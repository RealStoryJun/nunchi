import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, ApiError } from '../lib/api';
import { clearAllCache } from '../lib/cache';

export interface User {
  id: number;
  email: string;
  business_name: string;
  business_type: string | null;
  is_admin?: boolean;
}

interface AuthState {
  user: User | null;
  loading: boolean;
}

let _cache: AuthState = { user: null, loading: true };
const _listeners = new Set<(s: AuthState) => void>();

const setState = (next: AuthState) => {
  _cache = next;
  _listeners.forEach((l) => l(next));
};

export const refreshAuth = async () => {
  try {
    const data = await apiGet<{ user: User }>('/api/me');
    setState({ user: data.user, loading: false });
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      setState({ user: null, loading: false });
    } else {
      setState({ user: null, loading: false });
    }
  }
};

export const logout = async () => {
  await apiPost('/api/auth/logout', {});
  clearAllCache();
  setState({ user: null, loading: false });
};

export function useAuth() {
  const [state, setLocal] = useState<AuthState>(_cache);
  useEffect(() => {
    _listeners.add(setLocal);
    if (_cache.loading) refreshAuth();
    return () => {
      _listeners.delete(setLocal);
    };
  }, []);
  const login = useCallback(async (email: string, password: string) => {
    const data = await apiPost<{ user: User }>('/api/auth/login', { email, password });
    setState({ user: data.user, loading: false });
    return data.user;
  }, []);
  return { ...state, login, logout, refresh: refreshAuth };
}
