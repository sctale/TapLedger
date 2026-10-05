// 与 server/src/types.ts 字段对齐的客户端类型
export interface SyncRecordDTO {
  uuid: string;
  userId: number;
  amount: number;
  category: string;
  type: 'expense' | 'income';
  note: string;
  date: string;
  timestamp: number;
  reimbursable: number;
  reimbursed: number;
  updatedAt: number;
  deleted: number;
}

export interface SyncRecurringDTO {
  uuid: string;
  userId: number;
  name: string;
  amount: number;
  type: 'expense' | 'income';
  category: string;
  frequency: string;
  dayOfWeek: number;
  dayOfMonth: number;
  monthOfYear: number;
  note: string;
  enabled: number;
  lastGenerated: string;
  updatedAt: number;
  deleted: number;
}

export interface SyncCustomCategoryDTO {
  uuid: string;
  key: string;
  label: string;
  emoji: string;
  color: string;
  type: 'expense' | 'income';
  updatedAt: number;
  deleted: number;
}

export interface SyncChanges {
  records: SyncRecordDTO[];
  recurring: SyncRecurringDTO[];
  customCategories: SyncCustomCategoryDTO[];
}

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  avatarEmoji: string;
  familyId: number | null;
  familyRole: 'owner' | 'member' | null;
  personalLedgerId: number | null;  // 个人账本 id（注册自动创建）
  personalLedgerName: string;       // 个人账本名
}

export type LedgerType = 'personal' | 'family';

// 用户可访问的账本（个人账本 + 家庭账本）
export interface LedgerInfo {
  id: number;
  name: string;
  type: LedgerType;
  role: 'owner' | 'member';
}

export interface FamilyInfo {
  id: number;
  name: string;
  inviteCode: string;
  ownerId: number;
}

export interface FamilyMember {
  id: number;
  displayName: string;
  avatarEmoji: string;
  role: 'owner' | 'member';
}

// POST /api/sync/push 的响应（server 0.5.6 起把「未生效」拆成两类）
export interface PushResult {
  serverTime: number;
  applied: number;
  rejected: number;        // = skipped + invalid，兼容只看这个字段的老客户端
  skipped?: number;        // 版本不比服务端新 / uuid 属于别的账本：幂等丢弃，不用打扰用户
  invalid?: number;        // 字段超出服务端限制：本地已写入但传不上去，必须如实提示
  invalidIds?: string[];   // 非法条目样本（最多 20 个 uuid）
  errors?: string[];
}
