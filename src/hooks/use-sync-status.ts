'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/auth-fetch';
import { db } from '@/lib/db';
import { useBackendReachability } from '@/hooks/use-backend-reachability';

/**
 * Hook to track pending sync items from both:
 * 1. AuthFetch queue (sessions, settings, etc.)
 * 2. Sync Service dirty flags (inventory, orders, transfers, waste, etc.)
 * 
 * Updates whenever sync status changes
 * 
 * @param branchId - Optional branch ID to filter dirty records by branch
 */
export function useSyncStatus(branchId?: string | null) {
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const { isReachable: isOnline } = useBackendReachability({ intervalMs: 10000 });
  const [dirtyRecords, setDirtyRecords] = useState<any[]>([]);
  const [failedQueueItems, setFailedQueueItems] = useState<any[]>([]);
  const [pendingQueueItems, setPendingQueueItems] = useState<any[]>([]);

  useEffect(() => {
    // Check sync status from both authFetch and Sync Service dirty flags
    const updateSyncStatus = async () => {
      try {
        const stableStringify = (value: any): string => {
          const normalize = (input: any): any => {
            if (Array.isArray(input)) {
              return input.map(normalize);
            }
            if (input && typeof input === 'object') {
              const sortedKeys = Object.keys(input).sort();
              const normalized: Record<string, any> = {};
              for (const key of sortedKeys) {
                normalized[key] = normalize(input[key]);
              }
              return normalized;
            }
            return input;
          };

          try {
            const serialized = JSON.stringify(normalize(value));
            return serialized === undefined ? 'undefined' : serialized;
          } catch {
            return String(value);
          }
        };

        const getQueueSignature = (item: any): string => {
          return [
            item?.method || '',
            item?.url || '',
            item?.domain || '',
            item?.entityType || '',
            item?.entityId || '',
            stableStringify(item?.body),
            stableStringify(item?.metadata),
          ].join('::');
        };

        const CANCELLED_KEY = 'handypos-cancelled-sync-items';
        const cancelledIds = new Set<string>(JSON.parse(localStorage.getItem(CANCELLED_KEY) || '[]'));
        const idsReferToSameEntity = (left: unknown, right: unknown): boolean => {
          const leftId = String(left || '').trim();
          const rightId = String(right || '').trim();
          if (!leftId || !rightId) return false;
          if (leftId === rightId) return true;
          const shortestLength = Math.min(leftId.length, rightId.length);
          return shortestLength >= 8 && (leftId.startsWith(rightId) || rightId.startsWith(leftId));
        };
        const queueItemMatchesBlockedEntity = (item: any, blockedIds: Set<string>): boolean => {
          if (blockedIds.size === 0) return false;
          const urlParts = String(item?.url || '').split(/[/?#]/).filter(Boolean);
          const body = item?.body && typeof item.body === 'object' ? item.body : {};
          return Array.from(blockedIds).some((blockedId) => (
            idsReferToSameEntity(item?.entityId, blockedId) ||
            urlParts.some((part) => idsReferToSameEntity(decodeURIComponent(part), blockedId)) ||
            idsReferToSameEntity(body?.id, blockedId) ||
            idsReferToSameEntity(body?.orderId, blockedId) ||
            idsReferToSameEntity(body?.order_id, blockedId) ||
            idsReferToSameEntity(body?.inventoryItemId, blockedId) ||
            idsReferToSameEntity(body?.inventory_item_id, blockedId)
          ));
        };

        // Get authFetch sync queue (includes sessions, settings, etc.)
        const authFetchStatus = authFetch.getSyncQueueStatus();
        const authQueueItems = authFetchStatus.items || [];
        const authFetchPending = Array.from(
          authQueueItems
            .filter((item: any) => !item?.cancelled && !cancelledIds.has(item.id))
            .reduce((acc: Map<string, any>, item: any) => {
              acc.set(getQueueSignature(item), item);
              return acc;
            }, new Map<string, any>())
            .values()
        );

        // Get dirty records from Sync Service (inventory, orders, transfers, waste, purchases, suppliers, etc.)
        // Note: Use filter() instead of where().equals() for boolean fields as IndexedDB doesn't support boolean key ranges
        const localInventory = await db.inventory.toArray();
        const dirtyInventory = localInventory.filter(
          r => r._dirty === true && (r as any).syncRetryBlocked !== true && (!branchId || String(r.branchId) === String(branchId))
        );
        const dirtySessions = (await db.sessions.toArray()).filter(r => r._dirty === true && (!branchId || String(r.branchId) === String(branchId)));
        const localOrders = (await db.orders.toArray()).filter(r => !branchId || String(r.branchId) === String(branchId));
        const failedLocalOrders = localOrders.filter(r => Boolean(r.syncRetryBlocked && String(r.syncError || '').trim()));
        const dirtyOrders = localOrders.filter(r => r._dirty === true && r.syncRetryBlocked !== true);
        const blockedOrderIds = new Set(
          failedLocalOrders.map((order) => String(order.id || '').trim()).filter(Boolean)
        );
        const blockedInventoryIds = new Set(
          localInventory
            .filter((item) => Boolean((item as any).syncRetryBlocked && String((item as any).syncError || '').trim()))
            .map((item) => String(item.id || '').trim())
            .filter(Boolean)
        );
        const dirtyPurchaseOrders = (await db.purchaseOrders.toArray()).filter(r => r._dirty === true && (!branchId || String(r.branchId) === String(branchId)));
        const dirtyStockTransfers = (await db.stockTransfers.toArray()).filter(r => r._dirty === true && (!branchId || String(r.branchId) === String(branchId)));
        const dirtyWasteRecords = (await db.wasteLog.toArray()).filter(r => r._dirty === true && (!branchId || String(r.branchId) === String(branchId)));
        const dirtyPurchaseHistory = (await db.purchaseHistory.toArray()).filter(r => r._dirty === true && (!branchId || String(r.branchId) === String(branchId)));
        const dirtySuppliers = (await db.suppliers.toArray()).filter(r => r._dirty === true && (!branchId || String(r.branchId) === String(branchId)));
        
        // Combine all dirty records
        const allDirtyRecords = [
          ...dirtyInventory.map(r => ({ type: 'InventoryItem', id: r.id, operation: r._operation, name: r.name })),
          ...dirtySessions.map(r => ({ type: 'Session', id: r.id, operation: r._operation, name: r.id })),
          ...dirtyOrders.map(r => ({ type: 'Order', id: r.id, operation: r._operation, name: r.id })),
          ...dirtyPurchaseOrders.map(r => ({ type: 'PurchaseOrder', id: r.id, operation: r._operation, name: r.order_number })),
          ...dirtyStockTransfers.map(r => ({ type: 'StockTransfer', id: r.id, operation: r._operation, name: r.id })),
          ...dirtyWasteRecords.map(r => ({ type: 'WasteRecord', id: r.id, operation: r._operation, name: r.id })),
          ...dirtyPurchaseHistory.map(r => ({ type: 'PurchaseRecord', id: r.id, operation: r._operation, name: r.productName })),
          ...dirtySuppliers.map(r => ({ type: 'Supplier', id: r.id, operation: r._operation, name: r.name })),
        ];
        
        const dirtyCount = allDirtyRecords.length;
        const failedAuthQueueItems = authFetchPending.filter(
          (item: any) => Boolean(String(item?.error || '').trim())
        );
        const pendingQueueItems = authFetchPending.filter(
          (item: any) =>
            !String(item?.error || '').trim() &&
            !queueItemMatchesBlockedEntity(item, blockedOrderIds) &&
            !queueItemMatchesBlockedEntity(item, blockedInventoryIds)
        );
        const failedLocalQueueItems = failedLocalOrders.map((order) => ({
          id: `local-order-${order.id}`,
          source: 'local-order',
          entityType: 'Order',
          entityId: order.id,
          method: 'POST',
          url: '/sessions/orders/',
          error: order.syncError,
          metadata: {
            label: order.orderNumber ? `Order #${order.orderNumber}` : `Order ${order.id}`,
          },
        }));
        const failedQueueItems = [...failedAuthQueueItems, ...failedLocalQueueItems];
        const totalPending = dirtyCount + pendingQueueItems.length;
        const totalFailed = failedQueueItems.length;
        
        console.log(`[Sync Status] Dirty Records: ${dirtyCount} | AuthFetch: ${pendingQueueItems.length} pending, ${failedQueueItems.length} failed | Total Pending: ${totalPending}${branchId ? ` | Branch: ${branchId}` : ''}`);
        
        setPendingCount(totalPending);
        setFailedCount(totalFailed);
        setDirtyRecords(allDirtyRecords);
        setFailedQueueItems(failedQueueItems);
        setPendingQueueItems(pendingQueueItems);
      } catch (error) {
        console.error('[Sync Status] Error updating sync status:', error);
      }
    };

    updateSyncStatus();

    // Poll for sync status changes every 1 second (more frequent for dirty flags)
    const interval = setInterval(updateSyncStatus, 1000);

    // Listen for storage changes (sync from other tabs)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key?.includes('sync') || e.key?.includes('dirty')) {
        console.log('[Sync Status] Storage changed, updating sync status');
        updateSyncStatus();
      }
    };
    const handleSyncStatusChanged = () => {
      updateSyncStatus();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('handypos-sync-status-changed', handleSyncStatusChanged);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('handypos-sync-status-changed', handleSyncStatusChanged);
      clearInterval(interval);
    };
  }, [branchId]);

  return {
    pendingCount,
    failedCount,
    isOnline,
    hasPending: pendingCount > 0,
    hasFailed: failedCount > 0,
    dirtyRecords,
    failedQueueItems,
    pendingQueueItems,
  };
}
