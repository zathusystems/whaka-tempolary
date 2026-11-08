import React, { useState, useEffect } from 'react';
import type { DateRange } from 'react-day-picker';
import { endOfDay, format, startOfDay, subDays, startOfMonth } from 'date-fns';
import { Calendar as CalendarIcon, Loader2, MoreHorizontal } from 'lucide-react';

import { db, type Session } from '@/lib/db';
import { useCurrency } from '@/hooks/use-currency';
import { toast } from '@/hooks/use-toast';
import { authFetch } from '@/lib/auth-fetch';
import { useAuth } from '@/hooks/use-auth';
import { getSessionTotalSales } from '@/lib/session-financials';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import SessionDetailDialog from './session-detail-modal';

const LOCAL_STORAGE_KEYS = {
  ACTIVE_BRANCH: 'handypos-active-branch'
};

interface SessionHistoryModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  branchId?: string | null;
}

type HistoryOrder = {
  status?: string;
  total?: number | string;
  gross_amount?: number | string;
  grossAmount?: number | string;
  created_at?: string;
  createdAt?: string;
};

type HistorySession = Session & {
  orders?: HistoryOrder[];
  /** True when totals came from the server's date-aware summary endpoint. */
  serverSalesSummary?: boolean;
};

const INCLUDED_ORDER_STATUSES = new Set(['new', 'preparing', 'ready', 'completed']);

const getOrderDate = (order: HistoryOrder): Date | null => {
  const rawDate = order.created_at ?? order.createdAt;
  if (!rawDate) return null;
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getOrderGrossTotal = (order: HistoryOrder): number => {
  const value = Number(order.total ?? order.gross_amount ?? order.grossAmount ?? 0);
  return Number.isFinite(value) ? value : 0;
};

const isDateInRange = (value: Date | null, dateRange?: DateRange): boolean => {
  if (!dateRange?.from) return true;
  if (!value) return false;

  const from = startOfDay(dateRange.from).getTime();
  const to = endOfDay(dateRange.to ?? dateRange.from).getTime();
  const timestamp = value.getTime();
  return timestamp >= from && timestamp <= to;
};

const sessionHasSalesInRange = (session: HistorySession, dateRange?: DateRange): boolean => {
  if (!dateRange?.from) return true;

  const orders = Array.isArray(session.orders) ? session.orders : [];
  if (orders.length > 0) {
    return orders.some((order) =>
      INCLUDED_ORDER_STATUSES.has(String(order.status || '').toLowerCase()) &&
      isDateInRange(getOrderDate(order), dateRange)
    );
  }

  if (session.serverSalesSummary) {
    return true;
  }

  // Offline/local fallback records do not contain nested orders. In that
  // case, use the session start date so the history still remains usable.
  const sessionDate = session.startedAt || session.closedAt;
  return isDateInRange(sessionDate ? new Date(sessionDate) : null, dateRange);
};

const getSessionSalesInRange = (session: HistorySession, dateRange?: DateRange): number => {
  // The summary endpoint has already applied the selected order-date range
  // and calculated gross totals. Use that value directly instead of falling
  // back to the session payment totals, which are intentionally all-time.
  if (session.serverSalesSummary) {
    return Number.isFinite(Number(session.totalSales)) ? Number(session.totalSales) : 0;
  }

  const orders = Array.isArray(session.orders) ? session.orders : [];
  if (orders.length > 0) {
    const matchingOrders = orders.filter((order) =>
      INCLUDED_ORDER_STATUSES.has(String(order.status || '').toLowerCase()) &&
      isDateInRange(getOrderDate(order), dateRange)
    );

    // Session History and Reports now use the same gross order total. This
    // avoids comparing Reports' order totals with the session's net subtotal.
    if (matchingOrders.length > 0 || dateRange?.from) {
      return matchingOrders.reduce((sum, order) => sum + getOrderGrossTotal(order), 0);
    }
  }

  return getSessionTotalSales(session);
};

const normalizeBranchId = (value: string | null): string | null => {
  if (!value) return null;
  const branch = value.trim();
  if (!branch) return null;

  const normalized = branch.toLowerCase();
  if (['nan', 'null', 'none', 'undefined'].includes(normalized)) return null;

  const prefixedMatch = /^BRN-(\d+)$/i.exec(branch);
  if (prefixedMatch) return prefixedMatch[1];

  if (/^\d+$/.test(branch)) return branch;

  if (['main', 'main-branch', 'main_branch'].includes(normalized)) return 'main';

  // UUID branch IDs should be passed as-is.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(branch)) {
    return branch;
  }

  return null;
};

