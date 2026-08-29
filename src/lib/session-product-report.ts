import type { InventoryItem } from '@/lib/db';

export const PRODUCT_REPORTING_CATEGORIES = ['normal', 'oil', 'fuel'] as const;

export type ProductReportingCategory = (typeof PRODUCT_REPORTING_CATEGORIES)[number];

export type SessionProductMixEntry = {
  quantity: number;
  amount: number;
  itemCount: number;
};

export type SessionProductMixSummary = Record<ProductReportingCategory, SessionProductMixEntry>;

export type ProductCategorySummaryRow = SessionProductMixEntry & {
  category: ProductReportingCategory;
  label: string;
  shortLabel: string;
  badgeClassName: string;
};

type InventoryCategoryLookupItem = Pick<InventoryItem, 'id' | 'name' | 'isFuel' | 'isOil'>;

type ResolveProductCategoryInput = {
  inventoryItemId?: string | number | null;
  name?: string | null;
};

type SummaryRowInput = {
  category: ProductReportingCategory;
  key?: string;
  quantity?: number;
  amount?: number;
};

type SessionOrderLike = {
  status?: string;
  items?: Array<{
    inventoryItemId?: string | number | null;
    inventory_item_id?: string | number | null;
    inventoryItem?: string | number | null;
    inventory_item?: string | number | null;
    name?: string | null;
    quantity?: number;
    total?: number;
    price?: number;
  }>;
};

const PRODUCT_REPORTING_META: Record<
  ProductReportingCategory,
  { label: string; shortLabel: string; badgeClassName: string }
> = {
  normal: {
    label: 'Normal Products',
    shortLabel: 'Normal',
    badgeClassName: 'border-slate-300 text-slate-700',
  },
  oil: {
    label: 'Oil Products',
    shortLabel: 'Oils',
    badgeClassName: 'border-amber-300 text-amber-700',
  },
  fuel: {
    label: 'Fuel Products',
    shortLabel: 'Fuel',
    badgeClassName: 'border-sky-300 text-sky-700',
  },
};

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeProductName = (value?: string | null): string => {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
};

const createEmptySummary = (): SessionProductMixSummary => ({
  normal: { quantity: 0, amount: 0, itemCount: 0 },
  oil: { quantity: 0, amount: 0, itemCount: 0 },
  fuel: { quantity: 0, amount: 0, itemCount: 0 },
});

export const resolveInventoryProductReportingCategory = (
  item?: Pick<InventoryItem, 'isFuel' | 'isOil'> | null
): ProductReportingCategory => {
  // Oil takes precedence if a product is flagged both ways so oils remain separated.
  if (Boolean(item?.isOil)) return 'oil';
  if (Boolean(item?.isFuel)) return 'fuel';
  return 'normal';
};

export const getProductReportingCategoryMeta = (
  category: ProductReportingCategory
) => PRODUCT_REPORTING_META[category];

export const createInventoryProductCategoryResolver = (
  inventoryItems: InventoryCategoryLookupItem[]
) => {
  const categoryById = new Map<string, ProductReportingCategory>();
  const categoryByName = new Map<string, ProductReportingCategory>();

  inventoryItems.forEach((item) => {
    const category = resolveInventoryProductReportingCategory(item);
    const itemId = String(item.id ?? '').trim();
    if (itemId) {
      categoryById.set(itemId, category);
    }

    const normalizedName = normalizeProductName(item.name);
    if (normalizedName && !categoryByName.has(normalizedName)) {
      categoryByName.set(normalizedName, category);
    }
  });

  return ({ inventoryItemId, name }: ResolveProductCategoryInput): ProductReportingCategory => {
    const normalizedItemId = String(inventoryItemId ?? '').trim();
    if (normalizedItemId && categoryById.has(normalizedItemId)) {
      return categoryById.get(normalizedItemId)!;
    }

    const normalizedName = normalizeProductName(name);
    if (normalizedName && categoryByName.has(normalizedName)) {
      return categoryByName.get(normalizedName)!;
    }

    return 'normal';
  };
};

export const summarizeProductCategoryRows = (
  rows: SummaryRowInput[]
): SessionProductMixSummary => {
  const summary = createEmptySummary();
  const trackedKeys: Record<ProductReportingCategory, Set<string>> = {
    normal: new Set<string>(),
    oil: new Set<string>(),
    fuel: new Set<string>(),
  };

  rows.forEach((row, index) => {
    const category = row.category;
    summary[category].quantity += toFiniteNumber(row.quantity);
    summary[category].amount += toFiniteNumber(row.amount);
    trackedKeys[category].add(String(row.key ?? `row-${index}`));
  });

  PRODUCT_REPORTING_CATEGORIES.forEach((category) => {
    summary[category].itemCount = trackedKeys[category].size;
  });

  return summary;
};

export const summarizeSessionOrderProductMix = (
  orders: SessionOrderLike[],
  inventoryItems: InventoryCategoryLookupItem[]
): SessionProductMixSummary => {
  const resolveCategory = createInventoryProductCategoryResolver(inventoryItems);
  const summary = createEmptySummary();
  const trackedKeys: Record<ProductReportingCategory, Set<string>> = {
    normal: new Set<string>(),
    oil: new Set<string>(),
    fuel: new Set<string>(),
  };

  const activeOrders = orders.filter((order) => {
    const status = String(order?.status ?? '').trim().toLowerCase();
    return status !== 'voided' && status !== 'cancelled';
  });

  activeOrders.forEach((order, orderIndex) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    items.forEach((item, itemIndex) => {
      const inventoryItemId =
        item?.inventoryItemId ??
        item?.inventory_item_id ??
        item?.inventoryItem ??
        item?.inventory_item;
      const quantity = toFiniteNumber(item?.quantity);
      const amount = toFiniteNumber(item?.total, toFiniteNumber(item?.price) * quantity);
      const category = resolveCategory({
        inventoryItemId,
        name: item?.name,
      });

      summary[category].quantity += quantity;
      summary[category].amount += amount;
      const normalizedItemId = String(inventoryItemId ?? '').trim();
      const itemKey =
        normalizedItemId ||
        normalizeProductName(item?.name) ||
        `order-${orderIndex}-item-${itemIndex}`;
      trackedKeys[category].add(itemKey);
    });
  });

  PRODUCT_REPORTING_CATEGORIES.forEach((category) => {
    summary[category].itemCount = trackedKeys[category].size;
  });

  return summary;
};

export const toProductCategorySummaryRows = (
  summary: SessionProductMixSummary
): ProductCategorySummaryRow[] =>
  PRODUCT_REPORTING_CATEGORIES.map((category) => ({
    category,
    label: PRODUCT_REPORTING_META[category].label,
    shortLabel: PRODUCT_REPORTING_META[category].shortLabel,
    badgeClassName: PRODUCT_REPORTING_META[category].badgeClassName,
    quantity: summary[category].quantity,
    amount: summary[category].amount,
    itemCount: summary[category].itemCount,
  }));
