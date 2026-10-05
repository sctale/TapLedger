# =====================================================
# TapLedger Server — 本地构建并推送镜像到 GitHub 容器仓库 (GHCR)
# 用法（在装有 Docker 的机器上，server/ 目录下）：
#   powershell -ExecutionPolicy Bypass -File scripts/docker-push.ps1
# 前置：已安装 Docker；已安装官方 GitHub CLI (gh) 且已登录
#   gh auth status          # 确认已登录
#   或用 PAT 登录 gh：gh auth login --web  /  gh auth login
# 产出：ghcr.io/sctale/tapledger-server:<tag>
# 推送后 NAS 上只需 docker compose pull && docker compose up -d
# =====================================================

# -AllowSingleArch：本机没有 buildx 多架构能力时，明确允许只推宿主架构
# （默认拒绝——CI 推的是 amd64+arm64 清单，单架构覆盖后 arm64 NAS 会拉不到镜像）
param([switch]$AllowSingleArch)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# 镜像 tag：自动读取 server/package.json 版本号（单一数据源，无需手动改）
$serverDir = Split-Path -Parent $PSScriptRoot
$TAG = (Get-Content (Join-Path $serverDir 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
# 版本镜像名 + latest 镜像名（latest 供 NAS 无脑拉取）
$IMAGE = "ghcr.io/sctale/tapledger-server:$TAG"
$IMAGE_LATEST = "ghcr.io/sctale/tapledger-server:latest"

function Fail([string]$msg) { Write-Host "[错误] $msg" -ForegroundColor Red; exit 1 }
function SkipIfNoDocker {
  $d = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $d) { Fail "未检测到 docker，请先安装 Docker Desktop（或改为在 NAS 上执行本脚本）。" }
}
function SkipIfNoGh {
  $g = Get-Command gh -ErrorAction SilentlyContinue
  if (-not $g) { Fail "未检测到 GitHub CLI (gh)，请先安装并登录（gh auth login --web）。" }
}

# 0) 环境自查
Write-Host "==> 环境检查" -ForegroundColor Cyan
SkipIfNoDocker
SkipIfNoGh
& gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { Fail "gh 未登录，请执行 gh auth login --web 后重试。" }

# 0.1) 进入 server 目录（$serverDir 已在顶部解析）
  Push-Location $serverDir
try {
  # 1) 本地门禁：仓库不再配置任何构建类 GitHub Actions，检查必须在这里跑完，
  #    否则推上去的是一个没人验过的镜像（NAS 端直接跑生产）
  Write-Host "==> 服务端门禁：依赖 / typecheck / build" -ForegroundColor Cyan
  if (-not (Test-Path (Join-Path $serverDir 'node_modules'))) {
    & npm ci
    if ($LASTEXITCODE -ne 0) { Fail "依赖按 lockfile 安装失败，禁止推送。" }
  }
  & npm run typecheck
  if ($LASTEXITCODE -ne 0) { Fail "tsc 类型检查未通过，禁止推送。" }
  & npm run build
  if ($LASTEXITCODE -ne 0) { Fail "构建失败，禁止推送。" }

  # 冒烟：生产模式缺 JWT_SECRET 必须拒绝启动。这项保护一旦退化，等于发布一个
  # token 可被任意伪造的服务端镜像，所以它在门禁里而不是只写在文档里。
  Write-Host "==> 冒烟：生产模式缺 JWT_SECRET 必须拒绝启动" -ForegroundColor Cyan
  $smokeDir = Join-Path $env:TEMP ("tl-image-smoke-" + $PID)
  $prevNodeEnv = $env:NODE_ENV
  $prevDataDir = $env:DATA_DIR
  $prevJwtSecret = $env:JWT_SECRET
  $prevBackupDisabled = $env:BACKUP_DISABLED
  try {
    $env:NODE_ENV = 'production'
    $env:DATA_DIR = $smokeDir
    $env:BACKUP_DISABLED = '1'
    $env:JWT_SECRET = $null
    $smokeOut = (& node dist/index.js 2>&1 | Out-String)
    $smokeExit = $LASTEXITCODE
  } finally {
    $env:NODE_ENV = $prevNodeEnv
    $env:DATA_DIR = $prevDataDir
    $env:JWT_SECRET = $prevJwtSecret
    $env:BACKUP_DISABLED = $prevBackupDisabled
    if (Test-Path $smokeDir) { Remove-Item -Recurse -Force $smokeDir -ErrorAction SilentlyContinue }
  }
  if ($smokeExit -eq 0) { Fail "生产模式下没配 JWT_SECRET 居然启动成功：拒绝启动的保护已失效，禁止推送。" }
  if ($smokeOut -notmatch 'JWT_SECRET') { Fail "启动虽被拒绝，但没有预期的 JWT_SECRET 提示，请检查启动校验：`n$smokeOut" }
  Write-Host "==> 门禁通过" -ForegroundColor Green

  # 2) 登录 GHCR（用 gh 生成的临时 token 走 stdin，凭据文件用后即删）
  # 修复记录（2026-10-01）：PS5.x 非交互子进程中，管道/BaseStream 向 docker 写 stdin
  # 会被控制台编码层破坏，GHCR 报 "denied: denied"；改为写临时 ASCII 文件 + cmd 重定向，已实测成功。
  Write-Host "==> docker login ghcr.io" -ForegroundColor Cyan
  # 凭据来源优先级：环境变量里的一次性细粒度 PAT（推荐，只给 write:packages）
  #   其次才是 gh auth token —— 那是整机 GitHub 登录 token，scope 远大于推镜像所需
  $ghToken = if ($env:TAPLEDGER_GHCR_PAT) { $env:TAPLEDGER_GHCR_PAT.Trim() } else { (& gh auth token) -join '' }
  if (-not $ghToken) { Fail "没有可用凭据：设置环境变量 TAPLEDGER_GHCR_PAT（推荐，仅 write:packages 的 PAT），或执行 gh auth login --web 登录。" }
  # 随机文件名，避免多个进程/多次运行互相覆盖，也避免固定路径被其它工具翻找
  $tokFile = Join-Path $env:TEMP ("ghcr_login_{0}_{1}.tmp" -f $PID, [System.Guid]::NewGuid().ToString('N').Substring(0, 8))
  try {
    [System.IO.File]::WriteAllText($tokFile, $ghToken + "`n", [System.Text.Encoding]::ASCII)
    cmd /c "docker login ghcr.io --username sctale --password-stdin < `"$tokFile`"" 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
      Fail "docker login 失败：token 可能缺少 packages 权限，请先执行 gh auth refresh -h github.com -s write:packages 并在浏览器确认授权后重试。"
    }
  } finally {
    Remove-Item $tokFile -Force -ErrorAction SilentlyContinue
    $ghToken = $null
  }

  # 3) 构建并推送
  # 优先 buildx 多架构：CI workflow 发布的是 amd64+arm64 清单，
  # 而本机 docker build 只产宿主架构 —— 用它覆盖同名 tag/latest，
  # 会让 arm64 的 NAS 突然拉不到镜像（v0.11.8 审查发现的静默降级）
  & docker buildx version *> $null
  $hasBuildx = ($LASTEXITCODE -eq 0)
  if ($hasBuildx) {
    Write-Host "==> docker buildx build（linux/amd64 + linux/arm64）并推送 $TAG / latest" -ForegroundColor Cyan
    & docker buildx build --platform linux/amd64,linux/arm64 -t $IMAGE -t $IMAGE_LATEST --push .
    if ($LASTEXITCODE -ne 0) { Fail "多架构构建或推送失败。" }
  } else {
    if (-not $AllowSingleArch) {
      Fail "本机 docker 没有 buildx 多架构能力。单架构推送会覆盖 CI 发布的 amd64+arm64 清单，arm64 的 NAS 之后会拉不到镜像。请改跑 GitHub Actions 的 build-and-push-server-image workflow；确认确实只需本机架构时再加 -AllowSingleArch 重跑。"
    }
    Write-Host "==> docker build（仅本机架构，会覆盖多架构清单）" -ForegroundColor Yellow
    & docker build -t $IMAGE .
    if ($LASTEXITCODE -ne 0) { Fail "镜像构建失败。" }
    & docker tag $IMAGE $IMAGE_LATEST
    & docker push $IMAGE
    if ($LASTEXITCODE -ne 0) { Fail "镜像推送失败，请检查 gh 是否对该仓库有写权限。" }
    & docker push $IMAGE_LATEST
    if ($LASTEXITCODE -ne 0) { Fail "latest 镜像推送失败，请检查 gh 是否对该仓库有写权限。" }
  }

  Write-Host ""
  Write-Host "镜像已推送: $IMAGE 与 $IMAGE_LATEST" -ForegroundColor Green
  Write-Host "NAS 上更新步骤：" -ForegroundColor Cyan
  Write-Host "  cd server && docker compose pull && docker compose up -d" -ForegroundColor Cyan
}
finally {
  # 不留 GHCR 凭据在 ~/.docker/config.json 里（base64 明文长期有效）
  & docker logout ghcr.io 2>&1 | Out-Null
  Pop-Location
}