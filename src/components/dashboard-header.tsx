

'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cloud, CloudOff, AlertCircle, Loader2, ChevronDown, X, Trash2, Radio } from 'lucide-react';
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
import { db } from '@/lib/db';
import { useAuth } from '@/hooks/use-auth';
import {
  DEVICE_IDENTITY_CHANGED_EVENT,
  ensureTauriDeviceIdentity,
  getDeviceSerial,
} from '@/lib/device-identity';
import { isWarehouseBranchId } from '@/lib/branch-context';
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

const SALES_STORAGE_KEY = 'handypos-sales';
const PENDING_SALES_KEY = 'handypos-pending-sales';

const syncDropdownContentClassName =
  'w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] overflow-hidden sm:w-[28rem] md:w-[34rem]';

const MRA_PING_STORAGE_PREFIX = 'handypos-mra-ping-status';
const MRA_PING_THROTTLE_MS = 5 * 60 * 1000;

type MraPingStatus = {
  enabled: boolean;
  isOnline: boolean | null;
  checkedAt: string;
  serverTime?: string;
  terminalId?: string;
  terminalLabel?: string;
  terminalStatus?: string;
  error?: string;
};

const formatOptionalDateTime = (value?: string): string => {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const toBackendBranchId = (id?: unknown): string => {
  const normalized = String(id || '').trim();
  if (!normalized) return normalized;
  if (isWarehouseBranchId(normalized)) return normalized;

  const brnMatch = /^BRN-(\d+)$/i.exec(normalized);
  if (brnMatch) return brnMatch[1];

  const legacyBranchMatch = /^branch-(\d+)$/i.exec(normalized);
  if (legacyBranchMatch) return legacyBranchMatch[1];

  if (/^\d+$/.test(normalized)) return normalized;
  return normalized;
};

const extractApiList = <T,>(payload: any): T[] => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const getApiBranchId = (item: any): string => {
  const rawBranch = item?.branch;
  if (rawBranch && typeof rawBranch === 'object') {
    return String(rawBranch.id ?? rawBranch.pk ?? rawBranch.branch_id ?? rawBranch.branchId ?? '').trim();
  }
  return String(rawBranch ?? item?.branch_id ?? item?.branchId ?? '').trim();
};

const getApiDeviceSerial = (item: any): string => {
  return String(item?.device_serial ?? item?.deviceSerial ?? item?.mac_address ?? item?.macAddress ?? '').trim();
};

const readBooleanFlag = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'enabled'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'disabled'].includes(normalized)) return false;
  }
  return null;
};

const parseStoredJson = <T,>(key: string): T | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

const getMraPingStorageKey = (businessId: string, branchId: string): string => (
  `${MRA_PING_STORAGE_PREFIX}:${businessId}:${toBackendBranchId(branchId)}`
);

const readCachedMraPingStatus = (businessId?: unknown, branchId?: unknown): MraPingStatus | null => {
  if (typeof window === 'undefined') return null;
  const normalizedBusinessId = String(businessId || '').trim();
  const normalizedBranchId = toBackendBranchId(branchId);
  if (!normalizedBusinessId || !normalizedBranchId) return null;
  return parseStoredJson<MraPingStatus>(getMraPingStorageKey(normalizedBusinessId, normalizedBranchId));
};

