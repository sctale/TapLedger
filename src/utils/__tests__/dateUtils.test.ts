import { describe, it, expect } from 'vitest';
import {
  formatDate,
  parseDate,
  addMonths,
  getDaysInMonth,
  getFirstDayOfMonth,
  getMonthRange,
  getMonthName,
  getWeekdayShort,
  formatMoney,
  formatMoneyShort,
  getLastNDates,
  getToday,
} from '../dateUtils';

describe('formatDate / parseDate（本地时区，无偏移）', () => {
  it('格式化为 YYYY-MM-DD 并补零', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatDate(new Date(2026, 11, 25))).toBe('2026-12-25');
  });

  it('解析回本地年月日', () => {
    const d = parseDate('2026-01-05');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 0, 5]);
  });

  it('format/parse 往返一致', () => {
    expect(parseDate(formatDate(new Date(2024, 1, 29)))).toBeInstanceOf(Date);
    expect(formatDate(parseDate('2023-07-04'))).toBe('2023-07-04');
  });
});

describe('月工具', () => {
  it('getDaysInMonth 处理闰年二月', () => {
    expect(getDaysInMonth(2024, 2)).toBe(29);
    expect(getDaysInMonth(2026, 2)).toBe(28);
    expect(getDaysInMonth(2026, 1)).toBe(31);
    expect(getDaysInMonth(2026, 4)).toBe(30);
  });

  it('getMonthRange 得到当月首末日', () => {
    expect(getMonthRange(new Date(2024, 1, 15))).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(getMonthRange(new Date(2026, 0, 10))).toEqual({ start: '2026-01-01', end: '2026-01-31' });
  });

  it('addMonths 跨年进位并落在 1 号', () => {
    const next = addMonths(new Date(2025, 11, 10), 1);
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2026, 0, 1]);
    const prev = addMonths(new Date(2026, 0, 3), -1);
    expect([prev.getFullYear(), prev.getMonth()]).toEqual([2025, 11]);
  });

  it('getFirstDayOfMonth 返回 0-6；getMonthName / getWeekdayShort 正常', () => {
    expect(getFirstDayOfMonth(2026, 1)).toBeGreaterThanOrEqual(0);
    expect(getFirstDayOfMonth(2026, 1)).toBeLessThanOrEqual(6);
    expect(getMonthName(new Date(2026, 1, 1))).toBe('2026年2月');
    expect(['日', '一', '二', '三', '四', '五', '六']).toContain(getWeekdayShort(new Date(2026, 0, 5)));
  });
});

describe('getLastNDates', () => {
  it('返回 n 个日期，末位为今天', () => {
    const arr = getLastNDates(7);
    expect(arr).toHaveLength(7);
    expect(arr[arr.length - 1]).toBe(getToday());
  });
});

describe('金额格式化', () => {
  it('formatMoney 千分位 + 两位小数 + 负号 + 抗浮点误差', () => {
    expect(formatMoney(0)).toBe('0.00');
    expect(formatMoney(1234.5)).toBe('1,234.50');
    expect(formatMoney(-1234.5)).toBe('-1,234.50');
    expect(formatMoney(1000000)).toBe('1,000,000.00');
    expect(formatMoney(0.1 + 0.2)).toBe('0.30');
  });

  it('formatMoneyShort 万单位缩写', () => {
    expect(formatMoneyShort(9999)).toBe('9999');
    expect(formatMoneyShort(12345)).toBe('1.2万');
    expect(formatMoneyShort(150000)).toBe('15万');
    expect(formatMoneyShort(-12345)).toBe('-1.2万');
  });
});
