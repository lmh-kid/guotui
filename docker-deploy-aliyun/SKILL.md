---
name: docker-deploy-aliyun
description: 为 Web 项目生成「构建机 docker build → 阿里云镜像仓库 → 目标服务器重建容器 → 健康检查回滚」的一键部署方案，输出 Dockerfile、.dockerignore 和 PowerShell 部署脚本（deploy.ps1）。当用户提到部署脚本、deploy.ps1、docker build 上线、镜像推送、阿里云镜像仓库、容器化发布、测试/生产服务器发布、一键部署时使用。
---

# Docker 部署到阿里云镜像仓库

## 这个 Skill 解决什么

把一个 Web 项目（Next.js / Node / 静态站）从「本地代码」变成「目标服务器上跑着的新容器」，产出一套可反复执行的部署链路：

```
本地 git push → 构建机 git pull + docker build → push-image.sh 推镜像仓库
   → 目标机 pull-image.sh + 重建容器 → 健康检查 → 失败自动回滚
```

## 何时使用

- 用户要「部署脚本」「一键上线」「发布到测试/生产服务器」
- 用户已有 .ps1/.sh 部署脚本，要为新项目复制一套（最常见）
- 用户提到构建服务器、阿里云个人版镜像仓库、docker run、健康检查、回滚

不适用：纯前端静态托管（OSS/CDN）、K8s 编排、Serverless 平台发布。

## 操作步骤

1. **先摸清项目产物形态**（决定 Dockerfile 长什么样）

   读取并确认：
   - `package.json` 的 `scripts.build` / `scripts.start`，有没有自定义 server（如 `server.ts` + tsup 打包成 `dist/server.js`）
   - 有没有 `next.config.*`、`public/`、`pnpm-lock.yaml`、`packageManager` 字段
   - 有没有 `Dockerfile` / `.dockerignore`（已存在则改造，不要重写）
   - 有没有定时任务、本地文件写入、需要外网访问的内部服务

   判定：
   | 特征 | 镜像形态 |
   |---|---|
   | 有 `next.config` | Next.js 运行时镜像（多阶段：build + 只装生产依赖运行） |
   | 有自定义 server（`dist/server.js`） | 同上，`CMD node dist/server.js` |
   | 纯 `vite build` 产物 `dist/` | nginx 静态镜像，**不需要 node 运行时** |
   | 进程内有 cron/定时任务 | 必须单实例，`--restart unless-stopped`，禁止多副本 |

2. **收集部署参数**（缺一项就写错一项，务必确认，不要瞎猜）

   - 镜像仓库地址、命名空间/镜像名、tag 规则（时间戳）
   - 容器名、宿主机端口 → 容器端口
   - 构建服务器、测试服务器、生产服务器的 IP/主机名
   - 目标机运行时环境变量（数据库连接、密钥、时区、域名）以及写入位置（如 `/root/release/<app>/.env.production`）
   - 目标机上是否已有 `push-image.sh` / `pull-image.sh` 辅助脚本（多数情况下沿用，不重写）
   - 健康检查路径 + 期望状态码（例如需要鉴权的接口期望 `401` 说明服务已就绪）
   - 构建机是否有外网、能否拉取私有仓库代码、内存是否 ≥ 4GB

3. **生成 Dockerfile**

   以 `assets/Dockerfile.nextjs.template` 为起点，替换占位符后写入项目根目录 `Dockerfile`。
   要点：
   - 多阶段：`builder` 装全量依赖并构建；`runner` 只装生产依赖
   - 用 `corepack enable` 固定 pnpm 版本，避免构建机 pnpm 版本漂移
   - `ENV TZ=Asia/Shanghai`（有定时任务时必加，否则 cron 时区错）
   - `EXPOSE` 与 `PORT` 保持一致，宿主机端口在外层映射

4. **生成 `.dockerignore`**

   必须排除：`node_modules`、`.next`、`dist`、`.git`、`*.log`、`.env*`、文档与素材目录。
   漏排 `node_modules` 会让构建上下文膨胀到几个 GB。

