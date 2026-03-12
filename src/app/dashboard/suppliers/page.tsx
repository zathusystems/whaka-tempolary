

'use client';

import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useForm } from 'react-hook-form';
import { MoreHorizontal, PlusCircle, Edit, Trash2, Package, History, DollarSign, Loader2 } from 'lucide-react';

import { db, type Supplier, type InventoryItem } from '@/lib/db';
import { useCurrency } from '@/hooks/use-currency';
import { useAuth } from '@/hooks/use-auth';
import { createSupplier, updateSupplier, deleteSupplier } from '@/lib/services/supplier-service';
import { syncService } from '@/lib/services/sync-service';
import { logAuditAction } from '@/lib/audit';
import { authFetch } from '@/lib/auth-fetch';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';


const resolveStoredBusinessId = (): string => {
    if (typeof window === 'undefined') return '';

    const storageKeys = ['handy-pos-business', 'handypos-business'];
    for (const key of storageKeys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
            const parsed = JSON.parse(raw);
            if (parsed?.id) {
                return String(parsed.id);
            }
        } catch (error) {
            console.warn(`[SuppliersPage] Failed to parse ${key}:`, error);
        }
    }

    const fallbackBusinessId = localStorage.getItem('handypos-business-id');
    return fallbackBusinessId ? String(fallbackBusinessId) : '';
};

const normalizeBranchId = (value?: string | number | null): string => {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '';

    const brnMatch = /^BRN-(\d+)$/i.exec(normalized);
    if (brnMatch) return brnMatch[1];

    const legacyMatch = /^branch-(\d+)$/i.exec(normalized);
    if (legacyMatch) return legacyMatch[1];

    return normalized;
};

