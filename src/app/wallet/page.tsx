'use client';

import { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/app-layout';
import { apiRequest } from '@/lib/api-request';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Wallet, Plus, ArrowDownCircle, ArrowUpCircle, Clock, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface BalanceData {
  balance: string;
  frozen_balance: string;
  total_recharge: string;
  total_consume: string;
}

interface Transaction {
  id: string;
  type: string;
  amount: string;
  balance_after: string;
  description: string;
  order_id: string | null;
  created_at: string;
}

interface TransactionsResponse {
  list: Transaction[];
  total: number;
  page: number;
  pageSize: number;
}

const RECHARGE_OPTIONS = [50, 100, 200, 500, 1000, 2000];

export default function WalletPage() {
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(20);
  const [rechargeDialogOpen, setRechargeDialogOpen] = useState(false);
  const [rechargeAmount, setRechargeAmount] = useState('100');
  const [customAmount, setCustomAmount] = useState('');
  const [rechargeLoading, setRechargeLoading] = useState(false);

  const fetchBalance = useCallback(async () => {
    try {
      const data = await apiRequest<BalanceData>('/api/balance');
      setBalance(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加载余额失败';
      toast.error(message);
    } finally {
      setBalanceLoading(false);
    }
  }, []);

  const fetchTransactions = useCallback(async () => {
    setTxLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        type: activeTab,
      });
      const data = await apiRequest<TransactionsResponse>(
        `/api/wallet/transactions?${params.toString()}`
      );
      setTransactions(data.list);
      setTotal(data.total);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加载流水失败';
      toast.error(message);
    } finally {
      setTxLoading(false);
    }
  }, [page, pageSize, activeTab]);

  useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handleRecharge = async () => {
    const amount = customAmount || rechargeAmount;
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('请输入有效金额');
      return;
    }

    setRechargeLoading(true);
    try {
      const result = await apiRequest<{ success: boolean; balance: string; message: string }>(
        '/api/wallet/recharge',
        {
          method: 'POST',
          body: JSON.stringify({ amount }),
        }
      );
      toast.success(result.message);
      setRechargeDialogOpen(false);
      setCustomAmount('');
      fetchBalance();
      setPage(1);
      fetchTransactions();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '充值失败';
      toast.error(message);
    } finally {
      setRechargeLoading(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <AppLayout>
      <div className="p-4 lg:p-6 max-w-5xl mx-auto">
        {/* 余额卡片 */}
        <Card className="bg-gradient-to-br from-blue-600 to-indigo-600 text-white border-0 shadow-lg mb-6">
          <CardContent className="pt-6 pb-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-blue-100 text-sm mb-1">账户余额</p>
                {balanceLoading ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-2xl">加载中...</span>
                  </div>
                ) : (
                  <p className="text-4xl font-bold">¥{balance?.balance || '0.00'}</p>
                )}
                <p className="text-blue-100 text-sm mt-2">
                  冻结余额：¥{balance?.frozen_balance || '0.00'}
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  className="bg-white text-blue-600 hover:bg-blue-50"
                  onClick={() => setRechargeDialogOpen(true)}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  立即充值
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-white/20">
              <div>
                <p className="text-blue-100 text-xs">累计充值</p>
                <p className="text-xl font-semibold mt-1">¥{balance?.total_recharge || '0.00'}</p>
              </div>
              <div>
                <p className="text-blue-100 text-xs">累计消费</p>
                <p className="text-xl font-semibold mt-1">¥{balance?.total_consume || '0.00'}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 流水记录 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">账单明细</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="all">全部</TabsTrigger>
                <TabsTrigger value="recharge">充值</TabsTrigger>
                <TabsTrigger value="consume">消费</TabsTrigger>
              </TabsList>

              <TabsContent value={activeTab}>
                {txLoading ? (
                  <div className="py-16 flex justify-center">
                    <Loader2 className="animate-spin h-8 w-8 text-blue-600" />
                  </div>
                ) : transactions.length === 0 ? (
                  <div className="py-16 text-center">
                    <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Wallet className="w-8 h-8 text-gray-400" />
                    </div>
                    <p className="text-gray-500">暂无账单记录</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-3">
                      {transactions.map((tx) => {
                        const isRecharge = tx.type === 'recharge';
                        const isPositive = isRecharge || tx.type === 'refund';
                        const Icon = isPositive ? ArrowDownCircle : ArrowUpCircle;

                        return (
                          <div
                            key={tx.id}
                            className="flex items-center justify-between p-3 hover:bg-gray-50 rounded-lg transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                  isPositive
                                    ? 'bg-green-100 text-green-600'
                                    : 'bg-red-100 text-red-600'
                                }`}
                              >
                                <Icon className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  {tx.description || (isRecharge ? '账户充值' : '消费扣款')}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <Clock className="w-3 h-3 text-gray-400" />
                                  <span className="text-xs text-gray-400">
                                    {new Date(tx.created_at).toLocaleString('zh-CN')}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p
                                className={`text-sm font-semibold ${
                                  isPositive ? 'text-green-600' : 'text-red-600'
                                }`}
                              >
                                {isPositive ? '+' : ''}{tx.amount}
                              </p>
                              <p className="text-xs text-gray-400 mt-0.5">
                                余额：¥{tx.balance_after}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* 分页 */}
                    {totalPages > 1 && (
                      <div className="flex justify-center items-center gap-4 mt-6 pt-4 border-t border-gray-100">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          disabled={page === 1}
                        >
                          上一页
                        </Button>
                        <span className="text-sm text-gray-500">
                          第 {page} / {totalPages} 页
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          disabled={page === totalPages}
                        >
                          下一页
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* 充值弹窗 */}
        <Dialog open={rechargeDialogOpen} onOpenChange={setRechargeDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>账户充值</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div>
                <p className="text-sm text-gray-600 mb-3">选择充值金额</p>
                <div className="grid grid-cols-3 gap-3">
                  {RECHARGE_OPTIONS.map((amount) => (
                    <button
                      key={amount}
                      onClick={() => {
                        setRechargeAmount(String(amount));
                        setCustomAmount('');
                      }}
                      className={`
                        p-3 rounded-lg border-2 text-center transition-all
                        ${customAmount === '' && rechargeAmount === String(amount)
                          ? 'border-blue-500 bg-blue-50 text-blue-600'
                          : 'border-gray-200 hover:border-gray-300'
                        }
                      `}
                    >
                      <p className="text-lg font-bold">¥{amount}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm text-gray-600 mb-2">自定义金额</p>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">¥</span>
                  <Input
                    type="number"
                    min="1"
                    step="0.01"
                    className="pl-7"
                    placeholder="输入自定义金额"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                  />
                </div>
              </div>

              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">充值金额</span>
                  <span className="font-medium">¥{customAmount || rechargeAmount}</span>
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setRechargeDialogOpen(false)}>
                取消
              </Button>
              <Button onClick={handleRecharge} disabled={rechargeLoading}>
                {rechargeLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    充值中...
                  </>
                ) : (
                  '确认充值'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
