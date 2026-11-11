import { getSupabaseAdminClient } from '@/storage/database/supabase-client';

/** 会话有效期：7 天 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AuthUser {
  id: string;
  account: string;
}

/**
 * 自建认证体系（不走 Supabase Auth）：
 * x-session 为 auth_sessions 表中的 token，验证时联查账号与过期时间。
 */
export async function getCurrentUser(token: string | null | undefined) {
  if (!token) {
    return { user: null, error: '请先登录' };
  }

  const client = getSupabaseAdminClient();

  const { data: session, error: sessionError } = await client
    .from('auth_sessions')
    .select('user_id, expires_at')
    .eq('token', token)
    .maybeSingle();

  if (sessionError) {
    return { user: null, error: '认证失败' };
  }
  if (!session) {
    return { user: null, error: '登录已过期' };
  }
  if (new Date(session.expires_at).getTime() < Date.now()) {
    // 过期会话顺手清理
    await client.from('auth_sessions').delete().eq('token', token);
    return { user: null, error: '登录已过期' };
  }

  const { data: accountRow } = await client
    .from('auth_accounts')
    .select('account')
    .eq('user_id', session.user_id)
    .maybeSingle();

  if (!accountRow) {
    return { user: null, error: '账号不存在' };
  }

  const user: AuthUser = { id: session.user_id as string, account: accountRow.account };

  return { user, error: null };
}

/** 滑动续期：距过期不足一半时延长（不阻塞调用方，忽略失败） */
export async function touchSession(token: string): Promise<void> {
  try {
    const client = getSupabaseAdminClient();
    const { data: session } = await client
      .from('auth_sessions')
      .select('expires_at')
      .eq('token', token)
      .maybeSingle();
    if (!session) return;
    const expiresAt = new Date(session.expires_at).getTime();
    const now = Date.now();
    if (expiresAt - now < SESSION_TTL_MS / 2) {
      await client
        .from('auth_sessions')
        .update({ expires_at: new Date(now + SESSION_TTL_MS).toISOString(), last_used_at: new Date(now).toISOString() })
        .eq('token', token);
    } else {
      await client
        .from('auth_sessions')
        .update({ last_used_at: new Date(now).toISOString() })
        .eq('token', token);
    }
  } catch {
    // 续期失败不影响业务
  }
}

export async function ensureUserBalance(userId: string) {
  const client = getSupabaseAdminClient();
  const { data: existing, error } = await client
    .from('user_balances')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`查询余额失败: ${error.message}`);

  if (!existing) {
    const { error: insertError } = await client.from('user_balances').insert({ user_id: userId });
    if (insertError) throw new Error(`创建余额记录失败: ${insertError.message}`);
  }
}

export async function checkIsAdmin(userId: string) {
  const client = getSupabaseAdminClient();
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
  const isAdmin = await checkIsAdmin(user.id);
  if (!isAdmin) {
    return { user, isAdmin: false, error: '无权限访问' as const };
  }
  return { user, isAdmin: true, error: null };
}
