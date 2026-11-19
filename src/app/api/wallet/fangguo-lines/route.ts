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
 * - 材料费：预扣即扣款——按订单取「实扣（预扣转实扣）总额 vs 预扣总额」绝对值较大者
 *   （未发货计预扣冻结额、已发货计实扣，两阶段同一笔钱不双计），退费统一冲抵进材料费
 * - 运费：发货实扣，退费冲抵
 * - 手动扣费：每笔订单 ¥0.50 推单服务费，按推送日归属账期（昨日推送今日发货的单记昨日，
 *   含方果后台直推；推送日按「扣费·订单推送」预扣流水最早 settle_date 判定），
 *   展示层合成不入库（实际扣款在日结统一结算）
 * - 合计 = 材料费 + 运费 + 手动扣费
 *
 * 数据源均为本地库已同步数据（日结任务/手动结算时同步，近 7 天窗口）
 */
interface OrderRow {
  order_no: string; // 订单号（方果 tid；充值等无订单流水为空）
  time: string; // 计费时间（该订单最近一次流水时间，统一 UTC ISO）
  store_name: string | null;
  recharge: number;
  material: number; // 材料费净额（实扣或预扣 - 退回）
  freight: number; // 运费净额（实扣 - 退回）
  manual: number; // 手动扣费 ¥0.50/单（仅展示）
  material_refund: number; // 材料退回（信息展示）
  freight_refund: number; // 运费退回（信息展示）
  total: number; // 合计 = 材料费 + 运费 + 手动扣费
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

    // 2. 按订单号聚合原始流水
    interface Acc {
      time: string;
      store: string | null;
      chargeMat: number; // 实扣材料费（预扣转实扣）
      preholdMat: number; // 预扣材料费（订单推送冻结，未发货时回退展示）
      refundMat: number; // 材料退回
      chargeFrt: number; // 实扣运费
      refundFrt: number; // 运费退回
    }
    const accMap = new Map<string, Acc>();
    const noOrderRows: OrderRow[] = []; // 无订单号流水（充值等）

    const getAcc = (key: string, time: string, store: string | null): Acc => {
      let a = accMap.get(key);
      if (!a) {
        a = {
          time,
          store,
          chargeMat: 0,
          preholdMat: 0,
          refundMat: 0,
          chargeFrt: 0,
          refundFrt: 0,
        };
        accMap.set(key, a);
      }
      if (time > a.time) a.time = time; // 计费时间取最近一笔
      if (store && !a.store) a.store = store;
      return a;
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
          total: kind === 'exclude' ? amount : 0,
        };
        if (kind !== 'exclude') {
          row.total = abs; // 未知无单流水按扣款展示
          row.material = abs;
        }
        noOrderRows.push(row);
        continue;
      }

      const acc = getAcc(tid, t, store);

      if (kind === 'charge') {
        if (name.includes('材料')) acc.chargeMat += abs;
        else acc.chargeFrt += abs;
      } else if (kind === 'refund') {
        if (name.includes('材料')) acc.refundMat += abs;
        else acc.refundFrt += abs;
      } else if (kind === 'prehold') {
        acc.preholdMat += abs; // 推送冻结，未发货时作为材料费展示
      }
      // unknown 不入账（与日结口径一致），可在每日对账中查看
    }

    // 3. 推单服务费归属推送日账期：查窗口内订单的「扣费·订单推送」预扣流水（推送
    //    动作），取每单最早 settle_date（=首次推送日）。昨日推送今日发货的单，其
    //    ¥0.50 记昨日账上，与日结口径完全对齐（消除跨日错位）
    const preholdDateByTid = new Map<string, string>();
    const tids = [...accMap.keys()];
    for (let i = 0; i < tids.length; i += 50) {
      const batch = tids.slice(i, i + 50);
      const { data: preholds, error: preErr } = await supabase
        .from('fangguo_transactions')
        .select('tid, settle_date')
        .eq('user_id', user.id)
        .eq('kind', 'prehold')
        .in('tid', batch);
      if (preErr) throw preErr;
      for (const ph of preholds ?? []) {
        const tid = String(ph.tid ?? '');
        const d = String(ph.settle_date ?? '');
        if (!tid || !d) continue;
        const prev = preholdDateByTid.get(tid);
        if (!prev || d < prev) preholdDateByTid.set(tid, d); // 取最早 = 首次推送日
      }
    }

    // 4. 生成行：材料费不分 feeType（有实扣取实扣，未发货回退预扣，退费冲抵）；
    //    每笔订单加 ¥0.50 手动扣费（仅展示，按推送日归属账期）；合计 = 材料费 + 运费 + 手动扣费
    const round2 = (x: number) => Math.round(x * 100) / 100;
    const list: OrderRow[] = [];
    for (const [tid, a] of accMap) {
      // 推单服务费 ¥0.50 归属推送日账期：推送日在查询窗口内才计（含方果后台直推），
      // 昨日推送今日发货的单的 0.5 记昨日，不重复计入今日
      const preholdDate = preholdDateByTid.get(tid);
      const manual = preholdDate && preholdDate >= since ? PUSH_FEE : 0;
      const row: OrderRow = {
        order_no: tid,
        time: a.time,
        store_name: a.store,
        recharge: 0,
        // 预扣与实扣是同一笔钱的两个阶段：取绝对值较大者（未发货计预扣、已发货计实扣）
        material: round2(Math.max(a.chargeMat, a.preholdMat) - a.refundMat),
        freight: round2(a.chargeFrt - a.refundFrt),
        manual,
        material_refund: round2(a.refundMat),
        freight_refund: round2(a.refundFrt),
        total: 0,
      };
      row.total = round2(row.material + row.freight + row.manual);
      list.push(row);
    }
    list.push(...noOrderRows);
    list.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));

    // 5. 汇总
    let totalMaterial = 0;
    let totalFreight = 0;
    let totalRefund = 0;
    let totalManual = 0;
    let orderCount = 0;
    let totalAmount = 0;
    for (const r of list) {
      totalMaterial += r.material;
      totalFreight += r.freight;
      totalRefund += r.material_refund + r.freight_refund;
      totalManual += r.manual;
      if (r.manual > 0) orderCount += 1; // 推单数 = 计入服务费的单（推送日归属窗口内）
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
        pushCount: orderCount,
        feePerOrder: PUSH_FEE,
      },
      days,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '查询资金明细失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
