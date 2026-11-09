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
  Users,
  Wallet,
  ArrowUpCircle,
  ArrowDownCircle,
  Search,
  Loader2,
  Shield,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
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

  // 过滤用户
  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.id.includes(userSearch)
  );

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
      </div>
    </AppLayout>
  );
}
