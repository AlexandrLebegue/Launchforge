/**
 * /api/telegram — liaison du compte avec le bot Telegram.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { createLinkCode, isTelegramConfigured } from '../services/telegramBot';
import { storage } from '../services/storage';

const router = Router();
router.use(requireAuth);

// Génère un code de liaison à envoyer au bot (valable 10 min)
router.post('/link-code', (req: Request, res: Response) => {
  if (!isTelegramConfigured()) {
    return res.status(503).json({ success: false, error: 'TELEGRAM_NOT_CONFIGURED' });
  }
  const code = createLinkCode(req.user!.userId);
  const linked = storage.getTelegramLinksByUserId(req.user!.userId).length > 0;
  res.json({ success: true, data: { code, linked } });
});

export default router;
