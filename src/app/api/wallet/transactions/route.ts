import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, ensureUserBalance } from '@/lib/auth-utils';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 获取钱包流水记录
export async function GET(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { user, error: authError } = await getCurrentUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: authError || '认证失败' }, { status: 401 });
  }

  const client = getSupabaseClient(token ?? undefined);
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const type = searchParams.get('type');

  try {
    await ensureUserBalance(user.id, client);

    let query = client
      .from('wallet_transactions')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (type && type !== 'all') {
      query = query.eq('type', type);
    }

    const { data, count, error } = await query
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (error) throw error;

    return NextResponse.json({
      list: data,
      total: count,
      page,
      pageSize,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '查询流水失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
