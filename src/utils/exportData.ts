import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  getAllRecords, getAllSettings, getRecurringRules, getCustomCategories,
} from '../database/ledgerDB';
import { EXPORT_VERSION } from '../constants';
import type { CustomCategory, ExportData, LedgerRecord, RecurringRule } from '../types';

// 导出全部数据为 JSON 文件并分享
export async function exportLedgerData(): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const records = await getAllRecords();
    if (records.length === 0) {
      return { success: false, count: 0, error: '暂无数据可导出' };
    }

    let settings: Record<string, string> = {};
    let recurring: RecurringRule[] = [];
    let customCategories: CustomCategory[] = [];
    try {
      const [s, r, c] = await Promise.all([
        getAllSettings(),
        getRecurringRules(),
        getCustomCategories(),
      ]);
      settings = s;
      recurring = r;
      customCategories = c;
    } catch {
      // 附属数据读取失败不影响记录导出
    }

    const data: ExportData = {
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      count: records.length,
      records,
      settings,
      recurring,
      customCategories,
    };

    const fileName = `tapledger_backup_${getDateStr()}.json`;
    const file = new File(Paths.cache, fileName);
    file.create({ intermediates: true, overwrite: true });
    file.write(JSON.stringify(data, null, 2));

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: '导出数据',
        UTI: 'public.json',
      });
      return { success: true, count: records.length };
    }
    return { success: false, count: records.length, error: '当前设备不支持分享' };
  } catch (e) {
    return { success: false, count: 0, error: '导出失败，请重试' };
  }
}

// 文件名日期
function getDateStr(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

// 校验单条记录（v0.3 字段；uuid 等同步字段可选）
export function isValidRecord(input: unknown): input is LedgerRecord {
  if (!input || typeof input !== 'object') return false;
  const r = input as Record<string, unknown>;
  return (
    typeof r.amount === 'number' &&
    Number.isFinite(r.amount) &&
    r.amount > 0 &&
    typeof r.category === 'string' &&
    r.category.length > 0 &&
    (r.type === 'expense' || r.type === 'income') &&
    typeof r.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(r.date) &&
    typeof r.timestamp === 'number'
  );
}

// 清洗记录，补齐同步字段（v2 备份无 uuid → 自动生成）
export function normalizeRecord(r: LedgerRecord): Omit<LedgerRecord, 'id'> {
  return {
    uuid: typeof r.uuid === 'string' && r.uuid ? r.uuid : '',
    userId: Number(r.userId) > 0 ? Number(r.userId) : 0,
    amount: Math.round(r.amount * 100) / 100,
    category: r.category,
    type: r.type,
    note: typeof r.note === 'string' ? r.note : '',
    date: r.date,
    timestamp: r.timestamp,
    reimbursable: Boolean(r.reimbursable),
    reimbursed: Boolean(r.reimbursed),
    updatedAt: Number(r.updatedAt) > 0 ? Number(r.updatedAt) : r.timestamp,
    deleted: Boolean(r.deleted),
  };
}
