import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiPost, ApiError } from '../lib/api';
import { clearAllCache } from '../lib/cache';

export interface User {
  id: number;
  email: string;
  business_name: string;
  business_type: string | null;
  is_admin?: boolean;
  is_master?: boolean; // 2026-05-16 신설. admin 부여·계정 삭제 권한
  access_until?: number | null; // 2026-05-16 신설. NULL = 무제한. 만료 시 read-only.
  mfa_enabled?: boolean;
  requires_security_setup?: boolean; // 어드민 생성 계정의 첫 보안질문 설정 필요 (PR B2)
  ai_insights_enabled?: boolean; // 2026-05-18 master/admin 토글. false 면 BI AI 카드 hide + 안내
}

// 로그인 1단계 응답 - 2FA 활성이면 mfa_token 받아 2단계 진행
export type LoginResult =
  | { kind: 'ok'; user: User }
  | { kind: 'mfa'; mfa_token: string; expires_in_sec: number };

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

// master 무제한·access_until null 무제한·만료 시 read-only.
// 백엔드 게이트(worker/index.ts)가 최종 방어선. 이 함수는 UX 사전 차단용.
export const isUserReadOnly = (user: User | null): boolean => {
  if (!user) return false;
  if (user.is_master) return false;
  if (user.access_until == null) return false;
  return user.access_until < Date.now();
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
  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    const data = await apiPost<
      { user: User } | { mfa_required: true; mfa_token: string; expires_in_sec: number }
    >('/api/auth/login', { email, password });
    if ('mfa_required' in data) {
      return { kind: 'mfa', mfa_token: data.mfa_token, expires_in_sec: data.expires_in_sec };
    }
    setState({ user: data.user, loading: false });
    return { kind: 'ok', user: data.user };
  }, []);
  // 2FA 2단계 - mfa_token + code → 세션 발급
  const loginMfa = useCallback(async (mfa_token: string, code: string): Promise<User> => {
    const data = await apiPost<{ user: User }>('/api/auth/login/mfa', { mfa_token, code });
    setState({ user: data.user, loading: false });
    return data.user;
  }, []);
  return {
    ...state,
    isReadOnly: isUserReadOnly(state.user),
    login,
    loginMfa,
    logout,
    refresh: refreshAuth,
  };
}
