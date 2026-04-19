import { format } from 'date-fns';

import type { Session } from '@/lib/db';
import {
  PRODUCT_REPORTING_CATEGORIES,
  type SessionProductMixSummary,
  getProductReportingCategoryMeta,
} from '@/lib/session-product-report';

export const SESSION_END_REPORT_TITLE = 'Session End Report';

export type ZReportPaymentBreakdown = {
  cash: number;
  card: number;
  mobileMoney: number;
  onAccount: number;
  other: number;
};

export type ZReportFinancialSummary = {
  orderCount: number;
  netSales: number;
  totalTax: number;
  grossSales: number;
  totalTips: number;
  totalPayable: number;
};

export type ZReportEisStatusCounts = {
  pending: number;
  submitted: number;
  accepted: number;
  rejected: number;
  unknown: number;
};

export type ZReportEisSummary = {
  ordersWithFiscalNumber: number;
  pendingFiscalNumber: number;
  eisStatusCounts: ZReportEisStatusCounts;
  ordersWithQr: number;
  ordersWithSignature: number;
  firstFiscalInvoice?: string;
  lastFiscalInvoice?: string;
  firstSubmissionAt?: string;
  lastSubmissionAt?: string;
};

export type ZReportOrderRecord = {
  status?: string;
  paymentMethod?: string;
  total?: number;
  tip?: number;
  subtotal?: number;
  tax?: number;
  vatAmount?: number;
  vat_amount?: number;
  netAmount?: number;
  net_amount?: number;
  grossAmount?: number;
  gross_amount?: number;
  fiscalInvoiceNumber?: string;
  fiscal_invoice_number?: string;
  eisStatus?: string;
  eis_status?: string;
  eisSubmittedAt?: string;
  eis_submitted_at?: string;
  qrCodePayload?: string;
  qr_code_payload?: string;
  digitalSignature?: string;
  digital_signature?: string;
  createdAt?: string;
  created_at?: string;
};

export type ZReportCalculatedSummary = {
  paymentBreakdown: ZReportPaymentBreakdown;
  financialSummary: ZReportFinancialSummary;
  eisSummary: ZReportEisSummary;
};

type ZReportSessionSnapshot = Pick<
  Session,
  | 'id'
  | 'status'
  | 'userName'
  | 'startedAt'
  | 'closedAt'
  | 'openingFloat'
  | 'actualCash'
  | 'difference'
  | 'totalSales'
>;

