'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Loader2, Upload, X, FileText, Download, GitBranch, CheckSquare, Square } from 'lucide-react';
import Papa from 'papaparse';
import { v4 as uuidv4 } from 'uuid';

import { db, type InventoryItem } from '@/lib/db';
import { type BusinessType, unitTypesByBusinessType } from '@/lib/inventory/config';
import { syncService } from '@/lib/services/sync-service';
import { isTauriApp } from '@/lib/tauri-init';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';

type Branch = { id: string; name: string; address: string; };
type ImportMode = 'csv' | 'branch';

const normalizeProductName = (value?: string) => String(value || '').trim().toLowerCase();
const toBackendBranchId = (id: string): string => {
  const normalized = String(id || '').trim();
  if (!normalized) return normalized;

  const brnMatch = /^BRN-(\d+)$/i.exec(normalized);
  if (brnMatch) return brnMatch[1];

  const legacyBranchMatch = /^branch-(\d+)$/i.exec(normalized);
  if (legacyBranchMatch) return legacyBranchMatch[1];

  if (/^\d+$/.test(normalized)) return normalized;
  return normalized;
};

const getBranchIdCandidates = (branchId: string): string[] => {
  const normalized = String(branchId || '').trim();
  if (!normalized) return [];

  const backendId = toBackendBranchId(normalized);
  const candidates = new Set<string>([normalized, backendId]);

  if (/^\d+$/.test(backendId)) {
    candidates.add(`BRN-${backendId}`);
    candidates.add(`branch-${backendId}`);
  }

  return Array.from(candidates).filter((candidate) => candidate.length > 0);
};

const getInventoryItemsForBranch = async (targetBranchId: string): Promise<InventoryItem[]> => {
  const branchCandidates = getBranchIdCandidates(targetBranchId);
  if (branchCandidates.length === 0) {
    return [];
  }

  if (branchCandidates.length === 1) {
    return db.inventory.where('branchId').equals(branchCandidates[0]).toArray();
  }

  return db.inventory.where('branchId').anyOf(branchCandidates).toArray();
};

const DEFAULT_REORDER_LEVEL = 5;
const REORDER_LEVEL_OPTIONS = ['5', '10', '20', '50'];
const BOOLEAN_OPTIONS = ['true', 'false'];
const BAR_PORTION_NAME_OPTIONS = ['shot', 'tot', 'glass', 'pint', 'bottle', 'can', 'cup', 'measure', 'custom'];

type ImportTemplateRow = Record<string, string | number | boolean>;
type TemplateFieldOption = { field: string; options: string[] };

type CsvRow = Record<string, unknown>;

const CSV_FIELD_ALIASES = {
  id: ['id', 'productid', 'itemid'],
  name: ['name', 'itemname', 'productname'],
  itemType: ['itemtype', 'type', 'producttype'],
  category: ['category', 'itemcategory'],
  stockUnits: ['stockunits', 'stock', 'quantity', 'qty', 'onhand'],
  unitType: ['unittype', 'unit', 'uom', 'measureunit'],
  reorderLevel: ['reorderlevel', 'reorder', 'minimumstock', 'minstock'],
  cost: ['cost', 'purchasecost', 'buyingprice', 'costperunit'],
  price: ['price', 'sellingprice', 'saleprice'],
  value: ['value', 'stockvalue'],
  status: ['status', 'stockstatus'],
  supplier: ['supplier', 'suppliername'],
  manufacturer: ['manufacturer', 'maker'],
  brand: ['brand'],
  batch: ['batch', 'batchnumber'],
  packSize: ['packsize'],
  productCode: ['productcode', 'code', 'itemcode'],
  barcode: ['barcode', 'barcodevalue'],
  sku: ['sku'],
  expiry: ['expiry', 'expirydate', 'expdate'],
  isVariablePrice: ['isvariableprice', 'variableprice'],
  isProduced: ['isproduced', 'produced'],
  onMenu: ['onmenu', 'menu'],
  isSoldInPortions: ['issoldinportions', 'soldinportions'],
  portionName: ['portionname'],
  portionsPerUnit: ['portionsperunit'],
  recipe: ['recipe', 'bom', 'billofmaterials'],
} as const;

const normalizeCsvHeader = (value: string): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const parseCsvBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;

  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
};

const parseCsvNumber = (value: unknown, fallback = 0): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value ?? '').trim().replace(/,/g, '');
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseCsvOptionalNumber = (value: unknown): number | undefined => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return undefined;
  const parsed = parseCsvNumber(normalized, Number.NaN);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const formatPreviewNumber = (value?: number): string => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return '—';
  }
  return parsed.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const normalizeItemType = (value: unknown): 'ingredient' | 'sellable' => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return 'sellable';
  if (
    normalized === 'ingredient' ||
    normalized === 'ingredients' ||
    normalized === 'raw' ||
    normalized === 'rawmaterial' ||
    normalized === 'rawmaterials'
  ) {
    return 'ingredient';
  }
  return 'sellable';
};

const normalizeExpiryDate = (value: unknown): string | undefined => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  const parsedDate = new Date(normalized);
  if (Number.isNaN(parsedDate.getTime())) {
    return undefined;
  }

  return parsedDate.toISOString().slice(0, 10);
};

