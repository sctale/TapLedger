import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, BackHandler, DeviceEventEmitter, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ACCOUNT_TYPES, CATEGORY_COLORS, COLORS, FONT_SIZE, LEDGER_EVENTS, RADIUS, SETTING_KEYS, SPACING, getAccountTypeDef,
} from '../constants';
import {
  addAccount, addTransfer, deleteAccount, getAccounts, getCustomCategories, getRecurringRules,
  getReimbursableSummary, getSetting, getTotalCount,
} from '../database/ledgerDB';
import { formatMoney, getToday } from '../utils/dateUtils';
import { hapticError, hapticSuccess } from '../utils/haptics';
import { useToast } from '../hooks/useToast';
import Modal from '../components/Modal';
import Toast from '../components/Toast';
import { getSyncConfig } from '../sync/apiClient';
import type { AccountBalance } from '../types';
import RecurringScreen from './manage/RecurringScreen';
import ReimburseScreen from './manage/ReimburseScreen';
import CategoriesScreen from './manage/CategoriesScreen';
import SyncScreen from './manage/SyncScreen';
import BackupScreen from './manage/BackupScreen';
import PrefsScreen from './manage/PrefsScreen';

// 版本号单一来源：app.json expo.version
const APP_VERSION = Constants.expoConfig?.version ?? '';

// 二级页面路由：main 为主页，其余为子页面（v0.5.9 入口列表+二级页重构）
type Page = 'main' | 'recurring' | 'reimburse' | 'categories' | 'sync' | 'backup' | 'prefs';

// 子页面顶栏标题映射
const PAGE_TITLES: Record<Exclude<Page, 'main'>, string> = {
  recurring: '周期记账',
  reimburse: '报销管理',
  categories: '自定义分类',
  sync: '家庭同步',
  backup: '数据备份',
  prefs: '偏好设置',
};

interface Props {
  active: boolean;   // 当前 Tab 激活（App 常驻挂载，激活时滚回顶部）
}

