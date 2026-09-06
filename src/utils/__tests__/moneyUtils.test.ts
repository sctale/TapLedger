import { describe, it, expect } from 'vitest';
import { appendKey, toAmount, isValidAmount, evaluateAmount, hasOperator } from '../moneyUtils';

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

describe('appendKey 运算符输入', () => {
  it('不能以运算符开头', () => {
    expect(appendKey('', '+')).toBe('');
    expect(appendKey('', '*')).toBe('');
  });

  it('连续运算符按最后一次替换', () => {
    expect(appendKey('12+', '-')).toBe('12-');
    expect(appendKey('12-', '*')).toBe('12*');
  });

  it('末尾裸小数点接运算符时替换该点', () => {
    expect(appendKey('12.', '+')).toBe('12+');
  });

  it('运算符后重新计数：小数两位、整数七位各自独立', () => {
    expect(appendKey('12+', '.')).toBe('12+0.');
    expect(appendKey('12+.2', '3')).toBe('12+.23');
    expect(appendKey('12+.23', '4')).toBe('12+.23'); // 第二段最多两位小数
    expect(appendKey('9+', '1234567')).toBe('9+1234567');
    expect(appendKey('9+1234567', '8')).toBe('9+1234567'); // 第二段整数最多七位
  });
});

describe('evaluateAmount 四则运算求值', () => {
  it('乘除优先于加减', () => {
    expect(evaluateAmount('2+3*4')).toBe(14);
    expect(evaluateAmount('10-6/2')).toBe(7);
    expect(evaluateAmount('2*3+4*5')).toBe(26);
  });

  it('尾部运算符被忽略、除零视为 0', () => {
    expect(evaluateAmount('12+')).toBe(12);
    expect(evaluateAmount('5/0')).toBe(0);
    expect(evaluateAmount('100/4')).toBe(25);
  });

  it('两位小数四舍五入', () => {
    expect(evaluateAmount('0.1+0.2')).toBe(0.3);
    expect(evaluateAmount('10/3')).toBe(3.33);
  });

  it('单值与空串兼容', () => {
    expect(evaluateAmount('12.5')).toBe(12.5);
    expect(evaluateAmount('')).toBe(0);
  });

  it('hasOperator / toAmount / isValidAmount 与求值一致', () => {
    expect(hasOperator('12')).toBe(false);
    expect(hasOperator('12+3')).toBe(true);
    expect(toAmount('12+3')).toBe(15);
    expect(isValidAmount('5-5')).toBe(false); // 结果 0 视为无效
    expect(isValidAmount('5+5')).toBe(true);
  });
});
