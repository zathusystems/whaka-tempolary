import { db, type Order, type Session, type InventoryItem, type PurchaseOrder, type TakeOrder } from '@/lib/db';
import { authFetch } from '@/lib/auth-fetch';

interface SyncChange {
  id: string;
  entity_type: string;
  op: 'create' | 'update' | 'delete';
  data: any;
  timestamp: string;
}

interface SyncState {
  last_synced_at: string | null;
  is_syncing: boolean;
  pending_changes: SyncChange[];
}

class SyncService {
  private syncState: SyncState = {
    last_synced_at: typeof window !== 'undefined' ? localStorage.getItem('last_synced_at') : null,
    is_syncing: false,
    pending_changes: []
  };

  private syncInProgress = false;
  private readonly INVENTORY_SYNC_KEY = 'inventory_last_synced_at';
  private retryIntervalId: NodeJS.Timeout | null = null;
  private readonly RETRY_INTERVAL = 30000; // 30 seconds
  private readonly DEFAULT_SYNC_TIMESTAMP = '2000-01-01T00:00:00Z';

  // Convert UI/display branch id (e.g., 'BRN-9') to backend PK string ('9')
  private toBackendBranchId(id: string): string {
    const normalized = String(id || '').trim();
    if (!normalized) return normalized;

    const prefixedMatch = /^BRN-(\d+)$/i.exec(normalized);
    if (prefixedMatch) {
      return prefixedMatch[1];
    }

    const legacyMatch = /^branch-(\d+)$/i.exec(normalized);
    if (legacyMatch) {
      return legacyMatch[1];
    }

    return normalized;
  }

  private getBranchSyncStorageKey(branchId: string): string {
    return `last_synced_at:${this.toBackendBranchId(branchId)}`;
  }

  private resolveLastSyncedAt(branchId: string): string {
    if (typeof window === 'undefined') {
      return this.syncState.last_synced_at || this.DEFAULT_SYNC_TIMESTAMP;
    }

    const branchSyncKey = this.getBranchSyncStorageKey(branchId);
    const branchLastSyncedAt = localStorage.getItem(branchSyncKey);
    const globalLastSyncedAt = localStorage.getItem('last_synced_at');

    return branchLastSyncedAt || globalLastSyncedAt || this.syncState.last_synced_at || this.DEFAULT_SYNC_TIMESTAMP;
  }

