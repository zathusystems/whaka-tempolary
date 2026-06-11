
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { syncSessionOrdersToLocalDb } from '@/lib/session-order-sync';
import {
  resolveSessionFinancialSummary,
  resolveSessionPaymentBreakdown,
} from '@/lib/session-financials';
import {
  buildZReportPrintHtml,
  calculateZReportSummary,
  isSessionClosedForZReport,
  SESSION_END_REPORT_TITLE,
} from '@/lib/z-report-print';
import {
  createInventoryProductCategoryResolver,
  getProductReportingCategoryMeta,
  summarizeProductCategoryRows,
  summarizeSessionOrderProductMix,
  toProductCategorySummaryRows,
  type ProductReportingCategory,
} from '@/lib/session-product-report';
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

const MobileInfoRow = ({
  label,
  value,
  valueClassName = '',
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) => (
  <div className="flex items-start justify-between gap-3 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <div className={`text-right ${valueClassName}`}>{value}</div>
  </div>
);

const formatQuantityDisplay = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0.00';
  }

  if (Math.abs(value - Math.round(value)) < 1e-9) {
    return value.toFixed(2);
  }

  return value.toFixed(3);
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
          {orderedSessionSales.length > 0 ? (
            <>
              <div className="space-y-3 md:hidden">
                {orderedSessionSales.map((order) => {
                  const buyerDetails = resolveBuyerDetails(order);
                  const buyerName = buyerDetails.name || 'Walk-in';
                  const eisStatus = resolveEisStatus(order);
                  const isEisPending = eisStatus === 'PENDING' || (!eisStatus && Boolean((order as any)?._dirty));
                  const createdAt = new Date(order.createdAt);
                  const orderTimeLabel = Number.isNaN(createdAt.getTime()) ? '-' : format(createdAt, 'HH:mm:ss');

                  return (
                    <button
                      key={order.id}
                      type="button"
                      className={`w-full rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/40 ${order.status === 'Voided' ? 'opacity-60' : ''}`}
                      onClick={() => setSelectedOrder(order)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">Order #{order.orderNumber}</p>
                          <p className="text-xs text-muted-foreground">{orderTimeLabel}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Total</p>
                          <p className="font-semibold">{formatCurrency(order.total)}</p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant={orderStatusBadge[order.status]}>
                          {order.status}
                        </Badge>
                        {isEisPending && (
                          <Badge variant="outline" className="border-amber-300 text-amber-700">
                            Fiscal Pending
                          </Badge>
                        )}
                      </div>

                      <div className="mt-3 space-y-2">
                        <MobileInfoRow
                          label="Buyer"
                          value={
                            <div className="space-y-0.5 text-right">
                              <div className="font-medium">{buyerName}</div>
                              {buyerDetails.phone && (
                                <div className="text-xs text-muted-foreground">{buyerDetails.phone}</div>
                              )}
                            </div>
                          }
                        />
                        <MobileInfoRow
                          label="Items"
                          value={`${order.items.length} item${order.items.length !== 1 ? 's' : ''}`}
                        />
                        <MobileInfoRow label="Payment" value={order.paymentMethod} />
                        <MobileInfoRow label="Subtotal" value={formatCurrency(order.subtotal)} />
                        <MobileInfoRow label="Tax" value={formatCurrency(order.tax)} />
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="hidden md:block">
                <Table className="min-w-[920px]">
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
                    {orderedSessionSales.map((order) => {
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
                                  Fiscal Pending
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(order.subtotal)}</TableCell>
                          <TableCell className="text-right text-sm">{formatCurrency(order.tax)}</TableCell>
                          <TableCell className="text-right font-medium text-sm">{formatCurrency(order.total)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
              No sales recorded in this session.
            </div>
          )}
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
    const sessionInventory = useLiveQuery(
        async () => {
            const normalizedSessionBranchId = normalizeStockBranchId(session.branchId);
            const inventoryItems = await db.inventory.toArray();
            return inventoryItems.filter(
                (item) => normalizeStockBranchId(item.branchId) === normalizedSessionBranchId
            );
        },
        [session.branchId]
    ) || [];

    const { paymentBreakdown, financialSummary, eisSummary } = useMemo(
        () => calculateZReportSummary(sessionOrders as any),
        [sessionOrders]
    );
    const productMixSummary = useMemo(
        () => summarizeSessionOrderProductMix(sessionOrders as any, sessionInventory as any),
        [sessionInventory, sessionOrders]
    );
    const productMixRows = useMemo(
        () => toProductCategorySummaryRows(productMixSummary),
        [productMixSummary]
    );
    const resolvedFinancialSummary = useMemo(
        () => resolveSessionFinancialSummary(session, financialSummary),
        [financialSummary, session]
    );
    const resolvedPaymentBreakdown = useMemo(
        () => resolveSessionPaymentBreakdown(session, paymentBreakdown, financialSummary),
        [financialSummary, paymentBreakdown, session]
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
            let reportOrders = sessionOrders;
            try {
                const syncedOrders = await syncSessionOrdersToLocalDb({
                    sessionId: session.id,
                    branchId: String(session.branchId || ''),
                });
                if (syncedOrders.length > 0) {
                    reportOrders = syncedOrders;
                }
            } catch (syncError) {
                console.warn('[Session Detail] Could not refresh session orders before printing report:', syncError);
            }

            const reportSummary = calculateZReportSummary(reportOrders as any);
            const reportFinancialSummary = resolveSessionFinancialSummary(
                session,
                reportSummary.financialSummary
            );
            const reportPaymentBreakdown = resolveSessionPaymentBreakdown(
                session,
                reportSummary.paymentBreakdown,
                reportSummary.financialSummary
            );
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
                    description: `Please configure a default printer before printing the ${SESSION_END_REPORT_TITLE.toLowerCase()}.`,
                });
                return;
            }

            const selectedPaperSize: '80mm' | '58mm' =
                printerSettings.receiptPaperWidth === '58mm' ? '58mm' : '80mm';

            const htmlContent = buildZReportPrintHtml({
                session,
                paymentBreakdown: reportPaymentBreakdown,
                financialSummary: reportFinancialSummary,
                eisSummary: reportSummary.eisSummary,
                productMixSummary,
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
                    description: `Could not print the ${SESSION_END_REPORT_TITLE.toLowerCase()}. Check the printer connection and try again.`,
                });
                return;
            }

            toast({
                title: `${SESSION_END_REPORT_TITLE} Printed`,
                description: `Sent to ${defaultPrinter.name}`,
            });
        } catch (error) {
            console.error('Error printing session end report:', error);
            toast({
                variant: 'destructive',
                title: 'Print Error',
                description:
                    error instanceof Error
                        ? error.message
                        : `Unexpected error while printing the ${SESSION_END_REPORT_TITLE.toLowerCase()}.`,
            });
        } finally {
            setIsPrintingZReport(false);
        }
    }, [formatCurrency, isSessionClosed, productMixSummary, session, sessionOrders]);

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <CardTitle>{SESSION_END_REPORT_TITLE}</CardTitle>
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
                        {isPrintingZReport ? 'Printing...' : `Print ${SESSION_END_REPORT_TITLE}`}
                    </Button>
                </div>
                {!isSessionClosed && (
                    <p className="text-xs text-muted-foreground">
                        Close this session first to print the {SESSION_END_REPORT_TITLE.toLowerCase()}.
                    </p>
                )}
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Sales & Tax Summary</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Orders:</span>
                                <span className="font-semibold">{resolvedFinancialSummary.orderCount}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Revenue:</span>
                                <span>{formatCurrency(resolvedFinancialSummary.netSales)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Tax Collected:</span>
                                <span>{formatCurrency(resolvedFinancialSummary.totalTax)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Total Sales:</span>
                                <span>{formatCurrency(resolvedFinancialSummary.grossSales)}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Cash Sales:</span>
                                <span>{formatCurrency(resolvedPaymentBreakdown.cash)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Card Sales:</span>
                                <span>{formatCurrency(resolvedPaymentBreakdown.card)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Mobile Money:</span>
                                <span>{formatCurrency(resolvedPaymentBreakdown.mobileMoney)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">On Account:</span>
                                <span>{formatCurrency(resolvedPaymentBreakdown.onAccount)}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Other:</span>
                                <span>{formatCurrency(resolvedPaymentBreakdown.other)}</span>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">Product Mix</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            {productMixRows.map((row) => {
                                const meta = getProductReportingCategoryMeta(row.category);
                                return (
                                    <div key={row.category} className="rounded-md border border-dashed p-3">
                                        <div className="flex items-center justify-between gap-3">
                                            <span className="text-muted-foreground">{meta.label}</span>
                                            <Badge variant="outline" className={meta.badgeClassName}>
                                                {row.itemCount} item{row.itemCount === 1 ? '' : 's'}
                                            </Badge>
                                        </div>
                                        <div className="mt-2 flex items-center justify-between gap-3">
                                            <span className="text-xs text-muted-foreground">
                                                {formatQuantityDisplay(row.quantity)} qty
                                            </span>
                                            <span className="font-semibold">{formatCurrency(row.amount)}</span>
                                        </div>
                                    </div>
                                );
                            })}
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
                                <span className="text-green-600">{formatCurrency(resolvedPaymentBreakdown.cash)}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between font-semibold">
                                <span>Expected in Drawer:</span>
                                <span>{formatCurrency((session.openingFloat || 0) + resolvedPaymentBreakdown.cash)}</span>
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
                                <span className="text-muted-foreground">Fiscal No Pending:</span>
                                <span>{eisSummary.pendingFiscalNumber}</span>
                            </div>
                            <Separator />
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Receipt Pending:</span>
                                <span>{eisSummary.eisStatusCounts.pending}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Fiscal Submitted:</span>
                                <span>{eisSummary.eisStatusCounts.submitted}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Fiscal Accepted:</span>
                                <span className="text-green-600">{eisSummary.eisStatusCounts.accepted}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Fiscal Rejected:</span>
                                <span className="text-red-600">{eisSummary.eisStatusCounts.rejected}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Fiscal Unknown:</span>
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
    const sessionInventory = useLiveQuery(
        async () => {
            const normalizedSessionBranchId = normalizeStockBranchId(session.branchId);
            const inventoryItems = await db.inventory.toArray();
            return inventoryItems.filter(
                (item) => normalizeStockBranchId(item.branchId) === normalizedSessionBranchId
            );
        },
        [session.branchId]
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

    const resolveProductCategory = useMemo(
        () => createInventoryProductCategoryResolver(sessionInventory as any),
        [sessionInventory]
    );

    const renderProductCategoryBadge = useCallback((category: ProductReportingCategory) => {
        const meta = getProductReportingCategoryMeta(category);
        return (
            <Badge variant="outline" className={meta.badgeClassName}>
                {meta.shortLabel}
            </Badge>
        );
    }, []);

    const productSalesData = useMemo(() => {
        const productMap = new Map<string, {
            key: string;
            name: string;
            quantity: number;
            totalCash: number;
            category: ProductReportingCategory;
        }>();

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
                        category: resolveProductCategory({
                            inventoryItemId: itemInventoryId,
                            name: item.name,
                        }),
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
    }, [productIdentity, resolveProductCategory, sessionOrders]);

    const purchasesData = useMemo(() => {
        const purchaseMap = new Map<string, { 
            key: string;
            name: string; 
            quantity: number; 
            totalCost: number; 
            unitCost: number;
            vatAmount: number;
            vatMethod: 'inclusive' | 'exclusive' | 'mixed';
            supplier: string;
            category: ProductReportingCategory;
            batchNumber?: string;
            expiryDate?: string;
        }>();

        const normalizeMethod = (value: unknown): 'inclusive' | 'exclusive' => {
            return value === 'inclusive' ? 'inclusive' : 'exclusive';
        };

        const resolveVatAmount = (purchase: any, method: 'inclusive' | 'exclusive'): number => {
            const taxRate = Number(purchase.taxRate);
            const base = Number(purchase.totalCost || 0);
            if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(taxRate) || taxRate <= 0) {
                return typeof purchase.taxAmount === 'number' && Number.isFinite(purchase.taxAmount)
                    ? purchase.taxAmount
                    : 0;
            }
            if (method === 'inclusive') {
                return base - base / (1 + taxRate / 100);
            }
            return base * (taxRate / 100);
        };

        sessionPurchases.forEach(purchase => {
            const key = resolveCanonicalProductKey(purchase.productId, purchase.productName, productIdentity.nameToId);
            if (!key) return;

            const method = normalizeMethod(purchase.taxCalculationMethod);
            const vatAmount = resolveVatAmount(purchase, method);

            if (!purchaseMap.has(key)) {
                purchaseMap.set(key, {
                    key,
                    name: resolveDisplayProductName(purchase.productId, purchase.productName, productIdentity.idToName),
                    quantity: 0,
                    totalCost: 0,
                    unitCost: purchase.costPerUnit,
                    vatAmount: 0,
                    vatMethod: method,
                    supplier: purchase.supplierName || 'Unknown Supplier',
                    category: resolveProductCategory({
                        inventoryItemId: purchase.productId,
                        name: purchase.productName,
                    }),
                    batchNumber: purchase.batchNumber,
                    expiryDate: purchase.expiryDate,
                });
            }
            const item = purchaseMap.get(key)!;
            const resolvedName = resolveDisplayProductName(purchase.productId, purchase.productName, productIdentity.idToName);
            if (!item.name || item.name === 'Unknown Item') {
                item.name = resolvedName;
            }
            if (item.vatMethod !== method) {
                item.vatMethod = 'mixed';
            }
            item.quantity += purchase.quantityReceived;
            item.totalCost += purchase.totalCost;
            item.vatAmount += vatAmount;
        });

        return Array.from(purchaseMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    }, [productIdentity, resolveProductCategory, sessionPurchases]);

    const comprehensiveStockData = useMemo(() => {
        const productMap = new Map<string, {
            key: string;
            name: string;
            category: ProductReportingCategory;
            opening: number;
            received: number;
            sold: number;
            waste: number;
        }>();

        const ensureProduct = (key: string, category: ProductReportingCategory, name?: string) => {
            if (!productMap.has(key)) {
                productMap.set(key, {
                    key,
                    name: name || 'Unknown Item',
                    category,
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
            const row = ensureProduct(
                key,
                resolveProductCategory({ inventoryItemId: item.itemId, name: item.name }),
                resolvedName
            );
            row.opening += parseFloat(String(item.quantity || 0));
        });

        sessionPurchases.forEach((purchase) => {
            const key = resolveCanonicalProductKey(purchase.productId, purchase.productName, productIdentity.nameToId);
            if (!key) return;
            const resolvedName = resolveDisplayProductName(purchase.productId, purchase.productName, productIdentity.idToName);
            const row = ensureProduct(
                key,
                resolveProductCategory({
                    inventoryItemId: purchase.productId,
                    name: purchase.productName,
                }),
                resolvedName
            );
            row.received += parseFloat(String(purchase.quantityReceived || 0));
        });

        activeOrders.forEach((order) => {
            order.items?.forEach((item) => {
                const itemInventoryId = getOrderItemInventoryId(item);
                const key = resolveCanonicalProductKey(itemInventoryId, item.name, productIdentity.nameToId);
                if (!key) return;
                const resolvedName = resolveDisplayProductName(itemInventoryId, item.name, productIdentity.idToName);
                const row = ensureProduct(
                    key,
                    resolveProductCategory({ inventoryItemId: itemInventoryId, name: item.name }),
                    resolvedName
                );
                row.sold += parseFloat(String(item.quantity || 0));
            });
        });

        sessionWaste.forEach((waste) => {
            const key = resolveCanonicalProductKey(waste.itemId, waste.itemName, productIdentity.nameToId);
            if (!key) return;
            const resolvedName = resolveDisplayProductName(waste.itemId, waste.itemName, productIdentity.idToName);
            const row = ensureProduct(
                key,
                resolveProductCategory({ inventoryItemId: waste.itemId, name: waste.itemName }),
                resolvedName
            );
            row.waste += parseFloat(String(waste.quantity || 0));
        });

        return Array.from(productMap.values())
            .map((row) => ({
                key: row.key,
                name: row.name,
                category: row.category,
                opening: row.opening,
                received: row.received,
                sold: row.sold,
                waste: row.waste,
                remaining: Math.max(0, row.opening + row.received - row.sold - row.waste),
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [productIdentity, resolveProductCategory, session.openingStock, sessionOrders, sessionPurchases, sessionWaste]);

    const soldCategorySummaryRows = useMemo(
        () =>
            toProductCategorySummaryRows(
                summarizeProductCategoryRows(
                    productSalesData.map((product) => ({
                        category: product.category,
                        key: product.key,
                        quantity: product.quantity,
                        amount: product.totalCash,
                    }))
                )
            ),
        [productSalesData]
    );

    const receivedCategorySummaryRows = useMemo(
        () =>
            toProductCategorySummaryRows(
                summarizeProductCategoryRows(
                    purchasesData.map((purchase) => ({
                        category: purchase.category,
                        key: purchase.key,
                        quantity: purchase.quantity,
                        amount: purchase.totalCost,
                    }))
                )
            ),
        [purchasesData]
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle>Stock Report</CardTitle>
                <CardDescription>Product sales quantities, cash value, and remaining stock</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div>
                    <h3 className="font-semibold mb-3">Product Type Summary</h3>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                        {soldCategorySummaryRows.map((row) => (
                            <div key={row.category} className="rounded-lg border bg-card p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <p className="font-medium">{row.label}</p>
                                    {renderProductCategoryBadge(row.category)}
                                </div>
                                <div className="mt-3 space-y-2 text-sm">
                                    <MobileInfoRow
                                        label="Sold Qty"
                                        value={formatQuantityDisplay(row.quantity)}
                                    />
                                    <MobileInfoRow
                                        label="Sales Value"
                                        value={formatCurrency(row.amount)}
                                        valueClassName="font-medium"
                                    />
                                    <MobileInfoRow
                                        label="Received Qty"
                                        value={formatQuantityDisplay(
                                            receivedCategorySummaryRows.find(
                                                (entry) => entry.category === row.category
                                            )?.quantity ?? 0
                                        )}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <Separator />

                <div>
                    <h3 className="font-semibold mb-3">Products Sold</h3>
                    {productSalesData.length > 0 ? (
                        <>
                            <div className="space-y-3 md:hidden">
                                {productSalesData.map((product) => (
                                    <div key={product.key} className="rounded-lg border bg-card p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <p className="font-medium">{product.name}</p>
                                            <p className="font-semibold">{formatCurrency(product.totalCash)}</p>
                                        </div>
                                        <div className="mt-3">
                                            <MobileInfoRow
                                                label="Type"
                                                value={renderProductCategoryBadge(product.category)}
                                            />
                                            <MobileInfoRow
                                                label="Quantity sold"
                                                value={formatQuantityDisplay(product.quantity)}
                                                valueClassName="font-medium"
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="hidden md:block">
                                <ScrollArea className="h-64 w-full rounded-md border">
                                    <Table className="min-w-[640px]">
                                        <TableHeader className="sticky top-0 bg-muted">
                                            <TableRow>
                                                <TableHead>Product</TableHead>
                                                <TableHead>Type</TableHead>
                                                <TableHead className="text-right">Quantity Sold</TableHead>
                                                <TableHead className="text-right">Total Cash</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {productSalesData.map((product) => (
                                                <TableRow key={product.key}>
                                                    <TableCell className="font-medium">{product.name}</TableCell>
                                                    <TableCell>{renderProductCategoryBadge(product.category)}</TableCell>
                                                    <TableCell className="text-right">
                                                        {formatQuantityDisplay(product.quantity)}
                                                    </TableCell>
                                                    <TableCell className="text-right font-semibold">{formatCurrency(product.totalCash)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </ScrollArea>
                            </div>
                        </>
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
                        <>
                            <div className="space-y-3 md:hidden">
                                {purchasesData.map((purchase) => (
                                    <div key={purchase.key} className="rounded-lg border bg-card p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <p className="font-medium">{purchase.name}</p>
                                            <p className="font-semibold">{formatCurrency(purchase.totalCost)}</p>
                                        </div>
                                        <div className="mt-3 space-y-2">
                                            <MobileInfoRow
                                                label="Type"
                                                value={renderProductCategoryBadge(purchase.category)}
                                            />
                                            <MobileInfoRow
                                                label="Quantity"
                                                value={purchase.quantity.toFixed(2)}
                                                valueClassName="font-medium text-blue-600"
                                            />
                                            <MobileInfoRow label="Unit cost" value={formatCurrency(purchase.unitCost)} />
                                            <MobileInfoRow
                                                label="VAT"
                                                value={`${formatCurrency(purchase.vatAmount)} (${purchase.vatMethod === 'mixed' ? 'Mixed' : purchase.vatMethod === 'inclusive' ? 'Incl' : 'Excl'})`}
                                            />
                                            <MobileInfoRow label="Supplier" value={purchase.supplier} />
                                            <MobileInfoRow label="Batch" value={purchase.batchNumber || '-'} />
                                            <MobileInfoRow
                                                label="Expiry"
                                                value={purchase.expiryDate ? format(new Date(purchase.expiryDate), 'MMM dd, yyyy') : '-'}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="hidden md:block">
                                <ScrollArea className="h-64 w-full rounded-md border">
                                    <Table className="min-w-[980px]">
                                        <TableHeader className="sticky top-0 bg-muted">
                                            <TableRow>
                                                <TableHead>Product</TableHead>
                                                <TableHead>Type</TableHead>
                                                <TableHead className="text-right">Quantity</TableHead>
                                                <TableHead className="text-right">Unit Cost</TableHead>
                                                <TableHead className="text-right">Total Cost</TableHead>
                                                <TableHead className="text-right">VAT (Incl/Excl)</TableHead>
                                                <TableHead>Supplier</TableHead>
                                                <TableHead>Batch #</TableHead>
                                                <TableHead>Expiry Date</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {purchasesData.map((purchase) => (
                                                <TableRow key={purchase.key}>
                                                    <TableCell className="font-medium">{purchase.name}</TableCell>
                                                    <TableCell>{renderProductCategoryBadge(purchase.category)}</TableCell>
                                                    <TableCell className="text-right text-blue-600 font-medium">{purchase.quantity.toFixed(2)}</TableCell>
                                                    <TableCell className="text-right">{formatCurrency(purchase.unitCost)}</TableCell>
                                                    <TableCell className="text-right font-semibold">{formatCurrency(purchase.totalCost)}</TableCell>
                                                    <TableCell className="text-right">
                                                        {formatCurrency(purchase.vatAmount)} ({purchase.vatMethod === 'mixed' ? 'Mixed' : purchase.vatMethod === 'inclusive' ? 'Incl' : 'Excl'})
                                                    </TableCell>
                                                    <TableCell className="text-sm">{purchase.supplier}</TableCell>
                                                    <TableCell className="text-sm">{purchase.batchNumber || '-'}</TableCell>
                                                    <TableCell className="text-sm">{purchase.expiryDate ? format(new Date(purchase.expiryDate), 'MMM dd, yyyy') : '-'}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </ScrollArea>
                            </div>
                        </>
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
                        <>
                            <div className="space-y-3 md:hidden">
                                {sessionWaste.map((waste) => (
                                    <div key={waste.id} className="rounded-lg border bg-card p-4">
                                        <div className="flex items-start justify-between gap-3">
                                            <p className="font-medium">{waste.itemName}</p>
                                            <p className="font-semibold">{formatCurrency(waste.cost)}</p>
                                        </div>
                                        <div className="mt-3 space-y-2">
                                            <MobileInfoRow
                                                label="Quantity"
                                                value={`${waste.quantity.toFixed(2)} ${waste.unit || ''}`.trim() || '-'}
                                                valueClassName="font-medium text-red-600"
                                            />
                                            <MobileInfoRow label="Reason" value={waste.reason} />
                                            <MobileInfoRow label="Recorded by" value={waste.recordedBy} />
                                            <MobileInfoRow label="Notes" value={waste.notes || '-'} />
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="hidden md:block">
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
                            </div>
                        </>
                    ) : (
                        <p className="text-muted-foreground text-center py-4">No waste recorded in this session.</p>
                    )}
                </div>

                <Separator />

                <div>
                    <h3 className="font-semibold mb-3">Complete Stock Tracking (Opening + Received - Sold - Waste = Closing)</h3>
                    {comprehensiveStockData.length > 0 ? (
                        <>
                            <div className="space-y-3 md:hidden">
                                {comprehensiveStockData.map((item) => (
                                    <div key={item.key} className="rounded-lg border bg-card p-4">
                                        <p className="font-medium">{item.name}</p>
                                        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                                            <div className="rounded-md bg-muted/50 p-3">
                                                <p className="text-xs text-muted-foreground">Opening</p>
                                                <p className="font-medium">{item.opening}</p>
                                            </div>
                                            <div className="rounded-md bg-muted/50 p-3">
                                                <p className="text-xs text-muted-foreground">Received</p>
                                                <p className="font-medium text-blue-600">{item.received}</p>
                                            </div>
                                            <div className="rounded-md bg-muted/50 p-3">
                                                <p className="text-xs text-muted-foreground">Sold</p>
                                                <p className="font-medium text-red-600">{item.sold}</p>
                                            </div>
                                            <div className="rounded-md bg-muted/50 p-3">
                                                <p className="text-xs text-muted-foreground">Waste</p>
                                                <p className="font-medium text-orange-600">{item.waste}</p>
                                            </div>
                                            <div className="col-span-2 rounded-md bg-muted/50 p-3">
                                                <p className="text-xs text-muted-foreground">Closing</p>
                                                <p className="font-semibold text-green-600">{item.remaining}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="hidden md:block">
                                <ScrollArea className="h-64 w-full rounded-md border">
                                    <Table className="min-w-[760px]">
                                        <TableHeader className="sticky top-0 bg-muted">
                                            <TableRow>
                                                <TableHead>Item</TableHead>
                                                <TableHead>Type</TableHead>
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
                                                    <TableCell>{renderProductCategoryBadge(item.category)}</TableCell>
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
                            </div>
                        </>
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

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        void syncSessionOrdersToLocalDb({
            sessionId: session.id,
            branchId: String(session.branchId || ''),
        }).catch((error) => {
            console.warn('[Session Detail] Could not hydrate session orders for detail view:', error);
        });
    }, [isOpen, session.branchId, session.id]);
    
    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
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
                        <TabsTrigger value="session-end-report" className="text-xs sm:text-sm">{SESSION_END_REPORT_TITLE}</TabsTrigger>
                        <TabsTrigger value="stock" className="text-xs sm:text-sm">Stock Report</TabsTrigger>
                    </TabsList>
                    
                    <TabsContent value="sales" className="flex-1 overflow-y-auto">
                        <SessionSalesListModal sessionId={session.id} />
                    </TabsContent>
                    
                    <TabsContent value="session-end-report" className="flex-1 overflow-y-auto">
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
