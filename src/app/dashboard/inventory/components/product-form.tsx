
'use client';

import React, { useEffect, useState } from 'react';
import { useForm, FormProvider, useFieldArray, useWatch } from 'react-hook-form';
import { format } from 'date-fns';
import { Utensils, Beef, BookOpen, Plus, X, Barcode as BarcodeIcon } from 'lucide-react';

import { db, type InventoryItem, type Supplier, type RecipeIngredient } from '@/lib/db';
import { type BusinessType, unitTypesByBusinessType, menuCategories, ingredientCategories, sellableCategories, producedCategories, purchasedCategories } from '@/lib/inventory/config';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { createProduct, updateProduct } from '@/lib/services/product-service';

import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

const REORDER_LEVEL_PRESETS = [5, 10, 20, 50] as const;
const DEFAULT_REORDER_LEVEL = REORDER_LEVEL_PRESETS[0];
const BUSINESS_SETTINGS_STORAGE_KEY = 'handypos-business-settings';

const normalizeReorderLevelForForm = (value?: number | null): number => {
    const parsed = Number(value);
    if (REORDER_LEVEL_PRESETS.includes(parsed as (typeof REORDER_LEVEL_PRESETS)[number])) {
        return parsed;
    }
    return DEFAULT_REORDER_LEVEL;
};

const normalizeProductTypeList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const entry of value) {
        const typeValue = String(entry ?? '').trim();
        if (!typeValue) continue;
        const key = typeValue.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push(typeValue);
    }
    return normalized;
};

