'use client';

import { db, type InventoryItem, type MRAMapping, type PurchaseRecord } from '@/lib/db';

export type StockReconciliationWarning = {
  productId: string;
  productName: string;
  stockUnits: number;
  localBatchQuantity: number;
  missingBatchQuantity: number;
  unitType?: string;
  cost?: number;
  sellingPrice?: number;
  taxRate?: number;
  taxCalculationMethod?: 'inclusive' | 'exclusive';
};

type StoredStockReconciliationWarnings = {
  updatedAt: string;
  warnings: StockReconciliationWarning[];
};

export const MRA_STOCK_RECONCILIATION_STORAGE_KEY = 'handypos-mra-stock-reconciliation-warnings';

function normalizeBranchId(value?: string | number | null): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';

  const brnMatch = /^BRN-(\d+)$/i.exec(normalized);
  if (brnMatch) return brnMatch[1];

  const legacyMatch = /^branch-(\d+)$/i.exec(normalized);
  if (legacyMatch) return legacyMatch[1];

  return normalized;
}

function getBranchIdCandidates(branchId: string): string[] {
  const normalized = String(branchId || '').trim();
  if (!normalized) return [];

  const backendId = normalizeBranchId(normalized);
  const candidates = new Set<string>([normalized, backendId]);
  if (/^\d+$/.test(backendId)) {
    candidates.add(`BRN-${backendId}`);
    candidates.add(`branch-${backendId}`);
  }

  return Array.from(candidates).filter(Boolean);
}

function toSafeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTaxCalculationMethod(value: unknown): 'inclusive' | 'exclusive' {
  return String(value || '').trim().toLowerCase() === 'inclusive' ? 'inclusive' : 'exclusive';
}

function isServiceProduct(product: InventoryItem, mapping?: MRAMapping): boolean {
  if (mapping?.isProduct === false || mapping?.is_product === false) return true;
  return String(product.category || '').toLowerCase().includes('service');
}

async function getBranchRows<T extends { branchId?: string }>(
  table: any,
  branchId: string,
  options?: { includeUnscoped?: boolean }
): Promise<T[]> {
  const branchCandidates = getBranchIdCandidates(branchId);
  if (branchCandidates.length === 0) return [];
  if (options?.includeUnscoped) {
    const rows = await table.toArray();
    return rows.filter((row: T) => {
      const rowBranchId = String(row?.branchId || '').trim();
      return !rowBranchId || branchCandidates.includes(rowBranchId) || branchCandidates.includes(normalizeBranchId(rowBranchId));
    });
  }
  if (branchCandidates.length === 1) return table.where('branchId').equals(branchCandidates[0]).toArray();
  return table.where('branchId').anyOf(branchCandidates).toArray();
}

export async function getMraStockReconciliationWarnings(branchId: string): Promise<StockReconciliationWarning[]> {
  const [products, purchaseRecords, mraMappings] = await Promise.all([
    getBranchRows<InventoryItem>(db.inventory, branchId),
    getBranchRows<PurchaseRecord>(db.purchaseHistory, branchId),
    getBranchRows<MRAMapping>(db.mraMappings, branchId, { includeUnscoped: true }),
  ]);

  const batchQuantityByProduct = new Map<string, number>();
  for (const record of purchaseRecords) {
    if (!record || record._operation === 'delete') continue;
    const productId = String(record.productId || '').trim();
    if (!productId) continue;

    const currentQuantity = batchQuantityByProduct.get(productId) || 0;
    batchQuantityByProduct.set(productId, currentQuantity + Math.max(0, toSafeNumber(record.quantityRemaining)));
  }

  const warnings: StockReconciliationWarning[] = [];
  const mappingByProduct = new Map<string, MRAMapping>();
  for (const mapping of mraMappings) {
    const productId = String(mapping.inventoryItemId || mapping.inventory_item_id || '').trim();
    if (!productId) continue;
    const existing = mappingByProduct.get(productId);
    if (!existing || (mapping.isApproved && mapping.mraSynced)) {
      mappingByProduct.set(productId, mapping);
    }
  }

  for (const product of products) {
    if (!product || product._operation === 'delete') continue;
    const productId = String(product.id || '').trim();
    if (!productId) continue;

    const mapping = mappingByProduct.get(productId);
    if (isServiceProduct(product, mapping)) continue;

    const stockUnits = Math.max(0, toSafeNumber(product.stockUnits));
    const localBatchQuantity = Math.max(0, batchQuantityByProduct.get(productId) || 0);
    const missingBatchQuantity = stockUnits - localBatchQuantity;

    if (missingBatchQuantity > 0.0001) {
      const taxRate = toSafeNumber(
        mapping?.mraTaxRate ?? mapping?.mra_tax_rate ?? mapping?.taxRate ?? mapping?.tax_rate
      );
      warnings.push({
        productId,
        productName: product.name || 'Unnamed product',
        stockUnits: Number(stockUnits.toFixed(3)),
        localBatchQuantity: Number(localBatchQuantity.toFixed(3)),
        missingBatchQuantity: Number(missingBatchQuantity.toFixed(3)),
        unitType: product.unitType,
        cost: toSafeNumber(product.cost),
        sellingPrice: toSafeNumber(product.price),
        taxRate: Number(taxRate.toFixed(2)),
        taxCalculationMethod: normalizeTaxCalculationMethod(mapping?.taxCalculationMethod),
      });
    }
  }

  return warnings.sort((a, b) => b.missingBatchQuantity - a.missingBatchQuantity);
}

export function storeMraStockReconciliationWarnings(warnings: StockReconciliationWarning[]): void {
  if (typeof window === 'undefined') return;

  if (!warnings.length) {
    localStorage.removeItem(MRA_STOCK_RECONCILIATION_STORAGE_KEY);
    return;
  }

  const payload: StoredStockReconciliationWarnings = {
    updatedAt: new Date().toISOString(),
    warnings,
  };
  localStorage.setItem(MRA_STOCK_RECONCILIATION_STORAGE_KEY, JSON.stringify(payload));
}

export function loadMraStockReconciliationWarnings(): StoredStockReconciliationWarnings | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = localStorage.getItem(MRA_STOCK_RECONCILIATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredStockReconciliationWarnings;
    if (!Array.isArray(parsed?.warnings)) return null;
    return parsed;
  } catch {
    return null;
  }
}
