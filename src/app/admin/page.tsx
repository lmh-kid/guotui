'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import AppLayout from '@/components/app-layout';
import { apiRequest } from '@/lib/api-request';
import { displayAccountName, isValidAccountName } from '@/lib/account';
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
  PlayCircle,
  CircleDollarSign,
  KeyRound,
  Trash2,
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
  platformCode: number | null;
  autoSync: boolean;
  defaultFactory: number | null;
  assigned: boolean;
  assignedUserId: string | null;
}

interface SettlementRow {
  user_id: string;
  account: string;
  date: string;
  push_count: number;
  push_fee: number;
  charge: number; // 入账扣费合计（含预扣，负数；材料费按订单取预扣/实扣较大者）
  refund: number; // 退费（正数，无条件冲抵）
  material_freight: number; // 材运费净额
  total: number; // 日结总金额（负=扣费）
  allSettled: boolean;
  lineCount: number;
}

interface SettlementSummary {
  totalAmount: number;
  totalPush: number;
  totalMaterialFreight: number;
  unsettledGroups: number;
  unassignedLines: number;
  unassignedStores: string[];
}

interface FangguoDailyRow {
  date: string;
  charge: number; // 方果侧实扣合计（负数，含未归属）
  refund: number; // 方果侧退费合计（正数，不过滤有效性）
  prehold: number; // 方果侧预扣合计（负数，推单冻结额）
  net: number; // 净额 = charge + refund + prehold
  unassignedCount: number; // 未归属流水条数
  lines: number; // 总流水条数
}

