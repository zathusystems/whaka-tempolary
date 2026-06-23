'use client';

import React from 'react';
import { Archive, Loader2, RefreshCw, Send, X } from 'lucide-react';

import { db, type InventoryItem } from '@/lib/db';
import { authFetch } from '@/lib/auth-fetch';
import { ensureTauriDeviceIdentity, getDeviceSerial } from '@/lib/device-identity';
import { formatInventoryQuantity } from '@/lib/quantity-format';
import { toast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PaginationControls, usePaginatedItems } from './pagination-controls';

type Branch = {
  id: string;
  name: string;
  address?: string;
  isWarehouse?: boolean;
};

type WarehouseStockItem = {
  barcode: string;
  productName: string;
  productDescription?: string;
  currentQuantity: number;
  uom?: string;
  price?: number | null;
  raw?: any;
};

type TransferDraft = {
  quantity: string;
  price: string;
};

type Terminal = {
  id: string;
  status?: string;
  device_serial?: string;
  deviceSerial?: string;
  terminal_id?: string;
  terminalId?: string;
};

interface WarehouseStockTabProps {
  branches: Branch[];
  searchTerm: string;
  currency?: string;
}

const extractApiList = <T,>(value: any): T[] => {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.results)) return value.results;
  if (Array.isArray(value?.data)) return value.data;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.stocks)) return value.stocks;
  return [];
};

const toFiniteNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const firstPresent = (...values: unknown[]): unknown => (
  values.find((value) => value !== undefined && value !== null && String(value).trim() !== '')
);

