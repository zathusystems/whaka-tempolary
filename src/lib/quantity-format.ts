import { type BusinessType } from '@/lib/inventory/config';

const WHOLE_STOCK_BUSINESS_TYPES = new Set<BusinessType>([
    'Grocery',
    'Supermarket',
    'General Retail',
    'Pharmacy',
    'Beauty Salon and Spa',
]);

type QuantityFormatOptions = {
    preferWholeNumbers?: boolean;
    maximumFractionDigits?: number;
};

export const shouldPreferWholeStockCounts = (businessType?: BusinessType): boolean => {
    return businessType ? WHOLE_STOCK_BUSINESS_TYPES.has(businessType) : false;
};

export const formatInventoryQuantity = (
    value: unknown,
    options: QuantityFormatOptions = {}
): string => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return '0';
    }

    const normalized = Math.abs(parsed) < 0.0005 ? 0 : parsed;
    const roundedWhole = Math.round(normalized);
    const wholeNumberTolerance = options.preferWholeNumbers ? 0.01 : 0.001;

    if (Math.abs(normalized - roundedWhole) <= wholeNumberTolerance) {
        return roundedWhole.toLocaleString(undefined, { maximumFractionDigits: 0 });
    }

    return normalized.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: options.maximumFractionDigits ?? (options.preferWholeNumbers ? 2 : 3),
    });
};

export const formatNotificationBadgeCount = (count: number): string => {
    return count > 9 ? '9+' : String(Math.max(0, count));
};
