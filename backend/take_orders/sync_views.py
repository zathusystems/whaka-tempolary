from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone
from .models import TakeOrder, TakeOrderItem
from .serializers import TakeOrderSerializer
from business.models import Branch


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def sync_push(request):
    """
    Receive local changes from frontend and apply them to backend
    Handles create, update, and delete operations for take orders
    """
    try:
        data = request.data
        branch_id = data.get('branch_id')
        changes = data.get('changes', [])
        
        if not branch_id:
            return Response(
                {'error': 'branch_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Verify branch exists and user has access
        try:
            branch = Branch.objects.get(id=branch_id)
        except Branch.DoesNotExist:
            return Response(
                {'error': 'Branch not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        acknowledged = []
        conflicts = []
        errors = []
        
        for change in changes:
            try:
                entity_type = change.get('entity_type')
                op = change.get('op')  # 'create', 'update', 'delete'
                change_id = change.get('id')
                change_data = change.get('data', {})
                
                if entity_type != 'TakeOrder':
                    continue
                
                if op == 'create':
                    # Create new take order
                    take_order_data = {
                        'id': change_id,
                        'branch_id': branch_id,
                        'business_id': branch.business_id,
                        'created_by_id': request.user.id,
                        **change_data
                    }
                    
                    # Get next order number
                    last_order = TakeOrder.objects.filter(branch_id=branch_id).order_by('-order_number').first()
                    take_order_data['order_number'] = (last_order.order_number + 1) if last_order else 1001
                    
                    take_order = TakeOrder.objects.create(**take_order_data)
                    
                    # Create items if provided
                    items_data = change_data.get('items', [])
                    for item_data in items_data:
                        TakeOrderItem.objects.create(
                            take_order=take_order,
                            **item_data
                        )
                    
                    acknowledged.append({'id': change_id})
                
                elif op == 'update':
                    # Update existing take order, or create if it doesn't exist
                    try:
                        take_order, created = TakeOrder.objects.get_or_create(
                            id=change_id,
                            defaults={
                                'branch_id': branch_id,
                                'business_id': branch.business_id,
                                'created_by_id': request.user.id,
                                'order_number': 1001,  # Will be updated below if provided
                            }
                        )
                        
                        # Update fields
                        for field, value in change_data.items():
                            if field != 'items' and hasattr(take_order, field):
                                setattr(take_order, field, value)
                        
                        # If order_number wasn't provided and this is a new order, generate it
                        if created and 'order_number' not in change_data:
                            last_order = TakeOrder.objects.filter(
                                branch_id=branch_id
                            ).exclude(id=change_id).order_by('-order_number').first()
                            take_order.order_number = (last_order.order_number + 1) if last_order else 1001
                        
                        take_order.save()
                        
                        # Update items if provided
                        if 'items' in change_data:
                            TakeOrderItem.objects.filter(take_order=take_order).delete()
                            for item_data in change_data['items']:
                                TakeOrderItem.objects.create(
                                    take_order=take_order,
                                    **item_data
                                )
                        
                        acknowledged.append({'id': change_id})
                    
                    except Exception as e:
                        errors.append({
                            'id': change_id,
                            'error': str(e)
                        })
                
                elif op == 'delete':
                    # Delete take order
                    try:
                        take_order = TakeOrder.objects.get(id=change_id, branch_id=branch_id)
                        take_order.delete()
                        acknowledged.append({'id': change_id})
                    except TakeOrder.DoesNotExist:
                        errors.append({
                            'id': change_id,
                            'error': 'Take order not found'
                        })
            
            except Exception as e:
                errors.append({
                    'id': change.get('id'),
                    'error': str(e)
                })
        
        return Response({
            'results': {
                'acknowledged': acknowledged,
                'conflicts': conflicts,
                'errors': errors
            }
        }, status=status.HTTP_200_OK)
    
    except Exception as e:
        return Response(
            {'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sync_pull(request):
    """
    Send server changes to frontend
    Returns all take orders modified since the given timestamp
    """
    try:
        branch_id = request.query_params.get('branch_id')
        since = request.query_params.get('since', '2000-01-01T00:00:00Z')
        
        if not branch_id:
            return Response(
                {'error': 'branch_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Verify branch exists
        try:
            branch = Branch.objects.get(id=branch_id)
        except Branch.DoesNotExist:
            return Response(
                {'error': 'Branch not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Parse since timestamp
        try:
            since_dt = timezone.datetime.fromisoformat(since.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            since_dt = timezone.datetime(2000, 1, 1, tzinfo=timezone.utc)
        
        # Get take orders modified since timestamp
        take_orders = TakeOrder.objects.filter(
            branch_id=branch_id,
            updated_at__gte=since_dt
        ).prefetch_related('items')
        
        serializer = TakeOrderSerializer(take_orders, many=True)
        
        return Response({
            'changes': {
                'take_orders': serializer.data
            }
        }, status=status.HTTP_200_OK)
    
    except Exception as e:
        return Response(
            {'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
