import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';
import { PUSH_FEE } from '@/lib/billing';

/**
 * 推单日账单（管理员）
 * GET /api/admin/push-records?days=7
 *
 * 返回按 用户 × 日期 分组的推单统计：
 * - list: [{ user_id, email, push_date, total_count, unsettled_count, amount }]
 * - summary: { totalCount, unsettledCount, totalAmount, unsettledAmount }
 */
export async function GET(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { isAdmin, error: adminError } = await requireAdminRequest(token);

  if (adminError || !isAdmin) {
    return NextResponse.json({ error: adminError || '需要管理员权限' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const daysRaw = parseInt(searchParams.get('days') || '7', 10);
  const days = Math.min(31, Math.max(1, daysRaw));

  try {
    const supabase = await getSupabaseAdminClient();
    const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

    const { data: records, error } = await supabase
      .from('push_records')
      .select('user_id, push_date, fee_applied')
      .gte('push_date', since)
      .order('push_date', { ascending: false })
      .order('user_id');

    if (error) throw error;

    // 用户账号名映射（自建认证体系）
    const userIds = [...new Set((records ?? []).map((r) => r.user_id))];
    const { data: users } = await supabase
      .from('auth_accounts')
      .select('user_id, account')
      .in('user_id', userIds);
    const emailMap = new Map((users ?? []).map((u) => [u.user_id, u.account]));

    // 按 用户×日期 聚合
    const grouped = new Map<string, {
      user_id: string;
      email: string;
      push_date: string;
      total_count: number;
      unsettled_count: number;
    }>();
    for (const r of records ?? []) {
      const key = `${r.user_id}|${r.push_date}`;
      const g = grouped.get(key) ?? {
        user_id: r.user_id,
        email: emailMap.get(r.user_id) ?? r.user_id.slice(0, 8),
        push_date: r.push_date,
        total_count: 0,
        unsettled_count: 0,
      };
      g.total_count += 1;
      if (!r.fee_applied) g.unsettled_count += 1;
      grouped.set(key, g);
    }

    const list = [...grouped.values()]
      .map((g) => ({
        ...g,
        amount: parseFloat((g.total_count * PUSH_FEE).toFixed(2)),
        unsettled_amount: parseFloat((g.unsettled_count * PUSH_FEE).toFixed(2)),
      }))
      .sort((a, b) => (a.push_date < b.push_date ? 1 : a.push_date > b.push_date ? -1 : a.email.localeCompare(b.email)));

    const totalCount = list.reduce((s, g) => s + g.total_count, 0);
    const unsettledCount = list.reduce((s, g) => s + g.unsettled_count, 0);

    return NextResponse.json({
      list,
      summary: {
        totalCount,
        unsettledCount,
        totalAmount: parseFloat((totalCount * PUSH_FEE).toFixed(2)),
        unsettledAmount: parseFloat((unsettledCount * PUSH_FEE).toFixed(2)),
      },
      feePerOrder: PUSH_FEE,
      days,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '查询推单记录失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
