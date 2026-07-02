/**
 * /api/config — état des connexions et réglages de publication.
 * Alimente la vue Configuration : ce qui est fonctionnel, ce qui ne l'est pas,
 * et où aller pour le connecter (dashboard Composio).
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { isAIConfigured, modelForUser } from '../services/aiClient';
import { isComposioConfigured } from '../services/mcpClient';
import { composioUserIdFor, createConnectLink, disconnectToolkit, NeedsOwnAppError } from '../services/composioConnect';
import { isTelegramConfigured, setUserBot, removeUserBot } from '../services/telegramBot';
import { verifyApolloKey } from '../services/apollo';
import { availableThemes, generateCustomTheme, CUSTOM_THEMES, BUILTIN_THEMES } from '../services/decks';
import { assertFeature, assertWithinUsage, recordUsage, Feature } from '../services/entitlements';
import { handleQuota } from '../middleware/quota';
import { upsertActivePlatforms } from '../services/analytics';

const router = Router();
router.use(requireAuth);

/** Vérifie une fonctionnalité réservée à Brasier ; renvoie true si bloquée (402 envoyé) */
function gate(req: Request, res: Response, feature: Feature): boolean {
  try { assertFeature(req.user!.userId, feature); return false; }
  catch (e) { handleQuota(res, e); return true; }
}

/** Toolkits mis en avant dans la configuration, avec la capacité qu'ils ouvrent */
const FEATURED_TOOLKITS = [
  { slug: 'linkedin',       name: 'LinkedIn',        capability: 'Publication LinkedIn' },
  { slug: 'twitter',        name: 'X / Twitter',     capability: 'Publication X + métriques + réactions' },
  { slug: 'instagram',      name: 'Instagram',       capability: 'Publication Instagram' },
  { slug: 'facebook',       name: 'Facebook',        capability: 'Publication Facebook' },
  { slug: 'gmail',          name: 'Gmail',           capability: 'Scan boîte mail + envoi d\'emails' },
  { slug: 'outlook',        name: 'Outlook',         capability: 'Scan boîte mail + envoi d\'emails + synchro agenda' },
  { slug: 'googlecalendar', name: 'Google Calendar', capability: 'Synchro de vos posts dans l\'agenda' },
  { slug: 'reddit',         name: 'Reddit',          capability: 'Publication Reddit' },
  { slug: 'youtube',        name: 'YouTube',         capability: 'Publication YouTube' },
  { slug: 'tiktok',         name: 'TikTok',          capability: 'Publication TikTok + import' },
  { slug: 'discord',        name: 'Discord',         capability: 'Messages Discord' },
  { slug: 'slack',          name: 'Slack',           capability: 'Messages Slack' },
  { slug: 'github',         name: 'GitHub',          capability: 'Publication GitHub (releases, discussions)' },
  { slug: 'hubspot',        name: 'HubSpot',         capability: 'Base de connaissances (société, produits, deals, emails)' },
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
  // Projet actif (perso ou d'équipe). Les comptes utilisés sont ceux du
  // PROPRIÉTAIRE du projet ; un membre non-propriétaire les voit en lecture seule.
  const ctx = storage.resolveActiveProject(req.user!.userId);
  const canManageAccounts = ctx.ownerUserId === req.user!.userId;
  const ownerName = canManageAccounts ? null : (storage.getUserById(ctx.ownerUserId)?.name || storage.getUserById(ctx.ownerUserId)?.email || 'le propriétaire');
  // ?fresh=1 contourne le cache (polling après une connexion de compte)
  const connected = await getConnectedToolkits(composioUserIdFor(ctx.ownerUserId), req.query.fresh === '1');
  // Le mode de publication est un réglage du projet actif (perso ou d'équipe)
  const agents = storage.getAgentsByPlan(ctx.ownerUserId, ctx.planId);
  const publishMode = agents.length > 0 && agents.every((a) => a.approvalMode === 'auto')
    ? 'auto'
    : 'manual';

  res.json({
    success: true,
    data: {
      ai: {
        configured: isAIConfigured(),
        // Modèle effectif du demandeur (premium Claude Opus pour l'offre PLUS)
        model: isAIConfigured() ? modelForUser(req.user!.userId) : null,
      },
      composio: {
        configured: isComposioConfigured() && Boolean(process.env.COMPOSIO_API_KEY),
        dashboardUrl: 'https://dashboard.composio.dev',
        // L'utilisateur courant peut-il connecter/déconnecter (= il est le propriétaire) ?
        canManage: canManageAccounts,
        ownerName,
        toolkits: FEATURED_TOOLKITS.map((t) => ({
          ...t,
          connected: connected.has(t.slug),
        })),
        // Agenda choisi pour la synchro des posts quand plusieurs sont connectés
        // (null = automatique : le seul agenda connecté est utilisé).
        preferredCalendar: storage.getPreferredCalendar(ctx.ownerUserId),
      },
      marp: {
        theme: storage.getMarpTheme(req.user!.userId).theme,
        hasCustomCss: Boolean(storage.getMarpTheme(req.user!.userId).customCss),
        themes: availableThemes(),
      },
      metricsSync: {
        // Intervalle de synchro automatique des métriques (minutes, 0 = off)
        intervalMinutes: storage.getMetricsSyncMinutes(req.user!.userId),
      },
      knowledgeSync: {
        // Intervalle de mise à jour auto de la base de connaissances (minutes, 0 = off)
        intervalMinutes: storage.getKnowledgeSyncMinutes(req.user!.userId),
      },
      telegram: {
        configured: isTelegramConfigured(req.user!.userId),
        linked: storage.getTelegramLinksByUserId(req.user!.userId).length > 0,
        ownBot: Boolean(storage.getTelegramBot(req.user!.userId)),
        botUsername: storage.getTelegramBot(req.user!.userId)?.botName ?? null,
      },
      apollo: {
        // Clé personnelle de l'utilisateur (jamais renvoyée) — enrichissement de contacts
        configured: Boolean(storage.getApolloApiKey(req.user!.userId)),
      },
      publishMode,
    },
  });
});

