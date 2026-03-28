"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Carrot,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Pill,
  ShoppingCart,
  Store,
  UtensilsCrossed,
  Wine,
  Building,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { authFetch } from "@/lib/auth-fetch";
import { HandyPosLogo } from "./icons/logo";
import { cn } from "@/lib/utils";
import { db, type Business, type Subscription } from "@/lib/db";
import { plans, type Plan } from "@/lib/subscriptions";
import { addDays } from "date-fns";
import { Textarea } from "./ui/textarea";

const wizardSchema = z.object({
  businessName: z.string().min(2, "Business name must be at least 2 characters."),
  businessType: z.string().min(1, "Please select a business type."),
  country: z.string().min(1, "Please select a country."),
  currency: z.string().default("USD"),
  email: z.string().email('Please enter a valid email.').optional().or(z.literal('')),
  phone: z.string().optional(),
  address: z.string().optional(),
  website: z.string().url('Please enter a valid URL.').optional().or(z.literal('')),
  referralCode: z.string().optional().or(z.literal('')),
});

type WizardData = z.infer<typeof wizardSchema>;

type TrialPreviewResponse = {
  currency_code?: string;
  free_trial_days?: number;
  free_trial_credits_amount?: number;
  total_daily_charge?: number;
  base_price_per_day?: number;
  free_trial_end_date?: string;
};

type BackendSubscriptionResponse = Record<string, any>;

const businessTypes = [
  { id: 'restaurant', label: 'Restaurant', icon: UtensilsCrossed },
  { id: 'supermarket', label: 'Supermarket', icon: ShoppingCart },
  { id: 'grocery', label: 'Grocery', icon: Carrot },
  { id: 'bar_liquor', label: 'Bar & Liquor', icon: Wine },
  { id: 'beauty_salon', label: 'Beauty Salon and Spa', icon: Store },
  { id: 'pharmacy', label: 'Pharmacy', icon: Pill },
  { id: 'generic', label: 'Generic', icon: Building },
];

const currencies = [
  { value: 'USD', label: 'USD - United States Dollar' },
  { value: 'MWK', label: 'MWK - Malawian Kwacha' },
];

