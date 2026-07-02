/**
 * Mémoire inter-sessions de l'assistant.
 *
 * L'assistant web et le bot Telegram sont sans état côté modèle : chaque tour
 * repart de l'historique du fil courant. Résultat : d'un fil à l'autre, le
 * copilote « oublie » qui est l'utilisateur. Ce module entretient une note
 * durable et compacte PAR (utilisateur, projet) — préférences, objectifs,
 * décisions, sujets récurrents — réinjectée dans le prompt système à chaque
 * tour, et rafraîchie en tâche de fond (best-effort, throttlée pour borner le
 * coût IA) à partir des derniers échanges.
 */

import { chatComplete, isAIConfigured } from './aiClient';
import { storage } from './storage';

/** Un échange minimal, indépendant du canal (web / Telegram) */
export interface MemoryTurn {
  role: 'user' | 'assistant';
  text: string;
}

const MAX_MEMORY_CHARS = 1500;
/** Intervalle minimal entre deux rafraîchissements (borne le coût IA) */
const REFRESH_THROTTLE_MS = 10 * 60_000;

/**
 * Bloc à injecter dans le prompt système — vide si aucune mémoire encore
 * constituée. Synchrone (lecture SQLite) : appelable depuis un systemPrompt.
 */
export function buildMemoryContext(userId: string, planId: string | null): string {
  const mem = storage.getAssistantMemory(userId, planId);
  if (!mem) return '';
  return `\n\n## Ce que tu sais déjà de l'utilisateur (mémoire inter-sessions — sers-t'en pour personnaliser tes réponses ; ne la récite pas telle quelle)\n${mem.content.slice(0, MAX_MEMORY_CHARS)}`;
}

/**
 * Replie le dernier échange dans la mémoire durable. À appeler en
 * fire-and-forget après un tour (l'échec ne doit jamais casser la réponse).
 * Throttlée : ne réécrit pas si la mémoire a été mise à jour très récemment.
 */
export async function refreshAssistantMemory(
  userId: string,
  planId: string | null,
  turns: MemoryTurn[],
): Promise<void> {
  if (!isAIConfigured()) return;

  const recent = turns.filter((t) => (t.role === 'user' || t.role === 'assistant') && t.text?.trim());
  if (recent.length < 2) return; // rien d'exploitable

  const existing = storage.getAssistantMemory(userId, planId);
  if (existing && Date.now() - new Date(existing.updatedAt).getTime() < REFRESH_THROTTLE_MS) {
    return; // rafraîchie il y a peu — on économise l'appel
  }

  // Fenêtre bornée du dernier échange (les tours récents suffisent : la mémoire
  // existante porte déjà le passé plus ancien).
  const exchange = recent
    .slice(-8)
    .map((t) => `${t.role === 'user' ? 'Utilisateur' : 'Assistant'} : ${t.text.replace(/\s+/g, ' ').slice(0, 800)}`)
    .join('\n');

  try {
    const result = await chatComplete({
      messages: [
        {
          role: 'system',
          content: `Tu maintiens une MÉMOIRE durable et compacte sur l'utilisateur d'un assistant (un fondateur de startup/petite entreprise), à travers ses conversations.
À partir de la mémoire actuelle et du dernier échange, renvoie une mémoire MISE À JOUR : uniquement des faits stables et réutilisables pour personnaliser les prochaines réponses — préférences (ton, format, langue), objectifs et priorités, produits/projets, contraintes et freins, décisions prises, sujets récurrents, personnes/contacts clés, style de travail.
Règles STRICTES :
- Fusionne l'ancien et le neuf ; corrige ce qui a changé ; supprime le périmé.
- Ignore le trivial, l'éphémère et les détails d'une seule tâche ponctuelle.
- Jamais de secrets, mots de passe, jetons ni données sensibles.
- Français, puces courtes « - … », maximum 12 lignes et ~1200 caractères.
- Renvoie UNIQUEMENT la mémoire, sans préambule ni commentaire. Si rien de durable n'émerge, renvoie la mémoire actuelle inchangée.`,
        },
        {
          role: 'user',
          content: `## Mémoire actuelle\n${existing?.content || '(vide)'}\n\n## Dernier échange\n${exchange}`,
        },
      ],
      maxTokens: 500,
      timeoutMs: 30_000,
    });

    const content = result.content.trim().slice(0, MAX_MEMORY_CHARS);
    if (content.length >= 8) storage.saveAssistantMemory(userId, planId, content);
  } catch {
    /* best-effort : une mémoire non rafraîchie n'est pas une erreur */
  }
}