const parseRecipe = (value: unknown): InventoryItem['recipe'] => {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value as InventoryItem['recipe'];
  }

  if (typeof value !== 'string') {
    return [];
  }

  const normalized = value.trim();
  if (!normalized) return [];

  try {
    const parsed = JSON.parse(normalized);
    return Array.isArray(parsed) ? (parsed as InventoryItem['recipe']) : [];
  } catch {
    return [];
  }
};

const normalizeLookupValue = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const computeStatus = (
  stockUnits: number,
  reorderLevel: number
): InventoryItem['status'] => {
  if (stockUnits <= 0) return 'Out of Stock';
  if (stockUnits <= reorderLevel) return 'Low Stock';
  return 'In Stock';
};

const getCsvValue = (
  row: CsvRow,
  aliases: readonly string[]
): unknown => {
  const normalizedEntries = new Map<string, unknown>();
  for (const [key, value] of Object.entries(row)) {
    normalizedEntries.set(normalizeCsvHeader(key), value);
  }

  for (const alias of aliases) {
    const normalizedAlias = normalizeCsvHeader(alias);
    if (!normalizedEntries.has(normalizedAlias)) continue;
    const value = normalizedEntries.get(normalizedAlias);
    if (value === undefined || value === null) continue;
    return value;
  }

  return undefined;
};

const parseInventoryCsvRow = (
  row: CsvRow,
  targetBranchId: string,
  businessType: BusinessType
): InventoryItem | null => {
  const name = String(getCsvValue(row, CSV_FIELD_ALIASES.name) ?? '').trim();
  if (!name) {
    return null;
  }

  const rawItemType = getCsvValue(row, CSV_FIELD_ALIASES.itemType);
  const hasExplicitItemType = String(rawItemType ?? '').trim().length > 0;
  const isRestaurantOrBar = businessType === 'Restaurant' || businessType === 'Bar & Liquor';
  const parsedPrice = parseCsvOptionalNumber(getCsvValue(row, CSV_FIELD_ALIASES.price));
  const parsedCost = parseCsvOptionalNumber(getCsvValue(row, CSV_FIELD_ALIASES.cost));
  const parsedRecipe = parseRecipe(getCsvValue(row, CSV_FIELD_ALIASES.recipe));
  const isProduced = parseCsvBoolean(getCsvValue(row, CSV_FIELD_ALIASES.isProduced), false);
  const itemType = hasExplicitItemType
    ? normalizeItemType(rawItemType)
    : isRestaurantOrBar
      ? isProduced || parsedPrice !== undefined || parsedRecipe.length > 0
        ? 'sellable'
        : parsedCost !== undefined
          ? 'ingredient'
          : 'sellable'
      : 'sellable';
  const stockUnits = parseCsvNumber(getCsvValue(row, CSV_FIELD_ALIASES.stockUnits), 0);
  const reorderLevel = parseCsvNumber(getCsvValue(row, CSV_FIELD_ALIASES.reorderLevel), DEFAULT_REORDER_LEVEL);
  const cost = parsedCost;
  const parsedValue = parseCsvOptionalNumber(getCsvValue(row, CSV_FIELD_ALIASES.value));
  const computedValue = Number((stockUnits * (cost || 0)).toFixed(2));
  const value = parsedValue ?? computedValue;
  const statusValue = String(getCsvValue(row, CSV_FIELD_ALIASES.status) ?? '').trim() as InventoryItem['status'];
  const status =
    statusValue === 'In Stock' || statusValue === 'Low Stock' || statusValue === 'Out of Stock'
      ? statusValue
      : computeStatus(stockUnits, reorderLevel);
  const rawId = String(getCsvValue(row, CSV_FIELD_ALIASES.id) ?? '').trim();

  return {
    id: rawId || uuidv4(),
    name,
    category: String(getCsvValue(row, CSV_FIELD_ALIASES.category) ?? '').trim() || 'Uncategorized',
    itemType,
    branchId: targetBranchId,
    stockUnits,
    unitType: String(getCsvValue(row, CSV_FIELD_ALIASES.unitType) ?? '').trim() || 'unit',
    reorderLevel,
    cost,
    price: parsedPrice,
    value,
    status,
    supplier: String(getCsvValue(row, CSV_FIELD_ALIASES.supplier) ?? '').trim() || undefined,
    manufacturer: String(getCsvValue(row, CSV_FIELD_ALIASES.manufacturer) ?? '').trim() || undefined,
    brand: String(getCsvValue(row, CSV_FIELD_ALIASES.brand) ?? '').trim() || undefined,
    batch: String(getCsvValue(row, CSV_FIELD_ALIASES.batch) ?? '').trim() || undefined,
    packSize: parseCsvOptionalNumber(getCsvValue(row, CSV_FIELD_ALIASES.packSize)),
    productCode: String(getCsvValue(row, CSV_FIELD_ALIASES.productCode) ?? '').trim() || undefined,
    barcode: String(getCsvValue(row, CSV_FIELD_ALIASES.barcode) ?? '').trim() || undefined,
    sku: String(getCsvValue(row, CSV_FIELD_ALIASES.sku) ?? '').trim() || undefined,
    expiry: normalizeExpiryDate(getCsvValue(row, CSV_FIELD_ALIASES.expiry)),
    recipe: parsedRecipe,
    isVariablePrice: parseCsvBoolean(getCsvValue(row, CSV_FIELD_ALIASES.isVariablePrice), false),
    isProduced,
    onMenu: parseCsvBoolean(getCsvValue(row, CSV_FIELD_ALIASES.onMenu), false),
    isSoldInPortions: parseCsvBoolean(getCsvValue(row, CSV_FIELD_ALIASES.isSoldInPortions), false),
    portionName: String(getCsvValue(row, CSV_FIELD_ALIASES.portionName) ?? '').trim() || undefined,
    portionsPerUnit: parseCsvOptionalNumber(getCsvValue(row, CSV_FIELD_ALIASES.portionsPerUnit)),
  };
};

