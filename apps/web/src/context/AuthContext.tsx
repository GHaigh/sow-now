import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

export interface User {
  id: string;
  email: string;
  tier: 'seed' | 'grower' | 'smallholder';
  deviceProvisioned: boolean;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (email: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Check for existing session on mount
  useEffect(() => {
    const token = localStorage.getItem('session_token');
    if (!token) { setLoading(false); return; }
    apiFetch<User>('/api/v1/me')
      .then(setUser)
      .catch(() => localStorage.removeItem('session_token'))
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string) => {
    await apiFetch('/api/v1/auth/magic-link', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    // Magic link sent — user clicks email link which sets session token
  };

  const logout = () => {
    localStorage.removeItem('session_token');
    setUser(null);
  };

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
