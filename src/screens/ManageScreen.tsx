import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, DeviceEventEmitter, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ACCOUNT_TYPES, CATEGORY_COLORS, COLORS, FONT_SIZE, LEDGER_EVENTS, RADIUS, RECURRING_FREQUENCIES,
  SETTING_KEYS, SPACING, findCategory, getAccountTypeDef, getCategories,
} from '../constants';
import {
  addAccount, addCustomCategory, addRecurringRule, addTransfer, deleteAccount, deleteCustomCategory,
  deleteRecurringRule, getAllRecords, getAccounts, getCustomCategories as getCustomCategoriesDB,
  getRecurringRules, getReimbursableRecords, getReimbursableSummary, getSetting, getTotalCount,
  markAllReimbursed, saveSetting, setCustomCategoriesCache, setReimbursed, updateRecurringRule,
  type RecurringRuleInput,
} from '../database/ledgerDB';
import { exportLedgerData } from '../utils/exportData';
import { exportCSV } from '../utils/csvExport';
import { pickAndImportData, type ImportStrategy } from '../utils/importData';
import { formatMoney, getToday } from '../utils/dateUtils';
import { hapticError, hapticLight, hapticSuccess } from '../utils/haptics';
import { useToast } from '../hooks/useToast';
import Modal from '../components/Modal';
import RecordList from '../components/RecordList';
import Toast from '../components/Toast';
import LoginModal from '../components/LoginModal';
import FamilyModal from '../components/FamilyModal';
import { runSync, claimLocalRecordsAsUser, isSyncing } from '../sync/syncEngine';
import { apiHealth, apiGetFamily } from '../sync/apiClient';
import type { AccountBalance, CustomCategory, LedgerRecord, RecurringRule, RecordType } from '../types';

// 版本号单一来源：app.json expo.version
const APP_VERSION = Constants.expoConfig?.version ?? '';

