import axios from 'axios';

const fallbackBaseUrl =
  process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:4000/api';

// Create a configured axios instance
export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || fallbackBaseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor to inject the auth token and provide safe offline demo responses
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('nabin_admin_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    if (token?.startsWith('demo-')) {
      config.adapter = async (cfg) => {
        const url = cfg.url || '';
        let data: Record<string, unknown> = { success: true };
        if (cfg.method && cfg.method.toLowerCase() !== 'get') {
          data = { success: true, message: 'Demo Preview: Action simulated safely in memory (no backend mutation).' };
        } else if (url.includes('/admin/security/sessions')) {
          data = {
            success: true,
            sessions: [
              { sessionId: 'sess-8491a3f0192b4c81', role: 'SUPER_ADMIN', adminId: 'adm-101', adminName: 'superadmin', createdAt: '2026-10-09T18:00:00Z', expiresAt: '2026-10-10T18:00:00Z', expired: false, inAdminMap: true },
              { sessionId: 'sess-9102c7e1082a3d72', role: 'OPERATIONS', adminId: 'adm-102', adminName: 'ops_lead', createdAt: '2026-10-09T14:30:00Z', expiresAt: '2026-10-10T14:30:00Z', expired: false, inAdminMap: true },
            ],
            scope: 'GLOBAL',
            note: 'Active administrator sessions (Demo Preview)',
          };
        } else if (url.includes('/admin/security/login-lockouts')) {
          data = {
            success: true,
            counters: [
              { username: 'operator_temp', failedAttempts: 3, lockedUntil: '2026-10-09T20:15:00Z', locked: true, lockedForMinutes: 15 },
            ],
            scope: 'LOCAL_MEMORY',
            resetOnRestart: false,
            durableColumnsInSchema: true,
          };
        } else if (url.includes('/admin/accounts')) {
          data = {
            success: true,
            accounts: [
              { id: 'adm-101', username: 'superadmin', name: 'Super Administrator', role: 'SUPER_ADMIN', email: 'admin@nabin.in', phone: '+919876543210', department: 'Executive', status: 'ACTIVE', permissions: ['*'], createdAt: '2026-09-01T00:00:00Z' },
              { id: 'adm-102', username: 'ops_lead', name: 'Operations Lead', role: 'OPERATIONS', email: 'ops@nabin.in', phone: '+919876543211', department: 'Operations', status: 'ACTIVE', permissions: ['operations.manage', 'kyc.verify'], createdAt: '2026-09-15T00:00:00Z' },
            ],
          };
        } else if (url.includes('/admin/customers')) {
          data = {
            success: true,
            customers: [
              { id: 'cust-1001', name: 'Rohan Sharma', phone: '+91 98765 43210', email: 'rohan.sharma@example.com', accountStatus: 'ACTIVE', identityStatus: 'VERIFIED', rating: 4.9, createdAt: '2026-09-10T10:00:00Z', updatedAt: '2026-10-08T12:00:00Z' },
              { id: 'cust-1002', name: 'Priya Patel', phone: '+91 98123 45678', email: 'priya.patel@example.com', accountStatus: 'ACTIVE', identityStatus: 'VERIFIED', rating: 4.8, createdAt: '2026-09-12T11:20:00Z', updatedAt: '2026-10-09T08:30:00Z' },
              { id: 'cust-1003', name: 'Amit Verma', phone: '+91 98234 56789', email: 'amit.verma@example.com', accountStatus: 'ACTIVE', identityStatus: 'PENDING', rating: 4.7, createdAt: '2026-09-20T14:15:00Z', updatedAt: '2026-10-07T16:45:00Z' },
              { id: 'cust-1004', name: 'Sneha Rao', phone: '+91 98345 67890', email: 'sneha.rao@example.com', accountStatus: 'SUSPENDED', identityStatus: 'VERIFIED', rating: 3.5, createdAt: '2026-09-25T09:10:00Z', updatedAt: '2026-10-06T11:00:00Z' },
            ],
            total: 4,
            dataSource: 'DATABASE_DIRECT',
            degraded: false,
          };
        } else if (url.includes('/admin/drivers')) {
          data = {
            success: true,
            drivers: [
              { id: 'drv-2001', name: 'Vikram Singh', phone: '+91 98456 78901', status: 'ACTIVE', categoryName: 'Auto', vehicle: 'Bajaj RE Auto (OD-02-X-1234)', rating: 4.9, operationalStatus: 'ONLINE', isOnline: true, todayTrips: 14, todayEarnings: 1850 },
              { id: 'drv-2002', name: 'Sunil Kumar', phone: '+91 98567 89012', status: 'ACTIVE', categoryName: 'Bike', vehicle: 'Honda Activa (OD-02-Y-5678)', rating: 4.8, operationalStatus: 'ONLINE', isOnline: true, todayTrips: 18, todayEarnings: 1420 },
              { id: 'drv-2003', name: 'Rajesh Patil', phone: '+91 98678 90123', status: 'OFFLINE', categoryName: 'Taxi', vehicle: 'Maruti Dzire (OD-02-Z-9012)', rating: 4.7, operationalStatus: 'OFFLINE', isOnline: false, todayTrips: 6, todayEarnings: 980 },
            ],
            total: 3,
          };
        } else if (url.includes('/admin/restaurants')) {
          data = {
            success: true,
            restaurants: [
              { id: 'rest-3001', name: 'Tandoori Nights', address: 'Plot 42, Saheed Nagar, Bhubaneswar', phone: '+91 98111 22334', rating: 4.8, isOpen: true, operationalStatus: 'OPEN', cuisines: ['North Indian', 'Mughlai'], payableBalance: 14250, commissionRate: 0.18 },
              { id: 'rest-3002', name: 'Pizza Bellissima', address: 'Shop 12, Janpath, Bhubaneswar', phone: '+91 98222 33445', rating: 4.6, isOpen: true, operationalStatus: 'OPEN', cuisines: ['Italian', 'Continental'], payableBalance: 9800, commissionRate: 0.20 },
              { id: 'rest-3003', name: 'Dosa Plaza', address: 'Unit 4 Market, Bhubaneswar', phone: '+91 98333 44556', rating: 4.9, isOpen: false, operationalStatus: 'CLOSED', cuisines: ['South Indian'], payableBalance: 6400, commissionRate: 0.15 },
            ],
            total: 3,
          };
        } else if (url.includes('/admin/jobs')) {
          data = {
            success: true,
            jobs: [
              { id: 'JOB-9821', type: 'RIDE', status: 'ASSIGNED', customerName: 'Rohan Sharma', vehicleType: 'Auto', fare: 145, platformFee: 26, createdAt: '2026-10-09T18:15:00Z', pickup: { address: 'Khandagiri Square' }, drop: { address: 'Master Canteen' } },
              { id: 'JOB-9822', type: 'FOOD', status: 'PREPARING', customerName: 'Priya Patel', vehicleType: 'Bike', fare: 420, platformFee: 84, createdAt: '2026-10-09T18:22:00Z', pickup: { address: 'Tandoori Nights, Saheed Nagar' }, drop: { address: 'Nayapalli, IRC Village' } },
              { id: 'JOB-9823', type: 'GROCERY', status: 'PACKING', customerName: 'Amit Verma', vehicleType: 'Bike', fare: 890, platformFee: 178, createdAt: '2026-10-09T18:30:00Z', pickup: { address: 'Fresh Daily Market, Unit 1' }, drop: { address: 'Patia, KIIT Road' } },
              { id: 'JOB-9824', type: 'PARCEL', status: 'DELIVERED', customerName: 'Sneha Rao', vehicleType: 'Bike', fare: 95, platformFee: 19, createdAt: '2026-10-09T17:45:00Z', pickup: { address: 'Chandrasekharpur' }, drop: { address: 'Baramunda' } },
            ],
            total: 4,
          };
        } else if (url.includes('/admin/campaigns')) {
          data = {
            success: true,
            campaigns: [
              { id: 'camp-101', code: 'DIWALI2026', name: 'Diwali Festive Savings 2026', description: '20% off up to ₹150 across Food & Grocery deliveries', status: 'ACTIVE', effectiveStatus: 'ACTIVE', priority: 10, serviceTypes: ['FOOD', 'GROCERY'], startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-11-15T23:59:59Z', isActive: true, createdAt: '2026-09-28T10:00:00Z', theme: { palette: { brand: '#1A3BA2' } }, assets: [], offers: [], messages: [] },
              { id: 'camp-102', code: 'FIRST50', name: 'First Ride Welcome Discount', description: 'Flat ₹50 off for first-time mobility customers', status: 'ACTIVE', effectiveStatus: 'ACTIVE', priority: 5, serviceTypes: ['RIDE'], startsAt: '2026-09-01T00:00:00Z', endsAt: '2026-12-31T23:59:59Z', isActive: true, createdAt: '2026-08-30T10:00:00Z', theme: { palette: { brand: '#1A3BA2' } }, assets: [], offers: [], messages: [] },
            ],
          };
        } else if (url.includes('/admin/metrics')) {
          data = {
            success: true,
            metrics: {
              activeCustomers: 1428,
              activeDrivers: 94,
              activeMerchants: 58,
              activeJobs: 23,
            },
          };
        } else if (url.includes('/admin/services')) {
          data = {
            success: true,
            services: [
              { id: 'rides', name: 'NABIN Rides', status: 'ACTIVE' },
              { id: 'food', name: 'NABIN Food', status: 'ACTIVE' },
              { id: 'grocery', name: 'NABIN Grocery', status: 'ACTIVE' },
              { id: 'parcel', name: 'NABIN Parcel', status: 'ACTIVE' },
            ],
          };
        } else if (url.includes('/admin/promotions')) {
          data = {
            success: true,
            promotions: [
              { id: 'prom-1', code: 'DIWALI2026', name: 'Diwali Festive Savings', serviceType: 'FOOD', discountType: 'PERCENTAGE', discountValue: 20, isActive: true },
              { id: 'prom-2', code: 'FIRST50', name: 'First Ride Welcome', serviceType: 'RIDE', discountType: 'FIXED', discountValue: 50, isActive: true },
            ],
          };
        }
        return { data, status: 200, statusText: 'OK', headers: {}, config: cfg } as any;
      };
    }
  }
  return config;
});

