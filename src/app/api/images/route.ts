import { NextResponse } from 'next/server';
import { checkIsAdmin, getCurrentUser } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';
import {
  IMAGE_ROOT,
  SynologyError,
  folderExistsAt,
  isImageFile,
  listFolder,
  resolveUserDir,
  sanitizeSegment,
} from '@/lib/synology';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/images?category=xxx
 * 返回当前用户在 NAS 上的图片目录内容（实时读群晖，不做任何本地缓存）
 * 目录不存在时不自动创建，返回 dirExists=false 由前端展示「创建根目录」按钮
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
    const isAdmin = await checkIsAdmin(user.id);
    const userDir = resolveUserDir(user.account, isAdmin);
    const targetDir = resolveUserDir(user.account, isAdmin, category);

    const dirExists = await folderExistsAt(targetDir);

    const [files, userDirEntries, rootEntries] = await Promise.all([
      dirExists ? listFolder(targetDir) : Promise.resolve([]),
      listFolder(userDir),
      listFolder(IMAGE_ROOT),
    ]);

    const categories = userDirEntries.filter((entry) => entry.isdir).map((entry) => entry.name);
    const suggestedCategories = rootEntries
      .filter((entry) => entry.isdir)
      .map((entry) => entry.name)
      .filter((name) => !categories.includes(name));

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
      isAdmin,
      userDir,
      dirPath: targetDir,
      category,
      dirExists,
      categories,
      suggestedCategories,
      files: list,
      total: list.length,
    });
  } catch (err) {
    const message = err instanceof SynologyError ? err.message : '读取 NAS 图片目录失败';
    console.error('[images] 读取目录失败', err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
