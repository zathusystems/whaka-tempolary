import type { StockTake } from '@/lib/db';
import { saveBlobFile } from '@/lib/file-download';

const quantityText = (value: unknown): string => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed.toLocaleString(undefined, { maximumFractionDigits: 3 })
    : '-';
};

const safeFilenamePart = (value: string): string => value.replace(/[^a-z0-9_-]+/gi, '-');

/** Generate and save a stock audit report without DOM/html2canvas rendering. */
export const saveStockAuditPdf = async (
  audit: StockTake,
  formatCurrency: (value: number) => string,
): Promise<boolean> => {
  const { default: JsPDF } = await import('jspdf');
  const pdf = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  pdf.setDrawColor(37, 99, 235);
  pdf.setLineWidth(1.2);
  pdf.line(margin, y + 4, pageWidth - margin, y + 4);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.setTextColor(17, 24, 39);
  pdf.text('Stock Audit Report', margin, y + 14);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(75, 85, 99);
  pdf.text(`Audit ${audit.id}`, margin, y + 21);
  y += 34;

  const writeLabelValue = (label: string, value: string, x: number, width: number) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(107, 114, 128);
    pdf.text(label, x, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(17, 24, 39);
    pdf.text(pdf.splitTextToSize(value || '-', width), x + 22, y);
  };

  writeLabelValue('Status', audit.status, margin, 45);
  writeLabelValue('Submitted', audit.createdAt ? new Date(audit.createdAt).toLocaleString() : '-', margin + contentWidth / 2, 55);
  y += 7;
  writeLabelValue('By', audit.createdBy || 'Unknown', margin, 45);
  writeLabelValue('Approved', audit.approvedBy || '-', margin + contentWidth / 2, 55);
  y += 7;
  writeLabelValue('Approved at', audit.approvedAt ? new Date(audit.approvedAt).toLocaleString() : '-', margin, 45);
  writeLabelValue('Reason', audit.notes || 'No reason recorded', margin + contentWidth / 2, 55);
  y += 14;

  pdf.setFillColor(239, 246, 255);
  pdf.roundedRect(margin, y - 4, contentWidth, 15, 2, 2, 'F');
  pdf.setFontSize(9);
  pdf.setTextColor(75, 85, 99);
  pdf.text('Products', margin + 5, y + 3);
  pdf.text('Total variance value', margin + contentWidth / 2, y + 3);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(17, 24, 39);
  pdf.text(String(audit.items.length), margin + 5, y + 9);
  pdf.text(formatCurrency(Number(audit.totalDiscrepancyValue) || 0), margin + contentWidth / 2, y + 9);
  y += 25;

  const columns = [
    { title: 'Product', x: margin, width: contentWidth * 0.5, align: 'left' as const },
    { title: 'System stock', x: margin + contentWidth * 0.5, width: contentWidth * 0.17, align: 'right' as const },
    { title: 'Counted stock', x: margin + contentWidth * 0.67, width: contentWidth * 0.17, align: 'right' as const },
    { title: 'Variance', x: margin + contentWidth * 0.84, width: contentWidth * 0.16, align: 'right' as const },
  ];

  const drawTableHeader = () => {
    pdf.setFillColor(37, 99, 235);
    pdf.rect(margin, y - 5, contentWidth, 9, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.setTextColor(255, 255, 255);
    columns.forEach((column) => {
      const textX = column.align === 'right' ? column.x + column.width - 2 : column.x + 2;
      pdf.text(column.title, textX, y + 1, { align: column.align });
    });
    y += 9;
  };
  drawTableHeader();

  audit.items.forEach((item) => {
    const discrepancy = Number(item.discrepancy) || 0;
    const nameLines = pdf.splitTextToSize(String(item.itemName || 'Product'), columns[0].width - 4);
    const rowHeight = Math.max(8, nameLines.length * 4.5 + 3);
    if (y + rowHeight > pageHeight - margin - 10) {
      pdf.addPage();
      y = margin;
      drawTableHeader();
    }

    pdf.setDrawColor(226, 232, 240);
    pdf.setLineWidth(0.2);
    pdf.line(margin, y + rowHeight, pageWidth - margin, y + rowHeight);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(17, 24, 39);
    pdf.text(nameLines, columns[0].x + 2, y + 4);
    pdf.text(quantityText(item.systemStock), columns[1].x + columns[1].width - 2, y + 4, { align: 'right' });
    pdf.text(quantityText(item.countedStock), columns[2].x + columns[2].width - 2, y + 4, { align: 'right' });
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(discrepancy < 0 ? 185 : discrepancy > 0 ? 21 : 17, discrepancy < 0 ? 28 : discrepancy > 0 ? 128 : 24, discrepancy < 0 ? 28 : discrepancy > 0 ? 61 : 39);
    pdf.text(`${discrepancy > 0 ? '+' : ''}${quantityText(discrepancy)}`, columns[3].x + columns[3].width - 2, y + 4, { align: 'right' });
    y += rowHeight;
  });

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(107, 114, 128);
  pdf.text(`Generated ${new Date().toLocaleString()}`, margin, pageHeight - margin);

  const filename = `stock-audit-${safeFilenamePart(String(audit.id))}.pdf`;
  return saveBlobFile(pdf.output('blob'), filename);
};
