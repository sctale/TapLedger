import * as SQLite from 'expo-sqlite';
import type {
  Account, AccountBalance, CustomCategory, DaySummary, LedgerRecord, RecurringRule,
  RecordType, Transfer,
} from '../types';
import { genUuid } from '../constants';

const DB_NAME = 'tapledger.db';

let db: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// 获取数据库实例（单例；同步引擎共用）
export async function getDB(): Promise<SQLite.SQLiteDatabase> {
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

// 初始化数据库表（含 v0.1 → v0.2 → v0.3 迁移）
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

  // ===== v0.2 → v0.3 迁移（同步字段：uuid / user_id / updated_at / deleted + 账户 uuid 关联）=====
  const syncCols: [string, string][] = [
    ['ledger_records', 'uuid'], ['ledger_records', 'user_id'], ['ledger_records', 'updated_at'], ['ledger_records', 'deleted'], ['ledger_records', 'account_uuid'],
    ['accounts', 'uuid'], ['accounts', 'updated_at'], ['accounts', 'deleted'],
    ['transfers', 'uuid'], ['transfers', 'updated_at'], ['transfers', 'deleted'], ['transfers', 'from_account_uuid'], ['transfers', 'to_account_uuid'],
    ['recurring_rules', 'uuid'], ['recurring_rules', 'user_id'], ['recurring_rules', 'updated_at'], ['recurring_rules', 'deleted'], ['recurring_rules', 'account_uuid'],
    ['custom_categories', 'uuid'], ['custom_categories', 'updated_at'], ['custom_categories', 'deleted'],
  ];
  for (const [table, col] of syncCols) {
    if (!(await hasColumn(database, table, col))) {
      const isText = col === 'uuid' || col === 'account_uuid' || col === 'from_account_uuid' || col === 'to_account_uuid';
      const defaultVal = isText ? `''` : '0';
      await database.execAsync(`ALTER TABLE ${table} ADD COLUMN ${col} ${isText ? 'TEXT' : 'INTEGER'} NOT NULL DEFAULT ${defaultVal}`);
    }
  }
  // 旧数据回填：uuid 用 SQLite randomblob 生成（幂等：仅填空值行）；关联 uuid 按本地 id 映射
  await database.execAsync(`
    UPDATE ledger_records SET uuid = 'mig-' || lower(hex(randomblob(8))), updated_at = timestamp WHERE uuid = '';
    UPDATE accounts SET uuid = 'miga-' || lower(hex(randomblob(8))), updated_at = created_at WHERE uuid = '';
    UPDATE transfers SET uuid = 'migt-' || lower(hex(randomblob(8))), updated_at = timestamp WHERE uuid = '';
    UPDATE recurring_rules SET uuid = 'migr-' || lower(hex(randomblob(8))), updated_at = created_at WHERE uuid = '';
    UPDATE custom_categories SET uuid = 'migc-' || lower(hex(randomblob(8))), updated_at = created_at WHERE uuid = '';
    UPDATE ledger_records SET account_uuid = COALESCE((SELECT uuid FROM accounts WHERE accounts.id = ledger_records.account_id), '') WHERE account_uuid = '';
    UPDATE transfers SET
      from_account_uuid = COALESCE((SELECT uuid FROM accounts WHERE accounts.id = transfers.from_account_id), ''),
      to_account_uuid = COALESCE((SELECT uuid FROM accounts WHERE accounts.id = transfers.to_account_id), '')
    WHERE from_account_uuid = '' OR to_account_uuid = '';
    UPDATE recurring_rules SET account_uuid = COALESCE((SELECT uuid FROM accounts WHERE accounts.id = recurring_rules.account_id), '') WHERE account_uuid = '';
  `);
  // 账户 uuid 索引（同步 upsert 查询用）
  await database.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_records_uuid ON ledger_records(uuid);
    CREATE INDEX IF NOT EXISTS idx_records_updated ON ledger_records(updated_at);
    CREATE INDEX IF NOT EXISTS idx_accounts_uuid ON accounts(uuid);
    CREATE INDEX IF NOT EXISTS idx_accounts_updated ON accounts(updated_at);
    CREATE INDEX IF NOT EXISTS idx_transfers_uuid ON transfers(uuid);
    CREATE INDEX IF NOT EXISTS idx_transfers_updated ON transfers(updated_at);
    CREATE INDEX IF NOT EXISTS idx_recurring_uuid ON recurring_rules(uuid);
    CREATE INDEX IF NOT EXISTS idx_recurring_updated ON recurring_rules(updated_at);
    CREATE INDEX IF NOT EXISTS idx_custom_cats_uuid ON custom_categories(uuid);
  `);

  // 3) 确保默认账户"现金"存在
  const cash = await database.getFirstAsync<{ id: number }>(
    'SELECT id FROM accounts WHERE id = 1'
  );
  if (!cash) {
    await database.runAsync(
      `INSERT INTO accounts (id, name, type, emoji, color, initial_balance, created_at, uuid, updated_at)
       VALUES (1, '现金', 'cash', '💵', '#FFB74D', 0, ?, ?, ?)`,
      [Date.now(), genUuid(), Date.now()]
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
  reimbursable = false,
  opts?: { userId?: number; accountUuid?: string; uuid?: string; timestamp?: number; updatedAt?: number }
): Promise<LedgerRecord> {
  const database = await getDB();
  const timestamp = opts?.timestamp ?? Date.now();
  const updatedAt = opts?.updatedAt ?? timestamp;
  const uuid = opts?.uuid ?? genUuid();
  // 查账户 uuid（未显式给出时）
  let accountUuid = opts?.accountUuid ?? '';
  if (!accountUuid) {
    const acc = await database.getFirstAsync<{ uuid: string }>('SELECT uuid FROM accounts WHERE id = ?', [accountId]);
    accountUuid = acc?.uuid ?? '';
  }
  const result = await database.runAsync(
    `INSERT INTO ledger_records (amount, category, type, note, date, timestamp, account_id, reimbursable, uuid, user_id, updated_at, deleted, account_uuid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [amount, category, type, note, date, timestamp, accountId, reimbursable ? 1 : 0, uuid, opts?.userId ?? 0, updatedAt, accountUuid]
  );
  return {
    id: result.lastInsertRowId,
    uuid,
    userId: opts?.userId ?? 0,
    amount,
    category,
    type,
    note,
    date,
    timestamp,
    accountId,
    accountUuid,
    reimbursable,
    reimbursed: false,
    updatedAt,
    deleted: false,
  };
}