const getTemplateColumnsForBusinessType = (businessType: BusinessType): string[] => {
  const isRestaurantOrBar = businessType === 'Restaurant' || businessType === 'Bar & Liquor';

  if (!isRestaurantOrBar) {
    const columns = ['name', 'productCode', 'barcode', 'price', 'cost', 'unitType', 'reorderLevel', 'supplier'];
    if (businessType === 'Grocery' || businessType === 'Supermarket') {
      columns.push('isVariablePrice');
    }
    return columns;
  }

  const columns = [
    'name',
    'productCode',
    'barcode',
    'isProduced',
    'price',
    'cost',
    'unitType',
    'reorderLevel',
    'supplier',
  ];

  if (businessType === 'Bar & Liquor') {
    columns.push('isSoldInPortions', 'portionName', 'portionsPerUnit');
  }

  columns.push('recipe');
  return columns;
};

const getTemplateFieldOptionsForBusinessType = (
  businessType: BusinessType,
  columns: string[]
): TemplateFieldOption[] => {
  const optionEntries: TemplateFieldOption[] = [];

  const registerOptions = (field: string, options: string[]) => {
    if (!columns.includes(field) || options.length === 0) return;
    optionEntries.push({ field, options });
  };

  registerOptions('unitType', unitTypesByBusinessType[businessType] || []);
  registerOptions('reorderLevel', REORDER_LEVEL_OPTIONS);
  registerOptions('isProduced', BOOLEAN_OPTIONS);
  registerOptions('isVariablePrice', BOOLEAN_OPTIONS);
  registerOptions('isSoldInPortions', BOOLEAN_OPTIONS);
  registerOptions('portionName', BAR_PORTION_NAME_OPTIONS);

  return optionEntries;
};

const getTemplateRowsForBusinessType = (businessType: BusinessType): ImportTemplateRow[] => {
  const isRestaurantOrBar = businessType === 'Restaurant' || businessType === 'Bar & Liquor';

  if (!isRestaurantOrBar) {
    return [
      {
        name: 'Milk 300ml',
        productCode: 'MILK-300',
        barcode: '1234567890123',
        price: 700,
        cost: 450,
        unitType: 'bottle',
        reorderLevel: DEFAULT_REORDER_LEVEL,
        supplier: 'Local Dairy Ltd',
        isVariablePrice: false,
      },
    ];
  }

  const ingredientRow: ImportTemplateRow = {
    name: 'Flour',
    productCode: 'FLOUR-001',
    barcode: '',
    itemType: 'ingredient',
    isProduced: false,
    price: '',
    cost: 2500,
    unitType: 'kg',
    reorderLevel: 20,
    supplier: 'Wholesale Foods',
    recipe: '',
    isSoldInPortions: false,
    portionName: '',
    portionsPerUnit: '',
  };

  const producedRow: ImportTemplateRow = {
    name: businessType === 'Bar & Liquor' ? 'Signature Mojito' : 'House Pizza',
    productCode: businessType === 'Bar & Liquor' ? 'MOJITO-SIG' : 'PIZZA-HOUSE',
    barcode: '',
    itemType: 'sellable',
    isProduced: true,
    price: businessType === 'Bar & Liquor' ? 4500 : 8000,
    cost: '',
    unitType: '',
    reorderLevel: '',
    supplier: '',
    recipe:
      businessType === 'Bar & Liquor'
        ? '[{"ingredientId":"ING-RUM","name":"Rum","quantity":0.05,"unit":"L"}]'
        : '[{"ingredientId":"ING-FLOUR","name":"Flour","quantity":0.5,"unit":"kg"}]',
    isSoldInPortions: false,
    portionName: '',
    portionsPerUnit: '',
  };

  const purchasedSellableRow: ImportTemplateRow = {
    name: businessType === 'Bar & Liquor' ? 'Whisky (Bottle)' : 'Bottled Water',
    productCode: businessType === 'Bar & Liquor' ? 'WHISKY-750' : 'WATER-500',
    barcode: '',
    itemType: 'sellable',
    isProduced: false,
    price: businessType === 'Bar & Liquor' ? 2500 : 1000,
    cost: businessType === 'Bar & Liquor' ? 18000 : 600,
    unitType: '',
    reorderLevel: '',
    supplier: businessType === 'Bar & Liquor' ? 'Premium Drinks Ltd' : 'Local Beverages',
    recipe: '',
    isSoldInPortions: businessType === 'Bar & Liquor',
    portionName: businessType === 'Bar & Liquor' ? 'shot' : '',
    portionsPerUnit: businessType === 'Bar & Liquor' ? 25 : '',
  };

  return [ingredientRow, purchasedSellableRow, producedRow];
};

