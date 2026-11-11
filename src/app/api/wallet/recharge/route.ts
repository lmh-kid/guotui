import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, ensureUserBalance } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';

// 模拟充值（实际应接入支付网关）
export async function POST(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { user, error: authError } = await getCurrentUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: authError || '认证失败' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { amount } = body as { amount: string };

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      return NextResponse.json({ error: '充值金额无效' }, { status: 400 });
    }

    const adminClient = getSupabaseAdminClient();

    await ensureUserBalance(user.id);

    // 查询当前余额
    const { data: balanceData, error: balanceError } = await adminClient
      .from('user_balances')
      .select('balance, total_recharge')
      .eq('user_id', user.id)
      .single();

    if (balanceError) throw balanceError;

    const currentBalance = parseFloat(balanceData.balance as string);
    const currentRecharge = parseFloat(balanceData.total_recharge as string);
    const newBalance = (currentBalance + amountNum).toFixed(2);
    const newTotalRecharge = (currentRecharge + amountNum).toFixed(2);

    // 更新余额
    const { error: updateError } = await adminClient
      .from('user_balances')
      .update({
        balance: newBalance,
        total_recharge: newTotalRecharge,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', user.id);

    if (updateError) throw updateError;

    // 写入流水
    const { error: txError } = await adminClient
      .from('wallet_transactions')
      .insert({
        user_id: user.id,
        type: 'recharge',
        amount: amountNum.toFixed(2),
        balance_after: newBalance,
        description: '账户充值',
      });

    if (txError) throw txError;

    return NextResponse.json({
      success: true,
      message: '充值成功',
      balance: newBalance,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '充值失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