// 删除一笔记录（墓碑软删除，同步后全家一致）
export async function deleteRecord(id: number): Promise<void> {
  const database = await getDB();
  await database.runAsync('UPDATE ledger_records SET deleted = 1, updated_at = ? WHERE id = ?', [Date.now(), id]);
}

// 更新报销状态
export async function setReimbursed(id: number, reimbursed: boolean): Promise<void> {
  const database = await getDB();
  await database.runAsync('UPDATE ledger_records SET reimbursed = ?, updated_at = ? WHERE id = ?', [
    reimbursed ? 1 : 0,
    Date.now(),
    id,
  ]);
}

// 查询记录（统一行 → 实体转换）
function mapRecord(r: Record<string, unknown>): LedgerRecord {
  return {
    id: Number(r.id),
    uuid: String(r.uuid ?? ''),
    userId: Number(r.user_id ?? 0),
    amount: Number(r.amount),
    category: String(r.category),
    type: (r.type as RecordType) ?? 'expense',
    note: String(r.note ?? ''),
    date: String(r.date),
    timestamp: Number(r.timestamp),
    accountId: Number(r.account_id ?? 1),
    accountUuid: String(r.account_uuid ?? ''),
    reimbursable: Number(r.reimbursable ?? 0) === 1,
    reimbursed: Number(r.reimbursed ?? 0) === 1,
    updatedAt: Number(r.updated_at ?? 0),
    deleted: Number(r.deleted ?? 0) === 1,
  };
}

