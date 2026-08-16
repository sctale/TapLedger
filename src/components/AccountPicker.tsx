import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../constants';
import type { AccountBalance } from '../types';
import { formatMoney } from '../utils/dateUtils';

interface Props {
  accounts: AccountBalance[];
  selectedId: number;
  onSelect: (id: number) => void;
}

// 账户选择器（横向滚动胶囊）
function AccountPicker({ accounts, selectedId, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {accounts.map((acc) => {
        const isSelected = acc.id === selectedId;
        return (
          <Pressable
            key={acc.id}
            style={[styles.chip, isSelected && { backgroundColor: acc.color, borderColor: acc.color }]}
            onPress={() => onSelect(acc.id)}
            android_ripple={{ color: 'rgba(0,0,0,0.06)' }}
            accessibilityRole="button"
            accessibilityLabel={`${acc.name}账户`}
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={styles.chipEmoji}>{acc.emoji}</Text>
            <Text style={[styles.chipName, isSelected && styles.chipTextSelected]}>{acc.name}</Text>
            <Text style={[styles.chipBalance, isSelected && styles.chipTextSelected]}>
              {formatMoney(acc.balance)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default React.memo(AccountPicker);

const styles = StyleSheet.create({
  row: {
    gap: SPACING.sm,
    paddingVertical: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.md,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipEmoji: {
    fontSize: 14,
  },
  chipName: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: '600',
  },
  chipBalance: {
    fontSize: 11,
    color: COLORS.textTertiary,
  },
  chipTextSelected: {
    color: COLORS.white,
  },
});
