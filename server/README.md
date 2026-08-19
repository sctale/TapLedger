# TapLedger Server — 家庭共享账本后端

部署在 NAS（Docker）上的自托管后端，为「一点账本」APP 提供多用户注册/登录与家庭公共账本同步。

- 技术栈：Node.js 22 + Express + better-sqlite3（单文件数据库）+ JWT
- 零外部依赖：不需要额外的数据库/缓存容器
- 数据安全：全部数据存在 `./data/tapledger.db`，备份该目录即可

## 一、NAS 部署（Docker Compose）

```bash
cd server
# 1. 修改 JWT_SECRET（docker-compose.yml 里改成随机长字符串）
# 2. 构建并启动
docker compose up -d --build

# 查看日志 / 健康检查
docker compose logs -f
curl http://<NAS_IP>:8420/api/health
```

### 群晖 / 威联通图形化步骤

1. Container Manager / Docker → 项目 → 新建
2. 路径选到本 `server` 目录（含 docker-compose.yml）
3. 确认 `JWT_SECRET` 已修改后启动
4. 防火墙放行 8420 端口（仅局域网使用则无需暴露公网）

### 数据备份

所有数据（用户/家庭/账本）都在 `server/data/` 卷里：

```bash
# 停机备份最稳（WAL 模式下热备份也基本安全）
tar czf tapledger-backup-$(date +%Y%m%d).tar.gz server/data
```

### HTTPS（可选）

APP 直连 `http://NAS_IP:8420` 即可（自托管场景）。如需公网访问，建议用反向代理（Nginx / 群晖反向代理 / Caddy）加 HTTPS，并在 APP 中填 `https://your.domain.com`。

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
