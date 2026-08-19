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

# 镜像 tag（版本号与 server/package.json 保持一致）
$TAG = '0.4.1'
# 镜像全名
$IMAGE = "ghcr.io/sctale/tapledger-server:$TAG"

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

# 0.1) 进入 server 目录（脚本挂在 server/scripts/ 下）
$serverDir = Split-Path -Parent $PSScriptRoot
Push-Location $serverDir
try {
  # 1) 登录 GHCR（用 gh 生成的临时 token 走 stdin，不落盘）
  Write-Host "==> docker login ghcr.io（用 gh token）" -ForegroundColor Cyan
  $ghToken = & gh auth token
  $tokenBytes = [System.Text.Encoding]::UTF8.GetBytes($ghToken)
  $processInfo = New-Object System.Diagnostics.ProcessStartInfo
  $processInfo.FileName = 'docker'
  $processInfo.Arguments = 'login ghcr.io --username sctale --password-stdin'
  $processInfo.UseShellExecute = $false
  $processInfo.RedirectStandardInput = $true
  $processInfo.RedirectStandardOutput = $true
  $processInfo.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($processInfo)
  $process.StandardInput.BaseStream.Write($tokenBytes, 0, $tokenBytes.Length)
  $process.StandardInput.Close()
  $out = $process.StandardOutput.ReadToEnd()
  $err = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  Write-Host $out
  if ($err) { Write-Host $err -ForegroundColor Yellow }
  if ($process.ExitCode -ne 0) { Fail "docker login 失败，请检查网络与 gh 权限。" }

  # 2) 构建镜像并打好 GHCR tag
  Write-Host "==> docker build -t $IMAGE ." -ForegroundColor Cyan
  & docker build -t $IMAGE .
  if ($LASTEXITCODE -ne 0) { Fail "镜像构建失败。" }

  # 3) 推送镜像到 GHCR
  Write-Host "==> docker push $IMAGE" -ForegroundColor Cyan
  & docker push $IMAGE
  if ($LASTEXITCODE -ne 0) { Fail "镜像推送失败，请检查 gh 是否对该仓库有写权限。" }

  Write-Host ""
  Write-Host "镜像已推送: $IMAGE" -ForegroundColor Green
  Write-Host "NAS 上更新步骤：" -ForegroundColor Cyan
  Write-Host "  cd server && docker compose pull && docker compose up -d" -ForegroundColor Cyan
}
finally {
  Pop-Location
}