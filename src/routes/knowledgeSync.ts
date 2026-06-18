/**
 * /api/knowledge/sources et /api/knowledge/sync — mise à jour automatique de la
 * base de connaissances à partir de sources déclarées (dépôt GitHub, site web).
 *
 * Ce routeur est monté AVANT ./knowledge sur le même préfixe : il ne capte que
 * les chemins /sources… et /sync… ; tout le reste retombe sur le routeur des
 * fiches (CRUD). Les actions d'écriture sont interdites au rôle Lecteur.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { isAIConfigured } from '../services/aiClient';
import {
  fetchGitHubKnowledge, fetchWebsiteKnowledge, analyzeSourcesForKnowledge,
  applySuggestionsToKnowledge, syncSourcesNow,
  parseGitHubRepo, FetchedSource,
} from '../services/knowledgeSync';
import { assertWithinUsage, recordUsage } from '../services/entitlements';
import { handleQuota } from '../middleware/quota';
import { KnowledgeSourceType } from '../types';

const router = Router();
router.use(requireAuth);

type Ctx = { planId: string | null; ownerUserId: string; role: string };

/** Contexte projet + garde « pas de Lecteur » pour les écritures. */
function writableCtx(req: Request, res: Response): Ctx | null {
  const ctx = storage.resolveActiveProject(req.user!.userId);
  if (ctx.role === 'viewer') {
    res.status(403).json({ success: false, error: 'Rôle Lecteur : action non autorisée' });
    return null;
  }
  return ctx;
}

const sameProject = (a: string | null, b: string | null) => (a ?? null) === (b ?? null);

/** Forme canonique d'une URL de source — pour dédoublonner des saisies équivalentes
 *  (github.com/x/y == https://github.com/x/y == x/y ; trailing slash, etc.). */
function canonicalUrl(type: KnowledgeSourceType, url: string): string {
  if (type === 'github') {
    const p = parseGitHubRepo(url);
    return p ? `github.com/${p.owner}/${p.repo}` : url.trim();
  }
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try { return new URL(u).toString(); } catch { return u; }
}

// ── Sources déclarées ─────────────────────────────────────────────────────────

router.get('/sources', (req: Request, res: Response) => {
  const ctx = storage.resolveActiveProject(req.user!.userId);
  res.json({ success: true, data: storage.getKnowledgeSources(ctx.ownerUserId, ctx.planId) });
});

router.post('/sources', (req: Request, res: Response) => {
  const ctx = writableCtx(req, res); if (!ctx) return;
  const body = req.body as { type?: unknown; url?: unknown; label?: unknown };
  const type: KnowledgeSourceType | null =
    body.type === 'github' ? 'github' : body.type === 'website' ? 'website' : null;
  const url = String(body.url ?? '').trim();
  if (!type) return res.status(400).json({ success: false, error: 'Type de source invalide (github ou website)' });
  if (!url) return res.status(400).json({ success: false, error: 'URL requise' });
  if (type === 'github' && !parseGitHubRepo(url)) {
    return res.status(400).json({ success: false, error: 'URL GitHub invalide (ex. github.com/utilisateur/depot)' });
  }
  const label = String(body.label ?? '').trim().slice(0, 120);
  const src = storage.upsertKnowledgeSource(ctx.ownerUserId, ctx.planId, type, canonicalUrl(type, url), label);
  res.status(201).json({ success: true, data: src });
});

router.delete('/sources/:id', (req: Request, res: Response) => {
  const ctx = writableCtx(req, res); if (!ctx) return;
  const src = storage.getKnowledgeSourceById(req.params.id);
  if (!src || src.userId !== ctx.ownerUserId || !sameProject(src.planId, ctx.planId)) {
    return res.status(404).json({ success: false, error: 'Source introuvable' });
  }
  storage.deleteKnowledgeSource(src.id);
  res.json({ success: true, data: null });
});

// ── Analyse (récupération + IA) ────────────────────────────────────────────────

