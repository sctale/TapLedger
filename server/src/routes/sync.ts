import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth, canAccessLedger } from '../auth';
import type { SyncChanges } from '../types';

const router = Router();
router.use(requireAuth);

// ===== 校验 schema =====
const uuidSchema = z.string().min(8).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const typeSchema = z.enum(['expense', 'income']);

const recordSchema = z.object({
  uuid: uuidSchema,
  amount: z.number().positive(),
  category: z.string().min(1).max(40),
  type: typeSchema,
  note: z.string().max(60).default(''),
  date: dateSchema,
  timestamp: z.number().int().nonnegative(),
  accountUuid: z.string().max(64).default(''),
  reimbursable: z.number().int().min(0).max(1).default(0),
  reimbursed: z.number().int().min(0).max(1).default(0),
  updatedAt: z.number().int().nonnegative(),
  deleted: z.number().int().min(0).max(1).default(0),
});

const accountSchema = z.object({
  uuid: uuidSchema,
  name: z.string().min(1).max(20),
  type: z.string().max(20).default('cash'),
  emoji: z.string().max(8).default('💵'),
  color: z.string().max(16).default('#90A4AE'),
  initialBalance: z.number().default(0),
  sort: z.number().int().default(0),
  updatedAt: z.number().int().nonnegative(),
  deleted: z.number().int().min(0).max(1).default(0),
});

const transferSchema = z.object({
  uuid: uuidSchema,
  fromAccountUuid: z.string().max(64).default(''),
  toAccountUuid: z.string().max(64).default(''),
  amount: z.number().positive(),
  date: dateSchema,
  note: z.string().max(60).default(''),
  timestamp: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  deleted: z.number().int().min(0).max(1).default(0),
});

const recurringSchema = z.object({
  uuid: uuidSchema,
  name: z.string().min(1).max(20),
  amount: z.number().positive(),
  type: typeSchema,
  category: z.string().min(1).max(40),
  accountUuid: z.string().max(64).default(''),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  dayOfWeek: z.number().int().min(0).max(6).default(0),
  dayOfMonth: z.number().int().min(1).max(31).default(1),
  monthOfYear: z.number().int().min(1).max(12).default(1),
  note: z.string().max(60).default(''),
  enabled: z.number().int().min(0).max(1).default(1),
  lastGenerated: z.string().max(10).default(''),
  updatedAt: z.number().int().nonnegative(),
  deleted: z.number().int().min(0).max(1).default(0),
});

const customCategorySchema = z.object({
  uuid: uuidSchema,
  key: z.string().min(1).max(60),
  label: z.string().min(1).max(12),
  emoji: z.string().max(8).default('📌'),
  color: z.string().max(16).default('#90A4AE'),
  type: typeSchema,
  updatedAt: z.number().int().nonnegative(),
  deleted: z.number().int().min(0).max(1).default(0),
});

const pullSchema = z.object({
  since: z.number().int().nonnegative().default(0),
  ledgerId: z.number().int().positive(),
});

// ===== 通用 LWW upsert（仅当传入 updated_at 更新时覆盖）=====