interface SettlementRunResult {
  success?: boolean;
  summary?: {
    syncedLines: number;
    newLines: number;
    unassigned: number;
    unknown: number;
    settledUsers: number;
    settledAmount: number;
    skippedUsers: number;
    errors: string[];
  };
  error?: string;
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
  const [createAccount, setCreateAccount] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createBalance, setCreateBalance] = useState('0');
  const [createLoading, setCreateLoading] = useState(false);

  // 删除用户
  const [deleteDialog, setDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // 调整用户店铺
  const [shopDialog, setShopDialog] = useState(false);
  const [shopTargetUser, setShopTargetUser] = useState<AdminUser | null>(null);
  const [shopDialogLoading, setShopDialogLoading] = useState(false);
  const [shopDialogSaving, setShopDialogSaving] = useState(false);
  const [shopSelection, setShopSelection] = useState<Record<string, boolean>>({});

  // 平台对接（方果）
  const [fgConfig, setFgConfig] = useState<{ configured: boolean; apiKeyMasked: string | null } | null>(null);
  const [fgApiKeyInput, setFgApiKeyInput] = useState('');
  const [fgKeySaving, setFgKeySaving] = useState(false);
  const [fgShops, setFgShops] = useState<FangguoShopRow[]>([]);
  const [fgShopsLoading, setFgShopsLoading] = useState(false);

  // 日结账单（材运费 + 0.5×推单数，每天 00:00 定时结算）
  const [settlementRecords, setSettlementRecords] = useState<SettlementRow[]>([]);
  const [settlementSummary, setSettlementSummary] = useState<SettlementSummary | null>(null);
  const [fangguoDaily, setFangguoDaily] = useState<FangguoDailyRow[]>([]);
  const [stLoading, setStLoading] = useState(false);
  const [stDays, setStDays] = useState(7);
  const [stRunLoading, setStRunLoading] = useState(false);

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
    setAdjustUserEmail(displayAccountName(user.email));
    setAdjustAmount('');
    setAdjustDesc('');
    setAdjustDialog(true);
  };

  // 打开调整店铺弹窗（实时拉取店铺列表与分配状态）
  const openShopDialog = async (u: AdminUser) => {
    setShopTargetUser(u);
    setShopDialog(true);
    setShopDialogLoading(true);
    try {
      const res = await apiRequest<{ list: FangguoShopRow[] }>('/api/admin/fangguo/shops');
      const list = res.list || [];
      setFgShops(list);
      const selection: Record<string, boolean> = {};
      for (const s of list) {
        selection[s.fangguoShopId] = !!s.assignedUserId && s.assignedUserId === u.id;
      }
      setShopSelection(selection);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载店铺列表失败');
      setShopDialog(false);
    } finally {
      setShopDialogLoading(false);
    }
  };

  // 保存店铺调整（仅提交有变化的店铺）
  const handleSaveShops = async () => {
    if (!shopTargetUser) return;
    setShopDialogSaving(true);
    try {
      const tasks: Promise<unknown>[] = [];
      for (const s of fgShops) {
        const wasMine = !!s.assignedUserId && s.assignedUserId === shopTargetUser.id;
        const shouldBeMine = !!shopSelection[s.fangguoShopId];
        if (wasMine === shouldBeMine) continue;
        tasks.push(
          apiRequest('/api/admin/fangguo/assign', {
            method: 'POST',
            body: JSON.stringify({
              fangguoShopId: s.fangguoShopId,
              shopName: s.shopName,
              brandName: s.brandName,
              platform: s.platform,
              platformCode: s.platformCode,
              userId: shouldBeMine ? shopTargetUser.id : null,
            }),
          })
        );
      }
      await Promise.all(tasks);
      toast.success(`已更新 ${displayAccountName(shopTargetUser.email)} 的店铺分配`);
      setShopDialog(false);
      setShopTargetUser(null);
      loadFangguoShops();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setShopDialogSaving(false);
    }
  };

  // 删除用户
  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await apiRequest('/api/admin/users', {
        method: 'DELETE',
        body: JSON.stringify({ userId: deleteTarget.id }),
      });
      toast.success(`用户 ${displayAccountName(deleteTarget.email)} 已删除`);
      setDeleteDialog(false);
      setDeleteTarget(null);
      loadUsers();
      loadFangguoShops();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    } finally {
      setDeleteLoading(false);
    }
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
    if (!isValidAccountName(createAccount)) {
      toast.error('账号格式不正确：字母开头，仅支持字母/数字/._-，2-32位');
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
          account: createAccount,
          password: createPassword,
          initialBalance: parseFloat(createBalance) || 0,
        }),
      });
      toast.success(`用户 ${createAccount} 创建成功`);
      setCreateDialog(false);
      setCreateAccount('');
      setCreatePassword('');
      setCreateBalance('0');
      loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建用户失败');
    } finally {
      setCreateLoading(false);
    }
  };

  // 过滤用户（支持按账号名或完整邮箱搜索）
  const filteredUsers = users.filter(
    (u) =>
      u.email.toLowerCase().includes(userSearch.toLowerCase()) ||
      displayAccountName(u.email).toLowerCase().includes(userSearch.toLowerCase()) ||
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

  const loadSettlementRecords = useCallback(async (days = 7) => {
    setStLoading(true);
    try {
      const res = await apiRequest<{
        list: SettlementRow[];
        summary: SettlementSummary;
        fangguoDaily?: FangguoDailyRow[];
      }>(`/api/admin/settlement/records?days=${days}`);
      setSettlementRecords(res.list || []);
      setSettlementSummary(res.summary || null);
      setFangguoDaily(res.fangguoDaily || []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载日结账单失败');
    } finally {
      setStLoading(false);
    }
  }, []);

  const runSettlementNow = async () => {
    setStRunLoading(true);
    try {
      const res = await apiRequest<SettlementRunResult>('/api/admin/settlement/run', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      if (res.summary) {
        const s = res.summary;
        const parts = [
          `同步流水 ${s.syncedLines} 条（新增 ${s.newLines}）`,
          `结算 ${s.settledUsers} 组`,
          s.settledAmount !== 0 ? `金额 ¥${s.settledAmount.toFixed(2)}` : '',
          s.skippedUsers > 0 ? `幂等跳过 ${s.skippedUsers} 组` : '',
        ].filter(Boolean);
        toast.success(`日结完成：${parts.join('，')}`);
        if (s.unassigned > 0) {
          toast.warning(`${s.unassigned} 条流水店铺未分配用户，未入账`);
        }
        if (s.errors?.length) {
          toast.error(`部分错误：${s.errors[0]}`);
        }
      }
      await loadSettlementRecords(stDays);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '日结执行失败');
    } finally {
      setStRunLoading(false);
    }
  };

  const refreshFangguo = async () => {
    await Promise.all([loadFangguoConfig(), loadFangguoShops()]);
  };

  useEffect(() => {
    if (isAdmin) {
      loadSettlementRecords(7);
    }
  }, [isAdmin, loadSettlementRecords]);

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
            <TabsTrigger value="settlement">日结账单</TabsTrigger>
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
                          <TableCell className="font-medium">{displayAccountName(u.email)}</TableCell>
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
                            <div className="flex items-center justify-center gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openAdjust(u)}
                              >
                                调整余额
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => openShopDialog(u)}
                              >
                                <Store className="w-4 h-4 mr-1" />
                                店铺
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
                                disabled={u.isAdmin}
                                title={u.isAdmin ? '不能删除管理员账号' : '删除用户'}
                                onClick={() => {
                                  setDeleteTarget(u);
                                  setDeleteDialog(true);
                                }}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* 方果每日对账 */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CircleDollarSign className="w-4 h-4 text-blue-600" />
                  方果每日对账（全部流水按账期，与方果后台账单核对）
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stLoading ? (
                  <div className="flex items-center justify-center h-24">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  </div>
                ) : fangguoDaily.length === 0 ? (
                  <p className="text-center text-gray-500 py-6">近 {stDays} 天暂无方果流水</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>账期</TableHead>
                        <TableHead className="text-right">实扣合计</TableHead>
                        <TableHead className="text-right">预扣合计</TableHead>
                        <TableHead className="text-right">退费合计</TableHead>
                        <TableHead className="text-right">净额</TableHead>
                        <TableHead className="text-right">未归属条数</TableHead>
                        <TableHead className="text-right">流水总数</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fangguoDaily.map((d) => (
                        <TableRow key={d.date}>
                          <TableCell className="text-gray-700">{d.date}</TableCell>
                          <TableCell className="text-right text-red-600">¥{d.charge.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-amber-600">
                            {d.prehold !== 0 ? `¥${d.prehold.toFixed(2)}` : '—'}
                          </TableCell>
                          <TableCell className="text-right text-green-600">
                            {d.refund !== 0 ? `+¥${d.refund.toFixed(2)}` : '—'}
                          </TableCell>
                          <TableCell className={`text-right font-semibold ${d.net < 0 ? 'text-red-600' : 'text-green-600'}`}>
                            ¥{d.net.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            {d.unassignedCount > 0 ? (
                              <span className="text-amber-600">{d.unassignedCount} 条</span>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="text-right text-gray-500">{d.lines}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                <p className="text-xs text-gray-400 mt-3">
                  对账口径与方果账单一致（按流水记账日分日汇总，退费含全部退费记录）。预扣为推单冻结额（即真实扣款，发货后转实扣不二次扣），按订单去重后的计费口径见上方日结账单（同一单预扣转实扣后不再重复计）。
                </p>
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
                            <TableCell className="text-sm">{displayAccountName(t.email)}</TableCell>
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

          {/* 日结账单 Tab */}
          <TabsContent value="settlement" className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1 border border-gray-200 rounded-md p-1">
                <CalendarDays className="w-4 h-4 text-gray-400 ml-1.5" />
                {[7, 14, 31].map((d) => (
                  <button
                    key={d}
                    onClick={() => {
                      setStDays(d);
                      loadSettlementRecords(d);
                    }}
                    className={`px-3 py-1 text-sm rounded transition-colors ${
                      stDays === d ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    近{d}天
                  </button>
                ))}
              </div>
              <Button variant="outline" size="sm" onClick={() => loadSettlementRecords(stDays)} disabled={stLoading}>
                <RefreshCw className={`w-4 h-4 mr-2 ${stLoading ? 'animate-spin' : ''}`} />
                刷新
              </Button>
              <Button size="sm" onClick={runSettlementNow} disabled={stRunLoading}>
                {stRunLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                立即执行日结
              </Button>
              {settlementSummary && (
                <div className="text-sm text-gray-500 ml-auto flex gap-6">
                  <span>
                    推单合计 <span className="font-semibold text-gray-900">{settlementSummary.totalPush} 单</span>
                  </span>
                  <span>
                    材运费合计 <span className="font-semibold text-gray-900">¥{settlementSummary.totalMaterialFreight.toFixed(2)}</span>
                  </span>
                  <span>
                    日结总额 <span className="font-semibold text-gray-900">¥{settlementSummary.totalAmount.toFixed(2)}</span>
                  </span>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-400">
              每天凌晨 00:00（北京时间）自动结算：用户应付 = 方果材运费（材料费 + 运费，材料费含推单预扣——预扣即真实扣款，发货转实扣不二次扣，按订单取较大者）+ ¥0.50×当天全部推送订单数，实际扣除用户余额；退费自动冲抵。账期按方果记账日归属（滞后运费记在订单当日账上），结算后迟到到达的材运费会在下次日结时自动补扣/补退；账期满 7 天封账，之后金额不再变动，可与方果账单逐日核对。
            </p>

            {settlementSummary && settlementSummary.unassignedLines > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  {settlementSummary.unassignedLines} 条流水店铺未分配用户（未入账）：
                  <span className="font-medium">{settlementSummary.unassignedStores.join('、')}</span>
                  <span className="text-xs text-amber-600">（到「平台对接」中分配店铺后，次日日结自动补账）</span>
                </div>
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <CircleDollarSign className="w-4 h-4 text-blue-600" />
                  日结账单（按用户 × 账期，材运费 + ¥0.50/单）
                </CardTitle>
              </CardHeader>
              <CardContent>
                {stLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  </div>
                ) : settlementRecords.length === 0 ? (
                  <p className="text-center text-gray-500 py-8">近 {stDays} 天暂无日结数据</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>账期</TableHead>
                        <TableHead>用户</TableHead>
                        <TableHead className="text-right">推单数</TableHead>
                        <TableHead className="text-right">推单费</TableHead>
                        <TableHead className="text-right">材运费</TableHead>
                        <TableHead className="text-right">退费冲抵</TableHead>
                        <TableHead className="text-right">日结合计</TableHead>
                        <TableHead>结算状态</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {settlementRecords.map((r) => (
                        <TableRow key={`${r.user_id}-${r.date}`}>
                          <TableCell className="text-gray-700">{r.date}</TableCell>
                          <TableCell className="font-medium">{displayAccountName(r.account)}</TableCell>
                          <TableCell className="text-right">{r.push_count} 单</TableCell>
                          <TableCell className="text-right">¥{r.push_fee.toFixed(2)}</TableCell>
                          <TableCell className="text-right">¥{r.material_freight.toFixed(2)}</TableCell>
                          <TableCell className="text-right text-green-600">
                            {r.refund !== 0 ? `+¥${r.refund.toFixed(2)}` : '—'}
                          </TableCell>
                          <TableCell
                            className={`text-right font-semibold ${r.total < 0 ? 'text-red-600' : 'text-green-600'}`}
                          >
                            ¥{r.total.toFixed(2)}
                          </TableCell>
                          <TableCell>
                            {r.allSettled ? (
                              <Badge className="bg-green-100 text-green-700">已结算</Badge>
                            ) : (
                              <Badge className="bg-amber-100 text-amber-700">
                                {r.date >= new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
                                  ? '待结算（当日，0 点自动结算）'
                                  : '待结算（下次日结时结算）'}
                              </Badge>
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
                                    {displayAccountName(assignedUser.email)}
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
                                          {displayAccountName(u.email)}
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
                <label className="text-sm font-medium">账号</label>
                <Input
                  type="text"
                  placeholder="用户登录账号（字母开头，如 seller01）"
                  value={createAccount}
                  onChange={(e) => setCreateAccount(e.target.value)}
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

        {/* 调整用户店铺弹窗 */}
        <Dialog
          open={shopDialog}
          onOpenChange={(open) => {
            setShopDialog(open);
            if (!open) setShopTargetUser(null);
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>调整店铺分配</DialogTitle>
              <DialogDescription>
                为用户{' '}
                <span className="font-semibold text-gray-900">
                  {shopTargetUser ? displayAccountName(shopTargetUser.email) : ''}
                </span>{' '}
                分配方果店铺，勾选后保存。已分配给其他用户的店铺勾选后将转移给该用户。
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] overflow-y-auto space-y-2 py-2">
              {shopDialogLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                </div>
              ) : fgShops.length === 0 ? (
                <p className="text-center text-gray-500 py-6">暂无可分配店铺</p>
              ) : (
                fgShops.map((s) => {
                  const assignedToOther =
                    !!s.assignedUserId && !!shopTargetUser && s.assignedUserId !== shopTargetUser.id;
                  const otherUser = users.find((u) => u.id === s.assignedUserId);
                  return (
                    <label
                      key={s.fangguoShopId}
                      className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-blue-600 cursor-pointer"
                          checked={!!shopSelection[s.fangguoShopId]}
                          onChange={(e) =>
                            setShopSelection((prev) => ({
                              ...prev,
                              [s.fangguoShopId]: e.target.checked,
                            }))
                          }
                        />
                        <div>
                          <div className="text-sm font-medium text-gray-900">{s.shopName}</div>
                          <div className="text-xs text-gray-500">{s.brandName || s.platform}</div>
                        </div>
                      </div>
                      {assignedToOther && (
                        <span className="text-xs text-amber-600 shrink-0 ml-3">
                          已分配给 {otherUser ? displayAccountName(otherUser.email) : '其他用户'}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShopDialog(false)}>
                取消
              </Button>
              <Button onClick={handleSaveShops} disabled={shopDialogSaving || shopDialogLoading}>
                {shopDialogSaving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* 删除用户确认弹窗 */}
        <Dialog open={deleteDialog} onOpenChange={setDeleteDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>删除用户</DialogTitle>
              <DialogDescription>
                确定要删除用户{' '}
                <span className="font-semibold text-gray-900">
                  {deleteTarget ? displayAccountName(deleteTarget.email) : ''}
                </span>{' '}
                吗？该操作不可恢复，将同时删除：
              </DialogDescription>
            </DialogHeader>
            <ul className="text-sm text-gray-600 space-y-1 py-2 list-disc list-inside">
              <li>登录账号与密码</li>
              <li>余额与钱包流水记录（当前余额 ¥{deleteTarget?.balance ?? '0.00'}）</li>
              <li>推单计费记录</li>
              <li>店铺分配关系</li>
            </ul>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteDialog(false)}>
                取消
              </Button>
              <Button variant="destructive" onClick={handleDeleteUser} disabled={deleteLoading}>
                {deleteLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                确认删除
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
