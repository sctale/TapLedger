# 一点账本 TapLedger

一款主打"零阻力"的极简记账应用，延续 [TapMood（一点心情）](https://github.com/sctale/TapMood) 的暖色治愈设计风格。

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)

## 设计理念

> **3 秒记一笔**：点分类 → 按数字 → 记一笔，全程大按键 + 触感反馈，无需思考。

- 暖米白背景 + 柔和分类色（靛蓝/琥珀/薄荷绿），大留白、圆角卡片
- 隐私优先：数据默认本地 SQLite 存储；**可选**开启家庭同步（自托管，数据不出家门）

## 功能特性

- **快捷记账**：自定义大数字键盘 + 表情分类网格，支出/收入一键切换，可选备注
- **明细编辑（v0.10）**：明细页点击任意记录进入全屏编辑，金额（支持四则运算）/类型/分类/备注/待报销均可修改，保存自动同步
- **周期记账**：每天/每周/每月/每年自动生成记录（工资、房租、订阅等）
- **报销管理**：标记待报销、汇总待报销金额、一键核销
- **月度预算**：预算进度条 + 已用/剩余展示，超支自动变红提醒
- **日历热力图**：月历颜色深浅直观展示每日消费（色盲友好：颜色+数字双通道）
- **流水明细**：按天分组、收支筛选、备注/分类搜索，显示报销状态
- **收支统计**：收支总览、分类占比圆环图、分类排行（**点任意一行下钻该分类的时间段明细**，合计与排行同口径）、近 7 天/本月/12 个月趋势
- **分类管理**：支持新增/编辑/删除自定义分类（预设图标点选 + 自定义输入，配色齐全），内置分类可显隐，全部分类可上下移动排序
- **数据管理**：JSON 完整备份（含周期/分类）+ Excel（CSV）导出，支持合并/替换导入；新增重置个人账本（清空记录/周期/分类，保留设置）
- **本地优先**：不配置服务器就是一本纯本地账本——无账号、无网络请求、冷启动秒开；家庭同步是可随时关掉的一项功能，开启了也仍然先写本地 SQLite、离线照常记账，联网后增量补同步
- **家庭同步（v0.4+ 可选）**：自托管 NAS 后端，多用户 + 家庭公共账本，邀请码邀请家人，本地优先离线可用，增量双向同步；v0.5 增加记账人标识、成员筛选与支出排行；v0.10 网络恢复/回前台自动补同步（详见下方「家庭共享记账」）

## 家庭共享记账（v0.4+，可选）

多人共同记账：把后端部署到自家 NAS，全家人共享一本账。

1. **部署后端**：按下文「服务端部署」在 NAS 上启动容器
2. **APP 连接**：管理页 → 家庭同步 → 填入服务器地址（如 `http://192.168.1.10:8420`）→ 连接
3. **注册/登录**：每位家庭成员注册自己的账号
4. **创建/加入家庭**：一人创建家庭拿到 6 位邀请码，其他人凭码加入
5. **自动同步**：记账后自动同步（可手动「立即同步」），离线照常记账，联网后自动补传

同步机制：本地优先 + 增量双向同步，冲突按「最后修改者胜」（LWW）；删除通过墓碑在全家设备同步生效。不配置服务器 = 纯本地单机版。

### 多成员账本（v0.5+）

- **个人 / 家庭双账本**：连接服务器注册后自动拥有独立「个人账本」；加入家庭后可随时切换个人/家庭账本，各账本数据隔离、互不污染
- **记账人标识**：每笔记录显示记账人（头像 + 昵称 + 专属配色），谁记的账一眼分明；周期记账自动生成的记录也归属当前开机记账人
- **成员筛选**：统计页按成员过滤（总览/饼图/排行/趋势）
- **成员支出排行**：各成员支出金额、占比与笔数对比
- **成员管理**：成员显示创建者/成员角色徽标；创建者可移除成员（历史记录保留）；任何人可改自己的昵称/头像，全家设备同步生效
- **账号安全（v0.11.8）**：同步页可直接**修改密码**（改密后其他设备的登录态立即失效，本机继续在线）与**注销账号**（需当前密码复核；创建者注销即解散家庭账本，其余成员解绑并保留本机副本）。此前的 365 天长效 JWT 没有任何撤销通道，现在由 `users.token_version` 兜住

