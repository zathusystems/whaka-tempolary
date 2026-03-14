from rest_framework import serializers
from .models import Menu, MenuConfig
from inventory.serializers import InventoryItemSerializer


class MenuSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source='inventory_item.name', read_only=True)
    item_details = InventoryItemSerializer(source='inventory_item', read_only=True)
    branch_name = serializers.CharField(source='branch.name', read_only=True)

    class Meta:
        model = Menu
        fields = [
            'id', 'business', 'branch', 'branch_name', 'inventory_item', 
            'item_name', 'item_details', 'added_at', 'updated_at'
        ]
        read_only_fields = ['added_at', 'updated_at', 'item_name', 'item_details', 'branch_name']


class MenuConfigSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source='branch.name', read_only=True)
    business_name = serializers.CharField(source='business.name', read_only=True)
    public_menu_url = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = MenuConfig
        fields = [
            'id', 'business', 'business_name', 'branch', 'branch_name',
            'display_name', 'description', 'tagline', 'footer_text',
            'business_logo', 'business_banner',
            'primary_color', 'accent_color',
            'theme', 'items_per_row', 'currency',
            'show_prices', 'show_categories', 'show_images',
            'show_brand_info', 'show_contact_info',
            'enable_search', 'enable_filters', 'enable_sorting',
            'accept_orders',
            'public_menu_url',
            'created_at', 'updated_at'
        ]
        read_only_fields = ['created_at', 'updated_at', 'business_name', 'branch_name', 'public_menu_url']

    def get_public_menu_url(self, obj):
        """Generate the public menu URL from business and branch slugs"""
        request = self.context.get('request')
        if request:
            # Get the host from the request
            host = request.get_host()
            protocol = 'https' if request.is_secure() else 'http'
        else:
            # Fallback if no request context
            protocol = 'https'
            host = 'localhost:9002'
        
        business_slug = obj.business.slug
        branch_slug = obj.branch.slug
        
        return f"{protocol}://{host}/{business_slug}/{branch_slug}/"
