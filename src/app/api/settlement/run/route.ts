import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-utils';
import { runDailySettlement } from '@/lib/daily-settlement';

/**
 * 手动触发日结（测试用，暂对所有登录用户开放）
 * POST /api/settlement/run
 *
 * 与每天 00:00 的定时任务等价（全局互斥）：
 * 同步方果资金流水（近 7 天） + 结算账期 ≤ 今天的材运费 + 0.5×推单数（真实扣余额，迟到费用自动补扣/补退）
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get('x-session');
  const { user, error: authError } = await getCurrentUser(token);
  if (authError || !user) {
    return NextResponse.json({ error: authError || '认证失败' }, { status: 401 });
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
