/**
 * Publication d'un post (manuelle ou automatique) — logique partagée entre
 * la route POST /api/posts/:id/publish et le worker de publication.
 * Gère la création de la prochaine occurrence pour les posts récurrents.
 */

import { v4 as uuid } from 'uuid';
import { storage } from './storage';
import { isAIConfigured } from './aiClient';
import { generateContent, GeneratedContent } from './contentAssistant';
import { upsertNewsArchive } from './analytics';
import { Post, Recurrence } from '../types';

/** Prochaine occurrence d'un post récurrent */
export function nextOccurrence(from: Date, recurrence: Recurrence): Date | null {
  const next = new Date(from);
  switch (recurrence) {
    case 'daily':    next.setDate(next.getDate() + 1);   return next;
    case 'weekly':   next.setDate(next.getDate() + 7);   return next;
    case 'biweekly': next.setDate(next.getDate() + 14);  return next;
    case 'monthly':  next.setMonth(next.getMonth() + 1); return next;
    default: return null;
  }
}

/**
 * Génère le contenu d'une occurrence selon les réglages IA de la série :
 * instruction (recurrenceBrief), accès à la base de connaissances, recherche
 * d'actualités, et mémoire de série (occurrences déjà publiées, à ne pas
 * répéter). Partagé entre le worker et le mode « simuler » de l'éditeur.
 */
export async function generateOccurrenceContent(post: Post): Promise<GeneratedContent> {
  if (!post.recurrenceBrief) throw new Error('NO_RECURRENCE_BRIEF');
  const seriesId = post.seriesId ?? post.id;
  const history = storage.getSeriesHistory(seriesId)
    .filter((p) => p.id !== post.id)
    .map((p) => ({ title: p.title, content: p.content }));
  return generateContent({
    userId: post.userId,
    platform: post.platform,
    brief: post.recurrenceBrief,
    useNews: Boolean(post.recurrenceUseNews),
    skipKnowledge: !post.recurrenceUseKnowledge,
    seriesHistory: history,
    collectNewsFacts: Boolean(post.recurrenceUpdateKb && post.recurrenceUseNews),
  });
}

/**
 * Régénère le contenu d'une occurrence récurrente à partir de son instruction
 * (recurrenceBrief). Best-effort en arrière-plan : en cas d'échec, l'occurrence
 * garde le contenu copié du post précédent — la publication n'est jamais bloquée.
 */
export function regenerateOccurrenceInBackground(next: Post): void {
  if (!next.recurrenceBrief || !isAIConfigured()) return;
  void generateOccurrenceContent(next)
    .then((gen) => {
      // Le post a pu être modifié/supprimé entre-temps : ne pas écraser
      const fresh = storage.getPostById(next.id);
      if (!fresh || fresh.status === 'published') return;
      const tags = gen.hashtags.length > 0 ? `\n\n${gen.hashtags.map((h) => `#${h}`).join(' ')}` : '';
      storage.updatePost(next.id, {
        title: gen.title,
        content: gen.content + tags,
      });
      // Opt-in : les actus utilisées sont archivées dans la fiche 📰 Veille
      if (next.recurrenceUpdateKb && gen.newsFacts && gen.newsFacts.length > 0) {
        upsertNewsArchive(next.userId, next.planId, gen.newsFacts);
      }
    })
    .catch((err) => {
      console.error(`⚠️  Régénération IA de l'occurrence ${next.id} échouée (contenu précédent conservé) :`, err instanceof Error ? err.message : err);
    });
}

/**
 * Marque le post publié et, s'il est récurrent, crée la prochaine occurrence
 * programmée (métriques à zéro, à re-synchroniser au calendrier). Si une
 * instruction de régénération est définie, l'IA réécrit le contenu en fond.
 */
export function markPublished(post: Post): { post: Post; next: Post | null } {
  const now = new Date();
  storage.updatePost(post.id, {
    status: 'published',
    publishedAt: now.toISOString(),
    publishError: null,
  });

  let next: Post | null = null;
  if (post.recurrence !== 'none') {
    const base = post.scheduledAt ? new Date(post.scheduledAt) : now;
    const nextDate = nextOccurrence(base, post.recurrence);
    if (nextDate) {
      // Si la date calculée est déjà passée (publication en retard), repartir d'aujourd'hui
      const scheduled = nextDate.getTime() > now.getTime() ? nextDate : nextOccurrence(now, post.recurrence)!;
      const ts = new Date().toISOString();
      next = {
        ...post,
        id:          uuid(),
        // Filiation : toutes les occurrences pointent vers le post d'origine
        seriesId:    post.seriesId ?? post.id,
        status:      'scheduled',
        scheduledAt: scheduled.toISOString(),
        publishedAt: null,
        externalUrl: null,
        publishError: null,
        calendarSynced: 0,
        impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0,
        createdAt:   ts,
        updatedAt:   ts,
      };
      storage.savePost(next);
      regenerateOccurrenceInBackground(next);
    }
  }

  return { post: storage.getPostById(post.id)!, next };
}
