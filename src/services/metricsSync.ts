/**
 * Worker de synchronisation automatique des métriques.
 *
 * Toutes les 10 minutes : relit via Composio les métriques réelles (vues,
 * likes, commentaires, partages) des posts publiés dont l'URL est renseignée,
 * pour les utilisateurs qui ont activé la synchro (intervalle configurable
 * dans la vue Configuration, par utilisateur).
 *
 * Garde-fous de coût (chaque synchro = un appel modèle + outils MCP) :
 *  - plafond de posts traités par tick ;
 *  - posts publiés depuis plus de 30 jours ignorés (chiffres figés) ;
 *  - l'horodatage est posé AVANT l'appel : un échec attend la prochaine
 *    fenêtre d'intervalle au lieu de réessayer à chaque tick.
 */

import { storage } from './storage';
import { syncMetricsViaComposio, isComposioConfigured, SyncedMetrics } from './composio';
import { isAIConfigured } from './aiClient';

const TICK_MS = 10 * 60_000;
const MAX_PER_TICK = 5;

let timer: NodeJS.Timeout | null = null;

type SyncFn = (userId: string, platform: string, externalUrl: string, title: string) => Promise<SyncedMetrics>;

/**
 * Traite les posts dont la fenêtre de synchro est écoulée.
 * Le synchroniseur est injectable pour les tests.
 * Retourne le nombre de posts dont les métriques ont été mises à jour.
 */
export async function processDueMetricsSync(
  now: Date = new Date(),
  sync: SyncFn = syncMetricsViaComposio,
): Promise<number> {
  const due = storage.getMetricsSyncDuePosts(now.toISOString(), MAX_PER_TICK);
  let synced = 0;

  for (const post of due) {
    storage.markMetricsSynced(post.id, now.toISOString());
    try {
      const metrics = await sync(post.userId, post.platform, post.externalUrl!, post.title);
      if (metrics.found) {
        storage.updatePost(post.id, {
          impressions: metrics.impressions,
          likes:       metrics.likes,
          comments:    metrics.comments,
          shares:      metrics.shares,
          clicks:      metrics.clicks,
        });
        synced += 1;
        console.log(`📈 Métriques synchronisées : "${post.title}" (${post.platform})`);
      }
    } catch { /* prochaine fenêtre d'intervalle */ }
  }

  return synced;
}

/** Démarre le worker (no-op si Composio/IA ne sont pas configurés) */
export function startMetricsSync(): boolean {
  if (timer) return true;
  if (!isComposioConfigured() || !isAIConfigured()) return false;
  timer = setInterval(() => {
    processDueMetricsSync().catch((err) => console.error('MetricsSync error:', err));
  }, TICK_MS);
  timer.unref?.();
  console.log('📈 Worker de synchro des métriques démarré (tick : 10 min)');
  return true;
}

export function stopMetricsSync(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
