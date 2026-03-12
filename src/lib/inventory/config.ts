export type BusinessType = 'Pharmacy' | 'Restaurant' | 'Bar & Liquor' | 'Supermarket' | 'Grocery' | 'Beauty Salon and Spa' | 'General Retail';

export const businessConfig: Record<BusinessType, { title: string; description: string; addText: string }> = {
    Pharmacy: { title: "Pharmaceutical Inventory", description: "Manage drug stocks with mandatory batch and expiry tracking.", addText: "Add Drug" },
    Restaurant: { title: "Ingredient Inventory", description: "Manage raw materials, recipes, and prep batches.", addText: "Add Ingredient" },
    "Bar & Liquor": { title: "Bar & Liquor Stock", description: "Track bottles, shots, and wastage with precision.", addText: "Add Bottle" },
    Supermarket: { title: "Supermarket Inventory", description: "Barcode-first workflows for multi-variant products.", addText: "Add Product" },
    Grocery: { title: "Grocery & Produce Stock", description: "Manage weight-based items and track expiry.", addText: "Add Item" },
    "Beauty Salon and Spa": { title: "Salon & Spa Stock", description: "Manage professional and retail beauty products.", addText: "Add Product" },
    "General Retail": { title: "General Retail Inventory", description: "Manage fast-moving stock and mixed merchandise.", addText: "Add Product"},
};

export const unitTypesByBusinessType: Record<BusinessType, string[]> = {
    Pharmacy: ['unit', 'tablet', 'capsule', 'vial', 'ampoule', 'strip', 'blister pack', 'sachet', 'tube', 'bottle', 'jar', 'pack', 'box', 'mg', 'g', 'ml', 'L'],
    Restaurant: ['unit', 'pcs', 'portion', 'dozen', 'g', 'kg', 'ml', 'L', 'bag', 'pack', 'bottle', 'can', 'tray'],
    "Bar & Liquor": ['unit', 'shot', 'glass', 'ml', 'L', 'bottle', 'can', 'pack', 'case', 'crate', 'keg'],
    Supermarket: ['unit', 'pcs', 'g', 'kg', 'ml', 'L', 'sachet', 'bag', 'pack', 'box', 'carton', 'case', 'bottle', 'can', 'jar'],
    Grocery: ['unit', 'pcs', 'bunch', 'dozen', 'g', 'kg', 'ml', 'L', 'bag', 'pack', 'bottle', 'crate'],
    "Beauty Salon and Spa": ['unit', 'pcs', 'pair', 'g', 'ml', 'L', 'sachet', 'tube', 'bottle', 'jar', 'pack', 'box'],
    "General Retail": ['unit', 'pcs', 'set', 'pair', 'meter', 'g', 'kg', 'ml', 'L', 'roll', 'pack', 'box', 'carton', 'bottle'],
};

// Categories for ingredients (raw materials)
export const ingredientCategories: Record<BusinessType, string[]> = {
    Pharmacy: [
      'Prescription Medicines', 'OTC Medicines', 'Pain Relief', 'Antibiotics', 'Cold & Flu',
      'Vitamins & Supplements', 'Digestive Care', 'Skin & Topical Care', 'First Aid',
      'Medical Devices', 'Personal Care'
    ],
    Restaurant: [
      'Proteins', 'Vegetables', 'Fruits', 'Grains & Flour', 'Dairy & Eggs',
      'Herbs & Spices', 'Oils & Fats', 'Sauces & Condiments', 'Beverages',
      'Frozen Items', 'Dry Goods', 'Packaging'
    ],
    "Bar & Liquor": [
      'Spirits', 'Wine', 'Beer & Cider', 'Liqueurs', 'Mixers', 'Syrups',
      'Juices', 'Garnishes', 'Ice & Chillers', 'Bar Consumables', 'Snacks'
    ],
    Supermarket: [
      'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Frozen Foods',
      'Beverages', 'Snacks & Confectionery', 'Pantry Staples',
      'Canned & Packaged Foods', 'Household Supplies', 'Personal Care',
      'Baby Care', 'Pet Care'
    ],
    Grocery: [
      'Fresh Vegetables', 'Fresh Fruits', 'Roots & Tubers', 'Grains & Cereals',
      'Legumes', 'Dairy & Eggs', 'Meat & Fish', 'Spices & Seasoning',
      'Oils', 'Beverages', 'Snacks', 'Household Essentials'
    ],
    "Beauty Salon and Spa": [
      'Hair Care Products', 'Hair Color & Chemicals', 'Skincare Products',
      'Nail Products', 'Waxing Supplies', 'Massage & Spa Oils',
      'Disposables & Hygiene', 'Salon Tools', 'Retail Products'
    ],
    "General Retail": [
      'Electronics', 'Mobile Accessories', 'Home & Kitchen', 'Cleaning Supplies',
      'Stationery', 'Clothing', 'Footwear', 'Beauty & Personal Care',
      'Hardware', 'Automotive', 'Toys & Games', 'Pet Supplies'
    ],
};

