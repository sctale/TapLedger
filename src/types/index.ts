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
  name: string;
  type: AccountType;
  emoji: string;
  color: string;
  initialBalance: number; // 初始余额
  createdAt: number;
}

// 周期记账频率
export type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

// 周期记账规则
export interface RecurringRule {
  id: number;
  name: string;
  amount: number;
  type: RecordType;
  category: string;
  accountId: number;
  frequency: RecurringFrequency;
  dayOfWeek: number;   // weekly: 0-6 (周日-周六)
  dayOfMonth: number;  // monthly/yearly: 1-31
  monthOfYear: number; // yearly: 1-12
  note: string;
  enabled: boolean;
  lastGenerated: string; // YYYY-MM-DD 最近生成日期
  createdAt: number;
}

// 转账记录
export interface Transfer {
  id: number;
  fromAccountId: number;
  toAccountId: number;
  amount: number;
  date: string;
  note: string;
  timestamp: number;
}

// 记录实体（v0.2 扩展：账户/报销）
export interface LedgerRecord {
  id: number;
  amount: number;
  category: string;
  type: RecordType;
  note: string;
  date: string;        // YYYY-MM-DD
  timestamp: number;
  accountId: number;   // 关联账户
  reimbursable: boolean; // 可报销（待报销）
  reimbursed: boolean;   // 已报销
}

// 自定义分类
export interface CustomCategory {
  key: string;
  label: string;
  emoji: string;
  color: string;
  type: RecordType;
  createdAt: number;
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
