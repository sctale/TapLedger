// 周期记账弹窗（从 ManageScreen 迁移，v0.5.10 起支持新增/编辑两种模式）
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { COLORS, RECURRING_FREQUENCIES, getCategories } from '../../constants';
import type { RecurringRuleInput } from '../../database/ledgerDB';
import type { AccountBalance, RecurringRule, RecordType } from '../../types';
import Modal from '../../components/Modal';
import { manageStyles as styles } from './sharedStyles';

interface Props {
  visible: boolean;
  accounts: AccountBalance[];
  initialRule?: RecurringRule | null; // 编辑模式：传入原规则；新增：null/不传
  onClose: () => void;
  // editingRule 为 null 表示新增（调 addRecurringRule 的入参），非 null 表示编辑（调用方合并 id/lastGenerated 后调 updateRecurringRule）
  onSubmit: (values: RecurringRuleInput, editingRule: RecurringRule | null) => void;
}

// sharedStyles 中缺失的选中态样式（与原 ManageScreen 定义保持一致）
const localStyles = StyleSheet.create({
  pickChipOn: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
});

export default function RuleModal({ visible, accounts, initialRule = null, onClose, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<RecordType>('expense');
  const [category, setCategory] = useState('food');
  const [accountId, setAccountId] = useState(1);
  const [frequency, setFrequency] = useState<RecurringRule['frequency']>('monthly');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [monthOfYear, setMonthOfYear] = useState(1);
  const [note, setNote] = useState('');

  const isEditing = !!initialRule;

  // 打开弹窗时：编辑模式预填原规则全部字段；新增模式重置为空白初始值
  useEffect(() => {
    if (!visible) return;
    if (initialRule) {
      setName(initialRule.name);
      setAmount(String(initialRule.amount));
      setType(initialRule.type);
      setCategory(initialRule.category);
      setAccountId(initialRule.accountId);
      setFrequency(initialRule.frequency);
      setDayOfWeek(initialRule.dayOfWeek);
      setDayOfMonth(initialRule.dayOfMonth);
      setMonthOfYear(initialRule.monthOfYear);
      setNote(initialRule.note);
    } else {
      setName('');
      setAmount('');
      setType('expense');
      setCategory('food');
      setAccountId(accounts[0]?.id ?? 1);
      setFrequency('monthly');
      setDayOfWeek(1);
      setDayOfMonth(1);
      setMonthOfYear(1);
      setNote('');
    }
  }, [visible, initialRule, accounts]);

  const submit = () => {
    onSubmit(
      {
        name, amount: parseFloat(amount) || 0, type, category, accountId,
        frequency, dayOfWeek, dayOfMonth, monthOfYear, note,
        // 编辑时保留原规则的启用状态与最近生成日期，由调用方合并
        enabled: initialRule ? initialRule.enabled : true,
        lastGenerated: initialRule?.lastGenerated ?? '',
      },
      initialRule
    );
  };

  return (
    <Modal visible={visible} title={isEditing ? '编辑周期记账' : '添加周期记账'} fullscreen saveLabel={isEditing ? '保存修改' : '保存'} onClose={onClose} onSave={submit}>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>名称</Text>
          <TextInput
            style={styles.input}
            placeholder="如 工资 / 房租 / 会员订阅"
            placeholderTextColor={COLORS.textTertiary}
            value={name}
            onChangeText={setName}
            maxLength={12}
            returnKeyType="done"
          />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>金额（元）</Text>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            placeholderTextColor={COLORS.textTertiary}
            keyboardType="decimal-pad"
            returnKeyType="done"
            value={amount}
            onChangeText={(t) => setAmount(t.replace(/[^0-9.]/g, ''))}
            maxLength={9}
          />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>收支类型</Text>
          <View style={styles.typeSwitch}>
            {(['expense', 'income'] as RecordType[]).map((t) => (
              <Pressable
                key={t}
                style={[styles.typeBtn, type === t && (t === 'expense' ? styles.typeBtnExpense : styles.typeBtnIncome)]}
                onPress={() => { setType(t); if (t === 'income' && (category === 'food' || category === 'housing')) setCategory('salary'); }}
              >
                <Text style={[styles.typeText, type === t && styles.typeTextActive]}>
                  {t === 'expense' ? '支出' : '收入'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>分类</Text>
          <View style={styles.catWrap}>
            {getCategories(type).slice(0, 6).map((c) => (
              <Pressable
                key={c.key}
                style={[styles.pickChip, category === c.key && { backgroundColor: c.color, borderColor: c.color }]}
                onPress={() => setCategory(c.key)}
              >
                <Text style={styles.pickEmoji}>{c.emoji}</Text>
                <Text style={[styles.pickName, category === c.key && styles.pickNameOn]}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>账户</Text>
          <View style={styles.catWrap}>
            {accounts.map((a) => (
              <Pressable
                key={a.id}
                style={[styles.pickChip, accountId === a.id && { backgroundColor: a.color, borderColor: a.color }]}
                onPress={() => setAccountId(a.id)}
              >
                <Text style={styles.pickEmoji}>{a.emoji}</Text>
                <Text style={[styles.pickName, accountId === a.id && styles.pickNameOn]}>{a.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>频率</Text>
          <View style={styles.catWrap}>
            {RECURRING_FREQUENCIES.map((f) => (
              <Pressable
                key={f.key}
                style={[styles.pickChip, frequency === f.key && localStyles.pickChipOn]}
                onPress={() => setFrequency(f.key)}
              >
                <Text style={[styles.pickName, frequency === f.key && styles.pickNameOn]}>{f.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        {frequency === 'weekly' ? (
          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>每周几</Text>
            <View style={styles.catWrap}>
              {['日', '一', '二', '三', '四', '五', '六'].map((w, i) => (
                <Pressable
                  key={w}
                  style={[styles.pickChip, dayOfWeek === i && localStyles.pickChipOn]}
                  onPress={() => setDayOfWeek(i)}
                >
                  <Text style={[styles.pickName, dayOfWeek === i && styles.pickNameOn]}>周{w}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {frequency === 'monthly' || frequency === 'yearly' ? (
          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>{frequency === 'monthly' ? '每月几号' : '每年几月几号'}</Text>
            <View style={styles.catWrap}>
              {[1, 5, 10, 15, 20, 25, 28, 31].map((d) => (
                <Pressable
                  key={d}
                  style={[styles.pickChip, dayOfMonth === d && localStyles.pickChipOn]}
                  onPress={() => setDayOfMonth(d)}
                >
                  <Text style={[styles.pickName, dayOfMonth === d && styles.pickNameOn]}>{d}号</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {frequency === 'yearly' ? (
          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>月份</Text>
            <View style={styles.catWrap}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                <Pressable
                  key={m}
                  style={[styles.pickChip, monthOfYear === m && localStyles.pickChipOn]}
                  onPress={() => setMonthOfYear(m)}
                >
                  <Text style={[styles.pickName, monthOfYear === m && styles.pickNameOn]}>{m}月</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>备注（可选，作为记录备注）</Text>
          <TextInput
            style={styles.input}
            placeholder="如 每月工资"
            placeholderTextColor={COLORS.textTertiary}
            value={note}
            onChangeText={setNote}
            maxLength={20}
            returnKeyType="done"
          />
        </View>
    </Modal>
  );
}
