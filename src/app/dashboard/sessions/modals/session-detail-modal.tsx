
import React, { useCallback, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, Loader2, Package, Printer } from 'lucide-react';

import { db, type Session, type Order } from '@/lib/db';
import { useCurrency } from '@/hooks/use-currency';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { buildZReportPrintHtml, calculateZReportSummary, isSessionClosedForZReport } from '@/lib/z-report-print';
import { SaleDetailModal } from './index';

const LOCAL_STORAGE_KEYS = {
  ACTIVE_BRANCH: 'handypos-active-branch',
};

const normalizeStockBranchId = (value?: string | number | null): string => {
    const normalized = String(value ?? '').trim();
    if (!normalized) return '';

    const brnMatch = /^BRN-(\d+)$/i.exec(normalized);
    if (brnMatch) return brnMatch[1];

    const legacyMatch = /^branch-(\d+)$/i.exec(normalized);
    if (legacyMatch) return legacyMatch[1];

    return normalized;
};

const normalizeProductName = (value?: string | null): string => {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
};

const isMeaningfulProductName = (value?: string | null): boolean => {
    const normalized = normalizeProductName(value);
    return normalized !== '' && normalized !== 'unknown item' && normalized !== 'unknown';
};

const toProductIdKey = (itemId?: string | number | null): string => {
    const normalizedItemId = String(itemId ?? '').trim();
    if (!normalizedItemId) return '';
    return `id:${normalizedItemId}`;
};

const resolveCanonicalProductKey = (
    itemId: string | number | null | undefined,
    name: string | null | undefined,
    nameToId: Map<string, string>
): string => {
    const idKey = toProductIdKey(itemId);
    if (idKey) return idKey;

    const normalizedName = normalizeProductName(name);
    if (!normalizedName) return '';

    const mappedId = nameToId.get(normalizedName);
    if (mappedId) return `id:${mappedId}`;

    return `name:${normalizedName}`;
};

const resolveDisplayProductName = (
    itemId: string | number | null | undefined,
    name: string | null | undefined,
    idToName: Map<string, string>
): string => {
    const trimmedName = String(name ?? '').trim();
    if (isMeaningfulProductName(trimmedName)) return trimmedName;

    const normalizedItemId = String(itemId ?? '').trim();
    if (normalizedItemId && idToName.has(normalizedItemId)) {
        return idToName.get(normalizedItemId)!;
    }

    if (trimmedName) return trimmedName;
    return 'Unknown Item';
};

const getOrderItemInventoryId = (item: any): string | undefined => {
    const rawId = item?.inventoryItemId ?? item?.inventory_item_id ?? item?.inventoryItem ?? item?.inventory_item;
    if (rawId === undefined || rawId === null) return undefined;
    const normalized = String(rawId).trim();
    return normalized || undefined;
};

const toTrimmedString = (value: unknown): string => {
    if (value === undefined || value === null) {
        return '';
    }
    const trimmed = String(value).trim();
    return trimmed;
};

const resolveBuyerField = (...candidates: Array<unknown>): string => {
    for (const candidate of candidates) {
        const trimmed = toTrimmedString(candidate);
        if (trimmed) {
            return trimmed;
        }
    }
    return '';
};

const resolveBuyerDetails = (order: Order | null | undefined) => {
    const source = order as any;
    const customer = source?.customer ?? {};
    const buyer = source?.buyer ?? {};
    const name = resolveBuyerField(
        source?.customerName,
        source?.customer_name,
        source?.buyerName,
        source?.buyer_name,
        customer?.name,
        customer?.fullName,
        buyer?.name,
        buyer?.fullName
    );
    const phone = resolveBuyerField(
        source?.customerPhone,
        source?.customer_phone,
        source?.buyerPhone,
        source?.buyer_phone,
        customer?.phone,
        customer?.phoneNumber,
        buyer?.phone,
        buyer?.phoneNumber
    );
    const tin = resolveBuyerField(
        source?.customerTin,
        source?.customer_tin,
        source?.buyerTin,
        source?.buyer_tin,
        customer?.tin,
        customer?.taxPin,
        customer?.tax_pin,
        buyer?.tin,
        buyer?.taxPin,
        buyer?.tax_pin
    );

    return {
        name: name || '',
        phone: phone || '',
        tin: tin || '',
    };
};

const resolveEisStatus = (order: Order | null | undefined): string => {
    const source = order as any;
    const status = toTrimmedString(source?.eisStatus ?? source?.eis_status);
    return status ? status.toUpperCase() : '';
};

