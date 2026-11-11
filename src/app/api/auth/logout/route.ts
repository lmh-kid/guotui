import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';

/**
 * POST /api/auth/logout  header: x-session
 * 删除当前会话
 */
export async function POST(request: NextRequest) {
  try {
    const token = request.headers.get('x-session');
    if (token) {
      const client = getSupabaseAdminClient();
      const { error } = await client.from('auth_sessions').delete().eq('token', token);
      if (error) {
        console.error('[Auth Logout] 删除会话失败:', error);
      }
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Auth Logout] 错误:', error);
    return NextResponse.json({ success: true });
  }
}
