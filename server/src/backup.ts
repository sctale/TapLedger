// 每日自动热备份：better-sqlite3 backup()（WAL 安全的在线备份，无需停服）
// 产物：DATA_DIR/backups/tapledger-YYYY-MM-DD.db，同日重复启动不重复审；默认保留最近 7 份
// env：BACKUP_KEEP 保留份数（默认 7）；BACKUP_DISABLED=1 关闭
import { db } from './db';
import path from 'path';
import fs from 'fs';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP || '7') || 7);
const INTERVAL_MS = 24 * 3600_000;

function localDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function prune(): void {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => /^tapledger-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort();
  while (files.length > KEEP) {
    const old = files.shift();
    if (!old) break;
    fs.rmSync(path.join(BACKUP_DIR, old));
    console.log(`[backup] pruned ${old}`);
  }
}

async function runBackup(): Promise<void> {
  const target = path.join(BACKUP_DIR, `tapledger-${localDate()}.db`);
  try {
    await db.backup(target);
    prune();
    console.log(`[backup] wrote ${path.basename(target)}`);
  } catch (e) {
    console.error('[backup] 备份失败:', (e as Error).message);
  }
}

export function startAutoBackup(): void {
  if (process.env.BACKUP_DISABLED === '1') {
    console.log('[backup] 已禁用（BACKUP_DISABLED=1）');
    return;
  }
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  // 当天还没有备份 → 启动后补一次，之后每 24h 一份；长期停机的场景靠开机补备覆盖
  const today = path.join(BACKUP_DIR, `tapledger-${localDate()}.db`);
  if (!fs.existsSync(today)) void runBackup();
  const timer = setInterval(() => void runBackup(), INTERVAL_MS);
  timer.unref(); // 不阻止进程退出
}
