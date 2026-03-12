

'use client';

import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { MoreHorizontal, PlusCircle, Edit, Trash2, User, Loader2 } from 'lucide-react';

import { db, type Staff, type Subscription } from '@/lib/db';
import { authFetch } from '@/lib/auth-fetch';
import { useAuth } from '@/hooks/use-auth';
interface SubscriptionFeature {
  id: number;
  feature: number;
  feature_name: string;
  feature_price: number;
  enabled: boolean;
  feature_id?: number;
}
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
    FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';

const LOCAL_STORAGE_KEYS = {
    BRANCHES: 'handypos-branches',
    ACTIVE_BRANCH: 'handypos-active-branch',
    BUSINESS_SETTINGS: 'handypos-business-settings',
};

const STAFF_LIMIT = 5;

type Branch = { id: string; name: string; address: string; backendId?: string; };

const normalizeBranchId = (value: unknown): string => {
    const raw = String(value ?? '').trim();
    if (!raw) {
        return '';
    }

    const legacyMatch = /^(?:BRN|branch)-(.+)$/i.exec(raw);
    if (legacyMatch?.[1]) {
        return legacyMatch[1];
    }

    return raw;
};

const createStaffSchema = (includeWaiter: boolean) => {
    const roles = includeWaiter
        ? ['Admin', 'Manager', 'Cashier', 'Waiter'] as const
        : ['Admin', 'Manager', 'Cashier'] as const;
    
    return z.object({
        name: z.string().min(2, "Name is required."),
        email: z.string().email("Invalid email address."),
        password: z.string().min(6, "Password must be at least 6 characters.").optional().or(z.literal('')),
        role: z.enum(roles),
        branch: z.string().min(1, "Branch is required."),
        isFuelAttendant: z.boolean().default(false),
    });
};

type StaffFormValues = z.infer<ReturnType<typeof createStaffSchema>>;

