export interface DishVariant {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
}

export interface DishAddOnOption {
  id: string;
  name: string;
  price: number;
  isDefault: boolean;
  isAvailable: boolean;
}

export interface DishAddOnGroup {
  id: string;
  name: string;
  isRequired: boolean;
  selectionType: 'single' | 'multi';
  minSelect: number;
  maxSelect: number;
  options: DishAddOnOption[];
}

export interface RestaurantDishItem {
  id: string;
  merchant_id?: string;
  name: string;
  shortDescription?: string;
  description: string;
  category: string;
  foodType: 'veg' | 'non-veg' | 'egg' | 'vegan';
  sku?: string;
  basePrice: number;
  sellingPrice: number;
  mrp?: number;
  discountPercent?: number;
  prepTime: number; // in minutes
  isAvailable: boolean;
  isFeatured?: boolean;
  photos: string[];
  primaryPhotoIndex: number;
  variants: DishVariant[];
  addOnGroups: DishAddOnGroup[];
  updatedAt: string;
}

export interface GroceryProductVariant {
  id: string;
  name: string;
  packSize: string;
  unit: string;
  sellingPrice: number;
  mrp: number;
  sku: string;
  stockQty: number;
  isAvailable: boolean;
}

export interface GroceryProductItem {
  id: string;
  name: string;
  brand: string;
  category: string;
  subcategory?: string;
  sku: string;
  barcode?: string;
  description: string;
  unit: 'piece' | 'pack' | 'kg' | 'g' | 'litre' | 'ml';
  sellingPrice: number;
  mrp?: number;
  discountPercent?: number;
  stockQty: number;
  lowStockThreshold: number;
  isAvailable: boolean;
  photos: string[];
  primaryPhotoIndex: number;
  variants: GroceryProductVariant[];
  updatedAt: string;
}

