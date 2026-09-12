import express from 'express';
import cors from 'cors';
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

app.listen(PORT, () => {
  console.log(`TapLedger server listening on :${PORT}`);
  startAutoBackup();
});
