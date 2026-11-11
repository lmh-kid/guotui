'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/app-layout';
import { apiRequest } from '@/lib/api-request';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ArrowUpCircle,
  ArrowDownCircle,
  Search,
  Loader2,
  Shield,
  AlertCircle,
  RefreshCw,
  UserPlus,
  Link2,
  Store,
  CalendarDays,
  Send,
  KeyRound,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';

interface AdminUser {
  id: string;
  email: string;
  createdAt: string;
  balance: string;
  frozenBalance: string;
  totalRecharge: string;
  totalConsume: string;
  isAdmin: boolean;
}

interface Transaction {
  id: string;
  user_id: string;
  email: string;
  type: string;
  amount: string;
  balance_after: string;
  order_id: string | null;
  description: string | null;
  created_at: string;
}

interface FangguoShopRow {
  fangguoShopId: string;
  shopName: string;
  brandName: string;
  platform: string;
  autoSync: boolean;
  defaultFactory: number | null;
  assigned: boolean;
  assignedUserId: string | null;
}

interface PushRecordRow {
  user_id: string;
  email: string;
  push_date: string;
  total_count: number;
  unsettled_count: number;
  amount: number;
  unsettled_amount: number;
}

interface PushSummary {
  totalCount: number;
  unsettledCount: number;
  totalAmount: number;
  unsettledAmount: number;
}

