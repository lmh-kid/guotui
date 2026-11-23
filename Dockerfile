# syntax=docker/dockerfile:1

# ---------- 构建阶段 ----------
FROM node:22-bookworm-slim AS builder

ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=1 \
    NODE_OPTIONS=--max-old-space-size=4096

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# 依赖层（package.json / lock 未变时可复用缓存）
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# 源码
COPY . .

# 与 scripts/build.sh 保持一致：next build（webpack）+ tsup 打包自定义 server
RUN pnpm next build --webpack \
 && pnpm tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify

# ---------- 运行阶段 ----------
FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=5000 \
    DEPLOY_RUN_PORT=5000 \
    TZ=Asia/Shanghai

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# 仅安装生产依赖（coze-coding-dev-sdk 等运行时必需包在 dependencies 中）
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

# 构建产物
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 5000

# 单实例运行：server.js 内含 node-cron 日结定时任务，切勿横向扩容
CMD ["node", "dist/server.js"]
