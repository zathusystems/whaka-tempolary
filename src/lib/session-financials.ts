import type { Session } from '@/lib/db';
import type {
  ZReportFinancialSummary,
  ZReportPaymentBreakdown,
} from '@/lib/z-report-print';

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const hasMeaningfulFinancialSummary = (summary: ZReportFinancialSummary): boolean =>
  summary.orderCount > 0 ||
  summary.netSales > 0 ||
  summary.totalTax > 0 ||
  summary.grossSales > 0 ||
  summary.totalTips > 0 ||
  summary.totalPayable > 0;

const hasMeaningfulPaymentBreakdown = (
  breakdown: ZReportPaymentBreakdown
): boolean =>
  breakdown.cash > 0 ||
  breakdown.card > 0 ||
  breakdown.mobileMoney > 0 ||
  breakdown.onAccount > 0 ||
  breakdown.other > 0;

export const getSessionRevenue = (
  session: Pick<Session, 'totalSales'>
): number => toFiniteNumber(session.totalSales);

export const getSessionPaymentBreakdown = (
  session: Pick<
    Session,
    | 'totalCashSales'
    | 'totalCardSales'
    | 'totalMobileMoneySales'
    | 'totalOnAccountSales'
    | 'totalOtherSales'
  >
): ZReportPaymentBreakdown => ({
  cash: toFiniteNumber(session.totalCashSales),
  card: toFiniteNumber(session.totalCardSales),
  mobileMoney: toFiniteNumber(session.totalMobileMoneySales),
  onAccount: toFiniteNumber(session.totalOnAccountSales),
  other: toFiniteNumber(session.totalOtherSales),
});

export const getSessionCollectedAmount = (
  session: Pick<
    Session,
    | 'totalCashSales'
    | 'totalCardSales'
    | 'totalMobileMoneySales'
    | 'totalOnAccountSales'
    | 'totalOtherSales'
    | 'totalSales'
    | 'totalTips'
  >
): number => {
  const paymentBreakdown = getSessionPaymentBreakdown(session);
  const collectedAmount =
    paymentBreakdown.cash +
    paymentBreakdown.card +
    paymentBreakdown.mobileMoney +
    paymentBreakdown.onAccount +
    paymentBreakdown.other;

  if (collectedAmount > 0) {
    return collectedAmount;
  }

  return getSessionRevenue(session) + toFiniteNumber(session.totalTips);
};

export const getSessionTotalSales = (
  session: Pick<
    Session,
    | 'totalCashSales'
    | 'totalCardSales'
    | 'totalMobileMoneySales'
    | 'totalOnAccountSales'
    | 'totalOtherSales'
    | 'totalSales'
    | 'totalTips'
  >
): number => {
  const collectedAmount = getSessionCollectedAmount(session);
  if (collectedAmount > 0) {
    return Math.max(collectedAmount - toFiniteNumber(session.totalTips), 0);
  }

  return getSessionRevenue(session);
};

export const getSessionTaxCollected = (
  session: Pick<
    Session,
    | 'totalCashSales'
    | 'totalCardSales'
    | 'totalMobileMoneySales'
    | 'totalOnAccountSales'
    | 'totalOtherSales'
    | 'totalSales'
    | 'totalTips'
  >
): number => Math.max(getSessionTotalSales(session) - getSessionRevenue(session), 0);

export const getSessionNonCashSales = (
  session: Pick<
    Session,
    | 'totalCardSales'
    | 'totalMobileMoneySales'
    | 'totalOnAccountSales'
    | 'totalOtherSales'
  >
): number =>
  toFiniteNumber(session.totalCardSales) +
  toFiniteNumber(session.totalMobileMoneySales) +
  toFiniteNumber(session.totalOnAccountSales) +
  toFiniteNumber(session.totalOtherSales);

export const resolveSessionFinancialSummary = (
  session: Pick<
    Session,
    | 'totalCashSales'
    | 'totalCardSales'
    | 'totalMobileMoneySales'
    | 'totalOnAccountSales'
    | 'totalOtherSales'
    | 'totalSales'
    | 'totalTips'
  >,
  financialSummary: ZReportFinancialSummary
): ZReportFinancialSummary => {
  if (hasMeaningfulFinancialSummary(financialSummary)) {
    return financialSummary;
  }

  const revenue = getSessionRevenue(session);
  const totalSales = getSessionTotalSales(session);
  const totalTips = toFiniteNumber(session.totalTips);
  const totalCollected = getSessionCollectedAmount(session);

  return {
    orderCount: financialSummary.orderCount,
    netSales: revenue,
    totalTax: Math.max(totalSales - revenue, 0),
    grossSales: totalSales,
    totalTips,
    totalPayable: totalCollected > 0 ? totalCollected : totalSales + totalTips,
  };
};

export const resolveSessionPaymentBreakdown = (
  session: Pick<
    Session,
    | 'totalCashSales'
    | 'totalCardSales'
    | 'totalMobileMoneySales'
    | 'totalOnAccountSales'
    | 'totalOtherSales'
  >,
  paymentBreakdown: ZReportPaymentBreakdown,
  financialSummary?: ZReportFinancialSummary
): ZReportPaymentBreakdown => {
  if (
    hasMeaningfulPaymentBreakdown(paymentBreakdown) ||
    (financialSummary && hasMeaningfulFinancialSummary(financialSummary))
  ) {
    return paymentBreakdown;
  }

  return getSessionPaymentBreakdown(session);
};
