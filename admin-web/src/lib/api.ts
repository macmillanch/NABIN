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

// Add a request interceptor to inject the auth token
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('nabin_admin_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
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
};
