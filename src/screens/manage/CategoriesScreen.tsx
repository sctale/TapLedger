import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, DeviceEventEmitter, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import {
  CATEGORY_COLORS, CATEGORY_ICONS, COLORS, EXPENSE_CATEGORIES, FONT_SIZE, INCOME_CATEGORIES, LEDGER_EVENTS, RADIUS, SPACING,
  ensureFullCategoryConfig, setCategoryConfig,
} from '../../constants';
import {
  addCustomCategory, deleteCustomCategory, getCategoryConfig as getCategoryConfigDB,
  getCustomCategories as getCustomCategoriesDB, saveCategoryConfig as saveCategoryConfigDB,
  setCustomCategoriesCache, updateCustomCategory,
} from '../../database/ledgerDB';
import { hapticError, hapticSuccess } from '../../utils/haptics';
import { useToast } from '../../hooks/useToast';
import Modal from '../../components/Modal';
import Toast from '../../components/Toast';
import type { CategoryConfig, CategoryDef, CustomCategory, RecordType } from '../../types';
import { manageStyles as styles } from './sharedStyles';

interface DisplayItem {
  def: CategoryDef;
  type: RecordType;
  isCustom: boolean;
  visible: boolean;
}

type ViewMode = 'list' | 'add' | 'edit';

