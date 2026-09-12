# TapLedger Server — 家庭共享账本后端

部署在 NAS（Docker）上的自托管后端，为「一点账本」APP 提供多用户注册/登录与家庭公共账本同步。

- 技术栈：Node.js 22 + Express + better-sqlite3（单文件数据库）+ JWT
- 零外部依赖：不需要额外的数据库/缓存容器
- 数据安全：全部数据存在 `./data/tapledger.db`，备份该目录即可

## 一、NAS 部署（Docker Compose，镜像拉取 / 免本地编译）

镜像托管在 GitHub 容器仓库 **GHCR**：`ghcr.io/sctale/tapledger-server`。
NAS 上不再本地编译，只 `pull` 已发布镜像并启动。

```bash
cd server
# 1. 首次部署先创建密钥文件（生产务必改成随机长字符串）
#    cp .env.example .env  然后编辑 .env 填真实 JWT_SECRET
# 2. 拉取镜像并启动
docker compose pull
docker compose up -d

# 查看日志 / 健康检查
docker compose logs -f
curl http://<NAS_IP>:8420/api/health
```

> 更新到新版本：`docker compose pull && docker compose up -d` 即可，无需重新编译。

> 部署教程：通用命令行版见 [DEPLOY_DOCKER.md](./DEPLOY_DOCKER.md)（HTTPS 反代 / TRUST_PROXY / 备份恢复 / FAQ），群晖图形化版见 [DEPLOY_SYNOLOGY.md](./DEPLOY_SYNOLOGY.md)。

### ⚠️ 升级到 v0.4.2+ 注意（重要）

自 v0.4.2 起服务端加了防伪造保护，**首次升级到 v0.4.2/v0.4.3/v0.5.0 前请先确认 `.env`**：

1. **必须先配好 `JWT_SECRET` 再升级**。生产镜像（`NODE_ENV=production`）若 `.env` 里的 `JWT_SECRET` **缺失、仍是示例值、短于 16 位或等于内置默认值**，容器会打印 `[fatal] 生产环境必须配置 JWT_SECRET…` 后**拒绝启动**。这是刻意保护（默认密钥下任何人可伪造登录 token 读取全家账本），不是 bug。
   - 升级前：`docker compose logs` 若看到上面这行，说明密钥没配好——先在 `.env` 写一个强随机串再 `docker compose up -d`。
   - 生成强密钥：`openssl rand -hex 32`（或任意 ≥32 位随机串）填入 `JWT_SECRET=`。
   - 该值是登录凭证的签名密钥，**迁移/换机时保持不变**，否则全员需重新登录；切勿提交到任何 git/网盘。
2. **（可选）管理面板**：v0.5.0 起，在 `.env` 加 `ADMIN_TOKEN=<强随机串>` 并重启一次，浏览器开 `http://NAS_IP:8420/admin` 可在线开关「允许新用户注册 / 允许邀请码加入家庭」（即时生效，用于公网暴露时随时熔断陌生人）。不配 `ADMIN_TOKEN` 则该面板不可用，其余功能不受影响。
3. **（可选）自动备份**：v0.4.3 起每天自动热备份到 `data/backups/tapledger-日期.db`（保留 7 份）。升级本身不动数据，但可顺手确认该目录已生成当日备份。

> 回退：改 `docker-compose.yml` 里 `image:` 指回旧版本号 tag 重新拉取即可；数据在 `data/` 卷内，升降级都不丢。

### 群晖 / 威联通图形化步骤

1. Container Manager / Docker → 项目 → 新建
2. 路径选到本 `server` 目录（含 docker-compose.yml）
3. 在同目录放好 `.env`（含 JWT_SECRET）后启动（首次会从 GHCR 拉镜像）
4. 防火墙放行 8420 端口（仅局域网使用则无需暴露公网）

### 发布新版本镜像（本地构建推送，默认流程）

在装有 Docker 的开发机上执行（tag 自动读 `server/package.json`，推 `<版本号>` + `latest` 双标签）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\docker-push.ps1
```

脚本完成：gh token 登录 GHCR → `docker build` → 推送双标签。镜像已设为 **Public**，NAS 无需 `docker login` 直接拉取。

NAS 更新：`docker compose pull && docker compose up -d`。

> 仓库内的 GitHub Actions workflow（`.github/workflows/build-and-push-server-image.yml`，已改为仅手动触发）仅作为无本地 Docker 环境时的备用通道。

### 数据备份

服务端内置**每日自动热备份**（v0.4.3 起，走 SQLite 在线备份 API，无需停服）：

- 产物：`data/backups/tapledger-YYYY-MM-DD.db`，默认保留最近 7 份（env 可调：`BACKUP_KEEP=份数`；`BACKUP_DISABLED=1` 关闭）
- 服务器当天开过机就会补一份当日备份；长期不停机则每 24 小时一份
- 想再稳一层：用 DSM「Hyper Backup」定期整包备份 `data/` 文件夹

**回滚到某个备份点**（如误删数据）：

```bash
docker compose down
cp data/tapledger.db data/tapledger.db.broken   # 留出现场
rm -f data/tapledger.db-wal data/tapledger.db-shm
cp data/backups/tapledger-2026-09-08.db data/tapledger.db   # 换成目标备份
docker compose up -d
```

手动整包备份仍然可用（停机时最稳）：

```bash
tar czf tapledger-backup-$(date +%Y%m%d).tar.gz server/data
```

### HTTPS（可选）

APP 直连 `http://NAS_IP:8420` 即可（自托管场景）。如需公网访问，建议用反向代理（Nginx / 群晖反向代理 / Caddy）加 HTTPS，并在 APP 中填 `https://your.domain.com`。