// Categories for sellable products (final foods/items)
export const sellableCategories: Record<BusinessType, string[]> = {
    Pharmacy: [
      'Prescription Medicines', 'OTC Medicines', 'Pain Relief', 'Antibiotics', 'Cold & Flu',
      'Vitamins & Supplements', 'Digestive Care', 'Skin & Topical Care',
      'First Aid', 'Medical Devices', 'Personal Care'
    ],
    Restaurant: [
      'Appetizers', 'Main Courses', 'Sides', 'Salads', 'Soups',
      'Sandwiches & Wraps', 'Pasta & Noodles', 'Rice Dishes',
      'Desserts', 'Hot Beverages', 'Cold Beverages', 'Specials'
    ],
    "Bar & Liquor": [
      'Cocktails', 'Mocktails', 'Shots', 'Spirits (Neat)', 'Wine by Glass',
      'Beer & Cider', 'Soft Drinks', 'Snack Platters', 'Bar Bites', 'Specials'
    ],
    Supermarket: [
      'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Frozen Foods',
      'Beverages', 'Snacks & Confectionery', 'Pantry Staples',
      'Canned & Packaged Foods', 'Household Supplies', 'Personal Care',
      'Baby Care', 'Pet Care', 'Prepared Meals', 'Deli'
    ],
    Grocery: [
      'Fresh Produce', 'Grains & Cereals', 'Legumes', 'Dairy & Eggs',
      'Meat & Fish', 'Beverages', 'Snacks', 'Spices & Seasoning',
      'Household Essentials', 'Personal Care'
    ],
    "Beauty Salon and Spa": [
      'Hair Care', 'Hair Color', 'Skincare', 'Body Care', 'Nail Care',
      'Makeup', 'Fragrances', 'Tools & Accessories', 'Disposable Supplies',
      'Retail Bundles'
    ],
    "General Retail": [
      'Electronics', 'Mobile Accessories', 'Home & Kitchen', 'Cleaning Supplies',
      'Stationery', 'Clothing', 'Footwear', 'Beauty & Personal Care',
      'Hardware', 'Automotive', 'Toys & Games', 'Pet Supplies'
    ],
};

// Categories for produced items (made in-house)
export const producedCategories: Record<BusinessType, string[]> = {
    Pharmacy: [
      'Compounded Medicines', 'Prepared Packs', 'Treatment Kits'
    ],
    Restaurant: [
      'Appetizers', 'Main Courses', 'Sides', 'Salads', 'Soups',
      'Sandwiches & Wraps', 'Pasta & Noodles', 'Rice Dishes',
      'Desserts', 'House Sauces', 'Specials'
    ],
    "Bar & Liquor": [
      'Signature Cocktails', 'Classic Cocktails', 'Mocktails',
      'Shots', 'Infusions', 'Bar Bites', 'Snack Platters'
    ],
    Supermarket: [
      'Bakery', 'Deli', 'Prepared Meals', 'Fresh Juices', 'In-Store Packed Produce'
    ],
    Grocery: [
      'Cut Produce Packs', 'Fresh Juice', 'Bakery Items', 'Ready-to-Cook Packs'
    ],
    "Beauty Salon and Spa": [
      'Treatment Mixes', 'Hair Color Mixes', 'Spa Blends', 'Retail Bundles'
    ],
    "General Retail": [
      'Gift Packs', 'Custom Bundles', 'Repacked Items'
    ],
};

// Categories for purchased items (not produced)
export const purchasedCategories: Record<BusinessType, string[]> = {
    Pharmacy: [
      'Prescription Medicines', 'OTC Medicines', 'Pain Relief', 'Antibiotics', 'Cold & Flu',
      'Vitamins & Supplements', 'Digestive Care', 'Skin & Topical Care',
      'First Aid', 'Medical Devices', 'Personal Care'
    ],
    Restaurant: [
      'Soft Drinks', 'Juices & Water', 'Beer & Cider', 'Wine',
      'Packaged Snacks', 'Desserts (Ready-Made)', 'Frozen Ready Items',
      'Condiments', 'Takeaway Packaging'
    ],
    "Bar & Liquor": [
      'Spirits', 'Wine', 'Beer & Cider', 'Ready-to-Drink',
      'Soft Drinks', 'Bottled Water', 'Snacks', 'Bar Supplies'
    ],
    Supermarket: [
      'Produce', 'Meat & Seafood', 'Dairy & Eggs', 'Bakery', 'Frozen Foods',
      'Beverages', 'Snacks & Confectionery', 'Pantry Staples',
      'Canned & Packaged Foods', 'Household Supplies', 'Personal Care',
      'Baby Care', 'Pet Care'
    ],
    Grocery: [
      'Fresh Produce', 'Grains & Cereals', 'Legumes', 'Dairy & Eggs',
      'Meat & Fish', 'Beverages', 'Snacks', 'Spices & Seasoning',
      'Household Essentials', 'Personal Care'
    ],
    "Beauty Salon and Spa": [
      'Hair Care', 'Hair Color', 'Skincare', 'Body Care', 'Nail Care',
      'Makeup', 'Fragrances', 'Tools & Accessories', 'Disposable Supplies',
      'Retail Bundles'
    ],
    "General Retail": [
      'Electronics', 'Mobile Accessories', 'Home & Kitchen', 'Cleaning Supplies',
      'Stationery', 'Clothing', 'Footwear', 'Beauty & Personal Care',
      'Hardware', 'Automotive', 'Toys & Games', 'Pet Supplies'
    ],
};

// Keep menuCategories for backward compatibility
export const menuCategories: Record<BusinessType, string[]> = ingredientCategories;
