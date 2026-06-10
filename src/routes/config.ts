/**
 * /api/config — état des connexions et réglages de publication.
 * Alimente la vue Configuration : ce qui est fonctionnel, ce qui ne l'est pas,
 * et où aller pour le connecter (dashboard Composio).
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { isAIConfigured, getModel } from '../services/aiClient';
import { isComposioConfigured } from '../services/mcpClient';
import { composioUserId, createConnectLink } from '../services/composioConnect';
import { isTelegramConfigured } from '../services/telegramBot';

const router = Router();
router.use(requireAuth);

/** Toolkits mis en avant dans la configuration, avec la capacité qu'ils ouvrent */
const FEATURED_TOOLKITS = [
  { slug: 'linkedin',       name: 'LinkedIn',        capability: 'Publication LinkedIn' },
  { slug: 'twitter',        name: 'X / Twitter',     capability: 'Publication X + métriques + réactions' },
  { slug: 'instagram',      name: 'Instagram',       capability: 'Publication Instagram' },
  { slug: 'facebook',       name: 'Facebook',        capability: 'Publication Facebook' },
  { slug: 'gmail',          name: 'Gmail',           capability: 'Scan boîte mail + envoi d\'emails' },
  { slug: 'googlecalendar', name: 'Google Calendar', capability: 'Synchro de vos posts dans l\'agenda' },
  { slug: 'reddit',         name: 'Reddit',          capability: 'Publication Reddit' },
  { slug: 'youtube',        name: 'YouTube',         capability: 'Publication YouTube' },
  { slug: 'discord',        name: 'Discord',         capability: 'Messages Discord' },
  { slug: 'slack',          name: 'Slack',           capability: 'Messages Slack' },
  { slug: 'github',         name: 'GitHub',          capability: 'Publication GitHub (releases, discussions)' },
];

// Cache court : l'appel REST Composio est externe
let toolkitCache: { at: number; connected: Set<string> } | null = null;

async function getConnectedToolkits(fresh = false): Promise<Set<string>> {
  if (!fresh && toolkitCache && Date.now() - toolkitCache.at < 60_000) return toolkitCache.connected;

  const connected = new Set<string>();
  if (process.env.COMPOSIO_API_KEY) {
    try {
      const res = await fetch('https://backend.composio.dev/api/v3/connected_accounts?limit=50', {
        headers: { 'x-api-key': process.env.COMPOSIO_API_KEY },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data: any = await res.json();
        // Seuls les comptes du user_id utilisé par le serveur MCP comptent :
        // une connexion faite sur le playground du dashboard (pg-test-…) est
        // ACTIVE chez Composio mais inutilisable par l'application.
        const appUserId = composioUserId();
        for (const item of data?.items || []) {
          if (item?.status !== 'ACTIVE' || !item?.toolkit?.slug) continue;
          if (appUserId && item?.user_id !== appUserId) continue;
          connected.add(String(item.toolkit.slug).toLowerCase());
        }
      }
    } catch { /* on renvoie ce qu'on sait */ }
  }
  toolkitCache = { at: Date.now(), connected };
  return connected;
}

// ── GET /api/config/status ───────────────────────────────────────────────────
router.get('/status', async (req: Request, res: Response) => {
  // ?fresh=1 contourne le cache (polling après une connexion de compte)
  const connected = await getConnectedToolkits(req.query.fresh === '1');
  // Le mode de publication est un réglage du projet actif
  const agents = storage.getAgentsByPlan(req.user!.userId, storage.getActivePlanId(req.user!.userId));
  const publishMode = agents.length > 0 && agents.every((a) => a.approvalMode === 'auto')
    ? 'auto'
    : 'manual';

  res.json({
    success: true,
    data: {
      ai: {
        configured: isAIConfigured(),
        model: isAIConfigured() ? getModel() : null,
      },
      composio: {
        configured: isComposioConfigured() && Boolean(process.env.COMPOSIO_API_KEY),
        dashboardUrl: 'https://dashboard.composio.dev',
        toolkits: FEATURED_TOOLKITS.map((t) => ({
          ...t,
          connected: connected.has(t.slug),
        })),
      },
      telegram: {
        configured: isTelegramConfigured(),
        linked: storage.getTelegramLinksByUserId(req.user!.userId).length > 0,
      },
      publishMode,
    },
  });
});

// ── POST /api/config/connect ─────────────────────────────────────────────────
// Prépare la connexion d'un compte (config d'auth + toolkit sur le serveur MCP)
// et renvoie le lien d'autorisation OAuth à ouvrir dans le navigateur.
router.post('/connect', async (req: Request, res: Response) => {
  const { toolkit } = req.body as { toolkit?: string };
  if (!toolkit || typeof toolkit !== 'string' || !/^[a-z0-9_-]{2,40}$/i.test(toolkit)) {
    return res.status(400).json({ success: false, error: 'toolkit is required' });
  }
  if (!isComposioConfigured() || !process.env.COMPOSIO_API_KEY) {
    return res.status(503).json({ success: false, error: 'COMPOSIO_NOT_CONFIGURED' });
  }
  try {
    const redirectUrl = await createConnectLink(toolkit.toLowerCase());
    // Le statut devra refléter la nouvelle connexion dès l'autorisation faite
    toolkitCache = null;
    res.json({ success: true, data: { redirectUrl } });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Connexion impossible',
    });
  }
});

// ── PATCH /api/config/publish-mode ───────────────────────────────────────────
// Réglage global : les contenus IA partent directement ou après validation.
router.patch('/publish-mode', (req: Request, res: Response) => {
  const { mode } = req.body as { mode?: string };
  if (mode !== 'auto' && mode !== 'manual') {
    return res.status(400).json({ success: false, error: 'mode must be auto or manual' });
  }
  // Réglage propre au projet actif : les autres projets gardent le leur
  for (const agent of storage.getAgentsByPlan(req.user!.userId, storage.getActivePlanId(req.user!.userId))) {
    storage.updateAgent(agent.id, { approvalMode: mode });
  }
  res.json({ success: true, data: { publishMode: mode } });
});

export default router;
