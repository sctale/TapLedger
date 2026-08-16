// 金额输入工具：把数字键盘按键序列转换为合法金额字符串
// 规则：最多 2 位小数，最多 7 位整数，不能以 0 开头（0. 除外）

export type PadKey = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '0' | '.' | 'backspace';

export function appendKey(current: string, key: string): string {
  if (key === 'backspace') {
    return current.slice(0, -1);
  }
  if (key === '.') {
    if (current.includes('.')) return current; // 已有点
    if (current === '') return '0.';           // 空 → 0.
    return current + '.';
  }
  // 数字键
  if (current.includes('.')) {
    const decimals = current.split('.')[1] ?? '';
    if (decimals.length >= 2) return current; // 最多两位小数
    return current + key;
  }
  if (current === '0') return key;            // 0 → 替换
  if (current === '' ) return key === '0' ? '0' : key;
  if (current.length >= 7) return current;    // 最多 7 位整数
  return current + key;
}

export function toAmount(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

export function isValidAmount(value: string): boolean {
  const n = toAmount(value);
  return n > 0;
}
