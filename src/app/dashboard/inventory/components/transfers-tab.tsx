
'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Repeat, AlertCircle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';

import { db, type StockTransfer } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/hooks/use-toast';
import { syncService } from '@/lib/services/sync-service';
import { PaginationControls, usePaginatedItems } from './pagination-controls';

interface TransfersTabProps {
    stockTransfersData: StockTransfer[];
    isMobile: boolean;
    searchTerm: string;
    onTransferStock: () => void;
    branchId: string;
}

export function TransfersTab({ stockTransfersData, isMobile, searchTerm, onTransferStock, branchId }: TransfersTabProps) {
    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
    const [pendingChanges, setPendingChanges] = useState(0);
    const [retryingTransferId, setRetryingTransferId] = useState<string | null>(null);
    const normalizedSearchTerm = searchTerm.trim().toLowerCase();

    const filteredTransfersData = React.useMemo(() => {
        if (!normalizedSearchTerm) return stockTransfersData || [];

        return (stockTransfersData || []).filter((transfer) =>
            [
                transfer.itemName,
                transfer.fromBranchName,
                transfer.toBranchName,
                transfer.initiatedBy,
                transfer.quantity,
            ].some((value) => String(value || '').toLowerCase().includes(normalizedSearchTerm))
        );
    }, [normalizedSearchTerm, stockTransfersData]);

    const {
        setCurrentPage,
        totalItems,
        totalPages,
        effectiveCurrentPage,
        pageStartIndex,
        pageEndIndex,
        paginatedItems: paginatedTransfersData,
    } = usePaginatedItems(filteredTransfersData);

    React.useEffect(() => {
        setCurrentPage(1);
    }, [normalizedSearchTerm, setCurrentPage]);

    // Refresh the shared transfer history while this tab is open. Transfers
    // created on another logged-in device are stored on the backend, so a
    // local-only Dexie query would otherwise remain stale until a full reload.
    useEffect(() => {
        const refreshTransfers = () => {
            void syncService.fetchAllStockTransfersFromBackend(branchId);
        };

        refreshTransfers();
        window.addEventListener('focus', refreshTransfers);
        const interval = setInterval(refreshTransfers, 30000);
        return () => {
            window.removeEventListener('focus', refreshTransfers);
            clearInterval(interval);
        };
    }, [branchId]);

    // Count pending changes for this branch
    useEffect(() => {
        const countPendingChanges = async () => {
            try {
                const normalizedBranchId = String(branchId || '').trim();
                const branchCandidates = new Set<string>([normalizedBranchId]);
                const numericMatch = /^(?:BRN-|branch-)(\d+)$/i.exec(normalizedBranchId);
                if (numericMatch) {
                    branchCandidates.add(numericMatch[1]);
                }
                if (/^\d+$/.test(normalizedBranchId)) {
                    branchCandidates.add(`BRN-${normalizedBranchId}`);
                    branchCandidates.add(`branch-${normalizedBranchId}`);
                }

                const dirtyRecords = (await db.stockTransfers.toArray()).filter((record) => {
                    const touchesBranch =
                        branchCandidates.has(String(record.fromBranchId || '').trim()) ||
                        branchCandidates.has(String(record.toBranchId || '').trim());
                    return touchesBranch && record._dirty;
                });
                setPendingChanges(dirtyRecords.length);
            } catch (error) {
                console.error('[Transfers] Error counting pending changes:', error);
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
                description: 'Stock transfers synced with backend',
            });
            setTimeout(() => setSyncStatus('idle'), 3000);
        } catch (error) {
            setSyncStatus('error');
            toast({
                variant: 'destructive',
                title: 'Sync Failed',
                description: 'Failed to sync stock transfers',
            });
            setTimeout(() => setSyncStatus('idle'), 3000);
        }
    };

    const failedTransfers = React.useMemo(
        () => (stockTransfersData || []).filter((transfer) => (
            transfer.syncStatus === 'failed' ||
            Boolean(transfer.syncError) ||
            transfer.syncRetryBlocked === true
        )),
        [stockTransfersData]
    );

    const retryTransfer = async (transfer: StockTransfer) => {
        setRetryingTransferId(transfer.id);
        try {
            // The local stock movement already happened when the transfer was
            // created. Retry only the backend transfer record so stock is not
            // deducted twice on the device.
            await db.stockTransfers.update(transfer.id, {
                _dirty: true,
                _operation: transfer._operation || 'create',
                syncStatus: 'pending',
                syncError: undefined,
                syncRetryBlocked: false,
                syncFailedAt: undefined,
            });
            await syncService.performFullSync(transfer.fromBranchId || branchId);
            // A full sync is best-effort and intentionally does not throw when
            // offline. Refresh the authoritative server list before telling
            // the user that this retry actually succeeded.
            await syncService.fetchAllStockTransfersFromBackend(transfer.fromBranchId || branchId);
            const refreshed = await db.stockTransfers.get(transfer.id);
            if (!refreshed || refreshed._dirty || refreshed.syncStatus === 'failed' || refreshed.syncError) {
                throw new Error(refreshed?.syncError || 'The backend rejected the transfer retry.');
            }
            toast({ title: 'Transfer synced', description: `${transfer.itemName} is now saved on the server.` });
        } catch (error) {
            console.error('[Transfers] Retry failed:', error);
            toast({
                variant: 'destructive',
                title: 'Retry failed',
                description: error instanceof Error ? error.message : 'The transfer could not be saved on the server.',
            });
        } finally {
            setRetryingTransferId(null);
        }
    };

    const retryAllFailedTransfers = async () => {
        if (failedTransfers.length === 0) return;
        setSyncStatus('syncing');
        try {
            await db.transaction('rw', db.stockTransfers, async () => {
                for (const transfer of failedTransfers) {
                    await db.stockTransfers.update(transfer.id, {
                        _dirty: true,
                        _operation: transfer._operation || 'create',
                        syncStatus: 'pending',
                        syncError: undefined,
                        syncRetryBlocked: false,
                        syncFailedAt: undefined,
                    });
                }
            });
            const sourceBranches = Array.from(new Set(
                failedTransfers
                    .map((transfer) => transfer.fromBranchId || branchId)
                    .filter(Boolean)
            ));
            for (const sourceBranchId of sourceBranches) {
                await syncService.performFullSync(sourceBranchId);
                await syncService.fetchAllStockTransfersFromBackend(sourceBranchId);
            }
            const remainingFailed: StockTransfer[] = [];
            for (const transfer of failedTransfers) {
                const refreshed = await db.stockTransfers.get(transfer.id);
                if (!refreshed || refreshed._dirty || refreshed.syncStatus === 'failed' || refreshed.syncError) {
                    remainingFailed.push(refreshed || transfer);
                }
            }
            setSyncStatus(remainingFailed.length > 0 ? 'error' : 'synced');
            toast({
                variant: remainingFailed.length > 0 ? 'destructive' : 'default',
                title: remainingFailed.length > 0 ? 'Some transfers still failed' : 'Transfers synced',
                description: remainingFailed.length > 0
                    ? `${remainingFailed.length} transfer${remainingFailed.length === 1 ? '' : 's'} still need attention.`
                    : `${failedTransfers.length} transfer${failedTransfers.length === 1 ? '' : 's'} saved on the server.`,
            });
            setTimeout(() => setSyncStatus('idle'), 3000);
        } catch (error) {
            console.error('[Transfers] Retry failed:', error);
            setSyncStatus('error');
            toast({ variant: 'destructive', title: 'Retry failed', description: 'The failed transfers could not be queued again.' });
            setTimeout(() => setSyncStatus('idle'), 3000);
        }
    };

    const transferStatus = (transfer: StockTransfer) => {
        if (transfer.syncStatus === 'failed' || transfer.syncError || transfer.syncRetryBlocked === true) return 'Failed';
        if (transfer._dirty) return 'Pending';
        return 'Synced';
    };

    return (
        <CardContent>
            <div className="mb-6 flex flex-wrap items-center gap-2">
                <Button onClick={onTransferStock}>
                    <Repeat className="mr-2 h-4 w-4" /> Transfer Stock
                </Button>
                <Button
                    onClick={handleSyncNow}
                    disabled={syncStatus === 'syncing'}
                    variant={pendingChanges > 0 ? 'default' : 'outline'}
                    size="sm"
                    title="Sync transfers with backend"
                >
                    {syncStatus === 'syncing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {syncStatus === 'synced' && <CheckCircle2 className="mr-2 h-4 w-4 text-green-600" />}
                    {syncStatus === 'error' && <AlertCircle className="mr-2 h-4 w-4 text-red-600" />}
                    Sync
                </Button>
                {failedTransfers.length > 0 && (
                    <Button
                        onClick={retryAllFailedTransfers}
                        disabled={syncStatus === 'syncing'}
                        variant="outline"
                        size="sm"
                        title="Retry failed transfers"
                    >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Retry failed ({failedTransfers.length})
                    </Button>
                )}
                {pendingChanges > 0 && (
                    <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                        {pendingChanges} pending
                    </span>
                )}
            </div>
            {isMobile ? (
                filteredTransfersData.length > 0 ? (
                <div className="space-y-3">
                    {paginatedTransfersData.map((transfer) => (
                        <div key={transfer.id} className="rounded-lg border bg-card p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="font-semibold leading-tight">{transfer.itemName}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {format(new Date(transfer.createdAt), 'PPpp')}
                                    </p>
                                </div>
                                <p className="text-sm font-semibold">{transfer.quantity}</p>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <p className="text-xs text-muted-foreground">From</p>
                                    <p className="font-medium">{transfer.fromBranchName}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">To</p>
                                    <p className="font-medium">{transfer.toBranchName}</p>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-xs text-muted-foreground">Initiated By</p>
                                    <p>{transfer.initiatedBy}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">Status</p>
                                    <p className={transfer.syncStatus === 'failed' || transfer.syncError || transfer.syncRetryBlocked === true ? 'font-medium text-destructive' : 'font-medium'}>{transferStatus(transfer)}</p>
                                </div>
                                {(transfer.syncStatus === 'failed' || transfer.syncError || transfer.syncRetryBlocked === true) && (
                                    <div className="col-span-2 space-y-2">
                                        <p className="text-xs text-destructive">{transfer.syncError || 'Transfer sync failed.'}</p>
                                        <Button size="sm" variant="outline" onClick={() => retryTransfer(transfer)} disabled={retryingTransferId === transfer.id || syncStatus === 'syncing'}>
                                            {retryingTransferId === transfer.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                                            Retry
                                        </Button>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                ) : (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                        {normalizedSearchTerm ? `No transfers match "${searchTerm.trim()}".` : 'No stock transfers have been recorded.'}
                    </div>
                )
            ) : (
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Item</TableHead>
                                <TableHead className="text-right">Quantity</TableHead>
                                <TableHead>From</TableHead>
                                <TableHead>To</TableHead>
                                <TableHead>Initiated By</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredTransfersData.length > 0 ? paginatedTransfersData.map((transfer) => (
                                <TableRow key={transfer.id}>
                                    <TableCell>{format(new Date(transfer.createdAt), 'PPpp')}</TableCell>
                                    <TableCell className="font-medium">{transfer.itemName}</TableCell>
                                    <TableCell className="text-right">{transfer.quantity}</TableCell>
                                    <TableCell>{transfer.fromBranchName}</TableCell>
                                    <TableCell>{transfer.toBranchName}</TableCell>
                                    <TableCell>{transfer.initiatedBy}</TableCell>
                                    <TableCell>
                                        <span className={transfer.syncStatus === 'failed' || transfer.syncError || transfer.syncRetryBlocked === true ? 'font-medium text-destructive' : ''}>
                                            {transferStatus(transfer)}
                                        </span>
                                        {(transfer.syncStatus === 'failed' || transfer.syncError || transfer.syncRetryBlocked === true) && transfer.syncError && (
                                            <p className="mt-1 max-w-xs text-xs text-muted-foreground">{transfer.syncError}</p>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {(transfer.syncStatus === 'failed' || transfer.syncError || transfer.syncRetryBlocked === true) && (
                                            <Button size="sm" variant="outline" onClick={() => retryTransfer(transfer)} disabled={retryingTransferId === transfer.id || syncStatus === 'syncing'}>
                                                {retryingTransferId === transfer.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                                                Retry
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            )) : (
                                <TableRow>
                                    <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                                        {normalizedSearchTerm ? `No transfers match "${searchTerm.trim()}".` : 'No stock transfers have been recorded.'}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}
            <PaginationControls
                currentPage={effectiveCurrentPage}
                totalItems={totalItems}
                totalPages={totalPages}
                pageStartIndex={pageStartIndex}
                pageEndIndex={pageEndIndex}
                onPageChange={setCurrentPage}
                itemLabel="transfers"
            />
        </CardContent>
    );
}
