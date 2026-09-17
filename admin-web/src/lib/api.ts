import axios from 'axios';

// Create a configured axios instance
export const api = axios.create({
  baseURL: 'http://localhost:3000/api', // Backend running locally
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
  login: (password: string) => api.post('/admin/login', { password }),
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
  pauseService: (service: string, reason: string) => api.post('/admin/services/pause', { service, reason }),
  resumeService: (service: string) => api.post('/admin/services/resume', { service }),
  getDrivers: () => api.get('/admin/drivers'),
  updateDriverStatus: (id: string, status: string) => api.post(`/admin/drivers/${id}/status`, { status }),
  getRestaurants: () => api.get('/admin/restaurants'),
  updateRestaurantStatus: (id: string, status: string) => api.post(`/admin/restaurants/${id}/status`, { status }),
  getJobs: () => api.get('/admin/jobs'),
};