const mapBackendSessionToLocal = (session: any, fallbackBranchId: string | null): HistorySession => {
  const hasServerGrossTotal = session.total_gross_sales !== undefined && session.total_gross_sales !== null;

  return {
    id: String(session.id),
    branchId: String(session.branch || fallbackBranchId || ''),
    userId: String(session.user || ''),
    userName: session.user_name || session.user_email || `User ${session.user}`,
    userEmail: session.user_email || '',
    status: String(session.status).toLowerCase() === 'closed' ? 'closed' : 'active',
    pumpName: session.pump_name ?? session.pumpName ?? undefined,
    openingFloat: parseFloat(session.opening_float || 0),
    expectedCash: parseFloat(session.expected_cash || 0),
    actualCash: session.actual_cash !== null && session.actual_cash !== undefined ? parseFloat(session.actual_cash) : undefined,
    closingFloat: session.closing_float !== null && session.closing_float !== undefined ? parseFloat(session.closing_float) : undefined,
    difference: session.difference !== null && session.difference !== undefined ? parseFloat(session.difference) : undefined,
    // The history summary endpoint returns gross order totals, which are the
    // same figures used by Reports. Keep the old total_sales fallback for
    // older backends and offline records.
    totalSales: parseFloat((hasServerGrossTotal ? session.total_gross_sales : session.total_sales) || 0),
    totalCashSales: parseFloat(session.total_cash_sales || 0),
    totalCardSales: parseFloat(session.total_card_sales || 0),
    totalMobileMoneySales: parseFloat(session.total_mobile_money_sales || 0),
    totalOnAccountSales: parseFloat(session.total_on_account_sales || 0),
    totalOtherSales: parseFloat(session.total_other_sales || 0),
    totalTips: parseFloat(session.total_tips || 0),
    openingStock: session.opening_stock || [],
    closingStock: session.closing_stock || [],
    orders: Array.isArray(session.orders) ? session.orders : [],
    serverSalesSummary: hasServerGrossTotal,
    startedAt: session.started_at || session.startedAt,
    closedAt: session.closed_at || session.closedAt,
  };
};

const formatSessionDate = (value?: string) => {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '-';
  return format(dt, 'PP');
};

