import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from './db';
import type { AuthUser } from './types';

const JWT_SECRET = process.env.JWT_SECRET || 'tapledger-dev-secret-change-me';
const JWT_EXPIRES = '7d';

export interface JwtPayload {
  uid: number;
}

// 签发 token
export function signToken(userId: number): string {
  return jwt.sign({ uid: userId } satisfies JwtPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

// 扩展 Request：注入当前用户
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

// 认证中间件：解 JWT → 读用户（含家庭归属）
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({ error: '未登录' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: '登录已过期，请重新登录' });
    return;
  }
  const user = db.prepare(
    `SELECT id, username, display_name, avatar_emoji, family_id, family_role, personal_family_id FROM users WHERE id = ?`
  ).get(payload.uid) as
    | { id: number; username: string; display_name: string; avatar_emoji: string; family_id: number | null; family_role: 'owner' | 'member' | null; personal_family_id: number | null }
    | undefined;
  if (!user) {
    res.status(401).json({ error: '用户不存在' });
    return;
  }
  // 老用户/新用户统一确保存在个人账本
  const personalFid = user.personal_family_id ?? ensurePersonalLedger(user.id, user.display_name);
  req.authUser = {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarEmoji: user.avatar_emoji,
    familyId: user.family_id,
    familyRole: user.family_role,
    personalLedgerId: personalFid,
    personalLedgerName: user.display_name,
  };
  next();
}

// 确保用户存在个人账本（注册时建；老用户惰性补建），返回个人账本 id
export function ensurePersonalLedger(userId: number, displayName: string): number {
  const existing = db.prepare('SELECT personal_family_id FROM users WHERE id = ?').get(userId) as
    | { personal_family_id: number | null }
    | undefined;
  if (existing && existing.personal_family_id != null) {
    return existing.personal_family_id;
  }
  const tx = db.transaction(() => {
    const code = `P${userId}${String(Date.now()).slice(-6)}`;
    const info = db.prepare(
      "INSERT INTO families (name, invite_code, owner_id, type, created_at) VALUES (?, ?, ?, 'personal', ?)"
    ).run(displayName || '个人账本', code, userId, Date.now());
    db.prepare('UPDATE users SET personal_family_id = ? WHERE id = ?').run(info.lastInsertRowid, userId);
    return info.lastInsertRowid as number;
  });
  return tx();
}

// 校验用户对某账本（家庭/个人）是否有读写权限
export function canAccessLedger(user: AuthUser, ledgerId: number): boolean {
  return ledgerId === user.personalLedgerId || ledgerId === user.familyId;
}

// 要求已加入家庭（同步接口前置）
export function requireFamily(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser || req.authUser.familyId == null) {
    res.status(403).json({ error: '请先创建或加入家庭' });
    return;
  }
  next();
}

// 登录限流（内存版，同 IP 每分钟 5 次）
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function loginRateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (entry && now < entry.resetAt) {
    if (entry.count >= 5) {
      res.status(429).json({ error: '尝试过于频繁，请 1 分钟后再试' });
      return;
    }
    entry.count += 1;
  } else {
    loginAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
  }
  next();
}
