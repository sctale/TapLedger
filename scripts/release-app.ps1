# =====================================================
# TapLedger APP 一键发布脚本（默认完整发布流程）
# 用法（任意目录）：
#   powershell -ExecutionPolicy Bypass -File scripts\release-app.ps1                 # 自动 patch +1
#   powershell -ExecutionPolicy Bypass -File scripts\release-app.ps1 -Version 1.0.0  # 指定版本
#   可选 -CommitMsg "feat: xxx" 自定义提交信息（默认 chore: 发布 vX.Y.Z）
# 前置：
#   - Node / Android SDK（gradlew + aapt）/ GitHub CLI(gh) 已登录
#   - android/ 已存在（首次需 npx expo prebuild --platform android）
#   - CHANGELOG.md 已包含目标版本条目（## [X.Y.Z]）
# 流程：
#   版本号同步（app.json/package.json/package-lock.json/build.gradle/README）
#   → 单测 + 类型检查 → 本地构建 APK → aapt 校验 → 复制 APK 到根目录
#   → git 提交推送 → 创建 GitHub Release 并上传 APK（说明取自 CHANGELOG）
# =====================================================

param(
  [string]$Version = '',
  [string]$CommitMsg = ''
)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Fail([string]$msg) { Write-Host "[错误] $msg" -ForegroundColor Red; exit 1 }

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
  # ---------- 0. 解析目标版本 ----------
  $appJson = Get-Content 'app.json' -Raw -Encoding UTF8 | ConvertFrom-Json
  $current = $appJson.expo.version
  if (-not $Version) {
    # 默认：补丁位 +1
    $parts = $current.Split('.')
    $parts[2] = [string]([int]$parts[2] + 1)
    $Version = $parts -join '.'
  }
  if ($Version -notmatch '^\d+\.\d+\.\d+$') { Fail "版本号格式错误：$Version（应为 X.Y.Z）" }
  $vp = $Version.Split('.')
  $versionCode = [int]$vp[0] * 10000 + [int]$vp[1] * 100 + [int]$vp[2]
  if ([int]$vp[1] -ge 100 -or [int]$vp[2] -ge 100) { Fail "minor/patch 必须 < 100" }
  Write-Host "==> 发布 v$Version（当前 $current，versionCode $versionCode）" -ForegroundColor Cyan

  # ---------- 1. CHANGELOG 校验（说明来源，缺失则中止） ----------
  $changelogPath = Join-Path $root 'CHANGELOG.md'
  $changelogRaw = [System.IO.File]::ReadAllText($changelogPath, $utf8)
  if ($changelogRaw -notmatch ('## \[' + [regex]::Escape($Version) + '\]')) {
    Fail "CHANGELOG.md 缺少 [$Version] 条目，请先补充（## [版本] - 日期）再发布。"
  }

  # ---------- 2. 版本号同步 ----------
  Write-Host "==> 同步版本号：app.json / package.json / package-lock.json" -ForegroundColor Cyan
  & node (Join-Path $PSScriptRoot 'sync-version.js') $Version
  if ($LASTEXITCODE -ne 0) { Fail "版本号同步失败。" }

  Write-Host "==> 同步 android/app/build.gradle（versionCode $versionCode / versionName $Version）" -ForegroundColor Cyan
  $gradlePath = Join-Path $root 'android\app\build.gradle'
  if (-not (Test-Path $gradlePath)) { Fail "未找到 android\app\build.gradle，请先执行 npx expo prebuild --platform android" }
  $g = [System.IO.File]::ReadAllText($gradlePath, $utf8)
  $g = $g -replace 'versionCode\s+\d+', "versionCode $versionCode"
  $g = $g -replace 'versionName\s+"[\d.]+"', "versionName `"$Version`""
  [System.IO.File]::WriteAllText($gradlePath, $g, $utf8)

  Write-Host "==> 同步 README 版本行" -ForegroundColor Cyan
  $readmePath = Join-Path $root 'README.md'
  $readmeRaw = [System.IO.File]::ReadAllText($readmePath, $utf8)
  $readmeRaw = $readmeRaw -replace '当前版本：[\d.]+', "当前版本：$Version"
  [System.IO.File]::WriteAllText($readmePath, $readmeRaw, $utf8)

  # ---------- 3. 单测 + 类型检查 ----------
  Write-Host "==> vitest + tsc" -ForegroundColor Cyan
  & npx vitest run
  if ($LASTEXITCODE -ne 0) { Fail "单测未通过。" }
  & npx tsc --noEmit
  if ($LASTEXITCODE -ne 0) { Fail "类型检查未通过。" }

  # ---------- 4. 本地构建 release APK ----------
  Write-Host "==> gradlew assembleRelease" -ForegroundColor Cyan
  Push-Location (Join-Path $root 'android')
  try { & .\gradlew.bat assembleRelease --console=plain }
  finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { Fail "APK 构建失败。" }

  $apkPath = Join-Path $root 'android\app\build\outputs\apk\release\app-release.apk'
  if (-not (Test-Path $apkPath)) { Fail "未找到构建产物：$apkPath" }

  # ---------- 5. aapt 校验 versionName / versionCode ----------
  $aapt = Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk\build-tools" -Recurse -Filter aapt.exe -ErrorAction SilentlyContinue |
          Sort-Object DirectoryName -Descending | Select-Object -First 1 -ExpandProperty FullName
  if (-not $aapt) { Fail "未找到 aapt.exe（Android SDK build-tools），无法校验版本号。" }
  $badgingOut = & $aapt dump badging $apkPath
  $pkgLine = ($badgingOut | Where-Object { $_ -match '^package:' }) -join ' '
  Write-Host "aapt: $pkgLine" -ForegroundColor Gray
  if ($pkgLine -notmatch [regex]::Escape("versionName='$Version'")) { Fail "versionName 校验失败（期望 $Version）" }
  if ($pkgLine -notmatch [regex]::Escape("versionCode='$versionCode'")) { Fail "versionCode 校验失败（期望 $versionCode）" }

  # ---------- 5.5 apksigner 校验签名者（v0.11：禁止 debug 签名的 release 包发布） ----------
  $apksigner = Get-ChildItem "$env:LOCALAPPDATA\Android\Sdk\build-tools" -Recurse -Filter apksigner.bat -ErrorAction SilentlyContinue |
               Sort-Object DirectoryName -Descending | Select-Object -First 1 -ExpandProperty FullName
  if (-not $apksigner) { Fail "未找到 apksigner.bat（Android SDK build-tools），无法校验签名。" }
  $certOut = & $apksigner verify --print-certs $apkPath 2>&1 | Out-String
  Write-Host "签名: $(($certOut -split "`n" | Where-Object { $_ -match 'certificate DN' }) -join ' ')" -ForegroundColor Gray
  if ($certOut -match 'CN=Android Debug') {
    Fail "APK 使用 debug keystore 签名，禁止发布！请确认 keystore.properties 与 keystore/ 目录存在后重新 prebuild。"
  }

  # ---------- 6. 复制 APK 到根目录 ----------
  $apkDest = Join-Path $root "TapLedger-v$Version.apk"
  Copy-Item $apkPath $apkDest -Force
  $mb = [math]::Round((Get-Item $apkDest).Length / 1MB, 1)
  Write-Host "==> APK 就绪：TapLedger-v$Version.apk（$mb MB）" -ForegroundColor Green

  # ---------- 7. git 提交推送 ----------
  Write-Host "==> git 提交推送" -ForegroundColor Cyan
  & git add -A
  if ($LASTEXITCODE -ne 0) { Fail "git add 失败。" }
  & git status --short
  if (-not $CommitMsg) { $CommitMsg = "chore: 发布 v$Version" }
  & git commit -m $CommitMsg
  if ($LASTEXITCODE -ne 0) { Fail "git commit 失败（可能无可提交改动）。" }
  & git push
  if ($LASTEXITCODE -ne 0) { Fail "git push 失败。" }

  # ---------- 8. GitHub Release + 上传 APK ----------
  Write-Host "==> gh release create v$Version" -ForegroundColor Cyan
  # Release 说明 = CHANGELOG 中本版本条目正文
  # v0.11 修复：改用 --notes-file（经验教训：--notes 传含 [x] 的内容会被 PowerShell 通配符干扰）
  $pattern = '(?s)## \[' + [regex]::Escape($Version) + '\] - [^\r\n]*\r?\n(.*?)(?=\r?\n## \[|$)'
  $m = [regex]::Match($changelogRaw, $pattern)
  $notes = if ($m.Success) { $m.Groups[1].Value.Trim() } else { "详见 CHANGELOG.md" }
  $notesFile = Join-Path ([System.IO.Path]::GetTempPath()) "tapledger-release-notes-$Version.md"
  [System.IO.File]::WriteAllText($notesFile, $notes, $utf8)
  try {
    & gh release create "v$Version" --repo sctale/TapLedger --title "v$Version" --target main --notes-file $notesFile $apkDest
    if ($LASTEXITCODE -ne 0) { Fail "GitHub Release 创建失败。" }
  } finally {
    Remove-Item $notesFile -ErrorAction SilentlyContinue
  }

  Write-Host ""
  Write-Host "发布完成：v$Version" -ForegroundColor Green
  Write-Host "  Release: https://github.com/sctale/TapLedger/releases/tag/v$Version" -ForegroundColor Cyan
}
finally {
  Pop-Location
}
