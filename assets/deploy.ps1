<#
.SYNOPSIS
    guotui 一键部署脚本（构建机 docker build → 阿里云镜像仓库 → 目标机重建容器 → 健康检查 + 自动回滚）

.DESCRIPTION
    由 docker-deploy-aliyun Skill 生成。服务器侧 push-image.sh / pull-image.sh 的仓库路径固定为 jiuyin/jiuyin，guotui 用 tag 前缀区分应用。

.EXAMPLE
    .\assets\deploy.ps1 -Env test
    .\assets\deploy.ps1 -Env prod -SupabaseUrl "https://x.supabase.co" -SupabaseAnonKey "..." -SupabaseServiceRoleKey "..." -ProjectDomain "https://a.com"
    .\assets\deploy.ps1 -Env test -SkipPush          # 只验构建
    .\assets\deploy.ps1 -Env prod -RollbackOnly       # 回滚到上一个镜像
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('test', 'prod')]
    [string]$Env,

    [string]$Commit = '',
    [string]$Branch = 'main',

    [string]$RepoUrl = 'https://github.com/lmh-kid/guotui.git',

    # 可选：初始化环境变量文件时使用（见 -UpdateEnv）
    [string]$SupabaseUrl = '',
    [string]$SupabaseAnonKey = '',
    [string]$SupabaseServiceRoleKey = '',
    [string]$ProjectDomain = '',
    [string]$ExtraEnv = '',

    [string]$BuildServer = '8.155.17.201',
    [string]$TestServer = '47.121.30.52',
    [string]$ProdServer = '118.145.180.246',

    [string]$Registry = 'crpi-wwgro8wum0lnddlc.cn-heyuan.personal.cr.aliyuncs.com',
    [string]$ImageName = 'jiuyin/guotui',
    [string]$ContainerName = 'nine-guotui',
    [string]$SrcDir = '/root/release/guotui-src',
    [string]$RuntimeDir = '/root/release/guotui',

    [int]$HostPort = 102,
    [int]$ContainerPort = 5000,

    [string]$HealthPath = '/api/auth/me',
    [int]$HealthCode = 401,

    [string]$DockerUser = 'root',
    [switch]$SkipPush,
    [switch]$SkipBuild,
    [switch]$NoCache,
    [switch]$UpdateEnv,
    [switch]$RollbackOnly,
    [switch]$DryRun
)

# 原生命令（git/ssh）的 stderr 在 Stop 模式下会被当成终止错误，这里用 Continue + 显式 $LASTEXITCODE 检查
$ErrorActionPreference = 'Continue'
# -n 禁用 stdin，BatchMode 禁止任何交互提示（避免后台执行时挂起）
$SshOpt = @('-n', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=15')

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "  [!!] $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  [XX] $msg" -ForegroundColor Red; exit 1 }

function Invoke-Ssh {
    param([string]$Target, [string]$Command)
    Write-Host "  ssh $DockerUser@$Target > $Command" -ForegroundColor DarkGray
    if ($DryRun) { return }
    $out = ssh $SshOpt "$DockerUser@$Target" $Command 2>&1
    if ($LASTEXITCODE -ne 0) {
        $out | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
        throw "ssh 执行失败（exit=$LASTEXITCODE）：$Command"
    }
    return $out
}

$DeployTarget = if ($Env -eq 'test') { $TestServer } else { $ProdServer }
$EnvFile = "$RuntimeDir/.env.production"
$Timestamp = Get-Date -Format 'yyyyMMddHHmmss'
# 服务器侧 push-image.sh / pull-image.sh 的仓库路径固定为 jiuyin/jiuyin，guotui 用 tag 前缀区分应用
$RepoPath = 'jiuyin/jiuyin'
$Tag = "guotui-$Timestamp"
$Image = "$Registry/$RepoPath`:$Tag"
$LatestImage = "$Registry/$RepoPath`:guotui-latest"
# test 走 VPC 内网，prod 走公网（--public 跳过交互询问，避免远程执行挂起）
$NetFlag = if ($Env -eq 'test') { '--vpc' } else { '--public' }
if (-not $Commit) { $Commit = (git rev-parse $Branch) }

