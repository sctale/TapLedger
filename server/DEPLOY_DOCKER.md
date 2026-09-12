# TapLedger Server 部署教程（通用 Docker Compose）

> 把「一点账本」家庭共享后端跑在你自己的机器上（Linux / 威联通 / Windows+WSL 等任意装了 Docker 的设备）。数据全部留在本地，仅一个 SQLite 文件。
>
> 群晖 DSM 图形化操作请看 [DEPLOY_SYNOLOGY.md](./DEPLOY_SYNOLOGY.md)，本文面向会用命令行的环境。

## 0. 前置条件

| 项 | 要求 |
|---|---|
| 系统 | 任意装了 Docker（含 compose 插件）的机器 |
| 架构 | 镜像支持 `linux/amd64` 和 `linux/arm64` |
| 网络 | 首次需能访问 `ghcr.io` 拉取镜像（镜像公开，无需 docker login） |
| 端口 | 默认 `8420`，可在 compose 里改 |

镜像地址：`ghcr.io/sctale/tapledger-server`（`latest` 或具体版本号双标签）

## 1. 准备目录与配置

```bash
mkdir -p /opt/tapledger && cd /opt/tapledger
```

**docker-compose.yml**：

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
      - ./data:/app/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8420/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

**.env**（与 compose 同目录，权限 `chmod 600 .env`）：

```bash
# 必填：JWT 签名密钥，≥32 位随机串。生成：openssl rand -hex 32
JWT_SECRET=<粘贴你的随机串>

# 可选：管理面板口令（浏览器开 http://机器IP:8420/admin 在线开关「注册/加入家庭」）
#ADMIN_TOKEN=<另一个强随机串>

# 可选：走 Nginx/反代暴露公网时设为 1（v0.5.2 起，否则限流按代理 IP 聚合）
#TRUST_PROXY=1

# 可选：自动备份（默认每日热备份，保留 7 份）
#BACKUP_KEEP=7
#BACKUP_DISABLED=1
```

> ⚠️ **JWT_SECRET 是硬性要求**：镜像默认 `NODE_ENV=production`，缺失/过短/用示例值时容器**拒绝启动**（日志 `[fatal] 生产环境必须配置 JWT_SECRET`）。这是防 token 伪造的保护，不是 bug。此密钥请记到密码管理器——换了它全家要重新登录。

## 2. 启动

```bash
docker compose up -d
```

## 3. 验证

```bash
# 健康检查
curl http://localhost:8420/api/health
# → {"ok":true,"time":1720000000000}

# 看日志（应有一行 [backup] wrote tapledger-YYYY-MM-DD.db，说明自动备份正常）
docker logs tapledger-server

# 状态应为 healthy
docker ps
```

## 4. APP 端连接

1. 打开「一点账本」→ 我的 → 家庭同步
2. 服务器地址填 `http://<你的机器IP>:8420`（反代后填 `https://你的域名`）
3. 第一位成员注册 → 创建家庭 → 其余家人用 6 位邀请码加入
4. 之后各端记账自动双向同步（LWW 冲突合并）

## 5. 公网访问（强烈建议 HTTPS 反代）

不要让明文 8420 裸露公网。以 Nginx 为例：

```nginx
server {
    listen 443 ssl;
    server_name ledger.example.com;
    # ssl_certificate ...; ssl_certificate_key ...;

    location / {
        proxy_pass http://127.0.0.1:8420;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;        # 配合 TRUST_PROXY=1
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 12m;                        # push 批量变更可能较大
    }
}
```

反代场景 `.env` 加 `TRUST_PROXY=1` 并重启容器，否则登录限流（5 次/分/IP）会把全家聚合成一个 IP——一人输错密码全员 429。

公网部署后建议配 `ADMIN_TOKEN`，用 `/admin` 面板随时熔断陌生人注册。

## 6. 升级 / 回退

```bash
# 升级（数据在 ./data 卷内，升降级不丢）
docker compose pull && docker compose up -d

# 回退：compose 里 image 改回旧版本号 tag，再 up -d
#   image: ghcr.io/sctale/tapledger-server:0.5.1
```

**版本注意**：

- 升到 v0.4.2+ 前先确认 `.env` 的 `JWT_SECRET` 是真实强随机串（否则拒绝启动）
- 当前最新：server v0.5.2（新增 TRUST_PROXY）、管理面板 v0.5.0、自动备份 v0.4.3

## 7. 备份与恢复

- **自动**：容器每日热备份到 `./data/backups/tapledger-YYYY-MM-DD.db`（留 7 份，`BACKUP_KEEP` 可调）
- **手动整包**：`tar czf tapledger-backup-$(date +%Y%m%d).tar.gz /opt/tapledger/data`
- **恢复**：停容器 → 删 `data/` 下 `tapledger.db-wal`、`tapledger.db-shm` → 把目标备份复制为 `tapledger.db` → 起容器
- **迁移新机器**：整个目录（compose + `.env` + `data/`）原样拷过去，`docker compose up -d` 即可

## 8. FAQ

| 现象 | 原因 / 解决 |
|---|---|
| 容器反复重启，日志 `[fatal] ...JWT_SECRET` | `.env` 填强随机串后 `docker compose up -d --force-recreate` |
| 一直拉取不到镜像 | 机器访问不了 ghcr.io；换网络或手动 `docker pull` |
| APP 注册 403「已关闭注册」 | `/admin` 面板关过开关，开回即可；老账号登录不受影响 |
| 加入家庭 429 | 正常保护：同 IP 5 次/分，或同邀请码连错 10 次锁 10 分钟 |
| 反代后一人 429 全家遭 | 忘了设 `TRUST_PROXY=1`（见第 5 节） |
| 数据会不会丢 | 不会，全在 `./data/`；容器可随便删重建 |

---

> 遇到任何一步报错，把 `docker logs tapledger-server` 的输出贴出来即可排查。
