'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Search, ScanBarcode, LayoutGrid, List, AlertTriangle, Loader2, X, Printer, Barcode, Grid3x3, ListIcon, Camera } from 'lucide-react';

import { db, type InventoryItem, type Order, type Session, type TaxRate } from '@/lib/db';
import { type BusinessType } from '@/lib/inventory/config';
import { PharmacyPos } from './pharmacy-pos';
import { RestaurantPos } from './restaurant-pos';
import { BarLiquorPos } from './bar-liquor-pos';
import { SupermarketPos } from './supermarket-pos';
import { GroceryPos } from './grocery-pos';
import { BeautySalonPos } from './beauty-salon-pos';
import type { BuyerDetails } from './generic-pos';
import { ScannerConfigModal } from './scanner-config-modal';
import { PrinterConfigModal } from './printer-config-modal';
import { CameraBarcodeScannerModal, type BarcodeDetectionOutcome } from './camera-barcode-scanner-modal';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { authFetch } from '@/lib/auth-fetch';
import { logAuditAction } from '@/lib/audit';
import { v4 as uuidv4 } from 'uuid';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export type CartItem = InventoryItem & { quantity: number; price: number; notes?: string; inventoryItemId?: string; };
export type PaymentMethod = Order['paymentMethod'];

type PosModalProps = {
  branchId: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

const LOCAL_STORAGE_KEYS = {
    ACTIVE_BRANCH: 'handypos-active-branch',
    POS_MODAL_VIEW_MODE: 'handypos-pos-modal-view-mode',
};

const normalizeBranchId = (value?: string | number | null): string => {
  if (value && typeof value === 'object') {
    const maybeId = (value as any).id ?? (value as any).branch_id ?? (value as any).branchId ?? (value as any).branch;
    if (maybeId !== undefined && maybeId !== value) {
      return normalizeBranchId(maybeId as any);
    }
    return '';
  }

  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (normalized === '[object Object]') return '';

  const brnMatch = /^BRN-(\d+)$/i.exec(normalized);
  if (brnMatch) return brnMatch[1];

  const legacyMatch = /^branch-(\d+)$/i.exec(normalized);
  if (legacyMatch) return legacyMatch[1];

  return normalized;
};

const toBackendBranchId = (value?: string | number | null): string => {
  return normalizeBranchId(value);
};

const getBranchIdCandidates = (branchId?: string | number | null): string[] => {
  const normalized = normalizeBranchId(branchId);
  if (!normalized) return [];

  const candidates = new Set<string>([normalized, String(branchId ?? '').trim()]);
  if (/^\d+$/.test(normalized)) {
    candidates.add(`BRN-${normalized}`);
    candidates.add(`branch-${normalized}`);
  }

  return Array.from(candidates).filter((candidate) => candidate.length > 0);
};

const normalizeText = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const isAllProductType = (value: string): boolean =>
  value === '' || value === 'all' || value === 'all products' || value === 'all items';

const normalizeInventoryReference = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const nestedValue =
      obj.id ??
      obj.pk ??
      obj.uuid ??
      obj.inventory_item_id ??
      obj.inventoryItemId;

    return String(nestedValue ?? '').trim();
  }

  return String(value).trim();
};

