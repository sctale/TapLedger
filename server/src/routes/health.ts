import { Router } from 'express';

const router = Router();

// GET /api/health（Docker healthcheck）
router.get('/', (_req, res) => {
  res.json({ ok: true, time: Date.now() });
});

export default router;
