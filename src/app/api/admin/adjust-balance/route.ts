import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, checkIsAdmin } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { userId, amount, description } = body;

    if (!userId || !amount || amount === 0) {
      return NextResponse.json({ error: '参数错误' }, { status: 400 });
    }

    // 使用 service role 操作（绕过 RLS）
    const adminClient = getSupabaseAdminClient();

    // 查询当前余额
    const { data: current, error: queryError } = await adminClient
      .from('user_balances')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (queryError) throw new Error(`查询余额失败: ${queryError.message}`);
    if (!current) throw new Error('用户余额记录不存在');

    const currentBalance = parseFloat(current.balance);
    const adjustAmount = parseFloat(amount);
    const newBalance = currentBalance + adjustAmount;

    if (newBalance < 0) {
      return NextResponse.json({ error: '调整后余额不能为负数' }, { status: 400 });
    }

    // 更新余额
    const updateData: Record<string, unknown> = {
      balance: newBalance.toFixed(2),
      updated_at: new Date().toISOString(),
    };

    if (adjustAmount > 0) {
      updateData.total_recharge = (parseFloat(current.total_recharge) + adjustAmount).toFixed(2);
    } else {
      updateData.total_consume = (parseFloat(current.total_consume) + Math.abs(adjustAmount)).toFixed(2);
    }

    const { error: updateError } = await adminClient
      .from('user_balances')
      .update(updateData)
      .eq('user_id', userId);

    if (updateError) throw new Error(`更新余额失败: ${updateError.message}`);

    // 记录流水
    const { error: txError } = await adminClient
      .from('wallet_transactions')
      .insert({
        user_id: userId,
        type: adjustAmount > 0 ? 'recharge' : 'consume',
        amount: Math.abs(adjustAmount).toFixed(2),
        balance_after: newBalance.toFixed(2),
        description: description || (adjustAmount > 0 ? '管理员充值' : '管理员扣费'),
      });

    if (txError) throw new Error(`记录流水失败: ${txError.message}`);

    return NextResponse.json({
      success: true,
      data: {
        userId,
        previousBalance: currentBalance.toFixed(2),
        newBalance: newBalance.toFixed(2),
        adjustAmount: adjustAmount.toFixed(2),
      },
    });
  } catch (error) {
    console.error('[Admin Adjust Balance] 错误:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

import { getSupabaseClient } from '@/storage/database/supabase-client';

function getCurrentUserClient(token: string) {
  return getSupabaseClient(token);
}
