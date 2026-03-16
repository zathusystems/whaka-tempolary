"""
Purchase Records Sync Views
Handles synchronization of purchase records (stock receipts) between frontend and backend
Implements offline-first pattern with FIFO batch tracking
"""

import re
from django.db.models import Q

from .models import InventoryItem, PurchaseOrderItem
from business.models import Business, Branch
from django.utils import timezone
from decimal import Decimal, InvalidOperation


def _parse_decimal(value, field_name, default=Decimal('0')):
    """Parse a non-negative finite Decimal from sync payload."""
    if value in (None, '', 'null', 'undefined'):
        return default
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        print(f"[Sync] Warning: Invalid decimal for {field_name}: {value}")
        return default
    if parsed.is_nan() or parsed.is_infinite():
        print(f"[Sync] Warning: Non-finite decimal for {field_name}: {value}")
        return default
    if parsed < 0:
        print(f"[Sync] Warning: Negative decimal for {field_name}: {value}")
        return default
    return parsed


def _resolve_branch_for_business(business, branch_id):
    """Resolve branch by id, legacy BRN-<id>, or common 'main' aliases."""
    if branch_id is None:
        return None
    raw = str(branch_id).strip()
    if not raw:
        return None

    match = re.match(r'^BRN-(\d+)$', raw, flags=re.IGNORECASE)
    if match:
        raw = match.group(1)

    if raw.isdigit():
        return Branch.objects.filter(id=int(raw), business=business).first()

    normalized = raw.lower()
    if normalized in {'main', 'main-branch', 'main_branch'}:
        return (
            Branch.objects.filter(business=business, name__iendswith='Main Branch')
            .order_by('created_at', 'id')
            .first()
        )

    return Branch.objects.filter(
        business=business
    ).filter(Q(slug=raw) | Q(name__iexact=raw)).first()


