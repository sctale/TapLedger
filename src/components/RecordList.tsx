import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT_SIZE, RADIUS, SPACING, findCategory } from '../constants';
import { formatMoney } from '../utils/dateUtils';
import { findMember, memberColor } from '../sync/memberUtils';
import type { LedgerRecord } from '../types';
import type { MemberInfo } from '../sync/memberUtils';

interface Props {
  records: LedgerRecord[];
  onDelete?: (record: LedgerRecord) => void;
  onEdit?: (record: LedgerRecord) => void; // 点击行编辑（v0.10，不传则整行不可点）
  emptyText?: string;
  showTime?: boolean; // 显示记录时间（今日明细用）
  showDate?: boolean; // 显示记录日期（跨多日列表用，如报销明细）
  members?: MemberInfo[]; // 家庭成员（显示记账人标识，v0.5）
  onToggleReimbursed?: (record: LedgerRecord) => void; // 报销页单条核销/撤销
}

// 单条记录行（memo：父组件 state 变化时避免整表重渲染；导出供 FlatList 虚拟化列表使用）
export const RecordRow = React.memo(function RecordRow({
  record,
  onDelete,
  onEdit,
  showTime,
  showDate,
  members,
  onToggleReimbursed,
}: {
  record: LedgerRecord;
  onDelete?: (record: LedgerRecord) => void;
  onEdit?: (record: LedgerRecord) => void;
  showTime?: boolean;
  showDate?: boolean;
  members?: MemberInfo[];
  onToggleReimbursed?: (record: LedgerRecord) => void;
}) {
  const cat = findCategory(record.category, record.type);
  const isExpense = record.type === 'expense';
  // 记账人标识：已登录且能解析出成员即显示（v0.10.1：家庭账本即使只有 1 人也显示，
  // 家人后续加入时历史记录已有归属；members 为空数组 = 未加入家庭，不显示）
  const member = members && record.userId > 0 ? findMember(members, record.userId) : null;
  // 单条核销/撤销按钮（只有报销页传 onToggleReimbursed）：放在左侧图标下方
  const showReimburseBtn = !!onToggleReimbursed && record.reimbursable;

  // 左滑删除：仅在明显横向拖动时接管手势（不抢点击），越过阈值触发删除后弹回；✕ 仍作为兜底
  const translateX = useRef(new Animated.Value(0)).current;
  const swipeable = !!onDelete;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, g) =>
          !!onDelete && g.dx < -8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_, g) => {
          if (g.dx < 0) translateX.setValue(Math.max(g.dx, -96));
        },
        onPanResponderRelease: (_, g) => {
          if (onDelete && g.dx <= -64) onDelete(record);
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
        },
        onPanResponderTerminate: () =>
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 8 }).start(),
      }),
    [onDelete, record, translateX],
  );

  return (
    <View style={styles.swipeWrap}>
      {swipeable ? (
        <View style={styles.swipeDelete} pointerEvents="none">
          <Text style={styles.swipeDeleteText}>删除</Text>
        </View>
      ) : null}
      <Animated.View
        style={swipeable ? { transform: [{ translateX }] } : undefined}
        {...(swipeable ? panResponder.panHandlers : {})}
      >
        <View style={styles.row}>
          {/* 两行结构：第一行「图标 + 分类信息 + 金额/删除」，第二行「核销 + 日期 + 备注」。
        v0.11.8：核销/删除不包进编辑热区——嵌套 Pressable 手指能点（内层优先），
        但 TalkBack 会把外层标签下的子树合并成一个节点，核销和删除就对读屏不可达了。
        v0.11.12：日期与备注挪到第二行用整行宽（原先和分类名挤在一列里，被压到零宽）；
        v0.11.14/15：核销按钮从右侧挪到第二行的行首，正好落在图标正下方——
        窄屏上「图标+分类+成员+待报销+核销+金额」超过一行宽，RN 不裁剪溢出就会盖住徽章。 */}
          <View style={styles.rowMain}>
            <Pressable
              style={styles.rowContent}
              onPress={() => onEdit?.(record)}
              disabled={!onEdit}
              accessibilityRole={onEdit ? 'button' : undefined}
              accessibilityLabel={onEdit ? `编辑${cat.label}记录${formatMoney(record.amount)}元` : undefined}
            >
              <View style={[styles.iconWrap, { backgroundColor: `${cat.color}22` }]}>
                <Text style={styles.icon} accessibilityLabel={`${cat.label}分类`}>
                  {cat.emoji}
                </Text>
              </View>
              <View style={styles.catRow}>
                <Text style={styles.catLabel}>{cat.label}</Text>
                {member ? (
                  <View style={[styles.memberTag, { backgroundColor: `${memberColor(member.id)}22` }]}>
                    <Text style={styles.memberEmoji}>{member.avatarEmoji}</Text>
                    <Text style={[styles.memberName, { color: memberColor(member.id) }]} numberOfLines={1}>
                      {member.displayName}
                    </Text>
                  </View>
                ) : null}
                {record.reimbursable ? (
                  <View style={[styles.badge, record.reimbursed ? styles.badgeDone : styles.badgePending]}>
                    <Text style={[styles.badgeText, record.reimbursed && styles.badgeTextDone]}>
                      {record.reimbursed ? '已报销' : '待报销'}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
            <View style={styles.rowActions}>
              <Text
                style={[styles.amount, { color: isExpense ? COLORS.expense : COLORS.income }]}
                accessibilityLabel={`${isExpense ? '支出' : '收入'}${formatMoney(record.amount)}元`}
              >
                {isExpense ? '-' : '+'}
                {formatMoney(record.amount)}
              </Text>
              {onDelete ? (
                <Pressable
                  style={styles.deleteBtn}
                  onPress={() => onDelete(record)}
                  hitSlop={{ top: 12, bottom: 12, left: 10, right: 10 }}
                  accessibilityRole="button"
                  accessibilityLabel={`删除${cat.label}记录${formatMoney(record.amount)}元`}
                >
                  <Text style={styles.deleteText}>✕</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
          {/* 第二行：核销按钮（行首，与图标同宽同左边缘）+ 日期 + 备注。
              没有核销按钮时，日期/备注用缩进对齐分类文字左边缘。 */}
          {showReimburseBtn || record.note || showDate || showTime ? (
            <View style={styles.metaRow}>
              {showReimburseBtn ? (
                <Pressable
                  style={[styles.reimburseToggle, record.reimbursed && styles.reimburseToggleUndo]}
                  onPress={() => onToggleReimbursed?.(record)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel={record.reimbursed ? '撤销核销' : '核销报销'}
                >
                  <Text style={styles.reimburseToggleText}>{record.reimbursed ? '撤销' : '核销'}</Text>
                </Pressable>
              ) : null}
              <Pressable
                style={[styles.metaLine, !showReimburseBtn && styles.metaIndented]}
                onPress={onEdit ? () => onEdit(record) : undefined}
                disabled={!onEdit}
                accessibilityRole={onEdit ? 'button' : undefined}
              >
                {showDate ? <Text style={styles.dateTag}>{record.date}</Text> : null}
                {showTime ? (
                  <Text style={styles.timeTag}>{new Date(record.timestamp).toTimeString().slice(0, 5)}</Text>
                ) : null}
                {record.note ? (
                  <Text style={styles.note} numberOfLines={2}>
                    {record.note}
                  </Text>
                ) : null}
              </Pressable>
            </View>
          ) : null}
        </View>
      </Animated.View>
    </View>
  );
});

// 记录列表（暖色卡片风格）
function RecordList({
  records,
  onDelete,
  onEdit,
  emptyText = '还没有记录，记一笔吧 ✨',
  showTime,
  showDate,
  members,
  onToggleReimbursed,
}: Props) {
  if (records.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyEmoji}>📭</Text>
        <Text style={styles.emptyText}>{emptyText}</Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {records.map((record) => (
        <RecordRow
          key={record.id}
          record={record}
          onDelete={onDelete}
          onEdit={onEdit}
          showTime={showTime}
          showDate={showDate}
          members={members}
          onToggleReimbursed={onToggleReimbursed}
        />
      ))}
    </View>
  );
}

export default React.memo(RecordList);

const styles = StyleSheet.create({
  empty: {
    paddingVertical: SPACING.xl,
    alignItems: 'center',
    gap: SPACING.sm,
  },
  emptyEmoji: {
    fontSize: 34,
    opacity: 0.5,
  },
  emptyText: {
    color: COLORS.textTertiary,
    fontSize: FONT_SIZE.sm,
  },
  list: {
    gap: SPACING.sm,
  },
  swipeWrap: {
    position: 'relative',
    borderRadius: RADIUS.md,
    overflow: 'hidden',
    backgroundColor: COLORS.danger,
  },
  swipeDelete: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeDeleteText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
  },
  row: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    gap: 2,
  },
  // 第一行：图标 + 分类 + 右侧金额/删除
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 4,
  },
  // 编辑热区（图标 + 分类信息），与右侧动作区分开，读屏可分别聚焦
  rowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 4,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 4,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: FONT_SIZE.xxl - 8,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap', // 极窄屏/大字号下让徽章换行，而不是溢出压到右侧金额上
    gap: 6,
  },
  catLabel: {
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    fontWeight: '600',
  },
  badge: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  memberTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
    maxWidth: 96,
  },
  memberEmoji: {
    fontSize: FONT_SIZE.xs,
  },
  memberName: {
    fontSize: FONT_SIZE.xs - 1.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  badgePending: {
    backgroundColor: COLORS.warningBg,
  },
  badgeDone: {
    backgroundColor: COLORS.incomeBg,
  },
  badgeText: {
    fontSize: FONT_SIZE.xs - 1.5,
    color: COLORS.warningText,
    fontWeight: '700',
  },
  badgeTextDone: {
    color: COLORS.incomeText,
  },
  // 第二行：行首是核销按钮（与图标同宽），其后是日期/备注
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm + 4,
  },
  metaLine: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  // 没有核销按钮占位时，用缩进把日期/备注对齐到分类文字左边缘（图标宽 + 行间距）
  metaIndented: {
    paddingLeft: 40 + SPACING.sm + 4,
  },
  note: {
    fontSize: FONT_SIZE.xs + 1,
    color: COLORS.textTertiary,
  },
  timeTag: {
    fontSize: FONT_SIZE.xs - 1,
    color: COLORS.textTertiary,
  },
  dateTag: {
    fontSize: FONT_SIZE.xs - 1,
    color: COLORS.textSecondary,
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  amount: {
    fontSize: FONT_SIZE.lg - 2,
    fontWeight: '700',
  },
  reimburseToggle: {
    width: 40, // 与上方图标同宽、同左边缘，整列对齐
    flexShrink: 0, // 第二行内容再挤也不能压掉这个宽度，否则就和图标错开了
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
    backgroundColor: COLORS.warningBg,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
  },
  reimburseToggleUndo: {
    backgroundColor: COLORS.bgAlt,
    borderColor: COLORS.border,
  },
  reimburseToggleText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.warningText,
    fontWeight: '700',
  },
  deleteBtn: {
    width: 26,
    height: 26,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    fontWeight: '600',
  },
});