const sortOrdersByMostRecent = (orders: Order[]): Order[] => {
    return [...orders].sort((a, b) => {
        const timeA = Date.parse(String((a as any)?.createdAt ?? (a as any)?.created_at ?? ''));
        const timeB = Date.parse(String((b as any)?.createdAt ?? (b as any)?.created_at ?? ''));
        const normalizedTimeA = Number.isFinite(timeA) ? timeA : 0;
        const normalizedTimeB = Number.isFinite(timeB) ? timeB : 0;
        if (normalizedTimeB !== normalizedTimeA) {
            return normalizedTimeB - normalizedTimeA;
        }

        const orderNumberA = Number((a as any)?.orderNumber ?? (a as any)?.order_number ?? 0);
        const orderNumberB = Number((b as any)?.orderNumber ?? (b as any)?.order_number ?? 0);
        const normalizedOrderNumberA = Number.isFinite(orderNumberA) ? orderNumberA : 0;
        const normalizedOrderNumberB = Number.isFinite(orderNumberB) ? orderNumberB : 0;
        if (normalizedOrderNumberB !== normalizedOrderNumberA) {
            return normalizedOrderNumberB - normalizedOrderNumberA;
        }

        return String((b as any)?.id ?? '').localeCompare(String((a as any)?.id ?? ''));
    });
};

