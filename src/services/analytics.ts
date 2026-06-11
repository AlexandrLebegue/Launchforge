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
import { Post, KnowledgeEntry } from '../types';

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
  ].join('\n');
}

const LEARNINGS_TITLE = '📈 Enseignements de performance (auto)';
const MAX_LEARNING_LINES = 25;

/**
 * Fusionne des enseignements dans la fiche « learnings » du projet (une seule
 * fiche, dédupliquée, bornée) — injectée ensuite dans toutes les générations.
 */
export function upsertLearnings(userId: string, planId: string | null, lines: string[]): number {
  const clean = lines.map((l) => l.replace(/^[-•]\s*/, '').trim()).filter((l) => l.length > 8);
  if (clean.length === 0) return 0;

  const existing = storage.getKnowledgeByPlan(userId, planId)
    .find((e) => e.category === 'learnings' && e.title === LEARNINGS_TITLE);

  const current = existing
    ? existing.content.split('\n').map((l) => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
    : [];
  // Déduplication approximative : même début de phrase = même enseignement
  const key = (l: string) => l.toLowerCase().slice(0, 40);
  const seen = new Set(current.map(key));
  const added = clean.filter((l) => !seen.has(key(l)));
  if (added.length === 0) return 0;

  const merged = [...added, ...current].slice(0, MAX_LEARNING_LINES);
  const content = merged.map((l) => `- ${l}`).join('\n');
  const now = new Date().toISOString();

  if (existing) {
    storage.updateKnowledge(existing.id, { content });
  } else {
    const entry: KnowledgeEntry = {
      id: uuid(), userId, planId, category: 'learnings',
      title: LEARNINGS_TITLE, content, createdAt: now, updatedAt: now,
    };
    storage.saveKnowledge(entry);
  }
  return added.length;
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

  return { report: result.content.trim(), stats };
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
