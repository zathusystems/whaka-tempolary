
'use client';

import React from 'react';
import { useForm, FormProvider, useWatch } from 'react-hook-form';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';

import { db, type InventoryItem, type PurchaseRecord, type WasteRecord } from '@/lib/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAuth } from '@/hooks/use-auth';
import { useCurrency } from '@/hooks/use-currency';
import { toast } from '@/hooks/use-toast';
import { logAuditAction } from '@/lib/audit';
import { syncService } from '@/lib/services/sync-service';
import { authFetch } from '@/lib/auth-fetch';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

const wasteReasons = ['Expired', 'Damaged', 'Spoilage', 'Error', 'Other'] as const;
type WasteReason = typeof wasteReasons[number];

type WasteFormValues = {
    itemId: string;
    batchId: number;
    quantity: number;
    reason: WasteReason;
    notes?: string;
};

const getBatchReceivedLabel = (batch: PurchaseRecord): string => {
    const rawReceivedDate =
        (batch as PurchaseRecord & { received_date?: unknown }).receivedDate ??
        (batch as PurchaseRecord & { received_date?: unknown }).received_date ??
        (batch as PurchaseRecord & { createdAt?: unknown }).createdAt ??
        (batch as PurchaseRecord & { created_at?: unknown }).created_at ??
        (batch as PurchaseRecord & { updatedAt?: unknown }).updatedAt ??
        (batch as PurchaseRecord & { updated_at?: unknown }).updated_at;

    if (rawReceivedDate === undefined || rawReceivedDate === null || rawReceivedDate === '') {
        return 'N/A';
    }

    const parsedDate = new Date(rawReceivedDate as string | number | Date);
    if (Number.isNaN(parsedDate.getTime())) {
        return String(rawReceivedDate);
    }

    return format(parsedDate, 'MMM dd');
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

export const RecordWasteForm = ({
  branchId,
  inventoryItems,
  onFormSubmit,
  sessionId: propSessionId,
}: {
  branchId: string;
  inventoryItems: InventoryItem[];
  onFormSubmit: () => void;
  sessionId?: string; // NEW: Session ID to link waste to session
}) => {
    const { user } = useAuth();
    const { format: formatCurrency } = useCurrency();
    const formMethods = useForm<WasteFormValues>();
    const { handleSubmit, control, watch, formState: { errors }, setValue } = formMethods;

    // NEW: Get active session ID from Dexie if not provided as prop
    const [sessionId, setSessionId] = React.useState<string | undefined>(propSessionId);
    
    React.useEffect(() => {
        let isCancelled = false;

        if (propSessionId) {
            setSessionId(propSessionId);
            return;
        }

        const fetchActiveSession = async () => {
            try {
                if (!branchId) {
                    if (!isCancelled) {
                        setSessionId(undefined);
                    }
                    return;
                }

                const backendBranchId = toBackendBranchId(branchId);

                try {
                    const backendSession = await authFetch.fetch<any>(
                        `/sessions/sessions/active/?branch_id=${encodeURIComponent(backendBranchId)}`
                    );

                    if (!isCancelled && backendSession?.id) {
                        console.log('[Waste Form] Found active session from backend:', backendSession.id);
                        setSessionId(String(backendSession.id));
                        return;
                    }
                } catch (backendError) {
                    console.warn('[Waste Form] Backend active session fetch failed, falling back to Dexie:', backendError);
                }

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
                
                if (!isCancelled) {
                    if (activeSession?.id) {
                        console.log('[Waste Form] Found active session in Dexie:', activeSession.id);
                        setSessionId(activeSession.id);
                    } else {
                        console.log('[Waste Form] No active session found in Dexie');
                        setSessionId(undefined);
                    }
                }
            } catch (error) {
                console.warn('[Waste Form] Failed to get session from Dexie:', error);
                if (!isCancelled) {
                    setSessionId(undefined);
                }
            }
        };
        
        fetchActiveSession();

        return () => {
            isCancelled = true;
        };
    }, [propSessionId, branchId, user?.uid, user?.email]);

    const selectedItemId = watch("itemId");

    const batches = useLiveQuery(
        () => {
            if (!selectedItemId || !branchId) return [];
            return db.purchaseHistory
                .where('branchId')
                .equals(branchId)
                .filter(batch => batch.productId === selectedItemId && batch.quantityRemaining > 0)
                .toArray();
        },
        [selectedItemId, branchId]
    );

    const selectedBatchId = watch("batchId");
    const selectedBatch = batches?.find(b => b.id === selectedBatchId);
    const canSubmit = Boolean(selectedBatch);

    const onSubmit = async (data: WasteFormValues) => {
        if (!user) {
            toast({ variant: 'destructive', title: 'Not authenticated' });
            return;
        }
        if (!selectedBatch) {
            toast({ variant: 'destructive', title: 'Invalid batch selected' });
            return;
        }
        const selectedItem = inventoryItems.find(i => i.id === selectedBatch.productId);
        if (!selectedItem) {
             toast({ variant: 'destructive', title: 'Invalid item selected' });
            return;
        }

        const quantityWasted = Number(data.quantity);
        if (quantityWasted > selectedBatch.quantityRemaining) {
            toast({ variant: 'destructive', title: 'Not enough stock in batch', description: `Only ${selectedBatch.quantityRemaining} units available to waste in this batch.` });
            return;
        }

        try {
            // Use offline-first pattern: save locally first, sync later
            await db.transaction('rw', db.inventory, db.wasteLog, db.purchaseHistory, async () => {
                // 1. Decrement the specific batch with sync flags
                // Optimistically update local batch remaining without marking dirty (backend will adjust authoritatively)
                await db.purchaseHistory.update(selectedBatch.id!, {
                    quantityRemaining: selectedBatch.quantityRemaining - quantityWasted,
                });
                
                // 2. Decrement main inventory item's total stock with sync flags
                const newStock = (selectedItem.stockUnits || 0) - quantityWasted;
                // Optimistically update local inventory stock without marking dirty (avoid pushing duplicate decrement)
                await db.inventory.update(selectedItem.id, { 
                    stockUnits: newStock,
                });

                // 3. Create waste record with sync flags using UUID
                const wasteRecordId = uuidv4();
                const wasteRecord: WasteRecord = {
                    id: wasteRecordId,
                    branchId,
                    sessionId: sessionId, // NEW: Link waste to session
                    itemId: selectedItem.id,
                    itemName: selectedItem.name,
                    batchId: selectedBatch.id as any, // Track which batch was wasted for FIFO
                    quantity: quantityWasted,
                    unit: selectedItem.unitType,
                    cost: quantityWasted * selectedBatch.costPerUnit,
                    reason: data.reason,
                    notes: data.notes,
                    recordedBy: user.displayName || user.email,
                    recordedAt: new Date().toISOString(),
                    _dirty: true,
                    _operation: 'create'
                };
                
                console.log('[Waste] Waste record with batchId:', wasteRecordId, 'batchId:', selectedBatch.id);

                // Add waste record directly to database
                await db.wasteLog.add(wasteRecord);
                console.log('[Waste] Created waste record:', wasteRecordId);
                console.log('[Waste] Waste record data:', wasteRecord);
                console.log('[Waste] Waste record _dirty:', wasteRecord._dirty);
                console.log('[Waste] Waste record _operation:', wasteRecord._operation);

                // Log audit action
                await logAuditAction({
                    userId: user.uid,
                    userName: user.displayName || user.email || 'Unknown',
                    branchId: branchId,
                    actionType: 'STOCK_WASTE',
                    entityType: 'Waste',
                    entityId: wasteRecordId,
                    details: {
                        itemName: selectedItem.name,
                        quantity: quantityWasted,
                        reason: data.reason,
                        cost: quantityWasted * selectedBatch.costPerUnit,
                    },
                });
            });

            // Show success message
            const isOnline = typeof window !== 'undefined' && navigator.onLine;
            if (isOnline) {
                toast({ 
                    title: 'Waste Recorded', 
                    description: `${quantityWasted} ${selectedItem.unitType} of ${selectedItem.name} recorded as waste and syncing...` 
                });
                
                // Trigger sync AFTER transaction completes and success toast is shown
                console.log('[Waste] Triggering sync after waste recording');
                try {
                    await syncService.performFullSync(branchId);
                } catch (syncError) {
                    console.error('[Waste] Sync error (non-blocking):', syncError);
                    // Don't show error - sync errors are non-blocking
                }
            } else {
                toast({ 
                    title: 'Waste Recorded (Offline)', 
                    description: `${quantityWasted} ${selectedItem.unitType} of ${selectedItem.name} recorded. Will sync when online.` 
                });
                console.log('[Waste] Offline - waste record queued for sync');
            }
            
            onFormSubmit();
        } catch (error) {
            console.error('Failed to record waste:', error);
            toast({ variant: 'destructive', title: 'Error recording waste' });
        }
    };

    return (
        <FormProvider {...formMethods}>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 max-h-[70vh] overflow-y-auto scrollbar-hide pr-2">
                 <FormField
                    control={control}
                    name="itemId"
                    rules={{ required: "Please select an item." }}
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Item to Waste</FormLabel>
                            <Select onValueChange={(value) => {
                                field.onChange(value);
                                setValue("batchId", 0); // Reset batch selection
                            }}>
                                <FormControl>
                                    <SelectTrigger><SelectValue placeholder="Select an item" /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {inventoryItems.map(item => (
                                        <SelectItem key={item.id} value={item.id}>
                                            {item.name} (Available: {item.stockUnits || 0} {item.unitType})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                 <FormField
                    control={control}
                    name="batchId"
                    rules={{ required: "Please select a batch.", valueAsNumber: true, min: { value: 1, message: "Please select a batch." } }}
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Select Batch to Discard</FormLabel>
                            {!selectedItemId ? (
                                <div className="text-sm text-gray-500 p-3 bg-gray-50 rounded border">
                                    Please select an item first
                                </div>
                            ) : !batches || batches.length === 0 ? (
                                <div className="text-sm text-gray-500 p-3 bg-gray-50 rounded border">
                                    No available batches for this item
                                </div>
                            ) : (
                                <div className="space-y-3 max-h-72 overflow-y-auto pr-2">
                                    {batches.map(batch => {
                                        const isSelected = field.value === batch.id;
                                        const expiryDate = batch.expiryDate ? new Date(batch.expiryDate) : null;
                                        const today = new Date();
                                        today.setHours(0, 0, 0, 0);
                                        const isExpired = expiryDate && expiryDate < today;
                                        const daysUntilExpiry = expiryDate 
                                            ? Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
                                            : null;
                                        
                                        return (
                                            <button
                                                key={batch.id}
                                                type="button"
                                                onClick={() => field.onChange(batch.id)}
                                                className={`w-full text-left p-4 rounded-lg border-2 transition-all duration-200 ${
                                                    isSelected
                                                        ? 'border-primary bg-primary/5 shadow-md'
                                                        : 'border-border bg-card hover:border-primary/50 hover:shadow-sm'
                                                }`}
                                            >
                                                <div className="flex justify-between items-start gap-3">
                                                    <div className="flex-1 space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <div className="font-semibold text-sm text-foreground">
                                                                Batch: {batch.batchNumber || 'N/A'}
                                                            </div>
                                                            <div className={`text-xs font-medium px-2 py-1 rounded-full ${
                                                                isExpired 
                                                                    ? 'bg-destructive/10 text-destructive' 
                                                                    : daysUntilExpiry && daysUntilExpiry <= 7 
                                                                    ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-500'
                                                                    : 'bg-green-500/10 text-green-700 dark:text-green-500'
                                                            }`}>
                                                                {isExpired ? 'EXPIRED' : daysUntilExpiry ? `${daysUntilExpiry}d` : 'No expiry'}
                                                            </div>
                                                        </div>
                                                        
                                                        <div className="grid grid-cols-2 gap-3 text-xs">
                                                            <div className="space-y-1">
                                                                <p className="text-muted-foreground font-medium">Stock</p>
                                                                <p className="text-foreground font-semibold">{batch.quantityRemaining} {batch.quantityRemaining === 1 ? 'unit' : 'units'}</p>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <p className="text-muted-foreground font-medium">Cost/Unit</p>
                                                                <p className="text-foreground font-semibold">{formatCurrency(batch.costPerUnit)}</p>
                                                            </div>
                                                            <div className="space-y-1">
                                                                <p className="text-muted-foreground font-medium">Received</p>
                                                                <p className="text-foreground font-semibold">
                                                                    {getBatchReceivedLabel(batch)}
                                                                </p>
                                                            </div>
                                                            {expiryDate && (
                                                                <div className="space-y-1">
                                                                    <p className="text-muted-foreground font-medium">Expires</p>
                                                                    <p className={`font-semibold ${isExpired ? 'text-destructive' : daysUntilExpiry && daysUntilExpiry <= 7 ? 'text-yellow-700 dark:text-yellow-500' : 'text-foreground'}`}>
                                                                        {format(expiryDate, 'MMM dd')}
                                                                    </p>
                                                                </div>
                                                            )}
                                                        </div>

                                                        {batch.supplierName && (
                                                            <div className="pt-2 border-t border-border">
                                                                <p className="text-xs text-muted-foreground font-medium">Supplier</p>
                                                                <p className="text-sm text-foreground font-medium">{batch.supplierName}</p>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="flex-shrink-0 pt-1">
                                                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all ${
                                                            isSelected 
                                                                ? 'border-primary bg-primary' 
                                                                : 'border-border bg-background'
                                                        }`}>
                                                            {isSelected && (
                                                                <svg className="w-4 h-4 text-primary-foreground" fill="currentColor" viewBox="0 0 20 20">
                                                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                                                </svg>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            <FormMessage />
                        </FormItem>
                    )}
                />

                 <div className="grid grid-cols-2 gap-4">
                     <FormField
                        control={control}
                        name="quantity"
                        rules={{ required: "Quantity is required.", valueAsNumber: true, min: { value: 1, message: "Quantity must be at least 1."} }}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Quantity Wasted</FormLabel>
                                <FormControl><Input type="number" step="1" min="1" max={selectedBatch?.quantityRemaining} {...field} /></FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                     <FormField
                        control={control}
                        name="reason"
                        rules={{ required: "Reason is required."}}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Reason for Waste</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl><SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger></FormControl>
                                    <SelectContent>
                                        {wasteReasons.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
                 <FormField
                    control={control}
                    name="notes"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Notes (Optional)</FormLabel>
                            <FormControl><Textarea placeholder="Add any extra details..." {...field} /></FormControl>
                        </FormItem>
                    )}
                />
                <DialogFooter>
                    <Button type="submit" disabled={!canSubmit}>Record Waste</Button>
                </DialogFooter>
            </form>
        </FormProvider>
    );
};
