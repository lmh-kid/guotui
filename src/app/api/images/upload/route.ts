import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { checkIsAdmin, getCurrentUser } from '@/lib/auth-utils';
import { getSupabaseAdminClient } from '@/storage/database/supabase-client';
import {
  IN_MEMORY_UPLOAD_LIMIT,
  MAX_UPLOAD_BYTES,
  SynologyError,
  findFile,
  isImageFile,
  resolveUserDir,
  sanitizeFileName,
  sanitizeSegment,
  uploadImage,
} from '@/lib/synology';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/images/upload?category=&name=&overwrite=0
 * body 为图片原始二进制（流式转发给 NAS，服务端不落盘、不缓存）。
 * 同名文件存在且未带 overwrite=1 时返回 409 + duplicated，由前端确认后再覆盖。
 */
export async function POST(request: Request) {
  const token = request.headers.get('x-session');
  const { user, error } = await getCurrentUser(token);
  if (!user) {
    return NextResponse.json({ error: error || '请先登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const category = sanitizeSegment(searchParams.get('category') || '');
  const overwrite = searchParams.get('overwrite') === '1';

  let fileName: string;
  try {
    fileName = sanitizeFileName(searchParams.get('name') || '');
  } catch (err) {
    const message = err instanceof Error ? err.message : '文件名不合法';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!isImageFile(fileName)) {
    return NextResponse.json({ error: '仅支持上传图片文件（png/jpg/jpeg/webp/gif/bmp/tif/heic）' }, { status: 415 });
  }

  const isAdmin = await checkIsAdmin(user.id);
  const dirPath = resolveUserDir(user.account, isAdmin, category);

  try {
    // 上传前判重：NAS 同名文件（overwrite=false 时群晖会静默跳过，因此必须先查）
    if (!overwrite) {
      const existing = await findFile(dirPath, fileName);
      if (existing) {
        return NextResponse.json(
          {
            duplicated: true,
            reason: 'name',
            fileName,
            existing: { name: existing.name, size: existing.size, mtime: existing.mtime },
          },
          { status: 409 },
        );
      }
    }

    const contentLength = Number(request.headers.get('content-length') || 0);
    const headerSize = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : 0;
    if (headerSize > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `单张图片不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB` },
        { status: 413 },
      );
    }

    // 小文件整体读入内存再发送（最稳），大文件流式转发（不落盘、不缓存）
    let buffer: Buffer | undefined;
    let stream: Readable | undefined;
    if (headerSize === 0 || headerSize <= IN_MEMORY_UPLOAD_LIMIT) {
      buffer = Buffer.from(await request.arrayBuffer());
      if (buffer.length === 0) {
        return NextResponse.json({ error: '未接收到文件内容' }, { status: 400 });
      }
      if (buffer.length > MAX_UPLOAD_BYTES) {
        return NextResponse.json(
          { error: `单张图片不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB` },
          { status: 413 },
        );
      }
    } else {
      if (!request.body) {
        return NextResponse.json({ error: '未接收到文件内容' }, { status: 400 });
      }
      stream = Readable.fromWeb(
        request.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>,
      );
    }

    const size = buffer ? buffer.length : headerSize;

    const result = await uploadImage({
      dirPath,
      fileName,
      size,
      mime: request.headers.get('content-type') || undefined,
      overwrite,
      buffer,
      stream,
    });

    if (result.skipped) {
      return NextResponse.json(
        { duplicated: true, reason: 'name', fileName, existing: null },
        { status: 409 },
      );
    }

    const remotePath = `${dirPath}/${fileName}`;
    const client = getSupabaseAdminClient();
    const { error: upsertError } = await client.from('user_images').upsert(
      {
        user_id: user.id,
        account: user.account,
        file_name: fileName,
        category,
        remote_dir: dirPath,
        remote_path: remotePath,
        size: String(size),
        mime: request.headers.get('content-type') || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'remote_path' },
    );

    // 映射写入失败不影响 NAS 上的图片（仅影响“系统上传”标注）
    if (upsertError) {
      console.error('[images] 写入映射表失败', upsertError.message);
    }

    return NextResponse.json({
      success: true,
      fileName,
      category,
      remotePath,
      size,
    });
  } catch (err) {
    const message = err instanceof SynologyError ? err.message : '图片上传失败，请重试';
    console.error('[images] 上传失败', err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
