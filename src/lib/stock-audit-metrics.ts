export type StockAuditMetricItem = {
  systemStock?: unknown;
  system_stock?: unknown;
  countedStock?: unknown;
  counted_stock?: unknown;
  discrepancy?: unknown;
  unitCost?: unknown;
  unit_cost?: unknown;
  cost?: unknown;
  discrepancyValue?: unknown;
  discrepancy_value?: unknown;
  countedStockProvided?: boolean;
};

export type StockAuditMetrics = {
  shortageValue: number;
  overageValue: number;
  grossValue: number;
  netValue: number;
  shortageCount: number;
  overageCount: number;
  noChangeCount: number;
  notCountedCount: number;
};

const finiteNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Calculate directional stock-audit values consistently everywhere:
 * discrepancy units = counted stock - system stock;
 * shortage value = max(system - counted, 0) * unit cost;
 * overage value = max(counted - system, 0) * unit cost.
 *
 * Gross value is the sum of both sides and therefore is always positive. Net
 * value is signed (overage minus shortage) and is the figure to use when a
 * direction is required.
 */
export const calculateStockAuditMetrics = (
  items: StockAuditMetricItem[] | undefined,
  authoritativeGrossValue?: unknown,
): StockAuditMetrics => {
  let shortageValue = 0;
  let overageValue = 0;
  let shortageCount = 0;
  let overageCount = 0;
  let noChangeCount = 0;
  let notCountedCount = 0;

  (items || []).forEach((item) => {
    if (item.countedStockProvided === false) {
      notCountedCount += 1;
      return;
    }

    const systemStock = finiteNumber(item.systemStock ?? item.system_stock);
    const countedStock = finiteNumber(item.countedStock ?? item.counted_stock);
    const rawDiscrepancy = item.discrepancy;
    const discrepancy = rawDiscrepancy === undefined || rawDiscrepancy === null || rawDiscrepancy === ''
      ? countedStock - systemStock
      : finiteNumber(rawDiscrepancy);
    const unitCost = finiteNumber(item.unitCost ?? item.unit_cost ?? item.cost);
    const rawValue = item.discrepancyValue ?? item.discrepancy_value;
    const itemValue = rawValue === undefined || rawValue === null || rawValue === ''
      ? Math.abs(discrepancy) * unitCost
      : Math.abs(finiteNumber(rawValue));

    if (discrepancy < 0) {
      shortageCount += 1;
      shortageValue += itemValue;
    } else if (discrepancy > 0) {
      overageCount += 1;
      overageValue += itemValue;
    } else {
      noChangeCount += 1;
    }
  });

  const parsedAuthoritativeGross = authoritativeGrossValue === undefined || authoritativeGrossValue === null || authoritativeGrossValue === ''
    ? Number.NaN
    : Number(authoritativeGrossValue);
  const hasAuthoritativeGross = Number.isFinite(parsedAuthoritativeGross);
  const grossValue = hasAuthoritativeGross ? Math.abs(parsedAuthoritativeGross) : shortageValue + overageValue;

  // Historical audits store one authoritative total. Older line items did
  // not store their cost snapshot, so their current-cost breakdown can drift.
  // Scale the directional parts back to the saved total so shortage + overage
  // always reconciles to the audit's recorded amount. New snapshot-backed
  // audits already have a scale of 1 (apart from harmless rounding).
  const calculatedGrossValue = shortageValue + overageValue;
  if (hasAuthoritativeGross && calculatedGrossValue > 0 && Math.abs(calculatedGrossValue - grossValue) > 0.005) {
    const scale = grossValue / calculatedGrossValue;
    shortageValue *= scale;
    overageValue *= scale;
  }

  return {
    shortageValue,
    overageValue,
    grossValue,
    netValue: overageValue - shortageValue,
    shortageCount,
    overageCount,
    noChangeCount,
    notCountedCount,
  };
};

export const stockAuditDirection = (discrepancy: unknown): 'Shortage' | 'Overage' | 'No change' => {
  const value = finiteNumber(discrepancy);
  return value < 0 ? 'Shortage' : value > 0 ? 'Overage' : 'No change';
};
