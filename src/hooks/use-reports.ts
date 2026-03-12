

'use client';

import { useState, useEffect } from 'react';
import { db, type Order, type Expense, type InventoryItem } from '@/lib/db';
import type { DateRange } from 'react-day-picker';
import { differenceInCalendarDays, endOfDay, startOfDay } from 'date-fns';

const LOCAL_STORAGE_KEYS = {
    ACTIVE_BRANCH: 'handypos-active-branch',
};

export interface ReportData {
  totalRevenue: number;
  totalSubtotal: number;
  totalTax: number;
  totalCogs: number;
  grossProfit: number;
  totalExpenses: number;
  netProfit: number;
  profitMargin: number;
  totalTransactions: number;
  averageOrderValue: number;
  averageOrderValueWithTax: number;
  topProducts: { name: string; quantity: number; revenue: number; revenueWithTax: number }[];
  fastMovingProducts: {
    name: string;
    quantity: number;
    revenueWithTax: number;
    averagePerDay: number;
    currentStock: number;
    unitType: string;
  }[];
  slowMovingProducts: {
    name: string;
    quantity: number;
    revenueWithTax: number;
    averagePerDay: number;
    currentStock: number;
    unitType: string;
  }[];
  salesByCategory: { name: string; revenue: number; revenueWithTax: number }[];
  salesByStaff: { name: string; sales: number; salesWithTax: number; transactions: number }[];
}

