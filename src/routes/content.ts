/**
 * /api/content — assistant IA de génération de contenu.
 * S'appuie sur la base de connaissances + le contexte entreprise du dernier plan.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { generateContent, isContentAssistantConfigured } from '../services/contentAssistant';

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

export default router;
