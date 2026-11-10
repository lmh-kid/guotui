import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, ensureUserBalance } from "@/lib/auth-utils";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { pushFangguoOrders, FangguoApiError } from "@/lib/fangguo";
import { chargeUser, PUSH_FEE } from "@/lib/billing";

/**
 * 批量订单推单（真实调方果 API）
 * 流程: 过滤可推订单 → 批量调方果 /order/push → 按实际成功数扣费 → 更新状态
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get("x-session");
  const { user, error: authError } = await getCurrentUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: authError || "认证失败" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { order_ids } = body as { order_ids: string[] };

    if (!order_ids || order_ids.length === 0) {
      return NextResponse.json({ error: "请选择要推送的订单" }, { status: 400 });
    }

    const client = getSupabaseClient(token ?? undefined);
    await ensureUserBalance(user.id, client);

    // 查询订单
    const { data: orders, error: ordersError } = await client
      .from("orders")
      .select("id, order_no, status, df_status")
      .in("id", order_ids)
      .eq("user_id", user.id);

    if (ordersError) throw ordersError;

    // 过滤可推送订单: 非 pushed/production/shipped，且方果状态为待推送(1)或未知(兼容手工单)
    const pushableOrders =
      orders?.filter((o) => {
        if (["pushed", "production", "shipped"].includes(o.status)) return false;
        if (o.df_status != null && o.df_status !== 1) return false;
        return true;
      }) || [];

    if (pushableOrders.length === 0) {
      return NextResponse.json(
        { error: "没有可推送的订单（仅方果「待推送」状态可推）" },
        { status: 400 }
      );
    }

    // 余额预检查
    const totalFee = pushableOrders.length * PUSH_FEE;
    const adminClient = getSupabaseClient();
    const { data: balanceData } = await adminClient
      .from("user_balances")
      .select("balance")
      .eq("user_id", user.id)
      .single();
    const balance = parseFloat((balanceData?.balance as string) ?? "0");
    if (balance < totalFee) {
      return NextResponse.json(
        { error: `余额不足，需 ${totalFee.toFixed(2)} 元（${pushableOrders.length} 单），当前 ${balance.toFixed(2)} 元` },
        { status: 400 }
      );
    }

    // 调方果批量推单
    try {
      await pushFangguoOrders(pushableOrders.map((o) => o.order_no));
    } catch (e) {
      const msg = e instanceof FangguoApiError ? e.message : "方果推单接口调用失败";
      return NextResponse.json({ error: `方果推单失败: ${msg}` }, { status: 400 });
    }

    // 方果成功后统一扣费
    const charge = await chargeUser(
      user.id,
      totalFee,
      `批量推单扣费 x${pushableOrders.length}`,
    );
    if (!charge.success) {
      console.error("[batch-push] charge failed after fangguo success:", charge.error);
      return NextResponse.json(
        { error: `订单已推送至方果，但扣费失败（${charge.error}），请联系管理员核对` },
        { status: 500 }
      );
    }

    // 更新订单状态
    const pushableIds = pushableOrders.map((o) => o.id);
    const { error: updateOrderError } = await client
      .from("orders")
      .update({
        status: "pushed",
        df_status: 3, // 工厂待审
        updated_at: new Date().toISOString(),
      })
      .in("id", pushableIds)
      .eq("user_id", user.id);

    if (updateOrderError) throw updateOrderError;

    return NextResponse.json({
      success: true,
      message: `成功推送 ${pushableOrders.length} 个订单至工厂`,
      balance: charge.balance,
      pushedCount: pushableOrders.length,
      skippedCount: (orders?.length || 0) - pushableOrders.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "批量推单失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
