import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser, checkIsAdmin, ensureUserBalance } from '@/lib/auth-utils';

export async function GET(request: NextRequest) {
  try {
    const token = request.headers.get('x-session');
    const { user, error: authError } = await getCurrentUser(token ?? undefined);

    if (authError || !user) {
      return NextResponse.json({ error: authError || '请先登录' }, { status: 401 });
    }

    const client = getCurrentUserClient(token!);
    await ensureUserBalance(user.id, client);

    const isAdmin = await checkIsAdmin(user.id, client);

    return NextResponse.json({ isAdmin, email: user.email });
  } catch (error) {
    console.error('[Admin Check] 错误:', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

// 辅助函数
import { getSupabaseClient } from '@/storage/database/supabase-client';
function getCurrentUserClient(token: string) {
  return getSupabaseClient(token);
}
