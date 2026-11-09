// 记账日期胶囊：点一下拉起系统日期选择器（Android 原生日历，iOS 滚轮）
// 默认不显式展示「记账日期」四字，胶囊本身即入口；跨年/非今天时带上具体日期，避免误记
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { COLORS, FONT_SIZE, RADIUS, SPACING } from '../constants';
import { formatDate, formatDateLabel, getToday, parseDate } from '../utils/dateUtils';

interface Props {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  // 无障碍文案前缀（如「记账日期」「记录日期」）
  label?: string;
}

export default function DateField({ value, onChange, label = '记账日期' }: Props) {
  const [show, setShow] = useState(false);
  // 不允许记未来：记账是已经发生的事，未来日期会污染本月/近 7 天统计
  const today = parseDate(getToday());

  return (
    <View style={styles.wrap}>
      <Pressable
        style={styles.chip}
        onPress={() => setShow(true)}
        hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={`${label} ${formatDateLabel(value)}，点击修改`}
      >
        <Text style={styles.icon}>📅</Text>
        <Text style={styles.text}>{formatDateLabel(value)}</Text>
      </Pressable>
      {show ? (
        <DateTimePicker
          value={parseDate(value)}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          maximumDate={today}
          onChange={(event, date) => {
            // Android：确认（set）与取消（dismissed）都会回调，先关闭再判断
            setShow(false);
            if (event.type === 'set' && date) onChange(formatDate(date));
          }}
        />
      ) : null}
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
});
