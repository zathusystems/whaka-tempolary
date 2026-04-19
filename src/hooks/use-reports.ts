

'use client';

import { useState, useEffect } from 'react';
import { db, type Order, type Expense, type InventoryItem } from '@/lib/db';
import type { DateRange } from 'react-day-picker';
import { differenceInCalendarDays, endOfDay, startOfDay } from 'date-fns';
import { useActiveBranch } from '@/hooks/use-active-branch';
import {
  resolveInventoryProductReportingCategory,
  summarizeProductCategoryRows,
  toProductCategorySummaryRows,
  type ProductCategorySummaryRow,
  type ProductReportingCategory,
} from '@/lib/session-product-report';

export interface ReportData {
  totalSales: number;
  totalRevenue: number;
  totalTax: number;
  totalCogs: number;
  grossProfit: number;
  totalExpenses: number;
  netProfit: number;
  profitMargin: number;
  totalTransactions: number;
  averageSaleValue: number;
  averageRevenuePerOrder: number;
  topProducts: {
    name: string;
    quantity: number;
    revenue: number;
    totalSales: number;
    productType: ProductReportingCategory;
  }[];
  fastMovingProducts: {
    name: string;
    quantity: number;
    totalSales: number;
    averagePerDay: number;
    currentStock: number;
    unitType: string;
    productType: ProductReportingCategory;
  }[];
  slowMovingProducts: {
    name: string;
    quantity: number;
    totalSales: number;
    averagePerDay: number;
    currentStock: number;
    unitType: string;
    productType: ProductReportingCategory;
  }[];
  salesByProductType: ProductCategorySummaryRow[];
  salesByCategory: { name: string; revenue: number; totalSales: number }[];
  salesByStaff: { name: string; revenue: number; totalSales: number; transactions: number }[];
}

