'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AppLayout from '@/components/app-layout';
import { apiRequest } from '@/lib/api-request';
import { SESSION_TOKEN_KEY } from '@/lib/auth-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  ImageIcon,
  Upload,
  RefreshCw,
  Loader2,
  Folder,
  FolderPlus,
  X,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';

interface NasFile {
  name: string;
  path: string;
  size: number;
  mtime: number;
  uploadedAt: string | null;
  uploadedBySystem: boolean;
}

interface ImagesResponse {
  account: string;
  isAdmin: boolean;
  userDir: string;
  dirPath: string;
  category: string;
  dirExists: boolean;
  categories: string[];
  files: NasFile[];
  total: number;
}

type TaskStatus = 'pending' | 'uploading' | 'done' | 'error' | 'skipped';

interface UploadTask {
  id: string;
  file: File;
  status: TaskStatus;
  progress: number;
  message?: string;
}

const MAX_SIZE = 200 * 1024 * 1024;
const CONCURRENCY = 3;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|heic)$/i;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatTime(seconds: number): string {
  if (!seconds) return '-';
  const date = new Date(seconds * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renamed(name: string, index: number): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name}_${index}`;
  return `${name.slice(0, dot)}_${index}${name.slice(dot)}`;
}

export default function ImagesPage() {
  const [data, setData] = useState<ImagesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState('');
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [preview, setPreview] = useState<NasFile | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<{ names: string[]; files: File[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sessionToken, setSessionToken] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (cat: string) => {
      setLoading(true);
      try {
        const res = await apiRequest<ImagesResponse>(`/api/images?category=${encodeURIComponent(cat)}`);
        setData(res);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '加载图片列表失败');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load(category);
  }, [category, load]);

  useEffect(() => {
    setSessionToken(localStorage.getItem(SESSION_TOKEN_KEY) || '');
  }, []);

  const createDir = useCallback(async () => {
    setCreating(true);
    try {
      await apiRequest<{ success: boolean; dirPath: string }>('/api/images/mkdir', {
        method: 'POST',
        body: JSON.stringify({ category }),
      });
      toast.success('目录已创建');
      await load(category);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建目录失败');
    } finally {
      setCreating(false);
    }
  }, [category, load]);

  const categoryOptions = useMemo(() => data?.categories ?? [], [data]);

  const queueRef = useRef<UploadTask[]>([]);
  const overwriteRef = useRef(false);

  const updateTask = useCallback((id: string, patch: Partial<UploadTask>) => {
    setTasks((prev) => prev.map((task) => (task.id === id ? { ...task, ...patch } : task)));
  }, []);

  const uploadOne = useCallback(
    (task: UploadTask): Promise<'ok' | 'duplicated' | 'error'> =>
      new Promise((resolve) => {
        const token = localStorage.getItem(SESSION_TOKEN_KEY) || '';
        const xhr = new XMLHttpRequest();
        const query = new URLSearchParams({
          category,
          name: task.file.name,
          overwrite: overwriteRef.current ? '1' : '0',
        });
        xhr.open('POST', `/api/images/upload?${query.toString()}`);
        xhr.setRequestHeader('x-session', token);
        xhr.setRequestHeader('Content-Type', task.file.type || 'application/octet-stream');

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            updateTask(task.id, { progress: Math.round((event.loaded / event.total) * 100) });
          }
        };

        xhr.onload = () => {
          let body: { error?: string; duplicated?: boolean } = {};
          try {
            body = JSON.parse(xhr.responseText || '{}');
          } catch {
            body = {};
          }
          if (xhr.status === 200) {
            updateTask(task.id, { status: 'done', progress: 100 });
            resolve('ok');
            return;
          }
          if (xhr.status === 409 || body.duplicated) {
            updateTask(task.id, { status: 'skipped', message: 'NAS 已存在同名文件' });
            resolve('duplicated');
            return;
          }
          if (xhr.status === 401) {
            window.location.href = '/login';
            resolve('error');
            return;
          }
          updateTask(task.id, { status: 'error', message: body.error || `上传失败（${xhr.status}）` });
          resolve('error');
        };

        xhr.onerror = () => {
          updateTask(task.id, { status: 'error', message: '网络中断，请重试' });
          resolve('error');
        };

        updateTask(task.id, { status: 'uploading', progress: 0 });
        xhr.send(task.file);
      }),
    [category, updateTask],
  );

  const drain = useCallback(async () => {
    const stats = { ok: 0, duplicated: 0, error: 0 };
    while (queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      if (!next) break;
      const result = await uploadOne(next);
      stats[result] += 1;
    }
    return stats;
  }, [uploadOne]);

  const startQueue = useCallback(
    async (items: UploadTask[]) => {
      if (items.length === 0) return;
      queueRef.current.push(...items);
      const workers = Math.min(CONCURRENCY, items.length);
      const results = await Promise.all(Array.from({ length: workers }, () => drain()));
      const ok = results.reduce((sum, item) => sum + item.ok, 0);
      const duplicated = results.reduce((sum, item) => sum + item.duplicated, 0);
      const failed = results.reduce((sum, item) => sum + item.error, 0);

      await load(category);
      if (ok > 0) toast.success(`已上传 ${ok} 张图片到 NAS`);
      if (duplicated > 0) toast.warning(`${duplicated} 张因重名被跳过`);
      if (failed > 0) toast.error(`${failed} 张上传失败，可重试`);
    },
    [category, drain, load],
  );

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const incoming = Array.from(fileList);
      const invalid = incoming.filter((file) => !IMAGE_EXT.test(file.name));
      const tooLarge = incoming.filter((file) => IMAGE_EXT.test(file.name) && file.size > MAX_SIZE);
      if (invalid.length > 0) toast.error(`已忽略 ${invalid.length} 个非图片文件`);
      if (tooLarge.length > 0) toast.error(`${tooLarge.length} 个文件超过 200MB，已忽略`);

      const valid = incoming.filter((file) => IMAGE_EXT.test(file.name) && file.size <= MAX_SIZE);
      if (valid.length === 0) return;

      // 上传前判重：一次请求批量查询，避免白跑流量
      let duplicates: string[] = [];
      try {
        const names = valid.map((file) => file.name).join(',');
        const res = await apiRequest<{ duplicates: Array<{ name: string }> }>(
          `/api/images/check?category=${encodeURIComponent(category)}&names=${encodeURIComponent(names)}`,
        );
        duplicates = res.duplicates.map((item) => item.name);
      } catch {
        // 判重失败不阻塞上传，由上传接口二次把关
      }

      if (duplicates.length > 0) {
        setDuplicatePrompt({ names: duplicates, files: valid });
        return;
      }

      const newTasks: UploadTask[] = valid.map((file) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        file,
        status: 'pending' as TaskStatus,
        progress: 0,
      }));
      setTasks((prev) => [...prev, ...newTasks]);
      overwriteRef.current = false;
      await startQueue(newTasks);
    },
    [category, startQueue],
  );

  const confirmDuplicate = useCallback(
    async (mode: 'skip' | 'overwrite' | 'rename') => {
      const prompt = duplicatePrompt;
      setDuplicatePrompt(null);
      if (!prompt) return;

      const duplicateSet = new Set(prompt.names);
      const queue: UploadTask[] = [];
      for (const file of prompt.files) {
        if (duplicateSet.has(file.name)) {
          if (mode === 'skip') continue;
          const targetName = mode === 'rename' ? renamed(file.name, 1) : file.name;
          const renamedFile =
            mode === 'rename' ? new File([file], targetName, { type: file.type }) : file;
          queue.push({
            id: `${targetName}-${file.size}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
            file: renamedFile,
            status: 'pending',
            progress: 0,
          });
          continue;
        }
        queue.push({
          id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
          file,
          status: 'pending',
          progress: 0,
        });
      }

      if (queue.length === 0) {
        toast.info('已跳过全部重名文件');
        return;
      }
      setTasks((prev) => [...prev, ...queue]);
      overwriteRef.current = mode === 'overwrite';
      await startQueue(queue);
    },
    [duplicatePrompt, startQueue],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      void handleFiles(event.dataTransfer.files);
    },
    [handleFiles],
  );

  const previewUrl = (file: NasFile, thumb: boolean) =>
    `/api/images/preview?path=${encodeURIComponent(file.path)}&thumb=${thumb ? '1' : '0'}${
      sessionToken ? `&token=${encodeURIComponent(sessionToken)}` : ''
    }`;

  const activeTasks = tasks.filter((task) => task.status === 'uploading' || task.status === 'pending');
  const finishedTasks = tasks.filter((task) => task.status !== 'uploading' && task.status !== 'pending');

  return (
    <AppLayout>
      <div className="p-4 lg:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-blue-600" />
              图片管理
            </h1>
            <p className="text-xs text-gray-500 mt-1">
              NAS 目录：{data?.dirPath ?? '加载中...'}
              <span className="mx-2 text-gray-300">|</span>
              单张上限 200MB，同时上传 3 张，图片直接存入 NAS，系统只记录名称映射、不缓存图片
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => load(category)} disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
              刷新
            </Button>
            <Button size="sm" onClick={() => inputRef.current?.click()}>
              <Upload className="w-4 h-4 mr-2" />
              选择图片
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                void handleFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </div>
        </div>

        <Card>
          <CardContent className="p-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 mr-1 flex items-center gap-1">
              <Folder className="w-3.5 h-3.5" />
              分类：
            </span>
            <button
              type="button"
              onClick={() => setCategory('')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                category === '' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              根目录
            </button>
            {categoryOptions.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setCategory(item)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  category === item ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {item}
              </button>
            ))}
            {data && categoryOptions.length === 0 && (
              <span className="text-xs text-gray-400">暂无分类，可创建目录时指定分类名</span>
            )}
          </CardContent>
        </Card>

        {!loading && data && !data.dirExists ? (
          <Card>
            <CardContent className="p-8 text-center">
              <FolderPlus className="w-9 h-9 text-blue-500 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-800">
                {category ? `分类目录「${category}」还不存在` : '你还没有 NAS 个人目录'}
              </p>
              <p className="text-xs text-gray-500 mt-1 break-all">{data.dirPath}</p>
              <Button className="mt-4" onClick={createDir} disabled={creating}>
                {creating ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <FolderPlus className="w-4 h-4 mr-2" />
                )}
                {category ? '创建该分类目录' : '创建根目录'}
              </Button>
              <p className="text-xs text-gray-400 mt-3">目录不会自动创建，创建后即可上传图片</p>
            </CardContent>
          </Card>
        ) : (
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-blue-400'
            }`}
          >
            <Upload className="w-6 h-6 text-blue-500 mx-auto mb-2" />
            <p className="text-sm text-gray-700">拖拽图片到此处，或点击选择文件</p>
            <p className="text-xs text-gray-500 mt-1">
              支持 png / jpg / jpeg / webp / gif / bmp / tif / heic，单张最大 200MB
            </p>
          </div>
        )}

        {(activeTasks.length > 0 || finishedTasks.length > 0) && (
          <Card>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-800">
                  上传队列（{activeTasks.length} 个进行中 / {finishedTasks.length} 个已结束）
                </span>
                {activeTasks.length === 0 && (
                  <button
                    type="button"
                    className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1"
                    onClick={() => setTasks([])}
                  >
                    <X className="w-3.5 h-3.5" />
                    清空
                  </button>
                )}
              </div>
              <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                {[...activeTasks, ...finishedTasks].map((task) => (
                  <div key={task.id} className="flex items-center gap-3 text-xs">
                    <span className="w-52 truncate text-gray-700" title={task.file.name}>
                      {task.file.name}
                    </span>
                    <span className="w-16 text-gray-400 shrink-0">{formatSize(task.file.size)}</span>
                    <div className="flex-1 min-w-[80px]">
                      <Progress value={task.progress} className="h-1.5" />
                    </div>
                    <span className="w-24 shrink-0 text-right">
                      {task.status === 'done' && (
                        <span className="text-green-600 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          已上传
                        </span>
                      )}
                      {task.status === 'error' && (
                        <span className="text-red-600 inline-flex items-center gap-1" title={task.message}>
                          <AlertTriangle className="w-3.5 h-3.5" />
                          失败
                        </span>
                      )}
                      {task.status === 'skipped' && (
                        <span className="text-amber-600 inline-flex items-center gap-1" title={task.message}>
                          <AlertTriangle className="w-3.5 h-3.5" />
                          已跳过
                        </span>
                      )}
                      {(task.status === 'uploading' || task.status === 'pending') && (
                        <span className="text-blue-600">{task.progress}%</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-gray-800">
                {category ? `${category} 目录` : '根目录'}图片
                <Badge variant="secondary" className="ml-2">
                  {data?.total ?? 0}
                </Badge>
              </div>
              <span className="text-xs text-gray-400">数据实时读取 NAS，不做本地缓存</span>
            </div>

            {loading ? (
              <div className="py-16 flex flex-col items-center text-gray-500">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600 mb-2" />
                <span className="text-sm">正在读取 NAS 目录...</span>
              </div>
            ) : (data?.files.length ?? 0) === 0 ? (
              <div className="py-16 text-center text-gray-400">
                <ImageIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                <p className="text-sm">
                  {data?.dirExists === false
                    ? '目录还不存在，请先在上方创建目录'
                    : '当前目录还没有图片，拖拽上传即可'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {data?.files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setPreview(file)}
                    className="group text-left border border-gray-200 rounded-lg overflow-hidden bg-white hover:border-blue-400 hover:shadow-sm transition-colors"
                  >
                    <div className="relative h-28 bg-gray-50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewUrl(file, true)}
                        alt={file.name}
                        loading="lazy"
                        className="absolute inset-0 w-full h-full object-contain p-1"
                      />
                    </div>
                    <div className="px-2 py-1.5 border-t border-gray-100">
                      <p className="text-xs text-gray-700 truncate" title={file.name}>
                        {file.name}
                      </p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {formatSize(file.size)}
                        <span className="mx-1">·</span>
                        {formatTime(file.mtime)}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 重名确认 */}
      <Dialog open={!!duplicatePrompt} onOpenChange={(open) => !open && setDuplicatePrompt(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              NAS 上已存在同名图片
            </DialogTitle>
            <DialogDescription>
              以下 {duplicatePrompt?.names.length ?? 0} 个文件名在「{category || '根目录'}」中已存在，请选择处理方式：
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-md p-2 bg-gray-50 space-y-1">
            {duplicatePrompt?.names.map((name) => (
              <div key={name} className="text-xs text-gray-700 truncate" title={name}>
                {name}
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => confirmDuplicate('skip')}>
              跳过重名
            </Button>
            <Button variant="outline" onClick={() => confirmDuplicate('rename')}>
              改名后上传
            </Button>
            <Button onClick={() => confirmDuplicate('overwrite')}>覆盖上传</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 大图预览 */}
      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium truncate pr-6">{preview?.name}</DialogTitle>
            <DialogDescription className="text-xs text-gray-500">
              {preview ? `${formatSize(preview.size)} · ${formatTime(preview.mtime)}` : ''}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="relative w-full h-[55vh] bg-gray-50 rounded-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl(preview, false)}
                alt={preview.name}
                className="absolute inset-0 w-full h-full object-contain"
              />
            </div>
          )}
          <DialogFooter>
            <a
              href={preview ? previewUrl(preview, false) : '#'}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              <ExternalLink className="w-4 h-4" />
              新窗口打开原图
            </a>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