const resolveMappingInventoryItemId = (mapping: any): string => {
  if (!mapping || typeof mapping !== 'object') {
    return '';
  }

  const candidates = [
    mapping.inventoryItemId,
    mapping.inventory_item_id,
    mapping.inventoryItem,
    mapping.inventory_item,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeInventoryReference(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return '';
};

const resolveCartInventoryItemId = (cartItem: { id?: string; inventoryItemId?: string }): string => {
  const explicitInventoryId = String(cartItem.inventoryItemId || '').trim();
  if (explicitInventoryId) {
    return explicitInventoryId;
  }

  const rawLineId = String(cartItem.id || '').trim();
  if (!rawLineId) {
    return '';
  }

  // Backward compatibility for legacy synthetic line ids like "<inventoryId>::cart::<ts>".
  return rawLineId.split('::cart::')[0] || rawLineId;
};

const mappingStatusRank = (mapping: any): number => {
  if (!mapping) {
    return -1;
  }

  const approved = Boolean(mapping.isApproved ?? mapping.is_approved);
  const synced = Boolean(mapping.mraSynced ?? mapping.mra_synced);

  if (approved && synced) {
    return 3;
  }
  if (approved) {
    return 2;
  }
  if (synced) {
    return 1;
  }
  return 0;
};

const choosePreferredMapping = (current: any, candidate: any): any => {
  if (!current) {
    return candidate;
  }

  const currentRank = mappingStatusRank(current);
  const candidateRank = mappingStatusRank(candidate);
  if (candidateRank > currentRank) {
    return candidate;
  }

  if (candidateRank < currentRank) {
    return current;
  }

  const currentUpdatedAt = new Date(current.updatedAt || current.updated_at || current.lastSyncedAt || current.last_synced_at || current.createdAt || current.created_at || 0).getTime();
  const candidateUpdatedAt = new Date(candidate.updatedAt || candidate.updated_at || candidate.lastSyncedAt || candidate.last_synced_at || candidate.createdAt || candidate.created_at || 0).getTime();

  return candidateUpdatedAt >= currentUpdatedAt ? candidate : current;
};

const buildMappingLookup = (mappings: any[]): Map<string, any> => {
  const lookup = new Map<string, any>();

  for (const mapping of mappings) {
    const mappingItemId = resolveMappingInventoryItemId(mapping);
    if (!mappingItemId) {
      continue;
    }

    const current = lookup.get(mappingItemId);
    lookup.set(mappingItemId, choosePreferredMapping(current, mapping));
  }

  return lookup;
};

const resolveMappingBranchId = (mapping: any): string => {
  return normalizeBranchId(
    mapping?.branchId ??
    mapping?.branch_id ??
    mapping?.branch
  );
};

const filterMappingsForBranch = (mappings: any[], branchId: string): any[] => {
  const normalizedBranchId = normalizeBranchId(branchId);
  const shouldScopeByBranch =
    Boolean(normalizedBranchId) &&
    !['main', 'main-branch', 'main_branch'].includes(normalizedBranchId.toLowerCase());

  return mappings.filter((mapping) => {
    const mappingBranchId = resolveMappingBranchId(mapping);
    if (!mappingBranchId) {
      return true;
    }
    if (!shouldScopeByBranch) {
      return true;
    }
    return mappingBranchId === normalizedBranchId;
  });
};

const pickPreferredMapping = (mappings: any[]): any => {
  let preferred: any = undefined;
  for (const mapping of mappings) {
    preferred = choosePreferredMapping(preferred, mapping);
  }
  return preferred;
};

export function PosModal({ branchId, isOpen, onOpenChange }: PosModalProps) {
  const [currentBusinessType, setCurrentBusinessType] = useState<BusinessType>('Grocery');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [isViewModeReady, setIsViewModeReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showScannerConfig, setShowScannerConfig] = useState(false);
  const [showPrinterConfig, setShowPrinterConfig] = useState(false);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [isLoadingInventory, setIsLoadingInventory] = useState(false);
  const [eisEnabled, setEisEnabled] = useState(false);
  const [blockSalesIfTaxMappingMissing, setBlockSalesIfTaxMappingMissing] = useState(false);
  const [barcodeBuffer, setBarcodeBuffer] = useState('');
  const [barcodeTimeout, setBarcodeTimeout] = useState<NodeJS.Timeout | null>(null);
  const { toast } = useToast();
  const { user, business } = useAuth();
  const normalizedSearchQuery = searchQuery.toLowerCase().trim();
  const hasSearchQuery = normalizedSearchQuery.length > 0;

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
    }
  }, [isOpen]);

  // Load persisted POS modal view mode once, with mobile-first default.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storedViewMode = window.localStorage.getItem(LOCAL_STORAGE_KEYS.POS_MODAL_VIEW_MODE);
    if (storedViewMode === 'grid' || storedViewMode === 'list') {
      setViewMode(storedViewMode);
      setIsViewModeReady(true);
      return;
    }

    if (window.innerWidth < 768) {
      setViewMode('list');
    }

    setIsViewModeReady(true);
  }, []);

  // Persist user preference for grid/list view mode.
  useEffect(() => {
    if (!isViewModeReady || typeof window === 'undefined') return;
    window.localStorage.setItem(LOCAL_STORAGE_KEYS.POS_MODAL_VIEW_MODE, viewMode);
  }, [viewMode, isViewModeReady]);

  const toFiniteNumber = useCallback((value: unknown, fallback = 0): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }, []);

  const toPositiveNumber = useCallback((value: unknown, fallback = 0): number => {
    const parsed = toFiniteNumber(value, fallback);
    return parsed > 0 ? parsed : fallback;
  }, [toFiniteNumber]);

  const toNonNegativeNumber = useCallback((value: unknown, fallback = 0): number => {
    const parsed = toFiniteNumber(value, fallback);
    return parsed >= 0 ? parsed : fallback;
  }, [toFiniteNumber]);

  const toBoolean = useCallback((value: unknown, fallback: boolean): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
      if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    }
    return fallback;
  }, []);

  const parseTaxRatePercent = useCallback((value: unknown): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    const raw = String(value ?? '').trim();
    if (!raw) {
      return 0;
    }

    const direct = Number(raw);
    if (Number.isFinite(direct)) {
      return direct;
    }

    const stripped = raw.replace(/[^0-9.-]/g, '');
    const parsed = Number.parseFloat(stripped);
    return Number.isFinite(parsed) ? parsed : 0;
  }, []);

  const toTaxRateDecimal = useCallback((value: unknown): number => {
    const parsedRate = parseTaxRatePercent(value);
    if (parsedRate <= 0) {
      return 0;
    }

    // Accept either percentage format (16.5) or decimal format (0.165).
    return parsedRate > 1 ? parsedRate / 100 : parsedRate;
  }, [parseTaxRatePercent]);

  const normalizeMappedTaxType = useCallback((value: unknown): 'standard' | 'zero' | 'exempt' => {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (
      normalized === 'zero' ||
      normalized === 'zero_rated' ||
      normalized === 'zero-rated' ||
      normalized === 'vat_zero'
    ) {
      return 'zero';
    }
    if (normalized === 'exempt' || normalized === 'vat_exempt') {
      return 'exempt';
    }
    return 'standard';
  }, []);

  const resolveBlockSalesIfTaxMappingMissing = useCallback((source: any): boolean | null => {
    if (!source || typeof source !== 'object') {
      return null;
    }

    const rawBlock = source.blockSalesIfTaxMappingMissing ?? source.block_sales_if_tax_mapping_missing;
    if (rawBlock !== undefined) {
      return toBoolean(rawBlock, false);
    }

    const rawAllow = source.allowSalesWithoutTaxMapping ?? source.allow_sales_without_tax_mapping;
    if (rawAllow !== undefined) {
      return !toBoolean(rawAllow, false);
    }

    return null;
  }, [toBoolean]);

  // Persist cart to IndexedDB - branch-specific
  const saveCartToDb = useCallback(async (cartItems: CartItem[]) => {
    try {
      // Clear only cart items for THIS branch
      await db.cart.where('branchId').equals(branchId).delete();
      
      if (cartItems.length > 0) {
        await db.cart.bulkAdd(cartItems.map((item) => {
          const inventoryItemId = resolveCartInventoryItemId(item) || String(item.id || '').trim();
          return {
            ...item,
            id: String(item.id || '').trim(),
            branchId,
            inventoryItemId,
            savedAt: new Date().toISOString()
          };
        }));
        console.log('[Cart] Saved to IndexedDB for branch', branchId, ':', cartItems.length, 'items');
      } else {
        console.log('[Cart] Cleared cart for branch', branchId);
      }
    } catch (error) {
      console.error('[Cart] Error saving to IndexedDB:', error);
    }
  }, [branchId]);

  // Load cart from IndexedDB on mount or branch change
  useEffect(() => {
    const loadCartFromDb = async () => {
      try {
        const savedCart = await db.cart.where('branchId').equals(branchId).toArray();
        if (savedCart.length > 0) {
          const cartItems = savedCart
            .map((item) => {
              const { branchId: _branchId, savedAt, ...cartItem } = item as any;
              const resolvedInventoryItemId = resolveCartInventoryItemId(cartItem);
              const resolvedLineId = String(cartItem.id || resolvedInventoryItemId || '').trim();

              if (!resolvedLineId) {
                return null;
              }

              return {
                ...cartItem,
                id: resolvedLineId,
                inventoryItemId: resolvedInventoryItemId || resolvedLineId,
              } as CartItem;
            })
            .filter((item): item is CartItem => Boolean(item));
          setCart(cartItems);
          console.log('[Cart] Loaded from IndexedDB for branch', branchId, ':', cartItems.length, 'items');
        } else {
          // No cart for this branch, clear the state
          setCart([]);
          console.log('[Cart] No saved cart for branch', branchId);
        }
      } catch (error) {
        console.error('[Cart] Error loading from IndexedDB:', error);
        setCart([]);
      }
    };

    if (branchId) {
      loadCartFromDb();
    }
  }, [branchId]);

  // Save cart whenever it changes
  useEffect(() => {
    saveCartToDb(cart);
  }, [cart, saveCartToDb]);

  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);

  const resolveBranchIntegerId = useCallback((rawBranchId: string): number | null => {
    const branchIdMatch = String(rawBranchId || '').match(/\d+/);
    const parsed = branchIdMatch ? parseInt(branchIdMatch[0], 10) : parseInt(rawBranchId, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }, []);

  const mapBackendSessionToLocal = useCallback((response: any): Session => {
    return {
      id: String(response.id),
      branchId: String(response.branch ?? response.branch_id ?? branchId),
      userId: String(response.user ?? response.user_id ?? ''),
      userEmail: String(response.user_email ?? response.userEmail ?? '').trim(),
      userName: response.user_name || response.userName || response.user_email || 'Unknown',
      status: String(response.status || '').toLowerCase() === 'closed' ? 'closed' : 'active',
      pumpName: response.pump_name ?? response.pumpName ?? undefined,
      openingFloat: parseFloat(response.opening_float || 0),
      expectedCash: parseFloat(response.expected_cash || 0),
      actualCash: response.actual_cash ? parseFloat(response.actual_cash) : undefined,
      closingFloat: response.closing_float ? parseFloat(response.closing_float) : undefined,
      difference: response.difference ? parseFloat(response.difference) : undefined,
      totalSales: parseFloat(response.total_sales || 0),
      totalCashSales: parseFloat(response.total_cash_sales || 0),
      totalCardSales: parseFloat(response.total_card_sales || 0),
      totalMobileMoneySales: parseFloat(response.total_mobile_money_sales || 0),
      totalOnAccountSales: parseFloat(response.total_on_account_sales || 0),
      totalOtherSales: parseFloat(response.total_other_sales || 0),
      totalTips: parseFloat(response.total_tips || 0),
      openingStock: response.opening_stock || [],
      closingStock: response.closing_stock || [],
      startedAt: response.started_at,
      closedAt: response.closed_at,
    };
  }, [branchId]);

  const isSessionOwnedByCurrentUser = useCallback((sessionLike: any): boolean => {
    const currentUserId = String(user?.uid || '').trim();
    const currentUserEmail = String(user?.email || '').trim().toLowerCase();

    const sessionUserId = String(sessionLike?.user ?? sessionLike?.user_id ?? sessionLike?.userId ?? '').trim();
    const sessionUserEmail = String(
      sessionLike?.user_email ?? sessionLike?.userEmail ?? ''
    ).trim().toLowerCase();

    if (currentUserId && sessionUserId && currentUserId === sessionUserId) {
      return true;
    }

    if (currentUserEmail && sessionUserEmail && currentUserEmail === sessionUserEmail) {
      return true;
    }

    return false;
  }, [user?.uid, user?.email]);

  const isSessionActive = useCallback((sessionLike: any): boolean => {
    return String(sessionLike?.status || '').trim().toLowerCase() === 'active';
  }, []);

  const resolveSessionForCheckout = useCallback(async (): Promise<Session | null> => {
    if (!branchId || (!user?.uid && !user?.email)) {
      return null;
    }

    if (activeSession && isSessionActive(activeSession) && isSessionOwnedByCurrentUser(activeSession)) {
      return activeSession;
    }

    const normalizedBranchId = normalizeBranchId(branchId);
    const currentUserId = String(user?.uid || '').trim();
    const currentUserEmail = String(user?.email || '').trim().toLowerCase();
    const activeSessions = await db.sessions.where('status').equals('active').toArray();

    return (
      activeSessions
        .filter((session) => {
          if (normalizeBranchId(session.branchId) !== normalizedBranchId) {
            return false;
          }

          const sessionUserId = String(session.userId || '').trim();
          const sessionUserEmail = String(session.userEmail || '').trim().toLowerCase();
          return (
            (currentUserId && sessionUserId === currentUserId) ||
            (currentUserEmail !== '' && sessionUserEmail === currentUserEmail)
          );
        })
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0] ?? null
    );
  }, [activeSession, branchId, isSessionActive, isSessionOwnedByCurrentUser, user?.uid, user?.email]);

  const closeStaleLocalActiveSessions = useCallback(async () => {
    if (!branchId || (!user?.uid && !user?.email)) {
      return;
    }

    const normalizedBranchId = normalizeBranchId(branchId);
    const currentUserId = String(user?.uid || '').trim();
    const currentUserEmail = String(user?.email || '').trim().toLowerCase();
    const activeSessions = await db.sessions.where('status').equals('active').toArray();

    const staleSessions = activeSessions.filter((session) => {
      if (normalizeBranchId(session.branchId) !== normalizedBranchId) {
        return false;
      }

      const sessionUserId = String(session.userId || '').trim();
      const sessionUserEmail = String(session.userEmail || '').trim().toLowerCase();
      const matchesUser =
        (currentUserId !== '' && sessionUserId === currentUserId) ||
        (currentUserEmail !== '' && sessionUserEmail === currentUserEmail);

      return matchesUser;
    });

    if (staleSessions.length === 0) {
      return;
    }

    const closedAt = new Date().toISOString();
    await Promise.all(
      staleSessions.map((session) =>
        db.sessions.update(session.id, {
          status: 'closed',
          closedAt: session.closedAt || closedAt,
          _dirty: false,
        })
      )
    );

    console.log('[POS Modal] Marked stale local sessions as closed:', staleSessions.map((s) => s.id));
  }, [branchId, user?.uid, user?.email]);

  // Fetch active session from backend first, then fallback to IndexedDB
  useEffect(() => {
    const fetchActiveSession = async () => {
      if (!user?.uid || !branchId) {
        setIsLoadingSession(false);
        return;
      }

      setIsLoadingSession(true);
      let backendConfirmedNoSessionForCurrentUser = false;

      try {
        const branchIdInt = resolveBranchIntegerId(branchId);
        if (branchIdInt !== null) {
          // First try backend active endpoint
          console.log('[POS Modal] Fetching active session from backend for user:', user.uid, 'branch:', branchIdInt);
          const response = await authFetch.fetch<any>(`/sessions/sessions/active/?branch_id=${branchIdInt}`);
          console.log('[POS Modal] Backend response:', response);

          if (response && response.id) {
            if (isSessionActive(response) && isSessionOwnedByCurrentUser(response)) {
              const mappedSession = mapBackendSessionToLocal(response);
              setActiveSession(mappedSession);
              setIsLoadingSession(false);
              return;
            }

            // If /active returns another user's session, check active_list for current user's session.
            console.warn('[POS Modal] Backend active session belongs to another user. Resolving current-user session from active_list.');
            try {
              const activeListResponse = await authFetch.fetch<any>(`/sessions/sessions/active_list/?branch_id=${branchIdInt}`);
              const activeList = Array.isArray(activeListResponse)
                ? activeListResponse
                : Array.isArray(activeListResponse?.results)
                ? activeListResponse.results
                : [];

              const ownSession = activeList.find(
                (session: any) => isSessionActive(session) && isSessionOwnedByCurrentUser(session)
              );
              if (ownSession && ownSession.id) {
                const mappedSession = mapBackendSessionToLocal(ownSession);
                setActiveSession(mappedSession);
                setIsLoadingSession(false);
                return;
              }

              backendConfirmedNoSessionForCurrentUser = true;
            } catch (activeListError: any) {
              const status = Number(activeListError?.status || 0);
              if (status === 404) {
                backendConfirmedNoSessionForCurrentUser = true;
              } else {
                console.warn('[POS Modal] Failed resolving active_list session for current user:', activeListError);
              }
            }
          } else {
            backendConfirmedNoSessionForCurrentUser = true;
          }
        }
      } catch (error: any) {
        const status = Number(error?.status || 0);
        if (status === 404) {
          // Backend confirms there is no active session for this user/branch.
          backendConfirmedNoSessionForCurrentUser = true;
          console.log('[POS Modal] Backend reports no active session for current user in this branch.');
        } else {
          console.warn('[POS Modal] Failed to fetch session from backend:', error);
        }
      }

      if (backendConfirmedNoSessionForCurrentUser) {
        try {
          await closeStaleLocalActiveSessions();
        } catch (reconcileError) {
          console.warn('[POS Modal] Failed to reconcile stale local sessions:', reconcileError);
        }
        setActiveSession(null);
        setIsLoadingSession(false);
        return;
      }

      // Fallback to IndexedDB
      try {
        console.log('[POS Modal] Falling back to IndexedDB for active session');
        const normalizedBranchId = normalizeBranchId(branchId);
        const currentUserId = String(user?.uid || '');
        const currentUserEmail = String(user?.email || '').trim().toLowerCase();
        const activeSessions = await db.sessions
          .where('status')
          .equals('active')
          .toArray();

        const dbSession = activeSessions
          .filter((session) => {
            if (normalizeBranchId(session.branchId) !== normalizedBranchId) {
              return false;
            }

            const sessionUserId = String(session.userId || '');
            const sessionUserEmail = String(session.userEmail || '').trim().toLowerCase();
            return sessionUserId === currentUserId || (currentUserEmail !== '' && sessionUserEmail === currentUserEmail);
          })
          .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
        
        if (dbSession) {
          console.log('[POS Modal] Found active session in IndexedDB:', dbSession.id);
          setActiveSession(dbSession);
        } else {
          console.log('[POS Modal] No active session found in IndexedDB');
          setActiveSession(null);
        }
      } catch (error) {
        console.error('[POS Modal] Error fetching from IndexedDB:', error);
        setActiveSession(null);
      }

      setIsLoadingSession(false);
    };

    // Fetch session when modal opens
    if (isOpen) {
      fetchActiveSession();
    }
  }, [
    user?.uid,
    branchId,
    isOpen,
    closeStaleLocalActiveSessions,
    isSessionActive,
    isSessionOwnedByCurrentUser,
    mapBackendSessionToLocal,
    resolveBranchIntegerId,
  ]);

  // Listen for session creation/closure events and refresh immediately
  useEffect(() => {
    const handleSessionCreated = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const { sessionId, branchId: eventBranchId } = customEvent.detail || {};
      
      // Only refresh if it's for the current branch
      if (normalizeBranchId(eventBranchId) === normalizeBranchId(branchId)) {
        console.log('[POS Modal] Session created event received, refreshing active session:', sessionId);
        
        // Try to fetch from backend first
        try {
          const branchIdInt = resolveBranchIntegerId(branchId);
          if (branchIdInt === null) {
            return;
          }
          
          const response = await authFetch.fetch<any>(`/sessions/sessions/active/?branch_id=${branchIdInt}`);
          
          if (response && response.id && isSessionActive(response) && isSessionOwnedByCurrentUser(response)) {
            const mappedSession: Session = mapBackendSessionToLocal(response);
            setActiveSession(mappedSession);
            console.log('[POS Modal] ✓ Active session updated from backend:', mappedSession.id);
          } else {
            console.log('[POS Modal] Session created belongs to another user; keeping current user session state unchanged.');
          }
        } catch (error) {
          console.warn('[POS Modal] Failed to fetch updated session from backend:', error);
          
          // Fallback to IndexedDB
          try {
            const dbSession = await db.sessions.get(sessionId);
            if (dbSession && dbSession.status === 'active' && isSessionOwnedByCurrentUser(dbSession)) {
              setActiveSession(dbSession);
              console.log('[POS Modal] ✓ Active session updated from IndexedDB:', dbSession.id);
            }
          } catch (dbError) {
            console.error('[POS Modal] Error fetching from IndexedDB:', dbError);
          }
        }
      }
    };

    const handleSessionClosed = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const { sessionId, branchId: eventBranchId } = customEvent.detail || {};
      
      // Only refresh if it's for the current branch
      if (normalizeBranchId(eventBranchId) === normalizeBranchId(branchId)) {
        console.log('[POS Modal] Session closed event received, reconciling local session state');
        const isCurrentSessionClosed =
          Boolean(sessionId) &&
          Boolean(activeSession) &&
          String(activeSession.id) === String(sessionId);

        if (sessionId) {
          try {
            await db.sessions.update(String(sessionId), {
              status: 'closed',
              closedAt: new Date().toISOString(),
              _dirty: false,
            });
          } catch (dbError) {
            console.warn('[POS Modal] Failed to update closed session locally:', dbError);
          }
        }

        if (isCurrentSessionClosed || !sessionId) {
          try {
            await closeStaleLocalActiveSessions();
          } catch (reconcileError) {
            console.warn('[POS Modal] Failed to reconcile stale local sessions after close event:', reconcileError);
          }
        }

        setActiveSession((previous) => {
          if (!previous) return null;
          if (sessionId && String(previous.id) !== String(sessionId)) {
            return previous;
          }
          return null;
        });
        console.log('[POS Modal] ✓ Session close reconciliation complete');
      }
    };

    window.addEventListener('sessionCreated', handleSessionCreated);
    window.addEventListener('sessionClosed', handleSessionClosed);
    
    return () => {
      window.removeEventListener('sessionCreated', handleSessionCreated);
      window.removeEventListener('sessionClosed', handleSessionClosed);
    };
  }, [
    activeSession?.id,
    branchId,
    closeStaleLocalActiveSessions,
    isSessionActive,
    isSessionOwnedByCurrentUser,
    mapBackendSessionToLocal,
    resolveBranchIntegerId,
  ]);
  
  const allInventory = useLiveQuery(
    () => {
      if (!branchId) return [];
      const candidates = getBranchIdCandidates(branchId);
      if (candidates.length === 0) return [];
      if (candidates.length === 1) {
        return db.inventory.where({ branchId: candidates[0] }).toArray();
      }
      return db.inventory.where('branchId').anyOf(candidates).toArray();
    },
    [branchId]
  );
  const hasCachedInventory = (allInventory?.length ?? 0) > 0;
  
  const defaultTaxRate = useLiveQuery(
    async () => {
      if (!business?.id) return null;

      const taxes = await db.taxes
        .where('businessId')
        .equals(String(business.id))
        .toArray();

      const activeTaxes = taxes.filter((tax) => tax.isActive !== false);
      const defaultTax = activeTaxes.find((tax) => tax.isDefault);
      if (defaultTax) return defaultTax;

      return activeTaxes
        .sort((a, b) => {
          const timeA = Date.parse(a.updatedAt || a.createdAt || '');
          const timeB = Date.parse(b.updatedAt || b.createdAt || '');
          return (Number.isFinite(timeB) ? timeB : 0) - (Number.isFinite(timeA) ? timeA : 0);
        })[0] ?? null;
    },
    [business?.id],
    null
  );

  // Load business type and EIS enabled status from business settings
  useEffect(() => {
    const loadBusinessSettings = async () => {
      if (business?.id) {
        try {
          const businessProfile = await db.business.get(business.id);
          if (businessProfile) {
            // Load business type - map from backend format to frontend BusinessType
            if (businessProfile.type) {
              const typeMap: Record<string, BusinessType> = {
                'pharmacy': 'Pharmacy',
                'restaurant': 'Restaurant',
                'bar_liquor': 'Bar & Liquor',
                'bar & liquor': 'Bar & Liquor',
                'supermarket': 'Supermarket',
                'grocery': 'Grocery',
                'beauty_salon': 'Beauty Salon and Spa',
                'beauty salon and spa': 'Beauty Salon and Spa',
                'general_retail': 'General Retail',
                'general retail': 'General Retail',
                'generic': 'General Retail',
              };
              const mappedType = typeMap[businessProfile.type.toLowerCase()] || 'Grocery';
              console.log('[POS Modal] Setting business type to:', mappedType);
              setCurrentBusinessType(mappedType);
            }
          }
        } catch (error) {
          console.error('[POS Modal] Failed to load business settings:', error);
        }
      }
    };
    loadBusinessSettings();
  }, [business?.id]);

  // Load EIS enabled status from business settings
  useEffect(() => {
    const loadEisStatus = async () => {
      if (business?.id && isOpen) {
        try {
          console.log('[POS Modal] Loading EIS status for business:', business.id);

          const applyCachedTaxMappingPolicy = () => {
            if (typeof window === 'undefined') return;
            try {
              const storedSettingsRaw = window.localStorage.getItem('handypos-business-settings');
              if (!storedSettingsRaw) return;
              const parsed = JSON.parse(storedSettingsRaw);
              const storedBusinessId = String(parsed?.businessId || '').trim();
              if (storedBusinessId && String(business.id) !== storedBusinessId) {
                return;
              }
              const cachedBlockSetting = resolveBlockSalesIfTaxMappingMissing(parsed);
              if (cachedBlockSetting !== null) {
                setBlockSalesIfTaxMappingMissing(cachedBlockSetting);
              }
            } catch (cacheError) {
              console.warn('[POS Modal] Failed to parse cached tax mapping policy:', cacheError);
            }
          };

          applyCachedTaxMappingPolicy();
          
          // First try to fetch from backend to get latest data
          try {
            const backendBusiness = await authFetch.fetch<any>(`/business/businesses/${business.id}/`);
            console.log('[POS Modal] Backend enable_eis:', backendBusiness?.enable_eis);

            if (backendBusiness) {
              const enableEisValue = backendBusiness?.enable_eis === true || backendBusiness?.enable_eis === 'true';
              setEisEnabled(enableEisValue);
              if (enableEisValue) {
                console.log('[POS Modal] EIS is enabled from backend');
              } else {
                console.log('[POS Modal] EIS is disabled from backend');
              }

              const backendBlockSetting =
                resolveBlockSalesIfTaxMappingMissing(backendBusiness) ??
                resolveBlockSalesIfTaxMappingMissing(backendBusiness?.settings);
              if (backendBlockSetting !== null) {
                setBlockSalesIfTaxMappingMissing(backendBlockSetting);
              }
              return;
            }
          } catch (backendError) {
            console.warn('[POS Modal] Failed to fetch from backend, trying IndexedDB:', backendError);
          }
          
          // Fallback to IndexedDB
          const businessProfile = await db.business.get(business.id);
          if (businessProfile) {
            const settings = await db.businessSettings.get(business.id);
            console.log('[POS Modal] IndexedDB enableEis:', settings?.enableEis);
            
            if (settings?.enableEis) {
              console.log('[POS Modal] EIS is enabled from IndexedDB');
              setEisEnabled(true);
            } else {
              console.log('[POS Modal] EIS is disabled');
              setEisEnabled(false);
            }
          }
        } catch (error) {
          console.error('[POS Modal] Failed to load EIS status:', error);
          setEisEnabled(false);
        }
      }
    };
    loadEisStatus();
  }, [business?.id, isOpen, resolveBlockSalesIfTaxMappingMissing]);

  // Fetch inventory from backend when modal opens to ensure we have current branch data
  // Falls back to local DB if offline or backend fails
  useEffect(() => {
    if (!isOpen || !branchId) {
      setIsLoadingInventory(false);
      return;
    }

    if (isOpen && branchId) {
      const fetchInventoryFromBackend = async () => {
        setIsLoadingInventory(true);
        try {
          // Check if online
          if (!navigator.onLine) {
            console.log('[POS Modal] Offline - using cached inventory for branch:', branchId);
            return;
          }

          const backendBranchId = toBackendBranchId(branchId);
          if (!backendBranchId) {
            console.warn('[POS Modal] Missing branch id for backend inventory sync');
            return;
          }
          
          console.log('[POS Modal] Refreshing inventory from backend for branch:', backendBranchId);

          const { syncService } = await import('@/lib/services/sync-service');
          await syncService.fetchAllInventoryFromBackend(branchId);

          const branchCandidates = getBranchIdCandidates(branchId);
          const refreshedItems = branchCandidates.length > 0
            ? await db.inventory.where('branchId').anyOf(branchCandidates).toArray()
            : await db.inventory.where({ branchId: branchId }).toArray();

          console.log('[POS Modal] Inventory cache now has', refreshedItems.length, 'items for branch:', branchId);

            // Keep MRA mappings in sync with inventory so product cards and add-to-cart checks stay accurate.
            try {
              const mappingsResponse = await authFetch.fetch<any>(`/inventory/mra-mappings/?branch_id=${encodeURIComponent(backendBranchId)}`);
              let mappings: any[] = [];

              if (Array.isArray(mappingsResponse)) {
                mappings = mappingsResponse;
              } else if (mappingsResponse?.results && Array.isArray(mappingsResponse.results)) {
                mappings = mappingsResponse.results;
              }

              const nowIso = new Date().toISOString();
              for (const rawMapping of mappings) {
                const mappingItemId = resolveMappingInventoryItemId(rawMapping);
                if (!mappingItemId) {
                  continue;
                }

                const taxType = rawMapping.mra_tax_type === 'zero' || rawMapping.mra_tax_type === 'exempt'
                  ? rawMapping.mra_tax_type
                  : (rawMapping.mraTaxType === 'zero' || rawMapping.mraTaxType === 'exempt' ? rawMapping.mraTaxType : 'standard');
                const calculationMethod = String(
                  rawMapping.tax_calculation_method ??
                  rawMapping.taxCalculationMethod ??
                  rawMapping.calculation_method ??
                  rawMapping.calculationMethod ??
                  ''
                ).trim().toLowerCase().startsWith('excl')
                  ? 'exclusive'
                  : 'inclusive';

                await db.mraMappings.put({
                  id: String(rawMapping.id || `${mappingItemId}-mapping`),
                  inventoryItemId: mappingItemId,
                  branchId: normalizeBranchId(
                    rawMapping.branch ??
                    rawMapping.branch_id ??
                    backendBranchId
                  ) || undefined,
                  mraProductCode: rawMapping.mra_product_code || rawMapping.mraProductCode || '',
                  mraProductName: rawMapping.mra_product_name || rawMapping.mraProductName || '',
                  mraTaxType: taxType,
                  mraTaxRate: Number(rawMapping.mra_tax_rate ?? rawMapping.mraTaxRate ?? 0),
                  mraUnitMeasure: rawMapping.mra_unit_measure || rawMapping.mraUnitMeasure || '',
                  taxCalculationMethod: calculationMethod,
                  isApproved: Boolean(rawMapping.is_approved ?? rawMapping.isApproved),
                  approvedAt: rawMapping.approved_at || rawMapping.approvedAt || undefined,
                  mraSynced: Boolean(rawMapping.mra_synced ?? rawMapping.mraSynced),
                  lastSyncedAt: rawMapping.last_synced_at || rawMapping.lastSyncedAt || undefined,
                  createdAt: rawMapping.created_at || rawMapping.createdAt || nowIso,
                  updatedAt: nowIso,
                  _dirty: false,
                  _synced_at: nowIso,
                });
              }

              console.log('[POS Modal] Synced', mappings.length, 'MRA mappings for branch:', backendBranchId);
            } catch (mappingError) {
              console.warn('[POS Modal] Failed to refresh MRA mappings for POS open:', mappingError);
            }
        } catch (error) {
          console.error('[POS Modal] Error fetching inventory from backend:', error);
          console.log('[POS Modal] Falling back to cached inventory for branch:', branchId);
        } finally {
          setIsLoadingInventory(false);
        }
      };
      
      fetchInventoryFromBackend();
    }
  }, [isOpen, branchId]);

  const sellableItems = useMemo(
    () => {
      if (!allInventory) return [];
      const isFuelAttendant = Boolean(user?.isFuelAttendant);

      let items = [...allInventory];
      items = items.filter((item) => {
        const isFuelItem = Boolean(item.isFuel);
        if (isFuelAttendant) {
          return isFuelItem;
        }
        return !isFuelItem;
      });

      if (!normalizedSearchQuery) {
        return [];
      }

      items = items.filter((item) => (
        item.name?.toLowerCase().includes(normalizedSearchQuery) ||
        item.id?.toLowerCase().includes(normalizedSearchQuery) ||
        item.barcode?.toLowerCase().includes(normalizedSearchQuery) ||
        item.sku?.toLowerCase().includes(normalizedSearchQuery) ||
        item.productCode?.toLowerCase().includes(normalizedSearchQuery) ||
        item.category?.toLowerCase().includes(normalizedSearchQuery) ||
        item.supplier?.toLowerCase().includes(normalizedSearchQuery) ||
        item.manufacturer?.toLowerCase().includes(normalizedSearchQuery) ||
        item.brand?.toLowerCase().includes(normalizedSearchQuery) ||
        item.batch?.toLowerCase().includes(normalizedSearchQuery) ||
        item.unitType?.toLowerCase().includes(normalizedSearchQuery) ||
        item.packSize?.toString().toLowerCase().includes(normalizedSearchQuery)
      ));

      return items;
    },
    [allInventory, normalizedSearchQuery, user?.isFuelAttendant]
  );
  
  const handleAddToCart = useCallback(async (item: InventoryItem, quantity: number = 1, price?: number, notes?: string) => {
    console.log('[POS Modal] handleAddToCart called:', item.name, 'quantity:', quantity, 'eisEnabled:', eisEnabled);

    if (blockSalesIfTaxMappingMissing) {
      // ALWAYS check if product has APPROVED AND SYNCED MRA mapping (regardless of EIS status)
      // Backend requires BOTH is_approved AND mra_synced to be true for sale
      // This is required for MRA compliance - MANDATORY CHECK
      try {
        console.log('[POS Modal] Checking MRA mapping for product:', item.id);
        
        let isReadyForSale = false;
        let mappingStatus = 'unknown';

        // Fast path: local cache first so add-to-cart stays responsive.
        try {
          const itemId = String(item.id);
          const directLocalMappings = await db.mraMappings
            .where('inventoryItemId')
            .equals(itemId)
            .toArray();
          let localMapping = pickPreferredMapping(filterMappingsForBranch(directLocalMappings, branchId));

          // Legacy fallback for mappings saved with inventoryItem/inventory_item but missing inventoryItemId.
          if (!localMapping) {
            const allMappings = await db.mraMappings.toArray();
            const scopedMappings = filterMappingsForBranch(allMappings, branchId);
            const lookup = buildMappingLookup(scopedMappings);
            localMapping = lookup.get(itemId);
          }
          
          const localApproved = Boolean(localMapping?.isApproved ?? localMapping?.is_approved);
          const localSynced = Boolean(localMapping?.mraSynced ?? localMapping?.mra_synced);

          if (localMapping && localApproved && localSynced) {
            console.log('[POS Modal] ✓ Found APPROVED & SYNCED MRA mapping in local database for:', item.name);
            isReadyForSale = true;
            mappingStatus = 'ready';
          } else if (localMapping && !localApproved) {
            console.log('[POS Modal] ⚠ MRA mapping found but NOT APPROVED for:', item.name);
            mappingStatus = 'pending';
          } else if (localMapping && !localSynced) {
            console.log('[POS Modal] ⚠ MRA mapping found but NOT SYNCED for:', item.name);
            mappingStatus = 'unsynced';
          } else {
            mappingStatus = 'missing';
          }
        } catch (dbError) {
          console.warn('[POS Modal] Error checking local database:', dbError);
          mappingStatus = 'missing';
        }
        
        // Fallback to API only when local mapping is missing or not ready.
        if (!isReadyForSale && navigator.onLine) {
          try {
            const backendBranchId = toBackendBranchId(branchId);
            if (!backendBranchId) {
              throw new Error('Missing branch id for MRA mapping validation');
            }
            const response = await authFetch.fetch<any>(
              `/inventory/mra-mappings/?inventory_item=${encodeURIComponent(String(item.id))}&branch_id=${encodeURIComponent(backendBranchId)}`
            );
            
            let mappings: any[] = [];
            if (Array.isArray(response)) {
              mappings = response;
            } else if (response?.results && Array.isArray(response.results)) {
              mappings = response.results;
            }

            if (mappings.length === 0) {
              mappingStatus = 'missing';
            } else {
              const readyMapping = mappings.find(m => Boolean(m.is_approved ?? m.isApproved) && Boolean(m.mra_synced ?? m.mraSynced));
              if (readyMapping) {
                isReadyForSale = true;
                mappingStatus = 'ready';

                // Cache backend-verified mapping locally to keep next clicks instant.
                try {
                  const taxType = readyMapping.mra_tax_type === 'zero' || readyMapping.mra_tax_type === 'exempt'
                    ? readyMapping.mra_tax_type
                    : (readyMapping.mraTaxType === 'zero' || readyMapping.mraTaxType === 'exempt' ? readyMapping.mraTaxType : 'standard');
                  const calculationMethod = String(
                    readyMapping.tax_calculation_method ??
                    readyMapping.taxCalculationMethod ??
                    readyMapping.calculation_method ??
                    readyMapping.calculationMethod ??
                    ''
                  ).trim().toLowerCase().startsWith('excl')
                    ? 'exclusive'
                    : 'inclusive';
                  const nowIso = new Date().toISOString();
                  const mappingItemId = resolveMappingInventoryItemId(readyMapping) || String(item.id);

                  await db.mraMappings.put({
                    id: String(readyMapping.id || `${mappingItemId}-mapping`),
                    inventoryItemId: mappingItemId,
                    branchId: normalizeBranchId(
                      readyMapping.branch ??
                      readyMapping.branch_id ??
                      backendBranchId
                    ) || undefined,
                    mraProductCode: readyMapping.mra_product_code || readyMapping.mraProductCode || '',
                    mraProductName: readyMapping.mra_product_name || readyMapping.mraProductName || item.name,
                    mraTaxType: taxType,
                    mraTaxRate: Number(readyMapping.mra_tax_rate ?? readyMapping.mraTaxRate ?? 0),
                    mraUnitMeasure: readyMapping.mra_unit_measure || readyMapping.mraUnitMeasure || '',
                    taxCalculationMethod: calculationMethod,
                    isApproved: Boolean(readyMapping.is_approved ?? readyMapping.isApproved),
                    approvedAt: readyMapping.approved_at || readyMapping.approvedAt || undefined,
                    mraSynced: Boolean(readyMapping.mra_synced ?? readyMapping.mraSynced),
                    lastSyncedAt: nowIso,
                    createdAt: readyMapping.created_at || readyMapping.createdAt || nowIso,
                    updatedAt: nowIso,
                  });
                } catch (cacheError) {
                  console.warn('[POS Modal] Failed to cache MRA mapping after API check:', cacheError);
                }
              } else {
                const approvedButNotSynced = mappings.find(
                  (m) => Boolean(m.is_approved ?? m.isApproved) && !Boolean(m.mra_synced ?? m.mraSynced)
                );
                mappingStatus = approvedButNotSynced ? 'unsynced' : 'pending';
              }
            }
          } catch (error) {
            console.error('[POS Modal] Error checking MRA mapping from API:', error);
            toast({
              variant: 'destructive',
              title: 'Error',
              description: 'Failed to verify MRA mapping for this product. Please try again.',
            });
            return;
          }
        }
        
        // Block sale if not ready for sale
        if (!isReadyForSale) {
          let errorTitle = 'MRA Mapping Required';
          let errorDescription = `${item.name} cannot be sold - MRA mapping issue.`;
          
          if (mappingStatus === 'pending') {
            errorTitle = 'MRA Mapping Pending Approval';
            errorDescription = `${item.name} has a pending MRA mapping. Go to Inventory → MRA Mappings to approve it.`;
          } else if (mappingStatus === 'unsynced') {
            errorTitle = 'MRA Mapping Not Synced';
            errorDescription = `${item.name} mapping is approved but not synced to MRA. Please sync it first.`;
          } else if (mappingStatus === 'missing') {
            errorTitle = 'MRA Mapping Missing';
            errorDescription = `${item.name} has no MRA mapping. Go to Inventory → MRA Mappings to create one.`;
          }
          
          toast({
            variant: 'destructive',
            title: errorTitle,
            description: errorDescription,
          });
          console.log('[POS Modal] ✗ BLOCKED add to cart - MRA mapping not ready for:', item.name, '(status:', mappingStatus + ')');
          return;
        }
      } catch (error) {
        console.error('[POS Modal] Unexpected error checking MRA mapping:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to verify MRA mapping for this product.',
        });
        return;
      }
    } else {
      console.log('[POS Modal] Tax mapping enforcement disabled, skipping MRA mapping validation for:', item.name);
    }

    setCart((prevCart) => {
      // Check if item is produced (unlimited quantity allowed)
      if (!item.isProduced) {
        // For non-produced items, enforce stock limit
        const currentCartQuantity = prevCart.reduce((acc, cartItem) => 
          resolveCartInventoryItemId(cartItem) === String(item.id) ? acc + cartItem.quantity : acc, 0
        );
        const remainingStock = (item.stockUnits || 0) - currentCartQuantity;
        
        if (remainingStock <= 0) {
          toast({ 
            variant: 'destructive', 
            title: 'Out of Stock', 
            description: `${item.name} is out of stock.` 
          });
          return prevCart;
        }
        
        if (quantity > remainingStock) {
          toast({ 
            variant: 'destructive', 
            title: 'Insufficient Stock', 
            description: `Only ${remainingStock} ${item.unitType || 'units'} of ${item.name} available.` 
          });
          return prevCart;
        }
      }

      const existingItemIndex = prevCart.findIndex(
        (cartItem) => resolveCartInventoryItemId(cartItem) === String(item.id)
      );
      const itemPrice = price !== undefined ? price : (item.price || 0);

      if (existingItemIndex > -1) {
        // Item already in cart, increment quantity
        const newCart = [...prevCart];
        const oldQuantity = newCart[existingItemIndex].quantity;
        const oldPrice = newCart[existingItemIndex].price;
        newCart[existingItemIndex].quantity += quantity;
        if (item.isVariablePrice) {
          // Variable-price items store line total in `price`, so accumulate both.
          newCart[existingItemIndex].price += itemPrice;
        }
        console.log('[POS Modal] Incremented item:', item.name, 'old quantity:', oldQuantity, 'new quantity:', newCart[existingItemIndex].quantity);
        if (item.isVariablePrice) {
          console.log('[POS Modal] Incremented variable item total:', item.name, 'old total:', oldPrice, 'new total:', newCart[existingItemIndex].price);
        }
        return newCart;
      } else {
        // New item, add to cart
        console.log('[POS Modal] Added new item:', item.name, 'quantity:', quantity);
        return [
          ...prevCart,
          {
            ...item,
            id: item.id,
            inventoryItemId: String(item.id),
            quantity: quantity,
            price: itemPrice,
            notes,
          }
        ];
      }
    });
  }, [toast, eisEnabled, blockSalesIfTaxMappingMissing]);
  
  const handleUpdateQuantity = (itemId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      setCart((prevCart) => prevCart.filter((cartItem) => cartItem.id !== itemId));
    } else {
      setCart((prevCart) =>
        prevCart.map((cartItem) =>
          cartItem.id === itemId ? { ...cartItem, quantity: newQuantity } : cartItem
        )
      );
    }
  };

  const handleClearCart = () => setCart([]);

  const normalizeBarcodeValue = (value: string): string => value.trim().replace(/\s+/g, '');

  const handleCameraBarcodeDetected = useCallback(async (barcode: string): Promise<BarcodeDetectionOutcome> => {
    const normalizedScannedBarcode = normalizeBarcodeValue(barcode);
    if (!normalizedScannedBarcode) {
      return {
        accepted: false,
        message: 'Invalid barcode value.',
      };
    }

    const matchedProduct = allInventory?.find((item) => {
      const itemBarcode = normalizeBarcodeValue(String(item.barcode || ''));
      return itemBarcode !== '' && itemBarcode === normalizedScannedBarcode;
    });

    if (!matchedProduct) {
      toast({
        variant: 'destructive',
        title: 'Product Not Found',
        description: `No product found with barcode: ${barcode}`,
      });
      return {
        accepted: false,
        message: `No product found with barcode: ${barcode}`,
      };
    }

    await handleAddToCart(matchedProduct, 1);
    return {
      accepted: true,
      productName: matchedProduct.name,
    };
  }, [allInventory, handleAddToCart, toast]);

  // Barcode scanner listener - search product by barcode and auto-add to cart
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Get the active element
      const activeElement = document.activeElement as HTMLElement;
      const isInputFocused = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';
      
      // Only process printable characters and Enter
      if (e.key === 'Enter') {
        // Process the barcode buffer
        if (barcodeBuffer.trim()) {
          console.log('[POS Modal] Processing barcode:', barcodeBuffer);
          
          // Search for product by barcode
          const product = allInventory?.find(item => 
            item.barcode === barcodeBuffer.trim()
          );
          
          if (product) {
            console.log('[POS Modal] Found product by barcode:', product.name);
            handleAddToCart(product, 1);
            toast({
              title: 'Added to Cart',
              description: `${product.name} added to cart`,
            });
          } else {
            console.log('[POS Modal] No product found with barcode:', barcodeBuffer);
            toast({
              variant: 'destructive',
              title: 'Product Not Found',
              description: `No product found with barcode: ${barcodeBuffer}`,
            });
          }
          
          // Clear the buffer
          setBarcodeBuffer('');
          
          // Clear any existing timeout
          if (barcodeTimeout) {
            clearTimeout(barcodeTimeout);
            setBarcodeTimeout(null);
          }
          
          // Prevent default Enter behavior
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      // Check if this is a printable character (barcode scanner input)
      // Only capture if not typing in search field or if we already have a barcode buffer
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // If we have a barcode buffer, capture all input
        // Otherwise, only capture if not in search field
        if (barcodeBuffer.length > 0 || !isInputFocused) {
          // Add character to buffer
          const newBuffer = barcodeBuffer + e.key;
          setBarcodeBuffer(newBuffer);
          console.log('[POS Modal] Barcode buffer:', newBuffer);
          
          // Clear existing timeout
          if (barcodeTimeout) {
            clearTimeout(barcodeTimeout);
          }
          
          // Set new timeout to clear buffer if no Enter is pressed within 100ms
          // (barcode scanners typically send all characters rapidly followed by Enter)
          const timeout = setTimeout(() => {
            console.log('[POS Modal] Barcode timeout - clearing buffer:', newBuffer);
            setBarcodeBuffer('');
            setBarcodeTimeout(null);
          }, 100);
          
          setBarcodeTimeout(timeout);
          
          // Prevent default behavior to stop modal from getting focus
          e.preventDefault();
          e.stopPropagation();
          
          // Blur any focused element to prevent modal focus
          if (activeElement && activeElement !== document.body) {
            activeElement.blur();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (barcodeTimeout) {
        clearTimeout(barcodeTimeout);
      }
    };
  }, [isOpen, allInventory, barcodeBuffer, barcodeTimeout, handleAddToCart, toast]);

  const handleCreateOrder = async (paymentMethod: PaymentMethod, tip: number, buyerDetails?: BuyerDetails): Promise<Order | null> => {
    if (!cart.length) {
      toast({ variant: 'destructive', title: 'Cart is empty' });
      return null;
    }
    if (!branchId) {
       toast({ variant: 'destructive', title: 'No active branch', description: 'Could not determine the active branch.' });
       return null;
    }
    const sessionForOrder = await resolveSessionForCheckout();
    if (!sessionForOrder) {
      toast({ variant: 'destructive', title: 'No active session', description: 'Please start a session to record sales.' });
      return null;
    }

    const buyerName = buyerDetails?.name?.trim();
    const buyerPhone = buyerDetails?.phone?.trim();
    const buyerTin = buyerDetails?.tin?.trim();
    const buyerFields: Partial<Order> = {};

    if (buyerName) {
      buyerFields.customerName = buyerName;
      buyerFields.customer_name = buyerName;
    }
    if (buyerPhone) {
      buyerFields.customerPhone = buyerPhone;
      buyerFields.customer_phone = buyerPhone;
    }
    if (buyerTin) {
      buyerFields.customerTin = buyerTin;
      buyerFields.customer_tin = buyerTin;
    }
    
    // Validate MRA mappings from local snapshot only.
    // Add-to-cart already verifies mapping online and caches it locally.
    const localMappings = filterMappingsForBranch(await db.mraMappings.toArray(), branchId);
    const mappingByItemId = buildMappingLookup(localMappings);

    if (blockSalesIfTaxMappingMissing) {
      const unmappedProducts: string[] = [];
      const unapprovedProducts: string[] = [];
      const unsyncedProducts: string[] = [];

      for (const cartItem of cart) {
        const cartInventoryItemId = resolveCartInventoryItemId(cartItem);
        const localMapping = mappingByItemId.get(cartInventoryItemId);

        if (!localMapping) {
          unmappedProducts.push(cartItem.name);
          continue;
        }

        const isApproved = Boolean(localMapping.isApproved ?? localMapping.is_approved);
        const isSynced = Boolean(localMapping.mraSynced ?? localMapping.mra_synced);

        if (!isApproved) {
          unapprovedProducts.push(cartItem.name);
          continue;
        }

        if (!isSynced) {
          unsyncedProducts.push(cartItem.name);
        }
      }
      
      // Block sale if any products are unmapped or unapproved
      if (unmappedProducts.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Unmapped Products',
          description: `Cannot sell: ${unmappedProducts.join(', ')}. Please map these products to MRA codes first.`,
        });
        return null;
      }
      
      if (unapprovedProducts.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Unapproved Mappings',
          description: `Cannot sell: ${unapprovedProducts.join(', ')}. Please approve the MRA mappings first.`,
        });
        return null;
      }

      if (unsyncedProducts.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Unsynced Mappings',
          description: `Cannot sell: ${unsyncedProducts.join(', ')}. Please sync these mappings first.`,
        });
        return null;
      }
    }
    
    // Build tax snapshot from approved+synced mappings for consistent order math.
    // When mapping enforcement is disabled, fall back to the default tax rate for unmapped items.
    let cartItemTaxRates: Record<string, { rate: number; taxType: 'standard' | 'zero' | 'exempt'; calculationMethod: 'inclusive' | 'exclusive' }> = {};
    const shouldApplyDefaultTax = !blockSalesIfTaxMappingMissing && Boolean(defaultTaxRate);
    const defaultTaxType = defaultTaxRate ? normalizeMappedTaxType(defaultTaxRate.taxType) : 'standard';
    const rawDefaultRate = defaultTaxRate ? toTaxRateDecimal(defaultTaxRate.rate) : 0;
    const normalizedDefaultRate = defaultTaxType === 'zero' || defaultTaxType === 'exempt' ? 0 : rawDefaultRate;

    for (const cartItem of cart) {
      const cartInventoryItemId = resolveCartInventoryItemId(cartItem);
      const mapping = mappingByItemId.get(cartInventoryItemId);
      const mappingReady = Boolean(mapping && (mapping.isApproved ?? mapping.is_approved) && (mapping.mraSynced ?? mapping.mra_synced));

      if (mappingReady) {
        const taxType = normalizeMappedTaxType(mapping.mraTaxType ?? mapping.mra_tax_type);
        const rawRate = mapping.mraTaxRate ?? mapping.mra_tax_rate ?? 0;
        const normalizedRate = taxType === 'zero' || taxType === 'exempt' ? 0 : toTaxRateDecimal(rawRate);
        const calculationMethod = String(mapping.taxCalculationMethod ?? mapping.tax_calculation_method).trim().toLowerCase() === 'exclusive'
          ? 'exclusive'
          : 'inclusive';

        cartItemTaxRates[cartInventoryItemId] = {
          rate: normalizedRate,
          taxType,
          calculationMethod,
        };
        continue;
      }

      if (shouldApplyDefaultTax) {
        cartItemTaxRates[cartInventoryItemId] = {
          rate: normalizedDefaultRate,
          taxType: defaultTaxType,
          calculationMethod: 'inclusive',
        };
      }
    }
    
    // Calculate tax per item using product-specific rates or default
    // CRITICAL: Respect inclusive/exclusive tax calculation method per product
    let subtotal = 0;
    let tax = 0;
    
    for (const cartItem of cart) {
      const itemPrice = Number(cartItem.price || 0);
      const itemQuantity = Number(cartItem.quantity || 0);
      const itemGross = cartItem.isVariablePrice ? itemPrice : itemPrice * itemQuantity; // Variable-price items store line total in `price`
      const cartInventoryItemId = resolveCartInventoryItemId(cartItem);
      
      // Use product-specific tax rate if available, otherwise use default
      let itemTax = 0;
      let itemSubtotal = itemGross;
      let calculationMethod = 'inclusive'; // Default
      
      if (cartItemTaxRates[cartInventoryItemId]) {
        const { rate, taxType, calculationMethod: method } = cartItemTaxRates[cartInventoryItemId];
        calculationMethod = method;
        
        // Handle different tax types
        if (taxType === 'zero' || taxType === 'exempt') {
          // Zero-rated or exempt items have 0% tax
          itemTax = 0;
          itemSubtotal = itemGross;
          console.log(`[Order] Item: ${cartItem.name}, Gross: ${itemGross}, Tax Type: ${taxType.toUpperCase()}, Tax: 0, Subtotal: ${itemSubtotal}`);
        } else if (calculationMethod === 'exclusive') {
          // Tax exclusive: price excludes tax, so tax is added
          // itemTax = itemGross * rate
          // itemSubtotal = itemGross (price is already net)
          itemTax = itemGross * rate;
          itemSubtotal = itemGross;
          console.log(`[Order] Item: ${cartItem.name}, EXCLUSIVE tax - Subtotal: ${itemSubtotal}, Tax Rate: ${(rate * 100).toFixed(2)}%, Tax: ${itemTax.toFixed(2)}, Gross: ${(itemSubtotal + itemTax).toFixed(2)}`);
        } else {
          // Tax inclusive: price includes tax, so tax is extracted
          // itemTax = itemGross / (1 + rate) * rate
          // itemSubtotal = itemGross - itemTax
          itemTax = itemGross / (1 + rate) * rate;
          itemSubtotal = itemGross - itemTax;
          console.log(`[Order] Item: ${cartItem.name}, INCLUSIVE tax - Gross: ${itemGross}, Tax Rate: ${(rate * 100).toFixed(2)}%, Tax: ${itemTax.toFixed(2)}, Subtotal: ${itemSubtotal.toFixed(2)}`);
        }
      } else {
        // Fallback to default tax rate (assume inclusive)
        const defaultRate = defaultTaxRate ? defaultTaxRate.rate / 100 : 0;
        if (defaultRate > 0) {
          itemTax = itemGross / (1 + defaultRate) * defaultRate;
          itemSubtotal = itemGross - itemTax;
          console.log(`[Order] Item: ${cartItem.name}, INCLUSIVE tax (default) - Gross: ${itemGross}, Tax Rate: ${(defaultRate * 100).toFixed(2)}%, Tax: ${itemTax.toFixed(2)}, Subtotal: ${itemSubtotal.toFixed(2)}`);
        } else {
          itemTax = 0;
          itemSubtotal = itemGross;
          console.log(`[Order] Item: ${cartItem.name}, No tax - Subtotal: ${itemSubtotal}`);
        }
      }
      
      subtotal += itemSubtotal;
      tax += itemTax;
    }
    
    const total = subtotal + tax + tip;
    let orderCogs = 0;
    let finalOrder: Order | null = null;

    try {
      // Track stock recalculation candidates and items that required direct inventory fallback.
      // If fallback is used, recalculation would overwrite the manual decrement when no batch exists.
      const itemsToRecalculateStock = new Set<string>();
      const itemsWithFallbackStockDeduction = new Set<string>();

      await db.transaction('rw', db.inventory, db.orders, db.sessions, db.purchaseHistory, async () => {
        const now = new Date();
        
        for (const cartItem of cart) {
            const originalItemId = resolveCartInventoryItemId(cartItem);
            const originalItem = allInventory?.find(i => String(i.id) === String(originalItemId));

            if (!originalItem) {
              console.warn(`[Order] Item not found in inventory: ${originalItemId}`);
              continue;
            }

            const cartQuantity = toPositiveNumber(cartItem.quantity, 0);
            if (cartQuantity <= 0) {
              console.warn(`[Order] Invalid cart quantity for ${originalItemId}:`, cartItem.quantity);
              continue;
            }

            // Determine what to decrement:
            // - If produced sellable item with recipe: decrement ingredients
            // - Otherwise: decrement the item itself
            const itemsToDecrement = (originalItem.itemType === 'sellable' && originalItem.isProduced && originalItem.recipe?.length)
                ? originalItem.recipe
                    .map(ri => {
                      const ingredientId = String(ri?.ingredientId || '');
                      const ingredientQty = toPositiveNumber(ri?.quantity, 0);
                      return {
                        id: ingredientId,
                        quantity: ingredientQty * cartQuantity,
                      };
                    })
                    .filter(entry => entry.id && entry.quantity > 0)
                : [{ id: originalItemId, quantity: cartQuantity }];
            
            console.log(`[Order] Processing item: ${originalItem.name}`, {
              isProduced: originalItem.isProduced,
              hasRecipe: !!originalItem.recipe?.length,
              itemsToDecrement: itemsToDecrement.length,
              cartQuantity: cartItem.quantity
            });
            
            for (const itemToDecrement of itemsToDecrement) {
                let quantityToDecrement = toPositiveNumber(itemToDecrement.quantity, 0);
                if (quantityToDecrement <= 0) {
                  console.warn(`[Order] Skipping invalid decrement quantity for ${itemToDecrement.id}:`, itemToDecrement.quantity);
                  continue;
                }

                const inventoryItemToUpdate = await db.inventory
                  .where('branchId')
                  .equals(branchId)
                  .filter(item => String(item.id) === String(itemToDecrement.id))
                  .first();

                if (!inventoryItemToUpdate) {
                  console.warn(`[Order] Inventory item not found for decrement: ${itemToDecrement.id}`);
                  continue;
                }

                // Query batches for this product with remaining quantity.
                // First try indexed lookup, then fallback to normalized id compare (handles string/number mismatches).
                let batches = await db.purchaseHistory
                  .where({ branchId, productId: itemToDecrement.id as any })
                  .and(batch => (batch.quantityRemaining || 0) > 0)
                  .toArray();

                if (batches.length === 0) {
                  batches = await db.purchaseHistory
                    .where('branchId')
                    .equals(branchId)
                    .filter(batch =>
                      String(batch.productId) === String(itemToDecrement.id) &&
                      (batch.quantityRemaining || 0) > 0
                    )
                    .toArray();
                }

                // Sort batches for FIFO with expiry awareness:
                // 1. Expired batches first (to clear them)
                // 2. Then by expiry date (soonest first)
                // 3. Then by received date (oldest first - FIFO)
                const sortedBatches = batches.sort((a, b) => {
                    const aExpiry = a.expiryDate ? new Date(a.expiryDate) : null;
                    const bExpiry = b.expiryDate ? new Date(b.expiryDate) : null;
                    const aReceived = new Date(a.receivedDate);
                    const bReceived = new Date(b.receivedDate);
                    
                    // Check if expired
                    const aIsExpired = aExpiry && aExpiry < now;
                    const bIsExpired = bExpiry && bExpiry < now;
                    
                    // Expired batches first
                    if (aIsExpired && !bIsExpired) return -1;
                    if (!aIsExpired && bIsExpired) return 1;
                    
                    // If both expired or both not expired, sort by expiry date (soonest first)
                    if (aExpiry && bExpiry) {
                        if (aExpiry.getTime() !== bExpiry.getTime()) {
                            return aExpiry.getTime() - bExpiry.getTime();
                        }
                    }
                    
                    // If expiry dates are same or both null, use FIFO (oldest received first)
                    return aReceived.getTime() - bReceived.getTime();
                });

                console.log(`[Order] FIFO sorting for ${itemToDecrement.id}:`, {
                    totalBatches: sortedBatches.length,
                    batches: sortedBatches.map(b => ({
                        id: b.id,
                        batchNumber: b.batchNumber,
                        quantityRemaining: b.quantityRemaining,
                        expiryDate: b.expiryDate,
                        receivedDate: b.receivedDate,
                        isExpired: b.expiryDate ? new Date(b.expiryDate) < now : false
                    }))
                });

                let totalDecrementedFromBatches = 0;
                for (const batch of sortedBatches) {
                    if (quantityToDecrement <= 0) break;

                    const batchQuantityRemaining = toNonNegativeNumber(batch.quantityRemaining, 0);
                    if (batchQuantityRemaining <= 0) {
                      continue;
                    }

                    const decrementAmount = Math.min(quantityToDecrement, batchQuantityRemaining);
                    if (!Number.isFinite(decrementAmount) || decrementAmount <= 0) {
                      continue;
                    }

                    const newQuantityRemaining = Math.max(0, batchQuantityRemaining - decrementAmount);
                    const isBatchFinished = newQuantityRemaining === 0;
                    
                    console.log(`[Order] Batch Deduction - ${batch.batchNumber || batch.id}:`, {
                        batchId: batch.id,
                        batchNumber: batch.batchNumber || 'N/A',
                        quantityNeeded: quantityToDecrement,
                        quantityAvailableInBatch: batchQuantityRemaining,
                        quantityUsedFromBatch: decrementAmount,
                        quantityRemainingAfter: newQuantityRemaining,
                        batchFinished: isBatchFinished,
                        expiryDate: batch.expiryDate || 'No expiry',
                        costPerUnit: batch.costPerUnit,
                        costForThisBatch: decrementAmount * batch.costPerUnit
                    });
                    
                    await db.purchaseHistory.update(batch.id!, {
                        quantityRemaining: newQuantityRemaining,
                        _dirty: true,
                        _operation: 'update'
                    });

                    orderCogs += decrementAmount * toNonNegativeNumber(batch.costPerUnit, 0);
                    quantityToDecrement -= decrementAmount;
                    totalDecrementedFromBatches += decrementAmount;
                }

                // If batch coverage is incomplete, also decrement from inventory directly to keep sale stock movement correct.
                // This protects offline/legacy datasets where purchase batches are missing or partially synced.
                let fallbackInventoryDecrement = 0;
                if (quantityToDecrement > 0) {
                  const currentItemStock = toNonNegativeNumber(inventoryItemToUpdate.stockUnits, 0);
                  const availableAfterBatch = Math.max(
                    0,
                    currentItemStock - totalDecrementedFromBatches
                  );
                  fallbackInventoryDecrement = Math.min(quantityToDecrement, availableAfterBatch);
                  quantityToDecrement -= fallbackInventoryDecrement;

                  if (fallbackInventoryDecrement > 0) {
                    itemsWithFallbackStockDeduction.add(String(itemToDecrement.id));
                    orderCogs += fallbackInventoryDecrement * toNonNegativeNumber(inventoryItemToUpdate.cost, 0);
                    console.warn(`[Order] Used inventory fallback decrement for ${itemToDecrement.id}:`, {
                      fallbackInventoryDecrement,
                      availableAfterBatch
                    });
                  }
                }

                const totalInventoryDecrement = totalDecrementedFromBatches + fallbackInventoryDecrement;
                if (totalInventoryDecrement > 0) {
                  const currentStock = toNonNegativeNumber(inventoryItemToUpdate.stockUnits, 0);
                  const newStock = Math.max(0, currentStock - totalInventoryDecrement);
                  const reorderLevel = inventoryItemToUpdate.reorderLevel || 0;
                  const newStatus =
                    newStock <= 0
                      ? 'Out of Stock'
                      : newStock <= reorderLevel
                        ? 'Low Stock'
                        : 'In Stock';

                  await db.inventory.update(inventoryItemToUpdate.id, {
                    stockUnits: newStock,
                    status: newStatus,
                    _dirty: true,
                    _operation: 'update'
                  });

                  console.log(`[Order] Inventory decremented for ${inventoryItemToUpdate.name}:`, {
                    previousStock: currentStock,
                    decrementedBy: totalInventoryDecrement,
                    newStock
                  });
                }

                if (totalDecrementedFromBatches > 0) {
                  itemsToRecalculateStock.add(String(itemToDecrement.id));
                }

                if (quantityToDecrement > 0) {
                  console.warn(`[Order] Sale consumed more than available tracked stock for ${itemToDecrement.id}. Remaining unmet quantity: ${quantityToDecrement}`);
                }
            }
        }

        const existingBranchOrders = await db.orders.where('branchId').equals(branchId).toArray();
        const maxKnownOrderNumber = existingBranchOrders.reduce((maxValue, orderRecord) => {
          const candidates = [
            Number((orderRecord as any).orderNumber),
            Number((orderRecord as any).order_number),
          ];
          for (const candidate of candidates) {
            if (Number.isFinite(candidate) && candidate > maxValue) {
              maxValue = candidate;
            }
          }
          return maxValue;
        }, 100);
        const nextOrderNumber = maxKnownOrderNumber + 1;
        const isKitchenOrder = currentBusinessType === 'Restaurant' || currentBusinessType === 'Bar & Liquor' || user?.role === 'Waiter';

        const newOrder: Order = {
          id: uuidv4(),
          orderNumber: nextOrderNumber,
          branchId: branchId,
          sessionId: sessionForOrder.id,
          pumpName: sessionForOrder.pumpName,
          orderType: 'sale',
          items: cart.map(item => {
            const inventoryItemId = resolveCartInventoryItemId(item) || String(item.id);
            // Get tax information for this specific item
            const itemTaxInfo =
              cartItemTaxRates[inventoryItemId] ||
              cartItemTaxRates[String(item.id)] ||
              { rate: 0, taxType: 'standard', calculationMethod: 'inclusive' };
            const itemLineGross = item.isVariablePrice
              ? Number(item.price || 0)
              : Number(item.price || 0) * Number(item.quantity || 0);
            const unitPriceForStorage =
              item.isVariablePrice && Number(item.quantity || 0) > 0
                ? Number(item.price || 0) / Number(item.quantity || 0)
                : Number(item.price || 0);
            let itemTax = 0;
            let itemSubtotal = itemLineGross;
            
            // Calculate tax for this item based on its tax type and calculation method
            if (itemTaxInfo.taxType === 'zero' || itemTaxInfo.taxType === 'exempt') {
              itemTax = 0;
              itemSubtotal = itemLineGross;
            } else if (itemTaxInfo.calculationMethod === 'exclusive') {
              // Tax exclusive: price excludes tax, so tax is added
              itemTax = itemLineGross * itemTaxInfo.rate;
              itemSubtotal = itemLineGross;
            } else {
              // Tax inclusive: price includes tax, so tax is extracted
              itemTax = itemLineGross / (1 + itemTaxInfo.rate) * itemTaxInfo.rate;
              itemSubtotal = itemLineGross - itemTax;
            }
            
            const snapshotTaxRate = itemTaxInfo.taxType === 'zero' || itemTaxInfo.taxType === 'exempt'
              ? 0
              : itemTaxInfo.rate * 100;

            return {
              id: uuidv4(), // Generate unique ID for each order item
              name: item.name,
              quantity: item.quantity,
              price: unitPriceForStorage, // Persist per-unit price for backend quantity x price recalculation
              notes: item.notes || '',
              // Store inventory item reference for tracking
              inventoryItemId,
              // Per-item tax information (MRA compliance - Immutable snapshot)
              taxRate: snapshotTaxRate,
              tax_rate: snapshotTaxRate,
              taxType: itemTaxInfo.taxType,
              tax_type: itemTaxInfo.taxType,
              taxCalculationMethod: itemTaxInfo.calculationMethod,
              tax_calculation_method: itemTaxInfo.calculationMethod,
              // Calculated tax amounts (Immutable snapshot for audit trail)
              subtotal: itemSubtotal,
              taxAmount: itemTax,
              total: itemSubtotal + itemTax,
            };
          }),
          status: isKitchenOrder ? 'New' : 'Completed',
          paymentMethod: paymentMethod,
          ...buyerFields,
          subtotal: Number(subtotal),
          tax: Number(tax),
          tip: Number(tip),
          total: Number(total),
          cogs: Number(orderCogs),
          eis_status: eisEnabled ? 'PENDING' : undefined,
          eisStatus: eisEnabled ? 'PENDING' : undefined,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        // Mark order as dirty for sync
        const orderWithSync: Order = {
          ...newOrder,
          _dirty: true,
          _operation: 'create'
        };
        await db.orders.add(orderWithSync);
        finalOrder = orderWithSync;
        console.log('[Sync] Marked order as dirty:', newOrder.id);

        const sessionUpdate: Partial<Session> = {
            totalSales: (sessionForOrder.totalSales || 0) + subtotal,
            totalTips: (sessionForOrder.totalTips || 0) + tip,
        };

        const saleAmount = total - tip;
        switch(paymentMethod) {
            case 'Cash':
                sessionUpdate.totalCashSales = (sessionForOrder.totalCashSales || 0) + saleAmount;
                sessionUpdate.expectedCash = (sessionForOrder.expectedCash || 0) + saleAmount;
                break;
            case 'Card':
                 sessionUpdate.totalCardSales = (sessionForOrder.totalCardSales || 0) + saleAmount;
                 break;
            case 'Mobile Money':
                 sessionUpdate.totalMobileMoneySales = (sessionForOrder.totalMobileMoneySales || 0) + saleAmount;
                 break;
            case 'On Account':
                 sessionUpdate.totalOnAccountSales = (sessionForOrder.totalOnAccountSales || 0) + saleAmount;
                 break;
            case 'Other':
                 sessionUpdate.totalOtherSales = (sessionForOrder.totalOtherSales || 0) + saleAmount;
                 break;
        }

        await db.sessions.update(sessionForOrder.id, sessionUpdate);
      });

      if (finalOrder && user) {
        await logAuditAction({
          userId: user.uid,
          userName: user.displayName || user.email || 'System',
          branchId: finalOrder.branchId,
          actionType: 'ORDER_CREATE',
          entityType: 'Order',
          entityId: finalOrder.id,
          details: {
            orderNumber: finalOrder.orderNumber,
            total: finalOrder.total,
            paymentMethod: finalOrder.paymentMethod,
            items: finalOrder.items.length,
          },
        });
      }

      // Recalculate inventory for items fully tracked by batches.
      // Skip items where fallback stock decrement was used, otherwise recalculation can undo the fallback deduction.
      if (itemsToRecalculateStock.size > 0) {
        const { updateInventoryStockUnits } = await import('@/lib/services/stock-calculator');
        for (const itemId of itemsToRecalculateStock) {
          if (itemsWithFallbackStockDeduction.has(itemId)) {
            console.log(`[Order] Skipping stock recalculation for ${itemId} due to inventory fallback deduction`);
            continue;
          }

          try {
            await updateInventoryStockUnits(itemId, branchId);
            console.log(`[Order] Updated stock units for item: ${itemId}`);
          } catch (err) {
            console.error(`[Order] Failed to update stock units for item ${itemId}:`, err);
          }
        }
      }

      if (finalOrder && typeof window !== 'undefined' && navigator.onLine) {
        // Don't block checkout UX on full sync. Sync runs in background.
        void (async () => {
          try {
            const { syncService } = await import('@/lib/services/sync-service');
            await syncService.performFullSync(branchId);
            console.log('[Order] Background sync completed after order creation');
          } catch (err) {
            console.error('[Order] Background sync failed after order creation:', err);
          }
        })();
      }

      const displayOrderNumber = (finalOrder as any)?.orderNumber ?? (finalOrder as any)?.order_number ?? '-';
      toast({
        title: `Order #${displayOrderNumber} Created`,
        description: `${paymentMethod} sale completed for ${total.toFixed(2)}.`,
      });

      // Clear cart from both state and IndexedDB
      handleClearCart();
      await db.cart.where('branchId').equals(branchId).delete();
      console.log('[Cart] Cleared from IndexedDB after successful sale');

      let printableOrder: Order | null = finalOrder;
      if (finalOrder?.id) {
        const latestOrder = await db.orders.get(finalOrder.id);
        if (latestOrder) {
          printableOrder = latestOrder as Order;
        }
      }

      return printableOrder;

    } catch (error) {
      console.error('Failed to create order:', error);
      toast({
        variant: 'destructive',
        title: 'Error creating order',
        description: error instanceof Error ? error.message : 'An unknown error occurred.',
      });
      return null;
    }
  };

  const renderPosForBusiness = () => {
    if ((isLoadingInventory && !hasCachedInventory) || !allInventory) {
        return (
          <Card className="flex h-full items-center justify-center">
            <CardContent className="text-center">
              <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-muted-foreground">Loading products...</p>
            </CardContent>
          </Card>
        )
    }
    const hasInventory = (allInventory?.length || 0) > 0;
    const emptyStateTitle = hasSearchQuery
      ? 'No products found'
      : hasInventory
        ? 'Search to show products'
        : 'No products available';
    const emptyStateDescription = hasSearchQuery
      ? 'Try adjusting your search terms.'
      : hasInventory
        ? 'Products stay hidden until you search. Barcode scanning still adds matching items to cart.'
        : 'Add items to inventory to get started.';

    // Calculate tax using MRA mappings if EIS is enabled
    let cartTax = 0;
    if (eisEnabled && cart.length > 0) {
      // We'll calculate tax in handleCreateOrder, so pass a placeholder here
      // The actual tax will be calculated when checkout is called
      cartTax = 0; // Will be recalculated in handleCreateOrder
    } else if (defaultTaxRate) {
      const cartTotal = cart.reduce((acc, item) => acc + (item.isVariablePrice ? item.price : item.price * item.quantity), 0);
      const taxRate = defaultTaxRate.rate / 100;
      cartTax = taxRate > 0 ? (cartTotal / (1 + taxRate)) * taxRate : 0;
    }

    const posProps = {
      inventory: allInventory || [],
      displayItems: sellableItems || [],
      emptyStateTitle,
      emptyStateDescription,
      cart,
      branchId,
      onAddToCart: handleAddToCart,
      onUpdateQuantity: handleUpdateQuantity,
      onClearCart: handleClearCart,
      onCheckout: handleCreateOrder,
      viewMode,
      defaultTaxRate,
      eisEnabled,
      blockSalesIfTaxMappingMissing,
    };

    switch (currentBusinessType) {
      case 'Pharmacy':
        return <PharmacyPos {...posProps} />;
      case 'Restaurant':
        return <RestaurantPos {...posProps} />;
      case 'Bar & Liquor':
        return <BarLiquorPos {...posProps} />;
      case 'Supermarket':
        return <SupermarketPos {...posProps} />;
      case 'Grocery':
        return <GroceryPos {...posProps} />;
      case 'Beauty Salon and Spa':
        return <BeautySalonPos {...posProps} />;
      default:
        return <p>No POS configuration for this business type.</p>;
    }
  };

  const hasUserSession =
    Boolean(activeSession) &&
    isSessionActive(activeSession) &&
    isSessionOwnedByCurrentUser(activeSession);

  if (!hasUserSession) {
    return (
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md" onOpenAutoFocus={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>No Active Session</DialogTitle>
          </DialogHeader>
          <div className="text-center py-6">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400 mb-4">
              <AlertTriangle />
            </div>
            <p className="text-muted-foreground mb-4">
              You must start a new session before you can make sales.
            </p>
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-full h-[90vh] flex flex-col p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogHeader className="p-3 pb-1 shrink-0">
          <DialogTitle className="text-lg">Point of Sale</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-hidden px-4 pt-4 pb-4 min-h-0">
          <div className="flex flex-col items-stretch gap-4 h-full min-h-0">
            <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:items-center shrink-0">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search to show products or scan barcode..."
                    className="w-full pl-10"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="h-10 w-10 p-0 sm:hidden"
                  title="Scan Barcode with Camera"
                  onClick={() => setShowCameraScanner(true)}
                >
                  <Camera className="h-4 w-4" />
                </Button>
                <Button 
                  variant="outline" 
                  className="h-10 w-10 p-0"
                  title="Configure Printer"
                  onClick={() => setShowPrinterConfig(true)}
                >
                  <Printer className="h-4 w-4" />
                </Button>
                <Button 
                  variant="outline" 
                  className="h-10 w-10 p-0"
                  title={viewMode === 'grid' ? 'Switch to List View' : 'Switch to Grid View'}
                  onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                >
                  {viewMode === 'grid' ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div className="flex-1 overflow-hidden min-h-0">{renderPosForBusiness()}</div>
          </div>
        </div>
      </DialogContent>

      <ScannerConfigModal isOpen={showScannerConfig} onOpenChange={setShowScannerConfig} />
      <CameraBarcodeScannerModal
        isOpen={showCameraScanner}
        onOpenChange={setShowCameraScanner}
        onBarcodeDetected={handleCameraBarcodeDetected}
      />
      <PrinterConfigModal isOpen={showPrinterConfig} onOpenChange={setShowPrinterConfig} />
    </Dialog>
  );
}
