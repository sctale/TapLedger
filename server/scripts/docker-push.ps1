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
  # 1) 登录 GHCR（用 gh 生成的临时 token 走 stdin，凭据文件用后即删）
  # 修复记录（2026-10-01）：PS5.x 非交互子进程中，管道/BaseStream 向 docker 写 stdin
  # 会被控制台编码层破坏，GHCR 报 "denied: denied"；改为写临时 ASCII 文件 + cmd 重定向，已实测成功。
  Write-Host "==> docker login ghcr.io（用 gh token）" -ForegroundColor Cyan
  $ghToken = & gh auth token
  if (-not $ghToken) { Fail "gh auth token 返回为空，请先执行 gh auth login --web 登录。" }
  $tokFile = Join-Path $env:TEMP 'ghcr_login_tok.tmp'
  try {
    [System.IO.File]::WriteAllText($tokFile, $ghToken + "`n", [System.Text.Encoding]::ASCII)
    cmd /c "docker login ghcr.io --username sctale --password-stdin < `"$tokFile`"" 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) {
      Fail "docker login 失败：token 可能缺少 packages 权限，请先执行 gh auth refresh -h github.com -s write:packages 并在浏览器确认授权后重试。"
    }
  } finally {
    Remove-Item $tokFile -Force -ErrorAction SilentlyContinue
  }

  # 2) 构建镜像并打好 GHCR tag
  Write-Host "==> docker build -t $IMAGE ." -ForegroundColor Cyan
  & docker build -t $IMAGE .
  if ($LASTEXITCODE -ne 0) { Fail "镜像构建失败。" }
  # 相同内容再打一个 latest tag（供 NAS docker compose pull 无脑拉取）
  & docker tag $IMAGE $IMAGE_LATEST
  if ($LASTEXITCODE -ne 0) { Fail "打 latest 标签失败。" }

  # 3) 推送镜像到 GHCR（版本号 + latest）
  Write-Host "==> docker push $IMAGE" -ForegroundColor Cyan
  & docker push $IMAGE
  if ($LASTEXITCODE -ne 0) { Fail "镜像推送失败，请检查 gh 是否对该仓库有写权限。" }
  Write-Host "==> docker push $IMAGE_LATEST" -ForegroundColor Cyan
  & docker push $IMAGE_LATEST
  if ($LASTEXITCODE -ne 0) { Fail "latest 镜像推送失败，请检查 gh 是否对该仓库有写权限。" }

  Write-Host ""
  Write-Host "镜像已推送: $IMAGE 与 $IMAGE_LATEST" -ForegroundColor Green
  Write-Host "NAS 上更新步骤：" -ForegroundColor Cyan
  Write-Host "  cd server && docker compose pull && docker compose up -d" -ForegroundColor Cyan
}
finally {
  Pop-Location
}