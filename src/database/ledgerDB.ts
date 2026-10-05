import * as SQLite from 'expo-sqlite';
import type {
  CategoryConfig, CustomCategory, DaySummary, LedgerRecord, RecurringRule, RecordType,
} from '../types';
import { genUuid, SETTING_KEYS } from '../constants';

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

// 幂等补列：列不存在时才执行 ALTER（老库升级用；新库建表时已含该列）
async function ensureColumn(
  database: SQLite.SQLiteDatabase,
  table: string,
  column: string,
  alterSql: string
): Promise<void> {
  if (!(await hasColumn(database, table, column))) {
    await database.execAsync(alterSql);
  }
}

// ===== 活动账本作用域（个人 / 家庭本地隔离）=====
// 0 = 本地未归属任何同步账本（未登录 / 未同步），此时只读写 ledger_id=0 的本地数据。
// 登录后同步会解析出真实账本 id 并 setActiveLedgerId，此后所有读写/推送/拉取都限定到该账本，
// 避免同一台设备在个人账本与家庭账本之间切换时互相串数据。
let activeLedgerId = 0;

export function setActiveLedgerId(id: number): void {
  activeLedgerId = id;
}

export function getActiveLedgerId(): number {
  return activeLedgerId;
}

// 把本地未归属（ledger_id=0）的数据一次性并入指定账本（登录/首同步认领本地存量，幂等）
export async function adoptUnassignedRowsIntoLedger(ledgerId: number): Promise<void> {
  if (ledgerId <= 0) return;
  const database = await getDB();
  await database.runAsync('UPDATE ledger_records SET ledger_id = ? WHERE ledger_id = 0', [ledgerId]);
  await database.runAsync('UPDATE recurring_rules SET ledger_id = ? WHERE ledger_id = 0', [ledgerId]);
  await database.runAsync('UPDATE custom_categories SET ledger_id = ? WHERE ledger_id = 0', [ledgerId]);
}

// ===== 老库主键迁移：custom_categories 主键 key → (key, ledger_id) =====
// SQLite 不能 ALTER 主键，只能重建表搬数据。检测依据是当前主键列集合，
// 因此重复执行安全（迁移完 pk 就是 key,ledger_id，直接返回）。
async function migrateCustomCategoryPrimaryKey(database: SQLite.SQLiteDatabase): Promise<void> {
  const cols = await database.getAllAsync<{ name: string; pk: number }>('PRAGMA table_info(custom_categories)');
  const pkCols = cols.filter((c) => c.pk > 0).map((c) => c.name).sort().join(',');
  if (pkCols === 'key,ledger_id') return;
  await database.execAsync(`
    BEGIN;
    CREATE TABLE custom_categories__pk_new (
      key TEXT NOT NULL,
      uuid TEXT NOT NULL DEFAULT '',
      ledger_id INTEGER NOT NULL DEFAULT 0,
      label TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📌',
      color TEXT NOT NULL DEFAULT '#90A4AE',
      type TEXT NOT NULL DEFAULT 'expense',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (key, ledger_id)
    );
    INSERT INTO custom_categories__pk_new (key, uuid, ledger_id, label, emoji, color, type, created_at, updated_at, deleted)
      SELECT key, uuid, ledger_id, label, emoji, color, type, created_at, updated_at, deleted FROM custom_categories;
    DROP TABLE custom_categories;
    ALTER TABLE custom_categories__pk_new RENAME TO custom_categories;
    COMMIT;
  `);
}