const projectTemplateRows = (
  rows: ImportTemplateRow[],
  columns: string[]
): ImportTemplateRow[] =>
  rows.map((row) => {
    const projected: ImportTemplateRow = {};
    columns.forEach((column) => {
      projected[column] = row[column] ?? '';
    });
    return projected;
  });

const buildTemplateOptionHintRow = (
  columns: string[],
  fieldOptions: TemplateFieldOption[]
): ImportTemplateRow => {
  const hintRow: ImportTemplateRow = {};

  columns.forEach((column) => {
    hintRow[column] = '';
  });

  fieldOptions.forEach(({ field, options }) => {
    if (!columns.includes(field)) return;
    hintRow[field] = options.join(' | ');
  });

  return hintRow;
};

export const ImportModal = ({
  isOpen,
  onOpenChange,
  branchId,
  branches,
  businessType,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  branchId: string;
  branches: Branch[];
  businessType: BusinessType;
}) => {
  const [importMode, setImportMode] = useState<ImportMode>('csv');
  const [file, setFile] = useState<globalThis.File | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [parsedData, setParsedData] = useState<InventoryItem[]>([]);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [sourceBranchId, setSourceBranchId] = useState('');
  const [sourceProducts, setSourceProducts] = useState<InventoryItem[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [isLoadingSourceProducts, setIsLoadingSourceProducts] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sourceBranchOptions = useMemo(
    () => branches.filter((branch) => String(branch.id) !== String(branchId)),
    [branches, branchId]
  );

  const templateColumns = useMemo(
    () => getTemplateColumnsForBusinessType(businessType),
    [businessType]
  );
  const templateRows = useMemo(
    () => projectTemplateRows(getTemplateRowsForBusinessType(businessType), templateColumns),
    [businessType, templateColumns]
  );
  const templateOptionalColumns = useMemo(
    () => templateColumns.filter((column) => column !== 'name'),
    [templateColumns]
  );
  const templateFieldOptions = useMemo(
    () => getTemplateFieldOptionsForBusinessType(businessType, templateColumns),
    [businessType, templateColumns]
  );
  const templateRowsForDownload = useMemo(
    () =>
      templateFieldOptions.length > 0
        ? [buildTemplateOptionHintRow(templateColumns, templateFieldOptions), ...templateRows]
        : templateRows,
    [templateColumns, templateFieldOptions, templateRows]
  );

  useEffect(() => {
    if (isOpen) {
      setImportMode('csv');
      setFile(null);
      setParsedData([]);
      setParsedHeaders([]);
      setSourceBranchId('');
      setSourceProducts([]);
      setSelectedProductIds([]);
    }
  }, [isOpen]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      const uploadedFile = event.target.files[0];
      setFile(uploadedFile);
      setParsedData([]);
      setParsedHeaders([]);
      parseFile(uploadedFile);
    }
  };

  const parseFile = (fileToParse: globalThis.File) => {
    setIsParsing(true);
    Papa.parse(fileToParse, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(),
      complete: (results) => {
        const headers = (results.meta.fields || []).map((header) => normalizeCsvHeader(header));
        setParsedHeaders(headers);
        const hasNameHeader = headers.some((header) =>
          CSV_FIELD_ALIASES.name.map((alias) => normalizeCsvHeader(alias)).includes(header)
        );

        if (!hasNameHeader) {
          toast({
            variant: 'destructive',
            title: 'Invalid CSV Format',
            description: 'File must contain at least a product name column (name/itemName/productName).',
          });
          setFile(null);
          setParsedData([]);
          setParsedHeaders([]);
        } else {
          const rows = Array.isArray(results.data) ? (results.data as CsvRow[]) : [];
          const inventoryItems = rows
            .map((row) => parseInventoryCsvRow(row, branchId, businessType))
            .filter((item): item is InventoryItem => item !== null);

          if (inventoryItems.length === 0) {
            toast({
              variant: 'destructive',
              title: 'No Valid Rows Found',
              description: 'No valid products were detected in the CSV file.',
            });
            setFile(null);
            setParsedData([]);
            setParsedHeaders([]);
          } else {
            setParsedData(inventoryItems);
          }
        }
        setIsParsing(false);
      },
      error: (error) => {
        toast({ variant: 'destructive', title: 'Error parsing file', description: error.message });
        setParsedData([]);
        setParsedHeaders([]);
        setIsParsing(false);
      },
    });
  };

  const loadSourceBranchProducts = async (selectedBranchId: string) => {
    setIsLoadingSourceProducts(true);
    try {
      if (typeof window !== 'undefined' && navigator.onLine) {
        try {
          await syncService.fetchAllInventoryFromBackend(selectedBranchId);
        } catch (error) {
          console.warn('Failed to refresh source branch products from backend:', error);
        }
      }

      const items = (await getInventoryItemsForBranch(selectedBranchId)).filter(
        (item) => item._operation !== 'delete'
      );

      const dedupedById: InventoryItem[] = [];
      const seenIds = new Set<string>();
      for (const item of items) {
        const normalizedId = String(item.id || '').trim();
        if (!normalizedId || seenIds.has(normalizedId)) {
          continue;
        }
        seenIds.add(normalizedId);
        dedupedById.push(item);
      }

      dedupedById.sort((a, b) => a.name.localeCompare(b.name));

      setSourceProducts(dedupedById);
      setSelectedProductIds(dedupedById.map((item) => item.id));
    } catch (error: any) {
      console.error('Failed to load source branch products:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to Load Branch Products',
        description: error?.message || 'Could not load products from selected branch.',
      });
      setSourceProducts([]);
      setSelectedProductIds([]);
    } finally {
      setIsLoadingSourceProducts(false);
    }
  };

  useEffect(() => {
    if (!isOpen || importMode !== 'branch') {
      return;
    }

    if (!sourceBranchId) {
      setSourceProducts([]);
      setSelectedProductIds([]);
      return;
    }

    loadSourceBranchProducts(sourceBranchId);
  }, [isOpen, importMode, sourceBranchId]);

  const toggleProductSelection = (productId: string, checked: boolean) => {
    setSelectedProductIds((prev) => {
      if (checked) {
        if (prev.includes(productId)) return prev;
        return [...prev, productId];
      }
      return prev.filter((id) => id !== productId);
    });
  };

  const handleToggleAllSourceProducts = () => {
    if (selectedProductIds.length === sourceProducts.length) {
      setSelectedProductIds([]);
      return;
    }
    setSelectedProductIds(sourceProducts.map((product) => product.id));
  };

  const handleDownloadTemplate = async () => {
    const csv = Papa.unparse(templateRowsForDownload);
    const normalizedBusinessType = businessType
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const filename = `inventory-template-${normalizedBusinessType || 'default'}.csv`;

    const isAndroidUserAgent = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent || '');
    const hasAndroidTauriAttr =
      typeof document !== 'undefined' &&
      document.documentElement.getAttribute('data-tauri-android') === 'true';
    const hasGlobalTauriInvoke =
      typeof window !== 'undefined' && typeof (window as any).__TAURI__?.invoke === 'function';
    const hasInternalTauriInvoke =
      typeof window !== 'undefined' && typeof (window as any).__TAURI_INTERNALS__?.invoke === 'function';
    const isAndroidTauri =
      (isAndroidUserAgent || hasAndroidTauriAttr) &&
      (isTauriApp() || hasGlobalTauriInvoke || hasInternalTauriInvoke || hasAndroidTauriAttr);

    if (isAndroidTauri) {
      try {
        let invokeFn: ((command: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          if (typeof invoke === 'function') {
            invokeFn = invoke as (command: string, args?: Record<string, unknown>) => Promise<unknown>;
          }
        } catch {
          // Ignore and try global fallbacks below.
        }

        if (!invokeFn && hasGlobalTauriInvoke) {
          invokeFn = (window as any).__TAURI__.invoke.bind((window as any).__TAURI__);
        }
        if (!invokeFn && hasInternalTauriInvoke) {
          invokeFn = (window as any).__TAURI_INTERNALS__.invoke.bind((window as any).__TAURI_INTERNALS__);
        }

        if (!invokeFn) {
          throw new Error('Tauri invoke bridge is not available');
        }

        const savedPath = await invokeFn('save_inventory_template_csv', {
          filename,
          content: csv,
        });

        toast({
          title: 'Template Saved',
          description: `Template saved to ${String(savedPath)}.`,
        });
        return;
      } catch (error) {
        console.error('Failed to save template via Tauri command:', error);
        toast({
          variant: 'destructive',
          title: 'Template Save Failed',
          description:
            'Could not save the CSV template on this Android app build. No file was downloaded.',
        });
        return;
      }
    }

    let downloadStarted = false;
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);

      link.setAttribute('href', url);
      link.setAttribute('download', filename);
      link.style.visibility = 'hidden';

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      downloadStarted = true;
    } catch (error) {
      console.error('Failed to trigger browser template download:', error);
      downloadStarted = false;
    }

    if (!downloadStarted) {
      toast({
        variant: 'destructive',
        title: 'Template Download Failed',
        description: 'Could not save the template file on this device. Please try again.',
      });
      return;
    }

    toast({
      title: isAndroidUserAgent ? 'Download Started' : 'Template Downloaded',
      description: isAndroidUserAgent
        ? 'Download started. Check your Downloads folder. If no file appears, use the desktop app.'
        : 'Fill in your product details and upload the file. The first row includes option hints.',
    });
  };

  const handleCsvImport = async (): Promise<{
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
  }> => {
    if (!branchId) throw new Error('Branch ID is missing.');

    const normalizedHeaderSet = new Set(parsedHeaders.map((header) => normalizeCsvHeader(header)));
    const hasColumn = (field: keyof typeof CSV_FIELD_ALIASES): boolean =>
      CSV_FIELD_ALIASES[field].some((alias) => normalizedHeaderSet.has(normalizeCsvHeader(alias)));

    const currentBranchItems = (await getInventoryItemsForBranch(branchId)).filter(
      (item) => item._operation !== 'delete'
    );

    const importedIds = parsedData
      .map((item) => String(item.id || '').trim())
      .filter(Boolean);

    const existingByImportedIdLookup = new Map<string, InventoryItem>();
    if (importedIds.length > 0) {
      const existingByImportedId = await db.inventory.bulkGet(importedIds);
      for (const existingItem of existingByImportedId) {
        if (existingItem?.id) {
          existingByImportedIdLookup.set(String(existingItem.id), existingItem);
        }
      }
    }

    const byId = new Map<string, InventoryItem>();
    const byName = new Map<string, InventoryItem>();
    const byProductCode = new Map<string, InventoryItem>();
    const byBarcode = new Map<string, InventoryItem>();

    for (const existingItem of currentBranchItems) {
      const itemId = String(existingItem.id || '').trim();
      if (itemId) byId.set(itemId, existingItem);

      const nameKey = normalizeLookupValue(existingItem.name);
      if (nameKey) byName.set(nameKey, existingItem);

      const productCodeKey = normalizeLookupValue(existingItem.productCode);
      if (productCodeKey) byProductCode.set(productCodeKey, existingItem);

      const barcodeKey = normalizeLookupValue(existingItem.barcode);
      if (barcodeKey) byBarcode.set(barcodeKey, existingItem);
    }

    const itemsToUpsert: InventoryItem[] = [];
    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const parsedItem of parsedData) {
      const parsedId = String(parsedItem.id || '').trim();
      const nameKey = normalizeLookupValue(parsedItem.name);
      if (!nameKey) {
        skippedCount += 1;
        continue;
      }

      const productCodeKey = normalizeLookupValue(parsedItem.productCode);
      const barcodeKey = normalizeLookupValue(parsedItem.barcode);

      let matchedExistingItem: InventoryItem | undefined;
      if (parsedId && byId.has(parsedId)) {
        matchedExistingItem = byId.get(parsedId);
      }
      if (!matchedExistingItem && barcodeKey && byBarcode.has(barcodeKey)) {
        matchedExistingItem = byBarcode.get(barcodeKey);
      }
      if (!matchedExistingItem && productCodeKey && byProductCode.has(productCodeKey)) {
        matchedExistingItem = byProductCode.get(productCodeKey);
      }
      if (!matchedExistingItem && byName.has(nameKey)) {
        matchedExistingItem = byName.get(nameKey);
      }

      const globalExistingById = parsedId ? existingByImportedIdLookup.get(parsedId) : undefined;
      const idBelongsToAnotherBranch =
        Boolean(globalExistingById) && String(globalExistingById?.branchId) !== String(branchId);

      const finalId = matchedExistingItem
        ? matchedExistingItem.id
        : parsedId && !idBelongsToAnotherBranch
          ? parsedId
          : uuidv4();

      const stockUnits = Number(parsedItem.stockUnits || 0);
      const reorderLevel = Number(parsedItem.reorderLevel || DEFAULT_REORDER_LEVEL);
      const cost = parsedItem.cost !== undefined ? Number(parsedItem.cost) : undefined;
      const value =
        parsedItem.value !== undefined
          ? Number(parsedItem.value)
          : Number((stockUnits * (cost || 0)).toFixed(2));

      if (matchedExistingItem) {
        const nextStockUnits = hasColumn('stockUnits') ? stockUnits : Number(matchedExistingItem.stockUnits || 0);
        const nextReorderLevel = hasColumn('reorderLevel')
          ? reorderLevel
          : Number(matchedExistingItem.reorderLevel || DEFAULT_REORDER_LEVEL);
        const nextCost = hasColumn('cost') ? cost : matchedExistingItem.cost;
        const nextValue = hasColumn('value')
          ? value
          : hasColumn('stockUnits') || hasColumn('cost')
            ? Number((nextStockUnits * Number(nextCost || 0)).toFixed(2))
            : matchedExistingItem.value;
        const nextStatus = hasColumn('status')
          ? parsedItem.status
          : hasColumn('stockUnits') || hasColumn('reorderLevel')
            ? computeStatus(nextStockUnits, nextReorderLevel)
            : matchedExistingItem.status;

        const updatedItem: InventoryItem = {
          ...matchedExistingItem,
          id: finalId,
          branchId,
          stockUnits: nextStockUnits,
          reorderLevel: nextReorderLevel,
          cost: nextCost,
          value: nextValue,
          status: nextStatus,
          _dirty: true,
          _operation: 'update',
        };

        if (hasColumn('name')) updatedItem.name = parsedItem.name;
        if (hasColumn('category')) updatedItem.category = parsedItem.category;
        if (hasColumn('itemType')) updatedItem.itemType = parsedItem.itemType;
        if (hasColumn('unitType')) updatedItem.unitType = parsedItem.unitType;
        if (hasColumn('price')) updatedItem.price = parsedItem.price;
        if (hasColumn('supplier')) updatedItem.supplier = parsedItem.supplier;
        if (hasColumn('manufacturer')) updatedItem.manufacturer = parsedItem.manufacturer;
        if (hasColumn('brand')) updatedItem.brand = parsedItem.brand;
        if (hasColumn('batch')) updatedItem.batch = parsedItem.batch;
        if (hasColumn('packSize')) updatedItem.packSize = parsedItem.packSize;
        if (hasColumn('productCode')) updatedItem.productCode = parsedItem.productCode;
        if (hasColumn('barcode')) updatedItem.barcode = parsedItem.barcode;
        if (hasColumn('sku')) updatedItem.sku = parsedItem.sku;
        if (hasColumn('expiry')) updatedItem.expiry = parsedItem.expiry;
        if (hasColumn('isVariablePrice')) updatedItem.isVariablePrice = parsedItem.isVariablePrice;
        if (hasColumn('isProduced')) updatedItem.isProduced = parsedItem.isProduced;
        if (hasColumn('onMenu')) updatedItem.onMenu = parsedItem.onMenu;
        if (hasColumn('isSoldInPortions')) updatedItem.isSoldInPortions = parsedItem.isSoldInPortions;
        if (hasColumn('portionName')) updatedItem.portionName = parsedItem.portionName;
        if (hasColumn('portionsPerUnit')) updatedItem.portionsPerUnit = parsedItem.portionsPerUnit;
        if (hasColumn('recipe')) updatedItem.recipe = parsedItem.recipe;

        itemsToUpsert.push({
          ...updatedItem,
        });
        updatedCount += 1;
      } else {
        const createdItem: InventoryItem = {
          ...parsedItem,
          id: finalId,
          branchId,
          stockUnits,
          reorderLevel,
          cost,
          value,
          status: parsedItem.status || computeStatus(stockUnits, reorderLevel),
        };

        itemsToUpsert.push({
          ...createdItem,
          _dirty: true,
          _operation: 'create',
        });
        createdCount += 1;
      }

      const indexedItem = itemsToUpsert[itemsToUpsert.length - 1];
      byId.set(String(indexedItem.id), indexedItem);
      if (nameKey) byName.set(nameKey, indexedItem);
      if (productCodeKey) byProductCode.set(productCodeKey, indexedItem);
      if (barcodeKey) byBarcode.set(barcodeKey, indexedItem);
    }

    if (itemsToUpsert.length === 0) {
      throw new Error('No valid items to import from CSV.');
    }

    await db.inventory.bulkPut(itemsToUpsert);

    return {
      createdCount,
      updatedCount,
      skippedCount,
    };
  };

  const handleBranchImport = async (): Promise<{
    importedCount: number;
    skippedCount: number;
    productCodeResetCount: number;
  }> => {
    if (!branchId) throw new Error('Branch ID is missing.');
    if (!sourceBranchId) throw new Error('Please select a source branch.');

    const selectedProducts = sourceProducts.filter((item) => selectedProductIds.includes(item.id));
    if (selectedProducts.length === 0) {
      throw new Error('Please select at least one product to import.');
    }

    if (typeof window !== 'undefined' && navigator.onLine) {
      try {
        await syncService.fetchAllInventoryFromBackend(branchId);
      } catch (error) {
        console.warn('Failed to refresh target branch products from backend before import:', error);
      }
    }

    const existingTargetItems = await getInventoryItemsForBranch(branchId);
    const existingNames = new Set(
      existingTargetItems
        .filter((item) => item._operation !== 'delete')
        .map((item) => normalizeProductName(item.name))
        .filter(Boolean)
    );

    const itemsToCreate: InventoryItem[] = [];
    let skippedCount = 0;
    let productCodeResetCount = 0;

    for (const sourceItem of selectedProducts) {
      const normalizedName = normalizeProductName(sourceItem.name);
      if (!normalizedName || existingNames.has(normalizedName)) {
        skippedCount += 1;
        continue;
      }

      existingNames.add(normalizedName);

      const {
        id: _id,
        _dirty: _dirty,
        _operation: _operation,
        _synced_at: _syncedAt,
        productCode: _sourceProductCode,
        ...productFields
      } = sourceItem;
      if (_sourceProductCode) {
        productCodeResetCount += 1;
      }

      const stockUnits = 0;

      itemsToCreate.push({
        ...productFields,
        id: uuidv4(),
        branchId,
        stockUnits,
        value: 0,
        status: 'Out of Stock',
        _dirty: true,
        _operation: 'create',
      });
    }

    if (itemsToCreate.length > 0) {
      await db.inventory.bulkAdd(itemsToCreate);
    }

    return {
      importedCount: itemsToCreate.length,
      skippedCount,
      productCodeResetCount,
    };
  };

  const handleImport = async () => {
    setIsImporting(true);
    try {
      if (importMode === 'csv') {
        const result = await handleCsvImport();
        const summary = [
          `${result.createdCount} created`,
          `${result.updatedCount} updated`,
          result.skippedCount > 0 ? `${result.skippedCount} skipped` : null,
        ].filter(Boolean);
        toast({
          title: 'Import Successful',
          description: `CSV import complete: ${summary.join(', ')}.`,
        });
      } else {
        const result = await handleBranchImport();
        const summaryParts = [
          `Imported ${result.importedCount} products`,
          result.skippedCount > 0 ? `skipped ${result.skippedCount} existing` : null,
          result.productCodeResetCount > 0
            ? `${result.productCodeResetCount} product code${result.productCodeResetCount === 1 ? '' : 's'} reset for backend uniqueness`
            : null,
          'stock initialized to 0',
        ].filter(Boolean) as string[];

        toast({
          title: 'Import Successful',
          description: `${summaryParts.join(', ')}.`,
        });
      }

      if (typeof window !== 'undefined' && navigator.onLine) {
        syncService.performFullSync(branchId).catch((error) => {
          console.error('Inventory sync after import failed:', error);
        });
      }

      onOpenChange(false);
    } catch (error: any) {
      console.error('Failed to import data:', error);
      toast({ variant: 'destructive', title: 'Import Failed', description: error.message });
    } finally {
      setIsImporting(false);
    }
  };

  const isBranchImportReady = !!sourceBranchId && selectedProductIds.length > 0;
  const isCsvImportReady = parsedData.length > 0;
  const canImport = importMode === 'csv' ? isCsvImportReady : isBranchImportReady;
  const areAllSelected = sourceProducts.length > 0 && selectedProductIds.length === sourceProducts.length;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Import Products</DialogTitle>
          <DialogDescription>
            Import products from a CSV file or copy them from another branch in this business.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="py-4">
            <Tabs value={importMode} onValueChange={(value) => setImportMode(value as ImportMode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="csv">From CSV</TabsTrigger>
                <TabsTrigger value="branch">From Branch</TabsTrigger>
              </TabsList>

              <TabsContent value="csv" className="space-y-6 pt-4">
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={handleDownloadTemplate}>
                    <Download className="w-4 h-4 mr-2" />
                    Download Template
                  </Button>
                </div>

              {!file ? (
                <div
                  className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-8 h-8 text-muted-foreground" />
                  <p className="mt-2 text-sm text-muted-foreground">Click or drag file to this area to upload</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
              ) : (
                <Card>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="w-6 h-6" />
                        <div>
                          <p className="font-semibold">{file.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {isParsing ? 'Parsing...' : `${parsedData.length} items found.`}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setFile(null);
                          setParsedData([]);
                          setParsedHeaders([]);
                          if (fileInputRef.current) {
                            fileInputRef.current.value = '';
                          }
                        }}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {!isParsing && parsedData.length > 0 && (
                <Card>
                  <CardContent className="p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Review Products Before Import</p>
                      <p className="text-xs text-muted-foreground">
                        {parsedData.length} item{parsedData.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <div className="max-h-72 overflow-y-auto rounded-md border p-2">
                      <div className="space-y-2">
                        {parsedData.map((item, index) => (
                          <div key={`${item.id}-${index}`} className="rounded-md border p-3">
                            <p className="text-xs text-muted-foreground">#{index + 1}</p>
                            <p
                              className="font-medium text-sm overflow-hidden"
                              title={item.name}
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                              }}
                            >
                              {item.name}
                            </p>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                              <p>
                                <span className="text-muted-foreground">Unit:</span> {item.unitType || 'unit'}
                              </p>
                              <p>
                                <span className="text-muted-foreground">Reorder:</span> {formatPreviewNumber(item.reorderLevel)}
                              </p>
                              <p>
                                <span className="text-muted-foreground">Cost:</span> {formatPreviewNumber(item.cost)}
                              </p>
                              <p>
                                <span className="text-muted-foreground">Price:</span> {formatPreviewNumber(item.price)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Confirm these products, then click Import.
                    </p>
                  </CardContent>
                </Card>
              )}

              </TabsContent>

              <TabsContent value="branch" className="space-y-4 pt-4">
                {sourceBranchOptions.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    No other branches are available to import from.
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label>Source Branch</Label>
                      <Select value={sourceBranchId} onValueChange={setSourceBranchId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select branch to import from" />
                        </SelectTrigger>
                        <SelectContent>
                          {sourceBranchOptions.map((branch) => (
                            <SelectItem key={branch.id} value={branch.id}>
                              {branch.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                  {sourceBranchId && (
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">
                            {isLoadingSourceProducts ? 'Loading products...' : `${sourceProducts.length} products found`}
                          </p>
                          {sourceProducts.length > 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={handleToggleAllSourceProducts}
                              className="h-8 px-2"
                            >
                              {areAllSelected ? (
                                <Square className="mr-2 h-4 w-4" />
                              ) : (
                                <CheckSquare className="mr-2 h-4 w-4" />
                              )}
                              {areAllSelected ? 'Clear All' : 'Select All'}
                            </Button>
                          )}
                        </div>

                        {isLoadingSourceProducts ? (
                          <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading branch products...
                          </div>
                        ) : sourceProducts.length === 0 ? (
                          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                            No products found in this branch.
                          </div>
                        ) : (
                          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                            {sourceProducts.map((item) => {
                              const isSelected = selectedProductIds.includes(item.id);
                              return (
                                <label
                                  key={item.id}
                                  className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/40"
                                >
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={(checked) => toggleProductSelection(item.id, checked === true)}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{item.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {item.category} • Stock {item.stockUnits || 0} {item.unitType || 'units'}
                                    </p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}

                        <p className="text-xs text-muted-foreground">
                          Selected {selectedProductIds.length} of {sourceProducts.length} products.
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}

                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <GitBranch className="h-3.5 w-3.5" />
                  Existing products are skipped by name. Imported stock is initialized to 0.
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
        <DialogFooter className="mt-2 border-t bg-background/95 pt-4 sticky bottom-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isImporting}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!canImport || isImporting}>
            {isImporting && <Loader2 className="animate-spin mr-2" />}
            {importMode === 'csv' ? `Import ${parsedData.length} items` : `Import ${selectedProductIds.length} products`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
