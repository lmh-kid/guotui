import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';
import { hashPassword, verifyPassword } from '@/lib/password';
import { isValidAccountName, normalizeAsciiInput } from '@/lib/account';
import { SESSION_TTL_MS, ensureUserBalance, checkIsAdmin } from '@/lib/auth-utils';

/**
 * POST /api/auth/login  body: { account, password }
 * 自建账号密码认证，成功返回 { token, user: { id, account, isAdmin } }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { account?: string; password?: string };

    const account = normalizeAsciiInput(String(body.account ?? '')).toLowerCase();
    const password = normalizeAsciiInput(String(body.password ?? ''));

    if (!account || !password) {
      return NextResponse.json({ error: '请输入账号和密码' }, { status: 400 });
    }

    const client = getSupabaseAdminClient();

    const { data: authAccount, error: queryError } = await client
      .from('auth_accounts')
      .select('user_id, account, password_hash')
      .eq('account', account)
      .maybeSingle();

    // 无论账号是否存在，报错统一，避免账号枚举
    if (queryError) {
      console.error('[Auth Login] 查询账号失败:', queryError);
      return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 });
    }
    if (!authAccount) {
      return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
    }

    const ok = await verifyPassword(password, authAccount.password_hash);
    if (!ok) {
      return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
    }

    await ensureUserBalance(authAccount.user_id);

    const isAdmin = await checkIsAdmin(authAccount.user_id);

    // 签发会话 token
    const token = randomBytes(32).toString('hex');
    const { error: sessionError } = await client.from('auth_sessions').insert({
      token,
      user_id: authAccount.user_id,
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    });
    if (sessionError) {
      console.error('[Auth Login] 创建会话失败:', sessionError);
      return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 });
    }

    return NextResponse.json({
      token,
      user: { id: authAccount.user_id, account: authAccount.account, isAdmin },
    });
  } catch (error) {
    console.error('[Auth Login] 错误:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
