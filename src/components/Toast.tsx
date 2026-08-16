import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONT_SIZE, RADIUS, SPACING } from '../constants';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastState {
  visible: boolean;
  message: string;
  type: ToastType;
}

interface Props {
  toast: ToastState;
  onHide: () => void;
  duration?: number;
}

export default function Toast({ toast, onHide, duration = 2000 }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  // ref 模式存回调：避免父组件内联函数导致 useEffect 定时器重建/泄漏
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;

  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (toast.visible) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 8 }),
      ]).start();
      hideTimer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(
          () => onHideRef.current()
        );
      }, duration);
    } else {
      opacity.setValue(0);
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.visible, toast.message]);

  if (!toast.visible) return null;

  const bgColor =
    toast.type === 'error' ? COLORS.danger : toast.type === 'info' ? COLORS.accent : COLORS.income;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.container, { opacity, transform: [{ translateY }], top: insets.top + SPACING.sm }]}
    >
      <Animated.View style={[styles.bubble, { backgroundColor: bgColor }]}>
        <Text style={styles.text}>{toast.message}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 100,
  },
  bubble: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    maxWidth: '85%',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: {
    color: COLORS.white,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    textAlign: 'center',
  },
});
