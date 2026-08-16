# ===== 构建阶段：编译 TS + 编译 better-sqlite3 原生模块 =====
FROM node:22-alpine AS builder

# better-sqlite3 等原生依赖编译链
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ===== 运行阶段：仅携带产物与生产依赖 =====
FROM node:22-alpine AS runtime

# better-sqlite3 运行时依赖（若 musl 无 prebuilt 亦需编译链，故带上）
RUN apk add --no-cache python3 make g++ tini

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
# 重新安装生产依赖（原生模块针对当前镜像编译）
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

# 数据目录（compose 挂载卷持久化）
RUN mkdir -p /app/data
ENV DATA_DIR=/app/data

EXPOSE 8420

# tini 处理信号，保证容器优雅退出（SQLite WAL 安全落盘）
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