const SessionSalesListModal = ({ sessionId }: { sessionId: string }) => {
  const { format: formatCurrency } = useCurrency();
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  
  const sessionOrders = useLiveQuery(
    () => db.orders.where({ sessionId }).toArray(),
    [sessionId, refreshKey]
  ) || [];
  const orderedSessionSales = useMemo(() => sortOrdersByMostRecent(sessionOrders), [sessionOrders]);

  const orderStatusBadge: Record<any, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    New: 'default',
    Preparing: 'secondary',
    Ready: 'outline',
    Completed: 'default',
    Voided: 'destructive',
    Cancelled: 'destructive',
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Sales List</CardTitle>
          <CardDescription>{orderedSessionSales.length} sale{orderedSessionSales.length !== 1 ? 's' : ''} recorded in this session</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order #</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Subtotal</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderedSessionSales.length > 0 ? (
                orderedSessionSales.map((order) => {
                  const buyerDetails = resolveBuyerDetails(order);
                  const buyerName = buyerDetails.name || 'Walk-in';
                  const eisStatus = resolveEisStatus(order);
                  const isEisPending = eisStatus === 'PENDING' || (!eisStatus && Boolean((order as any)?._dirty));
                  return (
                    <TableRow 
                      key={order.id}
                      className={`cursor-pointer hover:bg-muted/50 ${order.status === 'Voided' ? 'opacity-60' : ''}`}
                      onClick={() => setSelectedOrder(order)}
                    >
                      <TableCell className="font-medium">#{order.orderNumber}</TableCell>
                      <TableCell className="text-sm">{format(new Date(order.createdAt), 'HH:mm:ss')}</TableCell>
                      <TableCell className="text-sm">
                        <div className="font-medium">{buyerName}</div>
                        {buyerDetails.phone && (
                          <div className="text-xs text-muted-foreground">{buyerDetails.phone}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{order.items.length} item{order.items.length !== 1 ? 's' : ''}</TableCell>
                      <TableCell className="text-sm">{order.paymentMethod}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={orderStatusBadge[order.status]}>
                            {order.status}
                          </Badge>
                          {isEisPending && (
                            <Badge variant="outline" className="border-amber-300 text-amber-700">
                              EIS Pending
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(order.subtotal)}</TableCell>
                      <TableCell className="text-right text-sm">{formatCurrency(order.tax)}</TableCell>
                      <TableCell className="text-right font-medium text-sm">{formatCurrency(order.total)}</TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center">
                    <p className="text-muted-foreground">No sales recorded in this session.</p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <SaleDetailModal 
        order={selectedOrder}
        isOpen={!!selectedOrder}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedOrder(null);
            // Trigger refresh of orders list when modal closes (in case order was voided)
            setRefreshKey(prev => prev + 1);
          }
        }}
      />
    </>
  );
};

const ZReportTabModal = ({ session }: { session: Session }) => {
    const { format: formatCurrency } = useCurrency();
    const [isPrintingZReport, setIsPrintingZReport] = useState(false);
    
    const sessionOrders = useLiveQuery(
        () => db.orders.where({ sessionId: session.id }).toArray(),
        [session.id]
    ) || [];

    const { paymentBreakdown, financialSummary, eisSummary } = useMemo(
        () => calculateZReportSummary(sessionOrders as any),
        [sessionOrders]
    );

    const isSessionClosed = isSessionClosedForZReport(session);
    const formatOptionalDateTime = (value?: string) => {
        if (!value) return 'N/A';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return 'N/A';
        return format(parsed, 'PPpp');
    };

    const handlePrintZReport = useCallback(async () => {
        if (!isSessionClosed) {
            return;
        }

        try {
            setIsPrintingZReport(true);
            const activeBranchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH) || 'main';
            const [{ printerService }, { silentPrintService }] = await Promise.all([
                import('@/lib/services/printer-service'),
                import('@/lib/services/silent-print-service'),
            ]);

            const [printerSettings, defaultPrinter] = await Promise.all([
                printerService.getPrinterSettings(activeBranchId),
                printerService.getDefaultPrinter(activeBranchId),
            ]);

            if (!defaultPrinter) {
                toast({
                    variant: 'destructive',
                    title: 'No Printer Configured',
                    description: 'Please configure a default printer before printing the Z report.',
                });
                return;
            }

            const selectedPaperSize: '80mm' | '58mm' =
                printerSettings.receiptPaperWidth === '58mm' ? '58mm' : '80mm';

            const htmlContent = buildZReportPrintHtml({
                session,
                paymentBreakdown,
                financialSummary,
                eisSummary,
                formatCurrency,
            });

            const didPrint = await silentPrintService.printSilentlyViaSystem(htmlContent, {
                printerName: defaultPrinter.name,
                printerId: defaultPrinter.id,
                copies: 1,
                paperSize: selectedPaperSize,
                printerPaperSize: defaultPrinter.paperWidth === '58mm' ? '58mm' : '80mm',
                timeout: 20000,
            });

            if (!didPrint) {
                toast({
                    variant: 'destructive',
                    title: 'Print Failed',
                    description: 'Could not print the Z report. Check the printer connection and try again.',
                });
                return;
            }

            toast({
                title: 'Z Report Printed',
                description: `Sent to ${defaultPrinter.name}`,
            });
        } catch (error) {
            console.error('Error printing Z report:', error);
            toast({
                variant: 'destructive',
                title: 'Print Error',
                description: error instanceof Error ? error.message : 'Unexpected error while printing Z report.',
            });
        } finally {
            setIsPrintingZReport(false);
        }
    }, [eisSummary, financialSummary, formatCurrency, isSessionClosed, paymentBreakdown, session]);

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <CardTitle>Z Report</CardTitle>
                        <CardDescription>Complete session summary and cash reconciliation</CardDescription>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={!isSessionClosed || isPrintingZReport}
                        onClick={handlePrintZReport}
                    >
                        {isPrintingZReport ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Printer className="mr-2 h-4 w-4" />
                        )}
                        {isPrintingZReport ? 'Printing...' : 'Print Z Report'}
                    </Button>
                </div>
                {!isSessionClosed && (
                    <p className="text-xs text-muted-foreground">
                        Close this session first to print the Z report.
                    </p>
                )}
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Sales & Tax Summary</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Orders:</span>
                                <span className="font-semibold">{financialSummary.orderCount}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Session Total Sales:</span>
                                <span className="font-semibold">{formatCurrency(session.totalSales || 0)}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Net Sales:</span>
                                <span>{formatCurrency(financialSummary.netSales)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Total Tax:</span>
                                <span>{formatCurrency(financialSummary.totalTax)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Gross Sales:</span>
                                <span>{formatCurrency(financialSummary.grossSales)}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Cash Sales:</span>
                                <span>{formatCurrency(paymentBreakdown.cash)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Card Sales:</span>
                                <span>{formatCurrency(paymentBreakdown.card)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Mobile Money:</span>
                                <span>{formatCurrency(paymentBreakdown.mobileMoney)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">On Account:</span>
                                <span>{formatCurrency(paymentBreakdown.onAccount)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Other:</span>
                                <span>{formatCurrency(paymentBreakdown.other)}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between font-semibold">
                                <span>Total Payable:</span>
                                <span>{formatCurrency(financialSummary.totalPayable)}</span>
                            </div>
                        </CardContent>
                    </Card>
                    
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Cash Reconciliation</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Opening Float:</span>
                                <span className="font-semibold">{formatCurrency(session.openingFloat || 0)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">+ Cash Sales:</span>
                                <span className="text-green-600">{formatCurrency(paymentBreakdown.cash)}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between font-semibold">
                                <span>Expected in Drawer:</span>
                                <span>{formatCurrency((session.openingFloat || 0) + paymentBreakdown.cash)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Actual Cash:</span>
                                <span>{formatCurrency(session.actualCash || 0)}</span>
                            </div>
                            <Separator />
                            <div className={`flex justify-between font-semibold p-2 rounded ${(session.difference || 0) === 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                <span>Difference:</span>
                                <span>{formatCurrency(session.difference || 0)}</span>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">EIS Compliance</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Fiscal Assigned:</span>
                                <span className="font-semibold">{eisSummary.ordersWithFiscalNumber}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Fiscal Pending:</span>
                                <span>{eisSummary.pendingFiscalNumber}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">EIS Pending:</span>
                                <span>{eisSummary.eisStatusCounts.pending}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">EIS Submitted:</span>
                                <span>{eisSummary.eisStatusCounts.submitted}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">EIS Accepted:</span>
                                <span className="text-green-600">{eisSummary.eisStatusCounts.accepted}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">EIS Rejected:</span>
                                <span className="text-red-600">{eisSummary.eisStatusCounts.rejected}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">EIS Unknown:</span>
                                <span>{eisSummary.eisStatusCounts.unknown}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">With QR:</span>
                                <span>{eisSummary.ordersWithQr}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">With Signature:</span>
                                <span>{eisSummary.ordersWithSignature}</span>
                            </div>
                            <Separator />
                            <div className="space-y-1 text-xs">
                                <div className="flex justify-between gap-2">
                                    <span className="text-muted-foreground">First Fiscal #:</span>
                                    <span className="font-medium break-all text-right">{eisSummary.firstFiscalInvoice || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between gap-2">
                                    <span className="text-muted-foreground">Last Fiscal #:</span>
                                    <span className="font-medium break-all text-right">{eisSummary.lastFiscalInvoice || 'N/A'}</span>
                                </div>
                                <div className="flex justify-between gap-2">
                                    <span className="text-muted-foreground">First Submission:</span>
                                    <span className="text-right">{formatOptionalDateTime(eisSummary.firstSubmissionAt)}</span>
                                </div>
                                <div className="flex justify-between gap-2">
                                    <span className="text-muted-foreground">Last Submission:</span>
                                    <span className="text-right">{formatOptionalDateTime(eisSummary.lastSubmissionAt)}</span>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </CardContent>
        </Card>
    );
};

const StockReportTabModal = ({ session }: { session: Session }) => {
    const { format: formatCurrency } = useCurrency();
    
    const sessionOrders = useLiveQuery(
        () => db.orders.where({ sessionId: session.id }).toArray(),
        [session.id]
    ) || [];

    const sessionPurchases = useLiveQuery(
        async () => {
            const purchasesBySession = await db.purchaseHistory
                .where('sessionId')
                .equals(session.id)
                .toArray();
            
            let purchases = purchasesBySession;

            if (session.startedAt) {
                const startTime = new Date(session.startedAt);
                const endTime = session.closedAt ? new Date(session.closedAt) : new Date();
                const normalizedSessionBranchId = normalizeStockBranchId(session.branchId);
                
                const allPurchases = await db.purchaseHistory.toArray();
                const purchasesInWindow = allPurchases.filter(p => {
                    if (normalizeStockBranchId(p.branchId) !== normalizedSessionBranchId) return false;
                    const receivedTime = new Date(p.receivedDate);
                    return receivedTime >= startTime && receivedTime <= endTime;
                });

                if (purchasesBySession.length === 0) {
                    purchases = purchasesInWindow;
                } else {
                    const merged = new Map<string, typeof purchasesBySession[number]>();
                    const recordKey = (purchase: typeof purchasesBySession[number]) => {
                        const id = String((purchase as any).id ?? '').trim();
                        if (id) return `id:${id}`;
                        return `fallback:${String(purchase.productId ?? '').trim()}|${String(purchase.receivedDate ?? '').trim()}|${String(purchase.batchNumber ?? '').trim()}|${String(purchase.quantityReceived ?? '')}`;
                    };

                    purchasesBySession.forEach((purchase) => {
                        merged.set(recordKey(purchase), purchase);
                    });
                    purchasesInWindow.forEach((purchase) => {
                        const key = recordKey(purchase);
                        if (!merged.has(key)) {
                            merged.set(key, purchase);
                        }
                    });

                    purchases = Array.from(merged.values());
                }
            }

            const inventoryItems = await db.inventory.toArray();
            const inventoryNameById = new Map(inventoryItems.map((item) => [String(item.id), item.name]));

            return purchases.map((purchase) => {
                const fallbackName = purchase.productId ? inventoryNameById.get(String(purchase.productId)) : undefined;
                const resolvedName = isMeaningfulProductName(purchase.productName)
                    ? String(purchase.productName).trim()
                    : (fallbackName || 'Unknown Item');

                return {
                    ...purchase,
                    productName: resolvedName,
                };
            });
        },
        [session.id, session.startedAt, session.closedAt, session.branchId]
    ) || [];

    const sessionWaste = useLiveQuery(
        async () => {
            const wasteBySession = await db.wasteLog
                .where('sessionId')
                .equals(session.id)
                .toArray();
            
            let wasteRecords = wasteBySession;

            if (session.startedAt) {
                const startTime = new Date(session.startedAt);
                const endTime = session.closedAt ? new Date(session.closedAt) : new Date();
                const normalizedSessionBranchId = normalizeStockBranchId(session.branchId);
                
                const allWaste = await db.wasteLog.toArray();
                const wasteInWindow = allWaste.filter(w => {
                    if (normalizeStockBranchId(w.branchId) !== normalizedSessionBranchId) return false;
                    const recordedTime = new Date(w.recordedAt);
                    return recordedTime >= startTime && recordedTime <= endTime;
                });

                if (wasteBySession.length === 0) {
                    wasteRecords = wasteInWindow;
                } else {
                    const merged = new Map<string, typeof wasteBySession[number]>();
                    const recordKey = (waste: typeof wasteBySession[number]) => {
                        const id = String((waste as any).id ?? '').trim();
                        if (id) return `id:${id}`;
                        return `fallback:${String(waste.itemId ?? '').trim()}|${String(waste.recordedAt ?? '').trim()}|${String(waste.quantity ?? '')}`;
                    };

                    wasteBySession.forEach((waste) => {
                        merged.set(recordKey(waste), waste);
                    });
                    wasteInWindow.forEach((waste) => {
                        const key = recordKey(waste);
                        if (!merged.has(key)) {
                            merged.set(key, waste);
                        }
                    });

                    wasteRecords = Array.from(merged.values());
                }
            }

            const inventoryItems = await db.inventory.toArray();
            const inventoryNameById = new Map(inventoryItems.map((item) => [String(item.id), item.name]));

            return wasteRecords.map((waste) => {
                const fallbackName = waste.itemId ? inventoryNameById.get(String(waste.itemId)) : undefined;
                const resolvedName = isMeaningfulProductName(waste.itemName)
                    ? String(waste.itemName).trim()
                    : (fallbackName || 'Unknown Item');

                return {
                    ...waste,
                    itemName: resolvedName,
                };
            });
        },
        [session.id, session.startedAt, session.closedAt, session.branchId]
    ) || [];

    const productIdentity = useMemo(() => {
        const nameToId = new Map<string, string>();
        const idToName = new Map<string, string>();

        const registerIdentity = (itemId?: string | number | null, name?: string | null) => {
            const normalizedItemId = String(itemId ?? '').trim();
            const trimmedName = String(name ?? '').trim();
            if (!normalizedItemId || !isMeaningfulProductName(trimmedName)) return;

            const normalizedName = normalizeProductName(trimmedName);
            nameToId.set(normalizedName, normalizedItemId);

            if (!idToName.has(normalizedItemId)) {
                idToName.set(normalizedItemId, trimmedName);
            }
        };

        (session.openingStock || []).forEach((item: any) => registerIdentity(item.itemId, item.name));
        sessionPurchases.forEach((purchase) => registerIdentity(purchase.productId, purchase.productName));
        sessionWaste.forEach((waste) => registerIdentity(waste.itemId, waste.itemName));
        sessionOrders.forEach((order) => {
            order.items?.forEach((item) => registerIdentity(getOrderItemInventoryId(item), item.name));
        });

        return { nameToId, idToName };
    }, [session.openingStock, sessionOrders, sessionPurchases, sessionWaste]);

    const productSalesData = useMemo(() => {
        const productMap = new Map<string, { key: string; name: string; quantity: number; totalCash: number }>();

        const activeOrders = sessionOrders.filter(order => 
            order.status !== 'Voided' && order.status !== 'Cancelled'
        );

        activeOrders.forEach(order => {
            order.items?.forEach(item => {
                const itemInventoryId = getOrderItemInventoryId(item);
                const key = resolveCanonicalProductKey(itemInventoryId, item.name, productIdentity.nameToId);
                if (!key) return;

                if (!productMap.has(key)) {
                    productMap.set(key, {
                        key,
                        name: resolveDisplayProductName(itemInventoryId, item.name, productIdentity.idToName),
                        quantity: 0,
                        totalCash: 0,
                    });
                }
                const product = productMap.get(key)!;
                const resolvedName = resolveDisplayProductName(itemInventoryId, item.name, productIdentity.idToName);
                if (!product.name || product.name === 'Unknown Item') {
                    product.name = resolvedName;
                }

                const quantity = parseFloat(String(item.quantity ?? 0));
                const safeQuantity = Number.isFinite(quantity) ? quantity : 0;
                const unitPrice = parseFloat(String(item.price ?? 0));
                const safeUnitPrice = Number.isFinite(unitPrice) ? unitPrice : 0;
                const lineTotal = parseFloat(String(item.total ?? safeUnitPrice * safeQuantity));
                const safeLineTotal = Number.isFinite(lineTotal) ? lineTotal : safeUnitPrice * safeQuantity;

                product.quantity += safeQuantity;
                product.totalCash += safeLineTotal;
            });
        });

        return Array.from(productMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [sessionOrders, productIdentity]);

    const purchasesData = useMemo(() => {
        const purchaseMap = new Map<string, { 
            key: string;
            name: string; 
            quantity: number; 
            totalCost: number; 
            unitCost: number;
            supplier: string;
            batchNumber?: string;
            expiryDate?: string;
        }>();

        sessionPurchases.forEach(purchase => {
            const key = resolveCanonicalProductKey(purchase.productId, purchase.productName, productIdentity.nameToId);
            if (!key) return;

            if (!purchaseMap.has(key)) {
                purchaseMap.set(key, {
                    key,
                    name: resolveDisplayProductName(purchase.productId, purchase.productName, productIdentity.idToName),
                    quantity: 0,
                    totalCost: 0,
                    unitCost: purchase.costPerUnit,
                    supplier: purchase.supplierName || 'Unknown Supplier',
                    batchNumber: purchase.batchNumber,
                    expiryDate: purchase.expiryDate,
                });
            }
            const item = purchaseMap.get(key)!;
            const resolvedName = resolveDisplayProductName(purchase.productId, purchase.productName, productIdentity.idToName);
            if (!item.name || item.name === 'Unknown Item') {
                item.name = resolvedName;
            }
            item.quantity += purchase.quantityReceived;
            item.totalCost += purchase.totalCost;
        });

        return Array.from(purchaseMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [sessionPurchases, productIdentity]);

    const comprehensiveStockData = useMemo(() => {
        const productMap = new Map<string, {
            key: string;
            name: string;
            opening: number;
            received: number;
            sold: number;
            waste: number;
        }>();

        const ensureProduct = (key: string, name?: string) => {
            if (!productMap.has(key)) {
                productMap.set(key, {
                    key,
                    name: name || 'Unknown Item',
                    opening: 0,
                    received: 0,
                    sold: 0,
                    waste: 0,
                });
            }
            const existing = productMap.get(key)!;
            if (name && (!existing.name || existing.name === 'Unknown Item')) {
                existing.name = name;
            }
            return existing;
        };

        const activeOrders = sessionOrders.filter(order => 
            order.status !== 'Voided' && order.status !== 'Cancelled'
        );

        (session.openingStock || []).forEach((item: any) => {
            const key = resolveCanonicalProductKey(item.itemId, item.name, productIdentity.nameToId);
            if (!key) return;
            const resolvedName = resolveDisplayProductName(item.itemId, item.name, productIdentity.idToName);
            const row = ensureProduct(key, resolvedName);
            row.opening += parseFloat(String(item.quantity || 0));
        });

        sessionPurchases.forEach((purchase) => {
            const key = resolveCanonicalProductKey(purchase.productId, purchase.productName, productIdentity.nameToId);
            if (!key) return;
            const resolvedName = resolveDisplayProductName(purchase.productId, purchase.productName, productIdentity.idToName);
            const row = ensureProduct(key, resolvedName);
            row.received += parseFloat(String(purchase.quantityReceived || 0));
        });

        activeOrders.forEach((order) => {
            order.items?.forEach((item) => {
                const itemInventoryId = getOrderItemInventoryId(item);
                const key = resolveCanonicalProductKey(itemInventoryId, item.name, productIdentity.nameToId);
                if (!key) return;
                const resolvedName = resolveDisplayProductName(itemInventoryId, item.name, productIdentity.idToName);
                const row = ensureProduct(key, resolvedName);
                row.sold += parseFloat(String(item.quantity || 0));
            });
        });

        sessionWaste.forEach((waste) => {
            const key = resolveCanonicalProductKey(waste.itemId, waste.itemName, productIdentity.nameToId);
            if (!key) return;
            const resolvedName = resolveDisplayProductName(waste.itemId, waste.itemName, productIdentity.idToName);
            const row = ensureProduct(key, resolvedName);
            row.waste += parseFloat(String(waste.quantity || 0));
        });

        return Array.from(productMap.values())
            .map((row) => ({
                key: row.key,
                name: row.name,
                opening: row.opening,
                received: row.received,
                sold: row.sold,
                waste: row.waste,
                remaining: Math.max(0, row.opening + row.received - row.sold - row.waste),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [session.openingStock, sessionOrders, sessionPurchases, sessionWaste, productIdentity]);

    return (
        <Card>
            <CardHeader>
                <CardTitle>Stock Report</CardTitle>
                <CardDescription>Product sales quantities, cash value, and remaining stock</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div>
                    <h3 className="font-semibold mb-3">Products Sold</h3>
                    {productSalesData.length > 0 ? (
                        <ScrollArea className="h-64 w-full rounded-md border">
                            <Table className="min-w-[640px]">
                                <TableHeader className="sticky top-0 bg-muted">
                                    <TableRow>
                                        <TableHead>Product</TableHead>
                                        <TableHead className="text-right">Quantity Sold</TableHead>
                                        <TableHead className="text-right">Total Cash</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {productSalesData.map((product) => (
                                        <TableRow key={product.key}>
                                            <TableCell className="font-medium">{product.name}</TableCell>
                                            <TableCell className="text-right">
                                                {Math.abs(product.quantity - Math.round(product.quantity)) < 1e-9
                                                    ? product.quantity.toFixed(2)
                                                    : product.quantity.toFixed(3)}
                                            </TableCell>
                                            <TableCell className="text-right font-semibold">{formatCurrency(product.totalCash)}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    ) : (
                        <p className="text-muted-foreground text-center py-4">No products sold in this session.</p>
                    )}
                </div>

                <Separator />

                <div>
                    <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        Stock Received in Session
                    </h3>
                    {purchasesData.length > 0 ? (
                        <ScrollArea className="h-64 w-full rounded-md border">
                            <Table className="min-w-[980px]">
                                <TableHeader className="sticky top-0 bg-muted">
                                    <TableRow>
                                        <TableHead>Product</TableHead>
                                        <TableHead className="text-right">Quantity</TableHead>
                                        <TableHead className="text-right">Unit Cost</TableHead>
                                        <TableHead className="text-right">Total Cost</TableHead>
                                        <TableHead>Supplier</TableHead>
                                        <TableHead>Batch #</TableHead>
                                        <TableHead>Expiry Date</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {purchasesData.map((purchase) => (
                                        <TableRow key={purchase.key}>
                                            <TableCell className="font-medium">{purchase.name}</TableCell>
                                            <TableCell className="text-right text-blue-600 font-medium">{purchase.quantity.toFixed(2)}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(purchase.unitCost)}</TableCell>
                                            <TableCell className="text-right font-semibold">{formatCurrency(purchase.totalCost)}</TableCell>
                                            <TableCell className="text-sm">{purchase.supplier}</TableCell>
                                            <TableCell className="text-sm">{purchase.batchNumber || '-'}</TableCell>
                                            <TableCell className="text-sm">{purchase.expiryDate ? format(new Date(purchase.expiryDate), 'MMM dd, yyyy') : '-'}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    ) : (
                        <p className="text-muted-foreground text-center py-4">No stock received in this session.</p>
                    )}
                </div>

                <Separator />

                <div>
                    <h3 className="font-semibold mb-3 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                        Waste Recorded in Session
                    </h3>
                    {sessionWaste.length > 0 ? (
                        <ScrollArea className="h-64 w-full rounded-md border">
                            <Table className="min-w-[980px]">
                                <TableHeader className="sticky top-0 bg-muted">
                                    <TableRow>
                                        <TableHead>Product</TableHead>
                                        <TableHead className="text-right">Quantity</TableHead>
                                        <TableHead>Unit</TableHead>
                                        <TableHead className="text-right">Cost</TableHead>
                                        <TableHead>Reason</TableHead>
                                        <TableHead>Recorded By</TableHead>
                                        <TableHead>Notes</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {sessionWaste.map((waste) => (
                                        <TableRow key={waste.id}>
                                            <TableCell className="font-medium">{waste.itemName}</TableCell>
                                            <TableCell className="text-right text-red-600 font-medium">{waste.quantity.toFixed(2)}</TableCell>
                                            <TableCell className="text-sm">{waste.unit || '-'}</TableCell>
                                            <TableCell className="text-right">{formatCurrency(waste.cost)}</TableCell>
                                            <TableCell className="text-sm">{waste.reason}</TableCell>
                                            <TableCell className="text-sm">{waste.recordedBy}</TableCell>
                                            <TableCell className="text-sm">{waste.notes || '-'}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    ) : (
                        <p className="text-muted-foreground text-center py-4">No waste recorded in this session.</p>
                    )}
                </div>

                <Separator />

                <div>
                    <h3 className="font-semibold mb-3">Complete Stock Tracking (Opening + Received - Sold - Waste = Closing)</h3>
                    {comprehensiveStockData.length > 0 ? (
                        <ScrollArea className="h-64 w-full rounded-md border">
                            <Table className="min-w-[760px]">
                                <TableHeader className="sticky top-0 bg-muted">
                                    <TableRow>
                                        <TableHead>Item</TableHead>
                                        <TableHead className="text-right">Opening</TableHead>
                                        <TableHead className="text-right">Received</TableHead>
                                        <TableHead className="text-right">Sold</TableHead>
                                        <TableHead className="text-right">Waste</TableHead>
                                        <TableHead className="text-right">Closing</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {comprehensiveStockData.map((item) => (
                                        <TableRow key={item.key}>
                                            <TableCell className="font-medium">{item.name}</TableCell>
                                            <TableCell className="text-right">{item.opening}</TableCell>
                                            <TableCell className="text-right text-blue-600 font-medium">{item.received}</TableCell>
                                            <TableCell className="text-right text-red-600 font-medium">{item.sold}</TableCell>
                                            <TableCell className="text-right text-orange-600 font-medium">{item.waste}</TableCell>
                                            <TableCell className="text-right text-green-600 font-medium">{item.remaining}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </ScrollArea>
                    ) : (
                        <p className="text-muted-foreground text-center py-4">No stock data available for this session.</p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
};

export default function SessionDetailDialog({ session, isOpen, onOpenChange }: { session: Session; isOpen: boolean; onOpenChange: (open: boolean) => void; }) {
    const { format: formatCurrency } = useCurrency();
    
    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Session Details</DialogTitle>
                    <DialogDescription>
                        Summary for session started on {format(new Date(session.startedAt), 'PPpp')} by {session.userName}.
                        {session.pumpName && (
                            <span className="block text-xs text-muted-foreground">Pump: {session.pumpName}</span>
                        )}
                    </DialogDescription>
                </DialogHeader>
                <Tabs defaultValue="sales" className="flex-1 overflow-hidden flex flex-col">
                    <TabsList className="grid h-auto w-full grid-cols-1 sm:grid-cols-3">
                        <TabsTrigger value="sales" className="text-xs sm:text-sm">Sales Report</TabsTrigger>
                        <TabsTrigger value="z-report" className="text-xs sm:text-sm">Z Report</TabsTrigger>
                        <TabsTrigger value="stock" className="text-xs sm:text-sm">Stock Report</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="sales" className="flex-1 overflow-y-auto">
                        <SessionSalesListModal sessionId={session.id} />
                    </TabsContent>
                    
                    <TabsContent value="z-report" className="flex-1 overflow-y-auto">
                        <ZReportTabModal session={session} />
                    </TabsContent>
                    
                    <TabsContent value="stock" className="flex-1 overflow-y-auto">
                        <StockReportTabModal session={session} />
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
};
