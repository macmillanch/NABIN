"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { authApi, TOKEN_KEY, type MerchantProfile } from '@/lib/api';

interface MerchantAuthValue {
  merchant: MerchantProfile | null;
  loading: boolean;
  error: string;
  devCode: string;
  sendOtp: (phone: string) => Promise<void>;
  verifyOtp: (phone: string, otp: string) => Promise<void>;
  logout: () => void;
}

const MerchantAuthContext = createContext<MerchantAuthValue | undefined>(undefined);

export function MerchantAuthProvider({ children }: { children: React.ReactNode }) {
  const [merchant, setMerchant] = useState<MerchantProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [devCode, setDevCode] = useState('');
  const router = useRouter();

  useEffect(() => {
    const token = window.localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then((res) => {
        if (res.data.success && res.data.role === 'MERCHANT') {
          setMerchant(res.data.user);
        } else {
          window.localStorage.removeItem(TOKEN_KEY);
        }
      })
      .catch(() => window.localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false));
  }, []);

  const sendOtp = useCallback(async (phone: string) => {
    setError('');
    setDevCode('');
    try {
      const res = await authApi.sendOtp(phone);
      // Only present while the backend runs outside production; a live server
      // delivers the code out-of-band and omits the field.
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
        setMerchant(res.data.user);
        router.push('/');
      } catch (err) {
        const text = messageOf(err, 'Verification failed.');
        setError(text);
        throw new Error(text);
      }
    },
    [router],
  );

  const logout = useCallback(() => {
    authApi.logout().catch(() => undefined);
    window.localStorage.removeItem(TOKEN_KEY);
    setMerchant(null);
    router.push('/login');
  }, [router]);

  return (
    <MerchantAuthContext.Provider value={{ merchant, loading, error, devCode, sendOtp, verifyOtp, logout }}>
      {children}
    </MerchantAuthContext.Provider>
  );
}

export function messageOf(err: unknown, fallback: string): string {
  const body = (err as { response?: { data?: { error?: string } } })?.response?.data;
  return body?.error || (err instanceof Error ? err.message : '') || fallback;
}

export function useMerchant() {
  const context = useContext(MerchantAuthContext);
  if (!context) throw new Error('useMerchant must be used within MerchantAuthProvider');
  return context;
}