def handle_create_purchase_record(record_id, data, business, branch_id):
    """
    Handle creation of purchase record (stock receipt) from frontend
    
    This creates a PurchaseOrderItem batch record and updates inventory stock
    Implements FIFO batch tracking for proper stock management
    """
    try:
        print(f"[Sync] Creating purchase record {record_id} with data keys: {list(data.keys())}")
        
        # Validate branch exists (accept legacy/alias formats)
        branch = _resolve_branch_for_business(business, branch_id)
        if not branch:
            return {
                'success': False,
                'error': f'Branch {branch_id} not found for this business'
            }
        
        # Check if purchase record already exists
        existing = PurchaseOrderItem.objects.filter(
            id=record_id,
            purchase_order__business=business
        ).first()
        
        if existing:
            print(f"[Sync] Purchase record {record_id} already exists, updating instead")
            return handle_update_purchase_record(record_id, data, business, branch_id)
        
        # Get the inventory item
        product_id = data.get('productId') or data.get('product_id')
        if not product_id:
            return {
                'success': False,
                'error': 'productId is required'
            }
        
        try:
            inventory_item = InventoryItem.objects.get(
                id=product_id,
                business=business,
                branch=branch
            )
        except InventoryItem.DoesNotExist:
            return {
                'success': False,
                'error': f'Inventory item {product_id} not found'
            }
        
        # Parse quantity and cost - use Decimal for proper arithmetic with Django DecimalField
        quantity_received = _parse_decimal(
            data.get('quantityReceived') or data.get('quantity_received', 0),
            'quantity_received',
            Decimal('0')
        )
        cost_per_unit = _parse_decimal(
            data.get('costPerUnit') or data.get('cost_per_unit', 0),
            'cost_per_unit',
            Decimal('0')
        )
        tax_rate = _parse_decimal(
            data.get('taxRate') or data.get('tax_rate', 0),
            'tax_rate',
            Decimal('0')
        )
        tax_calc_method = data.get('taxCalculationMethod') or data.get('tax_calculation_method') or 'exclusive'
        if tax_calc_method not in {'inclusive', 'exclusive'}:
            tax_calc_method = 'exclusive'
        
        if quantity_received <= 0:
            return {
                'success': False,
                'error': 'Quantity received must be greater than 0'
            }
        
        print(f"[Sync] Purchase record: product={product_id}, quantity={quantity_received}, cost={cost_per_unit}")
        
        # Get or reuse existing purchase order
        # The PurchaseOrder should already exist from the frontend sync
        from .models import PurchaseOrder
        from uuid import uuid4
        
        po_id = data.get('purchaseOrderId') or data.get('purchase_order_id')
        
        if not po_id:
            # If no PO ID provided, this is a direct receipt without a PO
            # Create a minimal PO just to hold this item
            po_id = str(uuid4())
            reference_number = data.get('referenceNumber') or data.get('reference_number')
            vat_amount = data.get('vatAmount')
            if vat_amount is None:
                vat_amount = data.get('vat_amount')
            try:
                vat_amount_value = float(vat_amount) if vat_amount not in ('', None) else None
            except (TypeError, ValueError):
                vat_amount_value = None
            purchase_order = PurchaseOrder.objects.create(
                id=po_id,
                business=business,
                branch=branch,
                supplier=None,
                order_number=po_id,
                status='Received',
                total_items=1,
                total_cost=quantity_received * cost_per_unit,
                payment_status='Paid',
                reference_number=reference_number if reference_number not in ('', None) else None,
                vat_amount=vat_amount_value,
                created_by='System',
                received_date=timezone.now()
            )
            print(f"[Sync] Created minimal purchase order {po_id} for direct receipt")
        else:
            try:
                purchase_order = PurchaseOrder.objects.get(id=po_id, business=business)
                print(f"[Sync] Reusing existing purchase order {po_id}")
            except PurchaseOrder.DoesNotExist:
                # PO doesn't exist yet - this shouldn't happen if frontend synced it first
                # Create it now as a fallback
                raw_vat_amount = data.get('vatAmount')
                if raw_vat_amount is None:
                    raw_vat_amount = data.get('vat_amount')
                try:
                    vat_amount_value = float(raw_vat_amount) if raw_vat_amount not in ('', None) else None
                except (TypeError, ValueError):
                    vat_amount_value = None
                purchase_order = PurchaseOrder.objects.create(
                    id=po_id,
                    business=business,
                    branch=branch,
                    supplier=None,
                    order_number=po_id,
                    status='Received',
                    total_items=1,
                    total_cost=quantity_received * cost_per_unit,
                    payment_status='Paid',
                    reference_number=(data.get('referenceNumber') or data.get('reference_number')) or None,
                    vat_amount=vat_amount_value,
                    created_by='System',
                    received_date=timezone.now()
                )
                print(f"[Sync] Created fallback purchase order {po_id}")
        
        # Create purchase order item (batch record)
        purchase_item = PurchaseOrderItem.objects.create(
            id=record_id,
            purchase_order=purchase_order,
            inventory_item=inventory_item,
            session_id=data.get('sessionId') or data.get('session_id'),  # NEW: Link to session
            quantity_ordered=quantity_received,
            quantity_received=quantity_received,
            quantity_remaining=quantity_received,
            cost_per_unit=cost_per_unit,
            total_cost=quantity_received * cost_per_unit,
            tax_rate=tax_rate,
            tax_calculation_method=tax_calc_method,
            batch_number=data.get('batchNumber') or data.get('batch_number') or '',
            expiry_date=data.get('expiryDate') or data.get('expiry_date')
        )
        
        print(f"[Sync] Created purchase order item {record_id}")
        
        # Update inventory item stock
        old_stock = inventory_item.stock_units
        new_stock = old_stock + quantity_received
        
        inventory_item.stock_units = new_stock
        inventory_item.value = new_stock * (inventory_item.cost or 0)
        
        # Update status based on stock level
        if new_stock > inventory_item.reorder_level:
            inventory_item.status = 'In Stock'
        elif new_stock > 0:
            inventory_item.status = 'Low Stock'
        else:
            inventory_item.status = 'Out of Stock'
        
        inventory_item.save()
        
        print(f"[Sync] Updated inventory item {product_id}: stock {old_stock} -> {new_stock}")
        
        return {
            'success': True,
            'server_id': str(purchase_item.id)
        }
        
    except Exception as e:
        print(f"[Sync] Error creating purchase record: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e)
        }


