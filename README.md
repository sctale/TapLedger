# 一点账本 TapLedger

一款主打"零阻力"的极简记账应用，延续 [TapMood（一点心情）](https://github.com/sctale/TapMood) 的暖色治愈设计风格。

## 设计理念

> **3 秒记一笔**：点分类 → 按数字 → 记一笔，全程大按键 + 触感反馈，无需思考。

- 暖米白背景 + 柔和分类色（靛蓝/琥珀/薄荷绿），大留白、圆角卡片
- 隐私优先：所有数据本地 SQLite 存储，不上传任何服务器

## 功能特性

- **快捷记账**：自定义大数字键盘 + 表情分类网格，支出/收入一键切换，可选备注
- **账户管理**：现金/银行卡/信用卡/支付宝/微信等多账户，余额自动计算，支持账户间转账
- **周期记账**：每天/每周/每月/每年自动生成记录（工资、房租、订阅等）
- **报销管理**：标记待报销、汇总待报销金额、一键核销
- **月度预算**：预算进度条 + 已用/剩余展示，超支自动变红提醒
- **日历热力图**：月历颜色深浅直观展示每日消费（色盲友好：颜色+数字双通道）
- **流水明细**：按天分组、收支筛选、备注/分类搜索，显示账户与报销状态
- **收支统计**：总资产/结余总览、分类占比圆环图、分类排行、近 7 天/30 天/12 个月趋势
- **自定义分类**：新增自己的分类（表情 + 颜色）
- **数据备份**：JSON 完整备份（含账户/周期/分类）+ Excel（CSV）导出，支持合并/替换导入
- **隐私优先**：全部数据保存在本地，无账号、无网络请求

## 技术栈

- React Native + Expo SDK 56
- TypeScript（strict）
- expo-sqlite（本地数据存储）
- expo-file-system + expo-sharing + expo-document-picker（数据备份）
- expo-haptics（触感反馈）
- expo-constants（版本号读取）
- react-native-svg（图表渲染）

## 安装与运行

```bash
npm install
npx expo start          # 启动开发服务器
npx expo start --android
```

## 构建 Android APK

```bash
npx expo prebuild --platform android
cd android
.\gradlew assembleRelease
# 输出：android\app\build\outputs\apk\release\app-release.apk
```

## 项目结构

```
src/
├── components/         # UI 组件
│   ├── CategorySelector.tsx   # 分类选择网格
│   ├── NumberPad.tsx          # 自定义数字键盘
│   ├── AccountPicker.tsx      # 账户选择器
│   ├── RecordList.tsx         # 记录列表（账户/报销标记）
│   ├── MonthHeatmap.tsx       # 月历热力图
│   ├── CategoryPieChart.tsx   # 分类占比圆环图
│   ├── TrendBarChart.tsx      # 趋势柱状图
│   ├── Modal.tsx              # 通用底部弹窗
│   ├── TabBar.tsx             # 底部导航
│   └── Toast.tsx              # 轻提示
├── screens/            # 页面
│   ├── HomeScreen.tsx         # 记账（今日总览 + 快捷记账）
│   ├── LedgerScreen.tsx       # 明细（日历热力图 + 流水筛选搜索）
│   ├── StatsScreen.tsx        # 统计（总览/饼图/排行/趋势）
│   └── ManageScreen.tsx       # 管理（账户/转账/周期/报销/分类/备份）
├── database/           # 数据层
│   └── ledgerDB.ts            # SQLite CRUD + 迁移 + 账户/转账/周期/报销
├── constants/          # 设计令牌（配色/间距/圆角/分类/账户类型）
├── types/              # 类型定义
└── utils/
    ├── dateUtils.ts           # 日期工具
    ├── moneyUtils.ts          # 金额输入规则
    ├── recurring.ts           # 周期记账生成器
    ├── exportData.ts          # JSON 导出
    ├── importData.ts          # JSON 导入（合并/替换 + 校验）
    ├── csvExport.ts           # Excel（CSV）导出
    └── haptics.ts             # 触感反馈
scripts/
└── generate-icons.ps1         # 图标生成脚本
```

## 设计令牌（与 TapMood 同源）

| Token | 值 | 说明 |
|---|---|---|
| 背景 | `#F8F6F3` | 暖米白 |
| 卡片 | `#FFFFFF` / `#FFF9F5` | 白 / 暖色卡片底 |
| 主文字 | `#2D2D2D` / `#6E6E6E` | 深灰 / 次级 |
| 强调色 | `#7986CB` | 柔和靛蓝 |
| 支出 / 收入 / 转账 | `#FF8A65` / `#81C784` / `#4DB6AC` | 暖橙 / 薄荷绿 / 青 |
| 圆角 | 8 / 12 / 16 / 20 / 24 / 胶囊 | 统一设计令牌 |
| 间距 | 4 / 8 / 16 / 24 / 32 / 48 | 大留白风格 |

## 版本

当前版本：0.3.0
