import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../constants';
import type { PadKey } from '../utils/moneyUtils';

interface Props {
  onKey: (key: PadKey) => void;
  disabled?: boolean;
}

const KEYS: PadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace'];

// 自定义数字键盘（大按键、触感反馈、零阻力输入）
function NumberPad({ onKey, disabled }: Props) {
  return (
    <View style={styles.pad}>
      {KEYS.map((key) => (
        <Pressable
          key={key}
          disabled={disabled}
          style={({ pressed }) => [
            styles.key,
            pressed && styles.keyPressed,
            disabled && styles.keyDisabled,
          ]}
          onPress={() => onKey(key)}
          android_ripple={{ color: 'rgba(0,0,0,0.08)', borderless: false }}
          accessibilityRole="button"
          accessibilityLabel={key === 'backspace' ? '退格' : key === '.' ? '小数点' : key}
        >
          {key === 'backspace' ? (
            <Text style={styles.backspace}>⌫</Text>
          ) : (
            <Text style={styles.digit}>{key}</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

export default React.memo(NumberPad);

const styles = StyleSheet.create({
  pad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: SPACING.sm,
  },
  key: {
    width: '31%',
    height: 52,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: {
    backgroundColor: COLORS.bgAlt,
  },
  keyDisabled: {
    opacity: 0.4,
  },
  digit: {
    fontSize: 24,
    color: COLORS.text,
    fontWeight: '600',
  },
  backspace: {
    fontSize: 20,
    color: COLORS.textSecondary,
  },
});
