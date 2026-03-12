
'use client';

import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { PlusCircle, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { db, type WasteRecord } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { syncService } from '@/lib/services/sync-service';

interface WasteTabProps {
    wasteLogData: WasteRecord[];
    isMobile: boolean;
    onRecordWaste: () => void;
    branchId: string;
}

export function WasteTab({ wasteLogData, isMobile, onRecordWaste, branchId }: WasteTabProps) {
    const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle');
    const [pendingChanges, setPendingChanges] = useState(0);

    // Count pending changes for this branch
    useEffect(() => {
        const countPendingChanges = async () => {
            try {
                const dirtyRecords = await db.wasteLog
                    .where({ branchId })
                    .toArray()
                    .then(records => records.filter(r => r._dirty));
                setPendingChanges(dirtyRecords.length);
            } catch (error) {
                console.error('[Waste] Error counting pending changes:', error);
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
                description: 'Waste records synced with backend',
            });
            setTimeout(() => setSyncStatus('idle'), 3000);
        } catch (error) {
            setSyncStatus('error');
            toast({
                variant: 'destructive',
                title: 'Sync Failed',
                description: 'Failed to sync waste records',
            });
            setTimeout(() => setSyncStatus('idle'), 3000);
        }
    };

    return (
        <CardContent>
            <div className="mb-6 flex flex-wrap items-center gap-2">
                <Button variant="destructive" onClick={onRecordWaste}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Record Waste
                </Button>
                <Button
                    onClick={handleSyncNow}
                    disabled={syncStatus === 'syncing'}
                    variant={pendingChanges > 0 ? 'default' : 'outline'}
                    size="sm"
                    title="Sync waste records with backend"
                >
                    {syncStatus === 'syncing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {syncStatus === 'synced' && <CheckCircle2 className="mr-2 h-4 w-4 text-green-600" />}
                    {syncStatus === 'error' && <AlertCircle className="mr-2 h-4 w-4 text-red-600" />}
                    Sync
                </Button>
                {pendingChanges > 0 && (
                    <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                        {pendingChanges} pending
                    </span>
                )}
            </div>
            {isMobile ? (
                <div className="space-y-3">
                    {wasteLogData?.map((log) => (
                        <div key={log.id} className="rounded-lg border bg-card p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <p className="font-semibold leading-tight">{log.itemName}</p>
                                    <p className="text-xs text-muted-foreground">{format(new Date(log.recordedAt), 'PP')}</p>
                                </div>
                                <p className="text-sm font-semibold text-destructive">-${log.cost.toFixed(2)}</p>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <p className="text-xs text-muted-foreground">Quantity</p>
                                    <p className="font-medium">{log.quantity}{log.unit ? ` ${log.unit}` : ''}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">Reason</p>
                                    <Badge variant="outline">{log.reason}</Badge>
                                </div>
                                <div className="col-span-2">
                                    <p className="text-xs text-muted-foreground">Recorded By</p>
                                    <p>{log.recordedBy}</p>
                                </div>
                            </div>
                        </div>
                    ))}
                    {(!wasteLogData || wasteLogData.length === 0) && (
                        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                            No waste has been recorded.
                        </div>
                    )}
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Item</TableHead>
                                <TableHead className="text-right">Quantity</TableHead>
                                <TableHead>Reason</TableHead>
                                <TableHead className="text-right">Cost</TableHead>
                                <TableHead>Recorded By</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {wasteLogData?.map(log => (
                                <TableRow key={log.id}>
                                    <TableCell>{format(new Date(log.recordedAt), 'PP')}</TableCell>
                                    <TableCell className="font-medium">{log.itemName}</TableCell>
                                    <TableCell className="text-right">{log.quantity} {log.unit}</TableCell>
                                    <TableCell><Badge variant="outline">{log.reason}</Badge></TableCell>
                                    <TableCell className="text-right font-semibold text-destructive">-${log.cost.toFixed(2)}</TableCell>
                                    <TableCell>{log.recordedBy}</TableCell>
                                </TableRow>
                            ))}
                            {(!wasteLogData || wasteLogData.length === 0) && (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center">No waste has been recorded.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            )}
        </CardContent>
    );
}
