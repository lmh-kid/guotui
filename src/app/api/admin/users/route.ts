import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, checkIsAdmin, ensureUserBalance } from '@/lib/auth-utils';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('x-session');
    const { user, error: authError } = await getCurrentUser(token ?? undefined);

    if (authError || !user) {
      return NextResponse.json({ error: authError || '请先登录' }, { status: 401 });
    }

    const client = getCurrentUserClient(token!);
    await ensureUserBalance(user.id, client);

    const isAdmin = await checkIsAdmin(user.id, client);
    if (!isAdmin) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    // 使用 service role 查询所有用户（绕过 RLS）
    const supabaseUrl = process.env.COZE_SUPABASE_URL!;
    const supabaseServiceKey = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY!;

    const adminClient = createAdminClient(supabaseUrl, supabaseServiceKey);

    // 获取所有 auth 用户
    const { data: authUsers, error: authError2 } = await adminClient.auth.admin.listUsers();
    if (authError2) throw new Error(`获取用户列表失败: ${authError2.message}`);

    // 获取所有用户余额
    const { data: balances, error: balError } = await adminClient
      .from('user_balances')
      .select('*');
    if (balError) throw new Error(`获取余额失败: ${balError.message}`);

    // 合并数据
    const userList = authUsers.users.map((u) => {
      const bal = balances?.find((b) => b.user_id === u.id);
      return {
        id: u.id,
        email: u.email,
        createdAt: u.created_at,
        balance: bal?.balance ?? '0.00',
        frozenBalance: bal?.frozen_balance ?? '0.00',
        totalRecharge: bal?.total_recharge ?? '0.00',
        totalConsume: bal?.total_consume ?? '0.00',
        isAdmin: bal?.is_admin ?? false,
      };
    });

    return NextResponse.json({ list: userList, total: userList.length });
  } catch (error) {
    console.error('[Admin Users] 错误:', error);
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
