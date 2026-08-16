import * as SQLite from 'expo-sqlite';
import type {
  Account, AccountBalance, CustomCategory, DaySummary, LedgerRecord, RecurringRule,
  RecordType, Transfer,
} from '../types';

const DB_NAME = 'tapledger.db';

let db: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// 获取数据库实例（单例）
async function getDB(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  try {
    db = await dbPromise;
    return db;
  } catch (e) {
    db = null;
    dbPromise = null;
    throw e;
  }
}

// 检查列是否存在
async function hasColumn(database: SQLite.SQLiteDatabase, table: string, column: string): Promise<boolean> {
  const rows = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

// 初始化数据库表（含 v0.1 → v0.2 迁移）
export async function initDatabase(): Promise<void> {
  const database = await getDB();
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS ledger_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'expense' CHECK(type IN ('expense', 'income')),
      note TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger_records(date);
    CREATE INDEX IF NOT EXISTS idx_ledger_type ON ledger_records(type);
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // ===== v0.1 → v0.2 迁移 =====
  // 1) ledger_records 增加 account_id / reimbursable / reimbursed
  if (!(await hasColumn(database, 'ledger_records', 'account_id'))) {
    await database.execAsync(`ALTER TABLE ledger_records ADD COLUMN account_id INTEGER NOT NULL DEFAULT 1`);
  }
  if (!(await hasColumn(database, 'ledger_records', 'reimbursable'))) {
    await database.execAsync(`ALTER TABLE ledger_records ADD COLUMN reimbursable INTEGER NOT NULL DEFAULT 0`);
  }
  if (!(await hasColumn(database, 'ledger_records', 'reimbursed'))) {
    await database.execAsync(`ALTER TABLE ledger_records ADD COLUMN reimbursed INTEGER NOT NULL DEFAULT 0`);
  }

  // 2) 新表
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'cash',
      emoji TEXT NOT NULL DEFAULT '💵',
      color TEXT NOT NULL DEFAULT '#90A4AE',
      initial_balance REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_account_id INTEGER NOT NULL,
      to_account_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transfers_date ON transfers(date);
    CREATE TABLE IF NOT EXISTS recurring_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL DEFAULT 'expense',
      category TEXT NOT NULL,
      account_id INTEGER NOT NULL DEFAULT 1,
      frequency TEXT NOT NULL DEFAULT 'monthly',
      day_of_week INTEGER NOT NULL DEFAULT 0,
      day_of_month INTEGER NOT NULL DEFAULT 1,
      month_of_year INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_generated TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS custom_categories (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📌',
      color TEXT NOT NULL DEFAULT '#90A4AE',
      type TEXT NOT NULL DEFAULT 'expense',
      created_at INTEGER NOT NULL
    );
  `);

  // 3) 确保默认账户"现金"存在
  const cash = await database.getFirstAsync<{ id: number }>(
    'SELECT id FROM accounts WHERE id = 1'
  );
  if (!cash) {
    await database.runAsync(
      `INSERT INTO accounts (id, name, type, emoji, color, initial_balance, created_at)
       VALUES (1, '现金', 'cash', '💵', '#FFB74D', 0, ?)`,
      [Date.now()]
    );
  }
}

// ===== 记录 CRUD =====

// 新增一笔记录
export async function addRecord(
  amount: number,
  category: string,
  type: RecordType,
  date: string,
  note: string,
  accountId: number,
  reimbursable = false
): Promise<LedgerRecord> {
  const database = await getDB();
  const timestamp = Date.now();
  const result = await database.runAsync(
    `INSERT INTO ledger_records (amount, category, type, note, date, timestamp, account_id, reimbursable)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [amount, category, type, note, date, timestamp, accountId, reimbursable ? 1 : 0]
  );
  return {
    id: result.lastInsertRowId,
    amount,
    category,
    type,
    note,
    date,
    timestamp,
    accountId,
    reimbursable,
    reimbursed: false,
  };
}

// 删除一笔记录
export async function deleteRecord(id: number): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM ledger_records WHERE id = ?', [id]);
}

// 更新报销状态
export async function setReimbursed(id: number, reimbursed: boolean): Promise<void> {
  const database = await getDB();
  await database.runAsync('UPDATE ledger_records SET reimbursed = ? WHERE id = ?', [
    reimbursed ? 1 : 0,
    id,
  ]);
}

