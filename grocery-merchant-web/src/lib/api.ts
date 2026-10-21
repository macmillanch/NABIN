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
    if (token?.startsWith('demo-')) {
      config.adapter = async (cfg) => {
        const url = cfg.url || '';
        let data: Record<string, unknown> = { success: true };

        const demoOrders: MerchantOrder[] = [
          {
            id: 'ord-groc-701',
            order_number: 'ORD-GROC-701',
            service_type: 'GROCERY',
            order_state: 'RECEIVED',
            total_amount: 890,
            currency: 'INR',
            created_at: new Date(Date.now() - 15 * 60000).toISOString(),
            metadata: {
              customerName: 'Manas Ranjan',
              deliveryAddress: 'House 88, Kalinga Nagar, Sector 4, Bhubaneswar',
              deliveryInstructions: 'Leave with security if not answering door',
            },
            lines: [
              { id: 'line-01', product_name_snapshot: 'Aashirvaad Shudh Chakki Atta 5kg', quantity: 1, unit_snapshot: 'kg', unit_price_snapshot: 245, line_total: 245 },
              { id: 'line-02', product_name_snapshot: 'Amul Taaza Homogenised Toned Milk 1L', quantity: 2, unit_snapshot: 'L', unit_price_snapshot: 72, line_total: 144 },
              { id: 'line-03', product_name_snapshot: 'Fortune Premium Kachi Ghani Mustard Oil 1L', quantity: 1, unit_snapshot: 'L', unit_price_snapshot: 165, line_total: 165 },
              { id: 'line-04', product_name_snapshot: 'India Gate Basmati Rice Feast Rozzana 5kg', quantity: 1, unit_snapshot: 'kg', unit_price_snapshot: 336, line_total: 336 },
            ],
          },
          {
            id: 'ord-groc-702',
            order_number: 'ORD-GROC-702',
            service_type: 'GROCERY',
            order_state: 'PACKING',
            total_amount: 450,
            currency: 'INR',
            created_at: new Date(Date.now() - 30 * 60000).toISOString(),
            metadata: {
              customerName: 'Snehalata Mishra',
              deliveryAddress: 'Flat 204, Niladri Vihar, Chandrasekharpur, Bhubaneswar',
            },
            lines: [
              { id: 'line-05', product_name_snapshot: 'Tata Salt Vacuum Evaporated 1kg', quantity: 1, unit_snapshot: 'kg', unit_price_snapshot: 28, line_total: 28 },
              { id: 'line-06', product_name_snapshot: 'Madhur Pure & Hygienic Sugar 1kg', quantity: 2, unit_snapshot: 'kg', unit_price_snapshot: 52, line_total: 104 },
              { id: 'line-07', product_name_snapshot: 'Tata Tea Premium 500g', quantity: 1, unit_snapshot: 'g', unit_price_snapshot: 280, line_total: 280 },
              { id: 'line-08', product_name_snapshot: 'Catch Turmeric Powder 100g', quantity: 1, unit_snapshot: 'g', unit_price_snapshot: 38, line_total: 38 },
            ],
          },
          {
            id: 'ord-groc-703',
            order_number: 'ORD-GROC-703',
            service_type: 'GROCERY',
            order_state: 'READY_FOR_PICKUP',
            total_amount: 1240,
            currency: 'INR',
            created_at: new Date(Date.now() - 55 * 60000).toISOString(),
            metadata: {
              customerName: 'Debasis Sahoo',
              deliveryAddress: 'Lane 3, Bapuji Nagar, Bhubaneswar',
            },
            lines: [
              { id: 'line-09', product_name_snapshot: 'Fortune Sunlite Refined Sunflower Oil 5L Jar', quantity: 1, unit_snapshot: 'L', unit_price_snapshot: 785, line_total: 785 },
              { id: 'line-10', product_name_snapshot: 'Surf Excel Easy Wash Detergent Powder 1.5kg', quantity: 1, unit_snapshot: 'kg', unit_price_snapshot: 245, line_total: 245 },
              { id: 'line-11', product_name_snapshot: 'Dettol Original Germ Protection Bathing Soap (4x125g)', quantity: 1, unit_snapshot: 'pack', unit_price_snapshot: 210, line_total: 210 },
            ],
          },
        ];

        const demoInventory: InventoryItem[] = [
          {
            id: 'inv-01',
            inventoryId: 'inv-01',
            masterProductId: 'mst-01',
            masterName: 'Aashirvaad Shudh Chakki Atta 5kg',
            category: 'Atta & Flours',
            brand: 'Aashirvaad',
            unit: 'kg',
            packSize: '5kg',
            pricingModel: 'FIXED_PER_PACK',
            currentPrice: 245,
            stockQty: 48,
            isAvailable: true,
            status: 'AVAILABLE',
            updatedAt: new Date(Date.now() - 3600000).toISOString(),
          },
          {
            id: 'inv-02',
            inventoryId: 'inv-02',
            masterProductId: 'mst-02',
            masterName: 'Amul Taaza Homogenised Toned Milk 1L',
            category: 'Dairy & Eggs',
            brand: 'Amul',
            unit: 'L',
            packSize: '1L',
            pricingModel: 'FIXED_PER_PACK',
            currentPrice: 72,
            stockQty: 32,
            isAvailable: true,
            status: 'AVAILABLE',
            updatedAt: new Date(Date.now() - 7200000).toISOString(),
          },
          {
            id: 'inv-03',
            inventoryId: 'inv-03',
            masterProductId: 'mst-03',
            masterName: 'Fortune Premium Kachi Ghani Mustard Oil 1L',
            category: 'Edible Oils & Ghee',
            brand: 'Fortune',
            unit: 'L',
            packSize: '1L',
            pricingModel: 'FIXED_PER_PACK',
            currentPrice: 165,
            stockQty: 24,
            isAvailable: true,
            status: 'AVAILABLE',
            updatedAt: new Date(Date.now() - 10800000).toISOString(),
          },
          {
            id: 'inv-04',
            inventoryId: 'inv-04',
            masterProductId: 'mst-04',
            masterName: 'Tata Tea Premium 500g',
            category: 'Tea, Coffee & Beverages',
            brand: 'Tata Tea',
            unit: 'g',
            packSize: '500g',
            pricingModel: 'FIXED_PER_PACK',
            currentPrice: 280,
            stockQty: 16,
            isAvailable: true,
            status: 'AVAILABLE',
            updatedAt: new Date(Date.now() - 14400000).toISOString(),
          },
          {
            id: 'inv-05',
            inventoryId: 'inv-05',
            masterProductId: 'mst-05',
            masterName: 'India Gate Basmati Rice Feast Rozzana 5kg',
            category: 'Rice & Rice Products',
            brand: 'India Gate',
            unit: 'kg',
            packSize: '5kg',
            pricingModel: 'FIXED_PER_PACK',
            currentPrice: 336,
            stockQty: 18,
            isAvailable: true,
            status: 'AVAILABLE',
            updatedAt: new Date(Date.now() - 18000000).toISOString(),
          },
          {
            id: 'inv-06',
            inventoryId: 'inv-06',
            masterProductId: 'mst-06',
            masterName: 'Surf Excel Easy Wash Detergent Powder 1.5kg',
            category: 'Household & Cleaning',
            brand: 'Surf Excel',
            unit: 'kg',
            packSize: '1.5kg',
            pricingModel: 'FIXED_PER_PACK',
            currentPrice: 245,
            stockQty: 28,
            isAvailable: true,
            status: 'AVAILABLE',
            updatedAt: new Date(Date.now() - 21600000).toISOString(),
          },
        ];

        const demoMasterCatalog: MasterProduct[] = [
          { id: 'mst-01', name: 'Aashirvaad Shudh Chakki Atta 5kg', category: 'Atta & Flours', brand: 'Aashirvaad', standard_unit: 'kg', pack_size: '5kg', pricing_model: 'FIXED_PER_PACK' },
          { id: 'mst-02', name: 'Amul Taaza Homogenised Toned Milk 1L', category: 'Dairy & Eggs', brand: 'Amul', standard_unit: 'L', pack_size: '1L', pricing_model: 'FIXED_PER_PACK' },
          { id: 'mst-03', name: 'Fortune Premium Kachi Ghani Mustard Oil 1L', category: 'Edible Oils & Ghee', brand: 'Fortune', standard_unit: 'L', pack_size: '1L', pricing_model: 'FIXED_PER_PACK' },
          { id: 'mst-04', name: 'Tata Tea Premium 500g', category: 'Tea, Coffee & Beverages', brand: 'Tata Tea', standard_unit: 'g', pack_size: '500g', pricing_model: 'FIXED_PER_PACK' },
          { id: 'mst-05', name: 'India Gate Basmati Rice Feast Rozzana 5kg', category: 'Rice & Rice Products', brand: 'India Gate', standard_unit: 'kg', pack_size: '5kg', pricing_model: 'FIXED_PER_PACK' },
          { id: 'mst-06', name: 'Surf Excel Easy Wash Detergent Powder 1.5kg', category: 'Household & Cleaning', brand: 'Surf Excel', standard_unit: 'kg', pack_size: '1.5kg', pricing_model: 'FIXED_PER_PACK' },
          { id: 'mst-07', name: 'Dettol Original Germ Protection Bathing Soap (4x125g)', category: 'Bath & Body', brand: 'Dettol', standard_unit: 'pack', pack_size: '4x125g', pricing_model: 'FIXED_PER_PACK' },
          { id: 'mst-08', name: 'Madhur Pure & Hygienic Sugar 1kg', category: 'Sugar & Jaggery', brand: 'Madhur', standard_unit: 'kg', pack_size: '1kg', pricing_model: 'FIXED_PER_PACK' },
        ];

        if (cfg.method && cfg.method.toLowerCase() !== 'get') {
          data = { success: true, message: 'Demo Preview: Action simulated safely in memory.' };
        } else if (url.includes('/dashboard')) {
          data = { success: true, orders: demoOrders };
        } else if (url.includes('/orders')) {
          data = { success: true, orders: demoOrders };
        } else if (url.includes('/inventory')) {
          data = { success: true, inventory: demoInventory };
        } else if (url.includes('/master-catalog')) {
          data = { success: true, products: demoMasterCatalog };
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