// 初始化数据库表（新库建表含全部同步字段 + ledger_id；老库靠 ensureColumn 幂等补列）
export async function initDatabase(): Promise<void> {
  const database = await getDB();

  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS ledger_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL DEFAULT '',
      user_id INTEGER NOT NULL DEFAULT 0,
      ledger_id INTEGER NOT NULL DEFAULT 0,
      amount REAL NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'expense' CHECK(type IN ('expense', 'income')),
      note TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      reimbursable INTEGER NOT NULL DEFAULT 0,
      reimbursed INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recurring_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL DEFAULT '',
      user_id INTEGER NOT NULL DEFAULT 0,
      ledger_id INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL DEFAULT 'expense',
      category TEXT NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'monthly',
      day_of_week INTEGER NOT NULL DEFAULT 0,
      day_of_month INTEGER NOT NULL DEFAULT 1,
      month_of_year INTEGER NOT NULL DEFAULT 1,
      note TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      last_generated TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS custom_categories (
      key TEXT NOT NULL,
      uuid TEXT NOT NULL DEFAULT '',
      ledger_id INTEGER NOT NULL DEFAULT 0,
      label TEXT NOT NULL,
      emoji TEXT NOT NULL DEFAULT '📌',
      color TEXT NOT NULL DEFAULT '#90A4AE',
      type TEXT NOT NULL DEFAULT 'expense',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      -- 同一台设备上个人账本与家庭账本并存，key 必须是「账本内」唯一；
      -- 单列主键会让两本账本的同名分类互相顶掉（导入同一份备份即触发）
      PRIMARY KEY (key, ledger_id)
    );
  `);

  // ===== 老库幂等补列（缺失才 ALTER；新库建表时已含）=====
  await ensureColumn(database, 'ledger_records', 'uuid', `ALTER TABLE ledger_records ADD COLUMN uuid TEXT NOT NULL DEFAULT ''`);
  await ensureColumn(database, 'ledger_records', 'user_id', `ALTER TABLE ledger_records ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0`);
  await ensureColumn(database, 'ledger_records', 'ledger_id', `ALTER TABLE ledger_records ADD COLUMN ledger_id INTEGER NOT NULL DEFAULT 0`);
  await ensureColumn(database, 'ledger_records', 'reimbursable', `ALTER TABLE ledger_records ADD COLUMN reimbursable INTEGER NOT NULL DEFAULT 0`);
  await ensureColumn(database, 'ledger_records', 'reimbursed', `ALTER TABLE ledger_records ADD COLUMN reimbursed INTEGER NOT NULL DEFAULT 0`);
  await ensureColumn(database, 'ledger_records', 'updated_at', `ALTER TABLE ledger_records ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`);
  await ensureColumn(database, 'ledger_records', 'deleted', `ALTER TABLE ledger_records ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`);
  await ensureColumn(database, 'recurring_rules', 'uuid', `ALTER TABLE recurring_rules ADD COLUMN uuid TEXT NOT NULL DEFAULT ''`);
  await ensureColumn(database, 'recurring_rules', 'user_id', `ALTER TABLE recurring_rules ADD COLUMN user_id INTEGER NOT NULL DEFAULT 0`);
  await ensureColumn(database, 'recurring_rules', 'ledger_id', `ALTER TABLE recurring_rules ADD COLUMN ledger_id INTEGER NOT NULL DEFAULT 0`);
  await ensureColumn(database, 'recurring_rules', 'updated_at', `ALTER TABLE recurring_rules ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`);
  await ensureColumn(database, 'recurring_rules', 'deleted', `ALTER TABLE recurring_rules ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`);
  await ensureColumn(database, 'custom_categories', 'uuid', `ALTER TABLE custom_categories ADD COLUMN uuid TEXT NOT NULL DEFAULT ''`);
  await ensureColumn(database, 'custom_categories', 'ledger_id', `ALTER TABLE custom_categories ADD COLUMN ledger_id INTEGER NOT NULL DEFAULT 0`);
  await ensureColumn(database, 'custom_categories', 'updated_at', `ALTER TABLE custom_categories ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0`);
  await ensureColumn(database, 'custom_categories', 'deleted', `ALTER TABLE custom_categories ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0`);

  // ===== 老库主键迁移（必须在补列之后、建索引之前：搬数据要列齐，重建会连索引一起丢）=====
  await migrateCustomCategoryPrimaryKey(database);

  // ===== 索引（幂等）=====
  await database.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_ledger_date ON ledger_records(date);
    CREATE INDEX IF NOT EXISTS idx_ledger_type ON ledger_records(type);
    CREATE INDEX IF NOT EXISTS idx_records_uuid ON ledger_records(uuid);
    CREATE INDEX IF NOT EXISTS idx_records_updated ON ledger_records(updated_at);
    CREATE INDEX IF NOT EXISTS idx_records_scope ON ledger_records(ledger_id, deleted);
    CREATE INDEX IF NOT EXISTS idx_recurring_uuid ON recurring_rules(uuid);
    CREATE INDEX IF NOT EXISTS idx_recurring_updated ON recurring_rules(updated_at);
    CREATE INDEX IF NOT EXISTS idx_recurring_scope ON recurring_rules(ledger_id, deleted);
    CREATE INDEX IF NOT EXISTS idx_custom_cats_uuid ON custom_categories(uuid);
    CREATE INDEX IF NOT EXISTS idx_custom_cats_scope ON custom_categories(ledger_id, deleted);
  `);

  // ===== 旧数据回填 uuid（幂等：仅填空值行）=====
  await database.execAsync(`
    UPDATE ledger_records SET uuid = 'mig-' || lower(hex(randomblob(8))), updated_at = timestamp WHERE uuid = '';
    UPDATE recurring_rules SET uuid = 'migr-' || lower(hex(randomblob(8))), updated_at = created_at WHERE uuid = '';
    UPDATE custom_categories SET uuid = 'migc-' || lower(hex(randomblob(8))), updated_at = created_at WHERE uuid = '';
  `);

  // ===== 恢复活动账本作用域（默认 0=本地未归属）=====
  const scopeRow = await database.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_settings WHERE key = ?',
    [SETTING_KEYS.SYNC_ACTIVE_LEDGER_ID]
  );
  activeLedgerId = Number(scopeRow?.value ?? '0') || 0;
}

