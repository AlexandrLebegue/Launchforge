/**
 * Worker de publication automatique.
 *
 * Toutes les minutes : publie via Composio les posts programmés dont l'heure
 * est passée ET qui ont l'option « publication automatique » activée (opt-in
 * par post — garde-fou contre toute publication non voulue).
 *
 * En cas d'échec, l'option est désactivée sur le post et l'erreur est
 * enregistrée (publishError) pour éviter de réessayer en boucle à chaque
 * tick (chaque tentative coûte un appel modèle) — l'utilisateur voit
 * l'erreur dans le Hub et republie manuellement ou réactive l'option.
 */

import { storage } from './storage';
import { publishViaComposio, resolvePublishedUrl, isComposioConfigured } from './composio';
import { isAIConfigured } from './aiClient';
import { markPublished, cleanupPublishedVideo } from './postPublisher';
import { syncPostsToCalendarInBackground } from './calendarSync';

const TICK_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
const inFlight = new Set<string>();

type PublishFn = (userId: string, platform: string, content: string, imageUrl?: string | null, title?: string, subreddit?: string | null) => Promise<string>;

/**
 * Traite les posts dus. Le publieur est injectable pour les tests.
 * Retourne le nombre de posts publiés avec succès.
 */
export async function processDuePosts(
  now: Date = new Date(),
  publish: PublishFn = publishViaComposio,
): Promise<number> {
  const due = storage.getDueAutoPublishPosts(now.toISOString());
  let published = 0;

  for (const post of due) {
    if (inFlight.has(post.id)) continue;
    inFlight.add(post.id);

    try {
      // L'image part en paramètre média de l'outil de publication (et plus en
      // texte collé dans le contenu — Instagram & co l'exigent en vrai média)
      const result = await publish(post.userId, post.platform, post.content, post.imageUrl, post.title, post.subreddit);

      // Re-vérifie l'état : l'utilisateur a pu publier/supprimer entre-temps
      const fresh = storage.getPostById(post.id);
      if (!fresh || fresh.status !== 'scheduled') continue;

      if (result.trim().toUpperCase().startsWith('OK')) {
        const { next } = markPublished(fresh);
        // URL cliquable du post créé (reconstruite si besoin) : l'utilisateur
        // peut constater le résultat depuis le Hub et les métriques se
        // synchronisent sans saisie manuelle.
        const url = resolvePublishedUrl(fresh.platform, result);
        if (url) storage.updatePost(fresh.id, { externalUrl: url });
        // La plateforme a récupéré la vidéo : on libère le disque du serveur
        cleanupPublishedVideo(storage.getPostById(fresh.id)!);
        published += 1;
        // La prochaine occurrence d'un post récurrent hérite de l'auto-publish
        // et repart dans le calendrier personnel
        if (next) syncPostsToCalendarInBackground([next]);
        console.log(`📤 Auto-publié : "${fresh.title}" (${fresh.platform})`);
      } else {
        storage.updatePost(post.id, {
          autoPublish: 0,
          publishError: result.replace(/^ECHEC:\s*/i, '').slice(0, 500) || 'Publication refusée',
        });
        console.warn(`⚠️ Auto-publication échouée pour "${fresh.title}" — option désactivée`);
      }
    } catch (err) {
      storage.updatePost(post.id, {
        autoPublish: 0,
        publishError: (err instanceof Error ? err.message : 'Erreur inconnue').slice(0, 500),
      });
    } finally {
      inFlight.delete(post.id);
    }
  }

  return published;
}

/** Démarre le worker (no-op si Composio/IA ne sont pas configurés) */
export function startScheduler(): boolean {
  if (timer) return true;
  if (!isComposioConfigured() || !isAIConfigured()) {
    console.log('⏸️  Worker de publication inactif (COMPOSIO_MCP_URL ou OPENROUTER_API_KEY manquant)');
    return false;
  }
  timer = setInterval(() => {
    processDuePosts().catch((err) => console.error('Scheduler error:', err));
  }, TICK_MS);
  timer.unref?.();
  console.log('⏱️  Worker de publication automatique démarré (tick : 60 s)');
  return true;
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
