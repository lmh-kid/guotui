import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-utils';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 获取订单列表
export async function GET(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { user, error: authError } = await getCurrentUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: authError || '认证失败' }, { status: 401 });
  }

  const client = getSupabaseClient(token ?? undefined);
  const { searchParams } = new URL(req.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') || '20', 10);
  const status = searchParams.get('status');
  const keyword = searchParams.get('keyword');
  const shopId = searchParams.get('shopId');
  const platform = searchParams.get('platform');

  try {
    let query = client
      .from('orders')
      .select('*', { count: 'exact' })
      .eq('user_id', user.id);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    if (shopId) {
      query = query.eq('shop_id', shopId);
    }
    if (platform) {
      query = query.eq('platform', platform);
    }
    if (keyword) {
      query = query.or(`order_no.ilike.%${keyword}%,receiver_name.ilike.%${keyword}%,product_name.ilike.%${keyword}%`);
    }

    const { data, count, error } = await query
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (error) throw error;

    // 获取各状态订单数量
    const { data: statusCounts, error: countError } = await client
      .from('orders')
      .select('status')
      .eq('user_id', user.id);

    if (countError) throw countError;

    const counts: Record<string, number> = { all: count || 0 };
    if (statusCounts) {
      for (const item of statusCounts) {
        counts[item.status] = (counts[item.status] || 0) + 1;
      }
    }

    return NextResponse.json({
      list: data,
      total: count,
      page,
      pageSize,
      statusCounts: counts,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '查询订单失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// 批量创建订单（模拟导入/同步）
export async function POST(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { user, error: authError } = await getCurrentUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: authError || '认证失败' }, { status: 401 });
  }

  const client = getSupabaseClient(token ?? undefined);

  try {
    const body = await req.json();
    const orders = Array.isArray(body) ? body : [body];

    const ordersWithUserId = orders.map((order) => ({
      ...order,
      user_id: user.id,
    }));

    const { data, error } = await client
      .from('orders')
      .insert(ordersWithUserId)
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '创建订单失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
