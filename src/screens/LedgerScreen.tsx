import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DeviceEventEmitter, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONT_SIZE, LEDGER_EVENTS, RADIUS, SPACING, findCategory } from '../constants';
import {
  getDaySummaries, getMaxDailyExpense,
  getRecordsByDate, getRecordsByRange,
} from '../database/ledgerDB';
import { formatMoney, getMonthRange, getToday, parseDate, addMonths, getMonthName, getDaysInMonth } from '../utils/dateUtils';
import { useToast } from '../hooks/useToast';
import { confirmDeleteRecord } from '../hooks/useDeleteRecord';
import { getCachedMembers, type MemberInfo } from '../sync/memberUtils';
import MonthHeatmap from '../components/MonthHeatmap';
import RecordList, { RecordRow } from '../components/RecordList';
import Toast from '../components/Toast';
import type { LedgerRecord, RecordType } from '../types';

type FilterType = 'all' | RecordType;

// 流水模式拍平后的列表项（虚拟化渲染；按收支记录分组）
type FlowItem =
  | { kind: 'header'; date: string; count: number }
  | { kind: 'record'; record: LedgerRecord };

interface Props {
  active: boolean;   // 当前 Tab 激活（App 常驻挂载，激活时滚回顶部）
}

export default function LedgerScreen({ active }: Props) {
  const [mode, setMode] = useState<'calendar' | 'list'>('calendar');
  const [viewDate, setViewDate] = useState(new Date());
  const [dailyExpense, setDailyExpense] = useState<Record<string, number>>({});
  const [maxExpense, setMaxExpense] = useState(0);
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [dayRecords, setDayRecords] = useState<LedgerRecord[]>([]);
  const [dayExpense, setDayExpense] = useState(0);
  const [dayIncome, setDayIncome] = useState(0);

  // 流水模式
  const [monthRecords, setMonthRecords] = useState<LedgerRecord[]>([]);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [searchText, setSearchText] = useState('');
  const [members, setMembers] = useState<MemberInfo[]>([]); // 家庭成员缓存（v0.5 记账人标识）

  const { toast, showToast, hideToast } = useToast();

  const calendarScrollRef = useRef<ScrollView>(null);
  const listScrollRef = useRef<FlatList<FlowItem>>(null);

  const { start, end } = useMemo(() => getMonthRange(viewDate), [viewDate]);

  const loadMonth = useCallback(async () => {
    try {
      const [days, max, records] = await Promise.all([
        getDaySummaries(start, end),
        getMaxDailyExpense(start, end),
        getRecordsByRange(start, end),
      ]);
      const map: Record<string, number> = {};
      for (const d of days) map[d.date] = d.expense;
      setDailyExpense(map);
      setMaxExpense(max);
      setMonthRecords(records);
    } catch {
      showToast('明细数据加载失败', 'error');
    }
  }, [start, end, showToast]);

  const loadDay = useCallback(async (date: string) => {
    try {
      const records = await getRecordsByDate(date);
      setDayRecords(records);
      let exp = 0;
      let inc = 0;
      for (const r of records) {
        if (r.type === 'expense' && !r.reimbursable) exp += r.amount;
        else if (r.type === 'income') inc += r.amount;
      }
      setDayExpense(exp);
      setDayIncome(inc);
    } catch {
      // 单日加载失败保持现状
    }
  }, []);

  useEffect(() => {
    loadMonth();
  }, [loadMonth]);

  useEffect(() => {
    loadDay(selectedDate);
  }, [selectedDate, loadDay]);

  useEffect(() => {
    getCachedMembers().then(setMembers); // 记账人标识（v0.5）
  }, []);

  // Tab 激活时滚回顶部（按当前模式滚动对应列表，v0.5.4）
  useEffect(() => {
    if (!active) return;
    if (mode === 'calendar') calendarScrollRef.current?.scrollTo({ y: 0, animated: false });
    else listScrollRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [active, mode]);

  // Tab 激活时重载数据（激活刷新保证数据即时，v0.5.6）
  useEffect(() => {
    if (!active) return;
    loadMonth();
    loadDay(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // 全局刷新
  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.RECORDED, () => {
        loadMonth();
        loadDay(selectedDate);
      }),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.DATA_IMPORTED, () => {
        loadMonth();
        loadDay(selectedDate);
      }),
      // 登录态/同步完成 → 刷新成员缓存（v0.5）
      DeviceEventEmitter.addListener(LEDGER_EVENTS.AUTH_CHANGED, () => {
        getCachedMembers().then(setMembers);
      }),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SYNC_DONE, () => {
        getCachedMembers().then(setMembers);
      }),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [loadMonth, loadDay, selectedDate]);

  // 切月：选中日同步到目标月同日（超出月末则 clamp，与系统日历一致）
  const changeMonth = useCallback((delta: number) => {
    setViewDate((prev) => {
      const next = addMonths(prev, delta);
      const [y, m, d] = selectedDate.split('-').map(Number);
      // 目标月与当前选中日同月才需要同步（跨月选中日始终在 viewDate 月内）
      const sameMonth = y === prev.getFullYear() && m === prev.getMonth() + 1;
      if (sameMonth) {
        const day = Math.min(d, getDaysInMonth(next.getFullYear(), next.getMonth() + 1));
        setSelectedDate(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
      }
      return next;
    });
  }, [selectedDate]);

  const handleDelete = useCallback((record: LedgerRecord) => {
    confirmDeleteRecord(record.id, (msg, isError) => showToast(msg, isError ? 'error' : 'success'));
  }, [showToast]);

  // 流水筛选（records 按类型/关键词）
  const filteredRecords = useMemo(() => {
    let list = monthRecords;
    if (filterType !== 'all') {
      list = list.filter((r) => r.type === filterType);
    }
    if (searchText.trim()) {
      const kw = searchText.trim().toLowerCase();
      list = list.filter((r) => {
        const cat = findCategory(r.category, r.type);
        return (
          r.note.toLowerCase().includes(kw) ||
          cat.label.toLowerCase().includes(kw) ||
          cat.key.toLowerCase().includes(kw)
        );
      });
    }
    return list;
  }, [monthRecords, filterType, searchText]);

  // 拍平为虚拟化列表数据（日期头 + 记录行按时间降序分组）
  const flowItems = useMemo<FlowItem[]>(() => {
    type Mixed = { date: string; timestamp: number; item: FlowItem };
    const mixed: Mixed[] = [];
    for (const r of filteredRecords) mixed.push({ date: r.date, timestamp: r.timestamp, item: { kind: 'record', record: r } });
    mixed.sort((a, b) => (a.date === b.date ? b.timestamp - a.timestamp : b.date < a.date ? -1 : 1));

    const items: FlowItem[] = [];
    let curDate = '';
    let count = 0;
    const flush = () => {
      if (curDate) items.push({ kind: 'header', date: curDate, count });
    };
    for (const m of mixed) {
      if (m.date !== curDate) {
        flush();
        curDate = m.date;
        count = 1;
      } else {
        count += 1;
      }
      items.push(m.item);
    }
    flush();
    return items;
  }, [filteredRecords]);

  const monthTotal = useMemo(() => {
    let exp = 0;
    let inc = 0;
    for (const r of monthRecords) {
      if (r.type === 'expense' && !r.reimbursable) exp += r.amount;
      else if (r.type === 'income') inc += r.amount;
    }
    return { exp, inc };
  }, [monthRecords]);

  const isCurrentMonth = useMemo(() => {
    const now = new Date();
    return viewDate.getFullYear() === now.getFullYear() && viewDate.getMonth() === now.getMonth();
  }, [viewDate]);

  const selectedLabel = useMemo(() => {
    const d = parseDate(selectedDate);
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return `${selectedDate} ${week}`;
  }, [selectedDate]);

  const renderFlowItem = useCallback(({ item }: { item: FlowItem }) => {
    if (item.kind === 'header') {
      return (
        <View style={styles.groupHeader}>
          <Text style={styles.groupDate}>{item.date}</Text>
          <Text style={styles.groupCount}>{item.count} 笔</Text>
        </View>
      );
    }
    return (
      <View style={styles.flowRecordWrap}>
        <RecordRow record={item.record} onDelete={handleDelete} members={members} />
      </View>
    );
  }, [handleDelete, members]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" />
      {mode === 'calendar' ? (
        <ScrollView ref={calendarScrollRef} style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.titleRow}>
            <Text style={styles.pageTitle}>明细</Text>
            <View style={styles.modeSwitch}>
              {(['calendar', 'list'] as const).map((m) => (
                <Pressable
                  key={m}
                  style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
                  onPress={() => setMode(m)}
                  accessibilityRole="tab"
                  accessibilityLabel={m === 'calendar' ? '日历模式' : '流水模式'}
                  accessibilityState={{ selected: mode === m }}
                >
                  <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
                    {m === 'calendar' ? '日历' : '流水'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* 月份切换 + 热力图 */}
          <View style={styles.card}>
            <View style={styles.monthRow}>
              <Pressable
                style={styles.monthBtn}
                onPress={() => changeMonth(-1)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="上一月"
              >
                <Text style={styles.monthBtnText}>‹</Text>
              </Pressable>
              <Pressable
                onPress={() => { if (!isCurrentMonth) { setViewDate(new Date()); setSelectedDate(getToday()); } }}
                accessibilityRole="button"
                accessibilityLabel="回到本月"
              >
                <Text style={styles.monthTitle}>{getMonthName(viewDate)}</Text>
              </Pressable>
              <Pressable
                style={styles.monthBtn}
                onPress={() => changeMonth(1)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="下一月"
              >
                <Text style={styles.monthBtnText}>›</Text>
              </Pressable>
            </View>
            <MonthHeatmap
              year={viewDate.getFullYear()}
              month={viewDate.getMonth() + 1}
              dailyExpense={dailyExpense}
              maxExpense={maxExpense}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          </View>

          {/* 选中日期明细 */}
          <View style={styles.dayHeader}>
            <Text style={styles.dayTitle}>{selectedLabel}</Text>
            <View style={styles.daySummary}>
              {dayExpense > 0 ? (
                <Text style={styles.daySummaryText}>
                  支出 <Text style={{ color: COLORS.expense, fontWeight: '700' }}>¥{formatMoney(dayExpense)}</Text>
                </Text>
              ) : null}
              {dayIncome > 0 ? (
                <Text style={styles.daySummaryText}>
                  收入 <Text style={{ color: COLORS.income, fontWeight: '700' }}>¥{formatMoney(dayIncome)}</Text>
                </Text>
              ) : null}
            </View>
          </View>
          <RecordList
            records={dayRecords}
            onDelete={handleDelete}
            emptyText="这一天还没有记录"
            members={members}
          />
        </ScrollView>
      ) : (
        /* 流水模式：FlatList 虚拟化（长月数据不卡顿） */
        <FlatList
          ref={listScrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.content}
          data={flowItems}
          keyExtractor={(item) => item.kind === 'header' ? `h-${item.date}` : `r-${item.record.id}`}
          renderItem={renderFlowItem}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              <View style={styles.titleRow}>
                <Text style={styles.pageTitle}>明细</Text>
                <View style={styles.modeSwitch}>
                  {(['calendar', 'list'] as const).map((m) => (
                    <Pressable
                      key={m}
                      style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
                      onPress={() => setMode(m)}
                      accessibilityRole="tab"
                      accessibilityLabel={m === 'calendar' ? '日历模式' : '流水模式'}
                      accessibilityState={{ selected: mode === m }}
                    >
                      <Text style={[styles.modeText, mode === m && styles.modeTextActive]}>
                        {m === 'calendar' ? '日历' : '流水'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {/* 月份切换（流水模式与日历模式共享 viewDate，v0.5.1） */}
              <View style={styles.monthBar}>
                <Pressable
                  style={styles.monthBtn}
                  onPress={() => changeMonth(-1)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="上一月"
                >
                  <Text style={styles.monthBtnText}>‹</Text>
                </Pressable>
                <Pressable
                  onPress={() => { if (!isCurrentMonth) { setViewDate(new Date()); setSelectedDate(getToday()); } }}
                  accessibilityRole="button"
                  accessibilityLabel="回到本月"
                >
                  <Text style={styles.monthTitle}>{getMonthName(viewDate)}</Text>
                </Pressable>
                <Pressable
                  style={styles.monthBtn}
                  onPress={() => changeMonth(1)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="下一月"
                >
                  <Text style={styles.monthBtnText}>›</Text>
                </Pressable>
              </View>
              {/* 流水筛选 */}
              <View style={styles.filterRow}>
                <View style={styles.chips}>
                  {([['all', '全部'], ['expense', '支出'], ['income', '收入']] as [FilterType, string][]).map(([k, label]) => (
                    <Pressable
                      key={k}
                      style={[styles.filterChip, filterType === k && styles.filterChipActive]}
                      onPress={() => setFilterType(k)}
                      accessibilityRole="button"
                      accessibilityLabel={`筛选${label}`}
                      accessibilityState={{ selected: filterType === k }}
                    >
                      <Text style={[styles.filterChipText, filterType === k && styles.filterChipTextActive]}>{label}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              <View style={styles.searchRow}>
                <View style={styles.searchWrap}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="搜索备注 / 分类"
                    placeholderTextColor={COLORS.textTertiary}
                    value={searchText}
                    onChangeText={setSearchText}
                    maxLength={20}
                  />
                  {searchText.length > 0 ? (
                    <Pressable
                      style={styles.searchClear}
                      onPress={() => setSearchText('')}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel="清除搜索"
                    >
                      <Text style={styles.searchClearText}>✕</Text>
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.monthTotal}>
                  <Text style={styles.monthTotalText}>
                    收 <Text style={{ color: COLORS.income, fontWeight: '700' }}>{formatMoney(monthTotal.inc)}</Text>
                  </Text>
                  <Text style={styles.monthTotalText}>
                    支 <Text style={{ color: COLORS.expense, fontWeight: '700' }}>{formatMoney(monthTotal.exp)}</Text>
                  </Text>
                </View>
              </View>
              {flowItems.length === 0 ? (
                <RecordList records={[]} emptyText="没有符合条件的记录" />
              ) : null}
            </View>
          }
        />
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
  modeSwitch: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.pill,
    padding: 3,
  },
  modeBtn: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
  },
  modeBtnActive: {
    backgroundColor: COLORS.surface,
  },
  modeText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  modeTextActive: {
    color: COLORS.accentDark,
    fontWeight: '700',
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
  },
  monthRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm + 2,
  },
  monthBtn: {
    width: 34,
    height: 34,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthBtnText: {
    fontSize: FONT_SIZE.xl,
    color: COLORS.textSecondary,
    lineHeight: 24,
  },
  monthTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    color: COLORS.text,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  dayTitle: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '700',
    color: COLORS.text,
  },
  daySummary: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  daySummaryText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
  },
  filterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  chips: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  filterChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  filterChipActive: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  filterChipText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: COLORS.white,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  searchWrap: {
    flex: 1,
    position: 'relative',
    justifyContent: 'center',
  },
  searchInput: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingRight: 36,
    paddingVertical: 9,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
  },
  searchClear: {
    position: 'absolute',
    right: 8,
    width: 22,
    height: 22,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchClearText: {
    fontSize: FONT_SIZE.xs - 1,
    color: COLORS.textTertiary,
    fontWeight: '600',
  },
  monthTotal: {
    flexDirection: 'row',
    gap: SPACING.sm,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.sm + 2,
    flexShrink: 1,
  },
  monthTotalText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textSecondary,
  },
  monthBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: SPACING.sm,
    marginBottom: SPACING.xs + 2,
  },
  flowRecordWrap: {
    marginBottom: SPACING.sm,
  },
  groupDate: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  groupCount: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
  },
});
