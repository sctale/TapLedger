// 周期记账二级页面（顶栏返回按钮由外层 ManageScreen 渲染，本组件不含顶栏）
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, DeviceEventEmitter, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { COLORS, LEDGER_EVENTS, RECURRING_FREQUENCIES, SPACING, findCategory } from '../../constants';
import {
  addRecurringRule, deleteRecurringRule, getAccounts, getRecurringRules, updateRecurringRule,
  type RecurringRuleInput,
} from '../../database/ledgerDB';
import { formatMoney } from '../../utils/dateUtils';
import { hapticError, hapticLight, hapticSuccess } from '../../utils/haptics';
import { useToast } from '../../hooks/useToast';
import Toast from '../../components/Toast';
import type { AccountBalance, RecurringRule } from '../../types';
import RuleModal from './RuleModal';
import { manageStyles as styles } from './sharedStyles';

// sharedStyles 中缺失的行主体样式（可点击区域：图标 + 信息 + 金额）
const localStyles = StyleSheet.create({
  ruleMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
});

export default function RecurringScreen() {
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [ruleModal, setRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null);

  const { toast, showToast, hideToast } = useToast();

  // 自加载：规则 + 账户
  const reload = useCallback(async () => {
    try {
      const [accs, rs] = await Promise.all([getAccounts(), getRecurringRules()]);
      setAccounts(accs);
      setRules(rs);
    } catch {
      // 加载失败保持现状
    }
  }, []);

  // 挂载时加载；监听记账/导入/同步完成事件刷新，卸载时移除监听
  useEffect(() => {
    reload();
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.RECORDED, reload),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.DATA_IMPORTED, reload),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SYNC_DONE, reload),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [reload]);

  // 账户名映射（emoji + name），供行副标题显示
  const accountNames = useMemo(() => {
    const map: Record<number, string> = {};
    for (const a of accounts) map[a.id] = a.emoji + ' ' + a.name;
    return map;
  }, [accounts]);

  // ===== 保存（新增/编辑） =====
  const handleSubmit = useCallback(async (values: RecurringRuleInput, editing: RecurringRule | null) => {
    if (!values.name.trim()) {
      hapticError();
      showToast('请输入名称', 'error');
      return;
    }
    if (!(values.amount > 0)) {
      hapticError();
      showToast('请输入有效金额', 'error');
      return;
    }
    try {
      if (editing) {
        // 编辑：合并原规则（保留 id/lastGenerated 等），enabled 以原规则为准
        await updateRecurringRule({ ...editing, ...values, name: values.name.trim(), enabled: editing.enabled });
        showToast('周期记账已更新');
      } else {
        await addRecurringRule({ ...values, name: values.name.trim(), lastGenerated: '' });
        showToast('周期记账已添加');
      }
      hapticSuccess();
      setRuleModal(false);
      await reload();
    } catch {
      hapticError();
      showToast(editing ? '保存失败' : '添加失败', 'error');
    }
  }, [reload, showToast]);

  // ===== 启用开关 =====
  const handleToggleRule = useCallback(async (rule: RecurringRule) => {
    try {
      await updateRecurringRule({ ...rule, enabled: !rule.enabled });
      hapticLight();
      await reload();
    } catch {
      hapticError();
    }
  }, [reload]);

  // ===== 删除（二次确认） =====
  const handleDeleteRule = useCallback((rule: RecurringRule) => {
    Alert.alert('删除周期记账', `删除「${rule.name}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteRecurringRule(rule.id);
            hapticSuccess();
            await reload();
          } catch {
            hapticError();
          }
        },
      },
    ]);
  }, [reload]);

  // 打开新增弹窗
  const openAdd = () => {
    setEditingRule(null);
    setRuleModal(true);
  };

  // 打开编辑弹窗（点击行主体）
  const openEdit = (rule: RecurringRule) => {
    setEditingRule(rule);
    setRuleModal(true);
  };

  return (
    <View style={styles.scroll}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          {rules.length === 0 ? (
            <Text style={styles.emptyText}>还没有周期记账，添加工资/房租/订阅等自动记账 ✨</Text>
          ) : (
            rules.map((rule) => {
              const cat = findCategory(rule.category, rule.type);
              const freqLabel = RECURRING_FREQUENCIES.find((f) => f.key === rule.frequency)?.label ?? rule.frequency;
              return (
                <View key={rule.id} style={styles.ruleRow}>
                  {/* 行主体可点击 → 打开编辑弹窗；开关与删除在 Pressable 之外，保留独立行为 */}
                  <Pressable style={localStyles.ruleMain} onPress={() => openEdit(rule)}>
                    <View style={[styles.accIcon, { backgroundColor: `${cat.color}22` }]}>
                      <Text style={styles.accEmoji}>{cat.emoji}</Text>
                    </View>
                    <View style={styles.accInfo}>
                      <Text style={styles.accName}>{rule.name}</Text>
                      <Text style={styles.accType}>{freqLabel} · {cat.label} · {accountNames[rule.accountId] ?? '现金'}</Text>
                    </View>
                    <Text style={[styles.accBalance, { color: rule.type === 'expense' ? COLORS.expense : COLORS.income }]}>
                      {rule.type === 'expense' ? '-' : '+'}{formatMoney(rule.amount)}
                    </Text>
                  </Pressable>
                  <Switch
                    value={rule.enabled}
                    onValueChange={() => handleToggleRule(rule)}
                    trackColor={{ false: COLORS.border, true: COLORS.accent }}
                    thumbColor={COLORS.white}
                    style={{ transform: [{ scale: 0.8 }] }}
                  />
                  <Pressable onPress={() => handleDeleteRule(rule)} hitSlop={8}>
                    <Text style={styles.accDeleteText}>✕</Text>
                  </Pressable>
                </View>
              );
            })
          )}
          <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.accent }]} onPress={openAdd}>
            <Text style={styles.actionBtnText}>＋ 添加周期记账</Text>
          </Pressable>
        </View>
      </ScrollView>
      <Toast toast={toast} onHide={hideToast} />
      <RuleModal
        visible={ruleModal}
        accounts={accounts}
        initialRule={editingRule}
        onClose={() => setRuleModal(false)}
        onSubmit={handleSubmit}
      />
    </View>
  );
}
