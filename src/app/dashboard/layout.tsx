

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Boxes,
  LayoutDashboard,
  Package,
  Settings,
  ShoppingBag,
  Users,
  PlusCircle,
  Download,
  MoreHorizontal,
  ChevronDown,
  Search,
  Bell,
  Plus,
  FileText,
  Truck,
  Building,
  Printer,
  Archive,
  AlertTriangle,
  Pill,
  MonitorPlay,
  BarChart2,
  BookOpen,
  ClipboardList,
  ChefHat,
  Loader2,
  Edit,
  History,
  CreditCard,
  BookUser,
  FileSignature,
  ShieldCheck,
  Lock,
  PanelLeft,
  PanelRightOpen,
  UserCheck,
  Share2,
  Group,
  Utensils,
  RefreshCw,
  Trash2,
  CheckCircle2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useLiveQuery } from 'dexie-react-hooks';
import { format, parseISO, isBefore, addDays } from 'date-fns';

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarTrigger,
  SidebarFooter,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { HandyPosLogo } from '@/components/icons/logo';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { DashboardHeader } from '@/components/dashboard-header';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useSyncStatus } from '@/hooks/use-sync-status';
import { X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ThemeCustomizer } from '@/components/theme-customizer';

// Helper to remove auth sync items from queue
const removeAuthSyncItem = (itemId: string) => {
  const SYNC_QUEUE_KEY = 'handypos-sync-queue';
  try {
    // Remove from localStorage
    const stored = localStorage.getItem(SYNC_QUEUE_KEY);
    if (stored) {
      const queue = JSON.parse(stored);
      const filtered = queue.filter((item: any) => item.id !== itemId);
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(filtered));
      console.log('[SyncQueue] Removed auth item from persistent queue:', itemId);
    }
    
    // Also need to clear from authFetch's internal queue
    // Since we can't directly access authFetch's private queue, we'll mark it as cancelled
    // by storing a list of cancelled items
    const CANCELLED_KEY = 'handypos-cancelled-sync-items';
    const cancelled = JSON.parse(localStorage.getItem(CANCELLED_KEY) || '[]');
    if (!cancelled.includes(itemId)) {
      cancelled.push(itemId);
      localStorage.setItem(CANCELLED_KEY, JSON.stringify(cancelled));
    }
  } catch (e) {
    console.error('[SyncQueue] Failed to remove item from queue:', e);
  }
};

// Helper to clear all failed order sync items
const clearFailedOrders = () => {
  const SYNC_QUEUE_KEY = 'handypos-sync-queue';
  const CANCELLED_KEY = 'handypos-cancelled-sync-items';
  try {
    const stored = localStorage.getItem(SYNC_QUEUE_KEY);
    if (stored) {
      const queue = JSON.parse(stored);
      // Filter out all failed order items (POST to /sessions/orders/)
      const filtered = queue.filter((item: any) => 
        !item.url?.includes('/sessions/orders/') || item.error === undefined
      );
      
      // Add failed orders to cancelled list
      const failedOrders = queue.filter((item: any) => 
        item.url?.includes('/sessions/orders/') && item.error
      );
      
      const cancelled = JSON.parse(localStorage.getItem(CANCELLED_KEY) || '[]');
      failedOrders.forEach((order: any) => {
        if (!cancelled.includes(order.id)) {
          cancelled.push(order.id);
        }
      });
      
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(filtered));
      localStorage.setItem(CANCELLED_KEY, JSON.stringify(cancelled));
      console.log('[SyncQueue] Cleared', failedOrders.length, 'failed orders from queue');
    }
  } catch (e) {
    console.error('[SyncQueue] Failed to clear failed orders:', e);
  }
};
import { useAuth, type User } from '@/hooks/use-auth';
import { useRBAC } from '@/hooks/use-rbac';
import { useToast } from '@/hooks/use-toast';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { db, type Subscription, type InventoryItem, type PurchaseRecord } from '@/lib/db';
import { plans } from '@/lib/subscriptions';
import { cn } from '@/lib/utils';
import { PosModal } from '@/components/pos/pos-modal';
import { authFetch } from '@/lib/auth-fetch';

import type { Permission } from '@/lib/rbac/permissions';
import { hasPermission as checkPermission } from '@/lib/rbac/permissions';

