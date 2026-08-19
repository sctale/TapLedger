import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BackHandler, DeviceEventEmitter, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  COLORS, FONT_SIZE, LEDGER_EVENTS, RADIUS, SETTING_KEYS, SPACING,
} from '../constants';
import {
  getCustomCategories, getRecurringRules,
  getSetting, getTotalCount,
} from '../database/ledgerDB';
import { useToast } from '../hooks/useToast';
import Toast from '../components/Toast';
import { getSyncConfig } from '../sync/apiClient';
import RecurringScreen from './manage/RecurringScreen';
import CategoriesScreen from './manage/CategoriesScreen';
import SyncScreen from './manage/SyncScreen';
import DataManageScreen from './manage/DataManageScreen';
import PrefsScreen from './manage/PrefsScreen';

// 版本号单一来源：app.json expo.version
const APP_VERSION = Constants.expoConfig?.version ?? '';

// 二级页面路由：main 为主页，其余为子页面（v0.5.9 入口列表+二级页重构）
type Page = 'main' | 'recurring' | 'categories' | 'sync' | 'backup' | 'prefs';

// 子页面顶栏标题映射
const PAGE_TITLES: Record<Exclude<Page, 'main'>, string> = {
  recurring: '周期记账',
  categories: '自定义分类',
  sync: '家庭同步',
  backup: '数据管理',
  prefs: '偏好设置',
};

interface Props {
  active: boolean;   // 当前 Tab 激活（App 常驻挂载，激活时滚回顶部）
}

export default function ManageScreen({ active }: Props) {
  // ===== 路由状态 =====
  const [page, setPage] = useState<Page>('main');

  // ===== 主页数据：各板块摘要 =====
  const [ruleCount, setRuleCount] = useState(0);          // 周期记账规则数
  const [catCount, setCatCount] = useState(0);             // 自定义分类数
  const [totalCount, setTotalCount] = useState(0);         // 本地记录总数
  const [budgetStr, setBudgetStr] = useState('');          // 月度预算（原始字符串）
  const [syncSummary, setSyncSummary] = useState('');      // 家庭同步状态摘要

  const { toast, showToast, hideToast } = useToast();

  // 主页摘要加载：各板块计数 + 同步状态（一次并行读齐）
  const loadSummary = useCallback(async () => {
    try {
      const [rules, cats, count, budget, cfg, name, family, serverUrl] = await Promise.all([
        getRecurringRules(),
        getCustomCategories(),
        getTotalCount(),
        getSetting(SETTING_KEYS.MONTHLY_BUDGET),
        getSyncConfig(),                                  // serverUrl + token 均存在 → 已连接且已登录
        getSetting(SETTING_KEYS.SYNC_USER_DISPLAY),       // 登录昵称（摘要显示用）
        getSetting('sync.family_name'),                   // 家庭名（摘要显示用）
        getSetting(SETTING_KEYS.SYNC_SERVER_URL),         // 区分「已连接未登录」与「未配置」
      ]);
      setRuleCount(rules.length);
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

  // 功能入口列表（iOS 设置风格：图标 + 标题 + 状态摘要副标题）
  const entries: { icon: string; title: string; subtitle: string; target: Exclude<Page, 'main'> }[] = [
    { icon: '🔁', title: '周期记账', subtitle: `${ruleCount} 条规则`, target: 'recurring' },
    { icon: '🏷️', title: '分类管理', subtitle: `${catCount} 个`, target: 'categories' },
    { icon: '👨‍👩‍👧', title: '家庭同步', subtitle: syncSummary, target: 'sync' },
    { icon: '⚙️', title: '偏好设置', subtitle: budgetStr ? `月度预算 ¥${budgetStr}` : '未设置', target: 'prefs' },
    { icon: '💾', title: '数据管理', subtitle: '导出/导入/重置', target: 'backup' },
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
          ) : page === 'categories' ? (
            <CategoriesScreen />
          ) : page === 'sync' ? (
            <SyncScreen />
          ) : page === 'backup' ? (
            <DataManageScreen />
          ) : (
            <PrefsScreen />
          )}
        </View>
      )}

      <Toast toast={toast} onHide={hideToast} />
    </SafeAreaView>
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
  // ===== 通用行样式（功能入口列表共用） =====
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
});
