import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth-utils";
import { fetchFangguoShops, mapPlatformCode } from "@/lib/fangguo";
import { getSupabaseAdminClient } from "@/storage/database/supabase-client";

/**
 * GET - 方果店铺列表（远端实时拉取，合并本地分配状态）
 */
export async function GET(request: NextRequest) {
  try {
    const { isAdmin, error } = await requireAdminRequest(request.headers.get("x-session"));
    if (!isAdmin) {
      return NextResponse.json({ error }, { status: error === "请先登录" ? 401 : 403 });
    }

    // 远端店铺列表
    let remoteShops;
    try {
      remoteShops = await fetchFangguoShops();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "拉取失败";
      return NextResponse.json({ error: `拉取方果店铺失败: ${msg}` }, { status: 400 });
    }

    // 本地分配记录（shops 表）
    const supabase = await getSupabaseAdminClient();
    const { data: localShops, error: localErr } = await supabase
      .from("shops")
      .select("id, user_id, fangguo_shop_id, shop_name, platform, brand_name, status");
    if (localErr) {
      return NextResponse.json({ error: `查询本地店铺失败: ${localErr.message}` }, { status: 500 });
    }

    // 用户列表（用于展示分配给谁）
    const { data: users } = await supabase
      .from("user_balances")
      .select("user_id");

    const assignedMap = new Map<string, { localId: string; userId: string }>();
    for (const ls of localShops ?? []) {
      if (ls.fangguo_shop_id) {
        assignedMap.set(String(ls.fangguo_shop_id), {
          localId: ls.id,
          userId: ls.user_id,
        });
      }
    }

    const list = remoteShops.map((shop) => {
      const assigned = assignedMap.get(String(shop.id));
      return {
        fangguoShopId: String(shop.id),
        shopName: shop.nick,
        brandName: shop.brandName,
        platform: mapPlatformCode(shop.platform, shop.brandName),
        platformCode: shop.platform,
        autoSync: shop.autoSync,
        defaultFactory: shop.defaultFactory,
        createTime: shop.createTime,
        assigned: !!assigned,
        assignedUserId: assigned?.userId ?? null,
      };
    });

    return NextResponse.json({ list, total: list.length, userCount: users?.length ?? 0 });
  } catch (err) {
    console.error("[admin/fangguo/shops GET] error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