export default function ManageScreen({ active }: Props) {
  // ===== 路由状态 =====
  const [page, setPage] = useState<Page>('main');

  // ===== 主页数据：账户列表 + 各板块摘要 =====
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [ruleCount, setRuleCount] = useState(0);          // 周期记账规则数
  const [reimburseCount, setReimburseCount] = useState(0); // 待核销笔数
  const [catCount, setCatCount] = useState(0);             // 自定义分类数
  const [totalCount, setTotalCount] = useState(0);         // 本地记录总数
  const [budgetStr, setBudgetStr] = useState('');          // 月度预算（原始字符串）
  const [syncSummary, setSyncSummary] = useState('');      // 家庭同步状态摘要

  const { toast, showToast, hideToast } = useToast();

  // 弹窗状态
  const [accountModal, setAccountModal] = useState(false);
  const [transferModal, setTransferModal] = useState(false);

  // 主页摘要加载：账户 + 各板块计数 + 同步状态（一次并行读齐）
  const loadSummary = useCallback(async () => {
    try {
      const [accs, rules, rsSum, cats, count, budget, cfg, name, family, serverUrl] = await Promise.all([
        getAccounts(),
        getRecurringRules(),
        getReimbursableSummary(),
        getCustomCategories(),
        getTotalCount(),
        getSetting(SETTING_KEYS.MONTHLY_BUDGET),
        getSyncConfig(),                                  // serverUrl + token 均存在 → 已连接且已登录
        getSetting(SETTING_KEYS.SYNC_USER_DISPLAY),       // 登录昵称（摘要显示用）
        getSetting('sync.family_name'),                   // 家庭名（摘要显示用）
        getSetting(SETTING_KEYS.SYNC_SERVER_URL),         // 区分「已连接未登录」与「未配置」
      ]);
      setAccounts(accs);
      setRuleCount(rules.length);
      setReimburseCount(rsSum.count);
      setCatCount(cats.length);
      setTotalCount(count);
      setBudgetStr(budget ?? '');
      if (cfg) {
        // 已连接且已登录：昵称（无则「已登录」）+ 可选家庭名
        setSyncSummary(`${name || '已登录'}${family ? ` · ${family}` : ''}`);
      } else {
        setSyncSummary(serverUrl ? '未登录' : '未配置（可选）');
      }
    } catch {
      showToast('管理页数据加载失败', 'error');
    }
  }, [showToast]);

  const scrollRef = useRef<ScrollView>(null);

  // Tab 激活时回主页 + 滚回顶部 + 重载摘要（页面常驻挂载，激活刷新保证数据即时，v0.5.6 + v0.5.9 回主页重置）
  useEffect(() => {
    if (!active) return;
    setPage('main');
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    loadSummary();
  }, [active, loadSummary]);

  // 挂载时预载摘要
  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // 数据/同步/设置变化时刷新主页摘要（卸载移除）
  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.RECORDED, loadSummary),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.DATA_IMPORTED, loadSummary),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SYNC_DONE, loadSummary),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.AUTH_CHANGED, loadSummary),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SETTINGS_CHANGED, loadSummary),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.CATEGORIES_CHANGED, loadSummary),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [loadSummary]);

  // Android 系统返回键：子页面时返回主页而非退出 App（主页时不消费，走默认）
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page !== 'main') {
        setPage('main');
        return true; // 消费事件
      }
      return false;
    });
    return () => sub.remove();
  }, [page]);

  // ===== 账户 =====
  const handleAddAccount = useCallback(async (name: string, type: AccountBalance['type'], emoji: string, color: string, initial: number) => {
    if (!name.trim()) {
      hapticError();
      showToast('请输入账户名称', 'error');
      return;
    }
    try {
      await addAccount(name.trim(), type, emoji, color, initial);
      hapticSuccess();
      showToast('账户已添加');
      setAccountModal(false);
      await loadSummary();
      DeviceEventEmitter.emit(LEDGER_EVENTS.ACCOUNTS_CHANGED);
    } catch {
      hapticError();
      showToast('添加失败', 'error');
    }
  }, [loadSummary, showToast]);

  const handleDeleteAccount = useCallback((acc: AccountBalance) => {
    if (acc.id === 1) {
      showToast('默认账户不可删除', 'error');
      return;
    }
    Alert.alert('删除账户', `删除「${acc.name}」？该账户的收支记录将归入默认账户，转账记录将删除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAccount(acc.id);
            hapticSuccess();
            showToast('账户已删除');
            await loadSummary();
            DeviceEventEmitter.emit(LEDGER_EVENTS.ACCOUNTS_CHANGED);
          } catch {
            hapticError();
            showToast('删除失败', 'error');
          }
        },
      },
    ]);
  }, [loadSummary, showToast]);

  // ===== 转账 =====
  const handleTransfer = useCallback(async (fromId: number, toId: number, amount: number, note: string) => {
    if (fromId === toId) {
      hapticError();
      showToast('转出和转入账户不能相同', 'error');
      return;
    }
    if (!(amount > 0)) {
      hapticError();
      showToast('请输入有效金额', 'error');
      return;
    }
    try {
      await addTransfer(fromId, toId, amount, getToday(), note.trim());
      hapticSuccess();
      showToast('转账成功');
      setTransferModal(false);
      await loadSummary();
      DeviceEventEmitter.emit(LEDGER_EVENTS.RECORDED);
    } catch {
      hapticError();
      showToast('转账失败', 'error');
    }
  }, [loadSummary, showToast]);

  // 功能入口列表（iOS 设置风格：图标 + 标题 + 状态摘要副标题）
  const entries: { icon: string; title: string; subtitle: string; target: Exclude<Page, 'main'> }[] = [
    { icon: '🔁', title: '周期记账', subtitle: `${ruleCount} 条规则`, target: 'recurring' },
    { icon: '🧾', title: '报销管理', subtitle: reimburseCount > 0 ? `${reimburseCount} 笔待核销` : '暂无待核销', target: 'reimburse' },
    { icon: '🏷️', title: '分类管理', subtitle: `${catCount} 个`, target: 'categories' },
    { icon: '👨‍👩‍👧', title: '家庭同步', subtitle: syncSummary, target: 'sync' },
    { icon: '⚙️', title: '偏好设置', subtitle: budgetStr ? `月度预算 ¥${budgetStr}` : '未设置', target: 'prefs' },
    { icon: '💾', title: '数据备份', subtitle: `${totalCount} 条记录`, target: 'backup' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      {page === 'main' ? (
        /* ===== 主页 ===== */
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kavContainer}>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"  /* 键盘弹出时点击弹窗内按钮不被吞掉 */
          >
            <Text style={styles.pageTitle}>管理</Text>

            {/* ===== 账户管理 ===== */}
            <Text style={styles.sectionTitle}>账户管理</Text>
            <View style={styles.card}>
              {accounts.map((acc) => {
                const def = getAccountTypeDef(acc.type);
                return (
                  <View key={acc.id} style={styles.accountRow}>
                    <View style={[styles.accIcon, { backgroundColor: `${acc.color}22` }]}>
                      <Text style={styles.accEmoji}>{acc.emoji}</Text>
                    </View>
                    <View style={styles.accInfo}>
                      <Text style={styles.accName}>{acc.name}</Text>
                      <Text style={styles.accType}>{def.label}</Text>
                    </View>
                    <Text style={[styles.accBalance, { color: acc.balance >= 0 ? COLORS.text : COLORS.danger }]}>
                      {formatMoney(acc.balance)}
                    </Text>
                    {acc.id !== 1 ? (
                      <Pressable onPress={() => handleDeleteAccount(acc)} hitSlop={8} style={styles.accDelete}>
                        <Text style={styles.accDeleteText}>✕</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
              <View style={styles.btnRow}>
                <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.accent }]} onPress={() => setAccountModal(true)}>
                  <Text style={styles.actionBtnText}>＋ 添加账户</Text>
                </Pressable>
                <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.transfer }]} onPress={() => setTransferModal(true)}>
                  <Text style={styles.actionBtnText}>🔁 转账</Text>
                </Pressable>
              </View>
            </View>

            {/* ===== 功能入口列表 ===== */}
            <Text style={styles.sectionTitle}>功能</Text>
            <View style={styles.entryCard}>
              {entries.map((e, i) => (
                <Pressable
                  key={e.target}
                  style={[styles.entryRow, i > 0 && styles.entryDivider]}
                  onPress={() => setPage(e.target)}
                >
                  <View style={[styles.accIcon, { backgroundColor: `${COLORS.accent}15` }]}>
                    <Text style={styles.accEmoji}>{e.icon}</Text>
                  </View>
                  <View style={styles.accInfo}>
                    <Text style={styles.accName}>{e.title}</Text>
                    <Text style={styles.accType} numberOfLines={1}>{e.subtitle}</Text>
                  </View>
                  <Text style={styles.entryArrow}>›</Text>
                </Pressable>
              ))}
            </View>

            {/* ===== 关于 ===== */}
            <Text style={styles.sectionTitle}>关于</Text>
            <View style={styles.card}>
              <View style={styles.aboutRow}>
                <Text style={styles.aboutName}>一点账本</Text>
                <Text style={styles.aboutVersion}>v{APP_VERSION}</Text>
              </View>
              <Text style={styles.hint}>极简记账 · 3 秒记一笔 · 数据完全保存在本地，不上传任何服务器</Text>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        /* ===== 子页面：顶栏返回 + 对应二级页（切换 page 时组件自然挂载自加载） ===== */
        <View style={styles.subPage}>
          <View style={styles.navBar}>
            <Pressable hitSlop={8} onPress={() => setPage('main')}>
              <Text style={styles.navBack}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.navTitle}>{PAGE_TITLES[page]}</Text>
          </View>
          {page === 'recurring' ? (
            <RecurringScreen />
          ) : page === 'reimburse' ? (
            <ReimburseScreen />
          ) : page === 'categories' ? (
            <CategoriesScreen />
          ) : page === 'sync' ? (
            <SyncScreen />
          ) : page === 'backup' ? (
            <BackupScreen />
          ) : (
            <PrefsScreen />
          )}
        </View>
      )}

      {/* ===== 弹窗：添加账户 ===== */}
      <AccountModal
        visible={accountModal}
        onClose={() => setAccountModal(false)}
        onSubmit={handleAddAccount}
      />
      {/* ===== 弹窗：转账 ===== */}
      <TransferModal
        visible={transferModal}
        accounts={accounts}
        onClose={() => setTransferModal(false)}
        onSubmit={handleTransfer}
      />

      <Toast toast={toast} onHide={hideToast} />
    </SafeAreaView>
  );
}

// ===== 账户添加弹窗 =====
function AccountModal({ visible, onClose, onSubmit }: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (name: string, type: AccountBalance['type'], emoji: string, color: string, initial: number) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountBalance['type']>('cash');
  const [emoji, setEmoji] = useState('💵');
  const [color, setColor] = useState<string>(CATEGORY_COLORS[0]);
  const [initial, setInitial] = useState('');

  useEffect(() => {
    if (visible) {
      setName('');
      setType('cash');
      setInitial('');
      const def = ACCOUNT_TYPES[0];
      setEmoji(def?.emoji ?? '💵');
      setColor(CATEGORY_COLORS[0]);
    }
  }, [visible]);

  return (
    <Modal visible={visible} title="添加账户" onClose={onClose} height={480}>
      <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>账户类型</Text>
          <View style={styles.typeGrid}>
            {ACCOUNT_TYPES.map((t) => (
              <Pressable
                key={t.key}
                style={[styles.typeCell, type === t.key && { backgroundColor: COLORS.accent, borderColor: COLORS.accent }]}
                onPress={() => { setType(t.key); setEmoji(t.emoji); }}
              >
                <Text style={styles.typeCellEmoji}>{t.emoji}</Text>
                <Text style={[styles.typeCellLabel, type === t.key && styles.typeCellLabelOn]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>名称</Text>
          <TextInput
            style={styles.input}
            placeholder="如 工资卡 / 招商银行"
            placeholderTextColor={COLORS.textTertiary}
            value={name}
            onChangeText={setName}
            maxLength={12}
            returnKeyType="done"
          />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>初始余额（元，可选）</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={COLORS.textTertiary}
            keyboardType="decimal-pad"
            returnKeyType="done"
            value={initial}
            onChangeText={(t) => setInitial(t.replace(/[^0-9.]/g, ''))}
            maxLength={9}
          />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>颜色</Text>
          <View style={styles.colorRow}>
            {CATEGORY_COLORS.map((c) => (
              <Pressable
                key={c}
                style={[styles.colorDot, { backgroundColor: c }, color === c && styles.colorDotOn]}
                onPress={() => setColor(c)}
              />
            ))}
          </View>
        </View>
        <Pressable style={[styles.submitBtn, { backgroundColor: COLORS.accent }]} onPress={() => {
          onSubmit(name, type, emoji, color, parseFloat(initial) || 0);
        }}>
          <Text style={styles.submitText}>保存</Text>
        </Pressable>
      </ScrollView>
    </Modal>
  );
}

// ===== 转账弹窗 =====
function TransferModal({ visible, accounts, onClose, onSubmit }: {
  visible: boolean;
  accounts: AccountBalance[];
  onClose: () => void;
  onSubmit: (fromId: number, toId: number, amount: number, note: string) => void;
}) {
  const [fromId, setFromId] = useState(1);
  const [toId, setToId] = useState(2);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (visible) {
      setFromId(accounts[0]?.id ?? 1);
      setToId(accounts[1]?.id ?? accounts[0]?.id ?? 1);
      setAmount('');
      setNote('');
    }
  }, [visible, accounts]);

  const pick = (list: AccountBalance[], current: number, onChange: (id: number) => void) => (
    <View style={styles.pickRow}>
      {list.map((a) => (
        <Pressable
          key={a.id}
          style={[styles.pickChip, current === a.id && { backgroundColor: a.color, borderColor: a.color }]}
          onPress={() => onChange(a.id)}
        >
          <Text style={styles.pickEmoji}>{a.emoji}</Text>
          <Text style={[styles.pickName, current === a.id && styles.pickNameOn]}>{a.name}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <Modal visible={visible} title="账户转账" onClose={onClose} height={480}>
      <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>从账户转出</Text>
        {pick(accounts, fromId, setFromId)}
        <Text style={[styles.fieldLabel, { marginTop: SPACING.md }]}>转入账户</Text>
        {pick(accounts, toId, setToId)}
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
          <Text style={styles.fieldLabel}>备注（可选）</Text>
          <TextInput
            style={styles.input}
            placeholder="如 还信用卡"
            placeholderTextColor={COLORS.textTertiary}
            value={note}
            onChangeText={setNote}
            maxLength={20}
            returnKeyType="done"
          />
        </View>
        <Pressable
          style={[styles.submitBtn, { backgroundColor: COLORS.transfer }]}
          onPress={() => onSubmit(fromId, toId, parseFloat(amount) || 0, note)}
        >
          <Text style={styles.submitText}>确认转账</Text>
        </Pressable>
      </ScrollView>
    </Modal>
  );
}

// ===== 样式：主页所需完整集合（二级页共用样式已抽到 ./manage/sharedStyles，v0.5.9） =====
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  kavContainer: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  pageTitle: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    gap: SPACING.sm + 2,
  },
  hint: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    lineHeight: 17,
  },
  // ===== 账户行 =====
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  accIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accEmoji: {
    fontSize: FONT_SIZE.lg - 1,
  },
  accInfo: {
    flex: 1,
  },
  accName: {
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    fontWeight: '600',
  },
  accType: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  accBalance: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
  accDelete: {
    width: 26,
    height: 26,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accDeleteText: {
    fontSize: FONT_SIZE.xs + 1,
    color: COLORS.textTertiary,
    fontWeight: '600',
    padding: 4,
  },
  // ===== 按钮行 =====
  btnRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  actionBtnText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
  },
  // ===== 功能入口列表（iOS 设置风格） =====
  entryCard: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    marginBottom: SPACING.md,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm,
  },
  entryDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.border,
  },
  entryArrow: {
    fontSize: FONT_SIZE.xl + 4,
    color: COLORS.textTertiary,
    fontWeight: '600',
  },
  // ===== 关于 =====
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aboutName: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '800',
    color: COLORS.text,
  },
  aboutVersion: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textTertiary,
  },
  // ===== 子页面顶栏 =====
  subPage: {
    flex: 1,
  },
  navBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
  },
  navBack: {
    fontSize: FONT_SIZE.lg,
    color: COLORS.accent,
    fontWeight: '700',
  },
  navTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '800',
    color: COLORS.text,
    marginLeft: SPACING.sm,
  },
  // ===== 弹窗表单样式（AccountModal / TransferModal） =====
  formGroup: {
    marginBottom: SPACING.md,
  },
  modalScroll: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  typeCell: {
    width: '30%',
    paddingVertical: 10,
    borderRadius: RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    gap: 2,
  },
  typeCellEmoji: {
    fontSize: FONT_SIZE.xxl - 8,
  },
  typeCellLabel: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  typeCellLabelOn: {
    color: COLORS.white,
  },
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  colorDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  colorDotOn: {
    borderWidth: 3,
    borderColor: COLORS.text,
  },
  submitBtn: {
    borderRadius: RADIUS.lg,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  submitText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    letterSpacing: 1,
  },
  pickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  pickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pickEmoji: {
    fontSize: FONT_SIZE.sm,
  },
  pickName: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.text,
    fontWeight: '600',
  },
  pickNameOn: {
    color: COLORS.white,
  },
});
