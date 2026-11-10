import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname, port, webpack: true });
const handle = app.getRequestHandler();

// ============ 方果订单自动同步定时任务 ============
// 每 10 分钟同步一次（API KEY 未配置时自动跳过）
// 用 globalThis 防止 dev 模式 HMR 重复注册
const SYNC_INTERVAL_MS = 10 * 60 * 1000;

async function runAutoSync() {
  try {
    // 动态 import 避免 server 启动时加载业务模块
    const { syncFangguoOrders } = await import('@/lib/fangguo-sync');
    const result = await syncFangguoOrders(1);
    if (result.fetched > 0 || result.unassigned > 0 || result.failed > 0) {
      console.log(`[auto-sync] ${result.message}`);
      if (result.unassignedSamples.length > 0) {
        console.log(`[auto-sync] 未分配订单: ${result.unassignedSamples.join(', ')}`);
      }
    }
  } catch (err) {
    // API KEY 未配置等预期错误静默跳过，其他记录日志
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('未配置')) {
      console.error('[auto-sync] failed:', msg);
    }
  }
}

function startAutoSyncScheduler() {
  const g = globalThis as unknown as { __fangguoSyncTimer?: NodeJS.Timeout };
  if (g.__fangguoSyncTimer) return;

  g.__fangguoSyncTimer = setInterval(runAutoSync, SYNC_INTERVAL_MS);
  // 启动 30 秒后先跑一次
  setTimeout(runAutoSync, 30 * 1000);
  console.log(`[auto-sync] scheduler started, interval = ${SYNC_INTERVAL_MS / 60000} min`);
}
// ====================================================

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
    startAutoSyncScheduler();
  });
});
