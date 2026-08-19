import { Router } from 'express';
import { db } from '../db';
import { requireAuth, ensurePersonalLedger } from '../auth';
import type { LedgerInfo } from '../types';

const router = Router();
router.use(requireAuth);

// GET /api/ledgers —— 当前用户的账本列表（个人账本 + 家庭账本）
router.get('/', (req, res) => {
  const me = req.authUser!;
  // 确保个人账本存在
  const personalId = me.personalLedgerId ?? ensurePersonalLedger(me.id, me.displayName);
  const ledgers: LedgerInfo[] = [];

  const personal = db.prepare('SELECT id, name, type FROM families WHERE id = ?').get(personalId) as
    | { id: number; name: string; type: 'personal' | 'family' }
    | undefined;
  if (personal) {
    ledgers.push({ id: personal.id, name: personal.name, type: 'personal', role: 'owner' });
  }

  if (me.familyId != null) {
    const family = db.prepare('SELECT id, name, type FROM families WHERE id = ?').get(me.familyId) as
      | { id: number; name: string; type: 'personal' | 'family' }
      | undefined;
    if (family) {
      ledgers.push({
        id: family.id,
        name: family.name,
        type: 'family',
        role: me.familyRole ?? 'member',
      });
    }
  }

  res.json({ ledgers });
});

export default router;