import { NextResponse } from 'next/server';
import { checkIsAdmin, getCurrentUser } from '@/lib/auth-utils';
import { SynologyError, ensureFolder, folderExistsAt, resolveUserDir, sanitizeSegment } from '@/lib/synology';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/images/mkdir  body: { category?: string }
 * 创建当前用户的 NAS 目录（管理员=28-九因科技 本身及其分类；普通用户=28-九因科技/{账号}）
 */
export async function POST(request: Request) {
  const token = request.headers.get('x-session');
  const { user, error } = await getCurrentUser(token);
  if (!user) {
    return NextResponse.json({ error: error || '请先登录' }, { status: 401 });
  }

  let body: { category?: string } = {};
  try {
    body = (await request.json()) as { category?: string };
  } catch {
    body = {};
  }
  const category = sanitizeSegment(body.category || '');

  try {
    const isAdmin = await checkIsAdmin(user.id);
    const dirPath = resolveUserDir(user.account, isAdmin, category);
    const already = await folderExistsAt(dirPath);
    if (!already) {
      await ensureFolder(dirPath);
    }
    return NextResponse.json({ success: true, dirPath, existed: already });
  } catch (err) {
    const message = err instanceof SynologyError ? err.message : '创建 NAS 目录失败';
    console.error('[images] 创建目录失败', err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
