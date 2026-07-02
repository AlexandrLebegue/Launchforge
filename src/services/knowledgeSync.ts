/**
 * Mise à jour automatique de la base de connaissances.
 *
 * L'utilisateur déclare des SOURCES (dépôt GitHub, site/page web). Ce service
 * récupère leur contenu réel puis demande à l'IA d'en extraire des fiches à
 * créer/mettre à jour. Les propositions sont ensuite validées par l'utilisateur
 * (cf. /api/knowledge/sync/apply) — on n'écrit jamais la base sans son accord.
 *
 * Anti-hallucination : l'analyse ne porte QUE sur le texte réellement téléchargé.
 */

import { randomUUID } from 'crypto';
import * as cheerio from 'cheerio';
import { chatComplete, sanitizeJson, isAIConfigured } from './aiClient';
import { storage } from './storage';
import { composioUserIdFor } from './composioConnect';
import { executeComposioTool, ToolExecutor } from './composioDirect';
import { KnowledgeCategory, KnowledgeEntry, KnowledgeSource, KnowledgeSourceType, KnowledgeSuggestion } from '../types';

const UA = 'Mozilla/5.0 (compatible; LaunchForge/1.0; +https://launchforge.dev)';

export interface FetchedSource {
  type: KnowledgeSourceType;
  /** URL normalisée réellement récupérée */
  url: string;
  label: string;
  text: string;
}

// ── GitHub ────────────────────────────────────────────────────────────────────

function ghHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { 'User-Agent': 'LaunchForge', Accept: 'application/vnd.github+json', ...extra };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

