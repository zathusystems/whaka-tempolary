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

interface DebitNoteModalProps {
  order: Order | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onDebitNoteCreated?: () => void;
}

export function DebitNoteModal({
  order,
  isOpen,
  onOpenChange,
  onDebitNoteCreated,
}: DebitNoteModalProps) {
  const { format: formatCurrency } = useCurrency();
  const [isLoading, setIsLoading] = useState(false);
  const { register, handleSubmit, formState: { errors }, reset, watch, setValue } = useForm({
    defaultValues: {
      description: '',
      additional_amount: '',
      vat_amount: '',
    },
  });

  const additionalAmount = toFiniteNumber(watch('additional_amount'), 0);
  const vatAmount = toFiniteNumber(watch('vat_amount'), 0);
  const totalDebit = additionalAmount + vatAmount;
  const originalTotal = toFiniteNumber((order as any)?.total, 0);
  const originalVat = toFiniteNumber((order as any)?.vatAmount ?? (order as any)?.vat_amount ?? (order as any)?.tax, 0);
  const originalNet = toFiniteNumber((order as any)?.netAmount ?? (order as any)?.net_amount ?? (order as any)?.subtotal, Math.max(0, originalTotal - originalVat));
  const fiscalInvoiceNumber = String((order as any)?.fiscalInvoiceNumber ?? (order as any)?.fiscal_invoice_number ?? '').trim();
  const effectiveVatRate = originalNet > 0 ? originalVat / originalNet : 0;
  const effectiveVatRatePercent = effectiveVatRate * 100;

  useEffect(() => {
    if (!isOpen) return;
    reset({
      description: '',
      additional_amount: '',
      vat_amount: '',
    });
  }, [isOpen, order?.id, reset]);

  useEffect(() => {
    if (!isOpen) return;
    if (additionalAmount <= 0) {
      setValue('vat_amount', '0.00', { shouldDirty: false, shouldValidate: true });
      return;
    }

    setValue('vat_amount', formatAmountInput(additionalAmount * effectiveVatRate), { shouldDirty: true, shouldValidate: true });
  }, [additionalAmount, effectiveVatRate, isOpen, setValue]);

  const onSubmit = async (data: any) => {
    if (!order) return;

    setIsLoading(true);
    try {
      const response = await authFetch.fetch('/sessions/debit-notes/create_debit_note/', {
        method: 'POST',
        body: JSON.stringify({
          original_order_id: order.id,
          description: data.description,
          additional_amount: parseFloat(data.additional_amount),
          vat_amount: parseFloat(data.vat_amount),
        }),
      });

      if (response) {
        const debitNote = (response as any).debit_note ?? response;
        const eisStatus = String((response as any).eis_result?.eis_status || debitNote.eis_status || '').trim();
        toast({
          title: 'Debit Note Created',
          description: `Debit Note ${debitNote.debit_note_number} created${eisStatus ? ` with receipt status ${eisStatus}` : ''}.`,
        });
        reset();
        onOpenChange(false);
        onDebitNoteCreated?.();
      }
    } catch (error) {
      console.error('Error creating debit note:', error);
      toast({
        variant: 'destructive',
        title: 'Debit note failed',
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
          <DialogTitle>Debit Note</DialogTitle>
          <DialogDescription>
            Add a missed charge or increase the fiscal value for Order #{order.orderNumber}.
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

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="description">Explanation</Label>
            <Textarea
              id="description"
              placeholder="Example: missed item, undercharged price, or extra service charge to add to the original fiscal sale."
              {...register('description', { required: 'Description is required' })}
              className="min-h-24"
            />
            {errors.description && (
              <p className="text-sm text-red-500">{errors.description.message}</p>
            )}
          </div>

          {/* Additional Amount */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="additional_amount">Net additional charge</Label>
              <Input
                id="additional_amount"
                type="number"
                step="0.01"
                placeholder="0.00"
                {...register('additional_amount', {
                  required: 'Net additional charge is required',
                  min: { value: 0.01, message: 'Must be greater than 0' },
                })}
              />
              <p className="text-xs text-muted-foreground">Taxable amount to add before VAT.</p>
              {errors.additional_amount && (
                <p className="text-sm text-red-500">{String(errors.additional_amount.message)}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="vat_amount">VAT to add</Label>
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

          {/* Total Debit */}
          <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-orange-950">
            <div className="flex justify-between gap-3 font-semibold">
              <span>Total debit note value</span>
              <span>{formatCurrency(totalDebit)}</span>
            </div>
            <p className="mt-1 text-xs text-orange-900/80">
              New fiscal total after this debit note: {formatCurrency(originalTotal + totalDebit)}
            </p>
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
              Issue Debit Note
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
