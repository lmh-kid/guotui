import { getSupabaseAdminClient } from "@/storage/database/supabase-client";

/**
 * 方果开放平台 API 客户端
 * 文档: https://open.fangguo.com/fgapp/openapi
 * 认证: Authorization: Bearer {apiKey}（商家后台「获取授权」生成）
 * 响应约定: {code, data, msg, currentTime}，code=0 成功
 */

const FANGGUO_BASE_URL = "https://open.fangguo.com/fgapp/openapi";

// ============ 配置读取 ============

/**
 * 读取方果 API KEY（存于 system_configs 表，key = fangguo_api_key）
 */
export async function getFangguoApiKey(): Promise<string | null> {
  const supabase = await getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("system_configs")
    .select("value")
    .eq("key", "fangguo_api_key")
    .maybeSingle();
  if (error || !data?.value) return null;
  return data.value as string;
}

/**
 * 写入方果 API KEY
 */
export async function setFangguoApiKey(apiKey: string): Promise<void> {
  const supabase = await getSupabaseAdminClient();
  const { error } = await supabase.from("system_configs").upsert({
    key: "fangguo_api_key",
    value: apiKey,
    remark: "方果开放平台 API KEY",
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`保存 API KEY 失败: ${error.message}`);
}

// ============ 请求封装 ============

export class FangguoApiError extends Error {
  code: number;
  constructor(message: string, code: number) {
    super(message);
    this.code = code;
  }
}

async function fangguoRequest<T>(
  method: "GET" | "POST",
  path: string,
  apiKey: string,
  options: { query?: Record<string, string>; body?: unknown } = {}
): Promise<T> {
  const url = new URL(FANGGUO_BASE_URL + path);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new FangguoApiError(`方果接口 HTTP ${res.status}`, res.status);
  }

  const json = (await res.json()) as {
    code: number;
    data: T;
    msg: string;
    currentTime: number;
  };

  if (json.code !== 0) {
    throw new FangguoApiError(json.msg || `方果接口错误 code=${json.code}`, json.code);
  }

  return json.data;
}

/** 业务接口统一入口：自动读取配置的 API KEY */
async function callApi<T>(
  method: "GET" | "POST",
  path: string,
  options: { query?: Record<string, string>; body?: unknown } = {}
): Promise<T> {
  const apiKey = await getFangguoApiKey();
  if (!apiKey) {
    throw new FangguoApiError("方果 API KEY 未配置，请管理员在后台「平台对接」中配置", -1);
  }
  return fangguoRequest<T>(method, path, apiKey, options);
}

// ============ 类型定义 ============

export interface FangguoShop {
  id: number; // 店铺主键
  platform: number; // 平台枚举
  authId: string;
  nick: string; // 店铺昵称
  brandName: string; // 平台名称
  defaultFactory: number | null;
  autoSync: boolean;
  createTime: number;
}

export interface FangguoOrderItem {
  id: string;
  oid: string;
  sysOid: string; // 系统商品单号（saveProduct 必填）
  title: string; // 商品标题
  num: number;
  price: number;
  skuPropertiesName: string; // 规格
  shopMappingSku: string; // 解码后的商户编码
  outerIid: string; // 原商家编码
  materialCode: string | null;
  colorCode: string | null;
  modelCode: string | null;
  pictureCode: string | null;
  merchandisePicPath: string;
  customPicture: boolean;
  productType: number;
  logisticsCompanyCode: string | null;
  logisticsOrderNum: string | null;
  diyList: Array<{
    url: string;
    workUrl: string;
    effectUrl: string;
    picName: string;
    sort: number;
  }>;
}

export interface FangguoOrderDetail {
  id: string;
  sysTid: string; // 系统单号
  tid: string; // 平台订单号
  platform: number;
  platformDesc: string;
  dfStatus: number; // 0待整理 1待推送 2已反审 3工厂待审 4生产中 5已打包
  outerOrderStatusDesc: string; // 平台状态
  storeName: string;
  factoryId: number | null;
  orderType: number; // 0正常 1合并 2手工
  shopRemark: string;
  buyerRemark: string;
  payTime: number | null;
  submitTime: number | null;
  deliverTime: number | null;
  lastLogisticsTime: number | null;
  latestArrivalTime: number | null;
  orderItems: FangguoOrderItem[];
}

