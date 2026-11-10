import {
  fetchFangguoTidList,
  fetchFangguoOrderDetail,
  mapDfStatusToOrderStatus,
  mapPlatformCode,
  getFangguoApiKey,
  FangguoOrderDetail,
} from "@/lib/fangguo";
import { getSupabaseAdminClient } from "@/storage/database/supabase-client";

/**
 * 方果订单同步服务
 * 流程: tidList(时间窗口) → 逐单 detail → 按店铺名分配用户 → 落库/更新状态
 * 时间窗口游标存 system_configs.fangguo_last_sync_time
 */

const LAST_SYNC_KEY = "fangguo_last_sync_time";

async function getConfig(key: string): Promise<string | null> {
  const supabase = await getSupabaseAdminClient();
  const { data } = await supabase
    .from("system_configs")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return (data?.value as string) ?? null;
}

async function setConfig(key: string, value: string): Promise<void> {
  const supabase = await getSupabaseAdminClient();
  await supabase.from("system_configs").upsert({
    key,
    value,
    updated_at: new Date().toISOString(),
  });
}

export interface SyncResult {
  success: boolean;
  message: string;
  fetched: number; // 拉取到的订单号数
  inserted: number; // 新增
  updated: number; // 状态更新
  unassigned: number; // 未找到分配店铺
  failed: number; // 详情拉取失败
  unassignedSamples: string[]; // 未分配订单店铺名样本
}

/**
 * 执行同步
 * @param days 回溯天数（默认 1，最大 7）
 */
