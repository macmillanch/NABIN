import axios from 'axios';

const fallbackBaseUrl =
  process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:4000/api';

export const TOKEN_KEY = 'nabin_merchant_token';

// Compatibility keys from standalone portals
const LEGACY_TOKEN_KEYS = [
  'nabin_merchant_token',
  'nabin_restaurant_merchant_token',
  'nabin_grocery_merchant_token',
];

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || fallbackBaseUrl,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    let token = window.localStorage.getItem(TOKEN_KEY);
    if (!token) {
      for (const legacyKey of LEGACY_TOKEN_KEYS) {
        const found = window.localStorage.getItem(legacyKey);
        if (found) {
          token = found;
          window.localStorage.setItem(TOKEN_KEY, found);
          break;
        }
      }
    }
    if (token) config.headers.Authorization = `Bearer ${token}`;

    if (token?.startsWith('demo-')) {
      config.adapter = async (cfg) => {
        const url = cfg.url || '';
        let data: Record<string, unknown> = { success: true };

        const isRest = token.includes('restaurant');
        const isGroc = token.includes('grocery');

        if (cfg.method && cfg.method.toLowerCase() !== 'get') {
          data = { success: true, message: 'Demo Preview: Action simulated safely in memory (no backend mutation).' };
        } else if (url.includes('/merchant/services')) {
          data = {
            success: true,
            merchantId: isRest ? 'demo-rest-merchant-01' : isGroc ? 'demo-groc-merchant-01' : 'demo-hybrid-merchant-01',
            name: isRest ? 'Tandoori Nights' : isGroc ? 'Fresh Harvest Mart' : 'Zonun Deli & Grocery',
            merchantType: isRest ? 'RESTAURANT' : isGroc ? 'GROCERY' : 'HYBRID_BOTH',
            services: isRest ? ['RESTAURANT'] : isGroc ? ['INSTAMART'] : ['RESTAURANT', 'INSTAMART'],
            needsServiceSelector: !isRest && !isGroc,
            isOpen: true,
          };
        }

        return {
          data,
          status: 200,
          statusText: 'OK',
          headers: {},
          config: cfg,
        };
      };
    }
  }
  return config;
});

export interface MerchantProfile {
  id: string;
  name: string;
  business_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  lat?: number;
  lng?: number;
  merchant_type?: 'RESTAURANT' | 'GROCERY' | 'HYBRID_BOTH' | string;
  is_open?: boolean;
  prep_time?: number;
  service_radius?: number;
  auto_accept?: boolean;
  rating?: number;
  wallet_balance?: number;
  commission_rate?: number;
  fssai_license?: string | null;
}

export interface MerchantServicesResponse {
  success: boolean;
  merchantId: string;
  name: string | null;
  merchantType: 'RESTAURANT' | 'GROCERY' | 'HYBRID_BOTH' | string;
  services: ('RESTAURANT' | 'INSTAMART' | string)[];
  needsServiceSelector: boolean;
  isOpen: boolean | null;
  profile: {
    name: string | null;
    phone: string | null;
    address: string | null;
    fssaiLicense: string | null;
    city: string | null;
    rating: number | null;
  };
}

export interface OrderLine {
  id?: string;
  product_name_snapshot?: string;
  quantity?: number;
  unit_snapshot?: string;
  unit_price_snapshot?: number;
  line_total?: number;
  fulfilled_quantity?: number;
  packed_confirmed_quantity?: number | null;
  is_partially_fulfilled?: boolean;
  grocery_inventory_id?: string | null;
}

export interface MerchantOrder {
  id: string;
  order_number: string;
  service_type: 'FOOD' | 'GROCERY' | string;
  order_state: string;
  total_amount: number;
  currency?: string;
  created_at: string;
  updated_at?: string;
  checkout_id?: string | null;
  metadata?: { deliveryAddress?: string; deliveryInstructions?: string; customerName?: string };
  lines?: OrderLine[];
  items_snapshot?: OrderLine[];
}

export interface Product {
  id: string;
  sku?: string;
  name: string;
  description?: string | null;
  category?: string;
  price: number;
  discount_price?: number | null;
  is_available?: boolean;
  in_stock_quantity?: number;
  merchant_id?: string;
  selling_price?: number;
  mrp?: number;
  discount_percent?: number;
  is_veg?: boolean;
}

export interface InventoryItem {
  id: string;
  inventoryId: string;
  masterProductId: string;
  masterName: string;
  category: string;
  brand: string;
  unit: string;
  packSize: string;
  pricingModel: string;
  currentPrice: number;
  stockQty: number;
  isAvailable: boolean;
  status: string;
  updatedAt: string;
}

export interface MasterProduct {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  brand?: string;
  standard_unit?: string;
  pack_size?: string;
  pricing_model?: string;
}

export interface RegisterMerchantPayload {
  name: string;
  phone: string;
  address: string;
  businessType: 'RESTAURANT' | 'GROCERY' | 'BOTH';
  ownerName?: string;
  email?: string;
  fssaiLicense?: string;
  lat?: number;
  lng?: number;
}

export const authApi = {
  sendOtp: (phone: string) => api.post('/auth/send-otp', { phone, role: 'MERCHANT' }),
  verifyOtp: (phone: string, otp: string) =>
    api.post('/auth/verify-otp', { phone, otp, role: 'MERCHANT' }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
  register: (payload: RegisterMerchantPayload) => api.post('/merchant/register', payload),
};

export const merchantApi = {
  services: () => api.get('/merchant/services'),
  dashboard: (merchantId: string) => api.get(`/merchant/${merchantId}/dashboard`),
  orders: (status?: string) =>
    api.get('/merchant/orders', { params: status && status !== 'ALL' ? { status } : undefined }),
  setOrderStatus: (orderId: string, status: string, reason?: string) =>
    api.post(`/merchant/orders/${orderId}/status`, { status, reason }),
  // Restaurant Menu
  catalog: () => api.get('/merchant/catalog'),
  toggleDish: (merchantId: string, itemId: string) =>
    api.post(`/merchant/${merchantId}/menu/${itemId}/toggle`),
  // Grocery Inventory
  inventory: () => api.get('/merchant/inventory'),
  saveInventory: (patch: {
    masterProductId: string;
    currentPrice?: number;
    stockQty?: number;
    isAvailable?: boolean;
  }) => api.post('/merchant/inventory', patch),
  masterCatalog: () => api.get('/merchant/master-catalog'),
  setPackedWeight: (orderId: string, itemId: string, packedWeight: number) =>
    api.post(`/grocery/orders/${orderId}/packed-weight`, { itemId, packedWeight }),
  // Profile
  updateProfile: (merchantId: string, patch: Record<string, unknown>) =>
    api.patch(`/merchant/${merchantId}/profile`, patch),
};