def handle_update_purchase_record(record_id, data, business, branch_id):
    """
    Handle update of purchase record from frontend
    
    This handles changes to batch records (e.g., quantity adjustments)
    """
    try:
        print(f"[Sync] Updating purchase record {record_id} with data keys: {list(data.keys())}")
        
        # Get the purchase order item
        purchase_item = PurchaseOrderItem.objects.get(
            id=record_id,
            purchase_order__business=business
        )
        
        # Get the inventory item
        inventory_item = purchase_item.inventory_item
        
        # Calculate quantity change - convert to Decimal for proper arithmetic
        old_quantity_remaining = _parse_decimal(
            purchase_item.quantity_remaining,
            f'purchase_item.quantity_remaining:{record_id}',
            Decimal('0')
        )
        new_quantity_remaining_raw = data.get('quantityRemaining') or data.get('quantity_remaining')
        new_quantity_remaining = (
            _parse_decimal(
                new_quantity_remaining_raw,
                f'quantity_remaining:{record_id}',
                old_quantity_remaining
            )
            if new_quantity_remaining_raw is not None
            else old_quantity_remaining
        )
        allow_quantity_decrease = bool(
            data.get('allow_quantity_decrease')
            or data.get('allowQuantityDecrease')
        )
        # Consumption decrements must come from backend stock movement handlers.
        # Prevent duplicate decrements from generic sync updates.
        if new_quantity_remaining < old_quantity_remaining and not allow_quantity_decrease:
            print(
                f"[Sync] Ignoring quantity_remaining decrease for purchase record {record_id}: "
                f"{old_quantity_remaining} -> {new_quantity_remaining}. "
                "Use POS/waste stock movement endpoints for decrements."
            )
            new_quantity_remaining = old_quantity_remaining
        quantity_change = new_quantity_remaining - old_quantity_remaining
        
        print(f"[Sync] Purchase record quantity change: {old_quantity_remaining} -> {new_quantity_remaining} (change: {quantity_change})")
        
        # Update purchase item
        if 'quantityRemaining' in data or 'quantity_remaining' in data:
            purchase_item.quantity_remaining = new_quantity_remaining
        
        if 'batchNumber' in data or 'batch_number' in data:
            batch_num = data.get('batchNumber') or data.get('batch_number')
            # Ensure batch_number is never None - use empty string as default
            purchase_item.batch_number = batch_num if batch_num is not None else ''
        
        if 'expiryDate' in data or 'expiry_date' in data:
            purchase_item.expiry_date = data.get('expiryDate') or data.get('expiry_date')

        if 'taxRate' in data or 'tax_rate' in data:
            purchase_item.tax_rate = _parse_decimal(
                data.get('taxRate') or data.get('tax_rate', 0),
                f'tax_rate:{record_id}',
                purchase_item.tax_rate or Decimal('0')
            )

        if 'taxCalculationMethod' in data or 'tax_calculation_method' in data:
            tax_calc_method = data.get('taxCalculationMethod') or data.get('tax_calculation_method')
            if tax_calc_method in {'inclusive', 'exclusive'}:
                purchase_item.tax_calculation_method = tax_calc_method
        
        purchase_item.save()
        
        # Update inventory stock if quantity changed
        if quantity_change != 0:
            old_stock = inventory_item.stock_units
            new_stock = old_stock + quantity_change
            
            inventory_item.stock_units = max(0, new_stock)  # Prevent negative stock
            inventory_item.value = inventory_item.stock_units * (inventory_item.cost or 0)
            
            # Update status
            if inventory_item.stock_units > inventory_item.reorder_level:
                inventory_item.status = 'In Stock'
            elif inventory_item.stock_units > 0:
                inventory_item.status = 'Low Stock'
            else:
                inventory_item.status = 'Out of Stock'
            
            inventory_item.save()
            
            print(f"[Sync] Updated inventory item {inventory_item.id}: stock {old_stock} -> {inventory_item.stock_units}")
        
        return {
            'success': True,
            'server_id': str(purchase_item.id)
        }
        
    except PurchaseOrderItem.DoesNotExist:
        print(f"[Sync] Purchase record {record_id} not found, creating instead")
        return handle_create_purchase_record(record_id, data, business, branch_id)
    except Exception as e:
        print(f"[Sync] Error updating purchase record: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e)
        }


def handle_delete_purchase_record(record_id, business, branch_id):
    """
    Handle deletion of purchase record from frontend
    
    This removes a batch record and adjusts inventory stock accordingly
    """
    try:
        print(f"[Sync] Deleting purchase record {record_id}")
        
        # Get the purchase order item
        purchase_item = PurchaseOrderItem.objects.get(
            id=record_id,
            purchase_order__business=business
        )
        
        # Get the inventory item before deletion
        inventory_item = purchase_item.inventory_item
        quantity_to_remove = purchase_item.quantity_remaining
        
        # Delete the purchase item
        purchase_item.delete()
        
        print(f"[Sync] Deleted purchase record {record_id}")
        
        # Update inventory stock
        if quantity_to_remove > 0:
            old_stock = inventory_item.stock_units
            new_stock = max(0, old_stock - quantity_to_remove)
            
            inventory_item.stock_units = new_stock
            inventory_item.value = new_stock * (inventory_item.cost or 0)
            
            # Update status
            if new_stock > inventory_item.reorder_level:
                inventory_item.status = 'In Stock'
            elif new_stock > 0:
                inventory_item.status = 'Low Stock'
            else:
                inventory_item.status = 'Out of Stock'
            
            inventory_item.save()
            
            print(f"[Sync] Updated inventory item {inventory_item.id}: stock {old_stock} -> {new_stock}")
        
        return {
            'success': True,
            'server_id': record_id
        }
        
    except PurchaseOrderItem.DoesNotExist:
        print(f"[Sync] Purchase record {record_id} not found for deletion")
        return {
            'success': True,
            'server_id': record_id
        }
    except Exception as e:
        print(f"[Sync] Error deleting purchase record: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e)
        }
