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

console.log(`版本号已同步：${V}`);