  private resolveBusinessId(): string {
    if (typeof window === 'undefined') return '';

    const businessSettings = this.resolveBusinessSettings();
    if (businessSettings?.businessId) {
      return String(businessSettings.businessId).trim();
    }

    const storageKeys = ['handy-pos-business', 'handypos-business'];
    for (const key of storageKeys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.id) {
          return String(parsed.id);
        }
      } catch (error) {
        console.warn(`[Sync] Could not parse ${key}:`, error);
      }
    }

    const fallbackBusinessId = localStorage.getItem('handypos-business-id');
    return fallbackBusinessId ? String(fallbackBusinessId) : '';
  }

  private resolveBusinessSettings(): Record<string, any> | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem('handypos-business-settings');
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      console.warn('[Sync] Failed to parse business settings cache:', error);
      return null;
    }
  }

  private isEisEnabled(): boolean {
    const settings = this.resolveBusinessSettings();
    if (!settings) return false;
    const raw =
      settings.enableEis ??
      settings.enable_eis ??
      settings.eisEnabled ??
      settings.eis_enabled;
    return raw === true || raw === 'true';
  }

  private resolveTerminalId(branchId: string): string {
    if (typeof window === 'undefined') return '';
    const businessId = this.resolveBusinessId();
    if (!businessId || !branchId) return '';

    const candidateBranchIds = [branchId, this.toBackendBranchId(branchId)];
    for (const candidate of candidateBranchIds) {
      if (!candidate) continue;
      const cacheKey = `handypos-terminal:${businessId}:${candidate}`;
      const raw = localStorage.getItem(cacheKey);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const terminalId = String(parsed?.id || '').trim();
        if (terminalId) return terminalId;
      } catch (error) {
        console.warn('[Sync] Failed to parse terminal cache:', error);
      }
    }

    return '';
  }

  private async notifyEisOnlineStatus(isOnline: boolean, branchId: string): Promise<void> {
    if (!this.isEisEnabled()) return;
    const terminalId = this.resolveTerminalId(branchId);
    if (!terminalId) return;

    try {
      await authFetch.fetch(`/mra-eis/terminals/${terminalId}/update_online_status/`, {
        method: 'POST',
        body: JSON.stringify({ is_online: isOnline }),
      });
    } catch (error) {
      console.warn('[Sync] Failed to update EIS terminal online status:', error);
    }

    if (!isOnline) {
      return;
    }

    try {
      await authFetch.fetch(`/mra-eis/invoices/sync_offline/?terminal_id=${encodeURIComponent(terminalId)}`, {
        method: 'POST',
      });
    } catch (error) {
      console.warn('[Sync] Failed to trigger offline EIS sync:', error);
    }
  }

  // Convert snake_case to camelCase
  private snakeToCamel(obj: any): any {
    if (Array.isArray(obj)) {
      return obj.map(item => this.snakeToCamel(item));
    }
    
    if (obj !== null && typeof obj === 'object') {
      const converted: any = {};
      for (const [key, value] of Object.entries(obj)) {
        // Convert snake_case to camelCase
        const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        converted[camelKey] = this.snakeToCamel(value);
      }
      return converted;
    }
    
    return obj;
  }

  private toNumber(value: unknown, fallback = 0): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private toBoolean(value: unknown, fallback = false): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
      if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    }
    return fallback;
  }

  private normalizeTaxType(value: unknown): 'VAT_STANDARD' | 'VAT_ZERO' | 'VAT_EXEMPT' {
    const raw = String(value ?? '').trim().toUpperCase();
    if (raw === 'VAT_ZERO' || raw === 'ZERO') return 'VAT_ZERO';
    if (raw === 'VAT_EXEMPT' || raw === 'EXEMPT') return 'VAT_EXEMPT';
    return 'VAT_STANDARD';
  }

  private normalizeTaxRecord(record: any, fallbackBusinessId = ''): any | null {
    const converted = this.snakeToCamel(record);
    const id = String(converted.id ?? record?.id ?? '').trim();
    if (!id) return null;

    const nowIso = new Date().toISOString();
    const defaultDate = nowIso.split('T')[0];
    const businessId = String(
      converted.businessId ??
      converted.business ??
      record?.business_id ??
      record?.business ??
      fallbackBusinessId ??
      ''
    ).trim() || fallbackBusinessId;

    return {
      id,
      businessId,
      name: String(converted.name ?? record?.name ?? 'Tax').trim() || 'Tax',
      rate: this.toNumber(converted.rate ?? record?.rate, 0),
      taxType: this.normalizeTaxType(converted.taxType ?? record?.tax_type),
      isDefault: this.toBoolean(converted.isDefault ?? record?.is_default, false),
      effectiveFrom: String(
        converted.effectiveFrom ?? record?.effective_from ?? defaultDate
      ).trim() || defaultDate,
      effectiveTo: String(converted.effectiveTo ?? record?.effective_to ?? '').trim() || undefined,
      isActive: this.toBoolean(converted.isActive ?? record?.is_active, true),
      createdAt: String(converted.createdAt ?? record?.created_at ?? nowIso).trim() || nowIso,
      updatedAt: String(converted.updatedAt ?? record?.updated_at ?? nowIso).trim() || nowIso,
    };
  }

  /**
   * Main sync orchestration
   * Performs: Push local changes → Pull server changes → Update timestamp
   */
  async performFullSync(branchId: string): Promise<void> {
    if (!branchId) {
      console.warn('[Sync] No branch ID provided, skipping sync');
      return;
    }

    if (this.syncInProgress) {
      console.log('[Sync] Sync already in progress, skipping');
      return;
    }

    this.syncInProgress = true;
    this.syncState.is_syncing = true;

    try {
      console.log('[Sync] Starting full sync for branch:', branchId);
      this.syncState.last_synced_at = this.resolveLastSyncedAt(branchId);
      console.log('[Sync] Using sync timestamp:', this.syncState.last_synced_at);

      // Step 1: Push local changes to backend
      await this.pushChanges(branchId);

      // Step 2: Pull server changes from backend
      await this.pullChanges(branchId);

      // Step 3: Update sync timestamp
      this.syncState.last_synced_at = new Date().toISOString();
      if (typeof window !== 'undefined') {
        localStorage.setItem('last_synced_at', this.syncState.last_synced_at);
        localStorage.setItem(this.getBranchSyncStorageKey(branchId), this.syncState.last_synced_at);
      }

      console.log('[Sync] Full sync completed successfully at', this.syncState.last_synced_at);
    } catch (error) {
      console.error('[Sync] Full sync failed:', error);
      // Don't throw - allow app to continue working offline
    } finally {
      this.syncInProgress = false;
      this.syncState.is_syncing = false;
    }
  }

  /**
   * Step 1: Push local changes to backend
   * Collects all dirty records and sends them to /inventory/sync/push/
   * If backend is unreachable, dirty records remain marked for retry
   */
  private async pushChanges(branchId: string): Promise<void> {
    const changes = await this.collectLocalChanges(branchId);
    const backendBranchId = this.toBackendBranchId(branchId);

    if (changes.length === 0) {
      console.log('[Sync] No local changes to push');
      return;
    }

    console.log(`[Sync] Pushing ${changes.length} changes to backend`);

    try {
      // Separate changes by entity type
      const sessionChanges = changes.filter(c => c.entity_type === 'Session');
      const orderChanges = changes.filter(c => c.entity_type === 'Order');
      const taxChanges = changes.filter(c => c.entity_type === 'TaxRate');
      const inventoryChanges = changes.filter(c => c.entity_type !== 'TakeOrder' && c.entity_type !== 'Session' && c.entity_type !== 'Order' && c.entity_type !== 'TaxRate');
      const takeOrderChanges = changes.filter(c => c.entity_type === 'TakeOrder');

      // Push session changes to sessions sync endpoint
      if (sessionChanges.length > 0) {
        try {
          const result = await authFetch.fetch('/sessions/sync/push/', {
            method: 'POST',
            body: JSON.stringify({
              last_synced_at: this.syncState.last_synced_at,
              changes: sessionChanges,
              branch_id: backendBranchId
            })
          });

          if (result.results?.acknowledged && Array.isArray(result.results.acknowledged)) {
            console.log(`[Sync] ${result.results.acknowledged.length} session changes acknowledged`);
            for (const ack of result.results.acknowledged) {
              await this.markChangeAsSynced(ack.id);
            }
          }

          if (result.results?.errors && result.results.errors.length > 0) {
            console.error(`[Sync] ${result.results.errors.length} session sync errors:`, result.results.errors);
          }
        } catch (error) {
          console.error('[Sync] Session push failed:', error);
        }
      }

      // Push order changes to sessions sync endpoint (orders are part of sessions)
      let hasBlockingOrderSyncIssue = false;
      if (orderChanges.length > 0) {
        try {
          const result = await authFetch.fetch('/sessions/sync/push/', {
            method: 'POST',
            body: JSON.stringify({
              last_synced_at: this.syncState.last_synced_at,
              changes: orderChanges,
              branch_id: backendBranchId
            })
          });

          const acknowledged = Array.isArray(result?.results?.acknowledged)
            ? result.results.acknowledged
            : [];
          const errors = Array.isArray(result?.results?.errors)
            ? result.results.errors
            : [];

          if (result.results?.acknowledged && Array.isArray(result.results.acknowledged)) {
            console.log(`[Sync] ${result.results.acknowledged.length} order changes acknowledged`);
            for (const ack of result.results.acknowledged) {
              await this.applyOrderSyncAck(ack);
            }
          }

          if (result.results?.errors && result.results.errors.length > 0) {
            console.error(`[Sync] ${result.results.errors.length} order sync errors:`, result.results.errors);
          }

          // Prevent inventory/purchase pushes in the same cycle if any orders failed.
          // Order creation on backend performs stock movement; pushing inventory without
          // successful order acknowledgement can cause stock drift/out-of-order updates.
          if (errors.length > 0 || acknowledged.length < orderChanges.length) {
            hasBlockingOrderSyncIssue = true;
            console.warn('[Sync] Order sync incomplete; skipping inventory push for this cycle.');
          }
        } catch (error) {
          console.error('[Sync] Order push failed:', error);
          hasBlockingOrderSyncIssue = true;
        }
      }

      if (hasBlockingOrderSyncIssue) {
        return;
      }

      // Push inventory changes to inventory sync endpoint
      if (inventoryChanges.length > 0) {
        try {
          const result = await authFetch.fetch('/inventory/sync/push/', {
            method: 'POST',
            body: JSON.stringify({
              last_synced_at: this.syncState.last_synced_at,
              changes: inventoryChanges,
              branch_id: backendBranchId
            })
          });

          if (result.results?.acknowledged && Array.isArray(result.results.acknowledged)) {
            console.log(`[Sync] ${result.results.acknowledged.length} inventory changes acknowledged`);
            for (const ack of result.results.acknowledged) {
              await this.applyInventorySyncAck(ack);
            }
          }

          if (result.results?.conflicts && result.results.conflicts.length > 0) {
            console.warn(`[Sync] ${result.results.conflicts.length} inventory conflicts detected:`, result.results.conflicts);
            await this.handleConflicts(result.results.conflicts);
          }

          if (result.results?.errors && result.results.errors.length > 0) {
            console.error(`[Sync] ${result.results.errors.length} inventory sync errors:`, result.results.errors);
          }
        } catch (error) {
          console.error('[Sync] Inventory push failed:', error);
        }
      }

      // Push take order changes to take orders sync endpoint
      if (takeOrderChanges.length > 0) {
        try {
          const result = await authFetch.fetch('/orders/sync/push/', {
            method: 'POST',
            body: JSON.stringify({
              last_synced_at: this.syncState.last_synced_at,
              changes: takeOrderChanges,
              branch_id: backendBranchId
            })
          });

          if (result.results?.acknowledged && Array.isArray(result.results.acknowledged)) {
            console.log(`[Sync] ${result.results.acknowledged.length} take order changes acknowledged`);
            for (const ack of result.results.acknowledged) {
              await this.markChangeAsSynced(ack.id);
            }
          }

          if (result.results?.conflicts && result.results.conflicts.length > 0) {
            console.warn(`[Sync] ${result.results.conflicts.length} take order conflicts detected:`, result.results.conflicts);
            await this.handleConflicts(result.results.conflicts);
          }

          if (result.results?.errors && result.results.errors.length > 0) {
            console.error(`[Sync] ${result.results.errors.length} take order sync errors:`, result.results.errors);
          }
        } catch (error) {
          console.error('[Sync] Take order push failed:', error);
        }
      }

      // Push tax changes to business sync endpoint
      if (taxChanges.length > 0) {
        try {
          const businessId = this.resolveBusinessId();

          const result = await authFetch.fetch('/business/sync/push/', {
            method: 'POST',
            body: JSON.stringify({
              last_synced_at: this.syncState.last_synced_at,
              changes: taxChanges,
              business_id: businessId,
              branch_id: backendBranchId  // ← CRITICAL: Add branch_id for backend validation
            })
          });

          if (result.results?.acknowledged && Array.isArray(result.results.acknowledged)) {
            console.log(`[Sync] ${result.results.acknowledged.length} tax changes acknowledged`);
            for (const ack of result.results.acknowledged) {
              await this.markChangeAsSynced(ack.id);
            }
          }

          if (result.results?.errors && result.results.errors.length > 0) {
            console.error(`[Sync] ${result.results.errors.length} tax sync errors:`, result.results.errors);
          }
        } catch (error) {
          console.error('[Sync] Tax push failed:', error);
        }
      }

      // Push deferred MRA mapping writes (created during backend outages/import fallback)
      await this.pushPendingMraMappings(branchId);
    } catch (error: any) {
      // Check if it's a network/queued error
      if (error?.message?.includes('Network error - request queued') || 
          error?.message?.includes('Offline - request queued') ||
          error?.message?.includes('Failed to fetch') ||
          error?.message?.includes('Network') ||
          !navigator.onLine) {
        console.log('[Sync] Push request queued due to network error - will retry when online');
        // Dirty records remain marked with _dirty: true for retry
        return;
      }
      
      console.error('[Sync] Push failed:', error);
      // Don't throw - allow pull to continue
    }
  }

  private async pushPendingMraMappings(branchId: string): Promise<void> {
    const allMappings = await db.mraMappings.toArray();
    const pendingMappings = allMappings.filter(
      (mapping) =>
        mapping._dirty &&
        (mapping._operation === 'create' || mapping._operation === 'update') &&
        String(mapping.branchId || '') === String(branchId)
    );

    if (pendingMappings.length === 0) {
      return;
    }

    const backendBranchId = this.toBackendBranchId(branchId);
    const nowIso = new Date().toISOString();
    console.log(`[Sync] Retrying ${pendingMappings.length} deferred MRA mapping(s)`);

    for (const pendingMapping of pendingMappings) {
      try {
        let backendMappingId = String(pendingMapping.id || '');
        let backendMappingPayload: any | null = null;

        // Check if backend already has a mapping for this product to avoid duplicates.
        if (pendingMapping.inventoryItemId) {
          const existingResponse = await authFetch.fetch<any>(
            `/inventory/mra-mappings/?inventory_item=${encodeURIComponent(String(pendingMapping.inventoryItemId))}&branch_id=${encodeURIComponent(backendBranchId)}`
          );
          const existingMappings = Array.isArray(existingResponse)
            ? existingResponse
            : Array.isArray(existingResponse?.results)
              ? existingResponse.results
              : [];
          if (existingMappings.length > 0) {
            backendMappingPayload = existingMappings[0];
            backendMappingId = String(backendMappingPayload.id || backendMappingId);
          }
        }

        if (!backendMappingPayload && pendingMapping._operation === 'create') {
          backendMappingPayload = await authFetch.fetch<any>('/inventory/mra-mappings/', {
            method: 'POST',
            body: JSON.stringify({
              inventory_item_id: pendingMapping.inventoryItemId,
              mra_product_code: pendingMapping.mraProductCode,
              mra_product_name: pendingMapping.mraProductName,
              mra_tax_type: pendingMapping.mraTaxType,
              mra_tax_rate: pendingMapping.mraTaxRate,
              mra_unit_measure: pendingMapping.mraUnitMeasure,
              tax_calculation_method: pendingMapping.taxCalculationMethod,
            }),
            meta: {
              domain: 'inventory',
              entityType: 'MRAMapping',
              entityId: pendingMapping.inventoryItemId,
              metadata: { source: 'deferred-mapping-sync' },
            },
          });
          backendMappingId = String(backendMappingPayload?.id || backendMappingId);
        }

        let finalIsApproved = Boolean(
          backendMappingPayload?.is_approved ?? backendMappingPayload?.isApproved ?? pendingMapping.isApproved
        );
        let finalIsSynced = Boolean(
          backendMappingPayload?.mra_synced ?? backendMappingPayload?.mraSynced ?? pendingMapping.mraSynced
        );

        if (pendingMapping.isApproved && backendMappingId) {
          const approvedPayload = await authFetch.fetch<any>(`/inventory/mra-mappings/${backendMappingId}/approve/`, {
            method: 'POST',
            body: JSON.stringify({
              is_approved: true,
              mra_synced: pendingMapping.mraSynced,
            }),
            meta: {
              domain: 'inventory',
              entityType: 'MRAMapping',
              entityId: backendMappingId,
              metadata: { source: 'deferred-mapping-approve' },
            },
          });
          finalIsApproved = Boolean(approvedPayload?.is_approved ?? approvedPayload?.isApproved ?? true);
          finalIsSynced = Boolean(
            approvedPayload?.mra_synced ?? approvedPayload?.mraSynced ?? pendingMapping.mraSynced
          );
        }

        const mappedRecord = {
          ...pendingMapping,
          id: backendMappingId || pendingMapping.id,
          isApproved: finalIsApproved,
          mraSynced: finalIsSynced,
          lastSyncedAt: finalIsSynced ? nowIso : pendingMapping.lastSyncedAt,
          updatedAt: nowIso,
          _dirty: false,
          _operation: undefined,
          _synced_at: nowIso,
        };

        if (String(mappedRecord.id) !== String(pendingMapping.id)) {
          await db.mraMappings.delete(pendingMapping.id);
        }
        await db.mraMappings.put(mappedRecord);
      } catch (error) {
        console.warn(`[Sync] Deferred MRA mapping sync failed for ${pendingMapping.inventoryItemId}:`, error);
        // Keep dirty for next retry cycle.
      }
    }
  }

  /**
   * Step 2: Pull server changes from backend
   * Fetches all changes since last sync from inventory, take-order, session, and business sync endpoints
   */
  private async pullChanges(branchId: string): Promise<void> {
    const since = this.syncState.last_synced_at || this.DEFAULT_SYNC_TIMESTAMP;
    const backendBranchId = this.toBackendBranchId(branchId);

    console.log(`[Sync] Pulling changes since ${since}`);

    try {
      // Pull inventory changes
      const inventoryUrl = `/inventory/sync/pull/?since=${encodeURIComponent(since)}&branch_id=${backendBranchId}`;
      console.log('[Sync] Inventory URL:', inventoryUrl);
      const inventoryResult = await authFetch.fetch(inventoryUrl);
      console.log('[Sync] Inventory pull result:', inventoryResult);
      console.log('[Sync] Inventory changes:', inventoryResult?.changes);

      // Pull take order changes
      const ordersUrl = `/orders/sync/pull/?since=${encodeURIComponent(since)}&branch_id=${backendBranchId}`;
      console.log('[Sync] Orders URL:', ordersUrl);
      const ordersResult = await authFetch.fetch(ordersUrl);
      console.log('[Sync] Orders pull result:', ordersResult);
      console.log('[Sync] Orders changes:', ordersResult?.changes);

      // Pull session + POS order changes
      const sessionsUrl = `/sessions/sync/pull/?since=${encodeURIComponent(since)}&branch_id=${backendBranchId}`;
      console.log('[Sync] Sessions URL:', sessionsUrl);
      const sessionsResult = await authFetch.fetch(sessionsUrl);
      console.log('[Sync] Sessions pull result:', sessionsResult);
      console.log('[Sync] Sessions changes:', sessionsResult?.changes);

      // Pull invoice and expense changes
      const businessUrl = `/business/sync/pull/?since=${encodeURIComponent(since)}&branch_id=${backendBranchId}`;
      console.log('[Sync] Business URL:', businessUrl);
      const businessResult = await authFetch.fetch(businessUrl);
      console.log('[Sync] Business pull result:', businessResult);
      console.log('[Sync] Business changes:', businessResult?.changes);

      // Pull MRA mappings (CRITICAL for POS - ALWAYS fetch fresh, not timestamp-based)
      // MRA mappings must be up-to-date for offline sales compliance
      const mraMappingsUrl = `/inventory/mra-mappings/?branch_id=${backendBranchId}`;
      console.log('[Sync] MRA Mappings URL:', mraMappingsUrl);
      let mraMappingsResult: any = { mra_mappings: [] };
      try {
        const mraMappingsResponse = await authFetch.fetch(mraMappingsUrl);
        console.log('[Sync] MRA Mappings response:', mraMappingsResponse);
        
        // Handle both array and paginated responses
        if (Array.isArray(mraMappingsResponse)) {
          mraMappingsResult.mra_mappings = mraMappingsResponse;
        } else if (mraMappingsResponse?.results && Array.isArray(mraMappingsResponse.results)) {
          mraMappingsResult.mra_mappings = mraMappingsResponse.results;
        } else if (mraMappingsResponse?.mra_mappings && Array.isArray(mraMappingsResponse.mra_mappings)) {
          mraMappingsResult = mraMappingsResponse;
        }
        console.log('[Sync] MRA Mappings count:', mraMappingsResult.mra_mappings?.length || 0);
        
        // IMPORTANT: Do NOT clear mappings on every sync
        // Only update individual mappings to avoid flickering
        // Mappings are already cleared on first sync or when count changes
      } catch (error) {
        console.warn('[Sync] Failed to fetch MRA mappings:', error);
      }

      // Merge changes from all endpoints - properly extract the changes object
      const mergedChanges = {
        ...(inventoryResult?.changes || {}),
        ...(ordersResult?.changes || {}),
        ...(sessionsResult?.changes || {}),
        ...(businessResult?.changes || {}),
        mra_mappings: mraMappingsResult.mra_mappings || []
      };

      console.log('[Sync] Merged changes:', mergedChanges);
      console.log('[Sync] Merged changes keys:', Object.keys(mergedChanges));
      console.log('[Sync] Inventory items count:', mergedChanges.inventory_items?.length || 0);
      console.log('[Sync] POS orders count:', mergedChanges.orders?.length || 0);
      console.log('[Sync] Sessions count:', mergedChanges.sessions?.length || 0);
      console.log('[Sync] Take orders count:', mergedChanges.take_orders?.length || 0);
      console.log('[Sync] Suppliers count:', mergedChanges.suppliers?.length || 0);

      // Step 3: Apply server changes to local DB
      if (Object.keys(mergedChanges).length > 0) {
        await this.applyServerChanges(mergedChanges);
      } else {
        console.log('[Sync] No changes to apply');
      }
    } catch (error) {
      console.error('[Sync] Pull failed:', error);
      console.error('[Sync] Pull error details:', error instanceof Error ? error.message : String(error));
      // Don't throw - sync is best effort
    }
  }

  /**
   * Collect all local changes marked as dirty
   * Scans orders, sessions, and inventory tables for _dirty flag
   */
  private async collectLocalChanges(branchId: string): Promise<SyncChange[]> {
    const changes: SyncChange[] = [];

    try {
      // Collect from orders
      const orders = await db.orders
        .where('branchId')
        .equals(branchId)
        .toArray();

      console.log(`[Sync] Total orders in branch: ${orders.length}`);
      const dirtyOrders = orders.filter(o => o._dirty);
      console.log(`[Sync] Dirty orders: ${dirtyOrders.length}`);
      
      for (const order of dirtyOrders) {
        console.log(`[Sync] Order ${order.id}: _dirty=${order._dirty}, _operation=${order._operation}`);
        changes.push({
          id: order.id,
          entity_type: 'Order',
          op: order._operation || 'update',
          data: this.sanitizeForSync(order),
          timestamp: new Date().toISOString()
        });
      }

      console.log(`[Sync] Collected ${dirtyOrders.length} dirty orders`);

      // Collect from sessions
      const sessions = await db.sessions
        .where('branchId')
        .equals(branchId)
        .toArray();

      for (const session of sessions) {
        if (session._dirty) {
          changes.push({
            id: session.id,
            entity_type: 'Session',
            op: session._operation || 'update',
            data: this.sanitizeForSync(session),
            timestamp: new Date().toISOString()
          });
        }
      }

      console.log(`[Sync] Collected ${sessions.filter(s => s._dirty).length} dirty sessions`);

      // Collect from inventory items
      const inventoryItems = await db.inventory
        .where('branchId')
        .equals(branchId)
        .toArray();

      for (const item of inventoryItems) {
        if (item._dirty) {
          changes.push({
            id: item.id,
            entity_type: 'InventoryItem',
            op: item._operation || 'update',
            data: this.sanitizeForSync(item),
            timestamp: new Date().toISOString()
          });
        }
      }

      console.log(`[Sync] Collected ${inventoryItems.filter(i => i._dirty).length} dirty inventory items`);

      // Collect from purchase orders
      const purchaseOrders = await db.purchaseOrders
        .where('branchId')
        .equals(branchId)
        .toArray();

      for (const po of purchaseOrders) {
        if (po._dirty) {
          changes.push({
            id: po.id,
            entity_type: 'PurchaseOrder',
            op: po._operation || 'update',
            data: this.sanitizeForSync(po),
            timestamp: new Date().toISOString()
          });
        }
      }

      console.log(`[Sync] Collected ${purchaseOrders.filter(p => p._dirty).length} dirty purchase orders`);

      // Collect from stock transfers
      const stockTransfers = await db.stockTransfers
        .where('fromBranchId')
        .equals(branchId)
        .toArray();

      for (const transfer of stockTransfers) {
        if (transfer._dirty) {
          changes.push({
            id: transfer.id,
            entity_type: 'StockTransfer',
            op: transfer._operation || 'update',
            data: this.sanitizeForSync(transfer),
            timestamp: new Date().toISOString()
          });
        }
      }

      console.log(`[Sync] Collected ${stockTransfers.filter(t => t._dirty).length} dirty stock transfers`);

      // Collect from waste log
      const wasteRecords = await db.wasteLog
        .where({ branchId })
        .toArray();

      for (const waste of wasteRecords) {
        if (waste._dirty) {
          changes.push({
            id: waste.id,
            entity_type: 'WasteRecord',
            op: waste._operation || 'update',
            data: this.sanitizeForSync(waste),
            timestamp: new Date().toISOString()
          });
        }
      }

      console.log(`[Sync] Collected ${wasteRecords.filter(w => w._dirty).length} dirty waste records`);

      // Collect from suppliers
      const suppliers = await db.suppliers.toArray();

      for (const supplier of suppliers) {
        if (supplier._dirty) {
          changes.push({
            id: supplier.id,
            entity_type: 'Supplier',
            op: supplier._operation || 'update',
            data: this.sanitizeForSync(supplier),
            timestamp: new Date().toISOString()
          });
        }
      }

      console.log(`[Sync] Collected ${suppliers.filter(s => s._dirty).length} dirty suppliers`);

      // Collect from take orders
      const takeOrders = await db.takeOrders
        .where('branchId')
        .equals(branchId)
        .toArray();

      for (const takeOrder of takeOrders) {
        if (takeOrder._dirty) {
          changes.push({
            id: takeOrder.id,
            entity_type: 'TakeOrder',
            op: takeOrder._operation || 'update',
            data: this.sanitizeForSync(takeOrder),
            timestamp: new Date().toISOString()
          });
        }
      }

      console.log(`[Sync] Collected ${takeOrders.filter(t => t._dirty).length} dirty take orders`);

      // Collect from purchase history (batch records)
      const purchaseHistory = await db.purchaseHistory
        .where('branchId')
        .equals(branchId)
        .toArray();

      const dirtyPurchaseRecords = purchaseHistory.filter(r => r._dirty);
      console.log(`[Sync] Dirty purchase history records: ${dirtyPurchaseRecords.length}`);

      for (const record of dirtyPurchaseRecords) {
        // Skip numeric IDs - they are auto-increment IDs from IndexedDB, not UUIDs
        // The backend expects UUIDs for PurchaseOrderItem records
        if (typeof record.id === 'number' || /^\d+$/.test(String(record.id))) {
          console.log(`[Sync] Skipping purchase record with numeric ID: ${record.id} (not a UUID)`);
          // Mark as synced anyway to prevent re-attempting
          try {
            const purchaseId = parseInt(String(record.id), 10);
            if (!isNaN(purchaseId)) {
              await db.purchaseHistory.update(purchaseId, { _dirty: false, _operation: undefined });
            }
          } catch (err) {
            console.error(`[Sync] Error marking numeric purchase record as synced:`, err);
          }
          continue;
        }

        console.log(`[Sync] Purchase record ${record.id}: _dirty=${record._dirty}, _operation=${record._operation}, quantityRemaining=${record.quantityRemaining}`);
        changes.push({
          id: String(record.id),
          entity_type: 'PurchaseRecord',
          op: record._operation || 'update',
          data: this.sanitizeForSync(record),
          timestamp: new Date().toISOString()
        });
      }

      console.log(`[Sync] Collected ${dirtyPurchaseRecords.length} dirty purchase history records`);

      // Collect from taxes
      const taxes = await db.taxes.toArray();
      const dirtyTaxes = taxes.filter(t => t._dirty);

      console.log(`[Sync] Total taxes in DB: ${taxes.length}`);
      console.log(`[Sync] Dirty taxes: ${dirtyTaxes.length}`);
      if (taxes.length > 0) {
        console.log(`[Sync] All taxes:`, taxes);
      }
      if (dirtyTaxes.length > 0) {
        console.log(`[Sync] Dirty tax details:`, dirtyTaxes);
      }

      for (const tax of dirtyTaxes) {
        console.log(`[Sync] Processing dirty tax ${tax.id}: operation=${tax._operation}`);
        const sanitized = this.sanitizeForSync(tax);
        console.log(`[Sync] Sanitized tax data:`, sanitized);
        changes.push({
          id: tax.id,
          entity_type: 'TaxRate',
          op: tax._operation || 'update',
          data: sanitized,
          timestamp: new Date().toISOString()
        });
      }

      console.log(`[Sync] Collected ${dirtyTaxes.length} dirty tax rates`);
      console.log(`[Sync] Total changes collected so far: ${changes.length}`);

    } catch (error) {
      console.error('[Sync] Error collecting changes:', error);
    }

    return changes;
  }

  /**
   * Remove internal sync fields before sending to backend
   * Convert camelCase to snake_case for backend compatibility
   * Note: Large base64 images are kept for sync but may need compression in production
   */
  private sanitizeForSync(data: any): any {
    const { _dirty, _operation, _synced_at, ...clean } = data;
    
    // ✅ Fields that should NOT be converted to snake_case (backend expects camelCase)
    const keepCamelCase = ['supplierId', 'supplierName', 'totalItems', 'totalCost', 'paymentStatus', 'amountPaid', 'amountDue', 'createdBy', 'inventoryItemId', 'quantityOrdered', 'quantityReceived', 'quantityRemaining', 'costPerUnit', 'batchNumber', 'expiryDate', 'branchId', 'businessId', 'supplierTin', 'vatRegistered', 'itemType', 'stockUnits', 'unitType', 'reorderLevel', 'isVariablePrice', 'isProduced', 'isSoldInPortions', 'portionName', 'portionsPerUnit', 'isRecipeIngredient', 'onMenu', 'isRecipeIngredient'];
    
    // Convert camelCase keys to snake_case for backend
    const converted: any = {};
    for (const [key, value] of Object.entries(clean)) {
      // ✅ Keep camelCase for specific fields that backend expects
      if (keepCamelCase.includes(key)) {
        converted[key] = value;
      } else {
        // Convert camelCase to snake_case
        const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        
        // Handle empty strings for optional date fields - convert to null
        if ((snakeKey === 'effective_to' || snakeKey === 'effective_from') && value === '') {
          converted[snakeKey] = null;
        } else {
          converted[snakeKey] = value;
        }
      }
    }
    
    // For inventory items with images, compress if needed
    if (converted.image && typeof converted.image === 'string' && converted.image.length > 1000000) {
      console.warn('[Sync] Image is large (>1MB), consider compressing before sync');
      // In production, you might want to compress or upload separately
    }
    
    return converted;
  }

  /**
   * Normalize order field aliases so both snake_case and camelCase stay in sync locally.
   */
  private normalizeOrderRecord(record: any, base: any = {}): any {
    const normalized: any = {
      ...base,
      ...record,
    };

    const aliasPairs: Array<[string, string]> = [
      ['eisStatus', 'eis_status'],
      ['eisUuid', 'eis_uuid'],
      ['eisSubmittedAt', 'eis_submitted_at'],
      ['qrCodePayload', 'qr_code_payload'],
      ['digitalSignature', 'digital_signature'],
      ['netAmount', 'net_amount'],
      ['vatAmount', 'vat_amount'],
      ['grossAmount', 'gross_amount'],
      ['pumpName', 'pump_name'],
      ['customerName', 'customer_name'],
      ['customerPhone', 'customer_phone'],
      ['customerTin', 'customer_tin'],
      ['customerEmail', 'customer_email'],
      ['customerAddress', 'customer_address'],
      ['customerNotes', 'customer_notes'],
      ['buyerName', 'buyer_name'],
      ['buyerTin', 'buyer_tin'],
    ];

    const orderNumberRaw = normalized.orderNumber ?? normalized.order_number;
    const parsedOrderNumber = Number(orderNumberRaw);
    if (Number.isFinite(parsedOrderNumber) && parsedOrderNumber > 0) {
      normalized.orderNumber = parsedOrderNumber;
      normalized.order_number = parsedOrderNumber;
    }

    const branchRaw = normalized.branchId ?? normalized.branch_id ?? normalized.branch;
    if (branchRaw !== undefined && branchRaw !== null && String(branchRaw).trim().length > 0) {
      normalized.branchId = String(branchRaw);
    }

    const sessionRaw = normalized.sessionId ?? normalized.session_id ?? normalized.session;
    if (sessionRaw !== undefined && sessionRaw !== null && String(sessionRaw).trim().length > 0) {
      normalized.sessionId = String(sessionRaw);
    }

    const fiscalInvoiceNumber = String(
      normalized.fiscalInvoiceNumber ?? normalized.fiscal_invoice_number ?? ''
    ).trim();
    if (fiscalInvoiceNumber) {
      normalized.fiscalInvoiceNumber = fiscalInvoiceNumber;
      normalized.fiscal_invoice_number = fiscalInvoiceNumber;
    }

    const resolveAliasValue = (...candidates: Array<unknown>): unknown => {
      for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) {
          continue;
        }
        if (typeof candidate === 'string' && candidate.trim() === '') {
          continue;
        }
        return candidate;
      }
      return undefined;
    };

    for (const [camelKey, snakeKey] of aliasPairs) {
      const value = resolveAliasValue(normalized[camelKey], normalized[snakeKey]);
      if (value !== undefined) {
        normalized[camelKey] = value;
        normalized[snakeKey] = value;
      }
    }

    const resolveBuyerField = (...candidates: Array<unknown>): string | undefined => {
      for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) {
          continue;
        }
        const value = String(candidate).trim();
        if (value) {
          return value;
        }
      }
      return undefined;
    };

    const resolvedBuyerName = resolveBuyerField(
      normalized.customerName,
      normalized.customer_name,
      normalized.buyerName,
      normalized.buyer_name
    );
    if (resolvedBuyerName !== undefined) {
      normalized.customerName = resolvedBuyerName;
      normalized.customer_name = resolvedBuyerName;
    }

    const resolvedBuyerPhone = resolveBuyerField(
      normalized.customerPhone,
      normalized.customer_phone,
      normalized.buyerPhone,
      normalized.buyer_phone
    );
    if (resolvedBuyerPhone !== undefined) {
      normalized.customerPhone = resolvedBuyerPhone;
      normalized.customer_phone = resolvedBuyerPhone;
    }

    const resolvedBuyerTin = resolveBuyerField(
      normalized.customerTin,
      normalized.customer_tin,
      normalized.buyerTin,
      normalized.buyer_tin
    );
    if (resolvedBuyerTin !== undefined) {
      normalized.customerTin = resolvedBuyerTin;
      normalized.customer_tin = resolvedBuyerTin;
    }

    const resolvedBuyerEmail = resolveBuyerField(
      normalized.customerEmail,
      normalized.customer_email,
      normalized.buyerEmail,
      normalized.buyer_email
    );
    if (resolvedBuyerEmail !== undefined) {
      normalized.customerEmail = resolvedBuyerEmail;
      normalized.customer_email = resolvedBuyerEmail;
    }

    const resolvedBuyerAddress = resolveBuyerField(
      normalized.customerAddress,
      normalized.customer_address,
      normalized.buyerAddress,
      normalized.buyer_address
    );
    if (resolvedBuyerAddress !== undefined) {
      normalized.customerAddress = resolvedBuyerAddress;
      normalized.customer_address = resolvedBuyerAddress;
    }

    const resolvedBuyerNotes = resolveBuyerField(
      normalized.customerNotes,
      normalized.customer_notes,
      normalized.buyerNotes,
      normalized.buyer_notes
    );
    if (resolvedBuyerNotes !== undefined) {
      normalized.customerNotes = resolvedBuyerNotes;
      normalized.customer_notes = resolvedBuyerNotes;
    }

    if (normalized._operation === undefined) {
      delete normalized._operation;
    }

    return normalized;
  }

  /**
   * Apply backend order acknowledgement to local order row so fiscal metadata is available immediately.
   */
  private async applyOrderSyncAck(ack: any): Promise<void> {
    const id = String(ack?.id ?? '').trim();
    if (!id) {
      return;
    }

    try {
      const existingOrder = await db.orders.get(id);
      if (!existingOrder) {
        await this.markChangeAsSynced(id);
        return;
      }

      const normalizedAck = this.normalizeOrderRecord(ack);
      const updatePayload: any = {
        _dirty: false,
        _operation: undefined,
        _synced_at: normalizedAck.updated_at || normalizedAck.updatedAt || new Date().toISOString(),
      };

      const syncKeys = [
        'orderNumber',
        'order_number',
        'customerName',
        'customer_name',
        'customerPhone',
        'customer_phone',
        'customerTin',
        'customer_tin',
        'customerEmail',
        'customer_email',
        'customerAddress',
        'customer_address',
        'customerNotes',
        'customer_notes',
        'buyerName',
        'buyer_name',
        'buyerTin',
        'buyer_tin',
        'fiscalInvoiceNumber',
        'fiscal_invoice_number',
        'eisStatus',
        'eis_status',
        'eisUuid',
        'eis_uuid',
        'eisSubmittedAt',
        'eis_submitted_at',
        'qrCodePayload',
        'qr_code_payload',
        'digitalSignature',
        'digital_signature',
        'netAmount',
        'net_amount',
        'vatAmount',
        'vat_amount',
        'grossAmount',
        'gross_amount',
      ];

      for (const key of syncKeys) {
        if (normalizedAck[key] !== undefined) {
          updatePayload[key] = normalizedAck[key];
        }
      }

      await db.orders.update(id, updatePayload);

      const fiscalNumber = String(
        updatePayload.fiscalInvoiceNumber ?? updatePayload.fiscal_invoice_number ?? ''
      ).trim();
      if (fiscalNumber) {
        console.log(`[Sync] Marked order ${id} as synced with fiscal invoice ${fiscalNumber}`);
      } else {
        console.log(`[Sync] Marked order ${id} as synced`);
      }
    } catch (error) {
      console.error(`[Sync] Failed to apply order acknowledgement for ${id}:`, error);
      await this.markChangeAsSynced(id);
    }
  }

  /**
   * Apply backend inventory acknowledgement.
   * Handles server-side ID remapping (e.g. create resolved to an existing server row).
   */
  private async applyInventorySyncAck(ack: any): Promise<void> {
    const localId = String(ack?.id ?? '').trim();
    const serverId = String(ack?.server_id ?? ack?.serverId ?? '').trim();
    const fallbackId = localId || serverId;

    if (!fallbackId) {
      return;
    }

    const nowIso = new Date().toISOString();

    try {
      const localItem = localId ? await db.inventory.get(localId) : null;

      if (!localItem) {
        await this.markChangeAsSynced(serverId || localId);
        return;
      }

      if (!serverId || serverId === localId) {
        await db.inventory.update(localId, {
          _dirty: false,
          _operation: undefined,
          _synced_at: nowIso,
        });
        console.log(`[Sync] Marked inventory item ${localId} as synced`);
        return;
      }

      const existingServerItem = await db.inventory.get(serverId);
      const resolvedBranchId = String(
        localItem.branchId || existingServerItem?.branchId || ''
      ).trim() || String(localItem.branchId || existingServerItem?.branchId || '');

      const mergedItem: InventoryItem = {
        ...(existingServerItem || {}),
        ...localItem,
        id: serverId,
        branchId: resolvedBranchId,
        _dirty: false,
        _operation: undefined,
        _synced_at: nowIso,
      };

      await db.inventory.put(mergedItem);
      await db.inventory.delete(localId);

      console.log(
        `[Sync] Remapped local inventory item ${localId} to server id ${serverId} after acknowledgement`
      );
    } catch (error) {
      console.error(
        `[Sync] Failed to apply inventory acknowledgement for ${fallbackId}:`,
        error
      );
      await this.markChangeAsSynced(fallbackId);
    }
  }

  /**
   * Mark a change as synced in local DB
   * Clears _dirty flag and _operation after successful sync
   * For PurchaseRecord, we need to find by UUID and update the numeric ID
   */
  private async markChangeAsSynced(id: string): Promise<void> {
    try {
      // Try orders first
      const order = await db.orders.get(id);
      if (order) {
        await db.orders.update(id, { _dirty: false, _operation: undefined });
        console.log(`[Sync] Marked order ${id} as synced`);
        return;
      }
    } catch (error) {
      // Continue to next table
    }

    try {
      // Try sessions
      const session = await db.sessions.get(id);
      if (session) {
        await db.sessions.update(id, { _dirty: false, _operation: undefined });
        console.log(`[Sync] Marked session ${id} as synced`);
        return;
      }
    } catch (error) {
      // Continue to next table
    }

    try {
      // Try inventory items
      const item = await db.inventory.get(id);
      if (item) {
        if (item._operation === 'delete') {
          await db.inventory.delete(id);
          await db.mraMappings.where('inventoryItemId').equals(id).delete();
          console.log(`[Sync] Removed deleted inventory item ${id} and related local MRA mappings`);
        } else {
          await db.inventory.update(id, { _dirty: false, _operation: undefined });
          console.log(`[Sync] Marked inventory item ${id} as synced`);
        }
        return;
      }
    } catch (error) {
      // Continue to next table
    }

    try {
      // Try stock transfers
      const transfer = await db.stockTransfers.get(id);
      if (transfer) {
        await db.stockTransfers.update(id, { _dirty: false, _operation: undefined });
        console.log(`[Sync] Marked stock transfer ${id} as synced`);
        return;
      }
    } catch (error) {
      // Continue to next table
    }

    try {
      // Try waste records
      const waste = await db.wasteLog.get(id);
      if (waste) {
        await db.wasteLog.update(id, { _dirty: false, _operation: undefined });
        console.log(`[Sync] Marked waste record ${id} as synced`);
        return;
      }
    } catch (error) {
      // Continue to next table
    }

    try {
      // Try suppliers
      const supplier = await db.suppliers.get(id);
      if (supplier) {
        await db.suppliers.update(id, { _dirty: false, _operation: undefined });
        console.log(`[Sync] Marked supplier ${id} as synced`);
        return;
      }
    } catch (error) {
      // Continue to next table
    }

    try {
      // Try purchase orders
      const po = await db.purchaseOrders.get(id);
      if (po) {
        await db.purchaseOrders.update(id, { _dirty: false, _operation: undefined });
        console.log(`[Sync] Marked purchase order ${id} as synced`);
        return;
      }
    } catch (error) {
      // Continue to next table
    }

    try {
      // Try purchase history - search by UUID string id field
      // PurchaseRecord items are stored with UUID in the id field
      const allPurchases = await db.purchaseHistory.toArray();
      const purchase = allPurchases.find(p => String(p.id) === String(id));
      if (purchase) {
        // Update using the numeric primary key
        await db.purchaseHistory.update(purchase.id, { _dirty: false, _operation: undefined });
        console.log(`[Sync] Marked purchase history record ${id} as synced (numeric id: ${purchase.id})`);
        return;
      }
    } catch (error) {
      console.error(`[Sync] Error searching purchase history for ${id}:`, error);
    }

    try {
      // Try take orders
      const takeOrder = await db.takeOrders.get(id);
      if (takeOrder) {
        await db.takeOrders.update(id, { _dirty: false, _operation: undefined });
        console.log(`[Sync] Marked take order ${id} as synced`);
        return;
      }
    } catch (error) {
      // Continue to next table
    }

    try {
      // Try taxes
      const tax = await db.taxes.get(id);
      if (tax) {
        if (tax._operation === 'delete') {
          await db.taxes.delete(id);
          console.log(`[Sync] Removed deleted tax ${id}`);
        } else {
          await db.taxes.update(id, { _dirty: false, _operation: undefined });
          console.log(`[Sync] Marked tax ${id} as synced`);
        }
        return;
      }
    } catch (error) {
      console.error(`[Sync] Error marking ${id} as synced:`, error);
    }

    console.warn(`[Sync] Could not find record with id ${id} to mark as synced`);
  }

  /**
   * Apply server changes to local database
   * Merges server data with local data, clearing dirty flags
   */
  private async applyServerChanges(changes: any): Promise<void> {
    console.log('[Sync] Applying server changes to local DB');

    try {
      // Apply orders
      if (changes.orders && Array.isArray(changes.orders) && changes.orders.length > 0) {
        for (const order of changes.orders) {
          try {
            const convertedOrder = this.snakeToCamel(order);
            const orderId = String(convertedOrder.id ?? order.id ?? '').trim();
            if (!orderId) {
              console.warn('[Sync] Skipping order change without id:', order);
              continue;
            }

            const existingOrder = await db.orders.get(orderId);
            if (existingOrder?._dirty) {
              console.log(`[Sync] Skipping server overwrite for dirty order ${orderId}`);
              continue;
            }

            const normalizedOrder = this.normalizeOrderRecord(convertedOrder, existingOrder || {});

            await db.orders.put({
              ...normalizedOrder,
              id: orderId,
              _dirty: false,
              _operation: undefined,
              _synced_at: new Date().toISOString()
            });
          } catch (error) {
            console.error(`[Sync] Error applying order ${order.id}:`, error);
          }
        }
        console.log(`[Sync] Applied ${changes.orders.length} order changes`);
      }

      // Apply sessions
      if (changes.sessions && Array.isArray(changes.sessions) && changes.sessions.length > 0) {
        for (const session of changes.sessions) {
          try {
            const convertedSession = this.snakeToCamel(session);
            const sessionId = String(convertedSession.id ?? session.id ?? '').trim();
            if (!sessionId) {
              console.warn('[Sync] Skipping session change without id:', session);
              continue;
            }

            const existingSession = await db.sessions.get(sessionId);
            if (existingSession?._dirty) {
              console.log(`[Sync] Skipping server overwrite for dirty session ${sessionId}`);
              continue;
            }

            const mergedSession: any = {
              ...(existingSession || {}),
              ...convertedSession,
              id: sessionId,
            };

            const branchRaw = mergedSession.branchId ?? mergedSession.branch_id ?? mergedSession.branch;
            if (branchRaw !== undefined && branchRaw !== null && String(branchRaw).trim().length > 0) {
              mergedSession.branchId = String(branchRaw);
            }

            const userRaw = mergedSession.userId ?? mergedSession.user_id ?? mergedSession.user;
            if (userRaw !== undefined && userRaw !== null && String(userRaw).trim().length > 0) {
              mergedSession.userId = String(userRaw);
            }

            const startedAtRaw = mergedSession.startedAt ?? mergedSession.started_at;
            if (startedAtRaw) {
              mergedSession.startedAt = startedAtRaw;
            }

            const closedAtRaw = mergedSession.closedAt ?? mergedSession.closed_at;
            if (closedAtRaw) {
              mergedSession.closedAt = closedAtRaw;
            }

            await db.sessions.put({
              ...mergedSession,
              _dirty: false,
              _operation: undefined,
              _synced_at: new Date().toISOString()
            });
          } catch (error) {
            console.error(`[Sync] Error applying session ${session.id}:`, error);
          }
        }
        console.log(`[Sync] Applied ${changes.sessions.length} session changes`);
      }

      // Apply inventory items - MERGE with existing data, don't replace
      if (changes.inventory_items && Array.isArray(changes.inventory_items) && changes.inventory_items.length > 0) {
        for (const item of changes.inventory_items) {
          try {
            // Convert snake_case to camelCase
            const convertedItem = this.snakeToCamel(item);
            
            // Get existing item to preserve local fields
            const existingItem = await db.inventory.get(convertedItem.id);
            if (existingItem) {
              // Never overwrite local unsynced stock edits with server values.
              // This prevents "deduct then revert" when local push is delayed/fails.
              if (existingItem._dirty) {
                console.log(`[Sync] Skipping server overwrite for dirty inventory item ${convertedItem.id}`);
                continue;
              }

              // Merge: keep local data, update with server data
              // IMPORTANT: Preserve supplier field from local data
              await db.inventory.put({
                ...existingItem,
                ...convertedItem,
                branchId: existingItem.branchId, // Preserve existing branchId
                supplier: existingItem.supplier, // ✅ PRESERVE supplier relationship
                _dirty: false,
                _synced_at: new Date().toISOString()
              });
              console.log(`[Sync] Updated inventory item ${convertedItem.id} with server changes, preserved supplier: ${existingItem.supplier}`);
            } else {
              // New item from server - need to get branchId from somewhere
              // This shouldn't happen in normal flow, but log it
              console.warn(`[Sync] New inventory item ${convertedItem.id} from server without existing record - branchId may be missing`);
              await db.inventory.put({
                ...convertedItem,
                _dirty: false,
                _synced_at: new Date().toISOString()
              });
              console.log(`[Sync] Added new inventory item ${convertedItem.id} from server`);
            }
          } catch (error) {
            console.error(`[Sync] Error applying inventory item ${item.id}:`, error);
          }
        }
        console.log(`[Sync] Applied ${changes.inventory_items.length} inventory item changes`);
      }

      // Apply suppliers
      if (changes.suppliers && Array.isArray(changes.suppliers) && changes.suppliers.length > 0) {
        console.log('[Sync] Processing suppliers:', changes.suppliers);
        
        const businessId = this.resolveBusinessId();
        
        for (const supplier of changes.suppliers) {
          try {
            console.log(`[Sync] Storing supplier ${supplier.id}:`, supplier);
            await db.suppliers.put({
              ...supplier,
              businessId: String(supplier.businessId || businessId || '').trim() || undefined,
              _dirty: false,
              _synced_at: new Date().toISOString()
            });
            console.log(`[Sync] Successfully stored supplier ${supplier.id} with businessId: ${businessId}`);
          } catch (error) {
            console.error(`[Sync] Error applying supplier ${supplier.id}:`, error);
          }
        }
        console.log(`[Sync] Applied ${changes.suppliers.length} supplier changes`);
      } else {
        console.log('[Sync] No suppliers to apply');
      }

      // Apply take orders
      if (changes.take_orders && Array.isArray(changes.take_orders) && changes.take_orders.length > 0) {
        for (const takeOrder of changes.take_orders) {
          try {
            // Get existing take order to preserve local fields
            const existingTakeOrder = await db.takeOrders.get(takeOrder.id);
            if (existingTakeOrder) {
              // Merge: keep local data, update with server data
              await db.takeOrders.put({
                ...existingTakeOrder,
                ...takeOrder,
                _dirty: false,
              });
              console.log(`[Sync] Updated take order ${takeOrder.id} with server changes`);
            } else {
              // New take order from server
              await db.takeOrders.put({
                ...takeOrder,
                _dirty: false,
              });
              console.log(`[Sync] Added new take order ${takeOrder.id} from server`);
            }
          } catch (error) {
            console.error(`[Sync] Error applying take order ${takeOrder.id}:`, error);
          }
        }
        console.log(`[Sync] Applied ${changes.take_orders.length} take order changes`);
      }

      // Apply invoices
      if (changes.invoices && Array.isArray(changes.invoices) && changes.invoices.length > 0) {
        for (const invoice of changes.invoices) {
          try {
            // Get existing invoice to preserve local fields
            const existingInvoice = await db.invoices.get(invoice.id);
            if (existingInvoice) {
              // Merge: keep local data, update with server data
              await db.invoices.put({
                ...existingInvoice,
                ...invoice,
                _dirty: false,
                _synced_at: new Date().toISOString()
              });
              console.log(`[Sync] Updated invoice ${invoice.id} with server changes`);
            } else {
              // New invoice from server
              await db.invoices.put({
                ...invoice,
                _dirty: false,
                _synced_at: new Date().toISOString()
              });
              console.log(`[Sync] Added new invoice ${invoice.id} from server`);
            }
          } catch (error) {
            console.error(`[Sync] Error applying invoice ${invoice.id}:`, error);
          }
        }
        console.log(`[Sync] Applied ${changes.invoices.length} invoice changes`);
      }

      // Apply tax rates
      if (changes.tax_rates && Array.isArray(changes.tax_rates) && changes.tax_rates.length > 0) {
        const fallbackBusinessId = this.resolveBusinessId();

        for (const taxRate of changes.tax_rates) {
          try {
            const normalizedTax = this.normalizeTaxRecord(taxRate, fallbackBusinessId);
            if (!normalizedTax) {
              console.warn('[Sync] Skipping tax rate without id:', taxRate);
              continue;
            }

            const operation = String(taxRate?._operation ?? taxRate?.operation ?? '').trim().toLowerCase();
            const isDeleted =
              operation === 'delete' ||
              this.toBoolean(taxRate?.is_deleted ?? taxRate?.isDeleted ?? taxRate?.deleted, false);

            if (isDeleted) {
              await db.taxes.delete(normalizedTax.id);
              console.log(`[Sync] Removed tax rate ${normalizedTax.id} from server delete`);
              continue;
            }

            const existingTax = await db.taxes.get(normalizedTax.id);
            if (existingTax?._dirty) {
              console.log(`[Sync] Skipping server overwrite for dirty tax rate ${normalizedTax.id}`);
              continue;
            }

            await db.taxes.put({
              ...(existingTax || {}),
              ...normalizedTax,
              _dirty: false,
              _operation: undefined,
              _synced_at: new Date().toISOString()
            });

            console.log(`[Sync] Upserted tax rate ${normalizedTax.id} from server`);
          } catch (error) {
            console.error(`[Sync] Error applying tax rate ${taxRate.id}:`, error);
          }
        }
        console.log(`[Sync] Applied ${changes.tax_rates.length} tax rate changes`);
      }

      // Apply MRA mappings (CRITICAL for POS)
      if (changes.mra_mappings && Array.isArray(changes.mra_mappings) && changes.mra_mappings.length > 0) {
        console.log('[Sync] Processing MRA mappings:', changes.mra_mappings.length);
        
        for (const mapping of changes.mra_mappings) {
          try {
            // Convert snake_case from backend to camelCase for frontend
            const convertedMapping = this.snakeToCamel(mapping);

            const inventoryItemId = String(
              convertedMapping.inventoryItemId ??
              convertedMapping.inventoryItem ??
              mapping.inventory_item ??
              ''
            ).trim();

            if (!inventoryItemId) {
              console.warn('[Sync] Skipping MRA mapping without inventory item id:', mapping);
              continue;
            }

            const mappingToStore = {
              ...convertedMapping,
              inventoryItemId,
              branchId: String(
                convertedMapping.branchId ??
                convertedMapping.branch ??
                mapping.branch_id ??
                mapping.branch ??
                ''
              ).trim() || undefined,
              _dirty: false,
              _synced_at: new Date().toISOString()
            };
            
            // Remove the incorrect field name
            delete mappingToStore.inventoryItem;
            
            console.log(`[Sync] Storing MRA mapping for product ${mappingToStore.inventoryItemId}:`, mappingToStore);

            // Remove any local placeholder mappings for the same product to avoid duplicates.
            const existingMappingsForItem = await db.mraMappings
              .where('inventoryItemId')
              .equals(mappingToStore.inventoryItemId)
              .toArray();
            for (const existingMapping of existingMappingsForItem) {
              if (String(existingMapping.id) !== String(mappingToStore.id)) {
                await db.mraMappings.delete(existingMapping.id);
              }
            }
            
            await db.mraMappings.put(mappingToStore);
            console.log(`[Sync] Successfully stored MRA mapping ${mapping.id} for product ${mapping.inventory_item} with inventoryItemId: ${mappingToStore.inventoryItemId}`);
          } catch (error) {
            console.error(`[Sync] Error applying MRA mapping ${mapping.id}:`, error);
          }
        }
        console.log(`[Sync] Applied ${changes.mra_mappings.length} MRA mapping changes`);
      } else {
        console.log('[Sync] No MRA mappings to apply');
      }
    } catch (error) {
      console.error('[Sync] Error applying changes:', error);
    }
  }

  /**
   * Handle sync conflicts
   * Current strategy: Server wins
   * TODO: Implement user intervention or more sophisticated conflict resolution
   */
  private async handleConflicts(conflicts: any[]): Promise<void> {
    for (const conflict of conflicts) {
      console.warn(`[Sync] Conflict for ${conflict.id}: ${conflict.reason}`);
      // Strategy: Server wins (simple approach)
      // In production, you might want user intervention or more sophisticated logic
    }
  }

  /**
   * Fetch all inventory items from backend for a branch
   * This is separate from the sync pull and fetches all items regardless of sync timestamp
   */
  async fetchAllInventoryFromBackend(branchId: string): Promise<void> {
    try {
      console.log('[Sync] Fetching all inventory from backend for branch:', branchId);
      const backendBranchId = this.toBackendBranchId(branchId);
      
      const url = `/inventory/items/?branch_id=${backendBranchId}`;
      console.log('[Sync] Fetch URL:', url);
      
      const result = await authFetch.fetch(url);
      console.log('[Sync] Backend inventory response:', result);
      console.log('[Sync] Response type:', typeof result);
      console.log('[Sync] Response keys:', Object.keys(result));
      
      // Handle both paginated and direct response formats
      let items = [];
      if (result.results && Array.isArray(result.results)) {
        items = result.results;
        console.log(`[Sync] Found ${items.length} items in results array`);
      } else if (Array.isArray(result)) {
        items = result;
        console.log(`[Sync] Found ${items.length} items in direct array`);
      } else {
        console.warn('[Sync] Unexpected response format:', result);
        return;
      }
      
      if (items.length > 0) {
        console.log(`[Sync] Received ${items.length} inventory items from backend`);
        console.log('[Sync] Sample item:', items[0]);
        
        // Apply all inventory items to local DB
        for (const item of items) {
          try {
            // Convert snake_case from backend to camelCase for frontend
            const convertedItem = this.snakeToCamel(item);
            const existingItem = await db.inventory.get(convertedItem.id);
            if (existingItem?._dirty) {
              console.log(`[Sync] Skipping fetch overwrite for dirty inventory item ${convertedItem.id}`);
              continue;
            }
            
            const itemToStore = {
              ...(existingItem || {}),
              ...convertedItem,
              branchId: branchId, // Ensure branchId is set
              _dirty: false,
              _synced_at: new Date().toISOString()
            };
            console.log(`[Sync] Storing inventory item:`, itemToStore);
            await db.inventory.put(itemToStore);
            console.log(`[Sync] Stored inventory item ${item.id} from backend`);
          } catch (error) {
            console.error(`[Sync] Error storing inventory item ${item.id}:`, error);
          }
        }
        console.log(`[Sync] Successfully stored ${items.length} inventory items from backend`);
      } else {
        console.log('[Sync] No inventory items received from backend');
      }
    } catch (error) {
      console.error('[Sync] Failed to fetch inventory from backend:', error);
      console.error('[Sync] Error details:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Fetch all take orders from backend for a branch
   * This is separate from the sync pull and fetches all orders regardless of sync timestamp
   */
  async fetchAllTakeOrdersFromBackend(branchId: string): Promise<void> {
    try {
      console.log('[Sync] Fetching all take orders from backend for branch:', branchId);
      const backendBranchId = this.toBackendBranchId(branchId);
      
      const url = `/orders/take-orders/?branch_id=${backendBranchId}`;
      console.log('[Sync] Fetch URL:', url);
      
      const result = await authFetch.fetch(url);
      console.log('[Sync] Backend take orders response:', result);
      console.log('[Sync] Response type:', typeof result);
      console.log('[Sync] Response keys:', Object.keys(result));
      
      // Handle both paginated and direct response formats
      let orders = [];
      if (result.results && Array.isArray(result.results)) {
        orders = result.results;
        console.log(`[Sync] Found ${orders.length} orders in results array`);
      } else if (Array.isArray(result)) {
        orders = result;
        console.log(`[Sync] Found ${orders.length} orders in direct array`);
      } else {
        console.warn('[Sync] Unexpected response format:', result);
        return;
      }
      
      if (orders.length > 0) {
        console.log(`[Sync] Received ${orders.length} take orders from backend`);
        console.log('[Sync] Sample order:', orders[0]);
        
        // Apply all take orders to local DB
        for (const takeOrder of orders) {
          try {
            // Convert snake_case from backend to camelCase for frontend
            const convertedOrder = this.snakeToCamel(takeOrder);
            
            const orderToStore = {
              ...convertedOrder,
              branchId: branchId, // Ensure branchId is set
              _dirty: false,
              _synced_at: new Date().toISOString()
            };
            console.log(`[Sync] Storing take order:`, orderToStore);
            await db.takeOrders.put(orderToStore);
            console.log(`[Sync] Stored take order ${takeOrder.id} from backend`);
          } catch (error) {
            console.error(`[Sync] Error storing take order ${takeOrder.id}:`, error);
          }
        }
        console.log(`[Sync] Successfully stored ${orders.length} take orders from backend`);
      } else {
        console.log('[Sync] No take orders received from backend');
      }
    } catch (error) {
      console.error('[Sync] Failed to fetch take orders from backend:', error);
      console.error('[Sync] Error details:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Setup connectivity listeners for online/offline events
   * Automatically triggers sync when connection is restored
   */
  setupConnectivityListener(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('online', () => {
      console.log('[Sync] Back online, triggering sync');
      const branchId = localStorage.getItem('handypos-active-branch');
      if (branchId) {
        this.performFullSync(branchId).catch(err => 
          console.error('[Sync] Auto-sync failed:', err)
        );
        void this.notifyEisOnlineStatus(true, branchId);
      }
    });

    window.addEventListener('offline', () => {
      console.log('[Sync] Offline mode activated');
      const branchId = localStorage.getItem('handypos-active-branch');
      if (branchId) {
        void this.notifyEisOnlineStatus(false, branchId);
      }
    });

    // Start periodic retry for existing dirty data
    this.startRetryInterval();
  }

  /**
   * Start periodic retry interval for dirty records
   * Retries every 30 seconds if online and there are dirty records
   */
  private startRetryInterval(): void {
    if (typeof window === 'undefined') return;

    this.retryIntervalId = setInterval(async () => {
      if (!navigator.onLine) return;

      try {
        const branchId = localStorage.getItem('handypos-active-branch');
        if (!branchId) return;

        // Check if there are any dirty records
        const dirtyCount = await this.countDirtyRecords(branchId);
        if (dirtyCount > 0) {
          console.log(`[Sync] Found ${dirtyCount} dirty records, triggering retry sync`);
          await this.performFullSync(branchId);
        }
      } catch (error) {
        console.error('[Sync] Error in retry interval:', error);
      }
    }, this.RETRY_INTERVAL);
  }

  /**
   * Stop retry interval
   */
  private stopRetryInterval(): void {
    if (this.retryIntervalId) {
      clearInterval(this.retryIntervalId);
      this.retryIntervalId = null;
    }
  }

  /**
   * Count total dirty records across all tables
   */
  private async countDirtyRecords(branchId: string): Promise<number> {
    try {
      // Use filter() instead of where().equals() for boolean fields as IndexedDB doesn't support boolean key ranges
      const dirtyOrders = (await db.orders.toArray()).filter(r => r._dirty).length;
      const dirtySessions = (await db.sessions.toArray()).filter(r => r._dirty).length;
      const dirtyInventory = (await db.inventory.toArray()).filter(r => r._dirty).length;
      const dirtyPurchaseOrders = (await db.purchaseOrders.toArray()).filter(r => r._dirty).length;
      const dirtyStockTransfers = (await db.stockTransfers.toArray()).filter(r => r._dirty).length;
      const dirtyWasteRecords = (await db.wasteLog.toArray()).filter(r => r._dirty).length;
      const dirtyPurchaseHistory = (await db.purchaseHistory.toArray()).filter(r => r._dirty).length;
      const dirtySuppliers = (await db.suppliers.toArray()).filter(r => r._dirty).length;
      const dirtyTakeOrders = (await db.takeOrders.toArray()).filter(r => r._dirty).length;
      const dirtyTaxes = (await db.taxes.toArray()).filter(r => r._dirty).length;

      const total = dirtyOrders + dirtySessions + dirtyInventory + dirtyPurchaseOrders + dirtyStockTransfers + dirtyWasteRecords + dirtyPurchaseHistory + dirtySuppliers + dirtyTakeOrders + dirtyTaxes;
      
      if (total > 0) {
        console.log(`[Sync] Dirty records count: Orders=${dirtyOrders}, Sessions=${dirtySessions}, Inventory=${dirtyInventory}, Taxes=${dirtyTaxes}, Total=${total}`);
      }
      
      return total;
    } catch (error) {
      console.error('[Sync] Error counting dirty records:', error);
      return 0;
    }
  }

  /**
   * Mark an entity as dirty (needs sync)
   * Called when creating, updating, or deleting records
   */
  async markAsDirty(entityType: 'Order' | 'Session' | 'InventoryItem' | 'PurchaseOrder' | 'StockTransfer' | 'WasteRecord' | 'PurchaseRecord', id: string, operation: 'create' | 'update' | 'delete' = 'update'): Promise<void> {
    try {
      if (entityType === 'Order') {
        await db.orders.update(id, { _dirty: true, _operation: operation });
        console.log(`[Sync] Marked order ${id} as dirty (${operation})`);
      } else if (entityType === 'Session') {
        await db.sessions.update(id, { _dirty: true, _operation: operation });
        console.log(`[Sync] Marked session ${id} as dirty (${operation})`);
      } else if (entityType === 'InventoryItem') {
        await db.inventory.update(id, { _dirty: true, _operation: operation });
        console.log(`[Sync] Marked inventory item ${id} as dirty (${operation})`);
      } else if (entityType === 'PurchaseOrder') {
        await db.purchaseOrders.update(id, { _dirty: true, _operation: operation });
        console.log(`[Sync] Marked purchase order ${id} as dirty (${operation})`);
      } else if (entityType === 'StockTransfer') {
        await db.stockTransfers.update(id, { _dirty: true, _operation: operation });
        console.log(`[Sync] Marked stock transfer ${id} as dirty (${operation})`);
      } else if (entityType === 'WasteRecord') {
        await db.wasteLog.update(id, { _dirty: true, _operation: operation });
        console.log(`[Sync] Marked waste record ${id} as dirty (${operation})`);
      } else if (entityType === 'PurchaseRecord') {
        const allPurchases = await db.purchaseHistory.toArray();
        const purchase = allPurchases.find(p => String(p.id) === String(id));
        if (purchase) {
          await db.purchaseHistory.update(purchase.id as any, { _dirty: true, _operation: operation });
          console.log(`[Sync] Marked purchase record ${id} as dirty (${operation})`);
        } else {
          console.warn(`[Sync] Could not find purchase record ${id} to mark as dirty`);
        }
      }
    } catch (error) {
      console.error(`[Sync] Error marking ${entityType} ${id} as dirty:`, error);
    }
  }

  /**
   * Get current sync state
   */
  getSyncState(): SyncState {
    return { ...this.syncState };
  }

  /**
   * Check if sync is currently in progress
   */
  isSyncing(): boolean {
    return this.syncState.is_syncing;
  }

  /**
   * Get last sync timestamp
   */
  getLastSyncedAt(): string | null {
    return this.syncState.last_synced_at;
  }
}

export const syncService = new SyncService();
