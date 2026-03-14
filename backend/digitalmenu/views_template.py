from django.shortcuts import render, get_object_or_404
from django.views.decorators.http import require_http_methods
from business.models import Business, Branch
from .models import Menu, MenuConfig
from inventory.models import InventoryItem


@require_http_methods(["GET"])
def public_menu_view(request, business_slug, branch_slug):
    """
    Public menu view accessible at /{business_slug}/{branch_slug}
    """
    # Get business and branch
    business = get_object_or_404(Business, slug=business_slug)
    branch = get_object_or_404(Branch, slug=branch_slug, business=business)
    
    # Get menu config
    menu_config = MenuConfig.objects.filter(
        business=business,
        branch=branch
    ).first()
    
    if not menu_config:
        menu_config = MenuConfig.objects.create(
            business=business,
            branch=branch
        )
    
    # Get menu items
    menu_items = Menu.objects.filter(
        business=business,
        branch=branch
    ).select_related('inventory_item')
    
    # Group by category
    categories = {}
    for menu_item in menu_items:
        item = menu_item.inventory_item
        category = item.category or 'Uncategorized'
        if category not in categories:
            categories[category] = []
        categories[category].append(item)
    
    context = {
        'business': business,
        'branch': branch,
        'menu_config': menu_config,
        'categories': categories,
        'menu_items': menu_items,
    }
    
    return render(request, 'digitalmenu/public_menu.html', context)
