import React, { useCallback, useEffect, useState } from 'react';
import { Alert, DeviceEventEmitter, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { CATEGORY_COLORS, COLORS, LEDGER_EVENTS } from '../../constants';
import {
  addCustomCategory, deleteCustomCategory, getCustomCategories as getCustomCategoriesDB, setCustomCategoriesCache,
} from '../../database/ledgerDB';
import { hapticError, hapticSuccess } from '../../utils/haptics';
import { useToast } from '../../hooks/useToast';
import Modal from '../../components/Modal';
import Toast from '../../components/Toast';
import type { CustomCategory, RecordType } from '../../types';
import { manageStyles as styles } from './sharedStyles';

// 自定义分类二级页（v0.5.9 从 ManageScreen 拆分；顶栏返回按钮由外层 ManageScreen 统一渲染）
export default function CategoriesScreen() {
  const [customCategories, setCustomCategoriesState] = useState<CustomCategory[]>([]);
  const [categoryModal, setCategoryModal] = useState(false);

  const { toast, showToast, hideToast } = useToast();

  const reload = useCallback(async () => {
    try {
      const cats = await getCustomCategoriesDB();
      setCustomCategoriesState(cats);
    } catch {
      showToast('分类数据加载失败', 'error');
    }
  }, [showToast]);

  // 挂载时加载
  useEffect(() => {
    reload();
  }, [reload]);

  // 导入数据或其他页面增删分类后刷新列表
  useEffect(() => {
    const subs = [
      DeviceEventEmitter.addListener(LEDGER_EVENTS.DATA_IMPORTED, reload),
      DeviceEventEmitter.addListener(LEDGER_EVENTS.CATEGORIES_CHANGED, reload),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [reload]);

  // ===== 自定义分类操作（照搬 ManageScreen） =====
  const handleAddCategory = useCallback(async (label: string, emoji: string, color: string, type: RecordType) => {
    if (!label.trim()) {
      hapticError();
      showToast('请输入分类名称', 'error');
      return;
    }
    try {
      const key = `custom_${Date.now()}`;
      await addCustomCategory({ key, label: label.trim(), emoji: emoji || '📌', color, type });
      await setCustomCategoriesCache();
      hapticSuccess();
      showToast('分类已添加');
      setCategoryModal(false);
      await reload();
      DeviceEventEmitter.emit(LEDGER_EVENTS.CATEGORIES_CHANGED);
    } catch {
      hapticError();
      showToast('添加失败', 'error');
    }
  }, [reload, showToast]);

  const handleDeleteCategory = useCallback((cat: CustomCategory) => {
    Alert.alert('删除分类', `删除「${cat.label}」？已使用该分类的记录不受影响。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCustomCategory(cat.key);
            await setCustomCategoriesCache();
            hapticSuccess();
            await reload();
            DeviceEventEmitter.emit(LEDGER_EVENTS.CATEGORIES_CHANGED);
          } catch {
            hapticError();
          }
        },
      },
    ]);
  }, [reload]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* ===== 分类管理 ===== */}
      <Text style={styles.sectionTitle}>自定义分类</Text>
      <View style={styles.card}>
        {customCategories.length === 0 ? (
          <Text style={styles.emptyText}>还没有自定义分类</Text>
        ) : (
          customCategories.map((cat) => (
            <View key={cat.key} style={styles.catRow}>
              <View style={[styles.accIcon, { backgroundColor: `${cat.color}22` }]}>
                <Text style={styles.accEmoji}>{cat.emoji}</Text>
              </View>
              <Text style={styles.accName}>{cat.label}</Text>
              <Text style={styles.accType}>{cat.type === 'expense' ? '支出' : '收入'}</Text>
              <Pressable onPress={() => handleDeleteCategory(cat)} hitSlop={8}>
                <Text style={styles.accDeleteText}>✕</Text>
              </Pressable>
            </View>
          ))
        )}
        <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.accent }]} onPress={() => setCategoryModal(true)}>
          <Text style={styles.actionBtnText}>＋ 添加分类</Text>
        </Pressable>
      </View>

      {/* ===== 弹窗：自定义分类 ===== */}
      <CategoryModal
        visible={categoryModal}
        onClose={() => setCategoryModal(false)}
        onSubmit={handleAddCategory}
      />

      <Toast toast={toast} onHide={hideToast} />
    </ScrollView>
  );
}

// ===== 自定义分类弹窗（从 ManageScreen 迁移） =====
function CategoryModal({ visible, onClose, onSubmit }: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (label: string, emoji: string, color: string, type: RecordType) => void;
}) {
  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('📌');
  const [color, setColor] = useState(COLORS.accent);
  const [type, setType] = useState<RecordType>('expense');

  useEffect(() => {
    if (visible) {
      setLabel('');
      setEmoji('📌');
      setColor(COLORS.accent);
      setType('expense');
    }
  }, [visible]);

  return (
    <Modal visible={visible} title="添加自定义分类" onClose={onClose}>
      <ScrollView
        style={styles.modalScroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"  // 键盘弹出时仍可点击保存按钮（v0.5.8）
      >
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>名称</Text>
          <TextInput
            style={styles.input}
            placeholder="如 宠物 / 旅行"
            placeholderTextColor={COLORS.textTertiary}
            value={label}
            onChangeText={setLabel}
            maxLength={6}
          />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>表情图标</Text>
          <TextInput
            style={styles.input}
            placeholder="如 🐱 ✈️ 🎁"
            placeholderTextColor={COLORS.textTertiary}
            value={emoji}
            onChangeText={setEmoji}
            maxLength={4}
          />
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>归属</Text>
          <View style={styles.typeSwitch}>
            {(['expense', 'income'] as RecordType[]).map((t) => (
              <Pressable
                key={t}
                style={[styles.typeBtn, type === t && (t === 'expense' ? styles.typeBtnExpense : styles.typeBtnIncome)]}
                onPress={() => setType(t)}
              >
                <Text style={[styles.typeText, type === t && styles.typeTextActive]}>
                  {t === 'expense' ? '支出' : '收入'}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>颜色</Text>
          <View style={styles.colorRow}>
            {CATEGORY_COLORS.map((c) => (
              <Pressable
                key={c}
                style={[styles.colorDot, { backgroundColor: c }, color === c && styles.colorDotOn]}
                onPress={() => setColor(c)}
              />
            ))}
          </View>
        </View>
        <Pressable style={[styles.submitBtn, { backgroundColor: COLORS.accent }]} onPress={() => onSubmit(label, emoji, color, type)}>
          <Text style={styles.submitText}>保存</Text>
        </Pressable>
      </ScrollView>
    </Modal>
  );
}
