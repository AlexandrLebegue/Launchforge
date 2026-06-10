/**
 * /api/posts — Content Hub : planification, publication, récurrence, métriques.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { isAIConfigured } from '../services/aiClient';
import { isComposioConfigured, syncMetricsViaComposio } from '../services/composio';
import { markPublished } from '../services/postPublisher';
import { syncPostsToCalendarInBackground, syncPostsToCalendar } from '../services/calendarSync';
import { Post, PostStatus, Recurrence } from '../types';

const router = Router();
router.use(requireAuth);

const STATUSES: PostStatus[] = ['idea', 'draft', 'scheduled', 'published'];
const RECURRENCES: Recurrence[] = ['none', 'daily', 'weekly', 'biweekly', 'monthly'];

function loadOwnedPost(req: Request, res: Response): Post | null {
  const post = storage.getPostById(req.params.id);
  if (!post || post.userId !== req.user!.userId) {
    res.status(404).json({ success: false, error: 'Post not found' });
    return null;
  }
  return post;
}

function sanitizeMetric(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

// ── GET /api/posts ───────────────────────────────────────────────────────────
// Le Hub de contenu est propre au projet actif
router.get('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  res.json({ success: true, data: storage.getPostsByPlan(userId, storage.getActivePlanId(userId)) });
});

// ── POST /api/posts ──────────────────────────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  const body = req.body as Partial<Post>;
  if (!body.platform || typeof body.platform !== 'string') {
    return res.status(400).json({ success: false, error: 'platform is required' });
  }

  const now = new Date().toISOString();
  const post: Post = {
    id:          uuid(),
    userId:      req.user!.userId,
    planId:      storage.getActivePlan(req.user!.userId)?.id ?? null,
    platform:    body.platform,
    title:       typeof body.title === 'string' ? body.title : '',
    content:     typeof body.content === 'string' ? body.content : '',
    status:      STATUSES.includes(body.status as PostStatus) ? (body.status as PostStatus) : 'draft',
    scheduledAt: body.scheduledAt || null,
    publishedAt: null,
    externalUrl: typeof body.externalUrl === 'string' && body.externalUrl.trim() ? body.externalUrl.trim() : null,
    imageUrl:    typeof body.imageUrl === 'string' && body.imageUrl.trim() ? body.imageUrl.trim() : null,
    recurrence:  RECURRENCES.includes(body.recurrence as Recurrence) ? (body.recurrence as Recurrence) : 'none',
    recurrenceBrief: typeof body.recurrenceBrief === 'string' && body.recurrenceBrief.trim() ? body.recurrenceBrief.trim().slice(0, 600) : null,
    autoPublish: body.autoPublish ? 1 : 0,
    publishError: null,
    calendarSynced: 0,
    impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0,
    createdAt:   now,
    updatedAt:   now,
  };
  storage.savePost(post);

  // Synchro automatique vers le calendrier personnel (best-effort, non bloquant)
  if (post.status === 'scheduled' && post.scheduledAt) {
    syncPostsToCalendarInBackground([post]);
  }

  res.status(201).json({ success: true, data: storage.getPostById(post.id) ?? post });
});

// ── PATCH /api/posts/:id ─────────────────────────────────────────────────────
router.patch('/:id', (req: Request, res: Response) => {
  const post = loadOwnedPost(req, res);
  if (!post) return;

  const body = req.body as Partial<Post>;
  const patch: Partial<Post> = {};

  if (typeof body.platform === 'string' && body.platform) patch.platform = body.platform;
  if (typeof body.title === 'string')    patch.title = body.title;
  if (typeof body.content === 'string')  patch.content = body.content;
  if (STATUSES.includes(body.status as PostStatus)) patch.status = body.status as PostStatus;
  if (body.scheduledAt !== undefined) patch.scheduledAt = body.scheduledAt || null;
  if (body.externalUrl !== undefined) {
    patch.externalUrl = typeof body.externalUrl === 'string' && body.externalUrl.trim() ? body.externalUrl.trim() : null;
  }
  if (body.imageUrl !== undefined) {
    patch.imageUrl = typeof body.imageUrl === 'string' && body.imageUrl.trim() ? body.imageUrl.trim() : null;
  }
  if (RECURRENCES.includes(body.recurrence as Recurrence)) patch.recurrence = body.recurrence as Recurrence;
  if (body.recurrenceBrief !== undefined) {
    patch.recurrenceBrief = typeof body.recurrenceBrief === 'string' && body.recurrenceBrief.trim()
      ? body.recurrenceBrief.trim().slice(0, 600)
      : null;
  }
  if (body.autoPublish !== undefined) {
    patch.autoPublish = body.autoPublish ? 1 : 0;
    // Réactiver l'auto-publication efface l'erreur précédente
    if (patch.autoPublish === 1) patch.publishError = null;
  }

  // Date modifiée → l'événement calendrier doit être recréé
  if (patch.scheduledAt !== undefined && patch.scheduledAt !== post.scheduledAt) {
    patch.calendarSynced = 0;
  }

  for (const metric of ['impressions', 'likes', 'comments', 'shares', 'clicks'] as const) {
    const v = sanitizeMetric(body[metric]);
    if (v !== undefined) patch[metric] = v;
  }

  storage.updatePost(post.id, patch);
  const updated = storage.getPostById(post.id)!;

  // Synchro automatique vers le calendrier personnel (best-effort, non bloquant)
  if (updated.status === 'scheduled' && updated.scheduledAt && !updated.calendarSynced) {
    syncPostsToCalendarInBackground([updated]);
  }

  res.json({ success: true, data: updated });
});

// ── POST /api/posts/:id/publish ──────────────────────────────────────────────
// Marque le post publié ; si récurrent, crée automatiquement la prochaine
// occurrence programmée (régénérée par l'IA si une instruction est définie,
// sinon même contenu ; métriques remises à zéro).
router.post('/:id/publish', (req: Request, res: Response) => {
  const post = loadOwnedPost(req, res);
  if (!post) return;

  if (post.status === 'published') {
    return res.status(400).json({ success: false, error: 'Post already published' });
  }

  const { post: published, next } = markPublished(post);

  // La prochaine occurrence repart dans le calendrier personnel
  if (next) syncPostsToCalendarInBackground([next]);

  res.json({ success: true, data: { post: published, next } });
});

// ── POST /api/posts/:id/sync-metrics ─────────────────────────────────────────
// Récupère les métriques réelles du post via le serveur MCP Composio :
// le modèle (OpenRouter) pilote les outils Composio des comptes connectés.
router.post('/:id/sync-metrics', async (req: Request, res: Response) => {
  const post = loadOwnedPost(req, res);
  if (!post) return;

  if (!isComposioConfigured() || !isAIConfigured()) {
    return res.status(503).json({
      success: false,
      error: 'COMPOSIO_NOT_CONFIGURED',
    });
  }
  if (post.status !== 'published') {
    return res.status(400).json({ success: false, error: 'Seuls les posts publiés peuvent être synchronisés' });
  }
  if (!post.externalUrl) {
    return res.status(400).json({ success: false, error: 'Renseignez d\'abord l\'URL du post publié' });
  }

  try {
    const metrics = await syncMetricsViaComposio(req.user!.userId, post.platform, post.externalUrl, post.title);
    if (!metrics.found) {
      return res.status(422).json({
        success: false,
        error: metrics.note || 'Post introuvable via les outils Composio connectés',
      });
    }
    storage.updatePost(post.id, {
      impressions: metrics.impressions,
      likes:       metrics.likes,
      comments:    metrics.comments,
      shares:      metrics.shares,
      clicks:      metrics.clicks,
    });
    res.json({ success: true, data: { post: storage.getPostById(post.id), note: metrics.note } });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Sync failed',
    });
  }
});

// ── POST /api/posts/sync-calendar ────────────────────────────────────────────
// Synchronise tous les posts programmés non encore présents dans le calendrier
// personnel (bouton de la vue Frise).
router.post('/sync-calendar', async (req: Request, res: Response) => {
  if (!isComposioConfigured() || !isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'COMPOSIO_NOT_CONFIGURED' });
  }
  const toSync = storage.getPostsByPlan(req.user!.userId, storage.getActivePlanId(req.user!.userId))
    .filter((p) => p.status === 'scheduled' && p.scheduledAt && !p.calendarSynced);
  if (toSync.length === 0) {
    return res.json({ success: true, data: { synced: 0, message: 'Tout est déjà synchronisé' } });
  }
  const ok = await syncPostsToCalendar(toSync);
  if (!ok) {
    return res.status(502).json({ success: false, error: 'La création des événements a échoué — vérifiez que Google Calendar est connecté sur Composio' });
  }
  res.json({ success: true, data: { synced: toSync.length } });
});

// ── DELETE /api/posts/:id ────────────────────────────────────────────────────
router.delete('/:id', (req: Request, res: Response) => {
  const post = loadOwnedPost(req, res);
  if (!post) return;
  storage.deletePost(post.id);
  res.json({ success: true, data: null });
});

export default router;
