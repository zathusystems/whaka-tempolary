'use client';

import { authFetch } from '@/lib/auth-fetch';
import { db, type Order, type OrderItem } from '@/lib/db';

const toNumber = (value: unknown, fallback: number = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toOptionalString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized || undefined;
};

const toIsoString = (value: unknown, fallback?: string): string => {
  const normalized = toOptionalString(value);
  if (!normalized) {
    return fallback || new Date().toISOString();
  }
  return normalized;
};

const getOrderItemInventoryId = (item: any): string | undefined => {
  const rawId =
    item?.inventoryItemId ??
    item?.inventory_item_id ??
    item?.inventoryItem ??
    item?.inventory_item;
  return toOptionalString(rawId);
};

const mapBackendOrderItemToLocal = (item: any): OrderItem => {
  const inventoryItemId = getOrderItemInventoryId(item);
  const mraProductCode = toOptionalString(item?.mra_product_code ?? item?.mraProductCode);
  const vatCategory = toOptionalString(item?.vat_category ?? item?.vatCategory);
  const taxType = toOptionalString(item?.tax_type ?? item?.taxType);
  const taxCalculationMethod = toOptionalString(
    item?.tax_calculation_method ?? item?.taxCalculationMethod
  ) as OrderItem['taxCalculationMethod'];
  const taxRate = toNumber(item?.tax_rate ?? item?.taxRate);
  const subtotal = toNumber(item?.subtotal);
  const taxAmount = toNumber(item?.tax_amount ?? item?.taxAmount);

  return {
    id: String(item?.id ?? ''),
    inventoryItemId,
    name: String(item?.name ?? 'Unknown Item'),
    quantity: toNumber(item?.quantity),
    notes: String(item?.notes ?? ''),
    price: toNumber(item?.price),
    mraProductCode,
    mra_product_code: mraProductCode,
    vatCategory,
    vat_category: vatCategory,
    taxRate,
    tax_rate: taxRate,
    taxType,
    tax_type: taxType,
    taxCalculationMethod,
    tax_calculation_method: taxCalculationMethod,
    subtotal,
    taxAmount,
    tax_amount: taxAmount,
    total: toNumber(item?.total),
  };
};

