
'use client';

import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useSearchParams } from 'next/navigation';
import {
  Search,
  Filter,
  Package,
  History,
  Trash,
  Trash2,
  Loader2,
} from 'lucide-react';

import { db, type InventoryItem, type Supplier } from '@/lib/db';
import { type BusinessType } from '@/lib/inventory/config';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/hooks/use-auth';
import { syncInventoryFromBackend, getInventorySyncStatus, markInventorySynced } from '@/lib/services/inventory-sync';
import { toast } from '@/hooks/use-toast';
import { authFetch } from '@/lib/auth-fetch';
import { logAuditAction } from '@/lib/audit';

import { AddProductForm } from './components/product-form';
import { ReceiveStockForm } from './components/receive-stock-form';
import { TransferStockForm } from './components/transfer-stock-form';
import { RecordWasteForm } from './components/waste-form';
import { ImportModal } from './components/import-modal';
import { InventoryTab } from './components/inventory-tab';
import { PurchasesTab } from './components/purchases-tab';
import { TransfersTab } from './components/transfers-tab';
import { WasteTab } from './components/waste-tab';
import { MRAMappingsTab } from './components/mra-mappings-tab';

import {
  Card,
  CardHeader,
} from '@/components/ui/card';
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const LOCAL_STORAGE_KEYS = {
    ACTIVE_BRANCH: 'handypos-active-branch',
    BUSINESS_SETTINGS: 'handypos-business-settings',
    BRANCHES: 'handypos-branches'
};
type Branch = { id: string; name: string; address: string; };

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

const getInventoryItemsForBranch = async (branchId: string): Promise<InventoryItem[]> => {
  const branchCandidates = getBranchIdCandidates(branchId);
  if (branchCandidates.length === 0) {
    return [];
  }

  if (branchCandidates.length === 1) {
    return db.inventory.where('branchId').equals(branchCandidates[0]).toArray();
  }

  return db.inventory.where('branchId').anyOf(branchCandidates).toArray();
};

const getBranchScopedRows = async (table: any, branchId: string): Promise<any[]> => {
  const branchCandidates = getBranchIdCandidates(branchId);
  if (branchCandidates.length === 0) {
    return [];
  }

  if (branchCandidates.length === 1) {
    return table.where('branchId').equals(branchCandidates[0]).toArray();
  }

  return table.where('branchId').anyOf(branchCandidates).toArray();
};

