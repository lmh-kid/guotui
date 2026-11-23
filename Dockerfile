# syntax=docker/dockerfile:1
# guotui — Next.js（可选自定义 server，如 tsup 打包的 dist/server.js）
# 参数占位符由 docker-deploy-aliyun Skill 渲染，不要手动改占位符

FROM node:22-bookworm-slim AS builder
ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=1 \
    NODE_OPTIONS=--max-old-space-size=4096
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm next build --webpack && pnpm tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify

FROM node:22-bookworm-slim AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=Asia/Shanghai \
    PORT=5000 \
    DEPLOY_RUN_PORT=5000
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
COPY package.json pnpm-lock.yaml ./
# pnpm 的 node_modules 是符号链接结构，必须整目录安装/复制，不能挑单个包
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

EXPOSE 5000
CMD ["node","dist/server.js"]
