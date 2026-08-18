import { StyleSheet } from 'react-native';
import { COLORS, FONT_SIZE, RADIUS, SPACING } from '../../constants';

// 管理页二级页面共用样式（从 ManageScreen.tsx 抽取，键名与原 styles 保持一致，v0.5.9）
// 各二级页面：import { manageStyles as styles } from './sharedStyles'
export const manageStyles = StyleSheet.create({
  // ===== 页面骨架 =====
  scroll: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  sectionTitle: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    gap: SPACING.sm + 2,
  },
  // ===== 通用文本 =====
  label: {
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    fontWeight: '600',
  },
  hint: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    lineHeight: 17,
  },
  emptyText: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.textTertiary,
    paddingVertical: SPACING.xs,
  },
  // ===== 列表行（账户/规则/分类通用） =====
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  accIcon: {
    width: 36,
    height: 36,
    borderRadius: RADIUS.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accEmoji: {
    fontSize: FONT_SIZE.lg - 1,
  },
  accInfo: {
    flex: 1,
  },
  accName: {
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
    fontWeight: '600',
  },
  accType: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  accBalance: {
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
  accDelete: {
    width: 26,
    height: 26,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.bgAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accDeleteText: {
    fontSize: FONT_SIZE.xs + 1,
    color: COLORS.textTertiary,
    fontWeight: '600',
    padding: 4,
  },
  // ===== 按钮行 =====
  btnRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.xs,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: RADIUS.md,
    alignItems: 'center',
  },
  actionBtnText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
  },
  // ===== 输入 =====
  inputRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  input: {
    flex: 1,
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: 10,
    fontSize: FONT_SIZE.md,
    color: COLORS.text,
  },
  primaryBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.lg,
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
  },
  // ===== 报销 =====
  reimburseHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  reimburseTotal: {
    fontSize: FONT_SIZE.lg,
    fontWeight: '800',
    color: COLORS.text,
  },
  reimburseCount: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    marginTop: 1,
  },
  reimburseBtn: {
    backgroundColor: COLORS.warningBg,
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: 7,
  },
  reimburseBtnText: {
    color: COLORS.warningText,
    fontSize: FONT_SIZE.sm,
    fontWeight: '700',
  },
  // ===== 数据/设置行 =====
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dataCount: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingInfo: {
    flex: 1,
    gap: 2,
    paddingRight: SPACING.md,
  },
  // ===== 弹窗表单 =====
  formGroup: {
    marginBottom: SPACING.md,
  },
  modalScroll: {
    flex: 1,
  },
  fieldLabel: {
    fontSize: FONT_SIZE.xs,
    color: COLORS.textTertiary,
    fontWeight: '600',
    marginBottom: 6,
  },
  submitBtn: {
    borderRadius: RADIUS.lg,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  submitText: {
    color: COLORS.white,
    fontSize: FONT_SIZE.md,
    fontWeight: '700',
    letterSpacing: 1,
  },
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  colorDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  colorDotOn: {
    borderWidth: 3,
    borderColor: COLORS.text,
  },
  typeSwitch: {
    flexDirection: 'row',
    backgroundColor: COLORS.bgAlt,
    borderRadius: RADIUS.pill,
    padding: 3,
  },
  typeBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    alignItems: 'center',
  },
  typeBtnExpense: {
    backgroundColor: COLORS.expense,
  },
  typeBtnIncome: {
    backgroundColor: COLORS.income,
  },
  typeText: {
    fontSize: FONT_SIZE.md,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  typeTextActive: {
    color: COLORS.white,
    fontWeight: '700',
  },
  pickChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: 7,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pickEmoji: {
    fontSize: FONT_SIZE.sm,
  },
  pickName: {
    fontSize: FONT_SIZE.sm,
    color: COLORS.text,
    fontWeight: '600',
  },
  pickNameOn: {
    color: COLORS.white,
  },
  catWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
});

// 二级页面顶栏外框的内容内边距（顶栏由 ManageScreen 统一渲染）
export const SUB_PAGE_TOP_INSET = SPACING.md;
