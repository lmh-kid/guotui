import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import {
  pushFangguoOrders,
  fetchFangguoOrderDetail,
  isVoidedOrder,
  FangguoApiError,
} from "@/lib/fangguo";
import {
  settleUser,
  getPushBillingStats,
  recordPushes,
  getUserShopNames,
} from "@/lib/push-billing";
import { PUSH_FEE } from "@/lib/billing";

/**
 * 批量订单推单（实时透传，订单不落库）
 * Body: { order_nos: string[] }  （方果平台订单号 tid 数组）
 *
 * 流程: 惰性日结算 → 负余额禁推 → 实时校验归属/状态 → 配额预检 → 方果批量推单 → 记录 push_records
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get("x-session");
  const { user, error: authError } = await getCurrentUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: authError || "认证失败" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { order_nos } = body as { order_nos: string[] };

    if (!Array.isArray(order_nos) || order_nos.length === 0) {
      return NextResponse.json({ error: "请选择要推送的订单" }, { status: 400 });
    }

    // 1. 惰性日结算
    await settleUser(user.id);

    // 2. 计费状态
    const billing = await getPushBillingStats(user.id);
    if (billing.blocked) {
      return NextResponse.json(
        { error: `余额为负（¥${billing.balance.toFixed(2)}），请联系管理员补调后再推单` },
        { status: 403 }
      );
    }

    // 3. 店铺归属
    const shopNames = await getUserShopNames(user.id);
    if (shopNames.length === 0) {
      return NextResponse.json({ error: "您暂未分配店铺，请联系管理员" }, { status: 403 });
    }
    const shopSet = new Set(shopNames);

    // 4. 逐单实时校验（并发）
    const details = await Promise.allSettled(
      order_nos.map((tid) => fetchFangguoOrderDetail(tid))
    );

    const pushable: string[] = [];
    let skipped = 0;
    const notOwned: string[] = [];

    for (const d of details) {
      if (d.status !== "fulfilled") {
        skipped += 1; // 详情拉取失败
        continue;
      }
      const detail = d.value;
      if (!shopSet.has(detail.storeName ?? "")) {
        notOwned.push(detail.tid);
        continue;
      }
      if (detail.dfStatus === 1 && !isVoidedOrder(detail)) {
        pushable.push(detail.tid);
      } else {
        skipped += 1; // 非待推送状态，或已作废（平台交易关闭）
      }
    }

    if (pushable.length === 0) {
      return NextResponse.json(
        { error: `没有可推送的订单（仅方果「待推送」状态可推，跳过 ${skipped} 单）` },
        { status: 400 }
      );
    }

    // 5. 配额预检
    if (billing.availableQuota < pushable.length) {
      return NextResponse.json(
        {
          error: `余额仅可再推 ${billing.availableQuota} 单（余额 ¥${billing.balance.toFixed(2)}，今日已推 ${billing.todayUnsettled} 单未结算），本次选择 ${pushable.length} 单，请减少单量或充值`,
        },
        { status: 400 }
      );
    }

    // 6. 调方果批量推单
    try {
      await pushFangguoOrders(pushable);
    } catch (e) {
      const msg = e instanceof FangguoApiError ? e.message : "方果推单接口调用失败";
      return NextResponse.json({ error: `方果推单失败: ${msg}` }, { status: 400 });
    }

    // 7. 记录推单（日结算依据）
    const recorded = await recordPushes(user.id, pushable);

    const newBilling = await getPushBillingStats(user.id);

    return NextResponse.json({
      success: true,
      message: `成功推送 ${pushable.length} 单（费用 ¥${(pushable.length * PUSH_FEE).toFixed(2)} 将于次日日结算；今日已推 ${newBilling.todayPushed} 单）`,
      pushedCount: pushable.length,
      recordedCount: recorded,
      skippedCount: skipped,
      billing: newBilling,
    });
  } catch (err: unknown) {
    if (err instanceof FangguoApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "批量推单失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
