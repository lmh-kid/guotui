import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';
import { shanghaiDateStr } from '@/lib/daily-settlement';
import { getUserShopNames } from '@/lib/push-billing';
import { PUSH_FEE } from '@/lib/billing';

/**
 * 资金明细（普通用户，只读展示，按订单号聚合）
 * GET /api/wallet/fangguo-lines?days=1
 *
 * 布局对齐方果后台资金明细：一个订单号一行，费用分列展示
 * - 材料费：预扣转实扣（打包发货时实扣）
 * - 运费：扣费·非订单推送（发货后实扣）
 * - 手动扣费：推单服务费 ¥0.50/单，从推单记录合成展示，
 *   仅展示层合成不入库（实际扣款在日结统一结算）
 * - 材料退回/运费退回：退费冲抵
 * - 预扣冻结：订单推送时的材料费预扣（非实扣，不计入合计）
 *
 * 数据源均为本地库已同步数据（日结任务/手动结算时同步，近 7 天窗口）
 */
interface OrderRow {
  order_no: string; // 订单号（方果 tid；充值等无订单流水为空）
  time: string; // 计费时间（该订单最近一次流水时间，统一 UTC ISO）
  store_name: string | null;
  recharge: number;
  material: number;
  freight: number;
  manual: number;
  material_refund: number;
  freight_refund: number;
  prehold: number; // 预扣冻结（不计入合计）
  total: number; // 合计 = 材料费 + 运费 - 退回 + 手动扣费
  has_push: boolean;
}

// 时间统一转 UTC ISO（流水为 UTC ISO、推单 created_at 为 +08:00 带纳秒格式，直接字符串比较会错序）
const iso = (t?: string | null): string => (t ? new Date(t).toISOString() : '');

export async function GET(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { user, error: authError } = await getCurrentUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: authError || '认证失败' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const daysRaw = parseInt(searchParams.get('days') || '1', 10);
  const days = Math.min(90, Math.max(1, daysRaw)); // 默认展示当天

  try {
    const supabase = await getSupabaseAdminClient();
    const since = shanghaiDateStr(Date.now() - (days - 1) * 86400_000);

    // 0. 补归属：店铺刚分配时，历史同步的流水 user_id 仍为空，
    //    这里把「店铺名属于本用户但未归属」的流水就地补填（幂等，只填空不覆盖），
    //    避免等下一次日结同步才能看到数据
    const myShops = await getUserShopNames(user.id);
    if (myShops.length > 0) {
      await supabase
        .from('fangguo_transactions')
        .update({ user_id: user.id })
        .is('user_id', null)
        .in('store_name', myShops);
    }

    // 1. 方果流水（本用户）
    const { data: lines, error: linesErr } = await supabase
      .from('fangguo_transactions')
      .select(
        'id, tid, kind, fee_type, fee_name_type, business_node, processed_amount, store_name, transaction_time'
      )
      .eq('user_id', user.id)
      .gte('settle_date', since)
      .order('transaction_time', { ascending: false });
    if (linesErr) throw linesErr;

    // 2. 推单记录（手动扣费 ¥0.50 展示，仅展示不入库）
    const { data: pushes, error: pushErr } = await supabase
      .from('push_records')
      .select('order_no, push_date, created_at')
      .eq('user_id', user.id)
      .gte('push_date', since);
    if (pushErr) throw pushErr;

    // 3. 按订单号聚合：一个订单一行
    const rowMap = new Map<string, OrderRow>();
    const noOrderRows: OrderRow[] = []; // 无订单号流水（充值等）

    const getRow = (key: string, time: string, store: string | null): OrderRow => {
      let r = rowMap.get(key);
      if (!r) {
        r = {
          order_no: key,
          time: iso(time),
          store_name: store,
          recharge: 0,
          material: 0,
          freight: 0,
          manual: 0,
          material_refund: 0,
          freight_refund: 0,
          prehold: 0,
          total: 0,
          has_push: false,
        };
        rowMap.set(key, r);
      }
      return r;
    };

    for (const l of lines ?? []) {
      const amount = parseFloat(l.processed_amount as string);
      const abs = Math.abs(amount);
      const name = String(l.fee_name_type ?? '');
      const kind = String(l.kind);
      const t = iso(l.transaction_time);
      const store = l.store_name ?? null;
      const tid = l.tid && String(l.tid).length > 0 ? String(l.tid) : null;

      if (!tid) {
        // 充值等无订单流水：独立一行
        const row: OrderRow = {
          order_no: '',
          time: t,
          store_name: store,
          recharge: kind === 'exclude' ? amount : 0,
          material: 0,
          freight: 0,
          manual: 0,
          material_refund: 0,
          freight_refund: 0,
          prehold: 0,
          total: kind === 'exclude' ? amount : 0,
          has_push: false,
        };
        if (kind !== 'exclude') {
          row.total = abs; // 未知无单流水按扣款展示
          row.material = abs;
        }
        noOrderRows.push(row);
        continue;
      }

      const row = getRow(tid, t, store);
      if (t > row.time) row.time = t; // 计费时间取最近一笔

      if (kind === 'charge') {
        if (name.includes('材料')) row.material += abs;
        else row.freight += abs;
      } else if (kind === 'refund') {
        if (name.includes('材料')) row.material_refund += abs;
        else row.freight_refund += abs;
      } else if (kind === 'prehold') {
        row.prehold += abs; // 冻结，不计入合计
      }
      // unknown 不入账（与日结口径一致），可在每日对账中查看
    }

    // 4. 手动扣费：每笔推单 ¥0.50 并入对应订单行（仅展示）
    for (const p of pushes ?? []) {
      const key = String(p.order_no);
      const t = iso(p.created_at);
      const row = getRow(key, t, null);
      row.manual = PUSH_FEE;
      row.has_push = true;
      if (t > row.time) row.time = t;
    }

    // 5. 合计
    const list: OrderRow[] = [];
    for (const row of rowMap.values()) {
      row.total =
        Math.round(
          (row.material + row.freight + row.manual - row.material_refund - row.freight_refund) *
            100
        ) / 100;
      list.push(row);
    }
    list.push(...noOrderRows);
    list.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));

    // 6. 汇总
    let totalMaterial = 0;
    let totalFreight = 0;
    let totalRefund = 0;
    let totalManual = 0;
    let pushCount = 0;
    let totalAmount = 0;
    for (const r of list) {
      totalMaterial += r.material;
      totalFreight += r.freight;
      totalRefund += r.material_refund + r.freight_refund;
      totalManual += r.manual;
      if (r.has_push) pushCount += 1;
      if (r.order_no !== '' || r.recharge > 0) totalAmount += r.total;
    }

    return NextResponse.json({
      list,
      total: list.length,
      summary: {
        totalMaterial: parseFloat(totalMaterial.toFixed(2)),
        totalFreight: parseFloat(totalFreight.toFixed(2)),
        totalRefund: parseFloat(totalRefund.toFixed(2)),
        totalManual: parseFloat(totalManual.toFixed(2)),
        totalAmount: parseFloat(totalAmount.toFixed(2)),
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
