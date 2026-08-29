'use client';

import React, { useState, useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { 
  Loader2, AlertCircle, Calendar, 
  DollarSign, Plus, Zap
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { db } from '@/lib/db';
import { authFetch } from '@/lib/auth-fetch';
import { useCurrency } from '@/hooks/use-currency';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
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
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

interface SubscriptionData {
  id: number;
  business: number;
  status: string;
  account_balance: number;
  total_spent: number;
  base_price_per_day: number;
  daily_charge: number;
  monthly_charge: number;
  last_payment_date: string | null;
  last_billing_date: string | null;
  start_date: string;
  created_at: string;
  updated_at: string;
  currency_code?: string;
}

interface Deposit {
  id: number;
  deposit_id: string;
  amount: number;
  status: string;
  payment_method: string;
  transaction_id?: string | null;
  payment_proof?: string;
  requested_date: string;
  completed_date: string | null;
}

interface PaymentMethod {
  id: number;
  currency: string;
  payment_method: string;
  payment_method_display: string;
  is_enabled: boolean;
  display_order: number;
}

interface BankTransferDetails {
  id: number;
  currency: string;
  account_holder: string;
  bank_name: string;
  account_number: string;
  routing_number: string;
  swift_code: string;
  iban: string;
  instructions: string;
}

interface MobileMoneyProvider {
  id: number;
  provider: string;
  is_enabled: boolean;
  account_number: string;
  account_name: string;
  instructions: string;
  display_order: number;
}

interface Feature {
  id: number;
  feature: string;
  feature_display: string;
  price_per_day: number;
  default_price_per_day?: number;
  description: string;
  is_active?: boolean;
  is_premium?: boolean;
}

interface SubscriptionFeature {
  id: number;
  feature: number;
  feature_id: number;
  feature_name: string;
  feature_price: number;
  enabled: boolean;
  enabled_date: string;
}

export default function BillingPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [subscription, setSubscription] = useState<SubscriptionData | null>(null);
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [bankTransferDetails, setBankTransferDetails] = useState<BankTransferDetails | null>(null);
  const [mobileMoneyProviders, setMobileMoneyProviders] = useState<MobileMoneyProvider[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [subscriptionFeatures, setSubscriptionFeatures] = useState<SubscriptionFeature[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingDeposit, setIsCreatingDeposit] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositMethod, setDepositMethod] = useState('');
  const [depositTransactionId, setDepositTransactionId] = useState('');
  const [depositNotes, setDepositNotes] = useState('');
  const [showDepositDialog, setShowDepositDialog] = useState(false);
  const [showPauseDialog, setShowPauseDialog] = useState(false);
  const [showFeaturesDialog, setShowFeaturesDialog] = useState(false);
  const [hasAppliedOpenAddCredit, setHasAppliedOpenAddCredit] = useState(false);
  const [isPausing, setIsPausing] = useState(false);
  const [isUpdatingFeatures, setIsUpdatingFeatures] = useState(false);
  const { format: formatCurrency, currencyCode } = useCurrency();

  // Helper to format according to backend currency when provided
  const formatMoney = (value: number) => {
    const code = subscription?.currency_code || currencyCode;
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code }).format(value);
    } catch {
      return formatCurrency(value);
    }
  };

  
  // Fetch subscription data and payment methods
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        console.log('[Billing] Starting fresh data fetch...');
        
        // Clear ALL old cached data first
        localStorage.removeItem('subscription-features');
        sessionStorage.removeItem('subscription-features');
        
        const [subResponse, depositsResponse, paymentMethodsResponse, bankTransferResponse, mobileMoneyResponse, featuresResponse, subscriptionFeaturesResponse] = await Promise.all([
          authFetch.fetch('/subscription/subscriptions/current/'),
          authFetch.fetch('/subscription/deposits/'),
          authFetch.fetch('/config/payment-methods/'),
          authFetch.fetch('/config/bank-transfers/'),
          authFetch.fetch('/config/mobile-money/'),
          authFetch.fetch('/subscription/feature-pricing/'),
          authFetch.fetch('/subscription/subscription-features/'),
        ]);

        console.log('[Billing] Features from backend:', featuresResponse);
        console.log('[Billing] Subscription features from backend:', subscriptionFeaturesResponse);

        setSubscription(subResponse);
        setDeposits(depositsResponse.results || depositsResponse);
        
        // Filter payment methods for the business currency
        const businessCurrency = subResponse.currency_code || currencyCode;
        const availableMethods = (paymentMethodsResponse.results || paymentMethodsResponse).filter(
          (method: PaymentMethod) => method.currency === businessCurrency && method.is_enabled
        );
        setPaymentMethods(availableMethods.sort((a: PaymentMethod, b: PaymentMethod) => a.display_order - b.display_order));
        
        // Set default payment method to first available
        if (availableMethods.length > 0) {
          setDepositMethod(availableMethods[0].payment_method);
        }
        
        // Filter bank transfer details for the business currency
        const bankDetails = (bankTransferResponse.results || bankTransferResponse).find(
          (bank: BankTransferDetails) => bank.currency === businessCurrency
        );
        setBankTransferDetails(bankDetails || null);
        
        // Get mobile money providers (for MWK)
        const providers = (mobileMoneyResponse.results || mobileMoneyResponse).filter(
          (provider: MobileMoneyProvider) => provider.is_enabled
        );
        setMobileMoneyProviders(providers.sort((a: MobileMoneyProvider, b: MobileMoneyProvider) => a.display_order - b.display_order));
        
        // Set features - all available features from backend (already fetched all pages)
        let allFeatures: Feature[] = [];
        if (Array.isArray(featuresResponse)) {
          allFeatures = featuresResponse;
        } else if (featuresResponse && typeof featuresResponse === 'object') {
          allFeatures = [featuresResponse];
        }
        
        // Filter out invalid features
        allFeatures = allFeatures.filter((f: Feature) => f && f.id);
        
        console.log('[Billing] Setting features count:', allFeatures.length);
        console.log('[Billing] Available features:', allFeatures);
        console.log('[Billing] Available feature IDs:', allFeatures.map((f: Feature) => f.id));
        setFeatures(allFeatures);
        
        // Set subscription features - only enabled features from backend that exist in allFeatures
        let enabledFeatures = subscriptionFeaturesResponse.results || subscriptionFeaturesResponse || [];
        console.log('[Billing] Raw subscription features from backend:', enabledFeatures);
        
        // Filter out any subscription features that reference non-existent features
        const validEnabledFeatures = enabledFeatures.filter((sf: SubscriptionFeature) => {
          const isValid = allFeatures.some((f: Feature) => f.id === sf.feature_id);
          console.log(`[Billing] Feature ID ${sf.feature_id}: valid=${isValid}, feature_name=${sf.feature_name}`);
          return isValid;
        });
        
        console.log('[Billing] Setting subscription features count:', validEnabledFeatures.length);
        console.log('[Billing] Valid subscription feature IDs:', validEnabledFeatures.map((sf: SubscriptionFeature) => sf.feature_id));
        console.log('[Billing] Valid subscription features:', validEnabledFeatures);
        setSubscriptionFeatures(validEnabledFeatures);
        
        // Sync fresh subscription features to local storage
        if (enabledFeatures && enabledFeatures.length > 0) {
          localStorage.setItem('subscription-features', JSON.stringify(enabledFeatures));
          console.log('[Billing] Synced fresh subscription features to local storage:', enabledFeatures);
        } else {
          console.log('[Billing] No valid subscription features to cache');
        }
      } catch (error) {
        console.error('Error fetching billing data:', error);
        // Clear caches on error too
        localStorage.removeItem('subscription-features');
        sessionStorage.removeItem('subscription-features');
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to load billing information',
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, [currencyCode]);

  useEffect(() => {
    const shouldAutoOpenAddCredit = searchParams.get('openAddCredit') === '1';
    if (!shouldAutoOpenAddCredit || hasAppliedOpenAddCredit) {
      return;
    }

    setShowDepositDialog(true);
    setHasAppliedOpenAddCredit(true);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('openAddCredit');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [hasAppliedOpenAddCredit, pathname, router, searchParams]);

  const handleToggleFeature = async (featureId: number, isChecked: boolean, subscriptionFeatureId?: number) => {
    // Prevent duplicate requests
    if (isUpdatingFeatures) {
      console.log(`[Feature Toggle] Already updating features, ignoring duplicate request`);
      return;
    }
    
    setIsUpdatingFeatures(true);
    try {
      const subscriptionFeature = subscriptionFeatures.find(sf => sf.feature_id === featureId);
      
      console.log(`[Feature Toggle] Feature ID: ${featureId}, Checked: ${isChecked}, Existing: ${!!subscriptionFeature}`);
      
      // Prevent toggling if state doesn't match action
      if (isChecked && subscriptionFeature) {
        console.log(`[Feature Toggle] Feature already enabled, ignoring enable request`);
        setIsUpdatingFeatures(false);
        return;
      }
      
      if (!isChecked && !subscriptionFeature) {
        console.log(`[Feature Toggle] Feature already disabled, ignoring disable request`);
        setIsUpdatingFeatures(false);
        return;
      }
      
      // First, try to update backend
      let backendSuccess = false;
      try {
        if (isChecked && !subscriptionFeature) {
          // Create subscription feature association
          console.log(`[Feature Toggle] Creating feature ${featureId}`);
          const createPayload = {
            feature: featureId,
            enabled: true,
          };
          console.log(`[Feature Toggle] Sending payload:`, createPayload);
          await authFetch.fetch('/subscription/subscription-features/', {
            method: 'POST',
            body: JSON.stringify(createPayload),
          });
          console.log(`[Feature Toggle] Create successful for feature ${featureId}`);
          backendSuccess = true;
        } else if (!isChecked && subscriptionFeature) {
          // Delete subscription feature association
          const idToDelete = subscriptionFeatureId || subscriptionFeature?.id;
          if (idToDelete) {
            console.log(`[Feature Toggle] Deleting feature ${idToDelete}`);
            await authFetch.fetch(`/subscription/subscription-features/${idToDelete}/`, {
              method: 'DELETE',
            });
            console.log(`[Feature Toggle] Delete successful for feature ${idToDelete}`);
            backendSuccess = true;
          }
        }
      } catch (backendError) {
        console.error('[Feature Toggle] Backend update failed:', backendError);
        throw new Error(`Backend error: ${backendError instanceof Error ? backendError.message : 'Unknown error'}`);
      }

      // If backend succeeded, refresh and sync to local DB
      if (backendSuccess) {
        console.log(`[Feature Toggle] Backend succeeded, refreshing data...`);
        const [subResponse, subscriptionFeaturesResponse] = await Promise.all([
          authFetch.fetch('/subscription/subscriptions/current/'),
          authFetch.fetch('/subscription/subscription-features/'),
        ]);

        console.log(`[Feature Toggle] Refreshed subscription:`, subResponse);
        console.log(`[Feature Toggle] Refreshed features:`, subscriptionFeaturesResponse);

        // Extract features array from paginated response
        let updatedFeatures = subscriptionFeaturesResponse.results || subscriptionFeaturesResponse || [];
        if (!Array.isArray(updatedFeatures)) {
          updatedFeatures = [];
        }
        
        console.log(`[Feature Toggle] Updated features array:`, updatedFeatures);
        
        setSubscription(subResponse);
        setSubscriptionFeatures(updatedFeatures);

        // Sync subscription to local DB
        if (subResponse) {
          await db.subscriptions.put({
            id: 'sub_main-business',
            businessId: subResponse.business,
            status: subResponse.status,
            account_balance: subResponse.account_balance,
            total_spent: subResponse.total_spent,
            base_price_per_day: subResponse.base_price_per_day,
            free_trial_days: subResponse.free_trial_days || 0,
            free_trial_credits_applied: subResponse.free_trial_credits_applied || false,
            free_trial_credits_amount: subResponse.free_trial_credits_amount || 0,
            enable_pos: subResponse.enable_pos !== false,
            enable_inventory: subResponse.enable_inventory !== false,
            enable_invoicing: subResponse.enable_invoicing !== false,
            enable_online_menu: subResponse.enable_online_menu !== false,
            enable_online_ordering: subResponse.enable_online_ordering !== false,
            enable_kitchen: subResponse.enable_kitchen !== false,
            enable_expense_management: subResponse.enable_expense_management !== false,
            enable_supplier_management: subResponse.enable_supplier_management !== false,
            enable_purchases: subResponse.enable_purchases !== false,
            enable_low_stock_alerts: subResponse.enable_low_stock_alerts !== false,
            enable_expiry_alerts: subResponse.enable_expiry_alerts !== false,
            enable_customer_management: subResponse.enable_customer_management !== false,
            enable_reports: subResponse.enable_reports !== false,
            enable_analytics: subResponse.enable_analytics !== false,
            enable_take_orders: subResponse.enable_take_orders !== false,
            enable_staff_management: subResponse.enable_staff_management !== false,
            enable_waste_management: subResponse.enable_waste_management !== false,
            enable_stock_transfers: subResponse.enable_stock_transfers !== false,
            enable_stock_audits: subResponse.enable_stock_audits !== false,
            enable_tax_management: subResponse.enable_tax_management !== false,
            enable_multi_branch: subResponse.enable_multi_branch !== false,
            enable_usage_limits: subResponse.enable_usage_limits !== false,
            low_balance_threshold: subResponse.low_balance_threshold || 10,
            low_balance_notified: subResponse.low_balance_notified || false,
            start_date: subResponse.start_date,
            created_at: subResponse.created_at,
            updated_at: subResponse.updated_at,
          });
        }

        toast({
          title: 'Success',
          description: `Feature ${isChecked ? 'added' : 'removed'} successfully`,
        });
        
        // Close the manage features dialog after successful change
        setShowFeaturesDialog(false);
      }
    } catch (error) {
      console.error('[Feature Toggle] Error updating feature:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to update feature. Backend connection required.',
      });
    } finally {
      setIsUpdatingFeatures(false);
    }
  };

  const handleCreateDeposit = async () => {
    if (!depositAmount || parseFloat(depositAmount) <= 0) {
      toast({
        variant: 'destructive',
        title: 'Invalid Amount',
        description: 'Please enter a valid deposit amount',
      });
      return;
    }

    if (!depositMethod) {
      toast({
        variant: 'destructive',
        title: 'Payment Method Required',
        description: 'Please select a payment method',
      });
      return;
    }

    if (!depositTransactionId.trim()) {
      toast({
        variant: 'destructive',
        title: 'Transaction ID Required',
        description: 'Enter the payment transaction/reference ID used for this deposit.',
      });
      return;
    }

    setIsCreatingDeposit(true);
    try {
      await authFetch.fetch('/subscription/deposits/', {
        method: 'POST',
        body: JSON.stringify({
          amount: parseFloat(depositAmount),
          payment_method: depositMethod,
          transaction_id: depositTransactionId.trim(),
          payment_proof: depositNotes.trim() || depositTransactionId.trim(),
        }),
      });

      setDepositAmount('');
      setDepositTransactionId('');
      setDepositNotes('');
      setShowDepositDialog(false);
      toast({
        title: 'Deposit Submitted',
        description: 'Your paid deposit was submitted successfully and is pending verification.',
      });
      
      // Refresh deposits
      const depositsResponse = await authFetch.fetch('/subscription/deposits/');
      setDeposits(depositsResponse.results || depositsResponse);
    } catch (error) {
      console.error('Error creating deposit:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create deposit',
      });
    } finally {
      setIsCreatingDeposit(false);
    }
  };

  const handlePauseSubscription = async () => {
    setIsPausing(true);
    try {
      await authFetch.fetch('/subscription/subscriptions/pause/', {
        method: 'POST',
      });

      toast({
        title: 'Subscription Paused',
        description: 'Your subscription has been paused. You can resume it anytime.',
      });

      setShowPauseDialog(false);
      
      // Refresh subscription
      const subResponse = await authFetch.fetch('/subscription/subscriptions/current/');
      setSubscription(subResponse);
    } catch (error) {
      console.error('Error pausing subscription:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to pause subscription',
      });
    } finally {
      setIsPausing(false);
    }
  };

  const handleResumeSubscription = async () => {
    try {
      await authFetch.fetch('/subscription/subscriptions/resume/', {
        method: 'POST',
      });

      toast({
        title: 'Subscription Resumed',
        description: 'Your subscription is now active.',
      });

      // Refresh subscription
      const subResponse = await authFetch.fetch('/subscription/subscriptions/current/');
      setSubscription(subResponse);
    } catch (error) {
      console.error('Error resuming subscription:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to resume subscription',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge className="bg-green-600">Active</Badge>;
      case 'paused':
        return <Badge className="bg-yellow-600">Paused</Badge>;
      case 'cancelled':
        return <Badge className="bg-red-600">Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getDepositStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge className="bg-yellow-600">Pending</Badge>;
      case 'completed':
        return <Badge className="bg-green-600">Completed</Badge>;
      case 'failed':
        return <Badge className="bg-red-600">Failed</Badge>;
      case 'cancelled':
        return <Badge className="bg-gray-600">Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const formatPaymentMethodLabel = (method: string) => method.replace(/_/g, ' ');

  const daysUntilInsufficientBalance = subscription && subscription.daily_charge > 0
    ? Math.floor(subscription.account_balance / subscription.daily_charge)
    : null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!subscription) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Billing</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-muted-foreground mb-4">No subscription information found.</p>
          <p className="text-muted-foreground mb-6">Please complete the setup process.</p>
          <Button asChild>
            <Link href="/setup">Go to Setup</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6">
      {/* Account Balance Overview */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Account Balance</CardTitle>
              <CardDescription>Pay-as-you-go subscription model</CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Dialog open={showDepositDialog} onOpenChange={setShowDepositDialog}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="mr-2 h-4 w-4" />
                    Add Credits
                  </Button>
                </DialogTrigger>
                <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto scrollbar-hide p-4 sm:p-6">
                  <DialogHeader>
                    <DialogTitle>Add Credits to Account</DialogTitle>
                    <DialogDescription>
                      Submit a deposit after you have already paid. Enter the transaction/reference ID used for the payment.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="amount">Amount ({subscription?.currency_code || currencyCode})</Label>
                      <div className="flex gap-2">
                        <Input
                          id="amount"
                          type="number"
                          placeholder="0.00"
                          value={depositAmount}
                          onChange={(e) => setDepositAmount(e.target.value)}
                          step="0.01"
                          min="0"
                        />
                      </div>
                    </div>

                    <div>
                      <Label htmlFor="method">Payment Method</Label>
                      {paymentMethods.length > 0 ? (
                        <Select value={depositMethod} onValueChange={setDepositMethod}>
                          <SelectTrigger id="method">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {paymentMethods.map((method) => (
                              <SelectItem key={method.id} value={method.payment_method}>
                                {method.payment_method_display}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="p-2 border border-border rounded bg-muted/40 text-muted-foreground text-sm">
                          No payment methods available for your currency
                        </div>
                      )}
                    </div>

                    {/* Show account details based on selected payment method */}
                    {depositMethod === 'stripe' && (
                      <div className="p-3 border border-border rounded-lg bg-muted/40">
                        <p className="font-semibold text-sm mb-2">Stripe:</p>
                        <div className="space-y-1 text-sm">
                          <p className="text-muted-foreground">Select this if you already paid via Stripe.</p>
                          <p className="text-muted-foreground mt-2">Enter the Stripe transaction/reference ID below.</p>
                        </div>
                      </div>
                    )}

                    {depositMethod === 'paypal' && (
                      <div className="p-3 border border-border rounded-lg bg-muted/40">
                        <p className="font-semibold text-sm mb-2">PayPal:</p>
                        <div className="space-y-1 text-sm">
                          <p className="text-muted-foreground">Select this if you already paid via PayPal.</p>
                          <p className="text-muted-foreground mt-2">Enter the PayPal transaction/reference ID below.</p>
                        </div>
                      </div>
                    )}

                    {depositMethod === 'bank_transfer' && bankTransferDetails && (
                      <div className="p-3 border border-border rounded-lg bg-muted/40 space-y-3">
                        <p className="font-semibold text-sm">Bank Transfer Details:</p>
                        <div className="space-y-2 text-sm bg-card p-2 rounded border border-border">
                          <div className="flex flex-col gap-1 border-b pb-2 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-muted-foreground">Account Holder:</span>
                            <span className="font-semibold">{bankTransferDetails.account_holder}</span>
                          </div>
                          <div className="flex flex-col gap-1 border-b pb-2 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-muted-foreground">Bank Name:</span>
                            <span className="font-semibold">{bankTransferDetails.bank_name}</span>
                          </div>
                          <div className="flex flex-col gap-1 border-b pb-2 sm:flex-row sm:items-center sm:justify-between">
                            <span className="text-muted-foreground">Account Number:</span>
                            <span className="font-mono text-xs sm:text-sm font-semibold break-all">{bankTransferDetails.account_number}</span>
                          </div>
                          {bankTransferDetails.routing_number && (
                            <div className="flex flex-col gap-1 border-b pb-2 sm:flex-row sm:items-center sm:justify-between">
                              <span className="text-muted-foreground">Routing Number:</span>
                              <span className="font-mono text-xs sm:text-sm font-semibold break-all">{bankTransferDetails.routing_number}</span>
                            </div>
                          )}
                          {bankTransferDetails.swift_code && (
                            <div className="flex flex-col gap-1 border-b pb-2 sm:flex-row sm:items-center sm:justify-between">
                              <span className="text-muted-foreground">SWIFT Code:</span>
                              <span className="font-mono text-xs sm:text-sm font-semibold break-all">{bankTransferDetails.swift_code}</span>
                            </div>
                          )}
                          {bankTransferDetails.iban && (
                            <div className="flex flex-col gap-1 border-b pb-2 sm:flex-row sm:items-center sm:justify-between">
                              <span className="text-muted-foreground">IBAN:</span>
                              <span className="font-mono text-xs sm:text-sm font-semibold break-all">{bankTransferDetails.iban}</span>
                            </div>
                          )}
                        </div>
                        {bankTransferDetails.instructions && (
                          <div className="p-2 bg-muted/60 rounded border border-border">
                            <p className="text-muted-foreground text-xs font-semibold mb-1">Instructions:</p>
                            <p className="text-xs">{bankTransferDetails.instructions}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {depositMethod === 'mobile_money' && mobileMoneyProviders.length > 0 && (
                      <div className="p-3 border border-border rounded-lg bg-muted/40 space-y-2">
                        <p className="font-semibold text-sm mb-2">Mobile Money Providers:</p>
                        {mobileMoneyProviders.map((provider) => (
                          <div key={provider.id} className="bg-card p-2 rounded border border-border">
                            <p className="font-semibold text-sm mb-2">{provider.provider}</p>
                            <div className="space-y-1 text-sm">
                              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                <span className="text-muted-foreground">Account Number:</span>
                                <span className="font-mono text-xs sm:text-sm font-semibold break-all">{provider.account_number}</span>
                              </div>
                              {provider.account_name && (
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                  <span className="text-muted-foreground">Account Name:</span>
                                  <span className="font-semibold">{provider.account_name}</span>
                                </div>
                              )}
                            </div>
                            {provider.instructions && (
                              <div className="mt-2 p-2 bg-muted/60 rounded border border-border">
                                <p className="text-muted-foreground text-xs font-semibold mb-1">Instructions:</p>
                                <p className="text-xs">{provider.instructions}</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    <div>
                      <Label htmlFor="transactionId">Transaction ID / Reference Number</Label>
                      <Input
                        id="transactionId"
                        placeholder="e.g. MPAM-123456789, CHRG_xxx, PAYPAL-xxx"
                        value={depositTransactionId}
                        onChange={(e) => setDepositTransactionId(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Required. Use the exact reference from your payment receipt/SMS.
                      </p>
                    </div>

                    <div>
                      <Label htmlFor="notes">Additional Payment Details (Optional)</Label>
                      <Textarea
                        id="notes"
                        placeholder="Any extra context for verification (payer name, timestamp, etc.)"
                        value={depositNotes}
                        onChange={(e) => setDepositNotes(e.target.value)}
                        rows={3}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        Optional notes to help verify your payment faster.
                      </p>
                    </div>

                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        Deposit submissions are reviewed and approved before credits are added to your balance.
                      </AlertDescription>
                    </Alert>

                    <Button
                      onClick={handleCreateDeposit}
                      disabled={isCreatingDeposit || !depositAmount || !depositMethod || !depositTransactionId.trim()}
                      className="w-full"
                    >
                      {isCreatingDeposit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      Submit Deposit
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>

              {subscription.status === 'active' ? (
                <Dialog open={showPauseDialog} onOpenChange={setShowPauseDialog}>
                  <DialogTrigger asChild>
                    <Button variant="outline">Pause Subscription</Button>
                  </DialogTrigger>
                  <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-md p-4 sm:p-6">
                    <DialogHeader>
                      <DialogTitle>Pause Subscription</DialogTitle>
                      <DialogDescription>
                        Pausing your subscription will stop all charges. You can resume anytime.
                      </DialogDescription>
                    </DialogHeader>
                    <Alert>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        While paused, you won't have access to the system, but your data will be preserved.
                      </AlertDescription>
                    </Alert>
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                      <Button variant="outline" onClick={() => setShowPauseDialog(false)}>
                        Cancel
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={handlePauseSubscription}
                        disabled={isPausing}
                      >
                        {isPausing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Pause Subscription
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              ) : (
                <Button onClick={handleResumeSubscription} variant="outline">
                  Resume Subscription
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          {/* Current Balance */}
          <Card className="bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-blue-900 dark:text-blue-100">Current Balance</CardTitle>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">
                {formatMoney(subscription.account_balance)}
              </div>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">Available credits</p>
            </CardContent>
          </Card>

          {/* Daily Charge */}
          <Card className="bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 border-purple-200 dark:border-purple-800">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium text-purple-900 dark:text-purple-100">Daily Charge</CardTitle>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="text-2xl font-bold text-purple-900 dark:text-purple-100">
                {formatMoney(subscription.daily_charge)}
              </div>
              <p className="text-xs text-purple-700 dark:text-purple-300 mt-1">Per day</p>
            </CardContent>
          </Card>

          {/* Days Remaining */}
          <Card className={cn(
            "bg-gradient-to-br border-2",
            daysUntilInsufficientBalance && daysUntilInsufficientBalance > 30
              ? "from-green-50 to-green-100 dark:from-green-950 dark:to-green-900 border-green-200 dark:border-green-800"
              : daysUntilInsufficientBalance && daysUntilInsufficientBalance > 7
              ? "from-yellow-50 to-yellow-100 dark:from-yellow-950 dark:to-yellow-900 border-yellow-200 dark:border-yellow-800"
              : "from-red-50 to-red-100 dark:from-red-950 dark:to-red-900 border-red-200 dark:border-red-800"
          )}>
            <CardHeader className="pb-2">
              <CardTitle className={cn(
                "text-xs font-medium",
                daysUntilInsufficientBalance && daysUntilInsufficientBalance > 30
                  ? "text-green-900 dark:text-green-100"
                  : daysUntilInsufficientBalance && daysUntilInsufficientBalance > 7
                  ? "text-yellow-900 dark:text-yellow-100"
                  : "text-red-900 dark:text-red-100"
              )}>Days Until Low Balance</CardTitle>
            </CardHeader>
            <CardContent className="pb-3">
              <div className={cn(
                "text-2xl font-bold",
                daysUntilInsufficientBalance && daysUntilInsufficientBalance > 30
                  ? "text-green-900 dark:text-green-100"
                  : daysUntilInsufficientBalance && daysUntilInsufficientBalance > 7
                  ? "text-yellow-900 dark:text-yellow-100"
                  : "text-red-900 dark:text-red-100"
              )}>
                {daysUntilInsufficientBalance ?? '∞'}
              </div>
              <p className={cn(
                "text-xs mt-1",
                daysUntilInsufficientBalance && daysUntilInsufficientBalance > 30
                  ? "text-green-700 dark:text-green-300"
                  : daysUntilInsufficientBalance && daysUntilInsufficientBalance > 7
                  ? "text-yellow-700 dark:text-yellow-300"
                  : "text-red-700 dark:text-red-300"
              )}>
                {daysUntilInsufficientBalance && daysUntilInsufficientBalance <= 7
                  ? "⚠️ Add credits soon"
                  : "Estimated days"}
              </p>
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      {/* Subscription Status */}
      <Card>
        <CardHeader>
          <CardTitle>Subscription Status</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Status</p>
            <div className="flex items-center gap-2">
              {getStatusBadge(subscription.status)}
              <span className="text-sm font-medium capitalize">{subscription.status}</span>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Monthly Charge</p>
            <p className="text-lg font-semibold">{formatMoney(subscription.monthly_charge)}</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Total Spent</p>
            <p className="text-lg font-semibold">{formatMoney(subscription.total_spent)}</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Member Since</p>
            <p className="text-lg font-semibold">
              {format(parseISO(subscription.start_date), 'MMM d, yyyy')}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Features Management */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>Subscription Features</CardTitle>
              <CardDescription>
                {subscriptionFeatures.length > 0 
                  ? `${subscriptionFeatures.length} feature${subscriptionFeatures.length !== 1 ? 's' : ''} enabled`
                  : 'No features enabled yet'}
              </CardDescription>
            </div>
            <Dialog open={showFeaturesDialog} onOpenChange={setShowFeaturesDialog}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Manage Features
                </Button>
              </DialogTrigger>
              <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto scrollbar-hide p-4 sm:p-6">
                <DialogHeader>
                  <DialogTitle>Manage Subscription Features</DialogTitle>
                  <DialogDescription>
                    Enable or disable features to customize your subscription. Each feature has its own daily charge.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  {features.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">No features available</p>
                  ) : (
                    <div className="space-y-3">
                      {features.map((feature) => {
                        const isEnabled = subscriptionFeatures.some(sf => sf.feature_id === feature.id && sf.enabled);
                        return (
                          <div key={feature.id} className="flex items-start justify-between gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-semibold text-sm">{feature.feature_display}</p>
                                {feature.is_premium && (
                                  <Badge className="bg-purple-600">Premium</Badge>
                                )}
                              </div>
                              {feature.description && (
                                <p className="text-xs text-muted-foreground mt-1">{feature.description}</p>
                              )}
                              <p className="text-sm font-medium mt-2">
                                {formatMoney(feature.price_per_day || feature.default_price_per_day || 0)} / day
                              </p>
                            </div>
                            <div className="flex items-center gap-2 ml-4">
                              <input
                                type="checkbox"
                                checked={isEnabled}
                                onChange={(e) => handleToggleFeature(feature.id, e.target.checked)}
                                disabled={isUpdatingFeatures}
                                className="w-5 h-5 rounded cursor-pointer"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="mt-6 p-4 bg-muted rounded-lg">
                  <p className="text-sm font-semibold mb-2">Current Daily Charge:</p>
                  <p className="text-2xl font-bold">{subscription && formatMoney(subscription.daily_charge)}</p>
                  <p className="text-xs text-muted-foreground mt-2">
                    This includes the base subscription fee plus all enabled features.
                  </p>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {subscriptionFeatures.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No features enabled yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {subscriptionFeatures.map((sf) => {
                  const feature = features.find(f => f.id === sf.feature_id);
                  if (!feature) return null;
                  
                  return (
                    <div key={sf.id} className="flex items-start justify-between gap-3 p-3 border rounded-lg bg-green-50 border-green-200 dark:bg-green-950/40 dark:border-green-800 transition-colors">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-sm">{feature.feature_display}</p>
                          {feature.is_premium && (
                            <Badge className="bg-purple-600">Premium</Badge>
                          )}
                          <Badge className="bg-green-600">Enabled</Badge>
                        </div>
                        {feature.description && (
                          <p className="text-xs text-muted-foreground mt-1">{feature.description}</p>
                        )}
                        <div className="flex items-center gap-4 mt-2">
                          <span className="text-sm font-medium">
                            {formatMoney(feature.price_per_day || feature.default_price_per_day || 0)} / day
                          </span>
                          {sf && (
                            <span className="text-xs text-muted-foreground">
                              Enabled {format(parseISO(sf.enabled_date), 'MMM d, yyyy')}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <input
                          type="checkbox"
                          checked={true}
                          onChange={(e) => handleToggleFeature(feature.id, e.target.checked)}
                          disabled={isUpdatingFeatures}
                          className="w-5 h-5 rounded cursor-pointer"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {subscriptionFeatures.length > 0 && (
              <div className="p-3 bg-blue-50 border border-blue-200 dark:bg-blue-950/40 dark:border-blue-800 rounded-lg">
                <p className="text-sm text-blue-900 dark:text-blue-100">
                  <strong>Features Total:</strong> {formatMoney(
                    subscriptionFeatures.reduce((sum, f) => sum + Number(f.feature_price || 0), 0)
                  )} / day
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent Deposits */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Deposits</CardTitle>
          <CardDescription>Track your account credit additions</CardDescription>
        </CardHeader>
        <CardContent>
          {deposits.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No deposits yet. Add credits to get started.</p>
            </div>
          ) : (
            <>
              <div className="md:hidden space-y-3">
                {deposits.slice(0, 10).map((deposit) => (
                  <div key={deposit.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-mono text-xs break-all">{deposit.deposit_id}</p>
                      {getDepositStatusBadge(deposit.status)}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">Amount</span>
                      <span className="font-semibold">{formatMoney(deposit.amount)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">Method</span>
                      <span className="text-sm capitalize">{formatPaymentMethodLabel(deposit.payment_method)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">Transaction ID</span>
                      <span className="text-xs font-mono break-all text-right">
                        {deposit.transaction_id || deposit.payment_proof || '-'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-muted-foreground">Date</span>
                      <span className="text-sm">{format(parseISO(deposit.requested_date), 'MMM d, yyyy')}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Deposit ID</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Transaction ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deposits.slice(0, 10).map((deposit) => (
                      <TableRow key={deposit.id}>
                        <TableCell className="font-mono text-sm break-all">{deposit.deposit_id}</TableCell>
                        <TableCell className="font-semibold">{formatMoney(deposit.amount)}</TableCell>
                        <TableCell className="capitalize">{formatPaymentMethodLabel(deposit.payment_method)}</TableCell>
                        <TableCell className="font-mono text-xs break-all">
                          {deposit.transaction_id || deposit.payment_proof || '-'}
                        </TableCell>
                        <TableCell>{getDepositStatusBadge(deposit.status)}</TableCell>
                        <TableCell className="text-sm">
                          {format(parseISO(deposit.requested_date), 'MMM d, yyyy')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Pricing Information */}
      <Card>
        <CardHeader>
          <CardTitle>Pricing Information</CardTitle>
          <CardDescription>How your subscription charges are calculated</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Zap className="h-4 w-4" />
            <AlertDescription>
              You're on a pay-as-you-go plan. You're charged daily based on your base subscription fee and enabled features.
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 p-4 border rounded-lg">
              <p className="font-semibold flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Daily Charge
              </p>
              <p className="text-2xl font-bold">{formatMoney(subscription.daily_charge)}</p>
              <p className="text-sm text-muted-foreground">Includes base fee + enabled features</p>
            </div>

            <div className="space-y-2 p-4 border rounded-lg">
              <p className="font-semibold flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Monthly Estimate
              </p>
              <p className="text-2xl font-bold">{formatMoney(subscription.monthly_charge)}</p>
              <p className="text-sm text-muted-foreground">Based on 30 days</p>
            </div>
          </div>

          <div className="p-4 bg-muted rounded-lg">
            <p className="text-sm text-muted-foreground mb-2">
              Your daily charge includes your base subscription fee plus any enabled premium features. 
              Credits are automatically deducted daily to cover these charges.
            </p>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