// ── POST /api/config/connect ─────────────────────────────────────────────────
// Prépare la connexion d'un compte (config d'auth + toolkit sur le serveur MCP)
// et renvoie le lien d'autorisation OAuth à ouvrir dans le navigateur.
// Certains toolkits (X/Twitter, TikTok) n'ont pas d'auth gérée par Composio :
// la route répond alors 409 NEEDS_OWN_APP avec les champs à fournir, et
// l'appel suivant porte `credentials` (identifiants de l'app développeur).
router.post('/connect', async (req: Request, res: Response) => {
  const { toolkit, credentials } = req.body as { toolkit?: string; credentials?: Record<string, unknown> };
  if (!toolkit || typeof toolkit !== 'string' || !/^[a-z0-9_-]{2,40}$/i.test(toolkit)) {
    return res.status(400).json({ success: false, error: 'toolkit is required' });
  }
  if (!isComposioConfigured() || !process.env.COMPOSIO_API_KEY) {
    return res.status(503).json({ success: false, error: 'COMPOSIO_NOT_CONFIGURED' });
  }
  if (gate(req, res, 'publish')) return; // connexion de comptes = offre Brasier
  // Sur un projet d'équipe, seuls les comptes du propriétaire sont utilisés
  if (storage.resolveActiveProject(req.user!.userId).ownerUserId !== req.user!.userId) {
    return res.status(403).json({ success: false, error: 'Les comptes de ce projet sont gérés par son propriétaire.' });
  }
  try {
    const redirectUrl = await createConnectLink(req.user!.userId, toolkit.toLowerCase(), credentials as Record<string, string> | undefined);
    // Le statut de CET utilisateur devra refléter la connexion dès l'autorisation
    toolkitCache.delete(composioUserIdFor(req.user!.userId) ?? '__none__');
    res.json({ success: true, data: { redirectUrl } });
  } catch (err) {
    if (err instanceof NeedsOwnAppError) {
      return res.status(409).json({
        success: false,
        error: err.message,
        code: err.code,
        fields: err.fields,
        callbackUrl: err.callbackUrl,
      });
    }
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Connexion impossible',
    });
  }
});

// ── POST /api/config/disconnect ──────────────────────────────────────────────
// Supprime les comptes connectés d'un toolkit pour l'utilisateur (chez
// Composio) — permet de re-autoriser proprement avec de nouveaux droits OAuth.
router.post('/disconnect', async (req: Request, res: Response) => {
  const { toolkit } = req.body as { toolkit?: string };
  if (!toolkit || typeof toolkit !== 'string' || !/^[a-z0-9_-]{2,40}$/i.test(toolkit)) {
    return res.status(400).json({ success: false, error: 'toolkit is required' });
  }
  if (!isComposioConfigured() || !process.env.COMPOSIO_API_KEY) {
    return res.status(503).json({ success: false, error: 'COMPOSIO_NOT_CONFIGURED' });
  }
  if (storage.resolveActiveProject(req.user!.userId).ownerUserId !== req.user!.userId) {
    return res.status(403).json({ success: false, error: 'Les comptes de ce projet sont gérés par son propriétaire.' });
  }
  try {
    const removed = await disconnectToolkit(req.user!.userId, toolkit.toLowerCase());
    toolkitCache.delete(composioUserIdFor(req.user!.userId) ?? '__none__');
    res.json({ success: true, data: { removed } });
  } catch (err) {
    res.status(502).json({
      success: false,
      error: err instanceof Error ? err.message : 'Déconnexion impossible',
    });
  }
});

