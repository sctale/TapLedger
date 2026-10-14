import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT_SIZE, LEDGER_EVENTS, RADIUS, SPACING } from '../../constants';
import {
  getReimbursableRecords,
  getReimbursableSummary,
  markAllReimbursed,
  setReimbursed,
} from '../../database/ledgerDB';
import { formatMoney } from '../../utils/dateUtils';
import { hapticError, hapticLight, hapticSuccess } from '../../utils/haptics';
import { getCachedMembers, type MemberInfo } from '../../sync/memberUtils';
import { useToast } from '../../hooks/useToast';
import RecordList from '../../components/RecordList';
import EditRecordModal from '../../components/EditRecordModal';
import type { LedgerRecord } from '../../types';
import { manageStyles as styles } from './sharedStyles';

// 报销二级页（v0.5.9 从 ManageScreen 拆分；顶栏返回按钮由外层统一渲染，目前挂在统计页）
export default function ReimburseScreen() {
  const [reimburseSummary, setReimburseSummary] = useState({ total: 0, count: 0 });
  const [reimburseRecords, setReimburseRecords] = useState<LedgerRecord[]>([]);
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [memberFilter, setMemberFilter] = useState(0); // 0=全部成员（v0.11.16）
  const [editing, setEditing] = useState<LedgerRecord | null>(null);

  const { showToast } = useToast();

  const multiMember = members.length > 1;
  const filterName = members.find((m) => m.id === memberFilter)?.displayName ?? '';

  const reload = useCallback(async () => {
    try {
      // 合计与列表用同一个筛选条件，保证顶部数字就是下面这些条目的和
      const [rsSum, rsRec] = await Promise.all([
        getReimbursableSummary(memberFilter),
        getReimbursableRecords(memberFilter),
      ]);
      setReimburseSummary(rsSum);
      setReimburseRecords(rsRec);
    } catch {
      showToast('报销数据加载失败', 'error');
    }
  }, [memberFilter, showToast]);

  // 挂载时加载 / 切换成员后重载
  useEffect(() => {
    reload();
  }, [reload]);

  // 记账/导入/同步完成均可能改变报销记录，统一重载
  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.RECORDED, reload),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.DATA_IMPORTED, reload),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SYNC_DONE, reload),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [reload]);

  // 记账人标识靠成员缓存；登录态变化（登录/退出/同步）后重新读一次
  useEffect(() => {
    const load = async () => {
      const list = await getCachedMembers();
      setMembers(list);
      // 选中的成员被移出家庭/退出登录时回到「全部」，否则会停在一个查无此人的空列表上
      setMemberFilter((cur) => (cur > 0 && !list.some((m) => m.id === cur) ? 0 : cur));
    };
    load();
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SYNC_DONE, load),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.AUTH_CHANGED, load),
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  // ===== 报销核销操作 =====
  // 核销是批量、会同步到全家设备的动作，加确认；成功后只广播 RECORDED，
  // 本页已经监听该事件重载（此前还额外 await reload()，一次操作并发跑两轮查询）
  const busyRef = useRef(false);

  const handleMarkAllReimbursed = useCallback(() => {
    const scope = memberFilter > 0 ? `${filterName} 的` : '';
    Alert.alert(
      memberFilter > 0 ? `只核销 ${filterName} 的待报销？` : '一键核销全部待报销？',
      `共 ${scope}${reimburseSummary.count} 笔、¥${formatMoney(reimburseSummary.total)}，核销后会同步到全家设备。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: memberFilter > 0 ? '核销 TA 的' : '全部核销',
          style: 'destructive',
          onPress: async () => {
            if (busyRef.current) return;
            busyRef.current = true;
            try {
              await markAllReimbursed(memberFilter);
              hapticSuccess();
              showToast(memberFilter > 0 ? `已核销 ${filterName} 的报销` : '已全部核销');
              DeviceEventEmitter.emit(LEDGER_EVENTS.RECORDED);
            } catch {
              hapticError();
              showToast('操作失败', 'error');
            } finally {
              busyRef.current = false;
            }
          },
        },
      ],
    );
  }, [filterName, memberFilter, reimburseSummary.count, reimburseSummary.total, showToast]);

  const handleToggleReimbursed = useCallback(async (record: LedgerRecord) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await setReimbursed(record.id, !record.reimbursed);
      hapticLight();
      DeviceEventEmitter.emit(LEDGER_EVENTS.RECORDED);
    } catch {
      hapticError();
    } finally {
      busyRef.current = false;
    }
  }, []);

  return (
    <View style={local.page}>
      <View style={editing ? local.hidden : local.page}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ===== 报销 ===== */}
          <Text style={styles.sectionTitle}>报销</Text>

          {/* 成员筛选（多成员账本才显示，与统计页同款交互，v0.11.16） */}
          {multiMember ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={local.chipScroll}
              contentContainerStyle={local.chipRow}
            >
              <Pressable
                style={[local.chip, memberFilter === 0 && local.chipOn]}
                onPress={() => setMemberFilter(0)}
                accessibilityRole="tab"
                accessibilityLabel="全部成员"
                accessibilityState={{ selected: memberFilter === 0 }}
              >
                <Text style={[local.chipText, memberFilter === 0 && local.chipTextOn]} numberOfLines={1}>
                  👨‍👩‍👧 全部
                </Text>
              </Pressable>
              {members.map((m) => (
                <Pressable
                  key={m.id}
                  style={[local.chip, memberFilter === m.id && local.chipOn]}
                  onPress={() => setMemberFilter(m.id)}
                  accessibilityRole="tab"
                  accessibilityLabel={`只看${m.displayName}`}
                  accessibilityState={{ selected: memberFilter === m.id }}
                >
                  <Text style={[local.chipText, memberFilter === m.id && local.chipTextOn]} numberOfLines={1}>
                    {m.avatarEmoji} {m.displayName}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {/* 汇总卡只包这一小块；下面的条目和明细页一样直接铺在页面上 */}
          <View style={styles.card}>
            <View style={styles.reimburseHead}>
              <View>
                <Text style={styles.reimburseTotal}>待报销 ¥{formatMoney(reimburseSummary.total)}</Text>
                <Text style={styles.reimburseCount}>
                  {reimburseSummary.count} 笔待核销{memberFilter > 0 ? ` · ${filterName}` : ''}
                </Text>
              </View>
              {reimburseSummary.count > 0 ? (
                <Pressable
                  style={styles.reimburseBtn}
                  onPress={handleMarkAllReimbursed}
                  accessibilityRole="button"
                  accessibilityLabel={memberFilter > 0 ? `只核销${filterName}的待报销` : '一键核销全部待报销'}
                >
                  <Text style={styles.reimburseBtnText}>
                    {memberFilter > 0 ? '核销 TA 的' : '一键全部核销'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {reimburseRecords.length > 0 ? (
            <>
              <Text style={styles.hint}>点击条目可看完整备注并编辑</Text>
              <RecordList
                records={reimburseRecords}
                showDate
                members={members}
                onEdit={setEditing}
                onToggleReimbursed={handleToggleReimbursed}
              />
            </>
          ) : (
            <Text style={styles.emptyText}>
              {memberFilter > 0 ? `${filterName}暂无报销记录` : '暂无报销记录'}
            </Text>
          )}
        </ScrollView>
      </View>
      {/* 编辑页与列表页互斥显示（display 切换，与明细页/统计页同构）：
          EditRecordModal 要求宿主这样承载，不能用 RNModal 或绝对定位叠层 */}
      <View style={editing ? local.page : local.hidden}>
        <EditRecordModal visible={editing !== null} record={editing} onClose={() => setEditing(null)} />
      </View>
    </View>
  );
}

const local = StyleSheet.create({
  page: { flex: 1 },
  hidden: { flex: 1, display: 'none' },
  chipScroll: { flexGrow: 0, marginBottom: SPACING.sm },
  chipRow: { gap: SPACING.sm, paddingVertical: 2 },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipOn: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  chipText: { fontSize: FONT_SIZE.sm, color: COLORS.textSecondary, fontWeight: '600' },
  chipTextOn: { color: COLORS.white, fontWeight: '700' },
});
