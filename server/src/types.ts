// 实体与 DTO 类型定义（与 APP 端 src/types 保持字段对齐）
export type RecordType = 'expense' | 'income';

// ===== 同步实体（uuid 主键 + 墓碑软删除）=====

export interface SyncRecord {
  uuid: string;
  familyId: number;
  userId: number;          // 记账人
  amount: number;
  category: string;
  type: RecordType;
  note: string;
  date: string;            // YYYY-MM-DD
  timestamp: number;
  accountUuid: string;
  reimbursable: number;    // 0/1
  reimbursed: number;      // 0/1
  updatedAt: number;
  deleted: number;         // 0/1
}

export interface SyncAccount {
  uuid: string;
  familyId: number;
  name: string;
  type: string;
  emoji: string;
  color: string;
  initialBalance: number;
  sort: number;
  updatedAt: number;
  deleted: number;
}

export interface SyncTransfer {
  uuid: string;
  familyId: number;
  fromAccountUuid: string;
  toAccountUuid: string;
  amount: number;
  date: string;
  note: string;
  timestamp: number;
  updatedAt: number;
  deleted: number;
}

export interface SyncRecurring {
  uuid: string;
  familyId: number;
  userId: number;
  name: string;
  amount: number;
  type: RecordType;
  category: string;
  accountUuid: string;
  frequency: string;       // daily/weekly/monthly/yearly
  dayOfWeek: number;
  dayOfMonth: number;
  monthOfYear: number;
  note: string;
  enabled: number;         // 0/1
  lastGenerated: string;
  updatedAt: number;
  deleted: number;
}

export interface SyncCustomCategory {
  uuid: string;
  familyId: number;
  key: string;
  label: string;
  emoji: string;
  color: string;
  type: RecordType;
  updatedAt: number;
  deleted: number;
}

// ===== API 载荷 =====

export interface AuthUser {
  id: number;
  username: string;
  displayName: string;
  avatarEmoji: string;
  familyId: number | null;          // 家庭账本（共享）
  familyRole: 'owner' | 'member' | null;
  personalLedgerId: number | null;  // 个人账本（注册自动创建）
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

// pull 响应 / push 请求共用的变更集合
export interface SyncChanges {
  records: SyncRecord[];
  accounts: SyncAccount[];
  transfers: SyncTransfer[];
  recurring: SyncRecurring[];
  customCategories: SyncCustomCategory[];
}
