#!/usr/bin/env node
// 版本号同步（release-app.ps1 调用，v0.10.0 起独立成文件）
// 背景：PowerShell 5.1 调用 node -e 内联脚本时双引号会被原生参数传递吃掉，
// 改为独立脚本文件规避引号转义问题。
// 用法：node scripts/sync-version.js 0.10.0
// - app.json / package.json：正则替换保格式（不重排 JSON）
// - package-lock.json：JSON 往返（npm 本身写 2 空格缩进，格式一致）
const fs = require('fs');

const V = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(V)) {
  console.error(`版本号格式错误：${V}（应为 X.Y.Z）`);
  process.exit(1);
}

for (const f of ['app.json', 'package.json']) {
  let s = fs.readFileSync(f, 'utf8');
  s = s.replace(/"version": "[\d.]+"/, `"version": "${V}"`);
  fs.writeFileSync(f, s);
}

const lf = 'package-lock.json';
const l = JSON.parse(fs.readFileSync(lf, 'utf8'));
l.version = V;
if (l.packages && l.packages['']) l.packages[''].version = V;
fs.writeFileSync(lf, JSON.stringify(l, null, 2) + '\n');

// 服务端是独立的版本线（server/package.json 自己一套号），此前没人管它的 lock 文件，
// 导致 server/package-lock.json 里的 version 停在 0.4.0 而 package.json 已经是 0.5.5。
// 这里按 server/package.json 的实际版本回填 lock，避免发布时看着「版本不一致」误判。
const serverPkgPath = 'server/package.json';
const serverLockPath = 'server/package-lock.json';
if (fs.existsSync(serverPkgPath) && fs.existsSync(serverLockPath)) {
  const serverVersion = JSON.parse(fs.readFileSync(serverPkgPath, 'utf8')).version;
  if (serverVersion) {
    const sl = JSON.parse(fs.readFileSync(serverLockPath, 'utf8'));
    sl.version = serverVersion;
    if (sl.packages && sl.packages['']) sl.packages[''].version = serverVersion;
    fs.writeFileSync(serverLockPath, JSON.stringify(sl, null, 2) + '\n');
    console.log(`服务端 lock 版本已同步：${serverVersion}`);
  }
}

console.log(`版本号已同步：${V}`);
