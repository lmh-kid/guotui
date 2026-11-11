'use client';

import { useEffect, useState, createContext, useContext, ReactNode, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export const SESSION_TOKEN_KEY = 'guotui_session_token';

export interface SessionUser {
  id: string;
  account: string;
  isAdmin: boolean;
}

interface AuthContextType {
  user: SessionUser | null;
  isLoading: boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  refreshUser: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

/** 触发全站登录态刷新（登录/登出后调用） */
export const AUTH_STATE_EVENT = 'guotui-auth-changed';

const PUBLIC_PATHS = ['/login'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  const checkAuth = useCallback(async () => {
    try {
      const token = localStorage.getItem(SESSION_TOKEN_KEY);
      if (!token) {
        setUser(null);
        return;
      }

      const res = await fetch('/api/auth/me', {
        headers: { 'x-session': token },
      });

      if (!res.ok) {
        // 会话失效，清理本地 token
        localStorage.removeItem(SESSION_TOKEN_KEY);
        setUser(null);
        return;
      }

      const data = (await res.json()) as { user: SessionUser };
      setUser(data.user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    const run = async () => {
      await checkAuth();
      if (mounted) setIsLoading(false);
    };
    run();

    // 登录/登出后由页面派发事件，同步刷新登录态
    const handleAuthChanged = () => {
      run();
    };
    window.addEventListener(AUTH_STATE_EVENT, handleAuthChanged);

    return () => {
      mounted = false;
      window.removeEventListener(AUTH_STATE_EVENT, handleAuthChanged);
    };
  }, [checkAuth]);

  useEffect(() => {
    if (isLoading) return;
    const isPublicPath = PUBLIC_PATHS.some((p) => pathname?.startsWith(p));

    if (!user && !isPublicPath) {
      router.push('/login');
    } else if (user && pathname === '/login') {
      router.push('/');
    }
  }, [user, isLoading, pathname, router]);

  return (
    <AuthContext.Provider value={{ user, isLoading, refreshUser: checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}
