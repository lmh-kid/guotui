import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth-utils";
import { getSupabaseAdminClient } from "@/storage/database/supabase-client";

/**
 * POST - 店铺分配给用户 / 取消分配
 * body: { fangguoShopId, shopName, brandName, platform, platformCode, userId (为空则取消分配) }
 */
export async function POST(request: NextRequest) {
  try {
    const { isAdmin, error } = await requireAdminRequest(request.headers.get("x-session"));
    if (!isAdmin) {
      return NextResponse.json({ error }, { status: error === "请先登录" ? 401 : 403 });
    }

    const body = (await request.json()) as {
      fangguoShopId: string;
      shopName: string;
      brandName?: string;
      platform?: string;
      platformCode?: number;
      userId?: string | null;
    };

    if (!body.fangguoShopId || !body.shopName) {
      return NextResponse.json({ error: "缺少店铺参数" }, { status: 400 });
    }

    const supabase = await getSupabaseAdminClient();

    // 查询现有分配
    const { data: existing, error: queryErr } = await supabase
      .from("shops")
      .select("id, user_id")
      .eq("fangguo_shop_id", body.fangguoShopId)
      .maybeSingle();
    if (queryErr) {
      return NextResponse.json({ error: `查询失败: ${queryErr.message}` }, { status: 500 });
    }

    // 取消分配：删除本地店铺记录
    if (!body.userId) {
      if (existing) {
        const { error: delErr } = await supabase.from("shops").delete().eq("id", existing.id);
        if (delErr) {
          return NextResponse.json({ error: `取消分配失败: ${delErr.message}` }, { status: 500 });
        }
      }
      return NextResponse.json({ success: true, message: "已取消分配" });
    }

    // 校验目标用户存在
    const { data: user } = await supabase
      .from("user_balances")
      .select("user_id")
      .eq("user_id", body.userId)
      .maybeSingle();
    if (!user) {
      return NextResponse.json({ error: "目标用户不存在" }, { status: 400 });
    }

    if (existing) {
      // 更新分配
      const { error: updErr } = await supabase
        .from("shops")
        .update({
          user_id: body.userId,
          shop_name: body.shopName,
          brand_name: body.brandName ?? null,
          platform: body.platform ?? "other",
          platform_code: body.platformCode ?? null,
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      if (updErr) {
        return NextResponse.json({ error: `分配失败: ${updErr.message}` }, { status: 500 });
      }
    } else {
      // 新建分配
      const { error: insErr } = await supabase.from("shops").insert({
        user_id: body.userId,
        platform: body.platform ?? "other",
        shop_name: body.shopName,
        fangguo_shop_id: body.fangguoShopId,
        platform_code: body.platformCode ?? null,
        brand_name: body.brandName ?? null,
        status: "active",
      });
      if (insErr) {
        return NextResponse.json({ error: `分配失败: ${insErr.message}` }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true, message: "分配成功" });
  } catch (err) {
    console.error("[admin/fangguo/assign POST] error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
