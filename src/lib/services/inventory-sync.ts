'use client';

import { db, type InventoryItem } from '@/lib/db';
import { authFetch } from '@/lib/auth-fetch';

function toBackendBranchId(id: string): string {
  const normalized = String(id || '').trim();
  if (!normalized) return normalized;

  const brnMatch = /^BRN-(\d+)$/i.exec(normalized);
  if (brnMatch) return brnMatch[1];

  const legacyBranchMatch = /^branch-(\d+)$/i.exec(normalized);
  if (legacyBranchMatch) return legacyBranchMatch[1];

  if (/^\d+$/.test(normalized)) return normalized;
  return normalized;
}

/**
 * Convert snake_case to camelCase
 */
function snakeToCamel(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(item => snakeToCamel(item));
  }
  
  if (obj !== null && typeof obj === 'object') {
    const converted: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      converted[camelKey] = snakeToCamel(value);
    }
    return converted;
  }
  
  return obj;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeInventoryProduct(
  backendProduct: any,
  branchId: string,
  existingProduct?: InventoryItem
): InventoryItem | null {
  const converted = snakeToCamel(backendProduct);
  const id = String(converted.id ?? backendProduct?.id ?? existingProduct?.id ?? '').trim();
  if (!id) {
    return null;
  }

  const itemTypeRaw = String(
    converted.itemType ?? backendProduct?.item_type ?? existingProduct?.itemType ?? 'sellable'
  ).trim().toLowerCase();
  const itemType: InventoryItem['itemType'] = itemTypeRaw === 'ingredient' ? 'ingredient' : 'sellable';

  const stockUnits = toOptionalNumber(
    converted.stockUnits ?? backendProduct?.stock_units ?? existingProduct?.stockUnits
  ) ?? 0;
  const reorderLevel = toOptionalNumber(
    converted.reorderLevel ?? backendProduct?.reorder_level ?? existingProduct?.reorderLevel
  ) ?? 0;
  const cost = toOptionalNumber(converted.cost ?? backendProduct?.cost ?? existingProduct?.cost);
  const price = toOptionalNumber(converted.price ?? backendProduct?.price ?? existingProduct?.price);
  const explicitValue = toOptionalNumber(converted.value ?? backendProduct?.value ?? existingProduct?.value);
  const value = explicitValue ?? Number((stockUnits * (cost ?? 0)).toFixed(2));

  const isProduced = toBoolean(
    converted.isProduced ?? backendProduct?.is_produced ?? existingProduct?.isProduced,
    false
  );
  const isSoldInPortions = toBoolean(
    converted.isSoldInPortions ?? backendProduct?.is_sold_in_portions ?? existingProduct?.isSoldInPortions,
    false
  );
  const portionsPerUnit = isSoldInPortions
    ? toOptionalNumber(
        converted.portionsPerUnit ??
        backendProduct?.portions_per_unit ??
        existingProduct?.portionsPerUnit
      )
    : undefined;
  const rawPortionName = String(
    converted.portionName ??
    backendProduct?.portion_name ??
    existingProduct?.portionName ??
    ''
  ).trim();
  const portionName = isSoldInPortions && rawPortionName ? rawPortionName : undefined;

  const recipe = isProduced
    ? (Array.isArray(converted.recipe) ? converted.recipe : (Array.isArray(existingProduct?.recipe) ? existingProduct?.recipe : []))
    : [];

  return {
    ...(existingProduct || {}),
    ...converted,
    id,
    branchId: String(existingProduct?.branchId || branchId).trim() || branchId,
    name: String(converted.name ?? existingProduct?.name ?? 'Unnamed Item').trim() || 'Unnamed Item',
    category: String(converted.category ?? existingProduct?.category ?? 'General').trim() || 'General',
    itemType,
    stockUnits,
    unitType: String(converted.unitType ?? existingProduct?.unitType ?? 'unit').trim() || 'unit',
    reorderLevel,
    cost,
    price: itemType === 'sellable' ? price : undefined,
    value,
    status: converted.status ?? existingProduct?.status,
    supplier: converted.supplier ?? existingProduct?.supplier,
    manufacturer: converted.manufacturer ?? existingProduct?.manufacturer,
    batch: converted.batch ?? existingProduct?.batch,
    brand: converted.brand ?? existingProduct?.brand,
    packSize: toOptionalNumber(converted.packSize ?? existingProduct?.packSize),
    productCode: converted.productCode ?? existingProduct?.productCode,
    barcode: converted.barcode ?? existingProduct?.barcode,
    sku: converted.sku ?? existingProduct?.sku,
    expiry: converted.expiry ?? existingProduct?.expiry,
    isVariablePrice: toBoolean(
      converted.isVariablePrice ?? backendProduct?.is_variable_price ?? existingProduct?.isVariablePrice,
      false
    ),
    isProduced,
    onMenu: toBoolean(converted.onMenu ?? backendProduct?.on_menu ?? existingProduct?.onMenu, false),
    isSoldInPortions,
    portionName,
    portionsPerUnit,
    recipe,
    _dirty: false,
    _operation: undefined,
    _synced_at: new Date().toISOString(),
  };
}

/**
 * Fetch products from backend and merge with local inventory
 * Also fetches and syncs MRA mappings
 */
