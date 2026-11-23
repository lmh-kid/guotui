import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';
import { PUSH_FEE } from '@/lib/billing';
import { shanghaiDateStr, getSettlementStartDate, buildUserLedger } from '@/lib/daily-settlement';

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

    // 4. 聚合 (user, date) —— 与资金明细、日结扣款同源（buildUserLedger 账本）
    //    归属日 = 订单推送日：材料 max(预扣, 实扣) − 材料退费 + 运费实扣 − 运费退费
    //    + 0.5 服务费，全部记入推送日账期（每日合计 = 该日资金明细合计 = 日结扣款）
    const groups = new Map<
      string,
      {
        user_id: string;
        account: string;
        date: string;
        pushCount: number;
        materialGross: number;
        freightGross: number;
        refund: number;
        lineCount: number;
        pending: boolean;
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
          pushCount: 0,
          materialGross: 0,
          freightGross: 0,
          refund: 0,
          lineCount: 0,
          pending: false,
        };
        groups.set(key, g);
      }
      return g;
    };

    // 4.1 未结算数据（判断账期是否结清）
    const { data: unsettledLines } = userIds.size
      ? await supabase
          .from('fangguo_transactions')
          .select('user_id, tid')
          .eq('settled', false)
          .in('user_id', Array.from(userIds))
          .limit(5000)
      : { data: [] as Array<{ user_id: string | null; tid: string | null }> };
    const unsettledTids = new Map<string, Set<string>>();
    for (const l of unsettledLines ?? []) {
      if (!l.user_id || !l.tid) continue;
      const set = unsettledTids.get(l.user_id) ?? new Set<string>();
      set.add(String(l.tid));
      unsettledTids.set(l.user_id, set);
    }

    // 4.2 逐用户构建账本并按归属日聚合
    const ledgerKeys = new Set<string>();
    for (const userId of userIds) {
      let ledger;
      try {
        ledger = await buildUserLedger(userId, startDate);
      } catch {
        continue;
      }
      const un = unsettledTids.get(userId);
      for (const row of ledger) {
        ledgerKeys.add(`${userId}|${row.date}|${row.order_no}`);
        if (row.date < effectiveSince) continue;
        const g = getGroup(userId, row.date);
        g.materialGross += row.materialGross;
        g.freightGross += row.freightGross;
        g.refund += row.materialRefund + row.freightRefund;
        g.lineCount += 1;
        if (row.pushFee > 0) g.pushCount += 1;
        if (un && un.has(row.order_no)) g.pending = true;
      }
    }
    // 4.3 兜底：流水尚未同步的系统推单（push_records 有、账本无）
    for (const p of pushes ?? []) {
      if (!p.order_no || !p.user_id) continue;
      const g = getGroup(p.user_id, p.push_date);
      if (ledgerKeys.has(`${p.user_id}|${p.push_date}|${p.order_no}`)) {
        if (!p.fee_applied) g.pending = true;
        continue;
      }
      g.pushCount += 1;
      g.lineCount += 1;
      if (!p.fee_applied) g.pending = true;
    }

    const list = [...groups.values()]
      .map((g) => {
        const pushFee = parseFloat((g.pushCount * PUSH_FEE).toFixed(2));
        const chargeTotal = parseFloat((-(g.materialGross + g.freightGross)).toFixed(2));
        const refundTotal = parseFloat(g.refund.toFixed(2));
        const materialFreight = parseFloat((chargeTotal + refundTotal).toFixed(2));
        return {
          user_id: g.user_id,
          account: g.account,
          date: g.date,
          push_count: g.pushCount,
          push_fee: pushFee,
          charge: chargeTotal,
          refund: refundTotal,
          material_freight: materialFreight,
          total: parseFloat((materialFreight - pushFee).toFixed(2)),
          allSettled: !g.pending,
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