// ===== 记录 CRUD =====

// 新增一笔记录（写入当前活动账本作用域 ledger_id）
export async function addRecord(
  amount: number,
  category: string,
  type: RecordType,
  date: string,
  note: string,
  reimbursable = false,
  opts?: { userId?: number; uuid?: string; timestamp?: number; updatedAt?: number }
): Promise<LedgerRecord> {
  const database = await getDB();
  const timestamp = opts?.timestamp ?? Date.now();
  const updatedAt = opts?.updatedAt ?? timestamp;
  const uuid = opts?.uuid ?? genUuid();
  const result = await database.runAsync(
    `INSERT INTO ledger_records (amount, category, type, note, date, timestamp, reimbursable, uuid, user_id, updated_at, deleted, ledger_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [amount, category, type, note, date, timestamp, reimbursable ? 1 : 0, uuid, opts?.userId ?? 0, updatedAt, activeLedgerId]
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

// 编辑一笔记录（明细页点击编辑用，v0.10）
// 整体覆盖可编辑字段 + updated_at 触发增量同步推送（LWW 全家最终一致）
export async function updateRecord(
  id: number,
  patch: {
    amount: number;
    category: string;
    type: RecordType;
    note: string;
    reimbursable: boolean;
  }
): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    `UPDATE ledger_records
     SET amount = ?, category = ?, type = ?, note = ?, reimbursable = ?, updated_at = ?
     WHERE id = ?`,
    [patch.amount, patch.category, patch.type, patch.note, patch.reimbursable ? 1 : 0, Date.now(), id]
  );
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
    'SELECT * FROM ledger_records WHERE deleted = 0 AND ledger_id = ? AND date >= ? AND date <= ? ORDER BY date DESC, timestamp DESC',
    [activeLedgerId, start, end]
  );
  return rows.map(mapRecord);
}

// 查询某天的记录
export async function getRecordsByDate(date: string): Promise<LedgerRecord[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM ledger_records WHERE deleted = 0 AND ledger_id = ? AND date = ? ORDER BY timestamp DESC',
    [activeLedgerId, date]
  );
  return rows.map(mapRecord);
}

// 查询全部记录（用于导出）
export async function getAllRecords(): Promise<LedgerRecord[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM ledger_records WHERE deleted = 0 AND ledger_id = ? ORDER BY date DESC, timestamp DESC',
    [activeLedgerId]
  );
  return rows.map(mapRecord);
}

// 获取记录总数
export async function getTotalCount(): Promise<number> {
  const database = await getDB();
  const row = await database.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM ledger_records WHERE deleted = 0 AND ledger_id = ?',
    [activeLedgerId]
  );
  return row?.count ?? 0;
}

// 日期区间收支汇总（userId > 0 时按记账人筛选，v0.5）
export async function getRangeSummary(
  start: string,
  end: string,
  userId = 0
): Promise<{ expense: number; income: number }> {
  const database = await getDB();
  const row = await database.getFirstAsync<{ expense: number; income: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN type = 'expense' AND reimbursable = 0 THEN amount ELSE 0 END), 0) as expense,
       COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income
     FROM ledger_records
     WHERE deleted = 0 AND ledger_id = ? AND date >= ? AND date <= ? ${userId > 0 ? 'AND user_id = ?' : ''}`,
    userId > 0 ? [activeLedgerId, start, end, userId] : [activeLedgerId, start, end]
  );
  return { expense: row?.expense ?? 0, income: row?.income ?? 0 };
}

