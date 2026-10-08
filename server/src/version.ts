import fs from 'fs';
import path from 'path';

// 服务端版本号（dist/*.js 的 __dirname 上一级就是镜像里的 /app/package.json；
// 本地 tsx src/*.ts 同样命中 server/package.json）。
// 同时给启动日志与 GET /api/health 用：出问题时要能不登容器就知道「NAS 上跑的是哪一版」——
// tag 会被 latest 覆盖，光看 docker images 说明不了内容。
let cached: string | null = null;

export function serverVersion(): string {
  if (cached !== null) return cached;
  try {
    const file = path.join(__dirname, '..', 'package.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string };
    cached = raw.version || '未知';
  } catch {
    // 自构建镜像少了 package.json 时只影响这一处显示，不该拖停服务
    cached = '未知';
  }
  return cached;
}
