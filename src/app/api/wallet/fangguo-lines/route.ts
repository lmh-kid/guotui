import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';
import { shanghaiDateStr } from '@/lib/daily-settlement';
import { PUSH_FEE } from '@/lib/billing';

/**
 * 资金明细（普通用户，只读展示）
 * GET /api/wallet/fangguo-lines?days=30
 *
 * 数据源均为本地库已同步数据：
 * - fangguo_transactions：方果资金流水（日结任务/手动结算时同步，近 7 天窗口）
 *   按费用名分列展示：充值 / 材料费 / 运费 / 材料退回 / 运费退回
 * - push_records：推单记录 → 合成为「手动扣费」展示行（¥0.50/单），
 *   该费用仅在展示层合成，不产生任何入库流水（实际扣款在日结时统一结算）
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { user, error: authError } = await getCurrentUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: authError || '认证失败' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const daysRaw = parseInt(searchParams.get('days') || '30', 10);
  const days = Math.min(90, Math.max(1, daysRaw));

  try {
    const supabase = await getSupabaseAdminClient();
    const since = shanghaiDateStr(Date.now() - days * 86400_000);

    // 1. 方果流水（本用户，按计费时间倒序）
    const { data: lines, error: linesErr } = await supabase
      .from('fangguo_transactions')
      .select(
        'id, tid, kind, fee_type, fee_name_type, business_node, processed_amount, store_name, transaction_time'
      )
      .eq('user_id', user.id)
      .gte('settle_date', since)
      .order('transaction_time', { ascending: false });
    if (linesErr) throw linesErr;

    // 2. 推单记录（手动扣费 ¥0.50 展示行）
    const { data: pushes, error: pushErr } = await supabase
      .from('push_records')
      .select('order_no, push_date, created_at')
      .eq('user_id', user.id)
      .gte('push_date', since)
      .order('created_at', { ascending: false });
    if (pushErr) throw pushErr;

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
      amount: number; // 原始金额（负=扣费 正=入账）
      is_prehold: boolean;
    }

    const list: DetailRow[] = [];

    for (const l of lines ?? []) {
      const amount = parseFloat(l.processed_amount as string);
      const name = String(l.fee_name_type ?? '');
      const kind = String(l.kind);
      const row: DetailRow = {
        time: l.transaction_time,
        tid: l.tid ?? null,
        store_name: l.store_name ?? null,
        fee_type: '',
        recharge: 0,
        material: 0,
        freight: 0,
        manual: 0,
        material_refund: 0,
        freight_refund: 0,
        other: 0,
        amount,
        is_prehold: kind === 'prehold',
      };
      const abs = Math.abs(amount);

      if (kind === 'exclude') {
        row.recharge = amount; // 充值为正数入账
        row.fee_type = `充值（${l.business_node ?? ''}）`;
      } else if (kind === 'charge') {
        if (name.includes('材料')) row.material = abs;
        else row.freight = abs; // 运费及其他实扣
        row.fee_type = `${l.fee_type ?? ''}·${name || '实扣'}`;
      } else if (kind === 'refund') {
        if (name.includes('材料')) row.material_refund = amount;
        else row.freight_refund = amount;
        row.fee_type = `${l.fee_type ?? ''}·${name || '退费'}`;
      } else if (kind === 'prehold') {
        // 预扣冻结（订单推送时的材料费预扣），非实际成本，仅展示
        row.material = abs;
        row.fee_type = `预扣·${name || '订单推送'}（冻结，非实扣）`;
      } else {
        row.other = amount;
        row.fee_type = `${l.fee_type ?? ''}·${name || '未知类型'}`;
      }
      list.push(row);
    }

    // 3. 手动扣费展示行（每笔推单 ¥0.50，仅展示不入库）
    for (const p of pushes ?? []) {
      list.push({
        time: p.created_at,
        tid: p.order_no,
        store_name: null,
        fee_type: '手动扣费·推单服务费',
        recharge: 0,
        material: 0,
        freight: 0,
        manual: PUSH_FEE,
        material_refund: 0,
        freight_refund: 0,
        other: 0,
        amount: -PUSH_FEE,
        is_prehold: false,
      });
    }

    // 按时间倒序合并
    list.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));

    // 4. 汇总（预扣不计入实扣合计）
    let totalMaterial = 0;
    let totalFreight = 0;
    let totalRefund = 0;
    let totalManual = 0;
    let pushCount = 0;
    for (const r of list) {
      if (r.is_prehold) continue;
      totalMaterial += r.material;
      totalFreight += r.freight;
      totalRefund += r.material_refund + r.freight_refund;
      totalManual += r.manual;
      if (r.manual > 0) pushCount += 1;
    }

    return NextResponse.json({
      list,
      total: list.length,
      summary: {
        totalMaterial: parseFloat(totalMaterial.toFixed(2)),
        totalFreight: parseFloat(totalFreight.toFixed(2)),
        totalRefund: parseFloat(totalRefund.toFixed(2)),
        totalManual: parseFloat(totalManual.toFixed(2)),
        totalAmount: parseFloat(
          (totalMaterial + totalFreight + totalRefund + totalManual).toFixed(2)
        ),
        pushCount,
        feePerOrder: PUSH_FEE,
      },
      days,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '查询资金明细失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
