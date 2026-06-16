/**
 * Analyse de performance — le « pourquoi », pas juste le « combien ».
 *
 *  - computeProjectStats : agrégats calculés sur VOS données (par plateforme,
 *    jour/heure, média vs texte, top/flop) + attribution post → leads (les
 *    contacts importés depuis un scan de post portent l'id court du post).
 *  - analyzePost : post-mortem IA d'un post publié (diagnostic + réécriture)
 *    qui extrait des enseignements réutilisables.
 *  - upsertLearnings : les enseignements alimentent la base de connaissances
 *    (catégorie « learnings »), injectée dans TOUTES les générations — la
 *    boucle analyse → apprentissage → meilleur contenu.
 *  - generateCampaignReport : rapport de campagne narratif (à la demande et
 *    chaque lundi sur Telegram).
 */

import { v4 as uuid } from 'uuid';
import { chatComplete, sanitizeJson, isAIConfigured } from './aiClient';
import { storage } from './storage';
import { Post, KnowledgeEntry, KnowledgeCategory } from '../types';

export { isAIConfigured };

const engagement = (p: Post): number | null =>
  p.impressions > 0 ? ((p.likes + p.comments + p.shares) / p.impressions) * 100 : null;

export interface ProjectStats {
  publishedCount: number;
  withMetricsCount: number;
  totals: { impressions: number; likes: number; comments: number; shares: number; clicks: number };
  avgEngagement: number | null;
  byPlatform: { platform: string; posts: number; impressions: number; avgEngagement: number | null; leads: number }[];
  byDay: { day: string; posts: number; avgEngagement: number | null }[];
  media: { withMedia: { posts: number; avgEngagement: number | null }; withoutMedia: { posts: number; avgEngagement: number | null } };
  topPosts: { id: string; title: string; platform: string; engagement: number; impressions: number; leads: number }[];
  flopPosts: { id: string; title: string; platform: string; engagement: number; impressions: number }[];
  leads: { total: number; fromPosts: number; hot: number; byPost: { postId: string; title: string; leads: number }[] };
  lastWeek: { posts: number; impressions: number; likes: number };
  previousWeek: { posts: number; impressions: number; likes: number };
  /** Groupes multi-plateformes : le MÊME contenu comparé d'une plateforme à l'autre */
  crossGroups: {
    title: string;
    posts: { postId: string; platform: string; impressions: number; likes: number; engagement: number | null }[];
    bestPlatform: string | null;
  }[];
}

