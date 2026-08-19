import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { COLORS, FONT_SIZE, RADIUS, SPACING } from '../constants';
import Modal from './Modal';
import { hapticError, hapticLight } from '../utils/haptics';

interface Props {
  visible: boolean;
  baseUrl: string; // 已填的服务器地址（注册成功后写设置）
  onClose: () => void;
  onAuthed: (token: string, user: { id: number; displayName: string; avatarEmoji: string; familyId: number | null }) => void;
  onError: (msg: string) => void;
}

// 登录 / 注册弹窗（注册成功自动登录）
export default function LoginModal({ visible, baseUrl, onClose, onAuthed, onError }: Props) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setUsername('');
      setPassword('');
      setConfirm('');
      setDisplayName('');
      setBusy(false);
    }
  }, [visible]);

  const submit = async () => {
    if (!username.trim() || !password) {
      hapticError();
      onError('请输入用户名和密码');
      return;
    }
    if (mode === 'register') {
      if (password.length < 6) {
        hapticError();
        onError('密码至少 6 位');
        return;
      }
      if (password !== confirm) {
        hapticError();
        onError('两次输入的密码不一致');
        return;
      }
    }
    setBusy(true);
    try {
      const { apiRegister, apiLogin } = await import('../sync/apiClient');
      const res = mode === 'register'
        ? await apiRegister(baseUrl, username.trim(), password, displayName.trim() || undefined)
        : await apiLogin(baseUrl, username.trim(), password);
      hapticLight();
      onAuthed(res.token, res.user);
    } catch (e) {
      hapticError();
      onError(e instanceof Error ? e.message : '登录失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} title={mode === 'login' ? '登录' : '注册'} fullscreen saveLabel={mode === 'login' ? '登录' : '注册并登录'} onSave={submit} saveDisabled={busy} onClose={onClose}>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>用户名（中英文/数字/下划线）</Text>
          <TextInput
            style={styles.input}
            placeholder="如 dad / 妈妈"
            placeholderTextColor={COLORS.textTertiary}
            value={username}
            onChangeText={setUsername}
            maxLength={20}
            autoCapitalize="none"
          />
        </View>
        {mode === 'register' ? (
          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>昵称（家庭成员列表中显示）</Text>
            <TextInput
              style={styles.input}
              placeholder="如 爸爸"
              placeholderTextColor={COLORS.textTertiary}
              value={displayName}
              onChangeText={setDisplayName}
              maxLength={12}
            />
          </View>
        ) : null}
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>密码</Text>
          <TextInput
            style={styles.input}
            placeholder="至少 6 位"
            placeholderTextColor={COLORS.textTertiary}
            value={password}
            onChangeText={setPassword}
            maxLength={64}
            secureTextEntry
          />
        </View>
        {mode === 'register' ? (
          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>确认密码</Text>
            <TextInput
              style={styles.input}
              placeholder="再输入一次"
              placeholderTextColor={COLORS.textTertiary}
              value={confirm}
              onChangeText={setConfirm}
              maxLength={64}
              secureTextEntry
            />
          </View>
        ) : null}
        <Pressable style={styles.switchRow} onPress={() => setMode(mode === 'login' ? 'register' : 'login')}>
          <Text style={styles.switchText}>
            {mode === 'login' ? '没有账号？注册一个' : '已有账号？直接登录'}
          </Text>
        </Pressable>
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
  input: {
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
  },
  submitBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.lg,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    letterSpacing: 1,
  },
  switchRow: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
  },
  switchText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.accentDark,
    fontWeight: '600',
  },
});