// 按日期区间查询（含边界，按时间倒序，过滤墓碑）
export async function getRecordsByRange(start: string, end: string): Promise<LedgerRecord[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM ledger_records WHERE deleted = 0 AND date >= ? AND date <= ? ORDER BY date DESC, timestamp DESC',
    [start, end]
  );
  return rows.map(mapRecord);
}

// 查询某天的记录
export async function getRecordsByDate(date: string): Promise<LedgerRecord[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM ledger_records WHERE deleted = 0 AND date = ? ORDER BY timestamp DESC',
    [date]
  );
  return rows.map(mapRecord);
}

// 查询全部记录（用于导出）
export async function getAllRecords(): Promise<LedgerRecord[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM ledger_records WHERE deleted = 0 ORDER BY date DESC, timestamp DESC'
  );
  return rows.map(mapRecord);
}

// 获取记录总数
export async function getTotalCount(): Promise<number> {
  const database = await getDB();
  const row = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM ledger_records WHERE deleted = 0'
  );
  return row?.count ?? 0;
}

// 日期区间收支汇总
export async function getRangeSummary(start: string, end: string): Promise<{ expense: number; income: number }> {
  const database = await getDB();
  const rows = await database.getAllAsync<{ type: RecordType; total: number }>(
    'SELECT type, SUM(amount) as total FROM ledger_records WHERE deleted = 0 AND date >= ? AND date <= ? GROUP BY type',
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
     WHERE deleted = 0 AND date >= ? AND date <= ?
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
     WHERE deleted = 0 AND date >= ? AND date <= ? AND type = ?
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
       WHERE deleted = 0 AND date >= ? AND date <= ? AND type = 'expense'
       GROUP BY date
     )`,
    [start, end]
  );
  return row?.max ?? 0;
}

// ===== 账户 =====

// 获取全部账户（含计算余额，过滤墓碑）
export async function getAccounts(): Promise<AccountBalance[]> {
  const database = await getDB();
  const accounts = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM accounts WHERE deleted = 0 ORDER BY id ASC'
  );
  const balances = await database.getAllAsync<Record<string, unknown>>(
    `SELECT account_id as aid,
            COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) as flow
     FROM ledger_records WHERE deleted = 0 GROUP BY account_id`
  );
  const transfers = await database.getAllAsync<Record<string, unknown>>(
    `SELECT from_account_id as fid, to_account_id as tid,
            COALESCE(SUM(amount), 0) as total
     FROM transfers WHERE deleted = 0 GROUP BY from_account_id, to_account_id`
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
      uuid: String(a.uuid ?? ''),
      name: String(a.name),
      type: (a.type as Account['type']) ?? 'cash',
      emoji: String(a.emoji ?? '💵'),
      color: String(a.color ?? '#90A4AE'),
      initialBalance: Number(a.initial_balance ?? 0),
      createdAt: Number(a.created_at),
      updatedAt: Number(a.updated_at ?? 0),
      deleted: Number(a.deleted ?? 0) === 1,
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
  initialBalance: number,
  opts?: { uuid?: string; updatedAt?: number }
): Promise<Account> {
  const database = await getDB();
  const uuid = opts?.uuid ?? genUuid();
  const updatedAt = opts?.updatedAt ?? Date.now();
  const result = await database.runAsync(
    `INSERT INTO accounts (name, type, emoji, color, initial_balance, created_at, uuid, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, type, emoji, color, initialBalance, Date.now(), uuid, updatedAt]
  );
  return {
    id: result.lastInsertRowId, uuid, name, type, emoji, color, initialBalance,
    createdAt: Date.now(), updatedAt, deleted: false,
  };
}

