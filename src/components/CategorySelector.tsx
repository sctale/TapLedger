import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../constants';
import type { CategoryDef } from '../types';

interface Props {
  categories: CategoryDef[];
  selected: string;
  onSelect: (key: string) => void;
}

// 分类选择器（横向滑动，只显示一行）
function CategorySelector({ categories, selected, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      {categories.map((cat) => {
        const isSelected = cat.key === selected;
        return (
          <Pressable
            key={cat.key}
            style={styles.item}
            onPress={() => onSelect(cat.key)}
            android_ripple={{ color: 'rgba(0,0,0,0.06)', borderless: false }}
            accessibilityRole="button"
            accessibilityLabel={cat.label}
            accessibilityState={{ selected: isSelected }}
          >
            <View
              style={[
                styles.circle,
                { backgroundColor: isSelected ? cat.color : `${cat.color}1F` },
                isSelected && styles.circleSelected,
              ]}
            >
              <Text style={styles.emoji}>{cat.emoji}</Text>
            </View>
            <Text style={[styles.label, isSelected && styles.labelSelected]} numberOfLines={1}>
              {cat.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default React.memo(CategorySelector);

const styles = StyleSheet.create({
  row: {
    gap: SPACING.sm + 2,
    paddingVertical: 2,
    paddingRight: SPACING.md,
  },
  item: {
    width: 60,
    alignItems: 'center',
    gap: 4,
  },
  circle: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleSelected: {
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  emoji: {
    fontSize: 22,
  },
  label: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  labelSelected: {
    color: COLORS.text,
    fontWeight: '700',
  },
});
