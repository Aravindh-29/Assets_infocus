import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '../types';
import { request, setToken } from '../services/api';
type AuthValue = {
  user: User | null;
  loading: boolean;
  login: (identifier: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};
const AuthContext = createContext<AuthValue>(null!);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    request('POST', '/auth/refresh')
      .then((r) => {
        setToken(r.data.accessToken);
        setUser(r.data.user);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    const expired = () => setUser(null);
    window.addEventListener('session-expired', expired);
    return () => window.removeEventListener('session-expired', expired);
  }, []);
  async function login(identifier: string, password: string, remember: boolean) {
    const r = await request('POST', '/auth/login', { identifier, password, remember });
    setToken(r.data.accessToken);
    setUser(r.data.user);
  }
  async function logout() {
    try {
      await request('POST', '/auth/logout');
    } finally {
      setToken(null);
      setUser(null);
    }
  }
  async function refreshUser() {
    const r = await request<User>('GET', '/auth/me');
    setUser(r.data);
  }
  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
