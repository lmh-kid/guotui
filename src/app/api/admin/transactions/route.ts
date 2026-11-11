import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, checkIsAdmin } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('x-session');
    const { user, error: authError } = await getCurrentUser(token ?? undefined);

    if (authError || !user) {
      return NextResponse.json({ error: authError || '请先登录' }, { status: 401 });
    }

    const isAdmin = await checkIsAdmin(user.id);
    if (!isAdmin) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const userId = searchParams.get('userId');

    // 使用 service role 查询（绕过 RLS）
    const adminClient = getSupabaseAdminClient();

    let query = adminClient
      .from('wallet_transactions')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, error, count } = await query;
    if (error) throw new Error(`查询流水失败: ${error.message}`);

    // 获取账号名映射（自建认证体系）
    const { data: accounts } = await adminClient
      .from('auth_accounts')
      .select('user_id, account');
    const accountMap = new Map((accounts || []).map((a) => [a.user_id, a.account]));

    const list = (data || []).map((t) => ({
      ...t,
      account: accountMap.get(t.user_id) || '未知',
      email: accountMap.get(t.user_id) || '未知', // 兼容旧字段名
    }));

    return NextResponse.json({
      list,
      total: count || 0,
      page,
      pageSize,
    });
  } catch (error) {
    console.error('[Admin Transactions] 错误:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
