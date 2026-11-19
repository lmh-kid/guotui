'use client';

import { useState, useEffect, useCallback } from 'react';
import AppLayout from '@/components/app-layout';
import { apiRequest } from '@/lib/api-request';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Plus, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import FangguoLinesTab from '@/components/wallet/fangguo-lines-tab';
import DailySettlementTab from '@/components/wallet/daily-settlement-tab';
import TransactionsTab from '@/components/wallet/transactions-tab';

interface BalanceData {
  balance: string;
  frozen_balance: string;
  total_recharge: string;
  total_consume: string;
}

const RECHARGE_OPTIONS = [50, 100, 200, 500, 1000, 2000];

export default function WalletPage() {
  const [balance, setBalance] = useState<BalanceData | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('lines');
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

  useEffect(() => {
    fetchBalance();
    // 手动结算等操作触发余额变化时刷新
    const onBalanceUpdated = () => fetchBalance();
    window.addEventListener('balance-updated', onBalanceUpdated);
    return () => window.removeEventListener('balance-updated', onBalanceUpdated);
  }, [fetchBalance]);

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
      window.dispatchEvent(new Event('balance-updated'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '充值失败';
      toast.error(message);
    } finally {
      setRechargeLoading(false);
    }
  };

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

        {/* 明细 Tabs */}
        <Card>
          <CardContent className="pt-6">
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="lines">资金明细</TabsTrigger>
                <TabsTrigger value="daily">每日扣款记录</TabsTrigger>
                <TabsTrigger value="tx">账单流水</TabsTrigger>
              </TabsList>

              <TabsContent value="lines">
                <FangguoLinesTab />
              </TabsContent>
              <TabsContent value="daily">
                <DailySettlementTab />
              </TabsContent>
              <TabsContent value="tx">
                <TransactionsTab />
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