const mapBackendOrderToLocal = (
  order: any,
  fallbackSessionId: string,
  fallbackBranchId: string
): Order => {
  const createdAt = toIsoString(order?.created_at ?? order?.createdAt);
  const updatedAt = toIsoString(order?.updated_at ?? order?.updatedAt, createdAt);
  const orderType = toOptionalString(order?.order_type ?? order?.orderType) as Order['orderType'];
  const paymentMethod = toOptionalString(
    order?.payment_method ?? order?.paymentMethod
  ) as Order['paymentMethod'];
  const taxRateName = toOptionalString(order?.tax_rate_name ?? order?.taxRateName);
  const taxType = toOptionalString(order?.tax_type ?? order?.taxType) as Order['taxType'];
  const fiscalInvoiceNumber = toOptionalString(
    order?.fiscal_invoice_number ?? order?.fiscalInvoiceNumber
  );
  const eisUuid = toOptionalString(order?.eis_uuid ?? order?.eisUuid);
  const eisStatus = toOptionalString(order?.eis_status ?? order?.eisStatus) as Order['eisStatus'];
  const eisSubmittedAt = toOptionalString(
    order?.eis_submitted_at ?? order?.eisSubmittedAt
  );
  const qrCodePayload = toOptionalString(order?.qr_code_payload ?? order?.qrCodePayload);
  const digitalSignature = toOptionalString(
    order?.digital_signature ?? order?.digitalSignature
  );
  const isFiscalLocked = Boolean(
    order?.is_fiscal_locked ?? order?.isFiscalLocked ?? false
  );
  const items = Array.isArray(order?.items)
    ? order.items.map((item: any) => mapBackendOrderItemToLocal(item))
    : [];

  return {
    id: String(order?.id ?? ''),
    orderNumber: toNumber(order?.order_number ?? order?.orderNumber),
    branchId: String(order?.branch ?? fallbackBranchId ?? ''),
    sessionId: String(order?.session ?? fallbackSessionId ?? ''),
    pumpName: toOptionalString(order?.pump_name ?? order?.pumpName),
    orderType,
    items,
    status: String(order?.status ?? 'Completed') as Order['status'],
    subtotal: toNumber(order?.subtotal),
    total: toNumber(order?.total),
    tax: toNumber(order?.vat_amount ?? order?.vatAmount ?? order?.tax),
    tip: toNumber(order?.tip),
    paymentMethod,
    customerName: toOptionalString(order?.customer_name ?? order?.customerName),
    customer_name: toOptionalString(order?.customer_name ?? order?.customerName),
    customerPhone: toOptionalString(order?.customer_phone ?? order?.customerPhone),
    customer_phone: toOptionalString(order?.customer_phone ?? order?.customerPhone),
    customerTin: toOptionalString(order?.customer_tin ?? order?.customerTin),
    customer_tin: toOptionalString(order?.customer_tin ?? order?.customerTin),
    customerEmail: toOptionalString(order?.customer_email ?? order?.customerEmail),
    customer_email: toOptionalString(order?.customer_email ?? order?.customerEmail),
    customerAddress: toOptionalString(order?.customer_address ?? order?.customerAddress),
    customer_address: toOptionalString(order?.customer_address ?? order?.customerAddress),
    customerNotes: toOptionalString(order?.customer_notes ?? order?.customerNotes),
    customer_notes: toOptionalString(order?.customer_notes ?? order?.customerNotes),
    buyerName: toOptionalString(order?.buyer_name ?? order?.buyerName),
    buyer_name: toOptionalString(order?.buyer_name ?? order?.buyerName),
    buyerTin: toOptionalString(order?.buyer_tin ?? order?.buyerTin),
    buyer_tin: toOptionalString(order?.buyer_tin ?? order?.buyerTin),
    cogs: toNumber(order?.cogs),
    taxRateName,
    tax_rate_name: taxRateName,
    taxRateValue: toNumber(order?.tax_rate_value ?? order?.taxRateValue),
    tax_rate_value: toNumber(order?.tax_rate_value ?? order?.taxRateValue),
    taxType,
    tax_type: taxType,
    vatAmount: toNumber(order?.vat_amount ?? order?.vatAmount),
    vat_amount: toNumber(order?.vat_amount ?? order?.vatAmount),
    netAmount: toNumber(order?.net_amount ?? order?.netAmount),
    net_amount: toNumber(order?.net_amount ?? order?.netAmount),
    grossAmount: toNumber(order?.gross_amount ?? order?.grossAmount),
    gross_amount: toNumber(order?.gross_amount ?? order?.grossAmount),
    fiscalInvoiceNumber,
    fiscal_invoice_number: fiscalInvoiceNumber,
    eisUuid,
    eis_uuid: eisUuid,
    eisStatus,
    eis_status: eisStatus,
    eisSubmittedAt,
    eis_submitted_at: eisSubmittedAt,
    qrCodePayload,
    qr_code_payload: qrCodePayload,
    digitalSignature,
    digital_signature: digitalSignature,
    isFiscalLocked: isFiscalLocked,
    is_fiscal_locked: isFiscalLocked,
    createdAt,
    updatedAt,
  };
};

export const syncSessionOrdersToLocalDb = async ({
  sessionId,
  branchId,
  timeoutMs,
  maxAttempts,
}: {
  sessionId: string;
  branchId: string;
  timeoutMs?: number;
  maxAttempts?: number;
}): Promise<Order[]> => {
  const response = await authFetch.fetch<any>(
    `/sessions/orders/?session_id=${encodeURIComponent(String(sessionId))}`,
    { timeoutMs, maxAttempts }
  );
  const backendOrders = Array.isArray(response?.results)
    ? response.results
    : Array.isArray(response)
      ? response
      : [];

  const resolvedOrders: Order[] = [];

  for (const order of backendOrders) {
    const localOrder = mapBackendOrderToLocal(order, sessionId, branchId);
    const existingOrder = await db.orders.get(localOrder.id);

    if (existingOrder?._dirty) {
      resolvedOrders.push(existingOrder);
      continue;
    }

    await db.orders.put(localOrder);
    resolvedOrders.push(localOrder);
  }

  return resolvedOrders;
};