export const DEFAULT_RESTAURANT_DISHES: RestaurantDishItem[] = [
  {
    id: 'dish-demo-1',
    name: 'Royal Mutton Biryani',
    shortDescription: 'Slow-cooked aromatic Dum Biryani with tender mutton shanks',
    description: 'Slow cooked in traditional copper handi with long-grain aged basmati rice, tender succulent mutton pieces, aromatic whole spices, saffron milk, and fried golden onions. Served with spiced cucumber raita and salan.',
    category: 'Main Course',
    foodType: 'non-veg',
    sku: 'RBH-M-01',
    basePrice: 380,
    sellingPrice: 340,
    mrp: 380,
    discountPercent: 10,
    prepTime: 30,
    isAvailable: true,
    isFeatured: true,
    photos: [
      'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=600&auto=format&fit=crop&q=80',
    ],
    primaryPhotoIndex: 0,
    variants: [
      { id: 'var-1', name: 'Regular (Serves 1, 1 Piece Mutton)', price: 340, isAvailable: true },
      { id: 'var-2', name: 'Large (Serves 2, 2 Pieces Mutton + Egg)', price: 590, isAvailable: true },
      { id: 'var-3', name: 'Family Pack (Serves 4, 4 Pieces + 2 Eggs)', price: 1100, isAvailable: true },
    ],
    addOnGroups: [
      {
        id: 'grp-addon-1',
        name: 'Extra Gravy & Accompaniments',
        isRequired: false,
        selectionType: 'multi',
        minSelect: 0,
        maxSelect: 3,
        options: [
          { id: 'opt-1', name: 'Extra Spiced Mirchi Ka Salan (150ml)', price: 40, isDefault: false, isAvailable: true },
          { id: 'opt-2', name: 'Boiled Spiced Egg (1 pc)', price: 25, isDefault: false, isAvailable: true },
          { id: 'opt-3', name: 'Chilled Burani Garlic Raita (100ml)', price: 35, isDefault: false, isAvailable: true },
        ],
      },
      {
        id: 'grp-addon-2',
        name: 'Beverage Pairing',
        isRequired: false,
        selectionType: 'single',
        minSelect: 0,
        maxSelect: 1,
        options: [
          { id: 'opt-4', name: 'Thums Up (250ml Can)', price: 40, isDefault: false, isAvailable: true },
          { id: 'opt-5', name: 'Rose Masala Shikanji (300ml)', price: 60, isDefault: false, isAvailable: true },
        ],
      },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'dish-demo-2',
    name: 'Galouti Kebab (4 pcs)',
    shortDescription: 'Melt-in-mouth smoked minced mutton patties with Lucknow spices',
    description: 'Tenderised finely minced mutton infused with 32 rare royal Awadhi spices, pan seared in pure desi ghee to silky melt-in-mouth consistency. Accompanied by mint-coriander emulsion and laccha pyaaz.',
    category: 'Starters',
    foodType: 'non-veg',
    sku: 'RBH-K-02',
    basePrice: 260,
    sellingPrice: 240,
    mrp: 260,
    discountPercent: 8,
    prepTime: 20,
    isAvailable: true,
    isFeatured: true,
    photos: [
      'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?w=600&auto=format&fit=crop&q=80',
    ],
    primaryPhotoIndex: 0,
    variants: [
      { id: 'var-g1', name: 'Standard Portion (4 pcs)', price: 240, isAvailable: true },
      { id: 'var-g2', name: 'Platter (8 pcs)', price: 440, isAvailable: true },
    ],
    addOnGroups: [
      {
        id: 'grp-bread',
        name: 'Choice of Traditional Bread',
        isRequired: true,
        selectionType: 'single',
        minSelect: 1,
        maxSelect: 1,
        options: [
          { id: 'opt-b1', name: 'Ulte Tawe Ka Paratha (1 pc)', price: 30, isDefault: true, isAvailable: true },
          { id: 'opt-b2', name: 'Sheermal Sweet Saffron Roti', price: 50, isDefault: false, isAvailable: true },
          { id: 'opt-b3', name: 'Rumali Roti (1 pc)', price: 20, isDefault: false, isAvailable: true },
        ],
      },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'dish-demo-3',
    name: 'Paneer Butter Masala',
    shortDescription: 'Fresh malai cottage cheese cubes in rich tomato cashew gravy',
    description: 'Charred soft cottage cheese cubes simmered in a mildly sweet and tangy gravy of vine ripened tomatoes, slow roasted cashew paste, hand-churned butter, and fragrant crushed fenugreek leaves (kasuri methi).',
    category: 'Main Course',
    foodType: 'veg',
    sku: 'RBH-P-03',
    basePrice: 280,
    sellingPrice: 260,
    mrp: 280,
    discountPercent: 7,
    prepTime: 18,
    isAvailable: true,
    isFeatured: false,
    photos: [
      'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=600&auto=format&fit=crop&q=80',
    ],
    primaryPhotoIndex: 0,
    variants: [
      { id: 'var-p1', name: 'Half (300ml, 5-6 cubes)', price: 160, isAvailable: true },
      { id: 'var-p2', name: 'Full (600ml, 10-12 cubes)', price: 260, isAvailable: true },
    ],
    addOnGroups: [
      {
        id: 'grp-pbread',
        name: 'Accompaniment Breads',
        isRequired: false,
        selectionType: 'multi',
        minSelect: 0,
        maxSelect: 4,
        options: [
          { id: 'opt-pb1', name: 'Butter Naan (1 pc)', price: 45, isDefault: false, isAvailable: true },
          { id: 'opt-pb2', name: 'Garlic Butter Naan (1 pc)', price: 60, isDefault: false, isAvailable: true },
          { id: 'opt-pb3', name: 'Tandoori Roti with Butter (2 pcs)', price: 35, isDefault: false, isAvailable: true },
        ],
      },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'dish-demo-4',
    name: 'Gulab Jamun (2 pcs)',
    shortDescription: 'Warm golden khoya dumplings soaked in cardamom sugar syrup',
    description: 'Handcrafted mawa and chenna dumplings deep-fried in pure ghee and steeped in cardamom and rose water infused sugar syrup. Served warm with slivered pistachios.',
    category: 'Desserts',
    foodType: 'veg',
    sku: 'RBH-D-04',
    basePrice: 90,
    sellingPrice: 80,
    mrp: 90,
    discountPercent: 11,
    prepTime: 10,
    isAvailable: true,
    isFeatured: false,
    photos: [
      'https://images.unsplash.com/photo-1589301760014-d929f3979dbc?w=600&auto=format&fit=crop&q=80',
    ],
    primaryPhotoIndex: 0,
    variants: [
      { id: 'var-gj1', name: 'Portion of 2 pcs', price: 80, isAvailable: true },
      { id: 'var-gj2', name: 'Family Box (6 pcs)', price: 220, isAvailable: true },
    ],
    addOnGroups: [
      {
        id: 'grp-icecream',
        name: 'Topping',
        isRequired: false,
        selectionType: 'single',
        minSelect: 0,
        maxSelect: 1,
        options: [
          { id: 'opt-ic1', name: 'Vanilla Bean Ice Cream Scoop', price: 40, isDefault: false, isAvailable: true },
          { id: 'opt-ic2', name: 'Rabdi Drizzle (50g)', price: 45, isDefault: false, isAvailable: true },
        ],
      },
    ],
    updatedAt: new Date().toISOString(),
  },
];

export const DEFAULT_GROCERY_PRODUCTS: GroceryProductItem[] = [
  {
    id: 'prod-demo-1',
    name: 'Aashirvaad Shudh Chakki Atta',
    brand: 'Aashirvaad',
    category: 'Staples & Grains',
    subcategory: 'Flour & Atta',
    sku: 'ASH-AT-05K',
    barcode: '8901030382910',
    description: '100% whole wheat grain chakki atta with zero maida. High fiber for soft and nutritious rotis.',
    unit: 'kg',
    sellingPrice: 275,
    mrp: 310,
    discountPercent: 11,
    stockQty: 45,
    lowStockThreshold: 10,
    isAvailable: true,
    photos: [
      'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&auto=format&fit=crop&q=80',
    ],
    primaryPhotoIndex: 0,
    variants: [
      { id: 'gvar-1', name: '1 kg Pouch', packSize: '1kg', unit: 'kg', sellingPrice: 62, mrp: 70, sku: 'ASH-AT-01K', stockQty: 25, isAvailable: true },
      { id: 'gvar-2', name: '5 kg Value Bag', packSize: '5kg', unit: 'kg', sellingPrice: 275, mrp: 310, sku: 'ASH-AT-05K', stockQty: 45, isAvailable: true },
      { id: 'gvar-3', name: '10 kg Mega Saver', packSize: '10kg', unit: 'kg', sellingPrice: 510, mrp: 580, sku: 'ASH-AT-10K', stockQty: 18, isAvailable: true },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-demo-2',
    name: 'Fortune Sunlite Refined Sunflower Oil',
    brand: 'Fortune',
    category: 'Edible Oils',
    subcategory: 'Cooking Oils',
    sku: 'FOR-OIL-1L',
    barcode: '8906007281013',
    description: 'Light and healthy edible oil enriched with Vitamin A & D. Low absorption formula for crispy cooking.',
    unit: 'litre',
    sellingPrice: 135,
    mrp: 160,
    discountPercent: 15,
    stockQty: 8,
    lowStockThreshold: 15,
    isAvailable: true,
    photos: [
      'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=600&auto=format&fit=crop&q=80',
    ],
    primaryPhotoIndex: 0,
    variants: [
      { id: 'gvar-oil-1', name: '1 Litre Pouch', packSize: '1L', unit: 'litre', sellingPrice: 135, mrp: 160, sku: 'FOR-OIL-1L', stockQty: 8, isAvailable: true },
      { id: 'gvar-oil-2', name: '5 Litre Jar with Spout', packSize: '5L', unit: 'litre', sellingPrice: 650, mrp: 780, sku: 'FOR-OIL-5L', stockQty: 12, isAvailable: true },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-demo-3',
    name: 'Tata Salt Vacuum Evaporated',
    brand: 'Tata',
    category: 'Spices & Salt',
    subcategory: 'Salt & Seasoning',
    sku: 'TAT-SLT-1K',
    barcode: '8901012111118',
    description: 'Desh Ka Namak. Pure vacuum evaporated iodised salt guarantees right iodine levels for family health.',
    unit: 'kg',
    sellingPrice: 28,
    mrp: 30,
    discountPercent: 7,
    stockQty: 80,
    lowStockThreshold: 20,
    isAvailable: true,
    photos: [
      'https://images.unsplash.com/photo-1518110925495-5fe2fda0442c?w=600&auto=format&fit=crop&q=80',
    ],
    primaryPhotoIndex: 0,
    variants: [
      { id: 'gvar-slt-1', name: '1 kg Pack', packSize: '1kg', unit: 'kg', sellingPrice: 28, mrp: 30, sku: 'TAT-SLT-1K', stockQty: 80, isAvailable: true },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-demo-4',
    name: 'Amul Taaza Homogenised Toned Milk',
    brand: 'Amul',
    category: 'Dairy & Milk',
    subcategory: 'Milk & Cream',
    sku: 'AML-TZ-500',
    barcode: '8901262010056',
    description: 'Long shelf life UHT treated fresh toned milk. No preservatives needed. Consume chilled or heated.',
    unit: 'ml',
    sellingPrice: 27,
    mrp: 28,
    discountPercent: 4,
    stockQty: 0,
    lowStockThreshold: 15,
    isAvailable: false,
    photos: [
      'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=600&auto=format&fit=crop&q=80',
    ],
    primaryPhotoIndex: 0,
    variants: [
      { id: 'gvar-mlk-1', name: '500 ml Tetra Pak', packSize: '500ml', unit: 'ml', sellingPrice: 27, mrp: 28, sku: 'AML-TZ-500', stockQty: 0, isAvailable: false },
      { id: 'gvar-mlk-2', name: '1 Litre Family Tetra Pak', packSize: '1L', unit: 'litre', sellingPrice: 54, mrp: 56, sku: 'AML-TZ-1L', stockQty: 0, isAvailable: false },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'prod-demo-5',
    name: 'India Gate Basmati Rice Feast Rozzana',
    brand: 'India Gate',
    category: 'Staples & Grains',
    subcategory: 'Rice & Grains',
    sku: 'IND-BS-5K',
    barcode: '8901144001123',
    description: 'Aged long grain aromatic basmati rice ideal for everyday biryani, pulao, and steamed rice.',
    unit: 'kg',
    sellingPrice: 420,
    mrp: 495,
    discountPercent: 15,
    stockQty: 22,
    lowStockThreshold: 8,
    isAvailable: true,
    photos: [
      'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600&auto=format&fit=crop&q=80',
    ],
    primaryPhotoIndex: 0,
    variants: [
      { id: 'gvar-rc-1', name: '1 kg Pouch', packSize: '1kg', unit: 'kg', sellingPrice: 90, mrp: 105, sku: 'IND-BS-1K', stockQty: 15, isAvailable: true },
      { id: 'gvar-rc-2', name: '5 kg Family Bag', packSize: '5kg', unit: 'kg', sellingPrice: 420, mrp: 495, sku: 'IND-BS-5K', stockQty: 22, isAvailable: true },
    ],
    updatedAt: new Date().toISOString(),
  },
];

const MENU_STORAGE_KEY = 'nabin_demo_menu_items';
const GROCERY_STORAGE_KEY = 'nabin_demo_grocery_items';

export function getStoredMenuDishes(): RestaurantDishItem[] {
  if (typeof window === 'undefined') return DEFAULT_RESTAURANT_DISHES;
  try {
    const raw = localStorage.getItem(MENU_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(MENU_STORAGE_KEY, JSON.stringify(DEFAULT_RESTAURANT_DISHES));
      return DEFAULT_RESTAURANT_DISHES;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_RESTAURANT_DISHES;
  } catch {
    return DEFAULT_RESTAURANT_DISHES;
  }
}

export function saveStoredMenuDishes(dishes: RestaurantDishItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(MENU_STORAGE_KEY, JSON.stringify(dishes));
  } catch (e: any) {
    console.warn('Direct localStorage save failed, applying compact fallback', e);
    try {
      // Quota defense: compact dishes by keeping only primary photo and top 20 items
      const compacted = dishes.slice(0, 25).map((d) => ({
        ...d,
        photos: d.photos.slice(0, 2),
      }));
      localStorage.setItem(MENU_STORAGE_KEY, JSON.stringify(compacted));
    } catch (compactErr) {
      console.error('Failed to save compacted menu dishes', compactErr);
    }
  }
}

export function getStoredGroceryProducts(): GroceryProductItem[] {
  if (typeof window === 'undefined') return DEFAULT_GROCERY_PRODUCTS;
  try {
    const raw = localStorage.getItem(GROCERY_STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(GROCERY_STORAGE_KEY, JSON.stringify(DEFAULT_GROCERY_PRODUCTS));
      return DEFAULT_GROCERY_PRODUCTS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_GROCERY_PRODUCTS;
  } catch {
    return DEFAULT_GROCERY_PRODUCTS;
  }
}

export function saveStoredGroceryProducts(products: GroceryProductItem[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(GROCERY_STORAGE_KEY, JSON.stringify(products));
  } catch (e: any) {
    console.warn('Direct localStorage save failed, applying compact fallback', e);
    try {
      // Quota defense: compact products by keeping only primary photo and top 30 items
      const compacted = products.slice(0, 30).map((p) => ({
        ...p,
        photos: p.photos.slice(0, 2),
      }));
      localStorage.setItem(GROCERY_STORAGE_KEY, JSON.stringify(compacted));
    } catch (compactErr) {
      console.error('Failed to save compacted grocery products', compactErr);
    }
  }
}

export interface DemoCatalogSyncPayload {
  schema: 'nabin-catalog-sync';
  version: '1.0';
  description: string;
  origin: string;
  exportedAt: string;
  menuDishes: RestaurantDishItem[];
  groceryProducts: GroceryProductItem[];
}

export function exportDemoCatalogPayload(): string {
  const cleanDishes = getStoredMenuDishes().map((d) => ({
    id: d.id,
    name: d.name,
    shortDescription: d.shortDescription ?? '',
    description: d.description ?? '',
    category: d.category,
    foodType: d.foodType,
    sku: d.sku,
    basePrice: Number(d.basePrice) || 0,
    sellingPrice: Number(d.sellingPrice) || 0,
    mrp: Number(d.mrp) || Number(d.sellingPrice) || 0,
    prepTime: Number(d.prepTime) || 20,
    isAvailable: d.isAvailable !== false,
    isFeatured: d.isFeatured === true,
    photos: Array.isArray(d.photos) ? d.photos : [],
    primaryPhotoIndex: Number(d.primaryPhotoIndex) || 0,
    variants: Array.isArray(d.variants) ? d.variants : [],
    addOnGroups: Array.isArray(d.addOnGroups) ? d.addOnGroups : [],
    updatedAt: d.updatedAt || new Date().toISOString(),
  }));

  const cleanProducts = getStoredGroceryProducts().map((p) => ({
    id: p.id,
    name: p.name,
    brand: p.brand || '',
    category: p.category,
    description: p.description ?? '',
    unit: p.unit,
    sellingPrice: Number(p.sellingPrice) || 0,
    mrp: Number(p.mrp) || Number(p.sellingPrice) || 0,
    stockQty: Number(p.stockQty) || 0,
    lowStockThreshold: Number(p.lowStockThreshold) || 5,
    isAvailable: p.isAvailable !== false,
    sku: p.sku || '',
    photos: Array.isArray(p.photos) ? p.photos : [],
    primaryPhotoIndex: Number(p.primaryPhotoIndex) || 0,
    variants: Array.isArray(p.variants) ? p.variants : [],
    updatedAt: p.updatedAt || new Date().toISOString(),
  }));

  const payload: DemoCatalogSyncPayload = {
    schema: 'nabin-catalog-sync',
    version: '1.0',
    description: 'NABIN Demo Catalog Transfer Payload (Dishes, Products, Variants, Add-ons)',
    origin: typeof window !== 'undefined' ? window.location.origin : 'merchant-web',
    exportedAt: new Date().toISOString(),
    menuDishes: cleanDishes,
    groceryProducts: cleanProducts,
  };
  return JSON.stringify(payload, null, 2);
}

export function importDemoCatalogPayload(jsonString: string): {
  success: boolean;
  dishesImported: number;
  productsImported: number;
  dishCount: number;
  productCount: number;
  error?: string;
} {
  try {
    if (!jsonString || typeof jsonString !== 'string' || !jsonString.trim()) {
      return { success: false, dishesImported: 0, productsImported: 0, dishCount: 0, productCount: 0, error: 'Empty file payload' };
    }
    const parsed = JSON.parse(jsonString);
    if (!parsed || typeof parsed !== 'object') {
      return { success: false, dishesImported: 0, productsImported: 0, dishCount: 0, productCount: 0, error: 'Malformed JSON payload' };
    }
    if (parsed.schema && parsed.schema !== 'nabin-catalog-sync') {
      return { success: false, dishesImported: 0, productsImported: 0, dishCount: 0, productCount: 0, error: `Unsupported catalog schema: "${parsed.schema}". Expected "nabin-catalog-sync".` };
    }
    if (parsed.version && parsed.version !== '1.0') {
      return { success: false, dishesImported: 0, productsImported: 0, dishCount: 0, productCount: 0, error: `Unsupported catalog version: "${parsed.version}". Only version 1.0 is supported.` };
    }
    const incomingDishes = Array.isArray(parsed.restaurantDishes) ? parsed.restaurantDishes : Array.isArray(parsed.menuDishes) ? parsed.menuDishes : null;
    const incomingProducts = Array.isArray(parsed.groceryProducts) ? parsed.groceryProducts : null;
    if (!incomingDishes && !incomingProducts) {
      return { success: false, dishesImported: 0, productsImported: 0, dishCount: 0, productCount: 0, error: 'Payload must contain a "restaurantDishes" (or "menuDishes") or "groceryProducts" array.' };
    }

    let dishesCount = 0;
    let productsCount = 0;

    if (incomingDishes && incomingDishes.length > 0) {
      const validDishes: RestaurantDishItem[] = [];
      for (const d of incomingDishes) {
        if (d && typeof d === 'object' && d.id && d.name && typeof d.sellingPrice === 'number' && d.sellingPrice >= 0) {
          validDishes.push({
            id: String(d.id),
            name: String(d.name),
            shortDescription: d.shortDescription ? String(d.shortDescription) : '',
            description: d.description ? String(d.description) : '',
            category: String(d.category || 'Main Course'),
            foodType: ['veg', 'non-veg', 'egg', 'vegan'].includes(d.foodType) ? d.foodType : 'veg',
            sku: d.sku ? String(d.sku) : undefined,
            basePrice: Number(d.basePrice) || Number(d.sellingPrice),
            sellingPrice: Number(d.sellingPrice),
            mrp: Number(d.mrp) || Number(d.sellingPrice),
            prepTime: Number(d.prepTime) || 20,
            isAvailable: d.isAvailable !== false,
            isFeatured: d.isFeatured === true,
            photos: Array.isArray(d.photos) ? d.photos.map(String) : [],
            primaryPhotoIndex: Number(d.primaryPhotoIndex) || 0,
            variants: Array.isArray(d.variants) ? d.variants : [],
            addOnGroups: Array.isArray(d.addOnGroups) ? d.addOnGroups : [],
            updatedAt: d.updatedAt ? String(d.updatedAt) : new Date().toISOString(),
          });
        }
      }
      if (validDishes.length > 0) {
        saveStoredMenuDishes(validDishes);
        dishesCount = validDishes.length;
      }
    }

    if (incomingProducts && incomingProducts.length > 0) {
      const validProducts: GroceryProductItem[] = [];
      for (const p of incomingProducts) {
        if (p && typeof p === 'object' && p.id && p.name && typeof p.sellingPrice === 'number' && p.sellingPrice >= 0) {
          validProducts.push({
            id: String(p.id),
            name: String(p.name),
            brand: p.brand ? String(p.brand) : 'Fresho',
            category: String(p.category || 'Daily Essentials'),
            description: p.description ? String(p.description) : '',
            unit: ['piece', 'pack', 'kg', 'g', 'litre', 'ml'].includes(p.unit) ? p.unit : 'pack',
            sellingPrice: Number(p.sellingPrice),
            mrp: Number(p.mrp) || Number(p.sellingPrice),
            stockQty: typeof p.stockQty === 'number' ? Math.max(0, p.stockQty) : 10,
            lowStockThreshold: Number(p.lowStockThreshold) || 5,
            isAvailable: p.isAvailable !== false,
            sku: p.sku ? String(p.sku) : `SKU-${Date.now().toString().slice(-4)}`,
            photos: Array.isArray(p.photos) ? p.photos.map(String) : [],
            primaryPhotoIndex: Number(p.primaryPhotoIndex) || 0,
            variants: Array.isArray(p.variants) ? p.variants : [],
            updatedAt: p.updatedAt ? String(p.updatedAt) : new Date().toISOString(),
          });
        }
      }
      if (validProducts.length > 0) {
        saveStoredGroceryProducts(validProducts);
        productsCount = validProducts.length;
      }
    }

    if (dishesCount === 0 && productsCount === 0) {
      return { success: false, dishesImported: 0, productsImported: 0, dishCount: 0, productCount: 0, error: 'No valid dishes or products found in import file.' };
    }

    return { success: true, dishesImported: dishesCount, productsImported: productsCount, dishCount: dishesCount, productCount: productsCount };
  } catch (err: any) {
    return { success: false, dishesImported: 0, productsImported: 0, dishCount: 0, productCount: 0, error: err?.message || 'Invalid JSON syntax' };
  }
}

