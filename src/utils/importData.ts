import * as DocumentPicker from 'expo-document-picker';
import { DeviceEventEmitter } from 'react-native';
import { File } from 'expo-file-system';
import {
  bulkInsertRecords, replaceAllRecords, saveSetting, addCustomCategory,
  addRecurringRule, setCustomCategoriesCache, getCategoryConfig,
} from '../database/ledgerDB';
import { LEDGER_EVENTS, EXPORT_VERSION, setCategoryConfig, setCustomCategories } from '../constants';
import { isValidRecord, normalizeRecord } from './exportData';
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
  return {
    records,
    settings: (obj.settings && typeof obj.settings === 'object' ? obj.settings : {}) as Record<string, string>,
    recurring: Array.isArray(obj.recurring) ? (obj.recurring as RecurringRule[]) : [],
    customCategories: Array.isArray(obj.customCategories) ? (obj.customCategories as CustomCategory[]) : [],
    skipped,
  };
}

// 执行导入写入
async function applyImport(data: ParsedBackup, strategy: ImportStrategy): Promise<ImportResult> {
  try {
    let failed = 0;
    // 1) 记录
    if (strategy === 'replace') {
      await replaceAllRecords(data.records);
    } else {
      await bulkInsertRecords(data.records);
    }
    // 2) 设置
    for (const [k, v] of Object.entries(data.settings)) {
      if (typeof v === 'string') await saveSetting(k, v).catch(() => {});
    }
    // 3) 周期规则
    for (const r of data.recurring) {
      try {
        await addRecurringRule({
          name: r.name, amount: r.amount, type: r.type, category: r.category,
          frequency: r.frequency, dayOfWeek: r.dayOfWeek,
          dayOfMonth: r.dayOfMonth, monthOfYear: r.monthOfYear, note: r.note,
          enabled: r.enabled, lastGenerated: r.lastGenerated,
          uuid: r.uuid || undefined, updatedAt: r.updatedAt || undefined,
          userId: r.userId || undefined,
        });
      } catch {
        failed++;
      }
    }
    // 4) 自定义分类（刷新缓存）
    for (const c of data.customCategories) {
      try {
        await addCustomCategory({
          key: c.key, label: c.label, emoji: c.emoji, color: c.color, type: c.type,
          uuid: c.uuid || undefined, updatedAt: c.updatedAt || undefined,
        });
      } catch {
        failed++;
      }
    }
    await setCustomCategoriesCache();
    const cfg = await getCategoryConfig();
    setCategoryConfig(cfg);
    DeviceEventEmitter.emit(LEDGER_EVENTS.DATA_IMPORTED);
    return { success: true, strategy, imported: data.records.length, skipped: data.skipped, failed };
  } catch (e) {
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
