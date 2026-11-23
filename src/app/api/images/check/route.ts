import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-utils';
import { SynologyError, buildUserDir, findFile, sanitizeFileName, sanitizeSegment } from '@/lib/synology';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/images/check?category=&names=a.png,b.png
 * 批量检查 NAS 上是否已存在同名文件（上传前给用户提示，避免白跑流量）
 */
export async function GET(request: Request) {
  const token = request.headers.get('x-session');
  const { user, error } = await getCurrentUser(token);
  if (!user) {
    return NextResponse.json({ error: error || '请先登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const category = sanitizeSegment(searchParams.get('category') || '');
  const rawNames = (searchParams.get('names') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 50);

  if (rawNames.length === 0) {
    return NextResponse.json({ duplicates: [] });
  }

  try {
    const dirPath = buildUserDir(user.account, category);
    const duplicates: Array<{ name: string; size: number; mtime: number }> = [];

    for (const rawName of rawNames) {
      let fileName: string;
      try {
        fileName = sanitizeFileName(rawName);
      } catch {
        continue;
      }
      const existing = await findFile(dirPath, fileName);
      if (existing) {
        duplicates.push({ name: existing.name, size: existing.size, mtime: existing.mtime });
      }
    }

    return NextResponse.json({ duplicates, dirPath, category });
  } catch (err) {
    const message = err instanceof SynologyError ? err.message : '检查重名失败';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
