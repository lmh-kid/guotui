import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-utils";
import {
  fetchFangguoOrderDetail,
  fetchFangguoMaterialColors,
  getCachedFactoryModelPicOptions,
  warmFactoryModelPicOptions,
  saveFangguoProduct,
  isVoidedOrder,
  FangguoApiError,
  type FangguoMaterialColor,
  type SaveProductItemInput,
} from "@/lib/fangguo";
import { getUserShopNames } from "@/lib/push-billing";
import { refreshLiveOrder } from "@/lib/fangguo-live";

/**
 * 修改订单商家编码（材质-颜色-型号-图号 四要素）
 * 路由参数 id = 方果平台订单号 tid
 *
 * GET  : 返回订单商品明细（含现有编码）+ 可选项（材质/颜色、型号、图号）
 * POST : 保存修改（POST /order/saveProduct 透传），成功后刷新实时缓存
 *
 * 仅「待整理 / 已反审 / 待推送」（dfStatus 0/2/1）且未作废、未发货的订单可改码
 */

interface EditableItem {
  id: string;
  oid: string;
  sysOid: string;
  num: number;
  title: string;
  spec: string | null;
  image: string | null;
  currentSku: string | null; // 现有商家编码（如 90克磨毛布被套三件套-混合色-220X230-28810029）
  materialCode: string | null;
  colorCode: string | null;
  modelCode: string | null;
  pictureCode: string | null;
}

/** 校验登录 + 店铺归属 + 订单可改码状态，返回 detail 或错误响应 */
async function validateEditableOrder(
  token: string | null,
  tid: string
): Promise<
  | { ok: true; detail: Awaited<ReturnType<typeof fetchFangguoOrderDetail>> }
  | { ok: false; response: NextResponse }
