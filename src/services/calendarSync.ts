/**
 * Synchronisation des posts programmés vers le calendrier personnel de
 * l'utilisateur (Google Calendar / Outlook Calendar via le serveur MCP
 * Composio). Fire-and-forget : ne bloque jamais les routes.
 */

import { runMcpTask, isComposioConfigured } from './composio';
import { isAIConfigured } from './aiClient';
import { storage } from './storage';
import { listConnectedToolkits } from './composioConnect';
import { Post } from '../types';

/** Agendas synchronisables (toolkits Composio), par ordre de défaut. */
const CALENDAR_TOOLKITS = ['googlecalendar', 'outlook'];

/**
 * Mots-clés d'exposition des outils par fournisseur (filtre sur le préfixe du
 * toolkit). 'outlook' capte tout le toolkit Outlook (mail+agenda) : le tri de
 * priorité ['calendar','event'] fait ensuite remonter ses outils agenda.
 */
const PROVIDER_KEYWORDS: Record<string, string[]> = {
  googlecalendar: ['googlecalendar', 'calendar', 'calendrier'],
  outlook: ['outlook'],
};

// Repli quand on ne peut pas lister les comptes (pas de clé API Composio) : on
// expose les deux fournisseurs et le modèle choisit (comportement historique).
const ALL_CALENDAR_KEYWORDS = ['calendar', 'calendrier', 'event', 'outlook'];

/**
 * Mots-clés à exposer pour l'agenda de cet utilisateur :
 *  - 1 seul agenda connecté → le sien (déterministe) ;
 *  - 2 connectés → sa préférence (Configuration), sinon le premier par défaut ;
 *  - indéterminable (pas de clé API) → les deux (repli historique).
 */
async function resolveCalendarKeywords(userId: string): Promise<string[]> {
  if (!process.env.COMPOSIO_API_KEY) return ALL_CALENDAR_KEYWORDS;
  const connected = await listConnectedToolkits(userId);
  const available = CALENDAR_TOOLKITS.filter((c) => connected.has(c));
  if (available.length === 0) return ALL_CALENDAR_KEYWORDS; // runMcpTask échouera proprement
  if (available.length === 1) return PROVIDER_KEYWORDS[available[0]];
  const preferred = storage.getPreferredCalendar(userId);
  const chosen = preferred && available.includes(preferred) ? preferred : available[0];
  return PROVIDER_KEYWORDS[chosen];
}

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
    // Un lot = les posts d'UN utilisateur : son identité Composio s'applique.
    // On cible l'agenda choisi (déterministe si un seul connecté, sinon préférence).
    const keywords = await resolveCalendarKeywords(toSync[0].userId);
    const result = await runMcpTask(
      toSync[0].userId,
      keywords,
      `Tu es un assistant calendrier. Tu disposes des outils calendrier de l'utilisateur (Google Calendar / Outlook) via Composio.
Mission : créer UN événement par ligne fournie, dans le calendrier principal, avec exactement le titre, la date/heure de début (fournie en ISO UTC — laisse l'outil gérer le fuseau), la durée et la description indiquées. N'invente aucun autre événement.
Quand tous les événements sont créés, réponds "OK:" suivi du nombre créé. Si aucun outil calendrier n'est disponible ou si tout échoue, réponds "ECHEC:" avec la raison.
IMPÉRATIF : ta réponse finale commence par "OK:" ou "ECHEC:" — rien avant.`,
      `Crée ces ${toSync.length} événement(s) :\n${toSync.map(eventLine).join('\n')}`,
      // 'calendar' en tête : le tri de priorité teste le nom COMPLET de l'outil,
      // ce qui fait remonter les outils agenda (googlecalendar_*, outlook_calendar_*)
      // avant les outils mail/contacts d'Outlook — qui partagent le préfixe OUTLOOK
      // mais n'ont rien à faire ici (sinon ils satureraient les 30 outils exposés).
      ['calendar', 'event'],
    );

    // Anti-hallucination : OK exige au moins une création réellement exécutée
    const ok = result.reply.trim().toUpperCase().startsWith('OK') && result.okCalls > 0;
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
