import { saveBlobFile } from '@/lib/file-download';

export type FinancialReportPdfData = {
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
  salesTrend?: Array<{ name: string; total: number }>;
  salesByProductType: Array<{
    label: string;
    shortLabel: string;
    amount: number;
    quantity: number;
    itemCount: number;
  }>;
  topProducts: Array<{
    name: string;
    quantity: number;
    revenue: number;
    totalSales: number;
    productType?: string;
  }>;
  fastMovingProducts: Array<{
    name: string;
    quantity: number;
    totalSales: number;
    averagePerDay: number;
    currentStock: number;
    unitType: string;
    productType?: string;
  }>;
  slowMovingProducts: Array<{
    name: string;
    quantity: number;
    totalSales: number;
    averagePerDay: number;
    currentStock: number;
    unitType: string;
    productType?: string;
  }>;
  salesByCategory: Array<{ name: string; revenue: number; totalSales: number }>;
  salesByStaff: Array<{ name: string; revenue: number; totalSales: number; transactions: number }>;
};

export type MraAuditPdfRow = {
  receiptId: unknown;
  orderNumber: unknown;
  createdAt: unknown;
  status: unknown;
  paymentMethod: unknown;
  subtotal: number;
  tax: number;
  total: number;
  fiscalInvoiceNumber: unknown;
  eisStatus: unknown;
  eisUuid: unknown;
  eisSubmittedAt: unknown;
  qrCodePayload: unknown;
  digitalSignature: unknown;
  buyerName: unknown;
  buyerPhone: unknown;
  buyerTin: unknown;
  buyerEmail: unknown;
  buyerAddress: unknown;
  branchId: unknown;
  sessionId: unknown;
  items: unknown;
};

const safeFilenamePart = (value: string): string => value.replace(/[^a-z0-9_-]+/gi, '-');

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
};

const dateLabel = (value: unknown): string => {
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? displayValue(value) : parsed.toLocaleString();
};

const periodLabel = (fromDate?: Date, toDate?: Date): string => {
  if (!fromDate && !toDate) return 'All available dates';
  const from = fromDate?.toLocaleDateString() || 'Start';
  const to = toDate?.toLocaleDateString() || from;
  return `${from} - ${to}`;
};

type PdfColumn = {
  title: string;
  width: number;
  align?: 'left' | 'right';
};