## 服务端部署（NAS / Docker，可选）

后端镜像托管在 GHCR：`ghcr.io/sctale/tapledger-server`（**公开镜像，NAS 无需 docker login 直接拉取**）。零外部依赖——不需要额外的数据库/缓存容器，全部数据落在一个 SQLite 文件里。

### 通用 Docker 部署（3 步）

**1. 准备目录**：任意机器新建文件夹，放入 `docker-compose.yml`：

```yaml
services:
  tapledger:
    image: ghcr.io/sctale/tapledger-server:latest
    container_name: tapledger-server
    restart: unless-stopped
    ports:
      - "8420:8420"
    environment:
      - PORT=8420
      - TZ=Asia/Shanghai
    env_file:
      - .env
    volumes:
      - ./data:/app/data    # 数据库持久化：备份/迁移只需带走这个目录
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8420/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

**2. 生成 JWT 密钥**：同目录创建 `.env`（不要提交到任何仓库）：

```
JWT_SECRET=<至少 32 位的随机字符串>
```

**3. 拉取启动并验证**：

```bash
docker compose pull && docker compose up -d
curl http://<服务器IP>:8420/api/health   # 返回 {"ok":true,...} 即部署成功
```

完整教程（HTTPS 反代 / TRUST_PROXY / 备份恢复 / FAQ）见 [server/DEPLOY_DOCKER.md](server/DEPLOY_DOCKER.md)。

### 群晖 NAS（Container Manager 图形化，无命令行）

File Station 在 `docker` 共享文件夹下新建 `tapledger` → 放入上面的 `docker-compose.yml` 与 `.env`（卷路径写绝对路径 `/volume1/docker/tapledger/data:/app/data`）→ Container Manager → 项目 → 新建 → 路径选该文件夹 → 创建，等状态变「运行中」即可。

逐步截图说明见 [server/DEPLOY_SYNOLOGY.md](server/DEPLOY_SYNOLOGY.md)（DSM 7 / Container Manager）。

### 运维要点

- **升级**：`docker compose pull && docker compose up -d`（群晖：项目 → 更新），数据保留不丢
- **备份**：定期备份 `data/` 整个目录（数据库为 `data/tapledger.db` 单文件；WAL 模式运行时同目录的 `-wal` / `-shm` 临时文件属正常现象）
- **迁移**：带走整个部署文件夹（`docker-compose.yml` + `.env` + `data/`）到新机器重建即可；`.env` 里的 `JWT_SECRET` **必须保持同值**，否则所有用户需重新登录
- **安全**：局域网使用直接填 `http://NAS_IP:8420`；如需公网访问，务必加 HTTPS 反向代理（Nginx / 群晖反代 / Caddy），不要让明文 8420 裸露公网

> 更多细节（API 概览、同步协议、本地开发、curl 自测）见 [server/README.md](server/README.md)。

## 技术栈

- APP：React Native + Expo SDK 56 + TypeScript（strict）
- 后端（可选）：Node.js 22 + Express + better-sqlite3 + JWT（[server/](server/)）
- expo-sqlite（本地数据存储）/ expo-file-system + expo-sharing + expo-document-picker（备份）
- expo-haptics（触感反馈）/ expo-constants（版本号）/ react-native-svg（图表）

## 安装与运行

```bash
npm install
npx expo start          # 启动开发服务器
npx expo start --android
```

## 构建与发布

**发布流程：全部本地构建**，产物推送 GitHub（Release APK）与 GHCR（Docker 镜像）。

### APP 发布（一键脚本）

```powershell
# 1. 完成代码改动，并在 CHANGELOG.md 顶部新增 ## [X.Y.Z] 条目
# 2. 一键发布：自动 patch +1（或 -Version 1.0.0 指定版本）
powershell -ExecutionPolicy Bypass -File scripts\release-app.ps1
```

