// 日期工具（YYYY-MM-DD 本地时区，不依赖 toISOString 避免时区偏移）

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

// 本地日期 → YYYY-MM-DD
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function getToday(): string {
  return formatDate(new Date());
}

// YYYY-MM-DD → Date（本地时区零点）
export function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function getMonthName(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

export function getWeekdayShort(date: Date): string {
  return ['日', '一', '二', '三', '四', '五', '六'][date.getDay()] ?? '';
}

// 日期胶囊文案：今天 / 昨天 / 10月26日 周一（跨年时补年份）
export function formatDateLabel(dateStr: string): string {
  const today = getToday();
  if (dateStr === today) return '今天';
  const now = new Date();
  const yesterday = formatDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  if (dateStr === yesterday) return '昨天';
  const d = parseDate(dateStr);
  const base =
    d.getFullYear() === now.getFullYear()
      ? `${d.getMonth() + 1}月${d.getDate()}日`
      : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return `${base} 周${getWeekdayShort(d)}`;
}

// 完整日期文案：2026年11月10日 周二（日期面板头部展示选中日期用）
export function formatDateFull(dateStr: string): string {
  const d = parseDate(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 周${getWeekdayShort(d)}`;
}

// 只改日期、保留原记录的时分秒（编辑记录改日期后用，同日排序仍按真实录入时间）
// 若拼出的时间晚于当前时刻（例如把昨天 23:00 改到今天），收敛到当前时刻，避免排到列表最前。
export function mergeDateKeepTime(timestamp: number, dateStr: string): number {
  const old = new Date(timestamp);
  const next = parseDate(dateStr);
  next.setHours(old.getHours(), old.getMinutes(), old.getSeconds(), old.getMilliseconds());
  const ms = next.getTime();
  return ms > Date.now() ? Date.now() : ms;
}

// 获取某月天数
export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// 获取某月第一天是周几（0=周日）
export function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

// 月份内所有日期字符串
export function getMonthDates(year: number, month: number): string[] {
  const days = getDaysInMonth(year, month);
  const dates: string[] = [];
  for (let d = 1; d <= days; d++) {
    dates.push(`${year}-${pad(month)}-${pad(d)}`);
  }
  return dates;
}

// 近 N 天日期字符串（含今天）
export function getLastNDates(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push(formatDate(d));
  }
  return out;
}

// 月份范围 [start, end]
export function getMonthRange(date: Date): { start: string; end: string } {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(getDaysInMonth(y, m))}` };
}

// 相对月份加减
export function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

// 金额格式化：1234.5 → "1,234.50"（手动实现，避免 toLocaleString 在 Hermes 上不一致）
export function formatMoney(n: number): string {
  const neg = n < 0;
  const fixed = (Math.round(Math.abs(n) * 100) / 100).toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  const withComma = (intPart ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${withComma}.${decPart ?? '00'}`;
}

// 金额简写（大数字）：12345 → "1.2万"
export function formatMoneyShort(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10000) {
    return `${(n / 10000).toFixed(abs >= 100000 ? 0 : 1)}万`;
  }
  return String(Math.round(n));
}
