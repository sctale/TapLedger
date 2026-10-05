import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  DeviceEventEmitter,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { COLORS, FONT_SIZE, LEDGER_EVENTS, RADIUS, SETTING_KEYS, SPACING } from '../../constants';
import { getSetting, saveSetting, setActiveLedgerId as setDbActiveLedgerId } from '../../database/ledgerDB';
import { hapticError, hapticLight, hapticSuccess } from '../../utils/haptics';
import { useToast } from '../../hooks/useToast';
import LoginModal from '../../components/LoginModal';
import FamilyModal from '../../components/FamilyModal';
import Modal from '../../components/Modal';
import { runSync, claimLocalRecordsAsUser, isSyncing } from '../../sync/syncEngine';
import {
  apiHealth,
  apiGetFamily,
  apiGetLedgers,
  apiChangePassword,
  apiDeleteAccount,
} from '../../sync/apiClient';
import type { LedgerInfo } from '../../sync/serverTypes';
import { manageStyles } from './sharedStyles';

// 同步时间的友好显示（从 ManageScreen 迁移）
function formatSyncTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 本页补充样式（sharedStyles 未覆盖的同步专属键，值与原 ManageScreen styles 一致）
const extraStyles = StyleSheet.create({
  budgetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // ===== 服务器地址脱敏状态行 =====
  serverStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  serverDot: {
    width: 8,
    height: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.income,
  },
  serverStatusText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  serverEditBtn: {
    paddingVertical: 4,
    paddingHorizontal: SPACING.sm,
  },
  serverEditText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.accent,
    fontWeight: '700',
  },
  serverCancelBtn: {
    paddingVertical: 4,
    paddingHorizontal: SPACING.xs,
  },
  serverCancelText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textTertiary,
    fontWeight: '600',
  },
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
  ledgerRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  ledgerChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
  },
  ledgerChipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  ledgerChipText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  ledgerChipTextActive: {
    color: COLORS.white,
    fontWeight: '700',
  },
  logoutRow: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
    marginTop: SPACING.xs,
  },
  logoutText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.danger,
    fontWeight: '600',
  },
  // 账号安全操作行（改密码 / 注销），触摸高度按 ≥44dp 留白
  accountRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.lg,
  },
  accountLink: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.sm,
  },
  accountLinkText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
});

// 共用样式 + 本页补充（键名与原 ManageScreen styles 保持一致）
const styles = { ...manageStyles, ...extraStyles };

