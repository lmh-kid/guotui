'use client';

import { getSupabaseBrowserClientWithRetry } from './supabase-browser';

export async function apiRequest<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const supabase = await getSupabaseBrowserClientWithRetry();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    window.location.href = '/login';
    throw new Error('未登录');
  }

  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options?.headers || {}),
      'Content-Type': 'application/json',
      'x-session': session.access_token,
    },
  });

  if (response.status === 401) {
    window.location.href = '/login';
    throw new Error('登录已过期');
  }

  const data = await response.json();
  
  if (!response.ok) {
    throw new Error(data.error || '请求失败');
  }

  return data as T;
}
