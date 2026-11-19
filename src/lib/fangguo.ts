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