const navItems = [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', permission: 'view_dashboard' as Permission },
    { href: '/dashboard/pos', icon: MonitorPlay, label: 'POS', permission: 'access_pos' as Permission },
    { href: '/dashboard/sessions', icon: History, label: 'Sessions', permission: 'view_sessions' as Permission },
    { href: '/dashboard/sales', icon: BarChart2, label: 'Reports', permission: 'view_reports' as Permission },
    { href: '/dashboard/expenses', icon: CreditCard, label: 'Expenses', permission: 'view_expenses' as Permission },
    { href: '/dashboard/inventory', icon: Boxes, label: 'Inventory', permission: 'view_inventory' as Permission },
    { href: '/dashboard/suppliers', icon: Truck, label: 'Suppliers', permission: 'view_suppliers' as Permission },
    { href: '/dashboard/staff', icon: Users, label: 'Staff', permission: 'manage_staff' as Permission },
];

const settingsNav = [
  { href: '/dashboard/settings', icon: Settings, label: 'Settings', permission: 'manage_settings' as Permission },
  { href: '/dashboard/audit', icon: UserCheck, label: 'Audit Log', permission: 'view_audit_log' as Permission },
];

const profileSchema = z.object({
  displayName: z.string().min(2, 'Display name must be at least 2 characters.'),
  email: z.string().email(),
});

type ProfileFormValues = z.infer<typeof profileSchema>;

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters.'),
  confirmPassword: z.string().min(1, 'Please confirm your password.'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
});

type PasswordFormValues = z.infer<typeof passwordSchema>;

