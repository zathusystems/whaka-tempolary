'use client';

import React from 'react';
import { useForm, FormProvider, useFieldArray, useWatch } from 'react-hook-form';
import { format } from 'date-fns';
import { Plus, X, Calendar as CalendarIcon, Loader2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import { db, type InventoryItem, type PurchaseRecord, type Supplier } from '@/lib/db';
import { type BusinessType } from '@/lib/inventory/config';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { logAuditAction } from '@/lib/audit';
import { syncService } from '@/lib/services/sync-service';
import { authFetch } from '@/lib/auth-fetch';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';

type ReceiveStockFormValues = {
  supplierId?: string;
  items: {
    productId: string;
    quantity: number;
    cost: number;
    batchNumber?: string;
    expiryDate?: Date;
  }[];
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

const toBackendBranchId = (branchId: string): string => {
    const normalized = normalizeBranchId(branchId);
    return normalized || branchId;
};

type SessionChoice = {
    id: string;
    label: string;
    sortValue: number;
    hasPump: boolean;
    pumpName?: string;
};

const parseSessionDate = (value: unknown): Date | null => {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
        const ms = value < 1_000_000_000_000 ? value * 1000 : value;
        const parsed = new Date(ms);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        if (/^\d+$/.test(trimmed)) {
            const numericValue = Number(trimmed);
            const ms = numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
            const parsed = new Date(ms);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
        }
        const parsed = new Date(trimmed);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    return null;
};

const getSessionPumpName = (session: any): string => {
    const raw = session?.pump_name ?? session?.pumpName ?? session?.pump ?? '';
    return String(raw ?? '').trim();
};

const getSessionHasPump = (session: any): boolean => {
    return Boolean(getSessionPumpName(session));
};

const buildSessionChoice = (session: any): SessionChoice | null => {
    if (!session) return null;
    const id = String(session?.id ?? '').trim();
    if (!id) return null;

    const userLabel = String(
        session?.user_name ??
        session?.userName ??
        session?.user_email ??
        session?.userEmail ??
        session?.user ??
        ''
    ).trim();
    const displayUser = userLabel || 'Unknown User';

    const startedAtRaw =
        session?.started_at ??
        session?.startedAt ??
        session?.created_at ??
        session?.createdAt ??
        session?.opened_at ??
        session?.openedAt;
    const startedAtDate = parseSessionDate(startedAtRaw);
    const startedAtLabel = startedAtDate ? format(startedAtDate, 'PPpp') : '';
    const pumpName = getSessionPumpName(session);
    const hasPump = Boolean(pumpName);
    const pumpLabel = hasPump ? ` • Pump: ${pumpName}` : ' • No Pump';

    const label = startedAtLabel
        ? `${displayUser} • ${startedAtLabel}${pumpLabel}`
        : `${displayUser}${pumpLabel}`;
    const sortValue = startedAtDate ? startedAtDate.getTime() : 0;

    return { id, label, sortValue, hasPump, pumpName: pumpName || undefined };
};

const getSessionChoicesFromResponse = (response: any): SessionChoice[] => {
    const rawSessions = Array.isArray(response?.results)
        ? response.results
        : Array.isArray(response)
        ? response
        : [];

    const uniqueChoices = new Map<string, SessionChoice>();
    for (const session of rawSessions) {
        const choice = buildSessionChoice(session);
        if (choice) {
            uniqueChoices.set(choice.id, choice);
        }
    }

    return Array.from(uniqueChoices.values()).sort((a, b) => b.sortValue - a.sortValue);
};

export const ReceiveStockForm = ({ branchId, businessType, inventoryItems, suppliers, onFormSubmit }: { branchId: string; businessType: BusinessType, inventoryItems: InventoryItem[], suppliers: Supplier[], onFormSubmit: () => void }) => {
    const { user } = useAuth();
    const [isSubmitting, setIsSubmitting] = React.useState(false);
    const isSubmittingRef = React.useRef(false);
    const normalizedUserRole = String(user?.role || '').toLowerCase();
    const isAdminUser = normalizedUserRole === 'admin' || normalizedUserRole === 'owner' || normalizedUserRole === 'administrator';
    const manualSessionSelectionRef = React.useRef(false);
    
    // NEW: Get active session ID from Dexie (same pattern as waste form)
    const [sessionId, setSessionId] = React.useState<string | undefined>(undefined);
    const [resolvedSessionHasPump, setResolvedSessionHasPump] = React.useState<boolean | null>(null);
    const [availableSessions, setAvailableSessions] = React.useState<SessionChoice[]>([]);
    const [isLoadingSessionChoices, setIsLoadingSessionChoices] = React.useState(false);
    
    React.useEffect(() => {
        let isCancelled = false;
        manualSessionSelectionRef.current = false;
        setAvailableSessions([]);
        setIsLoadingSessionChoices(false);

        const fetchActiveSession = async () => {
            try {
                if (!branchId) {
                    if (!isCancelled) {
                        setSessionId(undefined);
                        setResolvedSessionHasPump(null);
                    }
                    return;
                }

                const backendBranchId = toBackendBranchId(branchId);
                let resolvedSessionId: string | undefined;
                let resolvedSessionHasPumpValue: boolean | null = null;

                try {
                    const backendSession = await authFetch.fetch<any>(
                        `/sessions/sessions/active/?branch_id=${encodeURIComponent(backendBranchId)}`
                    );

                    if (backendSession?.id) {
                        console.log('[ReceiveStockForm] Found active session from backend:', backendSession.id);
                        resolvedSessionId = String(backendSession.id);
                        resolvedSessionHasPumpValue = getSessionHasPump(backendSession);
                    }
                } catch (backendError) {
                    console.warn('[ReceiveStockForm] Backend active session fetch failed, falling back to Dexie:', backendError);
                }

                if (!resolvedSessionId) {
                    const normalizedBranchId = normalizeBranchId(branchId);
                    const currentUserId = String(user?.uid || '');
                    const currentUserEmail = String(user?.email || '').trim().toLowerCase();
                    const activeSessions = await db.sessions
                        .where('status')
                        .equals('active')
                        .toArray();

                    const activeSession = activeSessions
                        .filter((session) => {
                            if (normalizeBranchId(session.branchId) !== normalizedBranchId) {
                                return false;
                            }

                            const sessionUserId = String(session.userId || '');
                            const sessionUserEmail = String(session.userEmail || '').trim().toLowerCase();
                            return sessionUserId === currentUserId || (currentUserEmail !== '' && sessionUserEmail === currentUserEmail);
                        })
                        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
                    
                    if (activeSession?.id) {
                        console.log('[ReceiveStockForm] Found active session in Dexie:', activeSession.id);
                        resolvedSessionId = activeSession.id;
                        resolvedSessionHasPumpValue = getSessionHasPump(activeSession);
                    } else {
                        console.log('[ReceiveStockForm] No active session found in Dexie');
                    }
                }

                if (resolvedSessionId) {
                    if (!isCancelled && !manualSessionSelectionRef.current) {
                        setSessionId(resolvedSessionId);
                        setResolvedSessionHasPump(resolvedSessionHasPumpValue);
                    }
                    if (!isAdminUser) {
                        return;
                    }
                }

                if (!isAdminUser) {
                    if (!isCancelled) {
                        setSessionId(undefined);
                        setResolvedSessionHasPump(null);
                        setAvailableSessions([]);
                    }
                    return;
                }

                if (!isCancelled) {
                    setIsLoadingSessionChoices(true);
                }

                let resolvedChoices: SessionChoice[] = [];

                try {
                    const businessQuery = user?.businessId
                        ? `&business_id=${encodeURIComponent(String(user.businessId))}`
                        : '';
                    const activeListResponse = await authFetch.fetch<any>(
                        `/sessions/sessions/active_list/?branch_id=${encodeURIComponent(backendBranchId)}${businessQuery}`
                    );
                    resolvedChoices = getSessionChoicesFromResponse(activeListResponse);
                } catch (activeListError) {
                    console.warn('[ReceiveStockForm] Backend active_list fetch failed:', activeListError);
                }

                if (resolvedChoices.length === 0) {
                    try {
                        const normalizedBranchId = normalizeBranchId(branchId);
                        const activeSessions = await db.sessions
                            .where('status')
                            .equals('active')
                            .toArray();
                        const branchSessions = activeSessions.filter(
                            (session) => normalizeBranchId(session.branchId) === normalizedBranchId
                        );
                        resolvedChoices = getSessionChoicesFromResponse(branchSessions);
                    } catch (localError) {
                        console.warn('[ReceiveStockForm] Local active session lookup failed:', localError);
                    }
                }

                if (!isCancelled) {
                    setAvailableSessions(resolvedChoices);
                    if (!manualSessionSelectionRef.current && !resolvedSessionId) {
                        if (resolvedChoices.length === 1) {
                            setSessionId(resolvedChoices[0].id);
                            setResolvedSessionHasPump(resolvedChoices[0].hasPump);
                        } else {
                            setSessionId(undefined);
                            setResolvedSessionHasPump(null);
                        }
                    }
                    setIsLoadingSessionChoices(false);
                }
            } catch (error) {
                console.warn('[ReceiveStockForm] Failed to resolve session info:', error);
                if (!isCancelled) {
                    setSessionId(undefined);
                    setResolvedSessionHasPump(null);
                    setAvailableSessions([]);
                    setIsLoadingSessionChoices(false);
                }
            }
        };
        
        fetchActiveSession();

        return () => {
            isCancelled = true;
        };
    }, [branchId, user?.uid, user?.email, user?.businessId, isAdminUser]);
    
    // Log suppliers received
    React.useEffect(() => {
        console.log('[ReceiveStockForm] Suppliers received:', suppliers.length);
        console.log('[ReceiveStockForm] Suppliers data:', suppliers);
    }, [suppliers]);
    
    const form = useForm<ReceiveStockFormValues>({
        defaultValues: {
            supplierId: '',
            items: [{ productId: '', quantity: 1, cost: 0 }],
        }
    });
    const { control, handleSubmit, setValue, getValues } = form;
    const { fields, append, remove, replace } = useFieldArray({
        control,
        name: "items",
    });

    const supplierId = useWatch({ control, name: "supplierId" });
    const watchedItems = useWatch({ control, name: "items" }) || [];
    const hasFuelItems = React.useMemo(
        () => inventoryItems.some((item) => Boolean(item.isFuel)),
        [inventoryItems]
    );
    const hasNonFuelItems = React.useMemo(
        () => inventoryItems.some((item) => !Boolean(item.isFuel)),
        [inventoryItems]
    );
    const canToggleFuelMode = hasFuelItems && hasNonFuelItems;
    const [isFuelMode, setIsFuelMode] = React.useState<boolean>(hasFuelItems && !hasNonFuelItems);

    React.useEffect(() => {
        if (isFuelMode && !hasFuelItems && hasNonFuelItems) {
            setIsFuelMode(false);
        } else if (!isFuelMode && !hasNonFuelItems && hasFuelItems) {
            setIsFuelMode(true);
        }
    }, [hasFuelItems, hasNonFuelItems, isFuelMode]);

    const handleFuelModeToggle = React.useCallback((checked: boolean) => {
        if (!canToggleFuelMode) return;
        setIsFuelMode(checked);
        replace([{ productId: '', quantity: 1, cost: 0 }]);
    }, [replace, canToggleFuelMode]);

    const supplierFilteredProducts = supplierId 
        ? inventoryItems.filter(item => {
            // Match by supplier ID or supplier name
            const itemSupplier = suppliers.find(s => s.id === supplierId);
            const matches = item.supplier === itemSupplier?.name || item.supplier === itemSupplier?.id;
            console.log('[ReceiveStockForm] Checking item:', item.name, 'supplier:', item.supplier, 'matches:', matches, 'isProduced:', item.isProduced);
            return matches && !item.isProduced;
          })
        : inventoryItems.filter(item => !item.isProduced);

    const filteredProducts = supplierFilteredProducts.filter(
        (item) => Boolean(item.isFuel) === isFuelMode
    );

    const selectedProductIds = React.useMemo(() => {
        const selected = new Set<string>();
        for (const item of watchedItems) {
            const productId = String(item?.productId || '').trim();
            if (productId) {
                selected.add(productId);
            }
        }
        return selected;
    }, [watchedItems]);

    const getAvailableProductsForRow = React.useCallback((rowIndex: number) => {
        const currentProductId = String(watchedItems?.[rowIndex]?.productId || '').trim();
        return filteredProducts.filter((product) => {
            if (product.id === currentProductId) return true;
            return !selectedProductIds.has(product.id);
        });
    }, [filteredProducts, selectedProductIds, watchedItems]);

    const liveTotals = React.useMemo(() => {
        const items = (watchedItems || []).filter(
            (item) => item?.productId && String(item.productId).trim() !== ''
        );
        const totalItems = items.length;
        const totalQuantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
        const totalCost = items.reduce(
            (sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.cost) || 0),
            0
        );
        return { totalItems, totalQuantity, totalCost };
    }, [watchedItems]);

    const requiredSessionKind: 'pump' | 'no_pump' = isFuelMode ? 'pump' : 'no_pump';

    const applicableSessions = React.useMemo(() => {
        const requiresPump = requiredSessionKind === 'pump';
        return availableSessions.filter((session) => session.hasPump === requiresPump);
    }, [availableSessions, requiredSessionKind]);

    const enforceSessionKind = true;

    const sessionHasPump = React.useMemo(() => {
        if (!sessionId) return null;
        const found = availableSessions.find((session) => session.id === sessionId);
        if (found) return found.hasPump;
        return resolvedSessionHasPump;
    }, [sessionId, availableSessions, resolvedSessionHasPump]);

    const hasSessionChoices = applicableSessions.length > 0;
    const shouldEnforceSessionMatch = isAdminUser ? hasSessionChoices : Boolean(sessionId);
    const sessionMatchesRequired =
        sessionHasPump !== null &&
        (requiredSessionKind === 'pump' ? sessionHasPump : !sessionHasPump);
    const sessionMismatch = Boolean(
        shouldEnforceSessionMatch &&
            sessionId &&
            !sessionMatchesRequired
    );
    const needsSessionSelection =
        isAdminUser && enforceSessionKind && hasSessionChoices && !sessionId;
    const isWaitingForSessionChoices =
        isAdminUser && enforceSessionKind && hasSessionChoices && !sessionId && isLoadingSessionChoices;
    const shouldShowSessionSelector =
        isAdminUser && enforceSessionKind && hasSessionChoices && (isLoadingSessionChoices || needsSessionSelection || sessionMismatch);
    const shouldWarnNoSessions =
        isAdminUser && enforceSessionKind && !hasSessionChoices && !isLoadingSessionChoices;
    const sessionIdForSubmit =
        sessionId && (isAdminUser ? (hasSessionChoices ? sessionMatchesRequired : false) : sessionMatchesRequired)
            ? sessionId
            : undefined;
    const isSubmitDisabled =
        isSubmitting ||
        sessionMismatch ||
        needsSessionSelection ||
        isWaitingForSessionChoices;
    
    // Log for debugging
    React.useEffect(() => {
        console.log('[ReceiveStockForm] supplierId:', supplierId);
        console.log('[ReceiveStockForm] inventoryItems:', inventoryItems.length);
        console.log('[ReceiveStockForm] inventoryItems sample:', inventoryItems.slice(0, 3).map(i => ({ id: i.id, name: i.name, supplier: i.supplier })));
    }, [supplierId, inventoryItems]);
    
    React.useEffect(() => {
        console.log('[ReceiveStockForm] filteredProducts:', filteredProducts.length);
        console.log('[ReceiveStockForm] filteredProducts:', filteredProducts.map(p => ({ id: p.id, name: p.name, supplier: p.supplier })));
    }, [filteredProducts]);

    const onSubmit = async (data: ReceiveStockFormValues) => {
        if (!user) {
            toast({ variant: 'destructive', title: "User not found" });
            return;
        }

        if (sessionMismatch) {
            toast({
                variant: 'destructive',
                title: 'Session type mismatch',
                description:
                    requiredSessionKind === 'pump'
                        ? 'Select a session with a pump for fuel items.'
                        : 'Select a session without a pump for non-fuel items.',
            });
            return;
        }

        if (needsSessionSelection) {
            toast({ variant: 'destructive', title: 'Select a session', description: 'Choose an active session to attribute this stock receipt.' });
            return;
        }

        const mismatchedItems = (data.items || []).filter((item) => {
            const productId = String(item?.productId || '').trim();
            if (!productId) return false;
            const product = inventoryItems.find((candidate) => String(candidate.id) === productId);
            if (!product) return false;
            return Boolean(product.isFuel) !== isFuelMode;
        });
        if (mismatchedItems.length > 0) {
            toast({
                variant: 'destructive',
                title: 'Item type mismatch',
                description: isFuelMode
                    ? 'Switch to non-fuel mode or remove non-fuel items from this receipt.'
                    : 'Switch to fuel mode or remove fuel items from this receipt.',
            });
            return;
        }

        if (isSubmittingRef.current) {
            return;
        }
        isSubmittingRef.current = true;
        setIsSubmitting(true);

        const selectedSupplier = data.supplierId ? suppliers.find(s => s.id === data.supplierId) : null;
        const paymentStatus: 'Paid' = 'Paid';

        try {
            // Filter out items with empty productId
            const validItems = data.items.filter(item => item.productId && item.productId.trim() !== '');
            
            if (validItems.length === 0) {
                toast({ variant: 'destructive', title: 'Please add at least one item' });
                return;
            }

            const purchaseRecordIds: string[] = [];
            const totalCost = validItems.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.cost)), 0);
            // Generate UUID v4 like suppliers do
            const poId = uuidv4();
            const baseReceivedAt = Date.now();
            
            console.log('[Purchases] Form submission - validItems:', validItems);
            console.log('[Purchases] Calculated totalCost:', totalCost);
            console.log('[Purchases] Calculated totalItems:', validItems.length);

            await db.transaction('rw', db.inventory, db.purchaseHistory, db.purchaseOrders, async () => {
                for (const [index, item] of validItems.entries()) {
                    const product = await db.inventory.get(item.productId);
                    if (!product) continue;

                    const quantityReceived = Number(item.quantity);
                    const costPerUnit = Number(item.cost);
                    const itemTotalCost = quantityReceived * costPerUnit;

                    const newStock = (product.stockUnits || 0) + quantityReceived;
                    
                    // Update main inventory item. Cost will be latest cost.
                    await db.inventory.update(item.productId, {
                        stockUnits: newStock,
                        cost: costPerUnit,
                        status: newStock > (product.reorderLevel || 0) ? 'In Stock' : (newStock > 0 ? 'Low Stock' : 'Out of Stock'),
                        _dirty: true,
                        _operation: 'update'
                    });

                    const receivedDate = new Date(baseReceivedAt + index).toISOString();

                    // Create a new batch record (PurchaseRecord) for this purchase with sync flags
                    // This maps to PurchaseOrderItem on the backend
                    const purchaseRecordId = uuidv4();
                    const purchaseRecord: Omit<PurchaseRecord, 'id'> = {
                        productId: product.id,
                        productName: product.name,
                        supplierId: selectedSupplier?.id,
                        supplierName: selectedSupplier?.name || 'No Supplier',
                        branchId: branchId,
                    sessionId: sessionIdForSubmit,  // Link to active session if available
                        quantityReceived: quantityReceived,
                        quantityRemaining: quantityReceived,
                        costPerUnit: costPerUnit,
                        totalCost: itemTotalCost,
                        paymentStatus: paymentStatus,
                        amountDue: 0,
                        batchNumber: item.batchNumber,
                        expiryDate: item.expiryDate ? format(item.expiryDate, 'yyyy-MM-dd') : undefined,
                        receivedDate: receivedDate,
                        purchaseOrderId: poId,  // Link to the PO
                        _dirty: true,
                        _operation: 'create'
                    };
                    
                    // Add to database with UUID as ID
                    await db.purchaseHistory.put({
                        ...purchaseRecord,
                        id: purchaseRecordId
                    } as PurchaseRecord);
                    purchaseRecordIds.push(purchaseRecordId);
                    console.log('[Purchases] Created purchase record with UUID:', purchaseRecordId);
                    
                    // Mark purchase record for sync (this will create PurchaseOrderItem on backend)
                    await syncService.markAsDirty('PurchaseRecord', purchaseRecordId, 'create');
                }

                // Create a purchase order header for this stock receipt
                // This will be synced separately and reused by PurchaseRecord items
                await db.purchaseOrders.add({
                    id: poId,
                    orderNumber: poId,
                    supplierId: selectedSupplier?.id,
                    supplierName: selectedSupplier?.name || 'No Supplier',
                    status: 'Received',
                    totalItems: validItems.length,
                    totalCost: totalCost,
                    paymentStatus: 'Paid',
                    amountPaid: totalCost,
                    amountDue: 0,
                    notes: `Stock received from ${selectedSupplier?.name || 'No Supplier'}`,
                    createdBy: user.displayName || user.email || 'System',
                    branchId: branchId,
                    items: [],  // Items will be added via PurchaseRecord sync
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    
                    // MRA Compliance Fields
                    supplierTin: selectedSupplier?.supplierTin || undefined,
                    supplierVatRegistered: selectedSupplier?.vatRegistered || false,
                    
                    // EIS Tracking Fields
                    eisSynced: false,
                    eisSyncedAt: undefined,
                    
                    // Approval Workflow
                    approvedBy: undefined,
                    approvedAt: undefined,
                    
                    _dirty: true,
                    _operation: 'create'
                });
                console.log('[Purchases] Created purchase order header:', poId);
            });

            // Mark items for sync
            await syncService.markAsDirty('InventoryItem', data.items[0]?.productId || '', 'update');
            // Mark PurchaseOrder for sync (header only, items come from PurchaseRecord)
            await syncService.markAsDirty('PurchaseOrder', poId, 'create');

            // Log audit action for stock receipt
            await logAuditAction({
                userId: user.uid,
                userName: user.displayName || user.email || 'Unknown',
                branchId: branchId,
                actionType: 'STOCK_RECEIVE',
                entityType: 'Purchase',
                entityId: purchaseRecordIds[0]?.toString() || 'unknown',
                details: {
                    supplier: selectedSupplier?.name || 'No Supplier',
                    itemsCount: data.items.length,
                    totalCost: totalCost,
                    paymentStatus: paymentStatus,
                    purchaseOrderId: poId,
                },
            });

            console.log('[Purchases] Marked for sync and logged audit action');
            
            // Trigger sync immediately
            const activeBranchId = localStorage.getItem('handypos-active-branch');
            if (activeBranchId) {
                console.log('[Purchases] Triggering sync after stock receipt');
                await syncService.performFullSync(activeBranchId);
            }
            
            toast({ title: 'Stock Received Successfully' });
            onFormSubmit();
        } catch (error) {
            console.error('Failed to receive stock:', error);
            toast({ variant: 'destructive', title: 'Error receiving stock' });
        } finally {
            isSubmittingRef.current = false;
            setIsSubmitting(false);
        }
    };

    return (
        <FormProvider {...form}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                <fieldset disabled={isSubmitting} className={cn(isSubmitting && 'opacity-70')}>
                <div className="grid grid-cols-1 gap-4">
                    <FormField
                        control={control}
                        name="supplierId"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Supplier (Optional)</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value || ''}>
                                    <FormControl><SelectTrigger disabled={isSubmitting}><SelectValue placeholder="Select a supplier (optional)" /></SelectTrigger></FormControl>
                                    <SelectContent>
                                        {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <div className="rounded-lg border p-3">
                        <div className="flex items-center justify-between gap-4">
                            <div className="space-y-1">
                                <p className="text-sm font-medium">Product Type</p>
                                <p className="text-xs text-muted-foreground">
                                    {isFuelMode
                                        ? 'Fuel items require a pump session.'
                                        : 'Non-fuel items require a non-pump session.'}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className={cn('text-xs', !isFuelMode ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                                    Non-fuel
                                </span>
                                <Switch
                                    checked={isFuelMode}
                                    onCheckedChange={handleFuelModeToggle}
                                    disabled={!canToggleFuelMode}
                                />
                                <span className={cn('text-xs', isFuelMode ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                                    Fuel
                                </span>
                            </div>
                        </div>
                        {!canToggleFuelMode && (
                            <p className="text-xs text-muted-foreground mt-2">
                                {hasFuelItems ? 'Only fuel items are available.' : 'Only non-fuel items are available.'}
                            </p>
                        )}
                    </div>
                    {shouldShowSessionSelector && (
                        <FormItem>
                            <FormLabel>Assign to Session</FormLabel>
                            <Select
                                onValueChange={(value) => {
                                    manualSessionSelectionRef.current = true;
                                    setSessionId(value);
                                    const selectedSession = applicableSessions.find((session) => session.id === value);
                                    setResolvedSessionHasPump(selectedSession ? selectedSession.hasPump : null);
                                }}
                                value={sessionId || ''}
                            >
                                <FormControl>
                                    <SelectTrigger disabled={isSubmitting || isLoadingSessionChoices}>
                                        <SelectValue placeholder={isLoadingSessionChoices ? 'Loading sessions...' : 'Select an active session'} />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {applicableSessions.length > 0 ? (
                                        applicableSessions.map((session) => (
                                            <SelectItem key={session.id} value={session.id}>
                                                {session.label}
                                            </SelectItem>
                                        ))
                                    ) : (
                                        <SelectItem value="loading" disabled>
                                            {isLoadingSessionChoices ? 'Loading sessions...' : 'No active sessions'}
                                        </SelectItem>
                                    )}
                                </SelectContent>
                            </Select>
                            {needsSessionSelection && (
                                <p className="text-xs text-destructive">Select an active session to continue.</p>
                            )}
                            {sessionMismatch && (
                                <p className="text-xs text-destructive">
                                    {requiredSessionKind === 'pump'
                                        ? 'Current session has no pump. Select a pump session.'
                                        : 'Current session has a pump. Select a non-pump session.'}
                                </p>
                            )}
                        </FormItem>
                    )}
                    {shouldWarnNoSessions && (
                        <div className="text-xs text-muted-foreground">
                            {requiredSessionKind === 'pump'
                                ? 'No active pump sessions found for this branch.'
                                : 'No active non-pump sessions found for this branch.'}
                        </div>
                    )}
                </div>
                
                <Separator />

                <div>
                    <h3 className="text-lg font-medium mb-2">Items Received</h3>
                    <div className="space-y-4">
                        {fields.map((field, index) => {
                            const availableProducts = getAvailableProductsForRow(index);
                            return (
                            <div key={field.id} className="p-4 border rounded-lg space-y-4">
                                <div className="grid grid-cols-12 gap-2 items-start">
                                    <div className="col-span-11 grid grid-cols-1 sm:grid-cols-3 gap-2">
                                        <FormField
                                            control={control}
                                            name={`items.${index}.productId`}
                                            rules={{ required: true }}
                                            render={({ field: selectField }) => (
                                                <FormItem>
                                                    <FormLabel className="text-xs">Product</FormLabel>
                                                    <Select
                                                    onValueChange={(value) => {
                                                    const product = availableProducts.find(p => p.id === value);
                                                    selectField.onChange(value);
                                                    if (product) {
                                                    setValue(`items.${index}.cost`, Number(product.cost || 0), {
                                                        shouldDirty: true,
                                                        shouldTouch: true,
                                                    });
                                                    }
                                                    const currentQty = Number(getValues(`items.${index}.quantity`) || 0);
                                                    if (!currentQty || currentQty <= 0) {
                                                        setValue(`items.${index}.quantity`, 1, {
                                                            shouldDirty: true,
                                                            shouldTouch: true,
                                                        });
                                                    }
                                                    }}
                                                    defaultValue={selectField.value}
                                                    >
                                                    <FormControl><SelectTrigger disabled={isSubmitting}><SelectValue placeholder="Select product" /></SelectTrigger></FormControl>
                                                    <SelectContent>{availableProducts.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                                                    </Select>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField control={control} name={`items.${index}.quantity`} rules={{ required: true, valueAsNumber: true, min: 1 }} render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs">Quantity</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        placeholder="Quantity"
                                                        value={field.value ?? 1}
                                                        onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                                                        disabled={isSubmitting}
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )} />
                                        <FormField control={control} name={`items.${index}.cost`} rules={{ required: true, valueAsNumber: true, min: 0 }} render={({ field }) => (
                                            <FormItem>
                                                <FormLabel className="text-xs">Cost/Unit</FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        step="0.01"
                                                        placeholder="Cost"
                                                        value={field.value ?? 0}
                                                        onChange={(e) => field.onChange(e.target.value === '' ? 0 : Number(e.target.value))}
                                                        disabled={isSubmitting}
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )} />
                                    </div>
                                    <div className="col-span-1 flex items-center justify-end pt-6">
                                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="text-destructive" disabled={isSubmitting}><X className="h-4 w-4" /></Button>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                     <FormField control={control} name={`items.${index}.batchNumber`} render={({ field }) => (
                                        <FormItem><FormLabel className="text-xs">Batch No. (Optional)</FormLabel><FormControl><Input placeholder="Batch number" {...field} disabled={isSubmitting} /></FormControl></FormItem>
                                    )} />
                                     <FormField
                                        control={control}
                                        name={`items.${index}.expiryDate`}
                                        render={({ field }) => (
                                            <FormItem className="flex flex-col">
                                            <FormLabel className="text-xs">Expiry Date (Optional)</FormLabel>
                                                <Popover>
                                                    <PopoverTrigger asChild>
                                                    <FormControl>
                                                        <Button
                                                        variant={'outline'}
                                                        className={cn('pl-3 text-left font-normal', !field.value && 'text-muted-foreground')}
                                                        disabled={isSubmitting}
                                                        >
                                                        {field.value ? (format(field.value, 'PPP')) : (<span>Pick a date</span>)}
                                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                                        </Button>
                                                    </FormControl>
                                                    </PopoverTrigger>
                                                    <PopoverContent className="w-auto p-0" align="start">
                                                    <Calendar mode="single" selected={field.value} onSelect={field.onChange} initialFocus/>
                                                    </PopoverContent>
                                                </Popover>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>
                            );
                        })}
                         <Button
                            type="button"
                            variant="outline"
                            onClick={() => append({ productId: '', quantity: 1, cost: 0, batchNumber: '' })}
                            disabled={isSubmitting}
                        >
                            <Plus className="mr-2 h-4 w-4" /> Add Item
                        </Button>
                        <div className="rounded-lg border bg-muted/30 p-4">
                            <h4 className="text-sm font-medium mb-3">Live Totals</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <p className="text-xs text-muted-foreground">Products</p>
                                    <p className="font-semibold">{liveTotals.totalItems}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">Total Quantity</p>
                                    <p className="font-semibold">{liveTotals.totalQuantity}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">Total Cost</p>
                                    <p className="font-semibold">{liveTotals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button type="submit" disabled={isSubmitDisabled}>
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {isSubmitting ? 'Submitting...' : 'Receive Stock'}
                    </Button>
                </DialogFooter>
                </fieldset>
            </form>
        </FormProvider>
    );
};
