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
  accountUuid: string;
  reimbursable: number;
  reimbursed: number;
  updatedAt: number;
  deleted: number;
}

export interface SyncAccountDTO {
  uuid: string;
  name: string;
  type: string;
  emoji: string;
  color: string;
  initialBalance: number;
  sort: number;
  updatedAt: number;
  deleted: number;
}

export interface SyncTransferDTO {
  uuid: string;
  fromAccountUuid: string;
  toAccountUuid: string;
  amount: number;
  date: string;
  note: string;
  timestamp: number;
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
  accountUuid: string;
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
  accounts: SyncAccountDTO[];
  transfers: SyncTransferDTO[];
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