// 家庭同步二级页（v0.5.9 从 ManageScreen 拆分；顶栏返回按钮由外层 ManageScreen 统一渲染）
export default function SyncScreen() {
  const { showToast } = useToast();

  // 弹窗状态
  const [loginModal, setLoginModal] = useState(false);
  const [familyModal, setFamilyModal] = useState(false);

  // ===== 家庭同步状态 =====
  const [serverUrl, setServerUrl] = useState(''); // 已保存的服务器地址（不展示明文）
  const [serverUrlDraft, setServerUrlDraft] = useState(''); // 输入中的地址（仅在编辑态使用）
  const [editingServer, setEditingServer] = useState(false); // 修改地址编辑态（已连接时不显示明文）
  const [syncToken, setSyncToken] = useState('');
  const [loggedName, setLoggedName] = useState('');
  const [loggedAvatar, setLoggedAvatar] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [lastSyncTime, setLastSyncTime] = useState(0);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncUid, setSyncUid] = useState(0);
  const [ledgers, setLedgers] = useState<LedgerInfo[]>([]); // 可用账本（个人+家庭）
  const [activeLedgerId, setActiveLedgerId] = useState(0);
  const [ledgerSwitchBusy, setLedgerSwitchBusy] = useState(false);
  // 服务器可达性（v0.11.2）：null=未配置或检测中，true=可达，false=不可达
  // 此前「已连接服务器」仅由本地配置驱动，断网时也常亮绿点，误导用户
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);

  // 读取同步配置（reload 时一并刷新）
  // 离开二级页时本组件会卸载，而健康探测/账本拉取是异步的 → 用 mounted + 序号
  // 避免「后回来的旧响应覆盖新结果」和对已卸载组件 setState
  const mountedRef = useRef(true);
  const healthSeq = useRef(0);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const loadSyncState = useCallback(async () => {
    try {
      const [url, token, name, avatar, family, lastSync, uid, actId] = await Promise.all([
        getSetting(SETTING_KEYS.SYNC_SERVER_URL),
        getSetting(SETTING_KEYS.SYNC_TOKEN),
        getSetting(SETTING_KEYS.SYNC_USER_DISPLAY),
        getSetting(SETTING_KEYS.SYNC_USER_AVATAR),
        getSetting(SETTING_KEYS.SYNC_FAMILY_NAME),
        getSetting(SETTING_KEYS.SYNC_LAST_SYNC_TIME),
        getSetting(SETTING_KEYS.SYNC_USER_ID),
        getSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_ID),
      ]);
      if (!mountedRef.current) return;
      setServerUrl(url ?? '');
      setServerUrlDraft(''); // 已保存地址不回填明文，仅在编辑态输入
      setEditingServer(false);
      setSyncToken(token ?? '');
      setLoggedName(name ?? '');
      setLoggedAvatar(avatar ?? '');
      setFamilyName(family ?? '');
      setLastSyncTime(Number(lastSync ?? '0') || 0);
      setSyncUid(Number(uid ?? '0') || 0);
      const actIdNum = Number(actId ?? '0') || 0;
      setActiveLedgerId(actIdNum);
      setDbActiveLedgerId(actIdNum); // 本地读写作用域与持久化的活动账本保持一致
      // 可达性探测（异步，不阻塞本页其余加载）：每次进入页面/同步完成/登录态变化都会刷新
      if (url) {
        const seq = ++healthSeq.current;
        setServerOnline(null);
        apiHealth(url)
          .then(() => {
            if (mountedRef.current && seq === healthSeq.current) setServerOnline(true);
          })
          .catch(() => {
            if (mountedRef.current && seq === healthSeq.current) setServerOnline(false);
          });
      } else {
        setServerOnline(null);
      }
      // 登录后拉取账本列表
      if (url && token) {
        try {
          const { ledgers: list } = await apiGetLedgers(url, token);
          if (!mountedRef.current) return;
          setLedgers(list);
          // 未显式选中 → 自动选中个人账本
          const personal = list.find((l) => l.type === 'personal');
          const target = list.find((l) => l.id === actIdNum) || personal;
          if (target && target.id !== actIdNum) {
            setActiveLedgerId(target.id);
            setDbActiveLedgerId(target.id);
            saveSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_ID, String(target.id));
            saveSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_NAME, target.name);
          }
        } catch {
          // 账本列表拉取失败不阻断
        }
      }
    } catch {
      // 同步配置读取失败保持现状
    }
  }, []);

  // 挂载时加载
  useEffect(() => {
    loadSyncState();
  }, [loadSyncState]);

  // 同步完成更新上次同步时间；登录态变化（登录/退出/加入家庭）重载状态
  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SYNC_DONE, loadSyncState),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.AUTH_CHANGED, loadSyncState),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [loadSyncState]);

  // ===== 家庭同步操作 =====

  // 保存服务器地址（探活）；已连接状态下进入编辑态需先点「修改」
  const handleSaveServer = useCallback(async () => {
    const url = serverUrlDraft.trim().replace(/\/+$/, '');
    if (!url) {
      await saveSetting(SETTING_KEYS.SYNC_SERVER_URL, '');
      setServerUrl('');
      setServerOnline(null);
      setEditingServer(false);
      hapticLight();
      showToast('已清除服务器地址');
      return;
    }
    try {
      await apiHealth(url);
      await saveSetting(SETTING_KEYS.SYNC_SERVER_URL, url);
      setServerUrl(url);
      setServerOnline(true); // 探测刚成功，直接置「已连接」
      setServerUrlDraft('');
      setEditingServer(false); // 连接成功退出编辑态，地址不再明文展示
      hapticSuccess();
      showToast('服务器连接成功');
    } catch (e) {
      hapticError();
      showToast(e instanceof Error ? e.message : '连接失败，请检查地址', 'error');
    }
  }, [serverUrlDraft, showToast]);

  // 登录/注册成功
  const handleAuthed = useCallback(
    async (
      token: string,
      user: { id: number; displayName: string; avatarEmoji: string; familyId: number | null },
    ) => {
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
      // 查询家庭名（服务器地址用已保存值，编辑态草稿不再回填明文）
      try {
        const { family } = await apiGetFamily(serverUrl, token);
        await saveSetting(SETTING_KEYS.SYNC_FAMILY_NAME, family?.name ?? '');
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
    },
    [serverUrl, showToast, loadSyncState],
  );

  // 家庭变化（创建/加入/退出/资料修改）
  const handleFamilyChanged = useCallback(async () => {
    try {
      const url = serverUrl || serverUrlDraft.trim().replace(/\/+$/, '');
      const { family } = await apiGetFamily(url, syncToken);
      await saveSetting(SETTING_KEYS.SYNC_FAMILY_NAME, family?.name ?? '');
      setFamilyName(family?.name ?? '');
      // 资料可能已修改（昵称/头像），从服务端回读并更新本地缓存（v0.5）
      try {
        const { apiMe } = await import('../../sync/apiClient');
        const { user } = await apiMe(url, syncToken);
        await Promise.all([
          saveSetting(SETTING_KEYS.SYNC_USER_DISPLAY, user.displayName),
          saveSetting(SETTING_KEYS.SYNC_USER_AVATAR, user.avatarEmoji),
        ]);
        setLoggedName(user.displayName);
        setLoggedAvatar(user.avatarEmoji);
      } catch {
        // 回读失败不阻断
      }
      if (family) {
        setSyncBusy(true);
        try {
          const res = await runSync();
          if (res.ok) showToast(`已同步：上传 ${res.pushed} 条，下载 ${res.pulled} 条`);
          else showToast(res.error ?? '同步失败', 'error');
        } finally {
          setSyncBusy(false);
        }
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
    try {
      const res = await runSync();
      if (res.ok) {
        hapticSuccess();
        // 被服务端判非法而没能上传的条目要单独说清楚：本地看得到、家人看不到，
        // 不说就等于悄悄丢数据（v0.11.8）
        showToast(
          res.invalid
            ? `已同步：上传 ${res.pushed} 条，下载 ${res.pulled} 条；${res.invalid} 条超出字段限制未上传`
            : res.pushed + res.pulled > 0
              ? `已同步：上传 ${res.pushed} 条，下载 ${res.pulled} 条`
              : '已是最新',
          res.invalid ? 'error' : 'success',
        );
      } else {
        hapticError();
        showToast(res.error ?? '同步失败', 'error');
      }
    } finally {
      // runSync 在读取配置阶段就可能 reject；少了这个 finally，busy 永远停在 true，
      // 「立即同步」和账本选择会一直灰着直到离开本页
      setSyncBusy(false);
      loadSyncState();
    }
  }, [serverUrl, syncToken, syncBusy, showToast, loadSyncState]);

  // 切换当前账本（个人/家庭）
  const handleSwitchLedger = useCallback(
    async (target: LedgerInfo) => {
      if (!serverUrl || !syncToken || target.id === activeLedgerId) return;
      if (ledgerSwitchBusy || syncBusy) return;
      setLedgerSwitchBusy(true);
      try {
        await saveSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_ID, String(target.id));
        await saveSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_NAME, target.name);
        setActiveLedgerId(target.id);
        setDbActiveLedgerId(target.id); // 立即切换本地读写作用域
        // 切账本后拉取该账本数据到本地展示
        const res = await runSync();
        if (res.ok) {
          hapticSuccess();
          showToast(
            `已切换到「${target.name}」${res.pushed + res.pulled > 0 ? `，上传 ${res.pushed} / 下载 ${res.pulled}` : ''}`,
          );
        } else {
          showToast(res.error ?? '同步失败', 'error');
        }
        // 活动账本已变，展示的数据集整体切换；无论是否拉到数据都通知各页重新查询
        DeviceEventEmitter.emit(LEDGER_EVENTS.RECORDED);
      } catch (e) {
        hapticError();
        showToast(e instanceof Error ? e.message : '切换失败', 'error');
      } finally {
        setLedgerSwitchBusy(false);
        loadSyncState();
      }
    },
    [serverUrl, syncToken, activeLedgerId, ledgerSwitchBusy, syncBusy, showToast, loadSyncState],
  );

  // 清掉本地登录态（服务器地址保留）——退出登录与注销账号共用
  const clearLoginState = useCallback(async () => {
    await Promise.all([
      saveSetting(SETTING_KEYS.SYNC_TOKEN, ''),
      saveSetting(SETTING_KEYS.SYNC_USER_ID, '0'),
      saveSetting(SETTING_KEYS.SYNC_USER_DISPLAY, ''),
      saveSetting(SETTING_KEYS.SYNC_USER_AVATAR, ''),
      saveSetting(SETTING_KEYS.SYNC_FAMILY_NAME, ''),
      saveSetting(SETTING_KEYS.SYNC_MEMBERS_JSON, ''), // 清空成员缓存（v0.5）
      saveSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_ID, '0'),
      saveSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_NAME, ''),
    ]);
    setSyncToken('');
    setLoggedName('');
    setLoggedAvatar('');
    setFamilyName('');
    setLedgers([]);
    setActiveLedgerId(0);
    setDbActiveLedgerId(0);
    DeviceEventEmitter.emit(LEDGER_EVENTS.AUTH_CHANGED);
  }, [setActiveLedgerId]);

  // 退出登录（保留服务器地址）
  const handleLogout = useCallback(async () => {
    Alert.alert('退出登录', '退出后停止同步（本地数据保留）。确定？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          await clearLoginState();
          hapticLight();
          showToast('已退出登录');
        },
      },
    ]);
  }, [clearLoginState, showToast]);

  // ===== 账号安全操作：改密码 / 注销（Android 没有 Alert.prompt，走全屏表单）=====
  const [accountAction, setAccountAction] = useState<'password' | 'delete' | null>(null);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);

  const openAccountAction = useCallback((action: 'password' | 'delete') => {
    setCurrentPw('');
    setNewPw('');
    setAccountAction(action);
  }, []);

  const submitAccountAction = useCallback(async () => {
    if (!serverUrl || !syncToken) {
      showToast('请先登录', 'error');
      return;
    }
    if (!currentPw) {
      showToast('请输入当前密码', 'error');
      return;
    }
    if (accountAction === 'password' && newPw.length < 6) {
      showToast('新密码至少 6 位', 'error');
      return;
    }
    setAccountBusy(true);
    try {
      if (accountAction === 'password') {
        const { token } = await apiChangePassword(serverUrl, syncToken, currentPw, newPw);
        // 服务端把 token_version +1：本端换发新 token 继续用，其它设备旧 token 立刻 401
        await saveSetting(SETTING_KEYS.SYNC_TOKEN, token);
        setSyncToken(token);
        showToast('密码已修改，其他设备需要重新登录');
      } else if (accountAction === 'delete') {
        const res = await apiDeleteAccount(serverUrl, syncToken, currentPw);
        await clearLoginState();
        showToast(
          res.dissolvedFamily
            ? `账号已注销，家庭账本已解散${res.unboundMembers > 0 ? `（${res.unboundMembers} 位成员已解绑，其本机数据保留）` : ''}`
            : '账号已注销（本地数据保留，不再同步）',
        );
      }
      setAccountAction(null);
      setCurrentPw('');
      setNewPw('');
    } catch (e) {
      hapticError();
      showToast(e instanceof Error ? e.message : '操作失败', 'error');
    } finally {
      setAccountBusy(false);
    }
  }, [accountAction, clearLoginState, currentPw, newPw, serverUrl, setSyncToken, showToast, syncToken]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* ===== 家庭同步 ===== */}
      <Text style={styles.sectionTitle}>家庭同步</Text>
      <View style={styles.card}>
        {/* 服务器地址（已连接不显示明文，点「修改」进入编辑态） */}
        <View style={styles.budgetRow}>
          <Text style={styles.label}>服务器</Text>
          {serverUrl && !editingServer ? (
            <Pressable
              style={styles.serverEditBtn}
              onPress={() => {
                setEditingServer(true);
                setServerUrlDraft('');
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="修改服务器地址"
            >
              <Text style={styles.serverEditText}>修改</Text>
            </Pressable>
          ) : null}
        </View>
        {serverUrl && !editingServer ? (
          // 已配置：仅显示状态，不展示地址明文（截图/演示不泄露内网地址）
          // v0.11.2：绿点「已连接」仅在健康探测成功时显示；断网/服务器宕机显示「不可达」
          <View style={styles.serverStatusRow}>
            <View
              style={[
                styles.serverDot,
                serverOnline === false && { backgroundColor: COLORS.danger },
                serverOnline === null && { backgroundColor: COLORS.textTertiary },
              ]}
            />
            <Text style={styles.serverStatusText}>
              {serverOnline === null ? '正在检测服务器…' : serverOnline ? '已连接服务器' : '服务器不可达'}
            </Text>
            {serverOnline === false ? (
              <Pressable
                style={styles.serverEditBtn}
                onPress={loadSyncState}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="重试连接服务器"
              >
                <Text style={styles.serverEditText}>重试</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder={serverUrl ? '输入新的服务器地址' : '如 http://192.168.1.10:8420'}
              placeholderTextColor={COLORS.textTertiary}
              value={serverUrlDraft}
              onChangeText={setServerUrlDraft}
              autoCapitalize="none"
              keyboardType="url"
            />
            <Pressable style={styles.primaryBtn} onPress={handleSaveServer} accessibilityRole="button">
              <Text style={styles.primaryBtnText}>连接</Text>
            </Pressable>
            {serverUrl && editingServer ? (
              <Pressable
                style={styles.serverCancelBtn}
                onPress={() => {
                  setEditingServer(false);
                  setServerUrlDraft('');
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="取消修改服务器地址"
              >
                <Text style={styles.serverCancelText}>取消</Text>
              </Pressable>
            ) : null}
          </View>
        )}

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
              {/* 账本选择（个人/家庭） */}
              {ledgers.length > 0 ? (
                <>
                  <Text style={styles.label}>账本</Text>
                  <View style={styles.ledgerRow}>
                    {ledgers.map((l) => {
                      const active = l.id === activeLedgerId;
                      return (
                        <Pressable
                          key={l.id}
                          style={[styles.ledgerChip, active && styles.ledgerChipActive]}
                          onPress={() => handleSwitchLedger(l)}
                          disabled={ledgerSwitchBusy || syncBusy}
                          accessibilityRole="tab"
                          accessibilityLabel={`${l.type === 'personal' ? '个人账本' : '家庭账本'}`}
                          accessibilityState={{ selected: active }}
                        >
                          <Text style={[styles.ledgerChipText, active && styles.ledgerChipTextActive]}>
                            {l.type === 'personal' ? '👤 个人账本' : '👨‍👩‍👧 家庭账本'}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {ledgerSwitchBusy ? <Text style={styles.hint}>正在切换账本并拉取数据…</Text> : null}
                </>
              ) : null}
              <View style={styles.btnRow}>
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: COLORS.accent, opacity: syncBusy ? 0.6 : 1 }]}
                  onPress={handleSyncNow}
                  disabled={syncBusy}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionBtnText}>{syncBusy ? '同步中…' : '🔄 立即同步'}</Text>
                </Pressable>
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: COLORS.transfer }]}
                  onPress={() => setFamilyModal(true)}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionBtnText}>👨‍👩‍👧 家庭管理</Text>
                </Pressable>
              </View>
              {familyName ? (
                <Text style={styles.hint}>
                  {lastSyncTime > 0
                    ? `上次同步：${formatSyncTime(lastSyncTime)}`
                    : '尚未同步过，点击「立即同步」开始'}
                </Text>
              ) : null}
              <View style={styles.accountRow}>
                <Pressable
                  style={styles.accountLink}
                  onPress={() => openAccountAction('password')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="修改密码"
                >
                  <Text style={styles.accountLinkText}>修改密码</Text>
                </Pressable>
                <Pressable
                  style={styles.accountLink}
                  onPress={() => openAccountAction('delete')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="注销账号"
                >
                  <Text style={styles.logoutText}>注销账号</Text>
                </Pressable>
              </View>
              <Pressable
                style={styles.logoutRow}
                onPress={handleLogout}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="退出登录"
              >
                <Text style={styles.logoutText}>退出登录</Text>
              </Pressable>
            </>
          ) : (
            <>
              {/* 未登录 */}
              <Text style={styles.hint}>
                连接自建服务端后，可与家人共享一本账（可选功能，不登录则纯本地使用）
              </Text>
              <Pressable
                style={[styles.actionBtn, { backgroundColor: COLORS.accent }]}
                onPress={() => setLoginModal(true)}
                accessibilityRole="button"
              >
                <Text style={styles.actionBtnText}>🔑 登录 / 注册</Text>
              </Pressable>
            </>
          )
        ) : (
          <Text style={styles.hint}>填入 NAS 上部署的服务端地址（见 server/README.md），和家人一起记账</Text>
        )}
      </View>

      {/* ===== 弹窗：登录/注册 ===== */}
      <LoginModal
        visible={loginModal}
        baseUrl={serverUrl}
        onClose={() => setLoginModal(false)}
        onAuthed={handleAuthed}
        onError={(msg) => showToast(msg, 'error')}
      />
      {/* ===== 弹窗：家庭管理（仅登录后渲染） ===== */}
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

      {/* ===== 弹窗：修改密码 / 注销账号（都要求当前密码复核）===== */}
      <Modal
        visible={accountAction !== null}
        title={accountAction === 'delete' ? '注销账号' : '修改密码'}
        onClose={() => setAccountAction(null)}
        saveLabel={accountAction === 'delete' ? '确认注销' : '保存'}
        saveDisabled={accountBusy}
        onSave={submitAccountAction}
      >
        <Text style={styles.hint}>
          {accountAction === 'delete'
            ? '注销会删除服务端账号与你的个人账本；家庭创建者注销即解散家庭账本，其他成员的本机副本保留但不再同步。此操作不可撤销。'
            : '修改密码后，其他设备上的登录状态会立即失效，需要重新登录。'}
        </Text>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>当前密码</Text>
          <TextInput
            style={styles.input}
            value={currentPw}
            onChangeText={setCurrentPw}
            secureTextEntry
            placeholder="用于确认是你本人操作"
            placeholderTextColor={COLORS.textTertiary}
            maxLength={64}
          />
        </View>
        {accountAction === 'password' ? (
          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>新密码</Text>
            <TextInput
              style={styles.input}
              value={newPw}
              onChangeText={setNewPw}
              secureTextEntry
              placeholder="至少 6 位"
              placeholderTextColor={COLORS.textTertiary}
              maxLength={64}
            />
          </View>
        ) : null}
      </Modal>
    </ScrollView>
  );
}
