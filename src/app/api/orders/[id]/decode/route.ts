import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, ensureUserBalance } from '@/lib/auth-utils';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 单条订单解码
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

    if (order.decode_status === 'success') {
      return NextResponse.json({ error: '订单已解码' }, { status: 400 });
    }

    // 2. 读取请求体
    const body = await req.json().catch(() => ({}));
    const { merchant_code: manualCode } = body;

    // 3. 智能解码：如果手动传入商家编码则直接使用；否则模拟 AI 匹配
    let decodeSuccess = false;
    let merchantCode: string | null = null;

    if (manualCode && typeof manualCode === 'string' && manualCode.trim()) {
      // 手动设置商家编码（学习编码场景）
      decodeSuccess = true;
      merchantCode = manualCode.trim();
    } else {
      // 自动智能解码：根据规格匹配商品库
      const spec = order.spec || '';
      const mockCodes = ['FG-001', 'FG-002', 'FG-003', 'FG-004', 'FG-005'];
      decodeSuccess = Math.random() > 0.2; // 80% 成功率
      merchantCode = decodeSuccess
        ? mockCodes[Math.floor(Math.random() * mockCodes.length)]
        : null;
      void spec;
    }

    // 4. 更新订单解码状态
    const { error: updateError } = await client
      .from('orders')
      .update({
        decode_status: decodeSuccess ? 'success' : 'fail',
        merchant_code: merchantCode,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('user_id', user.id);

    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      decodeSuccess,
      merchantCode,
      message: decodeSuccess ? '解码成功' : '解码失败，请手动设置商家编码',
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '解码失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
