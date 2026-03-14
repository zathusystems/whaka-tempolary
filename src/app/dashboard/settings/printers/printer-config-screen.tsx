'use client';

import React, { useState, useEffect } from 'react';
import { Printer, Plus, Trash2, Check, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { printerService, type PrinterConfig, type PrinterSettings } from '@/lib/services/printer-service';
import { printerDiscoveryService, type DiscoveredPrinter } from '@/lib/services/printer-discovery-service';
import { unifiedPrintingService } from '@/lib/services/unified-printing-service';

const forcePrintFlagsOn = (value: PrinterSettings): PrinterSettings => ({
  ...value,
  autoprint: true,
  printHeader: true,
  printFooter: true,
  printQRCode: true,
  printItemDetails: true,
  printTaxBreakdown: true,
});

const areForcedFlagsOn = (value: PrinterSettings): boolean => (
  value.autoprint &&
  value.printHeader &&
  value.printFooter &&
  value.printQRCode &&
  value.printItemDetails &&
  value.printTaxBreakdown
);

export function PrinterConfigScreen() {
  const { toast } = useToast();
  const isWindows =
    typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('windows');
  const [printers, setPrinters] = useState<PrinterConfig[]>([]);
  const [settings, setSettings] = useState<PrinterSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddingPrinter, setIsAddingPrinter] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [testingPrinterId, setTestingPrinterId] = useState<string | null>(null);
  const [discoveredPrinters, setDiscoveredPrinters] = useState<DiscoveredPrinter[]>([]);

  const branchId = localStorage.getItem('handypos-active-branch') || 'main';

  // Load printers and settings
  useEffect(() => {
    const loadData = async () => {
      try {
        setIsLoading(true);
        const [printersList, printerSettings] = await Promise.all([
          printerService.getPrinterConfigs(branchId),
          printerService.getPrinterSettings(branchId),
        ]);
        setPrinters(printersList);
        const normalizedSettings = forcePrintFlagsOn(printerSettings);
        setSettings(normalizedSettings);
        if (!areForcedFlagsOn(printerSettings)) {
          try {
            await printerService.savePrinterSettings(normalizedSettings);
          } catch (error) {
            console.warn('Failed to enforce default print settings:', error);
          }
        }
      } catch (error) {
        console.error('Error loading printer data:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to load printer configuration',
        });
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [branchId, toast]);

  const handleDeletePrinter = async (printerId: string) => {
    try {
      await printerService.deletePrinterConfig(printerId, branchId);
      setPrinters(printers.filter(p => p.id !== printerId));

      toast({
        title: 'Success',
        description: 'Printer deleted successfully',
      });
    } catch (error) {
      console.error('Error deleting printer:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete printer',
      });
    }
  };

  const handleSetDefault = async (printerId: string) => {
    try {
      const updatedPrinters = printers.map(p => ({
        ...p,
        isDefault: p.id === printerId,
      }));

      for (const printer of updatedPrinters) {
        await printerService.savePrinterConfig(printer);
      }

      setPrinters(updatedPrinters);

      toast({
        title: 'Success',
        description: 'Default printer updated',
      });
    } catch (error) {
      console.error('Error setting default printer:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to set default printer',
      });
    }
  };

  const handleTogglePrinter = async (printerId: string, isEnabled: boolean) => {
    try {
      const printer = printers.find(p => p.id === printerId);
      if (!printer) return;

      const updated = { ...printer, isEnabled };
      await printerService.savePrinterConfig(updated);

      setPrinters(printers.map(p => (p.id === printerId ? updated : p)));

      toast({
        title: 'Success',
        description: `Printer ${isEnabled ? 'enabled' : 'disabled'}`,
      });
    } catch (error) {
      console.error('Error toggling printer:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update printer',
      });
    }
  };

  const handleSaveSettings = async () => {
    if (!settings) return;

    try {
      const normalizedSettings = forcePrintFlagsOn(settings);
      setSettings(normalizedSettings);
      await printerService.savePrinterSettings(normalizedSettings);

      toast({
        title: 'Success',
        description: 'Printer settings saved successfully',
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save printer settings',
      });
    }
  };

  const handleTestPrinter = async (printer: PrinterConfig) => {
    try {
      setTestingPrinterId(printer.id);
      const result = await unifiedPrintingService.testPrint(printer);

      if (result.success) {
        toast({
          title: 'Success',
          description: result.message,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Test Failed',
          description: result.message,
        });
      }
    } catch (error) {
      console.error('Error running test print:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to run test print',
      });
    } finally {
      setTestingPrinterId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Loading printer configuration...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Printers List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Printer className="h-5 w-5" />
                Configured Printers
              </CardTitle>
              <CardDescription>
                Manage receipt printers for your POS system
              </CardDescription>
            </div>
            <Dialog open={isAddingPrinter} onOpenChange={setIsAddingPrinter}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Printer
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Add Printer</DialogTitle>
                  <DialogDescription>
                    Scan for available printers or add manually
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Button
                      onClick={async () => {
                        try {
                          setIsScanning(true);
                          const discovered = await printerDiscoveryService.scanPrinters();
                          setDiscoveredPrinters(discovered);
                          
                          if (discovered.length === 0) {
                            toast({
                              title: 'No Printers Found',
                              description: 'Make sure your printer is connected and powered on.',
                            });
                          } else {
                            toast({
                              title: 'Success',
                              description: `Found ${discovered.length} printer(s)`,
                            });
                          }
                        } catch (error) {
                          console.error('Error scanning printers:', error);
                          toast({
                            variant: 'destructive',
                            title: 'Scan Failed',
                            description: error instanceof Error ? error.message : 'Failed to scan for printers',
                          });
                        } finally {
                          setIsScanning(false);
                        }
                      }}
                      disabled={isScanning}
                      className="w-full"
                    >
                      {isScanning ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Scanning...
                        </>
                      ) : (
                        <>
                          <Search className="mr-2 h-4 w-4" />
                          Scan for Printers
                        </>
                      )}
                    </Button>
                  </div>

                  
                  {discoveredPrinters.length > 0 && (
                    <div className="space-y-2">
                      <Label>Available Printers</Label>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {discoveredPrinters.map((printer) => (
                          <div
                            key={printer.id}
                            className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted cursor-pointer transition-colors"
                            onClick={async () => {
                              try {
                                const configId = printer.id?.trim() || `manual-${Date.now()}`;
                                const alreadyExists = printers.some((p) => p.id === configId);
                                if (alreadyExists) {
                                  toast({
                                    title: 'Already Added',
                                    description: `${printer.name} is already configured`,
                                  });
                                  return;
                                }

                                const newPrinter: PrinterConfig = {
                                  id: configId,
                                  branchId,
                                  name: printer.name,
                                  type: printer.type === 'bluetooth' ? 'thermal_bluetooth' : 'thermal',
                                  paperWidth: '80mm',
                                  connectionType:
                                    printer.type === 'bluetooth'
                                      ? 'bluetooth'
                                      : printer.type === 'network'
                                      ? 'network'
                                      : 'usb',
                                  bluetoothDeviceId: printer.type === 'bluetooth' ? configId : undefined,
                                  bluetoothDeviceName: printer.type === 'bluetooth' ? printer.name : undefined,
                                  isDefault: printers.length === 0,
                                  isEnabled: true,
                                  autoprint: true,
                                  printCopies: 1,
                                  createdAt: new Date().toISOString(),
                                  updatedAt: new Date().toISOString(),
                                };

                                await printerService.savePrinterConfig(newPrinter);
                                setPrinters([...printers, newPrinter]);

                                toast({
                                  title: 'Success',
                                  description: `${printer.name} added successfully`,
                                });

                                setIsAddingPrinter(false);
                                setDiscoveredPrinters([]);
                              } catch (error) {
                                console.error('Error adding printer:', error);
                                toast({
                                  variant: 'destructive',
                                  title: 'Error',
                                  description: 'Failed to add printer',
                                });
                              }
                            }}
                          >
                            <div className="flex-1">
                              <p className="font-medium text-sm">{printer.name}</p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded">
                                  {printer.type}
                                </span>
                                <span className={`text-xs px-2 py-0.5 rounded ${
                                  printer.status === 'ready' 
                                    ? 'bg-green-100 text-green-800' 
                                    : printer.status === 'offline'
                                    ? 'bg-red-100 text-red-800'
                                    : 'bg-yellow-100 text-yellow-800'
                                }`}>
                                  {printer.status}
                                </span>
                              </div>
                            </div>
                            <Check className="h-5 w-5 text-green-600 flex-shrink-0" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {discoveredPrinters.length === 0 && !isScanning && (
                    <div className="space-y-4">
                      <div className="text-center py-8 text-muted-foreground">
                        <Printer className="h-12 w-12 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">Click "Scan for Printers" to find available devices</p>
                      </div>
                      
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t border-gray-300" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-white px-2 text-gray-500">Or</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="manual-printer-name">Add Printer Manually</Label>
                        <div className="flex gap-2">
                          <Input
                            id="manual-printer-name"
                            placeholder="Enter printer name (e.g., Epson TM-T20)"
                            onKeyPress={(e) => {
                              if (e.key === 'Enter') {
                                const name = (e.target as HTMLInputElement).value.trim();
                                if (name) {
                                  const manualId = isWindows ? `win:${name}` : `manual-${Date.now()}`;
                                  const manualPrinter: DiscoveredPrinter = {
                                    id: manualId,
                                    name,
                                    type: 'unknown',
                                    status: 'ready',
                                    isDefault: false,
                                    description: `Manual entry: ${name}`,
                                  };
                                  setDiscoveredPrinters([manualPrinter]);
                                  (e.target as HTMLInputElement).value = '';
                                }
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            onClick={(e) => {
                              const input = (e.currentTarget.parentElement?.querySelector('#manual-printer-name') as HTMLInputElement);
                              const name = input?.value.trim();
                              if (name) {
                                const manualId = isWindows ? `win:${name}` : `manual-${Date.now()}`;
                                const manualPrinter: DiscoveredPrinter = {
                                  id: manualId,
                                  name,
                                  type: 'unknown',
                                  status: 'ready',
                                  isDefault: false,
                                  description: `Manual entry: ${name}`,
                                };
                                setDiscoveredPrinters([manualPrinter]);
                                input.value = '';
                              }
                            }}
                          >
                            Add
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Enter your printer name and press Enter or click Add
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => {
                    setIsAddingPrinter(false);
                    setDiscoveredPrinters([]);
                  }}>
                    Close
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {printers.length === 0 ? (
            <div className="text-center py-8">
              <Printer className="h-12 w-12 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-muted-foreground">No printers configured yet</p>
              <p className="text-sm text-muted-foreground">Add a printer to enable receipt printing</p>
            </div>
          ) : (
            <div className="space-y-3">
              {printers.map((printer) => (
                <div
                  key={printer.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{printer.name}</h3>
                      {printer.isDefault && (
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                          Default
                        </span>
                      )}
                      {!printer.isEnabled && (
                        <span className="text-xs bg-gray-100 text-gray-800 px-2 py-1 rounded">
                          Disabled
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {printer.type.charAt(0).toUpperCase() + printer.type.slice(1)} • {printer.paperWidth}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={printer.isEnabled}
                      onCheckedChange={(checked) =>
                        handleTogglePrinter(printer.id, checked)
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!printer.isEnabled || testingPrinterId === printer.id}
                      onClick={() => handleTestPrinter(printer)}
                    >
                      {testingPrinterId === printer.id ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Testing...
                        </>
                      ) : (
                        'Test Printer'
                      )}
                    </Button>
                    {!printer.isDefault && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleSetDefault(printer.id)}
                      >
                        Set Default
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDeletePrinter(printer.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Print Settings */}
      {settings && (
        <Card>
          <CardHeader>
            <CardTitle>Print Settings</CardTitle>
            <CardDescription>
              Configure default printing behavior for receipts
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              <div className="border-t pt-4">
                <Label htmlFor="receipt-format">Receipt Format</Label>
                <Select
                  value={settings.receiptPaperWidth}
                  onValueChange={(value) =>
                    setSettings({
                      ...settings,
                      receiptPaperWidth: value === '58mm' ? '58mm' : '80mm',
                    })
                  }
                >
                  <SelectTrigger id="receipt-format" className="mt-2 max-w-xs">
                    <SelectValue placeholder="Select receipt width" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="80mm">80mm (Standard)</SelectItem>
                    <SelectItem value="58mm">58mm (Compact)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground mt-1">
                  Controls receipt layout width. 58mm works on 80mm printers with side margins.
                </p>
              </div>

              <div className="border-t pt-4">
                <Label htmlFor="print-copies">Number of Copies</Label>
                <Input
                  id="print-copies"
                  type="number"
                  min="1"
                  max="5"
                  value={settings.printCopies}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      printCopies: Math.max(1, parseInt(e.target.value) || 1),
                    })
                  }
                  className="mt-2 max-w-xs"
                />
                <p className="text-sm text-muted-foreground mt-1">
                  Number of receipt copies to print per sale
                </p>
              </div>
            </div>

            <Button onClick={handleSaveSettings} className="w-full">
              Save Settings
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
