// 月份切换控件（日期选择面板 / 统计页共用）
// v0.11.27：收成一个完整的胶囊控件（箭头与月份同容器），不再让两个圆形按钮散落在页面上
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT_SIZE, RADIUS } from '../constants';

interface Props {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}

export default function MonthSwitcher({ label, onPrev, onNext, nextDisabled = false }: Props) {
  return (
    <View style={styles.pill}>
      <Pressable
        style={({ pressed }) => [styles.arrow, pressed && styles.arrowPressed]}
        onPress={onPrev}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="上个月"
      >
        <Text style={styles.arrowText}>‹</Text>
      </Pressable>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={({ pressed }) => [
          styles.arrow,
          pressed && styles.arrowPressed,
          nextDisabled && styles.arrowDisabled,
        ]}
        onPress={() => {
          if (!nextDisabled) onNext();
        }}
        disabled={nextDisabled}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel="下个月"
        accessibilityState={{ disabled: nextDisabled }}
      >
        <Text style={styles.arrowText}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // 胶囊容器：箭头与月份标签成为一个整体控件
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.pill,
    padding: 3,
  },
  arrow: {
    width: 30,
    height: 30,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowPressed: {
    backgroundColor: COLORS.surface,
  },
  arrowDisabled: {
    opacity: 0.3,
  },
  arrowText: {
    fontSize: FONT_SIZE.lg,
    lineHeight: FONT_SIZE.lg + 5,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  label: {
    minWidth: 96,
    textAlign: 'center',
    fontSize: FONT_SIZE.md,
    fontWeight: '800',
    color: COLORS.text,
  },
});
