'use client';

export const WAREHOUSE_BRANCH_ID = '__mra_warehouse__';

export const WAREHOUSE_BRANCH = {
  id: WAREHOUSE_BRANCH_ID,
  name: 'Warehouse',
  address: 'MRA warehouse stock',
  isWarehouse: true,
} as const;

export const isWarehouseBranchId = (value?: unknown): boolean => (
  String(value ?? '').trim() === WAREHOUSE_BRANCH_ID
);

