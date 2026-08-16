import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT_SIZE, RADIUS, SPACING } from '../constants';
import { formatMoneyShort, getDaysInMonth, getFirstDayOfMonth } from '../utils/dateUtils';

interface Props {
  year: number;
  month: number;          // 1-12
  dailyExpense: Record<string, number>; // date -> 支出金额
  maxExpense: number;     // 当月最大单日支出
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

// 月历热力图（颜色深浅 = 消费高低，色盲友好）
export default function MonthHeatmap({
  year,
  month,
  dailyExpense,
  maxExpense,
  selectedDate,
  onSelectDate,
}: Props) {
  const days = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const cells: (number | null)[] = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  // 按周分行（每行 7 格 flex 平分，替代百分比魔数，任意屏宽不溢出）
  // 末行不满 7 格时补空白占位，否则剩余日期格 flex:1 平分整行会异常超宽
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  // 按消费金额分 4 级（颜色由浅到深）；返回 [背景色, 是否深底(文字用白)]
  const levelStyle = (amount: number): [string, boolean] => {
    if (amount <= 0) return [COLORS.surface, false];
    const ratio = maxExpense > 0 ? amount / maxExpense : 0;
    if (ratio < 0.25) return [COLORS.heatmap[0], false];
    if (ratio < 0.5) return [COLORS.heatmap[1], false];
    if (ratio < 0.75) return [COLORS.heatmap[2], false];
    return [COLORS.heatmap[3], true]; // 最深档橙底，深灰字对比不足改白字
  };

  return (
    <View>
      <View style={styles.weekHeader}>
        {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
          <Text key={w} style={styles.weekLabel}>{w}</Text>
        ))}
      </View>
      <View style={styles.grid}>
        {weeks.map((week, wi) => (
          <View key={`week-${wi}`} style={styles.weekRow}>
            {week.map((day, idx) => {
              if (day === null) return <View key={`blank-${wi}-${idx}`} style={styles.cell} />;
              const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const amount = dailyExpense[dateStr] ?? 0;
              const isSelected = dateStr === selectedDate;
              const isToday = dateStr === todayStr();
              const [bg, isDeep] = levelStyle(amount);
              return (
                <Pressable
                  key={dateStr}
                  style={[
                    styles.cell,
                    { backgroundColor: bg },
                    isSelected && styles.cellSelected,
                    isToday && !isSelected && styles.cellToday,
                  ]}
                  onPress={() => onSelectDate(dateStr)}
                  accessibilityRole="button"
                  accessibilityLabel={`${month}月${day}日${amount > 0 ? `支出${formatMoneyShort(amount)}元` : '无支出'}`}
                >
                  <Text style={[styles.dayText, amount > 0 && styles.dayTextActive, isDeep && !isSelected && styles.dayTextDeep, isSelected && styles.dayTextSelected, isToday && !isSelected && styles.dayTextToday]}>
                    {day}
                  </Text>
                  {amount > 0 ? (
                    <Text style={[styles.amountText, isDeep && !isSelected && styles.amountTextDeep, isSelected && styles.dayTextSelected]} numberOfLines={1}>
                      {formatMoneyShort(amount)}
                    </Text>
                  ) : null}
                  {isToday && !isSelected ? <View style={styles.todayDot} /> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  weekHeader: {
    flexDirection: 'row',
    marginBottom: SPACING.xs,
  },
  weekLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
  },
  grid: {
    gap: 6,
  },
  weekRow: {
    flexDirection: 'row',
    gap: 4,
  },
  cell: {
    flex: 1,
    aspectRatio: 0.92,
    borderRadius: RADIUS.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderSubtle,
    paddingHorizontal: 1,
  },
  cellSelected: {
    borderWidth: 2,
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentDark, // 实底强调（覆盖热力浅色），白字对比度约 5:1
  },
  cellToday: {
    borderColor: COLORS.accent,
  },
  todayDot: {
    position: 'absolute',
    bottom: 3,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.accent,
  },
  dayText: {
    fontSize: FONT_SIZE.xs + 1,
    color: COLORS.textTertiary,
    fontWeight: '500',
  },
  dayTextActive: {
    color: COLORS.text,
    fontWeight: '700',
  },
  dayTextToday: {
    color: COLORS.accentDark,
  },
  dayTextSelected: {
    color: COLORS.white,
  },
  dayTextDeep: {
    color: COLORS.white,
  },
  amountText: {
    fontSize: FONT_SIZE.xs - 2.5,
    color: 'rgba(45,45,45,0.75)',
    fontWeight: '600',
    marginTop: 1,
  },
  amountTextDeep: {
    color: 'rgba(255,255,255,0.9)',
  },
});
