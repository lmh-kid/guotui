import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, touchSession, checkIsAdmin } from '@/lib/auth-utils';

/**
 * GET /api/auth/me  header: x-session
 * 返回当前登录用户信息（前端恢复登录态用）
 */
export async function GET(request: NextRequest) {
  const token = request.headers.get('x-session');
  const { user, error } = await getCurrentUser(token);

  if (!user) {
    return NextResponse.json({ error: error || '请先登录' }, { status: 401 });
  }

  await touchSession(token as string);
  const isAdmin = await checkIsAdmin(user.id);

  return NextResponse.json({ user: { id: user.id, account: user.account, isAdmin } });
}
