'use client';

import { useEffect, useMemo, useState } from 'react';
import { Edit, Loader2, PlusCircle, Trash2 } from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { authFetch } from '@/lib/auth-fetch';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type DiscountType = 'percentage' | 'fixed';
type DiscountScope = 'all' | 'products' | 'categories';

type DiscountRule = {
  id: string;
  business?: string | number;
  branch?: string | number | null;
  name: string;
  discount_type?: DiscountType;
  discountType?: DiscountType;
  value: number | string;
  applies_to?: DiscountScope;
  appliesTo?: DiscountScope;
  product_ids?: string[];
  productIds?: string[];
  categories?: string[];
  starts_at?: string | null;
  startsAt?: string | null;
  ends_at?: string | null;
  endsAt?: string | null;
  is_active?: boolean;
  isActive?: boolean;
};

type DiscountFormState = {
  name: string;
  discountType: DiscountType;
  value: string;
  appliesTo: DiscountScope;
  productIds: string;
  categories: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
};

const emptyForm: DiscountFormState = {
  name: '',
  discountType: 'percentage',
  value: '',
  appliesTo: 'all',
  productIds: '',
  categories: '',
  startsAt: '',
  endsAt: '',
  isActive: true,
};

const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

const toInputDateTime = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16);
};

const normalizeRule = (rule: DiscountRule): DiscountRule => ({
  ...rule,
  discount_type: rule.discount_type ?? rule.discountType ?? 'percentage',
  applies_to: rule.applies_to ?? rule.appliesTo ?? 'all',
  product_ids: Array.isArray(rule.product_ids) ? rule.product_ids : Array.isArray(rule.productIds) ? rule.productIds : [],
  categories: Array.isArray(rule.categories) ? rule.categories : [],
  starts_at: rule.starts_at ?? rule.startsAt ?? null,
  ends_at: rule.ends_at ?? rule.endsAt ?? null,
  is_active: Boolean(rule.is_active ?? rule.isActive ?? true),
});

const formatRuleValue = (rule: DiscountRule): string => {
  const normalized = normalizeRule(rule);
  const value = toFiniteNumber(normalized.value, 0);
  return normalized.discount_type === 'fixed' ? `MWK ${value.toFixed(2)}` : `${value}%`;
};

