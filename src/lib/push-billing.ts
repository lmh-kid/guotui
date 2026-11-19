import { getSupabaseAdminClient } from "@/storage/database/supabase-client";
import { PUSH_FEE } from "@/lib/billing";

/**
 * 推单计费模块
 *
 * 设计（日结 = 定时任务模式，见 src/lib/daily-settlement.ts）:
 * - 推单成功 → push_records 插一条 (fee_applied=false)，不立即扣费
 * - 每天 00:00（Asia/Shanghai）定时任务结算账期 ≤ 昨天的费用:
 *   材运费（方果资金流水实扣）+ 0.5 × 推单数 → 每用户每天一条 consume 流水
 * - 结算允许余额扣成负数；负余额用户禁止推单，直到管理员补调
 * - 预检配额: floor(balance / 0.5) - 今日已推未结算单数
 */

/** 本地日期字符串 YYYY-MM-DD */
export function localDateStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface PushBillingStats {
  balance: number;
  blocked: boolean; // 负余额，禁止推单
  todayPushed: number; // 今日已推单数（含已结算与未结算）
  todayUnsettled: number; // 今日未结算单数
  unsettledAmount: number; // 今日未结算金额
  availableQuota: number; // 今日还可推单数（估算）
}

/** 推单计费状态 */
export async function getPushBillingStats(userId: string): Promise<PushBillingStats> {
  const supabase = await getSupabaseAdminClient();
  const today = localDateStr();

  const [{ data: bal }, { count: todayPushed }, { count: todayUnsettled }] =
    await Promise.all([
      supabase.from("user_balances").select("balance").eq("user_id", userId).single(),
      supabase
        .from("push_records")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("push_date", today),
      supabase
        .from("push_records")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("push_date", today)
        .eq("fee_applied", false),
    ]);

  const balance = parseFloat((bal?.balance as string) ?? "0");
  const pushed = todayPushed ?? 0;
  const unsettled = todayUnsettled ?? 0;
  const quota = Math.max(0, Math.floor(balance / PUSH_FEE) - unsettled);

  return {
    balance,
    blocked: balance < 0,
    todayPushed: pushed,
    todayUnsettled: unsettled,
    unsettledAmount: parseFloat((unsettled * PUSH_FEE).toFixed(2)),
    availableQuota: balance < 0 ? 0 : quota,
  };
}

/**
 * 记录推单（推单成功后调用）
 * UNIQUE(user_id, order_no) 幂等：已记录过的订单跳过
 * @returns 实际新增记录数
 */
export async function recordPushes(
  userId: string,
  orderNos: string[]
): Promise<number> {
  if (orderNos.length === 0) return 0;
  const supabase = await getSupabaseAdminClient();
  const today = localDateStr();

  const { data, error } = await supabase
    .from("push_records")
    .upsert(
      orderNos.map((orderNo) => ({
        user_id: userId,
        order_no: orderNo,
        push_date: today,
        fee_applied: false,
      })),
      { onConflict: "user_id,order_no", ignoreDuplicates: true }
    )
    .select("id");

  if (error) {
    console.error("[push-record] insert failed:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

/** 用户店铺名集合（订单归属过滤用） */
export async function getUserShopNames(userId: string): Promise<string[]> {
  const supabase = await getSupabaseAdminClient();
  const { data } = await supabase
    .from("shops")
    .select("shop_name")
    .eq("user_id", userId)
    .eq("status", "active");
  return (data ?? []).map((s) => s.shop_name).filter(Boolean);
}