// ============ 具体接口 ============

/** 店铺列表 */
export async function fetchFangguoShops(): Promise<FangguoShop[]> {
  const data = await callApi<{ list: FangguoShop[] }>("GET", "/shop/store/list");
  return data.list ?? [];
}

/** 订单号列表（时间范围 ≤ 7 天，pageSize ≤ 100） */
export async function fetchFangguoTidList(params: {
  startTime: number;
  endTime: number;
  pageNo?: number;
  pageSize?: number;
}): Promise<{ list: Array<{ tid: string }>; total: number }> {
  return callApi<{ list: Array<{ tid: string }>; total: number }>("POST", "/order/tidList", {
    body: {
      startTime: params.startTime,
      endTime: params.endTime,
      pageNo: params.pageNo ?? 1,
      pageSize: params.pageSize ?? 100,
    },
  });
}

/** 订单详情 */
export async function fetchFangguoOrderDetail(tid: string): Promise<FangguoOrderDetail> {
  return callApi<FangguoOrderDetail>("GET", "/order/detail", { query: { tid } });
}

/** 推单（批量） */
export async function pushFangguoOrders(orderNoList: string[]): Promise<boolean> {
  const data = await callApi<boolean>("POST", "/order/push", {
    body: { orderNoList },
  });
  return data === true;
}

/** 取消推送（仅工厂待审 dfStatus=3） */
export async function cancelFangguoPush(tidStrs: string): Promise<boolean> {
  const data = await callApi<boolean>("POST", "/order/cancelPush", {
    body: { tidStrs },
  });
  return data === true;
}

/** 验证 API KEY 有效性（拉店铺列表试探） */
export async function verifyFangguoApiKey(apiKey: string): Promise<{ valid: boolean; shopCount: number; message: string }> {
  try {
    const data = await fangguoRequest<{ list: FangguoShop[] }>("GET", "/shop/store/list", apiKey);
    return { valid: true, shopCount: data.list?.length ?? 0, message: "验证成功" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "验证失败";
    return { valid: false, shopCount: 0, message: msg };
  }
}

// ============ 商家编码四要素（材质-颜色-型号-图号） ============

/** 工厂可用材质（含嵌套颜色选项） */
export interface FangguoMaterialColor {
  id: number;
  materialCode: string; // 材质编码（即名称，如「90克磨毛布被套三件套」）
  factoryCode: string;
  displaySort: number;
  colors: Array<{
    id: number;
    colorCode: string; // 颜色编码（即名称，如「混合色」）
    factoryCode: string;
    displaySort: number;
  }>;
}

/** 商品库 SKU（型号/图号选项的来源） */
interface FangguoGoodsPageSku {
  factoryTenantId: number | null;
  shopMaterialCode: string | null;
  shopColorCode: string | null;
  shopModelCode: string | null;
  shopPicCode: string | null;
}

/** 按工厂聚合的型号/图号选项 */
export interface FactoryCodeOptions {
  models: string[];
  pics: string[];
}

// 材质颜色缓存（10 分钟，按工厂）
const MATERIAL_CACHE_TTL_MS = 10 * 60_000;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const gmc = globalThis as unknown as { __fgMaterialCache?: Map<string, { ts: number; data: FangguoMaterialColor[] }> };
if (!gmc.__fgMaterialCache) gmc.__fgMaterialCache = new Map();

/**
 * 拉取工厂的材质+颜色选项（修改商家编码弹窗数据源）
 * GET /basic/materialColors/v1?factoryId=
 */
export async function fetchFangguoMaterialColors(factoryId: number): Promise<FangguoMaterialColor[]> {
  const cacheKey = String(factoryId);
  const cache = gmc.__fgMaterialCache!;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < MATERIAL_CACHE_TTL_MS) return hit.data;

  const data = await callApi<FangguoMaterialColor[]>("GET", "/basic/materialColors/v1", {
    query: { factoryId: String(factoryId) },
  });
  const list = (data ?? []).slice().sort((a, b) => (a.displaySort ?? 0) - (b.displaySort ?? 0));
  cache.set(cacheKey, { ts: Date.now(), data: list });
  return list;
}

