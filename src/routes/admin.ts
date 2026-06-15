import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { storage } from '../services/storage';

const router = Router();
router.use(requireAuth);
router.use(requireAdmin);

// ── GET /api/admin/stats ─────────────────────────────────────────────────────
router.get('/stats', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: storage.adminGetStats() });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erreur serveur' });
  }
});

// ── GET /api/admin/users ─────────────────────────────────────────────────────
router.get('/users', (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: storage.adminGetAllUsers() });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erreur serveur' });
  }
});

// ── GET /api/admin/users/:id/activity ────────────────────────────────────────
router.get('/users/:id/activity', (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    res.json({ success: true, data: storage.adminGetUserActivity(req.params.id, limit) });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erreur serveur' });
  }
});

// ── GET /api/admin/activity ──────────────────────────────────────────────────
// Flux d'activité global paginé par curseur (before=ISO date).
router.get('/activity', (req: Request, res: Response) => {
  try {
    const limit  = Math.min(Number(req.query.limit ?? 50), 200);
    const before = typeof req.query.before === 'string' ? req.query.before : undefined;
    res.json({ success: true, data: storage.adminGetActivity(limit, before) });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Erreur serveur' });
  }
});

export default router;