export function SetupWizard() {
  const [current, setCurrent] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showInvalidReferralDialog, setShowInvalidReferralDialog] = useState(false);
  const [pendingPlan, setPendingPlan] = useState<Plan | null>(null);
  const [referralName, setReferralName] = useState<string | null>(null);
  const [referralLoading, setReferralLoading] = useState(false);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [features, setFeatures] = useState<any[]>([]);
  const [featuresLoading, setFeaturesLoading] = useState(true);
  const [trialPreview, setTrialPreview] = useState<TrialPreviewResponse | null>(null);
  const [trialPreviewLoading, setTrialPreviewLoading] = useState(false);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);
  const { toast } = useToast();
  const { business, selectBusiness } = useAuth();

  const normalizeBusinessId = (value: unknown): string => String(value ?? "").trim();
  const normalizeCurrency = (value: string): string => {
    const normalized = String(value || "").trim().toUpperCase();
    return normalized === "MWK" ? "MWK" : "USD";
  };
  const isDeliveryEnabledForPlan = (planId: string): boolean => planId === "enterprise";
  const toNumber = (value: unknown, fallback = 0): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const toDateString = (value: unknown, fallback: string): string => {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    return fallback;
  };
  const toOptionalDateString = (value: unknown): string | undefined => {
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
    return undefined;
  };
  const toSubscriptionStatus = (value: unknown): Subscription['status'] => {
    if (value === 'paused' || value === 'cancelled') {
      return value;
    }
    return 'active';
  };
  const formatMoney = (value: number, currencyCode: string): string => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: normalizeCurrency(currencyCode),
        minimumFractionDigits: 2,
      }).format(value);
    } catch {
      return `${normalizeCurrency(currencyCode)} ${value.toFixed(2)}`;
    }
  };
  const mapSubscriptionForCache = (
    response: BackendSubscriptionResponse,
    businessId: string,
    planId?: Plan['id']
  ): Subscription => {
    const nowIso = new Date().toISOString();
    const freeTrialDays = toNumber(response.free_trial_days, 30);
    const freeTrialEndDate = toDateString(
      response.free_trial_end_date,
      addDays(new Date(), freeTrialDays).toISOString()
    );

    return {
      id: 'sub_main-business',
      businessId,
      planId: planId || 'starter',
      status: toSubscriptionStatus(response.status),
      trialEndDate: freeTrialEndDate,
      account_balance: toNumber(response.account_balance, 0),
      total_spent: toNumber(response.total_spent, 0),
      base_price_per_day: toNumber(response.base_price_per_day, 0),
      free_trial_days: freeTrialDays,
      free_trial_credits_applied: response.free_trial_credits_applied === true,
      free_trial_credits_amount: toNumber(response.free_trial_credits_amount, 0),
      free_trial_end_date: freeTrialEndDate,
      enable_pos: response.enable_pos !== false,
      enable_inventory: response.enable_inventory !== false,
      enable_invoicing: response.enable_invoicing !== false,
      enable_online_menu: response.enable_online_menu !== false,
      enable_online_ordering: response.enable_online_ordering !== false,
      enable_kitchen: response.enable_kitchen !== false,
      enable_expense_management: response.enable_expense_management !== false,
      enable_supplier_management: response.enable_supplier_management !== false,
      enable_purchases: response.enable_purchases !== false,
      enable_low_stock_alerts: response.enable_low_stock_alerts !== false,
      enable_expiry_alerts: response.enable_expiry_alerts !== false,
      enable_customer_management: response.enable_customer_management !== false,
      enable_reports: response.enable_reports !== false,
      enable_analytics: response.enable_analytics !== false,
      enable_take_orders: response.enable_take_orders !== false,
      enable_staff_management: response.enable_staff_management !== false,
      enable_waste_management: response.enable_waste_management !== false,
      enable_stock_transfers: response.enable_stock_transfers !== false,
      enable_stock_audits: response.enable_stock_audits !== false,
      enable_tax_management: response.enable_tax_management !== false,
      enable_multi_branch: response.enable_multi_branch !== false,
      enable_usage_limits: response.enable_usage_limits !== false,
      low_balance_threshold: toNumber(response.low_balance_threshold, 10),
      low_balance_notified: response.low_balance_notified === true,
      low_balance_notified_date: toOptionalDateString(response.low_balance_notified_date),
      start_date: toDateString(response.start_date, nowIso),
      last_payment_date: toOptionalDateString(response.last_payment_date),
      last_billing_date: toOptionalDateString(response.last_billing_date),
      last_charge_date: toOptionalDateString(response.last_charge_date),
      created_at: toDateString(response.created_at, nowIso),
      updated_at: toDateString(response.updated_at, nowIso),
    };
  };
  const fetchCurrentSubscription = async (businessId: string): Promise<BackendSubscriptionResponse> => (
    authFetch.fetch<BackendSubscriptionResponse>(
      `/subscription/subscriptions/current/?business=${encodeURIComponent(businessId)}`
    )
  );
  const fetchTrialPreview = async (businessId: string): Promise<void> => {
    setTrialPreviewLoading(true);
    try {
      const preview = await authFetch.fetch<TrialPreviewResponse>(
        `/subscription/subscriptions/trial-preview/?business=${encodeURIComponent(businessId)}`
      );
      setTrialPreview(preview || null);
    } catch (error) {
      console.warn('[Setup Wizard] Failed to fetch trial preview:', error);
      setTrialPreview(null);
    } finally {
      setTrialPreviewLoading(false);
    }
  };

  const persistBusinessSettingsCache = (businessId: string, currency: string) => {
    localStorage.setItem(
      'handypos-business-settings',
      JSON.stringify({
        businessId,
        currency,
        timezone: 'UTC',
      })
    );
  };

  const persistBusinessProfile = async (businessId: string, data: WizardData, currency: string) => {
    const businessProfile: Business = {
      id: businessId,
      name: data.businessName,
      type: data.businessType,
      currency,
      email: data.email || '',
      phone: data.phone || '',
      address: data.address || '',
      website: data.website || '',
    };
    await db.business.put(businessProfile);

    selectBusiness({
      id: businessId,
      name: data.businessName,
      type: data.businessType,
      currency,
      selectedAt: new Date().toISOString(),
    });

    localStorage.setItem(
      'handypos-business',
      JSON.stringify({
        id: businessId,
        name: data.businessName,
        type: data.businessType,
        currency,
      })
    );
    persistBusinessSettingsCache(businessId, currency);
  };

  useEffect(() => {
    const clearOldData = async () => {
      try {
        const keysToRemove = [
          'handypos-business',
          'handypos-business-settings',
          'handypos-business-id',
          'handypos-active-branch',
          'handypos-current-branch-id',
          'handypos-branches',
          'handy-pos-business',
          'handypos-auth-tokens',
          'handy-pos-auth-tokens',
        ];
        
        keysToRemove.forEach(key => localStorage.removeItem(key));

        await db.transaction('rw', [db.business, db.subscriptions, db.inventory, db.expenses, db.stockTakes, db.purchaseHistory], async () => {
          await db.business.clear();
          await db.subscriptions.clear();
          await db.inventory.clear();
          await db.expenses.clear();
          await db.stockTakes.clear();
          await db.purchaseHistory.clear();
        });
      } catch (error) {
        console.error('Error clearing old data:', error);
      }
    };

    clearOldData();
  }, []);

  const form = useForm<z.infer<typeof wizardSchema>>({
    resolver: zodResolver(wizardSchema),
    defaultValues: {
      businessName: "",
      currency: "USD",
      businessType: "",
      country: "",
      email: "",
      phone: "",
      address: "",
      website: "",
    },
  });

  const country = form.watch('country');
  useEffect(() => {
    if (country) {
      const isMalawi = country.toLowerCase().includes('malawi');
      form.setValue('currency', isMalawi ? 'MWK' : 'USD');
    }
  }, [country, form]);

  useEffect(() => {
    const fetchFeatures = async () => {
      try {
        const response = await authFetch.fetch<any>('/subscription/feature-pricing/');
        let featuresList: any[] = [];
        
        if (Array.isArray(response)) {
          featuresList = response;
        } else if (response?.results && Array.isArray(response.results)) {
          featuresList = response.results;
        }
        
        setFeatures(featuresList);
      } catch (error) {
        setFeatures([]);
      } finally {
        setFeaturesLoading(false);
      }
    };
    
    fetchFeatures();
  }, []);

  useEffect(() => {
    const businessId = normalizeBusinessId(business?.id);
    if (current !== 1 || !businessId) {
      return;
    }

    fetchTrialPreview(businessId);
  }, [business?.id, current]);

  useEffect(() => {
    const referralCode = form.watch('referralCode');
    
    if (!referralCode || referralCode.trim() === '') {
      setReferralName(null);
      setReferralError(null);
      return;
    }

    const fetchReferralName = async () => {
      setReferralLoading(true);
      setReferralError(null);
      try {
        const response = await authFetch.fetch<any>(
          `/affiliate/affiliates/validate-code/?code=${encodeURIComponent(referralCode)}`
        );
        
        if (response.valid && response.name) {
          setReferralName(response.name);
        } else {
          setReferralName(null);
          setReferralError('Invalid referral code');
        }
      } catch (error) {
        setReferralName(null);
        setReferralError('Invalid referral code');
      } finally {
        setReferralLoading(false);
      }
    };

    const timer = setTimeout(fetchReferralName, 500);
    return () => clearTimeout(timer);
  }, [form.watch('referralCode')]);

  const goNext = async (fieldToValidate?: keyof WizardData | (keyof WizardData)[]) => {
    let isValid = true;
    if (fieldToValidate) {
      isValid = await form.trigger(fieldToValidate as any);
    }
    if (isValid) {
      if (current === 0 && !business?.id) {
        setIsSubmitting(true);
        try {
          const data = form.getValues();
          const selectedCurrency = normalizeCurrency(data.currency);
          
          const businessResponse = await authFetch.fetch<any>(
            '/business/businesses/',
            {
              method: 'POST',
              body: JSON.stringify({
                name: data.businessName,
                business_type: data.businessType,
                country: data.country,
                currency: selectedCurrency,
                email: data.email,
                phone: data.phone,
                address: data.address,
                website: data.website,
              }),
            }
          );

          if (!businessResponse?.id) {
            throw new Error('Failed to create business');
          }

          const businessId = normalizeBusinessId(businessResponse.id);
          await persistBusinessProfile(businessId, data, selectedCurrency);

          // Ensure backend settings are aligned immediately after create.
          await authFetch.fetch<any>(
            `/business/businesses/${businessId}/business_settings/`,
            {
              method: 'PUT',
              body: JSON.stringify({
                currency: selectedCurrency,
              }),
            }
          ).catch((error) => {
            console.warn('[Setup Wizard] Initial currency sync failed (non-blocking):', error);
          });

          const branchesResponse = await authFetch.fetch<any>(
            `/business/businesses/${businessId}/branches/`
          );
          
          let branchesArray: any[] = [];
          if (Array.isArray(branchesResponse)) {
            branchesArray = branchesResponse;
          } else if (branchesResponse?.results && Array.isArray(branchesResponse.results)) {
            branchesArray = branchesResponse.results;
          }
          
          if (branchesArray.length === 0) {
            throw new Error('No branches found for business');
          }
          
          const mainBranch = branchesArray.find((b: any) => {
            const branchName = String(b?.name || '').trim().toLowerCase();
            return branchName === 'main branch' || branchName.endsWith(' main branch');
          }) || branchesArray[0];
          
          if (!mainBranch?.id) {
            throw new Error('Main branch ID not found');
          }
          
          localStorage.setItem('handypos-business-id', businessId);
          localStorage.setItem('handypos-active-branch', mainBranch.id.toString());
          localStorage.setItem('handypos-branches', JSON.stringify(branchesArray));

          await fetchTrialPreview(businessId);

          setCurrent(current + 1);
        } catch (error: any) {
          toast({
            variant: "destructive",
            title: "Error",
            description: error.message || "Failed to create business.",
          });
        } finally {
          setIsSubmitting(false);
        }
      } else {
        setCurrent(current + 1);
      }
    }
  };
  
  const goBack = () => setCurrent(current - 1);

  const onSelectPlan = async (plan: Plan) => {
    setIsSubmitting(true);
    try {
      const data = form.getValues();
      const selectedCurrency = normalizeCurrency(data.currency);

      if (!business?.id) {
        throw new Error('No business selected');
      }
      const businessId = normalizeBusinessId(business.id);

      const updatePayload: any = {
        name: data.businessName,
        business_type: data.businessType,
        email: data.email,
        phone: data.phone,
        address: data.address,
        website: data.website,
      };
      
      if (data.referralCode) {
        updatePayload.referral_code = data.referralCode;
      }

      const updatedBusiness = await authFetch.fetch<any>(
        `/business/businesses/${businessId}/`,
        {
          method: 'PUT',
          body: JSON.stringify(updatePayload),
        }
      );

      if (data.referralCode && updatedBusiness.referral_status && !updatedBusiness.referral_status.valid) {
        setPendingPlan(plan);
        setShowInvalidReferralDialog(true);
        setIsSubmitting(false);
        return;
      }

      if (data.referralCode && referralName) {
        try {
          await authFetch.fetch<any>(
            `/affiliate/affiliates/associate-business/`,
            {
              method: 'POST',
              body: JSON.stringify({
                referral_code: data.referralCode,
                business_id: businessId,
              }),
            }
          );
        } catch (error) {
          console.error('Failed to associate business with affiliate:', error);
        }
      }

      if (data.referralCode && updatedBusiness.referral_status && updatedBusiness.referral_status.valid) {
        toast({
          title: 'Referral Applied',
          description: updatedBusiness.referral_status.message,
        });
      }

      const settingsResponse = await authFetch.fetch<any>(
        `/business/businesses/${businessId}/business_settings/`,
        {
          method: 'PUT',
          body: JSON.stringify({
            currency: selectedCurrency,
          }),
        }
      );
      const resolvedCurrency = normalizeCurrency(settingsResponse?.currency || selectedCurrency);

      let subscriptionResponse: BackendSubscriptionResponse;
      try {
        subscriptionResponse = await authFetch.fetch<any>(
          `/subscription/subscriptions/`,
          {
            method: 'POST',
            body: JSON.stringify({
              business: businessId,
              plan: plan.id,
              status: 'trial',
              trial_days: plan.trialDays || 14,
              max_branches: plan.id === 'starter' ? 1 : plan.id === 'pro' ? 5 : 999,
              max_staff: plan.id === 'starter' ? 1 : plan.id === 'pro' ? 10 : 999,
              enable_pos: true,
              enable_inventory: true,
              enable_invoicing: plan.id !== 'starter',
              enable_online_menu: plan.id !== 'starter',
              enable_online_ordering: plan.id !== 'starter',
              enable_delivery: isDeliveryEnabledForPlan(plan.id),
              enable_kitchen: plan.id !== 'starter',
              enable_expense_management: plan.id !== 'starter',
              enable_supplier_management: plan.id !== 'starter',
              enable_purchases: plan.id !== 'starter',
              enable_low_stock_alerts: plan.id !== 'starter',
              enable_expiry_alerts: plan.id !== 'starter',
              enable_customer_management: plan.id !== 'starter',
              enable_reports: true,
              enable_analytics: plan.id !== 'starter',
            }),
          }
        );
      } catch (error: any) {
        if (error?.message?.includes('already exists')) {
          subscriptionResponse = await fetchCurrentSubscription(businessId);
        } else {
          throw error;
        }
      }

      const currentSubscription = await fetchCurrentSubscription(businessId).catch(() => subscriptionResponse);
      const subscriptionToPersist = currentSubscription || subscriptionResponse;

      await db.transaction('rw', db.subscriptions, async () => {
        const subscription: Subscription = mapSubscriptionForCache(subscriptionToPersist, businessId, plan.id);
        await db.subscriptions.put(subscription);
      });

      localStorage.setItem('handypos-business-id', businessId);
      await persistBusinessProfile(businessId, data, resolvedCurrency);

      toast({
        title: 'Setup Complete',
        description: `Welcome to the ${plan.name} plan! Your business has been configured successfully.`,
      });
      
      setCurrent(3);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "An error occurred during setup.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  const ProgressDots = () => {
    // Completion uses current=3 while the visible wizard has 3 stages.
    const visibleStep = Math.min(current, 2);

    return (
      <div className="flex justify-center gap-0 my-4">
        {[...Array(3)].map((_, i) => (
          <button
            key={i}
            onClick={() => { if (i < visibleStep) setCurrent(i); }}
            className={cn(
              "h-2 w-2 rounded-full transition-all -mx-2",
              i === visibleStep ? "w-6 bg-primary" : "bg-muted-foreground/50",
              i > visibleStep && "cursor-not-allowed",
            )}
            aria-label={`Go to step ${i + 1}`}
            disabled={i > visibleStep}
          />
        ))}
      </div>
    );
  };

  const previewCurrencyCode = normalizeCurrency(
    String(trialPreview?.currency_code || form.watch('currency') || 'USD')
  );
  const previewCredits = toNumber(trialPreview?.free_trial_credits_amount, 0);
  const previewDays = toNumber(trialPreview?.free_trial_days, 30);
  const previewDailyCharge = toNumber(trialPreview?.total_daily_charge, 0);

  return (
    <FormProvider {...form}>
      <div className="w-full max-w-xl mx-auto">
        <Card className="border-0 shadow-none sm:border sm:shadow-lg">
          {/* Step 1: Business Info */}
          {current === 0 && (
            <>
              <CardHeader className="text-center py-4">
                <div className="mx-auto mb-2 h-12 w-12"><HandyPosLogo /></div>
                <h1 className="font-headline text-2xl font-bold text-primary">Welcome to Mwaka POS</h1>
                <p className="text-sm text-muted-foreground">Let's get Mwaka POS set up in a few simple steps.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="businessName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Business Name</FormLabel>
                      <FormControl><Input placeholder="e.g., The Corner Cafe" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="businessType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>What type of business do you run?</FormLabel>
                      <RadioGroup onValueChange={field.onChange} value={field.value} className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2">
                        {businessTypes.map(({ id, label, icon: Icon }) => (
                          <FormItem key={id}>
                            <RadioGroupItem value={id} id={id} className="sr-only" />
                            <Label htmlFor={id} className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border-2 p-4 cursor-pointer transition-all", field.value === id ? "border-primary bg-primary/10 shadow-lg ring-2 ring-primary/50" : "border-muted bg-popover hover:bg-accent hover:text-accent-foreground")}>
                              <Icon className={cn("h-8 w-8 text-primary transition-transform", field.value === id && "scale-110")} />
                              <span className="font-semibold">{label}</span>
                            </Label>
                          </FormItem>
                        ))}
                      </RadioGroup>
                      <FormMessage className="text-center pt-2" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Country</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select your country" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="Malawi">🇲🇼 Malawi</SelectItem>
                          <SelectItem value="United States">🇺🇸 United States</SelectItem>
                          <SelectItem value="United Kingdom">🇬🇧 United Kingdom</SelectItem>
                          <SelectItem value="Canada">🇨🇦 Canada</SelectItem>
                          <SelectItem value="Australia">🇦🇺 Australia</SelectItem>
                          <SelectItem value="Other">Other (Please specify)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="contact@mybusiness.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="+1 (555) 123-4567" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Business Address</FormLabel>
                      <FormControl>
                        <Textarea placeholder="123 Business Rd, Suite 100, Commerce City, 12345" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="website"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Website</FormLabel>
                        <FormControl>
                          <Input type="url" placeholder="https://www.mybusiness.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="currency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Currency</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a currency" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {currencies.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="referralCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Referral Code (Optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter referral code if you have one" {...field} />
                      </FormControl>
                      <FormDescription>
                        If you were referred by an affiliate, enter their referral code here.
                      </FormDescription>
                      {referralLoading && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Validating referral code...</span>
                        </div>
                      )}
                      {referralName && !referralLoading && (
                        <div className="text-sm text-green-600 mt-2">
                          ✓ Referred by: <span className="font-semibold">{referralName}</span>
                        </div>
                      )}
                      {referralError && !referralLoading && (
                        <div className="text-sm text-destructive mt-2">
                          ✗ {referralError}
                        </div>
                      )}
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </>
          )}

          {/* Step 2: Free Trial */}
          {current === 1 && (
            <>
              <CardHeader className="py-4">
                <CardTitle className="font-headline text-2xl">Your Free Trial</CardTitle>
                <CardDescription>See your free credits and choose features to enable.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <Card className="bg-card border-border">
                  <CardHeader className="text-center pb-3">
                    <CheckCircle className="h-10 w-10 text-primary mx-auto mb-2" />
                    <CardTitle className="text-lg text-foreground">Free Trial Activated</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-center">
                    <div className="bg-background border border-border rounded-lg p-3">
                      <p className="text-xs text-muted-foreground mb-1">Your Free Credits</p>
                      {trialPreviewLoading ? (
                        <div className="flex items-center justify-center py-2">
                          <Loader2 className="h-5 w-5 animate-spin text-primary" />
                        </div>
                      ) : (
                        <p className="text-3xl font-bold text-primary">
                          {formatMoney(previewCredits, previewCurrencyCode)}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">{previewDays}-day trial period</p>
                    </div>
                    <div className="bg-muted/40 border border-border rounded-lg p-3">
                      <p className="text-xs text-foreground">
                        <strong>Covers:</strong> Base subscription + all enabled features for {previewDays} days
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Daily charge during trial: {formatMoney(previewDailyCharge, previewCurrencyCode)}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                <div className="space-y-3">
                  <div>
                    <h3 className="font-semibold text-sm mb-3">Premium Features (Optional)</h3>
                    <p className="text-xs text-muted-foreground mb-3">
                      Select features to add to your trial. Your free credits cover all of them!
                    </p>
                  </div>
                  
                  {featuresLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      <span className="ml-2 text-sm text-muted-foreground">Loading features...</span>
                    </div>
                  ) : features.length > 0 ? (
                    <div className="space-y-2">
                      {features.map((feature) => (
                        <label key={feature.feature} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors">
                          <input type="checkbox" defaultChecked={true} className="w-4 h-4 mt-1 rounded" />
                          <div className="flex-1">
                            <p className="font-medium text-sm">{feature.feature_display}</p>
                            <p className="text-xs text-muted-foreground">{feature.description || 'Feature'}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-sm text-muted-foreground">No features available at this time</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </>
          )}

          {/* Step 4: Completion */}
          {current === 3 && (
            <>
              <CardHeader className="text-center py-4">
                <div className="mx-auto mb-2">
                  <CheckCircle className="h-12 w-12 text-green-500" />
                </div>
                <CardTitle className="font-headline text-2xl">Setup Complete!</CardTitle>
                <CardDescription>
                  Your business is all set up. You can now proceed to your dashboard.
                </CardDescription>
              </CardHeader>
            </>
          )}
        </Card>

        <div className="px-6 py-4 border-t">
          <ProgressDots />
          <div className="flex justify-between gap-4 mt-4">
            {current > 0 && current < 3 && (
              <Button variant="outline" onClick={goBack}><ChevronLeft /> Back</Button>
            )}
            <div className="flex-grow" />
            {current === 0 && (
              <Button onClick={() => goNext(['businessName', 'businessType', 'country'])}>Start Free Trial <ChevronRight /></Button>
            )}
            {current === 1 && (
              <Button onClick={() => onSelectPlan(plans.starter)} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Activate Trial <ChevronRight />
              </Button>
            )}
            {current >= 2 && (
              <Button 
                onClick={() => setIsDashboardLoading(true)}
                disabled={isDashboardLoading}
                className="w-full"
                asChild
              >
                <Link href="/dashboard">
                  {isDashboardLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Go to Dashboard <ChevronRight />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={showInvalidReferralDialog} onOpenChange={setShowInvalidReferralDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Invalid Referral Code</AlertDialogTitle>
            <AlertDialogDescription>
              The referral code you entered is invalid or does not exist. Would you like to continue without a referral code, or go back and try a different code?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setShowInvalidReferralDialog(false);
              setPendingPlan(null);
            }}>
              Go Back
            </AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              if (pendingPlan) {
                setShowInvalidReferralDialog(false);
                setIsSubmitting(true);
                try {
                  const data = form.getValues();
                  const selectedCurrency = normalizeCurrency(data.currency);

                  if (!business?.id) {
                    throw new Error('No business selected');
                  }
                  const businessId = normalizeBusinessId(business.id);

                  const settingsResponse = await authFetch.fetch<any>(
                    `/business/businesses/${businessId}/business_settings/`,
                    {
                      method: 'PUT',
                      body: JSON.stringify({
                        currency: selectedCurrency,
                      }),
                    }
                  );
                  const resolvedCurrency = normalizeCurrency(settingsResponse?.currency || selectedCurrency);

                  let subscriptionResponse: BackendSubscriptionResponse;
                  try {
                    subscriptionResponse = await authFetch.fetch<any>(
                      `/subscription/subscriptions/`,
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          business: businessId,
                          plan: pendingPlan.id,
                          status: 'trial',
                          trial_days: pendingPlan.trialDays || 14,
                          max_branches: pendingPlan.id === 'starter' ? 1 : pendingPlan.id === 'pro' ? 5 : 999,
                          max_staff: pendingPlan.id === 'starter' ? 1 : pendingPlan.id === 'pro' ? 10 : 999,
                          enable_pos: true,
                          enable_inventory: true,
                          enable_invoicing: pendingPlan.id !== 'starter',
                          enable_online_menu: pendingPlan.id !== 'starter',
                          enable_online_ordering: pendingPlan.id !== 'starter',
                          enable_delivery: isDeliveryEnabledForPlan(pendingPlan.id),
                          enable_kitchen: pendingPlan.id !== 'starter',
                          enable_expense_management: pendingPlan.id !== 'starter',
                          enable_supplier_management: pendingPlan.id !== 'starter',
                          enable_purchases: pendingPlan.id !== 'starter',
                          enable_low_stock_alerts: pendingPlan.id !== 'starter',
                          enable_expiry_alerts: pendingPlan.id !== 'starter',
                          enable_customer_management: pendingPlan.id !== 'starter',
                          enable_reports: true,
                          enable_analytics: pendingPlan.id !== 'starter',
                        }),
                      }
                    );
                  } catch (error: any) {
                    if (error?.message?.includes('already exists')) {
                      subscriptionResponse = await fetchCurrentSubscription(businessId);
                    } else {
                      throw error;
                    }
                  }

                  const currentSubscription = await fetchCurrentSubscription(businessId).catch(() => subscriptionResponse);
                  const subscriptionToPersist = currentSubscription || subscriptionResponse;

                  await db.transaction('rw', db.subscriptions, async () => {
                    const subscription: Subscription = mapSubscriptionForCache(subscriptionToPersist, businessId, pendingPlan.id);
                    await db.subscriptions.put(subscription);
                  });

                  localStorage.setItem('handypos-business-id', businessId);
                  await persistBusinessProfile(businessId, data, resolvedCurrency);

                  toast({
                    title: 'Setup Complete',
                    description: `Welcome to the ${pendingPlan.name} plan! Your business has been configured successfully.`,
                  });
                  
                  setCurrent(3);
                } catch (error: any) {
                  toast({
                    variant: "destructive",
                    title: "Error",
                    description: error.message || "An error occurred during setup.",
                  });
                } finally {
                  setIsSubmitting(false);
                  setPendingPlan(null);
                }
              }
            }}>
              Continue Anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FormProvider>
  );
}
