import axios from 'axios';

const fallbackBaseUrl =
  process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:4000/api';

export const TOKEN_KEY = 'nabin_restaurant_merchant_token';

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
            id: 'ord-rest-901',
            order_number: 'ORD-REST-901',
            service_type: 'FOOD',
            order_state: 'RECEIVED',
            total_amount: 580,
            currency: 'INR',
            created_at: new Date(Date.now() - 12 * 60000).toISOString(),
            metadata: {
              customerName: 'Aditi Rao',
              deliveryAddress: 'Flat 402, Royal Palms, Saheed Nagar, Bhubaneswar',
              deliveryInstructions: 'Ring the doorbell, please do not honk',
            },
            lines: [
              { product_name_snapshot: 'Butter Chicken (Half)', quantity: 1, unit_price_snapshot: 320, line_total: 320 },
              { product_name_snapshot: 'Garlic Butter Naan', quantity: 2, unit_price_snapshot: 60, line_total: 120 },
              { product_name_snapshot: 'Jeera Basmati Rice', quantity: 1, unit_price_snapshot: 140, line_total: 140 },
            ],
          },
          {
            id: 'ord-rest-902',
            order_number: 'ORD-REST-902',
            service_type: 'FOOD',
            order_state: 'PREPARING',
            total_amount: 420,
            currency: 'INR',
            created_at: new Date(Date.now() - 24 * 60000).toISOString(),
            metadata: {
              customerName: 'Vikram Das',
              deliveryAddress: 'Tower B, Tech Hub, Infocity, Patia',
              deliveryInstructions: 'Call upon arrival at tower gate',
            },
            lines: [
              { product_name_snapshot: 'Paneer Tikka Angara', quantity: 1, unit_price_snapshot: 240, line_total: 240 },
              { product_name_snapshot: 'Tandoori Butter Roti', quantity: 3, unit_price_snapshot: 60, line_total: 180 },
            ],
          },
          {
            id: 'ord-rest-903',
            order_number: 'ORD-REST-903',
            service_type: 'FOOD',
            order_state: 'PACKING',
            total_amount: 750,
            currency: 'INR',
            created_at: new Date(Date.now() - 36 * 60000).toISOString(),
            metadata: {
              customerName: 'Subhashree Mohanty',
              deliveryAddress: 'Plot 105, Jaydev Vihar, Bhubaneswar',
            },
            lines: [
              { product_name_snapshot: 'Dum Mutton Biryani', quantity: 1, unit_price_snapshot: 450, line_total: 450 },
              { product_name_snapshot: 'Burani Raita', quantity: 1, unit_price_snapshot: 80, line_total: 80 },
              { product_name_snapshot: 'Gulab Jamun (2 pcs)', quantity: 2, unit_price_snapshot: 110, line_total: 220 },
            ],
          },
          {
            id: 'ord-rest-904',
            order_number: 'ORD-REST-904',
            service_type: 'FOOD',
            order_state: 'READY_FOR_PICKUP',
            total_amount: 310,
            currency: 'INR',
            created_at: new Date(Date.now() - 48 * 60000).toISOString(),
            metadata: {
              customerName: 'Rajesh Nayak',
              deliveryAddress: 'House 14, BJB Nagar, Bhubaneswar',
            },
            lines: [
              { product_name_snapshot: 'Dal Makhani Bukhara', quantity: 1, unit_price_snapshot: 210, line_total: 210 },
              { product_name_snapshot: 'Tandoori Roti', quantity: 2, unit_price_snapshot: 50, line_total: 100 },
            ],
          },
        ];

        const demoProducts: Product[] = [
          { id: 'prod-01', sku: 'MC-BUTTER-CHK', name: 'Butter Chicken (Half)', category: 'Main Course', price: 320, is_available: true, description: 'Tender chicken simmered in rich makhani gravy with butter' },
          { id: 'prod-02', sku: 'ST-PANEER-TIK', name: 'Paneer Tikka Angara', category: 'Tandoori Starters', price: 240, is_available: true, description: 'Charcoal-grilled cottage cheese cubes marinated in spiced yogurt' },
          { id: 'prod-03', sku: 'RC-MUTTON-BIR', name: 'Dum Mutton Biryani', category: 'Biryani & Rice', price: 450, is_available: true, description: 'Slow-cooked aromatic basmati rice layered with spiced mutton' },
          { id: 'prod-04', sku: 'MC-DAL-MAKH', name: 'Dal Makhani Bukhara', category: 'Main Course', price: 210, is_available: true, description: 'Black lentils slow cooked overnight with churned butter and cream' },
          { id: 'prod-05', sku: 'BR-GARLIC-NAAN', name: 'Garlic Butter Naan', category: 'Breads', price: 60, is_available: true, description: 'Clay oven leavened bread brushed with garlic-infused butter' },
          { id: 'prod-06', sku: 'DS-GULAB-JAM', name: 'Gulab Jamun (2 pcs)', category: 'Desserts', price: 90, is_available: true, description: 'Hot khoya dumplings soaked in cardamom saffron syrup' },
        ];

        if (cfg.method && cfg.method.toLowerCase() !== 'get') {
          data = { success: true, message: 'Demo Preview: Action simulated safely in memory.' };
        } else if (url.includes('/dashboard')) {
          data = { success: true, orders: demoOrders };
        } else if (url.includes('/orders')) {
          data = { success: true, orders: demoOrders };
        } else if (url.includes('/catalog')) {
          data = { success: true, products: demoProducts };
        } else if (url.includes('/rms/tables')) {
          data = {
            success: true,
            tables: [
              { id: 'tbl-1', table_number: 'T1', name: 'Window Booth', capacity: 4, status: 'OCCUPIED', current_session_id: 'sess-1', qr_token: 'qr_t1_demo', qr_url: 'http://localhost:3000/dining/qr/qr_t1_demo' },
              { id: 'tbl-2', table_number: 'T2', name: 'Courtyard Table', capacity: 2, status: 'AVAILABLE', qr_token: 'qr_t2_demo', qr_url: 'http://localhost:3000/dining/qr/qr_t2_demo' },
              { id: 'tbl-3', table_number: 'T3', name: 'Main Hall', capacity: 6, status: 'BILL_REQUESTED', current_session_id: 'sess-2', qr_token: 'qr_t3_demo', qr_url: 'http://localhost:3000/dining/qr/qr_t3_demo' },
              { id: 'tbl-4', table_number: 'T4', name: 'Family Corner', capacity: 8, status: 'CLEANING', qr_token: 'qr_t4_demo', qr_url: 'http://localhost:3000/dining/qr/qr_t4_demo' },
            ],
          };
        } else if (url.includes('/rms/kds/tickets')) {
          data = {
            success: true,
            tickets: [
              {
                id: 'kds-1',
                ticket_number: 'KDS-001',
                order_id: 'ord-rest-901',
                order_number: 'ORD-REST-901',
                order_channel: 'DINE_IN',
                table_number: 'T1',
                status: 'PREPARING',
                prep_time_minutes: 20,
                created_at: new Date(Date.now() - 10 * 60000).toISOString(),
                items: [
                  { product_name: 'Butter Chicken (Half)', quantity: 1, modifiers: ['Spicy'] },
                  { product_name: 'Garlic Butter Naan', quantity: 2 },
                ],
              },
              {
                id: 'kds-2',
                ticket_number: 'KDS-002',
                order_id: 'ord-rest-902',
                order_number: 'ORD-REST-902',
                order_channel: 'TAKEAWAY',
                status: 'NEW',
                prep_time_minutes: 15,
                created_at: new Date(Date.now() - 5 * 60000).toISOString(),
                items: [
                  { product_name: 'Paneer Tikka Angara', quantity: 1, notes: 'Extra mint chutney' },
                  { product_name: 'Tandoori Butter Roti', quantity: 3 },
                ],
              },
            ],
          };
        } else if (url.includes('/rms/settings')) {
          data = {
            success: true,
            settings: {
              dine_in_enabled: true,
              takeaway_enabled: true,
              delivery_enabled: true,
              tax_rate_percent: 5.0,
              service_charge_percent: 5.0,
              packaging_fee: 15.0,
              prep_time_minutes: 25,
              currency: 'INR',
            },
          };
        } else if (url.includes('/rms/reports/sales')) {
          data = {
            success: true,
            report: {
              summary: {
                total_orders: 14,
                gross_sales: 6840,
                net_sales: 6220,
                total_tax: 311,
                total_service_charge: 309,
                total_packaging_fee: 45,
                average_order_value: 488.57,
              },
              by_channel: {
                DINE_IN: { orders_count: 6, total_amount: 3240 },
                TAKEAWAY: { orders_count: 3, total_amount: 1150 },
                DELIVERY: { orders_count: 5, total_amount: 2450 },
              },
              payments_by_method: {
                CASH: 2200,
                UPI: 3100,
                CARD: 1540,
              },
            },
          };
        } else if (url.includes('/rms/staff')) {
          data = {
            success: true,
            staff: [
              { id: 'st-1', name: 'Rajesh Sharma', phone: '+91 98765 43210', role: 'OWNER', is_active: true, created_at: new Date().toISOString() },
              { id: 'st-2', name: 'Pooja Verma', phone: '+91 98765 43211', role: 'MANAGER', is_active: true, created_at: new Date().toISOString() },
              { id: 'st-3', name: 'Amit Pradhan', phone: '+91 98765 43212', role: 'CASHIER', is_active: true, created_at: new Date().toISOString() },
              { id: 'st-4', name: 'Sunil Jena', phone: '+91 98765 43213', role: 'KITCHEN_STAFF', is_active: true, created_at: new Date().toISOString() },
            ],
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
  product_name_snapshot?: string;
  quantity?: number;
  unit_snapshot?: string;
  unit_price_snapshot?: number;
  line_total?: number;
  fulfilled_quantity?: number;
  packed_confirmed_quantity?: number;
  is_partially_fulfilled?: boolean;
}

export interface MerchantOrder {
  id: string;
  order_number: string;
  service_type: 'FOOD' | 'GROCERY' | string;
  order_channel?: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  table_id?: string;
  table_session_id?: string;
  order_state: string;
  total_amount: number;
  currency?: string;
  created_at: string;
  updated_at?: string;
  checkout_id?: string | null;
  metadata?: {
    deliveryAddress?: string;
    deliveryInstructions?: string;
    customerName?: string;
    pickupTime?: string;
    tableNumber?: string;
  };
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
}

export interface RestaurantTable {
  id: string;
  restaurant_id: string;
  table_number: string;
  name?: string;
  capacity: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'ORDERING' | 'BILL_REQUESTED' | 'CLEANING';
  current_session_id?: string;
  qr_token?: string;
  qr_url?: string;
}

export interface TableSession {
  id: string;
  table_id: string;
  restaurant_id: string;
  guest_count: number;
  status: 'ACTIVE' | 'BILL_REQUESTED' | 'CLOSED' | 'CANCELLED';
  opened_at: string;
  closed_at?: string;
}

export interface SessionBill {
  id?: string;
  session_id: string;
  subtotal: number;
  tax_amount: number;
  service_charge_amount: number;
  packaging_fee_amount: number;
  discount_amount: number;
  total_amount: number;
  paid_amount: number;
  balance_amount: number;
  payment_status: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  lines?: { name: string; quantity: number; price: number; total: number }[];
  splits?: { split_index: number; amount: number; is_paid: boolean; payment_method?: string }[];
  payments?: { amount: number; payment_method: string; recorded_at: string; transaction_ref?: string }[];
}

export interface KdsTicket {
  id: string;
  ticket_number: string;
  order_id: string;
  order_number: string;
  restaurant_id: string;
  order_channel: 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
  table_id?: string;
  table_number?: string;
  status: 'NEW' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
  prep_time_minutes: number;
  created_at: string;
  items: { product_name: string; quantity: number; modifiers?: string[]; notes?: string }[];
}

export interface RestaurantStaff {
  id: string;
  restaurant_id: string;
  user_id: string;
  name: string;
  phone?: string;
  role: 'OWNER' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN_STAFF' | 'INVENTORY_STAFF';
  permissions?: string[];
  is_active: boolean;
  created_at: string;
}

export interface RmsSettings {
  dine_in_enabled: boolean;
  takeaway_enabled: boolean;
  delivery_enabled: boolean;
  tax_rate_percent: number;
  service_charge_percent: number;
  packaging_fee: number;
  prep_time_minutes: number;
  currency: string;
  upi_id?: string | null;
  upiId?: string | null;
  upi_qr_url?: string | null;
  upiQrUrl?: string | null;
  upi_merchant_name?: string | null;
  upiMerchantName?: string | null;
  gstin?: string | null;
}

export interface Receipt {
  receiptNumber: string;
  billId: string;
  invoiceNumber: string;
  tableNumber: string;
  orderChannel: string;
  merchantDetails: {
    name: string;
    address: string;
    phone: string;
    gstin?: string | null;
  };
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
  subtotal: number;
  taxAmount: number;
  serviceCharge: number;
  packagingFee: number;
  discountAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  isFullyPaid: boolean;
  paymentStatus: string;
  statusText: string;
  paymentInstructions?: {
    upiId?: string | null;
    upiQrUrl?: string | null;
    instruction?: string | null;
  } | null;
  payments: Array<{
    id: string;
    amount: number;
    method: string;
    reference?: string | null;
    changeDue?: number;
    recordedBy?: string;
    timestamp: string;
  }>;
  issuedAt: string;
}

export interface SalesReport {
  summary: {
    total_orders: number;
    total_bills?: number;
    gross_sales: number;
    net_sales: number;
    total_tax: number;
    total_service_charge: number;
    total_packaging_fee: number;
    average_order_value: number;
    total_recorded_collections?: number;
    total_outstanding_balance?: number;
  };
  by_channel: {
    DINE_IN: { orders_count: number; total_amount: number };
    TAKEAWAY: { orders_count: number; total_amount: number };
    DELIVERY: { orders_count: number; total_amount: number };
  };
  payment_methods?: Record<string, { count: number; recordedAmount: number }>;
  payments_by_method: Record<string, number>;
  disclaimer?: string;
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
  catalog: () => api.get('/merchant/catalog'),
};

export const rmsApi = {
  getSettings: (merchantId: string) => api.get(`/merchant/${merchantId}/rms/settings`),
  updateSettings: (merchantId: string, data: Partial<RmsSettings>) =>
    api.put(`/merchant/${merchantId}/rms/settings`, data),

  getPaymentSettings: (merchantId: string) => api.get(`/merchant/${merchantId}/rms/settings/payments`),
  updatePaymentSettings: (merchantId: string, data: { upiId?: string | null; upiQrUrl?: string | null; upiMerchantName?: string | null; gstin?: string | null }) =>
    api.put(`/merchant/${merchantId}/rms/settings/payments`, data),
  uploadUpiQr: (merchantId: string, qrImage: string, mimeType?: string) =>
    api.post(`/merchant/${merchantId}/rms/settings/payments/upload-qr`, { qrImage, mimeType }),
  removeUpiQr: (merchantId: string) =>
    api.delete(`/merchant/${merchantId}/rms/settings/payments/qr`),

  getTables: (merchantId: string) => api.get(`/merchant/${merchantId}/rms/tables`),
  createTable: (merchantId: string, data: { table_number: string; name?: string; capacity: number }) =>
    api.post(`/merchant/${merchantId}/rms/tables`, data),
  updateTable: (merchantId: string, tableId: string, data: { name?: string; capacity?: number }) =>
    api.put(`/merchant/${merchantId}/rms/tables/${tableId}`, data),
  setTableStatus: (merchantId: string, tableId: string, status: string) =>
    api.patch(`/merchant/${merchantId}/rms/tables/${tableId}/status`, { status }),
  regenerateTableQr: (merchantId: string, tableId: string) =>
    api.post(`/merchant/${merchantId}/rms/tables/${tableId}/qr/regenerate`),

  openSession: (merchantId: string, tableId: string, data?: { guest_count?: number; notes?: string }) =>
    api.post(`/merchant/${merchantId}/rms/tables/${tableId}/session`, data || {}),
  getActiveSession: (merchantId: string, tableId: string) =>
    api.get(`/merchant/${merchantId}/rms/tables/${tableId}/session`),
  transferSession: (merchantId: string, sessionId: string, toTableId: string) =>
    api.post(`/merchant/${merchantId}/rms/sessions/${sessionId}/transfer`, { toTableId }),
  closeSession: (merchantId: string, sessionId: string) =>
    api.post(`/merchant/${merchantId}/rms/sessions/${sessionId}/close`),

  getSessionBill: (merchantId: string, sessionId: string) =>
    api.get(`/merchant/${merchantId}/rms/sessions/${sessionId}/bill`),
  generateBill: (merchantId: string, sessionId: string) =>
    api.post(`/merchant/${merchantId}/rms/sessions/${sessionId}/bill`),
  splitBill: (merchantId: string, sessionId: string, splitCount: number) =>
    api.post(`/merchant/${merchantId}/rms/sessions/${sessionId}/bill/split`, { splitCount }),
  recordBillPayment: (
    merchantId: string,
    sessionId: string,
    data: { amount: number; paymentMethod: string; transactionRef?: string }
  ) => api.post(`/merchant/${merchantId}/rms/sessions/${sessionId}/bill/pay`, data),
  getReceipt: (merchantId: string, billId: string) =>
    api.get(`/merchant/${merchantId}/rms/bills/${billId}/receipt`),
  recordRefund: (merchantId: string, sessionId: string, data: { amount: number; reason?: string; method?: string }) =>
    api.post(`/merchant/${merchantId}/rms/sessions/${sessionId}/bill/refund`, data),

  getReservations: (merchantId: string) =>
    api.get(`/merchant/${merchantId}/rms/reservations`),
  createReservation: (merchantId: string, data: any) =>
    api.post(`/merchant/${merchantId}/rms/reservations`, data),
  updateReservationStatus: (merchantId: string, reservationId: string, status: string) =>
    api.patch(`/merchant/${merchantId}/rms/reservations/${reservationId}/status`, { status }),

  getKdsTickets: (merchantId: string, status?: string) =>
    api.get(`/merchant/${merchantId}/rms/kds/tickets`, { params: status ? { status } : undefined }),
  updateKdsTicket: (merchantId: string, ticketId: string, status: string) =>
    api.patch(`/merchant/${merchantId}/rms/kds/tickets/${ticketId}/status`, { status }),

  recordTakeawayHandover: (merchantId: string, orderId: string, handoverBy?: string) =>
    api.post(`/merchant/${merchantId}/rms/orders/${orderId}/handover`, { handoverBy }),

  getStaff: (merchantId: string) => api.get(`/merchant/${merchantId}/rms/staff`),
  createStaff: (merchantId: string, data: { name: string; phone?: string; role: string; userId?: string }) =>
    api.post(`/merchant/${merchantId}/rms/staff`, data),
  deleteStaff: (merchantId: string, staffId: string) =>
    api.delete(`/merchant/${merchantId}/rms/staff/${staffId}`),

  getSalesReport: (merchantId: string, params?: { startDate?: string; endDate?: string }) =>
    api.get(`/merchant/${merchantId}/rms/reports/sales`, { params }),
};
