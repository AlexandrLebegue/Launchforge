/**
 * Purge de l'historique des conversations avec l'assistant.
 *
 * Rétention : un mois. Toute conversation inactive (aucun message) depuis plus
 * de RETENTION_DAYS jours est supprimée. Le nettoyage tourne au démarrage puis
 * une fois par jour (même schéma que le nettoyage des médias).
 */

import { storage } from './storage';

export const RETENTION_DAYS = 30;

/** Supprime les conversations inactives depuis plus de RETENTION_DAYS. Retourne le nombre purgé. */
export function purgeOldConversations(now: Date = new Date()): number {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 3600_000).toISOString();
  const removed = storage.deleteExpiredConversations(cutoff);
  if (removed > 0) {
    console.log(`🧹 Conversations purgées : ${removed} fil(s) inactif(s) depuis plus de ${RETENTION_DAYS} jours`);
  }
  return removed;
}

let cleanupTimer: NodeJS.Timeout | null = null;

/** Lance la purge au démarrage puis quotidiennement. */
export function startConversationCleanup(): void {
  if (cleanupTimer) return;
  try { purgeOldConversations(); } catch (err) { console.error('Conversation cleanup error:', err); }
  cleanupTimer = setInterval(() => {
    try { purgeOldConversations(); } catch (err) { console.error('Conversation cleanup error:', err); }
  }, 24 * 3600_000);
  cleanupTimer.unref?.();
}

export function stopConversationCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
