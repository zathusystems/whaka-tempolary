from django.db.models.signals import post_save
from django.dispatch import receiver
from django.utils import timezone
from decimal import Decimal
import uuid
from .models import Invoice
from pos_sessions.models import Order, OrderItem
from inventory.models import InventoryItem

# Note: Slug generation for Business and Branch is now handled in model save() methods


@receiver(post_save, sender=Invoice)
def handle_invoice_status_change(sender, instance, created, update_fields, **kwargs):
    """
    Handle invoice creation and status changes:
    - When invoice is created: Create a POS Order and deduct stock immediately
      (because customer has taken products on credit)
    - When marked as 'Void': Delete related Order and restore stock
    """
    
    # When invoice is first created, create order and deduct stock
    if created:
        _create_order_from_invoice(instance)
        return
    
    # Only process status updates if not a new creation
    if update_fields and 'status' not in update_fields:
        return
    
    current_status = instance.status
    
    # Handle transition to 'Paid' status
    if current_status == 'Paid':
        # Update related order to mark as paid
        if instance.related_order_id:
            _mark_invoice_order_as_paid(instance)
    
    # Handle transition to 'Void' status
    elif current_status == 'Void':
        # Only void if there's a related order
        if instance.related_order_id:
            _delete_order_from_invoice(instance)


def _create_order_from_invoice(invoice):
    """Create a POS Order from a paid invoice and deduct stock"""
    try:
        # Check if order already exists
        if invoice.related_order_id:
            print(f"[INVOICE] Order already exists for invoice #{invoice.invoice_number}")
            return
        
        # Get the next order number for this branch
        last_order = Order.objects.filter(branch=invoice.branch).order_by('order_number').last()
        next_order_number = (last_order.order_number if last_order else 0) + 1
        
        # Create the Order
        order = Order.objects.create(
            id=uuid.uuid4(),
            business=invoice.business,
            branch=invoice.branch,
            order_number=next_order_number,
            order_type='invoice',  # Mark as invoice sale
            status='Completed',
            payment_method='On Account',  # Invoices are typically on-account sales
            subtotal=invoice.subtotal,
            tax=invoice.tax,
            total=invoice.total,
            cogs=Decimal('0.00'),
            created_at=invoice.issue_date,
            is_invoice_sale=True,  # Mark as invoice sale
            invoice_id=str(invoice.id),  # Link to invoice
            is_paid=False,  # Not paid yet
        )
        
        # Create OrderItems and deduct stock
        total_cogs = Decimal('0.00')
        for item in invoice.items:
            # Create OrderItem
            OrderItem.objects.create(
                id=uuid.uuid4(),
                order=order,
                inventory_item_id=item.get('id', ''),
                name=item.get('name', ''),
                quantity=Decimal(str(item.get('quantity', 0))),
            )
            
            # Deduct stock from inventory
            try:
                inventory_item = InventoryItem.objects.get(id=item.get('id', ''))
                quantity_to_deduct = Decimal(str(item.get('quantity', 0)))
                
                # Calculate COGS
                if inventory_item.cost:
                    total_cogs += inventory_item.cost * quantity_to_deduct
                
                # Deduct stock
                inventory_item.stock_units -= quantity_to_deduct
                inventory_item.value = inventory_item.stock_units * (inventory_item.cost or Decimal('0.00'))
                inventory_item.update_status()
                inventory_item.save()
                
                print(f"[INVOICE] Deducted {quantity_to_deduct} units of {inventory_item.name} for invoice #{invoice.invoice_number}")
            except InventoryItem.DoesNotExist:
                print(f"[INVOICE WARNING] Inventory item {item.get('id')} not found for invoice #{invoice.invoice_number}")
        
        # Update order COGS
        order.cogs = total_cogs
        order.save()
        
        # Link the order to the invoice
        invoice.related_order_id = str(order.id)
        invoice.save(update_fields=['related_order_id'])
        
        print(f"[INVOICE] Created Order #{order.order_number} from Invoice #{invoice.invoice_number}")
        
    except Exception as e:
        print(f"[INVOICE ERROR] Failed to create order from invoice #{invoice.invoice_number}: {str(e)}")
        import traceback
        traceback.print_exc()


def _mark_invoice_order_as_paid(invoice):
    """Mark the related invoice order as paid"""
    try:
        if not invoice.related_order_id:
            print(f"[INVOICE] No related order found for invoice #{invoice.invoice_number}")
            return
        
        # Get the order
        try:
            order = Order.objects.get(id=invoice.related_order_id)
        except Order.DoesNotExist:
            print(f"[INVOICE WARNING] Related order {invoice.related_order_id} not found for invoice #{invoice.invoice_number}")
            return
        
        # Mark order as paid
        order.is_paid = True
        order.save(update_fields=['is_paid'])
        
        print(f"[INVOICE] Marked Order #{order.order_number} as paid for Invoice #{invoice.invoice_number}")
        
    except Exception as e:
        print(f"[INVOICE ERROR] Failed to mark order as paid for invoice #{invoice.invoice_number}: {str(e)}")
        import traceback
        traceback.print_exc()


def _delete_order_from_invoice(invoice):
    """Delete the related POS Order and restore stock when invoice is voided"""
    try:
        if not invoice.related_order_id:
            print(f"[INVOICE] No related order found for invoice #{invoice.invoice_number}")
            return
        
        # Get the order
        try:
            order = Order.objects.get(id=invoice.related_order_id)
        except Order.DoesNotExist:
            print(f"[INVOICE WARNING] Related order {invoice.related_order_id} not found for invoice #{invoice.invoice_number}")
            return
        
        # Restore stock for each item
        for item in invoice.items:
            try:
                inventory_item = InventoryItem.objects.get(id=item.get('id', ''))
                quantity_to_restore = Decimal(str(item.get('quantity', 0)))
                
                # Restore stock
                inventory_item.stock_units += quantity_to_restore
                inventory_item.value = inventory_item.stock_units * (inventory_item.cost or Decimal('0.00'))
                inventory_item.update_status()
                inventory_item.save()
                
                print(f"[INVOICE] Restored {quantity_to_restore} units of {inventory_item.name} for voided invoice #{invoice.invoice_number}")
            except InventoryItem.DoesNotExist:
                print(f"[INVOICE WARNING] Inventory item {item.get('id')} not found when voiding invoice #{invoice.invoice_number}")
        
        # Delete the order
        order.delete()
        
        # Clear the related order ID
        invoice.related_order_id = None
        invoice.save(update_fields=['related_order_id'])
        
        print(f"[INVOICE] Deleted Order #{order.order_number} and restored stock for voided Invoice #{invoice.invoice_number}")
        
    except Exception as e:
        print(f"[INVOICE ERROR] Failed to void order from invoice #{invoice.invoice_number}: {str(e)}")
        import traceback
        traceback.print_exc()
