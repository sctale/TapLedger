import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, DeviceEventEmitter, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  COLORS, FONT_SIZE, LEDGER_EVENTS, RADIUS, SPACING, findCategory, SETTING_KEYS,
} from '../constants';
import {
  getCategorySummary, getRangeSummary, getDaySummaries, getAccounts, getSetting, getMemberExpenseSummary,
  getReimbursableSummary,
} from '../database/ledgerDB';
import { formatMoney, getLastNDates, getMonthRange, getMonthName, getToday } from '../utils/dateUtils';
import { useToast } from '../hooks/useToast';
import { getCachedMembers, memberColor, type MemberInfo } from '../sync/memberUtils';
import CategoryPieChart from '../components/CategoryPieChart';
import TrendBarChart from '../components/TrendBarChart';
import Toast from '../components/Toast';
import ReimburseScreen from './manage/ReimburseScreen';

type RangeKey = 'week' | 'month' | 'year';
type Page = 'main' | 'reimburse';

interface Props {
  active: boolean;   // 当前 Tab 激活（App 常驻挂载，激活时滚回顶部）
}

export default function StatsScreen({ active }: Props) {
  const [page, setPage] = useState<Page>('main');
  const [range, setRange] = useState<RangeKey>('month');
  const [expense, setExpense] = useState(0);
  const [income, setIncome] = useState(0);
  const [categoryData, setCategoryData] = useState<{ category: string; total: number }[]>([]);
  const [trendValues, setTrendValues] = useState<number[]>([]);
  const [trendLabels, setTrendLabels] = useState<string[]>([]);
  const [totalAssets, setTotalAssets] = useState(0);
  const [budget, setBudget] = useState(0);
  const [tick, setTick] = useState(0);
  const [members, setMembers] = useState<MemberInfo[]>([]);   // 家庭成员缓存（v0.5）
  const [memberFilter, setMemberFilter] = useState(0);        // 0=全部成员
  const [memberStats, setMemberStats] = useState<{ userId: number; total: number }[]>([]);
  const [reimburseSummary, setReimburseSummary] = useState({ total: 0, count: 0 });

  const { toast, showToast, hideToast } = useToast();

  const scrollRef = useRef<ScrollView>(null);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // 报销摘要加载（统计页入口展示用）
  const loadReimburseSummary = useCallback(async () => {
    try {
      setReimburseSummary(await getReimbursableSummary());
    } catch {
      showToast('报销摘要加载失败', 'error');
    }
  }, [showToast]);

  // Tab 激活时滚回顶部 + 重载数据 + 回主页（切 Tab 再回来回到 main，v0.5.9）
  useEffect(() => {
    if (!active) return;
    setPage('main');
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    refresh();
    loadReimburseSummary();
  }, [active, refresh, loadReimburseSummary]);

  // 挂载时预载报销摘要
  useEffect(() => { loadReimburseSummary(); }, [loadReimburseSummary]);

  // 成员缓存加载（登录态/同步完成事件触发）
  const loadMembers = useCallback(async () => {
    setMembers(await getCachedMembers());
  }, []);
  useEffect(() => { loadMembers(); }, [loadMembers]);

  // 当前范围
  const { rangeLabel, start, end, trendDates } = useMemo(() => {
    if (range === 'week') {
      const dates = getLastNDates(7);
      return { rangeLabel: '近 7 天', start: dates[0], end: getToday(), trendDates: dates };
    }
    if (range === 'month') {
      const mr = getMonthRange(new Date());
      const dates = getLastNDates(30);
      return { rangeLabel: '本月', start: mr.start, end: mr.end, trendDates: dates };
    }
    // 近 12 个月
    const now = new Date();
    const yearStart = `${now.getFullYear()}-01-01`;
    const today = getToday();
    const dates: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    }
    return { rangeLabel: '近 12 个月', start: yearStart, end: today, trendDates: dates };
  }, [range]);

  // 加载数据（memberFilter > 0 时按记账人筛选，v0.5）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [summary, cats, days, accounts, budgetStr, mStats] = await Promise.all([
          getRangeSummary(start, end, memberFilter),
          getCategorySummary(start, end, 'expense', memberFilter),
          getDaySummaries(start, end, memberFilter),
          getAccounts(),
          getSetting(SETTING_KEYS.MONTHLY_BUDGET),
          getMemberExpenseSummary(start, end),
        ]);
        if (cancelled) return;
        setExpense(summary.expense);
        setIncome(summary.income);
        setCategoryData(cats);
        setTotalAssets(accounts.reduce((s, a) => s + a.balance, 0));
        setBudget(parseFloat(budgetStr ?? '0') || 0);
        setMemberStats(mStats);
        // 趋势
        if (range === 'year') {
          // 按月聚合
          const monthMap = new Map<string, number>();
          for (const d of days) {
            monthMap.set(d.date.slice(0, 7), (monthMap.get(d.date.slice(0, 7)) ?? 0) + d.expense);
          }
          setTrendValues(trendDates.map((d) => monthMap.get(d.slice(0, 7)) ?? 0));
          setTrendLabels(trendDates.map((d) => `${Number(d.slice(5, 7))}月`));
        } else {
          const values = trendDates.map((d) => days.find((x) => x.date === d)?.expense ?? 0);
          setTrendValues(values);
          setTrendLabels(
            trendDates.map((d) => {
              const dt = new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
              return range === 'week'
                ? ['日', '一', '二', '三', '四', '五', '六'][dt.getDay()] ?? ''
                : `${dt.getMonth() + 1}/${dt.getDate()}`;
            })
          );
        }
      } catch {
        showToast('统计数据加载失败', 'error');
      }
    })();
    return () => { cancelled = true; };
  }, [start, end, range, trendDates, tick, memberFilter, showToast]);

  // 全局刷新（含登录态/同步事件 → 更新成员缓存，v0.5）
  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.RECORDED, refresh),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.DATA_IMPORTED, refresh),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.ACCOUNTS_CHANGED, refresh),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.AUTH_CHANGED, loadMembers),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SYNC_DONE, () => {
        loadMembers();
        refresh();
      }),
      // 设置变更（月度预算）→ 即时刷新预算卡（v0.5.5）
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SETTINGS_CHANGED, refresh),
      // 记账/导入/同步完成可能改变报销状态，独立刷新摘要
      DeviceEventEmitter.addListener(LEDGER_EVENTS.RECORDED, loadReimburseSummary),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.DATA_IMPORTED, loadReimburseSummary),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SYNC_DONE, loadReimburseSummary),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [refresh, loadMembers, loadReimburseSummary]);

  // Android 系统返回键：在报销子页时返回主页（主页时不消费，走默认）
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page !== 'main') {
        setPage('main');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [page]);

  const balance = income - expense;
  const budgetPercent = budget > 0 ? Math.min(expense / budget, 1) : 0;
  const budgetOver = budget > 0 && expense > budget;

  // 分类排行 Top5
  const topCategories = useMemo(() => {
    return categoryData.slice(0, 5).map((c) => ({
      ...c,
      def: findCategory(c.category, 'expense'),
    }));
  }, [categoryData]);

  // 排行条相对最大值归一化（第 1 名满格，其余按比例，避免占比>33% 全部顶满的误导）
  const maxCategoryTotal = topCategories.length > 0 ? topCategories[0].total : 0;
  const trendEmpty = trendValues.length > 0 && trendValues.every((v) => v <= 0);

  // 成员支出排行（多成员且未筛选时显示，v0.5）
  const multiMember = members.length > 1;
  const memberRows = useMemo(() => {
    if (!multiMember) return [];
    const allExpense = memberStats.reduce((s, m) => s + m.total, 0);
    const maxTotal = memberStats.length > 0 ? Math.max(...memberStats.map((m) => m.total)) : 0;
    return memberStats
      .filter((m) => m.total > 0)
      .map((m) => {
        const info = members.find((x) => x.id === m.userId);
        return {
          userId: m.userId,
          name: info?.displayName ?? (m.userId === 0 ? '未标记' : `成员${m.userId}`),
          emoji: info?.avatarEmoji ?? '👤',
          total: m.total,
          pct: allExpense > 0 ? (m.total / allExpense) * 100 : 0,
          barPct: maxTotal > 0 ? (m.total / maxTotal) * 100 : 0,
        };
      });
  }, [multiMember, memberStats, members]);

  const reimburseStatusText = reimburseSummary.count > 0
    ? `¥${formatMoney(reimburseSummary.total)} · ${reimburseSummary.count} 笔待核销`
    : '暂无待核销';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      {page === 'main' ? (
        <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.titleRow}>
            <Text style={styles.pageTitle}>统计</Text>
            <View style={styles.rangeSwitch}>
              {([['week', '近7天'], ['month', '本月'], ['year', '年度']] as [RangeKey, string][]).map(([r, label]) => (
                <Pressable
                  key={r}
                  style={[styles.rangeBtn, range === r && styles.rangeBtnActive]}
                  onPress={() => setRange(r)}
                  accessibilityRole="tab"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: range === r }}
                >
                  <Text style={[styles.rangeText, range === r && styles.rangeTextActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 成员筛选（多成员账本显示，v0.5） */}
          {multiMember ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.memberScroll}
              contentContainerStyle={styles.memberChips}
            >
              <Pressable
                style={[styles.memberChip, memberFilter === 0 && styles.memberChipActive]}
                onPress={() => setMemberFilter(0)}
                accessibilityRole="tab"
                accessibilityLabel="全部成员"
                accessibilityState={{ selected: memberFilter === 0 }}
              >
                <Text style={[styles.memberChipText, memberFilter === 0 && styles.memberChipTextActive]}>
                  👨‍👩‍👧 全部
                </Text>
              </Pressable>
              {members.map((m) => (
                <Pressable
                  key={m.id}
                  style={[styles.memberChip, memberFilter === m.id && styles.memberChipActive]}
                  onPress={() => setMemberFilter(m.id)}
                  accessibilityRole="tab"
                  accessibilityLabel={`只看${m.displayName}`}
                  accessibilityState={{ selected: memberFilter === m.id }}
                >
                  <Text style={[styles.memberChipText, memberFilter === m.id && styles.memberChipTextActive]}>
                    {m.avatarEmoji} {m.displayName}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {/* 总览卡片（金额自适应字号，大金额不换行溢出） */}
          <View style={styles.overview}>
            <View style={styles.overviewItem}>
              <Text style={styles.overviewLabel}>总资产</Text>
              <Text
                style={[styles.overviewValue, { color: COLORS.accentDark }]}
                adjustsFontSizeToFit
                numberOfLines={1}
              >
                ¥{formatMoney(totalAssets)}
              </Text>
            </View>
            <View style={styles.overviewDivider} />
            <View style={styles.overviewItem}>
              <Text style={styles.overviewLabel}>支出</Text>
              <Text
                style={[styles.overviewValue, { color: COLORS.expense }]}
                adjustsFontSizeToFit
                numberOfLines={1}
              >
                ¥{formatMoney(expense)}
              </Text>
            </View>
            <View style={styles.overviewDivider} />
            <View style={styles.overviewItem}>
              <Text style={styles.overviewLabel}>收入</Text>
              <Text
                style={[styles.overviewValue, { color: COLORS.income }]}
                adjustsFontSizeToFit
                numberOfLines={1}
              >
                ¥{formatMoney(income)}
              </Text>
            </View>
            <View style={styles.overviewDivider} />
            <View style={styles.overviewItem}>
              <Text style={styles.overviewLabel}>结余</Text>
              <Text
                style={[styles.overviewValue, { color: balance >= 0 ? COLORS.text : COLORS.danger }]}
                adjustsFontSizeToFit
                numberOfLines={1}
              >
                ¥{formatMoney(balance)}
              </Text>
            </View>
          </View>

          {/* 预算对比（预算为月维度，仅本月视图显示，避免与周/年范围数据错误对比） */}
          {budget > 0 && range === 'month' ? (
            <View style={styles.card}>
              <View style={styles.budgetHead}>
                <Text style={styles.cardTitle}>预算对比 · 本月</Text>
                <Text style={[styles.budgetPct, budgetOver && { color: COLORS.danger }]}>
                  {budgetOver ? '已超支' : `${Math.round(budgetPercent * 100)}%`}
                </Text>
              </View>
              <View style={styles.budgetTrack}>
                <View
                  style={[
                    styles.budgetFill,
                    { width: `${Math.round(budgetPercent * 100)}%`, backgroundColor: budgetOver ? COLORS.danger : COLORS.accent },
                  ]}
                />
              </View>
              <Text style={styles.budgetHint}>
                已用 ¥{formatMoney(expense)} / 预算 ¥{formatMoney(budget)} · 剩余 ¥{formatMoney(Math.max(budget - expense, 0))}
              </Text>
            </View>
          ) : null}

          {/* 报销入口（紧跟预算对比之后，v0.5.9） */}
          <Pressable
            style={styles.card}
            onPress={() => setPage('reimburse')}
            accessibilityRole="button"
            accessibilityLabel={`待报销，${reimburseStatusText}`}
          >
            <View style={styles.reimburseRow}>
              <View style={[styles.reimburseIcon, { backgroundColor: `${COLORS.warningText ?? COLORS.accent}15` }]}>
                <Text style={styles.reimburseEmoji}>🧾</Text>
              </View>
              <View style={styles.reimburseInfo}>
                <Text style={styles.reimburseTitle}>待报销</Text>
                <Text style={styles.reimburseStatus} numberOfLines={1}>{reimburseStatusText}</Text>
              </View>
              <Text style={styles.reimburseArrow}>›</Text>
            </View>
          </Pressable>

          {/* 支出占比 */}
          <Text style={styles.sectionTitle}>支出占比 · {rangeLabel}</Text>
          <View style={styles.card}>
            {categoryData.length > 0 ? (
              <CategoryPieChart data={categoryData} type="expense" />
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>这个时间段还没有支出记录</Text>
              </View>
            )}
          </View>

          {/* 分类排行 */}
          {topCategories.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>支出分类排行</Text>
              <View style={styles.card}>
                {topCategories.map((c, i) => {
                  const pct = expense > 0 ? (c.total / expense) * 100 : 0;
                  const barPct = maxCategoryTotal > 0 ? (c.total / maxCategoryTotal) * 100 : 0;
                  return (
                    <View key={c.category} style={styles.rankRow}>
                      <Text style={styles.rankIndex}>{i + 1}</Text>
                      <View style={[styles.rankIcon, { backgroundColor: `${c.def.color}22` }]}>
                        <Text style={styles.rankEmoji}>{c.def.emoji}</Text>
                      </View>
                      <View style={styles.rankInfo}>
                        <View style={styles.rankHead}>
                          <Text style={styles.rankLabel}>{c.def.label}</Text>
                          <Text style={styles.rankAmount}>¥{formatMoney(c.total)} · {pct.toFixed(1)}%</Text>
                        </View>
                        <View style={styles.rankTrack}>
                          <View style={[styles.rankFill, { width: `${Math.round(barPct)}%`, backgroundColor: c.def.color }]} />
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          ) : null}

          {/* 成员支出排行（多成员且未筛选时显示，v0.5） */}
          {multiMember && memberFilter === 0 && memberRows.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>成员支出排行 · {rangeLabel}</Text>
              <View style={styles.card}>
                {memberRows.map((m) => (
                  <Pressable
                    key={m.userId}
                    style={styles.memberRow}
                    onPress={() => setMemberFilter(m.userId)}
                    accessibilityRole="button"
                    accessibilityLabel={`查看${m.name}的支出，共${formatMoney(m.total)}元`}
                  >
                    <View style={[styles.memberAvatar, { backgroundColor: `${memberColor(m.userId)}22` }]}>
                      <Text style={styles.memberAvatarEmoji}>{m.emoji}</Text>
                    </View>
                    <View style={styles.memberInfo}>
                      <View style={styles.memberHead}>
                        <Text style={[styles.memberName, { color: memberColor(m.userId) }]}>{m.name}</Text>
                        <Text style={styles.memberAmount}>¥{formatMoney(m.total)} · {m.pct.toFixed(1)}%</Text>
                      </View>
                      <View style={styles.memberTrack}>
                        <View
                          style={[styles.memberFill, { width: `${Math.round(m.barPct)}%`, backgroundColor: memberColor(m.userId) }]}
                        />
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {/* 支出趋势 */}
          <Text style={styles.sectionTitle}>
            支出趋势 · {range === 'week' ? '近 7 天' : range === 'month' ? `近 30 天 · ${getMonthName(new Date())}` : '近 12 个月'}
          </Text>
          <View style={styles.card}>
            {trendEmpty ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>这个时间段还没有支出记录</Text>
              </View>
            ) : (
              <TrendBarChart
                values={trendValues}
                labels={trendLabels}
                color={COLORS.expense}
              />
            )}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.subPage}>
          <View style={styles.navBar}>
            <Pressable hitSlop={8} onPress={() => setPage('main')}>
              <Text style={styles.navBack}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.navTitle}>报销管理</Text>
          </View>
          <ReimburseScreen />
        </View>
      )}
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
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  pageTitle: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '800',
    color: COLORS.text,
  },
  rangeSwitch: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.pill,
    padding: 3,
  },
  rangeBtn: {
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
  },
  rangeBtnActive: {
    backgroundColor: COLORS.surface,
  },
  rangeText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  rangeTextActive: {
    color: COLORS.accentDark,
    fontWeight: '700',
  },
  overview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xs,
    marginBottom: SPACING.md,
  },
  overviewItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  overviewLabel: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    marginBottom: 3,
  },
  overviewValue: {
    fontSize: FONT_SIZE.md,
    fontWeight: '800',
  },
  overviewDivider: {
    width: 1,
    height: 28,
    backgroundColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: SPACING.sm,
    marginTop: SPACING.xs,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  cardTitle: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: COLORS.text,
  },
  budgetHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  budgetPct: {
    fontSize: FONT_SIZE.md,
    color: COLORS.accentDark,
    fontWeight: '800',
  },
  budgetTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.bgAlt,
    overflow: 'hidden',
  },
  budgetFill: {
    height: '100%',
    borderRadius: 4,
  },
  budgetHint: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    marginTop: SPACING.sm,
  },
  empty: {
    paddingVertical: SPACING.xl,
    alignItems: 'center',
  },
  emptyText: {
    color: COLORS.textTertiary,
    fontSize: FONT_SIZE.sm,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs + 2,
  },
  rankIndex: {
    width: 16,
    fontSize: FONT_SIZE.sm,
    color: COLORS.textTertiary,
    fontWeight: '700',
  },
  rankIcon: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankEmoji: {
    fontSize: FONT_SIZE.lg - 2,
  },
  rankInfo: {
    flex: 1,
    gap: 4,
  },
  rankHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rankLabel: {
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    fontWeight: '600',
  },
  rankAmount: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  rankTrack: {
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.bgAlt,
    overflow: 'hidden',
  },
  rankFill: {
    height: '100%',
    borderRadius: 2.5,
  },
  // ===== 成员筛选 chips（v0.5） =====
  memberScroll: {
    flexGrow: 0,
    marginBottom: SPACING.sm,
  },
  memberChips: {
    gap: SPACING.sm,
    paddingVertical: 2,
  },
  memberChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  memberChipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  memberChipText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  memberChipTextActive: {
    color: COLORS.white,
    fontWeight: '700',
  },
  // ===== 成员支出排行（v0.5） =====
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs + 2,
  },
  memberAvatar: {
    width: 32,
    height: 32,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarEmoji: {
    fontSize: FONT_SIZE.lg - 2,
  },
  memberInfo: {
    flex: 1,
    gap: 4,
  },
  memberHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  memberName: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
  memberAmount: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  memberTrack: {
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.bgAlt,
    overflow: 'hidden',
  },
  memberFill: {
    height: '100%',
    borderRadius: 2.5,
  },
  // ===== 报销入口卡片（v0.5.9） =====
  reimburseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  reimburseIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reimburseEmoji: {
    fontSize: FONT_SIZE.lg - 1,
  },
  reimburseInfo: {
    flex: 1,
  },
  reimburseTitle: {
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    fontWeight: '600',
  },
  reimburseStatus: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  reimburseArrow: {
    fontSize: FONT_SIZE.xl + 4,
    color: COLORS.textTertiary,
    fontWeight: '600',
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
