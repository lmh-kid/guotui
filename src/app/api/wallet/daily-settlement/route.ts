import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';
import { shanghaiDateStr } from '@/lib/daily-settlement';
import { PUSH_FEE } from '@/lib/billing';

/**
 * 每日扣款记录（普通用户，本地库按日聚合）
 * GET /api/wallet/daily-settlement?days=31
 *
 * 每个账期一行：
 * - push_count / push_fee: 当日全部推送订单数（含方果直推，按「扣费·订单推送」预扣流水去重 tid；
 *   当天流水未同步时由 push_records 兜底）与 0.5 服务费
 * - charge / refund / material_freight: 入账扣费（材料费按订单取「预扣 vs 实扣」较大者，
 *   预扣即扣款 + 运费等实扣）与退费（无条件冲抵）
 * - total: 当日应付合计（负=扣费）
 * - settled / settled_amount / balance_after: 日结状态与实际扣款流水（wallet_transactions「日结 YYYY-MM-DD」）
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

    // 1. 方果流水（本用户）
    const { data: lines, error: linesErr } = await supabase
      .from('fangguo_transactions')
      .select('id, tid, kind, processed_amount, settle_date, settled, fee_name_type')
      .eq('user_id', user.id)
      .gte('settle_date', since)
      .order('settle_date', { ascending: false });
    if (linesErr) throw linesErr;

    // 2. 推单记录（本用户；当天流水未同步时的兜底计数来源）
    const { data: pushes, error: pushErr } = await supabase
      .from('push_records')
      .select('id, push_date, fee_applied, order_no')
      .eq('user_id', user.id)
      .gte('push_date', since);
    if (pushErr) throw pushErr;

    // 3. 日结扣款流水（wallet_transactions 描述前缀「日结 YYYY-MM-DD」，含主结算+补扣/补退）
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

    // 4. 按日聚合
    //    材运费口径：预扣即扣款——材料费按订单 tid 取「预扣总额 vs 实扣总额」绝对值
    //    较大者（两阶段同一笔钱，避免双计/漏计）；退费无条件冲抵
    //    推单数口径：当天全部推送订单，含方果直推
    const groups = new Map<
      string,
      {
        date: string;
        pushedTids: Set<string>;
        matByTid: Map<string, { prehold: number; charge: number }>;
        freight: number; // 运费等非材料实扣（负）
        refund: number; // 退费（正，无条件冲抵）
        allSettled: boolean;
      }
    >();
    const getGroup = (date: string) => {
      let g = groups.get(date);
      if (!g) {
        g = {
          date,
          pushedTids: new Set(),
          matByTid: new Map(),
          freight: 0,
          refund: 0,
          allSettled: true,
        };
        groups.set(date, g);
      }
      return g;
    };

    for (const l of lines ?? []) {
      const g = getGroup(l.settle_date);
      const amount = parseFloat(l.processed_amount as string);
      const abs = Math.abs(amount);
      const name = String(l.fee_name_type ?? '');
      const tid = l.tid ? String(l.tid) : '';

      if (l.kind === 'prehold') {
        // 「扣费·订单推送」预扣 = 当天推送动作 + 材料费真实扣款
        if (tid) {
          g.pushedTids.add(tid);
          if (amount < 0 && name.includes('材料')) {
            const a = g.matByTid.get(tid) ?? { prehold: 0, charge: 0 };
            a.prehold += abs;
            g.matByTid.set(tid, a);
          }
        }
        if (!l.settled) g.allSettled = false;
        continue;
      }
      if (l.kind === 'charge' && amount < 0) {
        if (tid && name.includes('材料')) {
          const a = g.matByTid.get(tid) ?? { prehold: 0, charge: 0 };
          a.charge += abs;
          g.matByTid.set(tid, a);
        } else {
          g.freight -= abs;
        }
      } else if (l.kind === 'refund' && amount > 0) {
        g.refund += amount; // 无条件冲抵（预扣已入账，取消推送必须退回）
      }
      if (!l.settled) g.allSettled = false;
    }
    for (const p of pushes ?? []) {
      // 兜底：当天流水尚未同步时，系统推单记录仍计入（直推单靠流水，Set 去重合并）
      if (!p.order_no) continue;
      const g = getGroup(p.push_date);
      g.pushedTids.add(p.order_no);
      if (!p.fee_applied) g.allSettled = false;
    }

    const list = [...groups.values()]
      .map((g) => {
        const pushCount = g.pushedTids.size;
        const pushFee = parseFloat((pushCount * PUSH_FEE).toFixed(2));
        let matSum = 0; // 材料费（负）：每单取 max(预扣, 实扣)
        for (const a of g.matByTid.values()) matSum -= Math.max(a.prehold, a.charge);
        const chargeTotal = parseFloat((matSum + g.freight).toFixed(2)); // 入账扣费（含预扣，负）
        const refundTotal = parseFloat(g.refund.toFixed(2));
        const materialFreight = parseFloat((chargeTotal + refundTotal).toFixed(2));
        const settled = settledByDate.get(g.date);
        return {
          date: g.date,
          push_count: pushCount,
          push_fee: pushFee,
          charge: chargeTotal,
          refund: refundTotal,
          material_freight: materialFreight,
          total: parseFloat((materialFreight - pushFee).toFixed(2)),
          settled: !!settled || g.allSettled,
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
