'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { authApi } from '@/lib/api';
import { useRouter, usePathname } from 'next/navigation';

interface AuthContextType {
  user: any;
  loading: boolean;
  login: (password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    checkAuth();
  }, [pathname]);

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('nabin_admin_token');
      if (!token) throw new Error('No token');
      
      const res = await authApi.me();
      if (res.data.success) {
        setUser(res.data.admin);
      } else {
        throw new Error('Auth failed');
      }
    } catch (err) {
      setUser(null);
      localStorage.removeItem('nabin_admin_token');
      if (pathname !== '/login') {
        router.push('/login');
      }
    } finally {
      setLoading(false);
    }
  };

  const login = async (password: string) => {
    const res = await authApi.login(password);
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
