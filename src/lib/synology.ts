import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import { PassThrough, Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';

/**
 * 群晖 NAS（File Station）对接
 *
 * 说明：
 * 1. 该 NAS 未开放 Synology Photos 的 API（SYNO.Foto.*），因此图片统一走 FileStation 上传到共享目录，
 *    上传后与在 File Station 里手动上传完全等价（Photos 是否收录取决于共享文件夹是否被 Photos 索引）。
 * 2. 凭据为运营方提供的子账号（仅对该共享目录有读写权限），只在服务端使用，绝不下发前端。
 * 3. 图片本体全部保存在 NAS，服务端只做流式转发，不落盘、不缓存。
 */

const SYNOLOGY_HOST = '15.nat0.cn';
const SYNOLOGY_PORT = 23233;
const SYNOLOGY_ACCOUNT = '九因科技';
const SYNOLOGY_PASSWORD = 'Jy123456!';

const ENTRY_URL = `https://${SYNOLOGY_HOST}:${SYNOLOGY_PORT}/webapi/entry.cgi`;

/** 图片根目录（File Station 路径） */
export const IMAGE_ROOT = '/数码印花图片/28-九因科技';
/** 单张图片上传上限：200MB */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
/** 同时向 NAS 发起的上传并发上限 */
export const UPLOAD_CONCURRENCY = 3;

export interface SynoEntry {
  name: string;
  path: string;
  isdir: boolean;
  size: number;
  mtime: number;
  type: string;
}

interface SynoResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: number };
}

interface SynoRawFile {
  name: string;
  path: string;
  isdir: boolean;
  additional?: {
    size?: number;
    type?: string;
    time?: { mtime?: number };
  };
}

export class SynologyError extends Error {
  relogin: boolean;

  constructor(message: string, relogin = false) {
    super(message);
    this.name = 'SynologyError';
    this.relogin = relogin;
  }
}

/* ------------------------------------------------------------------ */
/* 底层 HTTP                                                           */
/* ------------------------------------------------------------------ */

interface RequestOptions {
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: Buffer | Readable;
  /** socket 空闲超时（不是总时长），大文件上传时数据持续流动不会触发 */
  idleTimeout?: number;
}

function request(url: string, options: RequestOptions): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: options.method,
        headers: options.headers,
        // 该 NAS 使用自签证书：仅服务端到 NAS 的内部转发，跳过校验
        rejectUnauthorized: false,
        timeout: options.idleTimeout ?? 60_000,
      },
      (res) => resolve(res),
    );

    req.on('timeout', () => req.destroy(new Error('群晖请求超时，请检查 NAS 是否在线')));
    req.on('error', reject);

    if (Buffer.isBuffer(options.body)) {
      req.end(options.body);
    } else if (options.body) {
      options.body.on('error', (err) => req.destroy(err));
      options.body.pipe(req);
    } else {
      req.end();
    }
  });
}

/** 读取 JSON 响应（限制 1MB，避免异常大响应） */
async function readJson<T>(res: IncomingMessage): Promise<SynoResponse<T>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of res) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > 1024 * 1024) throw new SynologyError('群晖响应异常（超过 1MB）');
    chunks.push(buf);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as SynoResponse<T>;
  } catch {
    throw new SynologyError('群晖返回了非 JSON 内容，请检查 NAS 服务状态');
  }
}

/* ------------------------------------------------------------------ */
/* 登录态（SID）                                                        */
/* ------------------------------------------------------------------ */

interface AuthState {
  sid: string;
  expiresAt: number;
  pending: Promise<string> | null;
}

const g = globalThis as unknown as { __synoAuth?: AuthState };

function authState(): AuthState {
  if (!g.__synoAuth) {
    g.__synoAuth = { sid: '', expiresAt: 0, pending: null };
  }
  return g.__synoAuth;
}

