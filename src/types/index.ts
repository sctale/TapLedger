// 记账类型
export type RecordType = 'expense' | 'income';

// 分类定义
export interface CategoryDef {
  key: string;
  label: string;
  emoji: string;
  color: string;
}

// 账户类型
export type AccountType = 'cash' | 'bank' | 'credit' | 'alipay' | 'wechat' | 'other';

// 账户
export interface Account {
  id: number;
  uuid: string;         // 同步标识（本地生成，服务端主键）
  name: string;
  type: AccountType;
  emoji: string;
  color: string;
  initialBalance: number; // 初始余额
  createdAt: number;
  updatedAt: number;    // 同步用：最后更新时间戳
  deleted: boolean;     // 墓碑软删除
}

// 周期记账频率
export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

// 周期记账规则
export interface RecurringRule {
  id: number;
  uuid: string;
  userId: number;       // 创建人（0=本地未同步）
  name: string;
  amount: number;
  type: RecordType;
  category: string;
  accountId: number;
  accountUuid: string;
  frequency: RecurringFrequency;
  dayOfWeek: number;   // weekly: 0-6 (周日-周六)
  dayOfMonth: number;  // monthly/yearly: 1-31
  monthOfYear: number; // yearly: 1-12
  note: string;
  enabled: boolean;
  lastGenerated: string; // YYYY-MM-DD 最近生成日期
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

// 转账记录
export interface Transfer {
  id: number;
  uuid: string;
  fromAccountId: number;
  toAccountId: number;
  fromAccountUuid: string;
  toAccountUuid: string;
  amount: number;
  date: string;
  note: string;
  timestamp: number;
  updatedAt: number;
  deleted: boolean;
}

// 记录实体（v0.2 扩展：账户/报销；v0.3 扩展：同步字段）
export interface LedgerRecord {
  id: number;
  uuid: string;          // 同步标识
  userId: number;        // 记账人（0=本地未同步）
  amount: number;
  category: string;
  type: RecordType;
  note: string;
  date: string;        // YYYY-MM-DD
  timestamp: number;
  accountId: number;   // 关联账户（本地 id）
  accountUuid: string; // 关联账户（同步 uuid）
  reimbursable: boolean; // 可报销（待报销）
  reimbursed: boolean;   // 已报销
  updatedAt: number;
  deleted: boolean;
}

// 自定义分类
export interface CustomCategory {
  key: string;
  uuid: string;
  label: string;
  emoji: string;
  color: string;
  type: RecordType;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

// 账户余额（含计算值）
export interface AccountBalance extends Account {
  balance: number; // initial + 收支 - 转出 + 转入
}

// 统计用：单日汇总
export interface DaySummary {
  date: string;
  expense: number;
  income: number;
}

// 导出数据格式
export interface ExportData {
  version: number;
  exportedAt: string;
  count: number;
  records: LedgerRecord[];
  settings: Record<string, string>;
  accounts?: Account[];
  transfers?: Transfer[];
  recurring?: RecurringRule[];
  customCategories?: CustomCategory[];
}
