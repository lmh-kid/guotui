'use client';

import { SESSION_TOKEN_KEY } from './auth-provider';

export async function apiRequest<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);

  if (!token) {
    window.location.href = '/login';
    throw new Error('未登录');
  }

  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options?.headers || {}),
      'Content-Type': 'application/json',
      'x-session': token,
    },
  });

  if (response.status === 401) {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    window.location.href = '/login';
    throw new Error('登录已过期');
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || '请求失败');
  }

  return data as T;
}