export default function InventoryPage() {
  const { business, user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const activeBusinessId = business?.id || user?.businessId || null;
  const [currentBusinessType, setCurrentBusinessType] = useState<BusinessType>('Grocery');
  const [isAddFormOpen, setAddFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | undefined>(undefined);
  const [isReceiveStockOpen, setReceiveStockOpen] = useState(false);
  const [isTransferStockOpen, setTransferStockOpen] = useState(false);
  const [isImportModalOpen, setImportModalOpen] = useState(false);
  const [isWasteModalOpen, setWasteModalOpen] = useState(false);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ hasPendingSync: false });
  const [activeTab, setActiveTab] = useState('inventory');
  const [businessCurrency, setBusinessCurrency] = useState('USD');
  const [searchTerm, setSearchTerm] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isDeleteAllInventoryOpen, setIsDeleteAllInventoryOpen] = useState(false);
  const [isDeletingAllInventory, setIsDeletingAllInventory] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState(0);
  const [deleteStage, setDeleteStage] = useState('');
  const [mraRefreshKey, setMraRefreshKey] = useState(0);
  
  useEffect(() => {
    if (typeof window !== 'undefined') {
        const branchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
        if(branchId) {
            setActiveBranchId(branchId);
        } else {
            // Default to 'main' if no branch is set
            setActiveBranchId('main');
        }
        const storedBranches = localStorage.getItem(LOCAL_STORAGE_KEYS.BRANCHES);
        if (storedBranches) {
          setBranches(JSON.parse(storedBranches));
        }
    }
  }, []);

  // Load business type and currency
  useEffect(() => {
    const loadBusinessSettings = async () => {
      if (activeBusinessId) {
        try {
          const businessProfile = await db.business.get(activeBusinessId);
          if (businessProfile) {
            // Load business type - map from backend format to frontend BusinessType
            if (businessProfile.type) {
              const typeMap: Record<string, BusinessType> = {
                'pharmacy': 'Pharmacy',
                'restaurant': 'Restaurant',
                'bar_liquor': 'Bar & Liquor',
                'bar & liquor': 'Bar & Liquor',
                'supermarket': 'Supermarket',
                'grocery': 'Grocery',
                'beauty_salon': 'Beauty Salon and Spa',
                'beauty salon and spa': 'Beauty Salon and Spa',
                'general_retail': 'General Retail',
                'general retail': 'General Retail',
                'generic': 'General Retail',
              };
              const mappedType = typeMap[businessProfile.type.toLowerCase()] || 'General Retail';
              console.log('[InventoryPage] Setting business type to:', mappedType);
              setCurrentBusinessType(mappedType);
            }
            // Load currency
            if (businessProfile.currency) {
              setBusinessCurrency(businessProfile.currency);
            }
          }
        } catch (error) {
          console.error('Failed to load business settings:', error);
        }
      }
    };
    loadBusinessSettings();
  }, [activeBusinessId]);

  // Listen for branch changes from header (custom event) and pull data
  useEffect(() => {
    const handleBranchChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      const branchId = customEvent.detail?.branchId;
      if (branchId) {
        console.log('[InventoryPage] Branch changed to:', branchId);
        setActiveBranchId(branchId);
        // Pull fresh data from server when branch changes
        pullServerData(branchId);
      }
    };

    window.addEventListener('branchChanged', handleBranchChange);
    return () => window.removeEventListener('branchChanged', handleBranchChange);
  }, []);

  // Pull server data on page load and when business context changes
  useEffect(() => {
    if (activeBranchId) {
      console.log('[InventoryPage] Pulling server data for branch:', activeBranchId);
      pullServerData(activeBranchId);
    }
  }, [activeBranchId, activeBusinessId]);

  const pullServerData = async (branchId: string) => {
    setIsLoadingData(true);
    try {
      console.log('[InventoryPage] Starting data fetch from backend for branch:', branchId);
      const { syncService } = await import('@/lib/services/sync-service');
      
      const backendBranchId = toBackendBranchId(branchId);

      try {
        // Fetch all inventory items from backend
        console.log('[InventoryPage] Fetching inventory from backend');
        await syncService.fetchAllInventoryFromBackend(branchId);
        console.log('[InventoryPage] Inventory fetch completed');
      } catch (error) {
        console.error('[InventoryPage] Failed to fetch inventory from backend:', error);
        console.log('[InventoryPage] Falling back to local inventory data');
      }

      try {
        // Fetch suppliers from backend (filtered by current business)
        console.log('[InventoryPage] Fetching suppliers from backend for business:', activeBusinessId);
        const suppliersUrl = activeBusinessId ? `/inventory/suppliers/?business_id=${activeBusinessId}` : '/inventory/suppliers/';
        const suppliersResponse = await authFetch.fetch<any>(suppliersUrl);
        
        let suppliers = [];
        if (suppliersResponse && Array.isArray(suppliersResponse)) {
          suppliers = suppliersResponse;
        } else if (suppliersResponse?.results && Array.isArray(suppliersResponse.results)) {
          suppliers = suppliersResponse.results;
        }

        console.log('[InventoryPage] Received', suppliers.length, 'suppliers from backend');
        for (const supplier of suppliers) {
          await db.suppliers.put({
            id: supplier.id,
            businessId: supplier.business || activeBusinessId || undefined,
            name: supplier.name,
            contactPerson: supplier.contact_person,
            email: supplier.email,
            phone: supplier.phone,
            address: supplier.address,
            createdAt: supplier.created_at,
            updatedAt: supplier.updated_at,
            // MRA EIS Compliance Fields
            supplierTin: supplier.supplier_tin || '',
            vatRegistered: supplier.vat_registered || false,
          });
        }
      } catch (error) {
        console.error('[InventoryPage] Failed to fetch suppliers from backend:', error);
        console.log('[InventoryPage] Falling back to local suppliers data');
      }

      try {
        // Fetch purchase history from backend
        console.log('[InventoryPage] Fetching purchase history from backend');
        const purchaseResponse = await authFetch.fetch<any>(`/inventory/purchase-orders/?branch_id=${backendBranchId}`);
        
        let purchases = [];
        if (purchaseResponse && Array.isArray(purchaseResponse)) {
          purchases = purchaseResponse;
        } else if (purchaseResponse?.results && Array.isArray(purchaseResponse.results)) {
          purchases = purchaseResponse.results;
        }

        console.log('[InventoryPage] Received', purchases.length, 'purchase records from backend');
        
        // ✅ Get all backend purchase IDs to identify which local records to keep
        const backendPurchaseIds = new Set<string>();
        for (const purchase of purchases) {
          if (Array.isArray(purchase.items)) {
            for (const item of purchase.items) {
              if (item?.id !== undefined && item?.id !== null) {
                backendPurchaseIds.add(String(item.id));
              }
            }
          }
        }
        
        // ✅ Delete only records that are NOT dirty (not waiting to sync)
        // and are server-trackable IDs. Keep legacy/local-only numeric IDs.
        const allLocalRecords = await db.purchaseHistory.where({ branchId: branchId }).toArray();
        const isUuidLike = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
        for (const record of allLocalRecords) {
          const localId = String(record.id ?? '').trim();
          const isServerTrackableId = isUuidLike(localId);

          // If record is not in backend AND not dirty, delete it
          if (isServerTrackableId && !backendPurchaseIds.has(localId) && !record._dirty) {
            await db.purchaseHistory.delete(record.id);
          }
        }
        
        for (const purchase of purchases) {
          // ✅ Get supplier name from backend response (includes null handling)
          let supplierName = purchase.supplier_name || 'No Supplier';
          
          // ✅ If supplier_name is null/undefined but supplier ID exists, try to fetch from local cache
          if (!supplierName || supplierName === 'null') {
            if (purchase.supplier) {
              try {
                const supplier = await db.suppliers.get(purchase.supplier);
                if (supplier) {
                  supplierName = supplier.name;
                  console.log('[InventoryPage] Found supplier from cache:', supplier.name);
                } else {
                  supplierName = 'No Supplier';
                }
              } catch (e) {
                console.warn('[InventoryPage] Could not fetch supplier from cache:', purchase.supplier);
                supplierName = 'No Supplier';
              }
            } else {
              supplierName = 'No Supplier';
            }
          }

          const receivedDate = purchase.received_date;
          const items = Array.isArray(purchase.items) ? purchase.items : [];

          if (items.length === 0) {
            console.warn('[InventoryPage] Purchase order has no items:', purchase.id);
          }

          for (const poItem of items) {
            const purchaseItemId = poItem.id ? String(poItem.id) : undefined;
            if (!purchaseItemId) {
              console.warn('[InventoryPage] Skipping purchase item without id:', poItem);
              continue;
            }

            const existingRecord = await db.purchaseHistory.get(purchaseItemId as any);
            if (existingRecord?._dirty) {
              console.log('[InventoryPage] Skipping purchase item overwrite because local record is dirty:', purchaseItemId);
              continue;
            }

            // Determine product name
            let productName = poItem.item_name || 'Unknown';
            if (productName === 'Unknown' && poItem.inventory_item) {
              try {
                const inv = await db.inventory.get(poItem.inventory_item);
                if (inv) productName = inv.name;
              } catch {}
            }

            const quantityReceivedRaw = poItem.quantity_received ?? poItem.quantityReceived ?? 0;
            const quantityReceivedParsed = Number(quantityReceivedRaw);
            const quantityReceived = Number.isFinite(quantityReceivedParsed) ? quantityReceivedParsed : 0;

            const quantityRemainingRaw = poItem.quantity_remaining ?? poItem.quantityRemaining;
            const quantityRemainingParsed = Number(quantityRemainingRaw);
            const hasExplicitRemaining =
              quantityRemainingRaw !== undefined &&
              quantityRemainingRaw !== null &&
              quantityRemainingRaw !== '' &&
              Number.isFinite(quantityRemainingParsed);

            const quantityRemaining = hasExplicitRemaining
              ? Math.max(0, quantityRemainingParsed)
              : Math.max(0, existingRecord?.quantityRemaining ?? quantityReceived);

            const sessionIdRaw = poItem.session_id ?? poItem.sessionId ?? existingRecord?.sessionId;
            const sessionId = sessionIdRaw !== undefined && sessionIdRaw !== null && sessionIdRaw !== ''
              ? String(sessionIdRaw)
              : undefined;

            await db.purchaseHistory.put({
              id: purchaseItemId,
              purchaseOrderId: purchase.id,
              branchId: branchId,
              supplierId: purchase.supplier,  // ✅ Can be null
              supplierName: supplierName,  // ✅ Will be 'No Supplier' if null
              productId: poItem.inventory_item,
              productName: productName,
              referenceNumber:
                (purchase as any).reference_number ||
                (purchase as any).referenceNumber ||
                existingRecord?.referenceNumber,
              vatAmount: (() => {
                const rawVat =
                  (purchase as any).vat_amount ??
                  (purchase as any).vatAmount ??
                  existingRecord?.vatAmount;
                const parsedVat = Number(rawVat);
                return Number.isFinite(parsedVat) ? parsedVat : undefined;
              })(),
              taxRate: (() => {
                const rawRate = poItem.tax_rate ?? poItem.taxRate;
                const parsed = Number(rawRate);
                return Number.isFinite(parsed) ? parsed : undefined;
              })(),
              taxCalculationMethod:
                poItem.tax_calculation_method ??
                poItem.taxCalculationMethod ??
                existingRecord?.taxCalculationMethod,
              taxAmount: (() => {
                const rawAmount = poItem.tax_amount ?? poItem.taxAmount;
                const parsed = Number(rawAmount);
                return Number.isFinite(parsed) ? parsed : undefined;
              })(),
              quantityReceived: quantityReceived,
              quantityRemaining: quantityRemaining,
              costPerUnit: Number(poItem.cost_per_unit || poItem.costPerUnit || 0),
              totalCost: Number(poItem.total_cost || poItem.totalCost || 0),
              paymentStatus: purchase.payment_status || 'Pending',
              amountDue: Number(purchase.amount_due || 0),
              receivedDate: receivedDate,
              expiryDate: poItem.expiry_date,
              batchNumber: poItem.batch_number,
              sessionId,
              createdAt: poItem.created_at || purchase.created_at,
              updatedAt: poItem.updated_at || purchase.updated_at,
            });
          }
        }
        
        console.log('[InventoryPage] Purchase history synced to local DB');
      } catch (error) {
        console.error('[InventoryPage] Failed to fetch purchase history from backend:', error);
        console.log('[InventoryPage] Falling back to local purchase history data');
      }

      try {
        // Fetch stock transfers from backend
        console.log('[InventoryPage] Fetching stock transfers from backend');
        const transferResponse = await authFetch.fetch<any>(`/inventory/transfers/?branch_id=${backendBranchId}`);
        
        let transfers = [];
        if (transferResponse && Array.isArray(transferResponse)) {
          transfers = transferResponse;
        } else if (transferResponse?.results && Array.isArray(transferResponse.results)) {
          transfers = transferResponse.results;
        }

        console.log('[InventoryPage] Received', transfers.length, 'stock transfers from backend');
        for (const transfer of transfers) {
          await db.stockTransfers.put({
            id: transfer.id,
            fromBranchId: transfer.from_branch,
            fromBranchName: transfer.from_branch_name,
            toBranchId: transfer.to_branch,
            toBranchName: transfer.to_branch_name,
            itemId: transfer.inventory_item,
            itemName: transfer.item_name,
            quantity: parseFloat(transfer.quantity || 0),
            initiatedBy: transfer.initiated_by,
            createdAt: transfer.created_at,
          });
        }
      } catch (error) {
        console.error('[InventoryPage] Failed to fetch stock transfers from backend:', error);
        console.log('[InventoryPage] Falling back to local stock transfers data');
      }

      try {
        // Fetch waste log from backend
        console.log('[InventoryPage] Fetching waste log from backend');
        const wasteResponse = await authFetch.fetch<any>(`/inventory/waste/?branch_id=${backendBranchId}`);
        
        let wasteRecords = [];
        if (wasteResponse && Array.isArray(wasteResponse)) {
          wasteRecords = wasteResponse;
        } else if (wasteResponse?.results && Array.isArray(wasteResponse.results)) {
          wasteRecords = wasteResponse.results;
        }

        console.log('[InventoryPage] Received', wasteRecords.length, 'waste records from backend');
        for (const waste of wasteRecords) {
          const sessionIdRaw = waste.session_id ?? waste.sessionId ?? waste.session;
          const sessionId = sessionIdRaw !== undefined && sessionIdRaw !== null && sessionIdRaw !== ''
            ? String(sessionIdRaw)
            : undefined;

          await db.wasteLog.put({
            id: waste.id,
            branchId: branchId,
            itemId: waste.inventory_item,
            itemName: waste.item_name,
            quantity: parseFloat(waste.quantity || 0),
            unit: waste.unit,
            cost: parseFloat(waste.cost || 0),
            reason: waste.reason,
            notes: waste.notes,
            // MRA EIS Fields
            affectsTax: waste.affects_tax || false,
            approvedBy: waste.approved_by || '',
            recordedAt: waste.recorded_at,
            recordedBy: waste.recorded_by,
            sessionId,
            createdAt: waste.created_at,
          });
        }
        // Reconcile local waste log with backend: remove local records no longer present remotely
        try {
          const backendWasteIds = new Set<string>(wasteRecords.map((w: any) => w.id));
          const localWaste = await db.wasteLog.where({ branchId: branchId }).toArray();
          for (const rec of localWaste) {
            if (!backendWasteIds.has(rec.id) && !rec._dirty) {
              await db.wasteLog.delete(rec.id);
              console.log('[InventoryPage] Deleted local waste record not on backend:', rec.id);
            }
          }
        } catch (wasteReconcileErr) {
          console.warn('[InventoryPage] Waste log reconciliation skipped/failed:', wasteReconcileErr);
        }
      } catch (error) {
        console.error('[InventoryPage] Failed to fetch waste log from backend:', error);
        console.log('[InventoryPage] Falling back to local waste log data');
      }

      try {
        // Fetch MRA product mappings from backend
        console.log('[InventoryPage] Fetching MRA product mappings from backend');
        const mraResponse = await authFetch.fetch<any>(`/inventory/mra-mappings/?branch_id=${backendBranchId}`);
        
        let mraMappings = [];
        if (mraResponse && Array.isArray(mraResponse)) {
          mraMappings = mraResponse;
        } else if (mraResponse?.results && Array.isArray(mraResponse.results)) {
          mraMappings = mraResponse.results;
        }

        console.log('[InventoryPage] Received', mraMappings.length, 'MRA product mappings from backend');
        // Note: MRA mappings are stored only in backend, not in local database
        // They are fetched on-demand when needed
      } catch (error) {
        console.error('[InventoryPage] Failed to fetch MRA mappings from backend:', error);
        console.log('[InventoryPage] MRA mappings will be fetched from backend on-demand');
      }

      try {
        // Fetch inventory snapshots from backend
        console.log('[InventoryPage] Fetching inventory snapshots from backend');
        const snapshotResponse = await authFetch.fetch<any>(`/inventory/snapshots/?branch_id=${backendBranchId}`);
        
        let snapshots = [];
        if (snapshotResponse && Array.isArray(snapshotResponse)) {
          snapshots = snapshotResponse;
        } else if (snapshotResponse?.results && Array.isArray(snapshotResponse.results)) {
          snapshots = snapshotResponse.results;
        }

        console.log('[InventoryPage] Received', snapshots.length, 'inventory snapshots from backend');
        for (const snapshot of snapshots) {
          await db.inventorySnapshots.put({
            id: snapshot.id,
            inventoryItemId: snapshot.inventory_item,
            branchId: branchId,
            quantityBeforeSale: parseFloat(snapshot.quantity_before_sale || 0),
            quantitySold: parseFloat(snapshot.quantity_sold || 0),
            quantityAfterSale: parseFloat(snapshot.quantity_after_sale || 0),
            relatedInvoiceNumber: snapshot.related_invoice_number,
            relatedOrderId: snapshot.related_order_id,
            productPrice: parseFloat(snapshot.product_price || 0),
            productTaxRate: parseFloat(snapshot.product_tax_rate || 0),
            productTaxType: snapshot.product_tax_type,
            createdAt: snapshot.created_at,
          });
        }
      } catch (error) {
        console.error('[InventoryPage] Failed to fetch inventory snapshots from backend:', error);
        console.log('[InventoryPage] Falling back to local inventory snapshots data');
      }

      console.log('[InventoryPage] Data fetch from backend completed');
    } catch (error) {
      console.error('[InventoryPage] Unexpected error during data fetch:', error);
      console.log('[InventoryPage] Using local data as fallback');
    } finally {
      setIsLoadingData(false);
    }
  };

  // Check sync status on mount and periodically
  useEffect(() => {
    const checkSyncStatus = () => {
      const status = getInventorySyncStatus();
      setSyncStatus(status);
    };

    checkSyncStatus();
    const interval = setInterval(checkSyncStatus, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Read tab parameter from URL
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['inventory', 'purchases', 'transfers', 'waste'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // Read modal parameter from URL
  useEffect(() => {
    const modalParam = searchParams.get('modal');
    if (modalParam === 'receive') {
      setReceiveStockOpen(true);
    } else if (modalParam === 'transfer') {
      setTransferStockOpen(true);
    } else if (modalParam === 'waste') {
      setWasteModalOpen(true);
    } else if (modalParam === 'add-item') {
      setAddFormOpen(true);
    }
  }, [searchParams]);

  const handleSyncFromBackend = async () => {
    if (!activeBranchId) return;

    setIsSyncing(true);
    try {
      const result = await syncInventoryFromBackend(activeBranchId);
      
      if (result.error) {
        toast({
          variant: 'destructive',
          title: 'Sync Failed',
          description: result.error,
        });
      } else {
        markInventorySynced();
        setSyncStatus({ hasPendingSync: false });
        toast({
          title: 'Sync Complete',
          description: `Synced ${result.synced} products (${result.created} new, ${result.updated} updated)`,
        });
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Sync Error',
        description: 'Failed to sync inventory from backend',
      });
    } finally {
      setIsSyncing(false);
    }
  };

  
  const inventoryData = useLiveQuery(() => {
    if (!activeBranchId) return [];
    console.log('[InventoryPage] Querying inventory for branch:', activeBranchId);
    return getInventoryItemsForBranch(activeBranchId).then(data => {
      // Filter out items marked for deletion
      const activeItems = data.filter(item => item._operation !== 'delete');
      console.log('[InventoryPage] Query result:', activeItems.length, 'items (filtered from', data.length, 'total)');
      return activeItems;
    });
  }, [activeBranchId], []);
  
  const suppliersData = useLiveQuery(() => {
    if (!activeBusinessId) return [];
    return db.suppliers.where('businessId').equals(activeBusinessId).toArray();
  }, [activeBusinessId], []);

  const purchaseHistoryData = useLiveQuery(
    () => {
      if (!activeBranchId) return [];
      return db.purchaseHistory
        .where({ branchId: activeBranchId })
        .toArray()
        .then((data) =>
          data
            .filter((record) => record._operation !== 'delete')
            .sort((a, b) => new Date(b.receivedDate).getTime() - new Date(a.receivedDate).getTime())
        )
    },
    [activeBranchId],
    []
  );
  
  const stockTransfersData = useLiveQuery(() => {
      if (!activeBranchId) return [];
      return db.stockTransfers
        .where('fromBranchId')
        .equals(activeBranchId)
        .or('toBranchId')
        .equals(activeBranchId)
        .reverse()
        .sortBy('createdAt')
        .then((data) => data.filter((record) => record._operation !== 'delete'));
  }, [activeBranchId], []);

  const wasteLogData = useLiveQuery(() => {
      if (!activeBranchId) return [];
      return db.wasteLog
        .where({ branchId: activeBranchId })
        .reverse()
        .sortBy('recordedAt')
        .then((data) => data.filter((record) => record._operation !== 'delete'));
  }, [activeBranchId], []);

  const isMobile = useIsMobile();
  
  const ingredients = inventoryData?.filter(item => item.itemType === 'ingredient') || [];

  useEffect(() => {
    if (!isDeleteAllInventoryOpen && !isDeletingAllInventory) {
      setDeleteProgress(0);
      setDeleteStage('');
    }
  }, [isDeleteAllInventoryOpen, isDeletingAllInventory]);

  const handleDeleteAllInventoryData = async () => {
    if (!activeBranchId) {
      return;
    }

    const branchCandidates = getBranchIdCandidates(activeBranchId);
    const branchCandidateSet = new Set(branchCandidates);
    const isOnline = typeof window !== 'undefined' && navigator.onLine;

    setIsDeletingAllInventory(true);
    setDeleteProgress(5);
    setDeleteStage('Preparing deletion');
    try {
      const [
        inventoryItems,
        purchaseHistoryRecords,
        purchaseOrders,
        wasteRecords,
        stockTransfers,
        inventorySnapshots,
        stockAudits,
        cartItems,
        allMappings,
      ] = await Promise.all([
        getInventoryItemsForBranch(activeBranchId),
        getBranchScopedRows(db.purchaseHistory, activeBranchId),
        getBranchScopedRows(db.purchaseOrders, activeBranchId),
        getBranchScopedRows(db.wasteLog, activeBranchId),
        db.stockTransfers.toArray(),
        getBranchScopedRows(db.inventorySnapshots, activeBranchId),
        getBranchScopedRows(db.stockAudits, activeBranchId),
        getBranchScopedRows(db.cart, activeBranchId),
        db.mraMappings.toArray(),
      ]);

      setDeleteProgress(15);
      setDeleteStage('Collecting records');

      const inventoryIds = new Set(inventoryItems.map((item) => String(item.id)));
      const branchTransfers = stockTransfers.filter((transfer) => {
        const fromBranchId = String(transfer.fromBranchId || '').trim();
        const toBranchId = String(transfer.toBranchId || '').trim();
        return branchCandidateSet.has(fromBranchId) || branchCandidateSet.has(toBranchId);
      });
      const branchMappings = allMappings.filter((mapping) => {
        const mappingBranchId = String(mapping.branchId || '').trim();
        return branchCandidateSet.has(mappingBranchId) || inventoryIds.has(String(mapping.inventoryItemId));
      });

      const totalRecordsToClear =
        inventoryItems.length +
        purchaseHistoryRecords.length +
        purchaseOrders.length +
        wasteRecords.length +
        branchTransfers.length +
        branchMappings.length +
        inventorySnapshots.length +
        stockAudits.length +
        cartItems.length;

      if (totalRecordsToClear === 0) {
        toast({
          title: 'Nothing to clear',
          description: 'There is no inventory data for the current branch.',
        });
        setDeleteProgress(0);
        setDeleteStage('');
        setIsDeleteAllInventoryOpen(false);
        return;
      }

      const nowIso = new Date().toISOString();
      let processedRecords = 0;
      const localWorkWeight = 65;
      const updateDeleteProgress = (stage: string, increment = 0) => {
        processedRecords += increment;
        const nextValue = Math.min(
          localWorkWeight,
          15 + Math.round((processedRecords / totalRecordsToClear) * (localWorkWeight - 15))
        );
        setDeleteStage(stage);
        setDeleteProgress((prev) => Math.max(prev, nextValue));
      };

      await db.transaction(
        'rw',
        db.inventory,
        db.purchaseHistory,
        db.purchaseOrders,
        db.wasteLog,
        db.stockTransfers,
        db.mraMappings,
        db.inventorySnapshots,
        db.stockAudits,
        db.cart,
        db.auditLog,
        async () => {
          updateDeleteProgress('Queueing inventory items');
          for (const item of inventoryItems) {
            await db.inventory.update(item.id, {
              _dirty: true,
              _operation: 'delete',
              _deletedAt: nowIso,
            } as any);
            updateDeleteProgress('Queueing inventory items', 1);
          }

          updateDeleteProgress('Queueing purchase history');
          for (const record of purchaseHistoryRecords) {
            const recordId = String(record.id ?? '').trim();
            if (!recordId || typeof record.id === 'number' || /^\d+$/.test(recordId)) {
              await db.purchaseHistory.delete(record.id);
              updateDeleteProgress('Queueing purchase history', 1);
              continue;
            }

            await db.purchaseHistory.update(record.id, {
              _dirty: true,
              _operation: 'delete',
            });
            updateDeleteProgress('Queueing purchase history', 1);
          }

          updateDeleteProgress('Queueing purchase orders');
          for (const order of purchaseOrders) {
            await db.purchaseOrders.update(order.id, {
              _dirty: true,
              _operation: 'delete',
              updatedAt: nowIso,
            });
            updateDeleteProgress('Queueing purchase orders', 1);
          }

          updateDeleteProgress('Queueing waste records');
          for (const waste of wasteRecords) {
            await db.wasteLog.update(waste.id, {
              _dirty: true,
              _operation: 'delete',
            });
            updateDeleteProgress('Queueing waste records', 1);
          }

          updateDeleteProgress('Queueing stock transfers');
          for (const transfer of branchTransfers) {
            await db.stockTransfers.update(transfer.id, {
              _dirty: true,
              _operation: 'delete',
            });
            updateDeleteProgress('Queueing stock transfers', 1);
          }

          updateDeleteProgress('Queueing MRA mappings');
          for (const mapping of branchMappings) {
            await db.mraMappings.put({
              ...mapping,
              _dirty: true,
              _operation: 'delete',
              updatedAt: nowIso,
            });
            updateDeleteProgress('Queueing MRA mappings', 1);
          }

          if (inventorySnapshots.length > 0) {
            await db.inventorySnapshots.bulkDelete(inventorySnapshots.map((snapshot) => snapshot.id));
            updateDeleteProgress('Removing snapshots', inventorySnapshots.length);
          }

          if (stockAudits.length > 0) {
            await db.stockAudits.bulkDelete(stockAudits.map((audit) => audit.id));
            updateDeleteProgress('Removing stock audits', stockAudits.length);
          }

          if (cartItems.length > 0) {
            await db.cart.bulkDelete(cartItems.map((item) => item.id));
            updateDeleteProgress('Removing saved carts', cartItems.length);
          }

          await logAuditAction({
            userId: user?.uid || user?.email || 'system',
            userName: user?.displayName || user?.email || 'System',
            branchId: activeBranchId,
            actionType: 'ITEM_DELETE',
            entityType: 'InventoryItem',
            entityId: `branch:${activeBranchId}`,
            details: {
              clearedAt: nowIso,
              inventoryItems: inventoryItems.length,
              purchaseHistory: purchaseHistoryRecords.length,
              purchaseOrders: purchaseOrders.length,
              wasteRecords: wasteRecords.length,
              stockTransfers: branchTransfers.length,
              mraMappings: branchMappings.length,
              inventorySnapshots: inventorySnapshots.length,
              stockAudits: stockAudits.length,
              cartItems: cartItems.length,
            },
          });
        }
      );

      setDeleteProgress(70);
      setDeleteStage('Syncing deletions');
      setSearchTerm('');
      setActiveTab('inventory');

      const { syncService } = await import('@/lib/services/sync-service');
      await syncService.performFullSync(activeBranchId, {
        onProgress: (progress) => {
          const syncBase = 70;
          const syncSpan = 30;
          const percent = typeof progress.percent === 'number' ? progress.percent : undefined;
          let nextValue = syncBase;

          if (progress.stage === 'inventory' && percent !== undefined) {
            nextValue = syncBase + Math.round((percent / 100) * syncSpan);
          } else if (progress.stage === 'pull') {
            nextValue = syncBase + Math.round(syncSpan * 0.85);
          } else if (progress.stage === 'done') {
            nextValue = 100;
          } else if (progress.stage === 'error') {
            nextValue = syncBase + Math.round(syncSpan * 0.9);
          }

          setDeleteProgress((prev) => Math.max(prev, Math.min(100, nextValue)));
          if (progress.message) {
            setDeleteStage(progress.message);
          }
        },
      });
      setDeleteProgress(100);
      setDeleteStage('Deletion complete');
      setMraRefreshKey((current) => current + 1);
      setIsDeleteAllInventoryOpen(false);

      toast({
        title: 'Inventory data cleared',
        description: isOnline
          ? 'Current-branch inventory data was cleared locally and sync was requested.'
          : 'Current-branch inventory data was cleared locally and queued for sync when you are back online.',
      });
    } catch (error) {
      console.error('[InventoryPage] Failed to clear inventory data:', error);
      toast({
        variant: 'destructive',
        title: 'Clear failed',
        description: 'Could not clear the current branch inventory data.',
      });
      setDeleteStage('Deletion failed');
    } finally {
      setIsDeletingAllInventory(false);
    }
  };
  
  const handleFormOpenChange = (open: boolean) => {
    setAddFormOpen(open);
    if (!open) {
      setEditingItem(undefined);
    }
  };

  const handleEditItem = (item: InventoryItem) => {
    setEditingItem(item);
    setAddFormOpen(true);
  };

  const searchPlaceholder =
    activeTab === 'purchases'
      ? 'Search supplier, product, batch, or payment...'
      : activeTab === 'waste'
        ? 'Search item, reason, or recorded by...'
        : activeTab === 'transfers'
          ? 'Search item, branch, or initiated by...'
          : activeTab === 'mra'
            ? 'Search product, MRA code, or mapping...'
            : 'Search products or scan barcode...';

  // Barcode scanner listener - search for products by barcode on inventory screen
  React.useEffect(() => {
    const handleBarcodeSearch = (e: KeyboardEvent) => {
      // Only process if we're on the inventory tab AND search field is focused
      if (activeTab !== 'inventory' || !isSearchFocused || e.key !== 'Enter') {
        return;
      }

      const searchValue = searchTerm.trim();

      if (!searchValue) {
        return;
      }

      console.log('[InventoryPage] Enter pressed, searching for barcode:', searchValue);
      const normalizedActiveBranchId = toBackendBranchId(activeBranchId);
      db.inventory.where('barcode').equals(searchValue).toArray().then(products => {
        const product = products.find(
          (item) =>
            toBackendBranchId(item.branchId) === normalizedActiveBranchId &&
            item._operation !== 'delete'
        );

        if (product) {
          console.log('[InventoryPage] Found product by barcode:', product.name);
          handleEditItem(product);
          toast({
            title: 'Product Found',
            description: `Found: ${product.name}`,
          });
          setSearchTerm('');
        }
      }).catch(error => {
        console.error('[InventoryPage] Error searching for barcode:', error);
      });
    };

    window.addEventListener('keydown', handleBarcodeSearch, false);
    return () => {
      window.removeEventListener('keydown', handleBarcodeSearch, false);
    };
  }, [activeTab, isSearchFocused, activeBranchId, searchTerm]);
  
  if (authLoading || !activeBranchId) {
    return (
        <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    )
  }

  return (
    <>
    <div className="flex flex-col gap-6">
      <div className="flex w-full flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
        <div className="grid gap-2">
          <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
          <p className="text-muted-foreground">
            Manage all your items, from raw ingredients to final products.
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:max-w-xs">
        </div>
      </div>
      
      <Card>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
            <CardHeader>
                <div className="flex flex-col items-start gap-4 md:flex-row md:items-center md:flex-wrap">
                    <div className="w-full overflow-x-auto md:w-auto">
                    <TabsList className="inline-flex min-w-max">
                        <TabsTrigger value="inventory" className="whitespace-nowrap">
                            <Package className="mr-2 h-4 w-4" />
                            Current Stock
                        </TabsTrigger>
                        <TabsTrigger value="purchases" className="whitespace-nowrap">
                            <History className="mr-2 h-4 w-4" />
                            Purchase History
                        </TabsTrigger>
                        <TabsTrigger value="waste" className="whitespace-nowrap">
                            <Trash className="mr-2 h-4 w-4" />
                            Waste Log
                        </TabsTrigger>
                        <TabsTrigger value="mra" className="whitespace-nowrap">
                            <Package className="mr-2 h-4 w-4" />
                            MRA Mappings
                        </TabsTrigger>
                    </TabsList>
                    </div>
                    <div className="ml-auto flex w-full flex-wrap items-center gap-2 md:w-auto md:flex-nowrap">
                        <div className="relative w-full flex-1 md:grow-0">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                          <Input 
                            ref={searchInputRef}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder={searchPlaceholder}
                            className="w-full pl-10 md:w-auto" 
                            onFocus={() => setIsSearchFocused(true)}
                            onBlur={() => setIsSearchFocused(false)}
                          />
                        </div>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline">
                                    <Filter className="mr-2 h-4 w-4" /> Filter
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[200px]">
                                <DropdownMenuLabel>Filter by Status</DropdownMenuLabel>
                                <DropdownMenuCheckboxItem checked>
                                In Stock
                                </DropdownMenuCheckboxItem>
                                <DropdownMenuCheckboxItem checked>
                                Low Stock
                                </DropdownMenuCheckboxItem>
                                <DropdownMenuCheckboxItem>
                                Out of Stock
                                </DropdownMenuCheckboxItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setIsDeleteAllInventoryOpen(true)}
                          disabled={isDeletingAllInventory}
                        >
                          {isDeletingAllInventory ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="mr-2 h-4 w-4" />
                          )}
                          Clear All Data
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <TabsContent value="inventory">
                <InventoryTab
                    inventoryData={inventoryData}
                    isMobile={isMobile}
                    currentBusinessType={currentBusinessType}
                    searchTerm={searchTerm}
                    onAddItem={() => setAddFormOpen(true)}
                    onEditItem={handleEditItem}
                    onImport={() => setImportModalOpen(true)}
                    onTransfer={() => setTransferStockOpen(true)}
                />
            </TabsContent>
            <TabsContent value="purchases">
                <PurchasesTab 
                    purchaseHistoryData={purchaseHistoryData}
                    isMobile={isMobile}
                    searchTerm={searchTerm}
                    onReceiveStock={() => setReceiveStockOpen(true)}
                    branchId={activeBranchId}
                    currency={businessCurrency}
                />
            </TabsContent>
            <TabsContent value="transfers">
                <TransfersTab
                    stockTransfersData={stockTransfersData}
                    isMobile={isMobile}
                    searchTerm={searchTerm}
                    onTransferStock={() => setTransferStockOpen(true)}
                    branchId={activeBranchId}
                />
            </TabsContent>
            <TabsContent value="waste">
                 <WasteTab 
                    wasteLogData={wasteLogData}
                    isMobile={isMobile}
                    searchTerm={searchTerm}
                    onRecordWaste={() => setWasteModalOpen(true)}
                    branchId={activeBranchId}
                 />
            </TabsContent>
            <TabsContent value="mra">
                <MRAMappingsTab
                    inventoryData={inventoryData}
                    businessId={business?.id}
                    branchId={activeBranchId}
                    searchTerm={searchTerm}
                    refreshKey={mraRefreshKey}
                />
            </TabsContent>
        </Tabs>
      </Card>
    </div>

    {/* Modals and Dialogs */}
    <Dialog open={isAddFormOpen} onOpenChange={handleFormOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader className="sticky top-0 bg-background z-10 pt-6">
            <DialogTitle>{editingItem ? 'Edit Item' : 'Add New Item to Inventory'}</DialogTitle>
            <DialogDescription>
                {editingItem ? `Update the details for ${editingItem.name}.` : 'Add an ingredient for tracking or a new sellable product with a recipe.'}
            </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto -mx-6 px-6">
            <AddProductForm 
                branchId={activeBranchId}
                businessType={currentBusinessType} 
                suppliers={suppliersData || []}
                ingredients={ingredients}
                onFormSubmit={() => handleFormOpenChange(false)}
                defaultValues={editingItem}
            />
        </div>
        </DialogContent>
    </Dialog>
     <Dialog open={isReceiveStockOpen} onOpenChange={setReceiveStockOpen}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] flex flex-col">
            <DialogHeader className="sticky top-0 bg-background z-10 pt-6">
            <DialogTitle>Receive Stock</DialogTitle>
            <DialogDescription>
                Record new inventory received from a supplier.
            </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto -mx-6 px-6">
            <ReceiveStockForm 
                branchId={activeBranchId}
                businessType={currentBusinessType} 
                inventoryItems={inventoryData || []} 
                suppliers={suppliersData || []}
                onFormSubmit={() => setReceiveStockOpen(false)} 
            />
        </div>
        </DialogContent>
    </Dialog>
    <Dialog open={isTransferStockOpen} onOpenChange={setTransferStockOpen}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Transfer Stock</DialogTitle>
                <DialogDescription>
                    Move inventory from this branch to another.
                </DialogDescription>
            </DialogHeader>
            <TransferStockForm
                branchId={activeBranchId}
                branches={branches}
                inventoryItems={ingredients}
                onFormSubmit={() => setTransferStockOpen(false)}
            />
        </DialogContent>
    </Dialog>
    <Dialog open={isWasteModalOpen} onOpenChange={setWasteModalOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Record Inventory Waste</DialogTitle>
                <DialogDescription>Log any items that were wasted, spoiled, or damaged. This will adjust your stock levels.</DialogDescription>
            </DialogHeader>
            <RecordWasteForm 
                branchId={activeBranchId}
                inventoryItems={inventoryData || []}
                onFormSubmit={() => setWasteModalOpen(false)}
            />
        </DialogContent>
    </Dialog>
    <ImportModal
      isOpen={isImportModalOpen}
      onOpenChange={setImportModalOpen}
      branchId={activeBranchId}
      branches={branches}
      businessType={currentBusinessType}
    />
    <AlertDialog open={isDeleteAllInventoryOpen} onOpenChange={setIsDeleteAllInventoryOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear all inventory data?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the current branch inventory products, purchase history, purchase orders, waste logs, transfers, MRA mappings, snapshots, and stock audits. The records are hidden immediately and queued for backend deletion on sync.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {(isDeletingAllInventory || deleteProgress > 0) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{deleteStage || 'Deleting...'}</span>
              <span>{Math.round(deleteProgress)}%</span>
            </div>
            <Progress value={deleteProgress} />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeletingAllInventory}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void handleDeleteAllInventoryData();
            }}
            disabled={isDeletingAllInventory}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeletingAllInventory ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Clearing...
              </>
            ) : (
              'Delete everything'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
