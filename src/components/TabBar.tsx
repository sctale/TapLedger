import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONT_SIZE, RADIUS, SPACING } from '../constants';

export type TabKey = 'home' | 'ledger' | 'stats' | 'manage';

interface Props {
  current: TabKey;
  onChange: (key: TabKey) => void;
}

const TABS: { key: TabKey; emoji: string; label: string }[] = [
  { key: 'home', emoji: '✏️', label: '记账' },
  { key: 'ledger', emoji: '📋', label: '明细' },
  { key: 'stats', emoji: '📊', label: '统计' },
  { key: 'manage', emoji: '⚙️', label: '管理' },
];

// 底部导航（暖色悬浮胶囊风格，适配全面屏底部安全区）
export default function TabBar({ current, onChange }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingBottom: SPACING.sm + Math.max(insets.bottom, SPACING.xs) }]}>
      <View style={styles.bar}>
        {TABS.map((tab) => {
          const active = tab.key === current;
          return (
            <Pressable
              key={tab.key}
              style={styles.item}
              onPress={() => onChange(tab.key)}
              android_ripple={{ color: 'rgba(0,0,0,0.05)', borderless: true }}
              accessibilityRole="tab"
              accessibilityLabel={tab.label}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.emoji, active && { transform: [{ scale: 1.12 }] }]}>
                {tab.emoji}
              </Text>
              <Text style={[styles.label, active && styles.labelActive]}>{tab.label}</Text>
              {active ? <View style={styles.dot} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xs,
    backgroundColor: COLORS.background,
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.xs,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: SPACING.xs,
    gap: 1,
  },
  emoji: {
    fontSize: FONT_SIZE.xxl - 8,
  },
  label: {
    fontSize: FONT_SIZE.xs - 0.5,
    color: COLORS.textTertiary,
    fontWeight: '500',
  },
  labelActive: {
    color: COLORS.accentDark,
    fontWeight: '700',
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.accent,
    marginTop: 1,
  },
});