// 型号/图号聚合缓存（6 小时；商品库数据变化慢）
const GOODS_OPTIONS_TTL_MS = 6 * 60 * 60_000;
const GOODS_SCAN_WINDOWS = 4; // 扫描最近 4 个 7 天窗口（接口限制单次 ≤7 天）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ggo = globalThis as unknown as {
  __fgGoodsOptions?: { ts: number; data: Map<number, FactoryCodeOptions> } | null;
  __fgGoodsOptionsWarming?: boolean;
};

/**
 * 读取已缓存的型号/图号选项（只读，立即返回；缓存可能为空 Map）
 * 首次访问需先调用 warmFactoryModelPicOptions() 后台预热
 */
export function getCachedFactoryModelPicOptions(): Map<number, FactoryCodeOptions> {
  const cached = ggo.__fgGoodsOptions;
  if (cached && Date.now() - cached.ts < GOODS_OPTIONS_TTL_MS) {
    return cached.data;
  }
  return new Map();
}

/**
 * 后台预热型号/图号选项聚合（fire-and-forget，防重入）
 * 聚合需分页扫商品库（数千商品），耗时可达数十秒，绝不阻塞请求
 */
export function warmFactoryModelPicOptions(): void {
  const cached = ggo.__fgGoodsOptions;
  if (cached && Date.now() - cached.ts < GOODS_OPTIONS_TTL_MS && cached.data.size > 0) return;
  if (ggo.__fgGoodsOptionsWarming) return;
  ggo.__fgGoodsOptionsWarming = true;

  void aggregateGoodsOptions()
    .catch(() => {
      // 静默失败：下次访问会再次触发预热
    })
    .finally(() => {
      ggo.__fgGoodsOptionsWarming = false;
    });
}

/**
 * 从商家商品库聚合各工厂的「型号/图号」选项
 * POST /warehouse/shop/goods/page（sjbm 更新时间窗口 ≤7 天，分页 100）
 *
 * 说明：方果 OpenAPI 未提供型号列表接口（/basic/models/v1 无法鉴权调用），
 * 故以商家商品库中已解码 SKU 的 shopModelCode/shopPicCode 去重聚合作为选项来源。
 */
async function aggregateGoodsOptions(): Promise<Map<number, FactoryCodeOptions>> {
  const byFactory = new Map<number, { models: Set<string>; pics: Set<string> }>();
  const now = Date.now();
  const day = 86400_000;
  const seenGoods = new Set<string>();

  // 各 7 天窗口并行拉取（窗口内分页串行）
  const windows: Array<Promise<void>> = [];
  for (let w = 0; w < GOODS_SCAN_WINDOWS; w += 1) {
    const end = now - w * 7 * day;
    const start = end - 7 * day + day;
    windows.push(
      (async () => {
        let pageNo = 1;
        // 每个窗口最多拉 20 页（2000 商品），防止极端情况拖垮请求
        while (pageNo <= 20) {
          const page = await callApi<{ list?: Array<{ id?: string; goodsOriginId?: string; skus?: FangguoGoodsPageSku[] }> }>(
            "POST",
            "/warehouse/shop/goods/page",
            { body: { pageNo, pageSize: 100, sjbmUpdateStartTime: start, sjbmUpdateEndTime: end } }
          );
          const list = page?.list ?? [];
          if (list.length === 0) break;
          for (const goods of list) {
            const key = String(goods.goodsOriginId ?? goods.id ?? "");
            if (key && seenGoods.has(key)) continue;
            if (key) seenGoods.add(key);
            for (const sku of goods.skus ?? []) {
              const fid = sku.factoryTenantId;
              if (fid == null) continue;
              let bucket = byFactory.get(fid);
              if (!bucket) {
                bucket = { models: new Set(), pics: new Set() };
                byFactory.set(fid, bucket);
              }
              if (sku.shopModelCode) bucket.models.add(sku.shopModelCode);
              if (sku.shopPicCode) bucket.pics.add(sku.shopPicCode);
            }
          }
          if (list.length < 100) break;
          pageNo += 1;
        }
      })()
    );
  }
  await Promise.all(windows);

  const result = new Map<number, FactoryCodeOptions>();
  for (const [fid, bucket] of byFactory) {
    result.set(fid, {
      models: Array.from(bucket.models).sort(),
      pics: Array.from(bucket.pics).sort(),
    });
  }

  if (result.size > 0) {
    ggo.__fgGoodsOptions = { ts: Date.now(), data: result };
  }
  return result;
}

