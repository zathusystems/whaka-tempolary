
'use client';

import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useForm } from 'react-hook-form';
import { MoreHorizontal, PlusCircle, Edit, Trash2, BookUser, Loader2 } from 'lucide-react';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { db, type Customer } from '@/lib/db';
import { authFetch } from '@/lib/auth-fetch';
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';

const LOCAL_STORAGE_KEYS = {
    ACTIVE_BRANCH: 'handypos-active-branch',
};

const customerSchema = z.object({
  name: z.string().min(2, 'Customer name is required.'),
  email: z.string().email('Please enter a valid email address.').optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
});

type CustomerFormValues = z.infer<typeof customerSchema>;

const CustomerForm = ({
  onFormSubmit,
  defaultValues,
}: {
  onFormSubmit: () => void;
  defaultValues?: Partial<Customer>;
}) => {
  const [activeBranchId, setActiveBranchId] = useState('main');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const branchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
    if (branchId) setActiveBranchId(branchId);
  }, []);

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues,
  });

  const onSubmit = async (data: CustomerFormValues) => {
    setIsLoading(true);
    try {
      if (defaultValues?.id) {
        // Update existing customer
        const updateData = {
          name: data.name,
          email: data.email || '',
          phone: data.phone || '',
          address: data.address || '',
        };
        const updatedCustomer = await authFetch.fetch(`/customers/${defaultValues.id}/`, {
          method: 'PATCH',
          body: JSON.stringify(updateData),
        });
        await db.customers.update(defaultValues.id, {
          ...updatedCustomer,
          branchId: activeBranchId,
        });
        toast({ title: 'Customer updated successfully' });
      } else {
        // Create new customer
        const createData = {
          name: data.name,
          email: data.email || '',
          phone: data.phone || '',
          address: data.address || '',
        };
        const newCustomer = await authFetch.fetch('/customers/', {
          method: 'POST',
          body: JSON.stringify(createData),
        });
        await db.customers.add({
          id: newCustomer.id.toString(),
          name: newCustomer.name,
          email: newCustomer.email,
          phone: newCustomer.phone,
          address: newCustomer.address,
          branchId: activeBranchId,
          createdAt: new Date().toISOString(),
        });
        toast({ title: 'Customer added successfully' });
      }
      onFormSubmit();
    } catch (error) {
      console.error('Failed to save customer:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to save customer',
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
                <FormLabel>Customer Name</FormLabel>
                <FormControl><Input placeholder="e.g., John Doe, ACME Inc." {...field} /></FormControl>
                <FormMessage />
            </FormItem>
        )} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl><Input type="email" placeholder="contact@example.com" {...field} /></FormControl>
                    <FormMessage />
                </FormItem>
            )} />
            <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl><Input placeholder="+1 234 567 890" {...field} /></FormControl>
                    <FormMessage />
                </FormItem>
            )} />
        </div>
         <FormField control={form.control} name="address" render={({ field }) => (
            <FormItem>
                <FormLabel>Address</FormLabel>
                <FormControl><Textarea placeholder="123 Main St, Anytown, USA" {...field} /></FormControl>
                <FormMessage />
            </FormItem>
        )} />
        <DialogFooter>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {defaultValues?.id ? 'Save Changes' : 'Add Customer'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
};

export default function CustomersPage() {
  const [isFormOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | undefined>(undefined);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);

  useEffect(() => {
    const branchId = localStorage.getItem(LOCAL_STORAGE_KEYS.ACTIVE_BRANCH);
    if (branchId) setActiveBranchId(branchId);
  }, []);

  // Listen for branch changes from header (custom event)
  useEffect(() => {
    const handleBranchChange = (e: Event) => {
      const customEvent = e as CustomEvent;
      const branchId = customEvent.detail?.branchId;
      if (branchId) {
        console.log('[CustomersPage] Branch changed to:', branchId);
        setActiveBranchId(branchId);
      }
    };

    window.addEventListener('branchChanged', handleBranchChange);
    return () => window.removeEventListener('branchChanged', handleBranchChange);
  }, []);

  const customers = useLiveQuery(
    () => {
      if (!activeBranchId) return [];
      return db.customers.where({ branchId: activeBranchId }).toArray()
    },
    [activeBranchId]
  ) || [];

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this customer?')) {
      try {
        await authFetch.fetch(`/customers/${id}/`, {
          method: 'DELETE',
        });

        await db.customers.delete(id);
        toast({ title: 'Customer deleted successfully', variant: 'destructive' });
      } catch (error) {
        console.error('Error:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to delete customer',
        });
      }
    }
  };

  const handleFormOpenChange = (open: boolean) => {
    setFormOpen(open);
    if (!open) {
      setEditingCustomer(undefined);
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
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customer Management</h1>
          <p className="text-muted-foreground">
            Manage your customers for invoicing and records.
          </p>
        </div>
        <Dialog open={isFormOpen} onOpenChange={handleFormOpenChange}>
          <DialogTrigger asChild>
            <Button>
              <PlusCircle className="mr-2 h-4 w-4" /> Add Customer
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{editingCustomer ? 'Edit Customer' : 'Add New Customer'}</DialogTitle>
              <DialogDescription>
                {editingCustomer
                  ? 'Update the details for this customer.'
                  : 'Add a new customer to your records.'}
              </DialogDescription>
            </DialogHeader>
            <CustomerForm
              onFormSubmit={() => handleFormOpenChange(false)}
              defaultValues={editingCustomer}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Customer List</CardTitle>
          <CardDescription>A list of all customers for the active branch.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Date Added</TableHead>
                <TableHead className="w-[50px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.length > 0 ? (
                customers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell>
                        <div className="text-sm">{customer.email}</div>
                        <div className="text-xs text-muted-foreground">{customer.phone}</div>
                    </TableCell>
                    <TableCell>{new Date(customer.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(customer)}>
                            <Edit className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleDelete(customer.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                     <div className="flex flex-col items-center justify-center space-y-4">
                        <BookUser className="h-12 w-12 text-muted-foreground/30" />
                        <p>No customers found. Click "Add Customer" to get started.</p>
                     </div>
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
