import { describe, it, expect } from 'vitest';
import { appendKey, toAmount, isValidAmount } from '../moneyUtils';

describe('appendKey 数字键盘金额拼装', () => {
  it('从空开始输入数字', () => {
    expect(appendKey('', '5')).toBe('5');
    expect(appendKey('', '0')).toBe('0');
  });

  it('前导 0 被替换、0 后接小数点补成 0.', () => {
    expect(appendKey('0', '5')).toBe('5');
    expect(appendKey('', '.')).toBe('0.');
  });

  it('最多两位小数，且不允许第二个小数点', () => {
    expect(appendKey('1', '.')).toBe('1.');
    expect(appendKey('1.', '2')).toBe('1.2');
    expect(appendKey('1.2', '3')).toBe('1.23');
    expect(appendKey('1.23', '4')).toBe('1.23'); // 超两位小数被忽略
    expect(appendKey('1.23', '.')).toBe('1.23'); // 已有点
  });

  it('整数最多 7 位', () => {
    expect(appendKey('123456', '7')).toBe('1234567');
    expect(appendKey('1234567', '8')).toBe('1234567');
  });

  it('退格删除末位', () => {
    expect(appendKey('12.5', 'backspace')).toBe('12.');
    expect(appendKey('1', 'backspace')).toBe('');
  });
});

describe('toAmount / isValidAmount', () => {
  it('解析金额，非法/空回退 0', () => {
    expect(toAmount('12.5')).toBe(12.5);
    expect(toAmount('')).toBe(0);
    expect(toAmount('abc')).toBe(0);
  });

  it('仅正数为有效金额', () => {
    expect(isValidAmount('0')).toBe(false);
    expect(isValidAmount('0.00')).toBe(false);
    expect(isValidAmount('')).toBe(false);
    expect(isValidAmount('0.5')).toBe(true);
    expect(isValidAmount('99')).toBe(true);
  });
});
