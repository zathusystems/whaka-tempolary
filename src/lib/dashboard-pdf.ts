import { saveBlobFile } from '@/lib/file-download';

type DashboardPdfData = {
  kpiData?: Array<{ title: string; value: number }>;
  salesData?: Array<{ name: string; total: number }>;
  paymentData?: Array<{ name: string; value: number }>;
  topProducts?: Array<{ name: string; unitsSold: number; revenue: number; profit: number }>;
  lowStockItems?: Array<{ name: string; category: string; stock_units: number; unit_type: string; reorder_level: number; status: string }>;
  recentSales?: Array<{ description?: string; id: string; amount: number; paymentMethod: string; createdAt: string }>;
  activeSession?: {
    opening_float: number;
    expected_cash: number;
    total_cash_sales: number;
    total_card_sales: number;
    total_mobile_money_sales: number;
  } | null;
};

type PdfColumn = {
  title: string;
  width: number;
  align?: 'left' | 'right';
};

const safeFilenamePart = (value: string): string => value.replace(/[^a-z0-9_-]+/gi, '-');

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
};

/** Generate a direct jsPDF dashboard report that works in browsers and Tauri. */
export const saveDashboardPdf = async (
  data: DashboardPdfData,
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

  const drawPageFooter = () => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.setTextColor(107, 114, 128);
    pdf.text(`Generated ${new Date().toLocaleString()}`, margin, pageHeight - 7);
  };

  const ensureSpace = (height: number) => {
    if (y + height > pageHeight - margin - 10) {
      drawPageFooter();
      pdf.addPage();
      y = margin;
    }
  };

  const drawSection = (
    title: string,
    columns: PdfColumn[],
    rows: string[][],
  ) => {
    ensureSpace(18);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(17, 24, 39);
    pdf.text(title, margin, y + 5);
    y += 11;

    const drawHeader = () => {
      pdf.setFillColor(37, 99, 235);
      pdf.rect(margin, y - 4, contentWidth, 8, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8.5);
      pdf.setTextColor(255, 255, 255);
      columns.forEach((column, index) => {
        const x = column.align === 'right'
          ? margin + columns.slice(0, index + 1).reduce((sum, item) => sum + item.width, 0) - 2
          : margin + columns.slice(0, index).reduce((sum, item) => sum + item.width, 0) + 2;
        pdf.text(column.title, x, y + 1, { align: column.align || 'left' });
      });
      y += 8;
    };

    drawHeader();
    if (rows.length === 0) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8.5);
      pdf.setTextColor(107, 114, 128);
      pdf.text('No data for this period.', margin + 2, y + 5);
      y += 12;
      return;
    }

    rows.forEach((row) => {
      const linesByColumn = row.map((value, index) => pdf.splitTextToSize(displayValue(value), columns[index].width - 4));
      const rowHeight = Math.max(7, ...linesByColumn.map((lines) => lines.length * 4 + 3));
      if (y + rowHeight > pageHeight - margin - 10) {
        drawPageFooter();
        pdf.addPage();
        y = margin;
        drawHeader();
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
        const x = column.align === 'right'
          ? margin + offset + column.width - 2
          : margin + offset + 2;
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
  pdf.text('Dashboard Report', margin, y + 14);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(75, 85, 99);
  const rangeLabel = fromDate && toDate
    ? `${fromDate.toLocaleDateString()} - ${toDate.toLocaleDateString()}`
    : 'All available dates';
  pdf.text(`Reporting period: ${rangeLabel}`, margin, y + 22);
  y += 34;

  const kpis = data.kpiData || [];
  const cardWidth = contentWidth / Math.max(kpis.length, 1);
  kpis.forEach((kpi, index) => {
    const x = margin + index * cardWidth;
    pdf.setFillColor(239, 246, 255);
    pdf.roundedRect(x + 1, y - 4, cardWidth - 3, 18, 2, 2, 'F');
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(75, 85, 99);
    pdf.text(kpi.title, x + 4, y + 2);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(12);
    pdf.setTextColor(17, 24, 39);
    pdf.text(kpi.title === 'Total Transactions' ? displayValue(kpi.value) : formatCurrency(Number(kpi.value) || 0), x + 4, y + 10);
  });
  y += 28;

  if (data.activeSession) {
    drawSection('Active Session', [
      { title: 'Opening float', width: contentWidth / 5, align: 'right' },
      { title: 'Cash sales', width: contentWidth / 5, align: 'right' },
      { title: 'Digital payments', width: contentWidth / 5, align: 'right' },
      { title: 'Expected cash', width: contentWidth / 5, align: 'right' },
      { title: 'Total session value', width: contentWidth / 5, align: 'right' },
    ], [[
      formatCurrency(Number(data.activeSession.opening_float) || 0),
      formatCurrency(Number(data.activeSession.total_cash_sales) || 0),
      formatCurrency((Number(data.activeSession.total_card_sales) || 0) + (Number(data.activeSession.total_mobile_money_sales) || 0)),
      formatCurrency(Number(data.activeSession.expected_cash) || 0),
      formatCurrency((Number(data.activeSession.opening_float) || 0) + (Number(data.activeSession.total_cash_sales) || 0)),
    ]]);
  }

  drawSection('Sales Trend', [
    { title: 'Period', width: contentWidth * 0.65 },
    { title: 'Sales total', width: contentWidth * 0.35, align: 'right' },
  ], (data.salesData || []).map((point) => [point.name, formatCurrency(Number(point.total) || 0)]));

  drawSection('Payment Methods', [
    { title: 'Payment method', width: contentWidth * 0.65 },
    { title: 'Amount', width: contentWidth * 0.35, align: 'right' },
  ], (data.paymentData || []).map((payment) => [payment.name, formatCurrency(Number(payment.value) || 0)]));

  drawSection('Top Products', [
    { title: 'Product', width: contentWidth * 0.40 },
    { title: 'Units sold', width: contentWidth * 0.15, align: 'right' },
    { title: 'Revenue', width: contentWidth * 0.225, align: 'right' },
    { title: 'Profit', width: contentWidth * 0.225, align: 'right' },
  ], (data.topProducts || []).map((product) => [
    product.name,
    displayValue(product.unitsSold),
    formatCurrency(Number(product.revenue) || 0),
    formatCurrency(Number(product.profit) || 0),
  ]));

  drawSection('Low Stock Items', [
    { title: 'Product', width: contentWidth * 0.35 },
    { title: 'Category', width: contentWidth * 0.25 },
    { title: 'Stock', width: contentWidth * 0.15, align: 'right' },
    { title: 'Reorder level', width: contentWidth * 0.15, align: 'right' },
    { title: 'Status', width: contentWidth * 0.10 },
  ], (data.lowStockItems || []).map((item) => [
    item.name,
    item.category,
    `${displayValue(item.stock_units)} ${item.unit_type || ''}`.trim(),
    displayValue(item.reorder_level),
    item.status,
  ]));

  drawSection('Recent Sales', [
    { title: 'Description', width: contentWidth * 0.40 },
    { title: 'Payment method', width: contentWidth * 0.20 },
    { title: 'Date', width: contentWidth * 0.25 },
    { title: 'Amount', width: contentWidth * 0.15, align: 'right' },
  ], (data.recentSales || []).map((sale) => [
    sale.description || `Sale #${sale.id}`,
    sale.paymentMethod,
    sale.createdAt ? new Date(sale.createdAt).toLocaleString() : '-',
    formatCurrency(Number(sale.amount) || 0),
  ]));

  drawPageFooter();
  const fromPart = fromDate ? fromDate.toISOString().slice(0, 10) : 'all';
  const toPart = toDate ? toDate.toISOString().slice(0, 10) : 'dates';
  return saveBlobFile(pdf.output('blob'), `dashboard-summary-${safeFilenamePart(fromPart)}-to-${safeFilenamePart(toPart)}.pdf`);
};
