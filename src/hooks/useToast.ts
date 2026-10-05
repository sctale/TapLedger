import { showToast } from '../components/Toast';

// 兼容旧写法：页面只需要 showToast，状态与渲染都收归到全局 Toast（见 components/Toast.tsx）
export function useToast() {
  return { showToast };
}
