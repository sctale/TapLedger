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
  return jwt.sign({ uid: userId, tv: tokenVersion } satisfies JwtPayload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES,
  });
}

export type VerifyOutcome =
  { ok: true; payload: JwtPayload } | { ok: false; reason: 'expired' | 'bad_signature' };

// 区分「token 过期」与「验签失败」：此前两者都回同一句「登录已过期，请重新登录」，
// 于是「NAS 换过 JWT_SECRET」这种全员掉线事故和「一年到期正常过期」在客户端根本分不开。
export function verifyToken(token: string): VerifyOutcome {
  try {
    return { ok: true, payload: jwt.verify(token, JWT_SECRET) as JwtPayload };
  } catch (e) {
    const name = (e as Error)?.name ?? '';
    return { ok: false, reason: name === 'TokenExpiredError' ? 'expired' : 'bad_signature' };
  }
}

// 401 记入容器日志：这类事故只有服务端留痕才查得出来（此前日志里只有启动行与每日备份）。
// 公网部署要防扫描流量刷爆日志，同一原因+账号每分钟最多记 5 条。
const authLogCounts = new Map<string, { n: number; windowAt: number }>();
function logAuthFail(reason: string, uid: string, req: Request): void {
  const now = Date.now();
  const key = `${reason}:${uid}`;
  const rec = authLogCounts.get(key);
  if (!rec || now - rec.windowAt >= 60_000) {
    authLogCounts.set(key, { n: 1, windowAt: now });
  } else if (rec.n < 5) {
    rec.n += 1;
  } else {
    return;
  }
  console.warn(`[auth] 401 原因=${reason} uid=${uid} path=${req.originalUrl} ip=${req.ip || '?'}`);
  if (authLogCounts.size > 256) {
    for (const [k, v] of authLogCounts) if (now - v.windowAt >= 60_000) authLogCounts.delete(k);
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
    // 不带 token 多是客户端尚未登录/已清登录态，不是异常，记日志也限流掉了
    res.status(401).json({ error: '未登录' });
    return;
  }
  const verified = verifyToken(token);
  if (!verified.ok) {
    if (verified.reason === 'expired') {
      logAuthFail('token 过期', '?', req);
      res.status(401).json({ error: `登录已过期（超过 ${JWT_EXPIRES} 未使用），请重新登录` });
    } else {
      // 最常见成因：服务端 JWT_SECRET 变了（换 .env、重建容器没带上新增卷、换部署目录）。
      // 表现就是"所有人同一天同时被退出"。
      logAuthFail('验签失败（JWT_SECRET 可能已变更）', '?', req);
      res
        .status(401)
        .json({
          error:
            '登录凭证校验失败：服务端签名密钥可能已变更，请重新登录；若全家同时出现请检查 .env 的 JWT_SECRET',
        });
    }
    return;
  }
  const payload = verified.payload;
  const user = db
    .prepare(
      `SELECT id, username, display_name, avatar_emoji, family_id, family_role, personal_family_id, token_version
     FROM users WHERE id = ?`,
    )
    .get(payload.uid) as
    | {
        id: number;
        username: string;
        display_name: string;
        avatar_emoji: string;
        family_id: number | null;
        family_role: 'owner' | 'member' | null;
        personal_family_id: number | null;
        token_version: number;
      }
    | undefined;
  if (!user) {
    // 签名有效但账号查不到 ⇒ 服务端数据出问题了（换 DATA_DIR / 卷没挂上 / 从旧备份回滚），
    // 必须留痕：这种被当成"重新登录一下就好"会掩盖一次真实的数据丢失
    logAuthFail('账号不存在（检查数据卷/是否换过 DATA_DIR）', String(payload.uid), req);
    res.status(401).json({ error: '用户不存在：服务端查不到该账号，请先确认数据卷与数据库是否还是原来那份' });
    return;
  }
  // 旧版本签发的 token 没有 tv 载荷 → 视作 0，升级后老用户不会被强制登出；
  // 一旦改密（token_version +1）这些 token 全部失效。
  if ((payload.tv ?? 0) !== user.token_version) {
    logAuthFail(`token_version 不匹配（改过密码？本地 ${user.token_version}）`, String(payload.uid), req);
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
    { personal_family_id: number | null } | undefined;
  if (existing && existing.personal_family_id != null) {
    return existing.personal_family_id;
  }
  const tx = db.transaction(() => {
    const code = `P${userId}${String(Date.now()).slice(-6)}`;
    const info = db
      .prepare(
        "INSERT INTO families (name, invite_code, owner_id, type, created_at) VALUES (?, ?, ?, 'personal', ?)",
      )
      .run(displayName || '个人账本', code, userId, Date.now());
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
