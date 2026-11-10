// 月份切换控件（日期选择面板 / 统计页共用）
// 统一箭头尺寸、间距与月份格式，避免两处功能各写一套视觉
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT_SIZE, RADIUS, SPACING } from '../constants';

interface Props {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  nextDisabled?: boolean;
}

export default function MonthSwitcher({ label, onPrev, onNext, nextDisabled = false }: Props) {
  return (
    <View style={styles.row}>
      <Pressable
        style={styles.arrow}
        onPress={onPrev}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="上个月"
      >
        <Text style={styles.arrowText}>‹</Text>
      </Pressable>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={[styles.arrow, nextDisabled && styles.arrowDisabled]}
        onPress={() => {
          if (!nextDisabled) onNext();
        }}
        disabled={nextDisabled}
        hitSlop={8}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  arrow: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowDisabled: {
    opacity: 0.35,
  },
  arrowText: {
    fontSize: FONT_SIZE.lg,
    lineHeight: FONT_SIZE.lg + 4,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  label: {
    minWidth: 104,
    textAlign: 'center',
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: COLORS.text,
  },
});
