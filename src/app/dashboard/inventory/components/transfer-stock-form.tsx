'use client';

import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { db, type InventoryItem, type MRAMapping, type StockTransfer } from '@/lib/db';
import { useAuth } from '@/hooks/use-auth';
import { toast } from '@/hooks/use-toast';
import { logAuditAction } from '@/lib/audit';
import { syncService } from '@/lib/services/sync-service';
import { formatInventoryQuantity } from '@/lib/quantity-format';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Branch = {
  id: string;
  name: string;
  address: string;
  isEisWarehouse?: boolean;
  is_eis_warehouse?: boolean;
};

type TransferDraft = {
  quantity: string;
};

const normalizeBranchId = (value?: string | number | null): string => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  const brnMatch = /^BRN-(\d+)$/i.exec(normalized);
  if (brnMatch) return brnMatch[1];
  const legacyMatch = /^branch-(\d+)$/i.exec(normalized);
  if (legacyMatch) return legacyMatch[1];
  return normalized;
};

const getMappingInventoryItemId = (mapping: MRAMapping): string => (
  String(mapping.inventoryItemId || mapping.inventory_item_id || '').trim()
);

const mappingReadinessRank = (mapping: MRAMapping): number => {
  let score = 0;
  if (mapping.isApproved || (mapping as any).is_approved) score += 2;
  if (mapping.mraSynced || (mapping as any).mra_synced) score += 1;
  return score;
};

const isServiceInventoryItem = (item: InventoryItem, mapping?: MRAMapping): boolean => {
  if (mapping?.isProduct === false || mapping?.is_product === false) return true;
  return String(item.category || '').toLowerCase().includes('service');
};

