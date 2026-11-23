import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';
import {
  shanghaiDateStr,
  getSettlementStartDate,
  buildUserLedger,
  shTimeLocal,
} from '@/lib/daily-settlement';
import { getUserShopNames } from '@/lib/push-billing';
import { PUSH_FEE } from '@/lib/billing';

/**
 * 资金明细（普通用户，只读展示，按订单号聚合）
 * GET /api/wallet/fangguo-lines?days=1
 *
 * 布局对齐方果后台资金明细：一个订单号一行，费用分列展示
 * - 材料费：预扣即扣款——按订单取「实扣（预扣转实扣）总额 vs 预扣总额」绝对值较大者
 *   （未发货计预扣冻结额、已发货计实扣，两阶段同一笔钱不双计），材料退费冲抵
 * - 运费：发货实扣、退费冲抵；跟随该订单整体归属**推送日**，不按发货账期拆行
 * - 手动扣费：每笔订单 ¥0.50 推单服务费，按推送日归属（含方果后台直推；推送日按
 *   「扣费·订单推送」预扣流水最早 settle_date 判定），展示层合成不入库
 * - 合计 = 材料费 + 运费 + 手动扣费
 *
 * 与日结扣款同源：账本由 src/lib/daily-settlement.ts 的 buildUserLedger() 统一构建，
 * 日结按「订单归属日」聚合同一账本扣款 → **每天的明细合计 ≡ 该天扣款金额**。
 *
 * 计费时间口径（与方果后台对齐）：行的 time 取「推单时刻」（最早一笔预扣流水的
 * transaction_time），而非发货转实扣时刻；行整体归属推送日账期（预扣 settle_date），
 * 推送日不在查询窗口内的行不展示（昨日推、今日发货的单归昨日，不出现在当天列表）
 *
 * 数据源均为本地库已同步数据（日结任务/手动结算时同步，近 7 天窗口）
 */
interface OrderRow {
  order_no: string; // 订单号（方果 tid；充值等无订单流水为空）
  time: string; // 计费时间 = 推单时刻（最早预扣流水时间，上海本地时间，与方果一致）
  store_name: string | null;
  recharge: number;
  material: number; // 材料费净额（实扣或预扣 - 退回）
  freight: number; // 运费净额（实扣 - 退回）
  manual: number; // 手动扣费 ¥0.50/单（仅展示）
  material_refund: number; // 材料退回（信息展示）
  freight_refund: number; // 运费退回（信息展示）
  total: number; // 合计 = 材料费 + 运费 + 手动扣费
}

const round2 = (x: number) => Math.round(x * 100) / 100;

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
    const startDate = await getSettlementStartDate();

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

    // 1. 订单账本（与日结扣款同源：统一由 buildUserLedger 构建）
    const ledger = await buildUserLedger(user.id, startDate);

    // 2. 无订单号流水（充值 / 未知类型）：单独成行，不进订单账本
    const { data: noTidLines, error: noTidErr } = await supabase
      .from('fangguo_transactions')
      .select('kind, processed_amount, store_name, settle_date, transaction_time')
      .eq('user_id', user.id)
      .is('tid', null)
      .gte('settle_date', since)
      .order('transaction_time', { ascending: false });
    if (noTidErr) throw noTidErr;

    const list: OrderRow[] = [];
    for (const l of noTidLines ?? []) {
      const kind = String(l.kind);
      const amount = parseFloat(l.processed_amount as string);
      const abs = Math.abs(amount);
      const row: OrderRow = {
        order_no: '',
        time: shTimeLocal(l.transaction_time),
        store_name: l.store_name ?? null,
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
      list.push(row);
    }

    // 3. 订单行：整行（材料费 + 运费 + 服务费）归属推送日，与日结逐日严格对齐
    for (const r of ledger) {
      if (r.date < since) continue; // 归属日不在查询窗口内不展示
      const material = round2(r.materialGross - r.materialRefund);
      const freight = round2(r.freightGross - r.freightRefund);
      list.push({
        order_no: r.order_no,
        time: r.time,
        store_name: r.store_name,
        recharge: 0,
        material,
        freight,
        manual: r.pushFee,
        material_refund: r.materialRefund,
        freight_refund: r.freightRefund,
        total: round2(material + freight + r.pushFee),
      });
    }

    list.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));

    // 4. 汇总
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
