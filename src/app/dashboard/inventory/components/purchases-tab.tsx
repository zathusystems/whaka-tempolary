'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Truck, AlertCircle, CheckCircle2, Loader2, ChevronDown, Cloud, CloudOff, Lock } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';

import { db, type PurchaseRecord, type PurchaseOrder } from '@/lib/db';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from '@/hooks/use-toast';
import { logAuditAction } from '@/lib/audit';
import { syncService } from '@/lib/services/sync-service';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PurchasesTabProps {
    purchaseHistoryData: PurchaseRecord[];
    isMobile: boolean;
    onReceiveStock: () => void;
    branchId: string;
    currency?: string;
}

interface PurchaseGroup {
    groupId: string;
    receivedDate: string;
    displayDate: string;
    dateSortValue: number;
    supplierId: string;
    supplierName: string;
    paymentStatus: string;
    amountDue: number;
    items: PurchaseRecord[];
    totalCost: number;
}

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

const formatPurchaseDate = (...values: unknown[]): string => {
    const parsed = parseDateCandidate(...values);
    return parsed ? parsed.toLocaleDateString() : '-';
};

const purchaseDateSortValue = (...values: unknown[]): number => {
    const parsed = parseDateCandidate(...values);
    return parsed ? parsed.getTime() : 0;
};

