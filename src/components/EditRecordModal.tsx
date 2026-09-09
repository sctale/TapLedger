import React, { useEffect, useState } from 'react';
import {
  DeviceEventEmitter, KeyboardAvoidingView, Modal as RNModal, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT_SIZE, LEDGER_EVENTS, RADIUS, SPACING, getCategories } from '../constants';
import { updateRecord } from '../database/ledgerDB';
import { formatMoney } from '../utils/dateUtils';
import { appendKey, evaluateAmount, hasOperator, isValidAmount, toAmount, type PadKey } from '../utils/moneyUtils';
import { hapticError, hapticLight, hapticSuccess } from '../utils/haptics';
import CategorySelector from './CategorySelector';
import NumberPad from './NumberPad';
import type { LedgerRecord, RecordType } from '../types';

interface Props {
  visible: boolean;
  record: LedgerRecord | null; // 待编辑记录（null 时弹窗不渲染内容）
  onClose: () => void;
}

// 编辑记录全屏弹窗（v0.10：明细页点击记录进入）
// 布局沿用记账页（上半内容 + 固定底部数字键盘）+ 顶部 取消/标题/保存 导航栏；
// 保存后 updated_at 变更，经 RECORDED 事件触发列表刷新与 debounce 自动同步（LWW 全家一致）
export default function EditRecordModal({ visible, record, onClose }: Props) {
  const [type, setType] = useState<RecordType>('expense');
  const [amountStr, setAmountStr] = useState('');
  const [category, setCategory] = useState('food');
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [reimbursable, setReimbursable] = useState(false);
  const [saving, setSaving] = useState(false);

  // 打开时用记录内容初始化（金额转字符串供键盘继续编辑）
  useEffect(() => {
    if (visible && record) {
      setType(record.type);
      setAmountStr(String(record.amount));
      setCategory(record.category);
      setNote(record.note);
      setShowNote(!!record.note);
      setReimbursable(record.reimbursable);
      setSaving(false);
    }
  }, [visible, record]);

  // 切换收支类型：分类切到该类型第一个；待报销仅对支出有意义，切收入时重置
  const handleTypeChange = (next: RecordType) => {
    if (next === type) return;
    setType(next);
    setCategory(getCategories(next)[0]?.key ?? 'other');
    if (next === 'income') setReimbursable(false);
    hapticLight();
  };

  const handleKey = (key: PadKey) => {
    setAmountStr((prev) => appendKey(prev, key));
    hapticLight();
  };

  const handleSave = async () => {
    if (!record || !isValidAmount(amountStr)) return;
    const amount = toAmount(amountStr);
    try {
      setSaving(true);
      await updateRecord(record.id, {
        amount, category, type, note: note.trim(), reimbursable,
      });
      hapticSuccess();
      // 列表刷新 + App 层 debounce 自动同步（与新增记录同一链路）
      DeviceEventEmitter.emit(LEDGER_EVENTS.RECORDED);
      onClose();
    } catch {
      hapticError();
      setSaving(false);
    }
  };

  const canSave = isValidAmount(amountStr) && !saving;

  // 计算器友好展示 + 实时「= 结果」预览（与记账页一致）
  const displayAmount = amountStr === ''
    ? '0.00'
    : amountStr.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
  const showPreview = hasOperator(amountStr);
  const previewAmount = showPreview ? evaluateAmount(amountStr) : 0;

  return (
    <RNModal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        {/* 顶部导航栏：取消 / 标题 / 保存 */}
        <View style={styles.navBar}>
          <Pressable onPress={onClose} hitSlop={8} style={styles.navBtn} accessibilityRole="button" accessibilityLabel="取消编辑">
            <Text style={styles.navCancel}>取消</Text>
          </Pressable>
          <Text style={styles.navTitle}>编辑记录</Text>
          <Pressable
            onPress={handleSave}
            disabled={!canSave}
            hitSlop={8}
            style={styles.navBtn}
            accessibilityRole="button"
            accessibilityLabel="保存修改"
          >
            <Text style={[styles.navSave, !canSave && styles.navSaveDisabled]}>保存</Text>
          </Pressable>
        </View>

        {/* 记账卡片结构：上半内容与数字键盘连为一张卡，键盘固定卡底 */}
        <View style={styles.card}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* 收支切换 */}
            <View style={styles.typeSwitch}>
              {(['expense', 'income'] as RecordType[]).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.typeBtn, type === t && (t === 'expense' ? styles.typeBtnExpense : styles.typeBtnIncome)]}
                  onPress={() => handleTypeChange(t)}
                  accessibilityRole="button"
                  accessibilityLabel={t === 'expense' ? '改为支出' : '改为收入'}
                  accessibilityState={{ selected: type === t }}
                >
                  <Text style={[styles.typeText, type === t && styles.typeTextActive]}>
                    {t === 'expense' ? '支出' : '收入'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* 金额区 */}
            <View style={styles.amountZone}>
              <View style={styles.amountRow}>
                <Text style={[styles.amountSymbol, { color: type === 'expense' ? COLORS.expense : COLORS.income }]}>¥</Text>
                <Text
                  style={[styles.amountInput, amountStr === '' && styles.amountPlaceholder]}
                  adjustsFontSizeToFit
                  numberOfLines={1}
                  accessibilityLabel={`金额 ${displayAmount}元`}
                >
                  {displayAmount}
                </Text>
              </View>
              <View style={styles.calcSlot}>
                {showPreview ? (
                  <Text style={styles.calcPreview}>= ¥{formatMoney(previewAmount)}</Text>
                ) : null}
              </View>
            </View>

            {/* 分类选择（横向滑动一行） */}
            <CategorySelector
              categories={getCategories(type)}
              selected={category}
              onSelect={(key) => { setCategory(key); hapticLight(); }}
            />

            {/* 备注 + 待报销 */}
            <View style={styles.optionRow}>
              {showNote ? (
                <TextInput
                  style={styles.noteInput}
                  placeholder="备注（可选）"
                  placeholderTextColor={COLORS.textTertiary}
                  value={note}
                  onChangeText={setNote}
                  maxLength={30}
                  autoFocus
                />
              ) : (
                <Pressable
                  style={styles.noteToggle}
                  onPress={() => setShowNote(true)}
                  accessibilityRole="button"
                  accessibilityLabel="添加备注"
                >
                  <Text style={styles.noteToggleText}>{note ? `备注：${note}` : '＋ 添加备注'}</Text>
                </Pressable>
              )}
              {type === 'expense' ? (
                <Pressable
                  style={[styles.reimburseBtn, reimbursable && styles.reimburseBtnOn]}
                  onPress={() => { setReimbursable((v) => !v); hapticLight(); }}
                  accessibilityRole="button"
                  accessibilityLabel="标记待报销"
                  accessibilityState={{ selected: reimbursable }}
                >
                  <Text style={[styles.reimburseText, reimbursable && styles.reimburseTextOn]}>
                    待报销
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>

          {/* 数字键盘：固定卡底 */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.padDock}
          >
            <NumberPad onKey={handleKey} />
          </KeyboardAvoidingView>
        </View>
      </SafeAreaView>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  navBtn: {
    minWidth: 56,
    alignItems: 'center',
  },
  navCancel: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    fontWeight: '600',
    paddingVertical: 8,
  },
  navTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '800',
    color: COLORS.text,
  },
  navSave: {
    fontSize: FONT_SIZE.md,
    color: COLORS.accent,
    fontWeight: '700',
    paddingVertical: 8,
  },
  navSaveDisabled: {
    opacity: 0.4,
  },
  // ===== 记账卡片（与 HomeScreen 记账卡一致） =====
  card: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginHorizontal: SPACING.md,
    marginBottom: SPACING.sm,
    overflow: 'hidden',
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
    flexGrow: 1,
  },
  typeSwitch: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.pill,
    padding: 3,
  },
  typeBtn: {
    flex: 1,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
  },
  typeBtnExpense: {
    backgroundColor: COLORS.expense,
  },
  typeBtnIncome: {
    backgroundColor: COLORS.income,
  },
  typeText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  typeTextActive: {
    color: COLORS.white,
    fontWeight: '700',
  },
  amountZone: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 64,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountSymbol: {
    fontSize: FONT_SIZE.xl,
    fontWeight: '700',
    marginRight: 4,
  },
  amountInput: {
    fontSize: FONT_SIZE.display,
    fontWeight: '800',
    color: COLORS.text,
    maxWidth: '80%',
  },
  amountPlaceholder: {
    color: COLORS.borderSubtle,
  },
  calcSlot: {
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calcPreview: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textTertiary,
    textAlign: 'center',
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  noteToggle: {
    paddingVertical: 2,
    flexShrink: 1,
  },
  noteToggleText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textTertiary,
  },
  noteInput: {
    flex: 1,
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
  },
  reimburseBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginLeft: SPACING.sm,
  },
  reimburseBtnOn: {
    // v0.10.2：选中效果与「连记」统一——主色 9% 透明底 + 主色边框 + 深色文字
    backgroundColor: `${COLORS.warningBorder}18`,
    borderColor: COLORS.warningBorder,
  },
  reimburseText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  reimburseTextOn: {
    color: COLORS.warningText,
  },
  padDock: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
});
