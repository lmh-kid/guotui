import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-utils';
import { syncFangguoOrders } from '@/lib/fangguo-sync';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';

/**
 * 用户触发的订单同步：实时调方果 API 拉取订单
 * - force=false（页面自动触发）：距上次同步 < 60s 时跳过，控制方果 API 调用量
 * - force=true（手动点击「同步订单」）：总是执行
 * - 内存锁防止并发重复同步（order_no 唯一索引兜底）
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get('x-session');
  const { user, error: authError } = await getCurrentUser(token);
  if (!user) {
    return NextResponse.json({ error: authError || '请先登录' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const force = (body as { force?: boolean })?.force === true;

  const g = globalThis as unknown as { __fgSyncRunning?: boolean };
  if (g.__fgSyncRunning) {
    return NextResponse.json({
      success: true,
      skipped: true,
      message: '同步进行中，请稍候',
      fetched: 0, inserted: 0, updated: 0, unassigned: 0, failed: 0,
    });
  }

  // 自动触发模式下的节流
  if (!force) {
    const supabase = await getSupabaseAdminClient();
    const { data } = await supabase
      .from('system_configs')
      .select('value')
      .eq('key', 'fangguo_last_sync_time')
      .maybeSingle();
    const last = data?.value ? Number(data.value) : 0;
    if (last > 0 && Date.now() - last < 60_000) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: '刚刚已同步',
        fetched: 0, inserted: 0, updated: 0, unassigned: 0, failed: 0,
      });
    }
  }

  g.__fgSyncRunning = true;
  try {
    const result = await syncFangguoOrders(1);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : '同步失败';
    return NextResponse.json({ success: false, message }, { status: 500 });
  } finally {
    g.__fgSyncRunning = false;
  }
}
