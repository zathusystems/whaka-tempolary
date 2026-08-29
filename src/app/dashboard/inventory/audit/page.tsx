

'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Save,
  Search,
  Printer,
  FileUp,
  Send,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';

import { db, type InventoryItem, type StockTake } from '@/lib/db';
import { useCurrency } from '@/hooks/use-currency';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';
import { authFetch } from '@/lib/auth-fetch';

const LOCAL_STORAGE_KEYS = {
    ACTIVE_BRANCH: 'handypos-active-branch'
};

type StockTakeFormValues = {
  items: (InventoryItem & { countedStock: number | string })[];
};

export default function StockAuditPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [submissionMessage, setSubmissionMessage] = useState('');

  useEffect(() => {
    const branchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
    if (branchId) {
      setActiveBranchId(branchId);
    }
  }, []);

  const inventoryItems = useLiveQuery(
    () => {
        if (!activeBranchId) return [];
        return db.inventory.where('branchId').equals(activeBranchId).toArray().then(items => 
          items.filter(item => !item.isProduced)
        )
    },
    [activeBranchId]
  );

  const form = useForm<StockTakeFormValues>();
  const { control, handleSubmit, getValues } = form;

  const { fields, replace } = useFieldArray({
    control,
    name: 'items',
  });
  const hydratedBranchIdRef = useRef<string | null>(null);
  const watchedItems = useWatch({ control, name: 'items' }) || [];
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const visibleFields = useMemo(() => fields.filter((item) => {
    if (!normalizedSearchTerm) return true;
    return [item.name, item.sku, item.barcode, item.productCode, item.category]
      .some((value) => String(value || '').toLowerCase().includes(normalizedSearchTerm));
  }), [fields, normalizedSearchTerm]);

  useEffect(() => {
    // Dexie live queries can re-run while an input is being edited. Replacing
    // the field array on each result remounts inputs and makes them lose focus.
    if (!inventoryItems || !activeBranchId || hydratedBranchIdRef.current === activeBranchId) return;

    replace(inventoryItems.map((item) => ({
      ...item,
      countedStock: item.stockUnits ?? '',
    })));
    hydratedBranchIdRef.current = activeBranchId;
  }, [activeBranchId, inventoryItems, replace]);

  const { totalValue, countedValue, totalDiscrepancy } = useMemo(() => {
    const values = watchedItems;
    if (!values) {
      return { totalValue: 0, countedValue: 0, totalDiscrepancy: 0 };
    }
    const result = values.reduce(
      (acc, item) => {
        const systemStock = Number(item.stockUnits) || 0;
        const countedStock = Number(item.countedStock) || 0;
        const cost = Number(item.cost) || 0;

        acc.totalValue += systemStock * cost;
        acc.countedValue += countedStock * cost;
        acc.totalDiscrepancy += (countedStock - systemStock) * cost;
        return acc;
      },
      { totalValue: 0, countedValue: 0, totalDiscrepancy: 0 }
    );
    return result;
  }, [watchedItems]);

  const onConfirmSubmit = async (data: StockTakeFormValues) => {
    if (!user || !activeBranchId) {
        toast({ variant: 'destructive', title: 'Authentication Error', description: 'You must be logged in to submit an audit.' });
        return;
    }

    const changedItems = data.items.filter((item) =>
      Number(item.countedStock) !== Number(item.stockUnits)
    );
    if (changedItems.length === 0) {
      toast({
        title: 'No stock changes',
        description: 'Enter a different counted quantity for at least one product before submitting.',
      });
      setIsConfirmModalOpen(false);
      return;
    }

    setIsSubmitting(true);
    setSubmissionMessage(`Submitting ${changedItems.length} stock adjustment${changedItems.length === 1 ? '' : 's'}…`);

    const stockTakeRecord: StockTake = {
      id: `ST-${Date.now()}`,
      branchId: activeBranchId,
      createdAt: new Date().toISOString(),
      createdBy: user.displayName || user.email,
      status: 'Pending Approval',
      items: changedItems.map(item => ({
        itemId: item.id,
        itemName: item.name,
        systemStock: Number(item.stockUnits) || 0,
        countedStock: Number(item.countedStock) || 0,
        discrepancy: (Number(item.countedStock) || 0) - (Number(item.stockUnits) || 0),
      })),
      totalDiscrepancyValue: totalDiscrepancy,
    };

    try {
      await authFetch.fetch('/inventory/stock-takes/', {
        method: 'POST',
        body: JSON.stringify(stockTakeRecord),
      });

      // Only mirror the count locally after the server has applied the atomic audit.
      setSubmissionMessage('Updating this device with the confirmed stock count…');
      await Promise.all(changedItems.map((item) =>
        db.inventory.update(item.id, { stockUnits: Number(item.countedStock) || 0 })
      ));

      // Keep the local audit history for offline/audit-log screens.
      const stockTakeWithSync: StockTake = {
        ...stockTakeRecord,
        status: 'Approved',
        _dirty: false,
        _operation: 'update'
      };
      await db.stockTakes.add(stockTakeWithSync);

      toast({
        title: 'Stock audit applied',
        description: 'Counted stock is now the system stock. Purchase batches were reconciled on the server.',
      });
      router.push('/dashboard/inventory');
    } catch (error) {
      console.error('Failed to save stock take:', error);
      toast({
        variant: 'destructive',
        title: 'Error Submitting Audit',
        description: 'There was a problem saving the stock audit.',
      });
    } finally {
      setIsSubmitting(false);
      setSubmissionMessage('');
      setIsConfirmModalOpen(false);
    }
  };

  const renderDiscrepancy = (item: any) => {
    const systemStock = Number(item.stockUnits) || 0;
    const countedStock = Number(item.countedStock) || 0;
    const discrepancy = countedStock - systemStock;

    if (discrepancy === 0) {
      return <Badge variant="secondary">No Change</Badge>;
    }
    const isSurplus = discrepancy > 0;
    return (
      <Badge variant={isSurplus ? 'default' : 'destructive'} className={isSurplus ? 'bg-green-600' : ''}>
        {isSurplus ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
        {isSurplus ? '+' : ''}{discrepancy}
      </Badge>
    );
  };
  
   if (!activeBranchId) {
    return (
        <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex w-full flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
        <div className="grid gap-2">
          <Button variant="outline" size="sm" className="w-fit" onClick={() => router.back()}>
            <ArrowLeft className="mr-2" /> Back to Inventory
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Full Stock Audit</h1>
          <p className="text-muted-foreground">
            Count your physical stock and submit for approval to update system levels.
          </p>
        </div>
        <div className="flex items-center gap-2">
           <Button variant="outline" onClick={() => {}} disabled={isSubmitting}>
             <Printer className="mr-2" /> Print Count Sheet
            </Button>
            <Button onClick={() => setIsConfirmModalOpen(true)} disabled={isSubmitting || fields.length === 0}>
              {isSubmitting ? (
                  <><Loader2 className="mr-2 animate-spin" />Applying audit…</>
              ) : (
                  <><Send className="mr-2" />Submit & Update Stock</>
              )}
            </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">System Stock Value</CardTitle>
                  <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
              </CardContent>
          </Card>
           <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Counted Stock Value</CardTitle>
                  <FileUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(countedValue)}</div>
              </CardContent>
          </Card>
          <Card className={cn(totalDiscrepancy !== 0 && (totalDiscrepancy > 0 ? 'border-green-500' : 'border-destructive'))}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Discrepancy Value</CardTitle>
              </CardHeader>
              <CardContent>
                  <div className={cn("text-2xl font-bold", totalDiscrepancy !== 0 && (totalDiscrepancy > 0 ? 'text-green-600' : 'text-destructive'))}>
                    {totalDiscrepancy > 0 ? '+' : ''}{formatCurrency(totalDiscrepancy)}
                  </div>
              </CardContent>
          </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by product, SKU, barcode, or category..."
              className="w-full pl-10 md:w-80"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(() => setIsConfirmModalOpen(true))}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[250px]">Item</TableHead>
                    <TableHead className="text-right">System Stock</TableHead>
                    <TableHead className="w-40 text-right">Counted Stock</TableHead>
                    <TableHead className="text-right">Discrepancy</TableHead>
                    <TableHead className="text-right">Cost/Unit</TableHead>
                    <TableHead className="text-right">Discrepancy Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleFields.map((field) => {
                    const index = fields.findIndex((item) => item.id === field.id);
                    const systemStock = Number(field.stockUnits) || 0;
                    const countedStock = Number(form.watch(`items.${index}.countedStock`)) || 0;
                    const cost = Number(field.cost) || 0;
                    const discrepancy = countedStock - systemStock;
                    const discrepancyValue = discrepancy * cost;
                    
                    return (
                        <TableRow key={field.id} className={cn(discrepancy !== 0 && 'bg-muted/50')}>
                            <TableCell className="font-medium">{field.name}</TableCell>
                            <TableCell className="text-right font-mono">{systemStock} {field.unitType}</TableCell>
                            <TableCell className="text-right">
                                <Input
                                {...form.register(`items.${index}.countedStock`)}
                                type="number"
                                min="0"
                                step="0.001"
                                className="h-8 w-24 text-right ml-auto"
                                />
                            </TableCell>
                            <TableCell className="text-right">{renderDiscrepancy(form.watch(`items.${index}`))}
                            </TableCell>
                             <TableCell className="text-right font-mono">{formatCurrency(cost)}</TableCell>
                            <TableCell className={cn("text-right font-semibold", discrepancyValue !== 0 && (discrepancyValue > 0 ? 'text-green-600' : 'text-destructive'))}>
                                {discrepancyValue > 0 ? '+' : ''}{formatCurrency(discrepancyValue)}
                            </TableCell>
                        </TableRow>
                    );
                  })}
                  {visibleFields.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No products match your search.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </form>
        </CardContent>
      </Card>
      
      <Dialog open={isConfirmModalOpen} onOpenChange={setIsConfirmModalOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Apply Stock Audit?</DialogTitle>
                <DialogDescription>
                    This will set product stock to the counted quantity and reconcile purchase-batch availability. This action is recorded and cannot be queued while offline.
                </DialogDescription>
            </DialogHeader>
            <Card className="bg-muted">
                <CardHeader>
                    <CardTitle className="text-base">Summary of Changes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                     <div className="flex justify-between">
                        <span>Items with shortages:</span>
                        <span className="font-medium">{getValues('items')?.filter(i => (Number(i.countedStock) || 0) < (i.stockUnits || 0)).length || 0}</span>
                    </div>
                     <div className="flex justify-between">
                        <span>Items with surplus:</span>
                        <span className="font-medium">{getValues('items')?.filter(i => (Number(i.countedStock) || 0) > (i.stockUnits || 0)).length || 0}</span>
                    </div>
                    <div className="flex justify-between font-semibold pt-2 border-t">
                        <span>Total Discrepancy Value:</span>
                        <span className={cn(totalDiscrepancy !== 0 && (totalDiscrepancy > 0 ? 'text-green-600' : 'text-destructive'))}>
                          {totalDiscrepancy >= 0 ? `+${formatCurrency(totalDiscrepancy)}` : `-${formatCurrency(Math.abs(totalDiscrepancy))}`}
                        </span>
                    </div>
                </CardContent>
            </Card>
            <DialogFooter>
                <Button variant="ghost" onClick={() => setIsConfirmModalOpen(false)} disabled={isSubmitting}>Cancel</Button>
                <Button onClick={handleSubmit(onConfirmSubmit)} disabled={isSubmitting}>
                     {isSubmitting ? (
                        <Loader2 className="mr-2 animate-spin" />
                     ) : (
                        <Send className="mr-2" />
                     )}
                    {isSubmitting ? 'Applying audit…' : 'Submit Audit'}
                </Button>
            </DialogFooter>
            {isSubmitting && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
                <Loader2 className="h-4 w-4 animate-spin" />
                {submissionMessage}
              </p>
            )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
