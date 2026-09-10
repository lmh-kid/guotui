import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-utils';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 批量订单解码
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
      return NextResponse.json({ error: '请选择要解码的订单' }, { status: 400 });
    }

    const client = getSupabaseClient(token ?? undefined);

    // 查询订单
    const { data: orders, error: ordersError } = await client
      .from('orders')
      .select('id, decode_status, spec')
      .in('id', order_ids)
      .eq('user_id', user.id);

    if (ordersError) throw ordersError;

    // 过滤待解码的订单
    const pendingOrders = orders?.filter((o) => o.decode_status !== 'success') || [];

    if (pendingOrders.length === 0) {
      return NextResponse.json({ error: '没有需要解码的订单' }, { status: 400 });
    }

    // 模拟批量智能解码
    const mockCodes = ['FG-001', 'FG-002', 'FG-003', 'FG-004', 'FG-005', 'FG-006'];
    let successCount = 0;
    let failCount = 0;

    for (const order of pendingOrders) {
      const decodeSuccess = Math.random() > 0.2;
      const merchantCode = decodeSuccess
        ? mockCodes[Math.floor(Math.random() * mockCodes.length)]
        : null;

      const { error: updateError } = await client
        .from('orders')
        .update({
          decode_status: decodeSuccess ? 'success' : 'fail',
          merchant_code: merchantCode,
          updated_at: new Date().toISOString(),
        })
        .eq('id', order.id)
        .eq('user_id', user.id);

      if (updateError) {
        console.error('更新订单解码状态失败:', updateError);
        failCount++;
      } else if (decodeSuccess) {
        successCount++;
      } else {
        failCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `批量解码完成：成功 ${successCount} 个，失败 ${failCount} 个`,
      successCount,
      failCount,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '批量解码失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
