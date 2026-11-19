import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import {
  pushFangguoOrders,
  fetchFangguoOrderDetail,
  isVoidedOrder,
  FangguoApiError,
} from "@/lib/fangguo";
import { settleUser, getPushBillingStats, recordPushes, getUserShopNames } from "@/lib/push-billing";
import { PUSH_FEE } from "@/lib/billing";

/**
 * 单条订单推单（实时透传，订单不落库）
 * 路由参数 id = 方果平台订单号 tid
 *
 * 流程: 惰性日结算 → 负余额禁推 → 实时校验归属/状态 → 配额预检 → 方果推单 → 记录 push_records
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = req.headers.get("x-session");
  const { user, error: authError } = await getCurrentUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: authError || "认证失败" }, { status: 401 });
  }

  const { id: tid } = await params;

  try {
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

    // 4. 实时拉取订单详情校验
    const detail = await fetchFangguoOrderDetail(tid);
    if (!shopNames.includes(detail.storeName ?? "")) {
      return NextResponse.json({ error: "订单不存在或不属于您的店铺" }, { status: 404 });
    }

    // 4.5 已作废拦截（平台交易关闭的单 dfStatus 可能仍为 1，必须显式拦截）
    if (isVoidedOrder(detail)) {
      return NextResponse.json(
        { error: `订单已作废（平台状态「${detail.outerOrderStatusDesc || "交易关闭"}」），无法推送` },
        { status: 400 }
      );
    }

    if (detail.dfStatus !== 1) {
      const statusText: Record<number, string> = {
        0: "待整理",
        1: "待推送",
        2: "已反审",
        3: "工厂待审",
        4: "生产中",
        5: "已打包",
      };
      return NextResponse.json(
        { error: `方果侧订单状态为「${statusText[detail.dfStatus] ?? detail.dfStatus}」，仅「待推送」状态可推送` },
        { status: 400 }
      );
    }

    // 5. 配额预检
    if (billing.availableQuota < 1) {
      return NextResponse.json(
        {
          error: `今日可推单数已用尽（余额 ¥${billing.balance.toFixed(2)}，今日已推 ${billing.todayPushed} 单未结算 ¥${billing.unsettledAmount.toFixed(2)}），请充值或明日结算后再推`,
        },
        { status: 400 }
      );
    }

    // 6. 调方果推单
    try {
      await pushFangguoOrders([tid]);
    } catch (e) {
      const msg = e instanceof FangguoApiError ? e.message : "方果推单接口调用失败";
      return NextResponse.json({ error: `方果推单失败: ${msg}` }, { status: 400 });
    }

    // 7. 记录推单（日结算依据）
    await recordPushes(user.id, [tid]);

    const newBilling = await getPushBillingStats(user.id);

    return NextResponse.json({
      success: true,
      message: `推单成功（今日已推 ${newBilling.todayPushed} 单，费用 ¥${(newBilling.todayPushed * PUSH_FEE).toFixed(2)} 将于次日结算）`,
      billing: newBilling,
    });
  } catch (err: unknown) {
    if (err instanceof FangguoApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "推单失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
