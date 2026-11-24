#!/usr/bin/env python3
"""把 docker-deploy-aliyun 的模板渲染到目标项目。

用法示例:
  python3 gen_deploy.py --target /workspace/projects \
      --app-name guotui --image-name jiuyin/guotui --container-name nine-guotui \
      --registry crpi-xxxx.cn-heyuan.personal.cr.aliyuncs.com \
      --repo-url https://github.com/owner/repo.git \
      --build-server 1.1.1.1 --test-server 2.2.2.2 --prod-server 3.3.3.3 \
      --src-dir /root/release/guotui-src --runtime-dir /root/release/guotui \
      --host-port 102 --container-port 5000 \
      --health-path /api/auth/me --health-code 401

渲染结果:
  <target>/Dockerfile
  <target>/.dockerignore
  <target>/assets/deploy.ps1
"""

import argparse
import pathlib
import re
import sys

TEMPLATE_DIR = pathlib.Path(__file__).resolve().parent.parent / "assets"

DEFAULTS = {
    "APP_NAME": "app",
    # 国内构建机通常直连不了 Docker Hub，默认走 DaoCloud 代理域名
    "NODE_IMAGE": "docker.m.daocloud.io/library/node:22-bookworm-slim",
    "NGINX_IMAGE": "docker.m.daocloud.io/library/nginx:1.27-alpine",
    "PNPM_VERSION": "9.0.0",
    "TZ": "Asia/Shanghai",
    "CONTAINER_PORT": "5000",
    "HOST_PORT": "5000",
    "BUILD_CMD": "pnpm build",
    "START_CMD": '["node","dist/server.js"]',
    "STATIC_DIR": "dist",
    "REPO_URL": "https://github.com/owner/repo.git",
    "REGISTRY": "registry.cn-hangzhou.aliyuncs.com",
    "IMAGE_NAME": "app/app",
    "CONTAINER_NAME": "app",
    "SRC_DIR": "/root/release/app-src",
    "RUNTIME_DIR": "/root/release/app",
    "BUILD_SERVER": "127.0.0.1",
    "TEST_SERVER": "127.0.0.1",
    "PROD_SERVER": "127.0.0.1",
    "HEALTH_PATH": "/",
    "HEALTH_CODE": "200",
}

REQUIRED = ("APP_NAME", "IMAGE_NAME", "CONTAINER_NAME", "BUILD_SERVER", "TEST_SERVER", "PROD_SERVER")


def render(template_name: str, values: dict) -> str:
    text = (TEMPLATE_DIR / template_name).read_text(encoding="utf-8")
    for key, value in values.items():
        text = text.replace(f"__{key}__", str(value))
    leftover = sorted(set(re.findall(r"__[A-Z0-9_]+__", text)))
    if leftover:
        print("  [warn] 仍有未替换的占位符：" + ", ".join(leftover))
    return text


def write_out(path: pathlib.Path, content: str, force: bool) -> None:
    if path.exists() and not force:
        backup = path.with_suffix(path.suffix + ".bak")
        path.replace(backup)
        print(f"  [backup] {path} -> {backup.name}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8", newline="\n")
    print(f"  [write]  {path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="渲染 docker 部署模板到目标项目")
    parser.add_argument("--target", required=True, help="目标项目根目录")
    parser.add_argument("--mode", choices=["nextjs", "static"], default="nextjs")
    parser.add_argument("--force", action="store_true", help="直接覆盖已有文件（默认生成 .bak 备份）")
    for key in DEFAULTS:
        parser.add_argument("--" + key.lower().replace("_", "-"), dest=key, default=None)
    args = parser.parse_args()

    values = dict(DEFAULTS)
    for key in DEFAULTS:
        given = getattr(args, key)
        if given:
            values[key] = given

    missing = [k for k in REQUIRED if values[k] == DEFAULTS[k]]
    if missing:
        print("[fail] 以下参数必须显式提供：" + ", ".join("--" + k.lower().replace("_", "-") for k in missing))
        return 2

    target = pathlib.Path(args.target).resolve()
    if not target.is_dir():
        print(f"[fail] 目标目录不存在: {target}")
        return 2

    if values["CONTAINER_PORT"] != "5000" and args.container_port is None:
        print("  [warn] 容器端口非 5000，确认 Dockerfile 的 EXPOSE 与 PORT 一致")

    print(f"[1/3] 渲染 Dockerfile（mode={args.mode}）")
    dockerfile_tpl = "Dockerfile.nextjs.template" if args.mode == "nextjs" else "Dockerfile.static.template"
    if args.mode == "static" and values["START_CMD"] == DEFAULTS["START_CMD"]:
        values["START_CMD"] = '["nginx","-g","daemon off;"]'
    write_out(target / "Dockerfile", render(dockerfile_tpl, values), args.force)

    print("[2/3] 渲染 .dockerignore")
    write_out(target / ".dockerignore", render("dockerignore.template", values), args.force)

    print("[3/3] 渲染 assets/deploy.ps1")
    write_out(target / "assets" / "deploy.ps1", render("deploy.ps1.template", values), args.force)

    print(
        "\n完成。请人工确认：\n"
        "  1. Dockerfile 的构建/启动命令与项目 package.json 一致\n"
        "  2. deploy.ps1 的环境变量清单覆盖运行时所需（漏一个就启动即崩）\n"
        "  3. 目标机已有 push-image.sh / pull-image.sh\n"
        "  4. 健康检查路径与期望状态码正确（依赖数据库的接口优先）\n"
        "  5. 构建机能访问代码仓库，内存 >= 4GB"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