export const useReports = (dateRange?: DateRange) => {
  const toFiniteNumber = (value: unknown, fallback = 0): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const toTrimmedString = (value: unknown): string => String(value ?? '').trim();

  const normalizeStatus = (value: unknown): string => toTrimmedString(value).toLowerCase();

  const getBranchIdCandidates = (branchId: string): string[] => {
    const normalized = toTrimmedString(branchId);
    if (!normalized) return [];

    const candidates = new Set<string>([normalized]);
    const numericMatch = normalized.match(/\d+/)?.[0];

    if (numericMatch) {
      candidates.add(numericMatch);
      candidates.add(`BRN-${numericMatch}`);
    }

    return Array.from(candidates);
  };

  const resolveNumber = (value: unknown): number | undefined => {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
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
    totalSales: 0,
    totalRevenue: 0,
    totalTax: 0,
    totalCogs: 0,
    grossProfit: 0,
    totalExpenses: 0,
    netProfit: 0,
    profitMargin: 0,
    totalTransactions: 0,
    averageSaleValue: 0,
    averageRevenuePerOrder: 0,
    topProducts: [],
    fastMovingProducts: [],
    slowMovingProducts: [],
    salesByProductType: [],
    salesByCategory: [],
    salesByStaff: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const activeBranchId = useActiveBranch();

  useEffect(() => {
    if (!dateRange?.from || !activeBranchId) {
      setLoading(false);
      setError(null);
      setData({
        totalSales: 0,
        totalRevenue: 0,
        totalTax: 0,
        totalCogs: 0,
        grossProfit: 0,
        totalExpenses: 0,
        netProfit: 0,
        profitMargin: 0,
        totalTransactions: 0,
        averageSaleValue: 0,
        averageRevenuePerOrder: 0,
        topProducts: [],
        fastMovingProducts: [],
        slowMovingProducts: [],
        salesByProductType: [],
        salesByCategory: [],
        salesByStaff: [],
      });
      return;
    }

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        const from = startOfDay(dateRange.from!).toISOString();
        const to = endOfDay(dateRange.to || dateRange.from!).toISOString();
        const fromMs = Date.parse(from);
        const toMs = Date.parse(to);
        const branchCandidates = new Set(getBranchIdCandidates(activeBranchId));

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
          db.expenses.toArray(),
          db.inventory.where('branchId').equals(activeBranchId).toArray(),
          db.staff.where('branchId').equals(activeBranchId).toArray(),
        ]);

        const normalizedExpenses = allExpenses.filter((expense) => {
          if (expense._operation === 'delete') {
            return false;
          }

          const expenseBranchId = toTrimmedString(
            expense.branchId ?? (expense as any).branch_id ?? (expense as any).branch
          );
          if (!expenseBranchId || !branchCandidates.has(expenseBranchId)) {
            return false;
          }

          const expenseStatus = normalizeStatus(
            expense.status ?? (expense as any).approvalStatus ?? (expense as any).approval_status
          );
          if (expenseStatus !== 'approved') {
            return false;
          }

          const expenseDateRaw = toTrimmedString(
            expense.date ??
              (expense as any).expenseDate ??
              (expense as any).expense_date ??
              expense.approvedAt ??
              (expense as any).approved_at ??
              (expense as any).createdAt ??
              (expense as any).created_at
          );
          const expenseDateMs = Date.parse(expenseDateRaw);
          if (!Number.isFinite(expenseDateMs)) {
            return false;
          }

          return expenseDateMs >= fromMs && expenseDateMs <= toMs;
        });

        const ordersToPatch = orders
          .map((order) => {
            const vat = resolveNumber((order as any).vatAmount ?? (order as any).vat_amount);
            const net = resolveNumber((order as any).netAmount ?? (order as any).net_amount);
            const gross = resolveNumber((order as any).grossAmount ?? (order as any).gross_amount);

            const existingTax = resolveNumber(order.tax);
            const existingSubtotal = resolveNumber(order.subtotal);
            const existingTotal = resolveNumber(order.total);

            const resolvedTax = existingTax ?? vat;
            const resolvedSubtotal =
              existingSubtotal ??
              net ??
              (gross !== undefined && resolvedTax !== undefined ? gross - resolvedTax : undefined);
            const resolvedTotal =
              existingTotal ??
              gross ??
              (resolvedSubtotal !== undefined && resolvedTax !== undefined
                ? resolvedSubtotal + resolvedTax
                : undefined);

            const changes: Partial<Order> = {};
            if (existingTax === undefined && resolvedTax !== undefined) {
              changes.tax = resolvedTax;
            }
            if (existingSubtotal === undefined && resolvedSubtotal !== undefined) {
              changes.subtotal = resolvedSubtotal;
            }
            if (existingTotal === undefined && resolvedTotal !== undefined) {
              changes.total = resolvedTotal;
            }

            return Object.keys(changes).length > 0
              ? { key: order.id, changes }
              : null;
          })
          .filter(Boolean) as Array<{ key: string; changes: Partial<Order> }>;

        if (ordersToPatch.length > 0) {
          await db.orders.bulkUpdate(ordersToPatch);
        }

        const normalizedOrders = orders.map((order) => {
          const total = toFiniteNumber(order.total ?? order.grossAmount ?? order.gross_amount, 0);
          const tax = toFiniteNumber(order.tax ?? order.vatAmount ?? order.vat_amount, 0);
          const subtotalCandidate = toFiniteNumber(order.subtotal ?? order.netAmount ?? order.net_amount, Number.NaN);
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
        
        // FINANCIAL CALCULATIONS
        const totalRevenue = normalizedOrders.reduce((acc, order) => acc + order.subtotal, 0);
        const totalTax = normalizedOrders.reduce((acc, order) => acc + order.tax, 0);
        const totalSales = normalizedOrders.reduce((acc, order) => acc + order.total, 0);
        const totalCogs = normalizedOrders.reduce((acc, order) => acc + order.cogs, 0);
        const totalExpenses = normalizedExpenses.reduce((acc, expense) => acc + toFiniteNumber(expense.amount, 0), 0);

        // Gross Profit = Revenue - COGS, excluding tax because tax is not business revenue.
        const grossProfit = totalRevenue - totalCogs;
        const netProfit = grossProfit - totalExpenses;

        // Profit Margin based on revenue (before tax)
        const profitMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;

        // SALES KPI CALCULATIONS
        const totalTransactions = normalizedOrders.length;
        const averageRevenuePerOrder = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
        const averageSaleValue = totalTransactions > 0 ? totalSales / totalTransactions : 0;

        // PRODUCT & CATEGORY CALCULATIONS
        const productMap = new Map<string, {
          id: string;
          name: string;
          category: string;
          productType: ProductReportingCategory;
          quantity: number;
          revenue: number;
          totalSales: number;
        }>();
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
                const existing = productMap.get(productKey) || {
                  id: productKey,
                  name: product.name,
                  category: product.category,
                  productType: resolveInventoryProductReportingCategory(product),
                  quantity: 0,
                  revenue: 0,
                  totalSales: 0,
                };
                existing.quantity += quantity;

                const itemTotalSales = getItemRevenueWithTax(item, quantity, order.total, totalItemQuantity);
                existing.totalSales += itemTotalSales;
                const taxRate = order.subtotal > 0 ? order.tax / order.subtotal : 0;
                const divisor = 1 + taxRate;
                const itemRevenueBeforeTax = divisor > 0 ? itemTotalSales / divisor : itemTotalSales;
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
                totalSales: p.totalSales,
                productType: p.productType,
            }));

        const salesByProductType = toProductCategorySummaryRows(
          summarizeProductCategoryRows(
            Array.from(productMap.values()).map((product) => ({
              category: product.productType,
              key: product.id,
              quantity: product.quantity,
              amount: product.totalSales,
            }))
          )
        );

        // Movement analytics for sellable products (fast-moving / slow-moving)
        const movementMap = new Map<string, {
          name: string;
          quantity: number;
          totalSales: number;
          currentStock: number;
          unitType: string;
          productType: ProductReportingCategory;
        }>();

        inventory
          .filter((item) => item.itemType === 'sellable')
          .forEach((item) => {
            const key = String(item.id);
            movementMap.set(key, {
              name: item.name,
              quantity: 0,
              totalSales: 0,
              currentStock: toFiniteNumber(item.stockUnits, 0),
              unitType: String(item.unitType || 'unit'),
              productType: resolveInventoryProductReportingCategory(item),
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
              totalSales: 0,
              currentStock: toFiniteNumber(product.stockUnits, 0),
              unitType: String(product.unitType || 'unit'),
              productType: resolveInventoryProductReportingCategory(product),
            };

            existing.quantity += quantity;
            existing.totalSales += getItemRevenueWithTax(item, quantity, order.total, totalItemQuantity);
            movementMap.set(key, existing);
          });
        });

        const movementRows = Array.from(movementMap.values()).map((row) => ({
          ...row,
          averagePerDay: row.quantity / periodDays,
        }));

        const fastMovingProducts = movementRows
          .filter((row) => row.quantity > 0)
          .sort((a, b) => (b.quantity - a.quantity) || (b.totalSales - a.totalSales))
          .slice(0, 10);

        const slowMovingProducts = movementRows
          .sort((a, b) => (a.quantity - b.quantity) || (a.totalSales - b.totalSales))
          .slice(0, 10);

        const categoryMap = new Map<string, { name: string; revenue: number; totalSales: number }>();
        for (const product of productMap.values()) {
            const category = product.category || 'Uncategorized';
            const existing = categoryMap.get(category) || { name: category, revenue: 0, totalSales: 0 };
            existing.revenue += product.revenue;
            existing.totalSales += product.totalSales;
            categoryMap.set(category, existing);
        }
        const salesByCategory = Array.from(categoryMap.values())
            .sort((a, b) => b.revenue - a.revenue)
            .map(c => ({
                name: c.name,
                revenue: c.revenue,
                totalSales: c.totalSales
            }));

        const staffMap = new Map<string, { name: string; revenue: number; totalSales: number; transactions: number }>();
        await Promise.all(normalizedOrders.map(async order => {
            const session = order.sessionId ? await db.sessions.get(order.sessionId) : null;
            if (!session) return;
            
            const staffMember = staff.find(s => s.id === session.userId);
            const staffName = staffMember?.name || session.userName || 'Unknown';

            const existing = staffMap.get(session.userId) || { name: staffName, revenue: 0, totalSales: 0, transactions: 0 };
            existing.revenue += order.subtotal;
            existing.totalSales += order.total;
            existing.transactions += 1;
            staffMap.set(session.userId, existing);
        }));

        const salesByStaff = Array.from(staffMap.values())
            .sort((a,b) => b.totalSales - a.totalSales)
            .map(s => ({
                name: s.name,
                revenue: s.revenue,
                totalSales: s.totalSales,
                transactions: s.transactions
            }));

        setData({
            totalSales: toFiniteNumber(totalSales, 0),
            totalRevenue: toFiniteNumber(totalRevenue, 0),
            totalTax: toFiniteNumber(totalTax, 0),
            totalCogs: toFiniteNumber(totalCogs, 0),
            grossProfit: toFiniteNumber(grossProfit, 0),
            totalExpenses: toFiniteNumber(totalExpenses, 0),
            netProfit: toFiniteNumber(netProfit, 0),
            profitMargin: toFiniteNumber(profitMargin, 0),
            totalTransactions,
            averageSaleValue: toFiniteNumber(averageSaleValue, 0),
            averageRevenuePerOrder: toFiniteNumber(averageRevenuePerOrder, 0),
            topProducts,
            fastMovingProducts,
            slowMovingProducts,
            salesByProductType,
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
