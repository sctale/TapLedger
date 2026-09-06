# TapLedger 服务端部署教程 — 群晖 DS224+（DSM 7 / Container Manager）

> 把「一点账本」的家庭共享后端跑在你的群晖 DS224+ 上。全程图形化操作，无需 SSH、无需命令，数据只存在你的 NAS 本地。

## 0. 事前准备

- 一台 **DS224+**，系统 **DSM 7.x** 或更高
- 已安装 **Container Manager**（套件中心 → 可直接装上；若没有，先去「套件中心」安装）
- NAS 能访问外网（首次要拉取镜像）
- 知道你的 **局域网 IP**（例如 `192.168.1.200`，在「控制面板 → 网络 → 网络接口」可查到）

> 本教程用的是镜像 `ghcr.io/sctale/tapledger-server`（公共镜像，`latest` 标签，无需登录即可拉取）。

---

## 1. 获取 docker-compose.yml

我们直接在 Container Manager 里新建，不碰命令行。需要用以下内容创建一份 `docker-compose.yml`：

1. 打开 **File Station**，进入共享文件夹 **`docker`**，新建文件夹 `tapledger`（本文以下均以实际路径 `/volume1/docker/tapledger` 为准）。
2. 在 `tapledger` 文件夹里新建文本文件 `docker-compose.yml`，内容照抄下面这段：

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
      # JWT_SECRET 从同级 .env 读取（首次部署前在同文件夹放一个 .env）
    env_file:
      - .env
    volumes:
      # 持久化：NAS 上的 /volume1/docker/tapledger/data ↔ 容器内 /app/data
      # 数据库、用户、家庭、账本全部存在这里，备份/迁移只需带走这个文件夹
      - /volume1/docker/tapledger/data:/app/data
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8420/api/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

然后在**同一个 `/volume1/docker/tapledger` 文件夹**里再建一个 `.env` 文件（不要提交到任何 git），内容：
```
JWT_SECRET=这里填你的随机长字符串（至少32位）
```

### 持久化文件夹说明（重要）

- 数据库文件为 **`/volume1/docker/tapledger/data/tapledger.db`**（SQLite 单文件，WAL 模式运行时同目录还会有 `tapledger.db-wal` / `tapledger.db-shm` 两个临时文件，属正常现象）。
- **首次启动时容器会自动创建** `data` 文件夹和数据库，无需手动新建；之后所有记账数据（用户/家庭/账本/记录）都只落在这里，容器删了重建数据也不丢。
- **备份**：定期备份 `/volume1/docker/tapledger/data` 整个文件夹即可（停机备份最稳，见第 7 节）。
- **迁移到新 NAS**：把整个 `/volume1/docker/tapledger` 文件夹（含 `docker-compose.yml`、`.env`、`data/`）原样复制过去，照第 2 节重新建项目即可，数据完整保留。
- ⚠️ `.env` 里的 `JWT_SECRET` 是登录凭证的签名密钥，**换库/迁移时必须保持同一个值**，否则所有用户需要重新登录；也不要把它放到任何仓库/网盘里。

> 「示范计划」：如果你只会 File Station 新增空文件，可以用「右键 → 用 Notepad 编辑」，粘贴后保存。确保文件名是 `docker-compose.yml`（不是 `docker-compose.yml.txt`）。

---

## 2. 在 Container Manager 里创建项目

1. 打开 **Container Manager**（桌面图标）。
2. 左侧选 **项目（Project）** → 右上点 **新建（Create Project）**。
3. 填：
   - **名称**：`tapledger`
   - **路径**：`/volume1/docker/tapledger`（含 `docker-compose.yml` 的那一层）
   - **来源**：选用「提供 docker-compose.yml 的内容」或「从文件夹读取」均可，指向这份 yml
4. 点击 **下一步 → 创建（Apply）**。
5. Container Manager 会自动从 GHCR 拉取镜像并启动容器。等它显示 **运行中（Running）**。

> 第一次拉镜像约几十 MB，视网速等 1~3 分钟；状态栏变「运行中」即成功。

---

## 3. 打开防火墙端口（可选）

默认 APP 走 `http://NAS_IP:8420`。若只在家里局域网用，不需要这步。

要开放公网/其他设备访问，到 **控制面板 → 安全性 → 防火墙**，为 `8420` 端口 **允许**（TCP），并设置好路由器端口转发。

> ⚠️ 想从外网访问强烈建议加 HTTPS 反向代理，不要让明文 8420 裸露在公网。

---

## 4. 验证部署成功

在电脑浏览器打开（把 IP 换成你的）：
```
http://192.168.1.200:8420/api/health
```
出现类似输出即成功：
```json
{"ok":true,"time":1720000000000}
```

也可打开 **Container Manager → 项目 → tapledger → 日志**，应能看到 Node 服务启动、无报错。

---

## 5. 在「一点账本」APP 里连接

1. 打开 APP → 我的 → 家庭同步（或设置里的同步）。
2. 服务器地址填：`http://192.168.1.200:8420`
3. 注册账号（第一位成员）→ 创建「我们家」家庭 → 其余家人用邀请码加入。

连接后即可多人共享同一个家庭账本，数据全部存在你的 NAS（`/volume1/docker/tapledger/data/`）。

---

## 6. 常见问题（FAQ）

| 现象 | 原因 / 解决 |
|---|---|
| 一直是「拉取中」，状态不运行 | 外网不通或镜像名写错；检查 Container Manager 网络设置，确认能访问 ghcr.io |
| `/api/health` 打不开 | 端口 8420 没映射或防火墙挡了；核对 yml 的 `ports` 与 DSM 防火墙 |
| APP 提示连接失败 | IP/端口填错，或在非局域网环境没做端口转发/HTTPS |
| 重启 NAS 后容器没起来 | 确认 yml 里有 `restart: unless-stopped`；Container Manager 项目需已启用 |
| 想换新版本 | 镜像在**开发者本地构建发布**到 GHCR（版本号 + latest 双标签）。你只需进项目 → **更新**：重新拉取 latest 再「重新创建」即可，或手动在上面的 yml 里指定 `image: ...:具体版本号` 更稳定 |
| 数据会不会丢 | 不会。数据库在 `/volume1/docker/tapledger/data/tapledger.db`，**定期备份这个文件夹即可** |

---

## 7. 升级 / 备份要点

- **升级**：项目 → 更新（拉取 latest）→ 重新创建；或改 yml 里 `image: ghcr.io/sctale/tapledger-server:新版本号` → 重新创建。数据保留在 `/volume1/docker/tapledger/data/`，升级不丢。
- **备份**：进 Container Manager **停止容器**后，整包复制 `/volume1/docker/tapledger/data/`，或用 DSM 的「Hyper Backup」备份该文件夹（WAL 运行中热备份也基本安全，停机最稳）。
- 强烈建议把 `JWT_SECRET` 记到安全的地方——换库/迁移时保持同一个值，已登录的用户才不需重新登录。

---

> 遇到任何一步报错，把 Container Manager 项目日志贴出来，我可以帮你排查。