from rest_framework import serializers
from django.contrib.auth import get_user_model
from .models import Staff, StaffRole

User = get_user_model()

class StaffSerializer(serializers.ModelSerializer):
    class Meta:
        model = Staff
        fields = [
            'id', 'business', 'branch', 'name', 'email', 'phone', 'role',
            'assigned_product_type', 'is_fuel_attendant',
            'is_active', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

class StaffCreateSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=True, min_length=6)

    class Meta:
        model = Staff
        fields = ['name', 'email', 'phone', 'password', 'role', 'branch', 'assigned_product_type', 'is_fuel_attendant']

    def validate(self, attrs):
        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password')
        branch = validated_data.get('branch')
        business = getattr(branch, 'business', None)

        if not business:
            raise serializers.ValidationError('Branch is required to assign staff to a business')

        # Enforce that requester belongs to the same business (owner or admin staff)
        request_user = self.context['request'].user
        if business.owner != request_user:
            try:
                requester_staff = Staff.objects.get(user=request_user)
                if requester_staff.business_id != business.id or requester_staff.role != StaffRole.ADMIN:
                    raise serializers.ValidationError('You do not have permission to add staff to this business')
            except Staff.DoesNotExist:
                raise serializers.ValidationError('You do not have permission to add staff to this business')

        # Create user account
        user = User.objects.create_user(
            email=validated_data['email'],
            password=password,
            first_name=validated_data['name'].split()[0] if validated_data['name'] else '',
        )

        # Create staff record
        staff = Staff.objects.create(
            business=business,
            user=user,
            **validated_data
        )
        return staff

class StaffUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Staff
        fields = ['name', 'email', 'phone', 'role', 'branch', 'is_active', 'assigned_product_type', 'is_fuel_attendant']

    def validate(self, attrs):
        return attrs
