import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';
import { PUSH_FEE } from '@/lib/billing';
import { shanghaiDateStr, getSettlementStartDate } from '@/lib/daily-settlement';

/**
 * 日结账单查询（管理员）
 * GET /api/admin/settlement/records?days=7
 *
 * 按 用户 × 账期 聚合：
 * - push_count / push_fee: 当日全部推送订单数（含方果直推，按「扣费·订单推送」预扣流水去重 tid；
 *   当天流水未同步时由 push_records 兜底）与 0.5 服务费
 * - charge: 入账扣费合计（负）：材料费按订单 tid 取「预扣 vs 实扣」绝对值较大者
 *   （预扣即扣款，发货转实扣只是状态确认）+ 运费等实扣
 * - refund: 退费合计（正，无条件冲抵：预扣已入账，取消推送必须退回）
 * - material_freight: charge + refund（当日材运费净额）
 * - total: 日结总金额（负=扣费）
 * - settled: 该组流水是否已结算
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { isAdmin, error: adminError } = await requireAdminRequest(token);

  if (adminError || !isAdmin) {
    return NextResponse.json({ error: adminError || '需要管理员权限' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const daysRaw = parseInt(searchParams.get('days') || '7', 10);
  const days = Math.min(31, Math.max(1, daysRaw));

  try {
    const supabase = await getSupabaseAdminClient();
    const since = shanghaiDateStr(Date.now() - days * 86400_000);

    // 起始日之前的历史流水已标记跳过不入账，账单同样排除（避免展示误导）
    const startDate = await getSettlementStartDate();
    const effectiveSince =
      startDate && startDate > since ? startDate : since;

    // 1. 资金流水（范围内全量，含未归属）
    const { data: lines, error: linesErr } = await supabase
      .from('fangguo_transactions')
      .select('id, user_id, tid, kind, processed_amount, settle_date, settled, store_name, fee_name_type')
      .gte('settle_date', effectiveSince)
      .order('settle_date', { ascending: false });
    if (linesErr) throw linesErr;

    // 2. 推单记录（当天流水未同步时的兜底计数来源）
    const { data: pushes, error: pushErr } = await supabase
      .from('push_records')
      .select('user_id, push_date, fee_applied, order_no')
      .gte('push_date', effectiveSince);
    if (pushErr) throw pushErr;

    // 3. 账号映射
    const userIds = new Set<string>();
    for (const l of lines ?? []) if (l.user_id) userIds.add(l.user_id);
    for (const p of pushes ?? []) userIds.add(p.user_id);
    const { data: users } = userIds.size
      ? await supabase
          .from('auth_accounts')
          .select('user_id, account')
          .in('user_id', Array.from(userIds))
      : { data: [] };
    const accountMap = new Map((users ?? []).map((u) => [u.user_id, u.account]));

    // 4. 聚合 (user, date)
    //    材运费口径：预扣即扣款——材料费按订单 tid 聚合，取「预扣总额 vs 实扣总额」
    //    绝对值较大者（两阶段同一笔钱，避免双计/漏计）；退费无条件冲抵
    //    推单数口径：当天全部推送订单，含方果直推
    const groups = new Map<
      string,
      {
        user_id: string;
        account: string;
        date: string;
        pushedTids: Set<string>;
        matByTid: Map<string, { prehold: number; charge: number }>;
        freight: number; // 运费等非材料实扣（负）
        refund: number; // 退费（正，无条件冲抵）
        allSettled: boolean;
        lineCount: number;
      }
    >();
    const getGroup = (userId: string, date: string) => {
      const key = `${userId}|${date}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          user_id: userId,
          account: accountMap.get(userId) ?? userId.slice(0, 8),
          date,
          pushedTids: new Set(),
          matByTid: new Map(),
          freight: 0,
          refund: 0,
          allSettled: true,
          lineCount: 0,
        };
        groups.set(key, g);
      }
      return g;
    };

    for (const l of lines ?? []) {
      if (!l.user_id) continue; // 未归属流水单独统计
      const g = getGroup(l.user_id, l.settle_date);
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
        g.lineCount += 1;
        if (tid && name.includes('材料')) {
          const a = g.matByTid.get(tid) ?? { prehold: 0, charge: 0 };
          a.charge += abs;
          g.matByTid.set(tid, a);
        } else {
          g.freight -= abs;
        }
      } else if (l.kind === 'refund' && amount > 0) {
        g.lineCount += 1;
        g.refund += amount; // 无条件冲抵（预扣已入账，取消推送必须退回）
      }
      if (!l.settled) g.allSettled = false;
    }
    for (const p of pushes ?? []) {
      if (!p.order_no) continue;
      const g = getGroup(p.user_id, p.push_date);
      // 兜底：当天流水尚未同步时，系统推单记录仍计入（直推单靠流水，Set 去重合并）
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
        return {
          user_id: g.user_id,
          account: g.account,
          date: g.date,
          push_count: pushCount,
          push_fee: pushFee,
          charge: chargeTotal,
          refund: refundTotal,
          material_freight: materialFreight,
          total: parseFloat((materialFreight - pushFee).toFixed(2)),
          allSettled: g.allSettled,
          lineCount: g.lineCount,
        };
      })
      .sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : a.account.localeCompare(b.account)
      );

    // 5. 未归属流水（店铺未分配用户，不入账）
    const unassigned = (lines ?? []).filter((l) => !l.user_id);
    const unassignedStores = [
      ...new Set(unassigned.map((l) => l.store_name).filter(Boolean)),
    ];

    // 6. 方果对账维度：全部流水（含未归属）按账期聚合，与方果后台账单每日金额核对
    //    方果账单资金明细里材料费 = 预扣（未发货）+ 实扣（已发货），故 prehold 单列展示，
    //    net = charge + refund + prehold（近似方果「合计」列；同一单预扣转实扣后会重复，
    //    精确计费口径以 list 为准）
    const fangguoDailyMap = new Map<
      string,
      {
        date: string;
        charge: number;
        refund: number;
        prehold: number;
        unassignedCount: number;
        lines: number;
      }
    >();
    for (const l of lines ?? []) {
      let d = fangguoDailyMap.get(l.settle_date);
      if (!d) {
        d = {
          date: l.settle_date,
          charge: 0,
          refund: 0,
          prehold: 0,
          unassignedCount: 0,
          lines: 0,
        };
        fangguoDailyMap.set(l.settle_date, d);
      }
      d.lines += 1;
      const amount = parseFloat(l.processed_amount as string);
      if (l.kind === 'charge') d.charge += amount;
      else if (l.kind === 'refund') d.refund += amount;
      else if (l.kind === 'prehold') d.prehold += amount;
      if (!l.user_id) d.unassignedCount += 1;
    }
    const fangguoDaily = [...fangguoDailyMap.values()]
      .map((d) => ({
        ...d,
        charge: parseFloat(d.charge.toFixed(2)),
        refund: parseFloat(d.refund.toFixed(2)),
        prehold: parseFloat(d.prehold.toFixed(2)),
        net: parseFloat((d.charge + d.refund + d.prehold).toFixed(2)),
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    const summary = {
      totalAmount: parseFloat(list.reduce((s, g) => s + g.total, 0).toFixed(2)),
      totalPush: list.reduce((s, g) => s + g.push_count, 0),
      totalMaterialFreight: parseFloat(
        list.reduce((s, g) => s + g.material_freight, 0).toFixed(2)
      ),
      unsettledGroups: list.filter((g) => !g.allSettled).length,
      unassignedLines: unassigned.length,
      unassignedStores,
    };

    return NextResponse.json({
      list,
      summary,
      fangguoDaily,
      feePerOrder: PUSH_FEE,
      settlementStartDate: startDate,
      days,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '查询日结账单失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
