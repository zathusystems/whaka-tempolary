import uuid
from django.db import models
from business.models import Business, Branch
from inventory.models import InventoryItem


class Menu(models.Model):
    """Menu model to track which inventory items are on the menu for a branch"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name='menus')
    branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name='menus')
    inventory_item = models.ForeignKey(InventoryItem, on_delete=models.CASCADE, related_name='menu_entries')
    
    # Metadata
    added_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['added_at']
        unique_together = ('branch', 'inventory_item')
        indexes = [
            models.Index(fields=['business', 'branch']),
            models.Index(fields=['branch', 'inventory_item']),
        ]

    def __str__(self):
        return f"{self.inventory_item.name} - {self.branch.name}"


class MenuConfig(models.Model):
    """Digital menu configuration for each branch"""
    THEME_CHOICES = [
        ('light', 'Light'),
        ('dark', 'Dark'),
        ('auto', 'Auto (System)'),
    ]

    ITEMS_PER_ROW_CHOICES = [
        ('auto', 'Auto (Responsive)'),
        ('2', '2 Items'),
        ('3', '3 Items'),
        ('4', '4 Items'),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    business = models.ForeignKey(Business, on_delete=models.CASCADE, related_name='menu_configs')
    branch = models.OneToOneField(Branch, on_delete=models.CASCADE, related_name='menu_config')
    
    # Branding
    display_name = models.CharField(max_length=255, default='Our Menu')
    description = models.TextField(default='Welcome to our restaurant')
    tagline = models.CharField(max_length=255, default='Fresh & Delicious')
    footer_text = models.CharField(max_length=255, default='Thank you for your visit!')
    
    # Images
    business_logo = models.TextField(blank=True, null=True)  # Base64 encoded
    business_banner = models.TextField(blank=True, null=True)  # Base64 encoded
    
    # Colors
    primary_color = models.CharField(max_length=7, default='#263b57')  # Hex color
    accent_color = models.CharField(max_length=7, default='#236dd5')  # Hex color
    
    # Display Settings
    theme = models.CharField(max_length=10, choices=THEME_CHOICES, default='auto')
    items_per_row = models.CharField(max_length=10, choices=ITEMS_PER_ROW_CHOICES, default='3')
    currency = models.CharField(max_length=10, default='USD')  # No choices - accepts any currency from frontend
    
    # Display Options
    show_prices = models.BooleanField(default=True)
    show_categories = models.BooleanField(default=True)
    show_images = models.BooleanField(default=True)
    show_brand_info = models.BooleanField(default=True)
    show_contact_info = models.BooleanField(default=True)
    
    # Features
    enable_search = models.BooleanField(default=True)
    enable_filters = models.BooleanField(default=True)
    enable_sorting = models.BooleanField(default=True)
    
    # Order Management
    accept_orders = models.BooleanField(default=True)
    
    # Metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['business', 'branch']),
        ]

    def __str__(self):
        return f"Menu Config - {self.branch.name}"
