import type { LedgerRecord, RecurringRule } from '../types';
import { addRecord, getRecurringRules, setRecurringLastGenerated, getSetting } from '../database/ledgerDB';
import { SETTING_KEYS } from '../constants';
import { formatDate } from './dateUtils';

// 计算某规则在 date 这天是否应该生成
export function isDueOn(rule: RecurringRule, date: Date): boolean {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  switch (rule.frequency) {
    case 'daily':
      return true;
    case 'weekly':
      return date.getDay() === rule.dayOfWeek;
    case 'monthly': {
      // 处理 31 号等不存在的日期：当月最后一天兜底
      const lastDay = new Date(y, m, 0).getDate();
      const target = Math.min(rule.dayOfMonth, lastDay);
      return d === target;
    }
    case 'yearly': {
      if (rule.monthOfYear !== m) return false;
      const lastDay = new Date(y, m, 0).getDate();
      const target = Math.min(rule.dayOfMonth, lastDay);
      return d === target;
    }
    default:
      return false;
  }
}

// 规则的上一个应生成日期（用于判断是否已生成）
function previousDueDate(rule: RecurringRule, today: Date): Date | null {
  // 从今天往前找最近一个到期日
  for (let i = 0; i < 370; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    if (isDueOn(rule, d)) return d;
  }
  return null;
}

// 检查并生成到期的周期记账（App 启动 / 首页挂载时调用）
// 返回本次生成的记录数
export async function runRecurringCheck(): Promise<number> {
  const rules = await getRecurringRules();
  const today = new Date();
  let generated = 0;
  // 周期记录归属当前登录用户（未登录时为 0，家庭账本中能正确显示记账人）
  const uidStr = await getSetting(SETTING_KEYS.SYNC_USER_ID);
  const syncUserId = Number(uidStr ?? '0') || 0;

  for (const rule of rules) {
    if (!rule.enabled) continue;
    const due = previousDueDate(rule, today);
    if (!due) continue;
    const dueStr = formatDate(due);
    // 已生成过（>= lastGenerated）则跳过
    if (rule.lastGenerated && dueStr <= rule.lastGenerated) continue;

    // 生成记录（仅生成最近一个到期日，不补历史，避免刷屏）
    await addRecord(
      rule.amount,
      rule.category,
      rule.type,
      dueStr,
      rule.note || rule.name,
      false,
      { userId: syncUserId }
    );
    await setRecurringLastGenerated(rule.id, dueStr);
    generated++;
  }
  return generated;
}

// 供其他模块使用的类型引用
export type { LedgerRecord };