/** Generate and save the selected-period financial summary directly as a PDF in browsers and Tauri. */
export const saveFinancialReportPdf = async (
  data: FinancialReportPdfData,
  fromDate: Date | undefined,
  toDate: Date | undefined,
  formatCurrency: (value: number) => string,
): Promise<boolean> => {
  const { default: JsPDF } = await import('jspdf');
  const pdf = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const footer = () => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(107, 114, 128);
    pdf.text(`Generated ${new Date().toLocaleString()}`, margin, pageHeight - 7);
  };
  const ensureSpace = (height: number) => {
    if (y + height > pageHeight - margin - 10) {
      footer();
      pdf.addPage();
      y = margin;
    }
  };

  const drawSection = (title: string, columns: PdfColumn[], rows: string[][]) => {
    ensureSpace(20);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(17, 24, 39);
    pdf.text(title, margin, y + 5);
    y += 11;

    const drawTableHeader = () => {
      pdf.setFillColor(37, 99, 235);
      pdf.rect(margin, y - 4, contentWidth, 8, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.setTextColor(255, 255, 255);
      let offset = 0;
      columns.forEach((column) => {
        const x = column.align === 'right' ? margin + offset + column.width - 2 : margin + offset + 2;
        pdf.text(column.title, x, y + 1, { align: column.align || 'left' });
        offset += column.width;
      });
      y += 8;
    };

    drawTableHeader();
    if (rows.length === 0) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);
      pdf.setTextColor(107, 114, 128);
      pdf.text('No data for this period.', margin + 2, y + 5);
      y += 14;
      return;
    }

    rows.forEach((row) => {
      const linesByColumn = row.map((value, index) =>
        pdf.splitTextToSize(displayValue(value), columns[index].width - 4),
      );
      const rowHeight = Math.max(7, ...linesByColumn.map((lines) => lines.length * 4 + 3));
      if (y + rowHeight > pageHeight - margin - 10) {
        footer();
        pdf.addPage();
        y = margin;
        drawTableHeader();
      }

      pdf.setDrawColor(226, 232, 240);
      pdf.setLineWidth(0.2);
      pdf.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(17, 24, 39);
      let offset = 0;
      linesByColumn.forEach((lines, index) => {
        const column = columns[index];
        const x = column.align === 'right' ? margin + offset + column.width - 2 : margin + offset + 2;
        pdf.text(lines, x, y + 4, { align: column.align || 'left' });
        offset += column.width;
      });
      y += rowHeight;
    });
    y += 7;
  };

  pdf.setDrawColor(37, 99, 235);
  pdf.setLineWidth(1.2);
  pdf.line(margin, y + 4, pageWidth - margin, y + 4);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.setTextColor(17, 24, 39);
  pdf.text('Financial Reports Summary', margin, y + 14);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(75, 85, 99);
  pdf.text(`Reporting period: ${periodLabel(fromDate, toDate)}`, margin, y + 22);
  pdf.text(`${data.totalTransactions} transaction${data.totalTransactions === 1 ? '' : 's'}`, pageWidth - margin, y + 22, { align: 'right' });
  y += 34;

  const kpis = [
    ['Total Sales', formatCurrency(data.totalSales)],
    ['Revenue Excl. Tax', formatCurrency(data.totalRevenue)],
    ['Gross Profit', formatCurrency(data.grossProfit)],
    ['Net Profit', formatCurrency(data.netProfit)],
    ['Transactions', displayValue(data.totalTransactions)],
  ];
  const cardWidth = contentWidth / kpis.length;
  kpis.forEach(([label, value], index) => {
    const x = margin + index * cardWidth;
    pdf.setFillColor(239, 246, 255);
    pdf.roundedRect(x + 1, y - 4, cardWidth - 3, 18, 2, 2, 'F');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(75, 85, 99);
    pdf.text(label, x + 4, y + 2);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(17, 24, 39);
    pdf.text(value, x + 4, y + 10);
  });
  y += 28;

  drawSection('Profit & Loss Statement', [
    { title: 'Metric', width: contentWidth * 0.7 },
    { title: 'Amount', width: contentWidth * 0.3, align: 'right' },
  ], [
    ['Revenue Excl. Tax', formatCurrency(data.totalRevenue)],
    ['Tax Collected', formatCurrency(data.totalTax)],
    ['Total Sales Incl. Tax', formatCurrency(data.totalSales)],
    ['Cost of Goods Sold', formatCurrency(data.totalCogs)],
    ['Gross Profit', formatCurrency(data.grossProfit)],
    ['Operating Expenses', formatCurrency(data.totalExpenses)],
    ['Net Profit', formatCurrency(data.netProfit)],
    ['Profit Margin', `${Number(data.profitMargin || 0).toFixed(2)}%`],
  ]);

  drawSection('Activity Metrics', [
    { title: 'Metric', width: contentWidth * 0.7 },
    { title: 'Value', width: contentWidth * 0.3, align: 'right' },
  ], [
    ['Total Transactions', displayValue(data.totalTransactions)],
    ['Average Sale Value', formatCurrency(data.averageSaleValue)],
    ['Average Revenue per Order', formatCurrency(data.averageRevenuePerOrder)],
  ]);

  drawSection('Sales Trend', [
    { title: 'Period', width: contentWidth * 0.65 },
    { title: 'Sales Total', width: contentWidth * 0.35, align: 'right' },
  ], (data.salesTrend || []).map((point) => [point.name, formatCurrency(Number(point.total) || 0)]));

  drawSection('Product Type Sales Mix', [
    { title: 'Product Type', width: contentWidth * 0.4 },
    { title: 'Products', width: contentWidth * 0.15, align: 'right' },
    { title: 'Quantity', width: contentWidth * 0.2, align: 'right' },
    { title: 'Sales', width: contentWidth * 0.25, align: 'right' },
  ], (data.salesByProductType || []).map((entry) => [
    entry.label || entry.shortLabel,
    displayValue(entry.itemCount),
    displayValue(entry.quantity),
    formatCurrency(Number(entry.amount) || 0),
  ]));

  drawSection('Top Products', [
    { title: 'Product', width: contentWidth * 0.34 },
    { title: 'Type', width: contentWidth * 0.16 },
    { title: 'Quantity', width: contentWidth * 0.15, align: 'right' },
    { title: 'Revenue', width: contentWidth * 0.18, align: 'right' },
    { title: 'Sales', width: contentWidth * 0.17, align: 'right' },
  ], (data.topProducts || []).slice(0, 15).map((product) => [
    product.name,
    product.productType || '-',
    displayValue(product.quantity),
    formatCurrency(Number(product.revenue) || 0),
    formatCurrency(Number(product.totalSales) || 0),
  ]));

  drawSection('Sales by Category', [
    { title: 'Category', width: contentWidth * 0.5 },
    { title: 'Revenue', width: contentWidth * 0.25, align: 'right' },
    { title: 'Sales', width: contentWidth * 0.25, align: 'right' },
  ], (data.salesByCategory || []).map((category) => [
    category.name,
    formatCurrency(Number(category.revenue) || 0),
    formatCurrency(Number(category.totalSales) || 0),
  ]));

  drawSection('Sales by Staff', [
    { title: 'Staff member', width: contentWidth * 0.35 },
    { title: 'Transactions', width: contentWidth * 0.18, align: 'right' },
    { title: 'Revenue', width: contentWidth * 0.23, align: 'right' },
    { title: 'Sales', width: contentWidth * 0.24, align: 'right' },
  ], (data.salesByStaff || []).map((staff) => [
    staff.name,
    displayValue(staff.transactions),
    formatCurrency(Number(staff.revenue) || 0),
    formatCurrency(Number(staff.totalSales) || 0),
  ]));

  const movementRows = (products: FinancialReportPdfData['fastMovingProducts']) => products.slice(0, 15).map((product) => [
    product.name,
    product.productType || '-',
    displayValue(product.quantity),
    displayValue(product.averagePerDay),
    `${displayValue(product.currentStock)} ${product.unitType || ''}`.trim(),
  ]);
  drawSection('Fast-moving Products', [
    { title: 'Product', width: contentWidth * 0.34 },
    { title: 'Type', width: contentWidth * 0.16 },
    { title: 'Quantity', width: contentWidth * 0.15, align: 'right' },
    { title: 'Avg / day', width: contentWidth * 0.15, align: 'right' },
    { title: 'Current stock', width: contentWidth * 0.20, align: 'right' },
  ], movementRows(data.fastMovingProducts || []));
  drawSection('Slow-moving Products', [
    { title: 'Product', width: contentWidth * 0.34 },
    { title: 'Type', width: contentWidth * 0.16 },
    { title: 'Quantity', width: contentWidth * 0.15, align: 'right' },
    { title: 'Avg / day', width: contentWidth * 0.15, align: 'right' },
    { title: 'Current stock', width: contentWidth * 0.20, align: 'right' },
  ], movementRows(data.slowMovingProducts || []));

  footer();
  const fromLabel = fromDate ? fromDate.toISOString().slice(0, 10) : 'from';
  const toLabel = (toDate || fromDate || new Date()).toISOString().slice(0, 10);
  return saveBlobFile(pdf.output('blob'), `financial-report-${safeFilenamePart(fromLabel)}-to-${safeFilenamePart(toLabel)}.pdf`);
};

