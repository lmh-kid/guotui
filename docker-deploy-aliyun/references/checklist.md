# 部署排障检查清单

## 首次部署前

- [ ] 构建机能 `git clone` 到代码（私有库需 token 或 deploy key）
- [ ] 构建机内存 ≥ 4GB（Next.js build 会吃 2GB 以上）
- [ ] 构建机与目标机都有 `push-image.sh` / `pull-image.sh`，且脚本支持 `--tag` / `--image`
- [ ] 目标机已 `docker login` 镜像仓库
- [ ] 目标机可出网访问依赖的外部服务（数据库、第三方 API、内网 NAS）
- [ ] 宿主机端口（如 102）未被占用：`ss -tulpn | grep ':102 '`
- [ ] 环境变量文件已准备，且每个 key 都被应用真正读取（少一个=接口 500）

## 构建失败

| 现象 | 原因 | 处理 |
|---|---|---|
| `ERR_PNPM_OUTDATED_LOCKFILE` | lockfile 与 package.json 不同步 | 本地 `pnpm install` 后提交 lockfile |
| `Killed` / `heap out of memory` | 构建内存不足 | 构建机加内存，或 `NODE_OPTIONS=--max-old-space-size=4096` |
| `sharp` / 原生模块报错 | 跨平台构建（Windows 产物传到 Linux） | 必须在构建机 `docker build`，不要复用本地 `.next` |
| 上下文 > 1GB | `.dockerignore` 漏排 `node_modules` | 补 `.dockerignore` |

## 容器起不来

```bash
docker ps -a --filter name=<容器名>          # 看 Exited 状态
docker logs --tail 200 <容器名>
```

- `Cannot find module 'xxx'` → 该包是 devDependency，运行阶段装生产依赖时被剪掉，移到 dependencies
- `ECONNREFUSED` / 连接数据库失败 → 环境变量缺失或值错误（`docker exec <容器名> env | grep -i 关键前缀` 验证）
- 立即退出且无日志 → `CMD` 路径错误（确认 `dist/server.js` 或 `.next` 存在）
- `EADDRINUSE` → 容器内端口与 `PORT` 不一致

## 健康检查失败但容器在跑

1. 在目标机内网 curl：`curl -i http://127.0.0.1:<端口><健康路径>`，看真实返回
2. 期望码设错（如把「未登录 401」当成失败）——鉴权接口返回 401 恰恰说明服务已就绪
3. 应用启动慢（首次编译/预热），把探针重试次数加大到 10~20 次
4. 反向代理/端口映射错：`docker port <容器名>`

## 回滚

```bash
cat <运行目录>/.last_good_image          # 上一个镜像
/root/pull-image.sh --image <该镜像>
docker stop <容器名> && docker rm <容器名>
docker run -d --name <容器名> --restart unless-stopped \
  --env-file <运行目录>/.env.production \
  -p <宿主端口>:<容器端口> \
  --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
  <该镜像>
```

或直接 `.\assets\deploy.ps1 -Env prod -RollbackOnly`。

## 日志与磁盘

- 没加 `--log-opt max-size` 时 `json-file` 会无限增长：`du -sh /var/lib/docker/containers/*/*-json.log`
- 定期检查：`docker system df`（镜像/容器/卷占用），`docker image prune -f` 清理旧 tag
- 应用内写文件日志的项目，额外配 logrotate，别指望 docker 管

## 定时任务类项目

- 进程内 cron 只能单副本，扩容前先剥离为独立任务容器
- 容器 `TZ` 必须显式设置，否则 cron 按 UTC 跑（差 8 小时）
