from django.contrib import admin
from .models import Menu, MenuConfig


@admin.register(Menu)
class MenuAdmin(admin.ModelAdmin):
    list_display = ('inventory_item', 'branch', 'business', 'added_at', 'updated_at')
    list_filter = ('business', 'branch', 'added_at')
    search_fields = ('inventory_item__name', 'branch__name', 'business__name')
    readonly_fields = ('id', 'added_at', 'updated_at')
    
    fieldsets = (
        ('Business & Branch', {
            'fields': ('business', 'branch')
        }),
        ('Menu Item', {
            'fields': ('inventory_item',)
        }),
        ('Metadata', {
            'fields': ('id', 'added_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(MenuConfig)
class MenuConfigAdmin(admin.ModelAdmin):
    list_display = ('branch', 'business', 'display_name', 'theme', 'show_prices', 'accept_orders', 'updated_at')
    list_filter = ('business', 'theme', 'show_prices', 'accept_orders', 'updated_at')
    search_fields = ('branch__name', 'business__name', 'display_name')
    readonly_fields = ('id', 'created_at', 'updated_at')
    
    fieldsets = (
        ('Basic Info', {
            'fields': ('id', 'business', 'branch')
        }),
        ('Branding', {
            'fields': ('display_name', 'description', 'tagline', 'footer_text', 'business_logo', 'business_banner')
        }),
        ('Colors', {
            'fields': ('primary_color', 'accent_color')
        }),
        ('Display Settings', {
            'fields': ('theme', 'items_per_row', 'currency')
        }),
        ('Display Options', {
            'fields': ('show_prices', 'show_categories', 'show_images', 'show_brand_info', 'show_contact_info')
        }),
        ('Features', {
            'fields': ('enable_search', 'enable_filters', 'enable_sorting')
        }),
        ('Order Management', {
            'fields': ('accept_orders',)
        }),
        ('Metadata', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
