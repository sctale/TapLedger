// 金额输入工具：数字键盘按键序列 → 合法「金额表达式」字符串，并安全求值
// 支持 + - * / 四则运算（随手记式），规则：
// - 单个操作数：整数最多 7 位、小数最多 2 位；不能以 0 开头（0. 除外）
// - 不允许以运算符开头、不允许连续运算符（后者替换前者）、末尾小数点后接运算符时替换该点
// - 整串长度上限，避免溢出显示

export type PadKey =
  | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '0'
  | '.' | 'backspace'
  | '+' | '-' | '*' | '/';

const MAX_EXPR_LEN = 30; // 表达式整体长度上限

function isOperator(ch: string): boolean {
  return ch === '+' || ch === '-' || ch === '*' || ch === '/';
}

// 取「当前操作数」：最后一个运算符之后的片段
function currentSegment(s: string): string {
  for (let i = s.length - 1; i >= 0; i--) {
    if (isOperator(s[i])) return s.slice(i + 1);
  }
  return s;
}

export function appendKey(current: string, key: string): string {
  if (key === 'backspace') {
    return current.slice(0, -1);
  }

  // 运算符
  if (isOperator(key)) {
    if (current === '') return current; // 不能以运算符开头
    const last = current[current.length - 1];
    if (isOperator(last)) return current.slice(0, -1) + key; // 连续运算符 → 替换
    if (last === '.') return current.slice(0, -1) + key;      // 末尾裸小数点 → 替换
    if (current.length >= MAX_EXPR_LEN) return current;
    return current + key;
  }

  // 小数点
  if (key === '.') {
    const seg = currentSegment(current);
    if (seg.includes('.')) return current;
    if (current === '' || seg === '') return current + '0.'; // 空 / 运算符后直接点 → 0.
    return current + '.';
  }

  // 数字
  const seg = currentSegment(current);
  if (seg.includes('.')) {
    const decimals = seg.split('.')[1] ?? '';
    if (decimals.length >= 2) return current; // 单个操作数最多两位小数
    return current + key;
  }
  if (seg === '0') return current.slice(0, -1) + key; // 前导 0 被替换
  if (seg.length >= 7) return current;                 // 单个操作数整数最多 7 位
  if (current.length >= MAX_EXPR_LEN) return current;
  return current + key;
}

// 安全求值：不依赖 eval。按 * / 优先于 + - 计算，容错尾部运算符、除零（视为 0）。
export function evaluateAmount(expr: string): number {
  const tokens = expr.match(/\d+(?:\.\d+)?|[+\-*/]/g);
  if (!tokens || tokens.length === 0) return 0;

  const values: number[] = [];
  const ops: string[] = [];
  const prec = (o: string): number => (o === '+' || o === '-' ? 1 : 2);

  const apply = (): boolean => {
    const o = ops[ops.length - 1];
    if (!o) return false;
    const b = values[values.length - 1];
    const a = values[values.length - 2];
    if (a === undefined || b === undefined) return false;
    ops.pop();
    values.length -= 2;
    let r: number;
    if (o === '+') r = a + b;
    else if (o === '-') r = a - b;
    else if (o === '*') r = a * b;
    else r = b === 0 ? NaN : a / b; // 除零 → NaN，末尾归零
    values.push(r);
    return true;
  };

  for (const t of tokens) {
    if (isOperator(t)) {
      while (ops.length && prec(ops[ops.length - 1]) >= prec(t)) {
        if (!apply()) break;
      }
      ops.push(t);
    } else {
      const n = Number(t);
      if (Number.isFinite(n)) values.push(n);
    }
  }
  while (ops.length) {
    if (!apply()) break;
  }

  const result = values.length ? values[values.length - 1] : 0;
  if (!Number.isFinite(result)) return 0;
  return Math.round(result * 100) / 100;
}

// 是否含运算符（用于决定是否显示「= 结果」预览）
export function hasOperator(expr: string): boolean {
  return /[+\-*/]/.test(expr);
}

export function toAmount(value: string): number {
  return evaluateAmount(value);
}

export function isValidAmount(value: string): boolean {
  return evaluateAmount(value) > 0;
}
