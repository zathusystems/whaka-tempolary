import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Loader2, MoreHorizontal } from 'lucide-react';

import { db, type Session } from '@/lib/db';
import { useCurrency } from '@/hooks/use-currency';
import { toast } from '@/hooks/use-toast';
import { authFetch } from '@/lib/auth-fetch';
import { useAuth } from '@/hooks/use-auth';
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
import SessionDetailDialog from './session-detail-modal';

const LOCAL_STORAGE_KEYS = {
  ACTIVE_BRANCH: 'handypos-active-branch'
};

interface SessionHistoryModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  branchId?: string | null;
}

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

const mapBackendSessionToLocal = (session: any, fallbackBranchId: string | null): Session => ({
  id: String(session.id),
  branchId: String(session.branch || fallbackBranchId || ''),
  userId: String(session.user || ''),
  userName: session.user_name || session.user_email || `User ${session.user}`,
  userEmail: session.user_email || '',
  status: String(session.status).toLowerCase() === 'closed' ? 'closed' : 'active',
  openingFloat: parseFloat(session.opening_float || 0),
  expectedCash: parseFloat(session.expected_cash || 0),
  actualCash: session.actual_cash !== null && session.actual_cash !== undefined ? parseFloat(session.actual_cash) : undefined,
  closingFloat: session.closing_float !== null && session.closing_float !== undefined ? parseFloat(session.closing_float) : undefined,
  difference: session.difference !== null && session.difference !== undefined ? parseFloat(session.difference) : undefined,
  totalSales: parseFloat(session.total_sales || 0),
  totalCashSales: parseFloat(session.total_cash_sales || 0),
  totalCardSales: parseFloat(session.total_card_sales || 0),
  totalMobileMoneySales: parseFloat(session.total_mobile_money_sales || 0),
  totalOnAccountSales: parseFloat(session.total_on_account_sales || 0),
  totalOtherSales: parseFloat(session.total_other_sales || 0),
  totalTips: parseFloat(session.total_tips || 0),
  openingStock: session.opening_stock || [],
  closingStock: session.closing_stock || [],
  startedAt: session.started_at || session.startedAt,
  closedAt: session.closed_at || session.closedAt,
});

const formatSessionDate = (value?: string) => {
  if (!value) return '-';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '-';
  return format(dt, 'PP');
};

export default function SessionHistoryModal({ isOpen, onOpenChange, branchId = null }: SessionHistoryModalProps) {
    const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
    const [viewingSession, setViewingSession] = useState<Session | null>(null);
    const { format: formatCurrency } = useCurrency();
    const { user } = useAuth();
    const [closedSessions, setClosedSessions] = useState<Session[]>([]);
    const [isLoading, setIsLoading] = useState(false);

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

        const fetchClosedSessions = async () => {
            setIsLoading(true);
            try {
                const normalizedBranchId = normalizeBranchId(activeBranchId);
                const businessQuery = user?.businessId
                  ? `?business_id=${encodeURIComponent(String(user.businessId))}`
                  : '';
                const initialUrl = normalizedBranchId
                  ? `/sessions/sessions/?branch_id=${encodeURIComponent(normalizedBranchId)}${businessQuery ? `&${businessQuery.slice(1)}` : ''}`
                  : `/sessions/sessions/${businessQuery}`;

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

                    setClosedSessions(backendClosedSessions);

                    for (const session of backendClosedSessions) {
                      try {
                        await db.sessions.put(session);
                      } catch (dbError) {
                        console.warn('[Sessions History] Error storing backend session in local DB:', dbError);
                      }
                    }
                } catch (backendError) {
                    console.warn('[Sessions History] Backend fetch failed, falling back to local DB:', backendError);

                    const localSessions = (await db.sessions.toArray())
                      .filter((session) =>
                        session.status === 'closed' &&
                        (!activeBranchId || String(session.branchId) === String(activeBranchId))
                      )
                      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

                    console.log('[Sessions History] Loaded', localSessions.length, 'closed sessions from local DB (fallback mode)');
                    setClosedSessions(localSessions);
                }
            } catch (error) {
                console.error('[Sessions History] Error fetching closed sessions:', error);
                toast({ 
                    variant: 'destructive', 
                    title: 'Failed to load session history',
                    description: error instanceof Error ? error.message : 'Unknown error'
                });
                setClosedSessions([]);
            } finally {
                setIsLoading(false);
            }
        };

        fetchClosedSessions();
    }, [activeBranchId, isOpen, user?.businessId]);

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

    return (
        <Dialog open={isOpen} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle>Session History</DialogTitle>
                    <DialogDescription>Review details from previously closed sessions for this branch.</DialogDescription>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Date</TableHead>
                                    <TableHead>Started By</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Total Sales</TableHead>
                                    <TableHead className="text-right">Cash Difference</TableHead>
                                    <TableHead className="w-auto text-right"><span className="sr-only">Actions</span></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {closedSessions && closedSessions.length > 0 ? (
                                    closedSessions.map(s => (
                                        <TableRow key={s.id}>
                                            <TableCell>{formatSessionDate(s.startedAt)}</TableCell>
                                            <TableCell>{s.userName}</TableCell>
                                            <TableCell><Badge variant="secondary">Closed</Badge></TableCell>
                                            <TableCell className="text-right font-medium">{formatCurrency(s.totalSales || 0)}</TableCell>
                                            <TableCell className={`text-right font-medium ${(s.difference || 0) !== 0 ? 'text-destructive' : ''}`}>
                                                {formatCurrency(s.difference || 0)}
                                            </TableCell>
                                            <TableCell>
                                                 <Button 
                                                    variant="ghost" 
                                                    size="icon"
                                                    onClick={() => setViewingSession(s)}
                                                 >
                                                    <MoreHorizontal className="h-4 w-4" />
                                                 </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center">
                                            No closed sessions found for this branch.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};
