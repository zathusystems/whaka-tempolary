'use client';

import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { authFetch } from '@/lib/auth-fetch';
import { useCurrency } from '@/hooks/use-currency';
import type { Order } from '@/lib/db';


const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatAmountInput = (value: number): string => {
  if (!Number.isFinite(value)) return '';
  return Math.max(0, value).toFixed(2);
};

interface CreditNoteModalProps {
  order: Order | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreditNoteCreated?: () => void;
}

export function CreditNoteModal({
  order,
  isOpen,
  onOpenChange,
  onCreditNoteCreated,
}: CreditNoteModalProps) {
  const { format: formatCurrency } = useCurrency();
  const [isLoading, setIsLoading] = useState(false);
  const { register, handleSubmit, formState: { errors }, reset, watch, setValue } = useForm({
    defaultValues: {
      reason: 'refund',
      description: '',
      credit_amount: '',
      vat_amount: '',
    },
  });

  const selectedReason = watch('reason');
  const creditAmount = toFiniteNumber(watch('credit_amount'), 0);
  const vatAmount = toFiniteNumber(watch('vat_amount'), 0);
  const totalCredit = creditAmount + vatAmount;
  const originalTotal = toFiniteNumber((order as any)?.total, 0);
  const originalVat = toFiniteNumber((order as any)?.vatAmount ?? (order as any)?.vat_amount ?? (order as any)?.tax, 0);
  const originalNet = toFiniteNumber((order as any)?.netAmount ?? (order as any)?.net_amount ?? (order as any)?.subtotal, Math.max(0, originalTotal - originalVat));
  const fiscalInvoiceNumber = String((order as any)?.fiscalInvoiceNumber ?? (order as any)?.fiscal_invoice_number ?? '').trim();
  const canUseFullSaleAmount = originalTotal > 0;
  const effectiveVatRate = originalNet > 0 ? originalVat / originalNet : 0;
  const effectiveVatRatePercent = effectiveVatRate * 100;

  useEffect(() => {
    if (!isOpen) return;
    reset({
      reason: 'refund',
      description: '',
      credit_amount: '',
      vat_amount: '',
    });
  }, [isOpen, order?.id, reset]);

  useEffect(() => {
    if (!isOpen) return;
    if (creditAmount <= 0) {
      setValue('vat_amount', '0.00', { shouldDirty: false, shouldValidate: true });
      return;
    }

    const calculatedVat = Math.abs(creditAmount - originalNet) < 0.005
      ? originalVat
      : creditAmount * effectiveVatRate;
    setValue('vat_amount', formatAmountInput(calculatedVat), { shouldDirty: true, shouldValidate: true });
  }, [creditAmount, effectiveVatRate, isOpen, originalNet, originalVat, setValue]);

  const applyFullSaleAmount = () => {
    setValue('credit_amount', formatAmountInput(originalNet), { shouldDirty: true, shouldValidate: true });
    setValue('vat_amount', formatAmountInput(originalVat), { shouldDirty: true, shouldValidate: true });
  };

  const onSubmit = async (data: any) => {
    if (!order) return;

    setIsLoading(true);
    try {
      const response = await authFetch.fetch('/sessions/credit-notes/create_credit_note/', {
        method: 'POST',
        body: JSON.stringify({
          original_order_id: order.id,
          reason: data.reason,
          description: data.description,
          credit_amount: parseFloat(data.credit_amount),
          vat_amount: parseFloat(data.vat_amount),
        }),
      });

      if (response) {
        const creditNote = (response as any).credit_note ?? response;
        const eisStatus = String((response as any).eis_result?.eis_status || creditNote.eis_status || '').trim();
        toast({
          title: 'Credit Note Created',
          description: `Credit Note ${creditNote.credit_note_number} created${eisStatus ? ` with receipt status ${eisStatus}` : ''}.`,
        });
        reset();
        onOpenChange(false);
        onCreditNoteCreated?.();
      }
    } catch (error) {
      console.error('Error creating credit note:', error);
      toast({
        variant: 'destructive',
        title: 'Credit note failed',
        description: 'Try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!order) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Credit Note</DialogTitle>
          <DialogDescription>
            Reduce or refund part of Order #{order.orderNumber}. The credit note reverses value from the original fiscal sale.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
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
                <p className="text-xs text-muted-foreground">Original total</p>
                <p className="text-base font-bold">{formatCurrency(originalTotal)}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-background p-2">
                <p className="text-muted-foreground">Taxable/net</p>
                <p className="font-medium">{formatCurrency(originalNet)}</p>
              </div>
              <div className="rounded-md bg-background p-2">
                <p className="text-muted-foreground">VAT</p>
                <p className="font-medium">{formatCurrency(originalVat)}</p>
              </div>
            </div>
          </div>

          {/* Reason */}
          <div className="space-y-2">
            <Label htmlFor="reason">Reason</Label>
            <Select
              value={selectedReason}
              onValueChange={(value) => setValue('reason', value, { shouldValidate: true })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="return">Sales Return</SelectItem>
                <SelectItem value="refund">Customer Refund</SelectItem>
                <SelectItem value="discount">Discount Adjustment</SelectItem>
                <SelectItem value="error">Invoice Error Correction</SelectItem>
              </SelectContent>
            </Select>
            {errors.reason && (
              <p className="text-sm text-red-500">{errors.reason.message}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Explanation</Label>
            <Textarea
              id="description"
              placeholder="Example: Customer returned one item, wrong price was charged, or invoice total needs reducing."
              {...register('description', { required: 'Description is required' })}
              className="min-h-24"
            />
            {errors.description && (
              <p className="text-sm text-red-500">{errors.description.message}</p>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={applyFullSaleAmount}
              disabled={!canUseFullSaleAmount || isLoading}
            >
              Use full sale amount
            </Button>
          </div>

          {/* Credit Amount */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="credit_amount">Net amount to credit</Label>
              <Input
                id="credit_amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                {...register('credit_amount', {
                  required: 'Net credit amount is required',
                  min: { value: 0.01, message: 'Must be greater than 0' },
                  validate: (value) => {
                    const total = toFiniteNumber(value, 0) + toFiniteNumber(watch('vat_amount'), 0);
                    return originalTotal <= 0 || total <= originalTotal || 'Credit cannot exceed the original sale total';
                  },
                })}
              />
              <p className="text-xs text-muted-foreground">Taxable amount being reversed before VAT.</p>
              {errors.credit_amount && (
                <p className="text-sm text-red-500">{String(errors.credit_amount.message)}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="vat_amount">VAT to credit</Label>
              <Input
                id="vat_amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                readOnly
                className="bg-muted"
                {...register('vat_amount', {
                  required: 'VAT amount is required',
                  min: { value: 0, message: 'Cannot be negative' },
                  validate: (value) => {
                    const total = creditAmount + toFiniteNumber(value, 0);
                    return originalTotal <= 0 || total <= originalTotal || 'Credit cannot exceed the original sale total';
                  },
                })}
              />
              <p className="text-xs text-muted-foreground">
                Auto-calculated from original sale VAT rate ({effectiveVatRatePercent.toFixed(2)}%).
              </p>
              {errors.vat_amount && (
                <p className="text-sm text-red-500">{String(errors.vat_amount.message)}</p>
              )}
            </div>
          </div>

          {/* Total Credit */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-blue-950">
            <div className="flex justify-between gap-3 font-semibold">
              <span>Total credit note value</span>
              <span>{formatCurrency(totalCredit)}</span>
            </div>
            {originalTotal > 0 && totalCredit > originalTotal && (
              <p className="mt-2 text-xs font-medium text-red-600">This is higher than the original sale total.</p>
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
            <Button type="submit" disabled={isLoading} className="flex-1">
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Issue Credit Note
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