// 按天汇总（热力图/趋势图用；userId > 0 时按记账人筛选，v0.5）
export async function getDaySummaries(start: string, end: string, userId = 0): Promise<DaySummary[]> {
  const database = await getDB();
  return database.getAllAsync<DaySummary>(
    `SELECT date,
            COALESCE(SUM(CASE WHEN type = 'expense' AND reimbursable = 0 THEN amount ELSE 0 END), 0) as expense,
            COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income
     FROM ledger_records
     WHERE deleted = 0 AND ledger_id = ? AND date >= ? AND date <= ? ${userId > 0 ? 'AND user_id = ?' : ''}
     GROUP BY date
     ORDER BY date ASC`,
    userId > 0 ? [activeLedgerId, start, end, userId] : [activeLedgerId, start, end]
  );
}

// 按分类汇总（饼图用；userId > 0 时按记账人筛选，v0.5）
export async function getCategorySummary(
  start: string,
  end: string,
  type: RecordType,
  userId = 0
): Promise<{ category: string; total: number }[]> {
  const database = await getDB();
  return database.getAllAsync<{ category: string; total: number }>(
    `SELECT category, SUM(amount) as total FROM ledger_records
     WHERE deleted = 0 AND ledger_id = ? AND date >= ? AND date <= ? AND type = ? ${type === 'expense' ? 'AND reimbursable = 0' : ''} ${userId > 0 ? 'AND user_id = ?' : ''}
     GROUP BY category ORDER BY total DESC`,
    userId > 0 ? [activeLedgerId, start, end, type, userId] : [activeLedgerId, start, end, type]
  );
}

// 按记账人汇总支出（成员排行用，v0.5；v0.10 增加笔数便于「谁花得多/花得勤」对比）
export async function getMemberExpenseSummary(
  start: string,
  end: string
): Promise<{ userId: number; total: number; count: number }[]> {
  const database = await getDB();
  return database.getAllAsync<{ userId: number; total: number; count: number }>(
    `SELECT user_id as userId, SUM(amount) as total, COUNT(*) as count FROM ledger_records
     WHERE deleted = 0 AND ledger_id = ? AND date >= ? AND date <= ? AND type = 'expense' AND reimbursable = 0
     GROUP BY user_id ORDER BY total DESC`,
    [activeLedgerId, start, end]
  );
}

// 当月最大单日支出（热力图分级用）
export async function getMaxDailyExpense(start: string, end: string): Promise<number> {
  const database = await getDB();
  const row = await database.getFirstAsync<{ max: number }>(
    `SELECT MAX(daily) as max FROM (
       SELECT SUM(amount) as daily FROM ledger_records
       WHERE deleted = 0 AND ledger_id = ? AND date >= ? AND date <= ? AND type = 'expense' AND reimbursable = 0
       GROUP BY date
     )`,
    [activeLedgerId, start, end]
  );
  return row?.max ?? 0;
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
    'SELECT * FROM recurring_rules WHERE deleted = 0 AND ledger_id = ? ORDER BY id ASC',
    [activeLedgerId]
  );
  return rows.map(mapRule);
}

// 周期规则创建入参（同步字段可选，本地新建自动生成）
export interface RecurringRuleInput {
  name: string;
  amount: number;
  type: RecordType;
  category: string;
  frequency: RecurringRule['frequency'];
  dayOfWeek: number;
  dayOfMonth: number;
  monthOfYear: number;
  note: string;
  enabled: boolean;
  lastGenerated: string;
  userId?: number;
  uuid?: string;
  updatedAt?: number;
}