// 查询记录（统一行 → 实体转换）
function mapRecord(r: Record<string, unknown>): LedgerRecord {
  return {
    id: Number(r.id),
    amount: Number(r.amount),
    category: String(r.category),
    type: (r.type as RecordType) ?? 'expense',
    note: String(r.note ?? ''),
    date: String(r.date),
    timestamp: Number(r.timestamp),
    accountId: Number(r.account_id ?? 1),
    reimbursable: Number(r.reimbursable ?? 0) === 1,
    reimbursed: Number(r.reimbursed ?? 0) === 1,
  };
}

// 按日期区间查询（含边界，按时间倒序）
export async function getRecordsByRange(start: string, end: string): Promise<LedgerRecord[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM ledger_records WHERE date >= ? AND date <= ? ORDER BY date DESC, timestamp DESC',
    [start, end]
  );
  return rows.map(mapRecord);
}

// 查询某天的记录
export async function getRecordsByDate(date: string): Promise<LedgerRecord[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM ledger_records WHERE date = ? ORDER BY timestamp DESC',
    [date]
  );
  return rows.map(mapRecord);
}

// 查询全部记录（用于导出）
export async function getAllRecords(): Promise<LedgerRecord[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM ledger_records ORDER BY date DESC, timestamp DESC'
  );
  return rows.map(mapRecord);
}

// 获取记录总数
export async function getTotalCount(): Promise<number> {
  const database = await getDB();
  const row = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM ledger_records'
  );
  return row?.count ?? 0;
}

// 日期区间收支汇总
export async function getRangeSummary(start: string, end: string): Promise<{ expense: number; income: number }> {
  const database = await getDB();
  const rows = await database.getAllAsync<{ type: RecordType; total: number }>(
    'SELECT type, SUM(amount) as total FROM ledger_records WHERE date >= ? AND date <= ? GROUP BY type',
    [start, end]
  );
  let expense = 0;
  let income = 0;
  for (const r of rows) {
    if (r.type === 'expense') expense = r.total;
    else income = r.total;
  }
  return { expense, income };
}

// 按天汇总（热力图/趋势图用）
export async function getDaySummaries(start: string, end: string): Promise<DaySummary[]> {
  const database = await getDB();
  return database.getAllAsync<DaySummary>(
    `SELECT date,
            COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense,
            COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income
     FROM ledger_records
     WHERE date >= ? AND date <= ?
     GROUP BY date
     ORDER BY date ASC`,
    [start, end]
  );
}

// 按分类汇总（饼图用）
export async function getCategorySummary(
  start: string,
  end: string,
  type: RecordType
): Promise<{ category: string; total: number }[]> {
  const database = await getDB();
  return database.getAllAsync<{ category: string; total: number }>(
    `SELECT category, SUM(amount) as total FROM ledger_records
     WHERE date >= ? AND date <= ? AND type = ?
     GROUP BY category ORDER BY total DESC`,
    [start, end, type]
  );
}

// 当月最大单日支出（热力图分级用）
export async function getMaxDailyExpense(start: string, end: string): Promise<number> {
  const database = await getDB();
  const row = await database.getFirstAsync<{ max: number }>(
    `SELECT MAX(daily) as max FROM (
       SELECT SUM(amount) as daily FROM ledger_records
       WHERE date >= ? AND date <= ? AND type = 'expense'
       GROUP BY date
     )`,
    [start, end]
  );
  return row?.max ?? 0;
}

// ===== 账户 =====

// 获取全部账户（含计算余额）
export async function getAccounts(): Promise<AccountBalance[]> {
  const database = await getDB();
  const accounts = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM accounts ORDER BY id ASC'
  );
  const balances = await database.getAllAsync<Record<string, unknown>>(
    `SELECT account_id as aid,
            COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) as flow
     FROM ledger_records GROUP BY account_id`
  );
  const transfers = await database.getAllAsync<Record<string, unknown>>(
    `SELECT from_account_id as fid, to_account_id as tid,
            COALESCE(SUM(amount), 0) as total
     FROM transfers GROUP BY from_account_id, to_account_id`
  );
  // 转出/转入汇总
  const outMap: Record<number, number> = {};
  const inMap: Record<number, number> = {};
  for (const t of transfers) {
    const fid = Number(t.fid);
    const tid = Number(t.tid);
    outMap[fid] = (outMap[fid] ?? 0) + Number(t.total);
    inMap[tid] = (inMap[tid] ?? 0) + Number(t.total);
  }
  const flowMap: Record<number, number> = {};
  for (const b of balances) {
    flowMap[Number(b.aid)] = Number(b.flow);
  }
  return accounts.map((a) => {
    const id = Number(a.id);
    const balance = Number(a.initial_balance ?? 0) + (flowMap[id] ?? 0) + (inMap[id] ?? 0) - (outMap[id] ?? 0);
    return {
      id,
      name: String(a.name),
      type: (a.type as Account['type']) ?? 'cash',
      emoji: String(a.emoji ?? '💵'),
      color: String(a.color ?? '#90A4AE'),
      initialBalance: Number(a.initial_balance ?? 0),
      createdAt: Number(a.created_at),
      balance,
    };
  });
}