const parseDateCandidate = (...values: unknown[]): Date | null => {
    for (const value of values) {
        if (value instanceof Date) {
            if (!Number.isNaN(value.getTime())) return value;
            continue;
        }

        if (typeof value === 'number' && Number.isFinite(value)) {
            const ms = value < 1_000_000_000_000 ? value * 1000 : value;
            const parsed = new Date(ms);
            if (!Number.isNaN(parsed.getTime())) return parsed;
            continue;
        }

        if (typeof value !== 'string') continue;

        const trimmed = value.trim();
        if (!trimmed) continue;
        if (trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'undefined') continue;

        if (/^\d+$/.test(trimmed)) {
            const numericValue = Number(trimmed);
            if (Number.isFinite(numericValue)) {
                const ms = numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
                const parsed = new Date(ms);
                if (!Number.isNaN(parsed.getTime())) return parsed;
            }
        }

        const parsed = new Date(trimmed);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    return null;
};

const formatDisplayDate = (...values: unknown[]): string => {
    const parsed = parseDateCandidate(...values);
    return parsed ? parsed.toLocaleDateString() : '-';
};

const dateSortValue = (...values: unknown[]): number => {
    const parsed = parseDateCandidate(...values);
    return parsed ? parsed.getTime() : 0;
};


const SupplierForm = ({
    onFormSubmit,
    defaultValues,
    activeBranchId,
    activeBusinessId,
}: {
    onFormSubmit: () => void,
    defaultValues?: Supplier,
    activeBranchId: string,
    activeBusinessId?: string
}) => {
    const { user, business } = useAuth();
    const { register, handleSubmit, reset, formState: { errors } } = useForm({ defaultValues });

    const onSubmit = async (data: { name: string; email?: string; phone?: string; address?: string; city?: string; supplierTin?: string; vatRegistered?: boolean; }) => {
        if (!user) {
            toast({ variant: 'destructive', title: 'User not found' });
            return;
        }

        try {
            const businessId = String(
                activeBusinessId ||
                user.businessId ||
                business?.id ||
                resolveStoredBusinessId() ||
                ''
            ).trim();

            if (!businessId) {
                toast({
                    variant: 'destructive',
                    title: 'Business context missing',
                    description: 'Please refresh and try again.',
                });
                return;
            }

            if (defaultValues) {
                await updateSupplier(
                    defaultValues.id,
                    data,
                    user.uid,
                    user.displayName || user.email || 'Unknown',
                    activeBranchId
                );
                toast({ title: 'Supplier Updated' });
            } else {
                await createSupplier(
                    { 
                        name: data.name, 
                        email: data.email, 
                        phone: data.phone, 
                        address: data.address, 
                        city: data.city,
                        // MRA EIS Compliance Fields
                        supplierTin: data.supplierTin,
                        vatRegistered: data.vatRegistered
                    },
                    user.uid,
                    user.displayName || user.email || 'Unknown',
                    activeBranchId,
                    businessId
                );
                toast({ title: 'Supplier Added' });
            }
            reset();
            onFormSubmit();
        } catch (error) {
            console.error('Failed to save supplier:', error);
            toast({ variant: 'destructive', title: 'Error saving supplier' });
        }
    };

    return (
        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4 py-4">
            <div>
                <Label htmlFor="name">Supplier Name</Label>
                <Input id="name" {...register("name", { required: "Supplier name is required" })} />
                {errors.name && <p className="text-destructive text-sm mt-1">{errors.name.message as string}</p>}
            </div>
            <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" {...register("email")} />
            </div>
            <div>
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" {...register("phone")} />
            </div>
            <div>
                <Label htmlFor="address">Address</Label>
                <Input id="address" {...register("address")} />
            </div>
            <div>
                <Label htmlFor="city">City</Label>
                <Input id="city" {...register("city")} />
            </div>
            
            {/* MRA EIS Compliance Fields */}
            <div className="border-t pt-4 mt-4">
                <h3 className="font-semibold text-sm mb-3">MRA EIS Compliance</h3>
                <div>
                    <Label htmlFor="supplierTin">Supplier TIN (Tax ID)</Label>
                    <Input 
                        id="supplierTin" 
                        placeholder="e.g., 1234567890"
                        {...register("supplierTin")} 
                    />
                    <p className="text-xs text-muted-foreground mt-1">Supplier's Tax Identification Number for VAT reclaim</p>
                </div>
                <div className="mt-3 flex items-center gap-2">
                    <input 
                        type="checkbox" 
                        id="vatRegistered"
                        {...register("vatRegistered")}
                        className="h-4 w-4 rounded border-gray-300"
                    />
                    <Label htmlFor="vatRegistered" className="font-normal cursor-pointer">
                        Supplier is VAT Registered
                    </Label>
                </div>
            </div>
            
            <DialogFooter>
                <Button type="submit">{defaultValues ? 'Save Changes' : 'Add Supplier'}</Button>
            </DialogFooter>
        </form>
    );
};


const SupplierListRow = ({ supplier, onView, onEdit, onDelete, activeBranchId }: { supplier: Supplier, onView: () => void, onEdit: () => void, onDelete: () => void, activeBranchId: string }) => {
    const { format: formatCurrency } = useCurrency();
    
    // Get purchase history for this supplier
    const purchaseHistory = useLiveQuery(
        async () => {
            const normalizedActiveBranchId = normalizeBranchId(activeBranchId);
            const allRecords = await db.purchaseHistory.where('supplierId').equals(supplier.id).toArray();
            return allRecords.filter(
                (record) => normalizeBranchId(record.branchId) === normalizedActiveBranchId
            );
        },
        [supplier.id, activeBranchId]
    );
    
    // ✅ Calculate balance due from unpaid orders (paymentStatus === 'Unpaid')
    const balanceDue = purchaseHistory?.filter(p => p.paymentStatus === 'Unpaid').reduce((acc, p) => acc + p.amountDue, 0) || 0;
    const totalPurchases = purchaseHistory?.reduce((acc, p) => acc + p.totalCost, 0) || 0;
    
    return (
        <TableRow>
            <TableCell>
                <button onClick={onView} className="font-medium text-primary hover:underline">
                    {supplier.name}
                </button>
            </TableCell>
            <TableCell>
                <div className="text-sm">
                    {supplier.phone && <p>{supplier.phone}</p>}
                    {supplier.email && <p className="text-muted-foreground text-xs">{supplier.email}</p>}
                </div>
            </TableCell>
            <TableCell>{supplier.city || '-'}</TableCell>
            <TableCell className="text-right">
                <Badge variant={balanceDue > 0 ? 'destructive' : 'secondary'}>
                    {formatCurrency(balanceDue)}
                </Badge>
            </TableCell>
            <TableCell className="text-right font-semibold">{formatCurrency(totalPurchases)}</TableCell>
            <TableCell className="text-right">
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={onView}>
                            <History className="mr-2 h-4 w-4" /> View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={onEdit}>
                            <Edit className="mr-2 h-4 w-4" /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </TableCell>
        </TableRow>
    );
};


const SupplierDetailDialog = ({ supplier, isOpen, onOpenChange, activeBranchId }: { supplier: Supplier, isOpen: boolean, onOpenChange: (open: boolean) => void, activeBranchId: string }) => {
    const [isPaying, setIsPaying] = useState(false);
    const [isSyncingDetails, setIsSyncingDetails] = useState(false);
    const { user } = useAuth();
    const { format: formatCurrency } = useCurrency();
    
    // Note: Purchase history is stored locally in purchaseHistory table
    // Backend doesn't have a dedicated purchase-history endpoint
    // Data is synced via the main sync service
    
    const purchaseHistory = useLiveQuery(
        async () => {
            const normalizedActiveBranchId = normalizeBranchId(activeBranchId);
            const allRecords = await db.purchaseHistory.where('supplierId').equals(supplier.id).toArray();
            return allRecords
                .filter((record) => normalizeBranchId(record.branchId) === normalizedActiveBranchId)
                .sort(
                    (a, b) =>
                        dateSortValue(
                            b.receivedDate,
                            (b as any).createdAt,
                            (b as any).updatedAt
                        ) -
                        dateSortValue(
                            a.receivedDate,
                            (a as any).createdAt,
                            (a as any).updatedAt
                        )
                );
        },
        [supplier.id, activeBranchId]
    );

    const associatedProducts = useLiveQuery(
        async () => {
            const normalizedActiveBranchId = normalizeBranchId(activeBranchId);
            const allProducts = await db.inventory.where('supplier').equals(supplier.name).toArray();
            return allProducts.filter(
                (product) => normalizeBranchId(product.branchId) === normalizedActiveBranchId
            );
        },
        [supplier.name, activeBranchId]
    );
    
    const amountOwed = purchaseHistory?.filter(p => p.paymentStatus === 'Unpaid').reduce((acc, p) => acc + p.amountDue, 0) || 0;

    const handleRecordPayment = async () => {
        setIsPaying(true);
        try {
            const unpaidPurchases = purchaseHistory?.filter(p => p.paymentStatus === 'Unpaid') || [];
            if (unpaidPurchases.length) {
                // Update purchase history records
                await db.purchaseHistory.bulkUpdate(unpaidPurchases.map(record => ({
                    key: record.id!,
                    changes: { 
                        paymentStatus: 'Paid', 
                        amountDue: 0,
                        _dirty: true,
                        _operation: 'update' as const
                    }
                })));

                // Log audit action
                if (user) {
                    await logAuditAction({
                        userId: user.uid,
                        userName: user.displayName || user.email || 'Unknown',
                        branchId: localStorage.getItem('handypos-active-branch') || 'default',
                        actionType: 'STOCK_RECEIVE',
                        entityType: 'Purchase',
                        entityId: supplier.id,
                        details: { 
                            supplierId: supplier.id,
                            supplierName: supplier.name,
                            recordsUpdated: unpaidPurchases.length,
                            totalAmountPaid: amountOwed
                        },
                    });
                }

                // Trigger sync
                const branchId = localStorage.getItem('handypos-active-branch') || 'default';
                syncService.performFullSync(branchId).catch(err => 
                    console.error('[Supplier Detail] Sync failed:', err)
                );
            }
            toast({ title: 'Payment Recorded', description: `Cleared outstanding balance for ${supplier.name}.`});
        } catch(e) {
            console.error(e);
            toast({ variant: 'destructive', title: 'Failed to record payment' });
        } finally {
            setIsPaying(false);
        }
    };


    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-4xl">
                <DialogHeader>
                    <DialogTitle>{supplier.name}</DialogTitle>
                    <DialogDescription>
                        Supplier ID: {supplier.id}
                    </DialogDescription>
                </DialogHeader>
                <Tabs defaultValue="account">
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="account">Account / Debts</TabsTrigger>
                        <TabsTrigger value="history">Purchase History</TabsTrigger>
                        <TabsTrigger value="products">Products</TabsTrigger>
                        <TabsTrigger value="details">Details</TabsTrigger>
                    </TabsList>
                     <TabsContent value="account">
                        <Card>
                            <CardHeader>
                                <CardTitle>Account Balance</CardTitle>
                                <CardDescription>Manage outstanding payments to {supplier.name}.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex flex-col items-center justify-center space-y-4 rounded-lg bg-muted/50 p-8">
                                    <p className="text-sm font-medium text-muted-foreground">Total Amount Owed</p>
                                    <p className="text-4xl font-bold tracking-tight">{formatCurrency(amountOwed)}</p>
                                    <Button onClick={handleRecordPayment} disabled={amountOwed === 0 || isPaying}>
                                        {isPaying ? <Loader2 className="mr-2 animate-spin" /> : <DollarSign className="mr-2" />}
                                        Record Full Payment
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                     <TabsContent value="history">
                        <Card>
                            <CardHeader>
                                <CardTitle>Purchase History</CardTitle>
                                <CardDescription>Complete purchase record from {supplier.name}.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="overflow-x-auto max-h-[400px]">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Date</TableHead>
                                                <TableHead>Product</TableHead>
                                                <TableHead>Payment</TableHead>
                                                <TableHead className="text-right">Total Cost</TableHead>
                                                <TableHead className="text-right">Amount Due</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {purchaseHistory?.map((record) => (
                                                <TableRow key={record.id}>
                                                    <TableCell>
                                                        {formatDisplayDate(
                                                            record.receivedDate,
                                                            (record as any).createdAt,
                                                            (record as any).updatedAt
                                                        )}
                                                    </TableCell>
                                                    <TableCell className="font-medium">{record.productName}</TableCell>
                                                    <TableCell><Badge variant={record.paymentStatus === 'Paid' ? 'secondary' : 'destructive'}>{record.paymentStatus}</Badge></TableCell>
                                                    <TableCell className="text-right">{formatCurrency(record.totalCost)}</TableCell>
                                                    <TableCell className="text-right font-semibold">{formatCurrency(record.amountDue)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                    <TabsContent value="products">
                        <Card>
                            <CardHeader>
                                <CardTitle>Associated Products</CardTitle>
                                <CardDescription>Products sourced from {supplier.name}.</CardDescription>
                            </CardHeader>
                             <CardContent>
                                <div className="overflow-x-auto max-h-[400px]">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Product</TableHead>
                                                <TableHead>Manufacturer</TableHead>
                                                <TableHead>Category</TableHead>
                                                <TableHead className="text-right">Current Stock</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {associatedProducts?.map((product) => (
                                                <TableRow key={product.id}>
                                                    <TableCell className="font-medium">{product.name}</TableCell>
                                                    <TableCell>{product.manufacturer}</TableCell>
                                                    <TableCell>{product.category}</TableCell>
                                                    <TableCell className="text-right">{product.stockUnits} {product.unitType}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                    <TabsContent value="details">
                         <Card>
                            <CardHeader><CardTitle>Supplier Information</CardTitle></CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Supplier Name</p>
                                        <p className="text-lg font-semibold mt-1">{supplier.name}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Email</p>
                                        <p className="text-lg mt-1">{supplier.email || 'Not provided'}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Phone</p>
                                        <p className="text-lg mt-1">{supplier.phone || 'Not provided'}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">City</p>
                                        <p className="text-lg mt-1">{supplier.city || 'Not provided'}</p>
                                    </div>
                                    <div className="md:col-span-2">
                                        <p className="text-sm font-medium text-muted-foreground">Address</p>
                                        <p className="text-lg mt-1">{supplier.address || 'Not provided'}</p>
                                    </div>
                                    
                                    {/* MRA EIS Compliance Fields */}
                                    <div className="md:col-span-2 border-t pt-6 mt-6">
                                        <h3 className="font-semibold text-sm mb-4">MRA EIS Compliance Information</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            <div>
                                                <p className="text-sm font-medium text-muted-foreground">Supplier TIN</p>
                                                <p className="text-lg mt-1 font-mono">
                                                    {supplier.supplierTin ? (
                                                        <Badge variant="outline">{supplier.supplierTin}</Badge>
                                                    ) : (
                                                        <span className="text-muted-foreground">Not provided</span>
                                                    )}
                                                </p>
                                            </div>
                                            <div>
                                                <p className="text-sm font-medium text-muted-foreground">VAT Registration Status</p>
                                                <p className="text-lg mt-1">
                                                    {supplier.vatRegistered ? (
                                                        <Badge variant="secondary">VAT Registered</Badge>
                                                    ) : (
                                                        <Badge variant="outline">Not VAT Registered</Badge>
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};


export default function SuppliersPage() {
  const { user, business } = useAuth();
  const [isAddFormOpen, setAddFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | undefined>(undefined);
  const [viewingSupplier, setViewingSupplier] = useState<Supplier | undefined>(undefined);
  const [activeBranchId, setActiveBranchId] = useState<string>('default');
  const [businessId, setBusinessId] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState(false);

  // Get active branch ID and business ID from auth context
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      const branchId = localStorage.getItem('handypos-active-branch') || 'default';
      setActiveBranchId(branchId);
      
      const resolvedBusinessId =
        String(user?.businessId || business?.id || resolveStoredBusinessId() || '').trim();

      if (resolvedBusinessId) {
        console.log('[SuppliersPage] Mount - resolved businessId:', resolvedBusinessId);
        setBusinessId(resolvedBusinessId);
        console.log('[SuppliersPage] Initialized with business:', resolvedBusinessId, 'branch:', branchId);
      } else {
        console.warn('[SuppliersPage] No businessId found in auth context/storage');
      }
    }
  }, [user, business]);

  // Fetch suppliers from backend and sync with local database
  React.useEffect(() => {
    const syncSuppliersFromBackend = async () => {
      if (!businessId) {
        console.log('[SuppliersPage] No business ID, skipping backend sync');
        return;
      }

      setIsSyncing(true);
      try {
        // Repair legacy local records that were created without business context.
        const orphanSuppliers = await db.suppliers
          .toArray()
          .then(items => items.filter(s => !s.businessId || String(s.businessId).trim() === ''));
        if (orphanSuppliers.length > 0) {
          console.log('[SuppliersPage] Repairing orphan suppliers with missing businessId:', orphanSuppliers.length);
          for (const supplier of orphanSuppliers) {
            await db.suppliers.update(supplier.id, { businessId });
          }
        }

        const url = `/inventory/suppliers/?business_id=${businessId}`;
        console.log('[SuppliersPage] ===== STARTING SUPPLIER FETCH =====');
        console.log('[SuppliersPage] Business ID:', businessId);
        console.log('[SuppliersPage] Full URL:', url);
        console.log('[SuppliersPage] Timestamp:', new Date().toISOString());
        
        // Fetch suppliers directly from backend API with business_id parameter
        console.log('[SuppliersPage] About to call authFetch.fetch()...');
        const backendSuppliers = await authFetch.fetch<any>(url);
        console.log('[SuppliersPage] ===== FETCH COMPLETED =====');
        console.log('[SuppliersPage] Backend suppliers response:', backendSuppliers);
        console.log('[SuppliersPage] Response type:', typeof backendSuppliers);
        console.log('[SuppliersPage] Response keys:', backendSuppliers ? Object.keys(backendSuppliers) : 'null/undefined');
        
        // Check if response is null or undefined
        if (!backendSuppliers) {
          console.warn('[SuppliersPage] Backend returned null/undefined response');
          setIsSyncing(false);
          return;
        }
        
        // Handle different response formats
        let suppliersData: any[] = [];
        if (Array.isArray(backendSuppliers)) {
          suppliersData = backendSuppliers;
        } else if (backendSuppliers?.results && Array.isArray(backendSuppliers.results)) {
          suppliersData = backendSuppliers.results;
        } else if (backendSuppliers) {
          console.warn('[SuppliersPage] Unexpected backend response format:', backendSuppliers);
          suppliersData = [];
        }

        console.log('[SuppliersPage] Processing', suppliersData.length, 'suppliers from backend');

        // Get current local suppliers for this business
        const localSuppliers = await db.suppliers
          .toArray()
          .then(items => items.filter(s => String(s.businessId || '').trim() === businessId));
        const localSupplierIds = new Set(localSuppliers.map(s => s.id));
        const backendSupplierIds = new Set(suppliersData.map(s => s.id));

        // Update or create suppliers from backend
        for (const backendSupplier of suppliersData) {
          const mappedSupplier: Supplier = {
            id: backendSupplier.id,
            businessId: businessId,
            name: backendSupplier.name,
            email: backendSupplier.email || '',
            phone: backendSupplier.phone || '',
            address: backendSupplier.address || '',
            city: backendSupplier.city || '',
            // MRA EIS Compliance Fields
            supplierTin: backendSupplier.supplier_tin || '',
            vatRegistered: backendSupplier.vat_registered || false,
          };

          try {
            // Use put to insert or update (upsert)
            await db.suppliers.put(mappedSupplier);
            console.log('[SuppliersPage] Upserted supplier:', backendSupplier.id);
          } catch (error) {
            console.error('[SuppliersPage] Error upserting supplier:', backendSupplier.id, error);
          }
        }

        // Delete suppliers that no longer exist on backend
        for (const localSupplierId of localSupplierIds) {
          if (!backendSupplierIds.has(localSupplierId)) {
            const localSupplier = localSuppliers.find(s => s.id === localSupplierId);
            // Keep unsynced local records to avoid dropping newly created suppliers.
            if (localSupplier?._dirty) {
              console.log('[SuppliersPage] Keeping dirty local supplier not yet on backend:', localSupplierId);
              continue;
            }
            await db.suppliers.delete(localSupplierId);
            console.log('[SuppliersPage] Deleted supplier:', localSupplierId);
          }
        }

        console.log('[SuppliersPage] Suppliers sync completed successfully');
      } catch (error) {
        console.error('[SuppliersPage] Error syncing suppliers from backend:', error);
        // Silently fail - will use local data
      } finally {
        setIsSyncing(false);
      }
    };

    syncSuppliersFromBackend();
  }, [businessId]);

  // Listen for branch changes from header (custom event)
  React.useEffect(() => {
    const handleBranchChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      const branchId = customEvent.detail?.branchId;
      if (branchId) {
        console.log('[SuppliersPage] Branch changed to:', branchId);
        setActiveBranchId(branchId);
      }
    };

    window.addEventListener('branchChanged', handleBranchChange);
    return () => window.removeEventListener('branchChanged', handleBranchChange);
  }, []);

  // Query suppliers filtered by current business
  const suppliers = useLiveQuery(() => {
    if (!businessId) {
      console.log('[SuppliersPage] No business ID, returning empty suppliers');
      return Promise.resolve([]);
    }
    console.log('[SuppliersPage] Querying suppliers for business:', businessId);
    return db.suppliers.toArray().then(all => {
      const data = all.filter(s => String(s.businessId || '').trim() === businessId);
      console.log('[SuppliersPage] Query result:', data.length, 'suppliers for business', businessId);
      return data;
    });
  }, [businessId]);

  const handleEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setAddFormOpen(true);
  };
  
  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this supplier? This action cannot be undone.')) {
        if (user) {
          await deleteSupplier(
            id,
            user.uid,
            user.displayName || user.email || 'Unknown',
            activeBranchId
          );
        }
    }
  };

  const handleAddFormOpenChange = (open: boolean) => {
    setAddFormOpen(open);
    if (!open) {
        setEditingSupplier(undefined);
    }
  }
  
  const handleDetailViewOpenChange = (open: boolean) => {
      if (!open) {
          setViewingSupplier(undefined);
      }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-muted-foreground">
            Manage your product suppliers and their information.
          </p>
        </div>
        <Dialog open={isAddFormOpen} onOpenChange={handleAddFormOpenChange}>
            <DialogTrigger asChild>
                <Button>
                    <PlusCircle className="mr-2 h-4 w-4" /> Add Supplier
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px] max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>{editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}</DialogTitle>
                    <DialogDescription>
                        {editingSupplier ? 'Update the details for this supplier.' : 'Add a new supplier to your list.'}
                    </DialogDescription>
                </DialogHeader>
                <div className="overflow-y-auto flex-1 pr-4">
                    <SupplierForm 
                        onFormSubmit={() => handleAddFormOpenChange(false)} 
                        defaultValues={editingSupplier}
                        activeBranchId={activeBranchId}
                        activeBusinessId={businessId}
                    />
                </div>
            </DialogContent>
        </Dialog>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Supplier List</CardTitle>
          <CardDescription>A list of all suppliers in your system. Click a name to see details.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>City</TableHead>
                <TableHead className="text-right">Balance Due</TableHead>
                <TableHead className="text-right">Total Purchases</TableHead>
                <TableHead className="w-[50px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers?.map((supplier) => (
                <SupplierListRow 
                  key={supplier.id} 
                  supplier={supplier}
                  onView={() => setViewingSupplier(supplier)}
                  onEdit={() => handleEdit(supplier)}
                  onDelete={() => handleDelete(supplier.id)}
                  activeBranchId={activeBranchId}
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

        {viewingSupplier && (
            <SupplierDetailDialog 
                supplier={viewingSupplier} 
                isOpen={!!viewingSupplier}
                onOpenChange={handleDetailViewOpenChange}
                activeBranchId={activeBranchId}
            />
        )}
    </div>
  );
}