export async function deleteAccount(id: number): Promise<void> {
  if (id === 1) throw new Error('默认账户不可删除');
  const database = await getDB();
  const now = Date.now();
  // 该账户的历史记录归入默认账户，转账记录墓碑删除，账户本身墓碑删除
  await database.withTransactionAsync(async () => {
    // 记录迁移到默认账户（同时刷新 account_uuid + updated_at 以便同步）
    await database.runAsync(
      `UPDATE ledger_records SET account_id = 1, account_uuid = (SELECT uuid FROM accounts WHERE id = 1), updated_at = ?
       WHERE account_id = ? AND deleted = 0`,
      [now, id]
    );
    await database.runAsync(
      'UPDATE transfers SET deleted = 1, updated_at = ? WHERE (from_account_id = ? OR to_account_id = ?) AND deleted = 0',
      [now, id, id]
    );
    await database.runAsync('UPDATE accounts SET deleted = 1, updated_at = ? WHERE id = ?', [now, id]);
  });
}

// ===== 转账 =====

export async function addTransfer(
  fromAccountId: number,
  toAccountId: number,
  amount: number,
  date: string,
  note: string,
  opts?: { uuid?: string; updatedAt?: number; fromAccountUuid?: string; toAccountUuid?: string }
): Promise<void> {
  const database = await getDB();
  const uuid = opts?.uuid ?? genUuid();
  const updatedAt = Number(opts?.updatedAt ?? Date.now());
  // 解析账户 uuid
  let fromAccountUuid = opts?.fromAccountUuid ?? '';
  let toAccountUuid = opts?.toAccountUuid ?? '';
  if (!fromAccountUuid || !toAccountUuid) {
    const rows = await database.getAllAsync<{ id: number; uuid: string }>(
      'SELECT id, uuid FROM accounts WHERE id IN (?, ?)', [fromAccountId, toAccountId]
    );
    const map: Record<number, string> = {};
    for (const r of rows) map[r.id] = r.uuid;
    fromAccountUuid = fromAccountUuid || map[fromAccountId] || '';
    toAccountUuid = toAccountUuid || map[toAccountId] || '';
  }
  await database.runAsync(
    `INSERT INTO transfers (from_account_id, to_account_id, amount, date, note, timestamp, uuid, updated_at, deleted, from_account_uuid, to_account_uuid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [fromAccountId, toAccountId, amount, date, note, Date.now(), uuid, updatedAt, fromAccountUuid, toAccountUuid]
  );
}

function mapTransfer(r: Record<string, unknown>): Transfer {
  return {
    id: Number(r.id),
    uuid: String(r.uuid ?? ''),
    fromAccountId: Number(r.from_account_id),
    toAccountId: Number(r.to_account_id),
    fromAccountUuid: String(r.from_account_uuid ?? ''),
    toAccountUuid: String(r.to_account_uuid ?? ''),
    amount: Number(r.amount),
    date: String(r.date),
    note: String(r.note ?? ''),
    timestamp: Number(r.timestamp),
    updatedAt: Number(r.updated_at ?? 0),
    deleted: Number(r.deleted ?? 0) === 1,
  };
}

export async function getTransfersByDate(date: string): Promise<Transfer[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM transfers WHERE deleted = 0 AND date = ? ORDER BY timestamp DESC',
    [date]
  );
  return rows.map(mapTransfer);
}

// 删除转账（墓碑）
export async function deleteTransfer(id: number): Promise<void> {
  const database = await getDB();
  await database.runAsync('UPDATE transfers SET deleted = 1, updated_at = ? WHERE id = ?', [Date.now(), id]);
}

// 按日期区间查询转账（start/end 为空字符串时查全部）
export async function getTransfersByDateSafe(start: string, end: string): Promise<Transfer[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    start
      ? 'SELECT * FROM transfers WHERE deleted = 0 AND date >= ? AND date <= ? ORDER BY date DESC, timestamp DESC'
      : 'SELECT * FROM transfers WHERE deleted = 0 ORDER BY date DESC, timestamp DESC',
    start ? [start, end] : []
  );
  return rows.map(mapTransfer);
}

// ===== 周期记账 =====

function mapRule(r: Record<string, unknown>): RecurringRule {
  return {
    id: Number(r.id),
    uuid: String(r.uuid ?? ''),
    userId: Number(r.user_id ?? 0),
    name: String(r.name),
    amount: Number(r.amount),
    type: (r.type as RecordType) ?? 'expense',
    category: String(r.category),
    accountId: Number(r.account_id ?? 1),
    accountUuid: String(r.account_uuid ?? ''),
    frequency: (r.frequency as RecurringRule['frequency']) ?? 'monthly',
    dayOfWeek: Number(r.day_of_week ?? 0),
    dayOfMonth: Number(r.day_of_month ?? 1),
    monthOfYear: Number(r.month_of_year ?? 1),
    note: String(r.note ?? ''),
    enabled: Number(r.enabled ?? 1) === 1,
    lastGenerated: String(r.last_generated ?? ''),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at ?? 0),
    deleted: Number(r.deleted ?? 0) === 1,
  };
}

export async function getRecurringRules(): Promise<RecurringRule[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM recurring_rules WHERE deleted = 0 ORDER BY id ASC'
  );
  return rows.map(mapRule);
}

// 周期规则创建入参（同步字段可选，本地新建自动生成）
export interface RecurringRuleInput {
  name: string;
  amount: number;
  type: RecordType;
  category: string;
  accountId: number;
  frequency: RecurringRule['frequency'];
  dayOfWeek: number;
  dayOfMonth: number;
  monthOfYear: number;
  note: string;
  enabled: boolean;
  lastGenerated: string;
  userId?: number;
  accountUuid?: string;
  uuid?: string;
  updatedAt?: number;
}

export async function addRecurringRule(rule: RecurringRuleInput): Promise<void> {
  const database = await getDB();
  const uuid = rule.uuid ?? genUuid();
  const updatedAt = rule.updatedAt ?? Date.now();
  let accountUuid = rule.accountUuid ?? '';
  if (!accountUuid) {
    const acc = await database.getFirstAsync<{ uuid: string }>('SELECT uuid FROM accounts WHERE id = ?', [rule.accountId]);
    accountUuid = acc?.uuid ?? '';
  }
  await database.runAsync(
    `INSERT INTO recurring_rules
     (name, amount, type, category, account_id, frequency, day_of_week, day_of_month, month_of_year, note, enabled, last_generated, created_at, uuid, user_id, updated_at, deleted, account_uuid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      rule.name, rule.amount, rule.type, rule.category, rule.accountId, rule.frequency,
      rule.dayOfWeek, rule.dayOfMonth, rule.monthOfYear, rule.note, rule.enabled ? 1 : 0,
      rule.lastGenerated, Date.now(), uuid, rule.userId ?? 0, updatedAt, accountUuid,
    ]
  );
}

