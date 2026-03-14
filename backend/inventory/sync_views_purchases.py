"""
Purchase Sync Views
Handles synchronization of purchase orders between frontend and backend
"""

import re
from django.db.models import Q

from .models import InventoryItem, PurchaseOrder, PurchaseOrderItem, Supplier
from business.models import Business, Branch


def _parse_boolean(value, default=False):
    """Parse boolean-like values from sync payloads safely."""
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {'1', 'true', 'yes', 'on'}
    return default


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


def handle_create_purchase_order(po_id, data, business, branch_id):
    """Handle creation of purchase order from frontend"""
    try:
        print(f"[Sync] Creating PO {po_id} with data: {data}")
        
        # Validate branch exists (accept legacy/alias formats)
        branch = _resolve_branch_for_business(business, branch_id)
        if not branch:
            return {
                'success': False,
                'error': f'Branch {branch_id} not found for this business'
            }
        
        # Check if PO already exists
        existing = PurchaseOrder.objects.filter(id=po_id, business=business).first()
        if existing:
            print(f"[Sync] PO {po_id} already exists, updating instead")
            return handle_update_purchase_order(po_id, data, business, branch_id)
        
        # Get supplier if provided
        supplier = None
        if data.get('supplierId'):
            try:
                supplier = Supplier.objects.get(id=data['supplierId'], business=business)
                print(f"[Sync] Found supplier: {supplier.id} - {supplier.name}")
            except Supplier.DoesNotExist:
                print(f"[Sync] Supplier {data.get('supplierId')} not found for business {business.id}")
                # Don't pass - supplier can be None, but log the issue

        supplier_tin = data.get('supplierTin')
        if supplier_tin is None:
            supplier_tin = data.get('supplier_tin')

        supplier_vat_registered = data.get('supplierVatRegistered')
        if supplier_vat_registered is None:
            supplier_vat_registered = data.get('supplier_vat_registered')

        # Backfill supplier compliance values from linked supplier if payload omitted them.
        if supplier and supplier_tin in (None, ''):
            supplier_tin = supplier.supplier_tin
        if supplier and supplier_vat_registered is None:
            supplier_vat_registered = supplier.vat_registered
        
        # Create new PO
        # Note: order_number is a UUIDField, so we use po_id directly
        # Support both camelCase (from direct API) and snake_case (from sync)
        total_items = int(data.get('totalItems') or data.get('total_items', 0))
        total_cost = float(data.get('totalCost') or data.get('total_cost', 0)) or 0
        print(f"[Sync] PO totals from data: totalItems={total_items}, totalCost={total_cost}, raw data keys={list(data.keys())}")
        
        po_data = {
            'id': po_id,
            'business': business,
            'branch': branch,
            'supplier': supplier,  # ✅ Will be None if not found, but that's OK
            'order_number': po_id,  # Use the UUID directly, not a formatted string
            'status': data.get('status', 'Draft'),
            'total_items': total_items,
            'total_cost': total_cost,
            'payment_status': data.get('paymentStatus', 'Unpaid'),
            'amount_paid': float(data.get('amountPaid', 0)) or 0,
            'amount_due': float(data.get('amountDue', 0)) or 0,
            'supplier_tin': supplier_tin if supplier_tin not in ('', None) else None,
            'supplier_vat_registered': _parse_boolean(supplier_vat_registered, default=False),
            'notes': data.get('notes', ''),
            'created_by': data.get('createdBy', 'System'),
        }
        
        # ✅ Don't remove None values - supplier can be None
        # Only remove None values for optional fields that shouldn't be set
        po_data = {k: v for k, v in po_data.items() if v is not None or k == 'supplier'}
        
        po = PurchaseOrder.objects.create(**po_data)
        
        # Create PO items if provided
        if data.get('items'):
            for item_data in data['items']:
                try:
                    inventory_item = InventoryItem.objects.get(
                        id=item_data.get('inventoryItemId'),
                        business=business,
                        branch=branch
                    )
                    
                    # Calculate quantity_remaining: if not provided, default to quantity_received
                    quantity_received = float(item_data.get('quantityReceived', 0))
                    quantity_remaining = float(item_data.get('quantityRemaining', 0))
                    
                    # If quantityRemaining is 0 or not provided, set it to quantityReceived
                    if quantity_remaining == 0 and quantity_received > 0:
                        quantity_remaining = quantity_received
                        print(f"[Sync] Setting quantity_remaining to {quantity_remaining} (from quantityReceived)")
                    
                    po_item = PurchaseOrderItem.objects.create(
                        purchase_order=po,
                        inventory_item=inventory_item,
                        quantity_ordered=float(item_data.get('quantityOrdered', 0)),
                        quantity_received=quantity_received,
                        quantity_remaining=quantity_remaining,
                        cost_per_unit=float(item_data.get('costPerUnit', 0)),
                        batch_number=item_data.get('batchNumber', ''),
                        expiry_date=item_data.get('expiryDate')
                    )
                    print(f"[Sync] Created PO item: {po_item.inventory_item.name}, received={quantity_received}, remaining={quantity_remaining}")
                except InventoryItem.DoesNotExist:
                    print(f"[Sync] Inventory item {item_data.get('inventoryItemId')} not found")
        
        print(f"[Sync] Created purchase order {po_id}")
        
        return {
            'success': True,
            'server_id': str(po.id)
        }
        
    except Exception as e:
        print(f"[Sync] Error creating purchase order: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            'success': False,
            'error': str(e)
        }