const hasPumpName = (session: Session) => {
  const pumpName = String(session.pumpName ?? '').trim();
  return pumpName !== '';
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

export default function SessionHistoryModal({ isOpen, onOpenChange, branchId = null }: SessionHistoryModalProps) {
    const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
    const [viewingSession, setViewingSession] = useState<Session | null>(null);
    const { format: formatCurrency } = useCurrency();
    const { user } = useAuth();
    const [closedSessions, setClosedSessions] = useState<HistorySession[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<'fuel' | 'nonFuel'>('nonFuel');
    const [dateRange, setDateRange] = useState<DateRange | undefined>();

    useEffect(() => {
        if (branchId) {
          setActiveBranchId(branchId);
          return;
        }
        const storedBranchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
        if (storedBranchId) setActiveBranchId(storedBranchId);
    }, [branchId, isOpen]);

    // Listen for branch changes only if branchId prop is not provided.
    useEffect(() => {
        if (branchId) return;

        const handleBranchChange = (e: Event) => {
            const customEvent = e as CustomEvent;
            const nextBranchId = customEvent.detail?.branchId;
            if (nextBranchId) {
                setActiveBranchId(nextBranchId);
                console.log('[Sessions History] Branch changed to:', nextBranchId);
            }
        };
        window.addEventListener('branchChanged', handleBranchChange);
        return () => window.removeEventListener('branchChanged', handleBranchChange);
    }, [branchId]);

    // Fetch closed sessions from backend with fallback to local DB
    useEffect(() => {
        if (!isOpen) return;

        let requestActive = true;

        const fetchClosedSessions = async () => {
            setIsLoading(true);
            try {
                const normalizedBranchId = normalizeBranchId(activeBranchId);
                const query = new URLSearchParams();
                if (normalizedBranchId) query.set('branch_id', normalizedBranchId);
                if (user?.businessId) query.set('business_id', String(user.businessId));
                query.set('summary', '1');

                // Ask the backend to aggregate only the selected sales period.
                // This avoids downloading every order just to filter it in the
                // browser and keeps sessions with sales in the range visible
                // even when their session started earlier.
                if (dateRange?.from) {
                  query.set('sales_from', startOfDay(dateRange.from).toISOString());
                  query.set('sales_to', endOfDay(dateRange.to ?? dateRange.from).toISOString());
                }

                const initialUrl = `/sessions/sessions/closed_list/?${query.toString()}`;

                console.log('[Sessions History] Fetching sessions from backend:', { activeBranchId, normalizedBranchId, initialUrl });

                const allSessions: any[] = [];
                try {
                    let nextUrl: string | null = initialUrl;
                    const visitedUrls = new Set<string>();

                    while (nextUrl) {
                      if (visitedUrls.has(nextUrl)) {
                        console.warn('[Sessions History] Detected duplicate pagination URL, stopping:', nextUrl);
                        break;
                      }
                      visitedUrls.add(nextUrl);

                      const response = await authFetch.fetch<any>(nextUrl);
                      if (Array.isArray(response)) {
                        allSessions.push(...response);
                        nextUrl = null;
                        continue;
                      }

                      if (response?.results && Array.isArray(response.results)) {
                        allSessions.push(...response.results);
                        nextUrl = typeof response.next === 'string' && response.next.length > 0
                          ? response.next
                          : null;
                        continue;
                      }

                      nextUrl = null;
                    }

                    const backendClosedSessions = allSessions
                      .filter((session) => String(session?.status || '').toLowerCase() === 'closed')
                      .map((session) => mapBackendSessionToLocal(session, activeBranchId))
                      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

                    console.log(
                      '[Sessions History] Loaded closed sessions from backend:',
                      backendClosedSessions.length,
                      'out of total sessions:',
                      allSessions.length
                    );

                    if (!requestActive) return;
                    setClosedSessions(backendClosedSessions);

                    // Do not make the visible history wait for local cache
                    // writes. Details hydrate their orders when opened.
                    void Promise.all(backendClosedSessions.map(async (session) => {
                      try {
                        // The server-summary marker is request-specific and
                        // must not leak into offline fallback calculations.
                        const {
                          orders: _orders,
                          serverSalesSummary: _serverSalesSummary,
                          ...sessionCacheRecord
                        } = session;
                        await db.sessions.put(sessionCacheRecord);
                      } catch (dbError) {
                        console.warn('[Sessions History] Error storing backend session in local DB:', dbError);
                      }
                    }));
                } catch (backendError) {
                    console.warn('[Sessions History] Backend fetch failed, falling back to local DB:', backendError);

                    const localSessions = (await db.sessions.toArray())
                      .filter((session) =>
                        session.status === 'closed' &&
                        (!activeBranchId || normalizeBranchId(String(session.branchId)) === normalizeBranchId(activeBranchId))
                      )
                      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

                    const localOrders = await db.orders.toArray();
                    const ordersBySession = new Map<string, HistoryOrder[]>();
                    localOrders.forEach((order) => {
                      const sessionKey = String(order.sessionId || '').trim();
                      if (!sessionKey) return;
                      const sessionOrders = ordersBySession.get(sessionKey) || [];
                      sessionOrders.push({
                        status: order.status,
                        total: order.total,
                        createdAt: order.createdAt,
                      });
                      ordersBySession.set(sessionKey, sessionOrders);
                    });
                    const localSessionsWithOrders = localSessions.map((session) => ({
                      ...session,
                      orders: ordersBySession.get(String(session.id)) || [],
                    }));

                    console.log('[Sessions History] Loaded', localSessionsWithOrders.length, 'closed sessions from local DB (fallback mode)');
                    if (requestActive) setClosedSessions(localSessionsWithOrders);
                }
            } catch (error) {
                if (!requestActive) return;
                console.error('[Sessions History] Error fetching closed sessions:', error);
                toast({ 
                    variant: 'destructive', 
                    title: 'Failed to load session history',
                    description: error instanceof Error ? error.message : 'Unknown error'
                });
                setClosedSessions([]);
            } finally {
                if (requestActive) setIsLoading(false);
            }
        };

        fetchClosedSessions();

        return () => {
          requestActive = false;
        };
    }, [
      activeBranchId,
      isOpen,
      user?.businessId,
      dateRange?.from?.getTime(),
      dateRange?.to?.getTime(),
    ]);

    if (viewingSession) {
        return (
            <>
                <SessionDetailDialog 
                    session={viewingSession}
                    isOpen={isOpen}
                    onOpenChange={(open) => {
                        if (!open) {
                            setViewingSession(null);
                        }
                        onOpenChange(open);
                    }}
                />
            </>
        );
    }

    const filteredSessions = closedSessions.filter((session) => sessionHasSalesInRange(session, dateRange));
    const fuelSessions = filteredSessions.filter((session) => hasPumpName(session));
    const nonFuelSessions = filteredSessions.filter((session) => !hasPumpName(session));
    const totalSalesInRange = filteredSessions.reduce(
        (sum, session) => sum + getSessionSalesInRange(session, dateRange),
        0
    );
    const dateRangeLabel = dateRange?.from
        ? dateRange.to
            ? `${format(dateRange.from, 'LLL dd, y')} - ${format(dateRange.to, 'LLL dd, y')}`
            : format(dateRange.from, 'LLL dd, y')
        : 'All closed sessions';
    const salesColumnLabel = dateRange?.from ? 'Sales in Range' : 'Total Sales';

    const renderSessionsTable = (sessions: Session[], emptyMessage: string, showPump: boolean) => (
        <>
            <div className="space-y-3 md:hidden">
                {sessions.length > 0 ? (
                    sessions.map((session) => (
                        <div key={session.id} className="rounded-lg border bg-card p-4">
                            <div className="flex items-start justify-between gap-3">
                                <div className="space-y-1">
                                    <p className="font-semibold">{session.userName}</p>
                                    <p className="text-xs text-muted-foreground">{formatSessionDate(session.startedAt)}</p>
                                </div>
                                <Badge variant="secondary">Closed</Badge>
                            </div>

                            <div className="mt-3 space-y-2">
                                {showPump && (
                                    <MobileInfoRow label="Pump" value={session.pumpName || '-'} />
                                )}
                                <MobileInfoRow
                                    label={salesColumnLabel}
                                    value={formatCurrency(getSessionSalesInRange(session, dateRange))}
                                    valueClassName="font-medium"
                                />
                                <MobileInfoRow
                                    label="Cash diff."
                                    value={formatCurrency(session.difference || 0)}
                                    valueClassName={`font-medium ${(session.difference || 0) !== 0 ? 'text-destructive' : ''}`}
                                />
                            </div>

                            <Button
                                variant="outline"
                                className="mt-4 w-full"
                                onClick={() => setViewingSession(session)}
                            >
                                View Details
                            </Button>
                        </div>
                    ))
                ) : (
                    <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                        {emptyMessage}
                    </div>
                )}
            </div>

            <div className="hidden md:block">
                <Table className={showPump ? 'min-w-[860px]' : 'min-w-[760px]'}>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Started By</TableHead>
                            {showPump && <TableHead>Pump</TableHead>}
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">{salesColumnLabel}</TableHead>
                            <TableHead className="text-right">Cash Difference</TableHead>
                            <TableHead className="w-auto text-right">
                                <span className="sr-only">Actions</span>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {sessions.length > 0 ? (
                            sessions.map((session) => (
                                <TableRow key={session.id}>
                                    <TableCell>{formatSessionDate(session.startedAt)}</TableCell>
                                    <TableCell>{session.userName}</TableCell>
                                    {showPump && <TableCell>{session.pumpName || '-'}</TableCell>}
                                    <TableCell><Badge variant="secondary">Closed</Badge></TableCell>
                                    <TableCell className="text-right font-medium">{formatCurrency(getSessionSalesInRange(session, dateRange))}</TableCell>
                                    <TableCell className={`text-right font-medium ${(session.difference || 0) !== 0 ? 'text-destructive' : ''}`}>
                                        {formatCurrency(session.difference || 0)}
                                    </TableCell>
                                    <TableCell>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setViewingSession(session)}
                                        >
                                            <MoreHorizontal className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={showPump ? 7 : 6} className="h-24 text-center">
                                    {emptyMessage}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </>
    );

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle>Session History</DialogTitle>
                    <DialogDescription>
                        Review closed sessions and compare gross sales with the selected Reports period.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <>
                        <div className="mb-4 flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-3">
                                <div className="rounded-md bg-primary/10 p-2 text-primary">
                                    <CalendarIcon className="h-4 w-4" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium">Sales period</p>
                                    <p className="text-xs text-muted-foreground">{dateRangeLabel}</p>
                                </div>
                            </div>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className="w-full justify-start text-left sm:w-auto">
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {dateRange?.from
                                            ? dateRange.to
                                                ? `${format(dateRange.from, 'LLL dd')} - ${format(dateRange.to, 'LLL dd, y')}`
                                                : format(dateRange.from, 'LLL dd, y')
                                            : 'Choose date range'}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent align="end" className="w-auto p-0">
                                    <div className="flex flex-wrap gap-2 border-b p-3">
                                        <Button size="sm" variant={!dateRange ? 'secondary' : 'ghost'} onClick={() => setDateRange(undefined)}>All time</Button>
                                        <Button size="sm" variant="ghost" onClick={() => {
                                            const today = new Date();
                                            setDateRange({ from: startOfDay(today), to: endOfDay(today) });
                                        }}>Today</Button>
                                        <Button size="sm" variant="ghost" onClick={() => {
                                            const yesterday = subDays(new Date(), 1);
                                            setDateRange({ from: startOfDay(yesterday), to: endOfDay(yesterday) });
                                        }}>Yesterday</Button>
                                        <Button size="sm" variant="ghost" onClick={() => setDateRange({ from: startOfDay(subDays(new Date(), 7)), to: endOfDay(new Date()) })}>Last 7 days</Button>
                                        <Button size="sm" variant="ghost" onClick={() => setDateRange({ from: startOfDay(subDays(new Date(), 30)), to: endOfDay(new Date()) })}>Last 30 days</Button>
                                        <Button size="sm" variant="ghost" onClick={() => {
                                            const today = new Date();
                                            setDateRange({ from: startOfMonth(today), to: endOfDay(today) });
                                        }}>This month</Button>
                                    </div>
                                    <Calendar
                                        initialFocus
                                        mode="range"
                                        selected={dateRange}
                                        onSelect={setDateRange}
                                        numberOfMonths={2}
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>

                        <div className="mb-4 grid gap-3 sm:grid-cols-3">
                            <div className="rounded-lg border bg-card p-3">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sales in period</p>
                                <p className="mt-1 text-xl font-semibold">{formatCurrency(totalSalesInRange)}</p>
                            </div>
                            <div className="rounded-lg border bg-card p-3">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Sessions</p>
                                <p className="mt-1 text-xl font-semibold">{filteredSessions.length}</p>
                            </div>
                            <div className="rounded-lg border bg-card p-3">
                                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Breakdown</p>
                                <p className="mt-1 text-sm font-medium">{fuelSessions.length} fuel · {nonFuelSessions.length} non-pump</p>
                            </div>
                        </div>

                        <p className="mb-3 text-xs text-muted-foreground">
                            Sales are gross order totals, excluding voided and cancelled orders. Sessions with sales in the selected period are included, even if they started earlier.
                        </p>
                        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'fuel' | 'nonFuel')}>
                            <TabsList className="mb-4 grid h-auto w-full grid-cols-1 sm:grid-cols-2">
                                <TabsTrigger value="fuel" className="text-xs sm:text-sm">Fuel Sessions</TabsTrigger>
                                <TabsTrigger value="nonFuel" className="text-xs sm:text-sm">Non-Pump Sessions</TabsTrigger>
                            </TabsList>
                            <TabsContent value="fuel">
                                {renderSessionsTable(
                                    fuelSessions,
                                    'No closed pump sessions found for this branch.',
                                    true
                                )}
                            </TabsContent>
                            <TabsContent value="nonFuel">
                                {renderSessionsTable(
                                    nonFuelSessions,
                                    'No closed non-pump sessions found for this branch.',
                                    false
                                )}
                            </TabsContent>
                        </Tabs>
                        </>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
