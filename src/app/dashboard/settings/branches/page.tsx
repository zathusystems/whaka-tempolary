'use client';

import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { PlusCircle, MoreHorizontal, Edit, Trash2, Lock, Loader2, CheckCircle2, CloudOff } from 'lucide-react';

import { db, type Subscription } from '@/lib/db';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
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
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { authFetch } from '@/lib/auth-fetch';
import { syncBusinessBranchesFromServer, type StoredBranch } from '@/lib/branch-sync';
import { syncSessionSnapshotToDesktopStore } from '@/lib/desktop-session-store';

const LOCAL_STORAGE_KEYS = {
    BRANCHES: 'handypos-branches',
    ACTIVE_BRANCH: 'handypos-active-branch',
    CURRENT_BRANCH: 'handypos-current-branch-id',
};

const branchSchema = z.object({
    id: z.string().optional(),
    name: z.string().min(2, 'Branch name is required.'),
    address: z.string().min(5, 'Address is required.'),
    backendId: z.string().optional(), // Track backend ID separately
    mraBranchCode: z.string().optional(),
    mra_branch_code: z.string().optional(),
    mraSiteId: z.string().optional(),
    mra_site_id: z.string().optional(),
    mraSiteName: z.string().optional(),
    mra_site_name: z.string().optional(),
    mraTerminalId: z.string().optional(),
    mra_terminal_id: z.string().optional(),
    mraTerminalPosition: z.coerce.number().optional().nullable(),
    mra_terminal_position: z.coerce.number().optional().nullable(),
    isEisWarehouse: z.boolean().optional(),
    is_eis_warehouse: z.boolean().optional(),
});

type Branch = z.infer<typeof branchSchema>;

const toBranchModel = (branch: StoredBranch): Branch => ({
    id: branch.id,
    backendId: branch.backendId,
    name: branch.name,
    address: branch.address,
    mraBranchCode: branch.mraBranchCode || branch.mra_branch_code || '',
    mra_branch_code: branch.mra_branch_code || branch.mraBranchCode || '',
    mraSiteId: branch.mraSiteId || branch.mra_site_id || '',
    mra_site_id: branch.mra_site_id || branch.mraSiteId || '',
    mraSiteName: branch.mraSiteName || branch.mra_site_name || '',
    mra_site_name: branch.mra_site_name || branch.mraSiteName || '',
    mraTerminalId: branch.mraTerminalId || branch.mra_terminal_id || '',
    mra_terminal_id: branch.mra_terminal_id || branch.mraTerminalId || '',
    mraTerminalPosition: branch.mraTerminalPosition ?? branch.mra_terminal_position ?? null,
    mra_terminal_position: branch.mra_terminal_position ?? branch.mraTerminalPosition ?? null,
    isEisWarehouse: Boolean(branch.isEisWarehouse ?? branch.is_eis_warehouse ?? false),
    is_eis_warehouse: Boolean(branch.is_eis_warehouse ?? branch.isEisWarehouse ?? false),
});

