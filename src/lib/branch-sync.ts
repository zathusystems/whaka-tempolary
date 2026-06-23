'use client';

import { authFetch } from '@/lib/auth-fetch';
import { isWarehouseBranchId, WAREHOUSE_BRANCH_ID } from '@/lib/branch-context';
import { syncSessionSnapshotToDesktopStore } from '@/lib/desktop-session-store';

const LOCAL_STORAGE_KEYS = {
  BRANCHES: 'handypos-branches',
  ACTIVE_BRANCH: 'handypos-active-branch',
  CURRENT_BRANCH: 'handypos-current-branch-id',
} as const;

export type StoredBranch = {
  id: string;
  name: string;
  address: string;
  backendId?: string;
  mraBranchCode?: string;
  mra_branch_code?: string;
  mraSiteId?: string;
  mra_site_id?: string;
  mraSiteName?: string;
  mra_site_name?: string;
  mraTerminalId?: string;
  mra_terminal_id?: string;
  mraTerminalPosition?: number | null;
  mra_terminal_position?: number | null;
  isEisWarehouse?: boolean;
  is_eis_warehouse?: boolean;
};

const toTrimmedString = (value: unknown): string => String(value ?? '').trim();

const getBranchIdCandidates = (value: unknown): string[] => {
  const normalized = toTrimmedString(value);
  if (!normalized) return [];
  if (isWarehouseBranchId(normalized)) return [WAREHOUSE_BRANCH_ID];

  const candidates = new Set<string>([normalized]);
  const numericMatch = normalized.match(/\d+/)?.[0];

  if (numericMatch) {
    candidates.add(numericMatch);
    candidates.add(`BRN-${numericMatch}`);
  }

  return Array.from(candidates);
};

const matchesBranchId = (branchId: string, value: unknown): boolean => {
  const branchCandidates = new Set(getBranchIdCandidates(branchId));
  return getBranchIdCandidates(value).some((candidate) => branchCandidates.has(candidate));
};

const normalizeStoredBranch = (branch: any): StoredBranch | null => {
  const id = toTrimmedString(branch?.id ?? branch?.backendId);
  if (!id) {
    return null;
  }

  const explicitBackendId = toTrimmedString(
    branch?.backendId ?? branch?.backend_id ?? branch?.pk
  );
  const brnMatch = /^BRN-(\d+)$/i.exec(id);
  const backendId = explicitBackendId || (/^\d+$/.test(id) ? id : brnMatch?.[1] || '');

  return {
    id,
    backendId: backendId || undefined,
    name: toTrimmedString(branch?.name) || 'Branch',
    address: toTrimmedString(branch?.address),
    mraBranchCode: toTrimmedString(branch?.mraBranchCode ?? branch?.mra_branch_code),
    mra_branch_code: toTrimmedString(branch?.mra_branch_code ?? branch?.mraBranchCode),
    mraSiteId: toTrimmedString(branch?.mraSiteId ?? branch?.mra_site_id),
    mra_site_id: toTrimmedString(branch?.mra_site_id ?? branch?.mraSiteId),
    mraSiteName: toTrimmedString(branch?.mraSiteName ?? branch?.mra_site_name),
    mra_site_name: toTrimmedString(branch?.mra_site_name ?? branch?.mraSiteName),
    mraTerminalId: toTrimmedString(branch?.mraTerminalId ?? branch?.mra_terminal_id),
    mra_terminal_id: toTrimmedString(branch?.mra_terminal_id ?? branch?.mraTerminalId),
    mraTerminalPosition: branch?.mraTerminalPosition ?? branch?.mra_terminal_position ?? null,
    mra_terminal_position: branch?.mra_terminal_position ?? branch?.mraTerminalPosition ?? null,
    isEisWarehouse: Boolean(branch?.isEisWarehouse ?? branch?.is_eis_warehouse ?? false),
    is_eis_warehouse: Boolean(branch?.is_eis_warehouse ?? branch?.isEisWarehouse ?? false),
  };
};

const extractBranchesFromBusinessResponse = (response: any): any[] => {
  if (Array.isArray(response?.branches)) {
    return response.branches;
  }
  return [];
};

const extractBranchList = (response: any): any[] => {
  if (Array.isArray(response)) {
    return response;
  }
  if (Array.isArray(response?.results)) {
    return response.results;
  }
  if (Array.isArray(response?.data)) {
    return response.data;
  }
  return [];
};

const chooseActiveBranchId = (branches: StoredBranch[], preferredBranchId?: string | null): string | null => {
  const candidates = [
    preferredBranchId,
    localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH),
    localStorage.getItem(LOCAL_STORAGE_KEYS.CURRENT_BRANCH),
  ];

  for (const candidate of candidates) {
    if (isWarehouseBranchId(candidate)) {
      return WAREHOUSE_BRANCH_ID;
    }

    const matchedBranch = branches.find((branch) => matchesBranchId(branch.id, candidate));
    if (matchedBranch) {
      return matchedBranch.id;
    }
  }

  return branches[0]?.id || null;
};

export const persistBranchesToStorage = (
  rawBranches: any[],
  preferredBranchId?: string | null
): { branches: StoredBranch[]; activeBranchId: string | null } => {
  if (typeof window === 'undefined') {
    return { branches: [], activeBranchId: null };
  }

  const branches = rawBranches
    .map((branch) => normalizeStoredBranch(branch))
    .filter((branch): branch is StoredBranch => Boolean(branch));

  localStorage.setItem(LOCAL_STORAGE_KEYS.BRANCHES, JSON.stringify(branches));

  for (const rawBranch of rawBranches) {
    const normalizedBranch = normalizeStoredBranch(rawBranch);
    if (!normalizedBranch) {
      continue;
    }
    localStorage.setItem(`handypos-branch-${normalizedBranch.id}`, JSON.stringify(rawBranch));
  }

  const activeBranchId = chooseActiveBranchId(branches, preferredBranchId);
  if (activeBranchId) {
    localStorage.setItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH, activeBranchId);
    localStorage.setItem(LOCAL_STORAGE_KEYS.CURRENT_BRANCH, activeBranchId);
  } else {
    localStorage.removeItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
    localStorage.removeItem(LOCAL_STORAGE_KEYS.CURRENT_BRANCH);
  }

  window.dispatchEvent(new CustomEvent('branchesUpdated', { detail: { branches } }));
  if (activeBranchId) {
    window.dispatchEvent(new CustomEvent('branchChanged', { detail: { branchId: activeBranchId } }));
  }
  void syncSessionSnapshotToDesktopStore();

  return { branches, activeBranchId };
};

export async function syncBusinessBranchesFromServer(
  businessId: string,
  preferredBranchId?: string | null,
  options: { timeoutMs?: number } = {}
): Promise<{
  businessResponse: any;
  rawBranches: any[];
  branches: StoredBranch[];
  activeBranchId: string | null;
}> {
  const businessResponse = await authFetch.fetch<any>(`/business/businesses/${businessId}/`, {
    timeoutMs: options.timeoutMs,
  });
  let rawBranches: any[] = [];

  if (rawBranches.length === 0) {
    rawBranches = extractBranchesFromBusinessResponse(businessResponse);
  }

  if (rawBranches.length === 0) {
    const branchesResponse = await authFetch.fetch<any>(`/business/businesses/${businessId}/branches/`, {
      timeoutMs: options.timeoutMs,
    });
    rawBranches = extractBranchList(branchesResponse);
  }

  const { branches, activeBranchId } = persistBranchesToStorage(rawBranches, preferredBranchId);

  return {
    businessResponse,
    rawBranches,
    branches,
    activeBranchId,
  };
}
