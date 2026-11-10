import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth-utils";
import { syncFangguoOrders } from "@/lib/fangguo-sync";

/**
 * POST - 管理员手动触发订单同步
 * body: { days?: number } 回溯天数（默认 1，最大 7）
 */
export async function POST(request: NextRequest) {
  try {
    const { isAdmin, error } = await requireAdminRequest(request.headers.get("x-session"));
    if (!isAdmin) {
      return NextResponse.json({ error }, { status: error === "请先登录" ? 401 : 403 });
    }

    let days = 1;
    try {
      const body = (await request.json()) as { days?: number };
      if (body?.days && Number.isFinite(body.days)) {
        days = Math.min(Math.max(Math.floor(body.days), 1), 7);
      }
    } catch {
      // 无 body 用默认值
    }

    const result = await syncFangguoOrders(days);
    return NextResponse.json(
      {
        success: result.success,
        message: result.message,
        stats: {
          fetched: result.fetched,
          inserted: result.inserted,
          updated: result.updated,
          unassigned: result.unassigned,
          failed: result.failed,
        },
        unassignedSamples: result.unassignedSamples,
      },
      { status: result.success ? 200 : 400 }
    );
  } catch (err) {
    console.error("[admin/fangguo/sync POST] error:", err);
    const msg = err instanceof Error ? err.message : "同步失败";
    return NextResponse.json({ error: `同步失败: ${msg}` }, { status: 500 });
  }
}
