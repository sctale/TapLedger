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
  reimbursable: z.number().int().min(0).max(1).default(0),
  reimbursed: z.number().int().min(0).max(1).default(0),
  updatedAt: z.number().int().nonnegative(),
  deleted: z.number().int().min(0).max(1).default(0),
});

const recurringSchema = z.object({
  uuid: uuidSchema,
  name: z.string().min(1).max(20),
  amount: z.number().positive(),
  type: typeSchema,
  category: z.string().min(1).max(40),
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
//
// 两条不变量（v0.5.6 安全审查修复）：
// 1. WHERE 带上 family_id = @familyId：uuid 是全局主键，缺这条守卫时
//    任何登录用户只要知道（或撞上）别人账本的 uuid，就能把字段写进**那本账本**的行里
//    （SET 子句不改 family_id，所以数据留在原账本——等于跨账本篡改）。
// 2. SET 子句不再更新 user_id：user_id 是「记账人」（作者），只在插入时落定。
//    此前每次编辑都会把作者改写成最后编辑的人，成员支出排行与报销归属随之错位。
//    客户端传的 userId 仍被 schema 丢弃，伪造记账人的能力不变。
const UPSERTS = {
  records: db.prepare(`
    INSERT INTO records (uuid, family_id, user_id, amount, category, type, note, date, timestamp, reimbursable, reimbursed, updated_at, deleted)
    VALUES (@uuid, @familyId, @userId, @amount, @category, @type, @note, @date, @timestamp, @reimbursable, @reimbursed, @updatedAt, @deleted)
    ON CONFLICT(uuid) DO UPDATE SET
      amount = excluded.amount, category = excluded.category,
      type = excluded.type, note = excluded.note, date = excluded.date, timestamp = excluded.timestamp,
      reimbursable = excluded.reimbursable, reimbursed = excluded.reimbursed,
      updated_at = excluded.updated_at, deleted = excluded.deleted
    WHERE excluded.updated_at > records.updated_at AND records.family_id = excluded.family_id
  `),
  recurring: db.prepare(`
    INSERT INTO recurring (uuid, family_id, user_id, name, amount, type, category, frequency, day_of_week, day_of_month, month_of_year, note, enabled, last_generated, updated_at, deleted)
    VALUES (@uuid, @familyId, @userId, @name, @amount, @type, @category, @frequency, @dayOfWeek, @dayOfMonth, @monthOfYear, @note, @enabled, @lastGenerated, @updatedAt, @deleted)
    ON CONFLICT(uuid) DO UPDATE SET
      name = excluded.name, amount = excluded.amount, type = excluded.type,
      category = excluded.category, frequency = excluded.frequency,
      day_of_week = excluded.day_of_week, day_of_month = excluded.day_of_month, month_of_year = excluded.month_of_year,
      note = excluded.note, enabled = excluded.enabled, last_generated = excluded.last_generated,
      updated_at = excluded.updated_at, deleted = excluded.deleted
    WHERE excluded.updated_at > recurring.updated_at AND recurring.family_id = excluded.family_id
  `),
  custom_categories: db.prepare(`
    INSERT INTO custom_categories (uuid, family_id, key, label, emoji, color, type, updated_at, deleted)
    VALUES (@uuid, @familyId, @key, @label, @emoji, @color, @type, @updatedAt, @deleted)
    ON CONFLICT(uuid) DO UPDATE SET
      key = excluded.key, label = excluded.label, emoji = excluded.emoji, color = excluded.color,
      type = excluded.type, updated_at = excluded.updated_at, deleted = excluded.deleted
    WHERE excluded.updated_at > custom_categories.updated_at AND custom_categories.family_id = excluded.family_id
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
      'SELECT uuid, family_id as familyId, user_id as userId, amount, category, type, note, date, timestamp, reimbursable, reimbursed, updated_at as updatedAt, deleted FROM records WHERE family_id = ? AND updated_at > ?'
    ).all(ledgerId, since) as never,
    recurring: db.prepare(
      'SELECT uuid, family_id as familyId, user_id as userId, name, amount, type, category, frequency, day_of_week as dayOfWeek, day_of_month as dayOfMonth, month_of_year as monthOfYear, note, enabled, last_generated as lastGenerated, updated_at as updatedAt, deleted FROM recurring WHERE family_id = ? AND updated_at > ?'
    ).all(ledgerId, since) as never,
    customCategories: db.prepare(
      'SELECT uuid, family_id as familyId, key, label, emoji, color, type, updated_at as updatedAt, deleted FROM custom_categories WHERE family_id = ? AND updated_at > ?'
    ).all(ledgerId, since) as never,
  };
  res.json({ serverTime: Date.now(), changes });
});

// POST /api/sync/push —— 上传本地变更（逐条 LWW upsert）
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
  // updated_at 钳制到服务端时钟：客户端设备时钟超前（改错时区/手动调时间）时，
  // 一条「未来的」updated_at 会永久压制后续所有正常编辑——LWW 比不过就再也改不动了。
  // 钳制只压低版本号，不丢数据：该条仍然入库，后续编辑按服务端时间依次覆盖。
  const serverNow = Date.now();

  let applied = 0;
  let skipped = 0;              // 版本不比服务端新 / uuid 属于别的账本：正常幂等丢弃
  const invalidIds: string[] = []; // 字段不合法：必须让用户知道，否则本地有、服务端永远没有
  const invalidCounts: Record<string, number> = {};

  const tally = (kind: 'records' | 'recurring' | 'customCategories', raw: unknown) => {
    const schema = kind === 'records' ? recordSchema : kind === 'recurring' ? recurringSchema : customCategorySchema;
    const p = schema.safeParse(raw);
    if (!p.success) {
      const id = typeof (raw as { uuid?: unknown })?.uuid === 'string' ? (raw as { uuid: string }).uuid : '?';
      if (invalidIds.length < 20) invalidIds.push(id);
      invalidCounts[kind] = (invalidCounts[kind] ?? 0) + 1;
      return;
    }
    const data = { ...p.data, updatedAt: Math.min(p.data.updatedAt, serverNow) };
    const info =
      kind === 'records'
        ? UPSERTS.records.run({ ...data, familyId: ledgerId, userId })
        : kind === 'recurring'
          ? UPSERTS.recurring.run({ ...data, familyId: ledgerId, userId })
          : UPSERTS.custom_categories.run({ ...data, familyId: ledgerId });
    if (info.changes > 0) applied++;
    else skipped++;
  };

  // 事务整体提交：单条失败不污染其余（校验失败的条目在 tally 内直接计入 invalid）
  const run = db.transaction(() => {
    for (const raw of Array.isArray(body.records) ? body.records : []) tally('records', raw);
    for (const raw of Array.isArray(body.recurring) ? body.recurring : []) tally('recurring', raw);
    for (const raw of Array.isArray(body.customCategories) ? body.customCategories : []) tally('customCategories', raw);
  });
  run();

  const invalid = invalidIds.length > 0 ? Object.values(invalidCounts).reduce((s, n) => s + n, 0) : 0;
  const errors: string[] = [];
  if (invalid > 0) {
    errors.push(`${invalid} 条数据不符合服务端字段限制，未上传（详见 invalidIds）`);
  }
  res.json({
    serverTime: serverNow,
    applied,
    // rejected 保留原语义（= 未生效条数），老客户端只看这个字段也不会出错
    rejected: skipped + invalid,
    skipped,
    invalid,
    invalidIds: invalidIds.length > 0 ? invalidIds : undefined,
    errors: errors.length > 0 ? errors : undefined,
  });
});

export default router;
