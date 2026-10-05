import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getAllRecords, getAllSettings, getRecurringRules, getCustomCategories } from '../database/ledgerDB';
import { EXPORT_VERSION, SETTING_KEYS } from '../constants';
import type { CustomCategory, ExportData, LedgerRecord, RecurringRule } from '../types';

// v0.11 安全：备份不得携带登录凭证/身份/水位等同步私有键（分享即泄露 token，导入即劫持账号）
const EXPORT_EXCLUDED_SETTINGS = new Set<string>(
  Object.values(SETTING_KEYS).filter((k) => k.startsWith('sync.')),
);

// 过滤 settings：剔除 sync.* 私有键
export function sanitizeExportSettings(settings: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (!EXPORT_EXCLUDED_SETTINGS.has(k)) out[k] = v;
  }
  return out;
}

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
      const [s, r, c] = await Promise.all([getAllSettings(), getRecurringRules(), getCustomCategories()]);
      settings = sanitizeExportSettings(s);
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
  } catch {
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

// 服务端 push 侧的字段上限（server/src/routes/sync.ts 的 zod schema）。
// 导入的数据若超限，服务端会逐条判非法并拒收，而本地已写入 → 表现为「我这有、家人没有」。
// 所以在导入入口就归一到上限内，宁可用默认值也不留一条永远传不上去的脏数据。
export const SERVER_LIMITS = {
  note: 60,
  category: 40,
  name: 20,
  label: 12,
  key: 60,
  color: 16,
  emoji: 8,
  uuidMin: 8,
  uuidMax: 64,
};

// 按码点截断（避免把 emoji 从中间切成乱码）
export function clip(value: string, max: number): string {
  const chars = Array.from(value ?? '');
  return chars.length <= max ? value : chars.slice(0, max).join('');
}

// uuid 不合法（过短/过长，多为外部工具伪造）时清空，由调用方重新生成
export function normUuid(uuid: unknown): string {
  if (typeof uuid !== 'string') return '';
  return uuid.length >= SERVER_LIMITS.uuidMin && uuid.length <= SERVER_LIMITS.uuidMax ? uuid : '';
}

// 清洗记录，补齐同步字段（v2 备份无 uuid → 自动生成）
export function normalizeRecord(r: LedgerRecord): Omit<LedgerRecord, 'id'> {
  const timestamp = Number.isFinite(r.timestamp) ? Math.max(0, Math.round(r.timestamp)) : Date.now();
  const updatedAt = Number(r.updatedAt) > 0 ? Math.round(Number(r.updatedAt)) : timestamp;
  return {
    uuid: normUuid(r.uuid),
    userId: Number(r.userId) > 0 ? Number(r.userId) : 0,
    amount: Math.round(r.amount * 100) / 100,
    category: clip(r.category, SERVER_LIMITS.category),
    type: r.type,
    note: clip(typeof r.note === 'string' ? r.note : '', SERVER_LIMITS.note),
    date: r.date,
    timestamp,
    reimbursable: Boolean(r.reimbursable),
    reimbursed: Boolean(r.reimbursed),
    updatedAt,
    deleted: Boolean(r.deleted),
  };
}
