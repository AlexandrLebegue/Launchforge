/**
 * /api/content — assistant IA de génération de contenu.
 * S'appuie sur la base de connaissances + le contexte entreprise du dernier plan.
 */

import { Router, Request, Response } from 'express';
import { generateImage, hostImage, isImageGenConfigured } from '../services/imageGen';
import { saveMediaStream, deleteMediaFile } from '../services/mediaStore';
import { storage } from '../services/storage';
import { generateCampaignReport, computePerformanceSeries } from '../services/analytics';
import { requireAuth } from '../middleware/auth';
import { generateContent, isContentAssistantConfigured } from '../services/contentAssistant';
import { generateContentCalendar, clampParams } from '../services/calendarGenerator';
import { syncPostsToCalendarInBackground } from '../services/calendarSync';
import { runPostChatTurn, PostChatMessage } from '../services/postAssistant';

const router = Router();
router.use(requireAuth);

router.post('/generate', async (req: Request, res: Response) => {
  if (!isContentAssistantConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }

  const { platform, brief, tone, baseContent, useNews } = req.body as {
    platform?: string;
    brief?: string;
    tone?: string;
    baseContent?: string;
    useNews?: boolean;
  };

  if (!platform || typeof platform !== 'string') {
    return res.status(400).json({ success: false, error: 'platform is required' });
  }
  if (!brief || typeof brief !== 'string' || !brief.trim()) {
    return res.status(400).json({ success: false, error: 'brief is required' });
  }

  try {
    const result = await generateContent({
      userId: req.user!.userId,
      platform,
      brief: brief.trim(),
      tone: typeof tone === 'string' ? tone : undefined,
      baseContent: typeof baseContent === 'string' && baseContent.trim() ? baseContent : undefined,
      useNews: Boolean(useNews),
    });
    res.json({ success: true, data: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Generation failed';
    res.status(msg === 'AI_NOT_CONFIGURED' ? 503 : 502).json({ success: false, error: msg });
  }
});

// ── POST /api/content/calendar ───────────────────────────────────────────────
// Génère un calendrier éditorial complet (posts rédigés + programmés) à
// partir du plan de lancement et de la base de connaissances.
router.post('/calendar', async (req: Request, res: Response) => {
  if (!isContentAssistantConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }

  const body = req.body as {
    weeks?: number;
    postsPerWeek?: number;
    platforms?: string[];
    startDate?: string;
  };

  const { weeks, postsPerWeek } = clampParams(body);
  const platforms = Array.isArray(body.platforms)
    ? body.platforms.filter((p) => typeof p === 'string' && p.trim()).slice(0, 6)
    : [];
  const start = body.startDate ? new Date(body.startDate) : new Date();
  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({ success: false, error: 'startDate invalide' });
  }

  try {
    const posts = await generateContentCalendar({
      userId: req.user!.userId,
      weeks,
      postsPerWeek,
      platforms,
      startDate: start,
    });

    // Tout le lot part dans le calendrier personnel (best-effort, non bloquant)
    syncPostsToCalendarInBackground(posts);

    res.status(201).json({ success: true, data: posts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Generation failed';
    res.status(msg === 'AI_NOT_CONFIGURED' ? 503 : 502).json({ success: false, error: msg });
  }
});

// ── POST /api/content/chat/stream ────────────────────────────────────────────
// Assistant conversationnel de création de posts (SSE) :
//   data: {"type":"delta","text":…}   — texte de la réponse en continu
//   data: {"type":"action","text":…}  — recherche web effectuée
//   data: {"type":"saved","postId":…,"title":…} — post enregistré dans le Hub
//   data: {"type":"done","reply":…}   — fin du tour
//   data: {"type":"error","error":…}
// Sans état côté serveur : le client envoie l'historique complet.
router.post('/chat/stream', async (req: Request, res: Response) => {
  if (!isContentAssistantConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }

  const raw = (req.body as { messages?: unknown }).messages;
  const history: PostChatMessage[] = Array.isArray(raw)
    ? raw
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
        .map((m: any) => ({ role: m.role, text: String(m.text).slice(0, 8000) }))
    : [];

  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return res.status(400).json({ success: false, error: 'messages must end with a user message' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const result = await runPostChatTurn(req.user!.userId, history, send);
    send({ type: 'done', reply: result.reply, actions: result.actions, savedPosts: result.savedPosts });
  } catch (err) {
    send({ type: 'error', error: err instanceof Error ? err.message : 'Chat failed' });
  } finally {
    res.end();
  }
});

// ── GET /api/content/performance — séries pour les graphiques (sans IA) ─────
router.get('/performance', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const ctx = storage.resolveActiveProject(userId);
  res.json({ success: true, data: computePerformanceSeries(ctx.ownerUserId, ctx.planId) });
});

// ── GET /api/content/report — rapport de campagne narratif (IA) ─────────────
router.get('/report', async (req: Request, res: Response) => {
  if (!isContentAssistantConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }
  try {
    const { report, stats } = await generateCampaignReport(req.user!.userId);
    res.json({ success: true, data: { report, stats } });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Rapport échoué' });
  }
});

// ── POST /api/content/image — génère un visuel (IA) et l'héberge ─────────────
// Retourne une URL publique ; si postId est fourni, l'image est attachée au post.
router.post('/image', async (req: Request, res: Response) => {
  if (!isImageGenConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }
  const { brief, postId } = req.body as { brief?: string; postId?: string };
  if (!brief || typeof brief !== 'string' || !brief.trim()) {
    return res.status(400).json({ success: false, error: 'brief is required' });
  }
  try {
    const { url, public: isPublic } = await generateImage(req.user!.userId, brief.trim().slice(0, 600));
    if (postId) {
      const post = storage.getPostById(postId);
      if (post && post.userId === req.user!.userId) storage.updatePost(post.id, { imageUrl: url });
    }
    res.json({ success: true, data: { url, publicUrl: isPublic ? url : null } });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Génération échouée' });
  }
});

// ── POST /api/content/image/upload — héberge une image fournie (base64) ─────
router.post('/image/upload', async (req: Request, res: Response) => {
  const { imageBase64, postId } = req.body as { imageBase64?: string; postId?: string };
  if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length < 100) {
    return res.status(400).json({ success: false, error: 'imageBase64 is required' });
  }
  if (imageBase64.length > 12_000_000) {
    return res.status(400).json({ success: false, error: 'Image trop lourde (8 Mo max)' });
  }
  try {
    // Accepte un data-URL ou du base64 brut ; déduit l'extension du préfixe
    const b64 = imageBase64.startsWith('data:') ? imageBase64.slice(imageBase64.indexOf(',') + 1) : imageBase64;
    const mime = imageBase64.startsWith('data:') ? imageBase64.slice(5, imageBase64.indexOf(';')) : '';
    const ext = mime.split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png';
    // hostImage ne bloque jamais : repli local si freeimage.host échoue
    const { url, public: isPublic } = await hostImage(b64, ext);
    if (postId) {
      const post = storage.getPostById(postId);
      if (post && post.userId === req.user!.userId) storage.updatePost(post.id, { imageUrl: url });
    }
    res.json({ success: true, data: { url, publicUrl: isPublic ? url : null } });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Hébergement échoué' });
  }
});

// ── POST /api/content/video/upload — héberge une vidéo de l'utilisateur ─────
// Corps binaire STREAMÉ vers le disque : mémoire constante quelle que soit la
// taille (une petite machine encaisse des uploads de plusieurs Go). Stockée
// dans data/uploads (servie sur /uploads, purge à 90 jours). En production,
// APP_URL rend l'URL publique pour la publication sur les plateformes.
const VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};
// 3 Go : la vidéo n'est qu'un sas — supprimée automatiquement une fois
// récupérée par la plateforme (cleanupPublishedVideo)
const VIDEO_MAX_BYTES = 3 * 1024 * 1024 * 1024;

router.post('/video/upload', async (req: Request, res: Response) => {
  const ext = VIDEO_TYPES[String(req.headers['content-type'] || '').split(';')[0]];
  if (!ext) {
    return res.status(400).json({
      success: false,
      error: 'Envoyez la vidéo en corps binaire (Content-Type video/mp4, video/webm ou video/quicktime)',
    });
  }
  try {
    const { fileName, url, bytes } = await saveMediaStream(req, ext, VIDEO_MAX_BYTES);
    if (bytes < 1000) {
      deleteMediaFile(fileName);
      return res.status(400).json({ success: false, error: 'Fichier vidéo vide ou corrompu' });
    }
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    const publicUrl = appUrl ? `${appUrl}${url}` : null;
    const finalUrl = publicUrl ?? url;
    const postId = typeof req.query.postId === 'string' ? req.query.postId : null;
    if (postId) {
      const post = storage.getPostById(postId);
      if (post && post.userId === req.user!.userId) storage.updatePost(post.id, { imageUrl: finalUrl });
    }
    res.json({ success: true, data: { url: finalUrl, publicUrl } });
  } catch (err) {
    if (err instanceof Error && err.message === 'TOO_LARGE') {
      return res.status(413).json({ success: false, error: 'Vidéo trop lourde (3 Go max)' });
    }
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Enregistrement échoué' });
  }
});

export default router;