const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Agrégats du projet — pur calcul local, aucun appel IA */
export function computeProjectStats(userId: string, planId: string | null): ProjectStats {
  const posts = storage.getPostsByPlan(userId, planId).filter((p) => p.status === 'published');
  const withMetrics = posts.filter((p) => p.impressions > 0);
  const contacts = storage.getContactsByPlan(userId, planId);

  // Attribution : source « réactions post [xxxxxxxx] … » → id court du post
  const leadsByShortId = new Map<string, number>();
  for (const c of contacts) {
    const m = c.source?.match(/post \[([0-9a-f]{8})\]/i);
    if (m) leadsByShortId.set(m[1], (leadsByShortId.get(m[1]) ?? 0) + 1);
  }
  const leadsFor = (p: Post) => leadsByShortId.get(p.id.slice(0, 8)) ?? 0;

  const avg = (arr: Post[]): number | null => {
    const rates = arr.map(engagement).filter((r): r is number => r !== null);
    return rates.length > 0 ? rates.reduce((s, r) => s + r, 0) / rates.length : null;
  };

  const platforms = [...new Set(posts.map((p) => p.platform))];
  const byPlatform = platforms.map((platform) => {
    const sub = posts.filter((p) => p.platform === platform);
    return {
      platform,
      posts: sub.length,
      impressions: sub.reduce((s, p) => s + p.impressions, 0),
      avgEngagement: avg(sub),
      leads: sub.reduce((s, p) => s + leadsFor(p), 0),
    };
  }).sort((a, b) => b.impressions - a.impressions);

  const byDay = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const sub = withMetrics.filter((p) => p.publishedAt && new Date(p.publishedAt).getDay() === d);
    return { day: DAY_NAMES[d], posts: sub.length, avgEngagement: avg(sub) };
  }).filter((d) => d.posts > 0);

  const withMedia = withMetrics.filter((p) => p.imageUrl);
  const withoutMedia = withMetrics.filter((p) => !p.imageUrl);

  const ranked = withMetrics
    .map((p) => ({ post: p, rate: engagement(p)! }))
    .sort((a, b) => b.rate - a.rate);

  const weekStats = (offsetDays: number) => {
    const end = Date.now() - offsetDays * 86400e3;
    const start = end - 7 * 86400e3;
    const sub = posts.filter((p) => {
      const t = p.publishedAt ? new Date(p.publishedAt).getTime() : 0;
      return t >= start && t < end;
    });
    return {
      posts: sub.length,
      impressions: sub.reduce((s, p) => s + p.impressions, 0),
      likes: sub.reduce((s, p) => s + p.likes, 0),
    };
  };

  // Multi-plateformes : groupes de cross-posts avec ≥ 2 exemplaires publiés —
  // la comparaison la plus propre qui soit (même contenu, seule la plateforme change)
  const byGroup = new Map<string, Post[]>();
  for (const p of posts) {
    if (p.crossPostId) byGroup.set(p.crossPostId, [...(byGroup.get(p.crossPostId) ?? []), p]);
  }
  const crossGroups = [...byGroup.values()]
    .filter((group) => group.length >= 2)
    .map((group) => {
      const entries = group.map((p) => ({
        postId: p.id, platform: p.platform,
        impressions: p.impressions, likes: p.likes,
        engagement: engagement(p) === null ? null : Math.round(engagement(p)! * 10) / 10,
      }));
      const best = [...entries]
        .filter((e) => e.engagement !== null || e.impressions > 0)
        .sort((a, b) => (b.engagement ?? -1) - (a.engagement ?? -1) || b.impressions - a.impressions)[0];
      return {
        title: group[0].title || '(sans titre)',
        posts: entries,
        bestPlatform: best?.platform ?? null,
      };
    })
    .sort((a, b) => b.posts.length - a.posts.length)
    .slice(0, 10);

  return {
    publishedCount: posts.length,
    withMetricsCount: withMetrics.length,
    totals: {
      impressions: posts.reduce((s, p) => s + p.impressions, 0),
      likes: posts.reduce((s, p) => s + p.likes, 0),
      comments: posts.reduce((s, p) => s + p.comments, 0),
      shares: posts.reduce((s, p) => s + p.shares, 0),
      clicks: posts.reduce((s, p) => s + p.clicks, 0),
    },
    avgEngagement: avg(withMetrics),
    byPlatform,
    byDay,
    media: {
      withMedia: { posts: withMedia.length, avgEngagement: avg(withMedia) },
      withoutMedia: { posts: withoutMedia.length, avgEngagement: avg(withoutMedia) },
    },
    topPosts: ranked.slice(0, 3).map(({ post, rate }) => ({
      id: post.id, title: post.title, platform: post.platform,
      engagement: Math.round(rate * 10) / 10, impressions: post.impressions, leads: leadsFor(post),
    })),
    flopPosts: ranked.slice(-2).reverse()
      .filter(({ rate }) => ranked.length > 3 && rate < (avg(withMetrics) ?? 0))
      .map(({ post, rate }) => ({
        id: post.id, title: post.title, platform: post.platform,
        engagement: Math.round(rate * 10) / 10, impressions: post.impressions,
      })),
    leads: {
      total: contacts.length,
      fromPosts: [...leadsByShortId.values()].reduce((s, n) => s + n, 0),
      hot: contacts.filter((c) => (c.interestScore ?? 0) >= 70).length,
      byPost: posts
        .map((p) => ({ postId: p.id, title: p.title, leads: leadsFor(p) }))
        .filter((x) => x.leads > 0)
        .sort((a, b) => b.leads - a.leads)
        .slice(0, 5),
    },
    lastWeek: weekStats(0),
    previousWeek: weekStats(7),
    crossGroups,
  };
}