export const AddProductForm = ({
    businessType,
    suppliers,
    ingredients,
    onFormSubmit,
    defaultValues,
    branchId,
}: {
    businessType: BusinessType;
    suppliers: Supplier[];
    ingredients: InventoryItem[];
    onFormSubmit: () => void;
    defaultValues?: Partial<InventoryItem>;
    branchId: string;
}) => {
    const { user } = useAuth();
    const isRestaurantOrBar = businessType === 'Restaurant' || businessType === 'Bar & Liquor';
    const [productTypeOptions, setProductTypeOptions] = useState<string[]>([]);
    
    const unitTypes = unitTypesByBusinessType[businessType] || [];
    const unitOptionsListId = `unit-options-${businessType.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const raw = localStorage.getItem(BUSINESS_SETTINGS_STORAGE_KEY);
            if (!raw) {
                setProductTypeOptions([]);
                return;
            }
            const parsed = JSON.parse(raw);
            const normalized = normalizeProductTypeList(
                parsed?.productTypes ?? parsed?.product_types
            );
            setProductTypeOptions(normalized);
        } catch (error) {
            console.warn('[ProductForm] Failed to parse business settings:', error);
            setProductTypeOptions([]);
        }
    }, [businessType]);
    
    // Determine which categories to use based on item type and produced status
    const getCategories = (type: string, produced?: boolean) => {
        if (!isRestaurantOrBar && type === 'sellable' && productTypeOptions.length > 0) {
            return productTypeOptions;
        }
        if (!isRestaurantOrBar && type === 'sellable') {
            return [];
        }
        if (type === 'ingredient') {
            return ingredientCategories[businessType] || [];
        }

        if (type === 'sellable') {
            if (isRestaurantOrBar) {
                if (produced === true) {
                    return producedCategories[businessType] || sellableCategories[businessType] || [];
                }
                if (produced === false) {
                    return purchasedCategories[businessType] || sellableCategories[businessType] || [];
                }
            }
            return sellableCategories[businessType] || menuCategories[businessType] || [];
        }

        return menuCategories[businessType] || [];
    };

    const form = useForm<InventoryItem>({
      defaultValues: {
          branchId,
          name: '',
          category: '',
          itemType: 'sellable',
          stockUnits: 0,
          price: 0,
          cost: 0,
          recipe: [],
          reorderLevel: DEFAULT_REORDER_LEVEL,
          isVariablePrice: false,
          isFuel: false,
      }
    });

    const { handleSubmit, control, watch, reset, setValue } = form;

    const { fields, append, remove } = useFieldArray({
        control,
        name: "recipe",
    });

    const itemType = useWatch({ control, name: 'itemType' });
    const isVariablePrice = useWatch({ control, name: 'isVariablePrice' });
    const isProduced = useWatch({ control, name: 'isProduced' });
    const isSoldInPortions = useWatch({ control, name: 'isSoldInPortions' });
    const portionName = useWatch({ control, name: 'portionName' });
    const unitType = useWatch({ control, name: 'unitType' });
    const hasSelectedUnit = Boolean((unitType || '').trim());

    // Log suppliers for debugging
    React.useEffect(() => {
        console.log('[ProductForm] Suppliers received:', suppliers.length);
        console.log('[ProductForm] Suppliers data:', suppliers.map(s => ({ id: s.id, name: s.name })));
    }, [suppliers]);

    // Global barcode scanner listener - prevent form submission on Enter when scanning
    React.useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            // Check if this is an Enter key press
            if (e.key !== 'Enter') {
                return;
            }

            // Get the currently focused element
            const activeElement = document.activeElement as HTMLInputElement;
            
            // If no element is focused, do nothing
            if (!activeElement) {
                return;
            }

            // Check if the focused element is a form input (but not the barcode field)
            const isFormInput = activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT';
            const isBarcodeField = activeElement.name === 'barcode';
            
            // If it's a form input but NOT the barcode field, and Enter is pressed,
            // this might be a barcode scan (barcode scanners typically end with Enter)
            // So we should prevent the default form submission
            if (isFormInput && !isBarcodeField) {
                // Check if the input value looks like it could be a barcode
                // (typically barcodes are numeric or alphanumeric strings)
                const inputValue = activeElement.value;
                
                // If the field just received input (barcode scan), prevent form submission
                // by checking if this is likely a barcode scan (rapid input followed by Enter)
                if (inputValue && inputValue.length > 0) {
                    // Prevent the Enter key from submitting the form
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        };

        window.addEventListener('keydown', handleGlobalKeyDown, true);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown, true);
    }, []);

    // When defaultValues change (i.e., when opening the dialog to edit),
    // reset the form with the new default values.
    // This must happen AFTER the form is initialized
    useEffect(() => {
        console.log('[ProductForm] useEffect triggered with defaultValues:', defaultValues?.id, 'isRestaurantOrBar:', isRestaurantOrBar);
        
        if (defaultValues && defaultValues.id) {
            console.log('[ProductForm] Resetting form with defaultValues:', defaultValues);
            const resetData = {
                ...defaultValues,
                itemType: defaultValues.itemType ?? (isRestaurantOrBar ? 'ingredient' : 'sellable'),
                // Ensure all fields are present
                stockUnits: defaultValues.stockUnits ?? 0,
                price: defaultValues.price ?? 0,
                cost: defaultValues.cost ?? 0,
                reorderLevel: normalizeReorderLevelForForm(defaultValues.reorderLevel),
                isVariablePrice: defaultValues.isVariablePrice ?? false,
                isFuel: defaultValues.isFuel ?? false,
                isProduced: defaultValues.isProduced ?? false,
                isSoldInPortions: defaultValues.isSoldInPortions ?? false,
                recipe: defaultValues.recipe ?? [],
            };
            console.log('[ProductForm] Reset data:', resetData);
            reset(resetData);
        } else {
            console.log('[ProductForm] Resetting form to empty state');
            reset({
                branchId,
                name: '',
                category: '',
                itemType: 'sellable',
                stockUnits: 0,
                price: 0,
                cost: 0,
                recipe: [],
                reorderLevel: DEFAULT_REORDER_LEVEL,
                isVariablePrice: false,
                isFuel: false,
                isProduced: false,
                isSoldInPortions: false,
            });
        }
    }, [defaultValues?.id, isRestaurantOrBar, branchId, reset]);
    
    const onSubmit = async (data: Partial<InventoryItem>) => {
        if (!user) {
            toast({ variant: 'destructive', title: 'Not authenticated.'});
            return;
        }
        
        try {
            console.log('[ProductForm] Form data received:', data);
            console.log('[ProductForm] stockUnits value:', data.stockUnits, 'type:', typeof data.stockUnits);
            console.log('[ProductForm] cost value:', data.cost, 'type:', typeof data.cost);
            console.log('[ProductForm] price value:', data.price, 'type:', typeof data.price);
            console.log('[ProductForm] itemType from form:', data.itemType, 'isRestaurantOrBar:', isRestaurantOrBar);
            
            // Determine final item type - ensure it's always set correctly
            let finalItemType: InventoryItem['itemType'] = data.itemType === 'ingredient' ? 'ingredient' : 'sellable';
            if (!isRestaurantOrBar) {
                // For non-restaurant businesses, always force sellable
                finalItemType = 'sellable';
            }
            
            console.log('[ProductForm] Final itemType:', finalItemType);
            
            const isEditing = !!defaultValues?.id;
            const supportsProducedItems = isRestaurantOrBar && finalItemType === 'sellable';
            const normalizedIsProduced = supportsProducedItems ? Boolean(data.isProduced) : false;
            const supportsPortions =
                businessType === 'Bar & Liquor' &&
                finalItemType === 'sellable' &&
                !normalizedIsProduced;
            const normalizedIsSoldInPortions = supportsPortions ? Boolean(data.isSoldInPortions) : false;
            const normalizedPortionName = normalizedIsSoldInPortions
                ? String(data.portionName || '').trim()
                : '';
            const normalizedPortionsPerUnit = normalizedIsSoldInPortions
                ? (Number(data.portionsPerUnit) > 0 ? Number(data.portionsPerUnit) : undefined)
                : undefined;
            const normalizedRecipe = supportsProducedItems && normalizedIsProduced
                ? data.recipe
                    ?.map((recipeItem) => ({
                        ...recipeItem,
                        quantity: Number(recipeItem.quantity),
                    }))
                    .filter((recipeItem) => recipeItem.ingredientId && Number(recipeItem.quantity) > 0)
                : [];

            // Parse numeric values properly - handle both string and number inputs
            // On edit, preserve existing stock; on create, always use 0
            const stockUnitsValue = isEditing && defaultValues?.stockUnits !== undefined 
                ? Number(defaultValues.stockUnits) 
                : 0;
            const costValue = data.cost !== undefined && data.cost !== null ? Number(data.cost) : 0;
            const priceValue = data.price !== undefined && data.price !== null ? Number(data.price) : 0;
            const reorderLevelValue = normalizeReorderLevelForForm(data.reorderLevel);
            const fallbackCategories = getCategories(
                finalItemType || 'sellable',
                finalItemType === 'sellable' ? normalizedIsProduced : undefined
            );
            const resolvedCategory = (data.category || '').trim() || fallbackCategories[0] || 'General';

            console.log('[ProductForm] Parsed values - stockUnits:', stockUnitsValue, 'cost:', costValue, 'price:', priceValue);

            // Build complete item data with all fields
            // For updates, we need to include ALL fields, not just changed ones
            // This ensures the backend receives complete data for proper sync
            const itemData: Omit<InventoryItem, 'id'> = {
                branchId: branchId,
                name: data.name!,
                itemType: finalItemType!,
                category: resolvedCategory,
                status: stockUnitsValue > reorderLevelValue ? 'In Stock' : (stockUnitsValue > 0 ? 'Low Stock' : 'Out of Stock'),
                supplier: data.supplier || 'N/A',
                manufacturer: data.manufacturer || '',
                batch: data.batch || '',
                unitType: data.unitType || 'unit',
                reorderLevel: reorderLevelValue,
                expiry: data.expiry ? format(new Date(data.expiry), 'yyyy-MM-dd') : undefined,
                stockUnits: stockUnitsValue,
                cost: costValue > 0 ? costValue : undefined,
                value: stockUnitsValue * costValue,
                price: finalItemType === 'sellable' ? (priceValue > 0 ? priceValue : undefined) : undefined,
                recipe: normalizedRecipe,
                isVariablePrice: data.isVariablePrice || false,
                isFuel: data.isFuel || false,
                isProduced: normalizedIsProduced,
                isSoldInPortions: normalizedIsSoldInPortions,
                portionName: normalizedPortionName || undefined,
                portionsPerUnit: normalizedPortionsPerUnit,
                // Include product identifiers
                productCode: data.productCode || undefined,
                barcode: data.barcode || undefined,
                sku: data.sku || undefined,
                // Include all other fields from defaultValues for updates to preserve data
                ...(isEditing && defaultValues ? {
                    brand: defaultValues.brand,
                    packSize: defaultValues.packSize,
                    isRecipeIngredient: defaultValues.isRecipeIngredient,
                    onMenu: defaultValues.onMenu,
                    image: defaultValues.image,
                } : {})
            };
            
            console.log('[ProductForm] itemData being sent:', itemData);

            if (isEditing && defaultValues?.id) {
                // Update existing product (offline-first)
                // Pass the complete merged data to ensure all fields are synced
                await updateProduct(
                    defaultValues.id,
                    itemData,
                    user.uid,
                    user.displayName || user.email || 'Unknown',
                    branchId
                );
                toast({
                    title: 'Item Updated',
                    description: `"${itemData.name}" has been saved locally. It will sync when online.`,
                });
            } else {
                // Create new product (offline-first)
                await createProduct(
                    itemData,
                    user.uid,
                    user.displayName || user.email || 'Unknown'
                );
                toast({
                    title: 'Item Added',
                    description: `"${itemData.name}" has been saved locally. It will sync when online.`,
                });
            }

            reset();
            onFormSubmit();
        } catch (error) {
            console.error('Failed to save product:', error);
            toast({
                variant: 'destructive',
                title: 'Error',
                description: 'Failed to save product. Please try again.',
            });
        }
    };

    return (
        <FormProvider {...form}>
            <form onSubmit={handleSubmit(onSubmit)} className="grid gap-6">
                {isRestaurantOrBar && (
                    <>
                        <FormField
                            control={control}
                            name="itemType"
                            render={({ field }) => (
                                <FormItem className="space-y-3">
                                    <FormLabel>What are you adding?</FormLabel>
                                    <FormControl>
                                        <RadioGroup
                                            onValueChange={field.onChange}
                                            value={field.value}
                                            className="grid grid-cols-2 gap-4"
                                        >
                                            <FormItem>
                                                <RadioGroupItem value="ingredient" id="ingredient" className="sr-only" />
                                                <Label 
                                                    htmlFor="ingredient" 
                                                    className={`flex flex-col items-center justify-center rounded-md border-2 bg-popover p-4 hover:bg-accent hover:text-accent-foreground cursor-pointer transition-all ${
                                                        itemType === 'ingredient' 
                                                            ? 'border-primary outline outline-2 outline-primary outline-offset-2' 
                                                            : 'border-muted'
                                                    }`}
                                                >
                                                    <Beef className="mb-3 h-6 w-6" />
                                                    Ingredient
                                                </Label>
                                            </FormItem>
                                            <FormItem>
                                                <RadioGroupItem value="sellable" id="sellable" className="sr-only" />
                                                <Label 
                                                    htmlFor="sellable" 
                                                    className={`flex flex-col items-center justify-center rounded-md border-2 bg-popover p-4 hover:bg-accent hover:text-accent-foreground cursor-pointer transition-all ${
                                                        itemType === 'sellable' 
                                                            ? 'border-primary outline outline-2 outline-primary outline-offset-2' 
                                                            : 'border-muted'
                                                    }`}
                                                >
                                                    <Utensils className="mb-3 h-6 w-6" />
                                                    Sellable Product
                                                </Label>
                                            </FormItem>
                                        </RadioGroup>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <Separator />
                    </>
                )}

                {isRestaurantOrBar && itemType === 'sellable' && (
                    <>
                    <FormField
                        control={form.control}
                        name="isProduced"
                        render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                            <FormLabel>This is a Produced Item</FormLabel>
                            <FormDescription>
                                Enable if this product is made in-house using a recipe. Disable if it's a purchased product.
                            </FormDescription>
                            </div>
                            <FormControl>
                            <Switch
                                checked={field.value}
                                onCheckedChange={(checked) => {
                                    field.onChange(checked);
                                    // Reset category when toggling isProduced to show appropriate categories
                                    setValue('category', '');
                                }}
                            />
                            </FormControl>
                        </FormItem>
                        )}
                    />
                    </>
                )}
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     <FormField
                        control={control}
                        name="name"
                        rules={{ required: "Item name is required" }}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Item Name</FormLabel>
                                <FormControl>
                                    <Input placeholder={itemType === 'ingredient' ? "e.g., Roma Tomatoes" : "e.g., Margherita Pizza"} {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={control}
                        name="productCode"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Product Code</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g., PROD-001" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid grid-cols-1 gap-4">
                    <FormField
                        control={control}
                        name="barcode"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Barcode</FormLabel>
                                <FormControl>
                                    <Input 
                                        placeholder="e.g., 5901234123457 (scan or type)" 
                                        {...field}
                                        onKeyDown={(e) => {
                                            // Prevent form submission when Enter is pressed on barcode field
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                            }
                                        }}
                                    />
                                </FormControl>
                                <FormDescription>
                                    Scan or type the product barcode for quick lookup at POS. Leave blank if unavailable.
                                </FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                {(businessType === 'Grocery' || businessType === 'Supermarket') && itemType === 'sellable' && (
                     <FormField
                        control={form.control}
                        name="isVariablePrice"
                        render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                            <FormLabel>Variable Price</FormLabel>
                            <FormDescription>
                                Enable if product is sold by weight/volume (e.g. kg, L).
                            </FormDescription>
                            </div>
                            <FormControl>
                            <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                            />
                            </FormControl>
                        </FormItem>
                        )}
                    />
                )}

                {!isRestaurantOrBar && itemType === 'sellable' && (
                     <FormField
                        control={form.control}
                        name="isFuel"
                        render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                            <FormLabel>Fuel Item</FormLabel>
                            <FormDescription>
                                Enable for fuel products so only fuel attendants can sell them.
                            </FormDescription>
                            </div>
                            <FormControl>
                            <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                            />
                            </FormControl>
                        </FormItem>
                        )}
                    />
                )}

                {(itemType === 'ingredient' || !isRestaurantOrBar) && (
                     <div className="space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                             <FormField
                                control={control}
                                name="unitType"
                                rules={{ required: 'Unit is required before pricing.' }}
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Unit</FormLabel>
                                        <FormControl>
                                            <Input
                                                list={unitOptionsListId}
                                                placeholder="Type or select a unit"
                                                value={field.value || ''}
                                                onChange={(event) => field.onChange(event.target.value)}
                                            />
                                        </FormControl>
                                        <datalist id={unitOptionsListId}>
                                            {unitTypes.map((unit) => (
                                                <option key={unit} value={unit} />
                                            ))}
                                        </datalist>
                                        <FormDescription>
                                            Type to search units, then enter prices.
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                             <FormField
                                control={control}
                                name="reorderLevel"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Reorder Level</FormLabel>
                                        <Select
                                            onValueChange={(selectedValue) => field.onChange(Number(selectedValue))}
                                            value={String(normalizeReorderLevelForForm(field.value))}
                                        >
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select reorder level" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {REORDER_LEVEL_PRESETS.map((level) => (
                                                    <SelectItem key={level} value={String(level)}>
                                                        {level}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormDescription>
                                            Stock warning appears when quantity reaches this level.
                                        </FormDescription>
                                    </FormItem>
                                )}
                            />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                             <FormField
                                control={control}
                                name="cost"
                                render={({ field: { value, onChange, ...field } }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {isVariablePrice ? `Cost Price per ${unitType || 'Unit'}` : `Cost Price${unitType ? ` (per ${unitType})` : ''}`}
                                        </FormLabel>
                                        <FormControl>
                                            <Input 
                                                type="number" 
                                                step="0.01" 
                                                placeholder="0.00" 
                                                disabled={!hasSelectedUnit}
                                                value={value || ''} 
                                                onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : 0)}
                                                {...field} 
                                            />
                                        </FormControl>
                                        {!hasSelectedUnit && (
                                            <FormDescription>Select a unit first to add cost price.</FormDescription>
                                        )}
                                    </FormItem>
                                )}
                            />
                            {!isRestaurantOrBar && itemType === 'sellable' && (
                                <FormField
                                    control={control}
                                    name="price"
                                    rules={{ required: "Price is required", min: { value: 0, message: "Price must be positive" } }}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {isVariablePrice ? `Selling Price per ${unitType || 'Unit'}` : `Selling Price${unitType ? ` (per ${unitType})` : ''}`}
                                            </FormLabel>
                                            <FormControl>
                                                <Input type="number" step="0.01" placeholder="0.00" disabled={!hasSelectedUnit} {...field} />
                                            </FormControl>
                                            {!hasSelectedUnit && (
                                                <FormDescription>Select a unit first to add selling price.</FormDescription>
                                            )}
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}
                        </div>
                        <FormField
                            control={control}
                            name="supplier"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Supplier</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select a supplier" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            {suppliers.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </FormItem>
                            )}
                        />
                    </div>
                )}
                
                {itemType === 'sellable' && isRestaurantOrBar && (
                    <div className="space-y-4">
                        <FormField
                            control={control}
                            name="unitType"
                            rules={{ required: 'Unit is required before pricing.' }}
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Unit</FormLabel>
                                    <FormControl>
                                        <Input
                                            list={unitOptionsListId}
                                            placeholder="Type or select a unit"
                                            value={field.value || ''}
                                            onChange={(event) => field.onChange(event.target.value)}
                                        />
                                    </FormControl>
                                    <datalist id={unitOptionsListId}>
                                        {unitTypes.map((unit) => (
                                            <option key={unit} value={unit} />
                                        ))}
                                    </datalist>
                                    <FormDescription>
                                        Type to search units, then enter prices.
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {!isProduced ? (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <FormField
                                    control={control}
                                    name="cost"
                                    render={({ field: { value, onChange, ...field } }) => (
                                        <FormItem>
                                            <FormLabel>Cost Price</FormLabel>
                                            <FormControl>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    placeholder="0.00"
                                                    disabled={!hasSelectedUnit}
                                                    value={value || ''}
                                                    onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : 0)}
                                                    {...field}
                                                />
                                            </FormControl>
                                            {!hasSelectedUnit && (
                                                <FormDescription>Select a unit first to add cost price.</FormDescription>
                                            )}
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={control}
                                    name="price"
                                    rules={{ required: "Price is required", min: { value: 0, message: "Price must be positive" } }}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {isVariablePrice ? `Selling Price per ${unitType || 'Unit'}` : `Selling Price${unitType ? ` (per ${unitType})` : ''}`}
                                            </FormLabel>
                                            <FormControl>
                                                <Input type="number" step="0.01" placeholder="0.00" disabled={!hasSelectedUnit} {...field} />
                                            </FormControl>
                                            {!hasSelectedUnit && (
                                                <FormDescription>Select a unit first to add selling price.</FormDescription>
                                            )}
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>
                        ) : (
                            <FormField
                                control={control}
                                name="price"
                                rules={{ required: "Price is required", min: { value: 0, message: "Price must be positive" } }}
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {isVariablePrice ? `Selling Price per ${unitType || 'Unit'}` : `Selling Price${unitType ? ` (per ${unitType})` : ''}`}
                                        </FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.01" placeholder="0.00" disabled={!hasSelectedUnit} {...field} />
                                        </FormControl>
                                        {!hasSelectedUnit && (
                                            <FormDescription>Select a unit first to add selling price.</FormDescription>
                                        )}
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}

                        <Separator />

                        {isRestaurantOrBar && isProduced && (
                            <>
                            <div>
                                <h3 className="text-lg font-medium flex items-center gap-2"><BookOpen className="h-5 w-5"/> Recipe / Bill of Materials</h3>
                                <p className="text-sm text-muted-foreground mb-4">Define the ingredients that make up this product.</p>
                                <div className="space-y-4">
                                    {fields.map((field, index) => (
                                        <div key={field.id} className="grid grid-cols-[1fr_auto_auto] items-end gap-2 p-3 border rounded-lg sm:grid-cols-[1fr_auto_auto_auto]">
                                            <FormField
                                                control={control}
                                                name={`recipe.${index}.ingredientId`}
                                                rules={{ required: true }}
                                                render={({ field: selectField }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-xs">Ingredient</FormLabel>
                                                        <Select 
                                                            onValueChange={(value) => {
                                                                const selectedIngredient = ingredients.find(i => i.id === value);
                                                                if (selectedIngredient) {
                                                                    selectField.onChange(value);
                                                                    setValue(`recipe.${index}.name`, selectedIngredient.name);
                                                                    setValue(`recipe.${index}.unit`, selectedIngredient.unitType || '');
                                                                }
                                                            }} 
                                                            defaultValue={selectField.value}
                                                        >
                                                            <FormControl>
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Select ingredient" />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                {ingredients.map(ing => <SelectItem key={ing.id} value={ing.id}>{ing.name}</SelectItem>)}
                                                            </SelectContent>
                                                        </Select>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={control}
                                                name={`recipe.${index}.quantity`}
                                                rules={{ required: true, min: 0.001 }}
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel className="text-xs">Qty</FormLabel>
                                                        <FormControl>
                                                            <Input type="number" step="0.01" className="w-20 sm:w-24" {...field} />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <FormField
                                                control={control}
                                                name={`recipe.${index}.unit`}
                                                render={({ field }) => (
                                                    <FormItem className="hidden sm:block">
                                                        <FormLabel className="text-xs">Unit</FormLabel>
                                                        <FormControl>
                                                            <Input className="w-20 bg-muted" readOnly {...field} />
                                                        </FormControl>
                                                    </FormItem>
                                                )}
                                            />
                                            <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="text-destructive">
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => append({ ingredientId: '', name: '', quantity: 1, unit: '' })}
                                    >
                                    <Plus className="mr-2 h-4 w-4" /> Add Ingredient
                                    </Button>
                                </div>
                            </div>
                            </>
                        )}

                        {isRestaurantOrBar && !isProduced && (
                            <>
                            <div className="space-y-4">
                                <FormField
                                    control={control}
                                    name="supplier"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Supplier</FormLabel>
                                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select a supplier" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {suppliers.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </FormItem>
                                    )}
                                />
                                
                                {businessType === 'Bar & Liquor' && (
                                    <>
                                    <Separator />
                                    <FormField
                                        control={form.control}
                                        name="isSoldInPortions"
                                        render={({ field }) => (
                                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                            <div className="space-y-0.5">
                                            <FormLabel>Sold in Portions</FormLabel>
                                            <FormDescription>
                                                Enable if this product is sold in portions (shots, tots, glasses, etc).
                                            </FormDescription>
                                            </div>
                                            <FormControl>
                                            <Switch
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                            />
                                            </FormControl>
                                        </FormItem>
                                        )}
                                    />
                                    
                                    {isSoldInPortions && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
                                            <FormField
                                                control={control}
                                                name="portionName"
                                                rules={{ required: "Portion name is required" }}
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Portion Name</FormLabel>
                                                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                                                            <FormControl>
                                                                <SelectTrigger>
                                                                    <SelectValue placeholder="Select portion type" />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                <SelectItem value="shot">Shot</SelectItem>
                                                                <SelectItem value="tot">Tot</SelectItem>
                                                                <SelectItem value="glass">Glass</SelectItem>
                                                                <SelectItem value="pint">Pint</SelectItem>
                                                                <SelectItem value="bottle">Bottle</SelectItem>
                                                                <SelectItem value="can">Can</SelectItem>
                                                                <SelectItem value="cup">Cup</SelectItem>
                                                                <SelectItem value="measure">Measure</SelectItem>
                                                                <SelectItem value="custom">Custom</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                            
                                            {portionName === 'custom' && (
                                                <FormField
                                                    control={control}
                                                    name="portionName"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>Custom Portion Name</FormLabel>
                                                            <FormControl>
                                                                <Input placeholder="e.g., Jigger, Nip, etc" {...field} />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            )}
                                            
                                            <FormField
                                                control={control}
                                                name="portionsPerUnit"
                                                rules={{ required: "Number of portions is required", min: { value: 1, message: "Must be at least 1" } }}
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>Portions per Full Unit</FormLabel>
                                                        <FormControl>
                                                            <Input type="number" min="1" placeholder="e.g., 25 shots per bottle" {...field} />
                                                        </FormControl>
                                                        <FormDescription>
                                                            How many portions make up one full unit of this product
                                                        </FormDescription>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    )}
                                    </>
                                )}
                            </div>
                            </>
                        )}
                    </div>
                )}
                
                <DialogFooter className="sticky bottom-0 bg-background pt-4 border-t">
                    <Button type="submit">{defaultValues?.id ? 'Save Changes' : 'Add Item'}</Button>
                </DialogFooter>
            </form>
        </FormProvider>
    );
};
