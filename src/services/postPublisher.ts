/**
 * Publication d'un post (manuelle ou automatique) — logique partagée entre
 * la route POST /api/posts/:id/publish et le worker de publication.
 * Gère la création de la prochaine occurrence pour les posts récurrents.
 */

import { v4 as uuid } from 'uuid';
import { storage } from './storage';
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
 * Marque le post publié et, s'il est récurrent, crée la prochaine occurrence
 * programmée (même contenu, métriques à zéro, à re-synchroniser au calendrier).
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
    }
  }

  return { post: storage.getPostById(post.id)!, next };
}
