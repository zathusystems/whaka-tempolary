
'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type InventoryItem, type Subscription } from '@/lib/db';
import { authFetch } from '@/lib/auth-fetch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { PlusCircle, Utensils, QrCode, Copy, Loader2, Upload, X, Download, Settings, Save, Palette } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import Image from 'next/image';
import { useToast } from '@/hooks/use-toast';
import { syncService } from '@/lib/services/sync-service';
import { MenuTemplates } from '@/components/menu/menu-templates';
import { QRCodeTemplates } from '@/components/menu/qr-code-templates';

const LOCAL_STORAGE_KEYS = {
    ACTIVE_BRANCH: 'handypos-active-branch'
};

const MenuItemCard = ({
  item,
  onRemove,
}: {
  item: InventoryItem;
  onRemove: (item: InventoryItem) => void;
}) => {
  const [isEditingImage, setIsEditingImage] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Image = event.target?.result as string;
      await db.inventory.update(item.id, { image: base64Image, _dirty: true, _operation: 'update' });
      await syncService.markAsDirty('InventoryItem', item.id, 'update');
      setIsEditingImage(false);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = async () => {
    await db.inventory.update(item.id, { image: undefined, _dirty: true, _operation: 'update' });
    await syncService.markAsDirty('InventoryItem', item.id, 'update');
  };

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        {/* Image Section */}
        <div className="relative mb-4 flex h-40 items-center justify-center rounded-lg bg-muted">
          {item.image ? (
            <div className="relative h-full w-full">
              <img
                src={item.image}
                alt={item.name}
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity hover:opacity-100">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleRemoveImage}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground"
            >
              <Upload className="h-8 w-8" />
              <span className="text-xs">Add Image</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
          />
        </div>

        {/* Item Info */}
        <div className="space-y-2">
          <div>
            <h3 className="font-semibold">{item.name}</h3>
            <p className="text-sm text-muted-foreground">{item.category}</p>
          </div>
          <Badge variant="secondary">${Number(item.price)?.toFixed(2) || '0.00'}</Badge>
        </div>

        <Separator className="my-3" />
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onRemove(item)}
        >
          Remove from Menu
        </Button>
      </CardContent>
    </Card>
  );
};