const toOptionalFiniteNumber = (value: unknown): number | null => {
  const present = firstPresent(value);
  if (present === undefined) return null;
  const parsed = Number(present);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatMoneyOrNA = (value: unknown, currency: string): string => {
  const parsed = toOptionalFiniteNumber(value);
  if (parsed === null) return 'N/A';
  return `${currency} ${parsed.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const getApiDeviceSerial = (terminal: any): string => (
  String(terminal?.device_serial || terminal?.deviceSerial || '').trim()
);

const getTerminalLabel = (terminal: Terminal | null): string => (
  String(terminal?.terminal_id || terminal?.terminalId || terminal?.id || 'EIS terminal')
);

const normalizeWarehouseItem = (item: any): WarehouseStockItem | null => {
  const barcode = String(
    item?.barcode ||
    item?.productCode ||
    item?.product_code ||
    item?.mraProductCode ||
    ''
  ).trim();
  if (!barcode) return null;

  return {
    barcode,
    productName: String(item?.productName || item?.product_name || item?.name || barcode),
    productDescription: String(item?.productDescription || item?.product_description || '').trim(),
    currentQuantity: toFiniteNumber(item?.currentQuantity ?? item?.current_quantity ?? item?.quantity),
    uom: String(item?.uom || item?.unitOfMeasure || item?.unit_of_measure || '').trim(),
    price: toOptionalFiniteNumber(firstPresent(
      item?.price,
      item?.sellingPrice,
      item?.selling_price,
      item?.unitPrice,
      item?.unit_price,
      item?.UnitPrice,
      item?.retailPrice,
      item?.retail_price,
      item?.salePrice,
      item?.sale_price,
      item?.costPrice,
      item?.cost_price
    )),
    raw: item,
  };
};

export function WarehouseStockTab({ branches, searchTerm, currency = 'MWK' }: WarehouseStockTabProps) {
  const [terminal, setTerminal] = React.useState<Terminal | null>(null);
  const [items, setItems] = React.useState<WarehouseStockItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isTransferring, setIsTransferring] = React.useState(false);
  const [error, setError] = React.useState('');
  const [selectedItems, setSelectedItems] = React.useState<Record<string, TransferDraft>>({});
  const [toBranchId, setToBranchId] = React.useState('');
  const [localPriceByBarcode, setLocalPriceByBarcode] = React.useState<Record<string, number>>({});
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false);

  const destinationBranches = React.useMemo(
    () => branches.filter((branch) => !branch.isWarehouse),
    [branches]
  );

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const filteredItems = React.useMemo(() => {
    if (!normalizedSearchTerm) return items;
    return items.filter((item) =>
      [
        item.productName,
        item.productDescription,
        item.barcode,
        item.uom,
        item.currentQuantity,
        item.price,
      ].some((value) => String(value || '').toLowerCase().includes(normalizedSearchTerm))
    );
  }, [items, normalizedSearchTerm]);

  const {
    setCurrentPage,
    totalItems,
    totalPages,
    effectiveCurrentPage,
    pageStartIndex,
    pageEndIndex,
    paginatedItems,
  } = usePaginatedItems(filteredItems);

  React.useEffect(() => {
    setCurrentPage(1);
  }, [normalizedSearchTerm, setCurrentPage]);

  const getPreferredPrice = React.useCallback((item: WarehouseStockItem): number => {
    const localPrice = localPriceByBarcode[item.barcode];
    if (Number.isFinite(localPrice) && localPrice > 0) return localPrice;
    if (item.price !== null && item.price !== undefined && Number.isFinite(item.price)) return item.price;
    return 0;
  }, [localPriceByBarcode]);

  const selectedRows = React.useMemo(() => (
    Object.entries(selectedItems)
      .map(([barcode, draft]) => {
        const item = items.find((row) => row.barcode === barcode);
        return item ? { item, draft } : null;
      })
      .filter(Boolean) as Array<{ item: WarehouseStockItem; draft: TransferDraft }>
  ), [items, selectedItems]);

  const selectedCount = selectedRows.length;
  const destinationBranch = React.useMemo(
    () => destinationBranches.find((branch) => branch.id === toBranchId) || null,
    [destinationBranches, toBranchId]
  );
  const selectedTotals = React.useMemo(() => (
    selectedRows.reduce(
      (totals, { draft }) => {
        const quantity = Number(draft.quantity);
        const price = Number(draft.price);
        if (Number.isFinite(quantity)) totals.quantity += quantity;
        if (Number.isFinite(quantity) && Number.isFinite(price)) {
          totals.value += quantity * price;
        }
        return totals;
      },
      { quantity: 0, value: 0 }
    )
  ), [selectedRows]);

  const selectedValidationError = React.useMemo(() => {
    if (selectedRows.length === 0) return 'Select at least one product.';
    for (const { item, draft } of selectedRows) {
      const quantity = Number(draft.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return `Enter quantity for ${item.productName}.`;
      }
      if (quantity > item.currentQuantity) {
        return `${item.productName} exceeds warehouse stock.`;
      }
      const price = Number(draft.price);
      if (!Number.isFinite(price) || price < 1) {
        return `${item.productName} needs selling price of at least 1.`;
      }
    }
    return '';
  }, [selectedRows]);

  const loadWarehouseStock = React.useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      await ensureTauriDeviceIdentity();
      const terminalsResponse = await authFetch.fetch<any>('/mra-eis/terminals/');
      const terminals = extractApiList<Terminal>(terminalsResponse);
      const deviceSerial = getDeviceSerial().toLowerCase();
      const selectedTerminal =
        terminals.find((item) => (
          String(item?.status || '').toLowerCase() === 'active' &&
          getApiDeviceSerial(item).toLowerCase() === deviceSerial
        )) ||
        terminals.find((item) => String(item?.status || '').toLowerCase() === 'active') ||
        terminals[0] ||
        null;

      if (!selectedTerminal?.id) {
        setTerminal(null);
        setItems([]);
        setError('Activate this device first.');
        return;
      }

      setTerminal(selectedTerminal);
      const stockResponse = await authFetch.fetch<any>(
        `/mra-eis/terminals/${selectedTerminal.id}/warehouse_inventory/?page_size=200&max_pages=25`
      );
      const stockRows = extractApiList<any>(
        stockResponse?.stocks ||
        stockResponse?.items ||
        stockResponse?.data?.stocks ||
        stockResponse?.data ||
        stockResponse?.response?.data?.stocks ||
        stockResponse?.response?.data ||
        stockResponse?.response ||
        stockResponse
      )
        .map(normalizeWarehouseItem)
        .filter(Boolean) as WarehouseStockItem[];

      setItems(stockRows);
      const barcodes = new Set(stockRows.map((item) => item.barcode));
      const inventoryItems = await db.inventory.toArray();
      const priceMap: Record<string, number> = {};
      inventoryItems.forEach((item: InventoryItem) => {
        const candidates = [
          item.barcode,
          item.productCode,
          item.sku,
        ].map((value) => String(value || '').trim()).filter(Boolean);
        const matchedBarcode = candidates.find((candidate) => barcodes.has(candidate));
        const price = Number(item.price || 0);
        if (matchedBarcode && Number.isFinite(price) && price > 0) {
          priceMap[matchedBarcode] = price;
        }
      });
      setLocalPriceByBarcode(priceMap);
      setSelectedItems((current) => {
        const next: Record<string, TransferDraft> = {};
        Object.entries(current).forEach(([barcode, draft]) => {
          if (stockRows.some((item) => item.barcode === barcode)) {
            next[barcode] = draft;
          }
        });
        return next;
      });
    } catch (err: any) {
      const message = err?.message || 'Could not load warehouse stock.';
      setError(message);
      toast({
        variant: 'destructive',
        title: 'Warehouse stock failed',
        description: message,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadWarehouseStock();
  }, [loadWarehouseStock]);

  const updateTransferDraft = (barcode: string, updates: Partial<TransferDraft>) => {
    setSelectedItems((current) => {
      const existing = current[barcode];
      if (!existing) return current;
      return {
        ...current,
        [barcode]: { ...existing, ...updates },
      };
    });
  };

  const toggleItemSelection = (item: WarehouseStockItem, checked: boolean) => {
    setSelectedItems((current) => {
      const next = { ...current };
      if (checked) {
        next[item.barcode] = {
          quantity: '1',
          price: String(getPreferredPrice(item) || ''),
        };
      } else {
        delete next[item.barcode];
      }
      return next;
    });
    if (!toBranchId) {
      setToBranchId(destinationBranches[0]?.id || '');
    }
  };

  const clearSelection = () => {
    setSelectedItems({});
    setIsPreviewOpen(false);
  };

  const openTransferPreview = () => {
    if (!toBranchId) {
      toast({ variant: 'destructive', title: 'Select a branch' });
      return;
    }
    if (selectedValidationError) {
      toast({ variant: 'destructive', title: selectedValidationError });
      return;
    }
    setIsPreviewOpen(true);
  };

  const handleTransfer = async () => {
    if (!terminal?.id) return;
    if (!toBranchId) {
      toast({ variant: 'destructive', title: 'Select a branch' });
      return;
    }
    if (selectedValidationError) {
      toast({ variant: 'destructive', title: selectedValidationError });
      return;
    }

    const transferItems = selectedRows.map(({ item, draft }) => ({
      barcode: item.barcode,
      quantity: Number(draft.quantity),
      price: Number(draft.price),
    }));

    setIsTransferring(true);
    try {
      await authFetch.fetch<any>(`/mra-eis/terminals/${terminal.id}/transfer_inventory/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toBranchId,
          fromWarehouseToSite: true,
          items: transferItems,
        }),
      });
      toast({
        title: 'Transfer submitted',
        description: `${transferItems.length} product${transferItems.length === 1 ? '' : 's'} submitted.`,
      });
      setIsPreviewOpen(false);
      clearSelection();
      await loadWarehouseStock();
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Transfer failed',
        description: err?.message || 'Could not transfer warehouse stock.',
      });
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <CardContent>
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-muted-foreground" />
            <p className="font-medium">MRA Warehouse Stock</p>
            {terminal && <Badge variant="outline">{getTerminalLabel(terminal)}</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Official EIS warehouse quantities. Transfer stock to a branch before selling.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadWarehouseStock()} disabled={isLoading}>
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {!isLoading && (
        <div className="mb-4 rounded-md border bg-muted/20 p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2">
              <Label>Destination Branch</Label>
              <Select value={toBranchId} onValueChange={setToBranchId}>
                <SelectTrigger className="w-full lg:w-72">
                  <SelectValue placeholder="Select branch" />
                </SelectTrigger>
                <SelectContent>
                  {destinationBranches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              {selectedCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearSelection} disabled={isTransferring}>
                  <X className="mr-2 h-4 w-4" />
                  Clear {selectedCount}
                </Button>
              )}
              <Button
                onClick={openTransferPreview}
                disabled={isTransferring || Boolean(selectedValidationError) || !toBranchId}
              >
                <Send className="mr-2 h-4 w-4" />
                Review Transfer
              </Button>
            </div>
          </div>
          {selectedValidationError && selectedCount > 0 && (
            <p className="mt-2 text-xs text-destructive">{selectedValidationError}</p>
          )}
          {selectedCount === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Search products, tick items, then confirm quantity and selling price. Price must be at least 1.
            </p>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex min-h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading warehouse stock
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead className="text-right">Warehouse Qty</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead className="w-32 text-right">Transfer Qty</TableHead>
                  <TableHead className="w-36 text-right">Selling Price</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedItems.length > 0 ? paginatedItems.map((item) => {
                  const draft = selectedItems[item.barcode];
                  const isSelected = Boolean(draft);
                  const priceValue = Number(draft?.price || 0);
                  const invalidPrice = isSelected && (!Number.isFinite(priceValue) || priceValue < 1);
                  return (
                  <TableRow key={item.barcode} data-state={isSelected ? 'selected' : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={isSelected}
                        disabled={item.currentQuantity <= 0 || destinationBranches.length === 0}
                        onCheckedChange={(checked) => toggleItemSelection(item, checked === true)}
                        aria-label={`Select ${item.productName}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{item.productName}</div>
                      {item.productDescription && (
                        <div className="text-xs text-muted-foreground">{item.productDescription}</div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{item.barcode}</TableCell>
                    <TableCell className="text-right font-medium">
                      {formatInventoryQuantity(item.currentQuantity, { preferWholeNumbers: true })}
                    </TableCell>
                    <TableCell>{item.uom || '-'}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        className="ml-auto h-8 w-24 text-right"
                        type="text"
                        inputMode="decimal"
                        value={draft?.quantity || ''}
                        disabled={!isSelected}
                        placeholder="Qty"
                        onChange={(event) => updateTransferDraft(item.barcode, { quantity: event.target.value })}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        className={`ml-auto h-8 w-28 text-right ${invalidPrice ? 'border-destructive text-destructive' : ''}`}
                        type="text"
                        inputMode="decimal"
                        value={draft?.price || ''}
                        disabled={!isSelected}
                        placeholder={formatMoneyOrNA(getPreferredPrice(item), currency)}
                        onChange={(event) => updateTransferDraft(item.barcode, { price: event.target.value })}
                      />
                      {!isSelected && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatMoneyOrNA(getPreferredPrice(item), currency)}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
                }) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                      {normalizedSearchTerm ? `No warehouse stock matches "${searchTerm.trim()}".` : 'No warehouse stock found.'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <div className="space-y-3 md:hidden">
            {paginatedItems.length > 0 ? paginatedItems.map((item) => (
              <div key={item.barcode} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      className="mt-1"
                      checked={Boolean(selectedItems[item.barcode])}
                      disabled={item.currentQuantity <= 0 || destinationBranches.length === 0}
                      onCheckedChange={(checked) => toggleItemSelection(item, checked === true)}
                      aria-label={`Select ${item.productName}`}
                    />
                    <div>
                    <p className="font-semibold leading-tight">{item.productName}</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{item.barcode}</p>
                    </div>
                  </div>
                  <Badge variant="secondary">
                    {formatInventoryQuantity(item.currentQuantity, { preferWholeNumbers: true })}
                  </Badge>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{item.uom || 'Unit'}</span>
                  <span>{formatMoneyOrNA(getPreferredPrice(item), currency)}</span>
                </div>
                {selectedItems[item.barcode] && (
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Qty</Label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={selectedItems[item.barcode]?.quantity || ''}
                        onChange={(event) => updateTransferDraft(item.barcode, { quantity: event.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Price</Label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        value={selectedItems[item.barcode]?.price || ''}
                        onChange={(event) => updateTransferDraft(item.barcode, { price: event.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
            )) : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {normalizedSearchTerm ? `No warehouse stock matches "${searchTerm.trim()}".` : 'No warehouse stock found.'}
              </div>
            )}
          </div>

          <PaginationControls
            currentPage={effectiveCurrentPage}
            totalItems={totalItems}
            totalPages={totalPages}
            pageStartIndex={pageStartIndex}
            pageEndIndex={pageEndIndex}
            onPageChange={setCurrentPage}
            itemLabel="warehouse items"
          />
        </>
      )}

      <Dialog open={isPreviewOpen} onOpenChange={(open) => !isTransferring && setIsPreviewOpen(open)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Review Warehouse Transfer</DialogTitle>
            <DialogDescription>
              Confirm selected products before submitting the EIS warehouse transfer.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground">Destination</p>
                <p className="font-medium">{destinationBranch?.name || 'Not selected'}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Products</p>
                <p className="font-medium">{selectedCount}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Transfer Value</p>
                <p className="font-medium">{formatMoneyOrNA(selectedTotals.value, currency)}</p>
              </div>
            </div>

            <div className="max-h-[50vh] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Barcode</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Line Value</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedRows.map(({ item, draft }) => {
                    const quantity = Number(draft.quantity);
                    const price = Number(draft.price);
                    const lineValue = Number.isFinite(quantity) && Number.isFinite(price) ? quantity * price : 0;
                    return (
                      <TableRow key={item.barcode}>
                        <TableCell>
                          <div className="font-medium">{item.productName}</div>
                          {item.productDescription && (
                            <div className="text-xs text-muted-foreground">{item.productDescription}</div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{item.barcode}</TableCell>
                        <TableCell className="text-right">
                          {formatInventoryQuantity(quantity, { preferWholeNumbers: true })}
                        </TableCell>
                        <TableCell className="text-right">{formatMoneyOrNA(price, currency)}</TableCell>
                        <TableCell className="text-right">{formatMoneyOrNA(lineValue, currency)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPreviewOpen(false)} disabled={isTransferring}>
              Back
            </Button>
            <Button onClick={handleTransfer} disabled={isTransferring || Boolean(selectedValidationError)}>
              {isTransferring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Submit Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardContent>
  );
}