export async function getAccount(id: number): Promise<AccountBalance | null> {
  const accounts = await getAccounts();
  return accounts.find((a) => a.id === id) ?? null;
}

export async function addAccount(
  name: string,
  type: Account['type'],
  emoji: string,
  color: string,
  initialBalance: number
): Promise<Account> {
  const database = await getDB();
  const result = await database.runAsync(
    `INSERT INTO accounts (name, type, emoji, color, initial_balance, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, type, emoji, color, initialBalance, Date.now()]
  );
  return { id: result.lastInsertRowId, name, type, emoji, color, initialBalance, createdAt: Date.now() };
}

export async function deleteAccount(id: number): Promise<void> {
  if (id === 1) throw new Error('默认账户不可删除');
  const database = await getDB();
  // 该账户的历史记录归入默认账户，转账记录删除
  await database.withTransactionAsync(async () => {
    await database.runAsync('UPDATE ledger_records SET account_id = 1 WHERE account_id = ?', [id]);
    await database.runAsync('DELETE FROM transfers WHERE from_account_id = ? OR to_account_id = ?', [id, id]);
    await database.runAsync('DELETE FROM accounts WHERE id = ?', [id]);
  });
}

// ===== 转账 =====

export async function addTransfer(
  fromAccountId: number,
  toAccountId: number,
  amount: number,
  date: string,
  note: string
): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    `INSERT INTO transfers (from_account_id, to_account_id, amount, date, note, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [fromAccountId, toAccountId, amount, date, note, Date.now()]
  );
}

export async function getTransfersByDate(date: string): Promise<Transfer[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM transfers WHERE date = ? ORDER BY timestamp DESC',
    [date]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    fromAccountId: Number(r.from_account_id),
    toAccountId: Number(r.to_account_id),
    amount: Number(r.amount),
    date: String(r.date),
    note: String(r.note ?? ''),
    timestamp: Number(r.timestamp),
  }));
}

export async function deleteTransfer(id: number): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM transfers WHERE id = ?', [id]);
}

// 按日期区间查询转账（start/end 为空字符串时查全部）
export async function getTransfersByDateSafe(start: string, end: string): Promise<Transfer[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    start
      ? 'SELECT * FROM transfers WHERE date >= ? AND date <= ? ORDER BY date DESC, timestamp DESC'
      : 'SELECT * FROM transfers ORDER BY date DESC, timestamp DESC',
    start ? [start, end] : []
  );
  return rows.map((r) => ({
    id: Number(r.id),
    fromAccountId: Number(r.from_account_id),
    toAccountId: Number(r.to_account_id),
    amount: Number(r.amount),
    date: String(r.date),
    note: String(r.note ?? ''),
    timestamp: Number(r.timestamp),
  }));
}

// ===== 周期记账 =====

export async function getRecurringRules(): Promise<RecurringRule[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM recurring_rules ORDER BY id ASC'
  );
  return rows.map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    amount: Number(r.amount),
    type: (r.type as RecordType) ?? 'expense',
    category: String(r.category),
    accountId: Number(r.account_id ?? 1),
    frequency: (r.frequency as RecurringRule['frequency']) ?? 'monthly',
    dayOfWeek: Number(r.day_of_week ?? 0),
    dayOfMonth: Number(r.day_of_month ?? 1),
    monthOfYear: Number(r.month_of_year ?? 1),
    note: String(r.note ?? ''),
    enabled: Number(r.enabled ?? 1) === 1,
    lastGenerated: String(r.last_generated ?? ''),
    createdAt: Number(r.created_at),
  }));
}