脚本自动完成全链路：版本号同步（app.json / package.json / package-lock.json / android build.gradle / README）→ 单测 + 类型检查 + ESLint + Prettier 检查 → 签名注入自检（确认 `android/app/build.gradle` 里三段私有签名配置都在，且 `keystore.properties` 存在）→ 本地构建 release APK → `aapt` 校验 versionName/versionCode → `apksigner` 校验签名者（拦截 debug 签名）→ 复制到根目录 `TapLedger-vX.Y.Z.apk` → git 提交推送 → 创建 GitHub Release 并上传 APK（说明取自 CHANGELOG 最新条目）。

> **签名前置**：release 包使用私有 keystore 签名（非 debug）。首次构建前需准备 `keystore/tapledger-release.keystore` 与根目录 `keystore.properties`（均不入库，`.gitignore` 已排除），再执行 `npx expo prebuild --platform android` 让 `plugins/withReleaseSigning.js` 注入签名配置。丢失 keystore 将无法给老用户推送升级，务必异地备份。

### 服务端镜像发布（GHCR）

```powershell
# 1. 完成 server 代码改动，更新 server/package.json 版本号
# 2. 一键构建推送（tag 自动读 package.json，推 <版本> + latest 双标签）
powershell -ExecutionPolicy Bypass -File server\scripts\docker-push.ps1
```

- 镜像：`ghcr.io/sctale/tapledger-server`（Public，NAS 无需 `docker login` 直接拉取）
- 推送前脚本会先跑本地门禁：`npm run typecheck` + `npm run build` + 断言「生产模式缺 `JWT_SECRET` 必须拒绝启动」，任一项不过就不发镜像
- 构建走 `docker buildx`，一次产出 **linux/amd64 + linux/arm64** 双架构清单（群晖等多为 arm64）；本机没有多架构能力时脚本拒绝单架构推送，避免覆盖清单把 NAS 的拉取搞坏
- NAS 更新：`docker compose pull && docker compose up -d`
- 前置：本机装有 Docker Desktop；`gh auth login` 已登录且含 `write:packages` 权限（或给脚本传只含 `write:packages` 的 `TAPLEDGER_GHCR_PAT`）

### 手动构建 APK（调试用）

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
│   ├── RecordList.tsx         # 记录行/列表（记账人标记、报销标记，编辑热区与动作区分离）
│   ├── EditRecordModal.tsx    # 明细页全屏编辑（v0.10，与首页同构的记账卡）
│   ├── MonthHeatmap.tsx       # 月历热力图
│   ├── CategoryPieChart.tsx   # 分类占比圆环图
│   ├── TrendBarChart.tsx      # 趋势柱状图
│   ├── LoginModal.tsx         # 登录/注册弹窗（v0.4）
│   ├── FamilyModal.tsx        # 家庭管理弹窗（v0.4）
│   ├── Modal.tsx              # 全屏表单弹窗（内含 Toast 层）
│   ├── TabBar.tsx             # 底部导航
│   └── Toast.tsx              # 轻提示（全局单例，非模态浮层）
├── screens/            # 页面
│   ├── HomeScreen.tsx         # 记账（快捷记账卡 + 连记/上次金额）
│   ├── LedgerScreen.tsx       # 明细（日历热力图 + 流水 FlatList 虚拟化 + 点行编辑）
│   ├── StatsScreen.tsx        # 统计（收支总览/预算/饼图/排行/趋势/报销入口）
│   ├── ManageScreen.tsx       # 管理首页（周期/报销/分类/家庭同步/偏好/数据 六个入口）
│   └── manage/                # 二级页：Categories / Recurring / Reimburse / Sync / Prefs / DataManage + RuleModal + sharedStyles
├── sync/               # 家庭同步（v0.4，本地优先）
│   ├── apiClient.ts           # fetch 封装（token/超时/错误语义化）
│   ├── syncEngine.ts          # 增量双向同步引擎（push/pull + LWW + 墓碑 + 401 清登录态）
│   ├── memberUtils.ts         # 家庭成员缓存（记账人标识）
│   └── serverTypes.ts         # 与 server 对齐的 DTO
├── database/           # 数据层
│   └── ledgerDB.ts            # SQLite CRUD + 幂等迁移（补列 / 主键重建）+ 软删除 + 账本作用域
├── constants/          # 设计令牌（配色/间距/圆角/分类/同步事件/设置 key）
├── hooks/              # useToast / useDeleteRecord
├── types/              # 类型定义
└── utils/
    ├── dateUtils.ts           # 日期与金额格式化
    ├── moneyUtils.ts          # 数字键盘输入规则 + 四则运算求值（不用 eval）
    ├── recurring.ts           # 周期记账生成器
    ├── exportData.ts          # JSON 导出（v3 含同步字段）+ 服务端字段上限归一
    ├── importData.ts          # JSON 导入（合并/替换，兼容 v2）
    ├── csvExport.ts           # Excel（CSV）导出
    └── haptics.ts             # 触感反馈
