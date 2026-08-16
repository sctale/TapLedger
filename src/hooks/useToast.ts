import { useCallback, useState } from 'react';
import type { ToastState } from '../components/Toast';

// 统一 Toast 状态管理（ref 模式组件配合，避免定时器泄漏）
export function useToast() {
  const [toast, setToast] = useState<ToastState>({ visible: false, message: '', type: 'success' });

  const showToast = useCallback((message: string, type: ToastState['type'] = 'success') => {
    setToast({ visible: true, message, type });
  }, []);

  const hideToast = useCallback(() => {
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  return { toast, showToast, hideToast };
}