export const useReports = (dateRange?: DateRange) => {
  const toFiniteNumber = (value: unknown, fallback = 0): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const normalizeName = (value: unknown): string =>
    String(value ?? '').trim().toLowerCase();

  const resolveOrderItemInventoryId = (item: any): string => {
    const candidates = [
      item?.inventoryItemId,
      item?.inventory_item_id,
      item?.inventoryItem,
      item?.inventory_item,
    ];

    for (const candidate of candidates) {
      const normalized = String(candidate ?? '').trim();
      if (normalized) return normalized;
    }

    const rawLineId = String(item?.id ?? '').trim();
    if (!rawLineId) return '';
    return rawLineId.split('::cart::')[0] || rawLineId;
  };

  const getItemRevenueWithTax = (
    item: any,
    quantity: number,
    orderTotal: number,
    totalItemQuantity: number
  ): number => {
    const lineQuantity = Math.max(0, toFiniteNumber(item?.quantity, 0));
    const lineTotal = toFiniteNumber(
      item?.total ?? item?.gross_amount ?? item?.grossAmount,
      Number.NaN
    );
    if (Number.isFinite(lineTotal) && lineTotal >= 0) {
      if (lineQuantity > 0 && quantity > 0 && quantity !== lineQuantity) {
        return (lineTotal / lineQuantity) * quantity;
      }
      return lineTotal;
    }

    const unitPrice = toFiniteNumber(item?.price, Number.NaN);
    if (Number.isFinite(unitPrice) && unitPrice >= 0) {
      return unitPrice * quantity;
    }

    if (totalItemQuantity > 0) {
      return (orderTotal / totalItemQuantity) * quantity;
    }

    return 0;
  };

  const [data, setData] = useState<ReportData>({
    totalRevenue: 0,
    totalSubtotal: 0,
    totalTax: 0,
    totalCogs: 0,
    grossProfit: 0,
    totalExpenses: 0,
    netProfit: 0,
    profitMargin: 0,
    totalTransactions: 0,
    averageOrderValue: 0,
    averageOrderValueWithTax: 0,
    topProducts: [],
    fastMovingProducts: [],
    slowMovingProducts: [],
    salesByCategory: [],
    salesByStaff: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);

  useEffect(() => {
    const branchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
    if (branchId) {
      setActiveBranchId(branchId);
    } else {
        setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!dateRange?.from || !activeBranchId) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const from = startOfDay(dateRange.from!).toISOString();
        const to = endOfDay(dateRange.to || dateRange.from!).toISOString();

        const [orders, allExpenses, inventory, staff] = await Promise.all([
          db.orders
            .where('branchId').equals(activeBranchId)
            .and(order => 
              order.createdAt >= from && 
              order.createdAt <= to &&
              order.status !== 'Voided' &&
              order.status !== 'Cancelled'
            )
            .toArray(),
          db.expenses
            .where('branchId').equals(activeBranchId)
            .and(expense => expense.status === 'Approved' && expense.date >= from && expense.date <= to)
            .toArray(),
          db.inventory.where('branchId').equals(activeBranchId).toArray(),
          db.staff.where('branchId').equals(activeBranchId).toArray(),
        ]);

        const normalizedOrders = orders.map((order) => {
          const total = toFiniteNumber(order.total, 0);
          const tax = toFiniteNumber(order.tax, 0);
          const subtotalCandidate = toFiniteNumber(order.subtotal, Number.NaN);
          const subtotal = Number.isFinite(subtotalCandidate)
            ? subtotalCandidate
            : Math.max(total - tax, 0);
          const cogs = toFiniteNumber(order.cogs, 0);

          return {
            ...order,
            total,
            tax,
            subtotal,
            cogs,
          };
        });
        const periodDays = Math.max(
          1,
          differenceInCalendarDays(
            endOfDay(dateRange.to || dateRange.from!),
            startOfDay(dateRange.from!)
          ) + 1
        );
        const inventoryById = new Map<string, InventoryItem>(
          inventory.map((item) => [String(item.id), item])
        );
        const inventoryByName = new Map<string, InventoryItem>(
          inventory.map((item) => [normalizeName(item.name), item])
        );
        
        // FINANCIAL CALCULATIONS - INCLUDING TAX BREAKDOWN
        const totalSubtotal = normalizedOrders.reduce((acc, order) => acc + order.subtotal, 0);
        const totalTax = normalizedOrders.reduce((acc, order) => acc + order.tax, 0);
        const totalRevenue = normalizedOrders.reduce((acc, order) => acc + order.total, 0);
        const totalCogs = normalizedOrders.reduce((acc, order) => acc + order.cogs, 0);
        const totalExpenses = allExpenses.reduce((acc, expense) => acc + toFiniteNumber(expense.amount, 0), 0);
        
        // Gross Profit = Revenue - COGS (before tax consideration)
        const grossProfit = totalSubtotal - totalCogs;
        
        // Net Profit = Gross Profit - Operating Expenses
        const netProfit = grossProfit - totalExpenses;
        
        // Profit Margin based on subtotal (before tax)
        const profitMargin = totalSubtotal > 0 ? (netProfit / totalSubtotal) * 100 : 0;

        // SALES KPI CALCULATIONS - RESPECTING TAX
        const totalTransactions = normalizedOrders.length;
        // Average Order Value based on subtotal (pre-tax)
        const averageOrderValue = totalTransactions > 0 ? totalSubtotal / totalTransactions : 0;
        // Average Order Value including tax
        const averageOrderValueWithTax = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

        // PRODUCT & CATEGORY CALCULATIONS - RESPECTING TAX
        // Note: Product prices already include VAT, so:
        // - revenueWithTax = actual price paid (includes VAT)
        // - revenue = price without VAT (calculated by removing tax)
        const productMap = new Map<string, { name: string; category: string; quantity: number; revenue: number; revenueWithTax: number }>();
        normalizedOrders.forEach(order => {
            const totalItemQuantity = order.items.reduce((sum, i) => sum + Math.max(0, toFiniteNumber(i.quantity, 0)), 0);
            if (totalItemQuantity <= 0) return;

            order.items.forEach(item => {
                const resolvedInventoryId = resolveOrderItemInventoryId(item);
                const product =
                  inventoryById.get(resolvedInventoryId) ||
                  inventoryByName.get(normalizeName(item?.name));
                if (!product) return;

                const quantity = Math.max(0, toFiniteNumber(item.quantity, 0));
                if (quantity <= 0) return;

                const productKey = String(product.id);
                const existing = productMap.get(productKey) || { name: product.name, category: product.category, quantity: 0, revenue: 0, revenueWithTax: 0 };
                existing.quantity += quantity;
                
                // Calculate item revenue WITH tax (actual price paid - includes VAT)
                const itemRevenueWithTax = getItemRevenueWithTax(item, quantity, order.total, totalItemQuantity);
                existing.revenueWithTax += itemRevenueWithTax;
                
                // Calculate item revenue WITHOUT tax (remove VAT from price)
                // Revenue before tax = Revenue with tax / (1 + tax rate)
                const taxRate = order.subtotal > 0 ? order.tax / order.subtotal : 0;
                const divisor = 1 + taxRate;
                const itemRevenueBeforeTax = divisor > 0 ? itemRevenueWithTax / divisor : itemRevenueWithTax;
                existing.revenue += itemRevenueBeforeTax;
                
                productMap.set(productKey, existing);
            });
        });

        const topProducts = Array.from(productMap.values())
            .sort((a,b) => b.revenue - a.revenue)
            .slice(0, 10)
            .map(p => ({
                name: p.name,
                quantity: p.quantity,
                revenue: p.revenue,
                revenueWithTax: p.revenueWithTax
            }));

        // Movement analytics for sellable products (fast-moving / slow-moving)
        const movementMap = new Map<string, {
          name: string;
          quantity: number;
          revenueWithTax: number;
          currentStock: number;
          unitType: string;
        }>();

        inventory
          .filter((item) => item.itemType === 'sellable')
          .forEach((item) => {
            const key = String(item.id);
            movementMap.set(key, {
              name: item.name,
              quantity: 0,
              revenueWithTax: 0,
              currentStock: toFiniteNumber(item.stockUnits, 0),
              unitType: String(item.unitType || 'unit'),
            });
          });

        normalizedOrders.forEach((order) => {
          const totalItemQuantity = order.items.reduce((sum, i) => sum + Math.max(0, toFiniteNumber(i.quantity, 0)), 0);
          if (totalItemQuantity <= 0) return;

          order.items.forEach((item) => {
            const itemKey = resolveOrderItemInventoryId(item);
            const quantity = Math.max(0, toFiniteNumber(item.quantity, 0));
            if (quantity <= 0) return;

            const product =
              inventoryById.get(itemKey) ||
              inventoryByName.get(normalizeName(item?.name));
            if (!product || product.itemType !== 'sellable') return;

            const key = String(product.id);
            const existing = movementMap.get(key) || {
              name: product.name,
              quantity: 0,
              revenueWithTax: 0,
              currentStock: toFiniteNumber(product.stockUnits, 0),
              unitType: String(product.unitType || 'unit'),
            };

            existing.quantity += quantity;
            existing.revenueWithTax += getItemRevenueWithTax(item, quantity, order.total, totalItemQuantity);
            movementMap.set(key, existing);
          });
        });

        const movementRows = Array.from(movementMap.values()).map((row) => ({
          ...row,
          averagePerDay: row.quantity / periodDays,
        }));

        const fastMovingProducts = movementRows
          .filter((row) => row.quantity > 0)
          .sort((a, b) => (b.quantity - a.quantity) || (b.revenueWithTax - a.revenueWithTax))
          .slice(0, 10);

        const slowMovingProducts = movementRows
          .sort((a, b) => (a.quantity - b.quantity) || (a.revenueWithTax - b.revenueWithTax))
          .slice(0, 10);
        
        const categoryMap = new Map<string, { name: string; revenue: number; revenueWithTax: number }>();
        for (const product of productMap.values()) {
            const category = product.category || 'Uncategorized';
            const existing = categoryMap.get(category) || { name: category, revenue: 0, revenueWithTax: 0 };
            existing.revenue += product.revenue;
            existing.revenueWithTax += product.revenueWithTax;
            categoryMap.set(category, existing);
        }
        const salesByCategory = Array.from(categoryMap.values())
            .sort((a, b) => b.revenue - a.revenue)
            .map(c => ({
                name: c.name,
                revenue: c.revenue,
                revenueWithTax: c.revenueWithTax
            }));

        // STAFF CALCULATIONS - RESPECTING TAX
        const staffMap = new Map<string, { name: string; sales: number; salesWithTax: number; transactions: number }>();
        await Promise.all(normalizedOrders.map(async order => {
            const session = order.sessionId ? await db.sessions.get(order.sessionId) : null;
            if (!session) return;
            
            const staffMember = staff.find(s => s.id === session.userId);
            const staffName = staffMember?.name || session.userName || 'Unknown';

            const existing = staffMap.get(session.userId) || { name: staffName, sales: 0, salesWithTax: 0, transactions: 0 };
            existing.sales += order.subtotal;  // Pre-tax sales
            existing.salesWithTax += order.total;  // Total with tax
            existing.transactions += 1;
            staffMap.set(session.userId, existing);
        }));

        const salesByStaff = Array.from(staffMap.values())
            .sort((a,b) => b.salesWithTax - a.salesWithTax)
            .map(s => ({
                name: s.name,
                sales: s.sales,
                salesWithTax: s.salesWithTax,
                transactions: s.transactions
            }));

        setData({
            totalRevenue: toFiniteNumber(totalRevenue, 0),
            totalSubtotal: toFiniteNumber(totalSubtotal, 0),
            totalTax: toFiniteNumber(totalTax, 0),
            totalCogs: toFiniteNumber(totalCogs, 0),
            grossProfit: toFiniteNumber(grossProfit, 0),
            totalExpenses: toFiniteNumber(totalExpenses, 0),
            netProfit: toFiniteNumber(netProfit, 0),
            profitMargin: toFiniteNumber(profitMargin, 0),
            totalTransactions,
            averageOrderValue: toFiniteNumber(averageOrderValue, 0),
            averageOrderValueWithTax: toFiniteNumber(averageOrderValueWithTax, 0),
            topProducts,
            fastMovingProducts,
            slowMovingProducts,
            salesByCategory,
            salesByStaff,
        });

      } catch (e: any) {
        setError(e);
        console.error("Failed to generate report data", e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [dateRange, activeBranchId]);

  return { data, loading, error };
};