/** Résumé compact des stats pour les prompts IA */
function statsForPrompt(stats: ProjectStats): string {
  const fmt = (n: number | null) => (n === null ? 'n/a' : `${n.toFixed(1)} %`);
  return [
    `Posts publiés : ${stats.publishedCount} (${stats.withMetricsCount} avec métriques) · engagement moyen : ${fmt(stats.avgEngagement)}`,
    `Totaux : ${stats.totals.impressions} vues · ${stats.totals.likes} likes · ${stats.totals.comments} commentaires · ${stats.totals.shares} partages`,
    `Par plateforme : ${stats.byPlatform.map((p) => `${p.platform} (${p.posts} posts, ${fmt(p.avgEngagement)}, ${p.leads} leads)`).join(' · ') || 'aucune'}`,
    `Par jour : ${stats.byDay.map((d) => `${d.day} ${fmt(d.avgEngagement)}`).join(' · ') || 'n/a'}`,
    `Avec média : ${fmt(stats.media.withMedia.avgEngagement)} (${stats.media.withMedia.posts} posts) vs sans : ${fmt(stats.media.withoutMedia.avgEngagement)} (${stats.media.withoutMedia.posts})`,
    `Top : ${stats.topPosts.map((p) => `« ${p.title} » (${p.platform}, ${p.engagement} %, ${p.leads} leads)`).join(' · ') || 'n/a'}`,
    `Leads : ${stats.leads.total} au total, dont ${stats.leads.fromPosts} attribués à des posts, ${stats.leads.hot} chauds (score ≥ 70)`,
    `Semaine écoulée : ${stats.lastWeek.posts} posts, ${stats.lastWeek.impressions} vues vs semaine précédente : ${stats.previousWeek.posts} posts, ${stats.previousWeek.impressions} vues`,
    ...(stats.crossGroups.length > 0 ? [
      `Multi-plateformes (MÊME contenu décliné — comparaison directe des plateformes) : ${stats.crossGroups.slice(0, 3).map((g) =>
        `« ${g.title} » → ${g.posts.map((p) => `${p.platform} ${p.engagement !== null ? `${p.engagement} %` : `${p.impressions} vues`}`).join(' vs ')}${g.bestPlatform ? ` (meilleure : ${g.bestPlatform})` : ''}`
      ).join(' · ')}`,
    ] : []),
  ].join('\n');
}

export interface PerformanceSeries {
  /** Performance des publications, agrégée par semaine (12 dernières) */
  weekly: { week: string; posts: number; impressions: number; likes: number; relImpressions: number | null; relLikes: number | null }[];
  /** Courbe temporelle réelle (instantanés de synchro, cumulés tous posts) */
  daily: { date: string; impressions: number; likes: number }[];
  hasHistory: boolean;
}

