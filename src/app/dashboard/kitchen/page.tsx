'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { authFetch } from '@/lib/auth-fetch';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

interface TakeOrderItem {
  id: string;
  name: string;
  quantity: number;
  notes?: string;
}

interface TakeOrder {
  id: string;
  order_number: number;
  status: 'Pending' | 'Confirmed' | 'Sent to Kitchen' | 'Preparing' | 'Ready' | 'Completed' | 'Cancelled';
  customer_name?: string;
  customer_phone?: string;
  customer_notes?: string;
  special_instructions?: string;
  items: TakeOrderItem[];
  created_at: string;
  updated_at: string;
}

const statusColors: Record<string, string> = {
  'Pending': 'bg-blue-100 text-blue-800',
  'Confirmed': 'bg-purple-100 text-purple-800',
  'Sent to Kitchen': 'bg-orange-100 text-orange-800',
  'Preparing': 'bg-yellow-100 text-yellow-800',
  'Ready': 'bg-green-100 text-green-800',
  'Completed': 'bg-gray-100 text-gray-800',
  'Cancelled': 'bg-red-100 text-red-800',
};

const statusIcons: Record<string, React.ReactNode> = {
  'Pending': <AlertCircle className="h-4 w-4" />,
  'Confirmed': <CheckCircle2 className="h-4 w-4" />,
  'Sent to Kitchen': <Clock className="h-4 w-4" />,
  'Preparing': <Clock className="h-4 w-4" />,
  'Ready': <CheckCircle2 className="h-4 w-4" />,
  'Completed': <CheckCircle2 className="h-4 w-4" />,
  'Cancelled': <AlertCircle className="h-4 w-4" />,
};

