// 家庭成员信息缓存与展示工具（v0.5 多成员体验）
import { SETTING_KEYS } from '../constants';
import { getSetting, saveSetting } from '../database/ledgerDB';

export interface MemberInfo {
  id: number;
  displayName: string;
  avatarEmoji: string;
  role: 'owner' | 'member';
}

// 成员标识色板（按 userId 循环分配，全家设备一致）
export const MEMBER_COLORS = ['#7986CB', '#FF8A65', '#81C784', '#4DB6AC', '#9575CD', '#F48FB1'];

export function memberColor(userId: number): string {
  return MEMBER_COLORS[Math.abs(userId) % MEMBER_COLORS.length];
}

// 读取成员缓存（未登录/未加入家庭返回 []）
// 兜底：已加入家庭但成员列表尚未拉到时，从本地登录态合并「自己」，
// 保证家庭账本即使只有 1 人也能显示记账人标识（v0.10.1）
export async function getCachedMembers(): Promise<MemberInfo[]> {
  try {
    const [raw, uidStr, display, avatar, familyName] = await Promise.all([
      getSetting(SETTING_KEYS.SYNC_MEMBERS_JSON),
      getSetting(SETTING_KEYS.SYNC_USER_ID),
      getSetting(SETTING_KEYS.SYNC_USER_DISPLAY),
      getSetting(SETTING_KEYS.SYNC_USER_AVATAR),
      getSetting(SETTING_KEYS.SYNC_FAMILY_NAME),
    ]);
    let list: MemberInfo[] = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) list = parsed as MemberInfo[];
      } catch {
        list = [];
      }
    }
    const uid = Number(uidStr ?? '0') || 0;
    // 仅已加入家庭（familyName 非空）才兜底合并自己：
    // 未加入家庭的纯个人使用不合并，明细页保持无记账人标识（随手记语义）
    if (uid > 0 && !!familyName && !list.some((m) => m.id === uid)) {
      list = [...list, {
        id: uid,
        displayName: display || '我',
        avatarEmoji: avatar || '🙂',
        role: 'member',
      }];
    }
    return list;
  } catch {
    return [];
  }
}

// 拉取并缓存成员列表（登录/同步/家庭变更后调用）
export async function refreshMembersCache(baseUrl: string, token: string): Promise<MemberInfo[]> {
  const { apiFamilyMembers } = await import('./apiClient');
  const { members } = await apiFamilyMembers(baseUrl, token);
  await saveSetting(SETTING_KEYS.SYNC_MEMBERS_JSON, JSON.stringify(members));
  return members;
}

// userId → 成员信息（含本地未同步兜底）
export function findMember(members: MemberInfo[], userId: number): MemberInfo | null {
  return members.find((m) => m.id === userId) ?? null;
}
