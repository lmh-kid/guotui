import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, ensureUserBalance } from '@/lib/auth-utils';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 单条订单推单
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = req.headers.get('x-session');
  const { user, error: authError } = await getCurrentUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: authError || '认证失败' }, { status: 401 });
  }

  const client = getSupabaseClient(token ?? undefined);
  const { id } = await params;

  try {
    await ensureUserBalance(user.id, client);

    // 1. 查询订单
    const { data: order, error: orderError } = await client
      .from('orders')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: '订单不存在' }, { status: 404 });
    }

    // 2. 检查订单状态
    if (order.status === 'pushed') {
      return NextResponse.json({ error: '订单已推送' }, { status: 400 });
    }

    if (order.decode_status !== 'success') {
      return NextResponse.json({ error: '请先完成解码再推送' }, { status: 400 });
    }

    // 3. 扣费 - 使用 service role 执行事务性操作
    const adminClient = getSupabaseClient();
    const PUSH_FEE = '0.50'; // 推单费用 0.5元

    // 查询当前余额
    const { data: balanceData, error: balanceError } = await adminClient
      .from('user_balances')
      .select('balance')
      .eq('user_id', user.id)
      .single();

    if (balanceError) throw balanceError;

    if (parseFloat(balanceData.balance as string) < parseFloat(PUSH_FEE)) {
      return NextResponse.json({ error: '余额不足，请先充值' }, { status: 400 });
    }

    // 更新余额
    const newBalance = (parseFloat(balanceData.balance as string) - parseFloat(PUSH_FEE)).toFixed(2);
    const { error: updateBalanceError } = await adminClient
      .from('user_balances')
      .update({
        balance: newBalance,
        total_consume: (parseFloat(balanceData.balance as string) - parseFloat(newBalance) + parseFloat(balanceData.balance as string) ? '0' : '0').toString(), // 简化处理
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (updateBalanceError) throw updateBalanceError;

    // 重新获取余额
    const { data: updatedBalance } = await adminClient
      .from('user_balances')
      .select('balance, total_consume')
      .eq('user_id', user.id)
      .single();

    // 写入流水
    const { error: txError } = await adminClient
      .from('wallet_transactions')
      .insert({
        user_id: user.id,
        type: 'consume',
        amount: `-${PUSH_FEE}`,
        balance_after: updatedBalance?.balance || '0',
        order_id: order.order_no,
        description: '订单推单扣费',
      });

    if (txError) throw txError;

    // 4. 更新订单状态
    const { error: updateOrderError } = await client
      .from('orders')
      .update({
        status: 'pushed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', user.id);

    if (updateOrderError) throw updateOrderError;

    return NextResponse.json({
      success: true,
      message: '推单成功',
      balance: newBalance,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '推单失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
