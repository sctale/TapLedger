import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, DeviceEventEmitter, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { COLORS, FONT_SIZE, LEDGER_EVENTS, RADIUS, SETTING_KEYS, SPACING } from '../../constants';
import { getSetting, saveSetting } from '../../database/ledgerDB';
import { hapticError, hapticLight, hapticSuccess } from '../../utils/haptics';
import { useToast } from '../../hooks/useToast';
import Toast from '../../components/Toast';
import LoginModal from '../../components/LoginModal';
import FamilyModal from '../../components/FamilyModal';
import { runSync, claimLocalRecordsAsUser, isSyncing } from '../../sync/syncEngine';
import { apiHealth, apiGetFamily, apiGetLedgers } from '../../sync/apiClient';
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
    paddingVertical: SPACING.sm,
    marginTop: SPACING.xs,
  },
  logoutText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.danger,
    fontWeight: '600',
  },
});

// 共用样式 + 本页补充（键名与原 ManageScreen styles 保持一致）
const styles = { ...manageStyles, ...extraStyles };

// 家庭同步二级页（v0.5.9 从 ManageScreen 拆分；顶栏返回按钮由外层 ManageScreen 统一渲染）
export default function SyncScreen() {
  const { toast, showToast, hideToast } = useToast();

  // 弹窗状态
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
  const [ledgers, setLedgers] = useState<LedgerInfo[]>([]);      // 可用账本（个人+家庭）
  const [activeLedgerId, setActiveLedgerId] = useState(0);
  const [activeLedgerName, setActiveLedgerName] = useState('');
  const [ledgerSwitchBusy, setLedgerSwitchBusy] = useState(false);

  // 读取同步配置（reload 时一并刷新）
  const loadSyncState = useCallback(async () => {
    try {
      const [url, token, name, avatar, family, lastSync, uid, actId, actName] = await Promise.all([
        getSetting(SETTING_KEYS.SYNC_SERVER_URL),
        getSetting(SETTING_KEYS.SYNC_TOKEN),
        getSetting(SETTING_KEYS.SYNC_USER_DISPLAY),
        getSetting(SETTING_KEYS.SYNC_USER_AVATAR),
        getSetting('sync.family_name'),
        getSetting(SETTING_KEYS.SYNC_LAST_SYNC_TIME),
        getSetting(SETTING_KEYS.SYNC_USER_ID),
        getSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_ID),
        getSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_NAME),
      ]);
      setServerUrl(url ?? '');
      setServerUrlDraft(url ?? '');
      setSyncToken(token ?? '');
      setLoggedName(name ?? '');
      setLoggedAvatar(avatar ?? '');
      setFamilyName(family ?? '');
      setLastSyncTime(Number(lastSync ?? '0') || 0);
      setSyncUid(Number(uid ?? '0') || 0);
      const actIdNum = Number(actId ?? '0') || 0;
      setActiveLedgerId(actIdNum);
      setActiveLedgerName(actName ?? '');
      // 登录后拉取账本列表
      if (url && token) {
        try {
          const { ledgers: list } = await apiGetLedgers(url, token);
          setLedgers(list);
          // 未显式选中 → 自动选中个人账本
          const personal = list.find((l) => l.type === 'personal');
          const target = list.find((l) => l.id === actIdNum) || personal;
          if (target && target.id !== actIdNum) {
            setActiveLedgerId(target.id);
            setActiveLedgerName(target.name);
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

  // 家庭变化（创建/加入/退出/资料修改）
  const handleFamilyChanged = useCallback(async () => {
    try {
      const url = serverUrl || serverUrlDraft.trim().replace(/\/+$/, '');
      const { family } = await apiGetFamily(url, syncToken);
      await saveSetting('sync.family_name', family?.name ?? '');
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

  // 切换当前账本（个人/家庭）
  const handleSwitchLedger = useCallback(async (target: LedgerInfo) => {
    if (!serverUrl || !syncToken || target.id === activeLedgerId) return;
    if (ledgerSwitchBusy || syncBusy) return;
    setLedgerSwitchBusy(true);
    try {
      await saveSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_ID, String(target.id));
      await saveSetting(SETTING_KEYS.SYNC_ACTIVE_LEDGER_NAME, target.name);
      setActiveLedgerId(target.id);
      setActiveLedgerName(target.name);
      // 切账本后拉取该账本数据到本地展示
      const res = await runSync();
      if (res.ok) {
        hapticSuccess();
        showToast(`已切换到「${target.name}」${res.pushed + res.pulled > 0 ? `，上传 ${res.pushed} / 下载 ${res.pulled}` : ''}`);
      } else {
        showToast(res.error ?? '同步失败', 'error');
      }
    } catch (e) {
      hapticError();
      showToast(e instanceof Error ? e.message : '切换失败', 'error');
    } finally {
      setLedgerSwitchBusy(false);
      loadSyncState();
    }
  }, [serverUrl, syncToken, activeLedgerId, ledgerSwitchBusy, syncBusy, showToast, loadSyncState]);

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
          setActiveLedgerName('');
          hapticLight();
          showToast('已退出登录');
          DeviceEventEmitter.emit(LEDGER_EVENTS.AUTH_CHANGED);
        },
      },
    ]);
  }, [showToast]);

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
                  {ledgerSwitchBusy ? (
                    <Text style={styles.hint}>正在切换账本并拉取数据…</Text>
                  ) : null}
                </>
              ) : null}
              <View style={styles.btnRow}>
                <Pressable
                  style={[styles.actionBtn, { backgroundColor: COLORS.accent, opacity: syncBusy ? 0.6 : 1 }]}
                  onPress={handleSyncNow}
                  disabled={syncBusy}
                >
                  <Text style={styles.actionBtnText}>{syncBusy ? '同步中…' : '🔄 立即同步'}</Text>
                </Pressable>
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

      <Toast toast={toast} onHide={hideToast} />
    </ScrollView>
  );
}