Write-Host "`n===== guotui 部署 =====" -ForegroundColor Cyan
Write-Host "  环境      : $Env"
Write-Host "  目标主机  : $DeployTarget"
Write-Host "  镜像      : $Image"
Write-Host "  容器      : $ContainerName  ($HostPort -> $ContainerPort)"
Write-Host "  代码版本  : $Commit"
if ($DryRun) { Write-Warn2 'DryRun 模式：只打印命令，不实际执行' }

# ---------- 0. 仅回滚 ----------
if ($RollbackOnly) {
    Write-Step '0/7 仅回滚（不构建不推送）'
    Invoke-Ssh $DeployTarget "set -e; IMG=`$(cat $RuntimeDir/.last_good_image); echo 回滚镜像: `$IMG; docker stop $ContainerName >/dev/null 2>&1 || true; docker rm $ContainerName >/dev/null 2>&1 || true; docker run -d --name $ContainerName --restart unless-stopped --env-file $EnvFile -p ${HostPort}:${ContainerPort} --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 `$IMG; docker ps --filter name=$ContainerName --format '{{.Status}}'" | ForEach-Object { Write-Ok $_ }
    exit 0
}

# ---------- 1. 本地检查 ----------
Write-Step '1/7 本地代码检查'
git diff --quiet
$DirtyWork = ($LASTEXITCODE -ne 0)
git diff --cached --quiet
$DirtyIndex = ($LASTEXITCODE -ne 0)
if ($DirtyWork -or $DirtyIndex) {
    Write-Fail '工作区有未提交改动，请先 commit（部署只认 git 里的版本）'
}
Write-Ok "当前分支 $(git rev-parse --abbrev-ref HEAD) @ $Commit"
if (-not $SkipPush) {
    if ($DryRun) { Write-Ok 'git push（dry-run 跳过）' }
    else {
        git push origin $Branch 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Fail 'git push 失败（可加 -SkipPush 跳过）' }
        Write-Ok '代码已推送'
    }
}

# ---------- 2. 构建机拉代码 ----------
Write-Step '2/7 构建机同步代码'
Invoke-Ssh $BuildServer "set -e; mkdir -p $SrcDir; cd $SrcDir; if [ ! -d .git ]; then git clone $RepoUrl .; fi; git fetch --all; git checkout -f $Commit; git log --oneline -1" | ForEach-Object { Write-Ok $_ }

# ---------- 3. 构建镜像 ----------
if ($SkipBuild) {
    Write-Step '3/7 构建镜像（-SkipBuild 跳过）'
} else {
    Write-Step '3/7 构建镜像'
    $CacheFlag = if ($NoCache) { '--no-cache' } else { '' }
    Invoke-Ssh $BuildServer "set -e; cd $SrcDir; docker build $CacheFlag -t $Image -t $LatestImage . && docker images | head -n 5" | ForEach-Object { Write-Ok $_ }
}

# ---------- 4. 推送镜像 ----------
Write-Step '4/7 推送镜像到仓库'
if ($SkipPush -and -not $SkipBuild) { Write-Warn2 '-SkipPush 已置位，跳过推送（目标机将拉不到新镜像）' }
else {
    Invoke-Ssh $BuildServer "set -e; /root/push-image.sh --image $Image --tag $Tag $NetFlag" | ForEach-Object { Write-Ok $_ }
}

