

'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Cloud, CloudOff, AlertCircle, Loader2, ChevronDown } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useSyncStatus } from '@/hooks/use-sync-status';
import { ScrollArea } from './ui/scroll-area';
import { authFetch } from '@/lib/auth-fetch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

interface DashboardHeaderProps {
  children?: React.ReactNode;
  onTakeOrderClick?: () => void;
  branchId?: string | null;
}

interface SubscriptionReminderData {
  id: number | null;
  balance: number;
  monthlyCharge: number;
  currencyCode: string;
}

export function DashboardHeader({
  children,
  onTakeOrderClick,
  branchId: propBranchId,
}: DashboardHeaderProps) {
  const {
    pendingCount,
    failedCount,
    isOnline,
    hasPending,
    hasFailed,
    dirtyRecords,
    failedQueueItems,
    pendingQueueItems,
  } = useSyncStatus(propBranchId);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showLowFundsModal, setShowLowFundsModal] = useState(false);
  const [showOutOfCreditsModal, setShowOutOfCreditsModal] = useState(false);
  const [subscriptionReminder, setSubscriptionReminder] = useState<SubscriptionReminderData | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isBillingAddCreditFlow = pathname === '/dashboard/settings/billing' && searchParams.get('openAddCredit') === '1';
  const lowFundsThreshold = useMemo(
    () => (subscriptionReminder ? subscriptionReminder.monthlyCharge * 0.2 : 0),
    [subscriptionReminder]
  );

  const formatAmount = (value: number): string => {
    const code = subscriptionReminder?.currencyCode || 'USD';
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(value);
    } catch {
      return `${value.toFixed(2)} ${code}`;
    }
  };

  useEffect(() => {
    let active = true;

    const syncSubscriptionReminder = async () => {
      try {
        const response = await authFetch.fetch('/subscription/subscriptions/current/');
        if (!active || !response) return;

        const balance = Number(response.account_balance ?? 0);
        const monthlyChargeFromApi = Number(response.monthly_charge ?? 0);
        const dailyCharge = Number(response.daily_charge ?? response.base_price_per_day ?? 0);
        const monthlyCharge = monthlyChargeFromApi > 0 ? monthlyChargeFromApi : Math.max(dailyCharge * 30, 0);
        const currencyCode = String(response.currency_code || 'USD').toUpperCase();
        const subscriptionId = Number.isFinite(Number(response.id)) ? Number(response.id) : null;

        setSubscriptionReminder({
          id: subscriptionId,
          balance,
          monthlyCharge,
          currencyCode,
        });

        if (isBillingAddCreditFlow) {
          setShowOutOfCreditsModal(false);
          setShowLowFundsModal(false);
          return;
        }

        if (balance <= 0) {
          setShowOutOfCreditsModal(true);
          setShowLowFundsModal(false);
          return;
        }

        const threshold = monthlyCharge * 0.2;
        if (monthlyCharge > 0 && balance < threshold) {
          const dayKey = new Date().toISOString().slice(0, 10);
          const reminderKey = `handypos-low-funds-reminder:${subscriptionId ?? 'current'}:${dayKey}`;
          const hasShownToday = localStorage.getItem(reminderKey) === '1';
          if (!hasShownToday) {
            localStorage.setItem(reminderKey, '1');
            setShowLowFundsModal(true);
          }
          setShowOutOfCreditsModal(false);
          return;
        }

        setShowOutOfCreditsModal(false);
        setShowLowFundsModal(false);
      } catch (error) {
        console.warn('[DashboardHeader] Subscription reminder fetch skipped:', error);
      }
    };

    void syncSubscriptionReminder();
    const handleFocus = () => {
      void syncSubscriptionReminder();
    };
    window.addEventListener('focus', handleFocus);

    return () => {
      active = false;
      window.removeEventListener('focus', handleFocus);
    };
  }, [isBillingAddCreditFlow]);

  const openBillingAddCredit = () => {
    setShowLowFundsModal(false);
    setShowOutOfCreditsModal(false);
    router.push('/dashboard/settings/billing?openAddCredit=1');
  };

  const getOperationColor = (operation?: string) => {
    switch (operation) {
      case 'create':
        return 'bg-green-100 text-green-800';
      case 'update':
        return 'bg-blue-100 text-blue-800';
      case 'delete':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'InventoryItem':
        return '📦';
      case 'Session':
        return '🔄';
      case 'Order':
        return '🛒';
      case 'PurchaseOrder':
        return '📋';
      case 'StockTransfer':
        return '🚚';
      case 'WasteRecord':
        return '🗑️';
      default:
        return '📝';
    }
  };

  const getQueueItemTitle = (item: any): string => {
    const metadata = item?.metadata || {};
    const entityType = String(item?.entityType || '').trim();
    const entityId = String(item?.entityId || '').trim();
    const metadataLabel =
      metadata?.label ||
      metadata?.name ||
      metadata?.title ||
      '';
    if (metadataLabel) return String(metadataLabel);
    if (entityType) {
      return entityId ? `${entityType} #${entityId}` : entityType;
    }
    return String(item?.url || 'Request');
  };

  const getQueueItemSubtitle = (item: any): string => {
    const method = String(item?.method || '').trim().toUpperCase();
    const url = String(item?.url || '').trim();
    if (method && url) return `${method} ${url}`;
    return url || method || 'Queued request';
  };

  return (
    <>
      <header className="tauri-android-safe-top sticky top-0 z-10 flex h-16 w-full items-center justify-between gap-4 border-b bg-background/80 px-4 py-3 backdrop-blur-sm sm:px-6">
        <div className="flex items-center gap-4 flex-1">
          {children}
        </div>
        
        {/* Sync Status Indicator */}
        <div className="flex items-center gap-2">
          {/* Online/Offline Status */}
          <div className={`flex items-center gap-1 px-2 py-1 rounded-md ${isOnline ? 'bg-green-500/10' : 'bg-destructive/10'}`}>
            {isOnline ? (
              <>
                <Cloud className="h-4 w-4 text-green-600" />
                <span className="text-xs font-medium text-green-600">Online</span>
              </>
            ) : (
              <>
                <CloudOff className="h-4 w-4 text-destructive" />
                <span className="text-xs font-medium text-destructive">Offline</span>
              </>
            )}
          </div>

          {/* Failed Sync Items */}
          {hasFailed && (
            <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 px-2">
                  <AlertCircle className="h-4 w-4 text-destructive" />
                  <Badge variant="destructive" className="text-xs">
                    {failedCount} Failed
                  </Badge>
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 max-h-[75vh] overflow-hidden">
                <DropdownMenuLabel>Failed Sync Items</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <ScrollArea className="max-h-[60vh]">
                  <div className="space-y-2 p-2">
                    {failedQueueItems.length > 0 ? (
                      failedQueueItems.map((item) => (
                        <div
                          key={item.id || `${item.method}-${item.url}-${item.timestamp || ''}`}
                          className="flex items-start gap-2 p-2 rounded-md bg-muted/50 text-xs"
                        >
                          <span className="text-lg">⚠️</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium truncate">{getQueueItemTitle(item)}</div>
                            <div className="text-muted-foreground text-xs truncate">
                              {getQueueItemSubtitle(item)}
                            </div>
                            {item?.error && (
                              <div className="text-xs text-destructive mt-1 truncate">
                                {String(item.error)}
                              </div>
                            )}
                          </div>
                          <Badge variant="outline" className="text-xs whitespace-nowrap text-destructive border-destructive/40">
                            Failed
                          </Badge>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-4 text-muted-foreground text-xs">
                        No failed items
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Pending Sync Items */}
          {hasPending && !hasFailed && (
            <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 px-2">
                  <Loader2 className="h-4 w-4 text-yellow-600 animate-spin" />
                  <Badge variant="outline" className="text-xs">
                    {pendingCount} Pending
                  </Badge>
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80 max-h-[75vh] overflow-hidden">
                <DropdownMenuLabel>Pending Sync Items</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <ScrollArea className="max-h-[60vh]">
                  <div className="space-y-2 p-2">
                    {pendingQueueItems.length === 0 && dirtyRecords.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground text-xs">
                        No pending items
                      </div>
                    ) : (
                      <>
                        {pendingQueueItems.length > 0 && (
                          <>
                            <div className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Queued Requests
                            </div>
                            {pendingQueueItems.map((item) => (
                              <div
                                key={item.id || `${item.method}-${item.url}-${item.timestamp || ''}`}
                                className="flex items-start gap-2 p-2 rounded-md bg-muted/50 text-xs"
                              >
                                <span className="text-lg">⏳</span>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium truncate">{getQueueItemTitle(item)}</div>
                                  <div className="text-muted-foreground text-xs truncate">
                                    {getQueueItemSubtitle(item)}
                                  </div>
                                </div>
                                <Badge variant="outline" className="text-xs whitespace-nowrap text-yellow-700 border-yellow-400/40">
                                  Pending
                                </Badge>
                              </div>
                            ))}
                          </>
                        )}
                        {dirtyRecords.length > 0 && (
                          <>
                            <div className="px-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Local Changes
                            </div>
                            {dirtyRecords.map((record) => (
                              <div
                                key={`${record.type}-${record.id}`}
                                className="flex items-start gap-2 p-2 rounded-md bg-muted/50 text-xs"
                              >
                                <span className="text-lg">{getTypeIcon(record.type)}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium truncate">{record.name || record.id}</div>
                                  <div className="text-muted-foreground text-xs">{record.type}</div>
                                </div>
                                <Badge variant="outline" className={`text-xs whitespace-nowrap ${getOperationColor(record.operation)}`}>
                                  {record.operation || 'update'}
                                </Badge>
                              </div>
                            ))}
                          </>
                        )}
                      </>
                    )}
                  </div>
                </ScrollArea>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

        </div>
      </header>

      <AlertDialog open={showOutOfCreditsModal}>
        <AlertDialogContent className="w-[calc(100vw-1rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Subscription Credits Finished</AlertDialogTitle>
            <AlertDialogDescription>
              Your account balance is {formatAmount(Math.max(subscriptionReminder?.balance ?? 0, 0))}. Add credits now to keep using all features.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={openBillingAddCredit}>
              Go to Billing and Add Credits
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showLowFundsModal} onOpenChange={setShowLowFundsModal}>
        <AlertDialogContent className="w-[calc(100vw-1rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Low Subscription Credits</AlertDialogTitle>
            <AlertDialogDescription>
              Remaining credits ({formatAmount(subscriptionReminder?.balance ?? 0)}) are below 20% of your monthly charge ({formatAmount(subscriptionReminder?.monthlyCharge ?? 0)}).
              {lowFundsThreshold > 0 ? ` Threshold: ${formatAmount(lowFundsThreshold)}.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Later</AlertDialogCancel>
            <AlertDialogAction onClick={openBillingAddCredit}>
              Add Credits
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
