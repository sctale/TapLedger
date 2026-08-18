import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated, Modal as RNModal, PanResponder, Pressable, StyleSheet, Text, View,
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

// 通用底部弹窗（绝对定位 + 原生 slide，v0.5.8）
// 根因修复：不再用 flex justifyContent:'flex-end' 在 Android Dialog 中定位，
// 改为绝对定位 bottom:0 固定 sheet；不再内嵌 KeyboardAvoidingView，避免 Dialog 布局测量冲突。
export default function Modal({ visible, title, onClose, children, height }: Props) {
  // translateY 仅用于拖拽把手时的跟手偏移；系统 slide 动画负责打开/关闭
  const translateY = useRef(new Animated.Value(0)).current;

  // 每次打开前重置拖拽偏移（防止上一次拖拽残留）
  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  const close = useCallback(() => {
    onClose();
  }, [onClose]);

  const springBack = useCallback(() => {
    Animated.spring(translateY, {
      toValue: 0,
      useNativeDriver: true,
      friction: 9,
      tension: 72,
    }).start();
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
            // 直接回调关闭，RNModal 原生 slide out 负责下滑消失动画
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
      animationType="slide"   // 系统级底部滑入/滑出动画（Android Dialog 原生支持）
      onRequestClose={close}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={close} />
        <Animated.View
          style={[
            styles.sheet,
            height ? { height } : null,
            { transform: [{ translateY }] },
          ]}
        >
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
    flex: 1, // RNModal slide 动画需要根 View 参与布局
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.overlay,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
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