export async function updateRecurringRule(rule: RecurringRule): Promise<void> {
  const database = await getDB();
  let accountUuid = rule.accountUuid ?? '';
  if (!accountUuid) {
    const acc = await database.getFirstAsync<{ uuid: string }>('SELECT uuid FROM accounts WHERE id = ?', [rule.accountId]);
    accountUuid = acc?.uuid ?? '';
  }
  await database.runAsync(
    `UPDATE recurring_rules SET
       name = ?, amount = ?, type = ?, category = ?, account_id = ?, frequency = ?,
       day_of_week = ?, day_of_month = ?, month_of_year = ?, note = ?, enabled = ?, last_generated = ?, updated_at = ?, account_uuid = ?
     WHERE id = ?`,
    [
      rule.name, rule.amount, rule.type, rule.category, rule.accountId, rule.frequency,
      rule.dayOfWeek, rule.dayOfMonth, rule.monthOfYear, rule.note, rule.enabled ? 1 : 0,
      rule.lastGenerated, Date.now(), accountUuid, rule.id,
    ]
  );
}

export async function deleteRecurringRule(id: number): Promise<void> {
  const database = await getDB();
  await database.runAsync('UPDATE recurring_rules SET deleted = 1, updated_at = ? WHERE id = ?', [Date.now(), id]);
}