export const TransferStockForm = ({
  branchId,
  branches,
  inventoryItems,
  onFormSubmit,
}: {
  branchId: string;
  branches: Branch[];
  inventoryItems: InventoryItem[];
  onFormSubmit: () => void;
}) => {
  const { user } = useAuth();
  const [itemSearchTerm, setItemSearchTerm] = React.useState('');
  const [selectedItems, setSelectedItems] = React.useState<Record<string, TransferDraft>>({});
  const [toBranchId, setToBranchId] = React.useState('');
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const mraMappings = useLiveQuery(
    async () => {
      const allMappings = await db.mraMappings.toArray();
      const normalizedBranchId = normalizeBranchId(branchId);
      return allMappings.filter((mapping) => {
        if (!mapping.branchId && !(mapping as any).branch_id) return true;
        return normalizeBranchId(mapping.branchId || (mapping as any).branch_id) === normalizedBranchId;
      });
    },
    [branchId],
    []
  ) || [];

  const mappingByItemId = React.useMemo(() => {
    const map = new Map<string, MRAMapping>();
    for (const mapping of mraMappings) {
      const itemId = getMappingInventoryItemId(mapping);
      if (!itemId) continue;
      const existing = map.get(itemId);
      if (!existing || mappingReadinessRank(mapping) > mappingReadinessRank(existing)) {
        map.set(itemId, mapping);
      }
    }
    return map;
  }, [mraMappings]);

  const destinationBranches = React.useMemo(
    () => branches.filter((branch) => branch.id !== branchId),
    [branches, branchId]
  );

  const normalizedItemSearchTerm = itemSearchTerm.trim().toLowerCase();
  const filteredInventoryItems = React.useMemo(() => {
    const inStockItems = inventoryItems.filter((item) => (
      Number(item.stockUnits || 0) > 0 &&
      !isServiceInventoryItem(item, mappingByItemId.get(String(item.id)))
    ));
    if (!normalizedItemSearchTerm) return inStockItems;
    return inStockItems.filter((item) =>
      [
        item.name,
        item.category,
        item.sku,
        item.barcode,
        item.productCode,
        item.unitType,
        item.stockUnits,
        item.price,
      ].some((value) => String(value || '').toLowerCase().includes(normalizedItemSearchTerm))
    );
  }, [inventoryItems, mappingByItemId, normalizedItemSearchTerm]);

  const visibleSearchResults = React.useMemo(
    () => filteredInventoryItems.slice(0, 30),
    [filteredInventoryItems]
  );

  const selectedRows = React.useMemo(() => (
    Object.entries(selectedItems)
      .map(([itemId, draft]) => {
        const item = inventoryItems.find((row) => row.id === itemId);
        return item ? { item, draft } : null;
      })
      .filter(Boolean) as Array<{ item: InventoryItem; draft: TransferDraft }>
  ), [inventoryItems, selectedItems]);

  const selectedCount = selectedRows.length;

  const validationError = React.useMemo(() => {
    if (!toBranchId) return 'Select a destination.';
    if (selectedRows.length === 0) return 'Select at least one product.';

    for (const { item, draft } of selectedRows) {
      if (isServiceInventoryItem(item, mappingByItemId.get(String(item.id)))) {
        return `${item.name} is a service and cannot be transferred.`;
      }
      const quantity = Number(draft.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return `Enter quantity for ${item.name}.`;
      }
      if (quantity > Number(item.stockUnits || 0)) {
        return `${item.name} exceeds available stock.`;
      }
    }
    return '';
  }, [mappingByItemId, selectedRows, toBranchId]);

  const updateTransferDraft = (itemId: string, updates: Partial<TransferDraft>) => {
    setSelectedItems((current) => {
      const existing = current[itemId];
      if (!existing) return current;
      return {
        ...current,
        [itemId]: { ...existing, ...updates },
      };
    });
  };

  const toggleItemSelection = (item: InventoryItem, checked: boolean) => {
    if (checked && isServiceInventoryItem(item, mappingByItemId.get(String(item.id)))) {
      toast({
        variant: 'destructive',
        title: 'Service item',
        description: 'Services do not track stock and cannot be transferred.',
      });
      return;
    }
    setSelectedItems((current) => {
      const next = { ...current };
      if (checked) {
        next[item.id] = { quantity: '1' };
      } else {
        delete next[item.id];
      }
      return next;
    });

    if (!toBranchId) {
      setToBranchId(destinationBranches[0]?.id || '');
    }
  };

  const clearSelection = () => {
    setSelectedItems({});
  };

  const submitTransfers = async () => {
    if (!user) {
      toast({ variant: 'destructive', title: 'User not found' });
      return;
    }

    if (validationError) {
      toast({ variant: 'destructive', title: validationError });
      return;
    }

    const fromBranch = branches.find((branch) => branch.id === branchId);
    const toBranch = branches.find((branch) => branch.id === toBranchId);
    if (!fromBranch || !toBranch) {
      toast({ variant: 'destructive', title: 'Invalid branch selection.' });
      return;
    }

    setIsSubmitting(true);

    try {
      const changedInventoryIds = new Set<string>();
      const createdTransferIds: string[] = [];

      await db.transaction('rw', db.inventory, db.stockTransfers, async () => {
        for (const [index, { item, draft }] of selectedRows.entries()) {
          const quantity = Number(draft.quantity);
          const newStock = Number(item.stockUnits || 0) - quantity;

          await db.inventory.update(item.id, {
            stockUnits: newStock,
            _dirty: true,
            _operation: 'update',
          });
          changedInventoryIds.add(item.id);

          const destinationItem = await db.inventory.where({ branchId: toBranchId, name: item.name }).first();

          if (destinationItem) {
            await db.inventory.update(destinationItem.id, {
              stockUnits: Number(destinationItem.stockUnits || 0) + quantity,
            });
          } else {
            const newItem: InventoryItem = {
              ...item,
              id: crypto.randomUUID(),
              branchId: toBranchId,
              stockUnits: quantity,
              _dirty: false,
              _operation: undefined,
            };
            await db.inventory.add(newItem);
          }

          const transferRecord: StockTransfer = {
            id: crypto.randomUUID(),
            fromBranchId: branchId,
            fromBranchName: fromBranch.name,
            toBranchId,
            toBranchName: toBranch.name,
            itemId: item.id,
            itemName: item.name,
            quantity,
            initiatedBy: user.displayName || 'System',
            createdAt: new Date().toISOString(),
            _dirty: true,
            _operation: 'create',
          };
          await db.stockTransfers.add(transferRecord);
          createdTransferIds.push(transferRecord.id);
        }
      });

      await Promise.all(
        Array.from(changedInventoryIds).map((id) => syncService.markAsDirty('InventoryItem', id, 'update'))
      );
      await Promise.all(
        createdTransferIds.map((id) => syncService.markAsDirty('StockTransfer', id, 'create'))
      );

      await logAuditAction({
        userId: user.uid,
        userName: user.displayName || user.email || 'Unknown',
        branchId,
        actionType: 'STOCK_TRANSFER',
        entityType: 'StockTransfer',
        entityId: createdTransferIds.join(','),
        details: {
          fromBranch: fromBranch.name,
          toBranch: toBranch.name,
          productCount: selectedRows.length,
          products: selectedRows.map(({ item, draft }) => ({
            itemName: item.name,
            quantity: Number(draft.quantity),
          })),
        },
      });

      toast({
        title: 'Stock Transferred',
        description: `${selectedRows.length} product${selectedRows.length === 1 ? '' : 's'} transferred.`,
      });
      clearSelection();
      onFormSubmit();
    } catch (error) {
      console.error('Stock transfer failed:', error);
      toast({ variant: 'destructive', title: 'Transfer failed' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto scrollbar-hide pr-2">
      <div className="space-y-2">
        <Label>Destination Branch</Label>
        <Select value={toBranchId} onValueChange={setToBranchId}>
          <SelectTrigger>
            <SelectValue placeholder="Select destination" />
          </SelectTrigger>
          <SelectContent>
            {destinationBranches.map((branch) => {
              const isWarehouse = Boolean(branch.isEisWarehouse || branch.is_eis_warehouse);
              return (
                <SelectItem key={branch.id} value={branch.id}>
                  {branch.name}{isWarehouse ? ' - Warehouse' : ''}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Products to Transfer</Label>
        <Input
          type="search"
          value={itemSearchTerm}
          onChange={(event) => setItemSearchTerm(event.target.value)}
          placeholder="Search product, barcode, SKU..."
        />
        <div className="max-h-80 overflow-y-auto rounded-md border">
          {visibleSearchResults.length > 0 ? visibleSearchResults.map((item) => {
            const draft = selectedItems[item.id];
            const isSelected = Boolean(draft);
            return (
              <div
                key={item.id}
                className={`grid grid-cols-[auto_minmax(0,1fr)_6rem] items-center gap-3 border-b px-3 py-2 last:border-b-0 ${
                  isSelected ? 'bg-primary/5' : ''
                }`}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => toggleItemSelection(item, checked === true)}
                  aria-label={`Select ${item.name}`}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[item.barcode, item.sku, item.productCode].filter(Boolean).join(' / ') || 'No barcode'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Available: {formatInventoryQuantity(item.stockUnits || 0)}
                  </p>
                </div>
                <Input
                  className="h-8 text-right"
                  type="text"
                  inputMode="decimal"
                  value={draft?.quantity || ''}
                  disabled={!isSelected}
                  placeholder="Qty"
                  onChange={(event) => updateTransferDraft(item.id, { quantity: event.target.value })}
                />
              </div>
            );
          }) : (
            <div className="px-3 py-4 text-sm text-muted-foreground">
              No products match "{itemSearchTerm.trim()}".
            </div>
          )}
        </div>
      </div>

      {selectedCount > 0 && (
        <div className="rounded-md border bg-muted/20 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span>{selectedCount} product{selectedCount === 1 ? '' : 's'} selected</span>
            <Button type="button" variant="ghost" size="sm" onClick={clearSelection} disabled={isSubmitting}>
              Clear
            </Button>
          </div>
          {validationError && <p className="mt-2 text-xs text-destructive">{validationError}</p>}
        </div>
      )}

      <DialogFooter>
        <Button
          type="button"
          onClick={submitTransfers}
          disabled={isSubmitting || Boolean(validationError)}
        >
          {isSubmitting ? 'Transferring...' : 'Confirm Transfer'}
        </Button>
      </DialogFooter>
    </div>
  );
};
