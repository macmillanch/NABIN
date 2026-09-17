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
    const token = localStorage.getItem('nabin_customer_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Auth API Wrapper
export const authApi = {
  sendOtp: (phone: string) => api.post('/auth/send-otp', { phone, role: 'CUSTOMER' }),
  verifyOtp: (phone: string, otp: string) => api.post('/auth/verify-otp', { phone, otp, role: 'CUSTOMER' }),
  me: () => api.get('/auth/me'),
  logout: () => api.post('/auth/logout'),
};

// Services API Wrapper
export const servicesApi = {
  getStatus: () => api.get('/services/status'),
};

// Customer Booking API Wrappers
export const bookingApi = {
  bookRide: (data: Record<string, unknown>) => api.post('/customer/book-ride', data),
  bookFood: (data: Record<string, unknown>) => api.post('/customer/book-food', data),
  bookParcel: (data: Record<string, unknown>) => api.post('/customer/book-parcel', data),
  checkoutGrocery: (data: Record<string, unknown>) => api.post('/grocery/checkout/validate', data),
  getOrders: () => api.get('/customer/orders'),
};