/** Séries pour les graphiques de la vue Performances (pur calcul local) */
export function computePerformanceSeries(userId: string, planId: string | null): PerformanceSeries {
  const posts = storage.getPostsByPlan(userId, planId)
    .filter((p) => p.status === 'published' && p.publishedAt);

  // ── Hebdomadaire : 12 dernières semaines, lundi comme borne ──
  const monday = (d: Date) => {
    const out = new Date(d);
    out.setHours(0, 0, 0, 0);
    out.setDate(out.getDate() - ((out.getDay() + 6) % 7));
    return out;
  };
  const thisMonday = monday(new Date());
  const weekly: PerformanceSeries['weekly'] = [];
  for (let i = 11; i >= 0; i--) {
    const start = new Date(thisMonday.getTime() - i * 7 * 86400e3);
    const end = new Date(start.getTime() + 7 * 86400e3);
    const sub = posts.filter((p) => {
      const t = new Date(p.publishedAt!).getTime();
      return t >= start.getTime() && t < end.getTime();
    });
    weekly.push({
      week: start.toISOString().slice(0, 10),
      posts: sub.length,
      impressions: sub.reduce((s2, p) => s2 + p.impressions, 0),
      likes: sub.reduce((s2, p) => s2 + p.likes, 0),
      relImpressions: null,
      relLikes: null,
    });
  }
  // Progression relative (%) vs semaine précédente non nulle
  for (let i = 1; i < weekly.length; i++) {
    const prev = weekly[i - 1];
    if (prev.impressions > 0) weekly[i].relImpressions = Math.round(((weekly[i].impressions - prev.impressions) / prev.impressions) * 100);
    if (prev.likes > 0)       weekly[i].relLikes       = Math.round(((weekly[i].likes - prev.likes) / prev.likes) * 100);
  }
  // On coupe les semaines vides en tête pour ne pas écraser le graphique
  const firstActive = weekly.findIndex((w) => w.posts > 0);
  const trimmedWeekly = firstActive > 0 ? weekly.slice(Math.max(0, firstActive - 1)) : weekly;

  // ── Quotidien : instantanés de synchro, report de la dernière valeur ──
  const snaps = storage.getMetricSnapshots(userId, planId);
  const days = [...new Set(snaps.map((s2) => s2.at.slice(0, 10)))].sort();
  const latestPerPost = new Map<string, { impressions: number; likes: number }>();
  const daily: PerformanceSeries['daily'] = [];
  let cursor = 0;
  for (const date of days) {
    while (cursor < snaps.length && snaps[cursor].at.slice(0, 10) <= date) {
      latestPerPost.set(snaps[cursor].postId, { impressions: snaps[cursor].impressions, likes: snaps[cursor].likes });
      cursor += 1;
    }
    let impressions = 0;
    let likes = 0;
    for (const v of latestPerPost.values()) { impressions += v.impressions; likes += v.likes; }
    daily.push({ date, impressions, likes });
  }

  return { weekly: trimmedWeekly, daily, hasHistory: daily.length >= 2 };
}

// ── Commentaires des posts (contenu réel, regroupé par type de post) ─────────

export interface CommentStatsEntry {
  platform: string;
  total: number;
  comments: { author: string | null; text: string; likeCount: number; commentedAt: string | null }[];
}

export interface CommentStats {
  total: number;
  /** Regroupés par plateforme (type de post), du plus commenté au moins commenté */
  byPlatform: CommentStatsEntry[];
}

/** Agrégat local des commentaires récupérés, groupés par plateforme — aucun appel IA */
export function computeCommentStats(userId: string, planId: string | null): CommentStats {
  const comments = storage.getPostCommentsByPlan(userId, planId);
  const platforms = [...new Set(comments.map((c) => c.platform))];
  const byPlatform = platforms.map((platform) => {
    const sub = comments.filter((c) => c.platform === platform);
    return {
      platform,
      total: sub.length,
      comments: sub.slice(0, 100).map((c) => ({
        author: c.author, text: c.text, likeCount: c.likeCount, commentedAt: c.commentedAt,
      })),
    };
  }).sort((a, b) => b.total - a.total);
  return { total: comments.length, byPlatform };
}

export type CommentSentiment = 'positif' | 'mitigé' | 'négatif' | 'n/a';

export interface CommentAnalysis {
  byPlatform: { platform: string; total: number; sentiment: CommentSentiment; summary: string; themes: string[] }[];
  overall: string;
}

/**
 * Lecture IA des commentaires récupérés : sentiment + thèmes récurrents PAR
 * plateforme (type de post). Les enseignements alimentent la boucle
 * d'apprentissage existante (fiche « learnings » du projet).
 */