export async function addRecurringRule(rule: Omit<RecurringRule, 'id' | 'createdAt'>): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    `INSERT INTO recurring_rules
     (name, amount, type, category, account_id, frequency, day_of_week, day_of_month, month_of_year, note, enabled, last_generated, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      rule.name, rule.amount, rule.type, rule.category, rule.accountId, rule.frequency,
      rule.dayOfWeek, rule.dayOfMonth, rule.monthOfYear, rule.note, rule.enabled ? 1 : 0,
      rule.lastGenerated, Date.now(),
    ]
  );
}

export async function updateRecurringRule(rule: RecurringRule): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    `UPDATE recurring_rules SET
       name = ?, amount = ?, type = ?, category = ?, account_id = ?, frequency = ?,
       day_of_week = ?, day_of_month = ?, month_of_year = ?, note = ?, enabled = ?, last_generated = ?
     WHERE id = ?`,
    [
      rule.name, rule.amount, rule.type, rule.category, rule.accountId, rule.frequency,
      rule.dayOfWeek, rule.dayOfMonth, rule.monthOfYear, rule.note, rule.enabled ? 1 : 0,
      rule.lastGenerated, rule.id,
    ]
  );
}

export async function deleteRecurringRule(id: number): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM recurring_rules WHERE id = ?', [id]);
}

export async function setRecurringLastGenerated(id: number, date: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('UPDATE recurring_rules SET last_generated = ? WHERE id = ?', [date, id]);
}

// ===== 自定义分类 =====

export async function getCustomCategories(): Promise<CustomCategory[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM custom_categories ORDER BY created_at ASC'
  );
  return rows.map((r) => ({
    key: String(r.key),
    label: String(r.label),
    emoji: String(r.emoji ?? '📌'),
    color: String(r.color ?? '#90A4AE'),
    type: (r.type as RecordType) ?? 'expense',
    createdAt: Number(r.created_at),
  }));
}

export async function addCustomCategory(cat: Omit<CustomCategory, 'key' | 'createdAt'> & { key: string }): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    `INSERT INTO custom_categories (key, label, emoji, color, type, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [cat.key, cat.label, cat.emoji, cat.color, cat.type, Date.now()]
  );
}

export async function deleteCustomCategory(key: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM custom_categories WHERE key = ?', [key]);
}

// 从 DB 加载自定义分类到内存缓存（App 启动 / 分类变更后调用）
export async function setCustomCategoriesCache(): Promise<void> {
  const { setCustomCategories } = await import('../constants');
  const list = await getCustomCategories();
  setCustomCategories(list);
}

// ===== 报销 =====

// 待报销汇总（未核销）
export async function getReimbursableSummary(): Promise<{ total: number; count: number }> {
  const database = await getDB();
  const row = await database.getFirstAsync<{ total: number; count: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
     FROM ledger_records WHERE reimbursable = 1 AND reimbursed = 0`
  );
  return { total: row?.total ?? 0, count: row?.count ?? 0 };
}

// 待报销记录列表
export async function getReimbursableRecords(): Promise<LedgerRecord[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM ledger_records WHERE reimbursable = 1
     ORDER BY reimbursed ASC, date DESC, timestamp DESC`
  );
  return rows.map(mapRecord);
}

// 一键核销全部待报销
export async function markAllReimbursed(): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    `UPDATE ledger_records SET reimbursed = 1 WHERE reimbursable = 1 AND reimbursed = 0`
  );
}

// ===== 设置 =====

export async function getSetting(key: string): Promise<string | null> {
  const database = await getDB();
  const row = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

export async function saveSetting(key: string, value: string): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const database = await getDB();
  const rows = await database.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM app_settings'
  );
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// ===== 导入支持 =====

// 批量插入（合并策略）
export async function bulkInsertRecords(records: Omit<LedgerRecord, 'id'>[]): Promise<void> {
  const database = await getDB();
  await database.withTransactionAsync(async () => {
    for (const r of records) {
      await database.runAsync(
        `INSERT INTO ledger_records (amount, category, type, note, date, timestamp, account_id, reimbursable, reimbursed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.amount, r.category, r.type, r.note, r.date, r.timestamp, r.accountId ?? 1, r.reimbursable ? 1 : 0, r.reimbursed ? 1 : 0]
      );
    }
  });
}

// 全量替换（替换策略）
export async function replaceAllRecords(records: Omit<LedgerRecord, 'id'>[]): Promise<void> {
  const database = await getDB();
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM ledger_records');
    for (const r of records) {
      await database.runAsync(
        `INSERT INTO ledger_records (amount, category, type, note, date, timestamp, account_id, reimbursable, reimbursed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.amount, r.category, r.type, r.note, r.date, r.timestamp, r.accountId ?? 1, r.reimbursable ? 1 : 0, r.reimbursed ? 1 : 0]
      );
    }
  });
}

// 清空所有记录
export async function clearAllRecords(): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM ledger_records');
}
