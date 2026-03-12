

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useForm, useFieldArray } from 'react-hook-form';
import {
  FileSignature,
  PlusCircle,
  MoreHorizontal,
  Trash2,
  Calendar as CalendarIcon,
  X,
  Plus,
  Loader2,
  Edit,
} from 'lucide-react';
import { format } from 'date-fns';
import { Download } from 'lucide-react';

import { db, type Invoice, type Customer, type InventoryItem, type TaxRate, type Subscription } from '@/lib/db';
import { authFetch } from '@/lib/auth-fetch';
import { useCurrency } from '@/hooks/use-currency';
import { generateInvoicePDF } from '@/lib/invoice-pdf';
import { canUseInvoicing } from '@/lib/subscription-access';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

const LOCAL_STORAGE_KEYS = {
    ACTIVE_BRANCH: 'handypos-active-branch',
};

type InvoiceFormValues = {
  customerId: string;
  issueDate: Date;
  dueDate: Date;
  items: {
    productId: string;
    name: string;
    quantity: number;
    price: number;
  }[];
  notes?: string;
};

const InvoiceForm = ({
  onFormSubmit,
  customers,
  products,
  defaultTaxRate,
}: {
  onFormSubmit: () => void;
  customers: Customer[];
  products: InventoryItem[];
  defaultTaxRate?: TaxRate;
}) => {
  const [activeBranchId, setActiveBranchId] = useState('main');
  const [isLoading, setIsLoading] = useState(false);
  const { format: formatCurrency } = useCurrency();

  useEffect(() => {
    const branchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
    if (branchId) setActiveBranchId(branchId);
  }, []);

  const form = useForm<InvoiceFormValues>({
    defaultValues: {
      issueDate: new Date(),
      dueDate: new Date(new Date().setDate(new Date().getDate() + 30)),
      items: [{ productId: '', name: '', quantity: 1, price: 0 }],
    },
  });

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: 'items',
  });
  
  const taxRate = defaultTaxRate ? defaultTaxRate.rate / 100 : 0;
  const taxLabel = defaultTaxRate ? `${defaultTaxRate.name} (${defaultTaxRate.rate}%)` : 'Tax';

  const { subtotal, tax, total } = useMemo(() => {
    const items = form.watch('items');
    const sub = items.reduce((acc, item) => acc + (item.quantity * item.price), 0);
    const taxAmount = sub * taxRate;
    return { subtotal: sub, tax: taxAmount, total: sub + taxAmount };
  }, [form.watch('items'), taxRate]);

  const onSubmit = async (data: InvoiceFormValues) => {
    setIsLoading(true);
    try {
      const selectedCustomer = customers.find(c => c.id === data.customerId);
      if (!selectedCustomer) {
        throw new Error('Customer not found');
      }

      const lastInvoice = await db.invoices.orderBy('invoiceNumber').last();
      const newInvoiceNumber = (lastInvoice?.invoiceNumber || 0) + 1;

      const invoicePayload = {
        invoice_number: newInvoiceNumber,
        customer_id: selectedCustomer.id,
        customer_name: selectedCustomer.name,
        status: 'Draft',
        items: data.items.map(item => ({
          product_id: item.productId,
          name: item.name,
          quantity: Number(item.quantity),
          price: Number(item.price),
        })),
        subtotal: Number(subtotal.toFixed(2)),
        tax: Number(tax.toFixed(2)),
        total: Number(total.toFixed(2)),
        issue_date: data.issueDate.toISOString(),
        due_date: data.dueDate.toISOString(),
        notes: data.notes || '',
      };

      // Send to backend
      const backendInvoice = await authFetch.fetch('/api/invoices/', {
        method: 'POST',
        body: JSON.stringify(invoicePayload),
        meta: {
          domain: 'sales',
          entityType: 'invoice',
          metadata: { action: 'create' },
        },
      });

      // Store in local DB with sync metadata
      const newInvoice: Invoice = {
        id: backendInvoice.id.toString(),
        invoiceNumber: newInvoiceNumber,
        branchId: activeBranchId,
        customerId: selectedCustomer.id,
        customerName: selectedCustomer.name,
        status: 'Draft',
        items: data.items.map(item => ({
          id: item.productId,
          productId: item.productId,
          name: item.name,
          quantity: Number(item.quantity),
          price: Number(item.price),
          total: Number(item.quantity) * Number(item.price),
        })),
        subtotal,
        tax,
        total,
        issueDate: data.issueDate.toISOString(),
        dueDate: data.dueDate.toISOString(),
        notes: data.notes,
        relatedOrderId: backendInvoice.related_order_id || undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await db.invoices.add(newInvoice);
      toast({ title: `Invoice #${newInvoiceNumber} Created`, description: 'Stock has been deducted and a POS order has been created.' });
      onFormSubmit();
      form.reset();
    } catch (error) {
      console.error('Failed to save invoice:', error);
      toast({ 
        variant: 'destructive', 
        title: 'Error', 
        description: error instanceof Error ? error.message : 'Failed to create invoice'
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FormField
                control={form.control}
                name="customerId"
                rules={{ required: 'Please select a customer.'}}
                render={({ field }) => (
                    <FormItem className="md:col-span-1">
                    <FormLabel>Customer</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                        <SelectTrigger>
                            <SelectValue placeholder="Select a customer" />
                        </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                        {customers.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                            {c.name}
                            </SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                    <FormMessage />
                    </FormItem>
                )}
            />
             <FormField
                control={form.control}
                name="issueDate"
                render={({ field }) => (
                    <FormItem className="flex flex-col">
                    <FormLabel>Issue Date</FormLabel>
                    <Popover><PopoverTrigger asChild><FormControl>
                        <Button variant="outline" className={cn(!field.value && "text-muted-foreground")}>
                            {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                    </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus/>
                    </PopoverContent></Popover>
                    <FormMessage />
                    </FormItem>
                )}
             />
             <FormField
                control={form.control}
                name="dueDate"
                render={({ field }) => (
                    <FormItem className="flex flex-col">
                    <FormLabel>Due Date</FormLabel>
                    <Popover><PopoverTrigger asChild><FormControl>
                        <Button variant="outline" className={cn(!field.value && "text-muted-foreground")}>
                            {field.value ? format(field.value, 'PPP') : <span>Pick a date</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                    </FormControl></PopoverTrigger><PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} />
                    </PopoverContent></Popover>
                    <FormMessage />
                    </FormItem>
                )}
            />
        </div>
        
        <Separator />
        
        <div>
            <h3 className="text-lg font-medium mb-2">Invoice Items</h3>
            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-12 gap-2 p-3 border rounded-lg items-start">
                  <div className="col-span-12 sm:col-span-5">
                    <FormField
                      control={form.control}
                      name={`items.${index}.productId`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="sr-only">Product</FormLabel>
                          <Select onValueChange={(value) => {
                            const product = products.find(p => p.id === value);
                            if (product) {
                                field.onChange(value);
                                update(index, { ...form.getValues(`items.${index}`), name: product.name, price: product.price || 0 });
                            }
                          }}>
                            <FormControl><SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger></FormControl>
                            <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                     <FormField control={form.control} name={`items.${index}.quantity`} render={({ field }) => (
                         <FormItem><FormLabel className="sr-only">Qty</FormLabel><FormControl><Input type="number" placeholder="Qty" {...field} /></FormControl></FormItem>
                     )} />
                  </div>
                   <div className="col-span-4 sm:col-span-2">
                     <FormField control={form.control} name={`items.${index}.price`} render={({ field }) => (
                         <FormItem><FormLabel className="sr-only">Price</FormLabel><FormControl><Input type="number" step="0.01" placeholder="Price" {...field} /></FormControl></FormItem>
                     )} />
                  </div>
                  <div className="col-span-3 sm:col-span-2 flex items-center">
                    <p className="font-medium w-full text-right">{formatCurrency(form.watch(`items.${index}.quantity`) * form.watch(`items.${index}.price`))}</p>
                  </div>
                  <div className="col-span-1 flex items-center justify-end">
                    <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="text-destructive"><X className="h-4 w-4" /></Button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" onClick={() => append({ productId: '', name: '', quantity: 1, price: 0 })}>
                <Plus className="mr-2 h-4 w-4" /> Add Item
              </Button>
            </div>
        </div>
        
        <Separator />
        
        <div className="flex justify-end">
            <div className="w-full max-w-sm space-y-4">
                <div className="flex justify-between"><span>Subtotal:</span><span className="font-medium">{formatCurrency(subtotal)}</span></div>
                <div className="flex justify-between"><span>{taxLabel}:</span><span className="font-medium">{formatCurrency(tax)}</span></div>
                <div className="flex justify-between text-lg font-bold border-t pt-2"><span>Total:</span><span>{formatCurrency(total)}</span></div>
            </div>
        </div>
        
        <FormField control={form.control} name="notes" render={({ field }) => (
            <FormItem><FormLabel>Notes</FormLabel><FormControl><Textarea placeholder="Add any terms or additional details..." {...field} /></FormControl></FormItem>
        )} />

        <DialogFooter>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save as Draft
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
};

export default function InvoicingPage() {
  const [isFormOpen, setFormOpen] = useState(false);
  const [activeBranchId, setActiveBranchId] = useState<string>('main');
  const [defaultTaxRate, setDefaultTaxRate] = useState<TaxRate | null>(null);
  const [isLoadingTax, setIsLoadingTax] = useState(true);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isLoadingSubscription, setIsLoadingSubscription] = useState(true);
  const { format: formatCurrency } = useCurrency();

  useEffect(() => {
    const branchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
    if (branchId) setActiveBranchId(branchId);
  }, []);

  // Fetch subscription data for access control
  useEffect(() => {
    const fetchSubscription = async () => {
      setIsLoadingSubscription(true);
      try {
        const response = await authFetch.fetch('/subscription/subscriptions/current/');
        setSubscription(response);
        console.log('[Invoicing] Subscription loaded:', response.status);
      } catch (error) {
        console.error('[Invoicing] Error fetching subscription:', error);
        // Try to get from local DB
        try {
          const localSub = await db.subscriptions.get('sub_main-business');
          if (localSub) {
            setSubscription(localSub);
            console.log('[Invoicing] Using local subscription');
          }
        } catch (localError) {
          console.error('[Invoicing] Error fetching from local DB:', localError);
        }
      } finally {
        setIsLoadingSubscription(false);
      }
    };

    fetchSubscription();
  }, []);

  // Fetch default tax rate from backend
  useEffect(() => {
    const fetchDefaultTaxRate = async () => {
      setIsLoadingTax(true);
      try {
        const response = await authFetch.fetch('/business/tax-rates/');
        const taxRates = Array.isArray(response) ? response : response.results || [];
        const defaultTax = taxRates.find((t: any) => t.is_default && t.is_active);
        
        if (defaultTax) {
          setDefaultTaxRate({
            id: defaultTax.id.toString(),
            name: defaultTax.name,
            rate: parseFloat(defaultTax.rate),
            taxType: defaultTax.tax_type,
            isDefault: defaultTax.is_default,
            isActive: defaultTax.is_active,
            effectiveFrom: defaultTax.effective_from,
            effectiveTo: defaultTax.effective_to,
            createdAt: defaultTax.created_at,
            updatedAt: defaultTax.updated_at,
          });
          console.log('[Invoicing] Default tax rate loaded:', defaultTax.name, `${defaultTax.rate}%`);
        } else {
          console.log('[Invoicing] No default tax rate found');
        }
      } catch (error) {
        console.error('[Invoicing] Error fetching default tax rate:', error);
        // Fall back to local DB
        try {
          const taxes = await db.taxes.toArray();
          const localDefaultTax = taxes.find(t => t.isDefault);
          if (localDefaultTax) {
            setDefaultTaxRate(localDefaultTax);
            console.log('[Invoicing] Using local default tax rate:', localDefaultTax.name);
          }
        } catch (localError) {
          console.error('[Invoicing] Error fetching from local DB:', localError);
        }
      } finally {
        setIsLoadingTax(false);
      }
    };

    fetchDefaultTaxRate();
  }, []);

  const invoices = useLiveQuery(() => {
    return db.invoices.where('branchId').equals(activeBranchId).toArray()
  }, [activeBranchId]) || [];
  
  const customers = useLiveQuery(() => {
    return db.customers.where('branchId').equals(activeBranchId).toArray()
  }, [activeBranchId]) || [];

  const products = useLiveQuery(() => {
    return db.inventory.where('branchId').equals(activeBranchId).and(item => item.itemType === 'sellable').toArray()
  }, [activeBranchId]) || [];
  
  const statusBadge: Record<Invoice['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
    Draft: 'outline',
    Sent: 'secondary',
    Paid: 'default',
    Void: 'destructive',
  };

  const handleUpdateStatus = async (invoiceId: string, newStatus: Invoice['status']) => {
    try {
      // Update locally first (offline-first)
      await db.invoices.update(invoiceId, { status: newStatus });

      // Then sync to backend with offline-first support
      await authFetch.fetch(`/api/invoices/${invoiceId}/`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus }),
        meta: {
          domain: 'sales',
          entityType: 'invoice',
          entityId: invoiceId,
          metadata: { action: 'status_update', newStatus },
        },
      });
      
      // Show appropriate message based on status change
      if (newStatus === 'Paid') {
        toast({ 
          title: `Invoice marked as Paid`,
          description: 'Payment has been recorded. The order is now marked as paid.'
        });
      } else if (newStatus === 'Void') {
        toast({ 
          title: `Invoice voided`,
          description: 'Invoice has been voided. The related order has been deleted and stock has been restored.'
        });
      } else if (newStatus === 'Sent') {
        toast({ 
          title: `Invoice marked as Sent`,
          description: 'Invoice has been sent to customer.'
        });
      } else {
        toast({ title: `Invoice status updated to ${newStatus}` });
      }
    } catch (error) {
      console.error('[INVOICE] Error updating status:', error);
      // Don't show error if it's queued for sync
      if (error instanceof Error && error.message.includes('queued')) {
        toast({ 
          title: `Invoice status update queued`,
          description: 'Will sync when connection is restored.'
        });
      } else {
        toast({ 
          variant: 'destructive', 
          title: 'Error', 
          description: error instanceof Error ? error.message : 'Failed to update invoice'
        });
      }
    }
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    if (!confirm('Are you sure you want to delete this invoice?')) return;

    try {
      // Delete locally first (offline-first)
      await db.invoices.delete(invoiceId);

      // Then sync deletion to backend with offline-first support
      await authFetch.fetch(`/api/invoices/${invoiceId}/`, {
        method: 'DELETE',
        meta: {
          domain: 'sales',
          entityType: 'invoice',
          entityId: invoiceId,
          metadata: { action: 'delete' },
        },
      });

      toast({ title: 'Invoice deleted successfully', variant: 'destructive' });
    } catch (error) {
      console.error('[INVOICE] Error deleting invoice:', error);
      // Don't show error if it's queued for sync
      if (error instanceof Error && error.message.includes('queued')) {
        toast({ 
          title: `Invoice deletion queued`,
          description: 'Will sync when connection is restored.'
        });
      } else {
        toast({ 
          variant: 'destructive', 
          title: 'Error', 
          description: error instanceof Error ? error.message : 'Failed to delete invoice'
        });
      }
    }
  };

  const handleExportPDF = async (invoice: Invoice) => {
    try {
      await generateInvoicePDF(invoice, 'Your Business Name', 'Your Business Address');
      toast({ title: 'PDF Exported', description: `Invoice #${invoice.invoiceNumber} has been downloaded.` });
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast({ 
        variant: 'destructive', 
        title: 'Error', 
        description: 'Failed to export invoice as PDF'
      });
    }
  };

  // Check access control
  const accessCheck = canUseInvoicing(subscription);
  const isLoading = isLoadingSubscription || isLoadingTax;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invoicing</h1>
          <p className="text-muted-foreground">Create and manage invoices for your customers.</p>
        </div>
        <Dialog open={isFormOpen} onOpenChange={setFormOpen}>
          <DialogTrigger asChild>
            <Button disabled={!accessCheck.allowed || isLoading}>
              <PlusCircle className="mr-2 h-4 w-4" /> Create Invoice
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
            <DialogHeader className="sticky top-0 bg-background z-10 pt-6">
              <DialogTitle>New Invoice</DialogTitle>
              <DialogDescription>Fill in the details to create a new invoice.</DialogDescription>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto -mx-6 px-6">
                <InvoiceForm
                  onFormSubmit={() => setFormOpen(false)}
                  customers={customers}
                  products={products}
                  defaultTaxRate={defaultTaxRate}
                />
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {!accessCheck.allowed && !isLoading && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="flex-1">
                <h3 className="font-semibold text-amber-900 mb-1">Invoicing Feature Unavailable</h3>
                <p className="text-sm text-amber-800 mb-2">{accessCheck.reason}</p>
                {accessCheck.requiresUpgrade && (
                  <p className="text-sm text-amber-700">
                    Please upgrade your subscription or contact support to enable this feature.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Invoice History</CardTitle>
          <CardDescription>A list of all invoices for the active branch. Stock is deducted immediately when invoice is created.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Issue Date</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-[50px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length > 0 ? (
                invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium">#{inv.invoiceNumber}</TableCell>
                    <TableCell>{inv.customerName}</TableCell>
                    <TableCell><Badge variant={statusBadge[inv.status]}>{inv.status}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={inv.status === 'Paid' ? 'default' : 'secondary'}>
                        {inv.status === 'Paid' ? '✓ Paid' : '○ Unpaid'}
                      </Badge>
                    </TableCell>
                    <TableCell>{format(new Date(inv.issueDate), 'PP')}</TableCell>
                    <TableCell>{format(new Date(inv.dueDate), 'PP')}</TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(inv.total)}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleExportPDF(inv)}>
                            <Download className="mr-2 h-4 w-4" /> Export PDF
                          </DropdownMenuItem>
                          {inv.status !== 'Sent' && (
                            <DropdownMenuItem onClick={() => handleUpdateStatus(inv.id, 'Sent')}>
                              Mark as Sent
                            </DropdownMenuItem>
                          )}
                          {inv.status !== 'Paid' && inv.status !== 'Void' && (
                            <DropdownMenuItem onClick={() => handleUpdateStatus(inv.id, 'Paid')}>
                              Record Payment
                            </DropdownMenuItem>
                          )}
                          {inv.status !== 'Void' && (
                            <DropdownMenuItem onClick={() => handleUpdateStatus(inv.id, 'Void')} className="text-destructive">
                              Void Invoice
                            </DropdownMenuItem>
                          )}
                          {inv.status === 'Draft' && (
                            <DropdownMenuItem onClick={() => handleDeleteInvoice(inv.id)} className="text-destructive">
                              <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="h-48 text-center">
                    <div className="flex flex-col items-center justify-center space-y-4">
                        <FileSignature className="h-16 w-16 text-muted-foreground/30" />
                        <p>No invoices found. Click "Create Invoice" to get started.</p>
                     </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
