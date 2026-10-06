

'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import * as XLSX from 'xlsx';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Save,
  Search,
  FileUp,
  Send,
  Download,
  Upload,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';

import { db, type InventoryItem, type StockTake } from '@/lib/db';
import { useCurrency } from '@/hooks/use-currency';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';
import { authFetch } from '@/lib/auth-fetch';
import { saveBlobFile } from '@/lib/file-download';
import { syncInventoryFromBackend } from '@/lib/services/inventory-sync';
import { calculateStockAuditMetrics, stockAuditDirection } from '@/lib/stock-audit-metrics';

const LOCAL_STORAGE_KEYS = {
    ACTIVE_BRANCH: 'handypos-active-branch'
};

type StockTakeFormValues = {
  items: (InventoryItem & { countedStock: number | string; countedStockProvided?: boolean })[];
};

type StockCountSheetRow = {
  'Item ID'?: unknown;
  'Product Name'?: unknown;
  SKU?: unknown;
  Barcode?: unknown;
  'System Stock'?: unknown;
  Unit?: unknown;
  'Counted Stock'?: unknown;
};

type AuditSheetComparisonIssue = {
  kind: 'Mismatch' | 'Missing' | 'Extra' | 'Invalid';
  itemId: string;
  productName: string;
  details: string;
};

type AuditSheetComparison = {
  auditId: string;
  filename: string;
  matchedCount: number;
  ignoredUnchangedCount: number;
  issues: AuditSheetComparisonIssue[];
};

const STOCK_COUNT_SHEET_COLUMNS = [
  'Item ID',
  'Product Name',
  'System Stock',
  'Unit',
  'Counted Stock',
];

const stockCountNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  const normalized = String(value ?? '').trim().replace(/,/g, '');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const sameStockQuantity = (left: number | null, right: number): boolean => (
  left !== null && Number.isFinite(left) && Math.abs(left - right) < 0.0005
);

const historyStatusLabel = (audit: any): string => {
  const status = String(audit?.status || 'Submitted');
  return status === 'Pending' ? 'Pending Approval' : status;
};

const historyItems = (audit: any): any[] => Array.isArray(audit?.items) ? audit.items : [];

const historyQuantity = (value: unknown): string => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '-';
};

const historyGrossDiscrepancyValue = (audit: any): number => {
  // Historical totals are stored when the audit is created. Do not recalculate
  // them with today's product costs, which can make an approved audit drift.
  return Number(audit?.total_discrepancy_value ?? audit?.totalDiscrepancyValue) || 0;
};

const readableErrorValue = (value: unknown, path = ''): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return `${path ? `${path}: ` : ''}${String(value)}`;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry, index) => readableErrorValue(entry, path || String(index)))
      .filter(Boolean)
      .join('; ');
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => readableErrorValue(entry, path ? `${path}.${key}` : key))
      .filter(Boolean)
      .join('; ');
  }
  return '';
};

const submissionErrorMessage = (error: unknown): string => {
  const details = error as { message?: unknown; status?: unknown; data?: unknown };
  const message = typeof details?.message === 'string' && details.message.trim()
    ? details.message.trim()
    : 'The request could not be completed.';
  const structuredData = readableErrorValue(details?.data);
  const readableMessage = message === '[object Object]' && structuredData ? structuredData : message;
  const status = Number(details?.status);
  return Number.isFinite(status) && status > 0 ? `HTTP ${status}: ${readableMessage}` : readableMessage;
};