export async function syncFangguoOrders(days = 1): Promise<SyncResult> {
  // 前置检查
  const apiKey = await getFangguoApiKey();
  if (!apiKey) {
    return {
      success: false,
      message: "方果 API KEY 未配置",
      fetched: 0, inserted: 0, updated: 0, unassigned: 0, failed: 0,
      unassignedSamples: [],
    };
  }

  const supabase = await getSupabaseAdminClient();

  // 本地店铺分配表（shop_name → user_id / shop_id）
  const { data: localShops } = await supabase
    .from("shops")
    .select("id, user_id, shop_name, fangguo_shop_id");
  const shopByName = new Map<string, { id: string; userId: string }>();
  const shopByFgId = new Map<string, { id: string; userId: string }>();
  for (const s of localShops ?? []) {
    if (s.shop_name) shopByName.set(s.shop_name, { id: s.id, userId: s.user_id });
    if (s.fangguo_shop_id) shopByFgId.set(String(s.fangguo_shop_id), { id: s.id, userId: s.user_id });
  }

  // 时间窗口
  const now = Date.now();
  const lastSyncStr = await getConfig(LAST_SYNC_KEY);
  const lastSync = lastSyncStr ? Number(lastSyncStr) : 0;
  const maxDays = Math.min(Math.max(days, 1), 7);
  // 起点: 上次同步时间（若超过 maxDays 天则回溯 maxDays 天；首次默认 1 天）
  let startTime = lastSync > 0 ? lastSync : now - 1 * 86400_000;
  if (now - startTime > maxDays * 86400_000) {
    startTime = now - maxDays * 86400_000;
  }
  // 留 5 分钟重叠防止边界漏单
  startTime = Math.max(0, startTime - 5 * 60_000);

  // 分页拉取订单号
  const allTids: string[] = [];
  let pageNo = 1;
  const pageSize = 100;
  for (;;) {
    const { list, total } = await fetchFangguoTidList({
      startTime,
      endTime: now,
      pageNo,
      pageSize,
    });
    allTids.push(...(list ?? []).map((x) => x.tid));
    if (allTids.length >= total || (list ?? []).length === 0) break;
    pageNo += 1;
    if (pageNo > 50) break; // 安全上限
  }

  const result: SyncResult = {
    success: true,
    message: "",
    fetched: allTids.length,
    inserted: 0,
    updated: 0,
    unassigned: 0,
    failed: 0,
    unassignedSamples: [],
  };

  // 已存在的订单（tid → 状态），避免重复拉详情
  const { data: existingOrders } = await supabase
    .from("orders")
    .select("id, order_no, status, df_status, sys_tid")
    .in("order_no", allTids.length > 0 ? allTids : ["__none__"]);
  const existingByTid = new Map<string, { id: string; dfStatus: number | null }>();
  for (const o of existingOrders ?? []) {
    existingByTid.set(o.order_no, { id: o.id, dfStatus: o.df_status });
  }

  // 逐单拉详情并落库
  for (const tid of allTids) {
    try {
      const detail = await fetchFangguoOrderDetail(tid);
      const exist = existingByTid.get(tid);

      if (exist) {
        // 更新状态（仅当方果状态变化时）
        const mapped = mapDfStatusToOrderStatus(detail);
        if (exist.dfStatus !== detail.dfStatus) {
          const { error: updErr } = await supabase
            .from("orders")
            .update({
              status: mapped.status,
              decode_status: mapped.decodeStatus,
              df_status: detail.dfStatus,
              tracking_no: detail.orderItems?.find((i) => i.logisticsOrderNum)?.logisticsOrderNum ?? null,
              logistics_company: detail.orderItems?.find((i) => i.logisticsCompanyCode)?.logisticsCompanyCode ?? null,
              deliver_time: detail.deliverTime ? new Date(detail.deliverTime).toISOString() : null,
              last_sync_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", exist.id);
          if (updErr) {
            console.error("[sync] update order failed:", tid, updErr.message);
          } else {
            result.updated += 1;
          }
        }
        continue;
      }

      // 新订单：找店铺分配
      // 注意 detail 无 shopId，只有 storeName；按店铺名匹配，兜底遍历
      let assigned = detail.storeName ? shopByName.get(detail.storeName) : undefined;
      if (!assigned) {
        // 店铺名匹配失败的兜底：若仅分配了一个店铺，归给它
        if (shopByName.size === 1 && shopByFgId.size === 1) {
          assigned = [...shopByFgId.values()][0];
        }
      }

      if (!assigned) {
        result.unassigned += 1;
        if (result.unassignedSamples.length < 5) {
          result.unassignedSamples.push(`${detail.storeName}(${tid})`);
        }
        continue;
      }

      const inserted = await insertOrder(supabase, detail, assigned.id, assigned.userId);
      if (inserted) result.inserted += 1;
      else result.failed += 1;
    } catch (e) {
      console.error("[sync] fetch detail failed:", tid, e);
      result.failed += 1;
    }
  }

  // 更新同步游标
  await setConfig(LAST_SYNC_KEY, String(now));

  const parts: string[] = [];
  parts.push(`拉取 ${result.fetched} 单`);
  parts.push(`新增 ${result.inserted} 单`);
  if (result.updated) parts.push(`更新 ${result.updated} 单`);
  if (result.unassigned) parts.push(`未分配 ${result.unassigned} 单`);
  if (result.failed) parts.push(`失败 ${result.failed} 单`);
  result.message = `同步完成: ${parts.join("，")}`;
  return result;
}

/** 订单详情落库 */
async function insertOrder(
  supabase: Awaited<ReturnType<typeof getSupabaseAdminClient>>,
  detail: FangguoOrderDetail,
  shopId: string,
  userId: string
): Promise<boolean> {
  const mapped = mapDfStatusToOrderStatus(detail);
  const firstItem = detail.orderItems?.[0];
  const totalQty = (detail.orderItems ?? []).reduce((s, i) => s + (i.num ?? 1), 0);
  const totalPrice = (detail.orderItems ?? []).reduce((s, i) => s + (i.price ?? 0) * (i.num ?? 1), 0);
  const trackingItem = detail.orderItems?.find((i) => i.logisticsOrderNum);

  const { error } = await supabase.from("orders").insert({
    user_id: userId,
    shop_id: shopId,
    platform: mapPlatformCode(detail.platform, detail.platformDesc),
    order_no: detail.tid,
    sys_tid: detail.sysTid,
    df_status: detail.dfStatus,
    store_name: detail.storeName,
    factory_id: detail.factoryId != null ? String(detail.factoryId) : null,
    status: mapped.status,
    decode_status: mapped.decodeStatus,
    product_name: firstItem?.title ?? null,
    product_image: firstItem?.merchandisePicPath || null,
    spec: firstItem?.skuPropertiesName ?? null,
    merchant_code: firstItem?.shopMappingSku || null,
    quantity: totalQty || 1,
    price: totalPrice.toFixed(2),
    tracking_no: trackingItem?.logisticsOrderNum || null,
    logistics_company: trackingItem?.logisticsCompanyCode || null,
    pay_time: detail.payTime ? new Date(detail.payTime).toISOString() : null,
    deliver_time: detail.deliverTime ? new Date(detail.deliverTime).toISOString() : null,
    remark: [detail.buyerRemark, detail.shopRemark].filter(Boolean).join(" | ") || null,
    order_data: detail as unknown as Record<string, unknown>,
    last_sync_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[sync] insert order failed:", detail.tid, error.message);
    return false;
  }
  return true;
}
