import { getSupabaseAdminClient } from "@/storage/database/supabase-client";
import { PUSH_FEE } from "@/lib/billing";

/**
 * 推单计费模块（日结模式）
 *
 * 设计:
 * - 推单成功 → push_records 插一条 (fee_applied=false)，不立即扣费
 * - 次日用户任意请求（余额/订单/推单）触发惰性结算:
 *   汇总 push_date < 今天 的未结算记录 → 一次性扣费 → 写一条汇总流水 → 标记已结算
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

export interface SettleResult {
  settledCount: number; // 本次结算单数
  amount: number; // 本次扣费金额
  balance: number; // 结算后余额
}

/** 每用户结算互斥锁（防并发重复结算） */
const settleLocks = new Map<string, Promise<SettleResult>>();

/**
 * 惰性日结算：结算该用户所有 push_date < 今天 的未结算推单
 * 幂等：fee_applied 标记 + per-user 锁 + balance 条件更新三重保障
 */
export async function settleUser(userId: string): Promise<SettleResult> {
  const existing = settleLocks.get(userId);
  if (existing) return existing;

  const task = (async (): Promise<SettleResult> => {
    const supabase = await getSupabaseAdminClient();
    const today = localDateStr();

    // 1. 找出所有待结算的历史记录
    const { data: pending, error } = await supabase
      .from("push_records")
      .select("id, push_date")
      .eq("user_id", userId)
      .eq("fee_applied", false)
      .lt("push_date", today);

    if (error) {
      console.error("[settle] query pending failed:", error.message);
      return { settledCount: 0, amount: 0, balance: 0 };
    }
    if (!pending || pending.length === 0) {
      return { settledCount: 0, amount: 0, balance: 0 };
    }

    // 2. 按日期分组汇总（每天一条流水）
    const byDate = new Map<string, number>();
    for (const r of pending) {
      byDate.set(r.push_date, (byDate.get(r.push_date) ?? 0) + 1);
    }

    const amount = pending.length * PUSH_FEE;

    // 3. 扣余额（乐观锁，允许扣成负数）
    let newBalance = 0;
    let updated = false;
    for (let attempt = 0; attempt < 3 && !updated; attempt++) {
      const { data: bal, error: readErr } = await supabase
        .from("user_balances")
        .select("balance, total_consume")
        .eq("user_id", userId)
        .single();
      if (readErr || !bal) {
        console.error("[settle] read balance failed:", readErr?.message);
        return { settledCount: 0, amount: 0, balance: 0 };
      }

      const current = parseFloat(bal.balance as string);
      newBalance = parseFloat((current - amount).toFixed(2));
      const newTotalConsume = (
        parseFloat(bal.total_consume as string) + amount
      ).toFixed(2);

      const { data: upd, error: updErr } = await supabase
        .from("user_balances")
        .update({
          balance: newBalance.toFixed(2),
          total_consume: newTotalConsume,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("balance", bal.balance)
        .select("balance")
        .single();

      if (updErr) {
        console.error("[settle] update balance failed:", updErr.message);
        return { settledCount: 0, amount: 0, balance: current };
      }
      if (upd) updated = true;
    }

    if (!updated) {
      console.error("[settle] optimistic lock exhausted, skip settle");
      return { settledCount: 0, amount: 0, balance: 0 };
    }

    // 4. 写汇总流水（每天一条）
    for (const [date, count] of byDate) {
      const desc = date.replace(/-/g, "/").slice(5); // MM/DD
      await supabase.from("wallet_transactions").insert({
        user_id: userId,
        type: "consume",
        amount: `-${(count * PUSH_FEE).toFixed(2)}`,
        balance_after: newBalance.toFixed(2),
        description: `${desc}推单 ${count} 单，日结算扣费（¥${PUSH_FEE.toFixed(2)}/单）`,
      });
    }

    // 5. 标记已结算
    await supabase
      .from("push_records")
      .update({ fee_applied: true, settled_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("fee_applied", false)
      .lt("push_date", today);

    return { settledCount: pending.length, amount, balance: newBalance };
  })();

  settleLocks.set(userId, task);
  try {
    return await task;
  } finally {
    settleLocks.delete(userId);
  }
}

export interface PushBillingStats {
  balance: number;
  blocked: boolean; // 负余额，禁止推单
  todayPushed: number; // 今日已推单数（含已结算与未结算）
  todayUnsettled: number; // 今日未结算单数
  unsettledAmount: number; // 今日未结算金额
  availableQuota: number; // 今日还可推单数（估算）
}

/** 推单计费状态（先执行 settleUser 再调用） */
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
