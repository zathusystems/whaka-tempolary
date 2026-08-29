'use client';

import { db, type Order } from '@/lib/db';

const SALES_STORAGE_KEY = 'handypos-sales';
const PENDING_SALES_KEY = 'handypos-pending-sales';

export interface SaleRecord extends Order {
  syncedAt?: string;
  syncError?: string;
}

interface MarkSaleFailedOptions {
  retryBlocked?: boolean;
}

/**
 * Save a completed sale to localStorage with branch information
 */
export function saveSaleToLocalStorage(order: Order, branchId?: string): void {
  try {
    if (typeof window === 'undefined') return;

    const sales = getSalesFromLocalStorage();
    const saleRecord: SaleRecord = {
      ...order,
      branchId: branchId || order.branchId, // Ensure branch is included
      syncedAt: undefined,
      syncError: undefined,
      syncStatus: 'pending',
      syncRetryBlocked: false,
    };

    sales.push(saleRecord);
    localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify(sales));
    console.log('[Sales Service] Saved sale to localStorage:', order.id, 'Branch:', branchId);
  } catch (error) {
    console.error('[Sales Service] Failed to save sale to localStorage:', error);
  }
}

/**
 * Get all sales from localStorage
 */
export function getSalesFromLocalStorage(): SaleRecord[] {
  try {
    if (typeof window === 'undefined') return [];

    const sales = localStorage.getItem(SALES_STORAGE_KEY);
    return sales ? JSON.parse(sales) : [];
  } catch (error) {
    console.error('[Sales Service] Failed to get sales from localStorage:', error);
    return [];
  }
}

/**
 * Add a pending sale (waiting to sync to backend)
 */
export function addPendingSale(order: Order): void {
  try {
    if (typeof window === 'undefined') return;

    const pending = getPendingSales();
    pending.push({
      ...order,
      syncedAt: undefined,
      syncError: undefined,
      syncStatus: 'pending',
      syncRetryBlocked: false,
    });

    localStorage.setItem(PENDING_SALES_KEY, JSON.stringify(pending));
    console.log('[Sales Service] Added pending sale:', order.id);
  } catch (error) {
    console.error('[Sales Service] Failed to add pending sale:', error);
  }
}

/**
 * Get all pending sales
 */
export function getPendingSales(): SaleRecord[] {
  try {
    if (typeof window === 'undefined') return [];

    const pending = localStorage.getItem(PENDING_SALES_KEY);
    return pending ? JSON.parse(pending) : [];
  } catch (error) {
    console.error('[Sales Service] Failed to get pending sales:', error);
    return [];
  }
}

/**
 * Mark a sale as synced
 */
export function markSaleAsSynced(orderId: string): void {
  try {
    if (typeof window === 'undefined') return;

    const pending = getPendingSales();
    const updated = pending.filter(sale => sale.id !== orderId);
    localStorage.setItem(PENDING_SALES_KEY, JSON.stringify(updated));

    const sales = getSalesFromLocalStorage();
    const saleIndex = sales.findIndex(s => s.id === orderId);
    if (saleIndex !== -1) {
      sales[saleIndex].syncedAt = new Date().toISOString();
      sales[saleIndex].syncError = undefined;
      sales[saleIndex].syncStatus = 'synced';
      sales[saleIndex].syncRetryBlocked = false;
      localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify(sales));
    }

    void db.orders.update(orderId, {
      syncStatus: 'synced',
      syncError: undefined,
      syncRetryBlocked: false,
      syncFailedAt: undefined,
    });

    console.log('[Sales Service] Marked sale as synced:', orderId);
  } catch (error) {
    console.error('[Sales Service] Failed to mark sale as synced:', error);
  }
}

/**
 * Mark a sale as failed to sync
 */
export function markSaleAsFailed(orderId: string, error: string, options: MarkSaleFailedOptions = {}): void {
  try {
    if (typeof window === 'undefined') return;

    const failedAt = new Date().toISOString();
    const sales = getSalesFromLocalStorage();
    const saleIndex = sales.findIndex(s => s.id === orderId);
    if (saleIndex !== -1) {
      sales[saleIndex].syncError = error;
      sales[saleIndex].syncStatus = 'failed';
      sales[saleIndex].syncRetryBlocked = Boolean(options.retryBlocked);
      sales[saleIndex].syncFailedAt = failedAt;
      localStorage.setItem(SALES_STORAGE_KEY, JSON.stringify(sales));
    }

    const pending = getPendingSales();
    const pendingIndex = pending.findIndex(s => s.id === orderId);
    if (pendingIndex !== -1) {
      pending[pendingIndex].syncError = error;
      pending[pendingIndex].syncStatus = 'failed';
      pending[pendingIndex].syncRetryBlocked = Boolean(options.retryBlocked);
      pending[pendingIndex].syncFailedAt = failedAt;
      localStorage.setItem(PENDING_SALES_KEY, JSON.stringify(pending));
    }

    void db.orders.update(orderId, {
      syncStatus: 'failed',
      syncError: error,
      syncRetryBlocked: Boolean(options.retryBlocked),
      syncFailedAt: failedAt,
    });

    console.log('[Sales Service] Marked sale as failed:', orderId, error);
  } catch (error) {
    console.error('[Sales Service] Failed to mark sale as failed:', error);
  }
}

/**
 * Get sales summary for a date range
 */
export function getSalesSummary(startDate?: Date, endDate?: Date): {
  totalSales: number;
  totalOrders: number;
  totalTips: number;
  byPaymentMethod: Record<string, number>;
} {
  try {
    const sales = getSalesFromLocalStorage();
    
    let filtered = sales;
    if (startDate || endDate) {
      filtered = sales.filter(sale => {
        const saleDate = new Date(sale.createdAt);
        if (startDate && saleDate < startDate) return false;
        if (endDate && saleDate > endDate) return false;
        return true;
      });
    }

    const summary = {
      totalSales: filtered.reduce((sum, sale) => sum + sale.total, 0),
      totalOrders: filtered.length,
      totalTips: filtered.reduce((sum, sale) => sum + (sale.tip || 0), 0),
      byPaymentMethod: {} as Record<string, number>,
    };

    filtered.forEach(sale => {
      const method = sale.paymentMethod || 'Unknown';
      summary.byPaymentMethod[method] = (summary.byPaymentMethod[method] || 0) + sale.total;
    });

    return summary;
  } catch (error) {
    console.error('[Sales Service] Failed to get sales summary:', error);
    return {
      totalSales: 0,
      totalOrders: 0,
      totalTips: 0,
      byPaymentMethod: {},
    };
  }
}

/**
 * Clear all sales from localStorage (use with caution)
 */
export function clearSalesHistory(): void {
  try {
    if (typeof window === 'undefined') return;

    localStorage.removeItem(SALES_STORAGE_KEY);
    localStorage.removeItem(PENDING_SALES_KEY);
    console.log('[Sales Service] Cleared all sales history');
  } catch (error) {
    console.error('[Sales Service] Failed to clear sales history:', error);
  }
}
