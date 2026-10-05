import type { NextFunction, Request, Response } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { db } from './db';
import type { AuthUser } from './types';

const DEFAULT_JWT_SECRET = 'tapledger-dev-secret-change-me';
// 登录态有效期：家庭自托管为可信设备场景，默认 365 天长期有效（v0.5.5，此前 7 天导致频繁失效）；
// 可通过 .env 的 JWT_EXPIRES 覆盖（如 '30d'）
const JWT_EXPIRES = (process.env.JWT_EXPIRES || '365d') as SignOptions['expiresIn'];

// 生产环境强制要求安全密钥：缺失/沿用默认值/过短 → 拒绝启动（否则 token 可被任意伪造）
function loadJwtSecret(): string {
  const raw = process.env.JWT_SECRET || '';
  if (!raw || raw === DEFAULT_JWT_SECRET || raw.length < 16) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[fatal] 生产环境必须配置 JWT_SECRET（≥16 位随机串且不等于内置默认值），服务拒绝启动。');
      process.exit(1);
    }
    console.warn('[warn] 未配置安全 JWT_SECRET，正在使用开发默认密钥（仅限本地开发，勿用于生产）。');
    return DEFAULT_JWT_SECRET;
  }
  return raw;
}

const JWT_SECRET = loadJwtSecret();

export interface JwtPayload {
  uid: number;
  tv: number; // token_version：与 users.token_version 不一致即视为已撤销（改密后全端失效）
}

// 签发 token
export function signToken(userId: number, tokenVersion: number): string {
  return jwt.sign({ uid: userId, tv: tokenVersion } satisfies JwtPayload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
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
    `SELECT id, username, display_name, avatar_emoji, family_id, family_role, personal_family_id, token_version
     FROM users WHERE id = ?`
  ).get(payload.uid) as
    | { id: number; username: string; display_name: string; avatar_emoji: string; family_id: number | null; family_role: 'owner' | 'member' | null; personal_family_id: number | null; token_version: number }
    | undefined;
  if (!user) {
    res.status(401).json({ error: '用户不存在' });
    return;
  }
  // 旧版本签发的 token 没有 tv 载荷 → 视作 0，升级后老用户不会被强制登出；
  // 一旦改密（token_version +1）这些 token 全部失效。
  if ((payload.tv ?? 0) !== user.token_version) {
    res.status(401).json({ error: '登录状态已在其他设备变更（如修改密码），请重新登录' });
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

// 通用 IP 限流（内存版，单实例自托管足够）
export function makeIpRateLimit(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return function ipRateLimit(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const entry = hits.get(ip);
    if (entry && now < entry.resetAt) {
      if (entry.count >= limit) {
        res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
        return;
      }
      entry.count += 1;
    } else {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
    }
    // 只增不删的 Map 在长期运行（公网可达 + 扫描流量）下会缓慢涨内存：
    // 超过阈值时顺手清掉已过窗口的键，成本 O(size)，触发频率极低。
    if (hits.size > 512) {
      for (const [k, v] of hits) {
        if (now >= v.resetAt) hits.delete(k);
      }
    }
    next();
  };
}

export const loginRateLimit = makeIpRateLimit(5, 60_000);
export const registerRateLimit = makeIpRateLimit(3, 60_000);
export const joinRateLimit = makeIpRateLimit(5, 60_000);
