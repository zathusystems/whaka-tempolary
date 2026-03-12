import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Controller, useForm } from 'react-hook-form';
import { Loader2, Package } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import { db, type Session } from '@/lib/db';
import { useAuth } from '@/hooks/use-auth';
import { useCurrency } from '@/hooks/use-currency';
import { toast } from '@/hooks/use-toast';
import { authFetch } from '@/lib/auth-fetch';
import { logAuditAction } from '@/lib/audit';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const LOCAL_STORAGE_KEYS = {
  ACTIVE_BRANCH: 'handypos-active-branch',
  BUSINESS_SETTINGS: 'handypos-business-settings',
};

export default function StartSessionForm({ onSessionStarted }: { onSessionStarted: () => void }) {
    const { register, handleSubmit, formState: { errors }, getValues, control } = useForm<{ openingFloat: number; pumpName?: string }>({
        defaultValues: {
            openingFloat: 0,
            pumpName: '',
        },
    });
    const { user } = useAuth();
    const { format: formatCurrency } = useCurrency();
    const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
    const [step, setStep] = useState(1);
    const [isLoading, setIsLoading] = useState(false);
    const [backendInventory, setBackendInventory] = useState<any[]>([]);
    const [isFetchingInventory, setIsFetchingInventory] = useState(false);
    const [availablePumps, setAvailablePumps] = useState<string[]>([]);
    const [backendIsFuelAttendant, setBackendIsFuelAttendant] = useState<boolean | null>(null);
    const staffRecords = useLiveQuery(() => db.staff.toArray(), []);
    const currentUserEmail = (user?.email || '').trim().toLowerCase();
    const currentUserId = String(user?.uid || '').trim();
    const matchedStaff = staffRecords?.find((staff) => {
        const staffEmail = (staff.email || '').trim().toLowerCase();
        if (currentUserEmail && staffEmail) {
            return currentUserEmail === staffEmail;
        }
        if (currentUserId) {
            return String(staff.id) === currentUserId;
        }
        return false;
    });
    const isFuelAttendant = Boolean(
        backendIsFuelAttendant ??
        user?.isFuelAttendant ??
        matchedStaff?.isFuelAttendant
    );
    const showPumpField = isFuelAttendant;

    const toBackendBranchId = (branchId: string): string => {
        const normalized = String(branchId || '').trim();
        const prefixed = /^BRN-(\d+)$/i.exec(normalized);
        if (prefixed) return prefixed[1];
        return normalized;
    };

    const normalizeInventoryItem = (item: any, branchId: string) => ({
        id: String(item?.id ?? ''),
        name: item?.name || 'Unnamed Item',
        branchId: String(item?.branchId ?? item?.branch ?? branchId),
        stockUnits: Number(item?.stockUnits ?? item?.stock_units ?? 0),
        unitType: item?.unitType || item?.unit_type || 'unit',
        itemType: item?.itemType || item?.item_type || 'ingredient',
        sku: item?.sku || '',
        barcode: item?.barcode || '',
        category: item?.category || '',
        price: Number(item?.price ?? 0),
        cost: Number(item?.cost ?? 0),
        reorderLevel: Number(item?.reorderLevel ?? item?.reorder_level ?? 0),
        supplier: item?.supplier || '',
    });

    useEffect(() => {
        const branchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
        if (branchId) setActiveBranchId(branchId);
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        try {
            const rawSettings = localStorage.getItem(LOCAL_STORAGE_KEYS.BUSINESS_SETTINGS);
            if (!rawSettings) {
                setAvailablePumps([]);
                return;
            }

            const parsed = JSON.parse(rawSettings);
            const rawPumps = parsed?.fuelPumps ?? parsed?.fuel_pumps ?? parsed?.pumpNames ?? [];
            if (!Array.isArray(rawPumps)) {
                setAvailablePumps([]);
                return;
            }

            const seen = new Set<string>();
            const normalized = rawPumps
                .map((pump: unknown) => String(pump ?? '').trim())
                .filter((pump: string) => pump.length > 0)
                .filter((pump: string) => {
                    if (seen.has(pump)) return false;
                    seen.add(pump);
                    return true;
                });

            setAvailablePumps(normalized);
        } catch (error) {
            console.warn('[Sessions] Failed to parse fuel pumps from settings cache:', error);
            setAvailablePumps([]);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;

        const fetchStaffProfile = async () => {
            if (!user) {
                setBackendIsFuelAttendant(null);
                return;
            }
            try {
                const staffProfile = await authFetch.fetch<any>('/staff/me/');
                if (cancelled) return;
                if (staffProfile) {
                    setBackendIsFuelAttendant(
                        Boolean(
                            staffProfile?.is_fuel_attendant ??
                            staffProfile?.isFuelAttendant
                        )
                    );
                } else {
                    setBackendIsFuelAttendant(false);
                }
            } catch (error) {
                if (!cancelled) {
                    setBackendIsFuelAttendant(null);
                }
            }
        };

        fetchStaffProfile();

        return () => {
            cancelled = true;
        };
    }, [user?.uid]);

    // Listen for branch changes
    useEffect(() => {
        const handleBranchChange = (e: Event) => {
            const customEvent = e as CustomEvent;
            const branchId = customEvent.detail?.branchId;
            if (branchId) {
                setActiveBranchId(branchId);
                console.log('[Sessions] Branch changed to:', branchId);
            }
        };
        window.addEventListener('branchChanged', handleBranchChange);
        return () => window.removeEventListener('branchChanged', handleBranchChange);
    }, []);

    // Fetch inventory from backend when branch changes
    useEffect(() => {
        if (activeBranchId) {
            const fetchInventoryFromBackend = async () => {
                setIsFetchingInventory(true);
                const localInventory = await db.inventory.where({ branchId: activeBranchId }).toArray();
                try {
                    const backendBranchId = toBackendBranchId(activeBranchId);
                    
                    console.log('[Sessions] Fetching inventory from backend for branch:', backendBranchId);
                    
                    const result = await authFetch.fetch<any>(
                        `/inventory/items/?branch_id=${encodeURIComponent(backendBranchId)}`
                    );
                    
                    console.log('[Sessions] Backend response:', result);
                    
                    if (result && (Array.isArray(result) || result.results)) {
                        const rawItems = Array.isArray(result) ? result : result.results || [];
                        const items = rawItems.map((item: any) => normalizeInventoryItem(item, activeBranchId));
                        console.log('[Sessions] Received', items.length, 'items from backend for branch', backendBranchId);
                        console.log('[Sessions] Sample item from backend:', items[0]);

                        if (items.length > 0) {
                            // Store in state for form display
                            setBackendInventory(items);

                            // Refresh local cache for this branch
                            for (const item of localInventory) {
                                await db.inventory.delete(item.id);
                            }
                            for (const item of items) {
                                await db.inventory.put(item);
                            }
                            console.log('[Sessions] Stored', items.length, 'items in local DB for branch:', activeBranchId);
                        } else {
                            console.warn('[Sessions] Backend returned no inventory items, falling back to local cache.');
                            setBackendInventory(localInventory);
                        }
                    } else {
                        console.log('[Sessions] No valid backend inventory payload, falling back to local cache');
                        setBackendInventory(localInventory);
                    }
                } catch (error) {
                    console.error('[Sessions] Error fetching inventory from backend:', error);
                    setBackendInventory(localInventory);
                } finally {
                    setIsFetchingInventory(false);
                }
            };
            
            fetchInventoryFromBackend();
        }
    }, [activeBranchId]);

    // Use backend inventory for form display (ensures fresh data on session creation)
    const inventory = backendInventory;
    const openingInventory = isFuelAttendant
        ? inventory.filter((item) => Boolean(item.isFuel))
        : inventory.filter((item) => !Boolean(item.isFuel));

    const onFloatSubmit = () => {
        setStep(2);
    };

    const onSubmit = async () => {
        if (!activeBranchId || !user) {
            toast({ variant: 'destructive', title: 'Error', description: 'No active branch or user found.' });
            return;
        }
        setIsLoading(true);
        const openingFloat = getValues('openingFloat');
        const selectedPump = showPumpField ? getValues('pumpName') : '';

        try {
            const backendBranchId = toBackendBranchId(activeBranchId);
            const branchValue = /^\d+$/.test(backendBranchId)
                ? parseInt(backendBranchId, 10)
                : backendBranchId;

            const sessionData = {
                id: uuidv4(),
                business: user.businessId,
                branch: branchValue,
                opening_float: openingFloat,
                expected_cash: openingFloat,
                total_sales: 0,
                total_cash_sales: 0,
                total_card_sales: 0,
                total_mobile_money_sales: 0,
                total_on_account_sales: 0,
                total_other_sales: 0,
                total_tips: 0,
                pump_name: selectedPump || undefined,
                opening_stock: openingInventory.map((i) => ({
                    itemId: i.id,
                    name: i.name,
                    quantity: Number(i.stockUnits ?? i.stock_units ?? 0),
                })),
                started_at: new Date().toISOString(),
                status: 'active',
            };

            console.log('[Sessions] Creating session on backend:', sessionData);

            // Create session on backend
            const response = await authFetch.fetch<any>('/sessions/sessions/', {
                method: 'POST',
                body: JSON.stringify(sessionData),
                meta: {
                    domain: 'sessions',
                    entityType: 'Session',
                    entityId: sessionData.id,
                    metadata: { action: 'create', openingFloat: openingFloat }
                }
            });

            console.log('[Sessions] Session created on backend:', response);

            // Save to local DB for offline access
            await db.sessions.add({
                id: sessionData.id,
                branchId: activeBranchId,
                userId: user.uid,
                userName: user.displayName || user.email || 'Unknown User',
                status: 'active',
                pumpName: selectedPump || undefined,
                openingFloat: openingFloat,
                expectedCash: openingFloat,
                openingStock: sessionData.opening_stock,
                totalSales: 0,
                totalCashSales: 0,
                totalCardSales: 0,
                totalMobileMoneySales: 0,
                totalOnAccountSales: 0,
                totalOtherSales: 0,
                totalTips: 0,
                startedAt: new Date().toISOString(),
            });

            console.log('[Sessions] Session saved to local DB:', sessionData.id);

            // Log audit action
            await logAuditAction({
                userId: user.uid,
                userName: user.displayName || user.email || 'Unknown',
                branchId: activeBranchId,
                actionType: 'SESSION_START',
                entityType: 'Session',
                entityId: sessionData.id,
                details: { openingFloat: openingFloat },
            });

            toast({ title: 'Session Started', description: `Your session has been successfully started.` });
            
            // CRITICAL: Immediately refresh active session in POS modal
            // Dispatch custom event to notify POS modal to fetch the new session
            window.dispatchEvent(new CustomEvent('sessionCreated', { 
              detail: { sessionId: sessionData.id, branchId: activeBranchId }
            }));
            console.log('[Sessions] Dispatched sessionCreated event for POS modal refresh');
            
            onSessionStarted();
        } catch (error) {
            console.error('[Sessions] Error creating session:', error);
            toast({ 
                variant: 'destructive', 
                title: 'Failed to start session',
                description: error instanceof Error ? error.message : 'Unknown error'
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit(step === 1 ? onFloatSubmit : onSubmit)} className="grid gap-4 py-4">
           {step === 1 && (
               <>
                <div className="grid gap-2">
                    <Label htmlFor="openingFloat">Opening Cash Float</Label>
                    <Input
                        id="openingFloat"
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        {...register('openingFloat', { required: true, valueAsNumber: true, min: 0 })}
                    />
                    {errors.openingFloat && <p className="text-sm text-destructive">Please enter a valid opening float.</p>}
                </div>
                {showPumpField && (
                    <div className="grid gap-2">
                        <Label>Fuel Pump</Label>
                        {availablePumps.length > 0 ? (
                            <Controller
                                control={control}
                                name="pumpName"
                                rules={{
                                    validate: (value) =>
                                        Boolean(value) || 'Please select a pump.',
                                }}
                                render={({ field }) => (
                                    <Select value={field.value || ''} onValueChange={field.onChange}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select pump" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {availablePumps.map((pump) => (
                                                <SelectItem key={pump} value={pump}>
                                                    {pump}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                            />
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                No pumps configured. Add fuel pumps in Settings to enable selection.
                            </p>
                        )}
                        {errors.pumpName && (
                            <p className="text-sm text-destructive">{errors.pumpName.message}</p>
                        )}
                    </div>
                )}
                <DialogFooter>
                    <Button type="submit">Next: Review Stock</Button>
                </DialogFooter>
               </>
           )}
           {step === 2 && (
               <>
                <div className="space-y-4">
                    <div className="text-sm">
                        <p>You are starting your session with an opening float of <span className="font-bold text-xs">{formatCurrency(getValues('openingFloat'))}</span>.</p>
                        {showPumpField && availablePumps.length > 0 && getValues('pumpName') && (
                            <p className="text-muted-foreground">Assigned pump: <span className="font-medium">{getValues('pumpName')}</span>.</p>
                        )}
                        <p className="text-muted-foreground">The following stock levels will be recorded for the start of your session.</p>
                    </div>
                    <Card>
                        <CardHeader className="p-4">
                           <CardTitle className="text-base flex items-center gap-2"><Package/> Opening Inventory</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <ScrollArea className="h-64">
                                <Table>
                                    <TableHeader className="sticky top-0 bg-muted">
                                        <TableRow>
                                            <TableHead>Item</TableHead>
                                            <TableHead className="text-right">Quantity</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {isFetchingInventory ? (
                                            <TableRow>
                                                <TableCell colSpan={2} className="text-center text-muted-foreground py-4">
                                                    Loading inventory...
                                                </TableCell>
                                            </TableRow>
                                        ) : openingInventory.length > 0 ? (
                                            openingInventory.map(item => {
                                                const quantity = Number(item.stockUnits ?? item.stock_units ?? 0);
                                                const unitType = item.unitType || item.unit_type || 'unit';
                                                
                                                return (
                                                    <TableRow key={item.id}>
                                                        <TableCell className="font-medium">{item.name}</TableCell>
                                                        <TableCell className="text-right">{quantity} {unitType}</TableCell>
                                                    </TableRow>
                                                );
                                            })
                                        ) : (
                                            <TableRow>
                                                <TableCell colSpan={2} className="text-center text-muted-foreground py-4">
                                                    No inventory items found for this branch
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </ScrollArea>
                        </CardContent>
                    </Card>
                </div>
                <DialogFooter className="pt-4">
                    <Button variant="ghost" onClick={() => setStep(1)} disabled={isLoading}>Back</Button>
                    <Button type="submit" disabled={isLoading}>
                         {isLoading && <Loader2 className="mr-2 animate-spin" />}
                        Confirm & Start Session
                    </Button>
                </DialogFooter>
               </>
           )}
        </form>
    );
};
