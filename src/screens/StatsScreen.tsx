import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, DeviceEventEmitter, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT_SIZE, LEDGER_EVENTS, RADIUS, SPACING, findCategory, SETTING_KEYS } from '../constants';
import {
  getCategorySummary,
  getRangeSummary,
  getRecordsByCategory,
  getDaySummaries,
  getSetting,
  getMemberExpenseSummary,
  getReimbursableSummary,
} from '../database/ledgerDB';
import { formatMoney, getLastNDates, getMonthRange, getToday } from '../utils/dateUtils';
import { useToast } from '../hooks/useToast';
import { getCachedMembers, memberColor, type MemberInfo } from '../sync/memberUtils';
import CategoryPieChart from '../components/CategoryPieChart';
import TrendBarChart from '../components/TrendBarChart';
import RecordList from '../components/RecordList';
import EditRecordModal from '../components/EditRecordModal';
import ReimburseScreen from './manage/ReimburseScreen';
import type { LedgerRecord } from '../types';

type RangeKey = 'week' | 'month' | 'year';
type Page = 'main' | 'reimburse' | 'category';

interface Props {
  active: boolean; // 当前 Tab 激活（App 常驻挂载，激活时滚回顶部）
}

export default function StatsScreen({ active }: Props) {
  const [page, setPage] = useState<Page>('main');
  const [range, setRange] = useState<RangeKey>('month');
  const [expense, setExpense] = useState(0);
  const [income, setIncome] = useState(0);
  const [categoryData, setCategoryData] = useState<{ category: string; total: number }[]>([]);
  const [trendValues, setTrendValues] = useState<number[]>([]);
  const [trendLabels, setTrendLabels] = useState<string[]>([]);
  const [budget, setBudget] = useState(0);
  const [tick, setTick] = useState(0);
  const [members, setMembers] = useState<MemberInfo[]>([]); // 家庭成员缓存（v0.5）
  const [memberFilter, setMemberFilter] = useState(0); // 0=全部成员
  const [memberStats, setMemberStats] = useState<{ userId: number; total: number; count: number }[]>([]);
  const [reimburseSummary, setReimburseSummary] = useState({ total: 0, count: 0 });

  // 分类下钻（点「支出分类排行」某一行 → 看这个分类到底是些什么内容）
  const [drill, setDrill] = useState<{ key: string; label: string } | null>(null);
  const [drillRecords, setDrillRecords] = useState<LedgerRecord[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  // 明细里点某一条 → 就地编辑（复用明细页同一个 EditRecordModal 组件，不另造编辑器：
  // v0.11.4/0.11.5 两轮才把触摸与键盘避让修对，组件要求宿主用「并列页 + display 互斥」承载）
  const [drillEdit, setDrillEdit] = useState<LedgerRecord | null>(null);

  const { showToast } = useToast();

  const scrollRef = useRef<ScrollView>(null);

  // 报销摘要加载（统计页入口展示用）
  const loadReimburseSummary = useCallback(async () => {
    try {
      setReimburseSummary(await getReimbursableSummary());
    } catch {
      showToast('报销摘要加载失败', 'error');
    }
  }, [showToast]);

  // 数据变更事件同时影响主图和报销摘要，合成一个回调（此前两组监听器分别注册，
  // RECORDED/DATA_IMPORTED/SYNC_DONE 每个事件都跑两遍）
  const refreshAll = useCallback(() => {
    setTick((t) => t + 1);
    loadReimburseSummary();
  }, [loadReimburseSummary]);

  // Tab 激活时滚回顶部 + 重载数据 + 回主页（切 Tab 再回来回到 main，v0.5.6）
  // 激活重载已经覆盖摘要，不再单独挂一个「挂载预载」effect（此前两者重复跑一次查询）
  useEffect(() => {
    if (!active) {
      // 切走时收起编辑页（与明细页同处理），回到统计页不该还停在半开编辑态
      setDrillEdit(null);
      return;
    }
    setPage('main');
    setDrillEdit(null); // 切走再回来不该还停在半开的编辑页（与明细页一致）
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    refreshAll();
  }, [active, refreshAll]);

  // 成员缓存加载（登录态/同步完成事件触发）
  const loadMembers = useCallback(async () => {
    setMembers(await getCachedMembers());
  }, []);
  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  // 当前范围
  const { rangeLabel, start, end, trendDates } = useMemo(() => {
    if (range === 'week') {
      const dates = getLastNDates(7);
      return { rangeLabel: '近 7 天', start: dates[0], end: getToday(), trendDates: dates };
    }
    if (range === 'month') {
      const mr = getMonthRange(new Date());
      // 本月 1 日 → 今天（与标题「本月」一致，替代旧的近 30 天滚动窗口）
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dates: string[] = [];
      for (let day = 1; day <= now.getDate(); day++) {
        dates.push(`${now.getFullYear()}-${mm}-${String(day).padStart(2, '0')}`);
      }
      return { rangeLabel: '本月', start: mr.start, end: mr.end, trendDates: dates };
    }
    // 近 12 个月（v0.11 修复：start 取回溯窗口的首月月初，跨年时去年月份不再恒为 0）
    const now = new Date();
    const today = getToday();
    const dates: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
    }
    return { rangeLabel: '近 12 个月', start: dates[0], end: today, trendDates: dates };
    // tick 进依赖：4 个 tab 常驻挂载，跨零点后切回本页要重算窗口，
    // 否则「本月/近 7 天」还停在昨天（数据会按旧 end 查）。
    // 表达式里没直接引用 tick（它只通过 new Date() 生效），所以要显式关掉这条规则
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, tick]);

  // 加载数据（memberFilter > 0 时按记账人筛选，v0.5）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [summary, cats, days, budgetStr, mStats] = await Promise.all([
          getRangeSummary(start, end, memberFilter),
          getCategorySummary(start, end, 'expense', memberFilter),
          getDaySummaries(start, end, memberFilter),
          getSetting(SETTING_KEYS.MONTHLY_BUDGET),
          getMemberExpenseSummary(start, end),
        ]);
        if (cancelled) return;
        setExpense(summary.expense);
        setIncome(summary.income);
        setCategoryData(cats);
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
                ? (['日', '一', '二', '三', '四', '五', '六'][dt.getDay()] ?? '')
                : `${dt.getDate()}`; // 本月视图只显示「日」，图内自动抽样不拥挤
            }),
          );
        }
      } catch {
        showToast('统计数据加载失败', 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [start, end, range, trendDates, tick, memberFilter, showToast]);

  // 分类下钻明细：时间区间 / 成员筛选 / 数据变更都要跟着重查，
  // 离开子页或连续点不同分类时丢弃过期结果（与本页主查询同样的 cancelled 模式）
  useEffect(() => {
    if (page !== 'category' || !drill) return;
    let cancelled = false;
    setDrillLoading(true);
    (async () => {
      try {
        const rows = await getRecordsByCategory(start, end, drill.key, memberFilter);
        if (!cancelled) setDrillRecords(rows);
      } catch {
        if (!cancelled) {
          setDrillRecords([]);
          showToast('分类明细加载失败', 'error');
        }
      } finally {
        if (!cancelled) setDrillLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, drill, start, end, memberFilter, tick, showToast]);

  const openCategory = useCallback((c: { category: string; label: string }) => {
    setDrill({ key: c.category, label: c.label });
    setDrillEdit(null);
    setPage('category');
  }, []);

  const backToMain = useCallback(() => {
    setPage('main');
    setDrill(null);
    setDrillEdit(null);
  }, []);

  // 全局刷新（含登录态/同步事件 → 更新成员缓存，v0.5）
  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.RECORDED, refreshAll),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.DATA_IMPORTED, refreshAll),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.AUTH_CHANGED, loadMembers),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SYNC_DONE, () => {
        loadMembers();
        refreshAll();
      }),
      // 设置变更（月度预算）→ 即时刷新预算卡（v0.5.5）
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SETTINGS_CHANGED, refreshAll),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [refreshAll, loadMembers]);

  // Android 系统返回键：在报销 / 分类明细子页时返回主页（主页时不消费，走默认）
  // v0.11 修复：仅激活 tab 注册，避免与管理页同时消费返回键（两页常驻挂载）
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (page !== 'main') {
        backToMain();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [page, active, backToMain]);

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

  // 分类下钻：合计直接由明细累加，与 getCategorySummary 同口径，所以必然等于排行条上的数字
  const drillTotal = useMemo(() => drillRecords.reduce((s, r) => s + r.amount, 0), [drillRecords]);
  const drillScopeText = useMemo(() => {
    const who =
      memberFilter > 0
        ? (members.find((m) => m.id === memberFilter)?.displayName ?? `成员${memberFilter}`)
        : '';
    return [rangeLabel, who].filter(Boolean).join(' · ');
  }, [rangeLabel, memberFilter, members]);
  // 空数组也要走占位：此前 length > 0 的条件让「一条记录都还没有」时画出一张空白图
  const trendEmpty = trendValues.length === 0 || trendValues.every((v) => v <= 0);

  // 成员支出排行（多成员且未筛选时显示，v0.5；v0.10 增加笔数）
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
          count: m.count,
          pct: allExpense > 0 ? (m.total / allExpense) * 100 : 0,
          barPct: maxTotal > 0 ? (m.total / maxTotal) * 100 : 0,
        };
      });
  }, [multiMember, memberStats, members]);

  const reimburseStatusText =
    reimburseSummary.count > 0
      ? `¥${formatMoney(reimburseSummary.total)} · ${reimburseSummary.count} 笔待核销`
      : '暂无待核销';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      {page === 'main' ? (
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.titleRow}>
            <Text style={styles.pageTitle}>统计</Text>
            <View style={styles.rangeSwitch}>
              {(
                [
                  ['week', '近7天'],
                  ['month', '本月'],
                  ['year', '年度'],
                ] as [RangeKey, string][]
              ).map(([r, label]) => (
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
                <Text
                  style={[styles.memberChipText, memberFilter === 0 && styles.memberChipTextActive]}
                  numberOfLines={1}
                >
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
                  <Text
                    style={[styles.memberChipText, memberFilter === m.id && styles.memberChipTextActive]}
                    numberOfLines={1}
                  >
                    {m.avatarEmoji} {m.displayName}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {/* 总览卡片（金额自适应字号，大金额不换行溢出） */}
          <View style={styles.overview}>
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
                    {
                      width: `${Math.round(budgetPercent * 100)}%`,
                      backgroundColor: budgetOver ? COLORS.danger : COLORS.accent,
                    },
                  ]}
                />
              </View>
              <Text style={styles.budgetHint}>
                已用 ¥{formatMoney(expense)} / 预算 ¥{formatMoney(budget)} · 剩余 ¥
                {formatMoney(Math.max(budget - expense, 0))}
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
              <View style={[styles.reimburseIcon, { backgroundColor: `${COLORS.warningText}15` }]}>
                <Text style={styles.reimburseEmoji}>🧾</Text>
              </View>
              <View style={styles.reimburseInfo}>
                <Text style={styles.reimburseTitle}>待报销</Text>
                <Text style={styles.reimburseStatus} numberOfLines={1}>
                  {reimburseStatusText}
                </Text>
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

          {/* 分类排行（点任意一行 → 该分类在这个时间段的具体明细） */}
          {topCategories.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>支出分类排行 · 点击查看明细</Text>
              <View style={styles.card}>
                {topCategories.map((c, i) => {
                  const pct = expense > 0 ? (c.total / expense) * 100 : 0;
                  const barPct = maxCategoryTotal > 0 ? (c.total / maxCategoryTotal) * 100 : 0;
                  return (
                    <Pressable
                      key={c.category}
                      style={({ pressed }) => [styles.rankRow, pressed && styles.rankRowPressed]}
                      android_ripple={{ color: `${COLORS.accent}22` }}
                      onPress={() => openCategory({ category: c.category, label: c.def.label })}
                      accessibilityRole="button"
                      accessibilityLabel={`查看${c.def.label}明细，${formatMoney(c.total)}元，${pct.toFixed(0)}%`}
                    >
                      <Text style={styles.rankIndex}>{i + 1}</Text>
                      <View style={[styles.rankIcon, { backgroundColor: `${c.def.color}22` }]}>
                        <Text style={styles.rankEmoji}>{c.def.emoji}</Text>
                      </View>
                      <View style={styles.rankInfo}>
                        <View style={styles.rankHead}>
                          <Text style={styles.rankLabel}>{c.def.label}</Text>
                          <Text style={styles.rankAmount}>
                            ¥{formatMoney(c.total)} · {pct.toFixed(1)}%
                          </Text>
                        </View>
                        <View style={styles.rankTrack}>
                          <View
                            style={[
                              styles.rankFill,
                              { width: `${Math.round(barPct)}%`, backgroundColor: c.def.color },
                            ]}
                          />
                        </View>
                      </View>
                      <Text style={styles.reimburseArrow}>›</Text>
                    </Pressable>
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
                        <Text style={styles.memberAmount}>
                          ¥{formatMoney(m.total)} · {m.pct.toFixed(1)}% · {m.count}笔
                        </Text>
                      </View>
                      <View style={styles.memberTrack}>
                        <View
                          style={[
                            styles.memberFill,
                            { width: `${Math.round(m.barPct)}%`, backgroundColor: memberColor(m.userId) },
                          ]}
                        />
                      </View>
                    </View>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {/* 支出趋势（时间范围与支出占比统一用简化标签） */}
          <Text style={styles.sectionTitle}>支出趋势 · {rangeLabel}</Text>
          <View style={styles.card}>
            {trendEmpty ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>这个时间段还没有支出记录</Text>
              </View>
            ) : (
              <TrendBarChart values={trendValues} labels={trendLabels} color={COLORS.expense} />
            )}
          </View>
        </ScrollView>
      ) : page === 'reimburse' ? (
        <View style={styles.subPage}>
          <View style={styles.navBar}>
            <Pressable
              hitSlop={8}
              onPress={backToMain}
              accessibilityRole="button"
              accessibilityLabel="返回统计"
            >
              <Text style={styles.navBack}>‹ 返回</Text>
            </Pressable>
            <Text style={styles.navTitle}>报销管理</Text>
          </View>
          <ReimburseScreen />
        </View>
      ) : (
        // 分类明细下钻：区间/成员筛选与排行完全同口径，所以顶部合计必然等于排行条上的数字
        <View style={styles.subPage}>
          {/* 明细列表与编辑页互斥显示（display 切换，与明细页同构）：
              EditRecordModal 明确要求宿主这样承载，不能用绝对定位叠层或 RNModal
              ——那两轮修复（触摸失灵 / 键盘遮挡）就是从这里来的 */}
          <View style={drillEdit ? styles.pageHidden : styles.subPage}>
            <View style={styles.navBar}>
              <Pressable
                hitSlop={8}
                onPress={backToMain}
                accessibilityRole="button"
                accessibilityLabel="返回统计"
              >
                <Text style={styles.navBack}>‹ 返回</Text>
              </Pressable>
              <Text style={styles.navTitle} numberOfLines={1}>
                {drill ? `${drill.label}明细` : '分类明细'}
              </Text>
            </View>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.drillScope}>{drillScopeText} · 不含待报销 · 点击条目可编辑</Text>
              <View style={styles.drillSummary}>
                <Text style={styles.drillSummaryAmount}>¥{formatMoney(drillTotal)}</Text>
                <Text style={styles.drillSummaryCount}>{drillRecords.length} 笔</Text>
              </View>
              {drillLoading && drillRecords.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyText}>正在加载明细…</Text>
                </View>
              ) : (
                <RecordList
                  records={drillRecords}
                  showDate
                  members={members}
                  onEdit={(r) => setDrillEdit(r)}
                  emptyText="这个时间段该分类没有符合条件的支出"
                />
              )}
            </ScrollView>
          </View>
          <View style={drillEdit ? styles.subPage : styles.pageHidden}>
            {/* 保存后组件内部广播 RECORDED → 本页 refreshAll 递增 tick → 下钻查询自动重跑，
                列表就地更新（分类被改掉的那条会移出本列表），用户仍停在这个分类的明细上 */}
            <EditRecordModal
              visible={drillEdit !== null}
              record={drillEdit}
              onClose={() => setDrillEdit(null)}
            />
          </View>
        </View>
      )}
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
  rankRowPressed: {
    opacity: 0.6,
  },
  // 分类明细下钻页
  drillScope: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textTertiary,
    marginBottom: SPACING.sm,
  },
  drillSummary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.md,
  },
  drillSummaryAmount: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '800',
    color: COLORS.expense,
  },
  drillSummaryCount: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
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
  // 与明细页同款：两页互斥显示（列表页 / 编辑页），不用 absolute 叠层与 RNModal
  pageHidden: {
    flex: 1,
    display: 'none',
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
