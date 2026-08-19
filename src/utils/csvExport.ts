import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { LedgerRecord } from '../types';
import { findCategory } from '../constants';
import { formatMoney } from './dateUtils';

// 导出 CSV（Excel 可直接打开）并分享
export async function exportCSV(records: LedgerRecord[]): Promise<{ success: boolean; error?: string }> {
  try {
    if (records.length === 0) {
      return { success: false, error: '暂无数据可导出' };
    }

    const header = ['日期', '类型', '分类', '金额', '备注', '报销状态'];
    const lines = records.map((r) => {
      const cat = findCategory(r.category, r.type);
      const status = !r.reimbursable ? '-' : r.reimbursed ? '已报销' : '待报销';
      return [
        r.date,
        r.type === 'expense' ? '支出' : '收入',
        cat.label,
        (r.type === 'expense' ? '-' : '') + formatMoney(r.amount),
        r.note,
        status,
      ];
    });
    // CSV 转义
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const csv = [header, ...lines].map((row) => row.map(escape).join(',')).join('\r\n');
    // 加 BOM 便于 Excel 识别 UTF-8
    const content = '\uFEFF' + csv;

    const fileName = `tapledger_${getDateStr()}.csv`;
    const file = new File(Paths.cache, fileName);
    file.create({ intermediates: true, overwrite: true });
    file.write(content);

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/csv',
        dialogTitle: '导出 CSV',
        UTI: 'public.comma-separated-values-text',
      });
      return { success: true };
    }
    return { success: false, error: '当前设备不支持分享' };
  } catch (e) {
    return { success: false, error: '导出失败，请重试' };
  }
}

function getDateStr(): string {
  const now = new Date();
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}