> **走反向代理时请设 `TRUST_PROXY=1`**（v0.5.2 起，写在 `server/.env` 后重启容器）。否则服务端看到的客户端 IP 恒为代理地址，登录/注册限流会按代理 IP 聚合——一人输错密码全家 429。局域网直连无需配置。

### 管理面板（v0.5.0，可选）

给公网部署准备的一个极简后台，用于**随时熔断陌生人进入**：

1. 在 `server/.env` 增加 `ADMIN_TOKEN=<≥32位随机串>` 并重启一次容器（只有这一步需要重启）
2. 浏览器打开 `https://你的域名/admin`（局域网即 `http://NAS_IP:8420/admin`），粘贴口令连接
3. 可即时切换两个开关（保存到 SQLite，无需再重启）：
   - **允许新用户注册**：关闭后注册接口返回 403——攻击链「注册→爆破邀请码→进家庭」在第一环掐断；家人已注册的账号不受影响，登录照常
   - **允许邀请码加入家庭**：二级保险，关闭后即便拿到邀请码也进不去
4. 同页显示只读概览：用户数 / 家庭数 / 有效记录数 / 最近同步时间

安全说明：未配置 `ADMIN_TOKEN` 时面板接口一律 503（等于不存在）；口令错误 401 且有 10 次/分/IP 限流；面板页本身无任何敏感数据。请通过 HTTPS 使用（见上节）。

## 二、本地开发

```bash
cd server
npm install
npm run dev        # tsx 热重载，默认 :8420
npm run typecheck
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8420` | 监听端口 |
| `JWT_SECRET` | 开发默认值 | **生产必改** |
| `DATA_DIR` | `./data` | 数据库目录 |

## 三、API 概览

| 方法 | 路径 | 说明 | 认证 |
|---|---|---|---|
| GET | `/api/health` | 健康检查 | - |
| POST | `/api/auth/register` | 注册 `{username, password, displayName?}` | - |
| POST | `/api/auth/login` | 登录 `{username, password}` → `{token, user}` | - |
| GET | `/api/me` | 当前用户信息 | Bearer |
| PUT | `/api/me` | 改昵称/头像 `{displayName?, avatarEmoji?}` | Bearer |
| POST | `/api/family` | 创建家庭 `{name}`（创建者为 owner） | Bearer |
| POST | `/api/family/join` | 邀请码加入 `{inviteCode}` | Bearer |
| GET | `/api/family` | 当前家庭信息（含邀请码） | Bearer |
| GET | `/api/family/members` | 成员列表 | Bearer |
| POST | `/api/family/invite/regenerate` | 重置邀请码（owner） | Bearer |
| DELETE | `/api/family/members/:userId` | 移除成员（owner，不可移除自己） | Bearer |
| POST | `/api/family/leave` | 退出/解散家庭 | Bearer |
| GET | `/api/ledgers` | 列出当前用户可访问的账本（个人 + 家庭） | Bearer |
| POST | `/api/sync/pull` | 拉取增量 `{since, ledgerId}` → `{serverTime, changes}` | Bearer |
| POST | `/api/sync/push` | 上传变更 `{ledgerId, changes}` → `{applied, rejected}` | Bearer |

### 个人账本 / 家庭账本

- 注册时自动为用户创建独立「个人账本」（老用户惰性补建），仅本人可读写，与家庭账本数据隔离
- `GET /api/ledgers` 返回该用户可访问的全部账本（`type: personal | family`），客户端据此提供账本切换
- `sync/pull`、`sync/push` 均需携带 `ledgerId`，服务端校验用户对该账本的读写权限；不存在或无权访问返回 403

### 同步协议（本地优先 + LWW）

- 所有业务实体（records/accounts/transfers/recurring/customCategories）以 **uuid** 为主键，带 `updatedAt`（毫秒时间戳）与 `deleted`（墓碑）
- **pull**：返回 `updated_at > since` 的全部变更（含墓碑），客户端按 LWW 合并到本地
- **push**：服务端逐条 upsert，仅当 `incoming.updated_at > 服务端 updated_at` 才覆盖（整条 last-write-wins）
- 冲突（两端同时改一条）：`updatedAt` 新者胜，旧版本被拒绝（rejected 计数），客户端下次 pull 拉回正确版本
- 登录接口限流：同 IP 每分钟 5 次

## 四、快速自测（curl）

```bash
BASE=http://localhost:8420

# 注册两个家庭成员
curl -s $BASE/api/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"dad","password":"123456","displayName":"爸爸"}'
curl -s $BASE/api/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"mom","password":"123456","displayName":"妈妈"}'

# 爸爸创建家庭 → 拿到邀请码
TOKEN_DAD=...   # 上一步返回的 token
curl -s $BASE/api/family -H "Authorization: Bearer $TOKEN_DAD" \
  -H 'Content-Type: application/json' -d '{"name":"我们家"}'

# 妈妈用邀请码加入
TOKEN_MOM=...
curl -s $BASE/api/family/join -H "Authorization: Bearer $TOKEN_MOM" \
  -H 'Content-Type: application/json' -d '{"inviteCode":"XXXXXX"}'

# 爸爸 push 一条记录，妈妈 pull 即可看到
curl -s $BASE/api/sync/push -H "Authorization: Bearer $TOKEN_DAD" \
  -H 'Content-Type: application/json' \
  -d '{"records":[{"uuid":"r-001","amount":25,"category":"food","type":"expense","note":"午饭","date":"2026-08-16","timestamp":1755300000000,"accountUuid":"","updatedAt":1755300000000,"deleted":0}]}'
curl -s $BASE/api/sync/pull -H "Authorization: Bearer $TOKEN_MOM" \
  -H 'Content-Type: application/json' -d '{"since":0}'
```