export async function addRecurringRule(rule: RecurringRuleInput): Promise<void> {
  const database = await getDB();
  const uuid = rule.uuid ?? genUuid();
  const updatedAt = rule.updatedAt ?? Date.now();
  await database.runAsync(
    `INSERT INTO recurring_rules
     (name, amount, type, category, frequency, day_of_week, day_of_month, month_of_year, note, enabled, last_generated, created_at, uuid, user_id, updated_at, deleted, ledger_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [
      rule.name, rule.amount, rule.type, rule.category,
      rule.frequency, rule.dayOfWeek, rule.dayOfMonth, rule.monthOfYear, rule.note,
      rule.enabled ? 1 : 0, rule.lastGenerated, Date.now(), uuid, rule.userId ?? 0, updatedAt,
      activeLedgerId,
    ]
  );
}

export async function updateRecurringRule(rule: RecurringRule): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    `UPDATE recurring_rules SET
       name = ?, amount = ?, type = ?, category = ?, frequency = ?,
       day_of_week = ?, day_of_month = ?, month_of_year = ?, note = ?, enabled = ?, last_generated = ?, updated_at = ?
     WHERE id = ?`,
    [
      rule.name, rule.amount, rule.type, rule.category,
      rule.frequency, rule.dayOfWeek, rule.dayOfMonth, rule.monthOfYear, rule.note,
      rule.enabled ? 1 : 0, rule.lastGenerated, Date.now(), rule.id,
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
    'SELECT * FROM custom_categories WHERE deleted = 0 AND ledger_id = ? ORDER BY created_at ASC',
    [activeLedgerId]
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
// 同 (key, ledger_id) 已存在时按导入语义覆盖（同一本账本里的同名 key 就是同一个分类，
// 合并导入旧备份不该因此整条失败）；跨账本同 key 互不影响，正是主键改成复合的意义。
export async function addCustomCategory(
  cat: { key: string; label: string; emoji: string; color: string; type: RecordType; uuid?: string; updatedAt?: number }
): Promise<void> {
  const database = await getDB();
  const uuid = cat.uuid ?? genUuid();
  const updatedAt = cat.updatedAt ?? Date.now();
  await database.runAsync(
    `INSERT INTO custom_categories (key, label, emoji, color, type, created_at, uuid, updated_at, deleted, ledger_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(key, ledger_id) DO UPDATE SET
       label = excluded.label, emoji = excluded.emoji, color = excluded.color,
       type = excluded.type, uuid = excluded.uuid, updated_at = excluded.updated_at, deleted = 0`,
    [cat.key, cat.label, cat.emoji, cat.color, cat.type, Date.now(), uuid, updatedAt, activeLedgerId]
  );
}

export async function deleteCustomCategory(key: string): Promise<void> {
  const database = await getDB();
  // 必须限定账本：key 只在本账本内唯一，少了这个条件会把另一本账本的同 key 分类一起标删
  await database.runAsync(
    'UPDATE custom_categories SET deleted = 1, updated_at = ? WHERE key = ? AND ledger_id = ?',
    [Date.now(), key, activeLedgerId]
  );
}

export async function updateCustomCategory(
  cat: { key: string; label: string; emoji: string; color: string; type: RecordType; uuid?: string; updatedAt?: number }
): Promise<void> {
  const database = await getDB();
  const updatedAt = cat.updatedAt ?? Date.now();
  await database.runAsync(
    `UPDATE custom_categories
     SET label = ?, emoji = ?, color = ?, type = ?, updated_at = ?
     WHERE key = ? AND ledger_id = ?`,
    [cat.label, cat.emoji, cat.color, cat.type, updatedAt, cat.key, activeLedgerId]
  );
}

// 从 DB 加载自定义分类到内存缓存（App 启动 / 分类变更后调用）
export async function setCustomCategoriesCache(): Promise<void> {
  const { setCustomCategories } = await import('../constants');
  const list = await getCustomCategories();
  setCustomCategories(list);
}

// ===== 分类显隐/排序配置 =====

const CATEGORY_CONFIG_KEY = 'category_config_v1';

export async function getCategoryConfig(): Promise<CategoryConfig | null> {
  const raw = await getSetting(CATEGORY_CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CategoryConfig;
    if (!Array.isArray(parsed.expense) || !Array.isArray(parsed.income)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveCategoryConfig(config: CategoryConfig): Promise<void> {
  await saveSetting(CATEGORY_CONFIG_KEY, JSON.stringify(config));
}

// ===== 报销 =====
// 报销只对支出成立。此前三条 SQL 都没过滤 type，而首页切收支类型时不会重置待报销标记，
// 于是会产生「收入被标成待报销」的脏数据并虚增待报销总额（v0.11.8 两头一起堵）。

// 待报销汇总（未核销）
export async function getReimbursableSummary(): Promise<{ total: number; count: number }> {
  const database = await getDB();
  const row = await database.getFirstAsync<{ total: number; count: number }>(
    `SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count
     FROM ledger_records WHERE deleted = 0 AND ledger_id = ? AND type = 'expense' AND reimbursable = 1 AND reimbursed = 0`,
    [activeLedgerId]
  );
  return { total: row?.total ?? 0, count: row?.count ?? 0 };
}

// 待报销记录列表
export async function getReimbursableRecords(): Promise<LedgerRecord[]> {
  const database = await getDB();
  const rows = await database.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM ledger_records WHERE deleted = 0 AND ledger_id = ? AND type = 'expense' AND reimbursable = 1
     ORDER BY reimbursed ASC, date DESC, timestamp DESC`,
    [activeLedgerId]
  );
  return rows.map(mapRecord);
}

// 一键核销全部待报销
export async function markAllReimbursed(): Promise<void> {
  const database = await getDB();
  await database.runAsync(
    `UPDATE ledger_records SET reimbursed = 1, updated_at = ? WHERE deleted = 0 AND ledger_id = ? AND type = 'expense' AND reimbursable = 1 AND reimbursed = 0`,
    [Date.now(), activeLedgerId]
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
        `INSERT INTO ledger_records (amount, category, type, note, date, timestamp, reimbursable, reimbursed, uuid, user_id, updated_at, deleted, ledger_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.amount, r.category, r.type, r.note, r.date, r.timestamp,
         r.reimbursable ? 1 : 0, r.reimbursed ? 1 : 0,
         r.uuid || genUuid(), r.userId ?? 0, r.updatedAt || r.timestamp, r.deleted ? 1 : 0, activeLedgerId]
      );
    }
  });
}

// ===== 导入「替换」策略（按同步身份 upsert + 墓碑，绝不硬删）=====
//
// 旧实现直接 `DELETE FROM ... WHERE ledger_id = ?` 再重插，问题在于硬删不产生墓碑：
// 服务端只向前推进 updated_at，本地消失的行不会被任何设备知道 → 家人的设备上旧记录原样留着，
// 本机重装/换设备后还会被 pull 回来，表现就是「替换导入没生效、账目翻倍」。
// resetPersonalLedger（:690 附近）早就改用墓碑，这里把替换导入对齐到同一语义。
// 另外 uuid 在本地表上没有 UNIQUE 约束（历史数据可能重复），所以逐条 SELECT 再判增/改。

type ImportedRecord = Omit<LedgerRecord, 'id'>;

export async function replaceRecordsByIdentity(records: ImportedRecord[]): Promise<void> {
  const database = await getDB();
  await database.withTransactionAsync(async () => {
    const now = Date.now();
    const rows = records.map((r) => ({ ...r, uuid: r.uuid || genUuid() }));
    const keep = new Set(rows.map((r) => r.uuid));
    const local = await database.getAllAsync<{ uuid: string }>(
      'SELECT uuid FROM ledger_records WHERE ledger_id = ? AND deleted = 0',
      [activeLedgerId]
    );
    for (const e of local) {
      if (!keep.has(e.uuid)) {
        await database.runAsync(
          'UPDATE ledger_records SET deleted = 1, updated_at = ? WHERE uuid = ? AND ledger_id = ?',
          [now, e.uuid, activeLedgerId]
        );
      }
    }
    for (const r of rows) {
      const found = await database.getFirstAsync<{ id: number }>(
        'SELECT id FROM ledger_records WHERE uuid = ? AND ledger_id = ?',
        [r.uuid, activeLedgerId]
      );
      if (found) {
        await database.runAsync(
          `UPDATE ledger_records SET amount = ?, category = ?, type = ?, note = ?, date = ?, timestamp = ?,
             reimbursable = ?, reimbursed = ?, user_id = ?, updated_at = ?, deleted = 0
           WHERE id = ?`,
          [r.amount, r.category, r.type, r.note, r.date, r.timestamp,
           r.reimbursable ? 1 : 0, r.reimbursed ? 1 : 0, r.userId ?? 0, now, found.id]
        );
      } else {
        await database.runAsync(
          `INSERT INTO ledger_records (amount, category, type, note, date, timestamp, reimbursable, reimbursed, uuid, user_id, updated_at, deleted, ledger_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [r.amount, r.category, r.type, r.note, r.date, r.timestamp,
           r.reimbursable ? 1 : 0, r.reimbursed ? 1 : 0, r.uuid, r.userId ?? 0, now, activeLedgerId]
        );
      }
    }
  });
}

