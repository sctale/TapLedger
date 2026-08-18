import React, { useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter, View, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COLORS, LEDGER_EVENTS, setCategoryConfig } from './src/constants';
import { initDatabase, setCustomCategoriesCache, getSetting, getCategoryConfig } from './src/database/ledgerDB';
import { runRecurringCheck } from './src/utils/recurring';
import { getSyncConfig } from './src/sync/apiClient';
import { runSync, purgeOldTombstones } from './src/sync/syncEngine';
import TabBar, { type TabKey } from './src/components/TabBar';
import HomeScreen from './src/screens/HomeScreen';
import LedgerScreen from './src/screens/LedgerScreen';
import StatsScreen from './src/screens/StatsScreen';
import ManageScreen from './src/screens/ManageScreen';

// 已登录时：数据变更后 debounce 自动同步（毫秒）
const AUTO_SYNC_DEBOUNCE = 5000;

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [tab, setTab] = useState<TabKey>('home');
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await initDatabase();
        await setCustomCategoriesCache();
        const cfg = await getCategoryConfig();
        setCategoryConfig(cfg);
      } catch {
        // 初始化失败也放行，页面会自行兜底
      }
      // 周期记账：检查并生成到期记录
      try {
        await runRecurringCheck();
      } catch {
        // 静默
      }
      // 同步：墓碑清理 + 已登录则启动即拉一轮
      try {
        await purgeOldTombstones();
        const config = await getSyncConfig();
        if (config) {
          // 已入家庭才自动同步（未入家庭 pull 会被服务端 403）
          const familyId = await getSetting('sync.family_name');
          if (familyId) {
            const res = await runSync();
            if (res.ok) DeviceEventEmitter.emit(LEDGER_EVENTS.SYNC_DONE);
          }
        }
      } catch {
        // 同步失败静默（断网等场景），下次记账/启动再试
      }
      setDbReady(true);
    })();
  }, []);

  // 数据变更 → debounce 自动同步（仅已配置时；runSync 内部自检配置）
  useEffect(() => {
    const schedule = () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(async () => {
        const res = await runSync();
        if (res.ok && res.pushed + res.pulled > 0) {
          DeviceEventEmitter.emit(LEDGER_EVENTS.SYNC_DONE);
        }
      }, AUTO_SYNC_DEBOUNCE);
    };
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.RECORDED, schedule),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.DATA_IMPORTED, schedule),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.AUTH_CHANGED, schedule),
    ];
    return () => {
      subs.forEach((s) => s.remove());
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, []);

  if (!dbReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={COLORS.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={styles.container}>
        <View style={styles.screen}>
          {/* 保持所有页面挂载，仅切换显隐，避免每次切 tab 重查库；激活时各自滚回顶部 */}
          <View style={[styles.page, tab !== 'home' && styles.pageHidden]}>
            <HomeScreen active={tab === 'home'} />
          </View>
          <View style={[styles.page, tab !== 'ledger' && styles.pageHidden]}>
            <LedgerScreen active={tab === 'ledger'} />
          </View>
          <View style={[styles.page, tab !== 'stats' && styles.pageHidden]}>
            <StatsScreen active={tab === 'stats'} />
          </View>
          <View style={[styles.page, tab !== 'manage' && styles.pageHidden]}>
            <ManageScreen active={tab === 'manage'} />
          </View>
        </View>
        <TabBar current={tab} onChange={setTab} />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  screen: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
  pageHidden: {
    display: 'none',
  },
});
