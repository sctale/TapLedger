import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

// 触感反馈的唯一出口，强度和"什么时候振"都收在这里。
//
// 之前为什么怎么调都不舒服：expo-haptics 的 impactAsync / notificationAsync 在 Android 上**不是**
// 系统触感通道，而是直接 `Vibrator.vibrate(VibrationEffect.createWaveform(...))` 打自定义波形
// （soft/light = 50ms@30，heavy = 60ms@70）。自己定的"时长×振幅"落到不同马达上就是一段发闷的蜂鸣——
// Android 的触感设计原则把这类效果单列成「蜂鸣触感反馈（buzz）：噪杂、尖锐、穿透性强，振动结束后
// 还留余震」，举的坏例子恰恰是"按键按下后振动时间过长"。expo 自己的声明也写着
// "Android's Vibrator API is not recommended for implementing haptics feedback. Instead, use
// performAndroidHapticsAsync"。
//
// 现在 Android 走 HapticFeedbackConstants（View.performHapticFeedback）：以操作为导向的系统常量，
// 波形由厂商按设备调校、系统跟随用户的触感开关，且在不支持时平台自己给回退；iOS 仍用
// UISelection / UINotification generator。
//
// 再往前一步是"少振"：默认档位「精简」只在**结果**上振（记一笔成功、失败、删除），数字键盘按键、
// 分类与收支切换这类一秒内会连点好几下的操作完全不振。这也是 Things 3 / Cash App 一路的做法——
// 确认只出现在有意义的状态变化上；重复性选择要么没有，要么用最轻的一档（SEGMENT_FREQUENT_TICK 的
// 官方定义就是"预期非常轻，连续触发也不难受；设备做不出足够轻的振动时干脆不振"）。
// 想连按键也要反馈，可在「设置 → 偏好 → 触感反馈」切到「完整」。

export type HapticLevel = 'off' | 'subtle' | 'full';

let level: HapticLevel = 'subtle';

export function setHapticLevel(next: HapticLevel): void {
  level = next;
}

export function getHapticLevel(): HapticLevel {
  return level;
}

function enabled(minimum: Exclude<HapticLevel, 'off'>): boolean {
  if (level === 'off') return false;
  if (minimum === 'full') return level === 'full';
  return true;
}

// Android 的这些常量按 API 级别铺开得很散（CONFIRM/REJECT/SEGMENT_* 要 30+，TOGGLE_* 要 34+），
// 常量不存在时原生侧抛 HapticsNotSupportedException，所以每个语义都带一条回落梯子。
async function androidHaptic(ladder: Haptics.AndroidHaptics[]): Promise<void> {
  for (const type of ladder) {
    try {
      await Haptics.performAndroidHapticsAsync(type);
      return;
    } catch {
      // 这台设备/系统没有这个常量，试下一个
    }
  }
}

// 重复性轻反馈的防抖：同一次点击可能连发两次（Pressable 与 handler 各一次），叠起来就是"嗡"的一下。
let lastTickAt = 0;

/** 轻反馈：数字键盘按键、分类/收支切换等重复选择。只在「完整」档出现。 */
export async function hapticLight(): Promise<void> {
  if (!enabled('full')) return;
  const now = Date.now();
  if (now - lastTickAt < 25) return;
  lastTickAt = now;
  if (Platform.OS === 'android') {
    await androidHaptic([
      Haptics.AndroidHaptics.Segment_Frequent_Tick,
      Haptics.AndroidHaptics.Segment_Tick,
      Haptics.AndroidHaptics.Clock_Tick,
    ]);
    return;
  }
  try {
    await Haptics.selectionAsync();
  } catch {
    // 静默失败
  }
}

/** 结果确认：记一笔成功、设置保存成功。 */
export async function hapticSuccess(): Promise<void> {
  if (!enabled('subtle')) return;
  if (Platform.OS === 'android') {
    await androidHaptic([Haptics.AndroidHaptics.Confirm, Haptics.AndroidHaptics.Clock_Tick]);
    return;
  }
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // 静默失败
  }
}

/** 失败与撤销：金额不合法、保存失败、删除记录。要能被察觉，但仍是一次，不是三段长震。 */
export async function hapticError(): Promise<void> {
  if (!enabled('subtle')) return;
  if (Platform.OS === 'android') {
    await androidHaptic([Haptics.AndroidHaptics.Reject, Haptics.AndroidHaptics.Long_Press]);
    return;
  }
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  } catch {
    // 静默失败
  }
}
