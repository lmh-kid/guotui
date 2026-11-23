'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api-request';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Play, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

/**
 * 资金明细（按订单号聚合，布局对齐方果后台）
 * 一个订单一行：材料费 / 运费 / 手动扣费(推单服务费 ¥0.50/单) / 材料退回 / 运费退回
 * 材料费：预扣与实扣是同一笔钱的两个阶段，取绝对值较大者（未发货计预扣、已发货计实扣），退费冲抵
 * 合计 = 材料费 + 运费 + 手动扣费；默认展示当天，可切换近 3/7/30 天
 */

interface OrderRow {
  order_no: string;
  time: string;
  store_name: string | null;
  recharge: number;
  material: number;
  freight: number;
  manual: number;
  material_refund: number;
  freight_refund: number;
  total: number;
}

interface Summary {
  totalMaterial: number;
  totalFreight: number;
  totalRefund: number;
  totalManual: number;
  totalAmount: number;
  pushCount: number;
  feePerOrder: number;
}

const fmtTime = (t?: string) => (t ? t.slice(0, 19).replace('T', ' ') : '-');

export default function FangguoLinesTab() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [days, setDays] = useState(1); // 默认展示当天
  const [loading, setLoading] = useState(false);
  const [settling, setSettling] = useState(false);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    try {
      const json = (await apiRequest(`/api/wallet/fangguo-lines?days=${d}`)) as {
        list?: OrderRow[];
        summary?: Summary;
      };
      setRows(json.list ?? []);
      setSummary(json.summary ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      toast.error(msg && msg !== 'Failed to fetch' ? `查询资金明细失败：${msg}` : '查询资金明细失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const handleManualSettle = async () => {
    setSettling(true);
    try {
      const json = (await apiRequest('/api/settlement/run', {
        method: 'POST',
        body: JSON.stringify({}),
      })) as {
        summary?: {
          syncedLines?: number;
          settledUsers?: number;
          skippedUsers?: number;
          errors?: string[];
        };
      };
      const s = json.summary;
      toast.success(
        `结算完成：同步流水 ${s?.syncedLines ?? 0} 条，结算用户 ${s?.settledUsers ?? 0} 个，跳过 ${s?.skippedUsers ?? 0} 个`
      );
      await load(days);
      window.dispatchEvent(new Event('balance-updated'));
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      toast.error(msg && msg !== 'Failed to fetch' ? `手动结算失败：${msg}` : '手动结算失败');
    } finally {
      setSettling(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            资金明细
            {summary && (
              <span className="ml-2 text-xs font-normal text-gray-500">
                材料费 ¥{summary.totalMaterial.toFixed(2)} · 运费 ¥{summary.totalFreight.toFixed(2)} · 退回 ¥
                {summary.totalRefund.toFixed(2)} · 推单服务费 ¥{summary.totalManual.toFixed(2)}（{summary.pushCount} 单 × ¥
                {summary.feePerOrder}）· 合计 ¥{summary.totalAmount.toFixed(2)}
              </span>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {[1, 3, 7, 30].map((d) => (
              <Button
                key={d}
                size="sm"
                variant={days === d ? 'default' : 'outline'}
                className="h-7 px-2.5 text-xs"
                onClick={() => setDays(d)}
              >
                {d === 1 ? '当天' : `近${d}天`}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs"
              disabled={loading}
              onClick={() => void load(days)}
            >
              {loading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
              刷新
            </Button>
            <Button
              size="sm"
              className="h-7 bg-amber-600 px-2.5 text-xs text-white hover:bg-amber-700"
              disabled={settling}
              onClick={() => void handleManualSettle()}
            >
              {settling ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
              手动结算
            </Button>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          与方果后台账单同口径；数据在每日 0 点结算时自动同步（近 7 天窗口），可点「手动结算」立即同步
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr className="[&>th]:border-r [&>th]:border-b [&>th]:border-gray-200 [&>th]:px-3 [&>th]:py-2 last:[&>th]:border-r-0">
                <th className="text-left">计费时间</th>
                <th className="text-left">订单号</th>
                <th className="text-left">店铺</th>
                <th className="text-right">充值</th>
                <th className="text-right">材料费</th>
                <th className="text-right">运费</th>
                <th className="text-right">手动扣费</th>
                <th className="text-right" title="取消/改价重推时原预扣全额退回的金额，材料费列已是扣减后的净额，合计不重复计算">
                  材料退回
                </th>
                <th className="text-right">运费退回</th>
                <th className="text-right">合计</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, i) => (
                <tr
                  key={`${r.order_no || 'no-order'}-${r.time}-${i}`}
                  className="[&>td]:border-r [&>td]:border-gray-100 [&>td]:px-3 [&>td]:py-2 last:[&>td]:border-r-0 hover:bg-gray-50"
                >
                  <td className="whitespace-nowrap text-xs text-gray-600">{fmtTime(r.time)}</td>
                  <td className="font-mono text-xs text-gray-800">{r.order_no || '—'}</td>
                  <td className="max-w-32 truncate text-xs text-gray-600">{r.store_name || '-'}</td>
                  <Cell v={r.recharge} sign />
                  <Cell v={r.material} />
                  <Cell v={r.freight} />
                  <Cell v={r.manual} highlight />
                  <Cell v={r.material_refund} refund />
                  <Cell v={r.freight_refund} refund />
                  <td
                    className={`whitespace-nowrap text-right font-semibold ${
                      r.total < 0 ? 'text-green-600' : r.total > 0 ? 'text-gray-900' : 'text-gray-400'
                    }`}
                  >
                    {r.total > 0 ? '' : '-'}¥{Math.abs(r.total).toFixed(2)}
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-sm text-gray-400">
                    {days === 1 ? '今天暂无资金明细' : `近 ${days} 天暂无资金明细`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {loading && (
          <div className="flex items-center justify-center py-6 text-sm text-gray-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中...
          </div>
        )}
        <p className="mt-2 text-xs text-gray-400">
          材料费在推单时按预扣即真实扣款（发货转实扣不二次扣、取两者较大者），退费自动冲抵；推单服务费 ¥0.50/单按推送日归属账期（含方果后台直推），仅展示不入库，实际扣款在每日结算统一计入
        </p>
        <p className="mt-1 text-xs text-gray-400">
          计费时间取推单时刻（与方果后台一致），整行费用归属推送日账期：昨日推送、今日发货的单显示在昨日，不重复出现在今日列表
        </p>
        <p className="mt-1 text-xs text-gray-400">
          「材料退回」为取消/改价重推时原预扣的全额退回流水（如工厂改价 20→16.5：原扣 20 退回、按 16.5 重扣），
          「材料费」列已是扣除退回后的净额（16.50），两者不叠加
        </p>
      </CardContent>
    </Card>
  );
}

function Cell({
  v,
  sign = false,
  refund = false,
  highlight = false,
}: {
  v: number;
  sign?: boolean;
  refund?: boolean;
  highlight?: boolean;
}) {
  const abs = Math.abs(v);
  if (!v) return <td className="text-right text-xs text-gray-300">-</td>;
  if (sign) {
    return (
      <td className={`whitespace-nowrap text-right text-xs ${v > 0 ? 'text-green-600' : 'text-red-600'}`}>
        {v > 0 ? '+' : '-'}¥{abs.toFixed(2)}
      </td>
    );
  }
  if (refund) {
    return (
      <td className="whitespace-nowrap text-right text-xs text-green-600">+¥{abs.toFixed(2)}</td>
    );
  }
  if (highlight) {
    return (
      <td className="whitespace-nowrap text-right text-xs font-semibold text-amber-600">¥{abs.toFixed(2)}</td>
    );
  }
  if (v < 0) {
    // 净额为负（退回超过扣费）：按退回样式展示
    return (
      <td className="whitespace-nowrap text-right text-xs text-green-600">+¥{abs.toFixed(2)}</td>
    );
  }
  return <td className="whitespace-nowrap text-right text-xs text-gray-900">¥{abs.toFixed(2)}</td>;
}
