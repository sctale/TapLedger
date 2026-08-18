import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { addRecord, getAccounts, getSetting, saveSetting } from '../database/ledgerDB';
import { formatMoney, getToday } from '../utils/dateUtils';
import { appendKey, isValidAmount, toAmount, type PadKey } from '../utils/moneyUtils';
import { hapticError, hapticLight, hapticSuccess } from '../utils/haptics';
import { useToast } from '../hooks/useToast';
import { getCachedMembers, type MemberInfo } from '../sync/memberUtils';
import CategorySelector from '../components/CategorySelector';
import NumberPad from '../components/NumberPad';
import AccountPicker from '../components/AccountPicker';
import Toast from '../components/Toast';
import type { AccountBalance, RecordType } from '../types';

interface Props {
  active: boolean;   // 当前 Tab 激活（App 常驻挂载，激活时滚回顶部）
}

export default function HomeScreen({ active }: Props) {
  const [accountCountZero, setAccountCountZero] = useState(true);

  const { toast, showToast, hideToast } = useToast();

  // 记账输入状态
  const [type, setType] = useState<RecordType>('expense');
  const [amountStr, setAmountStr] = useState('');
  const [category, setCategory] = useState('food');
  const typeRef = useRef<RecordType>(type);
  const categoryRef = useRef<string>(category);
  useEffect(() => { typeRef.current = type; }, [type]);
  useEffect(() => { categoryRef.current = category; }, [category]);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [reimbursable, setReimbursable] = useState(false);

  // 账户状态
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [accountId, setAccountId] = useState(1);
  const [syncUserId, setSyncUserId] = useState(0); // 登录后的记账人标记（0=未登录本地）
  const [members, setMembers] = useState<MemberInfo[]>([]); // 家庭成员缓存（v0.5 记账人标识）

  const scrollRef = useRef<ScrollView>(null);
  const today = getToday();
  const [, setCatTick] = useState(0); // 自定义分类变更 → 触发重渲染刷新分类选择器

  // 加载家庭成员缓存（登录/同步完成后由事件触发刷新）
  const loadMembers = useCallback(async () => {
    const list = await getCachedMembers();
    setMembers(list);
  }, []);

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

  // Tab 激活时滚回顶部 + 重载账户
  useEffect(() => {
    if (!active) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    loadAccounts();
  }, [active, loadAccounts]);

  // 首次加载（额外恢复默认收支类型设置 + 同步用户标记）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([
        (async () => {
          try {
            const [savedType, uidStr] = await Promise.all([
              getSetting(SETTING_KEYS.DEFAULT_TYPE),
              getSetting(SETTING_KEYS.SYNC_USER_ID),
            ]);
            if (cancelled) return;
            setSyncUserId(Number(uidStr ?? '0') || 0);
            if (savedType === 'income' || savedType === 'expense') {
              setType(savedType);
              setCategory(getCategories(savedType)[0]?.key ?? 'food');
            }
          } catch {
            // 静默
          }
        })(),
        loadAccounts(),
        loadMembers(),
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
        loadAccounts();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 全局事件刷新
  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.RECORDED, () => {
        loadAccounts();
      }),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.DATA_IMPORTED, () => {
        loadAccounts();
      }),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.ACCOUNTS_CHANGED, () => {
        loadAccounts();
      }),
      // 登录态变化 / 同步完成 → 刷新成员缓存（v0.5）
      DeviceEventEmitter.addListener(LEDGER_EVENTS.AUTH_CHANGED, loadMembers),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SYNC_DONE, loadMembers),
      // 自定义分类增删/显隐变更 → 重渲染分类选择器并修正当前选中分类（v0.5.4）
      DeviceEventEmitter.addListener(LEDGER_EVENTS.CATEGORIES_CHANGED, () => {
        setCatTick((t) => t + 1);
        // 如果当前选中的分类被隐藏，自动切换到第一个可见分类
        const visible = getCategories(typeRef.current);
        if (!visible.some((c) => c.key === categoryRef.current)) {
          setCategory(visible[0]?.key ?? (typeRef.current === 'expense' ? 'food' : 'salary'));
        }
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
      await addRecord(amount, category, type, today, note.trim(), accountId, reimbursable, { userId: syncUserId });
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
  }, [amountStr, category, type, today, note, accountId, reimbursable, showToast, syncUserId]);

  // 选择账户时记住偏好
  const handleSelectAccount = useCallback((id: number) => {
    setAccountId(id);
    hapticLight();
    saveSetting(SETTING_KEYS.DEFAULT_ACCOUNT, String(id)).catch(() => {
      showToast('默认账户保存失败', 'error');
    });
  }, [showToast]);

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
      </ScrollView>

      <Toast toast={toast} onHide={hideToast} />
    </SafeAreaView>
  );
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
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  // ===== 记账卡片 =====
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.sm,
    gap: SPACING.sm,
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
    paddingVertical: 0,
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
    gap: 4,
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
    gap: 6,
  },
  saveBtn: {
    height: 48,
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
});
