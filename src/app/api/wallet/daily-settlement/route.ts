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
 * - push_count / push_fee: 当日推单数与 0.5 服务费
 * - charge / refund / material_freight: 方果实扣材运费与有效退费（退费仅冲抵已实扣部分）
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
      .select('id, tid, kind, processed_amount, settle_date, settled')
      .eq('user_id', user.id)
      .gte('settle_date', since)
      .order('settle_date', { ascending: false });
    if (linesErr) throw linesErr;

    // 2. 推单记录（本用户）
    const { data: pushes, error: pushErr } = await supabase
      .from('push_records')
      .select('id, push_date, fee_applied')
      .eq('user_id', user.id)
      .gte('push_date', since);
    if (pushErr) throw pushErr;

    // 3. 退费有效性：refund 的 tid 是否有实扣记录（不限日期）
    const refundTids = new Set<string>();
    for (const l of lines ?? []) {
      if (l.kind === 'refund' && l.tid) refundTids.add(l.tid);
    }
    const chargedTids = new Set<string>();
    if (refundTids.size > 0) {
      const tidList = Array.from(refundTids);
      for (let i = 0; i < tidList.length; i += 50) {
        const { data: charged } = await supabase
          .from('fangguo_transactions')
          .select('tid')
          .eq('kind', 'charge')
          .in('tid', tidList.slice(i, i + 50));
        for (const c of charged ?? []) if (c.tid) chargedTids.add(c.tid);
      }
    }

    // 4. 日结扣款流水（wallet_transactions 描述前缀「日结 YYYY-MM-DD」，含主结算+补扣/补退）
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

    // 5. 按日聚合
    const groups = new Map<
      string,
      {
        date: string;
        push_count: number;
        charge: number;
        refund: number;
        allSettled: boolean;
      }
    >();
    const getGroup = (date: string) => {
      let g = groups.get(date);
      if (!g) {
        g = { date, push_count: 0, charge: 0, refund: 0, allSettled: true };
        groups.set(date, g);
      }
      return g;
    };

    for (const l of lines ?? []) {
      if (l.kind !== 'charge' && l.kind !== 'refund') continue;
      const g = getGroup(l.settle_date);
      const amount = parseFloat(l.processed_amount as string);
      if (l.kind === 'charge' && amount < 0) g.charge += amount;
      else if (l.kind === 'refund' && amount > 0 && l.tid && chargedTids.has(l.tid)) {
        g.refund += amount;
      }
      if (!l.settled) g.allSettled = false;
    }
    for (const p of pushes ?? []) {
      const g = getGroup(p.push_date);
      g.push_count += 1;
      if (!p.fee_applied) g.allSettled = false;
    }

    const list = [...groups.values()]
      .map((g) => {
        const materialFreight = parseFloat((g.charge + g.refund).toFixed(2));
        const pushFee = parseFloat((g.push_count * PUSH_FEE).toFixed(2));
        const settled = settledByDate.get(g.date);
        return {
          date: g.date,
          push_count: g.push_count,
          push_fee: pushFee,
          charge: parseFloat(g.charge.toFixed(2)),
          refund: parseFloat(g.refund.toFixed(2)),
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
