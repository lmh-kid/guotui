import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-utils';
import { fetchLiveOrders, filterByShops, LiveOrder } from '@/lib/fangguo-live';
import { settleUser, getPushBillingStats, getUserShopNames } from '@/lib/push-billing';
import { FangguoApiError } from '@/lib/fangguo';

/**
 * 订单列表（实时透传方果 API，不落库）
 * - 惰性触发昨日推单日结算
 * - 按用户分配的店铺过滤
 * - 60s 全局缓存（多用户共享同一份方果数据）
 *
 * Query: page, pageSize, status, keyword, days(1今天/3近3天/7近7天)
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { user, error: authError } = await getCurrentUser(token);

  if (authError || !user) {
    return NextResponse.json({ error: authError || '认证失败' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));
  const status = searchParams.get('status');
  const keyword = (searchParams.get('keyword') || '').trim().toLowerCase();
  const daysRaw = parseInt(searchParams.get('days') || '1', 10);
  const days: 1 | 3 | 7 = daysRaw === 3 || daysRaw === 7 ? daysRaw : 1;

  try {
    // 1. 惰性日结算（昨日及更早的推单扣费）
    await settleUser(user.id);

    // 2. 计费状态（余额/配额/禁推）
    const [billing, shopNames] = await Promise.all([
      getPushBillingStats(user.id),
      getUserShopNames(user.id),
    ]);

    const response = {
      list: [] as LiveOrder[],
      total: 0,
      page,
      pageSize,
      statusCounts: { all: 0 } as Record<string, number>,
      billing,
      noShop: shopNames.length === 0,
      days,
    };

    if (shopNames.length === 0) {
      return NextResponse.json(response);
    }

    // 3. 实时拉取 + 店铺过滤
    const allOrders = filterByShops(await fetchLiveOrders(days), shopNames);

    // 4. 状态计数（过滤前统计）
    const counts: Record<string, number> = { all: allOrders.length };
    for (const o of allOrders) {
      counts[o.status] = (counts[o.status] || 0) + 1;
    }

    // 5. 状态 + 关键词过滤
    let filtered = allOrders;
    if (status && status !== 'all') {
      filtered = filtered.filter((o) => o.status === status);
    }
    if (keyword) {
      filtered = filtered.filter(
        (o) =>
          o.order_no.toLowerCase().includes(keyword) ||
          o.product_name.toLowerCase().includes(keyword) ||
          o.store_name.toLowerCase().includes(keyword) ||
          (o.merchant_code ?? '').toLowerCase().includes(keyword)
      );
    }

    // 6. 内存分页
    const start = (page - 1) * pageSize;
    response.list = filtered.slice(start, start + pageSize);
    response.total = filtered.length;
    response.statusCounts = counts;

    return NextResponse.json(response);
  } catch (err: unknown) {
    if (err instanceof FangguoApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : '查询订单失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