const emitSyncStatusChanged = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('handypos-sync-status-changed'));
};

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
  const { business } = useAuth();
  const [mraPingStatus, setMraPingStatus] = useState<MraPingStatus | null>(null);
  const [isCheckingMraPing, setIsCheckingMraPing] = useState(false);
  const mraPingAttemptRef = useRef<Record<string, number>>({});

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

  const resolveBusinessId = useCallback((): string => {
    const cachedBusiness =
      parseStoredJson<any>('handy-pos-business') ||
      parseStoredJson<any>('handypos-business') ||
      null;
    return String(business?.id ?? cachedBusiness?.id ?? '').trim();
  }, [business?.id]);

  const resolveCachedEisEnabled = useCallback((): boolean | null => {
    const cachedBusiness =
      parseStoredJson<any>('handy-pos-business') ||
      parseStoredJson<any>('handypos-business') ||
      null;
    const storedSettings = parseStoredJson<any>('handypos-business-settings');
    const businessId = resolveBusinessId();
    const settingsBusinessId = String(storedSettings?.businessId ?? storedSettings?.business_id ?? '').trim();
    const settingsBelongToBusiness = !settingsBusinessId || settingsBusinessId === businessId;

    const currentBusiness = business as any;
    const candidates = [
      currentBusiness?.enable_eis,
      currentBusiness?.enableEis,
      cachedBusiness?.enable_eis,
      cachedBusiness?.enableEis,
      settingsBelongToBusiness ? storedSettings?.enableEis : undefined,
      settingsBelongToBusiness ? storedSettings?.enable_eis : undefined,
    ];

    for (const value of candidates) {
      const parsed = readBooleanFlag(value);
      if (parsed !== null) return parsed;
    }

    return null;
  }, [business, resolveBusinessId]);

  const persistMraPingStatus = useCallback((businessId: string, branchId: string, status: MraPingStatus) => {
    setMraPingStatus(status);
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(getMraPingStorageKey(businessId, branchId), JSON.stringify(status));
    } catch (error) {
      console.warn('[DashboardHeader] Failed to cache MRA ping status:', error);
    }
  }, []);

  const runMraPing = useCallback(async (force = false) => {
    if (typeof window === 'undefined') return;
    const businessId = resolveBusinessId();
    const branchId = toBackendBranchId(propBranchId);
    if (isWarehouseBranchId(branchId)) {
      setMraPingStatus({
        enabled: false,
        isOnline: null,
        checkedAt: new Date().toISOString(),
        terminalLabel: 'Warehouse',
      });
      return;
    }
    if (!businessId || !branchId) return;

    const refKey = `${businessId}:${branchId}`;
    const now = Date.now();
    const lastAttemptAt = mraPingAttemptRef.current[refKey] || 0;
    if (!force && now - lastAttemptAt < MRA_PING_THROTTLE_MS) {
      return;
    }
    mraPingAttemptRef.current[refKey] = now;

    setIsCheckingMraPing(true);
    try {
      let eisEnabled = resolveCachedEisEnabled();
      if (eisEnabled === null) {
        try {
          const backendBusiness = await authFetch.fetch<any>(`/business/businesses/${businessId}/`);
          eisEnabled = readBooleanFlag(backendBusiness?.enable_eis ?? backendBusiness?.enableEis);
        } catch (error) {
          console.warn('[DashboardHeader] Could not confirm backend EIS status before MRA ping:', error);
        }
      }

      if (eisEnabled === false) {
        persistMraPingStatus(businessId, branchId, {
          enabled: false,
          isOnline: null,
          checkedAt: new Date().toISOString(),
        });
        return;
      }

      setMraPingStatus((previous) => previous || {
        enabled: true,
        isOnline: null,
        checkedAt: new Date().toISOString(),
      });

      const terminalsResponse = await authFetch.fetch<any>('/mra-eis/terminals/');
      const terminals = extractApiList<any>(terminalsResponse);
      const currentDeviceSerial = getDeviceSerial().toLowerCase();
      const branchTerminals = terminals.filter(
        (terminal) => toBackendBranchId(getApiBranchId(terminal)) === branchId
      );
      const matchingTerminal =
        branchTerminals.find((terminal) => (
          String(terminal?.status || '').toLowerCase() === 'active' &&
          getApiDeviceSerial(terminal).toLowerCase() === currentDeviceSerial
        )) ||
        branchTerminals.find((terminal) => getApiDeviceSerial(terminal).toLowerCase() === currentDeviceSerial);

      const terminalId = String(matchingTerminal?.id || '').trim();
      if (!terminalId) {
        persistMraPingStatus(businessId, branchId, {
          enabled: true,
          isOnline: false,
          checkedAt: new Date().toISOString(),
          error: 'Activation required.',
        });
        return;
      }

      const response = await authFetch.fetch<any>(`/mra-eis/terminals/${terminalId}/status/?ping=true&startup=true`);
      const healthCheck = response?.health_check || {};
      const parsedOnline = readBooleanFlag(response?.is_online ?? healthCheck?.is_online);
      const isMraOnline = parsedOnline === true;
      const terminalLabel = String(
        matchingTerminal?.terminal_label ||
        matchingTerminal?.terminalLabel ||
        matchingTerminal?.terminal_id ||
        response?.terminal_id ||
        'MRA terminal'
      );
      const error = String(healthCheck?.error || response?.error || '').trim();

      persistMraPingStatus(businessId, branchId, {
        enabled: true,
        isOnline: isMraOnline,
        checkedAt: String(healthCheck?.checked_at || new Date().toISOString()),
        serverTime: String(healthCheck?.server_time || healthCheck?.server_time_raw || ''),
        terminalId,
        terminalLabel,
        terminalStatus: String(response?.status || matchingTerminal?.status || ''),
        error: isMraOnline ? '' : error,
      });
    } catch (error: any) {
      persistMraPingStatus(businessId, branchId, {
        enabled: true,
        isOnline: false,
        checkedAt: new Date().toISOString(),
        error: error?.message || 'MRA ping failed.',
      });
    } finally {
      setIsCheckingMraPing(false);
    }
  }, [persistMraPingStatus, propBranchId, resolveBusinessId, resolveCachedEisEnabled]);

  useEffect(() => {
    const businessId = resolveBusinessId();
    const branchId = toBackendBranchId(propBranchId);
    if (isWarehouseBranchId(branchId)) {
      setMraPingStatus({
        enabled: false,
        isOnline: null,
        checkedAt: new Date().toISOString(),
        terminalLabel: 'Warehouse',
      });
      return;
    }
    setMraPingStatus(readCachedMraPingStatus(businessId, branchId));
    if (!businessId || !branchId) return;

    void ensureTauriDeviceIdentity().then(() => runMraPing(true));
    void runMraPing(false);

    const handleFocus = () => void runMraPing(false);
    const handleOnline = () => void runMraPing(true);
    const handleDeviceIdentityChanged = () => void runMraPing(true);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);
    window.addEventListener(DEVICE_IDENTITY_CHANGED_EVENT, handleDeviceIdentityChanged);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener(DEVICE_IDENTITY_CHANGED_EVENT, handleDeviceIdentityChanged);
    };
  }, [propBranchId, resolveBusinessId, runMraPing]);

  const mraPingTitle = useMemo(() => {
    if (!mraPingStatus?.enabled) return 'MRA EIS is disabled';
    const parts = [
      mraPingStatus.isOnline ? 'MRA ping: Online' : 'MRA ping: Offline',
      mraPingStatus.terminalLabel ? `Terminal: ${mraPingStatus.terminalLabel}` : '',
      mraPingStatus.checkedAt ? `Checked: ${formatOptionalDateTime(mraPingStatus.checkedAt)}` : '',
      mraPingStatus.serverTime ? `Server time: ${formatOptionalDateTime(mraPingStatus.serverTime)}` : '',
      mraPingStatus.error ? `Error: ${mraPingStatus.error}` : '',
    ];
    return parts.filter(Boolean).join(' | ');
  }, [mraPingStatus]);

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

  const isLocalOrderFailure = (item: any): boolean => {
    return item?.source === 'local-order' || String(item?.id || '').startsWith('local-order-');
  };

  const getLocalOrderFailureId = (item: any): string => {
    return String(item?.entityId || item?.id || '').replace(/^local-order-/, '').trim();
  };

  const updateStoredSaleSyncState = (orderId: string) => {
    if (typeof window === 'undefined') return;

    for (const key of [SALES_STORAGE_KEY, PENDING_SALES_KEY]) {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;

        const records = JSON.parse(raw);
        if (!Array.isArray(records)) continue;

        const nextRecords = key === PENDING_SALES_KEY
          ? records.filter((record: any) => String(record?.id || '') !== orderId)
          : records.map((record: any) => {
              if (String(record?.id || '') !== orderId) return record;
              const {
                syncError,
                syncRetryBlocked,
                syncFailedAt,
                syncStatus,
                ...rest
              } = record;
              return rest;
            });

        window.localStorage.setItem(key, JSON.stringify(nextRecords));
      } catch (error) {
        console.warn('[DashboardHeader] Failed to update stored sale sync state:', error);
      }
    }
  };

  const clearLocalOrderFailure = async (orderId: string) => {
    if (!orderId) return;

    await db.orders.update(orderId, {
      _dirty: false,
      _operation: undefined,
      syncStatus: undefined,
      syncError: undefined,
      syncRetryBlocked: false,
      syncFailedAt: undefined,
    });
    updateStoredSaleSyncState(orderId);
  };

  const clearFailedSyncItem = async (item: any) => {
    if (isLocalOrderFailure(item)) {
      await clearLocalOrderFailure(getLocalOrderFailureId(item));
    } else if (item?.id) {
      authFetch.removeSyncQueueItem(String(item.id));
    }

    emitSyncStatusChanged();
  };

  const clearAllFailedSyncItems = async () => {
    const localOrderIds = failedQueueItems
      .filter(isLocalOrderFailure)
      .map(getLocalOrderFailureId)
      .filter(Boolean);
    const authQueueIds = failedQueueItems
      .filter((item) => !isLocalOrderFailure(item))
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean);

    await Promise.all(localOrderIds.map(clearLocalOrderFailure));
    authFetch.removeSyncQueueItems(authQueueIds);
    emitSyncStatusChanged();
  };

  return (
    <>
      <header className="tauri-android-safe-top sticky top-0 z-10 w-full border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-[1540px] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8 2xl:px-10">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            {children}
          </div>
          
          {/* Sync Status Indicator */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {/* Online/Offline Status */}
          <div className={`flex items-center gap-1 px-2 py-1 rounded-md ${isOnline ? 'bg-green-500/10' : 'bg-destructive/10'}`}>
            {isOnline ? (
              <>
                <Cloud className="h-4 w-4 text-green-600" />
                <span className="hidden text-xs font-medium text-green-600 sm:inline">Online</span>
              </>
            ) : (
              <>
                <CloudOff className="h-4 w-4 text-destructive" />
                <span className="hidden text-xs font-medium text-destructive sm:inline">Offline</span>
              </>
            )}
          </div>

          {mraPingStatus?.enabled && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`h-7 gap-1 rounded-md px-2 text-xs ${
                isCheckingMraPing
                  ? 'bg-muted text-muted-foreground'
                  : mraPingStatus.isOnline
                    ? 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15'
                    : 'bg-destructive/10 text-destructive hover:bg-destructive/15'
              }`}
              title={mraPingTitle}
              aria-label={mraPingTitle}
              onClick={() => void runMraPing(true)}
              disabled={isCheckingMraPing}
            >
              {isCheckingMraPing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mraPingStatus.isOnline ? (
                <Radio className="h-4 w-4" />
              ) : (
                <CloudOff className="h-4 w-4" />
              )}
              <span className="hidden whitespace-nowrap font-medium sm:inline">
                {isCheckingMraPing ? 'MRA...' : mraPingStatus.isOnline ? 'MRA Online' : 'MRA Offline'}
              </span>
            </Button>
          )}

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
              <DropdownMenuContent align="end" sideOffset={8} className={syncDropdownContentClassName}>
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <DropdownMenuLabel className="p-0">Failed Sync Items</DropdownMenuLabel>
                  {failedQueueItems.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 gap-1 px-2 text-xs text-muted-foreground hover:text-destructive"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void clearAllFailedSyncItems();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Clear all
                    </Button>
                  )}
                </div>
                <DropdownMenuSeparator />
                <ScrollArea className="max-h-[min(65vh,30rem)]">
                  <div className="space-y-2 p-2">
                    {failedQueueItems.length > 0 ? (
                      failedQueueItems.map((item) => (
                        <div
                          key={item.id || `${item.method}-${item.url}-${item.timestamp || ''}`}
                          className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2 rounded-md bg-muted/50 p-2 text-xs"
                        >
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                          <div className="flex-1 min-w-0">
                            <div className="break-words font-medium leading-snug">{getQueueItemTitle(item)}</div>
                            <div className="break-all text-xs text-muted-foreground">
                              {getQueueItemSubtitle(item)}
                            </div>
                            {item?.error && (
                              <div className="mt-1 whitespace-normal break-words text-xs leading-relaxed text-destructive">
                                {String(item.error)}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-start gap-1">
                            <Badge variant="outline" className="hidden text-xs whitespace-nowrap border-destructive/40 text-destructive sm:inline-flex">
                              Failed
                            </Badge>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              aria-label={`Clear ${getQueueItemTitle(item)}`}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void clearFailedSyncItem(item);
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
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
              <DropdownMenuContent align="end" sideOffset={8} className={syncDropdownContentClassName}>
                <DropdownMenuLabel>Pending Sync Items</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <ScrollArea className="max-h-[min(65vh,30rem)]">
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
                                className="flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs"
                              >
                                <span className="text-lg">⏳</span>
                                <div className="flex-1 min-w-0">
                                  <div className="break-words font-medium">{getQueueItemTitle(item)}</div>
                                  <div className="break-all text-xs text-muted-foreground">
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
                                className="flex items-start gap-2 rounded-md bg-muted/50 p-2 text-xs"
                              >
                                <span className="text-lg">{getTypeIcon(record.type)}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="break-words font-medium">{record.name || record.id}</div>
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
