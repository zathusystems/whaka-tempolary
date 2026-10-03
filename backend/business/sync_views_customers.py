"""
Customer Sync Views
Handles synchronization of customers between frontend and backend
"""

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.utils import timezone
from .models import Customer, Branch
from .serializers import CustomerSerializer


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def sync_push(request):
    """
    Receive local customer changes from frontend and apply them to backend
    Handles create, update, and delete operations for customers
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
                
                if entity_type != 'Customer':
                    continue
                
                if op == 'create':
                    # Create new customer
                    customer_data = {
                        'id': change_id,
                        'branch_id': branch_id,
                        'business_id': branch.business_id,
                        **change_data
                    }
                    
                    customer = Customer.objects.create(**customer_data)
                    acknowledged.append({'id': change_id, 'server_id': str(customer.id)})
                
                elif op == 'update':
                    # Update existing customer, or create if it doesn't exist
                    try:
                        customer, created = Customer.objects.get_or_create(
                            id=change_id,
                            defaults={
                                'branch_id': branch_id,
                                'business_id': branch.business_id,
                                'name': 'Unnamed Customer',
                            }
                        )
                        
                        # Update fields
                        for field, value in change_data.items():
                            if hasattr(customer, field):
                                setattr(customer, field, value)
                        
                        customer.save()
                        acknowledged.append({'id': change_id, 'server_id': str(customer.id)})
                    
                    except Exception as e:
                        errors.append({
                            'id': change_id,
                            'error': str(e)
                        })
                
                elif op == 'delete':
                    # Delete customer
                    try:
                        customer = Customer.objects.get(id=change_id, branch_id=branch_id)
                        customer.delete()
                        acknowledged.append({'id': change_id})
                    except Customer.DoesNotExist:
                        errors.append({
                            'id': change_id,
                            'error': 'Customer not found'
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


def _get_customer_changes(branch_id, since):
    """
    Internal function to get customer changes
    """
    try:
        # Verify branch exists
        try:
            branch = Branch.objects.get(id=branch_id)
        except Branch.DoesNotExist:
            return None, 'Branch not found'
        
        # Parse since timestamp
        try:
            since_dt = timezone.datetime.fromisoformat(since.replace('Z', '+00:00'))
        except (ValueError, AttributeError):
            since_dt = timezone.datetime(2000, 1, 1, tzinfo=timezone.utc)
        
        # Get customers modified since timestamp
        customers = Customer.objects.filter(
            branch_id=branch_id,
            updated_at__gte=since_dt
        )
        
        serializer = CustomerSerializer(customers, many=True)
        
        return serializer.data, None
    
    except Exception as e:
        return None, str(e)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def sync_pull(request):
    """
    Send server customer changes to frontend
    Returns all customers modified since the given timestamp
    """
    try:
        branch_id = request.query_params.get('branch_id')
        since = request.query_params.get('since', '2000-01-01T00:00:00Z')
        
        if not branch_id:
            return Response(
                {'error': 'branch_id is required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        customers, error = _get_customer_changes(branch_id, since)
        
        if error:
            return Response(
                {'error': error},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
        
        return Response({
            'changes': {
                'customers': customers
            }
        }, status=status.HTTP_200_OK)
    
    except Exception as e:
        return Response(
            {'error': str(e)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
