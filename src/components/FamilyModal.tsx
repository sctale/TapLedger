import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { COLORS, FONT_SIZE, RADIUS, SPACING } from '../constants';
import Modal from './Modal';
import { hapticError, hapticLight } from '../utils/haptics';
import type { FamilyInfo, FamilyMember } from '../sync/serverTypes';

interface Props {
  visible: boolean;
  baseUrl: string;
  token: string;
  currentUserId: number;       // 当前登录用户 id（判断是否 owner）
  onClose: () => void;
  onFamilyChanged: () => void;   // 创建/加入/退出后刷新外层状态
  onError: (msg: string) => void;
}

// 家庭弹窗：未入家（创建/邀请码加入）｜已入家（成员列表 + 邀请码管理 + 退出）
export default function FamilyModal({ visible, baseUrl, token, currentUserId, onClose, onFamilyChanged, onError }: Props) {
  const [family, setFamily] = useState<FamilyInfo | null>(null);
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false); // 编辑自己的昵称/头像（v0.5）
  const [profileName, setProfileName] = useState('');
  const [profileEmoji, setProfileEmoji] = useState('🙂');

  const isOwner = family != null && family.ownerId === currentUserId;
  // 可选头像池（与登录注册一致）
  const AVATARS = ['🙂', '😊', '😎', '🥳', '🧑', '👩', '👨', '🧕', '👴', '👵', '🐱', '🐶'];

  useEffect(() => {
    if (!visible) return;
    setName('');
    setInviteCode('');
    setEditingProfile(false);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const reload = async () => {
    try {
      const { apiGetFamily, apiFamilyMembers } = await import('../sync/apiClient');
      const [f, m] = await Promise.all([
        apiGetFamily(baseUrl, token),
        apiFamilyMembers(baseUrl, token).catch(() => ({ members: [] as FamilyMember[] })),
      ]);
      setFamily(f.family);
      setMembers(m.members);
      // 同步自己的资料到编辑态
      const me = m.members.find((x) => x.id === currentUserId);
      if (me) {
        setProfileName(me.displayName);
        setProfileEmoji(me.avatarEmoji || '🙂');
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : '加载失败');
    }
  };

  // 创建家庭
  const createFamily = async () => {
    if (!name.trim()) {
      hapticError();
      onError('请输入家庭名称');
      return;
    }
    setBusy(true);
    try {
      const { apiCreateFamily } = await import('../sync/apiClient');
      await apiCreateFamily(baseUrl, token, name.trim());
      hapticLight();
      onFamilyChanged();
      reload();
    } catch (e) {
      hapticError();
      onError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };

  // 邀请码加入
  const joinFamily = async () => {
    const code = inviteCode.trim().toUpperCase();
    if (code.length !== 6) {
      hapticError();
      onError('请输入 6 位邀请码');
      return;
    }
    setBusy(true);
    try {
      const { apiJoinFamily } = await import('../sync/apiClient');
      await apiJoinFamily(baseUrl, token, code);
      hapticLight();
      onFamilyChanged();
      reload();
    } catch (e) {
      hapticError();
      onError(e instanceof Error ? e.message : '加入失败');
    } finally {
      setBusy(false);
    }
  };

  // 重置邀请码
  const regenerate = async () => {
    Alert.alert('重置邀请码', '旧邀请码将失效，确定重置？', [
      { text: '取消', style: 'cancel' },
      {
        text: '重置',
        style: 'destructive',
        onPress: async () => {
          try {
            const { apiRegenerateInvite } = await import('../sync/apiClient');
            const res = await apiRegenerateInvite(baseUrl, token);
            hapticLight();
            setFamily((prev) => (prev ? { ...prev, inviteCode: res.inviteCode } : prev));
          } catch (e) {
            onError(e instanceof Error ? e.message : '重置失败');
          }
        },
      },
    ]);
  };

  // 退出/解散家庭
  const leaveFamily = () => {
    Alert.alert(
      isOwner ? '解散家庭' : '退出家庭',
      isOwner
        ? '你是唯一成员，解散后账本数据将从服务器删除（本地保留）。确定？'
        : '退出后不再同步该家庭账本（历史记录保留在家庭中）。确定？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: isOwner ? '解散' : '退出',
          style: 'destructive',
          onPress: async () => {
            try {
              const { apiLeaveFamily } = await import('../sync/apiClient');
              await apiLeaveFamily(baseUrl, token);
              hapticLight();
              onFamilyChanged();
              setFamily(null);
              setMembers([]);
            } catch (e) {
              onError(e instanceof Error ? e.message : '操作失败');
            }
          },
        },
      ]
    );
  };

  // owner 移除成员（v0.5；不可移除自己）
  const removeMember = (m: FamilyMember) => {
    Alert.alert(
      '移除成员',
      `确定将「${m.displayName}」移出家庭？其历史记录保留在账本中。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '移除',
          style: 'destructive',
          onPress: async () => {
            try {
              const { apiRemoveMember } = await import('../sync/apiClient');
              await apiRemoveMember(baseUrl, token, m.id);
              hapticLight();
              reload();
            } catch (e) {
              hapticError();
              onError(e instanceof Error ? e.message : '移除失败');
            }
          },
        },
      ]
    );
  };

  // 修改自己的昵称/头像（v0.5）
  const saveProfile = async () => {
    const trimmed = profileName.trim();
    if (!trimmed) {
      hapticError();
      onError('昵称不能为空');
      return;
    }
    setBusy(true);
    try {
      const { apiUpdateMe } = await import('../sync/apiClient');
      await apiUpdateMe(baseUrl, token, { displayName: trimmed, avatarEmoji: profileEmoji });
      hapticLight();
      setEditingProfile(false);
      reload();
      onFamilyChanged();
    } catch (e) {
      hapticError();
      onError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} title="家庭账本" onClose={onClose}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {family ? (
          <>
            {/* 家庭信息 */}
            <View style={styles.formGroup}>
              <Text style={styles.familyName}>🏠 {family.name}</Text>
              <Pressable style={styles.inviteRow} onPress={() => {
                // 复制邀请码（长按复制体验的轻量替代：点击提示）
                Alert.alert('邀请码', `把邀请码告诉家人：${family.inviteCode}`);
              }}>
                <Text style={styles.inviteLabel}>邀请码</Text>
                <Text style={styles.inviteCode}>{family.inviteCode}</Text>
              </Pressable>
              {isOwner ? (
                <Pressable onPress={regenerate} hitSlop={8}>
                  <Text style={styles.linkText}>重置邀请码</Text>
                </Pressable>
              ) : null}
            </View>

            {/* 成员列表 */}
            <View style={styles.formGroup}>
              <Text style={styles.fieldLabel}>成员（{members.length}）</Text>
              {members.map((m) => (
                <View key={m.id} style={styles.memberRow}>
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberEmoji}>{m.avatarEmoji}</Text>
                  </View>
                  <Text style={styles.memberName}>{m.displayName}</Text>
                  <View style={[styles.roleBadge, m.role === 'owner' && styles.roleBadgeOwner]}>
                    <Text style={styles.roleText}>{m.role === 'owner' ? '创建者' : '成员'}</Text>
                  </View>
                  {/* owner 可移除其他成员（v0.5） */}
                  {isOwner && m.id !== currentUserId ? (
                    <Pressable
                      style={styles.removeBtn}
                      onPress={() => removeMember(m)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={`移除成员${m.displayName}`}
                    >
                      <Text style={styles.removeText}>移除</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}

              {/* 修改自己的资料（v0.5） */}
              {editingProfile ? (
                <View style={styles.profileEdit}>
                  <Text style={styles.fieldLabel}>我的昵称</Text>
                  <TextInput
                    style={styles.inlineInputFull}
                    value={profileName}
                    onChangeText={setProfileName}
                    maxLength={12}
                    placeholder="昵称（最多 12 字）"
                    placeholderTextColor={COLORS.textTertiary}
                  />
                  <Text style={[styles.fieldLabel, { marginTop: SPACING.sm }]}>我的头像</Text>
                  <View style={styles.avatarGrid}>
                    {AVATARS.map((a) => (
                      <Pressable
                        key={a}
                        style={[styles.avatarCell, profileEmoji === a && styles.avatarCellActive]}
                        onPress={() => { setProfileEmoji(a); hapticLight(); }}
                        accessibilityRole="button"
                        accessibilityLabel={`选择头像${a}`}
                        accessibilityState={{ selected: profileEmoji === a }}
                      >
                        <Text style={styles.avatarCellEmoji}>{a}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <View style={styles.profileBtnRow}>
                    <Pressable style={styles.cancelBtn} onPress={() => setEditingProfile(false)}>
                      <Text style={styles.cancelText}>取消</Text>
                    </Pressable>
                    <Pressable style={[styles.inlineBtn, busy && styles.btnDisabled]} onPress={saveProfile} disabled={busy}>
                      <Text style={styles.inlineBtnText}>保存</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable onPress={() => setEditingProfile(true)} hitSlop={8}>
                  <Text style={styles.linkText}>✏️ 修改我的昵称 / 头像</Text>
                </Pressable>
              )}
            </View>

            <Pressable style={[styles.leaveBtn]} onPress={leaveFamily}>
              <Text style={styles.leaveText}>{isOwner ? '解散家庭' : '退出家庭'}</Text>
            </Pressable>
          </>
        ) : (
          <>
            {/* 创建家庭 */}
            <View style={styles.formGroup}>
              <Text style={styles.fieldLabel}>创建新家庭（你是创建者）</Text>
              <View style={styles.inlineRow}>
                <TextInput
                  style={styles.inlineInput}
                  placeholder="家庭名称，如 我们家"
                  placeholderTextColor={COLORS.textTertiary}
                  value={name}
                  onChangeText={setName}
                  maxLength={20}
                />
                <Pressable style={[styles.inlineBtn, busy && styles.btnDisabled]} onPress={createFamily} disabled={busy}>
                  <Text style={styles.inlineBtnText}>创建</Text>
                </Pressable>
              </View>
            </View>

            {/* 邀请码加入 */}
            <View style={styles.formGroup}>
              <Text style={styles.fieldLabel}>或用家人分享的邀请码加入</Text>
              <View style={styles.inlineRow}>
                <TextInput
                  style={styles.inlineInput}
                  placeholder="6 位邀请码"
                  placeholderTextColor={COLORS.textTertiary}
                  value={inviteCode}
                  onChangeText={(t) => setInviteCode(t.toUpperCase())}
                  maxLength={6}
                  autoCapitalize="characters"
                />
                <Pressable style={[styles.inlineBtn, busy && styles.btnDisabled]} onPress={joinFamily} disabled={busy}>
                  <Text style={styles.inlineBtnText}>加入</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  formGroup: {
    marginBottom: SPACING.md,
  },
  fieldLabel: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    fontWeight: '600',
    marginBottom: 6,
  },
  familyName: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '800',
    color: COLORS.text,
    marginBottom: SPACING.sm,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    marginBottom: SPACING.xs,
  },
  inviteLabel: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textSecondary,
  },
  inviteCode: {
    fontSize: FONT_SIZE.xxl,
    fontWeight: '800',
    color: COLORS.accentDark,
    letterSpacing: 4,
  },
  linkText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.accentDark,
    fontWeight: '600',
    marginTop: SPACING.xs,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs + 2,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberEmoji: {
    fontSize: FONT_SIZE.lg - 1,
  },
  memberName: {
    flex: 1,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    fontWeight: '600',
  },
  roleBadge: {
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.bgAlt,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  roleBadgeOwner: {
    backgroundColor: COLORS.warningBg,
  },
  roleText: {
    fontSize: FONT_SIZE.xs - 1,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  inlineRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  inlineInput: {
    flex: 1,
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
  },
  inlineBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.lg,
    justifyContent: 'center',
  },
  inlineBtnText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
  // ===== 成员管理（v0.5） =====
  removeBtn: {
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: COLORS.danger,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  removeText: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.danger,
    fontWeight: '700',
  },
  profileEdit: {
    marginTop: SPACING.sm,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
  },
  inlineInputFull: {
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
  },
  avatarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  avatarCell: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarCellActive: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.surface,
  },
  avatarCellEmoji: {
    fontSize: FONT_SIZE.lg,
  },
  profileBtnRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  leaveBtn: {
    borderRadius: RADIUS.lg,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.danger,
    marginTop: SPACING.xs,
    marginBottom: SPACING.md,
  },
  leaveText: {
    color: COLORS.danger,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
});