def handle_update_purchase_order(po_id, data, business, branch_id):
    """Handle update of purchase order from frontend"""
    try:
        branch = _resolve_branch_for_business(business, branch_id)
        if branch:
            po = PurchaseOrder.objects.get(id=po_id, business=business, branch=branch)
        else:
            po = PurchaseOrder.objects.get(id=po_id, business=business)
        
        # Update fields
        if 'status' in data:
            po.status = data['status']
        if 'paymentStatus' in data:
            po.payment_status = data['paymentStatus']
        if 'amountPaid' in data:
            po.amount_paid = data['amountPaid']
        if 'amountDue' in data:
            po.amount_due = data['amountDue']
        if 'notes' in data:
            po.notes = data['notes']
        if 'totalCost' in data:
            po.total_cost = data['totalCost']
        
        # ✅ Handle supplier update
        if 'supplierId' in data:
            if data['supplierId']:
                try:
                    supplier = Supplier.objects.get(id=data['supplierId'], business=business)
                    po.supplier = supplier
                    print(f"[Sync] Updated PO supplier to: {supplier.id} - {supplier.name}")
                    if 'supplierTin' not in data and 'supplier_tin' not in data:
                        po.supplier_tin = supplier.supplier_tin
                    if 'supplierVatRegistered' not in data and 'supplier_vat_registered' not in data:
                        po.supplier_vat_registered = supplier.vat_registered
                except Supplier.DoesNotExist:
                    print(f"[Sync] Supplier {data['supplierId']} not found, keeping existing supplier")
            else:
                po.supplier = None
                print(f"[Sync] Cleared PO supplier")

        if 'supplierTin' in data or 'supplier_tin' in data:
            supplier_tin = data.get('supplierTin')
            if supplier_tin is None:
                supplier_tin = data.get('supplier_tin')
            po.supplier_tin = supplier_tin if supplier_tin not in ('', None) else None

        if 'supplierVatRegistered' in data or 'supplier_vat_registered' in data:
            supplier_vat_registered = data.get('supplierVatRegistered')
            if supplier_vat_registered is None:
                supplier_vat_registered = data.get('supplier_vat_registered')
            po.supplier_vat_registered = _parse_boolean(
                supplier_vat_registered,
                default=po.supplier_vat_registered,
            )
        
        po.save()
        print(f"[Sync] Updated purchase order {po_id}")
        
        return {
            'success': True,
            'server_id': str(po.id)
        }
        
    except PurchaseOrder.DoesNotExist:
        print(f"[Sync] PO {po_id} not found, creating instead")
        return handle_create_purchase_order(po_id, data, business, branch_id)
    except Exception as e:
        print(f"[Sync] Error updating purchase order: {str(e)}")
        return {
            'success': False,
            'error': str(e)
        }


def handle_delete_purchase_order(po_id, business, branch_id):
    """Handle deletion of purchase order from frontend"""
    try:
        branch = _resolve_branch_for_business(business, branch_id)
        if branch:
            po = PurchaseOrder.objects.get(id=po_id, business=business, branch=branch)
        else:
            po = PurchaseOrder.objects.get(id=po_id, business=business)
        po.delete()
        print(f"[Sync] Deleted purchase order {po_id}")
        
        return {
            'success': True,
            'server_id': po_id
        }
        
    except PurchaseOrder.DoesNotExist:
        print(f"[Sync] PO {po_id} not found for deletion")
        return {
            'success': True,
            'server_id': po_id
        }
    except Exception as e:
        print(f"[Sync] Error deleting purchase order: {str(e)}")
        return {
            'success': False,
            'error': str(e)
        }
