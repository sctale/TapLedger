import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DeviceEventEmitter,
  KeyboardAvoidingView,
  Platform,
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
import { addRecord, getSetting, saveSetting } from '../database/ledgerDB';
import { formatMoney, getToday } from '../utils/dateUtils';
import { appendKey, evaluateAmount, hasOperator, isValidAmount, toAmount, type PadKey } from '../utils/moneyUtils';
import { hapticError, hapticLight, hapticSuccess } from '../utils/haptics';
import { useToast } from '../hooks/useToast';
import CategorySelector from '../components/CategorySelector';
import NumberPad from '../components/NumberPad';
import Toast from '../components/Toast';
import type { RecordType } from '../types';

interface Props {
  active: boolean;   // 当前 Tab 激活（App 常驻挂载，激活时滚回顶部）
}

export default function HomeScreen({ active }: Props) {
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

  // 登录后的记账人标记（0=未登录本地）
  const [syncUserId, setSyncUserId] = useState(0);

  // v0.9.1 随手记式快捷记账：当前账本/记账人标识、连记、各分类上次金额
  const [identity, setIdentity] = useState<{ logged: boolean; display: string; avatar: string; ledgerName: string }>(
    { logged: false, display: '', avatar: '', ledgerName: '' }
  );
  const [continuous, setContinuous] = useState(false);
  const [amountMap, setAmountMap] = useState<Record<string, number>>({});

  const scrollRef = useRef<ScrollView>(null);
  // v0.11 修复：today 改为保存时实时计算（此前挂载时定死，跨零点连记会记到昨天）
  const [, setCatTick] = useState(0); // 自定义分类变更 → 触发重渲染刷新分类选择器

  // Tab 激活时滚回顶部
  useEffect(() => {
    if (!active) return;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [active]);

  // 首次加载（恢复默认收支类型 + 同步用户 + 快捷记账偏好）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [savedType, uidStr, cont, token, display, avatar, ledgerName, amtMapStr] = await Promise.all([
          getSetting(SETTING_KEYS.DEFAULT_TYPE),
          getSetting(SETTING_KEYS.SYNC_USER_ID),
          getSetting(SETTING_KEYS.CONTINUOUS_MODE),
          getSetting(SETTING_KEYS.SYNC_TOKEN),
          getSetting(SETTING_KEYS.SYNC_USER_DISPLAY),
          getSetting(SETTING_KEYS.SYNC_USER_AVATAR),
          getSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_NAME),
          getSetting(SETTING_KEYS.LAST_AMOUNT_BY_CATEGORY),
        ]);
        if (cancelled) return;
        setSyncUserId(Number(uidStr ?? '0') || 0);
        setContinuous(cont === '1');
        const logged = !!token;
        let parsed: Record<string, number> = {};
        try {
          const raw = amtMapStr ? JSON.parse(amtMapStr) : {};
          if (raw && typeof raw === 'object') parsed = raw as Record<string, number>;
        } catch {
          parsed = {};
        }
        setAmountMap(parsed);
        setIdentity({
          logged,
          display: display ?? '',
          avatar: avatar ?? '',
          ledgerName: ledgerName || (logged ? '我的账本' : '本地账本'),
        });
        if (savedType === 'income' || savedType === 'expense') {
          setType(savedType);
          setCategory(getCategories(savedType)[0]?.key ?? 'food');
        }
      } catch {
        // 静默
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 全局事件刷新
  useEffect(() => {
    // 登录态 / 同步完成 / 切换账本后，刷新账本标识、记账人、连记与各分类上次金额
    const reloadIdentity = async () => {
      try {
        const [cont, token, uidStr, display, avatar, ledgerName, amtMapStr] = await Promise.all([
          getSetting(SETTING_KEYS.CONTINUOUS_MODE),
          getSetting(SETTING_KEYS.SYNC_TOKEN),
          getSetting(SETTING_KEYS.SYNC_USER_ID),
          getSetting(SETTING_KEYS.SYNC_USER_DISPLAY),
          getSetting(SETTING_KEYS.SYNC_USER_AVATAR),
          getSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_NAME),
          getSetting(SETTING_KEYS.LAST_AMOUNT_BY_CATEGORY),
        ]);
        const logged = !!token;
        // 登录后新记录要归属当前用户（v0.11 修复：此前只在挂载时读一次，登录后仍记成 userId=0）
        setSyncUserId(logged ? Number(uidStr ?? '0') || 0 : 0);
        setContinuous(cont === '1');
        setIdentity({
          logged,
          display: display ?? '',
          avatar: avatar ?? '',
          ledgerName: ledgerName || (logged ? '我的账本' : '本地账本'),
        });
        try {
          const raw = amtMapStr ? JSON.parse(amtMapStr) : {};
          if (raw && typeof raw === 'object') setAmountMap(raw as Record<string, number>);
        } catch {
          /* 保留现状 */
        }
      } catch {
        // 静默
      }
    };
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.AUTH_CHANGED, reloadIdentity),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SYNC_DONE, reloadIdentity),
      // 偏好页改「默认记收入」→ 即时应用默认收支类型（v0.11 修复：此前需重启生效）
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SETTINGS_CHANGED, async () => {
        try {
          const savedType = await getSetting(SETTING_KEYS.DEFAULT_TYPE);
          if (savedType === 'income' || savedType === 'expense') {
            setType(savedType);
            setCategory(getCategories(savedType)[0]?.key ?? 'food');
          }
        } catch {
          // 静默
        }
      }),
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

  // 备注聚焦时滚到内容底部，确保输入框位于固定键盘上方可见
  const handleNoteFocus = useCallback(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, []);

  // 保存记录
  const handleSave = useCallback(async () => {
    if (!isValidAmount(amountStr)) {
      hapticError();
      showToast('请输入金额', 'error');
      return;
    }
    const amount = toAmount(amountStr);
    const today = getToday();
    try {
      await addRecord(amount, category, type, today, note.trim(), reimbursable, { userId: syncUserId });
      // 记住该分类最近金额，供「上次 ¥x」快捷填入
      const nextMap = { ...amountMap, [category]: amount };
      setAmountMap(nextMap);
      saveSetting(SETTING_KEYS.LAST_AMOUNT_BY_CATEGORY, JSON.stringify(nextMap)).catch(() => {});
      setAmountStr('');
      setNote('');
      setShowNote(false);
      hapticSuccess();
      if (!continuous) {
        setReimbursable(false);
        showToast(type === 'expense' ? `已记支出 ¥${formatMoney(amount)}` : `已记收入 ¥${formatMoney(amount)}`);
      }
      // 连记模式：不弹提示、保留待报销标记，便于连续补记同类
      DeviceEventEmitter.emit(LEDGER_EVENTS.RECORDED);
    } catch {
      hapticError();
      showToast('保存失败，请重试', 'error');
    }
  }, [amountStr, category, type, note, reimbursable, showToast, syncUserId, continuous, amountMap]);

  // 连记开关（持久化）
  const toggleContinuous = useCallback(() => {
    setContinuous((v) => {
      const next = !v;
      saveSetting(SETTING_KEYS.CONTINUOUS_MODE, next ? '1' : '0').catch(() => {});
      return next;
    });
    hapticLight();
  }, []);

  // 计算器：友好展示（× ÷ −）+ 实时「= 结果」预览
  const displayAmount = amountStr === ''
    ? '0.00'
    : amountStr.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
  const showPreview = hasOperator(amountStr);
  const previewAmount = showPreview ? evaluateAmount(amountStr) : 0;

  // 「上次 ¥x」快捷填入（当前分类且金额未输入时）
  const lastAmount = amountMap[category] ?? 0;
  const showLastChip = amountStr === '' && lastAmount > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      {/* 记账卡片：上半内容与数字键盘连为一张卡；键盘固定卡底，上半区仅在极小屏时兜底滚动 */}
      <View style={styles.card}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
          {/* 当前账本 + 记账人（家庭共同记账时防记错账本） */}
          <View style={styles.identityRow}>
            <Text style={styles.identityLedger} numberOfLines={1}>📒 {identity.ledgerName}</Text>
            <Text style={styles.identityWho} numberOfLines={1}>
              {identity.logged ? `${identity.avatar || '🙂'} ${identity.display || '已登录'}` : '未登录 · 本地'}
            </Text>
          </View>

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

          {/* 金额区（弹性占据卡内剩余空间，保证键盘稳定卡底） */}
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
            {/* 「上次填入」与「= 结果」互斥（金额为空 vs 含运算符），共用同一固定高度槽位避免跳动 */}
            <View style={styles.calcSlot}>
              {showLastChip ? (
                <Pressable
                  style={styles.lastChip}
                  onPress={() => { setAmountStr(String(lastAmount)); hapticLight(); }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`填入上次金额 ${formatMoney(lastAmount)} 元`}
                >
                  <Text style={styles.lastChipText}>上次 ¥{formatMoney(lastAmount)} · 点击填入</Text>
                </Pressable>
              ) : showPreview ? (
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

          {/* 备注 + 待报销 + 连记 */}
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
            <View style={styles.optionRight}>
              <Pressable
                style={[styles.contPill, continuous && styles.contPillOn]}
                onPress={toggleContinuous}
                hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="连记模式"
                accessibilityState={{ selected: continuous }}
              >
                <Text style={[styles.contText, continuous && styles.contTextOn]}>🔁 连记</Text>
              </Pressable>
              {type === 'expense' ? (
                <Pressable
                  style={[styles.reimburseBtn, reimbursable && styles.reimburseBtnOn]}
                  onPress={() => { setReimbursable((v) => !v); hapticLight(); }}
                  hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
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
          </View>

      </ScrollView>

      {/* 数字键盘：固定在卡片底部，与上半区连为一张卡；弹系统键盘时整体稳定不重排 */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.padDock}
      >
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
      </KeyboardAvoidingView>
      </View>

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
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.xs,
    paddingBottom: SPACING.sm,
    gap: SPACING.sm,
    flexGrow: 1,
  },
  // ===== 记账卡片 =====
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
  amountZone: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 64,
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
  identityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
    paddingBottom: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  identityLedger: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textSecondary,
    fontWeight: '700',
    flexShrink: 1,
  },
  identityWho: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    marginLeft: SPACING.sm,
    flexShrink: 0,
  },
  lastChip: {
    alignSelf: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.bgAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  lastChipText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  optionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  contPill: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  contPillOn: {
    backgroundColor: `${COLORS.accent}18`,
    borderColor: COLORS.accent,
  },
  contText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  contTextOn: {
    color: COLORS.accentDark,
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
    gap: 6,
    backgroundColor: COLORS.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
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
