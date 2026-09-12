import { useCallback, useState } from 'react';
import type { ToastState } from '../components/Toast';

// 统一 Toast 状态管理（ref 模式组件配合，避免定时器泄漏）
export function useToast() {
  const [toast, setToast] = useState<ToastState>({ visible: false, message: '', type: 'success', seq: 0 });

  // seq 自增：连续弹同一文案时也能让 Toast 组件重置定时器（v0.11 修复）
  const showToast = useCallback((message: string, type: ToastState['type'] = 'success') => {
    setToast((prev) => ({ visible: true, message, type, seq: (prev.seq ?? 0) + 1 }));
  }, []);

  const hideToast = useCallback(() => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  return { toast, showToast, hideToast };
}
