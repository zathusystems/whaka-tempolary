
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { format } from 'date-fns';
import { Check, X, ShieldCheck, Loader2, Info, ChevronDown, ChevronUp, FileText, CreditCard } from 'lucide-react';

import { db, type StockTake, type Expense, type Invoice } from '@/lib/db';
import { useAuth } from '@/hooks/use-auth';
import { useCurrency } from '@/hooks/use-currency';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { authFetch } from '@/lib/auth-fetch';
import { syncInventoryFromBackend } from '@/lib/services/inventory-sync';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

const LOCAL_STORAGE_KEYS = {
    ACTIVE_BRANCH: 'handypos-active-branch',
};

const numericValue = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const readableErrorValue = (value: unknown, path = ''): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return `${path ? `${path}: ` : ''}${String(value)}`;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => readableErrorValue(entry, path || String(index)))
      .filter(Boolean)
      .join('; ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => readableErrorValue(entry, path ? `${path}.${key}` : key))
      .filter(Boolean)
      .join('; ');
  }
  return '';
};

const approvalErrorMessage = (error: unknown): string => {
  const details = error as { message?: unknown; status?: unknown; data?: unknown };
  const message = typeof details?.message === 'string' && details.message.trim()
    ? details.message.trim()
    : 'The approval request could not be completed.';
  const structuredData = readableErrorValue(details?.data);
  const readableMessage = message === '[object Object]' && structuredData ? structuredData : message;
  const status = Number(details?.status);
  return Number.isFinite(status) && status > 0 ? `HTTP ${status}: ${readableMessage}` : readableMessage;
};

const mapServerAuditToStockTake = (audit: any): StockTake => ({
  id: String(audit.id),
  branchId: String(audit.branch ?? audit.branch_id ?? ''),
  createdAt: audit.created_at || new Date().toISOString(),
  createdBy: audit.created_by || '-',
  status: audit.status === 'Approved' ? 'Approved' : audit.status === 'Rejected' ? 'Rejected' : 'Pending Approval',
  totalDiscrepancyValue: numericValue(audit.total_discrepancy_value),
  notes: audit.notes || '',
  approvedBy: audit.approved_by || undefined,
  approvedAt: audit.approved_at || undefined,
  items: Array.isArray(audit.items) ? audit.items.map((item: any) => ({
    itemId: String(item.inventory_item ?? item.itemId ?? ''),
    itemName: item.inventory_item_name || item.itemName || 'Product',
    systemStock: numericValue(item.system_stock ?? item.systemStock),
    countedStock: numericValue(item.counted_stock ?? item.countedStock),
    discrepancy: numericValue(item.discrepancy),
  })) : [],
  _dirty: false,
  _operation: 'update',
});

