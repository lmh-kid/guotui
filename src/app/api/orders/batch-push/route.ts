import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, ensureUserBalance } from '@/lib/auth-utils';
import { getSupabaseClient } from '@/storage/database/supabase-client';

const PUSH_FEE = 0.5;

// 批量订单推单
export async function POST(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { user, error: authError } = await getCurrentUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: authError || '认证失败' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { order_ids } = body as { order_ids: string[] };

    if (!order_ids || order_ids.length === 0) {
      return NextResponse.json({ error: '请选择要推送的订单' }, { status: 400 });
    }

    const adminClient = getSupabaseClient();
    const client = getSupabaseClient(token ?? undefined);

    await ensureUserBalance(user.id, client);

    // 查询余额
    const { data: balanceData, error: balanceError } = await adminClient
      .from('user_balances')
      .select('balance')
      .eq('user_id', user.id)
      .single();

    if (balanceError) throw balanceError;

    const balance = parseFloat(balanceData.balance as string);
    const totalFee = order_ids.length * PUSH_FEE;

    if (balance < totalFee) {
      return NextResponse.json(
        { error: `余额不足，需要 ${totalFee.toFixed(2)} 元，当前余额 ${balance.toFixed(2)} 元` },
        { status: 400 }
      );
    }

    // 查询订单
    const { data: orders, error: ordersError } = await client
      .from('orders')
      .select('id, status, decode_status, order_no')
      .in('id', order_ids)
      .eq('user_id', user.id);

    if (ordersError) throw ordersError;

    // 过滤可推送的订单
    const pushableOrders = orders?.filter(
      (o) => o.status !== 'pushed' && o.decode_status === 'success'
    ) || [];

    if (pushableOrders.length === 0) {
      return NextResponse.json({ error: '没有可推送的订单（需解码成功且未推送）' }, { status: 400 });
    }

    const actualFee = pushableOrders.length * PUSH_FEE;
    const newBalance = (balance - actualFee).toFixed(2);

    // 更新余额
    const { error: updateBalanceError } = await adminClient
      .from('user_balances')
      .update({
        balance: newBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (updateBalanceError) throw updateBalanceError;

    // 批量写入流水
    const transactions = pushableOrders.map((order) => ({
      user_id: user.id,
      type: 'consume',
      amount: `-${PUSH_FEE.toFixed(2)}`,
      balance_after: newBalance,
      order_id: order.order_no,
      description: '订单推单扣费',
    }));

    const { error: txError } = await adminClient
      .from('wallet_transactions')
      .insert(transactions);

    if (txError) throw txError;

    // 批量更新订单状态
    const pushableIds = pushableOrders.map((o) => o.id);
    const { error: updateOrderError } = await client
      .from('orders')
      .update({
        status: 'pushed',
        updated_at: new Date().toISOString(),
      })
      .in('id', pushableIds)
      .eq('user_id', user.id);

    if (updateOrderError) throw updateOrderError;

    return NextResponse.json({
      success: true,
      message: `成功推送 ${pushableOrders.length} 个订单`,
      balance: newBalance,
      pushedCount: pushableOrders.length,
      skippedCount: (orders?.length || 0) - pushableOrders.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '批量推单失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
