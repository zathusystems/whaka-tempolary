from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse
from .models import TakeOrder, TakeOrderItem
from .serializers import TakeOrderSerializer, TakeOrderCreateSerializer
from business.models import Branch


class TakeOrderViewSet(viewsets.ModelViewSet):
    """ViewSet for managing take orders"""
    permission_classes = [IsAuthenticated]
    serializer_class = TakeOrderSerializer
    
    def get_permissions(self):
        """Override permissions for self_service action"""
        if self.action == 'self_service':
            return [AllowAny()]
        return super().get_permissions()
    
    def get_queryset(self):
        """Filter take orders by branch"""
        branch_id = self.request.query_params.get('branch_id')
        if branch_id:
            return TakeOrder.objects.filter(branch_id=branch_id).prefetch_related('items')
        return TakeOrder.objects.none()
    
    def get_serializer_class(self):
        if self.action == 'create':
            return TakeOrderCreateSerializer
        return TakeOrderSerializer
    
    def retrieve(self, request, *args, **kwargs):
        """Retrieve a single take order by ID"""
        try:
            # Get the take order by pk directly without filtering by branch_id
            take_order = TakeOrder.objects.get(pk=kwargs['pk'])
            serializer = self.get_serializer(take_order)
            return Response(serializer.data)
        except TakeOrder.DoesNotExist:
            return Response(
                {'error': 'Take order not found'},
                status=status.HTTP_404_NOT_FOUND
            )
    
    def create(self, request, *args, **kwargs):
        """Create a new take order"""
        branch_id = request.data.get('branch_id')
        
        try:
            branch = Branch.objects.get(id=branch_id)
        except Branch.DoesNotExist:
            return Response(
                {'error': 'Branch not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        serializer = self.get_serializer(
            data=request.data,
            context={'branch': branch, 'user': request.user}
        )
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        
        return Response(serializer.data, status=status.HTTP_201_CREATED)
    
    @action(detail=True, methods=['patch'])
    def update_status(self, request, pk=None):
        """Update take order status"""
        try:
            # Get the take order by pk directly without filtering by branch_id
            # This allows the endpoint to work without requiring branch_id query param
            take_order = TakeOrder.objects.get(pk=pk)
        except TakeOrder.DoesNotExist:
            return Response(
                {'error': 'Take order not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        new_status = request.data.get('status')
        
        if new_status not in dict(TakeOrder.STATUS_CHOICES):
            return Response(
                {'error': 'Invalid status'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        take_order.status = new_status
        
        if new_status == 'Completed':
            take_order.completed_at = timezone.now()
        
        take_order.save()
        
        return Response(
            TakeOrderSerializer(take_order).data,
            status=status.HTTP_200_OK
        )
    
    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def pending(self, request):
        """Get all pending take orders for a branch"""
        branch_id = request.query_params.get('branch_id')
        
        if not branch_id:
            return Response(
                {'error': 'branch_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        pending_orders = self.get_queryset().filter(
            branch_id=branch_id,
            status__in=['New', 'Preparing']
        )
        
        serializer = self.get_serializer(pending_orders, many=True)
        return Response(serializer.data)
    
    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def today(self, request):
        """Get all take orders created today for a branch"""
        branch_id = request.query_params.get('branch_id')
        
        if not branch_id:
            return Response(
                {'error': 'branch_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        today_orders = self.get_queryset().filter(
            branch_id=branch_id,
            created_at__date=timezone.now().date()
        )
        
        serializer = self.get_serializer(today_orders, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'], permission_classes=[AllowAny])
    def self_service(self, request):
        """Create a self-service order from public menu - NO AUTHENTICATION REQUIRED"""
        branch_id = request.data.get('branch_id')
        customer_name = request.data.get('customer_name')
        customer_phone = request.data.get('customer_phone')
        table_number = request.data.get('table_number')
        items = request.data.get('items', [])
        special_instructions = request.data.get('special_instructions', '')
        
        # Validate required fields
        if not branch_id:
            return Response(
                {'error': 'branch_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not customer_name:
            return Response(
                {'error': 'customer_name is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not items or len(items) == 0:
            return Response(
                {'error': 'At least one item is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            branch = Branch.objects.get(id=branch_id)
        except Branch.DoesNotExist:
            return Response(
                {'error': 'Branch not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Get the next order number
        last_order = TakeOrder.objects.filter(branch=branch).order_by('-order_number').first()
        next_order_number = (last_order.order_number + 1) if last_order else 1001
        
        # Create the take order (self-service, so no created_by user)
        take_order = TakeOrder.objects.create(
            order_number=next_order_number,
            branch=branch,
            business=branch.business,
            customer_name=customer_name,
            customer_phone=customer_phone,
            customer_notes=customer_phone or None,  # Store phone in notes for reference
            table_number=table_number,  # Store table number in dedicated field
            special_instructions=special_instructions,
            created_by=None,  # Self-service order, no user
            order_type='self_service',  # Mark as self-service
            status='New'
        )
        
        # Create items
        for item_data in items:
            TakeOrderItem.objects.create(
                take_order=take_order,
                inventory_item_id=item_data.get('inventory_item_id'),
                name=item_data.get('name'),
                quantity=item_data.get('quantity'),
                price=item_data.get('price'),
                notes=item_data.get('notes', '')
            )
        
        print(f"[TakeOrder] Self-service order created: #{take_order.order_number} for {customer_name}")
        serializer = TakeOrderSerializer(take_order)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


@csrf_exempt
def self_service_order(request):
    """Create a self-service order from public menu - NO AUTHENTICATION REQUIRED"""
    import json
    
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)
    
    print(f"[TakeOrder] self_service_order called")
    
    try:
        data = json.loads(request.body)
        branch_id = data.get('branch_id')
        customer_name = data.get('customer_name')
        customer_phone = data.get('customer_phone')
        table_number = data.get('table_number')
        items = data.get('items', [])
        special_instructions = data.get('special_instructions', '')
        
        # Validate required fields
        if not branch_id:
            return JsonResponse({'error': 'branch_id is required'}, status=400)
        
        if not customer_name:
            return JsonResponse({'error': 'customer_name is required'}, status=400)
        
        if not items or len(items) == 0:
            return JsonResponse({'error': 'At least one item is required'}, status=400)
        
        try:
            branch = Branch.objects.get(id=branch_id)
        except Branch.DoesNotExist:
            return JsonResponse({'error': 'Branch not found'}, status=404)
        
        # Get the next order number
        last_order = TakeOrder.objects.filter(branch=branch).order_by('-order_number').first()
        next_order_number = (last_order.order_number + 1) if last_order else 1001
        
        # Create the take order (self-service, so no created_by user)
        take_order = TakeOrder.objects.create(
            order_number=next_order_number,
            branch=branch,
            business=branch.business,
            customer_name=customer_name,
            customer_phone=customer_phone,
            customer_notes=customer_phone or None,  # Store phone in notes for reference
            table_number=table_number,  # Store table number in dedicated field
            special_instructions=special_instructions,
            created_by=None,  # Self-service order, no user
            order_type='self_service',  # Mark as self-service
            status='New'
        )
        
        # Create items
        for item_data in items:
            TakeOrderItem.objects.create(
                take_order=take_order,
                inventory_item_id=item_data.get('inventory_item_id'),
                name=item_data.get('name'),
                quantity=item_data.get('quantity'),
                price=item_data.get('price'),
                notes=item_data.get('notes', '')
            )
        
        print(f"[TakeOrder] Self-service order created: #{take_order.order_number} for {customer_name}")
        serializer = TakeOrderSerializer(take_order)
        return JsonResponse(serializer.data, status=201)
    
    except Exception as e:
        print(f"[TakeOrder] Error creating self-service order: {str(e)}")
        import traceback
        traceback.print_exc()
        return JsonResponse({'error': str(e)}, status=400)