export async function setRecurringLastGenerated(id: number, date: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('UPDATE recurring_rules SET last_generated = ? WHERE id = ?', [date, id]);
}

// ===== 自定义分类 =====

export async function getCustomCategories(): Promise<CustomCategory[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM custom_categories WHERE deleted = 0 ORDER BY created_at ASC'
  );
  return rows.map((r) => ({
    key: String(r.key),
    uuid: String(r.uuid ?? ''),
    label: String(r.label),
    emoji: String(r.emoji ?? '📌'),
    color: String(r.color ?? '#90A4AE'),
    type: (r.type as RecordType) ?? 'expense',
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at ?? 0),
    deleted: Number(r.deleted ?? 0) === 1,
  }));
}

// 自定义分类创建入参（同步字段可选）
export async function addCustomCategory(
  cat: { key: string; label: string; emoji: string; color: string; type: RecordType; uuid?: string; updatedAt?: number }
): Promise<void> {
  const database = await getDB();
  const uuid = cat.uuid ?? genUuid();
  const updatedAt = cat.updatedAt ?? Date.now();
  await database.runAsync(
    `INSERT INTO custom_categories (key, label, emoji, color, type, created_at, uuid, updated_at, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [cat.key, cat.label, cat.emoji, cat.color, cat.type, Date.now(), uuid, updatedAt]
  );
}

export async function deleteCustomCategory(key: string): Promise<void> {
  const database = await getDB();
  await database.runAsync('UPDATE custom_categories SET deleted = 1, updated_at = ? WHERE key = ?', [Date.now(), key]);
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
     FROM ledger_records WHERE deleted = 0 AND reimbursable = 1 AND reimbursed = 0`
  );
  return { total: row?.total ?? 0, count: row?.count ?? 0 };
}

// 待报销记录列表
export async function getReimbursableRecords(): Promise<LedgerRecord[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM ledger_records WHERE deleted = 0 AND reimbursable = 1
     ORDER BY reimbursed ASC, date DESC, timestamp DESC`
  );
  return rows.map(mapRecord);
}

// 一键核销全部待报销
export async function markAllReimbursed(): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    `UPDATE ledger_records SET reimbursed = 1, updated_at = ? WHERE deleted = 0 AND reimbursable = 1 AND reimbursed = 0`,
    [Date.now()]
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
        `INSERT INTO ledger_records (amount, category, type, note, date, timestamp, account_id, reimbursable, reimbursed, uuid, user_id, updated_at, deleted, account_uuid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.amount, r.category, r.type, r.note, r.date, r.timestamp, r.accountId ?? 1, r.reimbursable ? 1 : 0, r.reimbursed ? 1 : 0,
         r.uuid || genUuid(), r.userId ?? 0, r.updatedAt || r.timestamp, r.deleted ? 1 : 0, r.accountUuid ?? '']
      );
    }
  });
}

// 全量替换（替换策略：硬删除本地 + 重插）
export async function replaceAllRecords(records: Omit<LedgerRecord, 'id'>[]): Promise<void> {
  const database = await getDB();
  await database.withTransactionAsync(async () => {
    await database.runAsync('DELETE FROM ledger_records');
    for (const r of records) {
      await database.runAsync(
        `INSERT INTO ledger_records (amount, category, type, note, date, timestamp, account_id, reimbursable, reimbursed, uuid, user_id, updated_at, deleted, account_uuid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.amount, r.category, r.type, r.note, r.date, r.timestamp, r.accountId ?? 1, r.reimbursable ? 1 : 0, r.reimbursed ? 1 : 0,
         r.uuid || genUuid(), r.userId ?? 0, r.updatedAt || r.timestamp, r.deleted ? 1 : 0, r.accountUuid ?? '']
      );
    }
  });
}

// 清空所有记录（硬删，导入替换用）
export async function clearAllRecords(): Promise<void> {
  const database = await getDB();
  await database.runAsync('DELETE FROM ledger_records');
}
