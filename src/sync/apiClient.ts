// 后端 API 客户端：fetch 封装 + token 注入 + 超时 + 错误语义化
import { SETTING_KEYS } from '../constants';
import { getSetting } from '../database/ledgerDB';
import type { AuthUser, FamilyInfo, FamilyMember, LedgerInfo, SyncChanges } from './serverTypes';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// 当前配置（server_url + token），未配置返回 null
export async function getSyncConfig(): Promise<{ baseUrl: string; token: string } | null> {
  const [url, token] = await Promise.all([
    getSetting(SETTING_KEYS.SYNC_SERVER_URL),
    getSetting(SETTING_KEYS.SYNC_TOKEN),
  ]);
  if (!url || !token) return null;
  return { baseUrl: url.replace(/\/+$/, ''), token };
}

// 底层请求（10s 超时）
async function request<T>(
  baseUrl: string,
  path: string,
  init: { method: string; body?: unknown; token?: string }
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers: {
        'Content-Type': 'application/json',
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      throw new ApiError(data.error ?? `请求失败(${res.status})`, res.status);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if ((e as Error).name === 'AbortError') throw new ApiError('连接超时，请检查网络', 0);
    throw new ApiError('无法连接服务器', 0);
  } finally {
    clearTimeout(timer);
  }
}

// ===== 认证 =====

export async function apiRegister(baseUrl: string, username: string, password: string, displayName?: string) {
  return request<{ token: string; user: AuthUser }>(baseUrl, '/api/auth/register', {
    method: 'POST', body: { username, password, displayName },
  });
}

export async function apiLogin(baseUrl: string, username: string, password: string) {
  return request<{ token: string; user: AuthUser }>(baseUrl, '/api/auth/login', {
    method: 'POST', body: { username, password },
  });
}

export async function apiMe(baseUrl: string, token: string) {
  return request<{ user: AuthUser }>(baseUrl, '/api/me', { method: 'GET', token });
}

// ===== 家庭 =====

export async function apiCreateFamily(baseUrl: string, token: string, name: string) {
  return request<{ family: FamilyInfo; user: AuthUser }>(baseUrl, '/api/family', {
    method: 'POST', body: { name }, token,
  });
}

export async function apiJoinFamily(baseUrl: string, token: string, inviteCode: string) {
  return request<{ family: FamilyInfo; user: AuthUser }>(baseUrl, '/api/family/join', {
    method: 'POST', body: { inviteCode: inviteCode.trim().toUpperCase() }, token,
  });
}

export async function apiGetFamily(baseUrl: string, token: string) {
  return request<{ family: FamilyInfo | null }>(baseUrl, '/api/family', { method: 'GET', token });
}

export async function apiFamilyMembers(baseUrl: string, token: string) {
  return request<{ members: FamilyMember[] }>(baseUrl, '/api/family/members', { method: 'GET', token });
}

export async function apiRegenerateInvite(baseUrl: string, token: string) {
  return request<{ inviteCode: string }>(baseUrl, '/api/family/invite/regenerate', { method: 'POST', token });
}

export async function apiLeaveFamily(baseUrl: string, token: string) {
  return request<{ ok: boolean }>(baseUrl, '/api/family/leave', { method: 'POST', token });
}

// owner 移除成员（v0.5）
export async function apiRemoveMember(baseUrl: string, token: string, userId: number) {
  return request<{ ok: boolean }>(baseUrl, `/api/family/members/${userId}`, { method: 'DELETE', token });
}

// 修改自己的昵称/头像（v0.5）
export async function apiUpdateMe(baseUrl: string, token: string, patch: { displayName?: string; avatarEmoji?: string }) {
  return request<{ user: AuthUser }>(baseUrl, '/api/me', { method: 'PUT', body: patch, token });
}

// 当前用户的账本列表（个人账本 + 家庭账本）
export async function apiGetLedgers(baseUrl: string, token: string) {
  return request<{ ledgers: LedgerInfo[] }>(baseUrl, '/api/ledgers', { method: 'GET', token });
}

// ===== 同步 =====

export async function apiSyncPull(baseUrl: string, token: string, since: number, ledgerId: number) {
  return request<{ serverTime: number; changes: SyncChanges }>(baseUrl, '/api/sync/pull', {
    method: 'POST', body: { since, ledgerId }, token,
  });
}

export async function apiSyncPush(baseUrl: string, token: string, changes: Partial<SyncChanges>, ledgerId: number) {
  return request<{ serverTime: number; applied: number; rejected: number }>(baseUrl, '/api/sync/push', {
    method: 'POST', body: { ...changes, ledgerId }, token,
  });
}

// 健康检查（配置服务器地址时探测可达性）
export async function apiHealth(baseUrl: string) {
  return request<{ ok: boolean }>(baseUrl, '/api/health', { method: 'GET' });
}