export default function KitchenPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [takeOrders, setTakeOrders] = useState<TakeOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Get active branch from localStorage
  useEffect(() => {
    const activeBranch = localStorage.getItem('handypos-active-branch');
    if (activeBranch) {
      setBranchId(activeBranch);
    }
  }, []);

  // Fetch take orders
  const fetchTakeOrders = async () => {
    if (!branchId) return;

    try {
      setIsLoading(true);
      const data = await authFetch.fetch(
        `/orders/take-orders/?branch_id=${branchId}`
      );

      setTakeOrders(data.results || []);
    } catch (error) {
      console.error('Error fetching take orders:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to fetch take orders from kitchen',
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Initial fetch and auto-refresh
  useEffect(() => {
    if (branchId) {
      fetchTakeOrders();
    }

    if (!autoRefresh) return;

    const interval = setInterval(() => {
      if (branchId) {
        fetchTakeOrders();
      }
    }, 5000); // Refresh every 5 seconds

    return () => clearInterval(interval);
  }, [branchId, autoRefresh]);

  // Update order status
  const updateOrderStatus = async (orderId: string, newStatus: string) => {
    try {
      // First, try to update the order status
      await authFetch.fetch(
        `/orders/take-orders/${orderId}/update_status/`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ status: newStatus }),
        }
      );

      // Refresh orders
      await fetchTakeOrders();
      toast({
        title: 'Success',
        description: `Order status updated to ${newStatus}`,
      });
    } catch (error: any) {
      console.error('Error updating order status:', error);
      
      // If the order doesn't exist on the backend (404), try to sync it first
      if (error?.message?.includes('404') || error?.message?.includes('not found')) {
        try {
          console.log('Take order not found on backend, attempting to sync...');
          // Mark the order as dirty to trigger sync
          const takeOrder = await (window as any).db?.takeOrders?.get(orderId);
          if (takeOrder) {
            await (window as any).db?.takeOrders?.update(orderId, { 
              _dirty: true, 
              _operation: 'update',
              status: newStatus 
            });
            
            // Trigger a sync
            const { syncService } = await import('@/lib/services/sync-service');
            await syncService.performFullSync(branchId!);
            
            // Retry the update
            await authFetch.fetch(
              `/orders/take-orders/${orderId}/update_status/`,
              {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ status: newStatus }),
              }
            );
            
            await fetchTakeOrders();
            toast({
              title: 'Success',
              description: `Order status updated to ${newStatus}`,
            });
          }
        } catch (syncError) {
          console.error('Error syncing take order:', syncError);
          toast({
            variant: 'destructive',
            title: 'Error',
            description: 'Take order not found. Please sync and try again.',
          });
        }
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to update order status',
        });
      }
    }
  };

  // Group orders by status (exclude Pending orders, show Confirmed as "New Orders")
  const ordersByStatus = {
    'Confirmed': takeOrders.filter(o => o.status === 'Confirmed'),
    'Preparing': takeOrders.filter(o => o.status === 'Preparing'),
    'Ready': takeOrders.filter(o => o.status === 'Ready'),
  };

  if (!branchId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">No branch selected</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Kitchen Display</h1>
          <p className="text-muted-foreground">
            Manage take orders and track preparation status
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={autoRefresh ? 'default' : 'outline'}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
          </Button>
          <Button onClick={fetchTakeOrders} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Orders Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Confirmed Orders */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-purple-600" />
            <h2 className="text-lg font-semibold">Confirmed Orders ({ordersByStatus['Confirmed'].length})</h2>
          </div>
          <div className="space-y-3">
            {ordersByStatus['Confirmed'].length === 0 ? (
              <Card className="bg-muted/50">
                <CardContent className="p-4 text-center text-muted-foreground">
                  No confirmed orders
                </CardContent>
              </Card>
            ) : (
              ordersByStatus['Confirmed'].map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onStatusChange={updateOrderStatus}
                />
              ))
            )}
          </div>
        </div>

        {/* Preparing Orders */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-yellow-600" />
            <h2 className="text-lg font-semibold">Preparing ({ordersByStatus['Preparing'].length})</h2>
          </div>
          <div className="space-y-3">
            {ordersByStatus['Preparing'].length === 0 ? (
              <Card className="bg-muted/50">
                <CardContent className="p-4 text-center text-muted-foreground">
                  No orders being prepared
                </CardContent>
              </Card>
            ) : (
              ordersByStatus['Preparing'].map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onStatusChange={updateOrderStatus}
                />
              ))
            )}
          </div>
        </div>

        {/* Ready Orders */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <h2 className="text-lg font-semibold">Ready ({ordersByStatus['Ready'].length})</h2>
          </div>
          <div className="space-y-3">
            {ordersByStatus['Ready'].length === 0 ? (
              <Card className="bg-muted/50">
                <CardContent className="p-4 text-center text-muted-foreground">
                  No ready orders
                </CardContent>
              </Card>
            ) : (
              ordersByStatus['Ready'].map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  onStatusChange={updateOrderStatus}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderCard({
  order,
  onStatusChange,
}: {
  order: TakeOrder;
  onStatusChange: (orderId: string, status: string) => void;
}) {
  const getNextStatus = (currentStatus: string): string => {
    const statusFlow: Record<string, string> = {
      'Confirmed': 'Preparing',
      'Preparing': 'Ready',
      'Ready': 'Completed',
    };
    return statusFlow[currentStatus] || currentStatus;
  };

  const createdTime = new Date(order.created_at);
  const now = new Date();
  const minutesAgo = Math.floor((now.getTime() - createdTime.getTime()) / 60000);

  return (
    <Card className="overflow-hidden border-l-4" style={{
      borderLeftColor: order.status === 'Confirmed' ? '#a855f7' : order.status === 'Preparing' ? '#eab308' : '#16a34a'
    }}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-2xl">Order #{order.order_number}</CardTitle>
            <CardDescription>{minutesAgo} min ago</CardDescription>
          </div>
          <Badge className={statusColors[order.status]}>
            <span className="mr-1">{statusIcons[order.status]}</span>
            {order.status}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Customer Info */}
        {(order.customer_name || order.customer_phone) && (
          <div className="space-y-1 text-sm">
            {order.customer_name && (
              <p><span className="font-semibold">Customer:</span> {order.customer_name}</p>
            )}
            {order.customer_phone && (
              <p><span className="font-semibold">Phone:</span> {order.customer_phone}</p>
            )}
          </div>
        )}

        {/* Special Instructions */}
        {order.special_instructions && (
          <>
            <Separator />
            <div className="rounded-lg bg-amber-50 p-3 text-sm">
              <p className="font-semibold text-amber-900">Special Instructions:</p>
              <p className="text-amber-800">{order.special_instructions}</p>
            </div>
          </>
        )}

        {/* Items */}
        <div className="space-y-2">
          <p className="font-semibold text-sm">Items:</p>
          <div className="space-y-2">
            {order.items.map(item => (
              <div key={item.id} className="flex items-start justify-between rounded-lg bg-muted p-2 text-sm">
                <div className="flex-1">
                  <p className="font-medium">{item.name}</p>
                  {item.notes && (
                    <p className="text-xs text-muted-foreground italic">{item.notes}</p>
                  )}
                </div>
                <Badge variant="secondary" className="ml-2 flex-shrink-0">
                  x{item.quantity}
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Customer Notes */}
        {order.customer_notes && (
          <div className="rounded-lg bg-blue-50 p-3 text-sm">
            <p className="font-semibold text-blue-900">Notes:</p>
            <p className="text-blue-800">{order.customer_notes}</p>
          </div>
        )}

        {/* Status Buttons */}
        <Separator />
        <div className="flex gap-2">
          {order.status !== 'Completed' && order.status !== 'Cancelled' && (
            <Button
              className="flex-1"
              onClick={() => onStatusChange(order.id, getNextStatus(order.status))}
            >
              {getNextStatus(order.status) === 'Preparing' && 'Start Preparing'}
              {getNextStatus(order.status) === 'Ready' && 'Mark Ready'}
              {getNextStatus(order.status) === 'Completed' && 'Complete'}
            </Button>
          )}
          {order.status !== 'Completed' && (
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onStatusChange(order.id, 'Cancelled')}
            >
              Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
