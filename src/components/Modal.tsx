import React, { useCallback, useMemo, useRef } from 'react';
import {
  Animated, Dimensions, Modal as RNModal, PanResponder, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT_SIZE, RADIUS, SPACING } from '../constants';

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  height?: number;
}

// 屏幕高度作为弹窗动画起始偏移（替代魔数，兼容不同屏高）
const SCREEN_H = Dimensions.get('window').height;

// 通用底部弹窗（下滑关闭 + 淡入淡出，适配底部安全区）
export default function Modal({ visible, title, onClose, children, height }: Props) {
  // 初始 0（正常位置）：打开动画丢失的极端情况下弹窗仍可见，不会卡在屏幕外（v0.5.5）
  const translateY = useRef(new Animated.Value(0)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  // 打开动画：由 RNModal onShow 触发（Android Dialog 内容就绪后才启动，
  // 避免在 useEffect 里过早启动导致 native driver 动画丢失、弹窗停在屏幕外，v0.5.5）
  const runOpen = useCallback(() => {
    translateY.setValue(SCREEN_H);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 9, tension: 72 }),
    ]).start();
  }, [translateY, backdropOpacity]);

  // 关闭动画
  const close = useCallback(() => {
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: SCREEN_H + 20, duration: 200, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) onClose();
    });
  }, [onClose, translateY, backdropOpacity]);

  const springBack = useCallback(() => {
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 9, tension: 72 }).start();
  }, [translateY]);

  // 下滑关闭手势（仅挂载在顶部把手区域，不干扰内部滚动）
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => g.dy > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => {
          if (g.dy > 0) translateY.setValue(g.dy);
        },
        onPanResponderRelease: (_, g) => {
          if (g.dy > 110 || g.vy > 0.8) close();
          else springBack();
        },
        onPanResponderTerminate: springBack,
      }),
    [translateY, close, springBack]
  );

  return (
    <RNModal visible={visible} transparent animationType="none" onRequestClose={close} onShow={runOpen}>
      <View style={styles.overlay}>
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
          <Pressable style={styles.backdrop} onPress={close} />
        </Animated.View>
        <Animated.View style={[styles.sheet, height ? { height } : null, { transform: [{ translateY }] }]}>
          <SafeAreaView edges={['bottom']} style={styles.safeArea}>
            <View style={styles.handleArea} {...panResponder.panHandlers}>
              <View style={styles.handle} />
            </View>
            <Text style={styles.title}>{title}</Text>
            {children}
          </SafeAreaView>
        </Animated.View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
    backgroundColor: COLORS.overlay,
  },
  sheet: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.lg,
    maxHeight: '88%',
  },
  safeArea: {
    flex: 1,
    paddingBottom: SPACING.lg, // 基础底部留白（叠加安全区 inset）
  },
  handleArea: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginTop: -10,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.borderSubtle,
    marginBottom: SPACING.xs,
  },
  title: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
});
