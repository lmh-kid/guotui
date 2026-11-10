import { getSupabaseClient } from '@/storage/database/supabase-client';

export async function getCurrentUser(token: string | null | undefined) {
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

export async function checkIsAdmin(userId: string, client: ReturnType<typeof getSupabaseClient>) {
  const { data, error } = await client
    .from('user_balances')
    .select('is_admin')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) return false;
  return data?.is_admin === true;
}

/**
 * 管理员鉴权快捷方式：验证 token 并检查管理员身份
 * 返回 { user } 或 null（调用方直接返回 401/403）
 */
export async function requireAdminRequest(token: string | null | undefined) {
  const { user } = await getCurrentUser(token);
  if (!user) {
    return { user: null, isAdmin: false, error: '请先登录' as const };
  }
  const client = getSupabaseClient(token as string);
  const isAdmin = await checkIsAdmin(user.id, client);
  if (!isAdmin) {
    return { user, isAdmin: false, error: '无权限访问' as const };
  }
  return { user, isAdmin: true, error: null };
}
