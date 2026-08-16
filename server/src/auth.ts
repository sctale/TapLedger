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
    `SELECT id, username, display_name, avatar_emoji, family_id, family_role FROM users WHERE id = ?`
  ).get(payload.uid) as
    | { id: number; username: string; display_name: string; avatar_emoji: string; family_id: number | null; family_role: 'owner' | 'member' | null }
    | undefined;
  if (!user) {
    res.status(401).json({ error: '用户不存在' });
    return;
  }
  req.authUser = {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    avatarEmoji: user.avatar_emoji,
    familyId: user.family_id,
    familyRole: user.family_role,
  };
  next();
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
