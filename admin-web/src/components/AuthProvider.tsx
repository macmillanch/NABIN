/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi } from '@/lib/api';
import { useRouter, usePathname } from 'next/navigation';

interface AuthContextType {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user: Record<string, any> | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [user, setUser] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const checkAuth = useCallback(async () => {
    try {
      const token = localStorage.getItem('nabin_admin_token');
      if (!token) throw new Error('No token');
      
      const res = await authApi.me();
      if (res.data.success) {
        setUser(res.data.admin);
      } else {
        throw new Error('Auth failed');
      }
    } catch {
      setUser(null);
      localStorage.removeItem('nabin_admin_token');
      if (pathname !== '/login') {
        router.push('/login');
      }
    } finally {
      setLoading(false);
    }
  }, [pathname, router]);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = async (username: string, password: string) => {
    const res = await authApi.login(username, password);
    if (res.data.success) {
      localStorage.setItem('nabin_admin_token', res.data.token);
      setUser(res.data.admin);
      router.push('/');
    } else {
      throw new Error(res.data.error || 'Login failed');
    }
  };

  const logout = () => {
    authApi.logout();
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