router.post('/sync/analyze', async (req: Request, res: Response) => {
  const ctx = writableCtx(req, res); if (!ctx) return;
  const body = req.body as { github?: unknown; website?: unknown; crawl?: unknown; sourceIds?: unknown };
  const github = String(body.github ?? '').trim();
  const website = String(body.website ?? '').trim();
  const crawl = Boolean(body.crawl);
  const sourceIds = Array.isArray(body.sourceIds) ? body.sourceIds.map((x) => String(x)) : [];

  // Liste des récupérations à effectuer (sourceId connu = source déjà enregistrée)
  const tasks: { type: KnowledgeSourceType; url: string; sourceId?: string }[] = [];
  if (github) tasks.push({ type: 'github', url: canonicalUrl('github', github) });
  if (website) tasks.push({ type: 'website', url: canonicalUrl('website', website) });
  for (const id of sourceIds) {
    const src = storage.getKnowledgeSourceById(id);
    if (src && src.userId === ctx.ownerUserId && sameProject(src.planId, ctx.planId)) {
      tasks.push({ type: src.type, url: canonicalUrl(src.type, src.url), sourceId: src.id });
    }
  }
  // Dédoublonnage par type+url
  const seen = new Set<string>();
  const unique = tasks.filter((t) => {
    const k = `${t.type}::${t.url}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });

  if (unique.length === 0) {
    return res.status(400).json({ success: false, error: 'Indiquez au moins une source (GitHub ou site web)' });
  }
  if (!isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'IA non configurée (OPENROUTER_API_KEY manquante)' });
  }
  try { assertWithinUsage(req.user!.userId, 'ai_generation'); }
  catch (e) { if (handleQuota(res, e)) return; throw e; }

  const fetched: FetchedSource[] = [];
  const errors: { url: string; error: string }[] = [];
  const now = new Date().toISOString();

  for (const t of unique) {
    try {
      const f = t.type === 'github'
        ? await fetchGitHubKnowledge(t.url)
        : await fetchWebsiteKnowledge(t.url, crawl);
      fetched.push(f);
      // Mémorise la source (et l'horodate) pour pouvoir la re-synchroniser ensuite
      if (t.sourceId) {
        storage.markKnowledgeSourceSynced(t.sourceId, now);
      } else {
        // t.url est canonique → l'upsert retrouve la source au lieu d'en dupliquer
        const src = storage.upsertKnowledgeSource(ctx.ownerUserId, ctx.planId, f.type, t.url, f.label);
        storage.markKnowledgeSourceSynced(src.id, now);
      }
    } catch (e) {
      errors.push({ url: t.url, error: e instanceof Error ? e.message : 'Échec de récupération' });
    }
  }

  if (fetched.length === 0) {
    const detail = errors.map((e) => `${e.url} : ${e.error}`).join(' ; ');
    return res.status(502).json({ success: false, error: detail || 'Aucune source n\'a pu être récupérée' });
  }

  try {
    const suggestions = await analyzeSourcesForKnowledge(ctx.ownerUserId, ctx.planId, fetched);
    recordUsage(req.user!.userId, 'ai_generation');
    res.json({
      success: true,
      data: {
        suggestions,
        fetched: fetched.map((f) => ({ type: f.type, url: f.url, label: f.label, chars: f.text.length })),
        errors,
      },
    });
  } catch (e) {
    res.status(502).json({ success: false, error: e instanceof Error ? e.message : 'Analyse impossible' });
  }
});

// ── Application des propositions validées par l'utilisateur ─────────────────────

router.post('/sync/apply', (req: Request, res: Response) => {
  const ctx = writableCtx(req, res); if (!ctx) return;
  const suggestions = Array.isArray((req.body as any).suggestions) ? (req.body as any).suggestions : [];
  if (suggestions.length === 0) {
    return res.status(400).json({ success: false, error: 'Aucune fiche à intégrer' });
  }
  const applied = applySuggestionsToKnowledge(ctx.ownerUserId, ctx.planId, suggestions);
  res.json({ success: true, data: { applied } });
});

// ── Mise à jour « maintenant » : analyse + application automatiques ─────────────
// Récupère les sources enregistrées du projet actif, en extrait des fiches via
// l'IA et les applique directement (même cycle que le worker automatique). À
// déclencher manuellement depuis la base de connaissances ; la planification se
// règle dans Configuration.
router.post('/sync/run', async (req: Request, res: Response) => {
  const ctx = writableCtx(req, res); if (!ctx) return;
  if (!isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'IA non configurée (OPENROUTER_API_KEY manquante)' });
  }
  const crawl = Boolean((req.body as { crawl?: unknown }).crawl);
  const sources = storage.getKnowledgeSources(ctx.ownerUserId, ctx.planId);
  if (sources.length === 0) {
    return res.status(400).json({ success: false, error: 'Aucune source enregistrée — ajoutez-en dans Configuration.' });
  }
  try { assertWithinUsage(req.user!.userId, 'ai_generation'); }
  catch (e) { if (handleQuota(res, e)) return; throw e; }

  try {
    const now = new Date().toISOString();
    const { applied, syncedSourceIds, errors } = await syncSourcesNow(ctx.ownerUserId, ctx.planId, sources, crawl);
    recordUsage(req.user!.userId, 'ai_generation');
    for (const id of syncedSourceIds) storage.markKnowledgeSourceSynced(id, now);
    res.json({ success: true, data: { applied, errors, syncedAt: syncedSourceIds.length ? now : null } });
  } catch (e) {
    res.status(502).json({ success: false, error: e instanceof Error ? e.message : 'Mise à jour impossible' });
  }
});

export default router;
