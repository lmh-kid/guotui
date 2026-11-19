import { NextRequest, NextResponse } from 'next/server';
import { requireAdminRequest } from '@/lib/auth-utils';
import { runDailySettlement } from '@/lib/daily-settlement';

/**
 * 手动触发日结（管理员）
 * POST /api/admin/settlement/run
 *
 * 与每天 00:00 的定时任务等价（全局互斥）：
 * 同步方果资金流水（近 5 天） + 结算账期 ≤ 昨天的材运费 + 0.5×推单数
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { isAdmin, error: adminError } = await requireAdminRequest(token);

  if (adminError || !isAdmin) {
    return NextResponse.json({ error: adminError || '需要管理员权限' }, { status: 403 });
  }

  try {
    const summary = await runDailySettlement();
    return NextResponse.json({
      success: true,
      summary,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '日结执行失败';
    console.error('[settlement-run] failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
