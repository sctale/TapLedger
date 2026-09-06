import { describe, it, expect, vi } from 'vitest';
import { isDueOn } from '../recurring';
import type { RecurringRule } from '../../types';

// recurring.ts 顶层会 import 数据库层（依赖 expo-sqlite 原生模块），
// 在纯 Node 单测里把它整体 mock 掉，只验证 isDueOn 这段纯逻辑（vitest 会把 vi.mock 提升到 import 之前）。
vi.mock('../../database/ledgerDB', () => ({
  addRecord: vi.fn(),
  getRecurringRules: vi.fn(),
  setRecurringLastGenerated: vi.fn(),
  getSetting: vi.fn(),
}));

const rule = (patch: Partial<RecurringRule>): RecurringRule =>
  ({ frequency: 'monthly', dayOfMonth: 1, dayOfWeek: 0, monthOfYear: 1, ...patch } as RecurringRule);

describe('isDueOn 周期规则到期判断', () => {
  it('daily 恒为真', () => {
    expect(isDueOn(rule({ frequency: 'daily' }), new Date(2026, 3, 7))).toBe(true);
  });

  it('weekly 按星期几匹配', () => {
    const wed = new Date(2026, 0, 7); // getDay() 依本地日期
    expect(isDueOn(rule({ frequency: 'weekly', dayOfWeek: wed.getDay() }), wed)).toBe(true);
    expect(isDueOn(rule({ frequency: 'weekly', dayOfWeek: (wed.getDay() + 1) % 7 }), wed)).toBe(false);
  });

  it('monthly 正常匹配日', () => {
    expect(isDueOn(rule({ frequency: 'monthly', dayOfMonth: 15 }), new Date(2026, 2, 15))).toBe(true);
    expect(isDueOn(rule({ frequency: 'monthly', dayOfMonth: 15 }), new Date(2026, 2, 14))).toBe(false);
  });

  it('monthly 月末兜底（31 号在小月按当月最后一天）', () => {
    // 2026-02 非闰年 → 28 天，dayOfMonth=31 兜底到 28 号
    expect(isDueOn(rule({ frequency: 'monthly', dayOfMonth: 31 }), new Date(2026, 1, 28))).toBe(true);
    expect(isDueOn(rule({ frequency: 'monthly', dayOfMonth: 31 }), new Date(2026, 1, 27))).toBe(false);
    // 2026-01 有 31 号
    expect(isDueOn(rule({ frequency: 'monthly', dayOfMonth: 31 }), new Date(2026, 0, 31))).toBe(true);
  });

  it('yearly 需同时匹配月份与日', () => {
    expect(isDueOn(rule({ frequency: 'yearly', monthOfYear: 3, dayOfMonth: 31 }), new Date(2026, 2, 31))).toBe(true);
    expect(isDueOn(rule({ frequency: 'yearly', monthOfYear: 4, dayOfMonth: 31 }), new Date(2026, 2, 31))).toBe(false);
  });

  it('未知频率返回 false', () => {
    expect(isDueOn(rule({ frequency: 'hourly' as unknown as RecurringRule['frequency'] }), new Date(2026, 0, 1))).toBe(
      false
    );
  });
});
