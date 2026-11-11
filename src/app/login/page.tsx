'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Package2, Eye, EyeOff } from 'lucide-react';
import { SESSION_TOKEN_KEY, AUTH_STATE_EVENT } from '@/lib/auth-provider';
import { normalizeAsciiInput } from '@/lib/account';

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    try {
      // 后端统一校验账号密码（自建认证，无邮箱协议）
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 归一化：中文输入法的全角字符（＠ ａ １ 等）会导致校验必然失败
          account: normalizeAsciiInput(account),
          password: normalizeAsciiInput(password),
        }),
      });

      const data = (await res.json()) as { token?: string; error?: string };

      if (!res.ok || !data.token) {
        setMessage({ type: 'error', text: data.error || '账号或密码错误' });
        return;
      }

      localStorage.setItem(SESSION_TOKEN_KEY, data.token);
      window.dispatchEvent(new CustomEvent(AUTH_STATE_EVENT));
      router.push('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '登录失败';
      setMessage({ type: 'error', text: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-4">
      <div className="w-full max-w-md">
        {/* Logo 和名称 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 text-white mb-4 shadow-lg">
            <Package2 className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">果推</h1>
          <p className="text-gray-500 mt-1">智能订单推单系统</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-xl">登录</CardTitle>
            <CardDescription>使用管理员分配的账号登录</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="account">账号</Label>
                <Input
                  id="account"
                  type="text"
                  autoComplete="username"
                  placeholder="请输入账号"
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">密码</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="请输入密码"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {message && (
                <div className={`text-sm ${message.type === 'error' ? 'text-red-500' : 'text-green-500'}`}>
                  {message.text}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? '登录中...' : '登录'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-gray-400 mt-6">
          如需开通账号，请联系管理员
        </p>
      </div>
    </div>
  );
}
