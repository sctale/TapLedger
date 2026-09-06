import express from 'express';
import cors from 'cors';
import authRoutes, { meRouter } from './routes/auth';
import familyRoutes from './routes/family';
import syncRoutes from './routes/sync';
import ledgerRoutes from './routes/ledgers';
import healthRoutes from './routes/health';
import { loginRateLimit } from './auth';

const app = express();
const PORT = Number(process.env.PORT || 8420);

// 安全提示：未显式配置 JWT_SECRET 时会使用内置开发默认值（可被伪造 token），生产部署务必设置
if (!process.env.JWT_SECRET) {
  console.warn('[warn] 未设置 JWT_SECRET 环境变量，正在使用不安全的默认密钥；生产环境请配置强随机 JWT_SECRET。');
}

// 中间件
app.use(cors()); // 自托管场景：APP 直连，全开
app.use(express.json({ limit: '10mb' })); // push 全量变更时可能较大

// 路由
app.use('/api/health', healthRoutes);
// 登录限流（必须挂在 auth 路由之前）
app.use('/api/auth/login', loginRateLimit);
app.use('/api/auth', authRoutes);
app.use('/api', meRouter); // /api/me（GET 查询 / PUT 改资料）
app.use('/api/family', familyRoutes);
app.use('/api/ledgers', ledgerRoutes);
app.use('/api/sync', syncRoutes);

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
});