// Auth API Wrapper
export const authApi = {
  login: (username: string, password: string) => api.post('/admin/login', { username, password }),
  me: () => api.get('/admin/me'),
  logout: () => {
    localStorage.removeItem('nabin_admin_token');
    window.location.href = '/';
  }
};

// Admin Services API Wrapper
export const adminApi = {
  getMetrics: () => api.get('/admin/metrics'),
  getServiceStatus: () => api.get('/admin/services/status'),
  // The switchboard addresses a service by its id (`rides`, `parcel`, …) and says so in
  // the refusal when it is handed anything else. This used to post the display name
  // under a `service` key, which every pause and resume on the dashboard answered 400
  // from — a card that looked live because nothing had ever been paused.
  pauseService: (serviceId: string, reason: string) => api.post('/admin/services/pause', { serviceId, reason }),
  resumeService: (serviceId: string) => api.post('/admin/services/resume', { serviceId }),
  getDrivers: () => api.get('/admin/drivers'),
  updateDriverStatus: (id: string, status: string) => api.post(`/admin/drivers/${id}/status`, { status }),
  getRestaurants: () => api.get('/admin/restaurants'),
  updateRestaurantStatus: (id: string, status: string) => api.post(`/admin/restaurants/${id}/status`, { status }),
  getJobs: () => api.get('/admin/jobs'),
  getPromotions: (params?: Record<string, string>) => api.get('/admin/promotions', { params }),
  getCampaigns: (params?: Record<string, string>) => api.get('/admin/campaigns', { params }),
  getCampaign: (idOrCode: string) => api.get(`/admin/campaigns/${encodeURIComponent(idOrCode)}`),
  getLiveCampaigns: (serviceType?: string) =>
    api.get('/admin/campaigns/live', { params: serviceType ? { serviceType } : undefined }),
  createCampaign: (body: unknown) => api.post('/admin/campaigns', body),
  // A campaign edit is a conditional write: the revision the form was opened with goes
  // back as If-Match, so a second console that saved in the meantime is refused instead
  // of being quietly overwritten.
  updateCampaign: (idOrCode: string, body: unknown, revision?: string | null) =>
    api.put(`/admin/campaigns/${encodeURIComponent(idOrCode)}`, body, {
      headers: revision ? { 'If-Match': `"${revision}"` } : undefined,
    }),
  setCampaignStatus: (idOrCode: string, status: string, reason?: string) =>
    api.post(`/admin/campaigns/${encodeURIComponent(idOrCode)}/status`, { status, reason }),
  // SECURITY CENTRE (area 34). What a session row names is the SHA-256 handle the store
  // keys on, never the bearer itself, so this list is safe to render — and it is the
  // same handle the revoke call takes back.
  getAdminAccounts: () => api.get('/admin/accounts'),
  getAdminSessions: () => api.get('/admin/security/sessions'),
  getAdminLoginLockouts: () => api.get('/admin/security/login-lockouts'),
  revokeAdminSessions: (target: { sessionId?: string; adminId?: string }) =>
    api.post('/admin/security/sessions/revoke', target),
  // Only `isActive` crosses the wire. A role is never sent here, because a field that
  // names a role on a status change is a promotion button wearing a toggle.
  setAdminAccountStatus: (id: string, isActive: boolean) =>
    api.post(`/admin/accounts/${encodeURIComponent(id)}/status`, { isActive }),
  // CUSTOMER ACCOUNTS (area 4). The directory is a projected read rather than a row dump —
  // `id, name, phone, email, account_status, identity_status, rating, created_at,
  // updated_at` and nothing else, because RLS is bypassed for every backend query and this
  // route is reachable by three of the five roles. The detail read carries the live session
  // list so a confirmation can state how many devices it signs out instead of guessing.
  getCustomers: (params?: { search?: string; status?: string; limit?: number; offset?: number }) =>
    api.get('/admin/customers', { params }),
  getCustomer: (id: string) => api.get(`/admin/customers/${encodeURIComponent(id)}`),
  // `status` and `reason` are the whole body. A closing is refused server-side below five
  // characters of reason, because the audit record is the only notice the customer gets —
  // this write sends no notification — so an unexplained suspension cannot be answered
  // when the customer appeals.
  setCustomerStatus: (id: string, status: string, reason?: string) =>
    api.post(`/admin/customers/${encodeURIComponent(id)}/status`, { status, reason }),
  signOutCustomer: (id: string) => api.post(`/admin/customers/${encodeURIComponent(id)}/sign-out`),
  // COMMAND CENTER actions. Each body below was read off the route, not inferred:
  //   /admin/services/emergency-killswitch  { activate: boolean, reason?: string }
  //     `activate` must be a real boolean - the route refuses `KILLSWITCH_DIRECTION_REQUIRED`
  //     rather than guess a direction, because a dropped parameter once pulled the lockdown UP
  //     while answering 200. `false` is the recovery path, so the control is reversible.
  //   /admin/support/:id/assign   no body at all: the route assigns to `req.admin`, so sending
  //     an assignee would be an invitation to re-decide who owns a ticket from the client.
  //   /admin/support/:id/resolve  { resolutionNotes, refundAmount?, specializedData? }
  //     Only `resolutionNotes` is sent from this console. `refundAmount` is a money movement
  //     wearing a support ticket's clothing, and a dashboard field is not how it should arrive.
  emergencyKillswitch: (activate: boolean, reason: string) =>
    api.post('/admin/services/emergency-killswitch', { activate, reason }),
  getSupportTickets: (params?: Record<string, string | number>) => api.get('/admin/support', { params }),
  assignTicket: (id: string) => api.post(`/admin/support/${encodeURIComponent(id)}/assign`, {}),
  resolveTicket: (id: string, resolutionNotes: string) =>
    api.post(`/admin/support/${encodeURIComponent(id)}/resolve`, { resolutionNotes }),
  getFinanceMetrics: () => api.get('/admin/finance/metrics'),
  // A14 REFUND. This body is read off the route (`POST /admin/finance/refund`,
  // server.js:2294) rather than inferred: `paymentId` or `jobId` (the route takes
  // `paymentId || jobId` as the target), plus `amount`, `reason`, `ticketId` and
  // `idempotencyKey`, behind `authenticateAdmin` + `requirePermission('finance.refund')`.
  // `amount` is optional and is never filled in here, because the money decision belongs to
  // `refund_payment_atomic`: it computes `payments.amount - payments.refunded_amount` and
  // refunds that when no figure is declared (migration 016:115-120). "Nothing typed" therefore
  // means "what is still refundable", which is not the same claim as "the original amount"
  // once part of it has already gone back — a client default would be a second, weaker
  // version of a decision the durable row already makes correctly.
  refundPayment: (body: {
    paymentId?: string;
    jobId?: string;
    amount?: number;
    reason?: string;
    ticketId?: string;
    idempotencyKey?: string;
  }) => api.post('/admin/finance/refund', body),
  getLedger: (params?: Record<string, string | number>) => api.get('/admin/finance/ledger', { params }),
  getDoubleEntryLedger: (params?: Record<string, string | number>) =>
    api.get('/admin/finance/ledger-double-entry', { params }),
  getDriverSettlements: () => api.get('/admin/finance/settlements/drivers'),
  getKycQueue: (params?: Record<string, string | number>) => api.get('/admin/identity-verifications', { params }),
  // KYC decision. Body is exactly { decision, reason, checklist } - no other field exists on the
  // route. The server requires identity_verification.review plus the decision-specific grant, and
  // since TASK 4G an APPROVE is refused unless all three checklist values are strictly true
  // (code IDENTITY_APPROVAL_CHECKLIST_REQUIRED). The caller therefore sends the real checkbox
  // state; this client never fills the checklist in on the operator's behalf.
  reviewIdentity: (id: string, body: { decision: string; reason?: string; checklist?: Record<string, boolean> }) =>
    api.post(`/admin/identity-verifications/${encodeURIComponent(id)}/review`, body),
  getAuditLogs: (params?: Record<string, string | number>) => api.get('/admin/audit-logs', { params }),
  getPlatformSettings: () => api.get('/admin/platform-settings'),
  // Settings write. The route is `PUT /admin/platform-settings/:key` guarded by
  // authenticateAdmin + requireSuperAdmin (a role gate, not a permission key), and its body is
  // exactly { value, description?, reason? }; appConfigService.validateSettingWrite() decides
  // what is acceptable and never echoes the submitted value back. This console only ever calls
  // it for the one key it has a verified editor for - see SettingsPage.
  putPlatformSetting: (key: string, body: { value: unknown; description?: string; reason?: string }) =>
    api.put(`/admin/platform-settings/${encodeURIComponent(key)}`, body),
  getDarkStores: () => api.get('/admin/dark-stores'),
};
