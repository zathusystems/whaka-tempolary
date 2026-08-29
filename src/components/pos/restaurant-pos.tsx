'use client';

import React, { useMemo } from 'react';
import { Utensils } from 'lucide-react';
import { GenericPos, type PosProps } from './generic-pos';
import type { InventoryItem } from '@/lib/db';

export const RestaurantPos = (props: PosProps) => {
  // The inventory is already filtered by the parent component (POS page or POS modal)
  // Just pass it through to GenericPos
  return (
    <GenericPos
      {...props}
      productIcon={<Utensils className="h-8 w-8 text-muted-foreground" data-ai-hint="restaurant food" />}
    />
  );
};