// 同步时间的友好显示
function formatSyncTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ManageScreen() {
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [reimburseSummary, setReimburseSummary] = useState({ total: 0, count: 0 });
  const [reimburseRecords, setReimburseRecords] = useState<LedgerRecord[]>([]);
  const [customCategories, setCustomCategoriesState] = useState<CustomCategory[]>([]);
  const [budgetText, setBudgetText] = useState('');
  const [defaultIncome, setDefaultIncome] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  const { toast, showToast, hideToast } = useToast();

  // 弹窗状态
  const [accountModal, setAccountModal] = useState(false);
  const [transferModal, setTransferModal] = useState(false);
  const [ruleModal, setRuleModal] = useState(false);
  const [categoryModal, setCategoryModal] = useState(false);
  const [loginModal, setLoginModal] = useState(false);
  const [familyModal, setFamilyModal] = useState(false);

  // ===== 家庭同步状态 =====
  const [serverUrl, setServerUrl] = useState('');          // 已保存的服务器地址
  const [serverUrlDraft, setServerUrlDraft] = useState(''); // 输入中的地址
  const [syncToken, setSyncToken] = useState('');
  const [loggedName, setLoggedName] = useState('');
  const [loggedAvatar, setLoggedAvatar] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [lastSyncTime, setLastSyncTime] = useState(0);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncUid, setSyncUid] = useState(0);

  // 读取同步配置（reload 时一并刷新）
  const loadSyncState = useCallback(async () => {
    try {
      const [url, token, name, avatar, family, lastSync, uid] = await Promise.all([
        getSetting(SETTING_KEYS.SYNC_SERVER_URL),
        getSetting(SETTING_KEYS.SYNC_TOKEN),
        getSetting(SETTING_KEYS.SYNC_USER_DISPLAY),
        getSetting(SETTING_KEYS.SYNC_USER_AVATAR),
        getSetting('sync.family_name'),
        getSetting(SETTING_KEYS.SYNC_LAST_SYNC_TIME),
        getSetting(SETTING_KEYS.SYNC_USER_ID),
      ]);
      setServerUrl(url ?? '');
      setServerUrlDraft(url ?? '');
      setSyncToken(token ?? '');
      setLoggedName(name ?? '');
      setLoggedAvatar(avatar ?? '');
      setFamilyName(family ?? '');
      setLastSyncTime(Number(lastSync ?? '0') || 0);
      setSyncUid(Number(uid ?? '0') || 0);
    } catch {
      // 同步配置读取失败保持现状
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      const [accs, rs, rsSum, rsRec, cats, count, budget, type] = await Promise.all([
        getAccounts(),
        getRecurringRules(),
        getReimbursableSummary(),
        getReimbursableRecords(),
        getCustomCategoriesDB(),
        getTotalCount(),
        getSetting(SETTING_KEYS.MONTHLY_BUDGET),
        getSetting(SETTING_KEYS.DEFAULT_TYPE),
      ]);
      setAccounts(accs);
      setRules(rs);
      setReimburseSummary(rsSum);
      setReimburseRecords(rsRec);
      setCustomCategoriesState(cats);
      setTotalCount(count);
      setBudgetText(budget ?? '');
      setDefaultIncome(type === 'income');
    } catch {
      showToast('管理页数据加载失败', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    reload();
    loadSyncState();
  }, [reload, loadSyncState]);

  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.RECORDED, reload),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.DATA_IMPORTED, reload),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SYNC_DONE, loadSyncState),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [reload, loadSyncState]);

  // ===== 家庭同步操作 =====

  // 保存服务器地址（探活）
  const handleSaveServer = useCallback(async () => {
    const url = serverUrlDraft.trim().replace(/\/+$/, '');
    if (!url) {
      await saveSetting(SETTING_KEYS.SYNC_SERVER_URL, '');
      setServerUrl('');
      hapticLight();
      showToast('已清除服务器地址');
      return;
    }
    try {
      await apiHealth(url);
      await saveSetting(SETTING_KEYS.SYNC_SERVER_URL, url);
      setServerUrl(url);
      hapticSuccess();
      showToast('服务器连接成功');
    } catch (e) {
      hapticError();
      showToast(e instanceof Error ? e.message : '连接失败，请检查地址', 'error');
    }
  }, [serverUrlDraft, showToast]);

  // 登录/注册成功
  const handleAuthed = useCallback(async (token: string, user: { id: number; displayName: string; avatarEmoji: string; familyId: number | null }) => {
    await Promise.all([
      saveSetting(SETTING_KEYS.SYNC_TOKEN, token),
      saveSetting(SETTING_KEYS.SYNC_USER_ID, String(user.id)),
      saveSetting(SETTING_KEYS.SYNC_USER_DISPLAY, user.displayName),
      saveSetting(SETTING_KEYS.SYNC_USER_AVATAR, user.avatarEmoji),
    ]);
    // 本地历史记录归属当前用户
    await claimLocalRecordsAsUser(user.id);
    setSyncToken(token);
    setLoggedName(user.displayName);
    setLoggedAvatar(user.avatarEmoji);
    setLoginModal(false);
    hapticSuccess();
    showToast(`欢迎，${user.displayName}`);
    DeviceEventEmitter.emit(LEDGER_EVENTS.AUTH_CHANGED);
    // 查询家庭名
    try {
      const { family } = await apiGetFamily(serverUrlDraft.trim().replace(/\/+$/, ''), token);
      await saveSetting('sync.family_name', family?.name ?? '');
      setFamilyName(family?.name ?? '');
      if (family) {
        // 已入家庭 → 首次同步（推送本地存量 + 拉取家人数据）
        setSyncBusy(true);
        const res = await runSync();
        setSyncBusy(false);
        if (res.ok) showToast(`已同步：上传 ${res.pushed} 条，下载 ${res.pulled} 条`);
      }
    } catch {
      // 家庭信息查询失败不阻断
    }
    loadSyncState();
  }, [serverUrlDraft, showToast, loadSyncState]);

  // 家庭变化（创建/加入/退出）
  const handleFamilyChanged = useCallback(async () => {
    try {
      const url = serverUrl || serverUrlDraft.trim().replace(/\/+$/, '');
      const { family } = await apiGetFamily(url, syncToken);
      await saveSetting('sync.family_name', family?.name ?? '');
      setFamilyName(family?.name ?? '');
      if (family) {
        setSyncBusy(true);
        const res = await runSync();
        setSyncBusy(false);
        if (res.ok) showToast(`已同步：上传 ${res.pushed} 条，下载 ${res.pulled} 条`);
        else showToast(res.error ?? '同步失败', 'error');
      }
      DeviceEventEmitter.emit(LEDGER_EVENTS.AUTH_CHANGED);
    } catch (e) {
      showToast(e instanceof Error ? e.message : '操作失败', 'error');
    }
  }, [serverUrl, serverUrlDraft, syncToken, showToast]);

  // 手动同步
  const handleSyncNow = useCallback(async () => {
    if (!serverUrl || !syncToken) {
      showToast('请先配置服务器并登录', 'error');
      return;
    }
    if (isSyncing() || syncBusy) return;
    setSyncBusy(true);
    const res = await runSync();
    setSyncBusy(false);
    if (res.ok) {
      hapticSuccess();
      showToast(res.pushed + res.pulled > 0 ? `已同步：上传 ${res.pushed} 条，下载 ${res.pulled} 条` : '已是最新');
    } else {
      hapticError();
      showToast(res.error ?? '同步失败', 'error');
    }
    loadSyncState();
  }, [serverUrl, syncToken, syncBusy, showToast, loadSyncState]);

  // 退出登录（保留服务器地址）
  const handleLogout = useCallback(async () => {
    Alert.alert('退出登录', '退出后停止同步（本地数据保留）。确定？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          await Promise.all([
            saveSetting(SETTING_KEYS.SYNC_TOKEN, ''),
            saveSetting(SETTING_KEYS.SYNC_USER_ID, '0'),
            saveSetting(SETTING_KEYS.SYNC_USER_DISPLAY, ''),
            saveSetting(SETTING_KEYS.SYNC_USER_AVATAR, ''),
            saveSetting('sync.family_name', ''),
          ]);
          setSyncToken('');
          setLoggedName('');
          setLoggedAvatar('');
          setFamilyName('');
          hapticLight();
          showToast('已退出登录');
          DeviceEventEmitter.emit(LEDGER_EVENTS.AUTH_CHANGED);
        },
      },
    ]);
  }, [showToast]);

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
      await reload();
      DeviceEventEmitter.emit(LEDGER_EVENTS.ACCOUNTS_CHANGED);
    } catch {
      hapticError();
      showToast('添加失败', 'error');
    }
  }, [reload, showToast]);

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
            await reload();
            DeviceEventEmitter.emit(LEDGER_EVENTS.ACCOUNTS_CHANGED);
          } catch {
            hapticError();
            showToast('删除失败', 'error');
          }
        },
      },
    ]);
  }, [reload, showToast]);

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
      await reload();
      DeviceEventEmitter.emit(LEDGER_EVENTS.RECORDED);
    } catch {
      hapticError();
      showToast('转账失败', 'error');
    }
  }, [reload, showToast]);

  // ===== 周期记账 =====
  const handleAddRule = useCallback(async (rule: RecurringRuleInput) => {
    if (!rule.name.trim()) {
      hapticError();
      showToast('请输入名称', 'error');
      return;
    }
    if (!(rule.amount > 0)) {
      hapticError();
      showToast('请输入有效金额', 'error');
      return;
    }
    try {
      await addRecurringRule({ ...rule, name: rule.name.trim(), lastGenerated: '' });
      hapticSuccess();
      showToast('周期记账已添加');
      setRuleModal(false);
      await reload();
    } catch {
      hapticError();
      showToast('添加失败', 'error');
    }
  }, [reload, showToast]);

  const handleToggleRule = useCallback(async (rule: RecurringRule) => {
    try {
      await updateRecurringRule({ ...rule, enabled: !rule.enabled });
      hapticLight();
      await reload();
    } catch {
      hapticError();
    }
  }, [reload]);

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

  // ===== 报销 =====
  const handleMarkAllReimbursed = useCallback(async () => {
    try {
      await markAllReimbursed();
      hapticSuccess();
      showToast('已全部核销');
      DeviceEventEmitter.emit(LEDGER_EVENTS.RECORDED);
      await reload();
    } catch {
      hapticError();
      showToast('操作失败', 'error');
    }
  }, [reload, showToast]);

  const handleToggleReimbursed = useCallback(async (record: LedgerRecord) => {
    try {
      await setReimbursed(record.id, !record.reimbursed);
      hapticLight();
      DeviceEventEmitter.emit(LEDGER_EVENTS.RECORDED);
      await reload();
    } catch {
      hapticError();
    }
  }, [reload]);

  // ===== 自定义分类 =====
  const handleAddCategory = useCallback(async (label: string, emoji: string, color: string, type: RecordType) => {
    if (!label.trim()) {
      hapticError();
      showToast('请输入分类名称', 'error');
      return;
    }
    try {
      const key = `custom_${Date.now()}`;
      await addCustomCategory({ key, label: label.trim(), emoji: emoji || '📌', color, type });
      await setCustomCategoriesCache();
      hapticSuccess();
      showToast('分类已添加');
      setCategoryModal(false);
      await reload();
      DeviceEventEmitter.emit(LEDGER_EVENTS.CATEGORIES_CHANGED);
    } catch {
      hapticError();
      showToast('添加失败', 'error');
    }
  }, [reload, showToast]);

  const handleDeleteCategory = useCallback((cat: CustomCategory) => {
    Alert.alert('删除分类', `删除「${cat.label}」？已使用该分类的记录不受影响。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCustomCategory(cat.key);
            await setCustomCategoriesCache();
            hapticSuccess();
            await reload();
            DeviceEventEmitter.emit(LEDGER_EVENTS.CATEGORIES_CHANGED);
          } catch {
            hapticError();
          }
        },
      },
    ]);
  }, [reload]);

  // ===== 备份 =====
  const handleExport = useCallback(async () => {
    const result = await exportLedgerData();
    if (result.success) showToast(`已导出 ${result.count} 条记录`);
    else if (result.error) showToast(result.error, 'error');
  }, [showToast]);

  const handleExportCSV = useCallback(async () => {
    try {
      const records = await getAllRecords();
      const result = await exportCSV(records);
      if (result.success) showToast(`已导出 CSV（${records.length} 条）`);
      else if (result.error) showToast(result.error, 'error');
    } catch {
      showToast('导出失败', 'error');
    }
  }, [showToast]);

  const confirmImport = useCallback(() => {
    Alert.alert('导入数据', '选择导入方式', [
      { text: '取消', style: 'cancel' },
      { text: '合并', onPress: () => doImport('merge') },
      { text: '替换', style: 'destructive', onPress: () => doImport('replace') },
    ]);
  }, []);

  const doImport = useCallback(async (strategy: ImportStrategy) => {
    const result = await pickAndImportData(strategy);
    if (result.cancelled) return;
    if (result.success) {
      hapticSuccess();
      let msg = `已导入 ${result.imported} 条记录`;
      const extras: string[] = [];
      if (result.skipped > 0) extras.push(`跳过 ${result.skipped} 条无效`);
      if ((result.failed ?? 0) > 0) extras.push(`${result.failed} 项附属数据失败`);
      if (extras.length > 0) msg += `（${extras.join('，')}）`;
      showToast(msg, (result.failed ?? 0) > 0 ? 'info' : 'success');
      await reload();
    } else {
      hapticError();
      showToast(result.error ?? '导入失败', 'error');
    }
  }, [reload, showToast]);

  // ===== 设置 =====
  const handleSaveBudget = useCallback(async () => {
    const n = parseFloat(budgetText);
    if (budgetText.trim() === '') {
      await saveSetting(SETTING_KEYS.MONTHLY_BUDGET, '');
      hapticSuccess();
      showToast('已取消月度预算');
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
  }, [budgetText, showToast]);

  const handleDefaultType = useCallback(async (value: boolean) => {
    setDefaultIncome(value);
    await saveSetting(SETTING_KEYS.DEFAULT_TYPE, value ? 'income' : 'expense');
    hapticSuccess();
  }, []);

  // 渲染用数据
  const accountNames = useMemo(() => {
    const map: Record<number, string> = {};
    for (const a of accounts) map[a.id] = a.emoji + ' ' + a.name;
    return map;
  }, [accounts]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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

        {/* ===== 周期记账 ===== */}
        <Text style={styles.sectionTitle}>周期记账</Text>
        <View style={styles.card}>
          {rules.length === 0 ? (
            <Text style={styles.emptyText}>还没有周期记账，添加工资/房租/订阅等自动记账 ✨</Text>
          ) : (
            rules.map((rule) => {
              const cat = findCategory(rule.category, rule.type);
              const freqLabel = RECURRING_FREQUENCIES.find((f) => f.key === rule.frequency)?.label ?? rule.frequency;
              return (
                <View key={rule.id} style={styles.ruleRow}>
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
          <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.accent }]} onPress={() => setRuleModal(true)}>
            <Text style={styles.actionBtnText}>＋ 添加周期记账</Text>
          </Pressable>
        </View>

        {/* ===== 报销 ===== */}
        <Text style={styles.sectionTitle}>报销</Text>
        <View style={styles.card}>
          <View style={styles.reimburseHead}>
            <View>
              <Text style={styles.reimburseTotal}>待报销 ¥{formatMoney(reimburseSummary.total)}</Text>
              <Text style={styles.reimburseCount}>{reimburseSummary.count} 笔待核销</Text>
            </View>
            {reimburseSummary.count > 0 ? (
              <Pressable style={styles.reimburseBtn} onPress={handleMarkAllReimbursed}>
                <Text style={styles.reimburseBtnText}>一键全部核销</Text>
              </Pressable>
            ) : null}
          </View>
          {reimburseRecords.length > 0 ? (
            <RecordList
              records={reimburseRecords}
              accountNames={accountNames}
            />
          ) : (
            <Text style={styles.emptyText}>暂无报销记录</Text>
          )}
        </View>

        {/* ===== 分类管理 ===== */}
        <Text style={styles.sectionTitle}>自定义分类</Text>
        <View style={styles.card}>
          {customCategories.length === 0 ? (
            <Text style={styles.emptyText}>还没有自定义分类</Text>
          ) : (
            customCategories.map((cat) => (
              <View key={cat.key} style={styles.catRow}>
                <View style={[styles.accIcon, { backgroundColor: `${cat.color}22` }]}>
                  <Text style={styles.accEmoji}>{cat.emoji}</Text>
                </View>
                <Text style={styles.accName}>{cat.label}</Text>
                <Text style={styles.accType}>{cat.type === 'expense' ? '支出' : '收入'}</Text>
                <Pressable onPress={() => handleDeleteCategory(cat)} hitSlop={8}>
                  <Text style={styles.accDeleteText}>✕</Text>
                </Pressable>
              </View>
            ))
          )}
          <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.accent }]} onPress={() => setCategoryModal(true)}>
            <Text style={styles.actionBtnText}>＋ 添加分类</Text>
          </Pressable>
        </View>

        {/* ===== 家庭同步 ===== */}
        <Text style={styles.sectionTitle}>家庭同步</Text>
        <View style={styles.card}>
          {/* 服务器地址 */}
          <View style={styles.budgetRow}>
            <Text style={styles.label}>服务器地址</Text>
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="如 http://192.168.1.10:8420"
              placeholderTextColor={COLORS.textTertiary}
              value={serverUrlDraft}
              onChangeText={setServerUrlDraft}
              autoCapitalize="none"
              keyboardType="url"
            />
            <Pressable style={styles.primaryBtn} onPress={handleSaveServer}>
              <Text style={styles.primaryBtnText}>连接</Text>
            </Pressable>
          </View>

          {serverUrl ? (
            syncToken ? (
              <>
                {/* 已登录 */}
                <View style={styles.syncUserRow}>
                  <View style={styles.syncAvatar}>
                    <Text style={styles.syncAvatarEmoji}>{loggedAvatar || '🙂'}</Text>
                  </View>
                  <View style={styles.syncUserInfo}>
                    <Text style={styles.syncUserName}>{loggedName || '已登录'}</Text>
                    <Text style={styles.syncFamilyName}>
                      {familyName ? `🏠 ${familyName}` : '未加入家庭（点击下方管理创建/加入）'}
                    </Text>
                  </View>
                </View>
                <View style={styles.btnRow}>
                  {familyName ? (
                    <Pressable
                      style={[styles.actionBtn, { backgroundColor: COLORS.accent, opacity: syncBusy ? 0.6 : 1 }]}
                      onPress={handleSyncNow}
                      disabled={syncBusy}
                    >
                      <Text style={styles.actionBtnText}>{syncBusy ? '同步中…' : '🔄 立即同步'}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.transfer }]} onPress={() => setFamilyModal(true)}>
                    <Text style={styles.actionBtnText}>👨‍👩‍👧 家庭管理</Text>
                  </Pressable>
                </View>
                {familyName ? (
                  <Text style={styles.hint}>
                    {lastSyncTime > 0 ? `上次同步：${formatSyncTime(lastSyncTime)}` : '尚未同步过，点击「立即同步」开始'}
                  </Text>
                ) : null}
                <Pressable style={styles.logoutRow} onPress={handleLogout} hitSlop={8}>
                  <Text style={styles.logoutText}>退出登录</Text>
                </Pressable>
              </>
            ) : (
              <>
                {/* 未登录 */}
                <Text style={styles.hint}>连接自建服务端后，可与家人共享一本账（可选功能，不登录则纯本地使用）</Text>
                <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.accent }]} onPress={() => setLoginModal(true)}>
                  <Text style={styles.actionBtnText}>🔑 登录 / 注册</Text>
                </Pressable>
              </>
            )
          ) : (
            <Text style={styles.hint}>填入 NAS 上部署的服务端地址（见 server/README.md），和家人一起记账</Text>
          )}
        </View>

        {/* ===== 数据备份 ===== */}
        <Text style={styles.sectionTitle}>数据备份</Text>
        <View style={styles.card}>
          <View style={styles.dataRow}>
            <Text style={styles.label}>本地记录</Text>
            <Text style={styles.dataCount}>{totalCount} 条</Text>
          </View>
          <View style={styles.btnRow}>
            <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.accent }]} onPress={handleExport}>
              <Text style={styles.actionBtnText}>导出 JSON</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.income }]} onPress={handleExportCSV}>
              <Text style={styles.actionBtnText}>导出 Excel</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.bgAlt }]} onPress={confirmImport}>
              <Text style={[styles.actionBtnText, { color: COLORS.text }]}>导入数据</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>JSON 完整备份（含账户/周期/报销）；Excel 供日常查看分析</Text>
        </View>

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
              keyboardType="numeric"
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
      {/* ===== 弹窗：周期记账 ===== */}
      <RuleModal
        visible={ruleModal}
        accounts={accounts}
        onClose={() => setRuleModal(false)}
        onSubmit={handleAddRule}
      />
      {/* ===== 弹窗：自定义分类 ===== */}
      <CategoryModal
        visible={categoryModal}
        onClose={() => setCategoryModal(false)}
        onSubmit={handleAddCategory}
      />
      {/* ===== 弹窗：登录/注册 ===== */}
      <LoginModal
        visible={loginModal}
        baseUrl={serverUrl}
        onClose={() => setLoginModal(false)}
        onAuthed={handleAuthed}
        onError={(msg) => showToast(msg, 'error')}
      />
      {/* ===== 弹窗：家庭管理 ===== */}
      {syncToken ? (
        <FamilyModal
          visible={familyModal}
          baseUrl={serverUrl}
          token={syncToken}
          currentUserId={syncUid}
          onClose={() => setFamilyModal(false)}
          onFamilyChanged={handleFamilyChanged}
          onError={(msg) => showToast(msg, 'error')}
        />
      ) : null}

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
          />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>初始余额（元，可选）</Text>
          <TextInput
            style={styles.input}
            placeholder="0"
            placeholderTextColor={COLORS.textTertiary}
            keyboardType="numeric"
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
            keyboardType="numeric"
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

// ===== 周期记账弹窗 =====
function RuleModal({ visible, accounts, onClose, onSubmit }: {
  visible: boolean;
  accounts: AccountBalance[];
  onClose: () => void;
  onSubmit: (rule: RecurringRuleInput) => void;
}) {
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

  useEffect(() => {
    if (visible) {
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
  }, [visible, accounts]);

  const submit = () => {
    onSubmit({
      name, amount: parseFloat(amount) || 0, type, category, accountId,
      frequency, dayOfWeek, dayOfMonth, monthOfYear, note, enabled: true, lastGenerated: '',
    });
  };

  return (
    <Modal visible={visible} title="添加周期记账" onClose={onClose} height={560}>
      <ScrollView showsVerticalScrollIndicator={false} style={styles.modalScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>名称</Text>
          <TextInput
            style={styles.input}
            placeholder="如 工资 / 房租 / 会员订阅"
            placeholderTextColor={COLORS.textTertiary}
            value={name}
            onChangeText={setName}
            maxLength={12}
          />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>金额（元）</Text>
          <TextInput
            style={styles.input}
            placeholder="0.00"
            placeholderTextColor={COLORS.textTertiary}
            keyboardType="numeric"
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
                style={[styles.pickChip, frequency === f.key && styles.pickChipOn]}
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
                  style={[styles.pickChip, dayOfWeek === i && styles.pickChipOn]}
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
                  style={[styles.pickChip, dayOfMonth === d && styles.pickChipOn]}
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
                  style={[styles.pickChip, monthOfYear === m && styles.pickChipOn]}
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
          />
        </View>
        <Pressable style={[styles.submitBtn, { backgroundColor: COLORS.accent }]} onPress={submit}>
          <Text style={styles.submitText}>保存</Text>
        </Pressable>
      </ScrollView>
    </Modal>
  );
}

// ===== 自定义分类弹窗 =====
function CategoryModal({ visible, onClose, onSubmit }: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (label: string, emoji: string, color: string, type: RecordType) => void;
}) {
  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('📌');
  const [color, setColor] = useState(COLORS.accent);
  const [type, setType] = useState<RecordType>('expense');

  useEffect(() => {
    if (visible) {
      setLabel('');
      setEmoji('📌');
      setColor(COLORS.accent);
      setType('expense');
    }
  }, [visible]);

  return (
    <Modal visible={visible} title="添加自定义分类" onClose={onClose}>
      <View style={styles.formGroup}>
        <Text style={styles.fieldLabel}>名称</Text>
        <TextInput
          style={styles.input}
          placeholder="如 宠物 / 旅行"
          placeholderTextColor={COLORS.textTertiary}
          value={label}
          onChangeText={setLabel}
          maxLength={6}
        />
      </View>
      <View style={styles.formGroup}>
        <Text style={styles.fieldLabel}>表情图标</Text>
        <TextInput
          style={styles.input}
          placeholder="如 🐱 ✈️ 🎁"
          placeholderTextColor={COLORS.textTertiary}
          value={emoji}
          onChangeText={setEmoji}
          maxLength={4}
        />
      </View>
      <View style={styles.formGroup}>
        <Text style={styles.fieldLabel}>归属</Text>
        <View style={styles.typeSwitch}>
          {(['expense', 'income'] as RecordType[]).map((t) => (
            <Pressable
              key={t}
              style={[styles.typeBtn, type === t && (t === 'expense' ? styles.typeBtnExpense : styles.typeBtnIncome)]}
              onPress={() => setType(t)}
            >
              <Text style={[styles.typeText, type === t && styles.typeTextActive]}>
                {t === 'expense' ? '支出' : '收入'}
              </Text>
            </Pressable>
          ))}
        </View>
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
      <Pressable style={[styles.submitBtn, { backgroundColor: COLORS.accent }]} onPress={() => onSubmit(label, emoji, color, type)}>
        <Text style={styles.submitText}>保存</Text>
      </Pressable>
    </Modal>
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
  label: {
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    fontWeight: '600',
  },
  hint: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    lineHeight: 17,
  },
  emptyText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textTertiary,
    paddingVertical: SPACING.xs,
  },
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
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
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
  reimburseHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  reimburseTotal: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '800',
    color: COLORS.text,
  },
  reimburseCount: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  reimburseBtn: {
    backgroundColor: COLORS.warningBg,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: 7,
  },
  reimburseBtnText: {
    color: COLORS.warningText,
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dataCount: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
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
  primaryBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.lg,
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingInfo: {
    flex: 1,
    gap: 2,
    paddingRight: SPACING.md,
  },
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
  // 弹窗表单样式
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
  pickChipOn: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
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
  catWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
    paddingVertical: 8,
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
  // ===== 家庭同步 =====
  syncUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  syncAvatar: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncAvatarEmoji: {
    fontSize: FONT_SIZE.xl,
  },
  syncUserInfo: {
    flex: 1,
  },
  syncUserName: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: COLORS.text,
  },
  syncFamilyName: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  logoutRow: {
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    marginTop: SPACING.xs,
  },
  logoutText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.danger,
    fontWeight: '600',
  },
});
