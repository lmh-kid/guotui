'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '@/lib/api-request';
import { Button } from '@/components/ui/button';
import { Loader2, RefreshCw, Zap } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';

interface DetailRow {
  time: string;
  tid: string | null;
  store_name: string | null;
  fee_type: string;
  recharge: number;
  material: number;
  freight: number;
  manual: number;
  material_refund: number;
  freight_refund: number;
  other: number;
  amount: number; // 原始金额（负=扣费）
  is_prehold: boolean;
}

interface LinesResponse {
  list: DetailRow[];
  total: number;
  summary: {
    totalMaterial: number;
    totalFreight: number;
    totalRefund: number;
    totalManual: number;
    totalAmount: number;
    pushCount: number;
    feePerOrder: number;
  };
  days: number;
}

const DAYS_OPTIONS = [
  { value: 7, label: '近7天' },
  { value: 30, label: '近30天' },
  { value: 90, label: '近90天' },
];

/** 金额单元格：0 显示灰色 -，负数红色 */
function Amount({ value, positive = false }: { value: number; positive?: boolean }) {
  if (!value) return <span className="text-gray-300">-</span>;
  return (
    <span className={positive ? 'text-green-600' : 'text-gray-900'}>
      {positive ? '+' : ''}
      {value.toFixed(2)}
    </span>
  );
}

export default function FangguoLinesTab() {
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [summary, setSummary] = useState<LinesResponse['summary'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);
  const [days, setDays] = useState(30);

  const fetchLines = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest<LinesResponse>(`/api/wallet/fangguo-lines?days=${days}`);
      setRows(data.list);
      setSummary(data.summary);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '加载资金明细失败';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchLines();
  }, [fetchLines]);

  const handleManualSettle = async () => {
    setSettling(true);
    try {
      const result = await apiRequest<{
        success: boolean;
        summary: {
          syncedLines: number;
          newLines: number;
          unassigned: number;
          settledUsers: number;
          settledAmount: number;
          skippedUsers: number;
          errors: string[];
        };
      }>('/api/settlement/run', { method: 'POST' });
      const s = result.summary;
      const errs = s.errors?.length ? `（${s.errors.length} 个异常）` : '';
      toast.success(
        `已同步方果流水 ${s.syncedLines} 条（新增 ${s.newLines}）；结算 ${s.settledUsers} 个账期，扣款 ¥${Math.abs(s.settledAmount).toFixed(2)}${errs}`
      );
      window.dispatchEvent(new Event('balance-updated'));
      fetchLines();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '手动结算失败';
      toast.error(message);
    } finally {
      setSettling(false);
    }
  };

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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchLines} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
          <Button
            size="sm"
            onClick={handleManualSettle}
            disabled={settling}
            title="测试用：立即执行每日 0 点的结算逻辑（同步方果流水 + 结算满 7 天账期）"
          >
            {settling ? (
              <>
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                结算中...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-1" />
                手动结算
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 提示 */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 mb-4 text-xs text-gray-500">
        手动扣费 ¥{summary?.feePerOrder ?? 0.5}/单为推单服务费，仅在此处展示；实际扣款在每日结算时统一入账。
        预扣为推单时的材料费冻结，并非实际成本。数据由结算任务从方果同步（近 7 天窗口）。
      </div>

      {/* 汇总栏 */}
      {summary && (
        <div className="rounded-lg border border-gray-200 bg-white p-3 mb-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <span className="text-gray-500">材料费 </span>
            <span className="font-semibold text-gray-900">¥{summary.totalMaterial.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-gray-500">运费 </span>
            <span className="font-semibold text-gray-900">¥{summary.totalFreight.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-gray-500">退回 </span>
            <span className="font-semibold text-green-600">¥{summary.totalRefund.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-gray-500">手动扣费（{summary.pushCount} 单） </span>
            <span className="font-semibold text-amber-600">¥{summary.totalManual.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-gray-500">合计 </span>
            <span className="font-semibold text-red-600">¥{summary.totalAmount.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* 明细表 */}
      {loading ? (
        <div className="py-16 flex justify-center">
          <Loader2 className="animate-spin h-8 w-8 text-blue-600" />
        </div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center text-sm text-gray-500">
          暂无资金明细数据
          <p className="text-xs text-gray-400 mt-2">
            数据由每日结算任务从方果同步，或点击「手动结算」立即同步
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>计费时间</TableHead>
                <TableHead>订单号</TableHead>
                <TableHead>店铺</TableHead>
                <TableHead>类型</TableHead>
                <TableHead className="text-right">充值</TableHead>
                <TableHead className="text-right">材料费</TableHead>
                <TableHead className="text-right">运费</TableHead>
                <TableHead className="text-right">材料退回</TableHead>
                <TableHead className="text-right">运费退回</TableHead>
                <TableHead className="text-right">手动扣费</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row, idx) => (
                <TableRow key={`${row.time}-${idx}`}>
                  <TableCell className="text-sm text-gray-600 whitespace-nowrap">
                    {new Date(row.time).toLocaleString('zh-CN', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </TableCell>
                  <TableCell className="text-xs text-gray-600 font-mono">
                    {row.tid || <span className="text-gray-300">-</span>}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500 max-w-[140px] truncate" title={row.store_name ?? ''}>
                    {row.store_name || <span className="text-gray-300">-</span>}
                  </TableCell>
                  <TableCell className="text-xs text-gray-600 max-w-[220px]">
                    <span className={row.is_prehold ? 'text-amber-600' : ''}>{row.fee_type}</span>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    <Amount value={row.recharge} positive={row.recharge > 0} />
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {row.is_prehold ? (
                      // 预扣冻结非实扣，灰色展示且不计入汇总
                      <span className="text-gray-400">{row.material.toFixed(2)}</span>
                    ) : (
                      <Amount value={row.material} />
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    <Amount value={row.freight} />
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    <Amount value={row.material_refund} positive />
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    <Amount value={row.freight_refund} positive />
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {row.manual ? (
                      <span className="text-amber-600 font-medium">{row.manual.toFixed(2)}</span>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
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