const AddToMenuModal = ({
  isOpen,
  onOpenChange,
  availableItems,
  activeBranchId,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  availableItems: InventoryItem[];
  activeBranchId: string | null;
}) => {
  const { toast } = useToast();
  
  // Filter out ingredient products - only allow sellable items
  const menuEligibleItems = useMemo(() => {
    return availableItems.filter(item => item.itemType === 'sellable');
  }, [availableItems]);
  
  const handleAddToMenu = async (item: InventoryItem) => {
    try {
      // Save to local database
      await db.inventory.update(item.id, { onMenu: true, _dirty: true, _operation: 'update' });
      await syncService.markAsDirty('InventoryItem', item.id, 'update');
      
      // Save to backend
      if (activeBranchId) {
        // Extract branch ID from string like "BRN-10" -> 10
        const branchIdMatch = activeBranchId.match(/\d+/);
        const branchIdInt = branchIdMatch ? parseInt(branchIdMatch[0], 10) : parseInt(activeBranchId, 10);
        
        await authFetch.fetch('/digital-menu/menu/add_item/', {
          method: 'POST',
          body: JSON.stringify({
            branch_id: branchIdInt,
            inventory_item_id: item.id,
          }),
        });
        console.log('[Menu] Item added to backend menu:', item.id);
      }
      
      toast({
        title: 'Success',
        description: `${item.name} added to menu`,
      });
    } catch (error) {
      console.error('[Menu] Error adding item to menu:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to add item to menu',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Items to Menu</DialogTitle>
          <DialogDescription>
            Select sellable products to add them to your public menu. Ingredients cannot be added to the menu.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-3 p-1">
          {menuEligibleItems.length > 0 ? (
            menuEligibleItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-4 rounded-lg border p-3"
              >
                <div className="flex-1">
                  <p className="font-semibold">{item.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.category}
                  </p>
                </div>
                <Badge variant="outline">${Number(item.price)?.toFixed(2) || '0.00'}</Badge>
                <Button size="sm" onClick={() => handleAddToMenu(item)}>
                  Add
                </Button>
              </div>
            ))
          ) : (
            <p className="py-8 text-center text-muted-foreground">
              All sellable items are already on the menu. (Ingredients cannot be added to the menu)
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const ShareMenuModal = ({
  isOpen,
  onOpenChange,
  publicMenuUrl,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  publicMenuUrl: string;
}) => {
  const { toast } = useToast();
  const [qrCodeUrl, setQrCodeUrl] = useState('');

  useEffect(() => {
    if (publicMenuUrl) {
      setQrCodeUrl(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(publicMenuUrl)}`);
    }
  }, [publicMenuUrl]);

  const handleCopy = () => {
    navigator.clipboard.writeText(publicMenuUrl);
    toast({
      title: 'Copied to clipboard!',
      description: 'The public menu URL has been copied.',
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Your Public Menu</DialogTitle>
          <DialogDescription>
            Let customers view your menu by scanning the QR code or using the
            link.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center justify-center gap-4 py-4">
          <div className="rounded-lg border p-4">
            {qrCodeUrl && (
              <Image
                src={qrCodeUrl}
                alt="Menu QR Code"
                width={200}
                height={200}
              />
            )}
          </div>
          <div className="relative w-full">
            <Input value={publicMenuUrl} readOnly />
            <Button
              size="icon"
              variant="ghost"
              className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
              onClick={handleCopy}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

interface MenuConfig {
  displayName: string;
  description: string;
  tagline: string;
  theme: 'light' | 'dark' | 'auto';
  primaryColor: string;
  accentColor: string;
  showPrices: boolean;
  showCategories: boolean;
  showImages: boolean;
  showBrandInfo: boolean;
  showContactInfo: boolean;
  itemsPerRow: 'auto' | '2' | '3' | '4';
  currency: string;
  businessLogo?: string;
  businessBanner?: string;
  footerText: string;
  enableSearch: boolean;
  enableFilters: boolean;
  enableSorting: boolean;
  acceptOrders: boolean;
}

const DEFAULT_CONFIG: MenuConfig = {
  displayName: 'Our Menu',
  description: 'Welcome to our restaurant',
  tagline: 'Fresh & Delicious',
  theme: 'auto',
  primaryColor: '#263b57',
  accentColor: '#236dd5',
  showPrices: true,
  showCategories: true,
  showImages: true,
  showBrandInfo: true,
  showContactInfo: true,
  itemsPerRow: '3',
  currency: 'USD',
  footerText: 'Thank you for your visit!',
  enableSearch: true,
  enableFilters: true,
  enableSorting: true,
  acceptOrders: true,
};

const MenuConfigTab = ({ activeBranchId }: { activeBranchId: string | null }) => {
  const [config, setConfig] = useState<MenuConfig>(DEFAULT_CONFIG);
  const [editConfig, setEditConfig] = useState<MenuConfig>(DEFAULT_CONFIG);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [businessCurrency, setBusinessCurrency] = useState('USD');
  const { toast } = useToast();
  const logoInputRef = React.useRef<HTMLInputElement>(null);
  const bannerInputRef = React.useRef<HTMLInputElement>(null);

  // Load business currency
  useEffect(() => {
    const loadBusinessCurrency = async () => {
      try {
        // Try to get from IndexedDB first
        const business = await db.business.get('main-business');
        if (business?.currency) {
          console.log('[MenuConfig] Business currency from IndexedDB:', business.currency);
          setBusinessCurrency(business.currency);
          return;
        }

        // Fallback: try to get all businesses and use the first one
        const allBusinesses = await db.business.toArray();
        if (allBusinesses.length > 0 && allBusinesses[0].currency) {
          console.log('[MenuConfig] Business currency from first business:', allBusinesses[0].currency);
          setBusinessCurrency(allBusinesses[0].currency);
          return;
        }

        // Fallback: check localStorage for business data
        const storedBusiness = localStorage.getItem('handypos-business');
        if (storedBusiness) {
          const parsed = JSON.parse(storedBusiness);
          if (parsed.currency) {
            console.log('[MenuConfig] Business currency from localStorage:', parsed.currency);
            setBusinessCurrency(parsed.currency);
            return;
          }
        }
      } catch (error) {
        console.error('[MenuConfig] Error loading business currency:', error);
      }
    };

    loadBusinessCurrency();
  }, []);

  // Load config from backend only
  useEffect(() => {
    const loadConfig = async () => {
      if (!activeBranchId) return;
      
      setIsLoading(true);
      try {
        // Convert branch ID to integer
        const branchIdInt = parseInt(activeBranchId, 10);
        console.log('[MenuConfig] Loading configuration from backend for branch:', branchIdInt);
        const data = await authFetch.fetch<any>(`/digital-menu/menu-config/by_branch/?branch_id=${branchIdInt}`);
        
        console.log('[MenuConfig] Configuration loaded from backend:', data);
        
        // Handle both single object and array responses
        const configData = Array.isArray(data) ? data[0] : data;
        
        if (!configData) {
          console.log('[MenuConfig] No configuration found, using defaults');
          setConfig(DEFAULT_CONFIG);
          setEditConfig(DEFAULT_CONFIG);
          setIsLoading(false);
          return;
        }
        
        // Map snake_case from backend to camelCase for frontend
        const mappedConfig = {
          displayName: configData.display_name || DEFAULT_CONFIG.displayName,
          description: configData.description || DEFAULT_CONFIG.description,
          tagline: configData.tagline || DEFAULT_CONFIG.tagline,
          theme: configData.theme || DEFAULT_CONFIG.theme,
          primaryColor: configData.primary_color || DEFAULT_CONFIG.primaryColor,
          accentColor: configData.accent_color || DEFAULT_CONFIG.accentColor,
          showPrices: configData.show_prices !== undefined ? configData.show_prices : DEFAULT_CONFIG.showPrices,
          showCategories: configData.show_categories !== undefined ? configData.show_categories : DEFAULT_CONFIG.showCategories,
          showImages: configData.show_images !== undefined ? configData.show_images : DEFAULT_CONFIG.showImages,
          showBrandInfo: configData.show_brand_info !== undefined ? configData.show_brand_info : DEFAULT_CONFIG.showBrandInfo,
          showContactInfo: configData.show_contact_info !== undefined ? configData.show_contact_info : DEFAULT_CONFIG.showContactInfo,
          itemsPerRow: configData.items_per_row || DEFAULT_CONFIG.itemsPerRow,
          currency: configData.currency || DEFAULT_CONFIG.currency,
          businessLogo: configData.business_logo || undefined,
          businessBanner: configData.business_banner || undefined,
          footerText: configData.footer_text || DEFAULT_CONFIG.footerText,
          enableSearch: configData.enable_search !== undefined ? configData.enable_search : DEFAULT_CONFIG.enableSearch,
          enableFilters: configData.enable_filters !== undefined ? configData.enable_filters : DEFAULT_CONFIG.enableFilters,
          enableSorting: configData.enable_sorting !== undefined ? configData.enable_sorting : DEFAULT_CONFIG.enableSorting,
          acceptOrders: configData.accept_orders !== undefined ? configData.accept_orders : DEFAULT_CONFIG.acceptOrders,
        };
        setConfig(mappedConfig);
        setEditConfig(mappedConfig);
      } catch (error) {
        console.error('[MenuConfig] Error loading config from backend:', error);
        // No fallback - only use backend data
        setConfig(DEFAULT_CONFIG);
        setEditConfig(DEFAULT_CONFIG);
      } finally {
        setIsLoading(false);
      }
    };

    loadConfig();
  }, [activeBranchId]);

  const handleOpenEditModal = () => {
    // Set business currency as default if not already set
    const configWithDefault = {
      ...config,
      currency: config.currency || businessCurrency,
    };
    setEditConfig(configWithDefault);
    setIsEditModalOpen(true);
  };

  const handleSaveConfig = async () => {
    setIsSaving(true);
    try {
      if (!activeBranchId) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'No branch selected',
        });
        return;
      }

      console.log('[MenuConfig] Saving configuration to backend:', config);
      
      const responseData = await authFetch.fetch<any>('/digital-menu/menu-config/', {
        method: 'POST',
        body: JSON.stringify(config),
      });

      console.log('[MenuConfig] Configuration saved to backend:', responseData);

      toast({
        title: 'Success',
        description: 'Menu configuration saved successfully',
      });
    } catch (error) {
      console.error('[MenuConfig] Error saving config:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save menu configuration',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setConfig(prev => ({ ...prev, businessLogo: base64 }));
      toast({ title: 'Logo uploaded', description: 'Business logo has been updated' });
    };
    reader.readAsDataURL(file);
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setConfig(prev => ({ ...prev, businessBanner: base64 }));
      toast({ title: 'Banner uploaded', description: 'Business banner has been updated' });
    };
    reader.readAsDataURL(file);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Details View - Single Centered Card */}
      <Card className="mx-auto max-w-2xl">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Menu Configuration</CardTitle>
          <CardDescription>Current settings for your digital menu</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Banner */}
          {config.businessBanner && (
            <div className="flex justify-center">
              <img src={config.businessBanner} alt="Banner" className="h-32 w-full max-w-md rounded-lg object-cover" />
            </div>
          )}

          {/* Logo & Branding */}
          {config.businessLogo && (
            <div className="flex justify-center">
              <img src={config.businessLogo} alt="Logo" className="h-20 w-20 object-contain" />
            </div>
          )}

          {/* Display Name */}
          <div className="space-y-2 text-center">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Display Name</p>
            <p className="text-2xl font-bold">{config.displayName}</p>
          </div>

          <Separator />

          {/* Tagline */}
          <div className="space-y-2 text-center">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Tagline</p>
            <p className="text-lg italic">{config.tagline}</p>
          </div>

          <Separator />

          {/* Description */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Description</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{config.description}</p>
          </div>

          <Separator />

          {/* Colors */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Colors</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-16 rounded border" style={{ backgroundColor: config.primaryColor }} />
                <div>
                  <p className="text-xs text-muted-foreground">Primary</p>
                  <p className="text-sm font-mono font-semibold">{config.primaryColor}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-10 w-16 rounded border" style={{ backgroundColor: config.accentColor }} />
                <div>
                  <p className="text-xs text-muted-foreground">Accent</p>
                  <p className="text-sm font-mono font-semibold">{config.accentColor}</p>
                </div>
              </div>
            </div>
          </div>

          <Separator />

          {/* Display Settings */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Display Settings</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Items Per Row</p>
                <Badge variant="outline" className="mt-1">{config.itemsPerRow === 'auto' ? 'Auto (Responsive)' : `${config.itemsPerRow} Items`}</Badge>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Currency</p>
                <Badge variant="outline" className="mt-1">{config.currency}</Badge>
              </div>
            </div>
          </div>

          <Separator />

          {/* Display Options */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Display Options</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'showPrices', label: 'Show Prices' },
                { key: 'showCategories', label: 'Show Categories' },
                { key: 'showImages', label: 'Show Images' },
                { key: 'showBrandInfo', label: 'Show Brand Info' },
                { key: 'showContactInfo', label: 'Show Contact Info' },
                { key: 'enableSearch', label: 'Enable Search' },
                { key: 'enableFilters', label: 'Enable Filters' },
                { key: 'enableSorting', label: 'Enable Sorting' },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between text-sm p-2 rounded-lg bg-muted/50">
                  <span>{label}</span>
                  <Badge variant={config[key as keyof MenuConfig] ? 'default' : 'secondary'} className="text-xs">
                    {config[key as keyof MenuConfig] ? '✓' : '✗'}
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          <Separator />

          {/* Order Management */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Order Management</p>
            <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
              <div>
                <p className="font-semibold">Accept Orders</p>
                <p className="text-xs text-muted-foreground">Customers can place orders</p>
              </div>
              <Badge variant={config.acceptOrders ? 'default' : 'secondary'} className="text-xs">
                {config.acceptOrders ? '✓ Enabled' : '✗ Disabled'}
              </Badge>
            </div>
          </div>

          <Separator />

          {/* Theme */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Theme</p>
            <Badge variant="outline">{config.theme === 'auto' ? 'Auto (System)' : config.theme.charAt(0).toUpperCase() + config.theme.slice(1)}</Badge>
          </div>

          <Separator />

          {/* Footer Text */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Footer Text</p>
            <p className="text-sm text-muted-foreground italic">{config.footerText}</p>
          </div>
        </CardContent>
      </Card>

      {/* Update Button */}
      <div className="flex justify-center">
        <Button onClick={handleOpenEditModal} size="lg">
          <Settings className="mr-2 h-4 w-4" />
          Update Configuration
        </Button>
      </div>

      {/* Edit Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Menu Configuration</DialogTitle>
            <DialogDescription>Customize your digital menu appearance and settings</DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Display Name */}
            <div className="space-y-2">
              <Label htmlFor="edit-displayName">Menu Display Name</Label>
              <Input
                id="edit-displayName"
                value={editConfig.displayName}
                onChange={(e) => setEditConfig(prev => ({ ...prev, displayName: e.target.value }))}
                placeholder="e.g., Our Menu"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="edit-description">Menu Description</Label>
              <Textarea
                id="edit-description"
                value={editConfig.description}
                onChange={(e) => setEditConfig(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Welcome message for customers"
                rows={3}
              />
            </div>

            {/* Tagline */}
            <div className="space-y-2">
              <Label htmlFor="edit-tagline">Tagline</Label>
              <Input
                id="edit-tagline"
                value={editConfig.tagline}
                onChange={(e) => setEditConfig(prev => ({ ...prev, tagline: e.target.value }))}
                placeholder="e.g., Fresh & Delicious"
              />
            </div>

            <Separator />

            {/* Colors */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-primaryColor">Primary Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="edit-primaryColor"
                    type="color"
                    value={editConfig.primaryColor}
                    onChange={(e) => setEditConfig(prev => ({ ...prev, primaryColor: e.target.value }))}
                    className="h-10 w-16 cursor-pointer rounded border"
                  />
                  <Input
                    value={editConfig.primaryColor}
                    onChange={(e) => setEditConfig(prev => ({ ...prev, primaryColor: e.target.value }))}
                    className="flex-1"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-accentColor">Accent Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="edit-accentColor"
                    type="color"
                    value={editConfig.accentColor}
                    onChange={(e) => setEditConfig(prev => ({ ...prev, accentColor: e.target.value }))}
                    className="h-10 w-16 cursor-pointer rounded border"
                  />
                  <Input
                    value={editConfig.accentColor}
                    onChange={(e) => setEditConfig(prev => ({ ...prev, accentColor: e.target.value }))}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Layout & Currency */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-itemsPerRow">Items Per Row</Label>
                <Select value={editConfig.itemsPerRow} onValueChange={(value: any) => setEditConfig(prev => ({ ...prev, itemsPerRow: value }))}>
                  <SelectTrigger id="edit-itemsPerRow">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (Responsive)</SelectItem>
                    <SelectItem value="2">2 Items</SelectItem>
                    <SelectItem value="3">3 Items</SelectItem>
                    <SelectItem value="4">4 Items</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-currency">Currency</Label>
                <div className="flex items-center gap-2 p-2 rounded-lg border bg-muted/50">
                  <span className="text-sm font-semibold">{businessCurrency}</span>
                  <span className="text-xs text-muted-foreground">(Business Currency)</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Display Options */}
            <div className="space-y-3">
              <h4 className="font-semibold">Display Options</h4>
              {[
                { key: 'showPrices', label: 'Show Prices' },
                { key: 'showCategories', label: 'Show Categories' },
                { key: 'showImages', label: 'Show Images' },
                { key: 'enableSearch', label: 'Enable Search' },
                { key: 'enableFilters', label: 'Enable Filters' },
                { key: 'enableSorting', label: 'Enable Sorting' },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between">
                  <Label>{label}</Label>
                  <button
                    onClick={() => setEditConfig(prev => ({ ...prev, [key]: !prev[key as keyof MenuConfig] }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      editConfig[key as keyof MenuConfig] ? 'bg-primary' : 'bg-muted'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        editConfig[key as keyof MenuConfig] ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>

            <Separator />

            {/* Order Management */}
            <div className="space-y-3">
              <h4 className="font-semibold">Order Management</h4>
              <div className="flex items-center justify-between p-4 rounded-lg border border-border bg-card">
                <div className="space-y-1">
                  <Label className="text-base font-semibold">Accept Orders</Label>
                  <p className="text-sm text-muted-foreground">Allow customers to place orders</p>
                </div>
                <button
                  onClick={() => setEditConfig(prev => ({ ...prev, acceptOrders: !prev.acceptOrders }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    editConfig.acceptOrders ? 'bg-green-600' : 'bg-muted'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      editConfig.acceptOrders ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex gap-2 justify-end pt-4">
            <Button variant="outline" onClick={() => setIsEditModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setConfig(editConfig);
                setIsEditModalOpen(false);
                // Save after closing modal
                setIsSaving(true);
                try {
                  if (!activeBranchId) return;
                  
                  // Get business ID from IndexedDB with fallbacks
                  let businessId: number | null = null;
                  
                  // Try to get from IndexedDB first
                  let business = await db.business.get('main-business');
                  if (business) {
                    businessId = business.id;
                  } else {
                    // Fallback: try to get all businesses and use the first one
                    const allBusinesses = await db.business.toArray();
                    if (allBusinesses.length > 0) {
                      businessId = allBusinesses[0].id;
                    }
                  }
                  
                  if (!businessId) {
                    throw new Error('Business not found in local database');
                  }
                  
                  // Extract integer from branch ID (e.g., "BRN-10" -> 10)
                  const branchIdInt = parseInt(activeBranchId.split('-')[1] || activeBranchId, 10);
                  
                  console.log('[MenuConfig] Business ID:', businessId);
                  console.log('[MenuConfig] Branch ID (int):', branchIdInt);
                  
                  // Map camelCase to snake_case for backend
                  const backendData = {
                    business: businessId,
                    branch: branchIdInt,
                    display_name: editConfig.displayName,
                    description: editConfig.description,
                    tagline: editConfig.tagline,
                    theme: editConfig.theme,
                    primary_color: editConfig.primaryColor,
                    accent_color: editConfig.accentColor,
                    show_prices: editConfig.showPrices,
                    show_categories: editConfig.showCategories,
                    show_images: editConfig.showImages,
                    show_brand_info: editConfig.showBrandInfo,
                    show_contact_info: editConfig.showContactInfo,
                    items_per_row: editConfig.itemsPerRow,
                    currency: editConfig.currency,
                    business_logo: editConfig.businessLogo,
                    business_banner: editConfig.businessBanner,
                    footer_text: editConfig.footerText,
                    enable_search: editConfig.enableSearch,
                    enable_filters: editConfig.enableFilters,
                    enable_sorting: editConfig.enableSorting,
                    accept_orders: editConfig.acceptOrders,
                  };
                  
                  console.log('[MenuConfig] Sending data to backend:', backendData);
                  
                  const responseData = await authFetch.fetch<any>('/digital-menu/menu-config/', {
                    method: 'POST',
                    body: JSON.stringify(backendData),
                  });
                  
                  console.log('[MenuConfig] Response data:', responseData);
                  
                  toast({ title: 'Success', description: 'Configuration saved successfully' });
                } catch (error) {
                  console.error('[MenuConfig] Error saving:', error);
                  toast({ variant: 'destructive', title: 'Error', description: error instanceof Error ? error.message : 'Failed to save configuration' });
                } finally {
                  setIsSaving(false);
                }
              }}
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Changes
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default function MenuBuilderPage() {
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [isShareModalOpen, setShareModalOpen] = useState(false);
  const [publicMenuUrl, setPublicMenuUrl] = useState('');
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [businessName, setBusinessName] = useState('Our Restaurant');

  // Fetch subscription for access control
  const frontendSubscription = useLiveQuery(() => db.subscriptions.get('sub_main-business'));
  const [subscription, setSubscription] = useState<Subscription | undefined>(undefined);

  // Fetch subscription and features from backend first, fallback to frontend
  useEffect(() => {
    const fetchSubscriptionAndFeatures = async () => {
      try {
        const subResponse = await authFetch.fetch('/subscription/subscriptions/current/');
        
        console.log('[Menu] Backend subscription response:', subResponse);
        
        // Handle paginated response for subscription
        const subscriptionData = subResponse?.results?.[0] || subResponse?.data?.[0] || subResponse?.[0] || subResponse;
        
        if (subscriptionData && (subscriptionData.id || subscriptionData.business)) {
          console.log('[Menu] Using backend subscription:', subscriptionData);
          
          // Map backend subscription to frontend format
          const mappedSubscription: Subscription = {
            id: subscriptionData.id || 'sub_main-business',
            businessId: subscriptionData.business?.id || subscriptionData.businessId || 'main-business',
            status: subscriptionData.status || 'active',
            account_balance: subscriptionData.account_balance || 0,
            total_spent: subscriptionData.total_spent || 0,
            base_price_per_day: subscriptionData.base_price_per_day || 0,
            free_trial_days: subscriptionData.free_trial_days || 0,
            free_trial_credits_applied: subscriptionData.free_trial_credits_applied || false,
            free_trial_credits_amount: subscriptionData.free_trial_credits_amount || 0,
            enable_pos: subscriptionData.enable_pos === true || subscriptionData.enable_pos !== false,
            enable_inventory: subscriptionData.enable_inventory === true || subscriptionData.enable_inventory !== false,
            enable_invoicing: subscriptionData.enable_invoicing === true || subscriptionData.enable_invoicing !== false,
            enable_online_menu: subscriptionData.enable_online_menu === true || subscriptionData.enable_online_menu !== false,
            enable_online_ordering: subscriptionData.enable_online_ordering === true || subscriptionData.enable_online_ordering !== false,
            enable_kitchen: subscriptionData.enable_kitchen === true || subscriptionData.enable_kitchen !== false,
            enable_expense_management: subscriptionData.enable_expense_management === true || subscriptionData.enable_expense_management !== false,
            enable_supplier_management: subscriptionData.enable_supplier_management === true || subscriptionData.enable_supplier_management !== false,
            enable_purchases: subscriptionData.enable_purchases === true || subscriptionData.enable_purchases !== false,
            enable_low_stock_alerts: subscriptionData.enable_low_stock_alerts === true || subscriptionData.enable_low_stock_alerts !== false,
            enable_expiry_alerts: subscriptionData.enable_expiry_alerts === true || subscriptionData.enable_expiry_alerts !== false,
            enable_customer_management: subscriptionData.enable_customer_management === true || subscriptionData.enable_customer_management !== false,
            enable_reports: subscriptionData.enable_reports === true || subscriptionData.enable_reports !== false,
            enable_analytics: subscriptionData.enable_analytics === true || subscriptionData.enable_analytics !== false,
            enable_take_orders: subscriptionData.enable_take_orders === true || subscriptionData.enable_take_orders !== false,
            enable_staff_management: subscriptionData.enable_staff_management === true || subscriptionData.enable_staff_management !== false,
            enable_waste_management: subscriptionData.enable_waste_management === true || subscriptionData.enable_waste_management !== false,
            enable_stock_transfers: subscriptionData.enable_stock_transfers === true || subscriptionData.enable_stock_transfers !== false,
            enable_stock_audits: subscriptionData.enable_stock_audits === true || subscriptionData.enable_stock_audits !== false,
            enable_tax_management: subscriptionData.enable_tax_management === true || subscriptionData.enable_tax_management !== false,
            enable_multi_branch: subscriptionData.enable_multi_branch === true || subscriptionData.enable_multi_branch !== false,
            enable_usage_limits: subscriptionData.enable_usage_limits === true || subscriptionData.enable_usage_limits !== false,
            low_balance_threshold: subscriptionData.low_balance_threshold || 10,
            low_balance_notified: subscriptionData.low_balance_notified || false,
            start_date: subscriptionData.start_date || new Date().toISOString(),
            created_at: subscriptionData.created_at || new Date().toISOString(),
            updated_at: subscriptionData.updated_at || new Date().toISOString(),
          };
          
          setSubscription(mappedSubscription);
          return;
        }
      } catch (error) {
        console.log('[Menu] Backend subscription fetch failed, falling back to frontend:', error);
      }
      
      // Fallback to frontend database
      if (frontendSubscription) {
        console.log('[Menu] Using frontend subscription:', frontendSubscription);
        setSubscription(frontendSubscription);
      }
    };

    fetchSubscriptionAndFeatures();
  }, [frontendSubscription]);

  // Menu management is always enabled
  const canManageMenu = true;

  useEffect(() => {
    const branchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
    if(branchId) {
      setActiveBranchId(branchId);
      // Pull fresh data from server when page loads
      pullServerData(branchId);
    }
  }, []);

  // Pull server data when branch changes
  useEffect(() => {
    if (activeBranchId) {
      console.log('[Menu] Pulling server data for branch:', activeBranchId);
      pullServerData(activeBranchId);
    }
  }, [activeBranchId]);

  const pullServerData = async (branchId: string) => {
    try {
      console.log('[Menu] Starting full sync for branch:', branchId);
      const { syncService } = await import('@/lib/services/sync-service');
      await syncService.performFullSync(branchId);
      console.log('[Menu] Full sync completed');
      
      // Also fetch all inventory items directly to ensure they're in local DB
      console.log('[Menu] Fetching all inventory items from backend');
      await syncService.fetchAllInventoryFromBackend(branchId);
      console.log('[Menu] Inventory fetch completed');
    } catch (error) {
      console.error('[Menu] Sync error:', error);
      // Don't show error toast - sync is best effort
    }
  };

  // Fetch business name
  const business = useLiveQuery(
    () => db.business.get('main-business'),
    []
  );

  useEffect(() => {
    const loadBusinessName = async () => {
      // Try to get from IndexedDB first
      if (business?.name) {
        console.log('[Menu] Business name from IndexedDB:', business.name);
        setBusinessName(business.name);
        return;
      }

      // Fallback: try to get all businesses and use the first one
      try {
        const allBusinesses = await db.business.toArray();
        console.log('[Menu] All businesses in DB:', allBusinesses);
        if (allBusinesses.length > 0 && allBusinesses[0].name) {
          console.log('[Menu] Business name from first business:', allBusinesses[0].name);
          setBusinessName(allBusinesses[0].name);
          return;
        }
      } catch (error) {
        console.error('[Menu] Error fetching businesses:', error);
      }

      // Fallback: check localStorage for business data
      try {
        const storedBusiness = localStorage.getItem('handypos-business');
        if (storedBusiness) {
          const parsed = JSON.parse(storedBusiness);
          if (parsed.name) {
            console.log('[Menu] Business name from localStorage:', parsed.name);
            setBusinessName(parsed.name);
            return;
          }
        }
      } catch (error) {
        console.error('[Menu] Error parsing localStorage business:', error);
      }

      console.log('[Menu] Using default business name');
    };

    loadBusinessName();
  }, [business]);

  useEffect(() => {
    console.log('[Menu] Current businessName state:', businessName);
  }, [businessName]);

  // Fetch menu items from backend
  const [menuItems, setMenuItems] = useState<InventoryItem[]>([]);
  const [availableItems, setAvailableItems] = useState<InventoryItem[]>([]);
  const [isLoadingMenuItems, setIsLoadingMenuItems] = useState(false);

  // Fetch all sellable items from local database
  const allSellableItems = useLiveQuery(
    () => {
      if (!activeBranchId) return [];
      return db.inventory.where('branchId').equals(activeBranchId).filter(item => item.itemType === 'sellable').toArray()
    },
    [activeBranchId]
  );

  // Fetch menu items from backend - independent of allSellableItems
  useEffect(() => {
    const fetchMenuItems = async () => {
      if (!activeBranchId) {
        console.log('[Menu] No activeBranchId, skipping menu fetch');
        return;
      }
      
      setIsLoadingMenuItems(true);
      try {
        const branchIdMatch = activeBranchId.match(/\d+/);
        const branchIdInt = branchIdMatch ? parseInt(branchIdMatch[0], 10) : parseInt(activeBranchId, 10);
        
        console.log('[Menu] Fetching menu items from backend for branch:', branchIdInt);
        
        // Fetch menu entries from backend
        const menuData = await authFetch.fetch<any>(`/digital-menu/menu/by_branch/?branch_id=${branchIdInt}`);
        console.log('[Menu] Menu items from backend response:', menuData);
        
        // Handle different response formats
        let menuEntries: any[] = [];
        if (Array.isArray(menuData)) {
          menuEntries = menuData;
          console.log('[Menu] Response is array with', menuEntries.length, 'items');
        } else if (menuData && menuData.results && Array.isArray(menuData.results)) {
          menuEntries = menuData.results;
          console.log('[Menu] Response is paginated with', menuEntries.length, 'items');
        } else if (menuData) {
          console.warn('[Menu] Unexpected menu data format:', menuData);
          menuEntries = [];
        }
        
        // Extract inventory item IDs from menu entries
        const menuItemIds = new Set(menuEntries.map((entry: any) => String(entry.inventory_item || entry.inventory_item_id)));
        console.log('[Menu] Menu item IDs from backend:', Array.from(menuItemIds));
        
        // Get all inventory items from local database (not just sellable)
        const allItems = await db.inventory.where('branchId').equals(activeBranchId).toArray();
        console.log('[Menu] Total inventory items in local DB:', allItems.length);
        
        // Split items into menu and available
        const onMenu: InventoryItem[] = [];
        const notOnMenu: InventoryItem[] = [];
        
        allItems.forEach(item => {
          if (menuItemIds.has(String(item.id))) {
            onMenu.push(item);
          } else {
            notOnMenu.push(item);
          }
        });
        
        console.log('[Menu] Split items - onMenu:', onMenu.length, 'available:', notOnMenu.length);
        setMenuItems(onMenu);
        setAvailableItems(notOnMenu);
      } catch (error) {
        console.error('[Menu] Error fetching menu items from backend:', error);
        // Fallback: get all items from local DB
        try {
          const allItems = await db.inventory.where('branchId').equals(activeBranchId).toArray();
          const onMenu: InventoryItem[] = [];
          const notOnMenu: InventoryItem[] = [];
          allItems.forEach(item => {
            if (item.onMenu === true) {
              onMenu.push(item);
            } else {
              notOnMenu.push(item);
            }
          });
          console.log('[Menu] Using fallback - onMenu:', onMenu.length, 'available:', notOnMenu.length);
          setMenuItems(onMenu);
          setAvailableItems(notOnMenu);
        } catch (fallbackError) {
          console.error('[Menu] Fallback also failed:', fallbackError);
          setMenuItems([]);
          setAvailableItems([]);
        }
      } finally {
        setIsLoadingMenuItems(false);
      }
    };
    
    fetchMenuItems();
  }, [activeBranchId]);

  useEffect(() => {
    const fetchPublicMenuUrl = async () => {
      if (!activeBranchId) {
        console.log('[Menu] No activeBranchId, skipping menu URL fetch');
        return;
      }

      try {
        const branchIdMatch = activeBranchId.match(/\d+/);
        const branchIdInt = branchIdMatch ? parseInt(branchIdMatch[0], 10) : parseInt(activeBranchId, 10);
        
        console.log('[Menu] Fetching menu config for branch:', branchIdInt);
        
        // Fetch menu config which includes the public_menu_url
        const menuConfigData = await authFetch.fetch<any>(`/digital-menu/menu-config/by_branch/?branch_id=${branchIdInt}`);
        
        console.log('[Menu] Menu config response:', menuConfigData);
        
        // Handle both single object and array responses
        const configData = Array.isArray(menuConfigData) ? menuConfigData[0] : menuConfigData;
        
        if (configData && configData.public_menu_url) {
          console.log('[Menu] Using public menu URL from backend:', configData.public_menu_url);
          setPublicMenuUrl(configData.public_menu_url);
        } else {
          console.warn('[Menu] No public_menu_url in menu config response');
        }
      } catch (error) {
        console.error('[Menu] Error fetching public menu URL from backend:', error);
      }
    };

    fetchPublicMenuUrl();
  }, [activeBranchId]);

  const handleRemoveFromMenu = async (item: InventoryItem) => {
    try {
      // Remove from local database
      await db.inventory.update(item.id, { onMenu: false });
      
      // Remove from backend
      if (activeBranchId) {
        // Extract branch ID from string like "BRN-10" -> 10
        const branchIdMatch = activeBranchId.match(/\d+/);
        const branchIdInt = branchIdMatch ? parseInt(branchIdMatch[0], 10) : parseInt(activeBranchId, 10);
        
        await authFetch.fetch('/digital-menu/menu/remove_item/', {
          method: 'POST',
          body: JSON.stringify({
            branch_id: branchIdInt,
            inventory_item_id: item.id,
          }),
        });
        console.log('[Menu] Item removed from backend menu:', item.id);
      }
    } catch (error) {
      console.error('[Menu] Error removing item from menu:', error);
    }
  };
  
  if (!activeBranchId) {
    return (
        <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    )
  }

  return (
    <>
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Menu Builder</h1>
          <p className="text-muted-foreground">
            Manage the items that appear on your public customer-facing menu for the active branch.
          </p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={() => setAddModalOpen(true)}
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Item to Menu
          </Button>
          <Button
            variant="outline"
            onClick={() => setShareModalOpen(true)}
            disabled={!publicMenuUrl}
          >
            <QrCode className="mr-2 h-4 w-4" />
            Share Menu
          </Button>
        </div>
      </div>

      
      <Tabs defaultValue="menu" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="menu">Menu Items</TabsTrigger>
          <TabsTrigger value="config">
            <Settings className="mr-2 h-4 w-4" />
            Configuration
          </TabsTrigger>
          <TabsTrigger value="templates">
            <Download className="mr-2 h-4 w-4" />
            Print Templates
          </TabsTrigger>
        </TabsList>

        <TabsContent value="menu" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Current Menu</CardTitle>
              <CardDescription>
                These are the items currently visible to customers on your public menu page.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {menuItems.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {menuItems.map((item) => (
                    <MenuItemCard
                      key={item.id}
                      item={item}
                      onRemove={handleRemoveFromMenu}
                    />
                  ))}
                </div>
              ) : (
                <div
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 py-24 text-center cursor-pointer hover:bg-muted/50"
                  onClick={() => setAddModalOpen(true)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setAddModalOpen(true)}
                >
                  <Utensils className="h-16 w-16 text-muted-foreground/30" />
                  <h2 className="mt-6 text-xl font-semibold">Your menu is empty</h2>
                  <p className="mt-2 text-muted-foreground">
                    Click here to add your first sellable product to the menu.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="space-y-4">
          <MenuConfigTab activeBranchId={activeBranchId} />
        </TabsContent>

        <TabsContent value="templates" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Menu Templates</CardTitle>
              <CardDescription>
                Download professional menu templates ready for printing. Choose from various layouts and styles.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MenuTemplates menuItems={menuItems} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>QR Code Designs</CardTitle>
              <CardDescription>
                Download print-ready QR code designs that customers can scan to access your digital menu. Choose from multiple professional designs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <QRCodeTemplates publicMenuUrl={publicMenuUrl} businessName={businessName} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      
      <AddToMenuModal 
        isOpen={isAddModalOpen} 
        onOpenChange={setAddModalOpen} 
        availableItems={availableItems}
        activeBranchId={activeBranchId}
      />
      
      <ShareMenuModal
        isOpen={isShareModalOpen}
        onOpenChange={setShareModalOpen}
        publicMenuUrl={publicMenuUrl}
      />
    </>
  );
}
