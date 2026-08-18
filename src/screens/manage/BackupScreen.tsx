import React, { useCallback, useEffect, useState } from 'react';
import { Alert, DeviceEventEmitter, Pressable, ScrollView, Text, View } from 'react-native';
import { COLORS, LEDGER_EVENTS } from '../../constants';
import { getAllRecords, getTotalCount } from '../../database/ledgerDB';
import { exportLedgerData } from '../../utils/exportData';
import { exportCSV } from '../../utils/csvExport';
import { pickAndImportData, type ImportStrategy } from '../../utils/importData';
import { hapticError, hapticSuccess } from '../../utils/haptics';
import { useToast } from '../../hooks/useToast';
import Toast from '../../components/Toast';
import { manageStyles as styles } from './sharedStyles';

// 数据备份二级页（v0.5.9 从 ManageScreen 拆分；顶栏返回按钮由外层 ManageScreen 统一渲染）
export default function BackupScreen() {
  const [totalCount, setTotalCount] = useState(0);

  const { toast, showToast, hideToast } = useToast();

  const reload = useCallback(async () => {
    try {
      setTotalCount(await getTotalCount());
    } catch {
      // 记录数读取失败保持现状
    }
  }, []);

  // 挂载时加载
  useEffect(() => {
    reload();
  }, [reload]);

  // 记账/导入/同步完成均可能改变记录数，统一重载
  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.RECORDED, reload),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.DATA_IMPORTED, reload),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.SYNC_DONE, reload),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [reload]);

  // ===== 备份操作（照搬 ManageScreen） =====
  const handleExport = useCallback(async () => {
    const result = await exportLedgerData();
    if (result.success) showToast(`已导出 ${result.count} 条记录`);
    else if (result.error) showToast(result.error, 'error');
  }, [showToast]);

  const handleExportCSV = useCallback(async () => {
    try {
      const records = await getAllRecords();
      const result = await exportCSV(records);
      if (result.success) showToast(`已导出 CSV（${records.length} 条）`);
      else if (result.error) showToast(result.error, 'error');
    } catch {
      showToast('导出失败', 'error');
    }
  }, [showToast]);

  const doImport = useCallback(async (strategy: ImportStrategy) => {
    // pickAndImportData 内部成功后会 emit DATA_IMPORTED（含跨页刷新链）
    const result = await pickAndImportData(strategy);
    if (result.cancelled) return;
    if (result.success) {
      hapticSuccess();
      let msg = `已导入 ${result.imported} 条记录`;
      const extras: string[] = [];
      if (result.skipped > 0) extras.push(`跳过 ${result.skipped} 条无效`);
      if ((result.failed ?? 0) > 0) extras.push(`${result.failed} 项附属数据失败`);
      if (extras.length > 0) msg += `（${extras.join('，')}）`;
      showToast(msg, (result.failed ?? 0) > 0 ? 'info' : 'success');
      await reload();
    } else {
      hapticError();
      showToast(result.error ?? '导入失败', 'error');
    }
  }, [reload, showToast]);

  const confirmImport = useCallback(() => {
    Alert.alert('导入数据', '选择导入方式', [
      { text: '取消', style: 'cancel' },
      { text: '合并', onPress: () => doImport('merge') },
      { text: '替换', style: 'destructive', onPress: () => doImport('replace') },
    ]);
  }, [doImport]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* ===== 数据备份 ===== */}
      <Text style={styles.sectionTitle}>数据备份</Text>
      <View style={styles.card}>
        <View style={styles.dataRow}>
          <Text style={styles.label}>本地记录</Text>
          <Text style={styles.dataCount}>{totalCount} 条</Text>
        </View>
        <View style={styles.btnRow}>
          <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.accent }]} onPress={handleExport}>
            <Text style={styles.actionBtnText}>导出 JSON</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.income }]} onPress={handleExportCSV}>
            <Text style={styles.actionBtnText}>导出 Excel</Text>
          </Pressable>
          <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.bgAlt }]} onPress={confirmImport}>
            <Text style={[styles.actionBtnText, { color: COLORS.text }]}>导入数据</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>JSON 完整备份（含账户/周期/报销）；Excel 供日常查看分析</Text>
      </View>

      <Toast toast={toast} onHide={hideToast} />
    </ScrollView>
  );
}
