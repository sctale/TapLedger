import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler,
  DeviceEventEmitter,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { COLORS, FONT_SIZE, LEDGER_EVENTS, RADIUS, SPACING, getCategories } from '../constants';
import { updateRecord } from '../database/ledgerDB';
import { formatMoney } from '../utils/dateUtils';
import {
  appendKey,
  evaluateAmount,
  hasOperator,
  isValidAmount,
  toAmount,
  type PadKey,
} from '../utils/moneyUtils';
import { hapticError, hapticLight, hapticSuccess } from '../utils/haptics';
import CategorySelector from './CategorySelector';
import NumberPad from './NumberPad';
import type { LedgerRecord, RecordType } from '../types';

interface Props {
  visible: boolean;
  record: LedgerRecord | null; // 待编辑记录（null 时不渲染）
  onClose: () => void;
}

// 编辑记录全屏页（v0.10：明细页点击记录进入）
// v0.11.4 根因修复：弃用 RNModal——Android 上它是独立 Dialog 窗口（RN 内部强制
// disableEdgeToEdge + 已废弃的 ADJUST_RESIZE），与本项目 edge-to-edge 的 Activity
// 坐标系不一致，导致卡底数字键盘 Pressable 触摸失灵/被 IME 遮挡（备注靠系统 IME
// 输入可幸免，金额必须触摸窗内按键故"无法修改"）。改为渲染在 LedgerScreen 的
// Activity 视图层级内的绝对定位覆盖层：触摸与键盘避让（adjustResize）行为与首页记账卡完全一致。
export default function EditRecordModal({ visible, record, onClose }: Props) {
  const [type, setType] = useState<RecordType>('expense');
  const [amountStr, setAmountStr] = useState('');
  const [category, setCategory] = useState('food');
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [reimbursable, setReimbursable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // 仅用户主动点「＋ 添加备注」才聚焦弹键盘；打开页面时不自动弹
  const [noteFocused, setNoteFocused] = useState(false);
  // 系统键盘是否弹起：Android 15+ edge-to-edge 下 adjustResize 不再压缩窗口，
  // 固定数字键盘(约250px)+备注行会整体压在 IME 之下，滚动无法救——改为一抬键盘就收起数字键盘
  // （随手记同款交互），键盘落下后自动恢复。
  const [keyboardUp, setKeyboardUp] = useState(false);
  const [keyboardH, setKeyboardH] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  // 打开时用记录内容初始化（金额转字符串供键盘继续编辑）
  useEffect(() => {
    if (visible && record) {
      setType(record.type);
      setAmountStr(String(record.amount));
      setCategory(record.category);
      setNote(record.note);
      setShowNote(!!record.note);
      setNoteFocused(false);
      setReimbursable(record.reimbursable);
      setSaving(false);
      setError('');
    }
  }, [visible, record]);

  // 系统返回键：编辑页打开时关闭编辑页（此前由 RNModal onRequestClose 承担）
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // 备注弹键盘时的"手动 adjustResize"：Android 15+ edge-to-edge 下系统不再压缩窗口，
  // 改为给滚动内容补 paddingBottom=键盘高度并滚到底，把备注行精确顶到 IME 上沿；
  // 同时收起自定义数字键盘（其位置正被系统键盘占据）。iOS 同样适用。
  useEffect(() => {
    if (!visible) {
      setKeyboardUp(false);
      setKeyboardH(0);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardUp(true);
      setKeyboardH(e.endCoordinates?.height ?? 0);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardUp(false);
      setKeyboardH(0);
    });
    return () => {
      if (timer) clearTimeout(timer);
      show.remove();
      hide.remove();
    };
  }, [visible]);

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
        amount,
        category,
        type,
        note: note.trim(),
        reimbursable,
      });
      hapticSuccess();
      // 列表刷新 + App 层 debounce 自动同步（与新增记录同一链路）
      DeviceEventEmitter.emit(LEDGER_EVENTS.RECORDED);
      onClose();
    } catch {
      hapticError();
      setSaving(false);
      // v0.11 修复：保存失败在页内给出文案提示（此前仅震动，用户以为已保存）
      setError('保存失败，请重试');
    }
  };

  const canSave = isValidAmount(amountStr) && !saving;

  // 计算器友好展示 + 实时「= 结果」预览（与记账页一致）
  const displayAmount =
    amountStr === '' ? '0.00' : amountStr.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
  const showPreview = hasOperator(amountStr);
  const previewAmount = showPreview ? evaluateAmount(amountStr) : 0;

  if (!visible || !record) return null;

  // v0.11.5 结构修正：不再用"绝对定位覆盖层"（absolute 子级会无视父级 paddingTop 顶进状态栏、
  // 底部安全区重复计算顶出幽灵空隙，且叠层触摸在部分机型仍不稳）。
  // 改为与 App.tsx 切 Tab 同款的"并列页 + display 切换"：本组件作为 LedgerScreen 根内的普通页面渲染，
  // 触摸/安全区行为与首页记账卡完全一致（LedgerScreen 负责两页互斥显示）。
  return (
    <View style={styles.page}>
      {/* 顶部导航栏：取消 / 标题 / 保存 */}
      <View style={styles.navBar}>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          style={styles.navBtn}
          accessibilityRole="button"
          accessibilityLabel="取消编辑"
        >
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

      {/* 保存失败提示（页内可见） */}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {/* 记账卡片结构：上半内容与数字键盘连为一张卡，键盘固定卡底（与 HomeScreen 一致） */}
      <View style={styles.card}>
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={[styles.content, keyboardUp && { paddingBottom: keyboardH + SPACING.sm }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* 收支切换 */}
          <View style={styles.typeSwitch}>
            {(['expense', 'income'] as RecordType[]).map((t) => (
              <Pressable
                key={t}
                style={[
                  styles.typeBtn,
                  type === t && (t === 'expense' ? styles.typeBtnExpense : styles.typeBtnIncome),
                ]}
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
              <Text
                style={[styles.amountSymbol, { color: type === 'expense' ? COLORS.expense : COLORS.income }]}
              >
                ¥
              </Text>
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
              {showPreview ? <Text style={styles.calcPreview}>= ¥{formatMoney(previewAmount)}</Text> : null}
            </View>
          </View>

          {/* 分类选择（横向滑动一行） */}
          <CategorySelector
            categories={getCategories(type)}
            selected={category}
            onSelect={(key) => {
              setCategory(key);
              hapticLight();
            }}
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
                autoFocus={noteFocused}
                onFocus={() => {
                  // 与首页一致：聚焦时滚到底，输入框位于系统键盘上方（adjustResize 生效）
                  scrollRef.current?.scrollToEnd({ animated: true });
                }}
              />
            ) : (
              <Pressable
                style={styles.noteToggle}
                onPress={() => {
                  setShowNote(true);
                  setNoteFocused(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="添加备注"
              >
                <Text style={styles.noteToggleText}>{note ? `备注：${note}` : '＋ 添加备注'}</Text>
              </Pressable>
            )}
            {type === 'expense' ? (
              <Pressable
                style={[styles.reimburseBtn, reimbursable && styles.reimburseBtnOn]}
                onPress={() => {
                  setReimbursable((v) => !v);
                  hapticLight();
                }}
                accessibilityRole="button"
                accessibilityLabel="标记待报销"
                accessibilityState={{ selected: reimbursable }}
              >
                <Text style={[styles.reimburseText, reimbursable && styles.reimburseTextOn]}>待报销</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>

        {/* 数字键盘：固定在卡片底部；系统键盘弹起时让位（此时正被 IME 占据，收起可让备注行回落到可见区） */}
        {!keyboardUp ? (
          <View style={styles.padDock}>
            <NumberPad onKey={handleKey} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // 普通并列页：由 LedgerScreen 用 display 与列表视图互斥切换（同 App 切 Tab 的做法）
  page: {
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
  errorText: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.sm,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: SPACING.xs,
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
