import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, ensureUserBalance } from "@/lib/auth-utils";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { pushFangguoOrders, FangguoApiError } from "@/lib/fangguo";
import { chargeUser, PUSH_FEE } from "@/lib/billing";

/**
 * 单条订单推单（真实调方果 API）
 * 流程: 校验状态 → 调方果 /order/push → 成功后扣费 → 更新状态
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

  const client = getSupabaseClient(token ?? undefined);
  const { id } = await params;

  try {
    await ensureUserBalance(user.id, client);

    // 1. 查询订单
    const { data: order, error: orderError } = await client
      .from("orders")
      .select("id, order_no, sys_tid, status, decode_status, df_status, store_name")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "订单不存在" }, { status: 404 });
    }

    // 2. 状态检查：已推送/生产中/已发货不可推
    if (["pushed", "production", "shipped"].includes(order.status)) {
      return NextResponse.json({ error: "订单已推送，无需重复推送" }, { status: 400 });
    }
    // 方果侧状态: 仅 dfStatus=1(待推送) 可推
    if (order.df_status != null && order.df_status !== 1) {
      const statusText: Record<number, string> = {
        0: "待整理",
        1: "待推送",
        2: "已反审",
        3: "工厂待审",
        4: "生产中",
        5: "已打包",
      };
      return NextResponse.json(
        { error: `方果侧订单状态为「${statusText[order.df_status] ?? order.df_status}」，仅「待推送」状态可推送` },
        { status: 400 }
      );
    }

    // 3. 余额预检查（避免推送成功但扣费失败）
    const adminClient = getSupabaseClient();
    const { data: balanceData } = await adminClient
      .from("user_balances")
      .select("balance")
      .eq("user_id", user.id)
      .single();
    const balanceNow = parseFloat((balanceData?.balance as string) ?? "0");
    if (balanceNow < PUSH_FEE) {
      return NextResponse.json(
        { error: `余额不足（当前 ${balanceNow.toFixed(2)} 元，推单需 ${PUSH_FEE.toFixed(2)} 元），请先充值` },
        { status: 400 }
      );
    }

    // 4. 调方果真实推单
    try {
      await pushFangguoOrders([order.order_no]);
    } catch (e) {
      const msg = e instanceof FangguoApiError ? e.message : "方果推单接口调用失败";
      return NextResponse.json({ error: `方果推单失败: ${msg}` }, { status: 400 });
    }

    // 5. 推单成功 → 扣费
    const charge = await chargeUser(
      user.id,
      PUSH_FEE,
      `推单扣费 ${order.order_no}`,
      order.order_no
    );
    if (!charge.success) {
      // 推单已成功但扣费失败：记录日志（理论上余额检查前置可避免）
      console.error("[push] charge failed after fangguo push success:", order.order_no, charge.error);
      return NextResponse.json(
        { error: `订单已推送至方果，但扣费失败（${charge.error}），请联系管理员核对` },
        { status: 500 }
      );
    }

    // 6. 更新订单状态
    const { error: updateOrderError } = await client
      .from("orders")
      .update({
        status: "pushed",
        df_status: 3, // 工厂待审
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id);

    if (updateOrderError) throw updateOrderError;

    return NextResponse.json({
      success: true,
      message: "推单成功，订单已推送至工厂待审核",
      balance: charge.balance,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "推单失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