/** Generate and save a detailed MRA/EIS audit PDF, including all receipt fields. */
export const saveMraAuditPdf = async (
  rows: MraAuditPdfRow[],
  fromDate: Date | undefined,
  toDate: Date | undefined,
  formatCurrency: (value: number) => string,
): Promise<boolean> => {
  const { default: JsPDF } = await import('jspdf');
  const pdf = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  const footer = () => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(107, 114, 128);
    pdf.text(`Generated ${new Date().toLocaleString()}`, margin, pageHeight - 7);
  };
  const ensureSpace = (height: number) => {
    if (y + height > pageHeight - margin - 10) {
      footer();
      pdf.addPage();
      y = margin;
    }
  };
  const drawField = (label: string, value: unknown, x: number, width: number) => {
    const labelWidth = 25;
    const lines = pdf.splitTextToSize(displayValue(value), width - labelWidth - 3);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(107, 114, 128);
    pdf.text(label, x, y + 3);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(17, 24, 39);
    pdf.text(lines, x + labelWidth, y + 3);
    return Math.max(6, lines.length * 3.5 + 2);
  };

  pdf.setDrawColor(37, 99, 235);
  pdf.setLineWidth(1.2);
  pdf.line(margin, y + 4, pageWidth - margin, y + 4);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.setTextColor(17, 24, 39);
  pdf.text('MRA / EIS Audit Report', margin, y + 14);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(75, 85, 99);
  pdf.text(`Reporting period: ${periodLabel(fromDate, toDate)}`, margin, y + 22);
  pdf.text(`${rows.length} receipt${rows.length === 1 ? '' : 's'}`, pageWidth - margin, y + 22, { align: 'right' });
  y += 34;

  rows.forEach((row, index) => {
    ensureSpace(46);
    pdf.setFillColor(239, 246, 255);
    pdf.roundedRect(margin, y - 4, contentWidth, 9, 2, 2, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(17, 24, 39);
    pdf.text(`Receipt ${index + 1}: ${displayValue(row.receiptId)}  |  Order ${displayValue(row.orderNumber)}`, margin + 4, y + 2);
    y += 11;

    const columnGap = 8;
    const columnWidth = (contentWidth - columnGap) / 2;
    const left = margin;
    const right = margin + columnWidth + columnGap;
    const drawRow = (leftField: [string, unknown], rightField: [string, unknown]) => {
      const leftHeight = drawField(leftField[0], leftField[1], left, columnWidth);
      const rightHeight = drawField(rightField[0], rightField[1], right, columnWidth);
      y += Math.max(leftHeight, rightHeight);
    };

    drawRow(['Created', dateLabel(row.createdAt)], ['Status', row.status]);
    drawRow(['Payment', row.paymentMethod], ['Fiscal invoice', row.fiscalInvoiceNumber]);
    drawRow(['EIS status', row.eisStatus], ['EIS submitted', dateLabel(row.eisSubmittedAt)]);
    drawRow(['Branch', row.branchId], ['Session', row.sessionId]);
    drawRow(['Buyer', row.buyerName], ['Buyer phone', row.buyerPhone]);
    drawRow(['Buyer TIN', row.buyerTin], ['Buyer email', row.buyerEmail]);
    drawRow(['Buyer address', row.buyerAddress], ['Subtotal', formatCurrency(Number(row.subtotal) || 0)]);
    drawRow(['Tax', formatCurrency(Number(row.tax) || 0)], ['Total', formatCurrency(Number(row.total) || 0)]);
    drawRow(['EIS UUID', row.eisUuid], ['QR payload', row.qrCodePayload]);
    drawRow(['Signature', row.digitalSignature], ['Items', row.items]);
    y += 4;
    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.2);
    pdf.line(margin, y, pageWidth - margin, y);
    y += 7;
  });

  if (rows.length === 0) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(107, 114, 128);
    pdf.text('No receipts for this period.', margin, y);
  }

  footer();
  const fromLabel = fromDate ? fromDate.toISOString().slice(0, 10) : 'from';
  const toLabel = (toDate || fromDate || new Date()).toISOString().slice(0, 10);
  return saveBlobFile(pdf.output('blob'), `mra-audit-${safeFilenamePart(fromLabel)}-to-${safeFilenamePart(toLabel)}.pdf`);
};
