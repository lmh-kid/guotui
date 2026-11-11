import {
  fetchFangguoTidList,
  fetchFangguoOrderDetail,
  mapDfStatusToOrderStatus,
  mapPlatformCode,
  FangguoOrderDetail,
} from "@/lib/fangguo";

/**
 * 方果订单实时透传服务（订单不落库）
 *
 * 流程: tidList(时间窗口) → 并发 detail → 规整为前端 DTO
 * - 全局 60s 内存缓存（按窗口），多用户共享，控制方果 API 调用量
 * - detail 并发度 8，单窗口最多拉 500 单（tidList 上限保护）
 */

export interface LiveOrder {
  order_no: string; // 方果平台订单号 tid（同时作为前端行主键）
  sys_tid: string;
  platform: string; // 映射后的平台标识
  platform_desc: string; // 原始平台描述
  order_type_desc: string | null; // e.g. TEMU全托-紧急备货单
  status: string; // 果推状态: pending/decoded/pushed/production/shipped
  decode_status: string; // pending/success
  df_status: number;
  product_name: string;
  product_image: string | null;
  spec: string | null;
  merchant_code: string | null;
  quantity: number;
  price: string;
  pay_time: string | null; // ISO
  deliver_time: string | null; // ISO
  tracking_no: string | null;
  logistics_company: string | null;
  store_name: string;
  factory_id: string | null;
  buyer_remark: string;
  shop_remark: string | null;
}

interface CacheEntry {
  ts: number;
  orders: LiveOrder[];
}

const CACHE_TTL_MS = 60_000;
const MAX_TIDS = 500;
const DETAIL_CONCURRENCY = 8;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as unknown as { __fgLiveCache?: Map<string, CacheEntry> };
if (!g.__fgLiveCache) g.__fgLiveCache = new Map<string, CacheEntry>();

function mapDetailToLiveOrder(detail: FangguoOrderDetail): LiveOrder {
  const mapped = mapDfStatusToOrderStatus(detail);
  const items = detail.orderItems ?? [];
  const firstItem = items[0];
  const quantity = items.reduce((s, i) => s + (i.num ?? 1), 0);
  const totalPrice = items.reduce((s, i) => s + (i.price ?? 0) * (i.num ?? 1), 0);
  const trackingItem = items.find((i) => i.logisticsOrderNum);

  return {
    order_no: detail.tid,
    sys_tid: detail.sysTid,
    platform: mapPlatformCode(detail.platform, detail.platformDesc),
    platform_desc: detail.platformDesc,
    order_type_desc: (detail as { platformOrderTypeDesc?: string }).platformOrderTypeDesc ?? null,
    status: mapped.status,
    decode_status: mapped.decodeStatus,
    df_status: detail.dfStatus,
    product_name: firstItem?.title ?? "（无商品信息）",
    product_image: firstItem?.merchandisePicPath || null,
    spec: firstItem?.skuPropertiesName ?? null,
    merchant_code: firstItem?.shopMappingSku || null,
    quantity: quantity || 1,
    price: totalPrice.toFixed(2),
    pay_time: detail.payTime ? new Date(detail.payTime).toISOString() : null,
    deliver_time: detail.deliverTime ? new Date(detail.deliverTime).toISOString() : null,
    tracking_no: trackingItem?.logisticsOrderNum || null,
    logistics_company: trackingItem?.logisticsCompanyCode || null,
    store_name: detail.storeName ?? "",
    factory_id: detail.factoryId != null ? String(detail.factoryId) : null,
    buyer_remark: detail.buyerRemark ?? "",
    shop_remark: detail.shopRemark ?? null,
  };
}

/**
 * 拉取时间窗口内的全部订单（全店铺，缓存 60s）
 * @param days 窗口天数：1=今天0点起，3/7=近N天
 */
export async function fetchLiveOrders(days: 1 | 3 | 7): Promise<LiveOrder[]> {
  const now = new Date();
  let start: number;
  if (days === 1) {
    const d0 = new Date(now);
    d0.setHours(0, 0, 0, 0);
    start = d0.getTime();
  } else {
    start = now.getTime() - days * 86400_000;
  }
  const end = now.getTime();

  const cacheKey = `${days}:${start}`;
  const cache = g.__fgLiveCache!;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return hit.orders;
  }

  // 1. 分页拉订单号
  const allTids: string[] = [];
  let pageNo = 1;
  for (;;) {
    const { list, total } = await fetchFangguoTidList({
      startTime: start,
      endTime: end,
      pageNo,
      pageSize: 100,
    });
    allTids.push(...(list ?? []).map((x) => x.tid));
    if (allTids.length >= total || (list ?? []).length === 0) break;
    pageNo += 1;
    if (allTids.length >= MAX_TIDS) break;
  }
  const tids = allTids.slice(0, MAX_TIDS);

  // 2. 并发拉详情（分批，每批 8）
  const orders: LiveOrder[] = [];
  for (let i = 0; i < tids.length; i += DETAIL_CONCURRENCY) {
    const batch = tids.slice(i, i + DETAIL_CONCURRENCY);
    const details = await Promise.allSettled(
      batch.map((tid) => fetchFangguoOrderDetail(tid))
    );
    for (const d of details) {
      if (d.status === "fulfilled") {
        orders.push(mapDetailToLiveOrder(d.value));
      }
    }
  }

  // 3. 按付款时间倒序（无付款时间用提交时间兜底，排最后）
  orders.sort((a, b) => {
    const ta = a.pay_time ? Date.parse(a.pay_time) : 0;
    const tb = b.pay_time ? Date.parse(b.pay_time) : 0;
    return tb - ta;
  });

  cache.set(cacheKey, { ts: Date.now(), orders });
  return orders;
}

/** 按用户店铺过滤 */
export function filterByShops(orders: LiveOrder[], shopNames: string[]): LiveOrder[] {
  if (shopNames.length === 0) return [];
  const set = new Set(shopNames);
  return orders.filter((o) => set.has(o.store_name));
}
