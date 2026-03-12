'use client';

import React from 'react';
import { Printer } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PrinterConfigScreen } from '@/app/dashboard/settings/printers/printer-config-screen';

interface PrinterConfigModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PrinterConfigModal({ isOpen, onOpenChange }: PrinterConfigModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Printer Configuration
          </DialogTitle>
          <DialogDescription>
            Configure printers directly from POS without leaving this screen.
          </DialogDescription>
        </DialogHeader>

        <PrinterConfigScreen />
      </DialogContent>
    </Dialog>
  );
}