// ── PATCH /api/config/calendar ────────────────────────────────────────────────
// Agenda à utiliser pour la synchro des posts quand PLUSIEURS sont connectés
// (googlecalendar / outlook). 'auto' = laisser LaunchForge décider (le seul
// connecté). Réglage du propriétaire du projet (comme la gestion des comptes).
router.patch('/calendar', (req: Request, res: Response) => {
  const { calendar } = req.body as { calendar?: string };
  if (!calendar || !['googlecalendar', 'outlook', 'auto'].includes(calendar)) {
    return res.status(400).json({ success: false, error: 'calendar must be googlecalendar, outlook or auto' });
  }
  const ctx = storage.resolveActiveProject(req.user!.userId);
  if (ctx.ownerUserId !== req.user!.userId) {
    return res.status(403).json({ success: false, error: 'Les comptes de ce projet sont gérés par son propriétaire.' });
  }
  const value = calendar === 'auto' ? null : calendar;
  storage.setPreferredCalendar(req.user!.userId, value);
  res.json({ success: true, data: { preferredCalendar: value } });
});

// ── POST /api/config/active-platforms ─────────────────────────────────────────
// Consigne dans la base de connaissances du projet actif les plateformes
// sociales actuellement CONNECTÉES (détectées côté serveur, pas de confiance au
// client) — pour que l'IA adapte ton et recommandations aux canaux réellement
// utilisés. Appelée après l'onboarding et à chaque (dé)connexion de compte.
const SOCIAL_PUBLISH_TOOLKITS = new Set(['linkedin', 'twitter', 'instagram', 'facebook', 'reddit', 'youtube', 'tiktok']);
router.post('/active-platforms', async (req: Request, res: Response) => {
  const ctx = storage.resolveActiveProject(req.user!.userId);
  if (ctx.ownerUserId !== req.user!.userId) {
    return res.status(403).json({ success: false, error: 'Les comptes de ce projet sont gérés par son propriétaire.' });
  }
  const connected = await getConnectedToolkits(composioUserIdFor(ctx.ownerUserId), true);
  const platforms = [...connected]
    .filter((slug) => SOCIAL_PUBLISH_TOOLKITS.has(slug))
    .map((slug) => FEATURED_TOOLKITS.find((t) => t.slug === slug)?.name ?? slug);
  const added = platforms.length > 0 ? upsertActivePlatforms(ctx.ownerUserId, ctx.planId, platforms) : 0;
  res.json({ success: true, data: { platforms, added } });
});

// ── Bot Telegram personnel ───────────────────────────────────────────────────
// Chaque utilisateur peut brancher SON bot (token @BotFather) : le serveur
// démarre un poller dédié et tous les échanges passent par ce bot.
router.patch('/telegram-bot', async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token || typeof token !== 'string' || !/^\d+:[\w-]{30,}$/.test(token.trim())) {
    return res.status(400).json({ success: false, error: 'Token invalide — format attendu : 123456789:ABC… (fourni par @BotFather)' });
  }
  if (gate(req, res, 'telegram')) return;
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

// ── Clé API Apollo.io personnelle ────────────────────────────────────────────
// L'utilisateur fournit SA clé (apollo.io › Settings › API keys) : les crédits
// d'enrichissement consommés sont les siens. Stockée chiffrée, jamais renvoyée.
router.patch('/apollo-key', async (req: Request, res: Response) => {
  const { key } = req.body as { key?: string };
  if (!key || typeof key !== 'string' || !/^[\w-]{10,100}$/.test(key.trim())) {
    return res.status(400).json({ success: false, error: 'Clé invalide — copiez-la depuis apollo.io › Settings › API keys' });
  }
  if (gate(req, res, 'leads')) return;
  try {
    if (!(await verifyApolloKey(key.trim()))) {
      return res.status(400).json({ success: false, error: 'Clé refusée par Apollo — vérifiez qu\'elle est active et copiée en entier' });
    }
    storage.setApolloApiKey(req.user!.userId, key.trim());
    res.json({ success: true, data: { configured: true } });
  } catch {
    res.status(502).json({ success: false, error: 'Impossible de vérifier la clé auprès d\'Apollo — réessayez' });
  }
});

