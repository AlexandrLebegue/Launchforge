/**
 * Synchronisation des posts programmés vers le calendrier personnel de
 * l'utilisateur (Google Calendar / Outlook Calendar via le serveur MCP
 * Composio). Fire-and-forget : ne bloque jamais les routes.
 */

import { runMcpTask, isComposioConfigured } from './composio';
import { isAIConfigured } from './aiClient';
import { storage } from './storage';
import { Post } from '../types';

const CALENDAR_KEYWORDS = ['calendar', 'calendrier', 'event'];

function eventLine(post: Post): string {
  const date = post.scheduledAt ? new Date(post.scheduledAt).toISOString() : '';
  const excerpt = post.content.replace(/\s+/g, ' ').slice(0, 160);
  return `- Titre : "📣 Publier sur ${post.platform} : ${post.title || 'post'}" | Début : ${date} | Durée : 30 minutes | Description : "${excerpt}${post.content.length > 160 ? '…' : ''} (LaunchForge)"`;
}

/**
 * Crée les événements calendrier pour un lot de posts programmés.
 * Marque calendarSynced=1 sur les posts traités si la création aboutit.
 */
export async function syncPostsToCalendar(posts: Post[]): Promise<boolean> {
  const toSync = posts.filter(
    (p) => p.status === 'scheduled' && p.scheduledAt && !p.calendarSynced
  );
  if (toSync.length === 0) return true;
  if (!isComposioConfigured() || !isAIConfigured()) return false;

  try {
    const reply = await runMcpTask(
      CALENDAR_KEYWORDS,
      `Tu es un assistant calendrier. Tu disposes des outils calendrier de l'utilisateur (Google Calendar / Outlook) via Composio.
Mission : créer UN événement par ligne fournie, dans le calendrier principal, avec exactement le titre, la date/heure de début (fournie en ISO UTC — laisse l'outil gérer le fuseau), la durée et la description indiquées. N'invente aucun autre événement.
Quand tous les événements sont créés, réponds "OK:" suivi du nombre créé. Si aucun outil calendrier n'est disponible ou si tout échoue, réponds "ECHEC:" avec la raison.`,
      `Crée ces ${toSync.length} événement(s) :\n${toSync.map(eventLine).join('\n')}`,
    );

    const ok = reply.trim().toUpperCase().startsWith('OK');
    if (ok) {
      for (const post of toSync) {
        storage.updatePost(post.id, { calendarSynced: 1 });
      }
    }
    return ok;
  } catch {
    return false;
  }
}

/** Variante fire-and-forget pour les routes (jamais bloquante, erreurs avalées) */
export function syncPostsToCalendarInBackground(posts: Post[]): void {
  if (!isComposioConfigured() || !isAIConfigured()) return;
  syncPostsToCalendar(posts).catch(() => { /* best-effort */ });
}
