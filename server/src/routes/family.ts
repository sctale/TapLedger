import { Router } from 'express';
import { z } from 'zod';
import { db, genUniqueInviteCode } from '../db';
import { requireAuth } from '../auth';
import type { FamilyInfo, FamilyMember } from '../types';

const router = Router();

const createSchema = z.object({
  name: z.string().trim().min(1, '请输入家庭名称').max(20, '家庭名称最多 20 个字符'),
});

const joinSchema = z.object({
  inviteCode: z.string().trim().toUpperCase().min(6).max(6),
});

// POST /api/family（创建家庭，创建者即 owner）
router.post('/', requireAuth, (req, res) => {
  if (req.authUser!.familyId != null) {
    res.status(409).json({ error: '你已属于一个家庭，先退出后才能创建新家庭' });
    return;
  }
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? '参数无效' });
    return;
  }
  const code = genUniqueInviteCode();
  const tx = db.transaction(() => {
    const info = db.prepare(
      'INSERT INTO families (name, invite_code, owner_id, created_at) VALUES (?, ?, ?, ?)'
    ).run(parsed.data.name, code, req.authUser!.id, Date.now());
    db.prepare("UPDATE users SET family_id = ?, family_role = 'owner' WHERE id = ?")
      .run(info.lastInsertRowid, req.authUser!.id);
    return info.lastInsertRowid as number;
  });
  const familyId = tx();
  const family = db.prepare('SELECT id, name, invite_code, owner_id FROM families WHERE id = ?').get(familyId) as {
    id: number; name: string; invite_code: string; owner_id: number;
  };
  const info: FamilyInfo = {
    id: family.id, name: family.name, inviteCode: family.invite_code, ownerId: family.owner_id,
  };
  res.json({ family: info, user: { ...req.authUser!, familyId: familyId, familyRole: 'owner' } });
});

// POST /api/family/join（邀请码加入）
router.post('/join', requireAuth, (req, res) => {
  if (req.authUser!.familyId != null) {
    res.status(409).json({ error: '你已属于一个家庭，先退出后才能加入其他家庭' });
    return;
  }
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '请输入 6 位邀请码' });
    return;
  }
  const family = db.prepare('SELECT id, name, invite_code, owner_id FROM families WHERE invite_code = ?')
    .get(parsed.data.inviteCode) as { id: number; name: string; invite_code: string; owner_id: number } | undefined;
  if (!family) {
    res.status(404).json({ error: '邀请码无效' });
    return;
  }
  db.prepare("UPDATE users SET family_id = ?, family_role = 'member' WHERE id = ?")
    .run(family.id, req.authUser!.id);
  const info: FamilyInfo = {
    id: family.id, name: family.name, inviteCode: family.invite_code, ownerId: family.owner_id,
  };
  res.json({ family: info, user: { ...req.authUser!, familyId: family.id, familyRole: 'member' } });
});

// GET /api/family（当前家庭信息）
router.get('/', requireAuth, (req, res) => {
  if (req.authUser!.familyId == null) {
    res.json({ family: null });
    return;
  }
  const family = db.prepare('SELECT id, name, invite_code, owner_id FROM families WHERE id = ?')
    .get(req.authUser!.familyId) as { id: number; name: string; invite_code: string; owner_id: number };
  if (!family) {
    res.json({ family: null });
    return;
  }
  const info: FamilyInfo = {
    id: family.id, name: family.name, inviteCode: family.invite_code, ownerId: family.owner_id,
  };
  res.json({ family: info });
});

// GET /api/family/members（成员列表）
router.get('/members', requireAuth, (req, res) => {
  if (req.authUser!.familyId == null) {
    res.status(403).json({ error: '请先创建或加入家庭' });
    return;
  }
  const rows = db.prepare(
    `SELECT id, display_name, avatar_emoji, family_role FROM users
     WHERE family_id = ? ORDER BY (family_role = 'owner') DESC, id ASC`
  ).all(req.authUser!.familyId) as {
    id: number; display_name: string; avatar_emoji: string; family_role: 'owner' | 'member';
  }[];
  const members: FamilyMember[] = rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    avatarEmoji: r.avatar_emoji,
    role: r.family_role,
  }));
  res.json({ members });
});

// POST /api/family/invite/regenerate（owner 重新生成邀请码）
router.post('/invite/regenerate', requireAuth, (req, res) => {
  if (req.authUser!.familyId == null || req.authUser!.familyRole !== 'owner') {
    res.status(403).json({ error: '仅家庭创建者可重置邀请码' });
    return;
  }
  const code = genUniqueInviteCode();
  db.prepare('UPDATE families SET invite_code = ? WHERE id = ?').run(code, req.authUser!.familyId);
  res.json({ inviteCode: code });
});

// DELETE /api/family/members/:userId（owner 移除成员；不可移除自己；成员历史记录保留在账本）
router.delete('/members/:userId', requireAuth, (req, res) => {
  const me = req.authUser!;
  if (me.familyId == null || me.familyRole !== 'owner') {
    res.status(403).json({ error: '仅家庭创建者可移除成员' });
    return;
  }
  const targetId = Number(req.params.userId);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    res.status(400).json({ error: '参数无效' });
    return;
  }
  if (targetId === me.id) {
    res.status(400).json({ error: '不能移除自己，请使用解散家庭' });
    return;
  }
  const target = db.prepare('SELECT id, family_id FROM users WHERE id = ?').get(targetId) as
    | { id: number; family_id: number | null }
    | undefined;
  if (!target || target.family_id !== me.familyId) {
    res.status(404).json({ error: '该成员不存在或不属于此家庭' });
    return;
  }
  db.prepare("UPDATE users SET family_id = NULL, family_role = NULL WHERE id = ?").run(targetId);
  res.json({ ok: true });
});

// POST /api/family/leave（退出家庭；owner 需先转让或为唯一成员）
router.post('/leave', requireAuth, (req, res) => {
  if (req.authUser!.familyId == null) {
    res.status(400).json({ error: '你尚未加入家庭' });
    return;
  }
  const familyId = req.authUser!.familyId;
  if (req.authUser!.familyRole === 'owner') {
    const members = db.prepare('SELECT COUNT(*) as c FROM users WHERE family_id = ?').get(familyId) as { c: number };
    if (members.c > 1) {
      res.status(409).json({ error: '家庭还有其他成员，创建者不能直接退出' });
      return;
    }
    // 唯一成员：解散家庭（账本数据保留由客户端墓碑同步处理，服务端一并清理）
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM records WHERE family_id = ?').run(familyId);
      db.prepare('DELETE FROM accounts WHERE family_id = ?').run(familyId);
      db.prepare('DELETE FROM transfers WHERE family_id = ?').run(familyId);
      db.prepare('DELETE FROM recurring WHERE family_id = ?').run(familyId);
      db.prepare('DELETE FROM custom_categories WHERE family_id = ?').run(familyId);
      db.prepare("UPDATE users SET family_id = NULL, family_role = NULL WHERE id = ?").run(req.authUser!.id);
      db.prepare('DELETE FROM families WHERE id = ?').run(familyId);
    });
    tx();
  } else {
    db.prepare("UPDATE users SET family_id = NULL, family_role = NULL WHERE id = ?").run(req.authUser!.id);
  }
  res.json({ ok: true });
});

export default router;
