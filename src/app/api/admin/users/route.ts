import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, checkIsAdmin, ensureUserBalance } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';
import { accountToEmail, isValidAccountName } from '@/lib/account';

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
    const adminClient = getSupabaseAdminClient();

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

// 创建用户（管理员）
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { account, email, password, initialBalance } = body;

    // 账号制：输入账号名（如 seller01）或完整邮箱（兼容历史格式）
    const rawName = String(account || email || '').trim();
    if (!rawName) {
      return NextResponse.json({ error: '请输入账号' }, { status: 400 });
    }
    if (!rawName.includes('@') && !isValidAccountName(rawName)) {
      return NextResponse.json(
        { error: '账号格式不正确：字母开头，仅支持字母/数字/._-，2-32位' },
        { status: 400 }
      );
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json({ error: '密码长度至少6位' }, { status: 400 });
    }

    const loginEmail = accountToEmail(rawName);

    const balance = parseFloat(initialBalance) || 0;
    if (balance < 0) {
      return NextResponse.json({ error: '初始余额不能为负数' }, { status: 400 });
    }

    const adminClient = getSupabaseAdminClient();

    // 检查账号是否已存在
    const { data: existingUsers } = await adminClient.auth.admin.listUsers();
    const exists = existingUsers?.users?.some((u) => u.email?.toLowerCase() === loginEmail.toLowerCase());
    if (exists) {
      return NextResponse.json({ error: '该账号已被使用' }, { status: 400 });
    }

    // 创建用户（email_confirm: true 直接可用，无需邮箱验证）
    const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
      email: loginEmail,
      password,
      email_confirm: true,
    });

    if (createError) {
      return NextResponse.json({ error: `创建用户失败: ${createError.message}` }, { status: 400 });
    }

    // 初始化余额账户
    const { error: balanceError } = await adminClient.from('user_balances').insert({
      user_id: newUser.user.id,
      balance: balance.toFixed(2),
      total_recharge: balance.toFixed(2),
    });

    if (balanceError) {
      console.error('[Admin CreateUser] 初始化余额失败:', balanceError);
    }

    // 如果有初始余额，记录一笔充值流水
    if (balance > 0) {
      await adminClient.from('wallet_transactions').insert({
        user_id: newUser.user.id,
        type: 'recharge',
        amount: balance.toFixed(2),
        balance_after: balance.toFixed(2),
        description: '管理员开通账号赠送初始余额',
      });
    }

    return NextResponse.json({
      success: true,
      message: '用户创建成功',
      user: { id: newUser.user.id, email: newUser.user.email },
    });
  } catch (error) {
    console.error('[Admin CreateUser] 错误:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

import { getSupabaseClient } from '@/storage/database/supabase-client';

function getCurrentUserClient(token: string) {
  return getSupabaseClient(token);
}