type BuildZReportPrintHtmlInput = {
  session: ZReportSessionSnapshot;
  paymentBreakdown: ZReportPaymentBreakdown;
  financialSummary?: ZReportFinancialSummary;
  eisSummary?: ZReportEisSummary;
  productMixSummary?: SessionProductMixSummary;
  formatCurrency: (amount: number) => string;
  generatedAt?: Date;
};

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const toFiniteNumber = (value: unknown, fallback: number = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toTrimmedString = (value: unknown): string => String(value ?? '').trim();

const toTimestamp = (value: unknown): number | null => {
  const normalized = toTrimmedString(value);
  if (!normalized) return null;
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const DEFAULT_FINANCIAL_SUMMARY: ZReportFinancialSummary = {
  orderCount: 0,
  netSales: 0,
  totalTax: 0,
  grossSales: 0,
  totalTips: 0,
  totalPayable: 0,
};

const DEFAULT_EIS_STATUS_COUNTS: ZReportEisStatusCounts = {
  pending: 0,
  submitted: 0,
  accepted: 0,
  rejected: 0,
  unknown: 0,
};

const DEFAULT_EIS_SUMMARY: ZReportEisSummary = {
  ordersWithFiscalNumber: 0,
  pendingFiscalNumber: 0,
  eisStatusCounts: DEFAULT_EIS_STATUS_COUNTS,
  ordersWithQr: 0,
  ordersWithSignature: 0,
};

const formatQuantity = (value: unknown): string => {
  const quantity = toFiniteNumber(value);
  return quantity.toFixed(Math.abs(quantity - Math.round(quantity)) < 1e-9 ? 2 : 3);
};

export const calculateZReportSummary = (
  orders: ZReportOrderRecord[]
): ZReportCalculatedSummary => {
  const activeOrders = orders.filter((order) => {
    const status = toTrimmedString(order.status).toLowerCase();
    return status !== 'voided' && status !== 'cancelled';
  });

  const paymentBreakdown: ZReportPaymentBreakdown = {
    cash: 0,
    card: 0,
    mobileMoney: 0,
    onAccount: 0,
    other: 0,
  };

  const financialSummary: ZReportFinancialSummary = {
    orderCount: activeOrders.length,
    netSales: 0,
    totalTax: 0,
    grossSales: 0,
    totalTips: 0,
    totalPayable: 0,
  };

  const fiscalValues: Array<{ value: string; createdAt: number }> = [];
  const submissionTimes: number[] = [];
  const eisSummary: ZReportEisSummary = {
    ordersWithFiscalNumber: 0,
    pendingFiscalNumber: 0,
    eisStatusCounts: {
      pending: 0,
      submitted: 0,
      accepted: 0,
      rejected: 0,
      unknown: 0,
    },
    ordersWithQr: 0,
    ordersWithSignature: 0,
  };

  activeOrders.forEach((order, index) => {
    const tipAmount = toFiniteNumber(order.tip);
    const totalValue = toFiniteNumber(order.total);
    const netValue = toFiniteNumber(order.netAmount ?? order.net_amount ?? order.subtotal);
    const taxValue = toFiniteNumber(order.vatAmount ?? order.vat_amount ?? order.tax);
    const grossValueFromTotal = totalValue - tipAmount;
    const grossValue = toFiniteNumber(
      order.grossAmount ?? order.gross_amount,
      grossValueFromTotal > 0 ? grossValueFromTotal : netValue + taxValue
    );
    const totalPayableValue = grossValue + tipAmount;

    financialSummary.netSales += netValue;
    financialSummary.totalTax += taxValue;
    financialSummary.grossSales += grossValue;
    financialSummary.totalTips += tipAmount;
    financialSummary.totalPayable += totalPayableValue;

    const saleAmount = grossValue;
    switch (toTrimmedString(order.paymentMethod).toLowerCase()) {
      case 'cash':
        paymentBreakdown.cash += saleAmount;
        break;
      case 'card':
        paymentBreakdown.card += saleAmount;
        break;
      case 'mobile money':
        paymentBreakdown.mobileMoney += saleAmount;
        break;
      case 'on account':
        paymentBreakdown.onAccount += saleAmount;
        break;
      default:
        paymentBreakdown.other += saleAmount;
        break;
    }

    const fiscalInvoiceNumber = toTrimmedString(
      order.fiscalInvoiceNumber ?? order.fiscal_invoice_number
    );
    if (fiscalInvoiceNumber) {
      eisSummary.ordersWithFiscalNumber += 1;
      fiscalValues.push({
        value: fiscalInvoiceNumber,
        createdAt:
          toTimestamp(order.createdAt ?? order.created_at) ?? Number.MAX_SAFE_INTEGER - index,
      });
    } else {
      eisSummary.pendingFiscalNumber += 1;
    }

    const eisStatus = toTrimmedString(order.eisStatus ?? order.eis_status).toUpperCase();
    switch (eisStatus) {
      case 'PENDING':
        eisSummary.eisStatusCounts.pending += 1;
        break;
      case 'SUBMITTED':
        eisSummary.eisStatusCounts.submitted += 1;
        break;
      case 'ACCEPTED':
        eisSummary.eisStatusCounts.accepted += 1;
        break;
      case 'REJECTED':
        eisSummary.eisStatusCounts.rejected += 1;
        break;
      default:
        eisSummary.eisStatusCounts.unknown += 1;
        break;
    }

    if (toTrimmedString(order.qrCodePayload ?? order.qr_code_payload)) {
      eisSummary.ordersWithQr += 1;
    }
    if (toTrimmedString(order.digitalSignature ?? order.digital_signature)) {
      eisSummary.ordersWithSignature += 1;
    }

    const submittedAt = toTimestamp(order.eisSubmittedAt ?? order.eis_submitted_at);
    if (submittedAt !== null) {
      submissionTimes.push(submittedAt);
    }
  });

  if (fiscalValues.length > 0) {
    fiscalValues.sort((a, b) => a.createdAt - b.createdAt);
    eisSummary.firstFiscalInvoice = fiscalValues[0]?.value;
    eisSummary.lastFiscalInvoice = fiscalValues[fiscalValues.length - 1]?.value;
  }

  if (submissionTimes.length > 0) {
    submissionTimes.sort((a, b) => a - b);
    eisSummary.firstSubmissionAt = new Date(submissionTimes[0]).toISOString();
    eisSummary.lastSubmissionAt = new Date(submissionTimes[submissionTimes.length - 1]).toISOString();
  }

  return {
    paymentBreakdown,
    financialSummary,
    eisSummary,
  };
};

const formatSessionDate = (value?: string): string => {
  if (!value) return 'N/A';

  try {
    return format(new Date(value), 'PPpp');
  } catch {
    return 'N/A';
  }
};

export const isSessionClosedForZReport = (
  session: Pick<Session, 'status' | 'closedAt'>
): boolean => {
  const normalizedStatus = String(session.status || '').trim().toLowerCase();
  return normalizedStatus === 'closed' || Boolean(session.closedAt);
};

export const buildZReportPrintHtml = ({
  session,
  paymentBreakdown,
  financialSummary = DEFAULT_FINANCIAL_SUMMARY,
  eisSummary = DEFAULT_EIS_SUMMARY,
  productMixSummary,
  formatCurrency,
  generatedAt = new Date(),
}: BuildZReportPrintHtmlInput): string => {
  const openingFloat = toFiniteNumber(session.openingFloat);
  const netSales = toFiniteNumber(financialSummary.netSales);
  const totalTax = toFiniteNumber(financialSummary.totalTax);
  const totalSales = toFiniteNumber(financialSummary.grossSales);
  const totalTips = toFiniteNumber(financialSummary.totalTips);
  const totalCollected = toFiniteNumber(financialSummary.totalPayable);
  const actualCash = toFiniteNumber(session.actualCash);
  const difference = toFiniteNumber(session.difference);
  const cashSales = toFiniteNumber(paymentBreakdown.cash);
  const expectedDrawer = openingFloat + cashSales;
  const fiscalAssigned = toFiniteNumber(eisSummary.ordersWithFiscalNumber);
  const fiscalPending = toFiniteNumber(eisSummary.pendingFiscalNumber);
  const ordersWithQr = toFiniteNumber(eisSummary.ordersWithQr);
  const ordersWithSignature = toFiniteNumber(eisSummary.ordersWithSignature);
  const hasProductMixSummary = PRODUCT_REPORTING_CATEGORIES.some((category) => {
    const entry = productMixSummary?.[category];
    return (
      toFiniteNumber(entry?.amount) > 0 ||
      toFiniteNumber(entry?.quantity) > 0 ||
      toFiniteNumber(entry?.itemCount) > 0
    );
  });

  const lines: string[] = [
    SESSION_END_REPORT_TITLE.toUpperCase(),
    `Session ID: ${session.id}`,
    `Session By: ${toTrimmedString(session.userName) || 'Unknown'}`,
    `Generated: ${format(generatedAt, 'PPpp')}`,
    `Started: ${formatSessionDate(session.startedAt)}`,
    `Closed: ${formatSessionDate(session.closedAt)}`,
    '--------------------------------',
    'FINANCIAL SUMMARY',
    `Orders: ${Math.max(0, Math.floor(toFiniteNumber(financialSummary.orderCount)))}`,
    `Revenue: ${formatCurrency(netSales)}`,
    `Tax Collected: ${formatCurrency(totalTax)}`,
    `Total Sales: ${formatCurrency(totalSales)}`,
    '--------------------------------',
    'PAYMENT BREAKDOWN',
    `Cash Sales: ${formatCurrency(cashSales)}`,
    `Card Sales: ${formatCurrency(toFiniteNumber(paymentBreakdown.card))}`,
    `Mobile Money: ${formatCurrency(toFiniteNumber(paymentBreakdown.mobileMoney))}`,
    `On Account: ${formatCurrency(toFiniteNumber(paymentBreakdown.onAccount))}`,
    `Other: ${formatCurrency(toFiniteNumber(paymentBreakdown.other))}`,
    '--------------------------------',
    ...(totalTips > 0
      ? [
          `Tips: ${formatCurrency(totalTips)}`,
          `Total Collected: ${formatCurrency(totalCollected)}`,
          '--------------------------------',
        ]
      : []),
    ...(hasProductMixSummary
      ? [
          'PRODUCT MIX',
          ...PRODUCT_REPORTING_CATEGORIES.flatMap((category) => {
            const entry = productMixSummary?.[category];
            const meta = getProductReportingCategoryMeta(category);
            return [
              `${meta.label}: ${formatCurrency(toFiniteNumber(entry?.amount))}`,
              `  Qty: ${formatQuantity(entry?.quantity)} | Items: ${Math.max(
                0,
                Math.floor(toFiniteNumber(entry?.itemCount))
              )}`,
            ];
          }),
          '--------------------------------',
        ]
      : []),
    'CASH RECONCILIATION',
    `Opening Float: ${formatCurrency(openingFloat)}`,
    `Expected in Drawer: ${formatCurrency(expectedDrawer)}`,
    `Actual Cash: ${formatCurrency(actualCash)}`,
    `Difference: ${formatCurrency(difference)}`,
    // '--------------------------------',
    // 'EIS COMPLIANCE',
    // `Fiscal Assigned: ${Math.max(0, Math.floor(fiscalAssigned))}`,
    // `Fiscal Pending: ${Math.max(0, Math.floor(fiscalPending))}`,
    // `EIS Pending: ${Math.max(0, Math.floor(toFiniteNumber(eisSummary.eisStatusCounts?.pending)))}`,
    // `EIS Submitted: ${Math.max(0, Math.floor(toFiniteNumber(eisSummary.eisStatusCounts?.submitted)))}`,
    // `EIS Accepted: ${Math.max(0, Math.floor(toFiniteNumber(eisSummary.eisStatusCounts?.accepted)))}`,
    // `EIS Rejected: ${Math.max(0, Math.floor(toFiniteNumber(eisSummary.eisStatusCounts?.rejected)))}`,
    // `EIS Unknown: ${Math.max(0, Math.floor(toFiniteNumber(eisSummary.eisStatusCounts?.unknown)))}`,
    // `With QR Payload: ${Math.max(0, Math.floor(ordersWithQr))}`,
    // `With Signature: ${Math.max(0, Math.floor(ordersWithSignature))}`,
    // `First Fiscal #: ${eisSummary.firstFiscalInvoice || 'N/A'}`,
    // `Last Fiscal #: ${eisSummary.lastFiscalInvoice || 'N/A'}`,
    // `First Submission: ${formatSessionDate(eisSummary.firstSubmissionAt)}`,
    // `Last Submission: ${formatSessionDate(eisSummary.lastSubmissionAt)}`,
    '--------------------------------',
    `END OF ${SESSION_END_REPORT_TITLE.toUpperCase()}`,
  ];

  return `
<div id="receipt-printable-area" style="font-family:'Courier New',monospace;font-size:12px;line-height:1.35;">
  ${lines.map((line) => `<div>${escapeHtml(line)}</div>`).join('')}
</div>
`.trim();
};
