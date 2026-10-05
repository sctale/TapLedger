import * as DocumentPicker from 'expo-document-picker';
import { DeviceEventEmitter } from 'react-native';
import { File } from 'expo-file-system';
import {
  bulkInsertRecords,
  replaceRecordsByIdentity,
  replaceRecurringRulesByIdentity,
  replaceCustomCategoriesByIdentity,
  saveSetting,
  addCustomCategory,
  addRecurringRule,
  setCustomCategoriesCache,
  getCategoryConfig,
} from '../database/ledgerDB';
import { LEDGER_EVENTS, EXPORT_VERSION, setCategoryConfig } from '../constants';
import {
  isValidRecord,
  normalizeRecord,
  sanitizeExportSettings,
  clip,
  normUuid,
  SERVER_LIMITS,
} from './exportData';
import type { CustomCategory, LedgerRecord, RecurringRule } from '../types';

export type ImportStrategy = 'merge' | 'replace';

export interface ImportResult {
  success: boolean;
  strategy?: ImportStrategy;
  imported: number;
  skipped: number;
  failed?: number; // 附属数据（周期/分类）写入失败条数
  error?: string;
  cancelled?: boolean;
}

interface ParsedBackup {
  records: Omit<LedgerRecord, 'id'>[];
  settings: Record<string, string>;
  recurring: RecurringRule[];
  customCategories: CustomCategory[];
  skipped: number;
  error?: string;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

// 附属数据同样要归一到服务端字段上限（记录走 normalizeRecord）
function normalizeRecurring(r: RecurringRule): RecurringRule {
  const timestamp = Number.isFinite(r.createdAt) ? Math.max(0, Math.round(r.createdAt)) : Date.now();
  const amount = Number(r.amount);
  return {
    ...r,
    uuid: normUuid(r.uuid),
    name: clip(String(r.name ?? ''), SERVER_LIMITS.name) || '订阅',
    amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : 0,
    category: clip(String(r.category ?? ''), SERVER_LIMITS.category) || 'other',
    frequency: (['daily', 'weekly', 'monthly', 'yearly'] as const).includes(r.frequency)
      ? r.frequency
      : 'monthly',
    dayOfWeek: clampInt(r.dayOfWeek, 0, 6, 0),
    dayOfMonth: clampInt(r.dayOfMonth, 1, 31, 1),
    monthOfYear: clampInt(r.monthOfYear, 1, 12, 1),
    note: clip(typeof r.note === 'string' ? r.note : '', SERVER_LIMITS.note),
    enabled: Boolean(r.enabled),
    lastGenerated: clip(typeof r.lastGenerated === 'string' ? r.lastGenerated : '', 10),
    createdAt: timestamp,
    updatedAt: Number(r.updatedAt) > 0 ? Math.round(Number(r.updatedAt)) : timestamp,
  };
}

function normalizeCategory(c: CustomCategory): CustomCategory {
  const timestamp = Number.isFinite(c.createdAt) ? Math.max(0, Math.round(c.createdAt)) : Date.now();
  const emoji = typeof c.emoji === 'string' && c.emoji.length <= SERVER_LIMITS.emoji ? c.emoji : '📌';
  return {
    ...c,
    uuid: normUuid(c.uuid),
    key: clip(String(c.key ?? ''), SERVER_LIMITS.key) || `custom_${Date.now()}`,
    label: clip(String(c.label ?? ''), SERVER_LIMITS.label) || '分类',
    emoji,
    color: clip(typeof c.color === 'string' ? c.color : '', SERVER_LIMITS.color) || '#90A4AE',
    type: c.type === 'income' ? 'income' : 'expense',
    createdAt: timestamp,
    updatedAt: Number(c.updatedAt) > 0 ? Math.round(Number(c.updatedAt)) : timestamp,
  };
}

// 解析 JSON 备份
function parseJSONBackup(text: string): ParsedBackup {
  const empty: ParsedBackup = { records: [], settings: {}, recurring: [], customCategories: [], skipped: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...empty, error: 'JSON 解析失败' };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ...empty, error: 'JSON 结构无效' };
  }
  const obj = parsed as Record<string, unknown>;
  // 兼容 v2（无同步字段）与 v3（含 uuid/updatedAt）
  if (obj.version !== 2 && obj.version !== EXPORT_VERSION) {
    return { ...empty, error: `不支持的备份版本: ${String(obj.version)}` };
  }
  if (!Array.isArray(obj.records)) {
    return { ...empty, error: '缺少 records 字段' };
  }
  const records: Omit<LedgerRecord, 'id'>[] = [];
  let skipped = 0;
  for (const r of obj.records) {
    if (isValidRecord(r)) {
      records.push(normalizeRecord(r as LedgerRecord));
    } else {
      skipped++;
    }
  }
  const recurringRaw = Array.isArray(obj.recurring) ? (obj.recurring as RecurringRule[]) : [];
  const categoriesRaw = Array.isArray(obj.customCategories) ? (obj.customCategories as CustomCategory[]) : [];
  const recurring = recurringRaw.map(normalizeRecurring);
  // 金额非正的规则传上去必被服务端判非法，导入阶段直接丢弃并计入 skipped
  const validRecurring = recurring.filter((r) => r.amount > 0);
  return {
    records,
    settings: (obj.settings && typeof obj.settings === 'object' ? obj.settings : {}) as Record<
      string,
      string
    >,
    recurring: validRecurring,
    customCategories: categoriesRaw.map(normalizeCategory),
    skipped: skipped + (recurring.length - validRecurring.length),
  };
}

