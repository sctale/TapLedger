import { Router } from 'express';
import { serverVersion } from '../version';

const router = Router();

// GET /api/health（Docker healthcheck + 远程确认服务端版本）
// version 自 v0.5.8 起带上：排查"两台设备同时被退出"这类问题时，第一件事就是确认
// NAS 上实际在跑哪一版（旧镜像 7 天 token、换过 JWT_SECRET 等处置方式完全不同），
// 而 tag 会被 latest 覆盖、启动日志又要登容器才能看。
router.get('/', (_req, res) => {
  res.json({ ok: true, version: serverVersion(), time: Date.now() });
});

export default router;
