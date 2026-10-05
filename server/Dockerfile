# ===== 构建阶段：编译 TS + 编译 better-sqlite3 原生模块 =====
# 版本策略：node:22-alpine 是官方维护的 LTS 滚动标签（含安全补丁）。
# 想要完全可复现的镜像，把基础镜像钉到具体小版本或 digest 即可。
FROM node:22-alpine AS builder

# better-sqlite3 等原生依赖编译链（只在构建层存在，不进最终镜像）
RUN apk add --no-cache python3 make g++

WORKDIR /app

# npm ci：严格按 package-lock.json 装（此前用 npm install + 可选 glob，
# 结果镜像内容取决于构建日期——express/better-sqlite3 的 ^ 版本会漂移）
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 生产依赖剪枝后整体搬到运行层，避免在最终镜像里重新编译一遍原生模块
RUN npm prune --omit=dev

# ===== 运行阶段：仅携带产物与生产依赖 =====
FROM node:22-alpine AS runtime

# tini 处理信号（SQLite WAL 需要优雅退出）；不再需要 python3/make/g++
RUN apk add --no-cache tini

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# 数据目录（compose 挂载卷持久化）
# 注意：这里保持以 root 运行。改成 USER node 会让「已在跑的实例」升级后写不进
# 原来 root 属主的 data/ 目录（NAS 上表现为服务直接起不来）；要收紧的话请连同
# DEPLOY_*.md 里的 chown -R 1000:1000 data 一次性迁移步骤一起改。
RUN mkdir -p /app/data
ENV DATA_DIR=/app/data

EXPOSE 8420

# 镜像自带健康检查（此前只有 docker-compose 配了 healthcheck，
# 直接用 docker run / 群晖容器界面跑就没有任何存活探测）
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const p=process.env.PORT||8420;fetch('http://127.0.0.1:'+p+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
