// 记账日期胶囊：点开应用内自绘日历浮层卡片
// v0.11.24：从贴底全宽面板改为居中卡片——宽度、圆角、描边与记账页卡片一致，整体上移更协调
// v0.11.23：弃用系统 Material 日历弹窗（白底蓝字与暖色系界面风格割裂），改为与全站一致的暖色圆角面板
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT_SIZE, RADIUS, SPACING } from '../constants';
import {
  addMonths,
  formatDate,
  formatDateLabel,
  getDaysInMonth,
  getFirstDayOfMonth,
  getMonthName,
  getToday,
  parseDate,
} from '../utils/dateUtils';

interface Props {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  // 无障碍文案前缀（如「记账日期」「记录日期」）
  label?: string;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export default function DateField({ value, onChange, label = '记账日期' }: Props) {
  const [show, setShow] = useState(false);
  // 面板内先选、点「确定」才提交，避免滑动浏览月份时误改已保存的日期
  const [pending, setPending] = useState(value);
  const [viewDate, setViewDate] = useState(() => parseDate(value));

  // 不允许记未来：记账是已经发生的事，未来日期会污染本月/近 7 天统计
  const today = getToday();

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth() + 1;
  const now = new Date();
  // 只能翻到当前月（含），未来月份整月不可选
  const canGoNext = year < now.getFullYear() || (year === now.getFullYear() && month - 1 < now.getMonth());

  // 固定 6 行（42 格）：不同月份行数不同时面板高度不跳动
  const cells = useMemo(() => {
    const list: (number | null)[] = [];
    const firstDay = getFirstDayOfMonth(year, month);
    const days = getDaysInMonth(year, month);
    for (let i = 0; i < firstDay; i++) list.push(null);
    for (let d = 1; d <= days; d++) list.push(d);
    while (list.length < 42) list.push(null);
    return list;
  }, [year, month]);

  const open = () => {
    setPending(value);
    setViewDate(parseDate(value));
    setShow(true);
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.chip}
        onPress={open}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={`${label} ${formatDateLabel(value)}，点击修改`}
      >
        <Text style={styles.icon}>📅</Text>
        <Text style={styles.text}>{formatDateLabel(value)}</Text>
      </Pressable>

      <Modal
        visible={show}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setShow(false)}
      >
        <View style={styles.overlay}>
          {/* 点遮罩关闭，不提交未确认的选择 */}
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setShow(false)}
            accessibilityRole="button"
            accessibilityLabel="关闭日期选择"
          />
          <View style={styles.card}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>选择日期</Text>
              <Text style={styles.sheetSub}>{formatDateLabel(pending)}</Text>
            </View>

            {/* 月份切换：右侧到当前月为止 */}
            <View style={styles.monthBar}>
              <Pressable
                style={styles.monthBtn}
                onPress={() => setViewDate(addMonths(viewDate, -1))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="上个月"
              >
                <Text style={styles.monthArrow}>‹</Text>
              </Pressable>
              <Text style={styles.monthText}>{getMonthName(viewDate)}</Text>
              <Pressable
                style={[styles.monthBtn, !canGoNext && styles.monthBtnDisabled]}
                onPress={() => canGoNext && setViewDate(addMonths(viewDate, 1))}
                disabled={!canGoNext}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="下个月"
                accessibilityState={{ disabled: !canGoNext }}
              >
                <Text style={styles.monthArrow}>›</Text>
              </Pressable>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAYS.map((w) => (
                <Text key={w} style={styles.weekText}>
                  {w}
                </Text>
              ))}
            </View>

            <View style={styles.grid}>
              {cells.map((day, idx) => {
                if (day === null) {
                  return <View key={`blank-${idx}`} style={styles.cell} />;
                }
                const dateStr = formatDate(new Date(year, month - 1, day));
                const isFuture = dateStr > today;
                const isSelected = dateStr === pending;
                const isToday = dateStr === today;
                return (
                  <View key={dateStr} style={styles.cell}>
                    <Pressable
                      style={[styles.day, isToday && styles.dayToday, isSelected && styles.daySelected]}
                      onPress={() => setPending(dateStr)}
                      disabled={isFuture}
                      accessibilityRole="button"
                      accessibilityLabel={`${month}月${day}日${isToday ? ' 今天' : ''}`}
                      accessibilityState={{ selected: isSelected, disabled: isFuture }}
                    >
                      <Text
                        style={[
                          styles.dayText,
                          isToday && styles.dayTextToday,
                          isSelected && styles.dayTextSelected,
                          isFuture && styles.dayTextFuture,
                        ]}
                      >
                        {day}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>

            <View style={styles.footer}>
              <Pressable
                style={styles.todayBtn}
                onPress={() => {
                  setPending(today);
                  setViewDate(new Date());
                }}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="选择今天"
              >
                <Text style={styles.todayText}>今天</Text>
              </Pressable>
              <View style={styles.footerActions}>
                <Pressable
                  style={styles.cancelBtn}
                  onPress={() => setShow(false)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="取消"
                >
                  <Text style={styles.cancelText}>取消</Text>
                </Pressable>
                <Pressable
                  style={styles.confirmBtn}
                  onPress={() => {
                    onChange(pending);
                    setShow(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="确定"
                >
                  <Text style={styles.confirmText}>确定</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: SPACING.xs + 1,
    gap: 4,
  },
  icon: {
    fontSize: FONT_SIZE.xs,
  },
  text: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  // ===== 居中浮层卡片（宽度/圆角/描边与记账页卡片一致） =====
  overlay: {
    flex: 1,
    backgroundColor: COLORS.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xs,
    // 浮起感：暖色阴影 + Android elevation
    shadowColor: COLORS.text,
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '800',
    color: COLORS.text,
  },
  sheetSub: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.sm,
  },
  monthBtn: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthBtnDisabled: {
    opacity: 0.35,
  },
  monthArrow: {
    fontSize: FONT_SIZE.lg,
    lineHeight: FONT_SIZE.lg + 4,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  monthText: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: COLORS.text,
  },
  weekRow: {
    flexDirection: 'row',
    marginTop: SPACING.sm,
  },
  weekText: {
    width: '14.2857%',
    textAlign: 'center',
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    fontWeight: '600',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: SPACING.xs,
  },
  cell: {
    width: '14.2857%',
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  day: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayToday: {
    borderWidth: 1.5,
    borderColor: COLORS.accent,
  },
  daySelected: {
    backgroundColor: COLORS.accent,
  },
  dayText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    fontWeight: '500',
  },
  dayTextToday: {
    color: COLORS.accent,
    fontWeight: '700',
  },
  dayTextSelected: {
    color: COLORS.white,
    fontWeight: '700',
  },
  dayTextFuture: {
    color: COLORS.borderSubtle,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: SPACING.sm,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  todayBtn: {
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  todayText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.accentDark,
    fontWeight: '700',
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cancelBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  cancelText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  confirmBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm + 2,
    marginLeft: SPACING.xs,
  },
  confirmText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.white,
    fontWeight: '700',
  },
});