/** Extrait owner/repo de formes variées : URL complète, github.com/x/y, x/y */
export function parseGitHubRepo(input: string): { owner: string; repo: string } | null {
  let s = (input || '').trim();
  if (!s) return null;
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/^github\.com\//i, '');
  s = s.replace(/[?#].*$/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const parts = s.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  return { owner: parts[0], repo: parts[1] };
}

export async function fetchGitHubKnowledge(url: string): Promise<FetchedSource> {
  const parsed = parseGitHubRepo(url);
  if (!parsed) throw new Error(`URL GitHub invalide (format attendu : github.com/utilisateur/depot)`);
  const { owner, repo } = parsed;
  const api = `https://api.github.com/repos/${owner}/${repo}`;

  const metaRes = await fetch(api, { headers: ghHeaders(), signal: AbortSignal.timeout(10000) });
  if (metaRes.status === 404) throw new Error(`Dépôt introuvable : ${owner}/${repo} (privé ou inexistant)`);
  if (metaRes.status === 403) throw new Error(`GitHub a limité les requêtes — réessayez plus tard (ou configurez GITHUB_TOKEN)`);
  if (!metaRes.ok) throw new Error(`GitHub a renvoyé ${metaRes.status} pour ${owner}/${repo}`);
  const meta = (await metaRes.json()) as any;

  // README en texte brut (facultatif)
  let readme = '';
  try {
    const r = await fetch(`${api}/readme`, {
      headers: ghHeaders({ Accept: 'application/vnd.github.raw' }),
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) readme = await r.text();
  } catch { /* README facultatif */ }

  // Dernières versions (changelog / actus) — facultatif
  let releases = '';
  try {
    const r = await fetch(`${api}/releases?per_page=3`, { headers: ghHeaders(), signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const rels = (await r.json()) as any[];
      releases = (rels || [])
        .map((rel) => `- ${rel.name || rel.tag_name} (${String(rel.published_at || '').slice(0, 10)}) : ${String(rel.body || '').slice(0, 500)}`)
        .join('\n');
    }
  } catch { /* facultatif */ }

  const text = [
    `Dépôt : ${meta.full_name}`,
    meta.description && `Description : ${meta.description}`,
    meta.homepage && `Site associé : ${meta.homepage}`,
    Array.isArray(meta.topics) && meta.topics.length ? `Sujets : ${meta.topics.join(', ')}` : '',
    meta.language && `Langage principal : ${meta.language}`,
    typeof meta.stargazers_count === 'number' ? `Étoiles : ${meta.stargazers_count}` : '',
    readme && `\n--- README ---\n${readme.slice(0, 12000)}`,
    releases && `\n--- Dernières versions ---\n${releases}`,
  ].filter(Boolean).join('\n');

  return { type: 'github', url, label: meta.full_name || `${owner}/${repo}`, text: text.slice(0, 16000) };
}

// ── Site web ──────────────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000), redirect: 'follow' });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct && !ct.includes('html') && !ct.includes('text')) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function htmlToText(html: string): { title: string; text: string } {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, nav, footer, header, iframe, form').remove();
  const title = $('title').text().trim();
  const metaDesc = $('meta[name="description"]').attr('content') || '';
  const body = $('body').text().replace(/\s+/g, ' ').trim();
  const text = [title && `Titre : ${title}`, metaDesc && `Description : ${metaDesc}`, body].filter(Boolean).join('\n');
  return { title, text };
}

/** Liens internes pertinents (à propos, tarifs, produit, fonctionnalités…) */
function relevantInternalLinks(html: string, pageUrl: string, origin: string, max = 3): string[] {
  const $ = cheerio.load(html);
  const wanted = ['about', 'a-propos', 'apropos', 'pricing', 'tarif', 'product', 'produit', 'features', 'fonctionnalit', 'service', 'solution'];
  const seen = new Set<string>([pageUrl.replace(/#.*$/, '')]);
  const links: string[] = [];
  $('a[href]').each((_, el) => {
    if (links.length >= max) return;
    const href = $(el).attr('href');
    if (!href) return;
    let abs: URL;
    try { abs = new URL(href, pageUrl); } catch { return; }
    if (abs.origin !== origin) return;
    const clean = abs.toString().replace(/#.*$/, '');
    if (seen.has(clean)) return;
    const key = (abs.pathname + abs.search).toLowerCase();
    if (wanted.some((w) => key.includes(w))) { seen.add(clean); links.push(clean); }
  });
  return links;
}

export async function fetchWebsiteKnowledge(rawUrl: string, crawl = false): Promise<FetchedSource> {
  let url = (rawUrl || '').trim();
  if (!url) throw new Error('URL de site web vide');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let origin: URL;
  try { origin = new URL(url); } catch { throw new Error(`URL de site invalide`); }

  const html = await fetchHtml(url);
  if (!html) throw new Error(`Page web inaccessible : ${url}`);
  const main = htmlToText(html);
  let text = main.text;

  if (crawl) {
    const links = relevantInternalLinks(html, url, origin.origin, 3);
    for (const link of links) {
      const h = await fetchHtml(link);
      if (!h) continue;
      text += `\n\n--- ${link} ---\n${htmlToText(h).text}`;
    }
  }

  if (!text.trim()) throw new Error(`Aucun texte exploitable sur ${url}`);
  return { type: 'website', url, label: main.title || origin.hostname, text: text.slice(0, 16000) };
}

// ── HubSpot (API Composio directe) ─────────────────────────────────────────────
//
// Lecture DÉTERMINISTE des objets HubSpot via l'API Composio (tools/execute,
// aucun appel modèle), sur l'identité Composio de l'utilisateur. Chaque bloc est
// ÉTIQUETÉ par catégorie cible pour que l'analyse IA range chaque fiche au bon
// endroit (société → company, produits → product/offers, deals → learnings…).
//
// ⚠️ HubSpot Composio n'expose PAS les articles du Service Hub (Knowledge Base) :
// le contenu éditorial le plus proche provient des emails marketing & campagnes.

interface HubSpotRead {
  slug: string;
  args: Record<string, unknown>;
  /** En-tête de section — oriente la catégorie attribuée par l'IA */
  section: string;
}

/** Lectures HubSpot retenues (slugs vérifiés contre la toolkit Composio live). */
const HUBSPOT_READS: HubSpotRead[] = [
  {
    slug: 'HUBSPOT_HUBSPOT_LIST_COMPANIES',
    section: 'Société (catégorie : company)',
    args: { limit: 25, properties: ['name', 'description', 'industry', 'domain', 'city', 'country'] },
  },
  {
    slug: 'HUBSPOT_HUBSPOT_HUBSPOT_LIST_PRODUCTS_WITH_PAGING',
    section: 'Produits & offres (catégorie : product / offers)',
    args: { limit: 50, properties: ['name', 'description', 'price', 'hs_sku'] },
  },
  {
    slug: 'HUBSPOT_HUBSPOT_LIST_DEALS',
    section: 'Deals / opportunités (catégorie : learnings)',
    args: { limit: 50, properties: ['dealname', 'dealstage', 'amount', 'description', 'pipeline'] },
  },
  {
    slug: 'HUBSPOT_GET_ALL_MARKETING_EMAILS_FOR_A_HUB_SPOT_ACCOUNT',
    section: 'Emails marketing (catégorie : tone / news / offers)',
    args: { limit: 20 },
  },
  {
    slug: 'HUBSPOT_LIST_FEEDBACK_SUBMISSIONS_PAGE',
    section: 'Retours clients (catégorie : audience / learnings)',
    args: { limit: 50, properties: ['hs_content', 'hs_survey_name', 'hs_value', 'hs_sentiment'] },
  },
];

// Clés techniques sans valeur éditoriale — exclues de l'aplatissement.
const HS_SKIP_KEYS = /^(hs_object_id|hs_lastmodifieddate|hs_createdate|createdate|lastmodifieddate|updatedat|createdat|id|archived)$/i;

/** Aplati une réponse HubSpot (forme `{results:[{properties}]}`) en lignes de texte. */
function flattenHubSpotRecords(data: any): string {
  const rows: any[] =
    Array.isArray(data?.results) ? data.results
      : Array.isArray(data?.objects) ? data.objects
        : Array.isArray(data?.items) ? data.items
          : Array.isArray(data) ? data
            : [];
  const lines: string[] = [];
  for (const row of rows.slice(0, 100)) {
    const props = row?.properties && typeof row.properties === 'object' ? row.properties : row;
    if (!props || typeof props !== 'object') continue;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === '' || HS_SKIP_KEYS.test(k)) continue;
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (val.trim()) parts.push(`${k}: ${val.slice(0, 500)}`);
    }
    if (parts.length) lines.push(`- ${parts.join(' | ')}`);
  }
  return lines.join('\n');
}

/**
 * Récupère le contenu HubSpot de l'utilisateur via l'API Composio directe.
 * Une lecture qui échoue (objet absent, droit manquant) est ignorée ; on ne lève
 * une erreur que si AUCUN bloc n'a pu être lu (HubSpot non connecté / compte vide).
 * `execute` est injectable pour les tests (pas d'appel réseau).
 */
export async function fetchHubSpotKnowledge(
  ownerUserId: string,
  execute: ToolExecutor = executeComposioTool,
): Promise<FetchedSource> {
  const cuid = composioUserIdFor(ownerUserId);
  if (!cuid) throw new Error('HubSpot non connecté — connectez-le depuis la vue Configuration');

  const sections: string[] = [];
  const failures: string[] = [];
  for (const r of HUBSPOT_READS) {
    try {
      const data = await execute(cuid, r.slug, r.args);
      const block = flattenHubSpotRecords(data);
      if (block.trim()) sections.push(`### ${r.section}\n${block}`);
    } catch (e) {
      failures.push(e instanceof Error ? e.message : 'échec');
    }
  }

  if (sections.length === 0) {
    throw new Error(
      failures.length
        ? `Aucune donnée HubSpot exploitable (${failures[0].slice(0, 160)})`
        : 'Aucune donnée HubSpot exploitable — vérifiez le compte connecté',
    );
  }
  return { type: 'hubspot', url: 'hubspot', label: 'HubSpot', text: sections.join('\n\n=====\n\n').slice(0, 16000) };
}

// ── Analyse IA → propositions de fiches ──────────────────────────────────────

const CATEGORIES: KnowledgeCategory[] = ['company', 'product', 'audience', 'tone', 'offers', 'learnings', 'news', 'other'];

const SUGGESTION_SPEC = `Réponds UNIQUEMENT avec un objet JSON :
{"suggestions": [{
  "action": "create" | "update",
  "targetId": "id EXACT d'une fiche existante à mettre à jour, sinon null",
  "category": "company" | "product" | "audience" | "tone" | "offers" | "learnings" | "news" | "other",
  "title": "titre court et clair",
  "content": "contenu factuel rédigé, prêt à être réutilisé par l'IA (pas de markdown lourd)",
  "source": "libellé court de la source d'origine (dépôt ou site)",
  "reason": "1 phrase : ce que la fiche apporte ou ce qui a changé"
}]}

Règles impératives :
- Base-toi EXCLUSIVEMENT sur le contenu fourni des sources. N'invente AUCUN fait.
- Utilise "update" (avec le targetId exact) quand une fiche existante traite déjà du sujet ; sinon "create".
- Ne propose une mise à jour QUE si elle ajoute une information réellement nouvelle — ne reproduis pas une fiche identique.
- Rédige des fiches autonomes et concises (3 à 8 phrases), en français.
- Choisis la catégorie la plus juste ("news" pour nouveautés/versions récentes).
- suggestions = [] si les sources n'apportent rien d'exploitable.`;

function parseSuggestions(raw: string, existing: KnowledgeEntry[]): KnowledgeSuggestion[] {
  let parsed: any;
  try {
    parsed = JSON.parse(sanitizeJson(raw));
  } catch {
    // Le modèle a répondu en prose (outil indispo, refus…) : on remonte son texte.
    throw new Error(raw.replace(/^[\s*_#>`]+/, '').slice(0, 250) || 'Réponse illisible du modèle');
  }
  const list = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  const validIds = new Set(existing.map((e) => e.id));
  const out: KnowledgeSuggestion[] = [];
  for (const s of list) {
    if (!s || typeof s.title !== 'string' || typeof s.content !== 'string') continue;
    const title = s.title.trim();
    const content = s.content.trim();
    if (!title || !content) continue;
    let action: 'create' | 'update' = s.action === 'update' ? 'update' : 'create';
    const targetId: string | null = typeof s.targetId === 'string' && validIds.has(s.targetId) ? s.targetId : null;
    if (action === 'update' && !targetId) action = 'create'; // cible invalide → création
    out.push({
      action,
      targetId,
      category: CATEGORIES.includes(s.category) ? s.category : 'other',
      title: title.slice(0, 200),
      content: content.slice(0, 8000),
      source: typeof s.source === 'string' ? s.source.slice(0, 120) : '',
      reason: typeof s.reason === 'string' ? s.reason.slice(0, 300) : '',
    });
  }
  return out;
}

/** Analyse les sources récupérées et propose des fiches (create/update). */
export async function analyzeSourcesForKnowledge(
  ownerUserId: string,
  planId: string | null,
  fetched: FetchedSource[],
): Promise<KnowledgeSuggestion[]> {
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');
  if (fetched.length === 0) throw new Error('Aucune source exploitable n\'a pu être récupérée');

  const existing = storage.getKnowledgeByPlan(ownerUserId, planId); // triées par updatedAt DESC
  // Borne l'inventaire des fiches (il grossit à chaque sync) pour ne pas évincer
  // le texte des sources du contexte du modèle — les plus récentes d'abord.
  let existingBlock = '';
  for (const e of existing) {
    const line = `- id=${e.id} [${e.category}] ${e.title}\n  ${e.content.slice(0, 200).replace(/\s+/g, ' ')}\n`;
    if (existingBlock.length + line.length > 10000) break;
    existingBlock += line;
  }
  if (!existingBlock) existingBlock = '(aucune fiche pour l\'instant)';

  const sourcesBlock = fetched
    .map((s) => `### Source (${s.type}) : ${s.label}\nURL : ${s.url}\n${s.text}`)
    .join('\n\n=====\n\n');

  const result = await chatComplete({
    messages: [
      {
        role: 'system',
        content: `Tu enrichis la base de connaissances d'une entreprise à partir de ses sources officielles (dépôt de code, site web). Tu en extrais des faits durables et utiles pour produire du contenu marketing fidèle à la réalité.\n\n${SUGGESTION_SPEC}`,
      },
      {
        role: 'user',
        content: `## Fiches existantes (pour décider create vs update — réutilise leur id pour une mise à jour)\n${existingBlock}\n\n## Contenu des sources à analyser\n${sourcesBlock.slice(0, 40000)}`,
      },
    ],
    maxTokens: 4000,
    jsonMode: true,
  });

  return parseSuggestions(result.content, existing);
}

// ── Application des propositions à la base ─────────────────────────────────────

const sameProject = (a: string | null, b: string | null) => (a ?? null) === (b ?? null);

/**
 * Écrit les propositions dans la base du projet (create/update). Partagé par la
 * validation manuelle (route /sync/apply) et la mise à jour automatique.
 * Les fiches d'un autre projet/propriétaire ne sont jamais touchées.
 */
export function applySuggestionsToKnowledge(
  ownerUserId: string,
  planId: string | null,
  suggestions: KnowledgeSuggestion[],
): KnowledgeEntry[] {
  const applied: KnowledgeEntry[] = [];
  const now = new Date().toISOString();

  for (const s of suggestions) {
    const title = typeof s?.title === 'string' ? s.title.trim() : '';
    const content = typeof s?.content === 'string' ? s.content.trim() : '';
    if (!title || !content) continue;
    const category: KnowledgeCategory = CATEGORIES.includes(s.category) ? s.category : 'other';

    // Mise à jour d'une fiche existante du même projet
    if (s.action === 'update' && typeof s.targetId === 'string') {
      const existing = storage.getKnowledgeById(s.targetId);
      if (existing && existing.userId === ownerUserId && sameProject(existing.planId, planId)) {
        storage.updateKnowledge(existing.id, { title, content, category });
        const updated = storage.getKnowledgeById(existing.id);
        if (updated) applied.push(updated);
        continue;
      }
      // cible invalide / autre projet → on bascule en création
    }

    const entry: KnowledgeEntry = {
      id: randomUUID(), userId: ownerUserId, planId,
      category, title: title.slice(0, 200), content: content.slice(0, 8000),
      createdAt: now, updatedAt: now,
    };
    storage.saveKnowledge(entry);
    applied.push(entry);
  }

  return applied;
}

// ── Cycle complet : récupération → analyse → application ───────────────────────

/** Récupérateurs/analyseur injectables (tests : pas de réseau ni d'IA) */
export interface SyncDeps {
  fetchGitHub?: (url: string) => Promise<FetchedSource>;
  fetchWebsite?: (url: string, crawl: boolean) => Promise<FetchedSource>;
  fetchHubSpot?: (ownerUserId: string) => Promise<FetchedSource>;
  analyze?: (ownerUserId: string, planId: string | null, fetched: FetchedSource[]) => Promise<KnowledgeSuggestion[]>;
}

export interface SyncSourcesResult {
  applied: KnowledgeEntry[];
  /** Ids des sources réellement récupérées (à horodater par l'appelant) */
  syncedSourceIds: string[];
  errors: { id: string; url: string; error: string }[];
}

/**
 * Récupère le contenu réel des sources, demande à l'IA d'en extraire des fiches
 * et les applique directement à la base. Utilisé par la mise à jour manuelle
 * « maintenant » et par le worker automatique. N'horodate PAS les sources :
 * l'appelant décide (le worker marque avant pour éviter les boucles de retry).
 */
export async function syncSourcesNow(
  ownerUserId: string,
  planId: string | null,
  sources: KnowledgeSource[],
  crawl = false,
  deps: SyncDeps = {},
): Promise<SyncSourcesResult> {
  const fetchGh = deps.fetchGitHub ?? fetchGitHubKnowledge;
  const fetchWeb = deps.fetchWebsite ?? fetchWebsiteKnowledge;
  const fetchHub = deps.fetchHubSpot ?? fetchHubSpotKnowledge;
  const analyze = deps.analyze ?? analyzeSourcesForKnowledge;

  const fetched: FetchedSource[] = [];
  const syncedSourceIds: string[] = [];
  const errors: { id: string; url: string; error: string }[] = [];

  for (const src of sources) {
    try {
      const f = src.type === 'github' ? await fetchGh(src.url)
        : src.type === 'hubspot' ? await fetchHub(ownerUserId)
          : await fetchWeb(src.url, crawl);
      fetched.push(f);
      syncedSourceIds.push(src.id);
    } catch (e) {
      errors.push({ id: src.id, url: src.url, error: e instanceof Error ? e.message : 'Échec de récupération' });
    }
  }

  if (fetched.length === 0) return { applied: [], syncedSourceIds, errors };

  const suggestions = await analyze(ownerUserId, planId, fetched);
  const applied = applySuggestionsToKnowledge(ownerUserId, planId, suggestions);
  return { applied, syncedSourceIds, errors };
}
