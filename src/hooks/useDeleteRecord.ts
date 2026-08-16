import { Alert, DeviceEventEmitter } from 'react-native';
import { LEDGER_EVENTS } from '../constants';
import { deleteRecord, deleteTransfer } from '../database/ledgerDB';
import { hapticError, hapticLight } from '../utils/haptics';

type DoneCallback = (message: string, isError: boolean) => void;

// 删除记录（二次确认 + 全局刷新事件），Home/Ledger 共用
export function confirmDeleteRecord(recordId: number, done: DoneCallback): void {
  Alert.alert('删除记录', '确定删除这条记录吗？', [
    { text: '取消', style: 'cancel' },
    {
      text: '删除',
      style: 'destructive',
      onPress: () => {
        deleteRecord(recordId)
          .then(() => {
            hapticLight();
            DeviceEventEmitter.emit(LEDGER_EVENTS.RECORDED);
            done('已删除该记录', false);
          })
          .catch(() => {
            hapticError();
            done('删除失败', true);
          });
      },
    },
  ]);
}

// 删除转账（二次确认 + 全局刷新事件）
export function confirmDeleteTransfer(transferId: number, done: DoneCallback): void {
  Alert.alert('删除转账', '确定删除这条转账记录吗？', [
    { text: '取消', style: 'cancel' },
    {
      text: '删除',
      style: 'destructive',
      onPress: () => {
        deleteTransfer(transferId)
          .then(() => {
            hapticLight();
            DeviceEventEmitter.emit(LEDGER_EVENTS.RECORDED);
            done('已删除该转账', false);
          })
          .catch(() => {
            hapticError();
            done('删除失败', true);
          });
      },
    },
  ]);
}