src/utils/__tests__/   # vitest 单测（金额输入/求值、日期、周期到期判断）
server/                 # 自托管后端（NAS Docker，v0.4）
├── src/
│   ├── index.ts               # Express 装配（限流挂载顺序、TRUST_PROXY、统一错误处理）
│   ├── db.ts                  # SQLite（WAL）+ 建表 + 存量库幂等迁移 + 邀请码生成
│   ├── auth.ts                # JWT 签发/校验（含 token_version 撤销）、账本归属、IP 限流
│   ├── backup.ts              # 每日在线热备份（better-sqlite3 backup）
│   └── routes/                # auth / family / ledgers / sync / health / admin
├── Dockerfile          # 多阶段 alpine 构建（多架构 + 非编译运行层）
├── docker-compose.yml  # 一键部署（volume 持久化 + healthcheck）
├── DEPLOY_SYNOLOGY.md  # 群晖 DS224+ 图形化部署教程
├── DEPLOY_DOCKER.md    # 通用 Docker Compose 部署教程（反代/备份/FAQ）
├── scripts/            # docker-push.ps1（GHCR 推送）、selftest*.ps1（接口冒烟）
└── README.md           # 服务端详情（API / 同步协议 / 本地开发）
scripts/
├── sync-version.js            # 版本号单一来源同步（app.json / package.json / lock / server lock）
├── release-app.ps1            # APP 一键发布（版本同步→门禁→构建→签名校验→Release）
└── generate-icons.ps1         # 图标生成（本地工具，非发布链路）
```

## 设计令牌（与 TapMood 同源）

| Token | 值 | 说明 |
|---|---|---|
| 背景 | `#F8F6F3` | 暖米白 |
| 卡片 | `#FFFFFF` / `#FFF9F5` | 白 / 暖色卡片底 |
| 主文字 | `#2D2D2D` / `#6E6E6E` | 深灰 / 次级 |
| 强调色 | `#7986CB` | 柔和靛蓝 |
| 支出 / 收入 / 辅助青 | `#FF8A65` / `#81C784` / `#4DB6AC` | 暖橙 / 薄荷绿 / 青（家庭管理按钮等） |
| 圆角 | 8 / 12 / 16 / 20 / 24 / 胶囊 | 统一设计令牌 |
| 间距 | 4 / 8 / 16 / 24 / 32 / 48 | 大留白风格 |

## 版本

当前版本：0.11.10

## 开源许可

本项目采用 **Apache License 2.0** 开源，全文见 [LICENSE](./LICENSE)，附属声明见 [NOTICE](./NOTICE)。

```
Copyright 2026 sctale

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

简单说：你可以自由使用、修改、分发本代码（含商业用途），但需保留 LICENSE 与版权声明，修改过的文件需注明改动；Apache-2.0 同时包含专利授权条款。

> 本仓库自身代码不含第三方 GPL/AGPL 组件；npm 依赖各自遵循其原始许可证（见各包 `license` 字段）。
