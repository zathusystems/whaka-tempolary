'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AlertTriangle, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { authFetch } from '@/lib/auth-fetch';
import { logAuditAction } from '@/lib/audit';
import { useAuth } from '@/hooks/use-auth';
import { useCurrency } from '@/hooks/use-currency';
import type { Order } from '@/lib/db';


const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

interface VoidModalProps {
  order: Order | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  canVoid?: boolean;
  onVoidCreated?: (updatedOrder: Order) => void;
}

export function VoidModal({
  order,
  isOpen,
  onOpenChange,
  canVoid = true,
  onVoidCreated,
}: VoidModalProps) {
  const { user } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const [isLoading, setIsLoading] = useState(false);
  const { register, handleSubmit, formState: { errors }, reset, watch, setValue } = useForm({
    defaultValues: {
      void_reason: 'customer_request',
      reason_description: '',
      supporting_documents_text: '',
      refund_method: 'none',
      refund_amount: '0',
    },
  });

  const voidReason = watch('void_reason');
  const refundMethod = watch('refund_method');
  const refundAmount = toFiniteNumber(watch('refund_amount'), 0);
  const originalTotal = toFiniteNumber((order as any)?.total, 0);
  const originalVat = toFiniteNumber((order as any)?.vatAmount ?? (order as any)?.vat_amount ?? (order as any)?.tax, 0);
  const originalNet = toFiniteNumber((order as any)?.netAmount ?? (order as any)?.net_amount ?? (order as any)?.subtotal, Math.max(0, originalTotal - originalVat));
  const effectiveVatRate = originalNet > 0 ? (originalVat / originalNet) * 100 : 0;
  const fiscalInvoiceNumber = String((order as any)?.fiscalInvoiceNumber ?? (order as any)?.fiscal_invoice_number ?? '').trim();
  const paymentMethodDisplay = String((order as any)?.paymentMethod ?? (order as any)?.payment_method ?? '').trim() || 'N/A';

  React.useEffect(() => {
    if (!isOpen) {
      setIsLoading(false);
      return;
    }

      reset({
        void_reason: 'customer_request',
        reason_description: '',
        supporting_documents_text: '',
        refund_method: 'none',
        refund_amount: '0',
      });
  }, [isOpen, order?.id, reset]);

  React.useEffect(() => {
    if (!isOpen) return;
    if (refundMethod === 'none') {
      setValue('refund_amount', '0', { shouldDirty: false, shouldValidate: true });
    }
  }, [isOpen, refundMethod, setValue]);

  const onSubmit = async (data: any) => {
    if (!order) return;
    if (!canVoid) {
      toast({
        variant: 'destructive',
        title: 'Permission Denied',
        description: 'Only admin users can void sales.',
      });
      return;
    }

    setIsLoading(true);
    try {
      const supportingDocuments = String(data.supporting_documents_text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
      const response = await authFetch.fetch<any>('/sessions/void-transactions/create_void/', {
        method: 'POST',
        body: JSON.stringify({
          original_order_id: order.id,
          void_reason: data.void_reason,
          reason_description: data.reason_description,
          supporting_documents: supportingDocuments,
          voided_amount: originalNet,
          voided_vat: originalVat,
          refund_method: data.refund_method,
          refund_amount: parseFloat(data.refund_amount),
        }),
      });

      if (response) {
        const eisStatus = String(response.eis_result?.eis_status || response.void_transaction?.eis_status || '').trim();
        toast({
          title: 'Sale Voided',
          description: `Order #${order.orderNumber} voided${eisStatus ? ` with EIS status ${eisStatus}` : ''}.`,
        });

        reset();
        setIsLoading(false);
        onOpenChange(false);

        if (response.order) {
          onVoidCreated?.(response.order);
        } else {
          onVoidCreated?.(order);
        }

        try {
          await logAuditAction({
            userId: user?.uid || 'unknown',
            userName: user?.displayName || user?.email || 'System',
            branchId: order.branchId,
            actionType: 'ORDER_VOID',
            entityType: 'Order',
            entityId: order.id,
            details: {
              orderNumber: order.orderNumber,
              void_reason: data.void_reason,
              refund_method: data.refund_method,
              refund_amount: parseFloat(data.refund_amount),
              supporting_documents_count: supportingDocuments ? 1 : 0,
            },
          });
        } catch (auditError) {
          console.warn('Failed to log void audit action:', auditError);
        }

        void (async () => {
          try {
            const branchId =
              order.branchId ||
              localStorage.getItem('handypos-active-branch') ||
              'main';
            const { syncService } = await import('@/lib/services/sync-service');
            await syncService.fetchAllInventoryFromBackend(String(branchId));
            console.log('[Void] Refreshed inventory after void');
          } catch (syncError) {
            console.warn('[Void] Failed to refresh inventory after void:', syncError);
          }
        })();

        return;
      }
    } catch (error) {
      console.error('Error voiding sale:', error);
      toast({
        variant: 'destructive',
        title: 'Void failed',
        description: 'Try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!order) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-600" />
            Void Sale
          </DialogTitle>
          <DialogDescription>
            Cancel the full original sale for Order #{order.orderNumber}. Use a credit note for partial returns or partial refunds.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Warning */}
          <div className="rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm font-medium text-red-900">Void only when the whole receipt must be cancelled.</p>
            <p className="mt-1 text-xs text-red-800">
              This reverses the full fiscal sale, restores stock for all items, and records the correcting document with MRA EIS.
            </p>
          </div>

          {/* Original Order Info */}
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Original sale</p>
                <p className="font-semibold">Order #{order.orderNumber}</p>
                {fiscalInvoiceNumber && (
                  <p className="mt-0.5 break-all text-xs text-muted-foreground">Fiscal invoice {fiscalInvoiceNumber}</p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Full sale total</p>
                <p className="text-base font-bold">{formatCurrency(originalTotal)}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
              <div className="rounded-md bg-background p-2">
                <p className="text-muted-foreground">Taxable/net</p>
                <p className="font-medium">{formatCurrency(originalNet)}</p>
              </div>
              <div className="rounded-md bg-background p-2">
                <p className="text-muted-foreground">VAT reversed</p>
                <p className="font-medium">{formatCurrency(originalVat)}</p>
                <p className="text-[11px] text-muted-foreground">{effectiveVatRate.toFixed(2)}%</p>
              </div>
              <div className="rounded-md bg-background p-2">
                <p className="text-muted-foreground">Payment</p>
                <p className="font-medium">{paymentMethodDisplay}</p>
              </div>
            </div>
          </div>

          {/* Void Reason */}
          <div className="space-y-2">
            <Label htmlFor="void_reason">Reason</Label>
            <Select
              value={voidReason}
              onValueChange={(value) => setValue('void_reason', value, { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="customer_request">Customer Request</SelectItem>
                <SelectItem value="item_returned">Item Returned</SelectItem>
                <SelectItem value="wrong_order">Wrong Order</SelectItem>
                <SelectItem value="system_error">System Error</SelectItem>
                <SelectItem value="duplicate">Duplicate Entry</SelectItem>
                <SelectItem value="payment_failed">Payment Failed</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Detailed Description */}
          <div className="space-y-2">
            <Label htmlFor="reason_description">Explanation</Label>
            <Textarea
              id="reason_description"
              placeholder="Example: duplicate receipt, wrong sale, failed payment, or customer cancelled the whole sale."
              {...register('reason_description', { required: 'Description is required' })}
              className="min-h-20"
            />
            {errors.reason_description && (
              <p className="text-sm text-red-500">{errors.reason_description.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="supporting_documents_text">Supporting documents</Label>
            <Textarea
              id="supporting_documents_text"
              placeholder="Optional: return slip number, approval reference, or document URL. This is encoded as one MRA supporting document."
              {...register('supporting_documents_text')}
              className="min-h-16"
            />
          </div>

          {/* Refund Method */}
          <div className="space-y-2">
            <Label htmlFor="refund_method">Refund method</Label>
            <Select
              value={refundMethod}
              onValueChange={(value) => setValue('refund_method', value, { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No Refund</SelectItem>
                <SelectItem value="cash">Cash Refund</SelectItem>
                <SelectItem value="card">Card Refund</SelectItem>
                <SelectItem value="credit">Store Credit</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Refund Amount (if applicable) */}
          {refundMethod !== 'none' && (
            <div className="space-y-2">
              <Label htmlFor="refund_amount">Customer refund amount</Label>
              <Input
                id="refund_amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                {...register('refund_amount', {
                  required: 'Refund amount is required',
                  min: { value: 0, message: 'Cannot be negative' },
                  validate: (value) => {
                    const amount = toFiniteNumber(value, 0);
                    return amount <= originalTotal || 'Refund cannot exceed the original sale total';
                  },
                })}
              />
              {errors.refund_amount && (
                <p className="text-sm text-red-500">{errors.refund_amount.message}</p>
              )}
            </div>
          )}

          {/* Summary */}
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
            <div className="flex justify-between gap-3 font-semibold">
              <span>Full sale value to void</span>
              <span>{formatCurrency(originalTotal)}</span>
            </div>
            <p className="mt-1 text-xs text-orange-900/80">
              Net {formatCurrency(originalNet)} + VAT {formatCurrency(originalVat)} will be reversed.
            </p>
            {refundMethod !== 'none' && (
              <div className="mt-3 flex justify-between gap-3 border-t border-orange-200 pt-2">
                <span>Customer refund</span>
                <span className="font-semibold text-orange-700">{formatCurrency(refundAmount)}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || !canVoid}
              variant="destructive"
              className="flex-1"
            >
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Void Sale
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
