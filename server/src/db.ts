import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// 数据目录（Docker 内挂载 /app/data；本地开发为 server/data）
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'tapledger.db'));

// WAL 模式：读写并发更稳，NAS 断电容错更好
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 建表（幂等）
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_emoji TEXT NOT NULL DEFAULT '🙂',
    family_id INTEGER,
    family_role TEXT CHECK(family_role IN ('owner', 'member') OR family_role IS NULL),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS families (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    owner_id INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS records (
    uuid TEXT PRIMARY KEY,
    family_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL DEFAULT 0,
    amount REAL NOT NULL,
    category TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
    note TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    account_uuid TEXT NOT NULL DEFAULT '',
    reimbursable INTEGER NOT NULL DEFAULT 0,
    reimbursed INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_records_family_updated ON records(family_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_records_family_date ON records(family_id, date);

  CREATE TABLE IF NOT EXISTS accounts (
    uuid TEXT PRIMARY KEY,
    family_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'cash',
    emoji TEXT NOT NULL DEFAULT '💵',
    color TEXT NOT NULL DEFAULT '#90A4AE',
    initial_balance REAL NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_accounts_family_updated ON accounts(family_id, updated_at);

  CREATE TABLE IF NOT EXISTS transfers (
    uuid TEXT PRIMARY KEY,
    family_id INTEGER NOT NULL,
    from_account_uuid TEXT NOT NULL,
    to_account_uuid TEXT NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    timestamp INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_transfers_family_updated ON transfers(family_id, updated_at);

  CREATE TABLE IF NOT EXISTS recurring (
    uuid TEXT PRIMARY KEY,
    family_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
    category TEXT NOT NULL,
    account_uuid TEXT NOT NULL DEFAULT '',
    frequency TEXT NOT NULL DEFAULT 'monthly',
    day_of_week INTEGER NOT NULL DEFAULT 0,
    day_of_month INTEGER NOT NULL DEFAULT 1,
    month_of_year INTEGER NOT NULL DEFAULT 1,
    note TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    last_generated TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_recurring_family_updated ON recurring(family_id, updated_at);

  CREATE TABLE IF NOT EXISTS custom_categories (
    uuid TEXT PRIMARY KEY,
    family_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '📌',
    color TEXT NOT NULL DEFAULT '#90A4AE',
    type TEXT NOT NULL CHECK(type IN ('expense', 'income')),
    updated_at INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_custom_cats_family_updated ON custom_categories(family_id, updated_at);
`);

// 生成 6 位大写字母数字邀请码（避开易混淆字符）
export function genInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// 生成唯一邀请码（撞码重试）
export function genUniqueInviteCode(): string {
  for (let i = 0; i < 10; i++) {
    const code = genInviteCode();
    const row = db.prepare('SELECT id FROM families WHERE invite_code = ?').get(code);
    if (!row) return code;
  }
  // 极小概率兜底：时间戳后 6 位
  return String(Date.now()).slice(-6).toUpperCase();
}
