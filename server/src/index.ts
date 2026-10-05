import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import authRoutes, { meRouter } from './routes/auth';
import familyRoutes from './routes/family';
import syncRoutes from './routes/sync';
import ledgerRoutes from './routes/ledgers';
import healthRoutes from './routes/health';
import { adminPageRouter, adminApiRouter } from './routes/admin';
import { loginRateLimit, registerRateLimit } from './auth';
import { startAutoBackup } from './backup';

const app = express();
const PORT = Number(process.env.PORT || 8420);

// 反向代理支持（v0.5.2）：经 Nginx/群晖反代部署时设 TRUST_PROXY=1，
// 否则 req.ip 恒为代理 IP → 限流按代理 IP 聚合，全家共享配额、一人触发全员 429。
// 直连（局域网 8420）无需设置；设 true 信任链上所有代理，家庭自托管威胁模型可接受。
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', true);
}

// 中间件
app.use(cors()); // 自托管场景：APP 直连，全开
app.use(express.json({ limit: '10mb' })); // push 全量变更时可能较大

// 路由
app.use('/api/health', healthRoutes);
// 认证限流（必须挂在 auth 路由之前）：登录 5 次/分/IP、注册 3 次/分/IP
app.use('/api/auth/login', loginRateLimit);
app.use('/api/auth/register', registerRateLimit);
app.use('/api/auth', authRoutes);
app.use('/api', meRouter); // /api/me（GET 查询 / PUT 改资料）
app.use('/api/family', familyRoutes);
app.use('/api/ledgers', ledgerRoutes);
app.use('/api/sync', syncRoutes);
app.use('/admin', adminPageRouter); // 管理面板单页
app.use('/api/admin', adminApiRouter); // /admin 面板的数据接口

// 404
app.use((_req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 统一错误处理
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: '服务器内部错误' });
});

// 读服务端版本号（dist/index.js 的 __dirname 是 /app/dist，上一级就是镜像里的 /app/package.json；
// 本地 tsx src/index.ts 时同样命中 server/package.json）。
// 用在启动日志里：NAS 上「docker logs / 容器日志」是最快确认到底在跑哪个版本的途径，
// 而 tag 会被 latest 覆盖，光看 tag 说明不了什么。
function serverVersion(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    return raw.version || '未知';
  } catch {
    // 自构建镜像少了 package.json 时只影响这一行日志，不该拖停服务
    return '未知';
  }
}

app.listen(PORT, () => {
  console.log(`[boot] TapLedger server v${serverVersion()} 监听 :${PORT}`);
  console.log(
    `[boot] NODE_ENV=${process.env.NODE_ENV || 'development'}｜自动备份 ${process.env.BACKUP_DISABLED === '1' ? '已关闭' : '开启'}`,
  );
  startAutoBackup();
});
