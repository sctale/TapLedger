import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../constants';
import type { PadKey } from '../utils/moneyUtils';

interface Props {
  onKey: (key: PadKey) => void;
  disabled?: boolean;
}

// 4 列布局，右列为四则运算符（随手记式）
const ROWS: PadKey[][] = [
  ['7', '8', '9', '/'],
  ['4', '5', '6', '*'],
  ['1', '2', '3', '-'],
  ['.', '0', 'backspace', '+'],
];

const OP_LABEL: Record<string, string> = { '/': '÷', '*': '×', '-': '−', '+': '+' };
const OP_ACCESSIBILITY: Record<string, string> = { '/': '除', '*': '乘', '-': '减', '+': '加' };

const isOperator = (key: PadKey): boolean => key === '+' || key === '-' || key === '*' || key === '/';

// 自定义数字键盘（大按键、触感反馈、支持 + - * / 四则运算）
function NumberPad({ onKey, disabled }: Props) {
  return (
    <View style={styles.pad}>
      {ROWS.map((row) => (
        <View key={row.join('')} style={styles.keyRow}>
          {row.map((key) => {
            const op = isOperator(key);
            const label = key === 'backspace' ? '⌫' : op ? OP_LABEL[key] : key;
            const a11y = key === 'backspace' ? '退格' : op ? OP_ACCESSIBILITY[key] : key === '.' ? '小数点' : key;
            return (
              <Pressable
                key={key}
                disabled={disabled}
                style={({ pressed }) => [
                  styles.key,
                  op && styles.keyOp,
                  pressed && styles.keyPressed,
                  disabled && styles.keyDisabled,
                ]}
                onPress={() => onKey(key)}
                android_ripple={{ color: 'rgba(0,0,0,0.08)', borderless: false }}
                accessibilityRole="button"
                accessibilityLabel={a11y}
              >
                <Text style={[styles.digit, op && styles.opText, key === 'backspace' && styles.backspace]}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export default React.memo(NumberPad);

const styles = StyleSheet.create({
  pad: {
    gap: SPACING.sm,
  },
  keyRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  key: {
    flex: 1,
    height: 52,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyOp: {
    backgroundColor: COLORS.bgAlt,
    borderColor: COLORS.borderSubtle,
  },
  keyPressed: {
    backgroundColor: COLORS.borderSubtle,
  },
  keyDisabled: {
    opacity: 0.4,
  },
  digit: {
    fontSize: 24,
    color: COLORS.text,
    fontWeight: '600',
  },
  opText: {
    color: COLORS.accentDark,
    fontWeight: '700',
  },
  backspace: {
    fontSize: 20,
    color: COLORS.textSecondary,
  },
});