const StaffForm = ({
  onFormSubmit,
  defaultValues,
  branches,
  canCreate,
  staffLimit,
}: {
  onFormSubmit: () => void;
  defaultValues?: Partial<Staff>;
  branches: Branch[];
  canCreate: boolean;
  staffLimit: number;
}) => {
    const [isLoading, setIsLoading] = useState(false);
    const [backendBranches, setBackendBranches] = useState<Branch[]>(branches);
    const [currentBranchId, setCurrentBranchId] = useState<string>('');
    // Hide Waiter option entirely (new + edit).
    const includeWaiter = false;
    const staffSchema = createStaffSchema(includeWaiter);
    const defaultRole =
        defaultValues?.role === 'Waiter' ? 'Cashier' : (defaultValues?.role as any);
    
    // Fetch branches from backend first, fallback to frontend
    useEffect(() => {
        const fetchBranches = async () => {
            try {
                console.log('[StaffForm] Fetching branches from backend');
                const response = await authFetch.fetch<any>('/business/branches/');
                
                // Handle paginated or direct response
                const branchesData = response?.results || response?.data || response || [];
                
                if (Array.isArray(branchesData) && branchesData.length > 0) {
                    console.log('[StaffForm] Fetched', branchesData.length, 'branches from backend');
                    
                    // Map backend branches to frontend format
                    const mappedBranches: Branch[] = branchesData.map((b: any) => ({
                        id: normalizeBranchId(b.id),
                        name: b.name || '',
                        address: b.address || '',
                        backendId: String(b.id),
                    }));
                    
                    setBackendBranches(mappedBranches);
                } else {
                    console.log('[StaffForm] No branches from backend, using frontend branches');
                    setBackendBranches(branches);
                }
            } catch (error) {
                console.error('[StaffForm] Error fetching branches from backend:', error);
                console.log('[StaffForm] Falling back to frontend branches');
                setBackendBranches(branches);
            }
        };
        
        fetchBranches();
    }, [branches]);
    
    // Get current branch from localStorage
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const activeBranch = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
            setCurrentBranchId(normalizeBranchId(activeBranch));
            console.log('[StaffForm] Current branch ID:', activeBranch);
        }
    }, []);
    
    const form = useForm<StaffFormValues>({
        resolver: zodResolver(staffSchema),
        defaultValues: {
            name: defaultValues?.name || '',
            email: defaultValues?.email || '',
            password: '',
            role: defaultRole || 'Cashier',
            branch: normalizeBranchId(defaultValues?.branchId) || currentBranchId || '',
            isFuelAttendant: defaultValues?.isFuelAttendant ?? false,
        },
    });
    const selectedRole = form.watch('role');
    const isFuelAttendant = form.watch('isFuelAttendant');
    
    // Update branch field when currentBranchId changes (for new staff)
    useEffect(() => {
        if (!defaultValues?.id && currentBranchId) {
            form.setValue('branch', normalizeBranchId(currentBranchId));
        }
    }, [currentBranchId, defaultValues?.id, form]);

    useEffect(() => {
        if (selectedRole !== 'Cashier' && isFuelAttendant) {
            form.setValue('isFuelAttendant', false);
        }
    }, [selectedRole, isFuelAttendant, form]);

    const onSubmit = async (data: StaffFormValues) => {
        if (!defaultValues?.id && !canCreate) {
            toast({
                title: 'Staff limit reached',
                description: `You can only have up to ${staffLimit} staff members.`,
                variant: 'destructive',
            });
            return;
        }

        setIsLoading(true);
        try {
            const normalizedBranchId = normalizeBranchId(data.branch);
            const apiBranchId = Number.parseInt(normalizedBranchId, 10);
            if (Number.isNaN(apiBranchId)) {
                throw new Error('Invalid branch selected. Please choose a valid branch.');
            }
            if (defaultValues?.id) {
                // Update existing staff
                const updateData: Record<string, any> = {
                    name: data.name,
                    email: data.email,
                    role: data.role,
                    branch: apiBranchId,
                    is_fuel_attendant: Boolean(data.isFuelAttendant),
                };
                if (data.password && String(data.password).trim()) {
                    updateData.password = data.password;
                }
                const updatedStaff = await authFetch.fetch(`/staff/${defaultValues.id}/`, {
                    method: 'PATCH',
                    body: JSON.stringify(updateData),
                });
                await db.staff.update(defaultValues.id, {
                    name: updatedStaff?.name ?? data.name,
                    email: updatedStaff?.email ?? data.email,
                    role: updatedStaff?.role ?? data.role,
                    branchId: normalizeBranchId(updatedStaff?.branch ?? normalizedBranchId),
                    assignedProductType:
                        (updatedStaff?.assigned_product_type ??
                            updatedStaff?.assignedProductType) ||
                        undefined,
                    isFuelAttendant:
                        updatedStaff?.is_fuel_attendant ??
                        updatedStaff?.isFuelAttendant ??
                        Boolean(data.isFuelAttendant),
                });
                toast({ title: 'Staff member updated successfully' });
            } else {
                // Create new staff
                const createData = {
                    name: data.name,
                    email: data.email,
                    password: data.password,
                    role: data.role,
                    branch: apiBranchId,
                    is_fuel_attendant: Boolean(data.isFuelAttendant),
                };
                const newStaff = await authFetch.fetch('/staff/', {
                    method: 'POST',
                    body: JSON.stringify(createData),
                });
                // Some backends may return 201 with numeric id, others may return null; guard appropriately
                const newId = newStaff?.id ?? crypto.randomUUID();
                await db.staff.add({
                    id: String(newId),
                    name: newStaff?.name ?? data.name,
                    email: newStaff?.email ?? data.email,
                    role: newStaff?.role ?? data.role,
                    branchId: normalizeBranchId(newStaff?.branch ?? normalizedBranchId),
                    assignedProductType:
                        (newStaff?.assigned_product_type ??
                            newStaff?.assignedProductType) ||
                        undefined,
                    isFuelAttendant:
                        newStaff?.is_fuel_attendant ??
                        newStaff?.isFuelAttendant ??
                        Boolean(data.isFuelAttendant),
                });
                toast({ title: 'Staff member added successfully' });
            }
            onFormSubmit();
        } catch (error) {
            console.error('Error:', error);
            toast({ 
                title: 'Error', 
                description: error instanceof Error ? error.message : 'An error occurred',
                variant: 'destructive'
            });
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl><Input {...field} /></FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
                <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl><Input type="email" {...field} /></FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
                 <FormField control={form.control} name="password" render={({ field }) => (
                    <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl><Input type="password" {...field} /></FormControl>
                        <FormMessage />
                    </FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="role" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Role</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Select a role" /></SelectTrigger></FormControl>
                                <SelectContent>
                                    <SelectItem value="Admin">Administrator</SelectItem>
                                    <SelectItem value="Manager">Manager</SelectItem>
                                    <SelectItem value="Cashier">Cashier</SelectItem>
                                    {includeWaiter && <SelectItem value="Waiter">Waiter</SelectItem>}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )} />
                     <FormField control={form.control} name="branch" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Branch <span className="text-red-500">*</span></FormLabel>
                             <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl><SelectTrigger><SelectValue placeholder="Select a branch" /></SelectTrigger></FormControl>
                                <SelectContent>
                                    {backendBranches.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )} />
                </div>
                {selectedRole === 'Cashier' && (
                    <FormField
                        control={form.control}
                        name="isFuelAttendant"
                        render={({ field }) => (
                            <FormItem className="flex items-center justify-between rounded-md border px-3 py-2">
                                <div className="space-y-0.5">
                                    <FormLabel>Fuel Attendant</FormLabel>
                                    <FormDescription>
                                        Enable if this cashier sells only fuel products.
                                    </FormDescription>
                                </div>
                                <FormControl>
                                    <Switch
                                        checked={Boolean(field.value)}
                                        onCheckedChange={field.onChange}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                )}
                <DialogFooter>
                    <Button type="submit" disabled={isLoading || (!defaultValues?.id && !canCreate)}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {defaultValues?.id ? 'Save Changes' : (canCreate ? 'Add Staff Member' : 'Staff Limit Reached')}
                    </Button>
                </DialogFooter>
            </form>
        </Form>
    );
};

export default function StaffPage() {
  const { user } = useAuth();
  const [isFormOpen, setFormOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | undefined>(undefined);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [isLoadingStaff, setIsLoadingStaff] = useState(true);
  const [branches, setBranches] = useState<Branch[]>([]);
  const frontendSubscription = useLiveQuery(() => db.subscriptions.get('sub_main-business'));
  const [subscription, setSubscription] = useState<Subscription | undefined>(undefined);
  const [subscriptionFeatures, setSubscriptionFeatures] = useState<SubscriptionFeature[]>([]);

  // Fetch staff from backend
  useEffect(() => {
    const fetchStaffFromBackend = async () => {
      setIsLoadingStaff(true);
      try {
        console.log('[Staff Page] Fetching staff from backend');
        const response = await authFetch.fetch<any>('/staff/');
        
        console.log('[Staff Page] Backend staff response:', response);
        
        // Handle paginated or direct response
        const staffData = response?.results || response?.data || response || [];
        
        if (Array.isArray(staffData) && staffData.length > 0) {
          console.log('[Staff Page] Fetched', staffData.length, 'staff members from backend');
          
          // Map backend staff to frontend format and sync to local DB
          const mappedStaff: Staff[] = staffData.map((s: any) => ({
            id: String(s.id),
            name: s.name || '',
            email: s.email || '',
            role: s.role || 'Cashier',
            branchId: normalizeBranchId(s.branch || s.branchId || ''),
            assignedProductType: s.assigned_product_type ?? s.assignedProductType ?? undefined,
            isFuelAttendant: s.is_fuel_attendant ?? s.isFuelAttendant ?? false,
            password: '',
          }));
          
          // Sync to local DB
          await db.staff.clear();
          await db.staff.bulkAdd(mappedStaff);
          
          setStaffList(mappedStaff);
        } else {
          console.log('[Staff Page] No staff data found from backend, clearing local DB');
          // Backend has no data, clear the frontend to stay in sync
          await db.staff.clear();
          setStaffList([]);
        }
      } catch (error) {
        console.error('[Staff Page] Error fetching staff from backend:', error);
        // Fallback to local DB
        try {
          console.log('[Staff Page] Falling back to local DB due to backend error');
          const localStaff = await db.staff.toArray();
          console.log('[Staff Page] Loaded', localStaff.length, 'staff members from local DB');
          setStaffList(localStaff);
        } catch (localError) {
          console.error('[Staff Page] Error loading from local DB:', localError);
          setStaffList([]);
        }
      } finally {
        setIsLoadingStaff(false);
      }
    };

    fetchStaffFromBackend();
  }, []);

  // Fetch subscription and features from backend first, fallback to frontend
  useEffect(() => {
    const fetchSubscriptionAndFeatures = async () => {
      try {
        // Fetch subscription and features in parallel
        const [subResponse, featuresResponse] = await Promise.all([
          authFetch.fetch('/subscription/subscriptions/current/'),
          authFetch.fetch('/subscription/subscription-features/'),
        ]);
        
        console.log('Backend subscription response:', subResponse);
        console.log('Backend subscription features response:', featuresResponse);
        
        // Handle paginated response for subscription
        const subscriptionData = subResponse?.results?.[0] || subResponse?.data?.[0] || subResponse?.[0] || subResponse;
        
        // Handle paginated response for features
        const featuresData = featuresResponse?.results || featuresResponse?.data || featuresResponse || [];
        
        if (subscriptionData && (subscriptionData.id || subscriptionData.business)) {
          console.log('Using backend subscription:', subscriptionData);
          console.log('Subscription features:', featuresData);
          
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
          setSubscriptionFeatures(featuresData);
          return;
        }
      } catch (error) {
        console.log('Backend subscription fetch failed, falling back to frontend:', error);
      }
      
      // Fallback to frontend database
      if (frontendSubscription) {
        console.log('Using frontend subscription:', frontendSubscription);
        setSubscription(frontendSubscription);
      }
    };

    fetchSubscriptionAndFeatures();
  }, [frontendSubscription]);

  // Staff management is always enabled
  const canAddStaff = true;

  const currentUserEmail = (user?.email || '').trim().toLowerCase();
  const backendCurrentUserStaff = currentUserEmail
    ? staffList.find((s) => (s.email || '').trim().toLowerCase() === currentUserEmail)
    : null;
  const storedActiveBranchId =
    typeof window !== 'undefined'
      ? normalizeBranchId(localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH))
      : '';

  // Create current user staff object for display. Prefer backend staff record when available
  // so branch assignment is not lost immediately after onboarding.
  const currentUserStaff = user
    ? {
        id: backendCurrentUserStaff?.id || user.uid || 'current-user',
        name: backendCurrentUserStaff?.name || user.displayName || 'Current User',
        email: backendCurrentUserStaff?.email || user.email || '',
        role: (backendCurrentUserStaff?.role || user.role || 'Admin') as Staff['role'],
        branchId: normalizeBranchId(
          backendCurrentUserStaff?.branchId || user.branchId || storedActiveBranchId
        ),
        password: '',
      }
    : null;

  // Combine current user with staff list, avoiding duplicates by id/email.
  const displayStaffList = currentUserStaff && staffList
    ? [
        currentUserStaff,
        ...staffList.filter((s) => {
          const sameId = s.id === currentUserStaff.id;
          const sameEmail =
            (s.email || '').trim().toLowerCase() === (currentUserStaff.email || '').trim().toLowerCase();
          return !sameId && !sameEmail;
        }),
      ]
    : staffList || [];

  const staffCount = displayStaffList.length;
  const isStaffLimitReached = staffCount >= STAFF_LIMIT;


  useEffect(() => {
    const loadBranches = async () => {
      try {
        const response = await authFetch.fetch<any>('/business/branches/');
        const branchesData = response?.results || response?.data || response || [];

        if (Array.isArray(branchesData) && branchesData.length > 0) {
          const mappedBranches: Branch[] = branchesData.map((b: any) => ({
            id: normalizeBranchId(b.id),
            name: b.name || '',
            address: b.address || '',
            backendId: String(b.id),
          }));
          setBranches(mappedBranches);
          return;
        }
      } catch (error) {
        console.error('[Staff Page] Error fetching branches from backend:', error);
      }

      const storedBranches = localStorage.getItem(LOCAL_STORAGE_KEYS.BRANCHES);
      if (storedBranches) {
        try {
          const parsedBranches = JSON.parse(storedBranches);
          if (Array.isArray(parsedBranches)) {
            const normalizedBranches: Branch[] = parsedBranches.map((branch: any) => ({
              id: normalizeBranchId(branch?.id),
              name: branch?.name || '',
              address: branch?.address || '',
              backendId: branch?.backendId ? String(branch.backendId) : undefined,
            }));
            setBranches(normalizedBranches);
          }
        } catch (error) {
          console.error('[Staff Page] Failed to parse stored branches:', error);
        }
      }
    };

    loadBranches();
  }, []);

  const handleEdit = (staff: Staff) => {
    setEditingStaff(staff);
    setFormOpen(true);
  };
  
  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this staff member?')) {
        try {
            await authFetch.fetch(`/staff/${id}/`, {
                method: 'DELETE',
            });
            
            await db.staff.delete(id);
            toast({ title: "Staff member deleted successfully", variant: "destructive" });
        } catch (error) {
            console.error('Error:', error);
            toast({ 
                title: 'Error', 
                description: error instanceof Error ? error.message : 'Failed to delete staff member',
                variant: 'destructive'
            });
        }
    }
  };

  const handleFormOpenChange = async (open: boolean) => {
    setFormOpen(open);
    if (!open) {
        setEditingStaff(undefined);
        // Refresh staff list from backend when form closes
        try {
          console.log('[Staff Page] Refreshing staff list after form close');
          const response = await authFetch.fetch<any>('/staff/');
          const staffData = response?.results || response?.data || response || [];
          
          if (Array.isArray(staffData) && staffData.length > 0) {
            const mappedStaff: Staff[] = staffData.map((s: any) => ({
              id: String(s.id),
              name: s.name || '',
              email: s.email || '',
              role: s.role || 'Cashier',
              branchId: normalizeBranchId(s.branch || s.branchId || ''),
              assignedProductType: s.assigned_product_type ?? s.assignedProductType ?? undefined,
              isFuelAttendant: s.is_fuel_attendant ?? s.isFuelAttendant ?? false,
              password: '',
            }));
            
            await db.staff.clear();
            await db.staff.bulkAdd(mappedStaff);
            setStaffList(mappedStaff);
            console.log('[Staff Page] Staff list refreshed from backend');
          } else {
            // No backend data, clear the frontend to stay in sync
            console.log('[Staff Page] No staff data from backend, clearing local DB');
            await db.staff.clear();
            setStaffList([]);
          }
        } catch (error) {
          console.error('[Staff Page] Error refreshing staff list:', error);
          // Load from local DB on error
          try {
            const localStaff = await db.staff.toArray();
            setStaffList(localStaff);
          } catch (localError) {
            console.error('[Staff Page] Error loading from local DB:', localError);
          }
        }
    }
  }
  
  const getBranchName = (branchId: string) => {
      const targetBranchId = normalizeBranchId(branchId);
      if (!targetBranchId) {
        return 'N/A';
      }

      return (
        branches.find((b) => {
          const localBranchId = normalizeBranchId(b.id);
          const backendBranchId = normalizeBranchId(b.backendId);
          return localBranchId === targetBranchId || backendBranchId === targetBranchId;
        })?.name || 'N/A'
      );
  }

  const roleBadgeVariant: Record<Staff['role'], 'default' | 'secondary' | 'outline'> = {
    Admin: 'default',
    Manager: 'secondary',
    Waiter: 'outline',
    Cashier: 'outline',
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staff Management</h1>
          <p className="text-muted-foreground">
            Manage roles and permissions for your team members.
          </p>
        </div>
        <Dialog open={isFormOpen} onOpenChange={handleFormOpenChange}>
            <DialogTrigger asChild>
                <Button disabled={isStaffLimitReached}>
                    <PlusCircle className="mr-2 h-4 w-4" /> Add Staff Member
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{editingStaff ? 'Edit Staff Member' : 'Add New Staff Member'}</DialogTitle>
                    <DialogDescription>
                        {editingStaff ? 'Update the details for this staff member.' : 'Add a new staff member to your team.'}
                    </DialogDescription>
                </DialogHeader>
                <StaffForm 
                    onFormSubmit={() => handleFormOpenChange(false)} 
                    defaultValues={editingStaff}
                    branches={branches}
                    canCreate={!isStaffLimitReached}
                    staffLimit={STAFF_LIMIT}
                />
            </DialogContent>
        </Dialog>
      </div>
      
      <Card>
        <CardHeader>
          <CardTitle>Staff List</CardTitle>
          <CardDescription>A list of all staff members in your organization.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Assigned Branch</TableHead>
                <TableHead className="w-[50px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingStaff ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Loading staff...</span>
                    </div>
                  </TableCell>
                </TableRow>
              ) : displayStaffList && displayStaffList.length > 0 ? (
                displayStaffList.map((staff) => {
                  const isCurrentUser = staff.email === user?.email;
                  return (
                    <TableRow key={staff.id} className={isCurrentUser ? 'bg-blue-50 dark:bg-blue-950/20' : ''}>
                      <TableCell className="font-medium">
                          <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                                  <User className="h-5 w-5" />
                              </div>
                              <div>
                                  <div className="flex items-center gap-2">
                                    <p>{staff.name}</p>
                                    {isCurrentUser && <Badge variant="default" className="text-xs">You</Badge>}
                                  </div>
                                  <p className="text-xs text-muted-foreground">{staff.email}</p>
                                  {staff.isFuelAttendant && (
                                    <p className="text-xs text-muted-foreground">Fuel Attendant</p>
                                  )}
                                </div>
                          </div>
                      </TableCell>
                      <TableCell>
                          <Badge variant={roleBadgeVariant[staff.role]}>{staff.role}</Badge>
                      </TableCell>
                      <TableCell>{getBranchName(staff.branchId)}</TableCell>
                      <TableCell className="text-right">
                        {!isCurrentUser && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEdit(staff)}>
                                <Edit className="mr-2 h-4 w-4" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem className="text-destructive" onClick={() => handleDelete(staff.id)}>
                                <Trash2 className="mr-2 h-4 w-4" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    No staff members found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
