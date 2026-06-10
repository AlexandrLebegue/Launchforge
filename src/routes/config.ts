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
import { composioUserIdFor, createConnectLink } from '../services/composioConnect';
import { isTelegramConfigured, setUserBot, removeUserBot } from '../services/telegramBot';

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

// Cache court PAR identité Composio : l'appel REST est externe, et chaque
// utilisateur a ses propres comptes connectés.
const toolkitCache = new Map<string, { at: number; connected: Set<string> }>();

async function getConnectedToolkits(composioId: string | null, fresh = false): Promise<Set<string>> {
  const cacheKey = composioId ?? '__none__';
  const cached = toolkitCache.get(cacheKey);
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.connected;

  const connected = new Set<string>();
  if (process.env.COMPOSIO_API_KEY && composioId) {
    try {
      const res = await fetch(
        `https://backend.composio.dev/api/v3/connected_accounts?limit=100&user_ids=${encodeURIComponent(composioId)}`,
        {
          headers: { 'x-api-key': process.env.COMPOSIO_API_KEY },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (res.ok) {
        const data: any = await res.json();
        // Seuls les comptes ACTIFS de l'identité Composio du demandeur comptent
        for (const item of data?.items || []) {
          if (item?.status !== 'ACTIVE' || !item?.toolkit?.slug) continue;
          if (item?.user_id !== composioId) continue;
          connected.add(String(item.toolkit.slug).toLowerCase());
        }
      }
    } catch { /* on renvoie ce qu'on sait */ }
  }
  toolkitCache.set(cacheKey, { at: Date.now(), connected });
  return connected;
}

// ── GET /api/config/status ───────────────────────────────────────────────────
router.get('/status', async (req: Request, res: Response) => {
  // ?fresh=1 contourne le cache (polling après une connexion de compte)
  const connected = await getConnectedToolkits(composioUserIdFor(req.user!.userId), req.query.fresh === '1');
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
        configured: isTelegramConfigured(req.user!.userId),
        linked: storage.getTelegramLinksByUserId(req.user!.userId).length > 0,
        ownBot: Boolean(storage.getTelegramBot(req.user!.userId)),
        botUsername: storage.getTelegramBot(req.user!.userId)?.botName ?? null,
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
    const redirectUrl = await createConnectLink(req.user!.userId, toolkit.toLowerCase());
    // Le statut de CET utilisateur devra refléter la connexion dès l'autorisation
    toolkitCache.delete(composioUserIdFor(req.user!.userId) ?? '__none__');
    res.json({ success: true, data: { redirectUrl } });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Connexion impossible',
    });
  }
});

// ── Bot Telegram personnel ───────────────────────────────────────────────────
// Chaque utilisateur peut brancher SON bot (token @BotFather) : le serveur
// démarre un poller dédié et tous les échanges passent par ce bot.
router.patch('/telegram-bot', async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token || typeof token !== 'string' || !/^\d+:[\w-]{30,}$/.test(token.trim())) {
    return res.status(400).json({ success: false, error: 'Token invalide — format attendu : 123456789:ABC… (fourni par @BotFather)' });
  }
  try {
    const botName = await setUserBot(req.user!.userId, token.trim());
    res.json({ success: true, data: { ownBot: true, botUsername: botName } });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : 'Token refusé par Telegram',
    });
  }
});

router.delete('/telegram-bot', (req: Request, res: Response) => {
  removeUserBot(req.user!.userId);
  res.json({ success: true, data: { ownBot: false } });
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
