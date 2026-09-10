import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function getCurrentUser(token: string | null) {
  if (!token) {
    return { user: null, error: '请先登录' };
  }

  const client = getSupabaseClient(token);
  const { data: { user }, error: authError } = await client.auth.getUser();

  if (authError || !user) {
    return { user: null, error: '认证失败' };
  }

  return { user, client: client as ReturnType<typeof getSupabaseClient>, error: null };
}

export async function ensureUserBalance(userId: string, client: ReturnType<typeof getSupabaseClient>) {
  // 检查用户余额记录是否存在，不存在则创建
  const { data: existing, error } = await client
    .from('user_balances')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`查询余额失败: ${error.message}`);

  if (!existing) {
    const { error: insertError } = await client
      .from('user_balances')
      .insert({ user_id: userId });
    if (insertError) throw new Error(`创建余额记录失败: ${insertError.message}`);
  }
}
