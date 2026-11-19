import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import cron from 'node-cron';
import { runDailySettlement } from '@/lib/daily-settlement';

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname, port, webpack: true });
const handle = app.getRequestHandler();

// 订单不落库：订单查询实时透传方果 API（见 src/lib/fangguo-live.ts），
// 本地仅落库用户/余额/流水/推单记录/店铺分配/方果资金流水镜像

// 日结定时任务：每天 00:00（Asia/Shanghai）= 前一天 24 点
// 结算内容：每用户每天 = 方果实扣材运费 + 有效退费 + 0.5 × 当日推单数
// 幂等可重跑；也可由管理员在后台手动触发（/api/admin/settlement/run，与定时任务互斥）
function scheduleDailySettlement() {
  // timezone: Asia/Shanghai 保证按东八区零点触发（服务器时区无关）
  cron.schedule(
    '0 0 * * *',
    async () => {
      console.log('[settlement] 定时日结开始', new Date().toISOString());
      try {
        const result = await runDailySettlement();
        console.log(
          `[settlement] 定时日结完成: 同步流水 ${result.syncedLines} 条(新 ${result.newLines}), ` +
          `未归属 ${result.unassigned}, 未知类型 ${result.unknown}, ` +
          `结算 ${result.settledUsers} 用户 ¥${result.settledAmount.toFixed(2)}, 幂等跳过 ${result.skippedUsers}`,
        );
        if (result.errors.length > 0) {
          console.error('[settlement] 日结部分失败:', result.errors);
        }
      } catch (err) {
        console.error('[settlement] 定时日结异常:', err);
      }
    },
    { timezone: 'Asia/Shanghai' }
  );
  console.log('[settlement] 日结定时任务已注册（每天 00:00 Asia/Shanghai）');
}

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
    scheduleDailySettlement();
  });
});