# ---------- 5. 目标机环境变量 ----------
Write-Step '5/7 目标机环境变量'
$RemoteEnvExists = if ($DryRun) { 'no' } else { (ssh $SshOpt "$DockerUser@$DeployTarget" "[ -f $EnvFile ] && echo yes || echo no").Trim() }
$NeedWrite = ($RemoteEnvExists -ne 'yes') -or $UpdateEnv
if (-not $NeedWrite) {
    Write-Ok "复用已有 $EnvFile（加 -UpdateEnv 可覆盖）"
} else {
    if (-not $SupabaseUrl -or -not $SupabaseServiceRoleKey -or -not $ProjectDomain) {
        Write-Fail '首次部署必须提供 -SupabaseUrl / -SupabaseServiceRoleKey / -ProjectDomain（可加 -UpdateEnv 覆盖已有文件）'
    }
    $lines = @(
        "# guotui 运行时环境（$Env）"
        "COZE_SUPABASE_URL=$SupabaseUrl"
        "COZE_SUPABASE_ANON_KEY=$SupabaseAnonKey"
        "COZE_SUPABASE_SERVICE_ROLE_KEY=$SupabaseServiceRoleKey"
        "COZE_PROJECT_DOMAIN_DEFAULT=$ProjectDomain"
        "COZE_PROJECT_ENV=PROD"
        "PORT=$ContainerPort"
        "TZ=Asia/Shanghai"
    )
    if ($ExtraEnv) { $lines += ($ExtraEnv -split "`n") }
    $content = ($lines -join "`n") + "`n"
    $EnvB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($content))
    Invoke-Ssh $DeployTarget "set -e; mkdir -p $RuntimeDir; echo $EnvB64 | base64 -d > $EnvFile; chmod 600 $EnvFile; grep -c '=' $EnvFile" | ForEach-Object { Write-Ok "已写入 $EnvFile（$($lines.Count) 行）" }
}

# ---------- 6. 目标机重建容器 ----------
Write-Step '6/7 重建容器'
Invoke-Ssh $DeployTarget "set -e; mkdir -p $RuntimeDir; docker inspect -f '{{.Config.Image}}' $ContainerName > $RuntimeDir/.last_good_image 2>/dev/null || true"
$RunCmd = "set -e; " +
    "docker stop $ContainerName >/dev/null 2>&1 || true; " +
    "docker rm $ContainerName >/dev/null 2>&1 || true; " +
    "/root/pull-image.sh --tag $Tag $NetFlag; " +
    "docker rm -f $ContainerName >/dev/null 2>&1 || true; " +
    "docker run -d --name $ContainerName " +
    "--restart unless-stopped " +
    "--env-file $EnvFile " +
    "-p ${HostPort}:${ContainerPort} " +
    "--log-driver json-file --log-opt max-size=10m --log-opt max-file=3 " +
    "$Image; " +
    "docker ps --filter name=$ContainerName --format '{{.Status}}'"
Invoke-Ssh $DeployTarget $RunCmd | ForEach-Object { Write-Ok $_ }

# ---------- 7. 健康检查 + 回滚 ----------
Write-Step '7/7 健康检查'
if ($DryRun) { Write-Ok 'dry-run 跳过'; exit 0 }
$ProbeCmd = 'for i in 1 2 3 4 5 6 7 8 9 10; do code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:' + $HostPort + $HealthPath + '); if [ "$code" = "' + $HealthCode + '" ]; then echo OK:$code; exit 0; fi; sleep 3; done; echo FAIL:$code; exit 1'
$ProbeResult = (ssh $SshOpt "$DockerUser@$DeployTarget" $ProbeCmd) 2>&1
$ProbeExit = $LASTEXITCODE
$ProbeResult | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

if ($ProbeExit -eq 0) {
    Write-Ok "健康检查通过（$HealthPath = $HealthCode）"
    Write-Host "`n部署成功：$Env / $Image" -ForegroundColor Green
    Write-Host "日志：ssh $DeployTarget 'docker logs -f --tail 100 $ContainerName'" -ForegroundColor DarkGray
} else {
    Write-Warn2 '健康检查失败，开始回滚…'
    $RollbackCmd = "set -e; docker stop $ContainerName >/dev/null 2>&1 || true; docker rm $ContainerName >/dev/null 2>&1 || true; " +
        "IMG=`$(cat $RuntimeDir/.last_good_image 2>/dev/null); " +
        "if [ -n `"`$IMG`" ]; then docker run -d --name $ContainerName --restart unless-stopped --env-file $EnvFile -p ${HostPort}:${ContainerPort} --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 `$IMG; echo 已回滚到 `$IMG; else echo 无可用回滚镜像; fi"
    Invoke-Ssh $DeployTarget $RollbackCmd | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
    Write-Fail "部署失败，已回滚。排查：ssh $DeployTarget 'docker logs --tail 200 $ContainerName'"
}