// 分类管理二级页（v0.6.0 支持显隐与排序；v0.6.x 全屏添加/编辑）
export default function CategoriesScreen() {
  const [customCategories, setCustomCategoriesState] = useState<CustomCategory[]>([]);
  const [categoryConfig, setCategoryConfigState] = useState<CategoryConfig | null>(null);
  const [view, setView] = useState<ViewMode>('list');
  const [editingCategory, setEditingCategory] = useState<CustomCategory | null>(null);

  const { toast, showToast, hideToast } = useToast();

  const fullConfig = useMemo(
    () => ensureFullCategoryConfig(customCategories, categoryConfig),
    [customCategories, categoryConfig]
  );

  const displayGroups = useMemo(() => {
    const build = (type: RecordType): DisplayItem[] => {
      const builtin = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
      const typeCustom = customCategories.filter((c) => c.type === type);
      const customMap = new Map(typeCustom.map((c) => [c.key, c]));
      const items = type === 'expense' ? fullConfig.expense : fullConfig.income;
      return items.map((item) => {
        const isCustom = customMap.has(item.key);
        const def = isCustom
          ? { key: customMap.get(item.key)!.key, label: customMap.get(item.key)!.label, emoji: customMap.get(item.key)!.emoji, color: customMap.get(item.key)!.color }
          : builtin.find((c) => c.key === item.key)!;
        return { def, type, isCustom, visible: item.visible };
      });
    };
    return { expense: build('expense'), income: build('income') };
  }, [customCategories, fullConfig]);

  const persistConfig = useCallback(async (next: CategoryConfig) => {
    await saveCategoryConfigDB(next);
    setCategoryConfig(next);
    setCategoryConfigState(next);
    await setCustomCategoriesCache();
    DeviceEventEmitter.emit(LEDGER_EVENTS.CATEGORIES_CHANGED);
  }, []);

  const reload = useCallback(async () => {
    try {
      const [cats, cfg] = await Promise.all([getCustomCategoriesDB(), getCategoryConfigDB()]);
      const nextCfg = ensureFullCategoryConfig(cats, cfg);
      const cfgChanged = JSON.stringify(nextCfg) !== JSON.stringify(cfg);
      if (cfgChanged) {
        await saveCategoryConfigDB(nextCfg);
      }
      await setCustomCategoriesCache();
      setCategoryConfig(nextCfg);
      setCustomCategoriesState(cats);
      setCategoryConfigState(nextCfg);
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

  // ===== 显隐切换 =====
  const handleToggleVisible = useCallback(async (type: RecordType, key: string) => {
    const next = {
      expense: fullConfig.expense.map((i) => ({ ...i })),
      income: fullConfig.income.map((i) => ({ ...i })),
    };
    const list = type === 'expense' ? next.expense : next.income;
    const idx = list.findIndex((i) => i.key === key);
    if (idx >= 0) {
      list[idx] = { ...list[idx], visible: !list[idx].visible };
      await persistConfig(next);
    }
  }, [fullConfig, persistConfig]);

  // ===== 排序 =====
  const handleMove = useCallback(async (type: RecordType, key: string, direction: -1 | 1) => {
    const next = {
      expense: fullConfig.expense.map((i) => ({ ...i })),
      income: fullConfig.income.map((i) => ({ ...i })),
    };
    const list = type === 'expense' ? next.expense : next.income;
    const idx = list.findIndex((i) => i.key === key);
    const newIdx = idx + direction;
    if (idx >= 0 && newIdx >= 0 && newIdx < list.length) {
      [list[idx], list[newIdx]] = [list[newIdx], list[idx]];
      await persistConfig(next);
    }
  }, [fullConfig, persistConfig]);

  // ===== 自定义分类操作 =====
  const handleAddCategory = useCallback(async (label: string, emoji: string, color: string, type: RecordType) => {
    if (!label.trim()) {
      hapticError();
      showToast('请输入分类名称', 'error');
      return false;
    }
    try {
      const key = `custom_${Date.now()}`;
      await addCustomCategory({ key, label: label.trim(), emoji: emoji || '📌', color, type });
      await setCustomCategoriesCache();
      hapticSuccess();
      showToast('分类已添加');
      DeviceEventEmitter.emit(LEDGER_EVENTS.CATEGORIES_CHANGED);
      await reload();
      return true;
    } catch {
      hapticError();
      showToast('添加失败', 'error');
      return false;
    }
  }, [reload, showToast]);

  const handleUpdateCategory = useCallback(async (
    original: CustomCategory,
    label: string,
    emoji: string,
    color: string,
    type: RecordType
  ) => {
    if (!label.trim()) {
      hapticError();
      showToast('请输入分类名称', 'error');
      return false;
    }
    try {
      await updateCustomCategory({ key: original.key, label: label.trim(), emoji: emoji || '📌', color, type });

      if (type !== original.type && categoryConfig) {
        const next: CategoryConfig = {
          expense: categoryConfig.expense.filter((i) => i.key !== original.key).map((i) => ({ ...i })),
          income: categoryConfig.income.filter((i) => i.key !== original.key).map((i) => ({ ...i })),
        };
        next[type].push({ key: original.key, visible: true });
        await saveCategoryConfigDB(next);
        setCategoryConfig(next);
        setCategoryConfigState(next);
      }

      await setCustomCategoriesCache();
      hapticSuccess();
      showToast('分类已更新');
      DeviceEventEmitter.emit(LEDGER_EVENTS.CATEGORIES_CHANGED);
      await reload();
      return true;
    } catch {
      hapticError();
      showToast('更新失败', 'error');
      return false;
    }
  }, [categoryConfig, reload, showToast]);

  const handleDeleteCategory = useCallback((cat: CustomCategory) => {
    Alert.alert('删除分类', `删除「${cat.label}」？已使用该分类的记录不受影响。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCustomCategory(cat.key);
            const nextCfg = categoryConfig
              ? {
                  expense: categoryConfig.expense.filter((i) => i.key !== cat.key),
                  income: categoryConfig.income.filter((i) => i.key !== cat.key),
                }
              : null;
            if (nextCfg) {
              await saveCategoryConfigDB(nextCfg);
              setCategoryConfig(nextCfg);
              setCategoryConfigState(nextCfg);
            }
            await setCustomCategoriesCache();
            hapticSuccess();
            DeviceEventEmitter.emit(LEDGER_EVENTS.CATEGORIES_CHANGED);
            await reload();
          } catch {
            hapticError();
          }
        },
      },
    ]);
  }, [categoryConfig, reload]);

  const openAdd = useCallback(() => {
    setEditingCategory(null);
    setView('add');
  }, []);

  const openEdit = useCallback((cat: CustomCategory) => {
    setEditingCategory(cat);
    setView('edit');
  }, []);

  const closeForm = useCallback(() => {
    setView('list');
    setEditingCategory(null);
  }, []);

  const renderGroup = (title: string, type: RecordType, items: DisplayItem[]) => (
    <>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        {items.length === 0 ? (
          <Text style={styles.emptyText}>暂无分类</Text>
        ) : (
          items.map((item, idx) => (
            <View
              key={item.def.key}
              style={[localStyles.catRow, !item.visible && localStyles.catRowHidden]}
            >
              <View style={[styles.accIcon, { backgroundColor: `${item.def.color}22` }]}>
                <Text style={styles.accEmoji}>{item.def.emoji}</Text>
              </View>
              <View style={localStyles.catInfo}>
                <Text style={styles.accName}>{item.def.label}</Text>
                <Text style={styles.accType}>
                  {item.isCustom ? '自定义' : '内置'} · {item.visible ? '显示' : '隐藏'}
                </Text>
              </View>
              <View style={localStyles.catActions}>
                <Pressable
                  onPress={() => handleMove(type, item.def.key, -1)}
                  disabled={idx === 0}
                  style={[localStyles.sortBtn, idx === 0 && localStyles.sortBtnDisabled]}
                  hitSlop={4}
                >
                  <Text style={localStyles.sortBtnText}>↑</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleMove(type, item.def.key, 1)}
                  disabled={idx === items.length - 1}
                  style={[localStyles.sortBtn, idx === items.length - 1 && localStyles.sortBtnDisabled]}
                  hitSlop={4}
                >
                  <Text style={localStyles.sortBtnText}>↓</Text>
                </Pressable>
                <Switch
                  value={item.visible}
                  onValueChange={() => handleToggleVisible(type, item.def.key)}
                  trackColor={{ false: COLORS.border, true: `${COLORS.accent}88` }}
                  thumbColor={item.visible ? COLORS.accent : COLORS.textTertiary}
                />
                {item.isCustom && (
                  <>
                    <Pressable
                      onPress={() => openEdit(customCategories.find((c) => c.key === item.def.key)!)}
                      hitSlop={8}
                    >
                      <Text style={localStyles.editText}>编辑</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleDeleteCategory(customCategories.find((c) => c.key === item.def.key)!)}
                      hitSlop={8}
                    >
                      <Text style={styles.accDeleteText}>✕</Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          ))
        )}
      </View>
    </>
  );

  return (
    <View style={localStyles.container}>
      {view === 'list' ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ===== 分类管理 ===== */}
          <Text style={styles.sectionTitle}>分类管理</Text>

          {renderGroup('支出分类', 'expense', displayGroups.expense)}
          {renderGroup('收入分类', 'income', displayGroups.income)}

          <Pressable style={[styles.actionBtn, { backgroundColor: COLORS.accent }]} onPress={openAdd}>
            <Text style={styles.actionBtnText}>＋ 添加分类</Text>
          </Pressable>

          <Toast toast={toast} onHide={hideToast} />
        </ScrollView>
      ) : (
        <CategoryForm
          mode={view}
          editingCategory={editingCategory}
          onClose={closeForm}
          onAdd={handleAddCategory}
          onUpdate={handleUpdateCategory}
        />
      )}
    </View>
  );
}

// ===== 全屏添加/编辑分类表单 =====
function CategoryForm({
  mode,
  editingCategory,
  onClose,
  onAdd,
  onUpdate,
}: {
  mode: 'add' | 'edit';
  editingCategory: CustomCategory | null;
  onClose: () => void;
  onAdd: (label: string, emoji: string, color: string, type: RecordType) => Promise<boolean>;
  onUpdate: (
    original: CustomCategory,
    label: string,
    emoji: string,
    color: string,
    type: RecordType
  ) => Promise<boolean>;
}) {
  const [label, setLabel] = useState('');
  const [emoji, setEmoji] = useState('📌');
  const [color, setColor] = useState(COLORS.accent);
  const [type, setType] = useState<RecordType>('expense');
  const [loading, setLoading] = useState(false);
  // 图标选择弹窗：表单内仅显示单行预览框，点击后全屏弹出宫格选择
  const [iconPickerVisible, setIconPickerVisible] = useState(false);

  useEffect(() => {
    if (mode === 'edit' && editingCategory) {
      setLabel(editingCategory.label);
      setEmoji(editingCategory.emoji);
      setColor(editingCategory.color);
      setType(editingCategory.type);
    } else {
      setLabel('');
      setEmoji('📌');
      setColor(COLORS.accent);
      setType('expense');
    }
  }, [mode, editingCategory]);

  const submit = async () => {
    if (loading) return;
    setLoading(true);
    try {
      let ok: boolean;
      if (mode === 'edit' && editingCategory) {
        ok = await onUpdate(editingCategory, label, emoji, color, type);
      } else {
        ok = await onAdd(label, emoji, color, type);
      }
      if (ok) {
        onClose();
      }
    } finally {
      setLoading(false);
    }
  };

  const title = mode === 'add' ? '添加分类' : '编辑分类';

  return (
    <View style={localStyles.formContainer}>
      <View style={localStyles.navBar}>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={localStyles.navCancel}>取消</Text>
        </Pressable>
        <Text style={localStyles.navTitle}>{title}</Text>
        <Pressable onPress={submit} disabled={loading} hitSlop={8}>
          <Text style={[localStyles.navSave, loading && localStyles.navSaveDisabled]}>保存</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={localStyles.kavContainer}
      >
        <ScrollView
          style={localStyles.formScroll}
          contentContainerStyle={localStyles.formContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
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
              autoFocus
              returnKeyType="done"
              blurOnSubmit
            />
          </View>
          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>图标</Text>
            {/* 单行预览框：点击后全屏弹出选择 */}
            <Pressable
              style={localStyles.previewBox}
              onPress={() => setIconPickerVisible(true)}
              accessibilityRole="button"
              accessibilityLabel="选择图标"
            >
              <View style={[styles.accIcon, { backgroundColor: `${color}22` }]}>
                <Text style={styles.accEmoji}>{emoji || '🗂️'}</Text>
              </View>
              <Text style={localStyles.previewText}>点击选择图标</Text>
            </Pressable>
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

          <Pressable
            style={[styles.submitBtn, { backgroundColor: COLORS.accent }, loading && localStyles.submitBtnDisabled]}
            onPress={submit}
            disabled={loading}
          >
            <Text style={styles.submitText}>保存</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* 全屏图标选择弹窗 */}
      <IconPickerModal
        visible={iconPickerVisible}
        currentEmoji={emoji}
        onCancel={() => setIconPickerVisible(false)}
        onConfirm={(ic) => {
          setEmoji(ic);
          setIconPickerVisible(false);
        }}
      />
    </View>
  );
}

// ===== 全屏图标选择弹窗：平铺预设宫格 + 自定义输入 =====
function IconPickerModal({
  visible,
  currentEmoji,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  currentEmoji: string;
  onCancel: () => void;
  onConfirm: (emoji: string) => void;
}) {
  const [draft, setDraft] = useState(currentEmoji);

  // 每次打开时同步当前选中图标到草稿
  useEffect(() => {
    if (visible) setDraft(currentEmoji);
  }, [visible, currentEmoji]);

  return (
    <Modal
      visible={visible}
      title="选择图标"
      fullscreen
      onClose={onCancel}
      saveLabel="完成"
      onSave={() => onConfirm(draft || '📌')}
    >
      <View style={localStyles.pickerGroup}>
        <Text style={localStyles.pickerGroupTitle}>常用</Text>
        <View style={localStyles.iconGrid}>
          {CATEGORY_ICONS.map((ic) => (
            <Pressable
              key={ic}
              style={[localStyles.iconCell, draft === ic && localStyles.iconCellOn]}
              onPress={() => setDraft(ic)}
              accessibilityRole="button"
              accessibilityLabel={`选择图标${ic}`}
              accessibilityState={{ selected: draft === ic }}
            >
              <Text style={localStyles.iconCellEmoji}>{ic}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* 自定义 emoji 输入（保留原替换/去空格/截断逻辑） */}
      <View style={localStyles.pickerGroup}>
        <Text style={localStyles.pickerGroupTitle}>自定义</Text>
        <TextInput
          style={styles.input}
          placeholder="输入自定义图标，如 🚀"
          placeholderTextColor={COLORS.textTertiary}
          value={draft}
          onChangeText={(t) => setDraft(t.replace(/\s+/g, '').slice(0, 4))}
          maxLength={4}
          returnKeyType="done"
        />
      </View>
    </Modal>
  );
}

const localStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  catRowHidden: {
    opacity: 0.55,
  },
  catInfo: {
    flex: 1,
  },
  catActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  sortBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: COLORS.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sortBtnDisabled: {
    opacity: 0.35,
  },
  sortBtnText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '700',
  },
  editText: {
    fontSize: 13,
    color: COLORS.accent,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  // 预设图标选择
  previewBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  previewText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  iconCell: {
    width: 46,
    height: 46,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  iconCellOn: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.surfaceAlt,
  },
  iconCellEmoji: {
    fontSize: FONT_SIZE.lg,
  },
  // 全屏表单
  formContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  navBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
  },
  navCancel: {
    fontSize: 16,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  navTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
  },
  navSave: {
    fontSize: 16,
    color: COLORS.accent,
    fontWeight: '700',
  },
  navSaveDisabled: {
    opacity: 0.5,
  },
  kavContainer: {
    flex: 1,
  },
  formScroll: {
    flex: 1,
  },
  formContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  submitBtnDisabled: {
    opacity: 0.7,
  },
  // 图标选择弹窗分组
  pickerGroup: {
    marginBottom: SPACING.lg,
  },
  pickerGroupTitle: {
    fontSize: FONT_SIZE.xs + 1,
    fontWeight: '700',
    color: COLORS.textTertiary,
    marginBottom: SPACING.sm,
  },
});
