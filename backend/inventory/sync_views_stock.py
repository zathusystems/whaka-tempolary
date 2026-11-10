"""
Stock Transfer Sync Views
Handles synchronization of stock transfers between frontend and backend
"""

from .models import InventoryItem, StockTransfer
from business.models import Business, Branch
from .services import InventoryService
from django.db.models import Q
import re


def _is_valid_uuid(value):
    try:
        import uuid
        uuid.UUID(str(value))
        return True
    except (TypeError, ValueError):
        return False


def _resolve_branch(branch_reference, business):
    """Resolve the branch identifiers used by web, mobile, and desktop clients."""
    raw = str(branch_reference or '').strip()
    if not raw:
        return None

    numeric_match = re.match(r'^(?:BRN-|branch-)(\d+)$', raw, flags=re.IGNORECASE)
    if numeric_match:
        raw = numeric_match.group(1)

    branches = Branch.objects.filter(business=business)
    if raw.isdigit():
        return branches.filter(id=int(raw)).first()

    normalized = raw.lower()
    if normalized in {'main', 'main-branch', 'main_branch'}:
        return branches.filter(name__iendswith='Main Branch').order_by('created_at', 'id').first()

    return branches.filter(Q(slug__iexact=raw) | Q(name__iexact=raw)).first()


# ============================================================================
# STOCK TRANSFER HANDLERS
# ============================================================================

def handle_create_stock_transfer(transfer_id, data, business, branch_id):
    """Handle creation of stock transfer from frontend"""
    try:
        from django.db import transaction
        from decimal import Decimal
        
        # A retry must be idempotent. The first request may have committed on
        # the server while the device lost its response; never move stock a
        # second time for the same local transfer UUID.
        if _is_valid_uuid(transfer_id):
            existing = StockTransfer.objects.filter(id=transfer_id, business=business).first()
            if existing:
                print(f"[Sync Stock] Transfer {transfer_id} already exists; acknowledging retry")
                return {'success': True, 'server_id': str(existing.id)}

        from_branch = _resolve_branch(
            # The authenticated sync request's branch is authoritative. The
            # payload value is only a compatibility fallback for older clients
            # that did not send branch_id.
            branch_id or data.get('fromBranchId') or data.get('from_branch_id'),
            business,
        )
        if from_branch is None:
            return {
                'success': False,
                'error': f'From branch {branch_id} not found for this business',
            }
        
        # Validate to branch exists
        to_branch_id = data.get('toBranchId') or data.get('to_branch_id') or data.get('to_branch') or data.get('branchId')
        if not to_branch_id:
            return {
                'success': False,
                'error': 'To branch ID is required'
            }
        
        to_branch = _resolve_branch(to_branch_id, business)
        if to_branch is None:
            return {
                'success': False,
                'error': f'To branch {to_branch_id} not found for this business'
            }
        
        # Get inventory item
        item_id = data.get('itemId') or data.get('item_id') or data.get('inventoryItemId') or data.get('inventory_item_id')
        if not item_id:
            return {
                'success': False,
                'error': 'Item ID is required'
            }
        
        try:
            inventory_item = InventoryItem.objects.get(id=item_id, business=business, branch=from_branch)
        except InventoryItem.DoesNotExist:
            return {
                'success': False,
                'error': f'Inventory item {item_id} not found in source branch'
            }
        
        try:
            quantity = Decimal(str(data.get('quantity', 0)))
        except Exception:
            return {'success': False, 'error': 'Quantity must be a valid number'}
        if quantity <= 0:
            return {'success': False, 'error': 'Quantity must be positive'}
        if quantity > inventory_item.stock_units:
            return {
                'success': False,
                'error': f'Cannot transfer {quantity}. Only {inventory_item.stock_units} available.',
            }

        with transaction.atomic():
            # Lock the source row so concurrent sales/transfers cannot make a
            # retry overdraw stock between validation and the decrement.
            inventory_item = InventoryItem.objects.select_for_update().get(id=inventory_item.id)
            if quantity > inventory_item.stock_units:
                return {
                    'success': False,
                    'error': f'Cannot transfer {quantity}. Only {inventory_item.stock_units} available.',
                }

            # Submit to EIS only after the locked source stock has been
            # validated. A concurrent sale must not produce an external EIS
            # transfer when the local movement cannot be committed.
            try:
                InventoryService._validate_eis_branch_transfer_mapping(
                    from_branch,
                    to_branch,
                    business,
                )
                eis_transfer_result = InventoryService.submit_eis_transfer_if_required(
                    from_branch,
                    to_branch,
                    inventory_item,
                    quantity,
                )
            except Exception as exc:
                return {
                    'success': False,
                    'error': str(exc),
                }

            # 1. Decrement stock at source branch
            inventory_item.stock_units -= quantity
            inventory_item.value = inventory_item.stock_units * (inventory_item.cost or 0)
            inventory_item.update_status()
            inventory_item.save()
            print(f"[Sync Stock] Decremented source branch stock: {item_id} by {quantity}")
            
            # 2. Find or create item at destination branch and increment stock
            # Use product name as the unique identifier for matching across branches
            destination_item, created = InventoryItem.objects.get_or_create(
                business=business,
                branch=to_branch,
                name=inventory_item.name,
                defaults={
                    'category': inventory_item.category,
                    'item_type': inventory_item.item_type,
                    'unit_type': inventory_item.unit_type,
                    'cost': inventory_item.cost,
                    'price': inventory_item.price,
                    'stock_units': quantity,
                    'value': quantity * (inventory_item.cost or 0),
                    'status': 'In Stock' if quantity > 0 else 'Out of Stock',
                    'supplier': inventory_item.supplier,
                    'manufacturer': inventory_item.manufacturer,
                    'batch': inventory_item.batch,
                    'expiry': inventory_item.expiry,
                    'sku': inventory_item.sku,
                    'barcode': inventory_item.barcode,
                    'is_recipe_ingredient': inventory_item.is_recipe_ingredient,
                    'is_produced': inventory_item.is_produced,
                    'is_sold_in_portions': inventory_item.is_sold_in_portions,
                    'portion_name': inventory_item.portion_name,
                    'portions_per_unit': inventory_item.portions_per_unit,
                    'brand': inventory_item.brand,
                    'recipe': inventory_item.recipe,
                    'image': inventory_item.image,
                    'on_menu': inventory_item.on_menu,
                    'reorder_level': inventory_item.reorder_level,
                }
            )
            
            if not created:
                # Item already exists at destination, just increment stock
                destination_item.stock_units += quantity
                destination_item.value = destination_item.stock_units * (destination_item.cost or 0)
                destination_item.update_status()
                print(f"[Sync Stock] Incremented existing destination item stock: {destination_item.id} by {quantity}")
            else:
                print(f"[Sync Stock] Created new destination item: {destination_item.id} with stock: {quantity}")
            
            destination_item.save()
            print(f"[Sync Stock] Destination branch stock updated: {destination_item.id}")
            
            # 3. Create transfer record
            transfer_data = {
                'business': business,
                'from_branch': from_branch,
                'to_branch': to_branch,
                'inventory_item': inventory_item,
                'quantity': quantity,
                'mra_notified': bool(eis_transfer_result),
                'initiated_by': data.get('initiatedBy') or data.get('initiated_by') or 'System',
            }
            if _is_valid_uuid(transfer_id):
                transfer_data['id'] = transfer_id
                # Keep a stable reference for retries and for audit exports.
                transfer_data['transfer_reference'] = f'TRF-{str(transfer_id).replace("-", "")[:8].upper()}'
            
            transfer = StockTransfer.objects.create(**transfer_data)
            print(f"[Sync Stock] Created stock transfer {transfer_id}")
        
        return {
            'success': True,
            'server_id': str(transfer.id)
        }
        
    except Exception as e:
        print(f"[Sync Stock] Error creating stock transfer: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e)
        }


