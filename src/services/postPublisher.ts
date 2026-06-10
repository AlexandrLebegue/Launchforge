/**
 * Publication d'un post (manuelle ou automatique) — logique partagée entre
 * la route POST /api/posts/:id/publish et le worker de publication.
 * Gère la création de la prochaine occurrence pour les posts récurrents.
 */

import { v4 as uuid } from 'uuid';
import { storage } from './storage';
import { isAIConfigured } from './aiClient';
import { generateContent } from './contentAssistant';
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
 * Régénère le contenu d'une occurrence récurrente à partir de son instruction
 * (recurrenceBrief). Best-effort en arrière-plan : en cas d'échec, l'occurrence
 * garde le contenu copié du post précédent — la publication n'est jamais bloquée.
 */
export function regenerateOccurrenceInBackground(next: Post): void {
  if (!next.recurrenceBrief || !isAIConfigured()) return;
  void generateContent({
    userId: next.userId,
    platform: next.platform,
    brief: next.recurrenceBrief,
  })
    .then((gen) => {
      // Le post a pu être modifié/supprimé entre-temps : ne pas écraser
      const fresh = storage.getPostById(next.id);
      if (!fresh || fresh.status === 'published') return;
      const tags = gen.hashtags.length > 0 ? `\n\n${gen.hashtags.map((h) => `#${h}`).join(' ')}` : '';
      storage.updatePost(next.id, {
        title: gen.title,
        content: gen.content + tags,
      });
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
