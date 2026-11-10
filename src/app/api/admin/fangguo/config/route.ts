import { NextRequest, NextResponse } from "next/server";
import { requireAdminRequest } from "@/lib/auth-utils";
import { getFangguoApiKey, setFangguoApiKey, verifyFangguoApiKey } from "@/lib/fangguo";

/**
 * GET  - 获取方果对接配置（KEY 脱敏展示）
 * POST - 保存/更新方果 API KEY（保存前先验证有效性）
 */
export async function GET(request: NextRequest) {
  try {
    const { isAdmin, error } = await requireAdminRequest(request.headers.get("x-session"));
    if (!isAdmin) {
      return NextResponse.json({ error }, { status: error === "请先登录" ? 401 : 403 });
    }

    const apiKey = await getFangguoApiKey();
    return NextResponse.json({
      configured: !!apiKey,
      apiKeyMasked: apiKey
        ? `${apiKey.slice(0, 6)}${"*".repeat(Math.max(0, apiKey.length - 10))}${apiKey.slice(-4)}`
        : null,
    });
  } catch (err) {
    console.error("[admin/fangguo/config GET] error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { isAdmin, error } = await requireAdminRequest(request.headers.get("x-session"));
    if (!isAdmin) {
      return NextResponse.json({ error }, { status: error === "请先登录" ? 401 : 403 });
    }

    const body = (await request.json()) as { apiKey?: string };
    const apiKey = body.apiKey?.trim();
    if (!apiKey || apiKey.length < 16) {
      return NextResponse.json({ error: "API KEY 格式不正确" }, { status: 400 });
    }

    // 先验证 KEY 有效性再保存
    const verify = await verifyFangguoApiKey(apiKey);
    if (!verify.valid) {
      return NextResponse.json(
        { error: `API KEY 验证失败: ${verify.message}` },
        { status: 400 }
      );
    }

    await setFangguoApiKey(apiKey);
    return NextResponse.json({
      success: true,
      shopCount: verify.shopCount,
      message: `API KEY 保存成功，已验证可访问 ${verify.shopCount} 个店铺`,
    });
  } catch (err) {
    console.error("[admin/fangguo/config POST] error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
