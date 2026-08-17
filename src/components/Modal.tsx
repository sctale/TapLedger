import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated, Modal as RNModal, KeyboardAvoidingView, PanResponder, Platform, Pressable,
  StyleSheet, Text, View,
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

// 通用底部弹窗（原生 fade 开关 + 下滑手势关闭 + 键盘避让，v0.5.6）
// 注：不再使用自定义打开/关闭动画——native driver 动画在 Android Dialog 未完成
// 首次布局时会静默丢失，导致弹窗停在屏幕外（v0.5.5 及之前"卡在最下面"的根因）
export default function Modal({ visible, title, onClose, children, height }: Props) {
  // translateY 仅在拖拽把手期间使用；每次打开前重置为 0，杜绝跨次打开的状态残留
  const translateY = useRef(new Animated.Value(0)).current;

  // 打开前同步重置拖拽偏移（v0.5.6）
  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  // 关闭：直接回调父组件 setState，视觉交给 RNModal 原生 fade out（可靠，无动画丢失风险）
  const close = useCallback(() => {
    onClose();
  }, [onClose]);

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
          if (g.dy > 110 || g.vy > 0.8) {
            // 松手下滑关闭：播一段跟手动画，同时立即回调（不等动画完成，防丢失卡关）
            Animated.timing(translateY, { toValue: 600, duration: 180, useNativeDriver: true }).start();
            close();
          } else {
            springBack();
          }
        },
        onPanResponderTerminate: springBack,
      }),
    [translateY, close, springBack]
  );

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"                    // 原生淡入淡出，替代自定义动画（v0.5.6）
      statusBarTranslucent                     // edge-to-edge 下 Dialog 与 Activity 布局对齐
      navigationBarTranslucent
      onRequestClose={close}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={close} />
        {/* 键盘弹起时整个 sheet 上移，输入框不被遮挡（主流底部弹窗做法，v0.5.6） */}
        <KeyboardAvoidingView
          behavior="padding"
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
          style={styles.kav}
          pointerEvents="box-none"
        >
          <Animated.View style={[styles.sheet, height ? { height } : null, { transform: [{ translateY }] }]}>
            <SafeAreaView edges={['bottom']} style={styles.safeArea}>
              <View style={styles.handleArea} {...panResponder.panHandlers}>
                <View style={styles.handle} />
              </View>
              <Text style={styles.title}>{title}</Text>
              {children}
            </SafeAreaView>
          </Animated.View>
        </KeyboardAvoidingView>
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
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.overlay,
  },
  kav: {
    justifyContent: 'flex-end',
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
