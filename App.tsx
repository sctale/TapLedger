import React, { useEffect, useRef, useState } from 'react';
import { AppState, DeviceEventEmitter, View, StyleSheet, ActivityIndicator } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COLORS, LEDGER_EVENTS, setCategoryConfig } from './src/constants';
import { initDatabase, setCustomCategoriesCache, getCategoryConfig } from './src/database/ledgerDB';
import { runRecurringCheck } from './src/utils/recurring';
import { runSync, purgeOldTombstones } from './src/sync/syncEngine';
import TabBar, { type TabKey } from './src/components/TabBar';
import HomeScreen from './src/screens/HomeScreen';
import LedgerScreen from './src/screens/LedgerScreen';
import StatsScreen from './src/screens/StatsScreen';
import ManageScreen from './src/screens/ManageScreen';

// 已登录时：数据变更后 debounce 自动同步（毫秒）
const AUTO_SYNC_DEBOUNCE = 5000;

// 静默后台同步（未配置/断网时内部自检跳过；完成或失败都不打扰 UI）
async function syncInBackground(): Promise<void> {
  try {
    await runSync();
  } catch {
    // 静默（断网等场景），下次事件/回前台/网络恢复再试
  }
}

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
      // 本地优先：先渲染 UI 再后台同步（runSync 内部自检配置，
      // 未配置同步则跳过；完成后广播 SYNC_DONE，各页面自行刷新）
      setDbReady(true);
      (async () => {
        try {
          await purgeOldTombstones();
        } catch {
          // 静默
        }
        syncInBackground();
      })();
    })();
  }, []);

  // 本地优先的补网策略：回前台 / 网络恢复时自动补一轮同步（已配置才生效）
  useEffect(() => {
    // 回前台（后台期间断网记的账，回来看一眼就能补上）
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncInBackground();
    });
    // 网络恢复（前台等待断网恢复的场景，如地铁出站）
    const netSub = NetInfo.addEventListener((state) => {
      if (state.isConnected) syncInBackground();
    });
    return () => {
      appStateSub.remove();
      netSub();
    };
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