export async function syncInventoryFromBackend(branchId: string): Promise<{
  synced: number;
  updated: number;
  created: number;
  mraMappingsSynced?: number;
  error?: string;
}> {
  try {

    const backendBranchId = toBackendBranchId(branchId);

    console.log('[InventorySync] Starting sync for branch:', branchId, 'backend ID:', backendBranchId);

    // Fetch products from backend
    const response = await authFetch.fetch<any>(
      `/inventory/products/?branch_id=${backendBranchId}`,
      { method: 'GET' }
    );

    console.log('[InventorySync] Products response type:', typeof response, 'is array:', Array.isArray(response));

    // Handle both array and paginated responses
    let products: any[] = [];
    if (Array.isArray(response)) {
      products = response;
    } else if (response?.results && Array.isArray(response.results)) {
      products = response.results;
    } else {
      console.warn('[InventorySync] Unexpected products response format:', response);
      return {
        synced: 0,
        updated: 0,
        created: 0,
        error: 'Invalid response from backend',
      };
    }

    let created = 0;
    let updated = 0;

    // Process each backend product
    for (const backendProduct of products) {
      const backendId = String(backendProduct?.id ?? '').trim();
      if (!backendId) {
        console.warn('[InventorySync] Skipping backend product without id:', backendProduct);
        continue;
      }

      const localProduct = await db.inventory.get(backendId);
      if (localProduct?._dirty) {
        console.log('[InventorySync] Skipping overwrite for dirty local product:', backendId);
        continue;
      }

      const normalizedProduct = normalizeInventoryProduct(backendProduct, branchId, localProduct);
      if (!normalizedProduct) {
        continue;
      }

      if (localProduct) {
        // Update existing product with backend data
        await db.inventory.put(normalizedProduct);
        updated++;
      } else {
        // Create new product from backend
        await db.inventory.add(normalizedProduct);
        created++;
      }
    }

    console.log('[InventorySync] Synced products:', products.length, 'created:', created, 'updated:', updated);

    // CRITICAL: Also fetch and sync MRA mappings
    // IMPORTANT: Clear old mappings first to ensure approval status changes are reflected
    let mraMappingsSynced = 0;
    try {
      console.log('[InventorySync] Fetching MRA mappings for branch:', backendBranchId);
      
      const mraMappingsResponse = await authFetch.fetch<any>(
        `/inventory/mra-mappings/?branch_id=${backendBranchId}`,
        { method: 'GET' }
      );

      let mraMappings: any[] = [];
      if (Array.isArray(mraMappingsResponse)) {
        mraMappings = mraMappingsResponse;
      } else if (mraMappingsResponse?.results && Array.isArray(mraMappingsResponse.results)) {
        mraMappings = mraMappingsResponse.results;
      }

      console.log('[InventorySync] Received MRA mappings:', mraMappings.length);

      // Store each MRA mapping in local database with fresh data from backend
      for (const mapping of mraMappings) {
        try {
          // Convert snake_case to camelCase
          const convertedMapping = snakeToCamel(mapping);

          const inventoryItemId = String(
            convertedMapping.inventoryItemId ??
            convertedMapping.inventoryItem ??
            mapping.inventory_item ??
            ''
          ).trim();

          if (!inventoryItemId) {
            console.warn('[InventorySync] Skipping MRA mapping without inventory item id:', mapping);
            continue;
          }

          const mappingToStore = {
            ...convertedMapping,
            inventoryItemId,
            branchId: String(
              convertedMapping.branchId ??
              convertedMapping.branch ??
              mapping.branch_id ??
              mapping.branch ??
              branchId ??
              ''
            ).trim() || undefined,
            _dirty: false,
            _synced_at: new Date().toISOString()
          };

          delete (mappingToStore as any).inventoryItem;

          console.log('[InventorySync] Storing MRA mapping:', mappingToStore.id, 'for product:', mappingToStore.inventoryItemId, 'approved:', mappingToStore.isApproved, 'synced:', mappingToStore.mraSynced);

          await db.mraMappings.put(mappingToStore);
          
          mraMappingsSynced++;
          console.log('[InventorySync] ✓ Stored MRA mapping for product:', mappingToStore.inventoryItemId, 'approved:', mappingToStore.isApproved);
        } catch (error) {
          console.error('[InventorySync] Error storing MRA mapping:', mapping.id, error);
        }
      }

      console.log('[InventorySync] Successfully synced', mraMappingsSynced, 'MRA mappings');
    } catch (error) {
      console.error('[InventorySync] Failed to fetch MRA mappings:', error);
    }

    return {
      synced: products.length,
      updated,
      created,
      mraMappingsSynced,
    };
  } catch (error) {
    console.error('Failed to sync inventory from backend:', error);
    return {
      synced: 0,
      updated: 0,
      created: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get sync status - check if there are pending syncs
 */
export function getInventorySyncStatus(): {
  hasPendingSync: boolean;
  lastSyncTime?: number;
} {
  try {
    if (typeof window === 'undefined') {
      return { hasPendingSync: false };
    }

    const lastSync = localStorage.getItem('handypos-inventory-last-sync');
    const lastSyncTime = lastSync ? parseInt(lastSync, 10) : undefined;

    // Consider sync stale if older than 5 minutes
    const isStale = !lastSyncTime || Date.now() - lastSyncTime > 5 * 60 * 1000;

    return {
      hasPendingSync: isStale,
      lastSyncTime,
    };
  } catch (error) {
    console.error('Failed to get inventory sync status:', error);
    return { hasPendingSync: false };
  }
}

/**
 * Mark inventory as synced
 */
export function markInventorySynced(): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem('handypos-inventory-last-sync', String(Date.now()));
  } catch (error) {
    console.error('Failed to mark inventory as synced:', error);
  }
}
