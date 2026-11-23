import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';
import {
  IMAGE_ROOT,
  SynologyError,
  buildUserDir,
  ensureFolder,
  isImageFile,
  listFolder,
  sanitizeSegment,
} from '@/lib/synology';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/images?category=xxx
 * 返回当前用户在 NAS 上的图片目录内容（实时读群晖，不做任何本地缓存）
 */
export async function GET(request: Request) {
  const token = request.headers.get('x-session');
  const { user, error } = await getCurrentUser(token);
  if (!user) {
    return NextResponse.json({ error: error || '请先登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const category = sanitizeSegment(searchParams.get('category') || '');

  try {
    const userDir = buildUserDir(user.account);
    const targetDir = category ? buildUserDir(user.account, category) : userDir;

    const rootEntries = await listFolder(IMAGE_ROOT);
    const userDirExists = rootEntries.some((entry) => entry.isdir && entry.name === user.account);

    if (!userDirExists) {
      // 每个用户在 28-九因科技 下拥有以账号命名的独立文件夹
      await ensureFolder(userDir);
    }

    const [files, userDirEntries] = await Promise.all([
      listFolder(targetDir),
      listFolder(userDir),
    ]);

    const categories = userDirEntries.filter((entry) => entry.isdir).map((entry) => entry.name);
    const suggested = rootEntries
      .filter((entry) => entry.isdir && entry.name !== user.account)
      .map((entry) => entry.name);

    // 本地映射表：标注哪些文件由当前用户通过系统上传
    const client = getSupabaseAdminClient();
    const { data: mapping } = await client
      .from('user_images')
      .select('remote_path, created_at')
      .eq('user_id', user.id)
      .like('remote_dir', `${targetDir}%`);

    const uploadedAt = new Map<string, string>();
    for (const row of mapping ?? []) {
      uploadedAt.set(String(row.remote_path), String(row.created_at));
    }

    const list = files
      .filter((entry) => !entry.isdir && isImageFile(entry.name))
      .sort((a, b) => b.mtime - a.mtime)
      .map((entry) => ({
        name: entry.name,
        path: entry.path,
        size: entry.size,
        mtime: entry.mtime,
        uploadedAt: uploadedAt.get(entry.path) ?? null,
        uploadedBySystem: uploadedAt.has(entry.path),
      }));

    return NextResponse.json({
      account: user.account,
      userDir,
      dirPath: targetDir,
      category,
      categories,
      suggestedCategories: suggested,
      files: list,
      total: list.length,
    });
  } catch (err) {
    const message = err instanceof SynologyError ? err.message : '读取 NAS 图片目录失败';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
