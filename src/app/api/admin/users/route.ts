import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getCurrentUser, checkIsAdmin, ensureUserBalance } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';
import { isValidAccountName, normalizeAsciiInput } from '@/lib/account';
import { hashPassword } from '@/lib/password';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('x-session');
    const { user, error: authError } = await getCurrentUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: authError || '请先登录' }, { status: 401 });
    }

    await ensureUserBalance(user.id);

    const isAdmin = await checkIsAdmin(user.id);
    if (!isAdmin) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const adminClient = getSupabaseAdminClient();

    // 账号表 left join 余额表（自建认证体系，无 Supabase Auth 依赖）
    const { data: accounts, error: accError } = await adminClient
      .from('auth_accounts')
      .select('user_id, account, created_at');
    if (accError) throw new Error(`获取用户列表失败: ${accError.message}`);

    const { data: balances, error: balError } = await adminClient
      .from('user_balances')
      .select('*');
    if (balError) throw new Error(`获取余额失败: ${balError.message}`);

    const userList = (accounts || []).map((a) => {
      const bal = balances?.find((b) => b.user_id === a.user_id);
      return {
        id: a.user_id,
        account: a.account,
        email: a.account, // 兼容旧字段名
        createdAt: a.created_at,
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
    const { user, error: authError } = await getCurrentUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: authError || '请先登录' }, { status: 401 });
    }

    const isAdmin = await checkIsAdmin(user.id);
    if (!isAdmin) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const body = await request.json();
    const { account: accountRaw, password: passwordRaw, initialBalance } = body;

    const account = normalizeAsciiInput(String(accountRaw ?? '')).toLowerCase();
    if (!account) {
      return NextResponse.json({ error: '请输入账号' }, { status: 400 });
    }
    if (!isValidAccountName(account)) {
      return NextResponse.json(
        { error: '账号格式不正确：字母开头，仅支持字母/数字/._-，2-32位' },
        { status: 400 }
      );
    }
    const password = normalizeAsciiInput(String(passwordRaw ?? ''));
    if (!password || password.length < 6) {
      return NextResponse.json({ error: '密码长度至少6位' }, { status: 400 });
    }

    const balance = parseFloat(initialBalance) || 0;
    if (balance < 0) {
      return NextResponse.json({ error: '初始余额不能为负数' }, { status: 400 });
    }

    const adminClient = getSupabaseAdminClient();

    // 账号唯一性检查
    const { data: existing } = await adminClient
      .from('auth_accounts')
      .select('user_id')
      .eq('account', account)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: '该账号已被使用' }, { status: 400 });
    }

    // 创建账号 + 余额记录
    const newUserId = randomUUID();
    const { data: newUser, error: createError } = await adminClient
      .from('auth_accounts')
      .insert({ user_id: newUserId, account, password_hash: await hashPassword(password) })
      .select('user_id, account')
      .single();

    if (createError || !newUser) {
      return NextResponse.json({ error: `创建用户失败: ${createError?.message}` }, { status: 400 });
    }

    await adminClient.from('user_balances').insert({
      user_id: newUser.user_id,
      balance: balance.toFixed(2),
      total_recharge: balance.toFixed(2),
    });

    // 如果有初始余额，记录一笔充值流水
    if (balance > 0) {
      await adminClient.from('wallet_transactions').insert({
        user_id: newUser.user_id,
        type: 'recharge',
        amount: balance.toFixed(2),
        balance_after: balance.toFixed(2),
        description: '管理员开通账号赠送初始余额',
      });
    }

    return NextResponse.json({
      success: true,
      message: '用户创建成功',
      user: { id: newUser.user_id, account: newUser.account },
    });
  } catch (error) {
    console.error('[Admin CreateUser] 错误:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// 删除用户（管理员）
export async function DELETE(request: NextRequest) {
  try {
    const token = request.headers.get('x-session');
    const { user, error: authError } = await getCurrentUser(token);

    if (authError || !user) {
      return NextResponse.json({ error: authError || '请先登录' }, { status: 401 });
    }

    const isAdmin = await checkIsAdmin(user.id);
    if (!isAdmin) {
      return NextResponse.json({ error: '无权限访问' }, { status: 403 });
    }

    const body = await request.json();
    const { userId } = body as { userId?: string };

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    if (userId === user.id) {
      return NextResponse.json({ error: '不能删除当前登录账号' }, { status: 400 });
    }

    const adminClient = getSupabaseAdminClient();

    // 校验目标用户存在且非管理员
    const { data: target } = await adminClient
      .from('user_balances')
      .select('user_id, is_admin')
      .eq('user_id', userId)
      .maybeSingle();
    if (!target) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }
    if (target.is_admin) {
      return NextResponse.json({ error: '不能删除管理员账号' }, { status: 400 });
    }

    // 清理关联数据：会话、账号、店铺分配、钱包流水、推单计费记录、余额（任一失败则中止，避免产生孤儿数据）
    const cleanupTables: Array<{ table: string; label: string }> = [
      { table: 'auth_sessions', label: '登录会话' },
      { table: 'auth_accounts', label: '账号' },
      { table: 'shops', label: '店铺分配' },
      { table: 'wallet_transactions', label: '钱包流水' },
      { table: 'push_records', label: '推单记录' },
      { table: 'user_balances', label: '余额账户' },
    ];
    for (const { table, label } of cleanupTables) {
      const { error: cleanError } = await adminClient.from(table).delete().eq('user_id', userId);
      if (cleanError) {
        console.error(`[Admin DeleteUser] 清理${label}失败:`, cleanError);
        return NextResponse.json(
          { error: `清理${label}失败: ${cleanError.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({ success: true, message: '用户已删除' });
  } catch (error) {
    console.error('[Admin DeleteUser] 错误:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
