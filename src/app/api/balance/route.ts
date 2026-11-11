import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, ensureUserBalance } from '@/lib/auth-utils';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { settleUser } from '@/lib/push-billing';

/**
 * 获取用户余额
 * 顺带触发惰性日结算（跨天后首次访问自动结算昨日推单扣费）
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { user, error: authError } = await getCurrentUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: authError || '认证失败' }, { status: 401 });
  }

  const client = getSupabaseClient(token ?? undefined);

  try {
    // 确保余额记录存在
    await ensureUserBalance(user.id, client);

    // 惰性日结算（昨日推单扣费；失败不阻塞余额查询）
    await settleUser(user.id).catch((e) =>
      console.error('[balance] settle failed:', e instanceof Error ? e.message : e)
    );

    const { data, error } = await client
      .from('user_balances')
      .select('balance, frozen_balance, total_recharge, total_consume')
      .eq('user_id', user.id)
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '查询余额失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
