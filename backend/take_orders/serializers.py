from rest_framework import serializers
from .models import TakeOrder, TakeOrderItem


class TakeOrderItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = TakeOrderItem
        fields = ['id', 'inventory_item_id', 'name', 'quantity', 'price', 'notes', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']


class TakeOrderSerializer(serializers.ModelSerializer):
    items = TakeOrderItemSerializer(many=True, read_only=True)
    created_by_name = serializers.SerializerMethodField()
    order_type_display = serializers.CharField(source='get_order_type_display', read_only=True)
    
    class Meta:
        model = TakeOrder
        fields = [
            'id', 'order_number', 'status', 'order_type', 'order_type_display',
            'customer_name', 'customer_phone', 'customer_notes', 'table_number',
            'special_instructions', 'items', 'created_by', 'created_by_name',
            'created_at', 'updated_at', 'completed_at'
        ]
        read_only_fields = ['id', 'order_number', 'created_at', 'updated_at']
    
    def get_created_by_name(self, obj):
        """Get the name of the user who created the order"""
        if obj.created_by:
            return getattr(obj.created_by, 'full_name', None) or obj.created_by.get_username()
        return None


class TakeOrderCreateSerializer(serializers.ModelSerializer):
    items = TakeOrderItemSerializer(many=True, write_only=True)
    
    # Read-only fields for response
    id = serializers.CharField(read_only=True)
    order_number = serializers.IntegerField(read_only=True)
    status = serializers.CharField(read_only=True)
    order_type = serializers.CharField(read_only=True)
    order_type_display = serializers.CharField(source='get_order_type_display', read_only=True)
    created_by_name = serializers.CharField(source='created_by.get_full_name', read_only=True)
    created_at = serializers.DateTimeField(read_only=True)
    updated_at = serializers.DateTimeField(read_only=True)
    completed_at = serializers.DateTimeField(read_only=True, allow_null=True)
    items_response = TakeOrderItemSerializer(source='items', many=True, read_only=True)
    
    class Meta:
        model = TakeOrder
        fields = [
            'id', 'order_number', 'status', 'order_type', 'order_type_display',
            'customer_name', 'customer_phone', 'customer_notes', 'table_number',
            'special_instructions', 'items', 'items_response',
            'created_by', 'created_by_name', 'created_at', 'updated_at', 'completed_at'
        ]
    
    def create(self, validated_data):
        items_data = validated_data.pop('items', [])
        
        # Get the next order number
        branch = self.context['branch']
        last_order = TakeOrder.objects.filter(branch=branch).order_by('-order_number').first()
        next_order_number = (last_order.order_number + 1) if last_order else 1001
        
        # Create the take order
        take_order = TakeOrder.objects.create(
            order_number=next_order_number,
            branch=branch,
            business=branch.business,
            created_by=self.context['user'],
            **validated_data
        )
        
        # Create items
        for item_data in items_data:
            TakeOrderItem.objects.create(take_order=take_order, **item_data)
        
        return take_order
    
    def to_representation(self, instance):
        """Return full order data including items"""
        created_by_name = None
        if instance.created_by:
            # Try to get full name, fallback to username
            created_by_name = getattr(instance.created_by, 'full_name', None) or instance.created_by.get_username()
        
        return {
            'id': str(instance.id),
            'order_number': instance.order_number,
            'status': instance.status,
            'order_type': instance.order_type,
            'order_type_display': instance.get_order_type_display(),
            'customer_name': instance.customer_name,
            'customer_phone': instance.customer_phone,
            'customer_notes': instance.customer_notes,
            'table_number': instance.table_number,
            'special_instructions': instance.special_instructions,
            'items': TakeOrderItemSerializer(instance.items.all(), many=True).data,
            'created_by': str(instance.created_by.id) if instance.created_by else None,
            'created_by_name': created_by_name,
            'created_at': instance.created_at.isoformat(),
            'updated_at': instance.updated_at.isoformat(),
            'completed_at': instance.completed_at.isoformat() if instance.completed_at else None,
        }