5. **生成 `assets/deploy.ps1`**

   以 `assets/deploy.ps1.template` 为起点，替换占位符（或直接运行 `scripts/gen_deploy.py` 自动替换，见下）。
   脚本必须包含 7 个阶段：
   1. 本地检查 + `git push`
   2. 构建机 clone/pull + `git checkout -f <commit>`
   3. `docker build` 打时间戳 tag
   4. 推送镜像（test/prod 走不同网络参数）
   5. 目标机写 `.env.production`（base64 传输 + `chmod 600`，已存在则复用）
   6. `pull-image.sh` → 停旧容器 → 起新容器（含日志轮转）
   7. 健康检查，失败**回滚到上一镜像**（起容器前用 `docker inspect` 存 `.last_good_image`）

6. **配日志轮转，并给出容量结论**

   恒定加：
   ```
   --log-driver json-file --log-opt max-size=10m --log-opt max-file=3
   ```
   同时按「每天大概多少行 / 一年多少 MB」给用户一个明确结论，判断需不需要应用层清理。多数业务系统日志量小，docker 轮转即可；只有在应用写文件日志时才需要 logrotate 或应用内清理。

7. **交付前自查**

   - [ ] 镜像名、容器名、端口与用户确认值一致
   - [ ] 环境变量清单完整（少一个就启动即崩）
   - [ ] 健康检查路径存在且期望码正确
   - [ ] 回滚所需的上一个镜像 tag 有保存
   - [ ] 定时任务类项目写清「只能单实例」
   - [ ] 说明「沙箱无 docker/pwsh，未实跑」等验证限制，给出首次先 `-SkipPush` 只验构建的建议

## 快速生成（推荐）

参数确认后，一条命令渲染出 `Dockerfile` + `.dockerignore` + `assets/deploy.ps1`：

```bash
python3 scripts/gen_deploy.py \
  --target /path/to/项目根目录 \
  --mode nextjs \
  --app-name my-app \
  --repo-url https://github.com/org/repo.git \
  --build-server 1.1.1.1 --test-server 2.2.2.2 --prod-server 3.3.3.3 \
  --registry crpi-xxxx.cn-heyuan.personal.cr.aliyuncs.com \
  --image-name ns/image --container-name my-web \
  --src-dir /root/src/my-app --runtime-dir /root/release/my-app \
  --host-port 102 --health-path /api/auth/me --health-code 401
```

- 目标文件已存在时自动备份为 `*.bak`；加 `--force` 直接覆盖
- `--mode static` 走 nginx 静态站镜像（此时 node 相关参数可忽略）
- 生成后 `deploy.ps1` 里的这些值都是**参数默认值**，运行时仍可 `-Env`/`-HostPort` 覆盖
- 渲染结束会打印待人工确认的 5 条，逐条核对后再执行

**两个必须人工核对的点**：
1. `Dockerfile` 的 `RUN pnpm build` 与 `CMD [...]` 要和 `package.json` 的 `scripts.build`/`scripts.start` 一致。无自定义 server 时 `CMD` 应为 `pnpm start` 或 `npx next start`，不要保留 `node dist/server.js`
2. `deploy.ps1` 的 `$EnvVars` 清单必须覆盖应用实际读取的所有运行时环境变量

## 资源索引

- `assets/Dockerfile.nextjs.template`：Next.js / Node 自定义 server 的多阶段 Dockerfile 模板，替换 `__XXX__` 占位符
- `assets/Dockerfile.static.template`：纯静态站（vite 产物 + nginx）的 Dockerfile 模板
- `assets/deploy.ps1.template`：PowerShell 一键部署脚本模板，含回滚与健康检查
- `assets/dockerignore.template`：`.dockerignore` 模板
- `scripts/gen_deploy.py`：按 key=value 参数把模板渲染到目标项目目录（自动改名 `.dockerignore`），并打印待人工确认项
- `references/checklist.md`：首次部署 / 排障检查清单，遇到「容器起不来」「端口不通」「健康检查失败」时读取

## 常见坑（务必提醒用户）

1. **跨平台构建**：不要「Windows 本地 build 再把 `.next`/`node_modules` 传上去」，原生依赖（sharp 等）会坏。一律在构建机 `git pull` 源码后 `docker build`。
2. **pnpm 符号链接**：pnpm 的 `node_modules` 是符号链接结构，复制时必须整目录复制，不能只复制包目录。
3. **环境变量缺失**：运行时缺 DB/密钥配置表现为「容器启动成功但接口 500」，健康检查要选一个依赖数据库的接口。
4. **多副本重复执行定时任务**：进程内 cron 只能单副本，扩容前必须先剥离成独立任务进程。
5. **日志无限增长**：不加 `max-size` 时 `json-file` 会吃满磁盘，这是最常见的线上事故。
