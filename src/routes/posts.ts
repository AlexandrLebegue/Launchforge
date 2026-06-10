/**
 * /api/posts — Content Hub : planification, publication, récurrence, métriques.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { isAIConfigured } from '../services/aiClient';
import { isComposioConfigured, syncMetricsViaComposio } from '../services/composio';
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

/** Prochaine occurrence d'un post récurrent */
export function nextOccurrence(from: Date, recurrence: Recurrence): Date | null {
  const next = new Date(from);
  switch (recurrence) {
    case 'daily':    next.setDate(next.getDate() + 1);   return next;
    case 'weekly':   next.setDate(next.getDate() + 7);   return next;
    case 'biweekly': next.setDate(next.getDate() + 14);  return next;
    case 'monthly':  next.setMonth(next.getMonth() + 1); return next;
    default: return null;
  }
}

// ── GET /api/posts ───────────────────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  res.json({ success: true, data: storage.getPostsByUserId(req.user!.userId) });
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
    platform:    body.platform,
    title:       typeof body.title === 'string' ? body.title : '',
    content:     typeof body.content === 'string' ? body.content : '',
    status:      STATUSES.includes(body.status as PostStatus) ? (body.status as PostStatus) : 'draft',
    scheduledAt: body.scheduledAt || null,
    publishedAt: null,
    externalUrl: typeof body.externalUrl === 'string' && body.externalUrl.trim() ? body.externalUrl.trim() : null,
    recurrence:  RECURRENCES.includes(body.recurrence as Recurrence) ? (body.recurrence as Recurrence) : 'none',
    impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0,
    createdAt:   now,
    updatedAt:   now,
  };
  storage.savePost(post);
  res.status(201).json({ success: true, data: post });
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
  if (RECURRENCES.includes(body.recurrence as Recurrence)) patch.recurrence = body.recurrence as Recurrence;

  for (const metric of ['impressions', 'likes', 'comments', 'shares', 'clicks'] as const) {
    const v = sanitizeMetric(body[metric]);
    if (v !== undefined) patch[metric] = v;
  }

  storage.updatePost(post.id, patch);
  res.json({ success: true, data: storage.getPostById(post.id) });
});

// ── POST /api/posts/:id/publish ──────────────────────────────────────────────
// Marque le post publié ; si récurrent, crée automatiquement la prochaine
// occurrence programmée (même contenu, métriques remises à zéro).
router.post('/:id/publish', (req: Request, res: Response) => {
  const post = loadOwnedPost(req, res);
  if (!post) return;

  if (post.status === 'published') {
    return res.status(400).json({ success: false, error: 'Post already published' });
  }

  const now = new Date();
  storage.updatePost(post.id, { status: 'published', publishedAt: now.toISOString() });

  let next: Post | null = null;
  if (post.recurrence !== 'none') {
    const base = post.scheduledAt ? new Date(post.scheduledAt) : now;
    const nextDate = nextOccurrence(base, post.recurrence);
    if (nextDate) {
      // Si la date calculée est déjà passée (publication en retard), repartir d'aujourd'hui
      const scheduled = nextDate.getTime() > now.getTime() ? nextDate : nextOccurrence(now, post.recurrence)!;
      const ts = new Date().toISOString();
      next = {
        ...post,
        id:          uuid(),
        status:      'scheduled',
        scheduledAt: scheduled.toISOString(),
        publishedAt: null,
        impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0,
        createdAt:   ts,
        updatedAt:   ts,
      };
      storage.savePost(next);
    }
  }

  res.json({ success: true, data: { post: storage.getPostById(post.id), next } });
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
    const metrics = await syncMetricsViaComposio(post.platform, post.externalUrl, post.title);
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

// ── DELETE /api/posts/:id ────────────────────────────────────────────────────
router.delete('/:id', (req: Request, res: Response) => {
  const post = loadOwnedPost(req, res);
  if (!post) return;
  storage.deletePost(post.id);
  res.json({ success: true, data: null });
});

export default router;