export default function DiscountsPage() {
  const { business } = useAuth();
  const { toast } = useToast();
  const [rules, setRules] = useState<DiscountRule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<DiscountRule | null>(null);
  const [form, setForm] = useState<DiscountFormState>(emptyForm);

  const businessId = useMemo(() => String(business?.id ?? '').trim(), [business?.id]);

  const loadRules = async () => {
    if (!businessId) return;
    setIsLoading(true);
    try {
      const response = await authFetch.fetch<any>(`/sessions/discounts/?business_id=${encodeURIComponent(businessId)}`);
      const rows = Array.isArray(response)
        ? response
        : Array.isArray(response?.results)
          ? response.results
          : [];
      setRules(rows.map(normalizeRule));
    } catch (error) {
      console.error('[Discounts] Failed to load rules:', error);
      toast({
        title: 'Could not load discounts',
        description: 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const openCreateDialog = () => {
    setEditingRule(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };

  const openEditDialog = (rule: DiscountRule) => {
    const normalized = normalizeRule(rule);
    setEditingRule(normalized);
    setForm({
      name: normalized.name || '',
      discountType: normalized.discount_type === 'fixed' ? 'fixed' : 'percentage',
      value: String(normalized.value ?? ''),
      appliesTo: normalized.applies_to ?? 'all',
      productIds: (normalized.product_ids ?? []).join(', '),
      categories: (normalized.categories ?? []).join(', '),
      startsAt: toInputDateTime(normalized.starts_at),
      endsAt: toInputDateTime(normalized.ends_at),
      isActive: Boolean(normalized.is_active),
    });
    setDialogOpen(true);
  };

  const saveRule = async () => {
    if (!businessId) return;
    const value = toFiniteNumber(form.value, 0);
    if (!form.name.trim()) {
      toast({ title: 'Discount name is required', variant: 'destructive' });
      return;
    }
    if (value <= 0 || (form.discountType === 'percentage' && value > 99)) {
      toast({ title: 'Invalid discount value', variant: 'destructive' });
      return;
    }

    const payload = {
      business: businessId,
      name: form.name.trim(),
      discountType: form.discountType,
      value,
      appliesTo: form.appliesTo,
      productIds: form.appliesTo === 'products' ? splitList(form.productIds) : [],
      categories: form.appliesTo === 'categories' ? splitList(form.categories) : [],
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      isActive: form.isActive,
    };

    setIsSaving(true);
    try {
      if (editingRule?.id) {
        await authFetch.fetch(`/sessions/discounts/${editingRule.id}/`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await authFetch.fetch('/sessions/discounts/', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      toast({ title: editingRule ? 'Discount updated' : 'Discount created' });
      setDialogOpen(false);
      await loadRules();
    } catch (error) {
      console.error('[Discounts] Failed to save rule:', error);
      toast({
        title: 'Could not save discount',
        description: error instanceof Error ? error.message : 'Try again.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const deleteRule = async (rule: DiscountRule) => {
    if (!window.confirm(`Delete "${rule.name}"?`)) return;
    try {
      await authFetch.fetch(`/sessions/discounts/${rule.id}/`, { method: 'DELETE' });
      toast({ title: 'Discount deleted' });
      await loadRules();
    } catch (error) {
      console.error('[Discounts] Failed to delete rule:', error);
      toast({ title: 'Could not delete discount', variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div>
          <CardTitle>Discounts</CardTitle>
          <CardDescription>Create cashier-selectable discounts for POS sales.</CardDescription>
        </div>
        <Button onClick={openCreateDialog}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Discount
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-28 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                  Loading discounts...
                </TableCell>
              </TableRow>
            ) : rules.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No discounts created yet.
                </TableCell>
              </TableRow>
            ) : (
              rules.map((rule) => {
                const normalized = normalizeRule(rule);
                return (
                  <TableRow key={normalized.id}>
                    <TableCell className="font-medium">{normalized.name}</TableCell>
                    <TableCell>{formatRuleValue(normalized)}</TableCell>
                    <TableCell className="capitalize">{normalized.applies_to}</TableCell>
                    <TableCell>{normalized.is_active ? 'Active' : 'Inactive'}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="icon" onClick={() => openEditDialog(normalized)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => deleteRule(normalized)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingRule ? 'Edit Discount' : 'Add Discount'}</DialogTitle>
            <DialogDescription>These discounts appear in the POS cart for cashier selection.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="discount-name">Name</Label>
              <Input
                id="discount-name"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Weekend promo"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="discount-type">Type</Label>
                <select
                  id="discount-type"
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                  value={form.discountType}
                  onChange={(event) => setForm((current) => ({ ...current, discountType: event.target.value as DiscountType }))}
                >
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed amount</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="discount-value">Value</Label>
                <Input
                  id="discount-value"
                  inputMode="decimal"
                  value={form.value}
                  onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))}
                  placeholder={form.discountType === 'percentage' ? '10' : '500'}
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="discount-scope">Applies To</Label>
              <select
                id="discount-scope"
                className="h-10 rounded-md border bg-background px-3 text-sm"
                value={form.appliesTo}
                onChange={(event) => setForm((current) => ({ ...current, appliesTo: event.target.value as DiscountScope }))}
              >
                <option value="all">All products</option>
                <option value="products">Specific product IDs</option>
                <option value="categories">Specific categories</option>
              </select>
            </div>
            {form.appliesTo === 'products' && (
              <div className="grid gap-2">
                <Label htmlFor="discount-products">Product IDs</Label>
                <Input
                  id="discount-products"
                  value={form.productIds}
                  onChange={(event) => setForm((current) => ({ ...current, productIds: event.target.value }))}
                  placeholder="id-1, id-2"
                />
              </div>
            )}
            {form.appliesTo === 'categories' && (
              <div className="grid gap-2">
                <Label htmlFor="discount-categories">Categories</Label>
                <Input
                  id="discount-categories"
                  value={form.categories}
                  onChange={(event) => setForm((current) => ({ ...current, categories: event.target.value }))}
                  placeholder="Beverages, Grocery"
                />
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="discount-start">Start</Label>
                <Input
                  id="discount-start"
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="discount-end">End</Label>
                <Input
                  id="discount-end"
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))}
              />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={saveRule} disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