function UserProfileModal({ user, isOpen, onOpenChange }: { user: User, isOpen: boolean, onOpenChange: (open: boolean) => void }) {
  const { login: updateUser } = useAuth();
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const getInitials = (value?: string) => {
    const text = (value || '').trim();
    if (!text) return 'U';

    const normalized = text.includes('@') ? text.split('@')[0] : text;
    const parts = normalized.replace(/[_\-.]+/g, ' ').split(/\s+/).filter(Boolean);

    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }

    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  };
  const userInitials = getInitials(user.displayName || user.email);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      displayName: user?.displayName || '',
      email: user?.email || '',
    },
  });

  const passwordForm = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  });
  
  const { reset } = form;
  const { reset: resetPasswordForm } = passwordForm;
  const canChangePassword = user.role === 'Admin';

  useEffect(() => {
    if (isOpen) {
      reset({
        displayName: user.displayName || '',
        email: user.email || '',
      });
      resetPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
    }
  }, [user, isOpen, reset, resetPasswordForm]);

  const onSubmit = (data: ProfileFormValues) => {
    setIsSaving(true);
    // Simulate API call
    setTimeout(() => {
      const updatedUserData = { ...user, ...data };
      updateUser(updatedUserData);
      setIsSaving(false);
      setIsEditing(false);
    }, 1000);
  };

  const onChangePassword = async (data: PasswordFormValues) => {
    if (!canChangePassword) {
      toast({
        variant: 'destructive',
        title: 'Permission denied',
        description: 'Only admins can change passwords.',
      });
      return;
    }

    setIsSavingPassword(true);
    try {
      await authFetch.fetch('/accounts/change-password/', {
        method: 'POST',
        body: JSON.stringify({
          current_password: data.currentPassword,
          new_password: data.newPassword,
          confirm_password: data.confirmPassword,
        }),
      });
      toast({
        title: 'Password updated',
        description: 'Your password has been changed successfully.',
      });
      resetPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });
      setIsChangingPassword(false);
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Password update failed',
        description: error?.message || 'Could not change password. Please try again.',
      });
    } finally {
      setIsSavingPassword(false);
    }
  };
  
  const handleOpenChange = (open: boolean) => {
      onOpenChange(open);
      if (!open) {
          setIsEditing(false); // Reset edit state when modal closes
          setIsChangingPassword(false);
      }
  }

  if (!user) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>My Profile</DialogTitle>
          <DialogDescription>
            {isEditing ? 'Edit your personal information.' : 'View your personal information.'}
          </DialogDescription>
        </DialogHeader>
        
        {isEditing ? (
          <FormProvider {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="flex flex-col items-center gap-4 py-4">
                <Avatar className="h-24 w-24">
                  <AvatarFallback className="text-2xl font-semibold">{userInitials}</AvatarFallback>
                </Avatar>
              </div>
              <FormField
                control={form.control}
                name="displayName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Display Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Your name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address</FormLabel>
                    <FormControl>
                      <Input placeholder="Your email" {...field} readOnly disabled />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="pt-4">
                <Button variant="ghost" onClick={() => setIsEditing(false)}>Cancel</Button>
                <Button type="submit" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </form>
          </FormProvider>
        ) : (
          <div>
            <div className="flex flex-col items-center gap-4 py-4">
              <Avatar className="h-24 w-24">
                <AvatarFallback className="text-2xl font-semibold">{userInitials}</AvatarFallback>
              </Avatar>
              <div className="text-center">
                <h2 className="text-xl font-semibold">{user.displayName || user.email}</h2>
                <p className="text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Role:</span>
                    <span className="font-medium">{user.role}</span>
                </div>
                <div className="flex justify-between">
                    <span className="text-muted-foreground">Branch:</span>
                    <span className="font-medium">Main Branch</span>
                </div>
                 <div className="flex justify-between">
                    <span className="text-muted-foreground">Last Login:</span>
                    <span className="font-medium">
                      {new Date().toLocaleString('en-US', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                </div>
            </div>
            {canChangePassword && (
              <div className="mt-6 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Change Password</p>
                    <p className="text-xs text-muted-foreground">Admin-only action</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsChangingPassword((prev) => !prev)}
                  >
                    {isChangingPassword ? 'Cancel' : 'Change'}
                  </Button>
                </div>
                {isChangingPassword && (
                  <FormProvider {...passwordForm}>
                    <form onSubmit={passwordForm.handleSubmit(onChangePassword)} className="mt-4 space-y-3">
                      <FormField
                        control={passwordForm.control}
                        name="currentPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Current Password</FormLabel>
                            <FormControl>
                              <Input type="password" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={passwordForm.control}
                        name="newPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>New Password</FormLabel>
                            <FormControl>
                              <Input type="password" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={passwordForm.control}
                        name="confirmPassword"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Confirm Password</FormLabel>
                            <FormControl>
                              <Input type="password" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="pt-2">
                        <Button type="submit" disabled={isSavingPassword}>
                          {isSavingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                          Update Password
                        </Button>
                      </div>
                    </form>
                  </FormProvider>
                )}
              </div>
            )}
            <DialogFooter className="pt-6">
              <Button variant="outline" className="w-full" onClick={() => setIsEditing(true)}>
                <Edit className="mr-2 h-4 w-4" /> Edit Profile
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const LOCAL_STORAGE_KEYS = {
    BRANCHES: 'handypos-branches',
    ACTIVE_BRANCH: 'handypos-active-branch',
    AUTH_TOKENS: 'handypos-auth-tokens',
    LEGACY_AUTH_TOKENS: 'handy-pos-auth-tokens',
};

type Branch = { id: string; name: string; address: string; };

const getInitialBranches = (): Branch[] => {
    if (typeof window === 'undefined') {
        return [{ id: 'main', name: 'Main Branch', address: '' }];
    }

    let branches: Branch[];
    try {
        const storedBranches = localStorage.getItem(LOCAL_STORAGE_KEYS.BRANCHES);
        branches = storedBranches ? JSON.parse(storedBranches) : [];
    } catch (e) {
        branches = [];
        console.error("Failed to parse branches from localStorage", e);
    }
    
    if (branches.length === 0) {
        const defaultBranch = { id: 'main', name: 'Main Branch', 'address': '123 Default Street' };
        branches = [defaultBranch];
        localStorage.setItem(LOCAL_STORAGE_KEYS.BRANCHES, JSON.stringify(branches));
    }

    return branches;
};

const normalizePath = (path: string): string => {
  if (!path) return '/';
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
};

const isNavItemActive = (pathname: string, href: string): boolean => {
  const currentPath = normalizePath(pathname);
  const targetPath = normalizePath(href);

  if (targetPath === '/dashboard') {
    return currentPath === '/dashboard';
  }

  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`);
};


function SyncQueueDropdown({ branchId }: { branchId: string | null }) {
  const [syncQueue, setSyncQueue] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { dirtyRecords } = useSyncStatus(branchId);

  useEffect(() => {
    const updateQueue = () => {
      // Get list of cancelled items
      const CANCELLED_KEY = 'handypos-cancelled-sync-items';
      const cancelled = JSON.parse(localStorage.getItem(CANCELLED_KEY) || '[]');
      
      // Authenticated request queue (settings, sessions, etc.)
      const status = authFetch.getSyncQueueStatus();
      const authItems = (status.items || [])
        .filter((item: any) => !cancelled.includes(item.id)) // Filter out cancelled items
        .map((item: any) => {
          // Extract entity type from metadata or URL
          const entityType = item.entityType || item.domain || 'item';
          const entityId = item.entityId || item.url?.split('/').pop() || 'unknown';
          
          return {
            source: 'auth',
            id: item.id,
            method: item.method,
            url: item.url,
            retries: item.retries,
            error: item.error,
            entityType,
            entityId,
            domain: item.domain,
          };
        });

      // Map dirty records to display format
      const dirtyItems = (dirtyRecords || []).map((record: any) => {
        const operationMap: { [key: string]: string } = {
          'create': 'POST',
          'update': 'PUT',
          'delete': 'DELETE',
        };
        
        return {
          source: 'dirty',
          id: record.id,
          method: operationMap[record.operation] || 'UPDATE',
          url: `/api/inventory/${record.type.toLowerCase()}/${record.id}`,
          retries: 0,
          error: null,
          entityType: record.type,
          entityId: record.id,
          name: record.name,
        };
      });

      setSyncQueue([...dirtyItems, ...authItems]);
    };

    updateQueue();
    const interval = setInterval(updateQueue, 1000);
    return () => clearInterval(interval);
  }, [dirtyRecords, branchId]);

  const getActionLabel = (item: any) => {
    const action = item.method?.toUpperCase() || 'UNKNOWN';
    
    // Get entity type label
    let entityLabel = 'Item';
    if (item.entityType) {
      entityLabel = item.entityType;
    } else if (item.domain) {
      entityLabel = item.domain.charAt(0).toUpperCase() + item.domain.slice(1);
    }
    
    // Get entity ID or name
    const entityId = item.entityId || item.url?.split('/').pop() || 'unknown';
    const shortId = entityId.length > 12 ? entityId.substring(0, 12) + '...' : entityId;
    
    return `${action} ${entityLabel} (${shortId})`;
  };

  const getActionIcon = (item: any) => {
    const method = item.method?.toUpperCase();
    switch (method) {
      case 'POST':
        return <Plus className="h-4 w-4 text-green-600" />;
      case 'PUT':
      case 'PATCH':
        return <Edit className="h-4 w-4 text-blue-600" />;
      case 'DELETE':
        return <Trash2 className="h-4 w-4 text-red-600" />;
      default:
        return <RefreshCw className="h-4 w-4 text-gray-600" />;
    }
  };

  const handleRemoveItem = (item: any) => {
    if (item.source === 'auth') {
      // For auth items, completely remove from persistent queue
      console.log('[SyncQueue] Completely removing auth item from queue:', item.id);
      removeAuthSyncItem(item.id);
      // Update local state
      setSyncQueue(prev => prev.filter(i => i.id !== item.id));
    }
  };

  if (syncQueue.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <p>All changes synced ✓</p>
      </div>
    );
  }

  return (
    <div className="max-h-96 overflow-y-auto">
      <DropdownMenuLabel className="px-2 py-1.5">Pending Sync ({syncQueue.length})</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {syncQueue.map((item, index) => (
        <div key={item.id || index} className="px-2 py-2 hover:bg-accent rounded-sm text-sm group">
          <div className="flex items-center gap-2">
            {getActionIcon(item)}
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{getActionLabel(item)}</p>
              <p className="text-xs text-muted-foreground truncate">{item.url}</p>
              {item.error && (
                <p className="text-xs text-destructive mt-1">Error: {item.error}</p>
              )}
            </div>
            <div className="flex items-center gap-1">
              {item.retries > 0 && (
                <Badge variant="outline" className="text-xs">
                  Retry {item.retries}
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleRemoveItem(item)}
                title="Remove from queue"
              >
                <X className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}


function Header() {
  const { user, logout, business } = useAuth();
  const router = useRouter();
  const [isProfileModalOpen, setProfileModalOpen] = useState(false);
  const subscription = useLiveQuery(() => db.subscriptions.get('sub_main-business'));
  const { toggleSidebar } = useSidebar();

  // Debug: log user object
  useEffect(() => {
    console.log('[DEBUG HEADER] User object:', user);
  }, [user]);
  
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [activeBranch, setActiveBranch] = useState<Branch | null>(null);
  const [isPosModalOpen, setIsPosModalOpen] = useState(false);
  const [selectedExpiryBatch, setSelectedExpiryBatch] = useState<PurchaseRecord | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [businessName, setBusinessName] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('handypos-business-name');
      return cached || 'Mwaka POS';
    }
    return 'Mwaka POS';
  });
  const businessNameLoadedRef = React.useRef(false);
  const { pendingCount } = useSyncStatus(activeBranchId);

  const isProPlan = subscription?.planId === 'pro' || subscription?.status === 'active' || !subscription;

  // Load business name from IndexedDB - only once
  useEffect(() => {
    if (business?.id && !businessNameLoadedRef.current) {
      businessNameLoadedRef.current = true;
      const loadBusinessName = async () => {
        const businessData = await db.business.get(business.id);
        if (businessData?.name) {
          setBusinessName(businessData.name);
          localStorage.setItem('handypos-business-name', businessData.name);
        }
      };
      loadBusinessName();
    }
  }, [business?.id]);

  // Monitor sync queue handled by useSyncStatus
  // Clear failed orders on mount
  useEffect(() => {
    clearFailedOrders();
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
        const allBranches = getInitialBranches();
        setBranches(allBranches);

        const storedActiveBranchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
        const branchId = storedActiveBranchId || allBranches[0]?.id || null;
        setActiveBranchId(branchId);
        
        const active = allBranches.find(b => b.id === branchId) || allBranches[0] || { id: 'main', name: 'Main Branch', address: '' };
        setActiveBranch(active);

        // Listen for branches updated event
        const handleBranchesUpdated = (event: Event) => {
            const customEvent = event as CustomEvent;
            const updatedBranches = customEvent.detail?.branches;
            if (updatedBranches && Array.isArray(updatedBranches)) {
                console.log('[Header] Branches updated event received:', updatedBranches);
                setBranches(updatedBranches);
            }
        };

        window.addEventListener('branchesUpdated', handleBranchesUpdated);
        return () => window.removeEventListener('branchesUpdated', handleBranchesUpdated);
    }
  }, []);

  const lowStockItems = useLiveQuery(
    () => activeBranchId ? db.inventory
      .where({ branchId: activeBranchId, itemType: 'ingredient' })
      .and(item => (item.stockUnits || 0) <= (item.reorderLevel || 0))
      .toArray() : [],
    [activeBranchId]
  ) || [];

  const expiringItems = useLiveQuery(
    () => {
        if (!activeBranchId) return [];
        const ninetyDaysFromNow = addDays(new Date(), 90).toISOString();
        return db.purchaseHistory
            .where('branchId').equals(activeBranchId)
            .and(item => !!item.expiryDate && item.expiryDate <= ninetyDaysFromNow && isBefore(new Date(), parseISO(item.expiryDate)) && item.quantityRemaining > 0)
            .toArray();
    },
    [activeBranchId]
  ) || [];

  const totalNotifications = lowStockItems.length + expiringItems.length;

  

  const handleSetBranch = (branch: Branch) => {
    setActiveBranchId(branch.id);
    setActiveBranch(branch);
    localStorage.setItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH, branch.id);
    
    console.log('[Header] Branch switched to:', branch.name, '- Reloading page');
    
    // Reload the entire page to refresh all data for the new branch
    window.location.reload();
  };

  const handleLogout = () => {
    logout();
    router.push('/login');
  };
  
  if (!user) {
      return (
          <DashboardHeader>
              <div className="flex items-center gap-4">
                  <SidebarTrigger />
                  <div className="hidden lg:flex items-center gap-2">
                  <h1 className="text-xl font-semibold">Mwaka POS</h1>
                  <div className="w-48 h-9 bg-muted rounded-md animate-pulse" />
                  </div>
              </div>
              <div className="flex flex-1 items-center justify-end gap-2 md:gap-4">
                  <div className="hidden w-full max-w-sm lg:block h-10 bg-muted rounded-md animate-pulse" />
              </div>
          </DashboardHeader>
      );
  }

  return (
    <>
      <DashboardHeader branchId={activeBranchId}>
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={toggleSidebar}
          >
            <PanelLeft />
            <span className="sr-only">Toggle Sidebar</span>
          </Button>
          <div className="hidden lg:flex items-center gap-2">
            <h1 className="text-xl font-semibold">{businessName}</h1>
            {user.role === 'Admin' ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-1"
                  >
                    {activeBranch?.name || 'Select Branch'}
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuLabel>Switch Branch</DropdownMenuLabel>
                  {branches.length > 0 ? (
                    branches.map((branch) => (
                      <DropdownMenuItem
                        key={branch.id}
                        onSelect={() => handleSetBranch(branch)}
                      >
                        {branch.name}
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>
                      No branches configured
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Badge variant="secondary">
                {activeBranch?.name}
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-1 items-center justify-end gap-2 md:gap-4">
          {/* Search field - commented out
          {user.role !== 'Cashier' && (
            <div className="hidden w-full max-w-sm lg:block">
              <form>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    className="w-full bg-background/50 pl-10"
                    placeholder="Search products, customers, orders..."
                  />
                </div>
              </form>
            </div>
          )}
          */}

          <div className="flex items-center gap-1">
            <Button size="sm" onClick={() => setIsPosModalOpen(true)}>
                <MonitorPlay className="mr-2 h-4 w-4" /> POS
            </Button>

            {user.role !== 'Cashier' && (
              <div className="hidden sm:flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="relative"
                      title={pendingCount > 0 ? `${pendingCount} queued action${pendingCount !== 1 ? 's' : ''}` : 'Sync status'}
                    >
                      <RefreshCw className={cn("h-4 w-4", isSyncing && "animate-spin")} />
                      {pendingCount > 0 && (
                        <Badge
                          className="absolute top-1 right-1 h-4 w-4 justify-center p-0 text-[10px]"
                          variant="secondary"
                        >
                          {pendingCount}
                        </Badge>
                      )}
                      <span className="sr-only">Sync status</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-80">
                    <SyncQueueDropdown branchId={activeBranchId} />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                  <Bell />
                  {totalNotifications > 0 && (
                    <Badge
                      className="absolute top-1 right-1 h-4 w-4 justify-center p-0 text-[10px]"
                      variant="destructive"
                    >
                      {totalNotifications}
                    </Badge>
                  )}
                  <span className="sr-only">Notifications</span>
                </Button>
              </SheetTrigger>
              <SheetContent className="tauri-android-sidebar-safe-top">
                <SheetHeader>
                  <SheetTitle>Notifications & Alerts</SheetTitle>
                  <SheetDescription>
                    You have {totalNotifications} new critical alerts.
                  </SheetDescription>
                </SheetHeader>
                <div className="mt-4 space-y-4">
                  {lowStockItems.map((item) => (
                    <div key={`low-${item.id}`} className="flex items-start gap-3 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3">
                      <div className="mt-1 flex h-5 w-5 items-center justify-center rounded-full bg-yellow-500/20 text-yellow-600">
                        <AlertTriangle className="h-3 w-3" />
                      </div>
                      <div>
                        <p className="font-semibold text-sm">
                          Low Stock: {item.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Only {item.stockUnits} {item.unitType} remaining. Reorder level is {item.reorderLevel}.
                        </p>
                        <Button size="xs" variant="outline" className="mt-2 text-xs h-7">
                          Create Purchase Order
                        </Button>
                      </div>
                    </div>
                  ))}
                  {expiringItems.map((item) => (
                     <div key={`exp-${item.id}`} className="flex items-start gap-3 rounded-lg border border-orange-500/50 bg-orange-500/10 p-3">
                        <div className="mt-1 flex h-5 w-5 items-center justify-center rounded-full bg-orange-500/20 text-orange-600">
                            <Pill className="h-3 w-3" />
                        </div>
                        <div>
                            <p className="font-semibold text-sm">Batch Expiring Soon</p>
                            <p className="text-xs text-muted-foreground">
                                {item.productName} (Batch: {item.batchNumber || 'N/A'}) expires on {item.expiryDate ? format(parseISO(item.expiryDate), 'PP') : 'N/A'}.
                            </p>
                             <Button
                               size="xs"
                               variant="outline"
                               className="mt-2 text-xs h-7"
                               onClick={() => setSelectedExpiryBatch(item)}
                             >
                               View Batch
                             </Button>
                        </div>
                    </div>
                  ))}
                   {totalNotifications === 0 && (
                       <div className="text-center text-muted-foreground py-10">
                           <p>No new notifications.</p>
                       </div>
                   )}
                </div>
              </SheetContent>
            </Sheet>
            <Dialog
              open={Boolean(selectedExpiryBatch)}
              onOpenChange={(open) => {
                if (!open) {
                  setSelectedExpiryBatch(null);
                }
              }}
            >
              <DialogContent className="max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Batch Details</DialogTitle>
                  <DialogDescription>
                    Expiry alert details for the selected batch.
                  </DialogDescription>
                </DialogHeader>
                {selectedExpiryBatch && (
                  <div className="grid gap-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Product</span>
                      <span className="font-medium text-right">{selectedExpiryBatch.productName}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Batch No.</span>
                      <span className="font-medium text-right">{selectedExpiryBatch.batchNumber || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Expiry Date</span>
                      <span className="font-medium text-right">
                        {selectedExpiryBatch.expiryDate
                          ? format(parseISO(selectedExpiryBatch.expiryDate), 'PP')
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Quantity Remaining</span>
                      <span className="font-medium text-right">{selectedExpiryBatch.quantityRemaining}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Received Date</span>
                      <span className="font-medium text-right">
                        {selectedExpiryBatch.receivedDate
                          ? format(parseISO(selectedExpiryBatch.receivedDate), 'PP')
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Supplier</span>
                      <span className="font-medium text-right">{selectedExpiryBatch.supplierName || 'N/A'}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">Cost Per Unit</span>
                      <span className="font-medium text-right">{selectedExpiryBatch.costPerUnit}</span>
                    </div>
                  </div>
                )}
                <DialogFooter className="pt-4">
                  <Button asChild variant="outline">
                    <Link href="/dashboard/inventory?tab=purchases">Go to Purchases</Link>
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <div className="sm:hidden">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem>
                    <PlusCircle className="mr-2" />
                    New Sale
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Search className="mr-2" />
                    Search
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="relative h-10 w-10 rounded-full"
              >
                <Avatar className="h-9 w-9 bg-primary text-primary-foreground">
                  <AvatarFallback className="font-semibold">
                    {(user?.displayName || user?.email || 'U')
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase()
                      .slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="flex items-center gap-3 px-2 py-3">
                <Avatar className="h-10 w-10 bg-primary text-primary-foreground">
                  <AvatarFallback className="font-semibold">
                    {(user?.displayName || user?.email || 'U')
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase()
                      .slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {user?.displayName || 'User'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {user?.email}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {user?.role}
                  </p>
                </div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setProfileModalOpen(true)}>
                Profile
              </DropdownMenuItem>
              {user.role === 'Admin' && (
                <>
                  {/* <DropdownMenuItem asChild>
                    <Link href="/dashboard/settings/billing">Billing</Link>
                  </DropdownMenuItem> */}
                  <DropdownMenuItem asChild>
                    <Link href="/dashboard/settings">Settings</Link>
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout}>Log out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </DashboardHeader>
      {user && (
        <UserProfileModal
          user={user}
          isOpen={isProfileModalOpen}
          onOpenChange={setProfileModalOpen}
        />
      )}
      {activeBranchId && (
        <PosModal
          branchId={activeBranchId}
          isOpen={isPosModalOpen}
          onOpenChange={setIsPosModalOpen}
        />
      )}
    </>
  );
}


function NavGroup({ title, items, userRole, onPosClick }: { title: string, items: typeof settingsNav, userRole: User['role'], onPosClick?: () => void }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const { hasPermission } = useRBAC();
  
  // Restrict Cashier and Waiter to only see Point of Sale section
  const isCashierOrWaiter = userRole === 'Cashier' || userRole === 'Waiter';
  if (isCashierOrWaiter && title !== 'Point of Sale' && title !== 'Settings') {
    return null;
  }
  
  const filteredItems = items.filter(item => hasPermission(item.permission));

  if (filteredItems.length === 0) {
    return null;
  }
  
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') {
        const branchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
        if(branchId) setActiveBranchId(branchId);
    }
  }, []);

  const pendingStockAudits = useLiveQuery(
    () => {
      if (!activeBranchId) return 0;
      return db.stockTakes.where({ branchId: activeBranchId, status: 'Pending Approval' }).count()
    },
    [activeBranchId]
  );

  const pendingExpenses = useLiveQuery(
    () => {
      if (!activeBranchId) return 0;
      return db.expenses.where({ branchId: activeBranchId, status: 'Pending' }).count()
    },
    [activeBranchId]
  );
  
  const totalPending = (pendingStockAudits || 0) + (pendingExpenses || 0);

  return (
    <div>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider group-data-[collapsible=icon]:text-center group-data-[collapsible=icon]:[writing-mode:vertical-rl] group-data-[collapsible=icon]:mb-2">{title}</h3>
        <SidebarMenu>
        {filteredItems.map((item) => {
            const isActive = isNavItemActive(pathname, item.href);

            const handleClick = () => {
              setOpenMobile(false);
              if (item.href === '/dashboard/pos' && onPosClick) {
                onPosClick();
              }
            };

            return (
            <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                asChild={item.href !== '/dashboard/pos'}
                isActive={isActive}
                tooltip={item.label}
                aria-current={isActive ? "page" : undefined}
                onClick={handleClick}
                >
                {item.href === '/dashboard/pos' ? (
                  <button className="flex justify-between items-center w-full">
                    <div className="flex items-center gap-3">
                        <item.icon />
                        <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                    </div>
                  </button>
                ) : (
                  <Link href={item.href} className="flex justify-between items-center w-full">
                    <div className="flex items-center gap-3">
                        <item.icon />
                        <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                    </div>
                    {item.href === '/dashboard/approvals' && totalPending > 0 && (
                        <Badge className="h-5 group-data-[collapsible=icon]:hidden">{totalPending}</Badge>
                    )}
                  </Link>
                )}
                </SidebarMenuButton>
            </SidebarMenuItem>
            );
        })}
        </SidebarMenu>
    </div>
  )
}

function AppSidebar({ user, onPosClick }: { user: User, onPosClick?: () => void }) {
  const pathname = usePathname();
  const { hasPermission } = useRBAC();
  const { setOpenMobile } = useSidebar();

  const filteredItems = navItems.filter(item => hasPermission(item.permission));
  const filteredSettingsItems = user.role === 'Admin'
    ? settingsNav.filter(item => hasPermission(item.permission))
    : [];

  return (
    <>
      <SidebarHeader className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 group-data-[collapsible=icon]:hidden">
            <HandyPosLogo className="size-8" />
            <span className="text-lg font-semibold">Mwaka POS</span>
          </div>
          <SidebarTrigger className="hidden lg:block" />
        </div>
      </SidebarHeader>

      <SidebarContent className="flex-1 p-2">
        <SidebarMenu>
          {filteredItems.map((item) => {
            const isActive = isNavItemActive(pathname, item.href);

            const handleClick = () => {
              setOpenMobile(false);
              if (item.href === '/dashboard/pos' && onPosClick) {
                onPosClick();
              }
            };

            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild={item.href !== '/dashboard/pos'}
                  isActive={isActive}
                  tooltip={item.label}
                  aria-current={isActive ? "page" : undefined}
                  onClick={handleClick}
                >
                  {item.href === '/dashboard/pos' ? (
                    <button className="flex items-center gap-3">
                      <item.icon />
                      <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                    </button>
                  ) : (
                    <Link href={item.href} className="flex items-center gap-3">
                      <item.icon />
                      <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                    </Link>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarMenu>
          {filteredSettingsItems.map((item) => {
            const isActive = isNavItemActive(pathname, item.href);

            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  tooltip={item.label}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Link href={item.href} className="flex items-center gap-3">
                    <item.icon />
                    <span className="group-data-[collapsible=icon]:hidden">{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarFooter>
    </>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [isPosModalOpen, setIsPosModalOpen] = useState(false);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;

    const rawTokens =
      localStorage.getItem(LOCAL_STORAGE_KEYS.AUTH_TOKENS) ??
      localStorage.getItem(LOCAL_STORAGE_KEYS.LEGACY_AUTH_TOKENS);

    let hasValidTokens = false;
    if (rawTokens) {
      try {
        const parsedTokens = JSON.parse(rawTokens);
        hasValidTokens = Boolean(parsedTokens?.access && parsedTokens?.refresh);
      } catch {
        hasValidTokens = false;
      }
    }

    if (!user || !hasValidTokens) {
      if (user || hasValidTokens) {
        logout();
      }
      router.replace('/login');
    }
  }, [user, loading, logout, router]);

  useEffect(() => {
    if (user && user.branchId) {
        if (typeof window !== 'undefined') {
            const storedActiveBranch = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
            if (user.role !== 'Admin' && storedActiveBranch !== user.branchId) {
                localStorage.setItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH, user.branchId);
                window.location.reload();
            }
        }
    }
  }, [user]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
        const branchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
        setActiveBranchId(branchId);
    }
  }, []);

  useEffect(() => {
    if (user) {
        const accessibleRoutes = [...navItems, ...settingsNav]
            .filter(item => checkPermission(user.role, item.permission))
            .map(item => item.href);
        
        // Allow access to the base dashboard page
        if (pathname === '/dashboard') return;

        // Only enforce redirects when we have a non-empty set of accessible routes
        if (accessibleRoutes.length > 0 && !accessibleRoutes.some(route => pathname.startsWith(route))) {
            // If current route is not accessible, redirect to a default page for that role
            const roleStr = (user.role ?? 'Admin').toLowerCase();
            if (roleStr === 'cashier' || roleStr === 'waiter') {
                router.replace('/dashboard/pos');
            } else {
                router.replace('/dashboard');
            }
        }
    }
  }, [user, pathname, router]);

  if (loading || !user) {
    return (
        <div className="flex h-screen items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="flex h-screen w-full">
        <Sidebar className="hidden lg:flex lg:flex-col">
           <AppSidebar user={user} onPosClick={() => setIsPosModalOpen(true)} />
        </Sidebar>
        <div className="flex-1 flex flex-col overflow-y-auto">
          <Header />
          <main className="flex-1 bg-background/95 p-4 sm:p-6 w-full">
            {children}
          </main>
        </div>
      </div>
      {activeBranchId && (
        <PosModal
          branchId={activeBranchId}
          isOpen={isPosModalOpen}
          onOpenChange={setIsPosModalOpen}
        />
      )}
      <ThemeCustomizer />
    </SidebarProvider>
  );
}