// 逐表 upsert SQL（ON CONFLICT DO UPDATE ... WHERE 保证 LWW）
const UPSERTS = {
  records: db.prepare(`
    INSERT INTO records (uuid, family_id, user_id, amount, category, type, note, date, timestamp, account_uuid, reimbursable, reimbursed, updated_at, deleted)
    VALUES (@uuid, @familyId, @userId, @amount, @category, @type, @note, @date, @timestamp, @accountUuid, @reimbursable, @reimbursed, @updatedAt, @deleted)
    ON CONFLICT(uuid) DO UPDATE SET
      user_id = excluded.user_id, amount = excluded.amount, category = excluded.category,
      type = excluded.type, note = excluded.note, date = excluded.date, timestamp = excluded.timestamp,
      account_uuid = excluded.account_uuid, reimbursable = excluded.reimbursable, reimbursed = excluded.reimbursed,
      updated_at = excluded.updated_at, deleted = excluded.deleted
    WHERE excluded.updated_at > records.updated_at
  `),
  accounts: db.prepare(`
    INSERT INTO accounts (uuid, family_id, name, type, emoji, color, initial_balance, sort, updated_at, deleted)
    VALUES (@uuid, @familyId, @name, @type, @emoji, @color, @initialBalance, @sort, @updatedAt, @deleted)
    ON CONFLICT(uuid) DO UPDATE SET
      name = excluded.name, type = excluded.type, emoji = excluded.emoji, color = excluded.color,
      initial_balance = excluded.initial_balance, sort = excluded.sort,
      updated_at = excluded.updated_at, deleted = excluded.deleted
    WHERE excluded.updated_at > accounts.updated_at
  `),
  transfers: db.prepare(`
    INSERT INTO transfers (uuid, family_id, from_account_uuid, to_account_uuid, amount, date, note, timestamp, updated_at, deleted)
    VALUES (@uuid, @familyId, @fromAccountUuid, @toAccountUuid, @amount, @date, @note, @timestamp, @updatedAt, @deleted)
    ON CONFLICT(uuid) DO UPDATE SET
      from_account_uuid = excluded.from_account_uuid, to_account_uuid = excluded.to_account_uuid,
      amount = excluded.amount, date = excluded.date, note = excluded.note, timestamp = excluded.timestamp,
      updated_at = excluded.updated_at, deleted = excluded.deleted
    WHERE excluded.updated_at > transfers.updated_at
  `),
  recurring: db.prepare(`
    INSERT INTO recurring (uuid, family_id, user_id, name, amount, type, category, account_uuid, frequency, day_of_week, day_of_month, month_of_year, note, enabled, last_generated, updated_at, deleted)
    VALUES (@uuid, @familyId, @userId, @name, @amount, @type, @category, @accountUuid, @frequency, @dayOfWeek, @dayOfMonth, @monthOfYear, @note, @enabled, @lastGenerated, @updatedAt, @deleted)
    ON CONFLICT(uuid) DO UPDATE SET
      user_id = excluded.user_id, name = excluded.name, amount = excluded.amount, type = excluded.type,
      category = excluded.category, account_uuid = excluded.account_uuid, frequency = excluded.frequency,
      day_of_week = excluded.day_of_week, day_of_month = excluded.day_of_month, month_of_year = excluded.month_of_year,
      note = excluded.note, enabled = excluded.enabled, last_generated = excluded.last_generated,
      updated_at = excluded.updated_at, deleted = excluded.deleted
    WHERE excluded.updated_at > recurring.updated_at
  `),
  custom_categories: db.prepare(`
    INSERT INTO custom_categories (uuid, family_id, key, label, emoji, color, type, updated_at, deleted)
    VALUES (@uuid, @familyId, @key, @label, @emoji, @color, @type, @updatedAt, @deleted)
    ON CONFLICT(uuid) DO UPDATE SET
      key = excluded.key, label = excluded.label, emoji = excluded.emoji, color = excluded.color,
      type = excluded.type, updated_at = excluded.updated_at, deleted = excluded.deleted
    WHERE excluded.updated_at > custom_categories.updated_at
  `),
};

