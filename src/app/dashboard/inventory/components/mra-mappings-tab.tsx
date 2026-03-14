'use client';

import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { authFetch } from '@/lib/auth-fetch';
import { toast } from '@/hooks/use-toast';
import { type InventoryItem } from '@/lib/db';
import { ProductMappingForm } from './product-mapping-form';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface MRAMapping {
  id: string;
  inventory_item: string;
  inventory_item_name: string;
  branch?: number | string;
  branch_name?: string;
  mra_product_code: string;
  mra_product_name: string;
  mra_tax_rate: number;
  is_approved: boolean;
  mra_synced: boolean;
  created_at: string;
  approved_at?: string;
  last_synced_at?: string;
}

interface MRAMappingsTabProps {
  inventoryData: InventoryItem[];
  businessId?: string | number;
  branchId?: string;
}

export function MRAMappingsTab({ inventoryData, businessId, branchId }: MRAMappingsTabProps) {
  const [mappings, setMappings] = useState<MRAMapping[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isApproving, setIsApproving] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'approved' | 'unapproved' | 'synced'>('all');

  // Fetch MRA mappings from backend - filtered by branch
  useEffect(() => {
    const fetchMappings = async () => {
      try {
        setIsLoading(true);
        
        // Build URL with branch filter if available
        let url = '/inventory/mra-mappings/';
        if (branchId) {
          // Extract numeric branch ID
          const branchIdMatch = branchId.match(/\d+/);
          const branchIdInt = branchIdMatch ? parseInt(branchIdMatch[0], 10) : parseInt(branchId, 10);
          url = `/inventory/mra-mappings/?branch_id=${branchIdInt}`;
          console.log('[MRAMappingsTab] Fetching mappings for branch:', branchIdInt);
        }
        
        const response = await authFetch.fetch<any>(url);
        
        let mappingsList: MRAMapping[] = [];
        if (Array.isArray(response)) {
          mappingsList = response;
        } else if (response?.results && Array.isArray(response.results)) {
          mappingsList = response.results;
        }

        console.log('[MRAMappingsTab] Received', mappingsList.length, 'mappings for branch:', branchId);
        setMappings(mappingsList);
      } catch (error) {
        console.error('Failed to fetch MRA mappings:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to load MRA mappings',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchMappings();
  }, [branchId]);

  // Approve mapping
  const handleApproveMapping = async (mappingId: string) => {
    try {
      setIsApproving(mappingId);
      await authFetch.fetch<any>(`/inventory/mra-mappings/${mappingId}/approve/`, {
        method: 'POST',
        body: JSON.stringify({
          is_approved: true,
          mra_synced: true,
        }),
      });

      // Update local state
      setMappings(mappings.map(m => 
        m.id === mappingId 
          ? { ...m, is_approved: true, mra_synced: true, approved_at: new Date().toISOString() }
          : m
      ));

      toast({
        title: 'Success',
        description: 'Mapping approved and synced',
      });
    } catch (error) {
      console.error('Failed to approve mapping:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to approve mapping',
      });
    } finally {
      setIsApproving(null);
    }
  };

  // Filter mappings
  const filteredMappings = mappings.filter(mapping => {
    const matchesSearch = 
      mapping.inventory_item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      mapping.mra_product_code.toLowerCase().includes(searchTerm.toLowerCase());

    if (filterStatus === 'approved') return matchesSearch && mapping.is_approved;
    if (filterStatus === 'unapproved') return matchesSearch && !mapping.is_approved;
    if (filterStatus === 'synced') return matchesSearch && mapping.mra_synced;
    return matchesSearch;
  });

  const stats = {
    total: mappings.length,
    approved: mappings.filter(m => m.is_approved).length,
    synced: mappings.filter(m => m.mra_synced).length,
    pending: mappings.filter(m => !m.is_approved).length,
  };

  const mappedInventoryIds = new Set(
    mappings
      .map((mapping) => String(mapping.inventory_item || '').trim())
      .filter((id) => id.length > 0)
  );
  const unmappedInventory = inventoryData.filter(
    (item) => !mappedInventoryIds.has(String(item.id))
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Total Mappings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Approved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{stats.approved}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Synced</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{stats.synced}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{stats.pending}</div>
          </CardContent>
        </Card>
      </div>

      {/* Action */}
      <div className="flex justify-end">
        <ProductMappingForm
          inventoryData={unmappedInventory}
          businessId={businessId?.toString()}
          onMappingCreated={() => {
            // Refresh mappings for current branch
            const fetchMappings = async () => {
              try {
                let url = '/inventory/mra-mappings/';
                if (branchId) {
                  const branchIdMatch = branchId.match(/\d+/);
                  const branchIdInt = branchIdMatch ? parseInt(branchIdMatch[0], 10) : parseInt(branchId, 10);
                  url = `/inventory/mra-mappings/?branch_id=${branchIdInt}`;
                }
                
                const response = await authFetch.fetch<any>(url);
                let mappingsList: MRAMapping[] = [];
                if (Array.isArray(response)) {
                  mappingsList = response;
                } else if (response?.results && Array.isArray(response.results)) {
                  mappingsList = response.results;
                }
                setMappings(mappingsList);
              } catch (error) {
                console.error('Failed to refresh mappings:', error);
              }
            };
            fetchMappings();
          }}
        />
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-col sm:flex-row">
        <Input
          placeholder="Search by product name or MRA code..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1"
        />
        <Select value={filterStatus} onValueChange={(value: any) => setFilterStatus(value)}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Mappings</SelectItem>
            <SelectItem value="approved">Approved Only</SelectItem>
            <SelectItem value="unapproved">Pending Approval</SelectItem>
            <SelectItem value="synced">Synced Only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Mappings Table */}
      <Card>
        <CardHeader>
          <CardTitle>Product Mappings</CardTitle>
          <CardDescription>
            {filteredMappings.length} of {mappings.length} mappings
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredMappings.length === 0 ? (
            <div className="text-center py-12">
              <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No mappings found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product Name</TableHead>
                    <TableHead>MRA Code</TableHead>
                    <TableHead>MRA Product</TableHead>
                    <TableHead>Tax Rate</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMappings.map((mapping) => (
                    <TableRow key={mapping.id}>
                      <TableCell className="font-medium">
                        {mapping.inventory_item_name}
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-2 py-1 rounded">
                          {mapping.mra_product_code}
                        </code>
                      </TableCell>
                      <TableCell>{mapping.mra_product_name}</TableCell>
                      <TableCell>{mapping.mra_tax_rate}%</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          {mapping.is_approved && (
                            <Badge variant="default" className="bg-green-600">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Approved
                            </Badge>
                          )}
                          {!mapping.is_approved && (
                            <Badge variant="outline" className="border-amber-600 text-amber-600">
                              <AlertTriangle className="h-3 w-3 mr-1" />
                              Pending
                            </Badge>
                          )}
                          {mapping.mra_synced && (
                            <Badge variant="secondary">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Synced
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {!mapping.is_approved && (
                          <Button
                            size="sm"
                            onClick={() => handleApproveMapping(mapping.id)}
                            disabled={isApproving === mapping.id}
                          >
                            {isApproving === mapping.id ? (
                              <>
                                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                Approving...
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                Approve
                              </>
                            )}
                          </Button>
                        )}
                        {mapping.is_approved && (
                          <span className="text-xs text-muted-foreground">Approved</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
