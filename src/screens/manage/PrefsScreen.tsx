import React, { useCallback, useEffect, useState } from 'react';
import {
  DeviceEventEmitter, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { COLORS, LEDGER_EVENTS, SETTING_KEYS } from '../../constants';
import { getSetting, saveSetting } from '../../database/ledgerDB';
import { hapticError, hapticLight, hapticSuccess } from '../../utils/haptics';
import { useToast } from '../../hooks/useToast';
import Toast from '../../components/Toast';
import { manageStyles } from './sharedStyles';

// 本页补充样式（sharedStyles 未覆盖的键，值与原 ManageScreen styles 一致）
const extraStyles = StyleSheet.create({
  kavContainer: {
    flex: 1,
  },
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});

// 共用样式 + 本页补充（键名与原 ManageScreen styles 保持一致）
const styles = { ...manageStyles, ...extraStyles };

// 偏好设置二级页（v0.5.9 从 ManageScreen 拆分；顶栏返回按钮由外层 ManageScreen 统一渲染）
export default function PrefsScreen() {
  const [budgetText, setBudgetText] = useState('');
  const [defaultIncome, setDefaultIncome] = useState(false);

  const { toast, showToast, hideToast } = useToast();

  // 挂载时读取预算与默认收支类型
  useEffect(() => {
    (async () => {
      try {
        const [budget, type] = await Promise.all([
          getSetting(SETTING_KEYS.MONTHLY_BUDGET),
          getSetting(SETTING_KEYS.DEFAULT_TYPE),
        ]);
        setBudgetText(budget ?? '');
        setDefaultIncome(type === 'income');
      } catch {
        // 读取失败保持默认
      }
    })();
  }, []);

  // ===== 偏好设置操作（照搬 ManageScreen） =====
  const handleSaveBudget = useCallback(async () => {
    const n = parseFloat(budgetText);
    if (budgetText.trim() === '') {
      await saveSetting(SETTING_KEYS.MONTHLY_BUDGET, '');
      hapticSuccess();
      showToast('已取消月度预算');
      DeviceEventEmitter.emit(LEDGER_EVENTS.SETTINGS_CHANGED); // 通知首页/统计页即时刷新（v0.5.5）
      return;
    }
    if (!Number.isFinite(n) || n <= 0) {
      hapticError();
      showToast('请输入有效金额', 'error');
      return;
    }
    await saveSetting(SETTING_KEYS.MONTHLY_BUDGET, String(Math.round(n * 100) / 100));
    hapticSuccess();
    showToast('月度预算已保存');
    DeviceEventEmitter.emit(LEDGER_EVENTS.SETTINGS_CHANGED); // 通知首页/统计页即时刷新（v0.5.5）
  }, [budgetText, showToast]);

  const handleDefaultType = useCallback(async (value: boolean) => {
    setDefaultIncome(value);
    await saveSetting(SETTING_KEYS.DEFAULT_TYPE, value ? 'income' : 'expense');
    hapticLight();
  }, []);

  return (
    // 键盘避让：键盘弹出时内容上移，预算保存按钮不被遮挡（v0.5.7）
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kavContainer}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"  /* 键盘弹出时点击保存按钮不被吞掉（v0.5.7） */
      >
        {/* ===== 偏好设置 ===== */}
        <Text style={styles.sectionTitle}>偏好设置</Text>
        <View style={styles.card}>
          <View style={styles.budgetRow}>
            <Text style={styles.label}>每月支出预算（元）</Text>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="如 3000"
              placeholderTextColor={COLORS.textTertiary}
              keyboardType="decimal-pad"
              returnKeyType="done"
              value={budgetText}
              onChangeText={(t) => setBudgetText(t.replace(/[^0-9.]/g, ''))}
              maxLength={8}
            />
            <Pressable style={styles.primaryBtn} onPress={handleSaveBudget}>
              <Text style={styles.primaryBtnText}>保存</Text>
            </Pressable>
          </View>
          <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
              <Text style={styles.label}>默认记收入</Text>
              <Text style={styles.hint}>打开后首页记账默认切换为收入</Text>
            </View>
            <Switch
              value={defaultIncome}
              onValueChange={handleDefaultType}
              trackColor={{ false: COLORS.border, true: COLORS.income }}
              thumbColor={COLORS.white}
            />
          </View>
        </View>

        <Toast toast={toast} onHide={hideToast} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
