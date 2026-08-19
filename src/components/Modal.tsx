import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Animated, KeyboardAvoidingView, Modal as RNModal, PanResponder, Platform, Pressable,
  ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT_SIZE, RADIUS, SPACING } from '../constants';

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  height?: number;
  // 全屏表单模式（v0.7.1）：顶部 取消/标题/保存 导航栏 + 滚动内容 + 键盘避让
  // 所有含输入框的表单弹窗统一走全屏，符合 iOS/Android 主流「新建页」交互
  fullscreen?: boolean;
  saveLabel?: string;    // 右上角保存按钮文字（默认「保存」）
  onSave?: () => void;   // 存在则右上角显示保存按钮
  saveDisabled?: boolean;
}

// 通用弹窗（v0.5.8 修复 Android Dialog 定位；v0.7.1 新增全屏表单模式）
// 底部弹窗：绝对定位 bottom:0 固定 sheet，不再用 flex 居中定位，不再内嵌 KeyboardAvoidingView。
// 全屏表单：占满全屏 + 顶部导航栏 + ScrollView + KeyboardAvoidingView，适合所有含输入框的表单。
export default function Modal({ visible, title, onClose, children, height, fullscreen, saveLabel = '保存', onSave, saveDisabled }: Props) {
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

  // 下滑关闭手势（仅挂载在底部弹窗的顶部把手区域，不干扰内部滚动）
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
            close();
          } else {
            springBack();
          }
        },
        onPanResponderTerminate: springBack,
      }),
    [translateY, close, springBack]
  );

  if (fullscreen) {
    return (
      <RNModal
        visible={visible}
        transparent
        animationType="slide"   // 系统级滑入/滑出动画（Android Dialog 原生支持）
        onRequestClose={close}
      >
        <SafeAreaView style={styles.fullRoot} edges={['top', 'bottom']}>
          {/* 顶部导航栏：左取消 / 中标题 / 右保存（可选） */}
          <View style={styles.fullHeader}>
            <Pressable onPress={close} hitSlop={8} style={styles.fullHeaderBtn} accessibilityRole="button" accessibilityLabel="取消">
              <Text style={styles.fullCancel}>取消</Text>
            </Pressable>
            <Text style={styles.fullTitle} numberOfLines={1}>{title}</Text>
            {onSave ? (
              <Pressable
                onPress={onSave}
                hitSlop={8}
                disabled={saveDisabled}
                style={styles.fullHeaderBtn}
                accessibilityRole="button"
                accessibilityLabel={saveLabel}
              >
                <Text style={[styles.fullSave, saveDisabled && styles.fullSaveDisabled]}>{saveLabel}</Text>
              </Pressable>
            ) : (
              <View style={styles.fullHeaderBtn} />
            )}
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fullBody}>
            <ScrollView
              style={styles.fullScroll}
              contentContainerStyle={styles.fullContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </RNModal>
    );
  }

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
  // ===== 全屏表单模式 =====
  fullRoot: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  fullHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  fullHeaderBtn: {
    minWidth: 56,
    alignItems: 'center',
  },
  fullCancel: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    fontWeight: '600',
    paddingVertical: 8,
  },
  fullTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '800',
    color: COLORS.text,
  },
  fullSave: {
    fontSize: FONT_SIZE.md,
    color: COLORS.accent,
    fontWeight: '700',
    paddingVertical: 8,
  },
  fullSaveDisabled: {
    opacity: 0.4,
  },
  fullBody: {
    flex: 1,
  },
  fullScroll: {
    flex: 1,
  },
  fullContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },

  // ===== 底部弹窗模式 =====
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
