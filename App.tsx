import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { COLORS } from './src/constants';
import { initDatabase, setCustomCategoriesCache } from './src/database/ledgerDB';
import { runRecurringCheck } from './src/utils/recurring';
import TabBar, { type TabKey } from './src/components/TabBar';
import HomeScreen from './src/screens/HomeScreen';
import LedgerScreen from './src/screens/LedgerScreen';
import StatsScreen from './src/screens/StatsScreen';
import ManageScreen from './src/screens/ManageScreen';

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [tab, setTab] = useState<TabKey>('home');

  useEffect(() => {
    (async () => {
      try {
        await initDatabase();
        await setCustomCategoriesCache();
      } catch {
        // 初始化失败也放行，页面会自行兜底
      }
      // 周期记账：检查并生成到期记录
      try {
        await runRecurringCheck();
      } catch {
        // 静默
      }
      setDbReady(true);
    })();
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
          {/* 保持所有页面挂载，仅切换显隐，避免每次切 tab 重查库/丢滚动位置 */}
          <View style={[styles.page, tab !== 'home' && styles.pageHidden]}>
            <HomeScreen />
          </View>
          <View style={[styles.page, tab !== 'ledger' && styles.pageHidden]}>
            <LedgerScreen />
          </View>
          <View style={[styles.page, tab !== 'stats' && styles.pageHidden]}>
            <StatsScreen />
          </View>
          <View style={[styles.page, tab !== 'manage' && styles.pageHidden]}>
            <ManageScreen />
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
