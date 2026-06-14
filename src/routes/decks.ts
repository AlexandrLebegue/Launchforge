/**
 * /api/decks — présentations Marp générées par l'IA (onglet Slides du Hub).
 *
 * Les routes /:id/html et /theme-preview s'ouvrent dans un nouvel onglet du
 * navigateur (pas de header Authorization possible) : elles acceptent le JWT
 * en query string (?token=…).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { requireAuth, verifyToken } from '../middleware/auth';
import { storage } from '../services/storage';
import {
  generateDeckMarkdown, renderDeckHtml, themeForUser, isAIConfigured, SAMPLE_DECK,
} from '../services/decks';
import { renderDeckGif, renderDeckMp4 } from '../services/deckMedia';
import { saveMediaFile } from '../services/mediaStore';
import { uploadPublicImage } from '../services/imageGen';

const router = Router();

/** Auth par header OU par ?token= (ouverture en nouvel onglet) */
function authHeaderOrQuery(req: Request, res: Response, next: NextFunction): void {
  const fromQuery = typeof req.query.token === 'string' ? req.query.token : null;
  const fromHeader = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? null;
  const token = fromHeader || fromQuery;
  if (!token) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' });
  }
}

// ── GET /api/decks ───────────────────────────────────────────────────────────
router.get('/', requireAuth, (req: Request, res: Response) => {
  const ctx = storage.resolveActiveProject(req.user!.userId);
  res.json({ success: true, data: storage.getDecksByPlan(ctx.ownerUserId, ctx.planId) });
});

// ── POST /api/decks — génération IA d'un deck ────────────────────────────────
router.post('/', requireAuth, async (req: Request, res: Response) => {
  if (!isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }
  const { brief, slides } = req.body as { brief?: string; slides?: number };
  if (!brief || typeof brief !== 'string' || !brief.trim()) {
    return res.status(400).json({ success: false, error: 'brief is required' });
  }

  const ctx = storage.resolveActiveProject(req.user!.userId);
  if (ctx.role === 'viewer') {
    return res.status(403).json({ success: false, error: 'Rôle Lecteur : génération non autorisée' });
  }

  try {
    const { title, markdown } = await generateDeckMarkdown(ctx.ownerUserId, brief.trim().slice(0, 1000), Number(slides) || 8);
    const deck = {
      id: uuid(),
      userId: ctx.ownerUserId,
      planId: ctx.planId,
      title,
      markdown,
      createdAt: new Date().toISOString(),
    };
    storage.saveDeck(deck);
    res.status(201).json({ success: true, data: { id: deck.id, title: deck.title, createdAt: deck.createdAt } });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Génération échouée' });
  }
});

// ── GET /api/decks/theme-preview — aperçu du thème courant ──────────────────
router.get('/theme-preview', authHeaderOrQuery, (req: Request, res: Response) => {
  const { theme, css } = themeForUser(req.user!.userId);
  res.type('html').send(renderDeckHtml(SAMPLE_DECK, theme, css));
});

// ── GET /api/decks/:id/html — présentation plein écran ──────────────────────
router.get('/:id/html', authHeaderOrQuery, (req: Request, res: Response) => {
  const deck = storage.getDeckById(req.params.id);
  if (!deck || !storage.accessRole(req.user!.userId, deck.planId, deck.userId)) {
    return res.status(404).json({ success: false, error: 'Deck not found' });
  }
  const { theme, css } = themeForUser(deck.userId);
  res.type('html').send(renderDeckHtml(deck.markdown, theme, css));
});

// ── GET /api/decks/:id/markdown — source Marp (réutilisable dans Marp CLI) ──
router.get('/:id/markdown', authHeaderOrQuery, (req: Request, res: Response) => {
  const deck = storage.getDeckById(req.params.id);
  if (!deck || !storage.accessRole(req.user!.userId, deck.planId, deck.userId)) {
    return res.status(404).json({ success: false, error: 'Deck not found' });
  }
  res.setHeader('Content-Disposition', `attachment; filename="deck-${deck.id.slice(0, 8)}.md"`);
  res.type('text/markdown').send(deck.markdown);
});

// ── POST /api/decks/:id/render — deck → GIF animé ou MP4 (fondus) ───────────
// Le média est stocké sur le serveur (/uploads, purge à 90 jours). Le GIF est
// aussi hébergé publiquement pour pouvoir être attaché/publié sur un post.
router.post('/:id/render', requireAuth, async (req: Request, res: Response) => {
  const deck = storage.getDeckById(req.params.id);
  const role = deck ? storage.accessRole(req.user!.userId, deck.planId, deck.userId) : null;
  if (!deck || !role) {
    return res.status(404).json({ success: false, error: 'Deck not found' });
  }
  if (role === 'viewer') {
    return res.status(403).json({ success: false, error: 'Rôle Lecteur : action non autorisée' });
  }
  const { format, postId } = req.body as { format?: string; postId?: string };
  if (format !== 'gif' && format !== 'mp4') {
    return res.status(400).json({ success: false, error: 'format must be gif or mp4' });
  }

  try {
    const { theme } = themeForUser(deck.userId);
    let url: string;
    let publicUrl: string | null = null;

    if (format === 'gif') {
      const gif = await renderDeckGif(deck.markdown, theme);
      url = saveMediaFile(gif, 'gif').url;
      try { publicUrl = await uploadPublicImage(gif.toString('base64')); } catch { /* le GIF local reste utilisable */ }
    } else {
      const mp4 = await renderDeckMp4(deck.markdown, theme);
      url = saveMediaFile(mp4, 'mp4').url;
    }

    if (postId && publicUrl) {
      const post = storage.getPostById(postId);
      if (post && storage.accessRole(req.user!.userId, post.planId, post.userId)) storage.updatePost(post.id, { imageUrl: publicUrl });
    }
    res.json({ success: true, data: { url, publicUrl } });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Rendu échoué' });
  }
});

// ── DELETE /api/decks/:id ────────────────────────────────────────────────────
router.delete('/:id', requireAuth, (req: Request, res: Response) => {
  const deck = storage.getDeckById(req.params.id);
  const role = deck ? storage.accessRole(req.user!.userId, deck.planId, deck.userId) : null;
  if (!deck || !role) {
    return res.status(404).json({ success: false, error: 'Deck not found' });
  }
  if (role === 'viewer') {
    return res.status(403).json({ success: false, error: 'Rôle Lecteur : action non autorisée' });
  }
  storage.deleteDeck(deck.id);
  res.json({ success: true, data: null });
});

export default router;
