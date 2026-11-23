import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';
import { shanghaiDateStr, getSettlementStartDate, buildUserLedger } from '@/lib/daily-settlement';
import { PUSH_FEE } from '@/lib/billing';

/**
 * 每日扣款记录（普通用户，本地库按日聚合）
 * GET /api/wallet/daily-settlement?days=31
 *
 * 每个账期（= 订单归属日 = 推送日）一行，**与资金明细、日结扣款同源**
 * （统一由 buildUserLedger 构建账本）：
 * - push_count / push_fee: 当日推送订单数与 0.5 服务费（含方果直推；当日流水未同步时
 *   由 push_records 兜底）
 * - charge: 入账扣费（材料费 max(预扣, 实扣) + 运费等实扣，负）
 * - refund: 退费冲抵（材料/运费退回，正）
 * - material_freight: charge + refund（材运费净额，负）
 * - total: 当日应付合计（负=扣费）= 材运费 + 服务费；与资金明细当日合计完全相等
 * - settled / settled_amount / balance_after: 日结状态与实际扣款流水
 *   （wallet_transactions「日结 YYYY-MM-DD」前缀，含主结算 + 补扣/补退）
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { user, error: authError } = await getCurrentUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: authError || '认证失败' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const daysRaw = parseInt(searchParams.get('days') || '31', 10);
  const days = Math.min(31, Math.max(1, daysRaw));

  try {
    const supabase = await getSupabaseAdminClient();
    const since = shanghaiDateStr(Date.now() - days * 86400_000);
    const startDate = await getSettlementStartDate();

    // 1. 订单账本（与资金明细、日结扣款同源）
    const ledger = await buildUserLedger(user.id, startDate);

    // 2. 推单记录（流水尚未同步时的兜底计数来源）
    const { data: pushes, error: pushErr } = await supabase
      .from('push_records')
      .select('id, push_date, fee_applied, order_no')
      .eq('user_id', user.id)
      .gte('push_date', since);
    if (pushErr) throw pushErr;

    // 3. 日结扣款流水（钱包流水「日结 YYYY-MM-DD」前缀，含主结算 + 补扣/补退）
    const { data: settledTx, error: txErr } = await supabase
      .from('wallet_transactions')
      .select('amount, balance_after, description, created_at')
      .eq('user_id', user.id)
      .gte('created_at', new Date(Date.now() - (days + 10) * 86400_000).toISOString())
      .like('description', '日结 %')
      .order('created_at', { ascending: true });
    if (txErr) throw txErr;
    // 同一账期可能有多条流水（主结算 + 迟到补扣/补退），金额求和、余额取最新一条
    const settledByDate = new Map<string, { amount: number; balanceAfter: number }>();
    for (const t of settledTx ?? []) {
      const m = /^日结 (\d{4}-\d{2}-\d{2})/.exec(t.description ?? '');
      if (m) {
        const prev = settledByDate.get(m[1]);
        settledByDate.set(m[1], {
          amount: parseFloat(((prev?.amount ?? 0) + parseFloat(t.amount as string)).toFixed(2)),
          balanceAfter: parseFloat(t.balance_after as string),
        });
      }
    }

    // 4. 未结算数据（用于判断账期是否已结清）
    const { data: unsettledLines, error: unErr } = await supabase
      .from('fangguo_transactions')
      .select('tid')
      .eq('user_id', user.id)
      .eq('settled', false)
      .limit(5000);
    if (unErr) throw unErr;
    const unsettledTids = new Set<string>();
    for (const l of unsettledLines ?? []) {
      if (l.tid) unsettledTids.add(String(l.tid));
    }

    // 5. 按订单归属日（推送日）聚合账本
    const groups = new Map<
      string,
      {
        date: string;
        pushCount: number;
        materialGross: number;
        freightGross: number;
        refund: number;
        pending: boolean;
      }
    >();
    const getGroup = (date: string) => {
      let g = groups.get(date);
      if (!g) {
        g = {
          date,
          pushCount: 0,
          materialGross: 0,
          freightGross: 0,
          refund: 0,
          pending: false,
        };
        groups.set(date, g);
      }
      return g;
    };

    const ledgerKeys = new Set<string>();
    for (const row of ledger) {
      ledgerKeys.add(`${row.date}|${row.order_no}`);
      if (row.date < since) continue;
      const g = getGroup(row.date);
      g.materialGross += row.materialGross;
      g.freightGross += row.freightGross;
      g.refund += row.materialRefund + row.freightRefund;
      if (row.pushFee > 0) g.pushCount += 1;
      if (unsettledTids.has(row.order_no)) g.pending = true;
    }
    // 兜底：流水尚未同步的系统推单（push_records 有、账本无）
    for (const p of pushes ?? []) {
      if (!p.order_no) continue;
      const g = getGroup(p.push_date);
      if (ledgerKeys.has(`${p.push_date}|${p.order_no}`)) {
        if (!p.fee_applied) g.pending = true;
        continue;
      }
      g.pushCount += 1;
      if (!p.fee_applied) g.pending = true;
    }

    const list = [...groups.values()]
      .map((g) => {
        const pushFee = parseFloat((g.pushCount * PUSH_FEE).toFixed(2));
        const chargeTotal = parseFloat((-(g.materialGross + g.freightGross)).toFixed(2));
        const refundTotal = parseFloat(g.refund.toFixed(2));
        const materialFreight = parseFloat((chargeTotal + refundTotal).toFixed(2));
        const settled = settledByDate.get(g.date);
        return {
          date: g.date,
          push_count: g.pushCount,
          push_fee: pushFee,
          charge: chargeTotal,
          refund: refundTotal,
          material_freight: materialFreight,
          total: parseFloat((materialFreight - pushFee).toFixed(2)),
          settled: !!settled || !g.pending,
          settled_amount: settled ? settled.amount : null,
          balance_after: settled ? settled.balanceAfter : null,
        };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    const summary = {
      totalAmount: parseFloat(list.reduce((s, g) => s + g.total, 0).toFixed(2)),
      totalPush: list.reduce((s, g) => s + g.push_count, 0),
      totalMaterialFreight: parseFloat(
        list.reduce((s, g) => s + g.material_freight, 0).toFixed(2)
      ),
      settledDays: list.filter((g) => g.settled).length,
      unsettledDays: list.filter((g) => !g.settled).length,
    };

    return NextResponse.json({ list, summary, feePerOrder: PUSH_FEE, days });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '查询每日扣款记录失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
