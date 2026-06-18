/**
 * Worker de mise à jour automatique de la base de connaissances.
 *
 * À intervalle régulier : relit le contenu réel des sources déclarées (dépôt
 * GitHub, site web) dont la fenêtre d'intervalle est écoulée, en extrait des
 * fiches via l'IA et les applique directement à la base — pour les
 * utilisateurs qui ont activé la mise à jour automatique (intervalle
 * configurable dans la vue Configuration, par utilisateur).
 *
 * Garde-fous de coût (chaque analyse = un appel modèle) :
 *  - plafond de sources traitées par tick ;
 *  - l'horodatage est posé AVANT l'appel : une source en échec attend la
 *    prochaine fenêtre d'intervalle au lieu de réessayer à chaque tick.
 *
 * Contrairement à la validation manuelle (review des propositions), la mise à
 * jour automatique applique sans relecture : l'activation de l'intervalle vaut
 * consentement (comme la synchro des métriques).
 */

import { storage } from './storage';
import { syncSourcesNow, SyncDeps } from './knowledgeSync';
import { isAIConfigured } from './aiClient';
import { isBrasier } from './entitlements';
import { KnowledgeSource } from '../types';

const TICK_MS = 30 * 60_000;
const MAX_PER_TICK = 3;

let timer: NodeJS.Timeout | null = null;

/**
 * Traite les sources dont la fenêtre de mise à jour est écoulée.
 * Les récupérateurs/analyseur sont injectables pour les tests.
 * Retourne le nombre de fiches créées/mises à jour.
 */
export async function processDueKnowledgeSync(
  now: Date = new Date(),
  deps: SyncDeps = {},
): Promise<number> {
  // Mise à jour auto de la base = fonctionnalité Brasier (chaque analyse = appel
  // IA) : on exclut les comptes Braise (sources non horodatées → reprises s'ils
  // repassent Brasier).
  const due = storage.getKnowledgeSyncDueSources(now.toISOString(), MAX_PER_TICK).filter((s) => isBrasier(s.userId));
  if (due.length === 0) return 0;

  // Horodate AVANT l'analyse : une source en échec attend la prochaine fenêtre
  // au lieu d'être retentée à chaque tick.
  for (const src of due) storage.markKnowledgeSourceSynced(src.id, now.toISOString());

  // Regroupe par projet (propriétaire + plan) : une seule analyse par projet
  // voit toutes ses sources dues d'un coup (meilleur arbitrage create/update).
  const groups = new Map<string, { ownerUserId: string; planId: string | null; sources: KnowledgeSource[] }>();
  for (const src of due) {
    const key = `${src.userId}::${src.planId ?? ''}`;
    const g = groups.get(key) ?? { ownerUserId: src.userId, planId: src.planId, sources: [] };
    g.sources.push(src);
    groups.set(key, g);
  }

  let applied = 0;
  for (const g of groups.values()) {
    try {
      const res = await syncSourcesNow(g.ownerUserId, g.planId, g.sources, false, deps);
      applied += res.applied.length;
      if (res.applied.length) {
        console.log(`📚 Base de connaissances enrichie : ${res.applied.length} fiche(s) depuis ${g.sources.length} source(s)`);
      }
    } catch (err) {
      console.error('KnowledgeSync error:', err instanceof Error ? err.message : err);
    }
  }

  return applied;
}

/** Démarre le worker (no-op si l'IA n'est pas configurée) */
export function startKnowledgeSync(): boolean {
  if (timer) return true;
  if (!isAIConfigured()) {
    console.log('⏸️  Mise à jour auto de la base de connaissances inactive (OPENROUTER_API_KEY manquant)');
    return false;
  }
  timer = setInterval(() => {
    processDueKnowledgeSync().catch((err) => console.error('KnowledgeSync error:', err));
  }, TICK_MS);
  timer.unref?.();
  console.log('📚 Worker de mise à jour de la base de connaissances démarré (tick : 30 min)');
  return true;
}

export function stopKnowledgeSync(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
