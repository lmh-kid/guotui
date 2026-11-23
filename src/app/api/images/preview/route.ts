import { NextResponse } from 'next/server';
import { Readable } from 'node:stream';
import { getCurrentUser } from '@/lib/auth-utils';
import { SynologyError, buildUserDir, isImageFile, openImage } from '@/lib/synology';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/images/preview?path=<NAS 绝对路径>&thumb=1
 * 服务端代理读取 NAS 图片（缩略图优先），不落盘、不缓存。
 * 仅允许访问当前用户自己目录下的文件。
 */
export async function GET(request: Request) {
  const token = request.headers.get('x-session');
  const { user, error } = await getCurrentUser(token);
  if (!user) {
    return NextResponse.json({ error: error || '请先登录' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const remotePath = searchParams.get('path') || '';
  const wantThumb = searchParams.get('thumb') !== '0';

  const userDir = buildUserDir(user.account);
  if (!remotePath.startsWith(`${userDir}/`) || remotePath.includes('..')) {
    return NextResponse.json({ error: '无权访问该文件' }, { status: 403 });
  }
  if (!isImageFile(remotePath)) {
    return NextResponse.json({ error: '仅支持预览图片文件' }, { status: 415 });
  }

  try {
    const result = await openImage(remotePath, wantThumb);
    const webStream = Readable.toWeb(result.stream) as unknown as ReadableStream<Uint8Array>;

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        ...(result.contentLength ? { 'Content-Length': result.contentLength } : {}),
      },
    });
  } catch (err) {
    const message = err instanceof SynologyError ? err.message : '图片读取失败';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