export async function replaceRecurringRulesByIdentity(rules: RecurringRule[]): Promise<void> {
  const database = await getDB();
  await database.withTransactionAsync(async () => {
    const now = Date.now();
    const rows = rules.map((r) => ({ ...r, uuid: r.uuid || genUuid() }));
    const keep = new Set(rows.map((r) => r.uuid));
    const local = await database.getAllAsync<{ uuid: string }>(
      'SELECT uuid FROM recurring_rules WHERE ledger_id = ? AND deleted = 0',
      [activeLedgerId]
    );
    for (const e of local) {
      if (!keep.has(e.uuid)) {
        await database.runAsync(
          'UPDATE recurring_rules SET deleted = 1, updated_at = ? WHERE uuid = ? AND ledger_id = ?',
          [now, e.uuid, activeLedgerId]
        );
      }
    }
    for (const r of rows) {
      const found = await database.getFirstAsync<{ id: number }>(
        'SELECT id FROM recurring_rules WHERE uuid = ? AND ledger_id = ?',
        [r.uuid, activeLedgerId]
      );
      const fields = [
        r.name, r.amount, r.type, r.category,
        r.frequency, r.dayOfWeek, r.dayOfMonth, r.monthOfYear, r.note,
        r.enabled ? 1 : 0, r.lastGenerated, r.userId ?? 0, now,
      ];
      if (found) {
        await database.runAsync(
          `UPDATE recurring_rules SET
             name = ?, amount = ?, type = ?, category = ?, frequency = ?, day_of_week = ?,
             day_of_month = ?, month_of_year = ?, note = ?, enabled = ?, last_generated = ?,
             user_id = ?, updated_at = ?, deleted = 0
           WHERE id = ?`,
          [...fields, found.id]
        );
      } else {
        await database.runAsync(
          `INSERT INTO recurring_rules
           (name, amount, type, category, frequency, day_of_week, day_of_month, month_of_year, note, enabled, last_generated, user_id, updated_at, created_at, uuid, deleted, ledger_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [...fields, now, r.uuid, activeLedgerId]
        );
      }
    }
  });
}

export async function replaceCustomCategoriesByIdentity(cats: CustomCategory[]): Promise<void> {
  const database = await getDB();
  await database.withTransactionAsync(async () => {
    const now = Date.now();
    const rows = cats.map((c) => ({ ...c, uuid: c.uuid || genUuid() }));
    const keep = new Set(rows.map((c) => c.uuid));
    const local = await database.getAllAsync<{ uuid: string }>(
      'SELECT uuid FROM custom_categories WHERE ledger_id = ? AND deleted = 0',
      [activeLedgerId]
    );
    for (const e of local) {
      if (!keep.has(e.uuid)) {
        await database.runAsync(
          'UPDATE custom_categories SET deleted = 1, updated_at = ? WHERE uuid = ? AND ledger_id = ?',
          [now, e.uuid, activeLedgerId]
        );
      }
    }
    for (const c of rows) {
      await database.runAsync(
        `INSERT INTO custom_categories (key, label, emoji, color, type, created_at, uuid, updated_at, deleted, ledger_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
         ON CONFLICT(key, ledger_id) DO UPDATE SET
           label = excluded.label, emoji = excluded.emoji, color = excluded.color,
           type = excluded.type, uuid = excluded.uuid, updated_at = excluded.updated_at, deleted = 0`,
        [c.key, c.label, c.emoji, c.color, c.type, now, c.uuid, now, activeLedgerId]
      );
    }
  });
}

// ===== 重置当前账本 =====
// 墓碑软删除当前账本的全部数据（记录 / 周期规则 / 自定义分类），带新的 updated_at，
// 使下一轮同步把删除推送到服务端；服务端 LWW 只会向前推进，历史记录不会被重新拉回。
// 直接硬删会让已登录用户的数据被 pull 复原，也会跨账本误删，故改用墓碑。
// app_settings 保留（服务器地址、登录态、预算、分类显隐等）。
export async function resetPersonalLedger(): Promise<void> {
  const database = await getDB();
  await database.withTransactionAsync(async () => {
    const now = Date.now();
    await database.runAsync('UPDATE ledger_records SET deleted = 1, updated_at = ? WHERE deleted = 0 AND ledger_id = ?', [now, activeLedgerId]);
    await database.runAsync('UPDATE recurring_rules SET deleted = 1, updated_at = ? WHERE deleted = 0 AND ledger_id = ?', [now, activeLedgerId]);
    await database.runAsync('UPDATE custom_categories SET deleted = 1, updated_at = ? WHERE deleted = 0 AND ledger_id = ?', [now, activeLedgerId]);
  });
}