router.delete('/apollo-key', (req: Request, res: Response) => {
  storage.setApolloApiKey(req.user!.userId, null);
  res.json({ success: true, data: { configured: false } });
});

// ── Thème Marp des présentations ─────────────────────────────────────────────
router.patch('/marp-theme', (req: Request, res: Response) => {
  const { theme } = req.body as { theme?: string };
  const valid = theme && (CUSTOM_THEMES[theme] || (BUILTIN_THEMES as readonly string[]).includes(theme) || theme === 'custom');
  if (!valid) {
    return res.status(400).json({ success: false, error: 'Unknown theme' });
  }
  if (theme === 'custom' && !storage.getMarpTheme(req.user!.userId).customCss) {
    return res.status(400).json({ success: false, error: 'Générez d\'abord votre thème IA (champ ci-dessous)' });
  }
  storage.setMarpTheme(req.user!.userId, theme!);
  res.json({ success: true, data: { theme } });
});

// L'IA fabrique un thème Marp sur mesure (CSS validé puis stocké)
router.post('/marp-theme/customize', async (req: Request, res: Response) => {
  if (!isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }
  const { instructions } = req.body as { instructions?: string };
  if (!instructions || typeof instructions !== 'string' || !instructions.trim()) {
    return res.status(400).json({ success: false, error: 'instructions is required' });
  }
  try {
    assertWithinUsage(req.user!.userId, 'ai_generation');
    const css = await generateCustomTheme(req.user!.userId, instructions.trim().slice(0, 600));
    recordUsage(req.user!.userId, 'ai_generation');
    storage.setMarpTheme(req.user!.userId, 'custom', css);
    res.json({ success: true, data: { theme: 'custom' } });
  } catch (err) {
    if (handleQuota(res, err)) return;
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Génération du thème échouée' });
  }
});

// ── PATCH /api/config/metrics-sync ───────────────────────────────────────────
// Intervalle de synchro automatique des métriques (0 = désactivée). Chaque
// synchro coûte un appel modèle : on borne entre 15 min et 7 jours.
router.patch('/metrics-sync', (req: Request, res: Response) => {
  if (gate(req, res, 'analytics')) return;
  const raw = Number((req.body as { intervalMinutes?: unknown }).intervalMinutes);
  if (!Number.isFinite(raw) || raw < 0) {
    return res.status(400).json({ success: false, error: 'intervalMinutes must be a positive number (0 = disabled)' });
  }
  const minutes = raw === 0 ? 0 : Math.max(15, Math.min(10080, Math.round(raw)));
  storage.setMetricsSyncMinutes(req.user!.userId, minutes);
  res.json({ success: true, data: { intervalMinutes: minutes } });
});

// ── PATCH /api/config/knowledge-sync ─────────────────────────────────────────
// Intervalle de mise à jour automatique de la base de connaissances (0 = off).
// Chaque mise à jour coûte un appel modèle ; les sources évoluent lentement :
// on borne entre 1 h et 30 jours.
router.patch('/knowledge-sync', (req: Request, res: Response) => {
  const raw = Number((req.body as { intervalMinutes?: unknown }).intervalMinutes);
  if (!Number.isFinite(raw) || raw < 0) {
    return res.status(400).json({ success: false, error: 'intervalMinutes must be a positive number (0 = disabled)' });
  }
  const minutes = raw === 0 ? 0 : Math.max(60, Math.min(43200, Math.round(raw)));
  storage.setKnowledgeSyncMinutes(req.user!.userId, minutes);
  res.json({ success: true, data: { intervalMinutes: minutes } });
});

// ── PATCH /api/config/publish-mode ───────────────────────────────────────────
// Réglage global : les contenus IA partent directement ou après validation.
router.patch('/publish-mode', (req: Request, res: Response) => {
  const { mode } = req.body as { mode?: string };
  if (mode !== 'auto' && mode !== 'manual') {
    return res.status(400).json({ success: false, error: 'mode must be auto or manual' });
  }
  const ctx = storage.resolveActiveProject(req.user!.userId);
  if (ctx.role === 'viewer') {
    return res.status(403).json({ success: false, error: 'Rôle Lecteur : action non autorisée' });
  }
  // Réglage propre au projet actif : les autres projets gardent le leur
  for (const agent of storage.getAgentsByPlan(ctx.ownerUserId, ctx.planId)) {
    storage.updateAgent(agent.id, { approvalMode: mode });
  }
  res.json({ success: true, data: { publishMode: mode } });
});

export default router;
