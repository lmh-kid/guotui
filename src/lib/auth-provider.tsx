'use client';

import { useEffect, useState, createContext, useContext, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useSupabaseConfig } from '@/lib/supabase-config-inject';
import { getSupabaseBrowserClientWithRetry } from '@/lib/supabase-browser';
import type { User } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
});

export function useAuth() {
  return useContext(AuthContext);
}

const PUBLIC_PATHS = ['/login', '/api/supabase-config'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const { isLoading: configLoading } = useSupabaseConfig();

  useEffect(() => {
    if (configLoading) return;

    let mounted = true;

    const checkAuth = async () => {
      try {
        const supabase = await getSupabaseBrowserClientWithRetry();
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        
        if (!mounted) return;
        
        setUser(currentUser);

        // 检查是否需要跳转
        const isPublicPath = PUBLIC_PATHS.some(p => pathname?.startsWith(p));
        
        if (!currentUser && !isPublicPath) {
          router.push('/login');
        } else if (currentUser && pathname === '/login') {
          router.push('/');
        }
      } catch {
        if (!mounted) return;
        setUser(null);
        
        const isPublicPath = PUBLIC_PATHS.some(p => pathname?.startsWith(p));
        if (!isPublicPath) {
          router.push('/login');
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    checkAuth();

    // 监听认证状态变化
    let subscriptionRef: { unsubscribe: () => void } | null = null;
    getSupabaseBrowserClientWithRetry().then((supabase) => {
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (mounted) {
          setUser(session?.user || null);
        }
      });
      subscriptionRef = subscription;
    });

    return () => {
      mounted = false;
      subscriptionRef?.unsubscribe();
    };
  }, [configLoading, pathname, router]);

  return (
    <AuthContext.Provider value={{ user, isLoading: configLoading || isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}
