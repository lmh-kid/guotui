import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, checkIsAdmin } from '@/lib/auth-utils';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('x-session');
    const { user, error: authError } = await getCurrentUser(token ?? undefined);

    if (authError || !user) {
      return NextResponse.json({ error: authError || '请先登录' }, { status: 401 });
    }

    const client = getCurrentUserClient(token!);
    const isAdmin = await checkIsAdmin(user.id, client);
    if (!isAdmin) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '20');
    const userId = searchParams.get('userId');

    // 使用 service role 查询（绕过 RLS）
    const supabaseUrl = process.env.COZE_SUPABASE_URL!;
    const supabaseServiceKey = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY!;
    const adminClient = createAdminClient(supabaseUrl, supabaseServiceKey);

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

    // 获取所有用户邮箱映射
    const { data: authUsers } = await adminClient.auth.admin.listUsers();
    const emailMap = new Map(authUsers.users.map((u) => [u.id, u.email]));

    const list = (data || []).map((t) => ({
      ...t,
      email: emailMap.get(t.user_id) || '未知',
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

import { getSupabaseClient } from '@/storage/database/supabase-client';
import { createClient } from '@supabase/supabase-js';

function getCurrentUserClient(token: string) {
  return getSupabaseClient(token);
}

function createAdminClient(url: string, key: string) {
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
