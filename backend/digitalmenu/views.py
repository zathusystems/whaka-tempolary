from rest_framework import viewsets, permissions, status
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Menu, MenuConfig
from .serializers import MenuSerializer, MenuConfigSerializer


class IsBusinessOwner(permissions.BasePermission):
    """Permission to check if user owns the business"""
    def has_object_permission(self, request, view, obj):
        return obj.business.owner == request.user


class MenuViewSet(viewsets.ModelViewSet):
    """ViewSet for managing menu items (which inventory items are on the menu)"""
    serializer_class = MenuSerializer
    permission_classes = [permissions.IsAuthenticated, IsBusinessOwner]

    def get_queryset(self):
        """Filter menu items to only those belonging to the current user's business"""
        return Menu.objects.filter(business__owner=self.request.user)

    def perform_create(self, serializer):
        """Save menu item"""
        serializer.save()

    @action(detail=False, methods=['get'])
    def by_branch(self, request):
        """Get all menu items for a specific branch"""
        branch_id = request.query_params.get('branch_id')
        if not branch_id:
            return Response(
                {'error': 'branch_id query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        menu_items = self.get_queryset().filter(branch_id=branch_id)
        serializer = self.get_serializer(menu_items, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def add_item(self, request):
        """Add an inventory item to the menu for a branch"""
        try:
            from business.models import Business, Branch
            
            branch_id = request.data.get('branch_id')
            inventory_item_id = request.data.get('inventory_item_id')
            
            if not branch_id or not inventory_item_id:
                return Response(
                    {'error': 'branch_id and inventory_item_id are required'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Get business from authenticated user
            try:
                business = Business.objects.get(owner=request.user)
            except Business.DoesNotExist:
                return Response(
                    {'error': 'User does not have an associated business'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Verify branch belongs to this business
            try:
                branch = Branch.objects.get(id=branch_id, business=business)
            except Branch.DoesNotExist:
                return Response(
                    {'error': f'Branch {branch_id} not found'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Get or create menu item
            menu_item, created = Menu.objects.get_or_create(
                business=business,
                branch=branch,
                inventory_item_id=inventory_item_id
            )
            
            serializer = self.get_serializer(menu_item)
            return Response(
                serializer.data,
                status=status.HTTP_201_CREATED if created else status.HTTP_200_OK
            )
        
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=False, methods=['post'])
    def remove_item(self, request):
        """Remove an inventory item from the menu for a branch"""
        try:
            branch_id = request.data.get('branch_id')
            inventory_item_id = request.data.get('inventory_item_id')
            
            if not branch_id or not inventory_item_id:
                return Response(
                    {'error': 'branch_id and inventory_item_id are required'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            menu_item = Menu.objects.get(
                branch_id=branch_id,
                inventory_item_id=inventory_item_id,
                business__owner=request.user
            )
            menu_item.delete()
            
            return Response(status=status.HTTP_204_NO_CONTENT)
        
        except Menu.DoesNotExist:
            return Response(
                {'error': 'Menu item not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )


class MenuConfigViewSet(viewsets.ModelViewSet):
    """ViewSet for managing digital menu configuration per branch"""
    serializer_class = MenuConfigSerializer
    permission_classes = [permissions.IsAuthenticated, IsBusinessOwner]

    def get_queryset(self):
        """Filter menu configs to only those belonging to the current user's business"""
        return MenuConfig.objects.filter(business__owner=self.request.user)

    def create(self, request, *args, **kwargs):
        """Create or update menu config"""
        try:
            from business.models import Business, Branch
            
            print(f"[MenuConfig] Create request received")
            print(f"[MenuConfig] Request data: {request.data}")
            
            # Get business from authenticated user
            try:
                business = Business.objects.get(owner=request.user)
                print(f"[MenuConfig] Found business: {business.id}")
            except Business.DoesNotExist:
                print(f"[MenuConfig] No business found for user {request.user}")
                return Response(
                    {'error': 'User does not have an associated business'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Get branch from request data
            branch_id = request.data.get('branch')
            print(f"[MenuConfig] Branch ID: {branch_id}")
            
            if not branch_id:
                return Response(
                    {'error': 'branch is required'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Verify branch belongs to this business
            try:
                branch = Branch.objects.get(id=branch_id, business=business)
                print(f"[MenuConfig] Found branch: {branch.id}")
            except Branch.DoesNotExist:
                print(f"[MenuConfig] Branch {branch_id} not found for business {business.id}")
                return Response(
                    {'error': f'Branch {branch_id} not found'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Get or create config
            config, created = MenuConfig.objects.get_or_create(
                business=business,
                branch=branch
            )
            
            print(f"[MenuConfig] Config {'created' if created else 'retrieved'}: {config.id}")
            
            # Update with request data
            serializer = self.get_serializer(config, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            
            print(f"[MenuConfig] Config saved successfully")
            return Response(serializer.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)
        
        except Exception as e:
            print(f"[MenuConfig] Error: {str(e)}")
            import traceback
            traceback.print_exc()
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

    def perform_create(self, serializer):
        """Auto-populate business from authenticated user"""
        from business.models import Business
        
        try:
            business = Business.objects.get(owner=self.request.user)
        except Business.DoesNotExist:
            raise serializers.ValidationError('User must have a business')
        
        serializer.save(business=business)

    def perform_update(self, serializer):
        """Save menu config update"""
        serializer.save()

    @action(detail=False, methods=['get'], permission_classes=[])
    def public(self, request):
        """Get menu config for a specific branch - PUBLIC ENDPOINT (no auth required)"""
        branch_id = request.query_params.get('branch_id')
        
        if not branch_id:
            return Response(
                {'error': 'branch_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            from business.models import Branch
            
            # Get branch
            branch = Branch.objects.get(id=branch_id)
            
            # Get existing config or return defaults
            config, created = MenuConfig.objects.get_or_create(
                business=branch.business,
                branch=branch,
                defaults={
                    'display_name': 'Our Menu',
                    'description': 'Welcome to our restaurant',
                    'tagline': 'Fresh & Delicious',
                    'footer_text': 'Thank you for your visit!',
                    'primary_color': '#263b57',
                    'accent_color': '#236dd5',
                    'theme': 'auto',
                    'items_per_row': '3',
                    'currency': 'USD',
                    'show_prices': True,
                    'show_categories': True,
                    'show_images': True,
                    'show_brand_info': True,
                    'show_contact_info': True,
                    'enable_search': True,
                    'enable_filters': True,
                    'enable_sorting': True,
                    'accept_orders': True,
                }
            )
            
            print(f"[MenuConfig] Retrieved public config for branch {branch_id}: created={created}")
            serializer = self.get_serializer(config)
            return Response(serializer.data)
        
        except Exception as e:
            print(f"[MenuConfig] Error: {str(e)}")
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )

    @action(detail=False, methods=['get', 'post'])
    def by_branch(self, request):
        """Get or create menu config for a specific branch"""
        branch_id = request.query_params.get('branch_id') or request.data.get('branch_id')
        
        if not branch_id:
            return Response(
                {'error': 'branch_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            from business.models import Business, Branch
            
            # Get business from authenticated user
            business = Business.objects.get(owner=request.user)
            
            # Verify branch belongs to this business
            branch = Branch.objects.get(id=branch_id, business=business)
            
            if request.method == 'GET':
                # Get existing config or return defaults
                config, created = MenuConfig.objects.get_or_create(
                    business=business,
                    branch=branch,
                    defaults={
                        'display_name': 'Our Menu',
                        'description': 'Welcome to our restaurant',
                        'tagline': 'Fresh & Delicious',
                        'footer_text': 'Thank you for your visit!',
                        'primary_color': '#263b57',
                        'accent_color': '#236dd5',
                        'theme': 'auto',
                        'items_per_row': '3',
                        'currency': 'USD',
                        'show_prices': True,
                        'show_categories': True,
                        'show_images': True,
                        'show_brand_info': True,
                        'show_contact_info': True,
                        'enable_search': True,
                        'enable_filters': True,
                        'enable_sorting': True,
                        'accept_orders': True,
                    }
                )
                
                print(f"[MenuConfig] Retrieved config for branch {branch_id}: created={created}")
                serializer = self.get_serializer(config)
                return Response(serializer.data)
            
            elif request.method == 'POST':
                # Update or create config
                config, created = MenuConfig.objects.get_or_create(
                    business=business,
                    branch=branch
                )
                
                serializer = self.get_serializer(config, data=request.data, partial=True)
                serializer.is_valid(raise_exception=True)
                serializer.save()
                
                print(f"[MenuConfig] Updated config for branch {branch_id}")
                return Response(serializer.data, status=status.HTTP_200_OK)
        
        except Exception as e:
            print(f"[MenuConfig] Error: {str(e)}")
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
