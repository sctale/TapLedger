import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, DeviceEventEmitter, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LEDGER_EVENTS } from '../../constants';
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
  const [editing, setEditing] = useState<LedgerRecord | null>(null);

  const { showToast } = useToast();

  const reload = useCallback(async () => {
    try {
      const [rsSum, rsRec] = await Promise.all([getReimbursableSummary(), getReimbursableRecords()]);
      setReimburseSummary(rsSum);
      setReimburseRecords(rsRec);
    } catch {
      showToast('报销数据加载失败', 'error');
    }
  }, [showToast]);

  // 挂载时加载
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
    const load = () => {
      getCachedMembers().then(setMembers);
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
    Alert.alert(
      '一键核销全部待报销？',
      `共 ${reimburseSummary.count} 笔、¥${formatMoney(reimburseSummary.total)}，核销后会同步到全家设备。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '全部核销',
          style: 'destructive',
          onPress: async () => {
            if (busyRef.current) return;
            busyRef.current = true;
            try {
              await markAllReimbursed();
              hapticSuccess();
              showToast('已全部核销');
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
  }, [reimburseSummary.count, reimburseSummary.total, showToast]);

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
          <View style={styles.card}>
            <View style={styles.reimburseHead}>
              <View>
                <Text style={styles.reimburseTotal}>待报销 ¥{formatMoney(reimburseSummary.total)}</Text>
                <Text style={styles.reimburseCount}>{reimburseSummary.count} 笔待核销</Text>
              </View>
              {reimburseSummary.count > 0 ? (
                <Pressable
                  style={styles.reimburseBtn}
                  onPress={handleMarkAllReimbursed}
                  accessibilityRole="button"
                >
                  <Text style={styles.reimburseBtnText}>一键全部核销</Text>
                </Pressable>
              ) : null}
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
              <Text style={styles.emptyText}>暂无报销记录</Text>
            )}
          </View>
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
});
