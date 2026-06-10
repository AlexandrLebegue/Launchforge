/**
 * /api/content — assistant IA de génération de contenu.
 * S'appuie sur la base de connaissances + le contexte entreprise du dernier plan.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { generateContent, isContentAssistantConfigured } from '../services/contentAssistant';
import { generateContentCalendar, clampParams } from '../services/calendarGenerator';
import { syncPostsToCalendarInBackground } from '../services/calendarSync';

const router = Router();
router.use(requireAuth);

router.post('/generate', async (req: Request, res: Response) => {
  if (!isContentAssistantConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }

  const { platform, brief, tone, baseContent } = req.body as {
    platform?: string;
    brief?: string;
    tone?: string;
    baseContent?: string;
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

export default router;
