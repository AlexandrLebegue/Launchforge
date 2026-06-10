/**
 * /api/overview — tout le contexte du shell de l'application en UN seul
 * aller-retour : projets (légers, sans blobs JSON), stats du projet actif
 * (Kanban, posts, validations). Remplace la rafale de requêtes que faisaient
 * la sidebar et le tableau de bord à chaque navigation.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';

const router = Router();
router.use(requireAuth);

router.get('/', (req: Request, res: Response) => {
  res.json({ success: true, data: storage.getOverview(req.user!.userId) });
});

export default router;