> {
  const { user, error: authError } = await getCurrentUser(token);
  if (authError || !user) {
    return { ok: false, response: NextResponse.json({ error: authError || "认证失败" }, { status: 401 }) };
  }

  const shopNames = await getUserShopNames(user.id);
  if (shopNames.length === 0) {
    return { ok: false, response: NextResponse.json({ error: "您暂未分配店铺，请联系管理员" }, { status: 403 }) };
  }

  let detail: Awaited<ReturnType<typeof fetchFangguoOrderDetail>>;
  try {
    detail = await fetchFangguoOrderDetail(tid);
  } catch (e) {
    const msg = e instanceof FangguoApiError ? e.message : "订单查询失败";
    return { ok: false, response: NextResponse.json({ error: msg }, { status: 502 }) };
  }

  if (!shopNames.includes(detail.storeName ?? "")) {
    return { ok: false, response: NextResponse.json({ error: "订单不存在或不属于您的店铺" }, { status: 404 }) };
  }

  if (isVoidedOrder(detail)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `订单已作废（平台状态「${detail.outerOrderStatusDesc || "交易关闭"}」），无法修改` },
        { status: 400 }
      ),
    };
  }

  if (detail.deliverTime) {
    return { ok: false, response: NextResponse.json({ error: "订单已发货，无法修改商家编码" }, { status: 400 }) };
  }

  if (![0, 1, 2].includes(detail.dfStatus)) {
    const statusText: Record<number, string> = {
      3: "工厂待审（已推送）",
      4: "生产中",
      5: "已打包",
    };
    return {
      ok: false,
      response: NextResponse.json(
        { error: `订单状态为「${statusText[detail.dfStatus] ?? detail.dfStatus}」，仅待整理/待推送状态可修改商家编码` },
        { status: 400 }
      ),
    };
  }

  return { ok: true, detail };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tid } = await params;
  const result = await validateEditableOrder(req.headers.get("x-session"), tid);
  if (!result.ok) return result.response;
  const detail = result.detail;

  try {
    const factoryId = detail.factoryId;

    // 型号/图号选项：后台异步预热（商品库聚合耗时数十秒，绝不阻塞本次请求）
    warmFactoryModelPicOptions();

    // 材质+颜色：工厂维度实时拉取（10min 缓存，单次请求快）
    let materials: FangguoMaterialColor[] = [];
    let models: string[] = [];
    let pics: string[] = [];
    let modelsByMaterial: Record<string, string[]> = {};
    let optionsReady = true;
    if (factoryId != null) {
      const [materialList, goodsOptions] = await Promise.all([
        fetchFangguoMaterialColors(factoryId).catch(() => [] as FangguoMaterialColor[]),
        Promise.resolve(getCachedFactoryModelPicOptions()),
      ]);
      materials = materialList;
      const opts = goodsOptions.get(factoryId);
      if (opts) {
        models = opts.models;
        pics = opts.pics;
        modelsByMaterial = opts.modelsByMaterial || {};
      } else {
        optionsReady = false; // 首次访问商品库聚合尚未完成，型号/图号先手填
      }
    }

    const items: EditableItem[] = (detail.orderItems ?? []).map((it) => ({
      id: it.id,
      oid: it.oid,
      sysOid: it.sysOid,
      num: it.num,
      title: it.title,
      spec: it.skuPropertiesName ?? null,
      image: it.merchandisePicPath || null,
      currentSku: it.shopMappingSku || null,
      materialCode: it.materialCode ?? null,
      colorCode: it.colorCode ?? null,
      modelCode: it.modelCode ?? null,
      pictureCode: it.pictureCode ?? null,
    }));

    return NextResponse.json({
      order: {
        tid: detail.tid,
        sysTid: detail.sysTid,
        storeName: detail.storeName,
        factoryId: detail.factoryId,
        dfStatus: detail.dfStatus,
      },
      items,
      options: { materials, models, pics, modelsByMaterial },
      optionsReady,
    });
  } catch (err: unknown) {
    if (err instanceof FangguoApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "加载编码选项失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: tid } = await params;

  let body: { items?: Array<{ id?: string; materialCode?: string; colorCode?: string; modelCode?: string; pictureCode?: string }> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const clientItems = Array.isArray(body.items) ? body.items : [];
  if (clientItems.length === 0) {
    return NextResponse.json({ error: "缺少商品编码数据" }, { status: 400 });
  }

  const result = await validateEditableOrder(req.headers.get("x-session"), tid);
  if (!result.ok) return result.response;
  const detail = result.detail;

  // 以服务端 detail 的商品清单为准（id/oid/sysOid/num 不信任客户端），逐项匹配用户提交的四要素
  const detailItems = detail.orderItems ?? [];
  const byClient = new Map(clientItems.map((c) => [String(c.id ?? ""), c]));

  const missing = detailItems.filter((it) => !byClient.has(it.id));
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `有 ${missing.length} 个商品未填写编码，请为订单内全部商品选择「材质/颜色/型号/图号」` },
      { status: 400 }
    );
  }

  const saveItems = [];
  for (const it of detailItems) {
    const c = byClient.get(it.id);
    const materialCode = String(c?.materialCode ?? "").trim();
    const colorCode = String(c?.colorCode ?? "").trim();
    const modelCode = String(c?.modelCode ?? "").trim();
    const pictureCode = String(c?.pictureCode ?? "").trim();

    const missingFields: string[] = [];
    if (!materialCode) missingFields.push("材质");
    if (!colorCode) missingFields.push("颜色");
    if (!modelCode) missingFields.push("型号");
    if (!pictureCode) missingFields.push("图号");
    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `商品「${(it.title || it.id).slice(0, 20)}…」缺少: ${missingFields.join("/")}` },
        { status: 400 }
      );
    }

    saveItems.push({
      id: it.id,
      oid: it.oid,
      sysOid: it.sysOid,
      num: it.num,
      materialCode,
      colorCode,
      modelCode,
      pictureCode,
    });
  }

  try {
    await saveFangguoProduct({
      sysTid: detail.sysTid,
      factoryId: detail.factoryId,
      orderItems: saveItems,
    });
  } catch (e) {
    const msg = e instanceof FangguoApiError ? e.message : "方果保存接口调用失败";
    return NextResponse.json({ error: `修改商家编码失败: ${msg}` }, { status: 502 });
  }

  // 刷新实时缓存，列表立即反映新编码/新状态
  const fresh = await refreshLiveOrder(tid);

  return NextResponse.json({
    success: true,
    message: "商家编码已保存",
    order: fresh,
  });
}