// POST /api/sync/pull —— 拉取 since 之后的全部变更（含墓碑）
router.post('/pull', (req, res) => {
  const parsed = pullSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: '缺少账本参数 ledgerId' });
    return;
  }
  const { since, ledgerId } = parsed.data;
  if (!canAccessLedger(req.authUser!, ledgerId)) {
    res.status(403).json({ error: '无权访问该账本' });
    return;
  }

  const changes: SyncChanges = {
    records: db.prepare(
      'SELECT uuid, family_id as familyId, user_id as userId, amount, category, type, note, date, timestamp, account_uuid as accountUuid, reimbursable, reimbursed, updated_at as updatedAt, deleted FROM records WHERE family_id = ? AND updated_at > ?'
    ).all(ledgerId, since) as never,
    accounts: db.prepare(
      'SELECT uuid, family_id as familyId, name, type, emoji, color, initial_balance as initialBalance, sort, updated_at as updatedAt, deleted FROM accounts WHERE family_id = ? AND updated_at > ?'
    ).all(ledgerId, since) as never,
    transfers: db.prepare(
      'SELECT uuid, family_id as familyId, from_account_uuid as fromAccountUuid, to_account_uuid as toAccountUuid, amount, date, note, timestamp, updated_at as updatedAt, deleted FROM transfers WHERE family_id = ? AND updated_at > ?'
    ).all(ledgerId, since) as never,
    recurring: db.prepare(
      'SELECT uuid, family_id as familyId, user_id as userId, name, amount, type, category, account_uuid as accountUuid, frequency, day_of_week as dayOfWeek, day_of_month as dayOfMonth, month_of_year as monthOfYear, note, enabled, last_generated as lastGenerated, updated_at as updatedAt, deleted FROM recurring WHERE family_id = ? AND updated_at > ?'
    ).all(ledgerId, since) as never,
    customCategories: db.prepare(
      'SELECT uuid, family_id as familyId, key, label, emoji, color, type, updated_at as updatedAt, deleted FROM custom_categories WHERE family_id = ? AND updated_at > ?'
    ).all(ledgerId, since) as never,
  };
  res.json({ serverTime: Date.now(), changes });
});

// POST /api/sync/push —— 上传本地变更（逐条 LWW upsert，冲突旧版本被拒绝）
router.post('/push', (req, res) => {
  const body = req.body ?? {};
  const ledgerId = Number(body.ledgerId);
  if (!Number.isInteger(ledgerId) || ledgerId <= 0) {
    res.status(400).json({ error: '缺少账本参数 ledgerId' });
    return;
  }
  if (!canAccessLedger(req.authUser!, ledgerId)) {
    res.status(403).json({ error: '无权访问该账本' });
    return;
  }
  const userId = req.authUser!.id;

  let applied = 0;
  let rejected = 0;
  const errors: string[] = [];

  const count = (ok: boolean) => (ok ? applied++ : rejected++);

  // 校验 + 注入归属后逐条 upsert（事务整体提交）
  const run = db.transaction(() => {
    for (const raw of Array.isArray(body.records) ? body.records : []) {
      const p = recordSchema.safeParse(raw);
      if (!p.success) { rejected++; continue; }
      const info = UPSERTS.records.run({ ...p.data, familyId: ledgerId, userId });
      count(info.changes > 0);
    }
    for (const raw of Array.isArray(body.accounts) ? body.accounts : []) {
      const p = accountSchema.safeParse(raw);
      if (!p.success) { rejected++; continue; }
      const info = UPSERTS.accounts.run({ ...p.data, familyId: ledgerId });
      count(info.changes > 0);
    }
    for (const raw of Array.isArray(body.transfers) ? body.transfers : []) {
      const p = transferSchema.safeParse(raw);
      if (!p.success) { rejected++; continue; }
      const info = UPSERTS.transfers.run({ ...p.data, familyId: ledgerId });
      count(info.changes > 0);
    }
    for (const raw of Array.isArray(body.recurring) ? body.recurring : []) {
      const p = recurringSchema.safeParse(raw);
      if (!p.success) { rejected++; continue; }
      const info = UPSERTS.recurring.run({ ...p.data, familyId: ledgerId, userId });
      count(info.changes > 0);
    }
    for (const raw of Array.isArray(body.customCategories) ? body.customCategories : []) {
      const p = customCategorySchema.safeParse(raw);
      if (!p.success) { rejected++; continue; }
      const info = UPSERTS.custom_categories.run({ ...p.data, familyId: ledgerId });
      count(info.changes > 0);
    }
  });
  run();

  if (rejected > 0 && applied === 0) {
    errors.push('全部变更被拒绝（可能是版本过旧，请下拉同步）');
  }
  res.json({ serverTime: Date.now(), applied, rejected, errors: errors.length > 0 ? errors : undefined });
});

export default router;
