'use client';

import { db, type Business } from '@/lib/db';
import { safeLocalStorageGetItem } from '@/lib/safe-local-storage';

const LOCAL_STORAGE_KEYS = {
  AUTH_BUSINESS: 'handy-pos-business',
  BUSINESS_SETTINGS: 'handypos-business-settings',
  BUSINESS_ID: 'handypos-business-id',
  AUTH_USER: 'handy-pos-user',
};

function parseStoredJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeBusinessId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function normalizeTin(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function getStoredBusinessTin(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const settings = parseStoredJson<{ tin?: unknown; tax_pin?: unknown; taxPin?: unknown }>(
    safeLocalStorageGetItem(LOCAL_STORAGE_KEYS.BUSINESS_SETTINGS)
  );
  return (
    normalizeTin(settings?.tin) ||
    normalizeTin(settings?.tax_pin) ||
    normalizeTin(settings?.taxPin)
  );
}

export function resolveOfflineBusinessId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const directId = normalizeBusinessId(safeLocalStorageGetItem(LOCAL_STORAGE_KEYS.BUSINESS_ID));
  if (directId) {
    return directId;
  }

  const authBusiness = parseStoredJson<{ id?: string | number }>(
    safeLocalStorageGetItem(LOCAL_STORAGE_KEYS.AUTH_BUSINESS)
  );
  const authBusinessId = normalizeBusinessId(authBusiness?.id);
  if (authBusinessId) {
    return authBusinessId;
  }

  const businessSettings = parseStoredJson<{ businessId?: string | number }>(
    safeLocalStorageGetItem(LOCAL_STORAGE_KEYS.BUSINESS_SETTINGS)
  );
  const settingsBusinessId = normalizeBusinessId(businessSettings?.businessId);
  if (settingsBusinessId) {
    return settingsBusinessId;
  }

  const authUser = parseStoredJson<{ businessId?: string | number }>(
    safeLocalStorageGetItem(LOCAL_STORAGE_KEYS.AUTH_USER)
  );
  const authUserBusinessId = normalizeBusinessId(authUser?.businessId);
  if (authUserBusinessId) {
    return authUserBusinessId;
  }

  return null;
}

export async function getOfflineBusinessProfile(): Promise<Business | null> {
  const storedTin = getStoredBusinessTin();
  const businessId = resolveOfflineBusinessId();
  if (businessId) {
    const business = await db.business.get(businessId);
    if (business) {
      if (!normalizeTin((business as any).tin) && storedTin) {
        const mergedBusiness = { ...business, tin: storedTin };
        // Best-effort write-through so later reads use normalized cached data.
        void db.business.put(mergedBusiness as Business);
        return mergedBusiness as Business;
      }
      return business;
    }
  }

  const legacyBusiness = await db.business.get('main-business');
  if (legacyBusiness) {
    if (!normalizeTin((legacyBusiness as any).tin) && storedTin) {
      const mergedBusiness = { ...legacyBusiness, tin: storedTin };
      void db.business.put(mergedBusiness as Business);
      return mergedBusiness as Business;
    }
    return legacyBusiness;
  }

  const anyBusiness = await db.business.toCollection().first();
  if (anyBusiness && !normalizeTin((anyBusiness as any).tin) && storedTin) {
    const mergedBusiness = { ...anyBusiness, tin: storedTin };
    void db.business.put(mergedBusiness as Business);
    return mergedBusiness as Business;
  }
  return anyBusiness || null;
}