def handle_update_stock_transfer(transfer_id, data, business, branch_id):
    """Handle update of stock transfer from frontend"""
    try:
        transfer = StockTransfer.objects.get(id=transfer_id, business=business)
        
        # Transfer rows are immutable stock movements. Treat a duplicate
        # update/retry as an acknowledgement instead of changing quantity
        # without applying the corresponding inventory movement.
        print(f"[Sync Stock] Transfer {transfer_id} already exists; acknowledging update")
        
        return {
            'success': True,
            'server_id': str(transfer.id)
        }
        
    except StockTransfer.DoesNotExist:
        print(f"[Sync Stock] Transfer {transfer_id} not found, creating instead")
        return handle_create_stock_transfer(transfer_id, data, business, branch_id)
    except Exception as e:
        print(f"[Sync Stock] Error updating stock transfer: {str(e)}")
        return {
            'success': False,
            'error': str(e)
        }


def handle_delete_stock_transfer(transfer_id, business, branch_id):
    """Handle deletion of stock transfer from frontend"""
    try:
        transfer = StockTransfer.objects.get(id=transfer_id, business=business)
        transfer.delete()
        print(f"[Sync Stock] Deleted stock transfer {transfer_id}")
        
        return {
            'success': True,
            'server_id': transfer_id
        }
        
    except StockTransfer.DoesNotExist:
        print(f"[Sync Stock] Transfer {transfer_id} not found for deletion")
        return {
            'success': True,
            'server_id': transfer_id
        }
    except Exception as e:
        print(f"[Sync Stock] Error deleting stock transfer: {str(e)}")
        return {
            'success': False,
            'error': str(e)
        }
