/**
 * /api/posts — Content Hub : planification, publication, récurrence, métriques.
 */

import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { isAIConfigured } from '../services/aiClient';
import { isComposioConfigured, syncMetricsViaComposio, publishViaComposio, extractPublishedRef } from '../services/composio';
import { markPublished, generateOccurrenceContent, crosspostTo, cleanupPublishedVideo } from '../services/postPublisher';
import { syncPostsToCalendarInBackground, syncPostsToCalendar } from '../services/calendarSync';
import { analyzePost } from '../services/analytics';
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
    seriesId:    null,
    recurrenceUseNews:      body.recurrenceUseNews ? 1 : 0,
    recurrenceUseKnowledge: body.recurrenceUseKnowledge === undefined ? 1 : (body.recurrenceUseKnowledge ? 1 : 0),
    recurrenceUpdateKb:     body.recurrenceUpdateKb ? 1 : 0,
    crossPostId: null,
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
  if (body.recurrenceUseNews !== undefined)      patch.recurrenceUseNews = body.recurrenceUseNews ? 1 : 0;
  if (body.recurrenceUseKnowledge !== undefined) patch.recurrenceUseKnowledge = body.recurrenceUseKnowledge ? 1 : 0;
  if (body.recurrenceUpdateKb !== undefined)     patch.recurrenceUpdateKb = body.recurrenceUpdateKb ? 1 : 0;
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

  // Saisie manuelle de métriques → instantané pour les courbes temporelles
  if (updated.status === 'published' &&
      (['impressions', 'likes', 'comments', 'shares', 'clicks'] as const).some((m) => patch[m] !== undefined)) {
    storage.recordMetricSnapshot(updated);
  }

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

// ── POST /api/posts/:id/crosspost ────────────────────────────────────────────
// Décline un post vers d'autres plateformes (un exemplaire indépendant par
// plateforme, groupés par crossPostId — chaque exemplaire se publie, se mesure
// et s'analyse séparément). adapt=true : l'IA réécrit chaque exemplaire aux
// codes de sa plateforme.
router.post('/:id/crosspost', async (req: Request, res: Response) => {
  const post = loadOwnedPost(req, res);
  if (!post) return;

  const { platforms, adapt } = req.body as { platforms?: unknown; adapt?: unknown };
  if (!Array.isArray(platforms) || platforms.length === 0 ||
      !platforms.every((p) => typeof p === 'string' && /^[a-z0-9_-]{2,30}$/i.test(p))) {
    return res.status(400).json({ success: false, error: 'platforms must be a non-empty array of platform names' });
  }

  try {
    const created = await crosspostTo(post, platforms as string[], Boolean(adapt));
    // Les exemplaires programmés repartent dans le calendrier personnel
    const scheduled = created.filter((p) => p.status === 'scheduled' && p.scheduledAt);
    if (scheduled.length > 0) syncPostsToCalendarInBackground(scheduled);
    res.json({
      success: true,
      data: { posts: created, post: storage.getPostById(post.id)!, skipped: platforms.length - created.length },
    });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Déclinaison échouée' });
  }
});

// ── POST /api/posts/:id/recurrence/preview ───────────────────────────────────
// Mode « simuler » : génère la prochaine occurrence de la série SANS rien
// enregistrer — l'utilisateur voit ce que l'IA produira avec ses réglages
// (instruction, base de connaissances, actus, mémoire de série). Les réglages
// du corps de requête priment sur ceux du post pour tester avant de sauver.
router.post('/:id/recurrence/preview', async (req: Request, res: Response) => {
  const post = loadOwnedPost(req, res);
  if (!post) return;

  const body = req.body as Partial<Post>;
  const candidate: Post = {
    ...post,
    recurrenceBrief: typeof body.recurrenceBrief === 'string' && body.recurrenceBrief.trim()
      ? body.recurrenceBrief.trim().slice(0, 600)
      : post.recurrenceBrief,
    recurrenceUseNews:      body.recurrenceUseNews !== undefined ? (body.recurrenceUseNews ? 1 : 0) : post.recurrenceUseNews,
    recurrenceUseKnowledge: body.recurrenceUseKnowledge !== undefined ? (body.recurrenceUseKnowledge ? 1 : 0) : post.recurrenceUseKnowledge,
    // Simulation : jamais d'écriture en base de connaissances
    recurrenceUpdateKb: 0,
  };

  if (!candidate.recurrenceBrief) {
    return res.status(400).json({ success: false, error: 'Définissez d\'abord l\'instruction de régénération de la série' });
  }
  if (!isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }

  try {
    const gen = await generateOccurrenceContent(candidate);
    const tags = gen.hashtags.length > 0 ? `\n\n${gen.hashtags.map((h) => `#${h}`).join(' ')}` : '';
    res.json({ success: true, data: { title: gen.title, content: gen.content + tags } });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Simulation échouée' });
  }
});