export async function analyzeComments(userId: string, planId: string | null): Promise<CommentAnalysis> {
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');
  const stats = computeCommentStats(userId, planId);
  if (stats.total === 0) {
    return {
      byPlatform: [],
      overall: 'Aucun commentaire récupéré pour ce projet — synchronisez les métriques d\'un post publié pour en récupérer les commentaires.',
    };
  }

  // Digest compact (borné) par plateforme pour le prompt
  const digest = stats.byPlatform.map((p) => {
    const lines = p.comments.slice(0, 30)
      .map((c) => `- ${c.author ? `@${c.author}: ` : ''}${c.text.replace(/\s+/g, ' ').slice(0, 300)}`)
      .join('\n');
    return `### ${p.platform} (${p.total} commentaires)\n${lines}`;
  }).join('\n\n');

  const result = await chatComplete({
    messages: [
      {
        role: 'system',
        content: `Tu es un analyste social media. On te donne les commentaires reçus sur les posts d'un fondateur, groupés par plateforme. Pour CHAQUE plateforme, dégage le sentiment dominant et les thèmes récurrents — concret, honnête, sans jargon, en français. N'invente rien : appuie-toi uniquement sur les commentaires fournis.
Réponds UNIQUEMENT avec un objet JSON :
{"byPlatform":[{"platform":"<nom exact>","sentiment":"positif|mitigé|négatif","summary":"1-2 phrases sur ce que disent les gens","themes":["thème court", "..."]}],"overall":"2-3 phrases : la tendance générale et ce qu'il faut en retenir","learnings":["enseignement actionnable et généralisable (max 2)"]}`,
      },
      { role: 'user', content: digest.slice(0, 8000) },
    ],
    maxTokens: 1200,
    jsonMode: true,
  });

  const parsed = JSON.parse(sanitizeJson(result.content));
  const fromModel: any[] = Array.isArray(parsed.byPlatform) ? parsed.byPlatform : [];
  const byPlatform = stats.byPlatform.map((p) => {
    const m = fromModel.find((x) => String(x?.platform).toLowerCase() === p.platform.toLowerCase());
    const sentiment: CommentSentiment = ['positif', 'mitigé', 'négatif'].includes(String(m?.sentiment))
      ? (m.sentiment as CommentSentiment) : 'n/a';
    return {
      platform: p.platform,
      total: p.total,
      sentiment,
      summary: typeof m?.summary === 'string' ? m.summary.slice(0, 500) : '',
      themes: Array.isArray(m?.themes) ? m.themes.map((t: unknown) => String(t).slice(0, 80)).slice(0, 6) : [],
    };
  });

  const learnings: string[] = Array.isArray(parsed.learnings)
    ? parsed.learnings.map((l: unknown) => String(l)).slice(0, 2) : [];
  if (learnings.length > 0) upsertLearnings(userId, planId, learnings);

  return { byPlatform, overall: typeof parsed.overall === 'string' ? parsed.overall.slice(0, 800) : '' };
}

const LEARNINGS_TITLE = '📈 Enseignements de performance (auto)';
const NEWS_TITLE = '📰 Veille — actus utilisées par l\'IA (auto)';
const MAX_AUTO_LINES = 25;

/**
 * Fusionne des lignes dans UNE fiche auto-entretenue de la base de
 * connaissances (dédupliquée par début de phrase, bornée, plus récent en tête).
 */
