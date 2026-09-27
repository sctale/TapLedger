import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, getFlag } from '../db';
import { requireAuth, signToken, ensurePersonalLedger, makeIpRateLimit } from '../auth';
import type { AuthUser } from '../types';

const router = Router();

const registerSchema = z.object({
  username: z.string().trim().min(2, '用户名至少 2 个字符').max(20, '用户名最多 20 个字符')
    .regex(/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/, '用户名仅限中英文/数字/下划线'),
  password: z.string().min(6, '密码至少 6 位').max(64, '密码最多 64 位'),
  displayName: z.string().trim().max(12, '昵称最多 12 个字符').optional(),
});

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(12).optional(),
  avatarEmoji: z.string().trim().min(1).max(4).optional(),
});

// 用户行 → 对外字段
function toAuthUser(row: {
  id: number; username: string; display_name: string; avatar_emoji: string;
  family_id: number | null; family_role: 'owner' | 'member' | null;
}) {
  const personalFid = ensurePersonalLedger(row.id, row.display_name);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarEmoji: row.avatar_emoji,
    familyId: row.family_id,
    familyRole: row.family_role,
    personalLedgerId: personalFid,
    personalLedgerName: row.display_name,
  } satisfies AuthUser;
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  if (getFlag('allow_register') !== '1') {
    res.status(403).json({ error: '服务器已关闭注册，请联系管理员在后台开启' });
    return;
  }
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数无效' });
    return;
  }
  const { username, password, displayName } = parsed.data;
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    res.status(409).json({ error: '用户名已被使用' });
    return;
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    `INSERT INTO users (username, password_hash, display_name, avatar_emoji, created_at)
     VALUES (?, ?, ?, '🙂', ?)`
  ).run(username, hash, displayName || username, Date.now());
  const row = db.prepare(
    'SELECT id, username, display_name, avatar_emoji, family_id, family_role FROM users WHERE id = ?'
  ).get(info.lastInsertRowid) as Parameters<typeof toAuthUser>[0];
  res.json({ token: signToken(row.id), user: toAuthUser(row) });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '请输入用户名和密码' });
    return;
  }
  const { username, password } = parsed.data;
  const row = db.prepare(
    'SELECT id, username, password_hash, display_name, avatar_emoji, family_id, family_role FROM users WHERE username = ?'
  ).get(username) as
    | { id: number; username: string; password_hash: string; display_name: string; avatar_emoji: string; family_id: number | null; family_role: 'owner' | 'member' | null }
    | undefined;
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    res.status(401).json({ error: '用户名或密码错误' });
    return;
  }
  const { password_hash: _ph, ...safe } = row;
  res.json({ token: signToken(row.id), user: toAuthUser(safe) });
});

// /api/me 路由（独立挂载到 /api，与 /api/auth 区分）
export const meRouter = Router();

// GET /api/me
meRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.authUser });
});

// PUT /api/me（改昵称/头像）
meRouter.put('/me', requireAuth, (req, res) => {
  const parsed = updateMeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数无效' });
    return;
  }
  const { displayName, avatarEmoji } = parsed.data;
  if (displayName) {
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, req.authUser!.id);
  }
  if (avatarEmoji) {
    db.prepare('UPDATE users SET avatar_emoji = ? WHERE id = ?').run(avatarEmoji, req.authUser!.id);
  }
  const row = db.prepare(
    'SELECT id, username, display_name, avatar_emoji, family_id, family_role FROM users WHERE id = ?'
  ).get(req.authUser!.id) as Parameters<typeof toAuthUser>[0];
  res.json({ user: toAuthUser(row) });
});

// DELETE /api/me（注销账号）
// 审核要求：涉及账号体系必须提供便捷、真实有效的注销通道。密码复核用于防误操作，
// 除此之外不设额外障碍；JWT 无状态，删除用户行后旧 token 立即失效（requireAuth 查不到用户）。
const deleteMeSchema = z.object({ password: z.string().min(1, '请输入密码确认注销') });
const deleteRateLimit = makeIpRateLimit(5, 60_000);

meRouter.delete('/me', requireAuth, deleteRateLimit, (req, res) => {
  const parsed = deleteMeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '请输入密码确认注销' });
    return;
  }
  const uid = req.authUser!.id;
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(uid) as
    | { password_hash: string }
    | undefined;
  if (!row || !bcrypt.compareSync(parsed.data.password, row.password_hash)) {
    res.status(401).json({ error: '密码错误，未执行注销' });
    return;
  }

  const me = req.authUser!;
  const familyId = me.familyId;
  const personalId = me.personalLedgerId;
  const isOwner = me.familyRole === 'owner';
  let dissolvedFamily = false;
  let unboundMembers = 0;

  const tx = db.transaction(() => {
    if (familyId != null) {
      if (isOwner) {
        // 创建者注销 = 解散其创建的家庭账本：删共享数据，其余成员解绑（本地副本保留但不再同步）
        const others = db.prepare('SELECT COUNT(*) AS c FROM users WHERE family_id = ? AND id != ?')
          .get(familyId, uid) as { c: number };
        unboundMembers = others.c;
        db.prepare('DELETE FROM records WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM recurring WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM custom_categories WHERE family_id = ?').run(familyId);
        db.prepare('UPDATE users SET family_id = NULL, family_role = NULL WHERE family_id = ?').run(familyId);
        db.prepare('DELETE FROM families WHERE id = ?').run(familyId);
        dissolvedFamily = true;
      } else {
        // 普通成员注销：仅解绑，家庭账本与历史记录归创建者所有
        db.prepare('UPDATE users SET family_id = NULL, family_role = NULL WHERE id = ?').run(uid);
      }
    }
    // 个人账本及其全部数据
    if (personalId != null) {
      db.prepare('DELETE FROM records WHERE family_id = ?').run(personalId);
      db.prepare('DELETE FROM recurring WHERE family_id = ?').run(personalId);
      db.prepare('DELETE FROM custom_categories WHERE family_id = ?').run(personalId);
      db.prepare('DELETE FROM families WHERE id = ?').run(personalId);
    }
    // 残留在他人账本中的记录：记账人归为无主，避免成员列表出现幽灵
    db.prepare('UPDATE records SET user_id = 0 WHERE user_id = ?').run(uid);
    db.prepare('UPDATE recurring SET user_id = 0 WHERE user_id = ?').run(uid);
    db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  });
  tx();

  res.json({ ok: true, dissolvedFamily, unboundMembers });
});

export default router;