// ── POST /api/posts/:id/publish-now ──────────────────────────────────────────
// Publication IMMÉDIATE et RÉELLE via Composio (voie directe quand le schéma
// est connu, opérateur IA sinon) — contrairement à /publish qui ne fait que
// marquer le post publié. Retourne le résultat exact (lien publié ou raison
// de l'échec) pour un retour clair dans l'éditeur.
router.post('/:id/publish-now', async (req: Request, res: Response) => {
  const post = loadOwnedPost(req, res);
  if (!post) return;
  if (post.status === 'published') {
    return res.status(400).json({ success: false, error: 'Ce post est déjà publié.' });
  }
  if (!isComposioConfigured() && !process.env.COMPOSIO_API_KEY) {
    return res.status(503).json({ success: false, error: 'COMPOSIO_NOT_CONFIGURED' });
  }

  // Mode groupe : publie aussi tous les exemplaires multi-plateformes NON
  // publiés du même contenu (un résultat par plateforme).
  const includeGroup = Boolean((req.body as { group?: unknown })?.group);
  const targets: Post[] = [post];
  if (includeGroup && post.crossPostId) {
    targets.push(...storage.getCrossPostGroup(post.crossPostId)
      .filter((p) => p.id !== post.id && p.status !== 'published' && p.userId === req.user!.userId));
  }

  const results: { platform: string; ok: boolean; message: string; url?: string }[] = [];
  for (const target of targets) {
    let result: string;
    try {
      result = await publishViaComposio(req.user!.userId, target.platform, target.content, target.imageUrl, target.title);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Publication échouée';
      if (msg === 'COMPOSIO_NOT_CONFIGURED' || msg === 'AI_NOT_CONFIGURED') {
        return res.status(503).json({ success: false, error: 'COMPOSIO_NOT_CONFIGURED' });
      }
      storage.updatePost(target.id, { publishError: msg.slice(0, 500) });
      results.push({ platform: target.platform, ok: false, message: msg });
      continue;
    }

    if (!result.trim().toUpperCase().startsWith('OK')) {
      const reason = result.replace(/^ECHEC:\s*/i, '').trim() || 'Publication refusée par la plateforme';
      storage.updatePost(target.id, { publishError: reason.slice(0, 500) });
      results.push({ platform: target.platform, ok: false, message: reason });
      continue;
    }

    const { next } = markPublished(storage.getPostById(target.id)!);
    const ref = extractPublishedRef(result);
    if (ref) storage.updatePost(target.id, { externalUrl: ref });
    cleanupPublishedVideo(storage.getPostById(target.id)!);
    if (next) syncPostsToCalendarInBackground([next]);
    results.push({
      platform: target.platform,
      ok: true,
      message: result.replace(/^OK:\s*/i, '').trim(),
      url: ref && /^https?:/i.test(ref) ? ref : undefined,
    });
  }

  const anyOk = results.some((r) => r.ok);
  const payload = {
    post: storage.getPostById(post.id)!,
    results,
    message: results[0]?.message ?? '',
  };
  if (!anyOk) {
    return res.status(502).json({ success: false, error: results[0]?.message ?? 'Publication échouée', data: payload });
  }
  res.json({ success: true, data: payload });
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
    storage.recordMetricSnapshot(storage.getPostById(post.id)!);
    res.json({ success: true, data: { post: storage.getPostById(post.id), note: metrics.note } });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Sync failed',
    });
  }
});

// ── POST /api/posts/:id/analyze ──────────────────────────────────────────────
// Post-mortem IA d'un post publié : pourquoi ça a marché (ou pas), quoi
// refaire. Les enseignements alimentent la base de connaissances du projet.
router.post('/:id/analyze', async (req: Request, res: Response) => {
  const post = loadOwnedPost(req, res);
  if (!post) return;
  if (!isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }
  if (post.status !== 'published') {
    return res.status(400).json({ success: false, error: 'Seuls les posts publiés peuvent être analysés' });
  }
  try {
    const result = await analyzePost(req.user!.userId, post);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Analyse échouée' });
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
