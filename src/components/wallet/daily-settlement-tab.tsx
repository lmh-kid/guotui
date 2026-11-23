'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@/lib/api-request';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, CalendarClock } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

interface DailyRecord {
  date: string;
  push_count: number;
  push_fee: number;
  charge: number;
  refund: number;
  material_freight: number;
  total: number;
  settled: boolean;
  settled_amount: number | null;
  balance_after: number | null;
}

interface DailyResponse {
  list: DailyRecord[];
  summary: {
    totalAmount: number;
    totalPush: number;
    totalMaterialFreight: number;
    settledDays: number;
    unsettledDays: number;
  };
  feePerOrder: number;
  days: number;
}

const DAYS_OPTIONS = [
  { value: 7, label: '近7天' },
  { value: 31, label: '近31天' },
];

export default function DailySettlementTab() {
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [summary, setSummary] = useState<DailyResponse['summary'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(31);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<DailyResponse>(`/api/wallet/daily-settlement?days=${days}`);
      setRecords(data.list);
      setSummary(data.summary);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加载每日扣款记录失败';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  return (
    <div>
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-1 border border-gray-200 rounded-md p-1">
          {DAYS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setDays(opt.value)}
              className={`px-3 py-1 text-sm rounded transition-colors ${
                days === opt.value
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={fetchRecords} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {/* 提示 */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 mb-4 text-xs text-gray-500">
        每日扣款 = 当日推送订单的方果材运费（材料费含推单预扣，预扣即扣款；运费与退费跟随订单同归推送日）+ ¥0.50/单推单服务费（含方果后台直推）。账期 = 订单推送日，因此本页每天金额与「资金明细」同日合计完全相等；每天 0 点结算前一账期并实际扣除余额，材运费滞后到达（发货后 1-3 天出账）时次日日结自动补扣/补退，近 7 天账期会随之重算修正。
      </div>

      {/* 汇总 */}
      {summary && (
        <div className="rounded-lg border border-gray-200 bg-white p-3 mb-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <span className="text-gray-500">扣款合计 </span>
            <span className="font-semibold text-red-600">¥{Math.abs(summary.totalAmount).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-gray-500">推单合计 </span>
            <span className="font-semibold text-gray-900">{summary.totalPush} 单</span>
          </div>
          <div>
            <span className="text-gray-500">材运费合计 </span>
            <span className="font-semibold text-gray-900">¥{Math.abs(summary.totalMaterialFreight).toFixed(2)}</span>
          </div>
          <div>
            <span className="text-gray-500">已结算 </span>
            <span className="font-semibold text-green-600">{summary.settledDays} 天</span>
            <span className="text-gray-400"> / 待结算 </span>
            <span className="font-semibold text-amber-600">{summary.unsettledDays} 天</span>
          </div>
        </div>
      )}

      {/* 记录表 */}
      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="animate-spin h-8 w-8 text-blue-600" />
        </div>
      ) : records.length === 0 ? (
        <div className="py-16 text-center text-sm text-gray-500">
          <div className="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <CalendarClock className="w-7 h-7 text-gray-400" />
          </div>
          暂无每日扣款记录
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>账期日期</TableHead>
                <TableHead className="text-right">推单数</TableHead>
                <TableHead className="text-right">推单费</TableHead>
                <TableHead className="text-right">材运费</TableHead>
                <TableHead className="text-right">当日合计</TableHead>
                <TableHead>结算状态</TableHead>
                <TableHead className="text-right" title="该账期最后一次扣款/回补后的余额快照">
                  扣款后余额
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.date}>
                  <TableCell className="text-sm text-gray-700 font-medium">{r.date}</TableCell>
                  <TableCell className="text-right text-sm text-gray-700">{r.push_count}</TableCell>
                  <TableCell className="text-right text-sm text-gray-700">
                    ¥{r.push_fee.toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right text-sm text-gray-700">
                    {r.material_freight ? `¥${Math.abs(r.material_freight).toFixed(2)}` : '-'}
                    {r.refund > 0 && (
                      <span className="text-xs text-green-600 ml-1" title="含退回">
                        (含退 ¥{r.refund.toFixed(2)})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm font-semibold text-red-600">
                    ¥{Math.abs(r.total).toFixed(2)}
                  </TableCell>
                  <TableCell>
                    {r.settled ? (
                      <Badge className="bg-green-100 text-green-700 text-xs">已结算</Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-700 text-xs">待结算</Badge>
                    )}
                  </TableCell>
                  <TableCell
                    className="text-right text-sm text-gray-600"
                    title="该账期最后一笔扣款/回补后的账户余额快照（来自钱包流水 balance_after）。后续其他账期补扣、补退会继续改变账户余额，实时余额以页面顶部为准"
                  >
                    {r.balance_after != null ? `¥${r.balance_after.toFixed(2)}` : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