export function PurchasesTab({ purchaseHistoryData, isMobile, onReceiveStock, branchId, currency = 'USD' }: PurchasesTabProps) {
    const { user, business } = useAuth();
    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
    const [pendingChanges, setPendingChanges] = useState(0);
    const [selectedPurchase, setSelectedPurchase] = useState<PurchaseGroup | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [businessCurrency, setBusinessCurrency] = useState(currency);

    // Load business currency from IndexedDB
    useEffect(() => {
        const loadCurrency = async () => {
            if (business?.id) {
                try {
                    const businessProfile = await db.business.get(business.id);
                    if (businessProfile?.currency) {
                        setBusinessCurrency(businessProfile.currency);
                    }
                } catch (error) {
                    console.error('[Purchases] Error loading business currency:', error);
                }
            }
        };
        loadCurrency();
    }, [business?.id]);

    // Count pending changes for this branch
    useEffect(() => {
        const countPendingChanges = async () => {
            try {
                const dirtyRecords = await db.purchaseHistory
                    .where({ branchId })
                    .toArray()
                    .then(records => records.filter(r => r._dirty));
                setPendingChanges(dirtyRecords.length);
            } catch (error) {
                console.error('[Purchases] Error counting pending changes:', error);
            }
        };

        countPendingChanges();
        const interval = setInterval(countPendingChanges, 5000); // Check every 5 seconds
        return () => clearInterval(interval);
    }, [branchId]);

    const handleSyncNow = async () => {
        setSyncStatus('syncing');
        try {
            await syncService.performFullSync(branchId);
            setSyncStatus('synced');
            toast({
                title: 'Sync Complete',
                description: 'Purchase history synced with backend',
            });
            setTimeout(() => setSyncStatus('idle'), 3000);
        } catch (error) {
            setSyncStatus('error');
            toast({
                variant: 'destructive',
                title: 'Sync Failed',
                description: 'Failed to sync purchase history',
            });
            setTimeout(() => setSyncStatus('idle'), 3000);
        }
    };

    // Group purchases by purchaseOrderId
    const groupedPurchases = React.useMemo(() => {
        const groups: Record<string, PurchaseGroup> = {};
        
        purchaseHistoryData?.forEach((record) => {
            const key = record.purchaseOrderId || `${record.receivedDate}-${record.supplierId}`;
            const recordDisplayDate = formatPurchaseDate(
                record.receivedDate,
                (record as any).createdAt,
                (record as any).updatedAt
            );
            const recordSortDate = purchaseDateSortValue(
                record.receivedDate,
                (record as any).createdAt,
                (record as any).updatedAt
            );
            
            if (!groups[key]) {
                groups[key] = {
                    groupId: key,
                    receivedDate: record.receivedDate,
                    displayDate: recordDisplayDate,
                    dateSortValue: recordSortDate,
                    supplierId: record.supplierId,
                    supplierName: record.supplierName,
                    paymentStatus: record.paymentStatus,
                    amountDue: record.amountDue,
                    items: [],
                    totalCost: 0,
                };
            } else if (recordSortDate > groups[key].dateSortValue) {
                groups[key].receivedDate = record.receivedDate;
                groups[key].displayDate = recordDisplayDate;
                groups[key].dateSortValue = recordSortDate;
            }
            
            groups[key].items.push(record);
            groups[key].totalCost += record.totalCost;
        });
        
        return Object.values(groups).sort((a, b) => 
            b.dateSortValue - a.dateSortValue
        );
    }, [purchaseHistoryData]);

    const handleViewDetails = (purchase: PurchaseGroup) => {
        setSelectedPurchase(purchase);
        setIsModalOpen(true);
    };

    const getCurrencySymbol = () => {
        return businessCurrency === 'MWK' ? 'MWK' : '$';
    };

    const renderPurchaseCard = (purchase: PurchaseGroup) => {
        const itemCount = purchase.items.length;
        const totalQuantity = purchase.items.reduce((sum, item) => sum + item.quantityReceived, 0);
        const currencySymbol = getCurrencySymbol();
        
        return (
            <Card key={purchase.groupId} className="mb-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => handleViewDetails(purchase)}>
                <CardHeader className="p-4">
                    <div className="flex items-center justify-between">
                        <div className="flex-1">
                            <CardTitle className="text-base">{purchase.supplierName}</CardTitle>
                            <CardDescription>{purchase.displayDate}</CardDescription>
                        </div>
                        <div className="text-right">
                            <p className="font-semibold text-lg">{currencySymbol} {purchase.totalCost.toFixed(2)}</p>
                            <p className="text-xs text-muted-foreground">{itemCount} item{itemCount !== 1 ? 's' : ''}</p>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-4 pt-0 text-sm">
                    <Separator className="my-3" />
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-muted-foreground">Total Quantity</p>
                            <p className="font-semibold">{totalQuantity} units</p>
                        </div>
                        <div>
                            <p className="text-muted-foreground">Payment Status</p>
                            <Badge variant={purchase.paymentStatus === 'Paid' ? 'secondary' : 'outline'}>{purchase.paymentStatus}</Badge>
                        </div>
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    </div>
                </CardContent>
            </Card>
        );
    };

    return (
        <>
            <CardContent>
                <div className="mb-6">
                    <Button onClick={onReceiveStock}>
                        <Truck className="mr-2 h-4 w-4" /> Receive Stock
                    </Button>
                </div>
                {isMobile ? (
                    <div>
                        {groupedPurchases?.map(renderPurchaseCard)}
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Supplier</TableHead>
                                    <TableHead className="text-right">Items</TableHead>
                                    <TableHead className="text-right">Total Qty</TableHead>
                                    <TableHead>Payment</TableHead>
                                    <TableHead className="text-right">Total Cost</TableHead>
                                    <TableHead className="text-center">Sync Status</TableHead>
                                    <TableHead className="text-center">Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {groupedPurchases?.map((purchase) => {
                                    const totalQuantity = purchase.items.reduce((sum, item) => sum + item.quantityReceived, 0);
                                    const currencySymbol = getCurrencySymbol();
                                    const isDirty = purchase.items.some(item => item._dirty);
                                    
                                    return (
                                        <TableRow key={purchase.groupId} className="cursor-pointer hover:bg-muted/50">
                                            <TableCell>{purchase.displayDate}</TableCell>
                                            <TableCell className="font-medium">{purchase.supplierName}</TableCell>
                                            <TableCell className="text-right">{purchase.items.length}</TableCell>
                                            <TableCell className="text-right">{totalQuantity}</TableCell>
                                            <TableCell><Badge variant={purchase.paymentStatus === 'Paid' ? 'secondary' : 'outline'} className="text-xs">{purchase.paymentStatus}</Badge></TableCell>
                                            <TableCell className="text-right font-semibold">{currencySymbol} {purchase.totalCost.toFixed(2)}</TableCell>
                                            <TableCell className="text-center">
                                                {isDirty ? (
                                                    <div className="flex items-center justify-center gap-1">
                                                        <CloudOff className="h-4 w-4 text-orange-500" />
                                                        <span className="text-xs text-orange-600">Pending</span>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center justify-center gap-1">
                                                        <Cloud className="h-4 w-4 text-green-500" />
                                                        <span className="text-xs text-green-600">Synced</span>
                                                    </div>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-center">
                                                <Button 
                                                    variant="ghost" 
                                                    size="sm"
                                                    onClick={() => handleViewDetails(purchase)}
                                                >
                                                    View
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    );
                                })}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </CardContent>

            {/* Purchase Details Modal */}
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
                    <DialogHeader className="sticky top-0 bg-background z-10 pt-6">
                        <DialogTitle>Purchase Order Details</DialogTitle>
                        <DialogDescription>
                            {selectedPurchase && `${selectedPurchase.supplierName} - ${selectedPurchase.displayDate}`}
                        </DialogDescription>
                    </DialogHeader>
                    
                    {selectedPurchase && (
                        <div className="flex-1 overflow-y-auto -mx-6 px-6">
                            {/* Purchase Summary */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6 p-4 bg-muted rounded-lg">
                                <div>
                                    <p className="text-xs text-muted-foreground">Supplier</p>
                                    <p className="font-semibold">{selectedPurchase.supplierName}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">Date Received</p>
                                    <p className="font-semibold">{selectedPurchase.displayDate}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">Payment Status</p>
                                    <Badge variant={selectedPurchase.paymentStatus === 'Paid' ? 'secondary' : 'outline'}>{selectedPurchase.paymentStatus}</Badge>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">Total Cost</p>
                                    <p className="font-semibold text-lg">{getCurrencySymbol()} {selectedPurchase.totalCost.toFixed(2)}</p>
                                </div>
                            </div>

                            {/* Items Table */}
                            <div className="mb-4">
                                <h3 className="font-semibold mb-3">Items in this Purchase</h3>
                                <div className="overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Product</TableHead>
                                                <TableHead className="text-right">Received</TableHead>
                                                <TableHead className="text-right">Remaining</TableHead>
                                                <TableHead className="text-right">Unit Cost</TableHead>
                                                <TableHead className="text-right">Total</TableHead>
                                                <TableHead>Batch No.</TableHead>
                                                <TableHead>Expiry Date</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {selectedPurchase.items.map((item) => {
                                                const isConsumed = item.quantityRemaining === 0;
                                                const percentRemaining = (item.quantityRemaining / item.quantityReceived) * 100;
                                                const currencySymbol = getCurrencySymbol();
                                                return (
                                                    <TableRow key={item.id} className={isConsumed ? 'opacity-60' : ''}>
                                                        <TableCell className="font-medium">{item.productName}</TableCell>
                                                        <TableCell className="text-right">{item.quantityReceived}</TableCell>
                                                        <TableCell className="text-right">
                                                            <div className="flex items-center justify-end gap-2">
                                                                <span className={isConsumed ? 'text-muted-foreground line-through' : 'font-semibold'}>{item.quantityRemaining}</span>
                                                                {percentRemaining > 0 && percentRemaining < 100 && (
                                                                    <div className="w-12 h-2 bg-muted rounded-full overflow-hidden">
                                                                        <div 
                                                                            className={`h-full ${percentRemaining > 50 ? 'bg-green-500' : percentRemaining > 25 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                                                            style={{ width: `${percentRemaining}%` }}
                                                                        />
                                                                    </div>
                                                                )}
                                                                {isConsumed && <Badge variant="outline" className="text-xs">Consumed</Badge>}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right">{currencySymbol} {item.costPerUnit.toFixed(2)}</TableCell>
                                                        <TableCell className="text-right font-semibold">{currencySymbol} {item.totalCost.toFixed(2)}</TableCell>
                                                        <TableCell className="font-mono text-xs">{item.batchNumber || 'N/A'}</TableCell>
                                                        <TableCell>{item.expiryDate ? formatPurchaseDate(item.expiryDate) : 'N/A'}</TableCell>
                                                    </TableRow>
                                                );
                                            })}
                                        </TableBody>
                                    </Table>
                                </div>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
