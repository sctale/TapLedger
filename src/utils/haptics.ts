import * as Haptics from 'expo-haptics';

// 触感强度统一收在这里调（v0.11.12：用户反馈「振动太大、点击反馈不舒服」）。
// expo-haptics 在 Android 上是直接驱动马达的固定波形（见 node_modules/expo-haptics
// 的 HapticsNotificationType/HapticsImpactType），不是系统触感通道，所以选哪个
// 样式＝选波形：
//   notificationAsync(success) = 40ms@50 + 停 + 40ms@60（双段，180ms）
//   notificationAsync(error)   = 三段，330ms
//   impactAsync(soft/light)    = 50ms@30（单段，最轻）
//   impactAsync(heavy)         = 60ms@70（单段，仍明显）
// 因此日常确认（记一笔成功等）用单段轻击，只有真错误才用较重的那一下——
// 错误提示要能被察觉，但不必是三段长震。
export async function hapticSuccess(): Promise<void> {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  } catch {
    // 静默失败
  }
}

export async function hapticLight(): Promise<void> {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // 静默失败
  }
}

export async function hapticError(): Promise<void> {
  try {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {
    // 静默失败
  }
}
