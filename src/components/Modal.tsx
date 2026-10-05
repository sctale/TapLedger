import React, { useCallback } from 'react';
import {
  KeyboardAvoidingView, Modal as RNModal, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT_SIZE, SPACING } from '../constants';
import Toast from './Toast';

interface Props {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  // 全屏表单模式：顶部 取消/标题/保存 导航栏 + 滚动内容 + 键盘避让。
  // 所有含输入框的表单弹窗统一走全屏，符合 iOS/Android 主流「新建页」交互。
  // （此前的底部 sheet 分支在 v0.7.1 全面转全屏后已无调用方，v0.11.8 删除；
  // 顺带去掉了 sheet 的「轻扫即关」——表单填一半时被误滑直接丢弃，且没有二次确认）
  saveLabel?: string;    // 右上角保存按钮文字（默认「保存」）
  onSave?: () => void;   // 存在则右上角显示保存按钮
  saveDisabled?: boolean;
}

export default function Modal({ visible, title, onClose, children, saveLabel = '保存', onSave, saveDisabled }: Props) {
  const close = useCallback(() => {
    onClose();
  }, [onClose]);

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
              accessibilityState={{ disabled: Boolean(saveDisabled) }}
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
        {/* 表单在自己的 Dialog 窗口里，提示层必须挂在同一窗口内才盖得住（App 根的那层在它下面） */}
        <Toast anchor="center" />
      </SafeAreaView>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  fullRoot: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  fullHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    // 导航按钮的触摸高度靠 paddingVertical 撑到 44dp 上下
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  fullHeaderBtn: {
    minWidth: 56,
    alignItems: 'center',
    paddingVertical: SPACING.xs,
  },
  fullCancel: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  fullTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '800',
    color: COLORS.text,
    flexShrink: 1,
    textAlign: 'center',
  },
  fullSave: {
    fontSize: FONT_SIZE.md,
    color: COLORS.accent,
    fontWeight: '700',
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
});