const toBackendBranchId = (value: string): string => {
  const normalized = String(value || '').trim();
  const match = /^(?:BRN-|branch-)(\d+)$/i.exec(normalized);
  return match ? match[1] : normalized;
};

const getBranchIdCandidates = (value: string): string[] => {
  const normalized = String(value || '').trim();
  if (!normalized) return [];
  const candidates = new Set([normalized]);
  const match = /^(?:BRN-|branch-)?(\d+)$/i.exec(normalized);
  if (match) {
    candidates.add(match[1]);
    candidates.add(`BRN-${match[1]}`);
    candidates.add(`branch-${match[1]}`);
  }
  return Array.from(candidates);
};

/**
 * Refresh the complete report period from the server and reconcile the local
 * cache. Reports must not depend on which device happened to create the sale.
 */
export const syncBranchOrdersToLocalDb = async ({
  branchId,
  from,
  to,
  timeoutMs,
  maxAttempts,
}: {
  branchId: string;
  from: string;
  to: string;
  timeoutMs?: number;
  maxAttempts?: number;
}): Promise<Order[]> => {
  const backendBranchId = toBackendBranchId(branchId);
  const query = new URLSearchParams({
    branch_id: backendBranchId,
    created_from: from,
    created_to: to,
    // The report endpoint caps this at 500. A larger page keeps month-long
    // reports from issuing dozens of sequential 25-row requests.
    page_size: '500',
  });
  const resolvedOrders: Order[] = [];
  const serverIds = new Set<string>();
  let nextUrl: string | null = `/sessions/orders/?${query.toString()}`;
  const visitedUrls = new Set<string>();

  const cacheRows: Order[] = [];

  while (nextUrl) {
    if (visitedUrls.has(nextUrl)) {
      throw new Error('Order report pagination loop detected');
    }
    visitedUrls.add(nextUrl);

    const response = await authFetch.fetch<any>(nextUrl, { timeoutMs, maxAttempts });
    const rows = Array.isArray(response)
      ? response
      : Array.isArray(response?.results)
        ? response.results
        : [];
    for (const row of rows) {
      const mapped = mapBackendOrderToLocal(row, String(row?.session ?? ''), branchId);
      if (!mapped.id) continue;
      serverIds.add(mapped.id);

      // Return the server row for reports even if this device has a pending
      // local edit. The report must describe committed business sales; the
      // dirty local row remains queued for the normal sync flow.
      resolvedOrders.push(mapped);

      cacheRows.push(mapped);
    }

    nextUrl = typeof response?.next === 'string' && response.next.trim()
      ? response.next
      : null;
  }

  // Reconcile the whole page in one IndexedDB transaction instead of doing a
  // read/write round trip for every order. This is the main performance win
  // for long report ranges.
  if (cacheRows.length > 0) {
    const existingRows = await db.orders.bulkGet(cacheRows.map((order) => order.id));
    const cleanRows = cacheRows.filter((order, index) => !existingRows[index]?._dirty);
    if (cleanRows.length > 0) {
      const syncedAt = new Date().toISOString();
      await db.orders.bulkPut(
        cleanRows.map((order) => ({
          ...order,
          _dirty: false,
          _operation: undefined,
          _synced_at: syncedAt,
        }))
      );
    }
  }

  // The server response is authoritative for this period. Remove old cached
  // rows that are no longer on the server, but preserve unsynced local sales.
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const localRowsByBranch = await Promise.all(
    getBranchIdCandidates(branchId).map((candidate) =>
      db.orders
        .where('[branchId+createdAt]')
        .between([candidate, from], [candidate, to], true, true)
        .toArray()
    )
  );
  const localRows = localRowsByBranch.flat();
  const staleIds: string[] = [];
  for (const local of localRows) {
    const createdMs = Date.parse(String(local.createdAt || ''));
    if (
      Number.isFinite(fromMs) && Number.isFinite(toMs) &&
      createdMs >= fromMs && createdMs <= toMs &&
      !serverIds.has(String(local.id)) &&
      !local._dirty &&
      local._operation !== 'delete'
    ) {
      staleIds.push(local.id);
    }
  }
  if (staleIds.length > 0) {
    await db.orders.bulkDelete(staleIds);
  }

  return resolvedOrders;
};