export default function StockAuditPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { user } = useAuth();
  const { format: formatCurrency } = useCurrency();
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [submissionMessage, setSubmissionMessage] = useState('');
  const [auditReason, setAuditReason] = useState('');
  const [auditHistory, setAuditHistory] = useState<any[]>([]);
  const [auditHistorySearch, setAuditHistorySearch] = useState('');
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const [isLoadingAuditHistory, setIsLoadingAuditHistory] = useState(false);
  const [isHistoryDialogOpen, setIsHistoryDialogOpen] = useState(false);
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false);
  const [hasImportedStockSheet, setHasImportedStockSheet] = useState(false);
  const [isExportingReport, setIsExportingReport] = useState(false);
  const [exportingHistoryAuditId, setExportingHistoryAuditId] = useState<string | null>(null);
  const [auditSheetComparison, setAuditSheetComparison] = useState<AuditSheetComparison | null>(null);
  const [isComparingAuditSheet, setIsComparingAuditSheet] = useState(false);
  const stockSheetInputRef = useRef<HTMLInputElement>(null);
  const auditSheetInputRef = useRef<HTMLInputElement>(null);
  const comparisonTargetAuditIdRef = useRef<string | null>(null);
  const stockReportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const branchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
    if (branchId) {
      setActiveBranchId(branchId);
    }
  }, []);

  const inventoryItems = useLiveQuery(
    () => {
        if (!activeBranchId) return [];
        return db.inventory.where('branchId').equals(activeBranchId).toArray().then(items => 
          items.filter(item => !item.isProduced)
        )
    },
    [activeBranchId]
  );

  const form = useForm<StockTakeFormValues>();
  const { control, handleSubmit, getValues, setValue } = form;

  const { fields, replace } = useFieldArray({
    control,
    name: 'items',
  });
  const hydratedBranchIdRef = useRef<string | null>(null);
  const watchedItems = useWatch({ control, name: 'items' }) || [];
  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const visibleFields = useMemo(() => fields.filter((item) => {
    if (!normalizedSearchTerm) return true;
    return [item.name, item.sku, item.barcode, item.productCode, item.category]
      .some((value) => String(value || '').toLowerCase().includes(normalizedSearchTerm));
  }), [fields, normalizedSearchTerm]);

  useEffect(() => {
    // Dexie live queries can re-run while an input is being edited. Replacing
    // the field array on each result remounts inputs and makes them lose focus.
    if (!inventoryItems || inventoryItems.length === 0 || !activeBranchId || hydratedBranchIdRef.current === activeBranchId) return;

    replace(inventoryItems.map((item) => ({
      ...item,
      countedStock: item.stockUnits ?? '',
      countedStockProvided: true,
    })));
    hydratedBranchIdRef.current = activeBranchId;
  }, [activeBranchId, inventoryItems, replace]);

  useEffect(() => {
    // A background refresh can add costs after the form has been hydrated.
    // Update only the cost fields so an in-progress physical count is not
    // replaced or its input values remounted.
    if (!inventoryItems || !activeBranchId || hydratedBranchIdRef.current !== activeBranchId) return;
    const currentItems = getValues('items') || [];
    inventoryItems.forEach((item) => {
      const index = currentItems.findIndex((currentItem) => String(currentItem.id) === String(item.id));
      if (index < 0 || currentItems[index].cost === item.cost) return;
      setValue(`items.${index}.cost`, item.cost, { shouldDirty: false });
    });
  }, [activeBranchId, getValues, inventoryItems, setValue]);

  useEffect(() => {
    if (!activeBranchId) return;
    // The audit form reads from the local inventory cache. Refresh it first so
    // cost/unit is available even when the user opens Stock Audit directly.
    void syncInventoryFromBackend(activeBranchId).catch((error) => {
      console.warn('[StockAudit] Could not refresh inventory costs:', error);
    });
    setIsLoadingAuditHistory(true);
    authFetch.fetch<any>(`/inventory/stock-audits/?branch_id=${encodeURIComponent(activeBranchId)}`)
      .then((response) => setAuditHistory(Array.isArray(response) ? response : response?.results || []))
      .catch((error) => console.warn('[StockAudit] Could not load audit history:', error))
      .finally(() => setIsLoadingAuditHistory(false));
  }, [activeBranchId]);

  const { totalValue, countedValue, totalDiscrepancy } = useMemo(() => {
    const values = watchedItems;
    if (!values) {
      return { totalValue: 0, countedValue: 0, totalDiscrepancy: 0 };
    }
    const result = values.reduce(
      (acc, item) => {
        const systemStock = Number(item.stockUnits) || 0;
        const counted = item.countedStockProvided !== false;
        const countedStock = counted ? (Number(item.countedStock) || 0) : 0;
        const cost = Number(item.cost) || 0;

        acc.totalValue += systemStock * cost;
        if (counted) {
          acc.countedValue += countedStock * cost;
          // Match the backend's canonical audit total. Shortages and
          // surpluses are both exposure and must not offset each other.
          acc.totalDiscrepancy += Math.abs(countedStock - systemStock) * cost;
        }
        return acc;
      },
      { totalValue: 0, countedValue: 0, totalDiscrepancy: 0 }
    );
    return result;
  }, [watchedItems]);

  const filteredAuditHistory = useMemo(() => {
    const query = auditHistorySearch.trim().toLowerCase();
    if (!query) return auditHistory;
    return auditHistory.filter((audit) => {
      const itemNames = historyItems(audit).map((item) => item.inventory_item_name || item.itemName || '').join(' ');
      return [
        audit.id,
        audit.notes,
        audit.created_by,
        audit.createdBy,
        audit.branch_name,
        historyStatusLabel(audit),
        itemNames,
      ].some((value) => String(value || '').toLowerCase().includes(query));
    });
  }, [auditHistory, auditHistorySearch]);

  const auditHistorySummary = useMemo(() => auditHistory.reduce((summary, audit) => {
    const status = historyStatusLabel(audit);
    summary.total += 1;
    if (status === 'Approved') summary.approved += 1;
    else if (status === 'Rejected') summary.rejected += 1;
    else summary.pending += 1;
    return summary;
  }, { total: 0, approved: 0, pending: 0, rejected: 0 }), [auditHistory]);

  const downloadStockCountSheet = () => {
    const items = getValues('items') || [];
    if (items.length === 0) {
      toast({ variant: 'destructive', title: 'No stock to export', description: 'Wait for inventory to load before downloading the count sheet.' });
      return;
    }

    const rows = items.map((item) => ({
      'Item ID': item.id,
      'Product Name': item.name,
      'System Stock': Number(item.stockUnits) || 0,
      Unit: item.unitType || '',
      // Keep this blank so the physical count is clearly distinguished from system stock.
      'Counted Stock': '',
    }));
    const worksheet = XLSX.utils.json_to_sheet(rows, { header: STOCK_COUNT_SHEET_COLUMNS });
    worksheet['!cols'] = [
      { wch: 38 }, { wch: 32 }, { wch: 15 }, { wch: 12 }, { wch: 16 },
    ];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Stock Count');
    const workbookData = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const date = new Date().toISOString().slice(0, 10);
    void saveBlobFile(
      new Blob([workbookData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `stock-count-${date}.xlsx`
    ).then((downloadStarted) => {
      if (!downloadStarted) {
        toast({ variant: 'destructive', title: 'Download blocked', description: 'Your device could not save the Excel download.' });
        return;
      }
      toast({ title: 'Stock count sheet downloaded', description: 'Enter physical quantities in the Counted Stock column, save the file, then upload it here.' });
    });
  };

  const importStockCountSheet = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('The workbook does not contain a worksheet.');
      const rows = XLSX.utils.sheet_to_json<StockCountSheetRow>(sheet, { defval: '', raw: false });
      const hasCountedStockColumn = rows.length > 0 && Object.prototype.hasOwnProperty.call(rows[0], 'Counted Stock');
      if (!hasCountedStockColumn) throw new Error('Use the downloaded stock count sheet. It must include a Counted Stock column.');

      const items = getValues('items') || [];
      const itemById = new Map(items.map((item) => [String(item.id), item]));
      const updates = new Map<string, number>();
      const invalidRows: number[] = [];
      const unknownRows: number[] = [];

      rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const countedStock = stockCountNumber(row['Counted Stock']);
        if (countedStock === null) return; // Blank rows have not been counted and are left untouched.
        if (!Number.isFinite(countedStock) || countedStock < 0) {
          invalidRows.push(rowNumber);
          return;
        }
        const itemId = String(row['Item ID'] ?? '').trim();
        if (!itemId || !itemById.has(itemId)) {
          unknownRows.push(rowNumber);
          return;
        }
        updates.set(itemId, countedStock);
      });

      if (invalidRows.length || unknownRows.length) {
        const problems = [
          invalidRows.length ? `negative or invalid counts on row${invalidRows.length === 1 ? '' : 's'} ${invalidRows.join(', ')}` : '',
          unknownRows.length ? `unknown products on row${unknownRows.length === 1 ? '' : 's'} ${unknownRows.join(', ')}` : '',
        ].filter(Boolean).join('; ');
        throw new Error(`Could not import the sheet: ${problems}.`);
      }
      if (updates.size === 0) throw new Error('No counted quantities were found. Fill in the Counted Stock column before uploading.');

      replace(items.map((item) => {
        const itemId = String(item.id);
        const hasCount = updates.has(itemId);
        return {
          ...item,
          countedStock: hasCount ? updates.get(itemId)! : '',
          countedStockProvided: hasCount,
        };
      }));
      setHasImportedStockSheet(true);
      setIsReportDialogOpen(true);
      const changedCount = Array.from(updates.entries()).filter(([id, counted]) => Number(itemById.get(id)?.stockUnits) !== counted).length;
      toast({
        title: 'Stock count imported',
        description: `${updates.size} counted stock value${updates.size === 1 ? '' : 's'} loaded; ${items.length - updates.size} product${items.length - updates.size === 1 ? '' : 's'} not counted and excluded; ${changedCount} will update stock when you submit the audit.`,
      });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not import stock count sheet', description: error instanceof Error ? error.message : 'The selected file could not be read.' });
    }
  };

  const reportRows = useMemo(() => (watchedItems || []).map((item) => {
    const systemStock = Number(item.stockUnits) || 0;
    const countedStockProvided = item.countedStockProvided !== false;
    const countedStock = countedStockProvided ? (Number(item.countedStock) || 0) : 0;
    const discrepancy = countedStockProvided ? countedStock - systemStock : 0;
    const cost = Number(item.cost) || 0;
    return {
      ...item,
      systemStock,
      countedStock,
      countedStockProvided,
      discrepancy,
      discrepancyValue: Math.abs(discrepancy) * cost,
      cost,
    };
  }), [watchedItems]);

  const reportSummary = useMemo(() => reportRows.reduce((summary, item) => {
    if (!item.countedStockProvided) {
      summary.notCounted += 1;
    } else if (item.discrepancy < 0) {
      summary.shortages += 1;
    } else if (item.discrepancy > 0) {
      summary.surplus += 1;
    } else {
      summary.noChange += 1;
    }
    return summary;
  }, { notCounted: 0, shortages: 0, surplus: 0, noChange: 0 }), [reportRows]);

  const reportMetrics = useMemo(
    () => calculateStockAuditMetrics(reportRows),
    [reportRows]
  );

  const exportStockTakeReportPdf = async () => {
    if (!stockReportRef.current || reportRows.length === 0) return;
    setIsExportingReport(true);
    try {
      const html2pdfModule = await import('html2pdf.js');
      const { saveBlobFile } = await import('@/lib/file-download');
      const html2pdf = ((html2pdfModule as any).default ?? html2pdfModule) as any;
      const branchLabel = activeBranchId || 'branch';
      const filename = `stock-take-report-${branchLabel}-${new Date().toISOString().slice(0, 10)}.pdf`;
      const pdfBlob = await html2pdf()
        .set({
          margin: 0.35,
          filename,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
          pagebreak: { mode: ['css', 'legacy'] },
        })
        .from(stockReportRef.current)
        .outputPdf('blob');
      const downloadStarted = await saveBlobFile(pdfBlob, filename);
      if (!downloadStarted) throw new Error('The device could not save the PDF.');
      toast({ title: 'Stock take report exported', description: 'The full report was downloaded as a PDF.' });
    } catch (error) {
      console.error('[StockAudit] Could not export report PDF:', error);
      toast({ variant: 'destructive', title: 'PDF export failed', description: 'Could not generate the stock take report PDF.' });
    } finally {
      setIsExportingReport(false);
    }
  };

  const exportHistoryAuditPdf = async (audit: any) => {
    const auditId = String(audit?.id || 'audit');
    const items = historyItems(audit);
    if (items.length === 0) {
      toast({ variant: 'destructive', title: 'No audit details', description: 'This audit has no item details to export.' });
      return;
    }

    setExportingHistoryAuditId(auditId);
    try {
      const { default: JsPDF } = await import('jspdf');
      const { saveBlobFile } = await import('@/lib/file-download');
      const status = historyStatusLabel(audit);
      const createdAt = audit.created_at || audit.createdAt;
      const submittedBy = audit.created_by || audit.createdBy || 'Unknown';
      const approvedBy = audit.approved_by || audit.approvedBy || '-';
      const approvedAt = audit.approved_at || audit.approvedAt;
      const totalVariance = historyGrossDiscrepancyValue(audit);
      const historyMetrics = calculateStockAuditMetrics(items, totalVariance);
      const safeAuditId = auditId.replace(/[^a-z0-9_-]+/gi, '-');
      const filename = `stock-audit-${safeAuditId}.pdf`;
      const localInventory = await db.inventory.bulkGet(items.map((item) => String(item.inventory_item ?? item.itemId ?? '')));
      const localInventoryById = new Map(
        localInventory
          .filter(Boolean)
          .map((item) => [String(item!.id), item!])
      );
      const pdf = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 12;
      const contentWidth = pageWidth - margin * 2;
      let y = margin;

      const writeLabelValue = (label: string, value: string, x: number, width: number) => {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(107, 114, 128);
        pdf.text(label, x, y);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(17, 24, 39);
        const lines = pdf.splitTextToSize(value || '-', width);
        pdf.text(lines, x + 22, y);
      };

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
      pdf.text(`Audit ${auditId}`, margin, y + 21);
      y += 34;

      writeLabelValue('Status', status, margin, 45);
      writeLabelValue('Submitted', createdAt ? new Date(createdAt).toLocaleString() : '-', margin + contentWidth / 2, 55);
      y += 7;
      writeLabelValue('By', submittedBy, margin, 45);
      writeLabelValue('Approved', approvedBy, margin + contentWidth / 2, 55);
      y += 7;
      writeLabelValue('Approved at', approvedAt ? new Date(approvedAt).toLocaleString() : '-', margin, 45);
      writeLabelValue('Reason', String(audit.notes || 'No reason recorded'), margin + contentWidth / 2, 55);
      y += 14;

      const summary = [
        ['Products', String(items.length)],
        ['Shortage value', formatCurrency(historyMetrics.shortageValue)],
        ['Overage value', formatCurrency(historyMetrics.overageValue)],
        [historyMetrics.netValue < 0 ? 'Overall shortage' : historyMetrics.netValue > 0 ? 'Overall overage' : 'Overall balanced', `${historyMetrics.netValue < 0 ? '-' : historyMetrics.netValue > 0 ? '+' : ''}${formatCurrency(Math.abs(historyMetrics.netValue))}`],
      ];
      const summaryWidth = contentWidth / summary.length;
      summary.forEach(([label, value], index) => {
        const x = margin + index * summaryWidth;
        pdf.setFillColor(239, 246, 255);
        pdf.roundedRect(x + 1, y - 4, summaryWidth - 2, 18, 2, 2, 'F');
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(75, 85, 99);
        pdf.text(label, x + 4, y + 2);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9.5);
        pdf.setTextColor(index === 1 || (index === 3 && historyMetrics.netValue < 0) ? 185 : index === 2 || (index === 3 && historyMetrics.netValue > 0) ? 21 : 17, index === 1 || (index === 3 && historyMetrics.netValue < 0) ? 28 : index === 2 || (index === 3 && historyMetrics.netValue > 0) ? 128 : 24, index === 1 || (index === 3 && historyMetrics.netValue < 0) ? 28 : index === 2 || (index === 3 && historyMetrics.netValue > 0) ? 61 : 39);
        pdf.text(value, x + 4, y + 11);
      });
      y += 28;

      const columns = [
        { title: 'Product', x: margin, width: contentWidth * 0.34, align: 'left' as const },
        { title: 'System stock', x: margin + contentWidth * 0.34, width: contentWidth * 0.11, align: 'right' as const },
        { title: 'Counted stock', x: margin + contentWidth * 0.45, width: contentWidth * 0.11, align: 'right' as const },
        { title: 'Variance', x: margin + contentWidth * 0.56, width: contentWidth * 0.11, align: 'right' as const },
        { title: 'Direction', x: margin + contentWidth * 0.67, width: contentWidth * 0.10, align: 'left' as const },
        { title: 'Unit cost', x: margin + contentWidth * 0.77, width: contentWidth * 0.11, align: 'right' as const },
        { title: 'Value', x: margin + contentWidth * 0.88, width: contentWidth * 0.12, align: 'right' as const },
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

      items.forEach((item: any) => {
        const systemStock = Number(item.system_stock ?? item.systemStock);
        const countedStock = Number(item.counted_stock ?? item.countedStock);
        const discrepancy = Number(item.discrepancy ?? (countedStock - systemStock));
        const itemId = String(item.inventory_item ?? item.itemId ?? '');
        const localCost = localInventoryById.get(itemId)?.cost;
        const unitCost = Number(item.unit_cost ?? item.unitCost ?? item.cost ?? localCost) || 0;
        const discrepancyValueRaw = item.discrepancy_value ?? item.discrepancyValue;
        const discrepancyValue = discrepancyValueRaw === undefined || discrepancyValueRaw === null || discrepancyValueRaw === ''
          ? Math.abs(discrepancy) * unitCost
          : Math.abs(Number(discrepancyValueRaw) || 0);
        const direction = stockAuditDirection(discrepancy);
        const nameLines = pdf.splitTextToSize(String(item.inventory_item_name || item.itemName || 'Product'), columns[0].width - 4);
        const rowHeight = Math.max(8, nameLines.length * 4.5 + 3, pdf.splitTextToSize(direction, columns[4].width - 4).length * 4.5 + 3);
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
        pdf.text(historyQuantity(systemStock), columns[1].x + columns[1].width - 2, y + 4, { align: 'right' });
        pdf.text(historyQuantity(countedStock), columns[2].x + columns[2].width - 2, y + 4, { align: 'right' });
        pdf.setTextColor(discrepancy < 0 ? 185 : discrepancy > 0 ? 21 : 17, discrepancy < 0 ? 28 : discrepancy > 0 ? 128 : 24, discrepancy < 0 ? 28 : discrepancy > 0 ? 61 : 39);
        pdf.setFont('helvetica', 'bold');
        pdf.text(`${discrepancy > 0 ? '+' : ''}${historyQuantity(discrepancy)}`, columns[3].x + columns[3].width - 2, y + 4, { align: 'right' });
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(17, 24, 39);
        pdf.text(direction, columns[4].x + 2, y + 4);
        pdf.text(formatCurrency(unitCost), columns[5].x + columns[5].width - 2, y + 4, { align: 'right' });
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(discrepancy < 0 ? 185 : discrepancy > 0 ? 21 : 17, discrepancy < 0 ? 28 : discrepancy > 0 ? 128 : 17, discrepancy < 0 ? 28 : discrepancy > 0 ? 61 : 39);
        pdf.text(formatCurrency(discrepancyValue), columns[6].x + columns[6].width - 2, y + 4, { align: 'right' });
        y += rowHeight;
      });

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(7.5);
      pdf.setTextColor(107, 114, 128);
      pdf.text(`Generated ${new Date().toLocaleString()}`, margin, pageHeight - margin);
      const pdfBlob = pdf.output('blob');
      if (!await saveBlobFile(pdfBlob, filename)) throw new Error('The device could not save the PDF.');
      toast({ title: 'Audit PDF downloaded', description: `The report for audit ${auditId} was saved.` });
    } catch (error) {
      console.error('[StockAudit] Could not export history audit PDF:', error);
      toast({ variant: 'destructive', title: 'PDF export failed', description: 'Could not generate this audit report PDF.' });
    } finally {
      setExportingHistoryAuditId(null);
    }
  };

  const startAuditSheetComparison = (auditId: string) => {
    comparisonTargetAuditIdRef.current = auditId;
    auditSheetInputRef.current?.click();
  };

  const compareAuditSheet = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const auditId = comparisonTargetAuditIdRef.current;
    comparisonTargetAuditIdRef.current = null;
    if (!file || !auditId) return;

    const audit = auditHistory.find((entry) => String(entry?.id) === auditId);
    if (!audit) {
      toast({ variant: 'destructive', title: 'Audit not found', description: 'Refresh audit history and try again.' });
      return;
    }

    setIsComparingAuditSheet(true);
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) throw new Error('The workbook does not contain a worksheet.');
      const rows = XLSX.utils.sheet_to_json<StockCountSheetRow>(sheet, { defval: '', raw: false });
      if (rows.length === 0) throw new Error('The worksheet is empty.');
      if (!Object.prototype.hasOwnProperty.call(rows[0], 'Item ID') || !Object.prototype.hasOwnProperty.call(rows[0], 'Counted Stock')) {
        throw new Error('Use a stock count sheet with Item ID and Counted Stock columns.');
      }

      const issues: AuditSheetComparisonIssue[] = [];
      const uploadedById = new Map<string, { itemId: string; productName: string; systemStock: number | null; countedStock: number }>();

      rows.forEach((row, index) => {
        const rowNumber = index + 2;
        const itemId = String(row['Item ID'] ?? '').trim();
        const countedStock = stockCountNumber(row['Counted Stock']);
        if (countedStock === null) return; // Blank means this product was not counted.
        if (!itemId) {
          issues.push({ kind: 'Invalid', itemId: `Row ${rowNumber}`, productName: String(row['Product Name'] || 'Unknown product'), details: 'The row has a counted quantity but no Item ID.' });
          return;
        }
        if (!Number.isFinite(countedStock) || countedStock < 0) {
          issues.push({ kind: 'Invalid', itemId, productName: String(row['Product Name'] || 'Unknown product'), details: `Invalid counted stock on row ${rowNumber}.` });
          return;
        }
        if (uploadedById.has(itemId)) {
          issues.push({ kind: 'Invalid', itemId, productName: String(row['Product Name'] || 'Unknown product'), details: `The product appears more than once (row ${rowNumber}).` });
          return;
        }
        uploadedById.set(itemId, {
          itemId,
          productName: String(row['Product Name'] || 'Product'),
          systemStock: stockCountNumber(row['System Stock']),
          countedStock,
        });
      });

      const auditItems = historyItems(audit);
      const auditById = new Map(auditItems.map((item: any) => [
        String(item.inventory_item ?? item.itemId ?? ''),
        item,
      ]));
      let matchedCount = 0;
      let ignoredUnchangedCount = 0;

      uploadedById.forEach((sheetItem) => {
        const auditItem = auditById.get(sheetItem.itemId);
        if (!auditItem) {
          // The audit stores only changed products. A row whose count equals
          // its sheet system stock was intentionally excluded from the audit.
          if (sameStockQuantity(sheetItem.systemStock, sheetItem.countedStock)) {
            ignoredUnchangedCount += 1;
          } else {
            issues.push({
              kind: 'Extra',
              itemId: sheetItem.itemId,
              productName: sheetItem.productName,
              details: 'The sheet records a stock change that is not present in this audit.',
            });
          }
          return;
        }

        const auditSystemStock = Number(auditItem.system_stock ?? auditItem.systemStock);
        const auditCountedStock = Number(auditItem.counted_stock ?? auditItem.countedStock);
        const differences: string[] = [];
        if (!sameStockQuantity(sheetItem.systemStock, auditSystemStock)) {
          differences.push(`system stock: sheet ${historyQuantity(sheetItem.systemStock)} vs audit ${historyQuantity(auditSystemStock)}`);
        }
        if (!sameStockQuantity(sheetItem.countedStock, auditCountedStock)) {
          differences.push(`counted stock: sheet ${historyQuantity(sheetItem.countedStock)} vs audit ${historyQuantity(auditCountedStock)}`);
        }

        if (differences.length > 0) {
          issues.push({
            kind: 'Mismatch',
            itemId: sheetItem.itemId,
            productName: sheetItem.productName || auditItem.inventory_item_name || auditItem.itemName || 'Product',
            details: differences.join('; '),
          });
        } else {
          matchedCount += 1;
        }
      });

      auditById.forEach((auditItem: any, itemId: string) => {
        if (uploadedById.has(itemId)) return;
        issues.push({
          kind: 'Missing',
          itemId,
          productName: auditItem.inventory_item_name || auditItem.itemName || 'Product',
          details: 'This audited stock change is missing from the uploaded sheet or its count was left blank.',
        });
      });

      setAuditSheetComparison({
        auditId,
        filename: file.name,
        matchedCount,
        ignoredUnchangedCount,
        issues,
      });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not compare audit sheet', description: error instanceof Error ? error.message : 'The selected file could not be read.' });
    } finally {
      setIsComparingAuditSheet(false);
    }
  };

  const onConfirmSubmit = async (data: StockTakeFormValues) => {
    if (!user || !activeBranchId) {
        toast({ variant: 'destructive', title: 'Authentication Error', description: 'You must be logged in to submit an audit.' });
        return;
    }

    const changedItems = data.items.filter((item) =>
      item.countedStockProvided !== false && Number(item.countedStock) !== Number(item.stockUnits)
    );
    if (changedItems.length === 0) {
      toast({
        title: 'No stock changes',
        description: 'Enter a different counted quantity for at least one product before submitting.',
      });
      setIsConfirmModalOpen(false);
      return;
    }
    if (!auditReason.trim()) {
      toast({ variant: 'destructive', title: 'Reason required', description: 'Enter a reason before submitting the audit.' });
      return;
    }

    setIsSubmitting(true);
    setSubmissionMessage(`Submitting ${changedItems.length} stock adjustment${changedItems.length === 1 ? '' : 's'} for approval…`);

    const stockTakeRecord: StockTake = {
      id: `ST-${Date.now()}`,
      branchId: activeBranchId,
      createdAt: new Date().toISOString(),
      createdBy: user.displayName || user.email,
      status: 'Pending Approval',
      items: changedItems.map(item => {
        const cost = item.cost === null || item.cost === undefined ? undefined : Number(item.cost);
        const discrepancy = (Number(item.countedStock) || 0) - (Number(item.stockUnits) || 0);
        return {
          itemId: item.id,
          itemName: item.name,
          systemStock: Number(item.stockUnits) || 0,
          countedStock: Number(item.countedStock) || 0,
          discrepancy,
          ...(cost !== undefined && Number.isFinite(cost) ? {
            unitCost: cost,
            discrepancyValue: Math.abs(discrepancy) * cost,
          } : {}),
        };
      }),
      totalDiscrepancyValue: totalDiscrepancy,
      notes: auditReason.trim(),
    };

    let serverAudit: any;
    let serverAccepted = false;

    try {
      serverAudit = await authFetch.fetch<any>('/inventory/stock-audits/', {
        method: 'POST',
        body: JSON.stringify({
          branch_id: activeBranchId,
          items: changedItems.map((item) => ({
            inventory_item: item.id,
            counted_stock: Number(item.countedStock) || 0,
          })),
          notes: auditReason.trim(),
        }),
      });
      serverAccepted = true;

      // Keep a pending mirror so the Approvals screen can show this audit immediately.
      const stockTakeWithSync: StockTake = {
        ...stockTakeRecord,
        id: String(serverAudit?.id || stockTakeRecord.id),
        createdAt: serverAudit?.created_at || stockTakeRecord.createdAt,
        createdBy: serverAudit?.created_by || stockTakeRecord.createdBy,
        status: 'Pending Approval',
        _dirty: false,
        _operation: 'update'
      };
      await db.stockTakes.put(stockTakeWithSync);
      setAuditHistory((current) => [serverAudit, ...current]);

      toast({
        title: 'Stock audit submitted for approval',
        description: 'A manager must approve this audit before counted stock replaces system stock.',
      });
      setAuditReason('');
      router.push('/dashboard/inventory');
    } catch (error) {
      console.error('[StockAudit] Failed to submit audit:', {
        error,
        status: (error as any)?.status,
        data: (error as any)?.data,
        serverAccepted,
      });

      if (serverAccepted) {
        toast({
          title: 'Audit submitted for approval',
          description: `The backend accepted the audit, but this device could not save its local copy (${submissionErrorMessage(error)}). Open Approvals to review it.`,
        });
        setAuditReason('');
        router.push('/dashboard/inventory');
        return;
      }

      toast({
        variant: 'destructive',
        title: 'Error Submitting Audit',
        description: submissionErrorMessage(error),
      });
    } finally {
      setIsSubmitting(false);
      setSubmissionMessage('');
      setIsConfirmModalOpen(false);
    }
  };

  const renderDiscrepancy = (item: any) => {
    if (item.countedStockProvided === false) {
      return <Badge variant="outline">Not Counted</Badge>;
    }
    const systemStock = Number(item.stockUnits) || 0;
    const countedStock = Number(item.countedStock) || 0;
    const discrepancy = countedStock - systemStock;

    if (discrepancy === 0) {
      return <Badge variant="secondary">No Change</Badge>;
    }
    const isSurplus = discrepancy > 0;
    return (
      <Badge variant={isSurplus ? 'default' : 'destructive'} className={isSurplus ? 'bg-green-600' : ''}>
        {isSurplus ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
        {isSurplus ? 'Overage' : 'Shortage'}: {isSurplus ? '+' : ''}{discrepancy}
      </Badge>
    );
  };
  
   if (!activeBranchId) {
    return (
        <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex w-full flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
        <div className="grid gap-2">
          <Button variant="outline" size="sm" className="w-fit" onClick={() => router.back()}>
            <ArrowLeft className="mr-2" /> Back to Inventory
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Full Stock Audit</h1>
          <p className="text-muted-foreground">
            Count your physical stock and submit for approval to update system levels.
          </p>
        </div>
        <div className="flex items-center gap-2">
           <Button variant="outline" onClick={() => setIsHistoryDialogOpen(true)} disabled={isSubmitting}>
             <FileText className="mr-2" /> Previous audits
             {auditHistory.length > 0 && <Badge variant="secondary" className="ml-2">{auditHistory.length}</Badge>}
           </Button>
           <input ref={stockSheetInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={importStockCountSheet} />
           <Button variant="outline" onClick={downloadStockCountSheet} disabled={isSubmitting || fields.length === 0}>
             <Download className="mr-2" /> Download Excel Sheet
           </Button>
           <Button variant="outline" onClick={() => stockSheetInputRef.current?.click()} disabled={isSubmitting || fields.length === 0}>
             <Upload className="mr-2" /> Upload Counted Sheet
           </Button>
           <Button variant="outline" onClick={() => setIsReportDialogOpen(true)} disabled={isSubmitting || !hasImportedStockSheet || reportRows.length === 0}>
             <FileText className="mr-2" /> View Full Report
           </Button>
            <Button onClick={() => setIsConfirmModalOpen(true)} disabled={isSubmitting || fields.length === 0}>
              {isSubmitting ? (
                  <><Loader2 className="mr-2 animate-spin" />Submitting…</>
              ) : (
                  <><Send className="mr-2" />Submit for Approval</>
              )}
            </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">System Stock Value</CardTitle>
                  <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
              </CardContent>
          </Card>
           <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Counted Stock Value</CardTitle>
                  <FileUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                  <div className="text-2xl font-bold">{formatCurrency(countedValue)}</div>
              </CardContent>
          </Card>
          <Card className="border-destructive/30 bg-destructive/5 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-destructive">Shortage Value</CardTitle>
              </CardHeader>
              <CardContent>
                  <div className="text-2xl font-bold text-destructive">{formatCurrency(reportMetrics.shortageValue)}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{reportMetrics.shortageCount} below system stock</p>
              </CardContent>
          </Card>
          <Card className="border-emerald-500/30 bg-emerald-500/5 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-emerald-600 dark:text-emerald-400">Overage Value</CardTitle>
              </CardHeader>
              <CardContent>
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(reportMetrics.overageValue)}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{reportMetrics.overageCount} above system stock</p>
              </CardContent>
          </Card>
          <Card className={cn(
            'shadow-sm',
            reportMetrics.netValue < 0
              ? 'border-destructive/30 bg-destructive/5'
              : reportMetrics.netValue > 0
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : 'border-border bg-card'
          )}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Net Adjustment</CardTitle>
              </CardHeader>
              <CardContent>
                  <div className={cn('text-2xl font-bold', reportMetrics.netValue < 0 ? 'text-destructive' : reportMetrics.netValue > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground')}>
                    {reportMetrics.netValue < 0 ? '-' : reportMetrics.netValue > 0 ? '+' : ''}{formatCurrency(Math.abs(reportMetrics.netValue))}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">Overage minus shortage</p>
              </CardContent>
          </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by product, SKU, barcode, or category..."
              className="w-full pl-10 md:w-80"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(() => setIsConfirmModalOpen(true))}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[250px]">Item</TableHead>
                    <TableHead className="text-right">System Stock</TableHead>
                    <TableHead className="w-40 text-right">Counted Stock</TableHead>
                    <TableHead className="text-right">Discrepancy</TableHead>
                    <TableHead className="text-right">Cost/Unit</TableHead>
                    <TableHead className="text-right">Value (Shortage/Overage)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleFields.map((field) => {
                    const index = fields.findIndex((item) => item.id === field.id);
                    const systemStock = Number(field.stockUnits) || 0;
                    const watchedItem = form.watch(`items.${index}`);
                    const countedStockProvided = watchedItem?.countedStockProvided !== false;
                    const countedStock = countedStockProvided ? (Number(watchedItem?.countedStock) || 0) : 0;
                    const cost = Number(field.cost) || 0;
                    const discrepancy = countedStockProvided ? countedStock - systemStock : 0;
                    const discrepancyValue = countedStockProvided ? Math.abs(discrepancy) * cost : 0;
                    const countedStockRegistration = form.register(`items.${index}.countedStock`);
                    
                    return (
                        <TableRow key={field.id} className={cn(discrepancy !== 0 && 'bg-muted/50')}>
                            <TableCell className="font-medium">{field.name}</TableCell>
                            <TableCell className="text-right font-mono">{systemStock} {field.unitType}</TableCell>
                            <TableCell className="text-right">
                                <Input
                                {...countedStockRegistration}
                                onChange={(event) => {
                                  countedStockRegistration.onChange(event);
                                  form.setValue(`items.${index}.countedStockProvided`, event.target.value.trim() !== '', { shouldDirty: true });
                                }}
                                type="number"
                                min="0"
                                step="0.001"
                                className="h-8 w-24 text-right ml-auto"
                                />
                            </TableCell>
                            <TableCell className="text-right">{renderDiscrepancy(form.watch(`items.${index}`))}
                            </TableCell>
                             <TableCell className="text-right font-mono">{formatCurrency(cost)}</TableCell>
                            <TableCell className={cn("text-right font-semibold", discrepancyValue !== 0 && (discrepancy > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'))}>
                                {formatCurrency(discrepancyValue)}
                            </TableCell>
                        </TableRow>
                    );
                  })}
                  {visibleFields.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No products match your search.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog open={isConfirmModalOpen} onOpenChange={setIsConfirmModalOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Submit Stock Audit for Approval?</DialogTitle>
                <DialogDescription>
                    This sends the counted quantities to the Approvals queue. Stock will not change until an authorized manager approves the audit.
                </DialogDescription>
                <div className="space-y-2">
                  <label htmlFor="audit-reason" className="text-sm font-medium">Reason for audit (required)</label>
                  <Input id="audit-reason" placeholder="Monthly count, variance investigation, damaged stock..." value={auditReason} onChange={(event) => setAuditReason(event.target.value)} />
                </div>
            </DialogHeader>
            <Card className="bg-muted">
                <CardHeader>
                    <CardTitle className="text-base">Summary of Changes</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                     <div className="flex justify-between">
                        <span>Items with shortages:</span>
                        <span className="font-medium">{getValues('items')?.filter(i => i.countedStockProvided !== false && (Number(i.countedStock) || 0) < (i.stockUnits || 0)).length || 0}</span>
                    </div>
                     <div className="flex justify-between">
                        <span>Items with surplus:</span>
                        <span className="font-medium">{getValues('items')?.filter(i => i.countedStockProvided !== false && (Number(i.countedStock) || 0) > (i.stockUnits || 0)).length || 0}</span>
                    </div>
                    <div className="flex justify-between font-semibold pt-2 border-t">
                        <span>Shortage Value:</span>
                        <span className="text-destructive">{formatCurrency(reportMetrics.shortageValue)}</span>
                    </div>
                    <div className="flex justify-between font-semibold">
                        <span>Overage Value:</span>
                        <span className="text-emerald-600 dark:text-emerald-400">{formatCurrency(reportMetrics.overageValue)}</span>
                    </div>
                    <div className="flex justify-between font-semibold">
                        <span>Net Adjustment:</span>
                        <span className={reportMetrics.netValue < 0 ? 'text-destructive' : reportMetrics.netValue > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                          {reportMetrics.netValue < 0 ? '-' : reportMetrics.netValue > 0 ? '+' : ''}{formatCurrency(Math.abs(reportMetrics.netValue))}
                        </span>
                    </div>
                </CardContent>
            </Card>
            <DialogFooter>
                <Button variant="ghost" onClick={() => setIsConfirmModalOpen(false)} disabled={isSubmitting}>Cancel</Button>
                <Button onClick={handleSubmit(onConfirmSubmit)} disabled={isSubmitting || !auditReason.trim()}>
                     {isSubmitting ? (
                        <Loader2 className="mr-2 animate-spin" />
                     ) : (
                        <Send className="mr-2" />
                     )}
                    {isSubmitting ? 'Submitting…' : 'Submit for Approval'}
                </Button>
            </DialogFooter>
            {isSubmitting && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
                <Loader2 className="h-4 w-4 animate-spin" />
                {submissionMessage}
              </p>
            )}
        </DialogContent>
      </Dialog>

      <input
        ref={auditSheetInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={(event) => void compareAuditSheet(event)}
      />

      <Dialog open={isHistoryDialogOpen} onOpenChange={setIsHistoryDialogOpen}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Stock audit history</DialogTitle>
            <DialogDescription>Review every stock take submitted for this branch. Select an audit to see the item-level changes.</DialogDescription>
          </DialogHeader>
          {isLoadingAuditHistory ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading audit history…</p>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Card><CardContent className="p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total audits</p><p className="mt-1 text-2xl font-bold">{auditHistorySummary.total}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Approved</p><p className="mt-1 text-2xl font-bold text-green-600">{auditHistorySummary.approved}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pending</p><p className="mt-1 text-2xl font-bold text-amber-600">{auditHistorySummary.pending}</p></CardContent></Card>
                <Card><CardContent className="p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Rejected</p><p className="mt-1 text-2xl font-bold text-destructive">{auditHistorySummary.rejected}</p></CardContent></Card>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={auditHistorySearch}
                  onChange={(event) => setAuditHistorySearch(event.target.value)}
                  placeholder="Search by reason, submitter, status, or product..."
                  className="pl-9"
                />
              </div>

              {auditHistory.length === 0 ? (
                <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">No previous audits for this branch.</p>
              ) : filteredAuditHistory.length === 0 ? (
                <p className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">No audits match your search.</p>
              ) : (
                <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-1">
                  {filteredAuditHistory.map((audit) => {
                    const auditId = String(audit.id);
                    const isExpanded = expandedAuditId === auditId;
                    const status = historyStatusLabel(audit);
                    const items = historyItems(audit);
                    const totalVariance = historyGrossDiscrepancyValue(audit);
                    const historyMetrics = calculateStockAuditMetrics(items, totalVariance);
                    const statusVariant = status === 'Rejected' ? 'destructive' : status === 'Approved' ? 'default' : 'secondary';

                    return (
                      <Card key={auditId} className={cn('overflow-hidden transition-shadow', isExpanded && 'shadow-md')}>
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-4 p-4 text-left hover:bg-muted/40"
                          onClick={() => setExpandedAuditId(isExpanded ? null : auditId)}
                          aria-expanded={isExpanded}
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{audit.created_at || audit.createdAt ? new Date(audit.created_at || audit.createdAt).toLocaleString() : 'Date unavailable'}</span>
                              <Badge variant={statusVariant}>{status}</Badge>
                            </div>
                            <p className="truncate text-sm text-muted-foreground">{audit.notes || 'No reason recorded'}</p>
                            <p className="text-xs text-muted-foreground">Submitted by {audit.created_by || audit.createdBy || 'Unknown'} · {items.length} item{items.length === 1 ? '' : 's'}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-3">
                            <div className="hidden text-right sm:block">
                              <div className="grid grid-cols-3 gap-3 text-xs">
                                <div><p className="text-red-600">Shortage</p><p className="font-semibold text-red-800">{formatCurrency(historyMetrics.shortageValue)}</p></div>
                                <div><p className="text-green-600">Overage</p><p className="font-semibold text-green-800">{formatCurrency(historyMetrics.overageValue)}</p></div>
                                <div><p className={historyMetrics.netValue < 0 ? 'text-red-600' : historyMetrics.netValue > 0 ? 'text-green-600' : 'text-muted-foreground'}>{historyMetrics.netValue < 0 ? 'Overall shortage' : historyMetrics.netValue > 0 ? 'Overall overage' : 'Overall balanced'}</p><p className={cn('font-semibold', historyMetrics.netValue < 0 ? 'text-red-800' : historyMetrics.netValue > 0 ? 'text-green-800' : 'text-foreground')}>{historyMetrics.netValue < 0 ? '-' : historyMetrics.netValue > 0 ? '+' : ''}{formatCurrency(Math.abs(historyMetrics.netValue))}</p></div>
                              </div>
                            </div>
                            {isExpanded ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                          </div>
                        </button>
                        {isExpanded && (
                          <CardContent className="border-t bg-muted/20 p-4">
                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                                <span><strong className="text-foreground">Audit ID:</strong> {auditId}</span>
                                {audit.approved_by && <span><strong className="text-foreground">Approved by:</strong> {audit.approved_by}</span>}
                                {audit.approved_at && <span><strong className="text-foreground">Approved:</strong> {new Date(audit.approved_at).toLocaleString()}</span>}
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => void exportHistoryAuditPdf(audit)}
                                disabled={exportingHistoryAuditId === auditId}
                              >
                                {exportingHistoryAuditId === auditId ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                                {exportingHistoryAuditId === auditId ? 'Exporting…' : 'Download PDF'}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => startAuditSheetComparison(auditId)}
                                disabled={isComparingAuditSheet || items.length === 0}
                              >
                                {isComparingAuditSheet ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                                Compare Excel
                              </Button>
                            </div>
                            <div className="overflow-x-auto rounded-md border bg-background">
                              <Table>
                                <TableHeader><TableRow><TableHead>Product</TableHead><TableHead className="text-right">System stock</TableHead><TableHead className="text-right">Counted stock</TableHead><TableHead className="text-right">Variance</TableHead><TableHead className="text-right">Value / direction</TableHead></TableRow></TableHeader>
                                <TableBody>
                                  {items.length === 0 ? <TableRow><TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">No item details recorded.</TableCell></TableRow> : items.map((item: any, index: number) => {
                                    const systemStock = Number(item.system_stock ?? item.systemStock);
                                    const countedStock = Number(item.counted_stock ?? item.countedStock);
                                    const discrepancy = Number(item.discrepancy ?? (countedStock - systemStock));
                                    const itemValue = Number(item.discrepancy_value ?? item.discrepancyValue) || Math.abs(discrepancy) * (Number(item.unit_cost ?? item.unitCost ?? item.cost) || 0);
                                    const direction = stockAuditDirection(discrepancy);
                                    return <TableRow key={item.id || index}><TableCell className="font-medium">{item.inventory_item_name || item.itemName || 'Product'}</TableCell><TableCell className="text-right">{historyQuantity(systemStock)}</TableCell><TableCell className="text-right">{historyQuantity(countedStock)}</TableCell><TableCell className={cn('text-right font-semibold', discrepancy > 0 ? 'text-green-600' : discrepancy < 0 ? 'text-destructive' : '')}>{direction}: {discrepancy > 0 ? '+' : ''}{historyQuantity(discrepancy)}</TableCell><TableCell className={cn('text-right font-semibold', discrepancy > 0 ? 'text-green-600' : discrepancy < 0 ? 'text-destructive' : '')}>{direction}: {formatCurrency(itemValue)}</TableCell></TableRow>;
                                  })}
                                </TableBody>
                              </Table>
                            </div>
                          </CardContent>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(auditSheetComparison)}
        onOpenChange={(open) => { if (!open) setAuditSheetComparison(null); }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Compare uploaded audit sheet</DialogTitle>
            <DialogDescription>
              {auditSheetComparison
                ? `${auditSheetComparison.filename} compared with audit ${auditSheetComparison.auditId}.`
                : 'Compare the uploaded counts with the saved audit.'}
            </DialogDescription>
          </DialogHeader>
          {auditSheetComparison && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Card className="border-emerald-500/25 bg-emerald-500/5"><CardContent className="p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Matched</p><p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{auditSheetComparison.matchedCount}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Differences</p><p className="mt-1 text-2xl font-bold text-destructive">{auditSheetComparison.issues.filter((issue) => issue.kind === 'Mismatch').length}</p></CardContent></Card>
                <Card className="border-amber-500/25 bg-amber-500/5"><CardContent className="p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Missing</p><p className="mt-1 text-2xl font-bold text-amber-600 dark:text-amber-400">{auditSheetComparison.issues.filter((issue) => issue.kind === 'Missing').length}</p></CardContent></Card>
                <Card><CardContent className="p-3"><p className="text-xs uppercase tracking-wide text-muted-foreground">Extra / invalid</p><p className="mt-1 text-2xl font-bold">{auditSheetComparison.issues.filter((issue) => issue.kind === 'Extra' || issue.kind === 'Invalid').length}</p></CardContent></Card>
              </div>

              <p className="text-sm text-muted-foreground">
                {auditSheetComparison.ignoredUnchangedCount} unchanged product{auditSheetComparison.ignoredUnchangedCount === 1 ? '' : 's'} ignored because approved audits store only stock changes.
              </p>

              {auditSheetComparison.issues.length === 0 ? (
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-5 text-center text-sm text-emerald-700 dark:text-emerald-300">
                  The uploaded sheet matches every stock change recorded in this audit.
                </div>
              ) : (
                <div className="max-h-[45vh] overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Status</TableHead><TableHead>Product</TableHead><TableHead>Item ID</TableHead><TableHead>Details</TableHead></TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditSheetComparison.issues.map((issue, index) => (
                        <TableRow key={`${issue.itemId}-${index}`}>
                          <TableCell><Badge variant={issue.kind === 'Mismatch' ? 'destructive' : issue.kind === 'Missing' ? 'outline' : 'secondary'}>{issue.kind}</Badge></TableCell>
                          <TableCell className="font-medium">{issue.productName}</TableCell>
                          <TableCell className="font-mono text-xs">{issue.itemId}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{issue.details}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAuditSheetComparison(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isReportDialogOpen} onOpenChange={setIsReportDialogOpen}>
        <DialogContent className="max-w-[96vw] gap-0 overflow-hidden border-border bg-background p-0 shadow-2xl sm:max-w-7xl">
          <DialogHeader className="relative overflow-hidden border-b border-border bg-gradient-to-br from-primary/15 via-card to-background px-6 py-6 text-left">
            <div className="absolute inset-x-0 top-0 h-1 bg-primary" />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    <FileText className="h-4 w-4" /> Stock audit review
                  </span>
                  <Badge variant="secondary">Pending submission</Badge>
                </div>
                <DialogTitle className="text-2xl">Full stock take report</DialogTitle>
                <DialogDescription className="max-w-2xl text-sm leading-6">
                  Review every uploaded count against the latest system stock. Your inventory remains unchanged until an authorized manager approves the audit.
                </DialogDescription>
              </div>
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 sm:max-w-xs">
                <p className="font-semibold">Review before submitting</p>
                <p className="mt-0.5 leading-5">Not counted products are excluded. A zero is treated as a real counted quantity.</p>
              </div>
            </div>
          </DialogHeader>

          <div className="overflow-x-auto border-b border-border bg-card px-6 py-3">
            <div className="mx-auto flex min-w-[520px] max-w-3xl items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 font-semibold text-primary">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground shadow-sm">1</span>
                <span>Review report</span>
              </div>
              <div className="h-px flex-1 bg-primary/25" />
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background font-semibold">2</span>
                <span>Submit for approval</span>
              </div>
              <div className="h-px flex-1 bg-border" />
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background font-semibold">3</span>
                <span>Stock updated</span>
              </div>
            </div>
          </div>

          <div className="max-h-[72vh] overflow-y-auto bg-background px-4 py-5 sm:px-6">
            <div ref={stockReportRef} className="space-y-5 bg-card text-card-foreground">
              <div className="flex flex-col gap-4 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Stock take report</p>
                  <h2 className="mt-1 text-xl font-bold text-foreground">Physical count reconciliation</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Branch: {activeBranchId || '-'} · Prepared: {new Date().toLocaleString()}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3 text-right text-sm sm:grid-cols-5">
                  <div><div className="text-xs text-muted-foreground">System value</div><div className="mt-1 font-semibold text-foreground">{formatCurrency(totalValue)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Counted value</div><div className="mt-1 font-semibold text-foreground">{formatCurrency(countedValue)}</div></div>
                  <div><div className="text-xs text-destructive">Shortage value</div><div className="mt-1 font-semibold text-destructive">{formatCurrency(reportMetrics.shortageValue)}</div></div>
                  <div><div className="text-xs text-emerald-600 dark:text-emerald-400">Overage value</div><div className="mt-1 font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(reportMetrics.overageValue)}</div></div>
                  <div><div className="text-xs text-muted-foreground">Net adjustment</div><div className={cn('mt-1 font-semibold', reportMetrics.netValue < 0 ? 'text-destructive' : reportMetrics.netValue > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground')}>{reportMetrics.netValue < 0 ? '-' : reportMetrics.netValue > 0 ? '+' : ''}{formatCurrency(Math.abs(reportMetrics.netValue))}</div></div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-primary/25 bg-primary/5 p-3"><p className="text-xs font-medium uppercase tracking-wide text-primary">Reviewed</p><p className="mt-1 text-2xl font-bold text-foreground">{reportRows.length - reportSummary.notCounted}</p><p className="text-xs text-muted-foreground">products counted</p></div>
                <div className="rounded-xl border border-destructive/25 bg-destructive/5 p-3"><p className="text-xs font-medium uppercase tracking-wide text-destructive">Shortages</p><p className="mt-1 text-2xl font-bold text-destructive">{reportSummary.shortages}</p><p className="text-xs text-muted-foreground">below system stock</p></div>
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3"><p className="text-xs font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Overages</p><p className="mt-1 text-2xl font-bold text-emerald-600 dark:text-emerald-400">{reportSummary.surplus}</p><p className="text-xs text-muted-foreground">above system stock</p></div>
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3"><p className="text-xs font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">Not counted</p><p className="mt-1 text-2xl font-bold text-foreground">{reportSummary.notCounted}</p><p className="text-xs text-muted-foreground">excluded from audit</p></div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-border">
                <Table className="min-w-[980px] text-xs">
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>SKU / Barcode</TableHead>
                      <TableHead className="text-right">System</TableHead>
                      <TableHead className="text-right">Counted</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="text-right">Unit cost</TableHead>
                      <TableHead className="text-right">Variance value</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reportRows.map((item) => {
                      const status = !item.countedStockProvided ? 'Not counted' : item.discrepancy === 0 ? 'No change' : item.discrepancy > 0 ? 'Surplus' : 'Shortage';
                      const statusVariant = status === 'Shortage' ? 'destructive' : status === 'Surplus' ? 'default' : status === 'Not counted' ? 'outline' : 'secondary';
                      return (
                        <TableRow key={item.id} className="odd:bg-muted/20">
                          <TableCell className="font-medium text-foreground">{item.name}</TableCell>
                          <TableCell className="text-muted-foreground">{item.sku || item.productCode || '-'}{item.barcode ? ` / ${item.barcode}` : ''}</TableCell>
                          <TableCell className="text-right text-foreground">{item.systemStock} {item.unitType || ''}</TableCell>
                          <TableCell className="text-right text-foreground">{item.countedStockProvided ? `${item.countedStock} ${item.unitType || ''}` : 'Not counted'}</TableCell>
                          <TableCell className={cn('text-right font-semibold', item.countedStockProvided && (item.discrepancy > 0 ? 'text-emerald-600 dark:text-emerald-400' : item.discrepancy < 0 ? 'text-destructive' : 'text-foreground'))}>{item.countedStockProvided ? `${item.discrepancy > 0 ? '+' : ''}${item.discrepancy}` : '—'}</TableCell>
                          <TableCell className="text-right text-foreground">{formatCurrency(item.cost)}</TableCell>
                          <TableCell className={cn('text-right font-semibold', item.countedStockProvided && (item.discrepancy > 0 ? 'text-emerald-600 dark:text-emerald-400' : item.discrepancy < 0 ? 'text-destructive' : 'text-foreground'))}>{item.countedStockProvided ? `${stockAuditDirection(item.discrepancy)}: ${formatCurrency(item.discrepancyValue)}` : '—'}</TableCell>
                          <TableCell><Badge variant={statusVariant}>{status}</Badge></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t bg-muted/20 px-6 py-4 sm:justify-between">
            <p className="hidden text-xs text-muted-foreground sm:block">No stock changes have been applied yet.</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsReportDialogOpen(false)}>Close</Button>
              <Button variant="outline" onClick={exportStockTakeReportPdf} disabled={isExportingReport || reportRows.length === 0}>
                {isExportingReport ? <Loader2 className="mr-2 animate-spin" /> : <Download className="mr-2" />}
                {isExportingReport ? 'Exporting…' : 'Export PDF'}
              </Button>
              <Button onClick={() => { setIsReportDialogOpen(false); setIsConfirmModalOpen(true); }} disabled={isExportingReport || isSubmitting}>
                <Send className="mr-2" /> Submit for Approval
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
