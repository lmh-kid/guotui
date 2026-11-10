import { getSupabaseAdminClient } from "@/storage/database/supabase-client";

/**
 * 计费模块：推单扣费（原子操作，乐观锁重试）
 */

export const PUSH_FEE = 0.5; // 推单费用 0.5 元/单

export interface ChargeResult {
  success: boolean;
  error?: string;
  balance?: number; // 扣费后余额
}

/**
 * 扣费（单用户单笔）
 * 乐观锁: UPDATE ... WHERE balance = old，冲突重试
 */
export async function chargeUser(
  userId: string,
  amount: number,
  description: string,
  orderId?: string
): Promise<ChargeResult> {
  const supabase = await getSupabaseAdminClient();

  for (let attempt = 0; attempt < 3; attempt++) {
    // 读取当前余额
    const { data: bal, error: readErr } = await supabase
      .from("user_balances")
      .select("balance, total_consume")
      .eq("user_id", userId)
      .single();

    if (readErr || !bal) {
      return { success: false, error: "查询余额失败" };
    }

    const current = parseFloat(bal.balance as string);
    if (current < amount) {
      return { success: false, error: `余额不足（当前 ${current.toFixed(2)} 元），请先充值` };
    }

    const newBalance = (current - amount).toFixed(2);
    const newTotalConsume = (parseFloat(bal.total_consume as string) + amount).toFixed(2);

    // 乐观锁更新
    const { data: updated, error: updErr } = await supabase
      .from("user_balances")
      .update({
        balance: newBalance,
        total_consume: newTotalConsume,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("balance", bal.balance)
      .select("balance")
      .single();

    if (updErr) {
      return { success: false, error: `扣费失败: ${updErr.message}` };
    }

    if (!updated) {
      // 余额被并发修改，重试
      continue;
    }

    // 写流水
    const { error: txErr } = await supabase.from("wallet_transactions").insert({
      user_id: userId,
      type: "consume",
      amount: `-${amount.toFixed(2)}`,
      balance_after: newBalance,
      order_id: orderId ?? null,
      description,
    });

    if (txErr) {
      console.error("[billing] write transaction failed:", txErr.message);
      // 流水写入失败不阻断主流程，仅记录日志
    }

    return { success: true, balance: parseFloat(newBalance) };
  }

  return { success: false, error: "扣费冲突，请重试" };
}
