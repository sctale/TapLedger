import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  DeviceEventEmitter,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  COLORS, FONT_SIZE, LEDGER_EVENTS, RADIUS, SETTING_KEYS, SPACING, getCategories,
} from '../constants';
import {
  addRecord, getAccounts, getRecordsByDate, getRangeSummary, getSetting, getTotalCount, saveSetting,
} from '../database/ledgerDB';
import { formatMoney, getMonthRange, getToday, parseDate } from '../utils/dateUtils';
import { appendKey, isValidAmount, toAmount, type PadKey } from '../utils/moneyUtils';
import { hapticError, hapticLight, hapticSuccess } from '../utils/haptics';
import { useToast } from '../hooks/useToast';
import { confirmDeleteRecord } from '../hooks/useDeleteRecord';
import CategorySelector from '../components/CategorySelector';
import NumberPad from '../components/NumberPad';
import RecordList from '../components/RecordList';
import AccountPicker from '../components/AccountPicker';
import Toast from '../components/Toast';
import type { AccountBalance, LedgerRecord, RecordType } from '../types';

export default function HomeScreen() {
  // 数据状态
  const [records, setRecords] = useState<LedgerRecord[]>([]);
  const [todayExpense, setTodayExpense] = useState(0);
  const [todayIncome, setTodayIncome] = useState(0);
  const [monthExpense, setMonthExpense] = useState(0);
  const [budget, setBudget] = useState(0);
  const [accountCountZero, setAccountCountZero] = useState(true);

  const { toast, showToast, hideToast } = useToast();

  // 记账输入状态
  const [type, setType] = useState<RecordType>('expense');
  const [amountStr, setAmountStr] = useState('');
  const [category, setCategory] = useState('food');
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [reimbursable, setReimbursable] = useState(false);

  // 账户状态
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [accountId, setAccountId] = useState(1);
  const [emptyLedger, setEmptyLedger] = useState(true);

  const scrollRef = useRef<ScrollView>(null);
  const today = getToday();

  const loadAccounts = useCallback(async () => {
    try {
      const list = await getAccounts();
      setAccounts(list);
      setAccountCountZero(list.length === 0);
      if (list.length > 0) {
        setAccountId((prev) => (list.some((a) => a.id === prev) ? prev : list[0].id));
      }
    } catch {
      // 账户加载失败保持现状
    }
  }, []);

  // 纯数据查询（刷新时使用，不触碰输入状态，避免重置用户输入）
  const queryData = useCallback(async () => {
    try {
      const monthRange = getMonthRange(new Date());
      const [dayRecords, summary, monthSummary, totalCount, budgetStr] = await Promise.all([
        getRecordsByDate(today),
        getRangeSummary(today, today),
        getRangeSummary(monthRange.start, monthRange.end),
        getTotalCount(),
        getSetting(SETTING_KEYS.MONTHLY_BUDGET),
      ]);
      setRecords(dayRecords);
      setTodayExpense(summary.expense);
      setTodayIncome(summary.income);
      setMonthExpense(monthSummary.expense);
      setBudget(parseFloat(budgetStr ?? '0') || 0);
      setEmptyLedger(totalCount === 0);
    } catch {
      showToast('数据加载失败', 'error');
    }
  }, [today, showToast]);

  // 首次加载（额外恢复默认收支类型设置）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([
        (async () => {
          try {
            const savedType = await getSetting(SETTING_KEYS.DEFAULT_TYPE);
            if (cancelled) return;
            if (savedType === 'income' || savedType === 'expense') {
              setType(savedType);
              setCategory(getCategories(savedType)[0]?.key ?? 'food');
            }
          } catch {
            // 静默
          }
        })(),
        queryData(),
        loadAccounts(),
      ]);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 读取默认账户设置（账户加载完成后）
  useEffect(() => {
    if (accountCountZero) return;
    (async () => {
      try {
        const saved = await getSetting(SETTING_KEYS.DEFAULT_ACCOUNT);
        if (saved) {
          const id = Number(saved);
          if (accounts.some((a) => a.id === id)) setAccountId(id);
        }
      } catch {
        // 静默
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountCountZero]);

  // App 回到前台刷新
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        queryData();
        loadAccounts();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 全局事件刷新（RECORDED 事件已包含本页写入，统一走此通道，避免双重刷新）
  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.RECORDED, () => {
        queryData();
        loadAccounts();
      }),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.DATA_IMPORTED, () => {
        queryData();
        loadAccounts();
      }),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.ACCOUNTS_CHANGED, () => {
        loadAccounts();
      }),
    ];
    return () => subs.forEach((s) => s.remove());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换收支类型
  const handleTypeChange = useCallback((next: RecordType) => {
    if (next === type) return;
    setType(next);
    setCategory(getCategories(next)[0]?.key ?? 'other');
    hapticLight();
    saveSetting(SETTING_KEYS.DEFAULT_TYPE, next).catch(() => {});
  }, [type]);

  const handleKey = useCallback((key: PadKey) => {
    setAmountStr((prev) => appendKey(prev, key));
    hapticLight();
  }, []);

  // 备注聚焦时滚回顶部（记账卡片置顶，避免键盘遮挡输入框）
  const handleNoteFocus = useCallback(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, []);

  // 保存记录
  const handleSave = useCallback(async () => {
    if (!isValidAmount(amountStr)) {
      hapticError();
      showToast('请输入金额', 'error');
      return;
    }
    const amount = toAmount(amountStr);
    try {
      await addRecord(amount, category, type, today, note.trim(), accountId, reimbursable);
      setAmountStr('');
      setNote('');
      setShowNote(false);
      setReimbursable(false);
      hapticSuccess();
      showToast(type === 'expense' ? `已记支出 ¥${formatMoney(amount)}` : `已记收入 ¥${formatMoney(amount)}`);
      // 统一通过事件刷新本页与其他页
      DeviceEventEmitter.emit(LEDGER_EVENTS.RECORDED);
    } catch {
      hapticError();
      showToast('保存失败，请重试', 'error');
    }
  }, [amountStr, category, type, today, note, accountId, reimbursable, showToast]);

  // 删除记录（二次确认）
  const handleDelete = useCallback((record: LedgerRecord) => {
    confirmDeleteRecord(record.id, (msg, isError) => showToast(msg, isError ? 'error' : 'success'));
  }, [showToast]);

  // 选择账户时记住偏好
  const handleSelectAccount = useCallback((id: number) => {
    setAccountId(id);
    hapticLight();
    saveSetting(SETTING_KEYS.DEFAULT_ACCOUNT, String(id)).catch(() => {
      showToast('默认账户保存失败', 'error');
    });
  }, [showToast]);

  const budgetPercent = budget > 0 ? Math.min(monthExpense / budget, 1) : 0;
  const budgetOver = budget > 0 && monthExpense > budget;
  const totalAssets = useMemo(() => accounts.reduce((s, a) => s + a.balance, 0), [accounts]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ===== 记账卡片（核心，置顶） ===== */}
        <View style={styles.card}>
          {/* 收支切换 */}
          <View style={styles.typeSwitch}>
            {(['expense', 'income'] as RecordType[]).map((t) => (
              <Pressable
                key={t}
                style={[styles.typeBtn, type === t && (t === 'expense' ? styles.typeBtnExpense : styles.typeBtnIncome)]}
                onPress={() => handleTypeChange(t)}
                accessibilityRole="button"
                accessibilityLabel={t === 'expense' ? '记支出' : '记收入'}
                accessibilityState={{ selected: type === t }}
              >
                <Text style={[styles.typeText, type === t && styles.typeTextActive]}>
                  {t === 'expense' ? '支出' : '收入'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* 金额显示（自适应字号） */}
          <View style={styles.amountRow}>
            <Text style={[styles.amountSymbol, { color: type === 'expense' ? COLORS.expense : COLORS.income }]}>¥</Text>
            <Text
              style={[styles.amountInput, amountStr === '' && styles.amountPlaceholder]}
              adjustsFontSizeToFit
              numberOfLines={1}
              accessibilityLabel={`金额 ${amountStr === '' ? '0' : amountStr}元`}
            >
              {amountStr === '' ? '0.00' : amountStr}
            </Text>
          </View>

          {/* 分类选择（横向滑动一行） */}
          <CategorySelector
            categories={getCategories(type)}
            selected={category}
            onSelect={(key) => { setCategory(key); hapticLight(); }}
          />

          {/* 账户选择（横向滑动一行） */}
          {accounts.length > 0 ? (
            <View style={styles.accountSection}>
              <AccountPicker accounts={accounts} selectedId={accountId} onSelect={handleSelectAccount} />
            </View>
          ) : null}

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
                onFocus={handleNoteFocus}
              />
            ) : (
              <Pressable
                style={styles.noteToggle}
                onPress={() => setShowNote(true)}
                accessibilityRole="button"
                accessibilityLabel="添加备注"
              >
                <Text style={styles.noteToggleText}>＋ 添加备注</Text>
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
                  {reimbursable ? '✓ 待报销' : '待报销'}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* 数字键盘 + 记一笔（紧邻组合） */}
          <View style={styles.inputArea}>
            <NumberPad onKey={handleKey} />
            <Pressable
              style={[styles.saveBtn, { backgroundColor: type === 'expense' ? COLORS.expense : COLORS.income }]}
              onPress={handleSave}
              android_ripple={{ color: 'rgba(255,255,255,0.25)' }}
              accessibilityRole="button"
              accessibilityLabel="记一笔"
            >
              <Text style={styles.saveText}>记一笔</Text>
            </Pressable>
          </View>
        </View>

        {/* ===== 今日总览（精简） ===== */}
        <View style={styles.overviewCard}>
          <View style={styles.overviewTop}>
            <Text style={styles.overviewDate}>{todayLabel(today)}</Text>
            {emptyLedger ? <Text style={styles.overviewHint}>👋 记下第一笔吧</Text> : null}
          </View>
          <View style={styles.overviewMain}>
            <View style={styles.overviewItem}>
              <Text style={styles.overviewLabel}>今日支出</Text>
              <Text style={[styles.overviewValue, { color: COLORS.expense }]}>{formatMoney(todayExpense)}</Text>
            </View>
            <View style={styles.overviewDivider} />
            <View style={styles.overviewItem}>
              <Text style={styles.overviewLabel}>今日收入</Text>
              <Text style={[styles.overviewValue, { color: COLORS.income }]}>{formatMoney(todayIncome)}</Text>
            </View>
            <View style={styles.overviewDivider} />
            <View style={styles.overviewItem}>
              <Text style={styles.overviewLabel}>本月支出</Text>
              <Text style={styles.overviewValue}>{formatMoney(monthExpense)}</Text>
            </View>
            <View style={styles.overviewDivider} />
            <View style={styles.overviewItem}>
              <Text style={styles.overviewLabel}>总资产</Text>
              <Text style={[styles.overviewValue, { color: COLORS.accentDark }]}>{formatMoney(totalAssets)}</Text>
            </View>
          </View>
          {budget > 0 ? (
            <View style={styles.budgetBlock}>
              <View style={styles.budgetRow}>
                <Text style={styles.budgetLabel}>
                  本月预算 {formatMoney(budget)} · 已用 {formatMoney(monthExpense)}
                  {budgetOver ? ' · 已超支!' : ''}
                </Text>
                <Text style={[styles.budgetPct, budgetOver && { color: COLORS.danger }]}>
                  {Math.round(budgetPercent * 100)}%
                </Text>
              </View>
              <View style={styles.budgetTrack}>
                <View
                  style={[
                    styles.budgetFill,
                    { width: `${Math.round(budgetPercent * 100)}%`, backgroundColor: budgetOver ? COLORS.danger : COLORS.accent },
                  ]}
                />
              </View>
            </View>
          ) : null}
        </View>

        {/* ===== 今日明细（单个列表，行内含时间） ===== */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>今日明细</Text>
          <Text style={styles.sectionCount}>{records.length} 笔</Text>
        </View>
        <RecordList
          records={records}
          onDelete={handleDelete}
          showTime
          emptyText="今天还没有记录，记一笔吧 ✨"
        />
      </ScrollView>

      <Toast toast={toast} onHide={hideToast} />
    </SafeAreaView>
  );
}

function todayLabel(dateStr: string): string {
  const d = parseDate(dateStr);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]}`;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  // ===== 记账卡片 =====
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    gap: SPACING.md,
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
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xs,
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
  accountSection: {
    gap: 6,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  noteToggle: {
    paddingVertical: 2,
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
  },
  reimburseBtnOn: {
    backgroundColor: COLORS.warningBg,
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
  inputArea: {
    gap: SPACING.sm,
  },
  saveBtn: {
    height: 52,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    letterSpacing: 4,
  },
  // ===== 今日总览 =====
  overviewCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginTop: SPACING.md,
    gap: SPACING.sm,
  },
  overviewTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  overviewDate: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textTertiary,
  },
  overviewHint: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.accentDark,
    fontWeight: '600',
  },
  overviewMain: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overviewItem: {
    flex: 1,
    alignItems: 'center',
  },
  overviewLabel: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    marginBottom: 2,
  },
  overviewValue: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: COLORS.text,
  },
  overviewDivider: {
    width: 1,
    height: 26,
    backgroundColor: COLORS.border,
  },
  budgetBlock: {
    marginTop: SPACING.xs,
  },
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  budgetLabel: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textSecondary,
    flexShrink: 1,
  },
  budgetPct: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.accentDark,
    fontWeight: '700',
  },
  budgetTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.bgAlt,
    overflow: 'hidden',
  },
  budgetFill: {
    height: '100%',
    borderRadius: 3,
  },
  // ===== 今日明细 =====
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  sectionTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    color: COLORS.text,
  },
  sectionCount: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textTertiary,
  },
});
