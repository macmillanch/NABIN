"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  authApi,
  merchantApi,
  TOKEN_KEY,
  type MerchantProfile,
  type RegisterMerchantPayload,
} from '@/lib/api';

export type BusinessContext = 'ALL' | 'RESTAURANT' | 'GROCERY';

interface MerchantAuthValue {
  merchant: MerchantProfile | null;
  merchantType: 'RESTAURANT' | 'GROCERY' | 'HYBRID_BOTH' | string | null;
  services: string[];
  isHybrid: boolean;
  hasRestaurant: boolean;
  hasGrocery: boolean;
  activeContext: BusinessContext;
  setActiveContext: (ctx: BusinessContext) => void;
  loading: boolean;
  error: string;
  devCode: string;
  sendOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, otp: string) => Promise<void>;
  registerMerchant: (payload: RegisterMerchantPayload) => Promise<void>;
  logout: () => void;
}

const MerchantAuthContext = createContext<MerchantAuthValue | undefined>(undefined);

export function MerchantAuthProvider({ children }: { children: React.ReactNode }) {
  const [merchant, setMerchant] = useState<MerchantProfile | null>(null);
  const [merchantType, setMerchantType] = useState<string | null>(null);
  const [services, setServices] = useState<string[]>([]);
  const [activeContext, setActiveContextState] = useState<BusinessContext>('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [devCode, setDevCode] = useState('');
  const router = useRouter();

  const resolveServices = useCallback(async () => {
    try {
      const res = await merchantApi.services();
      if (res.data.success) {
        const srvs: string[] = res.data.services ?? [];
        const mType: string = res.data.merchantType ?? 'RESTAURANT';
        setServices(srvs);
        setMerchantType(mType);

        // Determine initial business context
        const isFood = srvs.includes('RESTAURANT');
        const isGroc = srvs.includes('INSTAMART') || srvs.includes('GROCERY');

        const savedCtx = window.localStorage.getItem('nabin_merchant_active_context') as BusinessContext;
        if (isFood && isGroc) {
          if (savedCtx && ['ALL', 'RESTAURANT', 'GROCERY'].includes(savedCtx)) {
            setActiveContextState(savedCtx);
          } else {
            setActiveContextState('ALL');
          }
        } else if (isFood) {
          setActiveContextState('RESTAURANT');
        } else if (isGroc) {
          setActiveContextState('GROCERY');
        }
      }
    } catch {
      // If services read fails, derive from merchant.merchant_type if available
    }
  }, []);

  const setActiveContext = useCallback((ctx: BusinessContext) => {
    setActiveContextState(ctx);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('nabin_merchant_active_context', ctx);
    }
  }, []);

  useEffect(() => {
    const restore = async () => {
      const token =
        window.localStorage.getItem(TOKEN_KEY) ||
        window.localStorage.getItem('nabin_restaurant_merchant_token') ||
        window.localStorage.getItem('nabin_grocery_merchant_token');

      console.log('RESTORE_TRACE_TOKEN:', token);

const DEMO_MERCHANT_PROFILE: MerchantProfile = {
  id: 'demo-merchant-preview-01',
  name: 'Zonun Deli & Bakery (Demo Partner)',
  business_name: 'Zonun Deli & Bakery (Demo Partner)',
  email: 'demo.partner@nabin.local',
  phone: '+91 98765 43210',
  is_open: true,
  prep_time: 25,
  service_radius: 5,
  auto_accept: false,
};

      if (!token) {
        setLoading(false);
        return;
      }

      if (token.startsWith('demo-')) {
        const savedCtx = (window.localStorage.getItem('nabin_merchant_active_context') as BusinessContext) || 'ALL';
        if (token.includes('restaurant')) {
          setMerchant({
            ...DEMO_MERCHANT_PROFILE,
            id: 'demo-rest-merchant-01',
            name: 'Tandoori Nights (Restaurant Partner)',
            business_name: 'Tandoori Nights',
            merchant_type: 'RESTAURANT',
          });
          setServices(['RESTAURANT']);
          setMerchantType('RESTAURANT');
          setActiveContextState('RESTAURANT');
        } else if (token.includes('grocery')) {
          setMerchant({
            ...DEMO_MERCHANT_PROFILE,
            id: 'demo-groc-merchant-01',
            name: 'Fresh Harvest Mart (Grocery Partner)',
            business_name: 'Fresh Harvest Mart',
            merchant_type: 'GROCERY',
          });
          setServices(['GROCERY']);
          setMerchantType('GROCERY');
          setActiveContextState('GROCERY');
        } else {
          setMerchant({
            ...DEMO_MERCHANT_PROFILE,
            id: 'demo-hybrid-merchant-01',
            name: 'Zonun Deli & Grocery (Hybrid Partner)',
            business_name: 'Zonun Deli & Grocery',
            merchant_type: 'HYBRID_BOTH',
          });
          setServices(['RESTAURANT', 'GROCERY']);
          setMerchantType('HYBRID_BOTH');
          if (['ALL', 'RESTAURANT', 'GROCERY'].includes(savedCtx)) {
            setActiveContextState(savedCtx);
          } else {
            setActiveContextState('ALL');
          }
        }
        setLoading(false);
        return;
      }

      try {
        const res = await authApi.me();
        if (res.data.success && res.data.role === 'MERCHANT') {
          setMerchant(res.data.user);
          await resolveServices();
        } else {
          window.localStorage.removeItem(TOKEN_KEY);
        }
      } catch {
        window.localStorage.removeItem(TOKEN_KEY);
      } finally {
        setLoading(false);
      }
    };
    restore();
  }, [resolveServices]);

  const sendOtp = useCallback(async (phone: string) => {
    setError('');
    setDevCode('');
    try {
      const res = await authApi.sendOtp(phone);
      setDevCode(res.data?.testOtp ?? '');
    } catch (err) {
      setError(messageOf(err, 'Could not send the verification code.'));
      throw err;
    }
  }, []);

  const verifyOtp = useCallback(
    async (phone: string, otp: string) => {
      setError('');
      try {
        const res = await authApi.verifyOtp(phone, otp);
        if (!res.data.success || res.data.role !== 'MERCHANT') {
          throw new Error('These credentials do not belong to a registered NABIN merchant.');
        }
        window.localStorage.setItem(TOKEN_KEY, res.data.token);
        // Also sync legacy keys so if user opens legacy console URLs, they stay signed in
        window.localStorage.setItem('nabin_restaurant_merchant_token', res.data.token);
        window.localStorage.setItem('nabin_grocery_merchant_token', res.data.token);

        setMerchant(res.data.user);
        await resolveServices();
        router.push('/');
      } catch (err) {
        const text = messageOf(err, 'Verification failed.');
        setError(text);
        throw new Error(text);
      }
    },
    [router, resolveServices],
  );

  const registerMerchant = useCallback(
    async (payload: RegisterMerchantPayload) => {
      setError('');
      try {
        const res = await authApi.register(payload);
        if (!res.data.success) {
          throw new Error(res.data.error || 'Registration failed.');
        }
        // Direct to login with phone prefilled or auto-send OTP
      } catch (err) {
        const text = messageOf(err, 'Could not register merchant account.');
        setError(text);
        throw new Error(text);
      }
    },
    [],
  );

  const logout = useCallback(() => {
    authApi.logout().catch(() => undefined);
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem('nabin_restaurant_merchant_token');
    window.localStorage.removeItem('nabin_grocery_merchant_token');
    window.localStorage.removeItem('nabin_merchant_active_context');
    setMerchant(null);
    setServices([]);
    setMerchantType(null);
    router.push('/login');
  }, [router]);

  const isHybrid =
    merchantType === 'HYBRID_BOTH' ||
    services.length > 1 ||
    (services.includes('RESTAURANT') && (services.includes('INSTAMART') || services.includes('GROCERY')));

  const hasRestaurant =
    services.includes('RESTAURANT') ||
    merchantType === 'RESTAURANT' ||
    merchantType === 'HYBRID_BOTH';

  const hasGrocery =
    services.includes('INSTAMART') ||
    services.includes('GROCERY') ||
    merchantType === 'GROCERY' ||
    merchantType === 'HYBRID_BOTH';

  return (
    <MerchantAuthContext.Provider
      value={{
        merchant,
        merchantType,
        services,
        isHybrid,
        hasRestaurant,
        hasGrocery,
        activeContext,
        setActiveContext,
        loading,
        error,
        devCode,
        sendOtp,
        verifyOtp,
        registerMerchant,
        logout,
      }}
    >
      {children}
    </MerchantAuthContext.Provider>
  );
}

export function messageOf(err: unknown, fallback: string): string {
  const body = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
  return body?.error || body?.message || (err instanceof Error ? err.message : '') || fallback;
}

export function useMerchant() {
  const context = useContext(MerchantAuthContext);
  if (!context) throw new Error('useMerchant must be used within MerchantAuthProvider');
  return context;
}