const BranchForm = ({
  onFormSubmit,
  defaultValues,
  isSubmitting,
}: {
  onFormSubmit: (data: Branch) => void;
  defaultValues?: Branch;
  isSubmitting?: boolean;
}) => {
  const form = useForm<Branch>({
    resolver: zodResolver(branchSchema),
    defaultValues: defaultValues || {
        name: '',
        address: '',
        mraSiteId: '',
        mraSiteName: '',
        mraTerminalId: '',
        mraTerminalPosition: null,
        isEisWarehouse: false,
    },
  });

  const onSubmit = (data: Branch) => {
    onFormSubmit(data);
    form.reset();
  };

  return (
    <FormProvider {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 py-4">
            <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Branch Name</FormLabel>
                        <FormControl>
                            <Input placeholder="e.g., Main Branch, Downtown Store" {...field} disabled={isSubmitting} />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>Address</FormLabel>
                        <FormControl>
                            <Input placeholder="123 Main St, Anytown, USA" {...field} disabled={isSubmitting} />
                        </FormControl>
                         <FormMessage />
                    </FormItem>
                )}
            />
            <div className="rounded-md border p-3">
                <p className="mb-3 text-sm font-medium">EIS Mapping</p>
                <div className="grid gap-3">
                    <FormField
                        control={form.control}
                        name="mraSiteId"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>MRA Site ID</FormLabel>
                                <FormControl>
                                    <Input placeholder="MRA site ID" {...field} value={field.value || ''} disabled={isSubmitting} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="mraSiteName"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>MRA Site Name</FormLabel>
                                <FormControl>
                                    <Input placeholder="MRA site name" {...field} value={field.value || ''} disabled={isSubmitting} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="mraTerminalId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Terminal ID</FormLabel>
                                    <FormControl>
                                        <Input placeholder="MRA terminal ID" {...field} value={field.value || ''} disabled={isSubmitting} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="mraTerminalPosition"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Terminal Position</FormLabel>
                                    <FormControl>
                                        <Input
                                            inputMode="numeric"
                                            placeholder="Position"
                                            value={field.value ?? ''}
                                            onChange={(event) => field.onChange(event.target.value ? Number(event.target.value) : null)}
                                            disabled={isSubmitting}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                    <FormField
                        control={form.control}
                        name="isEisWarehouse"
                        render={({ field }) => (
                            <FormItem>
                                <label className="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        checked={Boolean(field.value)}
                                        onChange={(event) => field.onChange(event.target.checked)}
                                        disabled={isSubmitting}
                                    />
                                    EIS warehouse/location
                                </label>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>
            </div>
            <DialogFooter>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {defaultValues ? 'Save Changes' : 'Add Branch'}
                </Button>
            </DialogFooter>
        </form>
    </FormProvider>
  );
};

export default function BranchesSettingsPage() {
    const subscription = useLiveQuery(() => db.subscriptions.get('sub_main-business'));
    const isProPlan = subscription?.planId === 'pro' || subscription?.status === 'active' || !subscription;
    const { business } = useAuth();

    const [branches, setBranches] = useState<Branch[]>([]);
    const [isBranchModalOpen, setBranchModalOpen] = useState(false);
    const [editingBranch, setEditingBranch] = useState<Branch | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isOnline, setIsOnline] = useState(true);
    const [activeBranchId, setActiveBranchId] = useState<string | null>(null);

    // Monitor online status
    useEffect(() => {
        setIsOnline(authFetch.getOnlineStatus());
        
        const handleOnline = () => {
            setIsOnline(true);
            console.log('[DEBUG BRANCHES] Online - attempting to sync');
        };
        
        const handleOffline = () => {
            setIsOnline(false);
            console.log('[DEBUG BRANCHES] Offline - operations will be queued');
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const storedActiveBranch = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
        if (storedActiveBranch) {
            setActiveBranchId(storedActiveBranch);
        }
    }, []);

    // Load branches from backend on mount (offline-first)
    useEffect(() => {
        if (business?.id) {
            loadBranches();
        }
    }, [business?.id]);

    const loadBranches = async () => {
        if (!business?.id) return;
        
        try {
            setIsLoading(true);
            console.log('[DEBUG BRANCHES] Loading branches for business:', business.id);
            
            const storedActiveBranch = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
            const syncResult = await syncBusinessBranchesFromServer(
                String(business.id),
                storedActiveBranch || undefined,
                { timeoutMs: 15000 }
            );
            console.log('[DEBUG BRANCHES] Loaded branches from backend:', syncResult.rawBranches);

            const transformedBranches = syncResult.branches.map(toBranchModel);
            
            setBranches(transformedBranches);
            localStorage.setItem(LOCAL_STORAGE_KEYS.BRANCHES, JSON.stringify(transformedBranches));
        } catch (error) {
            console.error('[DEBUG BRANCHES] Error loading branches from backend:', error);
            // Fall back to localStorage (offline-first)
            const storedBranches = localStorage.getItem(LOCAL_STORAGE_KEYS.BRANCHES);
            if (storedBranches) {
                try {
                    setBranches(JSON.parse(storedBranches));
                    console.log('[DEBUG BRANCHES] Loaded branches from localStorage');
                } catch (e) {
                    console.error('[DEBUG BRANCHES] Error parsing stored branches:', e);
                }
            }
        } finally {
            setIsLoading(false);
        }
    };

    const handleBranchSubmit = async (data: Branch) => {
        if (!business?.id) {
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'No business selected.',
            });
            return;
        }

        try {
            setIsSyncing(true);
            console.log('[DEBUG BRANCHES] Submitting branch:', data);

            const payload = {
                name: data.name,
                address: data.address,
                city: 'Main City',
                state: '',
                postal_code: '',
                country: 'Malawi',
                phone: '',
                email: '',
                is_active: true,
                mra_site_id: data.mraSiteId || data.mra_site_id || '',
                mra_site_name: data.mraSiteName || data.mra_site_name || '',
                mra_branch_code: data.mraSiteId || data.mra_site_id || data.mraBranchCode || data.mra_branch_code || '',
                mra_terminal_id: data.mraTerminalId || data.mra_terminal_id || '',
                mra_terminal_position: data.mraTerminalPosition ?? data.mra_terminal_position ?? null,
                is_eis_warehouse: Boolean(data.isEisWarehouse ?? data.is_eis_warehouse ?? false),
                eis_mapping_source: data.mraSiteId || data.mra_site_id ? 'manual' : '',
            };

            if (editingBranch && editingBranch.id) {
                // Update existing branch
                console.log('[DEBUG BRANCHES] Updating branch:', editingBranch.backendId);
                
                try {
                    // Try to sync with backend
                    if (editingBranch.backendId) {
                        await authFetch.fetch(`/business/branches/${editingBranch.backendId}/`, {
                            method: 'PUT',
                            body: JSON.stringify(payload),
                        });
                        console.log('[DEBUG BRANCHES] Branch updated on backend');
                    }
                } catch (error) {
                    console.error('[DEBUG BRANCHES] Error updating on backend, queueing:', error);
                    // Queue for later sync
                    if (editingBranch.backendId) {
                        await authFetch.fetch(`/business/branches/${editingBranch.backendId}/`, {
                            method: 'PUT',
                            body: JSON.stringify(payload),
                            offline: true,
                        }).catch(() => {});
                    }
                }

                const updatedBranches = branches.map(b => 
                    b.id === editingBranch.id ? toBranchModel({
                        ...b,
                        ...data,
                        id: b.id || editingBranch.id || '',
                        backendId: b.backendId,
                        name: data.name || b.name || '',
                        address: data.address || b.address || '',
                    }) : b
                );
                setBranches(updatedBranches);
                localStorage.setItem(LOCAL_STORAGE_KEYS.BRANCHES, JSON.stringify(updatedBranches));
                window.dispatchEvent(new CustomEvent('branchesUpdated', { detail: { branches: updatedBranches } }));

                toast({
                    title: 'Branch Updated',
                    description: `The branch "${data.name}" has been ${isOnline ? 'updated' : 'updated locally and will sync when online'}.`,
                });
            } else {
                // Create new branch
                console.log('[DEBUG BRANCHES] Creating new branch');
                
                let newBranch: Branch;
                
                try {
                    // Try to create on backend
                    console.log('[DEBUG BRANCHES] Sending payload:', JSON.stringify(payload));
                    const response = await authFetch.fetch(`/business/businesses/${business.id}/add_branch/`, {
                        method: 'POST',
                        body: JSON.stringify(payload),
                    });

                    newBranch = toBranchModel({
                        ...response,
                        id: String(response.id),
                        backendId: String(response.id),
                    });
                    console.log('[DEBUG BRANCHES] Branch created on backend:', response);
                } catch (error) {
                    console.error('[DEBUG BRANCHES] Error creating on backend:', error);
                    console.error('[DEBUG BRANCHES] Error details:', error instanceof Error ? error.message : error);
                    // Queue for later sync
                    await authFetch.fetch(`/business/businesses/${business.id}/add_branch/`, {
                        method: 'POST',
                        body: JSON.stringify(payload),
                        offline: true,
                    }).catch(() => {});

                    newBranch = toBranchModel({
                        ...data,
                        id: `BRN-${Date.now()}`,
                        name: data.name || 'New Branch',
                        address: data.address || '',
                    });
                }

                const updatedBranches = [...branches, newBranch];
                setBranches(updatedBranches);
                localStorage.setItem(LOCAL_STORAGE_KEYS.BRANCHES, JSON.stringify(updatedBranches));

                // Dispatch event to update branch switcher in header
                window.dispatchEvent(new CustomEvent('branchesUpdated', { detail: { branches: updatedBranches } }));

                toast({
                    title: 'Branch Added',
                    description: `The branch "${data.name}" has been ${isOnline ? 'created' : 'created locally and will sync when online'}.`,
                });
            }

            setBranchModalOpen(false);
            setEditingBranch(undefined);
        } catch (error) {
            console.error('[DEBUG BRANCHES] Unexpected error submitting branch:', error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to save branch.',
            });
        } finally {
            setIsSyncing(false);
        }
    };

    const handleEditBranch = (branch: Branch) => {
        setEditingBranch(branch);
        setBranchModalOpen(true);
    };

    const handleDeleteBranch = async (branchId: string, backendId?: string) => {
        if (branches.length <= 1) {
            toast({ 
                variant: 'destructive', 
                title: 'Cannot Delete', 
                description: 'You must have at least one branch.' 
            });
            return;
        }

        if (!confirm('Are you sure you want to delete this branch?')) {
            return;
        }

        try {
            setIsSyncing(true);
            console.log('[DEBUG BRANCHES] Deleting branch:', branchId, 'backendId:', backendId);

            // Try to delete from backend if it has a backend ID
            if (backendId) {
                try {
                    await authFetch.fetch(`/business/branches/${backendId}/`, {
                        method: 'DELETE',
                    });
                    console.log('[DEBUG BRANCHES] Branch deleted from backend');
                } catch (error) {
                    console.error('[DEBUG BRANCHES] Error deleting from backend, queueing:', error);
                    // Queue for later sync
                    await authFetch.fetch(`/business/branches/${backendId}/`, {
                        method: 'DELETE',
                        offline: true,
                    }).catch(() => {});
                }
            }

            const updatedBranches = branches.filter(b => b.id !== branchId);
            setBranches(updatedBranches);
            localStorage.setItem(LOCAL_STORAGE_KEYS.BRANCHES, JSON.stringify(updatedBranches));
            window.dispatchEvent(new CustomEvent('branchesUpdated', { detail: { branches: updatedBranches } }));

            if (activeBranchId === branchId) {
                const fallbackBranchId = updatedBranches[0]?.id ?? null;
                if (fallbackBranchId) {
                    localStorage.setItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH, fallbackBranchId);
                    setActiveBranchId(fallbackBranchId);
                    window.dispatchEvent(new CustomEvent('branchChanged', { detail: { branchId: fallbackBranchId } }));
                } else {
                    localStorage.removeItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
                    setActiveBranchId(null);
                }
            }

            toast({
                title: 'Branch Deleted',
                description: 'The branch has been removed.',
            });
        } catch (error) {
            console.error('[DEBUG BRANCHES] Unexpected error deleting branch:', error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: error instanceof Error ? error.message : 'Failed to delete branch.',
            });
        } finally {
            setIsSyncing(false);
        }
    };

    const handleSwitchBranch = (branch: Branch) => {
        if (branch.id === activeBranchId) {
            toast({
                title: 'Already Active',
                description: `"${branch.name}" is already the active branch.`,
            });
            return;
        }

        localStorage.setItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH, branch.id);
        localStorage.setItem(LOCAL_STORAGE_KEYS.CURRENT_BRANCH, branch.id);
        setActiveBranchId(branch.id);
        window.dispatchEvent(new CustomEvent('branchChanged', { detail: { branchId: branch.id } }));
        void syncSessionSnapshotToDesktopStore();

        toast({
            title: 'Branch Switched',
            description: `Switched to "${branch.name}".`,
        });
    };
    
    const handleBranchModalOpenChange = (open: boolean) => {
        setBranchModalOpen(open);
        if (!open) {
            setEditingBranch(undefined);
        }
    };

    return (
        <>
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
            <div>
                <CardTitle>Branch Management</CardTitle>
                <CardDescription>
                Manage your different store locations or warehouses.
                </CardDescription>
            </div>
            <div className="flex items-center gap-2">
                {!isOnline && (
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <CloudOff className="h-4 w-4" />
                        <span>Offline</span>
                    </div>
                )}
                <Button onClick={() => setBranchModalOpen(true)} disabled={!isProPlan || isSyncing}>
                    {!isProPlan && <Lock className="mr-2 h-4 w-4" />}
                    {isSyncing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <PlusCircle className="mr-2 h-4 w-4"/> New Branch
                </Button>
            </div>
            </CardHeader>
            <CardContent>
            {isLoading ? (
                <div className="flex items-center justify-center h-24">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Branch Name</TableHead>
                            <TableHead>Address</TableHead>
                            <TableHead>EIS Mapping</TableHead>
                            <TableHead className="w-16"><span className="sr-only">Actions</span></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {branches.length > 0 ? branches.map(branch => (
                            <TableRow key={branch.id}>
                                <TableCell className="font-medium">
                                    <div className="flex items-center gap-2">
                                        {branch.name}
                                        {branch.id === activeBranchId && (
                                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                                                Active
                                            </span>
                                        )}
                                        {!branch.backendId && (
                                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                <CloudOff className="h-3 w-3" />
                                                <span>Local</span>
                                            </div>
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="text-muted-foreground">{branch.address}</TableCell>
                                <TableCell>
                                    {(branch.mraSiteId || branch.mra_site_id) ? (
                                        <div className="space-y-1 text-xs">
                                            <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">Mapped</span>
                                            <div className="text-muted-foreground">{branch.mraSiteId || branch.mra_site_id}</div>
                                            {(branch.isEisWarehouse || branch.is_eis_warehouse) && <div className="font-medium">Warehouse</div>}
                                        </div>
                                    ) : (
                                        <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">Unmapped</span>
                                    )}
                                </TableCell>
                                <TableCell>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button variant="ghost" size="icon" disabled={!isProPlan || isSyncing}>
                                                <MoreHorizontal />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            {branch.id === activeBranchId ? (
                                                <DropdownMenuItem disabled>
                                                    <CheckCircle2 className="mr-2" /> Active Branch
                                                </DropdownMenuItem>
                                            ) : (
                                                <DropdownMenuItem onClick={() => handleSwitchBranch(branch)}>
                                                    <CheckCircle2 className="mr-2" /> Switch to This Branch
                                                </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem onClick={() => handleEditBranch(branch)}>
                                                <Edit className="mr-2"/> Edit
                                            </DropdownMenuItem>
                                            <DropdownMenuItem 
                                                onClick={() => handleDeleteBranch(branch.id, branch.backendId)} 
                                                className="text-destructive"
                                            >
                                                <Trash2 className="mr-2"/> Delete
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </TableCell>
                            </TableRow>
                        )) : (
                            <TableRow>
                                <TableCell colSpan={4} className="h-24 text-center">
                                    No branches found. Click "New Branch" to add your first one.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            )}
            </CardContent>
        </Card>
        <Dialog open={isBranchModalOpen} onOpenChange={handleBranchModalOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{editingBranch ? 'Edit Branch' : 'Add New Branch'}</DialogTitle>
                    <DialogDescription>
                    {editingBranch ? `Update the details for the "${editingBranch.name}" branch.` : 'Fill in the details for your new branch.'}
                    {!isOnline && <div className="mt-2 text-sm text-muted-foreground flex items-center gap-1"><CloudOff className="h-3 w-3" /> Changes will be saved locally and synced when online.</div>}
                    </DialogDescription>
                </DialogHeader>
                <BranchForm
                    onFormSubmit={handleBranchSubmit}
                    defaultValues={editingBranch}
                    isSubmitting={isSyncing}
                />
            </DialogContent>
        </Dialog>
        </>
    )
}