const StockAuditApprovalItem = ({ audit, onProcessed }: { audit: StockTake; onProcessed: (auditId: string) => void }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { format: formatCurrency } = useCurrency();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConfirming, setIsConfirming] = useState<'approve' | 'reject' | null>(null);

  const handleApprove = async () => {
    if (!user) return;
    setIsProcessing(true);
    let serverAccepted = false;

    try {
        const serverAudit = await authFetch.fetch<any>(`/inventory/stock-audits/${encodeURIComponent(audit.id)}/submit/`, {
          method: 'POST',
        });
        serverAccepted = true;
        const approvedAudit = mapServerAuditToStockTake(serverAudit);

        await db.transaction('rw', db.inventory, db.stockTakes, async () => {
            const approvedItems = approvedAudit.items.length > 0 ? approvedAudit.items : audit.items;
            for (const item of approvedItems) {
                const countedStock = Number(item.countedStock);
                const inventoryItem = await db.inventory.get(item.itemId);
                if (inventoryItem) {
                    await db.inventory.update(item.itemId, {
                        stockUnits: countedStock,
                        value: countedStock * (inventoryItem.cost || 0),
                        status: countedStock > (inventoryItem.reorderLevel || 0)
                          ? 'In Stock'
                          : countedStock > 0 ? 'Low Stock' : 'Out of Stock',
                        // This is now the server's canonical stock value. Do
                        // not let the regular sync skip it as a dirty local
                        // change and restore the old quantity.
                        _dirty: false,
                    });
                }
            }
            await db.stockTakes.put({
              ...audit,
              ...approvedAudit,
              status: 'Approved',
              approvedBy: approvedAudit.approvedBy || user.displayName || user.email,
              approvedAt: approvedAudit.approvedAt || new Date().toISOString(),
              _dirty: false,
              _operation: 'update',
            });
        });

        // Refresh the complete inventory cache from the server after approval.
        // The approval response contains audit items, but the inventory screen
        // needs the canonical InventoryItem records (including stock_units).
        const inventorySync = await syncInventoryFromBackend(audit.branchId);
        if (inventorySync.error) {
          console.warn('[Approvals] Inventory refresh after approval failed:', inventorySync.error);
        }
        onProcessed(audit.id);

      toast({
        title: 'Audit Approved',
        description: `Stock levels have been updated based on audit ${audit.id}.`,
      });
    } catch (error) {
      console.error('Failed to approve audit:', {
        error,
        status: (error as any)?.status,
        data: (error as any)?.data,
        serverAccepted,
      });

      if (serverAccepted) {
        // The backend has already applied the stock adjustment. Do not report
        // this as a failed approval just because the local mirror could not be
        // be updated. Remove the stale pending row so it cannot be approved
        // again from this device while the database schema is being upgraded.
        try {
          await db.stockTakes.delete(audit.id);
        } catch (cleanupError) {
          console.warn('[Approvals] Could not remove stale local audit:', cleanupError);
        }
        onProcessed(audit.id);
        toast({
          title: 'Audit approved',
          description: `The server updated stock. This device removed the stale pending copy; refresh inventory to see the new quantity.`,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Approval Failed',
          description: approvalErrorMessage(error),
        });
      }
    } finally {
      setIsProcessing(false);
      setIsConfirming(null);
    }
  };

  const handleReject = async () => {
    if (!user) return;
    setIsProcessing(true);
    try {
      const serverAudit = await authFetch.fetch<any>(`/inventory/stock-audits/${encodeURIComponent(audit.id)}/reject/`, {
        method: 'POST',
      });
      await db.stockTakes.put({
        ...audit,
        ...mapServerAuditToStockTake(serverAudit),
        status: 'Rejected',
        approvedBy: serverAudit?.approved_by || user.displayName || user.email,
        approvedAt: serverAudit?.approved_at || new Date().toISOString(),
        _dirty: false,
        _operation: 'update',
      });
      onProcessed(audit.id);
      toast({ title: 'Audit Rejected', variant: 'destructive' });
    } catch (error) {
      console.error('Failed to reject audit:', error);
      toast({ variant: 'destructive', title: 'Rejection Failed' });
    } finally {
      setIsProcessing(false);
      setIsConfirming(null);
    }
  };
  
  const discrepancyColor = audit.totalDiscrepancyValue > 0 ? 'text-green-600' : 'text-red-600';
  const discrepancySign = audit.totalDiscrepancyValue > 0 ? '+' : '';

  return (
    <>
      <AccordionItem value={audit.id}>
        <AccordionTrigger>
          <div className="flex w-full items-center justify-between pr-4">
            <div className="grid text-left">
              <span className="flex items-center gap-2 font-semibold">
                Stock Audit - {format(new Date(audit.createdAt), 'PP')}
                <Badge variant="secondary">{audit.status}</Badge>
              </span>
              <span className="text-sm text-muted-foreground">
                Submitted by {audit.createdBy}
              </span>
            </div>
            <div className="hidden sm:block text-right">
                <p className="text-sm">Discrepancy</p>
                <p className={cn("font-semibold", discrepancyColor)}>{discrepancySign}{formatCurrency(audit.totalDiscrepancyValue)}</p>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">System</TableHead>
                  <TableHead className="text-right">Counted</TableHead>
                  <TableHead className="text-right">Discrepancy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audit.items.map((item) => (
                  <TableRow key={item.itemId} className={cn(item.discrepancy !== 0 && "bg-muted/50")}>
                    <TableCell>{item.itemName}</TableCell>
                    <TableCell className="text-right">{item.systemStock}</TableCell>
                    <TableCell className="text-right">{item.countedStock}</TableCell>
                    <TableCell className="text-right">
                         <Badge variant={item.discrepancy === 0 ? 'secondary' : (item.discrepancy > 0 ? 'default' : 'destructive')} className={item.discrepancy > 0 ? 'bg-green-600' : ''}>
                            {item.discrepancy > 0 ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
                            {item.discrepancy > 0 ? '+' : ''}{item.discrepancy}
                        </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex justify-end gap-2 p-4 border-t">
              <Button variant="outline" onClick={() => setIsConfirming('reject')}>Reject</Button>
              <Button onClick={() => setIsConfirming('approve')}>Approve</Button>
            </div>
          </div>
        </AccordionContent>
      </AccordionItem>
      
      {isConfirming && (
         <Dialog open={!!isConfirming} onOpenChange={() => setIsConfirming(null)}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Confirm {isConfirming === 'approve' ? 'Approval' : 'Rejection'}</DialogTitle>
                    <DialogDescription>
                        {isConfirming === 'approve' ? 
                         'Approving this audit will permanently update your inventory levels. This action cannot be undone.' :
                         'Are you sure you want to reject this audit? It will need to be resubmitted.'
                        }
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="ghost" onClick={() => setIsConfirming(null)} disabled={isProcessing}>Cancel</Button>
                    <Button 
                        variant={isConfirming === 'approve' ? 'default' : 'destructive'} 
                        onClick={isConfirming === 'approve' ? handleApprove : handleReject}
                        disabled={isProcessing}
                    >
                         {isProcessing ? <Loader2 className="mr-2 animate-spin" /> : (isConfirming === 'approve' ? <Check className="mr-2" /> : <X className="mr-2" />)}
                        Confirm {isConfirming === 'approve' ? 'Approval' : 'Rejection'}
                    </Button>
                </DialogFooter>
            </DialogContent>
         </Dialog>
      )}
    </>
  );
};


const ExpenseApprovalItem = ({ expense }: { expense: Expense }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { format: formatCurrency } = useCurrency();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleApprove = async () => {
    if (!user) return;
    setIsProcessing(true);
    try {
      await db.expenses.update(expense.id, {
        status: 'Approved',
        approvedBy: user.displayName || user.email,
        approvedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _dirty: true,
        _operation: 'update',
      });
      toast({ title: 'Expense Approved' });
    } catch (error) {
      console.error('Failed to approve expense:', error);
      toast({ variant: 'destructive', title: 'Approval Failed' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!user) return;
    setIsProcessing(true);
    try {
      await db.expenses.update(expense.id, {
        status: 'Rejected',
        approvedBy: user.displayName || user.email,
        approvedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _dirty: true,
        _operation: 'update',
      });
      toast({ title: 'Expense Rejected', variant: 'destructive' });
    } catch (error) {
      console.error('Failed to reject expense:', error);
      toast({ variant: 'destructive', title: 'Rejection Failed' });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{expense.title}</div>
        <div className="text-sm text-muted-foreground">{expense.category}</div>
      </TableCell>
      <TableCell>{format(new Date(expense.date), 'PP')}</TableCell>
      <TableCell className="text-right font-semibold">{formatCurrency(expense.amount)}</TableCell>
      <TableCell>{expense.createdBy}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleReject} disabled={isProcessing}>
            {isProcessing ? <Loader2 className="animate-spin" /> : <X className="h-4 w-4" />}
          </Button>
          <Button size="sm" onClick={handleApprove} disabled={isProcessing}>
            {isProcessing ? <Loader2 className="animate-spin" /> : <Check className="h-4 w-4" />}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};


const InvoiceApprovalItem = ({ invoice }: { invoice: Invoice }) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { format: formatCurrency } = useCurrency();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleApprove = async () => {
    if (!user) return;
    setIsProcessing(true);
    try {
      await db.invoices.update(invoice.id, {
        status: 'Sent',
      });
      toast({ title: 'Invoice Sent' });
    } catch (error) {
      console.error('Failed to send invoice:', error);
      toast({ variant: 'destructive', title: 'Action Failed' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!user) return;
    setIsProcessing(true);
    try {
      await db.invoices.update(invoice.id, {
        status: 'Void',
      });
      toast({ title: 'Invoice Voided', variant: 'destructive' });
    } catch (error) {
      console.error('Failed to void invoice:', error);
      toast({ variant: 'destructive', title: 'Action Failed' });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">Invoice #{invoice.invoiceNumber}</div>
        <div className="text-sm text-muted-foreground">{invoice.customerName}</div>
      </TableCell>
      <TableCell>{format(new Date(invoice.issueDate), 'PP')}</TableCell>
      <TableCell className="text-right font-semibold">{formatCurrency(invoice.total)}</TableCell>
      <TableCell>{format(new Date(invoice.dueDate), 'PP')}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={handleReject} disabled={isProcessing}>
            {isProcessing ? <Loader2 className="animate-spin" /> : <X className="h-4 w-4" />}
          </Button>
          <Button size="sm" onClick={handleApprove} disabled={isProcessing}>
            {isProcessing ? <Loader2 className="animate-spin" /> : <Check className="h-4 w-4" />}
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};


function ApprovalsPageContent() {
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [serverPendingAudits, setServerPendingAudits] = useState<StockTake[]>([]);
  const [isLoadingServerAudits, setIsLoadingServerAudits] = useState(false);
  
  useEffect(() => {
    const branchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
    if (branchId) setActiveBranchId(branchId);
  }, []);

  useEffect(() => {
    if (!activeBranchId) return;
    let cancelled = false;
    setIsLoadingServerAudits(true);
    authFetch.fetch<any>(`/inventory/stock-audits/pending/?branch_id=${encodeURIComponent(activeBranchId)}`)
      .then((response) => {
        if (cancelled) return;
        const audits = Array.isArray(response) ? response : response?.results || [];
        setServerPendingAudits(audits.map(mapServerAuditToStockTake));
      })
      .catch((error) => {
        if (!cancelled) console.warn('[Approvals] Could not load pending stock audits:', error);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingServerAudits(false);
      });
    return () => { cancelled = true; };
  }, [activeBranchId]);

  const localPendingAudits = useLiveQuery(
    () => {
      if (!activeBranchId) return [];
      return db.stockTakes
        .where({ branchId: activeBranchId, status: 'Pending Approval' })
        .sortBy('createdAt')
    },
    [activeBranchId]
  ) || [];

  const pendingAudits = useMemo(() => {
    const byId = new Map<string, StockTake>();
    [...serverPendingAudits, ...localPendingAudits].forEach((audit) => byId.set(audit.id, audit));
    return Array.from(byId.values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [localPendingAudits, serverPendingAudits]);

  const removeProcessedAudit = (auditId: string) => {
    setServerPendingAudits((current) => current.filter((audit) => audit.id !== auditId));
  };

  const pendingExpenses = useLiveQuery(
    () => {
      if (!activeBranchId) return [];
      return db.expenses
        .where({ branchId: activeBranchId, status: 'Pending' })
        .sortBy('date')
    },
    [activeBranchId]
  ) || [];

  const pendingInvoices = useLiveQuery(
    () => {
      if (!activeBranchId) return [];
      return db.invoices
        .where({ branchId: activeBranchId, status: 'Draft' })
        .sortBy('issueDate')
    },
    [activeBranchId]
  ) || [];
  
  if (!activeBranchId) {
    return (
        <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Approval Requests</h1>
        <p className="text-muted-foreground">
          Review and approve or reject submissions from your team.
        </p>
      </div>

      <Tabs defaultValue="stock-audits">
        <TabsList>
            <TabsTrigger value="stock-audits">
                Stock Audits
                {pendingAudits.length > 0 && <Badge className="ml-2">{pendingAudits.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="expenses">
                Expenses
                {pendingExpenses.length > 0 && <Badge className="ml-2">{pendingExpenses.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="invoices">
                Invoices
                {pendingInvoices.length > 0 && <Badge className="ml-2">{pendingInvoices.length}</Badge>}
            </TabsTrigger>
        </TabsList>
        <TabsContent value="stock-audits">
            <Card>
                <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <FileText />
                    Pending Stock Audits
                </CardTitle>
                <CardDescription>
                    These stock audits are marked <span className="font-medium">Pending Approval</span> and are waiting for your approval before inventory levels are updated. Approved and rejected audits remain available in Stock Audit History.
                </CardDescription>
                </CardHeader>
                <CardContent>
                {isLoadingServerAudits && pendingAudits.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading pending audits…</div>
                ) : pendingAudits.length > 0 ? (
                    <Accordion type="multiple" className="w-full">
                    {pendingAudits.map((audit) => (
                        <StockAuditApprovalItem key={audit.id} audit={audit} onProcessed={removeProcessedAudit} />
                    ))}
                    </Accordion>
                ) : (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-center">
                    <ShieldCheck className="h-12 w-12 text-muted-foreground" />
                    <h2 className="text-xl font-semibold">All Clear!</h2>
                    <p className="text-muted-foreground">
                        There are no pending stock audits that require your approval.
                    </p>
                    </div>
                )}
                </CardContent>
            </Card>
        </TabsContent>
         <TabsContent value="expenses">
            <Card>
                <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <CreditCard />
                    Pending Expenses
                </CardTitle>
                <CardDescription>
                    Approve or reject these expenses submitted by your team. Approved expenses will be reflected in financial reports.
                </CardDescription>
                </CardHeader>
                <CardContent>
                {pendingExpenses.length > 0 ? (
                   <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Expense</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Submitted By</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                        {pendingExpenses.map(expense => (
                            <ExpenseApprovalItem key={expense.id} expense={expense} />
                        ))}
                    </TableBody>
                   </Table>
                ) : (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-center">
                    <ShieldCheck className="h-12 w-12 text-muted-foreground" />
                    <h2 className="text-xl font-semibold">All Clear!</h2>
                    <p className="text-muted-foreground">
                        There are no pending expenses that require your approval.
                    </p>
                    </div>
                )}
                </CardContent>
            </Card>
        </TabsContent>
        <TabsContent value="invoices">
            <Card>
                <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <FileText />
                    Draft Invoices
                </CardTitle>
                <CardDescription>
                    Send or void these draft invoices. Sent invoices will be marked as sent and can be tracked for payment.
                </CardDescription>
                </CardHeader>
                <CardContent>
                {pendingInvoices.length > 0 ? (
                   <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Issue Date</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead>Due Date</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                        {pendingInvoices.map(invoice => (
                            <InvoiceApprovalItem key={invoice.id} invoice={invoice} />
                        ))}
                    </TableBody>
                   </Table>
                ) : (
                    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-center">
                    <ShieldCheck className="h-12 w-12 text-muted-foreground" />
                    <h2 className="text-xl font-semibold">All Clear!</h2>
                    <p className="text-muted-foreground">
                        There are no draft invoices that require your attention.
                    </p>
                    </div>
                )}
                </CardContent>
            </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ApprovalsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading && user?.role !== 'Admin') {
      router.replace('/dashboard');
    }
  }, [loading, router, user?.role]);

  if (loading || !user || user.role !== 'Admin') {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <ApprovalsPageContent />;
}