export default function AdminPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  // 用户列表
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  // 流水记录
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txPage, setTxPage] = useState(1);
  const [txLoading, setTxLoading] = useState(false);
  const [txFilterUser, setTxFilterUser] = useState('');

  // 余额调整
  const [adjustDialog, setAdjustDialog] = useState(false);
  const [adjustUserId, setAdjustUserId] = useState('');
  const [adjustUserEmail, setAdjustUserEmail] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustDesc, setAdjustDesc] = useState('');
  const [adjustLoading, setAdjustLoading] = useState(false);

  // 创建用户
  const [createDialog, setCreateDialog] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createBalance, setCreateBalance] = useState('0');
  const [createLoading, setCreateLoading] = useState(false);

  // 平台对接（方果）
  const [fgConfig, setFgConfig] = useState<{ configured: boolean; apiKeyMasked: string | null } | null>(null);
  const [fgApiKeyInput, setFgApiKeyInput] = useState('');
  const [fgKeySaving, setFgKeySaving] = useState(false);
  const [fgShops, setFgShops] = useState<FangguoShopRow[]>([]);
  const [fgShopsLoading, setFgShopsLoading] = useState(false);

  // 推单日账单
  const [pushRecords, setPushRecords] = useState<PushRecordRow[]>([]);
  const [pushSummary, setPushSummary] = useState<PushSummary | null>(null);
  const [prLoading, setPrLoading] = useState(false);
  const [prDays, setPrDays] = useState(7);

  // 检查管理员权限
  useEffect(() => {
    const checkAdmin = async () => {
      try {
        const res = await apiRequest<{ isAdmin: boolean }>('/api/admin/check');
        if (res.isAdmin) {
          setIsAdmin(true);
        } else {
          setIsAdmin(false);
        }
      } catch {
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    };
    checkAdmin();
  }, []);

  // 加载用户列表
  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await apiRequest<{ list: AdminUser[] }>('/api/admin/users');
      setUsers(res.list || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载用户列表失败');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // 加载流水记录
  const loadTransactions = useCallback(async (page = 1, userId = '') => {
    setTxLoading(true);
    try {
      let url = `/api/admin/transactions?page=${page}&pageSize=20`;
      if (userId) url += `&userId=${userId}`;
      const res = await apiRequest<{ list: Transaction[]; total: number }>(url);
      setTransactions(res.list || []);
      setTxTotal(res.total || 0);
      setTxPage(page);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载流水记录失败');
    } finally {
      setTxLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadUsers();
      loadTransactions();
    }
  }, [isAdmin, loadUsers, loadTransactions]);

  // 打开余额调整弹窗
  const openAdjust = (user: AdminUser) => {
    setAdjustUserId(user.id);
    setAdjustUserEmail(user.email);
    setAdjustAmount('');
    setAdjustDesc('');
    setAdjustDialog(true);
  };

  // 提交余额调整
  const handleAdjust = async () => {
    const amount = parseFloat(adjustAmount);
    if (isNaN(amount) || amount === 0) {
      toast.error('请输入有效的金额（正数充值，负数扣费）');
      return;
    }

    setAdjustLoading(true);
    try {
      await apiRequest('/api/admin/adjust-balance', {
        method: 'POST',
        body: JSON.stringify({
          userId: adjustUserId,
          amount,
          description: adjustDesc || (amount > 0 ? '管理员充值' : '管理员扣费'),
        }),
      });
      toast.success(`已为 ${adjustUserEmail} ${amount > 0 ? '充值' : '扣费'} ${Math.abs(amount).toFixed(2)} 元`);
      setAdjustDialog(false);
      loadUsers();
      loadTransactions(txPage, txFilterUser);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    } finally {
      setAdjustLoading(false);
    }
  };

  // 提交创建用户
  const handleCreateUser = async () => {
    if (!createEmail.includes('@')) {
      toast.error('请输入有效的邮箱地址');
      return;
    }
    if (createPassword.length < 6) {
      toast.error('密码长度至少6位');
      return;
    }

    setCreateLoading(true);
    try {
      await apiRequest('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({
          email: createEmail,
          password: createPassword,
          initialBalance: parseFloat(createBalance) || 0,
        }),
      });
      toast.success(`用户 ${createEmail} 创建成功`);
      setCreateDialog(false);
      setCreateEmail('');
      setCreatePassword('');
      setCreateBalance('0');
      loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建用户失败');
    } finally {
      setCreateLoading(false);
    }
  };

  // 过滤用户
  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.id.includes(userSearch)
  );

  // ============ 平台对接（方果）============
  const loadFangguoConfig = useCallback(async () => {
    try {
      const res = await apiRequest<{ configured: boolean; apiKeyMasked: string | null }>(
        '/api/admin/fangguo/config'
      );
      setFgConfig({ configured: !!res.configured, apiKeyMasked: res.apiKeyMasked ?? null });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载方果配置失败');
    }
  }, []);

  const loadFangguoShops = useCallback(async () => {
    setFgShopsLoading(true);
    try {
      const res = await apiRequest<{ list: FangguoShopRow[] }>('/api/admin/fangguo/shops');
      setFgShops(res.list || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载店铺列表失败');
    } finally {
      setFgShopsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadFangguoConfig();
      loadFangguoShops();
    }
  }, [isAdmin, loadFangguoConfig, loadFangguoShops]);

  const handleSaveApiKey = async () => {
    if (!fgApiKeyInput.trim()) {
      toast.error('请输入 API KEY');
      return;
    }
    setFgKeySaving(true);
    try {
      const res = await apiRequest<{ message?: string }>('/api/admin/fangguo/config', {
        method: 'POST',
        body: JSON.stringify({ apiKey: fgApiKeyInput.trim() }),
      });
      toast.success(res.message || 'API KEY 保存成功');
      setFgApiKeyInput('');
      await loadFangguoConfig();
      await loadFangguoShops();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setFgKeySaving(false);
    }
  };

  const handleAssignShop = async (shop: FangguoShopRow, userId: string) => {
    try {
      const res = await apiRequest<{ message?: string }>('/api/admin/fangguo/assign', {
        method: 'POST',
        body: JSON.stringify({
          fangguoShopId: shop.fangguoShopId,
          shopName: shop.shopName,
          brandName: shop.brandName,
          platform: shop.platform,
          userId: userId || null,
        }),
      });
      toast.success(res.message || '操作成功');
      await loadFangguoShops();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  };

  const loadPushRecords = useCallback(async (days = 7) => {
    setPrLoading(true);
    try {
      const res = await apiRequest<{ list: PushRecordRow[]; summary: PushSummary }>(
        `/api/admin/push-records?days=${days}`
      );
      setPushRecords(res.list || []);
      setPushSummary(res.summary || null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载推单记录失败');
    } finally {
      setPrLoading(false);
    }
  }, []);

  const refreshFangguo = async () => {
    await Promise.all([loadFangguoConfig(), loadFangguoShops()]);
  };

  useEffect(() => {
    if (isAdmin) {
      loadPushRecords(7);
    }
  }, [isAdmin, loadPushRecords]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <AlertCircle className="w-12 h-12 text-red-500" />
          <p className="text-gray-600">您没有管理员权限</p>
          <Button variant="outline" onClick={() => router.push('/')}>
            返回首页
          </Button>
        </div>
      </AppLayout>
    );
  }

  const totalPages = Math.ceil(txTotal / 20);

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* 页面标题 */}
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-blue-600" />
          <h1 className="text-xl font-bold text-gray-900">后台管理</h1>
        </div>

        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users">用户管理</TabsTrigger>
            <TabsTrigger value="transactions">流水记录</TabsTrigger>
            <TabsTrigger value="push-records">推单记录</TabsTrigger>
            <TabsTrigger value="fangguo">平台对接</TabsTrigger>
          </TabsList>

          {/* 用户管理 Tab */}
          <TabsContent value="users" className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="搜索邮箱或用户ID..."
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button variant="outline" size="sm" onClick={loadUsers} disabled={usersLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${usersLoading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
              <Button size="sm" onClick={() => setCreateDialog(true)}>
                <UserPlus className="w-4 h-4 mr-2" />
                创建用户
              </Button>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">用户列表（共 {filteredUsers.length} 人）</CardTitle>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  </div>
                ) : filteredUsers.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">暂无用户</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>邮箱</TableHead>
                        <TableHead>注册时间</TableHead>
                        <TableHead className="text-right">余额</TableHead>
                        <TableHead className="text-right">累计充值</TableHead>
                        <TableHead className="text-right">累计消费</TableHead>
                        <TableHead>角色</TableHead>
                        <TableHead className="text-center">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredUsers.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className="font-medium">{u.email}</TableCell>
                          <TableCell className="text-gray-500 text-sm">
                            {new Date(u.createdAt).toLocaleDateString('zh-CN')}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            ¥{u.balance}
                          </TableCell>
                          <TableCell className="text-right text-green-600">
                            ¥{u.totalRecharge}
                          </TableCell>
                          <TableCell className="text-right text-red-600">
                            ¥{u.totalConsume}
                          </TableCell>
                          <TableCell>
                            {u.isAdmin ? (
                              <Badge className="bg-purple-100 text-purple-700">管理员</Badge>
                            ) : (
                              <Badge variant="secondary">用户</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openAdjust(u)}
                            >
                              调整余额
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 流水记录 Tab */}
          <TabsContent value="transactions" className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="输入用户邮箱过滤..."
                  value={txFilterUser}
                  onChange={(e) => setTxFilterUser(e.target.value)}
                  className="pl-9"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const target = users.find((u) => u.email === txFilterUser);
                      loadTransactions(1, target?.id || '');
                    }
                  }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const target = users.find((u) => u.email === txFilterUser);
                  loadTransactions(1, target?.id || '');
                }}
                disabled={txLoading}
              >
                <Search className="w-4 h-4 mr-2" />
                查询
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setTxFilterUser('');
                  loadTransactions(1, '');
                }}
              >
                重置
              </Button>
              <Button variant="outline" size="sm" onClick={() => loadTransactions(txPage, txFilterUser)} disabled={txLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${txLoading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">全局流水记录（共 {txTotal} 条）</CardTitle>
              </CardHeader>
              <CardContent>
                {txLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  </div>
                ) : transactions.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">暂无流水记录</p>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>用户</TableHead>
                          <TableHead>类型</TableHead>
                          <TableHead className="text-right">金额</TableHead>
                          <TableHead className="text-right">余额</TableHead>
                          <TableHead>说明</TableHead>
                          <TableHead>时间</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {transactions.map((t) => (
                          <TableRow key={t.id}>
                            <TableCell className="text-sm">{t.email}</TableCell>
                            <TableCell>
                              {t.type === 'recharge' ? (
                                <Badge className="bg-green-100 text-green-700">
                                  <ArrowUpCircle className="w-3 h-3 mr-1" />
                                  充值
                                </Badge>
                              ) : (
                                <Badge className="bg-red-100 text-red-700">
                                  <ArrowDownCircle className="w-3 h-3 mr-1" />
                                  消费
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className={`text-right font-semibold ${t.type === 'recharge' ? 'text-green-600' : 'text-red-600'}`}>
                              {t.type === 'recharge' ? '+' : '-'}¥{t.amount}
                            </TableCell>
                            <TableCell className="text-right text-gray-600">
                              ¥{t.balance_after}
                            </TableCell>
                            <TableCell className="text-sm text-gray-500 max-w-[200px] truncate">
                              {t.description || '-'}
                            </TableCell>
                            <TableCell className="text-sm text-gray-500">
                              {new Date(t.created_at).toLocaleString('zh-CN')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>

                    {/* 分页 */}
                    {totalPages > 1 && (
                      <div className="mt-4 flex justify-center">
                        <Pagination>
                          <PaginationContent>
                            <PaginationItem>
                              <PaginationPrevious
                                onClick={() => txPage > 1 && loadTransactions(txPage - 1, txFilterUser)}
                                className={txPage <= 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                              />
                            </PaginationItem>
                            <span className="text-sm text-gray-500 px-4 py-2">
                              {txPage} / {totalPages}
                            </span>
                            <PaginationItem>
                              <PaginationNext
                                onClick={() => txPage < totalPages && loadTransactions(txPage + 1, txFilterUser)}
                                className={txPage >= totalPages ? 'pointer-events-none opacity-50' : 'cursor-pointer'}
                              />
                            </PaginationItem>
                          </PaginationContent>
                        </Pagination>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 推单记录 Tab */}
          <TabsContent value="push-records" className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1 border border-gray-200 rounded-md p-1">
                <CalendarDays className="w-4 h-4 text-gray-400 ml-1.5" />
                {[7, 14, 31].map((d) => (
                  <button
                    key={d}
                    onClick={() => {
                      setPrDays(d);
                      loadPushRecords(d);
                    }}
                    className={`px-3 py-1 text-sm rounded transition-colors ${
                      prDays === d ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    近{d}天
                  </button>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => loadPushRecords(prDays)} disabled={prLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${prLoading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
              {pushSummary && (
                <div className="text-sm text-gray-500 ml-auto flex gap-6">
                  <span>
                    推单合计 <span className="font-semibold text-gray-900">{pushSummary.totalCount} 单</span>
                  </span>
                  <span>
                    金额合计 <span className="font-semibold text-gray-900">¥{pushSummary.totalAmount.toFixed(2)}</span>
                  </span>
                  <span>
                    未结算 <span className="font-semibold text-amber-600">¥{pushSummary.unsettledAmount.toFixed(2)}</span>
                    <span className="text-xs text-gray-400">（{pushSummary.unsettledCount} 单，次日自动结算）</span>
                  </span>
                </div>
              )}
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Send className="w-4 h-4 text-blue-600" />
                  推单日账单（按用户 × 日期，¥0.50/单）
                </CardTitle>
              </CardHeader>
              <CardContent>
                {prLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  </div>
                ) : pushRecords.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">近 {prDays} 天暂无推单记录</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>日期</TableHead>
                        <TableHead>用户</TableHead>
                        <TableHead className="text-right">推单数</TableHead>
                        <TableHead className="text-right">金额</TableHead>
                        <TableHead>结算状态</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pushRecords.map((r) => (
                        <TableRow key={`${r.user_id}-${r.push_date}`}>
                          <TableCell className="text-gray-700">{r.push_date}</TableCell>
                          <TableCell className="font-medium">{r.email}</TableCell>
                          <TableCell className="text-right">{r.total_count} 单</TableCell>
                          <TableCell className="text-right font-semibold">¥{r.amount.toFixed(2)}</TableCell>
                          <TableCell>
                            {r.unsettled_count > 0 ? (
                              <Badge className="bg-amber-100 text-amber-700">
                                未结算 {r.unsettled_count} 单（¥{r.unsettled_amount.toFixed(2)}）
                              </Badge>
                            ) : (
                              <Badge className="bg-green-100 text-green-700">已结算</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 平台对接 Tab */}
          <TabsContent value="fangguo" className="space-y-4">
            {/* API KEY 配置 */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-blue-600" />
                  方果平台 API KEY
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={refreshFangguo}
                  disabled={fgShopsLoading}
                >
                  <RefreshCw className={`w-4 h-4 mr-2 ${fgShopsLoading ? 'animate-spin' : ''}`} />
                  刷新
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-gray-500">当前状态：</span>
                  {fgConfig?.configured ? (
                    <Badge className="bg-green-100 text-green-700">已配置</Badge>
                  ) : (
                    <Badge className="bg-yellow-100 text-yellow-700">未配置</Badge>
                  )}
                  {fgConfig?.apiKeyMasked && (
                    <code className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                      {fgConfig.apiKeyMasked}
                    </code>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <Input
                    type="password"
                    placeholder={fgConfig?.configured ? '输入新的 API KEY 以更换' : '输入方果开放平台 API KEY'}
                    value={fgApiKeyInput}
                    onChange={(e) => setFgApiKeyInput(e.target.value)}
                    className="max-w-md"
                  />
                  <Button onClick={handleSaveApiKey} disabled={fgKeySaving}>
                    {fgKeySaving ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Link2 className="w-4 h-4 mr-2" />
                    )}
                    保存并验证
                  </Button>
                </div>
                <p className="text-xs text-gray-400">
                  保存时会先验证 KEY 有效性（调用方果店铺接口）。订单不落库：用户查询订单时实时调方果 API，按分配店铺过滤展示
                </p>
              </CardContent>
            </Card>

            {/* 店铺分配 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Store className="w-4 h-4 text-blue-600" />
                  店铺分配（{fgShops.length} 家店铺）
                </CardTitle>
              </CardHeader>
              <CardContent>
                {fgShopsLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  </div>
                ) : fgShops.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">
                    {fgConfig?.configured ? '未获取到店铺，请检查 API KEY' : '请先配置 API KEY'}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>店铺名称</TableHead>
                        <TableHead>品牌</TableHead>
                        <TableHead>平台</TableHead>
                        <TableHead>分配状态</TableHead>
                        <TableHead className="w-[240px]">分配给用户</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fgShops.map((s) => {
                        const assignedUser = users.find((u) => u.id === s.assignedUserId);
                        return (
                          <TableRow key={s.fangguoShopId}>
                            <TableCell className="font-medium">{s.shopName}</TableCell>
                            <TableCell className="text-gray-500">{s.brandName || '-'}</TableCell>
                            <TableCell className="uppercase text-gray-500">{s.platform || '-'}</TableCell>
                            <TableCell>
                              {s.assigned ? (
                                <Badge className="bg-green-100 text-green-700">已分配</Badge>
                              ) : (
                                <Badge variant="secondary">未分配</Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              {s.assigned && assignedUser ? (
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-gray-700 truncate max-w-[130px]">
                                    {assignedUser.email}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleAssignShop(s, '')}
                                  >
                                    取消分配
                                  </Button>
                                </div>
                              ) : (
                                <Select
                                  onValueChange={(v) => handleAssignShop(s, v)}
                                >
                                  <SelectTrigger className="w-full">
                                    <SelectValue placeholder="选择用户分配" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {users
                                      .filter((u) => !u.isAdmin)
                                      .map((u) => (
                                        <SelectItem key={u.id} value={u.id}>
                                          {u.email}
                                        </SelectItem>
                                      ))}
                                  </SelectContent>
                                </Select>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 余额调整弹窗 */}
        <Dialog open={adjustDialog} onOpenChange={setAdjustDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>调整余额</DialogTitle>
              <DialogDescription>
                为用户 <span className="font-semibold text-gray-900">{adjustUserEmail}</span> 调整余额
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">调整金额（正数充值，负数扣费）</label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="例如：100 或 -50"
                  value={adjustAmount}
                  onChange={(e) => setAdjustAmount(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">备注说明</label>
                <Input
                  placeholder="例如：活动赠送 / 异常扣费"
                  value={adjustDesc}
                  onChange={(e) => setAdjustDesc(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdjustDialog(false)}>
                取消
              </Button>
              <Button onClick={handleAdjust} disabled={adjustLoading}>
                {adjustLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                确认调整
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 创建用户弹窗 */}
        <Dialog open={createDialog} onOpenChange={setCreateDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>创建用户</DialogTitle>
              <DialogDescription>
                为新用户创建登录账号，创建后用户可直接登录
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">邮箱</label>
                <Input
                  type="email"
                  placeholder="用户登录邮箱"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">密码</label>
                <Input
                  type="text"
                  placeholder="登录密码（至少6位）"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">初始余额（元）</label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={createBalance}
                  onChange={(e) => setCreateBalance(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialog(false)}>
                取消
              </Button>
              <Button onClick={handleCreateUser} disabled={createLoading}>
                {createLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                创建用户
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
