import type { AccountType, CategoryDef, CustomCategory, RecordType, RecurringFrequency } from '../types';

// ===== 主题色（延续 TapMood 治愈暖色风格）=====
export const COLORS = {
  background: '#F8F6F3',     // 暖米白背景
  bgAlt: '#F3EFE9',          // 深一档背景
  surface: '#FFFFFF',
  surfaceAlt: '#FFF9F5',     // 暖色卡片底
  text: '#2D2D2D',           // 深灰主文字
  textSecondary: '#6E6E6E',
  textTertiary: '#857F78',   // 次次级(对比度 ≥ WCAG AA)
  border: '#F0EDE8',         // 暖灰边框
  borderSubtle: '#E8E4DE',
  accent: '#7986CB',         // 强调靛蓝
  accentDark: '#5C6BC0',
  income: '#81C784',         // 收入薄荷绿
  expense: '#FF8A65',        // 支出暖橙
  transfer: '#4DB6AC',       // 转账青色
  danger: '#E57373',
  white: '#FFFFFF',
  overlay: 'rgba(45,45,45,0.35)',          // 弹窗遮罩
  heatmap: ['#FFE0B2', '#FFB74D', '#FF8A65', '#F4511E'], // 热力图 0-3 级（暖橙=消费语义，与选中靛蓝区分）
  warningBg: '#FFF3E0',      // 待报销底色
  warningBorder: '#FFB74D',
  warningText: '#E65100',
  incomeBg: '#E8F5E9',       // 收入徽标底色
  incomeText: '#2E7D32',
};

// ===== 间距（大留白，Headspace 风格）=====
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
};

// ===== 圆角规范 =====
export const RADIUS = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  pill: 999,
};

// ===== 字体大小 =====
export const FONT_SIZE = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  xxxl: 36,
  hero: 48,
  display: 44,  // 记账页金额大字号
};

// ===== 自定义分类可选色板 =====
export const CATEGORY_COLORS = [
  '#FFB74D', '#7986CB', '#F48FB1', '#4DB6AC', '#A1887F',
  '#9575CD', '#E57373', '#64B5F6', '#FFD54F', '#90A4AE',
] as const;

// ===== 支出分类（内置柔和色系）=====
export const EXPENSE_CATEGORIES: CategoryDef[] = [
  { key: 'food',     label: '餐饮',   emoji: '🍜', color: '#FFB74D' },
  { key: 'transport', label: '交通',  emoji: '🚌', color: '#7986CB' },
  { key: 'shopping', label: '购物',   emoji: '🛍️', color: '#F48FB1' },
  { key: 'fun',      label: '娱乐',   emoji: '🎮', color: '#4DB6AC' },
  { key: 'daily',    label: '日用',   emoji: '🛒', color: '#A1887F' },
  { key: 'housing',  label: '居住',   emoji: '🏠', color: '#9575CD' },
  { key: 'medical',  label: '医疗',   emoji: '💊', color: '#E57373' },
  { key: 'education', label: '教育',  emoji: '📚', color: '#64B5F6' },
  { key: 'other',    label: '其他',   emoji: '📦', color: '#90A4AE' },
];

// ===== 收入分类（内置）=====
export const INCOME_CATEGORIES: CategoryDef[] = [
  { key: 'salary', label: '工资',   emoji: '💼', color: '#81C784' },
  { key: 'bonus',  label: '红包',   emoji: '🧧', color: '#FFD54F' },
  { key: 'invest', label: '理财',   emoji: '📈', color: '#4DB6AC' },
  { key: 'other',  label: '其他',   emoji: '💰', color: '#90A4AE' },
];

// ===== 账户类型定义 =====
export const ACCOUNT_TYPES: { key: AccountType; label: string; emoji: string }[] = [
  { key: 'cash',    label: '现金',   emoji: '💵' },
  { key: 'bank',    label: '银行卡', emoji: '💳' },
  { key: 'credit',  label: '信用卡', emoji: '🏦' },
  { key: 'alipay',  label: '支付宝', emoji: '🅰️' },
  { key: 'wechat',  label: '微信',   emoji: '💬' },
  { key: 'other',   label: '其他',   emoji: '👛' },
];

export function getAccountTypeDef(type: AccountType): { key: AccountType; label: string; emoji: string } {
  return ACCOUNT_TYPES.find((t) => t.key === type) ?? ACCOUNT_TYPES[ACCOUNT_TYPES.length - 1];
}

// ===== 自定义分类缓存（启动时从 DB 加载）=====
let customCategories: CustomCategory[] = [];

export function setCustomCategories(list: CustomCategory[]): void {
  customCategories = list;
}

export function getCustomCategories(): CustomCategory[] {
  return customCategories;
}

// 按类型取分类（内置 + 自定义）
export function getCategories(type: RecordType): CategoryDef[] {
  const builtin = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const custom = customCategories.filter((c) => c.type === type).map((c) => ({
    key: c.key,
    label: c.label,
    emoji: c.emoji,
    color: c.color,
  }));
  return [...builtin, ...custom];
}

// 根据 key 查找分类定义（跨类型兜底 + 自定义）
export function findCategory(key: string, type: RecordType): CategoryDef {
  return (
    getCategories(type).find((c) => c.key === key) ??
    [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].find((c) => c.key === key) ?? {
      key,
      label: key,
      emoji: '📌',
      color: '#90A4AE',
    }
  );
}

// ===== 周期记账频率 =====
export const RECURRING_FREQUENCIES: { key: RecurringFrequency; label: string }[] = [
  { key: 'daily',   label: '每天' },
  { key: 'weekly',  label: '每周' },
  { key: 'monthly', label: '每月' },
  { key: 'yearly',  label: '每年' },
];

export function getFrequencyLabel(f: RecurringFrequency): string {
  return RECURRING_FREQUENCIES.find((x) => x.key === f)?.label ?? f;
}

// ===== 全局事件名 =====
export const LEDGER_EVENTS = {
  RECORDED: 'ledger:recorded',
  DATA_IMPORTED: 'ledger:data_imported',
  ACCOUNTS_CHANGED: 'ledger:accounts_changed',
  CATEGORIES_CHANGED: 'ledger:categories_changed',
  SYNC_DONE: 'ledger:sync_done',       // 一轮同步完成
  AUTH_CHANGED: 'ledger:auth_changed', // 登录态变化（登录/退出/加入家庭）
} as const;

// 设置项 key
export const SETTING_KEYS = {
  MONTHLY_BUDGET: 'monthly_budget',
  DEFAULT_TYPE: 'default_type',
  DEFAULT_ACCOUNT: 'default_account',
  // ===== 家庭同步 =====
  SYNC_SERVER_URL: 'sync.server_url',
  SYNC_TOKEN: 'sync.token',
  SYNC_USER_ID: 'sync.user_id',
  SYNC_USER_DISPLAY: 'sync.user_display',
  SYNC_USER_AVATAR: 'sync.user_avatar',
  SYNC_LAST_PULL_AT: 'sync.last_pull_at',   // 服务端时间光标
  SYNC_LAST_PUSH_AT: 'sync.last_push_at',   // 本地 updated_at 水位
  SYNC_LAST_SYNC_TIME: 'sync.last_sync_time', // 上次同步完成的人类时间戳
  SYNC_MEMBERS_JSON: 'sync.members_json',   // 家庭成员缓存（v0.5 记账人标识）
} as const;

// 生成同步 uuid（时间戳36进制 + 随机串，家庭场景碰撞概率可忽略）
export function genUuid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// 导出格式版本（v3：实体带 uuid/updatedAt 同步字段；导入兼容 v2）
export const EXPORT_VERSION = 3;