// 执行导入写入
async function applyImport(data: ParsedBackup, strategy: ImportStrategy): Promise<ImportResult> {
  try {
    let failed = 0;
    // 1) 数据写入
    if (strategy === 'replace') {
      // 三张表统一按同步身份（uuid）替换：本地多出来的打墓碑、同 uuid 覆盖、新的插入。
      // 此前是「硬删本地 + 重插」，不产生墓碑 → 家人设备与服务器仍留着旧记录，
      // 换机/重装后被 pull 回来，表现为「替换导入没生效、账目翻倍」。
      await replaceRecordsByIdentity(data.records);
      await replaceRecurringRulesByIdentity(data.recurring);
      await replaceCustomCategoriesByIdentity(data.customCategories);
    } else {
      await bulkInsertRecords(data.records);
      // 3) 周期规则（合并策略逐条插入，冲突即计入 failed）
      for (const r of data.recurring) {
        try {
          await addRecurringRule({
            name: r.name,
            amount: r.amount,
            type: r.type,
            category: r.category,
            frequency: r.frequency,
            dayOfWeek: r.dayOfWeek,
            dayOfMonth: r.dayOfMonth,
            monthOfYear: r.monthOfYear,
            note: r.note,
            enabled: r.enabled,
            lastGenerated: r.lastGenerated,
            uuid: r.uuid || undefined,
            updatedAt: r.updatedAt || undefined,
            userId: r.userId || undefined,
          });
        } catch {
          failed++;
        }
      }
      // 4) 自定义分类
      for (const c of data.customCategories) {
        try {
          await addCustomCategory({
            key: c.key,
            label: c.label,
            emoji: c.emoji,
            color: c.color,
            type: c.type,
            uuid: c.uuid || undefined,
            updatedAt: c.updatedAt || undefined,
          });
        } catch {
          failed++;
        }
      }
    }
    // 2) 设置（v0.11 安全：剔除 sync.* 私有键，防止导入旧备份覆盖/劫持当前登录态）
    for (const [k, v] of Object.entries(sanitizeExportSettings(data.settings))) {
      if (typeof v === 'string') await saveSetting(k, v).catch(() => {});
    }
    await setCustomCategoriesCache();
    const cfg = await getCategoryConfig();
    setCategoryConfig(cfg);
    DeviceEventEmitter.emit(LEDGER_EVENTS.DATA_IMPORTED);
    return { success: true, strategy, imported: data.records.length, skipped: data.skipped, failed };
  } catch {
    return { success: false, imported: 0, skipped: 0, error: '数据库写入失败' };
  }
}

// 主入口：选择文件 + 解析 + 导入
export async function pickAndImportData(strategy: ImportStrategy): Promise<ImportResult> {
  let pickResult;
  try {
    pickResult = await DocumentPicker.getDocumentAsync({
      type: ['application/json', 'public.json'],
      copyToCacheDirectory: true,
    });
  } catch {
    return { success: false, imported: 0, skipped: 0, error: '无法选择文件' };
  }

  if (pickResult.canceled || !pickResult.assets || pickResult.assets.length === 0) {
    return { success: false, imported: 0, skipped: 0, cancelled: true };
  }

  const asset = pickResult.assets[0];
  const fileName = asset.name || '';
  if (!fileName.toLowerCase().endsWith('.json')) {
    return { success: false, imported: 0, skipped: 0, error: '请选择 JSON 文件' };
  }

  let text: string;
  try {
    const file = new File(asset.uri);
    text = await file.text();
  } catch {
    return { success: false, imported: 0, skipped: 0, error: '文件读取失败' };
  }

  const parsed = parseJSONBackup(text);
  if (parsed.error) {
    return { success: false, imported: 0, skipped: 0, error: parsed.error };
  }
  if (parsed.records.length === 0) {
    return { success: false, imported: 0, skipped: 0, error: '备份中无有效记录' };
  }
  return applyImport(parsed, strategy);
}
