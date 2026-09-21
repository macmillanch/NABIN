import axios from 'axios';

const fallbackBaseUrl =
  process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:4000/api';

export const TOKEN_KEY = 'nabin_grocery_merchant_token';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || fallbackBaseUrl,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export interface MerchantProfile {
  id: string;
  name: string;
  phone?: string;
  address?: string;
  lat?: number;
  lng?: number;
  merchant_type?: string;
  is_open?: boolean;
  rating?: number;
  wallet_balance?: number;
  commission_rate?: number;
  fssai_license?: string | null;
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
  metadata?: { deliveryAddress?: string; deliveryInstructions?: string; customerName?: string };
  lines?: OrderLine[];
  items_snapshot?: OrderLine[];
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

export const authApi = {
  sendOtp: (phone: string) => api.post('/auth/send-otp', { phone, role: 'MERCHANT' }),
  verifyOtp: (phone: string, otp: string) =>
    api.post('/auth/verify-otp', { phone, otp, role: 'MERCHANT' }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
};

export const merchantApi = {
  dashboard: (merchantId: string) => api.get(`/merchant/${merchantId}/dashboard`),
  orders: (status?: string) =>
    api.get('/merchant/orders', { params: status && status !== 'ALL' ? { status } : undefined }),
  setOrderStatus: (orderId: string, status: string, reason?: string) =>
    api.post(`/merchant/orders/${orderId}/status`, { status, reason }),
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
};
