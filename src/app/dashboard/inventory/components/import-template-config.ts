'use client';

import { type BusinessType } from '@/lib/inventory/config';

export const getInventoryTemplateColumnsForBusinessType = (businessType: BusinessType): string[] => {
  const isRestaurantOrBar = businessType === 'Restaurant' || businessType === 'Bar & Liquor';

  if (!isRestaurantOrBar) {
    return [
      'name',
      'category',
      'barcode',
      'currentStock',
      'price',
      'cost',
      'taxRate',
      'taxCalculationMethod',
      'mraProductCode',
      'mraProductName',
      'mraTaxType',
      'mraTaxRate',
      'mraUnitMeasure',
      'unitType',
      'reorderLevel',
      'supplier',
    ];
  }

  const columns = [
    'name',
    'category',
    'barcode',
    'isProduced',
    'currentStock',
    'price',
    'cost',
    'taxRate',
    'taxCalculationMethod',
    'mraProductCode',
    'mraProductName',
    'mraTaxType',
    'mraTaxRate',
    'mraUnitMeasure',
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