async function loginAttempt(version: string): Promise<string | null> {
  const query = new URLSearchParams({
    api: 'SYNO.API.Auth',
    version,
    method: 'login',
    account: SYNOLOGY_ACCOUNT,
    passwd: SYNOLOGY_PASSWORD,
    session: 'FileStation',
    format: 'sid',
  });
  const res = await request(`${ENTRY_URL}?${query.toString()}`, { method: 'GET', idleTimeout: 20_000 });
  const json = await readJson<{ sid?: string }>(res);
  const sid = json.data?.sid;
  if (!json.success || !sid) {
    console.error('[synology] 登录失败', { version, code: json.error?.code });
    return null;
  }
  return sid;
}

async function login(): Promise<string> {
  const state = authState();
  if (state.pending) return state.pending;

  state.pending = (async () => {
    // 关键：必须用 v3 + session=FileStation 登录。该 NAS 上 v6/v7 也能登录成功并返回 SID，
    // 但那个 SID 调 SYNO.FileStation.* 一律 401（会话类型不匹配），所以 v3 优先并做可用性探测。
    let sid: string | null = null;
    for (const version of ['3', '7']) {
      try {
        const candidate = await loginAttempt(version);
        if (!candidate) continue;
        // 拿到 SID 后立即探测一次 FileStation 是否可用，不可用则换下一个版本
        try {
          await callApi('SYNO.FileStation.List', '2', 'list', { folder_path: IMAGE_ROOT }, candidate);
          sid = candidate;
          console.log('[synology] 登录成功', { version });
          break;
        } catch (probeErr) {
          console.error('[synology] SID 不可用，尝试其它登录版本', {
            version,
            message: probeErr instanceof Error ? probeErr.message : String(probeErr),
          });
        }
      } catch (err) {
        console.error('[synology] 登录异常', err);
      }
    }
    if (!sid) {
      throw new SynologyError('群晖登录失败，请检查 NAS 账号密码或网络连通性');
    }
    state.sid = sid;
    // SID 默认有效期较短，保守按 20 分钟复用；过期后自动重登
    state.expiresAt = Date.now() + 20 * 60 * 1000;
    return sid;
  })().finally(() => {
    authState().pending = null;
  });

  return state.pending;
}

async function getSid(): Promise<string> {
  const state = authState();
  if (state.sid && Date.now() < state.expiresAt) return state.sid;
  return login();
}

/** SID 失效（错误码 119 等）时自动重登并重试一次 */
async function withSid<T>(fn: (sid: string) => Promise<T>): Promise<T> {
  const sid = await getSid();
  try {
    return await fn(sid);
  } catch (err) {
    if (err instanceof SynologyError && err.relogin) {
      authState().expiresAt = 0;
      const fresh = await login();
      return fn(fresh);
    }
    throw err;
  }
}

async function callApi<T>(
  api: string,
  version: string,
  method: string,
  params: Record<string, string>,
  sid: string,
): Promise<T> {
  const query = new URLSearchParams({ api, version, method, _sid: sid, ...params });
  const res = await request(`${ENTRY_URL}?${query.toString()}`, { method: 'GET' });
  const json = await readJson<T>(res);
  if (!json.success) {
    const code = json.error?.code ?? -1;
    // 119 = SID 不存在/已过期；106/107 = 会话超时/重复登录
    const relogin = code === 119 || code === 106 || code === 107;
    throw new SynologyError(`群晖接口 ${api}.${method} 调用失败（错误码 ${code}）`, relogin);
  }
  return json.data as T;
}

/* ------------------------------------------------------------------ */
/* 路径与文件名校验                                                     */
/* ------------------------------------------------------------------ */

/** 清洗路径片段：禁止路径分隔符、上级目录、控制字符 */
export function sanitizeSegment(input: string): string {
  const cleaned = input
    .replace(/[\\/\u0000-\u001f]/g, '')
    .replace(/\.\./g, '')
    .trim()
    .slice(0, 64);
  return cleaned;
}