function upsertAutoEntry(
  userId: string, planId: string | null,
  category: KnowledgeCategory, title: string, lines: string[],
): number {
  const clean = lines.map((l) => l.replace(/^[-•]\s*/, '').trim()).filter((l) => l.length > 8);
  if (clean.length === 0) return 0;

  const existing = storage.getKnowledgeByPlan(userId, planId)
    .find((e) => e.category === category && e.title === title);

  const current = existing
    ? existing.content.split('\n').map((l) => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
    : [];
  // Déduplication approximative : même début de phrase = même information
  const key = (l: string) => l.toLowerCase().slice(0, 40);
  const seen = new Set(current.map(key));
  const added = clean.filter((l) => !seen.has(key(l)));
  if (added.length === 0) return 0;

  const merged = [...added, ...current].slice(0, MAX_AUTO_LINES);
  const content = merged.map((l) => `- ${l}`).join('\n');
  const now = new Date().toISOString();

  if (existing) {
    storage.updateKnowledge(existing.id, { content });
  } else {
    const entry: KnowledgeEntry = {
      id: uuid(), userId, planId, category,
      title, content, createdAt: now, updatedAt: now,
    };
    storage.saveKnowledge(entry);
  }
  return added.length;
}

/**
 * Fusionne des enseignements dans la fiche « learnings » du projet (une seule
 * fiche, dédupliquée, bornée) — injectée ensuite dans toutes les générations.
 */
export function upsertLearnings(userId: string, planId: string | null, lines: string[]): number {
  return upsertAutoEntry(userId, planId, 'learnings', LEARNINGS_TITLE, lines);
}

/**
 * Archive les faits d'actualité utilisés par l'IA dans une fiche « 📰 Veille »
 * du projet (opt-in par série récurrente) — visibles et éditables par
 * l'utilisateur dans la vue Connaissances, réinjectés dans les générations.
 */
export function upsertNewsArchive(userId: string, planId: string | null, facts: string[]): number {
  const dated = facts.map((f) => `${new Date().toLocaleDateString('fr-FR')} — ${f}`);
  return upsertAutoEntry(userId, planId, 'news', NEWS_TITLE, dated);
}

export interface PostAnalysis {
  analysis: string;
  learnings: string[];
}

/** Post-mortem IA d'un post publié : pourquoi, et quoi refaire */
export async function analyzePost(userId: string, post: Post): Promise<PostAnalysis> {
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');
  const stats = computeProjectStats(userId, post.planId);
  const rate = engagement(post);

  const result = await chatComplete({
    messages: [
      {
        role: 'system',
        content: `Tu es un analyste social media senior. Tu expliques POURQUOI un post a performé (ou pas) et ce qu'il faut refaire — concret, honnête, sans jargon. Tu réponds dans la langue du post (français par défaut).
Méthode : compare le post aux moyennes du projet, examine l'accroche (1re ligne), la longueur, la structure, le média, le jour/heure de publication, le sujet. Si les métriques sont à zéro, dis-le (probablement pas encore synchronisées) et analyse quand même le contenu.
Réponds UNIQUEMENT avec un objet JSON :
{"analysis": "diagnostic en markdown : ## Verdict (1 phrase), ## Pourquoi (3-4 puces), ## À refaire / éviter (2-3 puces), ## Réécriture suggérée de l'accroche (1 proposition)", "learnings": ["enseignement généralisable et actionnable (max 2, seulement si le post a assez de données — sinon tableau vide)"]}`,
      },
      {
        role: 'user',
        content: `## Le post à analyser
Plateforme : ${post.platform} · Publié : ${post.publishedAt ?? 'n/a'} · Média : ${post.imageUrl ? 'oui' : 'non'}
Métriques : ${post.impressions} vues · ${post.likes} likes · ${post.comments} commentaires · ${post.shares} partages · ${post.clicks} clics · engagement ${rate === null ? 'n/a' : `${rate.toFixed(1)} %`} · ${computeLeadsForPost(userId, post)} lead(s) attribué(s)

--- Contenu ---
${post.content.slice(0, 2000)}
${crossPostContext(post)}
## Référentiel du projet
${statsForPrompt(stats)}`,
      },
    ],
    maxTokens: 1500,
    jsonMode: true,
  });

  const parsed = JSON.parse(sanitizeJson(result.content));
  const learnings: string[] = Array.isArray(parsed.learnings)
    ? parsed.learnings.map((l: unknown) => String(l)).slice(0, 2)
    : [];
  // Boucle d'apprentissage : les enseignements rejoignent la base de connaissances
  if (learnings.length > 0) upsertLearnings(userId, post.planId, learnings);

  return { analysis: String(parsed.analysis || 'Analyse vide'), learnings };
}

/**
 * Contexte multi-plateformes pour le post-mortem : le MÊME contenu publié
 * ailleurs est le meilleur point de comparaison qui existe (seule la
 * plateforme change) — l'IA doit en tirer des conclusions plateforme vs contenu.
 */
function crossPostContext(post: Post): string {
  if (!post.crossPostId) return '';
  const siblings = storage.getCrossPostGroup(post.crossPostId)
    .filter((p) => p.id !== post.id && p.status === 'published');
  if (siblings.length === 0) return '';
  const lines = siblings.map((p) => {
    const r = engagement(p);
    return `- ${p.platform} : ${p.impressions} vues · ${p.likes} likes · ${p.comments} commentaires · engagement ${r === null ? 'n/a' : `${r.toFixed(1)} %`}`;
  });
  return `\n## Le MÊME contenu sur d'autres plateformes (comparaison directe — distingue ce qui relève de la plateforme de ce qui relève du contenu)\n${lines.join('\n')}\n`;
}

function computeLeadsForPost(userId: string, post: Post): number {
  const short = post.id.slice(0, 8);
  return storage.getContactsByPlan(userId, post.planId)
    .filter((c) => c.source?.includes(`post [${short}]`)).length;
}

/** Rapport de campagne narratif (Analyse du Hub + digest Telegram du lundi) */
export async function generateCampaignReport(userId: string): Promise<{ report: string; stats: ProjectStats }> {
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');
  const planId = storage.getActivePlanId(userId);
  const stats = computeProjectStats(userId, planId);
  const project = storage.getActivePlan(userId);

  if (stats.publishedCount === 0) {
    return {
      report: '## Pas encore de données\nAucun post publié sur ce projet — publiez vos premiers contenus et le rapport s\'écrira tout seul.',
      stats,
    };
  }

  const result = await chatComplete({
    messages: [
      {
        role: 'system',
        content: `Tu es le CMO de poche d'un fondateur. Tu écris un rapport de campagne court, honnête et ACTIONNABLE en markdown — pas un dashboard déguisé en texte. Tu écris en français, tu tutoies.
Structure imposée :
## L'essentiel (2 phrases max : la tendance et LE fait marquant)
## Ce qui marche (2-3 puces, avec les chiffres)
## Ce qui ne marche pas (1-2 puces, franches)
## Posts → leads (le pipeline généré, ou comment en générer si zéro)
## À faire cette semaine (3 recommandations concrètes et priorisées)
Si les données sont maigres (< 5 posts avec métriques), dis-le et concentre les recommandations sur « publier plus pour apprendre ». N'invente AUCUN chiffre.`,
      },
      {
        role: 'user',
        content: `Projet : ${project?.input.productName ?? 'n/a'} (${project?.input.niche ?? ''})\n\n${statsForPrompt(stats)}`,
      },
    ],
    maxTokens: 1200,
  });

  const report = result.content.trim();
  // Archive l'analyse pour pouvoir la relire plus tard (historique par projet)
  storage.saveCampaignReport({
    id: uuid(),
    userId,
    planId,
    report,
    createdAt: new Date().toISOString(),
  });
  return { report, stats };
}

// ── Rapport hebdomadaire automatique (Telegram, le lundi) ────────────────────

let weeklyTimer: NodeJS.Timeout | null = null;

/** Envoie le rapport aux utilisateurs éligibles. Sender injectable (tests). */
export async function dispatchWeeklyReports(
  now: Date = new Date(),
  notify?: (userId: string, text: string) => Promise<void>,
): Promise<number> {
  if (now.getDay() !== 1) return 0; // le lundi uniquement
  if (!isAIConfigured()) return 0;
  // Import paresseux : évite un cycle telegramBot → analytics → telegramBot
  const send = notify ?? (await import('./telegramBot')).notifyLinkedChats;

  let sent = 0;
  for (const { userId } of storage.getUsersDueWeeklyReport(now.toISOString())) {
    try {
      const { report, stats } = await generateCampaignReport(userId);
      if (stats.publishedCount === 0) {
        storage.markWeeklyReportSent(userId, now.toISOString());
        continue;
      }
      await send(userId, `🗞️ Ton rapport de campagne hebdo\n\n${report.replace(/^#+\s*/gm, '').replace(/\*\*/g, '')}`);
      storage.markWeeklyReportSent(userId, now.toISOString());
      sent += 1;
    } catch { /* utilisateur suivant ; retentera le prochain tick */ }
  }
  return sent;
}

export function startWeeklyReports(): void {
  if (weeklyTimer) return;
  weeklyTimer = setInterval(() => {
    dispatchWeeklyReports().catch(() => { /* best-effort */ });
  }, 3 * 3600_000); // toutes les 3 h : couvre le lundi quel que soit le fuseau
  weeklyTimer.unref?.();
  console.log('🗞️  Rapports de campagne hebdomadaires armés (lundi, Telegram)');
}