/** 修改订单商品（商家编码四要素）请求体 */
export interface SaveProductItemInput {
  id: string; // 订单商品 id（orderItems[].id）
  oid: string;
  sysOid: string;
  num: number;
  materialCode: string;
  colorCode: string;
  modelCode: string;
  pictureCode: string;
}

/**
 * 修改订单商品/商家编码（语雀文档 19.修改订单商品/图片）
 * POST /order/saveProduct
 * 商家编码规则: 材质-颜色-型号-图号
 */
export async function saveFangguoProduct(params: {
  sysTid: string;
  factoryId?: number | null;
  orderItems: SaveProductItemInput[];
}): Promise<boolean> {
  const data = await callApi<boolean>("POST", "/order/saveProduct", {
    body: {
      sysTid: params.sysTid,
      factoryId: params.factoryId ?? undefined,
      orderItems: params.orderItems,
    },
  });
  return data === true;
}

// ============ 状态映射 ============

/**
 * 方果 dfStatus → 果推订单状态
 * dfStatus: 0待整理 1待推送 2已反审 3工厂待审 4生产中 5已打包
 * outerOrderStatusDesc 含「交易关闭」（平台侧取消/退款作废）→ 已作废 voided
 * deliverTime 有值 → 已发货
 */
export function mapDfStatusToOrderStatus(detail: {
  dfStatus: number;
  deliverTime?: number | null;
  outerOrderStatusDesc?: string | null;
}): {
  status: string;
  decodeStatus: string;
} {
  const { dfStatus, deliverTime, outerOrderStatusDesc } = detail;

  // 已发货优先判断
  if (deliverTime) {
    return { status: "shipped", decodeStatus: "success" };
  }

  // 平台侧交易关闭（买家取消/退款）→ 已作废
  if (outerOrderStatusDesc && outerOrderStatusDesc.includes("交易关闭")) {
    return { status: "voided", decodeStatus: "pending" };
  }

  switch (dfStatus) {
    case 0: // 待整理（未解码）
      return { status: "pending", decodeStatus: "pending" };
    case 1: // 待推送（已解码）
      return { status: "decoded", decodeStatus: "success" };
    case 2: // 已反审（工厂退回，重新整理）
      return { status: "pending", decodeStatus: "pending" };
    case 3: // 工厂待审（已推送）
      return { status: "pushed", decodeStatus: "success" };
    case 4: // 生产中
      return { status: "production", decodeStatus: "success" };
    case 5: // 已打包（生产完成待发货）
      return { status: "production", decodeStatus: "success" };
    default:
      // 未知 dfStatus（方果新增枚举，如作废类状态）→ 保守归为已作废，禁止推送
      return { status: "voided", decodeStatus: "pending" };
  }
}

/**
 * 是否已作废订单（平台交易关闭 / 未知状态），作废单禁止推送
 */
export function isVoidedOrder(detail: {
  dfStatus: number;
  deliverTime?: number | null;
  outerOrderStatusDesc?: string | null;
}): boolean {
  return mapDfStatusToOrderStatus(detail).status === "voided";
}

/** 方果平台编码 → 果推平台标识 */
export function mapPlatformCode(platform: number, platformDesc?: string): string {
  const desc = platformDesc ?? "";
  // 文本匹配优先（brandName / platformDesc）
  if (desc.includes("Temu")) return "temu";
  if (desc.includes("Shein") || desc.includes("SHEIN")) return "shein";
  if (desc.includes("TikTok") || desc.includes("抖音")) return "tiktok";
  if (desc.includes("速卖通") || desc.includes("AliExpress")) return "aliexpress";
  if (desc.includes("Shopee")) return "shopee";
  if (desc.includes("淘宝")) return "taobao";
  if (desc.includes("京东")) return "jd";
  if (desc.includes("拼多多")) return "pdd";
  // 已知平台码: 25=Temu全托管, 125/225/325/525=Temu半托管(美/欧/全球等分区)
  const temuCodes = [25, 125, 225, 325, 425, 525, 625, 725, 825, 925];
  if (temuCodes.includes(platform)) return "temu";
  return "other";
}