/** 校验并返回安全的文件名（禁止路径穿越） */
export function sanitizeFileName(input: string): string {
  const name = input.replace(/[\\/\u0000-\u001f"]/g, '').replace(/\.\./g, '').trim();
  if (!name) throw new SynologyError('文件名不合法');
  if (name.length > 200) throw new SynologyError('文件名过长（最多 200 个字符）');
  return name;
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.heic'];

export function isImageFile(name: string): boolean {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * 用户目录：IMAGE_ROOT/{账号名}，可再带一层分类子目录
 * 例：/数码印花图片/28-九因科技/test 、 /数码印花图片/28-九因科技/test/A
 */
export function buildUserDir(account: string, category?: string): string {
  const safeAccount = sanitizeSegment(account);
  if (!safeAccount) throw new SynologyError('账号名无法用作 NAS 目录名');
  const parts = [IMAGE_ROOT, safeAccount];
  const safeCategory = category ? sanitizeSegment(category) : '';
  if (safeCategory) parts.push(safeCategory);
  return parts.join('/');
}

/**
 * 当前用户实际使用的根目录：
 * - 管理员：直接使用运营方给定的 IMAGE_ROOT（即 28-九因科技 本身）
 * - 普通用户：IMAGE_ROOT/{账号名}
 */
export function resolveUserDir(account: string, isAdmin: boolean, category?: string): string {
  const safeCategory = category ? sanitizeSegment(category) : '';
  if (isAdmin) {
    return safeCategory ? `${IMAGE_ROOT}/${safeCategory}` : IMAGE_ROOT;
  }
  return buildUserDir(account, safeCategory);
}

/** 目录是否真实存在（与「空目录」区分开，供前端展示创建按钮） */
export async function folderExistsAt(folderPath: string): Promise<boolean> {
  try {
    await withSid((sid) =>
      callApi('SYNO.FileStation.List', '2', 'list', { folder_path: folderPath }, sid),
    );
    return true;
  } catch (err) {
    if (err instanceof SynologyError && !err.relogin && err.message.includes('错误码 408')) {
      return false;
    }
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* 目录操作                                                            */
/* ------------------------------------------------------------------ */

function toEntry(file: SynoRawFile): SynoEntry {
  return {
    name: file.name,
    path: file.path,
    isdir: file.isdir,
    size: Number(file.additional?.size ?? 0),
    mtime: Number(file.additional?.time?.mtime ?? 0),
    type: file.additional?.type ?? '',
  };
}

/** 列目录；目录不存在时返回空数组（首次使用时用户目录还未创建） */
export async function listFolder(folderPath: string): Promise<SynoEntry[]> {
  try {
    return await withSid(async (sid) => {
      const data = await callApi<{ files?: SynoRawFile[] }>('SYNO.FileStation.List', '2', 'list', {
        folder_path: folderPath,
        additional: JSON.stringify(['size', 'time', 'type']),
        sort_by: 'name',
        sort_direction: 'asc',
      }, sid);
      return (data.files ?? []).map(toEntry);
    });
  } catch (err) {
    if (err instanceof SynologyError && !err.relogin) {
      // 408 = 文件/目录不存在
      if (err.message.includes('错误码 408')) return [];
    }
    throw err;
  }
}

/** 确保目录存在（逐级创建，已存在则跳过）
 *  注意：子账号对 DSM 根目录 `/` 没有列表权限（会返回 401），
 *  所以从 IMAGE_ROOT 开始逐级处理，绝不去列 `/`。
 */
export async function ensureFolder(folderPath: string): Promise<void> {
  const rel = folderPath.startsWith(IMAGE_ROOT) ? folderPath.slice(IMAGE_ROOT.length) : folderPath;
  const segments = rel.split('/').filter(Boolean);
  let current = IMAGE_ROOT;
  for (const segment of segments) {
    const exists = await folderExists(current, segment);
    if (exists) {
      current = `${current}/${segment}`;
      continue;
    }
    try {
      await withSid((sid) =>
        callApi('SYNO.FileStation.CreateFolder', '2', 'create', {
          folder_path: current,
          name: JSON.stringify([segment]),
          force_parent: 'true',
        }, sid),
      );
    } catch (err) {
      // 并发创建时可能已被其他请求创建，二次确认
      const nowExists = await folderExists(current, segment);
      if (!nowExists) throw err;
    }
    current = `${current}/${segment}`;
  }
}

async function folderExists(parentPath: string, name: string): Promise<boolean> {
  const entries = await listFolder(parentPath);
  return entries.some((entry) => entry.isdir && entry.name === name);
}

/** 查询目录下是否已存在同名文件 */
export async function findFile(folderPath: string, fileName: string): Promise<SynoEntry | null> {
  const entries = await listFolder(folderPath);
  return entries.find((entry) => !entry.isdir && entry.name === fileName) ?? null;
}

/* ------------------------------------------------------------------ */
/* 上传（流式，不落盘）                                                 */
/* ------------------------------------------------------------------ */

interface UploadSlotState {
  active: number;
  waiters: Array<() => void>;
}

const gSlot = globalThis as unknown as { __synoUploadSlot?: UploadSlotState };

function slotState(): UploadSlotState {
  if (!gSlot.__synoUploadSlot) {
    gSlot.__synoUploadSlot = { active: 0, waiters: [] };
  }
  return gSlot.__synoUploadSlot;
}

function acquireSlot(): Promise<void> {
  const state = slotState();
  if (state.active < UPLOAD_CONCURRENCY) {
    state.active += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    state.waiters.push(() => {
      state.active += 1;
      resolve();
    });
  });
}

function releaseSlot(): void {
  const state = slotState();
  state.active = Math.max(0, state.active - 1);
  const next = state.waiters.shift();
  if (next) next();
}

export interface UploadImageOptions {
  /** 目标绝对目录 */
  dirPath: string;
  fileName: string;
  mime?: string;
  /** 文件字节数，用于拼装 Content-Length */
  size: number;
  /** 是否覆盖同名文件 */
  overwrite: boolean;
  /** 已在内存中的完整内容（小文件优先走这条路径，最稳定） */
  buffer?: Buffer;
  /** 大文件流式转发（不落盘、不缓存） */
  stream?: Readable;
}

export interface UploadImageResult {
  /** NAS 上已存在同名文件且未开启覆盖 */
  skipped: boolean;
}

/** 小于该体积直接整体缓冲发送，避免流式组装的不确定性 */
export const IN_MEMORY_UPLOAD_LIMIT = 32 * 1024 * 1024;

/** 上传图片到 NAS（不写磁盘、不缓存图片） */
export async function uploadImage(options: UploadImageOptions): Promise<UploadImageResult> {
  if (options.size > MAX_UPLOAD_BYTES) {
    throw new SynologyError(`单张图片不能超过 ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`);
  }
  if (!options.buffer && !options.stream) {
    throw new SynologyError('缺少图片内容');
  }

  await acquireSlot();
  try {
    await ensureFolder(options.dirPath);
    return await withSid((sid) => postMultipart(options, sid));
  } finally {
    releaseSlot();
  }
}

function postMultipart(options: UploadImageOptions, sid: string): Promise<UploadImageResult> {
  const boundary = `----guotui${randomBytes(10).toString('hex')}`;
  const safeName = options.fileName.replace(/"/g, '_');

  const head =
    [
      `--${boundary}`,
      'Content-Disposition: form-data; name="path"',
      '',
      options.dirPath,
      `--${boundary}`,
      'Content-Disposition: form-data; name="create_parents"',
      '',
      'true',
      `--${boundary}`,
      'Content-Disposition: form-data; name="overwrite"',
      '',
      options.overwrite ? 'true' : 'false',
      `--${boundary}`,
      `Content-Disposition: form-data; name="file"; filename="${safeName}"`,
      `Content-Type: ${options.mime || 'application/octet-stream'}`,
      '',
      '',
    ].join('\r\n');
  const tail = `\r\n--${boundary}--\r\n`;

  const headBuf = Buffer.from(head, 'utf8');
  const tailBuf = Buffer.from(tail, 'utf8');
  const fileSize = options.buffer ? options.buffer.length : options.size;
  const contentLength = headBuf.length + fileSize + tailBuf.length;

  const url = `${ENTRY_URL}?${new URLSearchParams({
    api: 'SYNO.FileStation.Upload',
    version: '2',
    method: 'upload',
    _sid: sid,
  }).toString()}`;

  console.log('[synology] upload start', {
    fileName: options.fileName,
    dirPath: options.dirPath,
    fileSize,
    mode: options.buffer ? 'buffer' : 'stream',
  });

  return new Promise<UploadImageResult>((resolve, reject) => {
    let settled = false;
    const done = (value: UploadImageResult) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      console.error('[synology] upload failed', err.message);
      reject(err);
    };

    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(contentLength),
        },
        rejectUnauthorized: false,
        timeout: 180_000,
      },
      (res) => {
        void (async () => {
          try {
            const json = await readJson<{ blSkip?: boolean; file?: string }>(res);
            if (!json.success) {
              const code = json.error?.code ?? -1;
              console.error('[synology] upload rejected', { fileName: options.fileName, status: res.statusCode, code, json });
              fail(new SynologyError(`图片上传失败（群晖错误码 ${code}）`, code === 119));
              return;
            }
            done({ skipped: json.data?.blSkip === true });
          } catch (err) {
            fail(err instanceof Error ? err : new SynologyError('图片上传失败'));
          }
        })();
      },
    );

    req.on('timeout', () => req.destroy(new SynologyError('上传超时，请检查 NAS 网络后重试')));
    req.on('error', (err) => fail(err instanceof Error ? err : new SynologyError('图片上传失败')));

    if (options.buffer) {
      req.write(headBuf);
      req.write(options.buffer);
      req.end(tailBuf);
      return;
    }

    const source = options.stream as Readable;
    const pass = new PassThrough();
    let sent = 0;

    source.on('data', (chunk: Buffer | string) => {
      sent += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    });
    source.on('error', (err) => pass.destroy(err));
    source.on('end', () => {
      if (sent !== options.size) {
        pass.destroy(new SynologyError(`上传数据不完整（收到 ${sent} 字节，声明 ${options.size} 字节）`));
        return;
      }
      pass.end(tailBuf);
    });
    pass.on('error', (err) => req.destroy(err instanceof Error ? err : new Error('读取上传数据失败')));

    pass.write(headBuf);
    source.pipe(pass, { end: false });
    pass.pipe(req);
  });
}

/* ------------------------------------------------------------------ */
/* 图片预览（服务端代理，不落盘、不缓存）                               */
/* ------------------------------------------------------------------ */

export interface ImageStream {
  stream: IncomingMessage;
  contentType: string;
  contentLength?: string;
}

/**
 * 打开图片流：优先取 NAS 缩略图（省带宽），失败时回退原图下载。
 * 返回的 stream 由调用方直接转发给浏览器，服务端不缓存。
 */
export async function openImage(remotePath: string, wantThumb: boolean): Promise<ImageStream> {
  return withSid(async (sid) => {
    if (wantThumb) {
      const thumb = await tryOpen(sid, {
        api: 'SYNO.FileStation.Thumb',
        version: '2',
        method: 'get',
        path: remotePath,
        size: 'medium',
      });
      if (thumb) return thumb;
    }

    const full = await tryOpen(sid, {
      api: 'SYNO.FileStation.Download',
      version: '2',
      method: 'download',
      path: remotePath,
      mode: 'open',
    });
    if (full) return full;

    throw new SynologyError('图片读取失败，文件可能已被移动或删除');
  });
}

async function tryOpen(sid: string, params: Record<string, string>): Promise<ImageStream | null> {
  const query = new URLSearchParams({ ...params, _sid: sid });
  const res = await request(`${ENTRY_URL}?${query.toString()}`, { method: 'GET', idleTimeout: 120_000 });
  const contentType = String(res.headers['content-type'] ?? '');

  // 群晖 API 失败时返回 HTTP 200 + JSON，需要按 Content-Type 区分
  if (res.statusCode === 200 && (contentType.startsWith('image/') || contentType === 'application/octet-stream')) {
    const contentLength = res.headers['content-length'];
    return {
      stream: res,
      contentType: contentType.startsWith('image/') ? contentType : 'image/jpeg',
      contentLength: typeof contentLength === 'string' ? contentLength : undefined,
    };
  }

  res.resume();
  return null;
}
