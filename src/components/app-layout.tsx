'use client';

import { ReactNode, useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-provider';
import {
  Package,
  ShoppingCart,
  Settings,
  Wallet,
  LogOut,
  User,
  Menu,
  X,
  ChevronDown,
  Loader2,
  Shield,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { apiRequest } from '@/lib/api-request';
import { getSupabaseBrowserClientWithRetry } from '@/lib/supabase-browser';

interface AppLayoutProps {
  children: ReactNode;
}

interface BalanceData {
  balance: string;
  frozen_balance: string;
}

const menuItems = [
  { href: '/', label: '订单管理', icon: Package },
  { href: '/products', label: '商品管理', icon: ShoppingCart },
  { href: '/wallet', label: '我的钱包', icon: Wallet },
];

const adminMenuItem = { href: '/admin', label: '后台管理', icon: Shield };

export default function AppLayout({ children }: AppLayoutProps) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [balance, setBalance] = useState<string>('0.00');
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!user) return;

    const fetchBalance = async () => {
      try {
        const data = await apiRequest<BalanceData>('/api/balance');
        setBalance(data.balance);
      } catch {
        // 余额加载失败不阻塞
      } finally {
        setBalanceLoading(false);
      }
    };

    const checkAdmin = async () => {
      try {
        const data = await apiRequest<{ isAdmin: boolean }>('/api/admin/check');
        setIsAdmin(data.isAdmin);
      } catch {
        // 非管理员不阻塞
      }
    };

    fetchBalance();
    checkAdmin();
  }, [user]);

  const handleLogout = async () => {
    const supabase = await getSupabaseBrowserClientWithRetry();
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <Loader2 className="animate-spin h-8 w-8 text-blue-600 mx-auto mb-4" />
          <p className="text-gray-500">加载中...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航栏 */}
      <header className="bg-blue-600 text-white shadow-sm sticky top-0 z-40">
        <div className="flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-4">
            <button
              className="lg:hidden p-2 hover:bg-blue-500 rounded-lg transition-colors"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
                <Package className="w-5 h-5" />
              </div>
              <span className="font-bold text-lg">果推</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* 余额显示 */}
            <Link
              href="/wallet"
              className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
            >
              <Wallet className="w-4 h-4" />
              <span className="text-sm font-medium">
                {balanceLoading ? (
                  <Loader2 className="w-3 h-3 inline animate-spin" />
                ) : (
                  `¥${balance}`
                )}
              </span>
            </Link>

            {/* 用户菜单 */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 hover:bg-blue-500 px-2 py-1 rounded-lg transition-colors">
                  <Avatar className="w-8 h-8 bg-blue-400">
                    <AvatarFallback>
                      <User className="w-4 h-4" />
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden sm:inline text-sm">
                    {user.email?.split('@')[0]}
                  </span>
                  <ChevronDown className="w-4 h-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="font-normal">{user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/wallet')}>
                  <Wallet className="w-4 h-4 mr-2" />
                  我的钱包
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/settings')}>
                  <Settings className="w-4 h-4 mr-2" />
                  设置
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-600">
                  <LogOut className="w-4 h-4 mr-2" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* 侧边栏 */}
        <aside
          className={`
            fixed lg:sticky lg:top-16 z-30
            w-64 h-[calc(100vh-4rem)]
            bg-white border-r border-gray-200
            transform transition-transform duration-200 ease-in-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          `}
        >
          <nav className="p-4 space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                    transition-colors
                    ${isActive
                      ? 'bg-blue-50 text-blue-600'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }
                  `}
                >
                  <Icon className="w-5 h-5" />
                  {item.label}
                </Link>
              );
            })}
            {isAdmin && (
              <Link
                href={adminMenuItem.href}
                onClick={() => setSidebarOpen(false)}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium
                  transition-colors
                  ${pathname === adminMenuItem.href
                    ? 'bg-purple-50 text-purple-600'
                    : 'text-purple-600 hover:bg-purple-50'
                  }
                `}
              >
                <Shield className="w-5 h-5" />
                {adminMenuItem.label}
              </Link>
            )}
          </nav>
        </aside>

        {/* 遮罩层 */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* 主内容区 */}
        <main className="flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
