/**
 * Worker des automatisations (cron jobs IA).
 *
 * Toutes les minutes : exécute les automatisations dont `nextRunAt` est passé.
 * Chaque automatisation est un OBJECTIF en langage naturel traité par la même
 * boucle agentique que l'assistant (TOOLS + executeTool) — l'IA peut donc
 * chercher sur le web, consulter la base de connaissances, lire les métriques
 * des posts, programmer/publier des posts, envoyer des emails, gérer l'agenda,
 * etc., selon ce que demande l'objectif.
 *
 * Différence clé avec l'assistant : PERSONNE n'est là pour confirmer. Le prompt
 * système autorise donc l'IA à agir de façon autonome pour accomplir l'objectif
 * (l'utilisateur a créé l'automatisation en connaissance de cause), puis à
 * produire un compte rendu concis, stocké et notifié sur Telegram.
 *
 * Garde-fous : seuls les comptes Brasier (ou en essai) sont traités — comme le
 * worker de publication —, et chaque exécution consomme une génération IA
 * (quota de l'offre). En cas de dépassement/verrou, l'automatisation est
 * simplement replanifiée sans être exécutée.
 */

import { v4 as uuid } from 'uuid';
import { storage } from './storage';
import { chatComplete, ChatMessage, isAIConfigured } from './aiClient';
import { TOOLS, executeTool, buildSalesContext, notifyLinkedChats } from './telegramBot';
import { buildMemoryContext } from './assistantMemory';
import { actionLabel } from './assistant';
import { assertWithinUsage, recordUsage, isBrasier, hasFeature } from './entitlements';
import { computeNextRunAt, describeCronSchedule, scheduleOf } from './cronSchedule';
import { CronJob, CronRun } from '../types';

const TICK_MS = 60_000;
const MAX_TOOL_ITERATIONS = 8;

// Une automatisation NE doit PAS piloter les automatisations (elle-même incluse) :
// on retire les outils de gestion des cron jobs de sa boîte à outils pour éviter
// toute récursion (un cron qui se relance/supprime/duplique) et tout effet de bord
// sur la configuration. Le worker garde tous les AUTRES outils de l'assistant.
const CRON_MANAGEMENT_TOOLS = new Set([
  'create_cron_job', 'list_cron_jobs', 'update_cron_job', 'delete_cron_job', 'run_cron_job',
]);
const CRON_TOOLS = TOOLS.filter((t) => !CRON_MANAGEMENT_TOOLS.has(t.name));

let timer: NodeJS.Timeout | null = null;
const inFlight = new Set<string>();

/** Résultat d'une exécution d'objectif : compte rendu + outils déclenchés. */
export interface ObjectiveResult {
  reply: string;
  actions: string[];
}

export type ObjectiveRunner = (job: CronJob, signal?: AbortSignal) => Promise<ObjectiveResult>;

function cronSystemPrompt(userId: string, job: CronJob): string {
  const project = storage.getActivePlan(userId);
  const memory = buildMemoryContext(userId, storage.getActivePlanId(userId));
  const now = new Date();
  return `Tu es une AUTOMATISATION de LaunchForge (un « cron job » nommé « ${job.title} », qui se relance : ${describeCronSchedule(scheduleOf(job)).toLowerCase()}) — un agent IA autonome qui s'exécute périodiquement pour l'utilisateur (startup/petite entreprise), sans supervision humaine en temps réel. Ta mission : accomplir l'objectif ci-dessous, de bout en bout, puis produire un compte rendu clair et concis (markdown léger). Tu n'es PAS une conversation : tu tournes seul en arrière-plan, il n'y a personne à qui poser une question ou demander une confirmation.

Date/heure actuelle : ${now.toISOString()} (utilise-la pour « aujourd'hui », « cette semaine », « demain 9h » — l'utilisateur est en Europe/Paris).
${project ? `Projet de travail : « ${project.input.productName} » (${project.input.niche}) — toutes tes actions s'appliquent à ce projet.` : 'Aucun projet actif — signale-le dans ton compte rendu et n\'invente rien.'}${buildSalesContext(userId)}

Tu disposes de TOUS les outils de l'assistant : recherche web (web_search, fetch_website), base de connaissances (list_knowledge, add_knowledge), état & métriques des posts (get_overview, list_upcoming_posts, sync_post_metrics, analyze_post, campaign_report), rédaction et programmation de posts (draft_post, set_post_image, publish_post, configure_recurrence), pipeline de vente (list_pipeline, move_deal), emails (read_emails, send_email, send_email_to_contact), agenda Google Calendar (calendar_events, create_calendar_event), rappels (set_reminder).

Règles spécifiques aux automatisations :
- Tu agis de façon AUTONOME : il n'y a personne pour confirmer. N'attends jamais de « oui », mais reste STRICTEMENT dans le périmètre de l'objectif. N'entreprends aucune action irréversible (publier, envoyer un email, créer un événement) qui n'est pas explicitement demandée par l'objectif.
- Utilise les outils concrètement plutôt que de décrire ce que tu ferais : si l'objectif dit « programme un post », programme-le vraiment (draft_post puis, si demandé, publish_post ou une date via configure_recurrence).
- Termine TOUJOURS par un compte rendu : ce que tu as fait, les liens/ids créés, et ce qui mérite l'attention de l'utilisateur. Si tu n'as rien pu faire, explique pourquoi (compte non connecté, données manquantes…).
- Ne réponds jamais par du JSON brut. Sois bref et actionnable.${memory}`;
}

/** Exécute un objectif via la boucle agentique outillée (implémentation par défaut). */
const defaultRunObjective: ObjectiveRunner = async (job, signal) => {
  const userId = job.userId;
  const messages: ChatMessage[] = [
    { role: 'system', content: cronSystemPrompt(userId, job) },
    { role: 'user', content: job.objective },
  ];

  const actions: string[] = [];
  let fullText = '';

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    if (signal?.aborted) break;
    const result = await chatComplete({ messages, userId, tools: CRON_TOOLS, maxTokens: 2500, signal });
    const iterText = result.content.trim();
    if (iterText) fullText = fullText ? `${fullText}\n\n${iterText}` : iterText;
    if (result.toolCalls.length === 0) break;

    messages.push(result.rawAssistantMessage);
    for (const call of result.toolCalls) {
      actions.push(actionLabel(call.name, call.args));
      let output: string;
      try {
        output = await executeTool(userId, '', call.name, call.args);
      } catch (err) {
        output = `ERREUR: ${err instanceof Error ? err.message : 'tool failed'}`;
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: output.slice(0, 10000) });
    }
  }

  if (!fullText) fullText = 'Automatisation exécutée, mais aucun compte rendu n\'a été produit.';
  return { reply: fullText, actions };
};

/**
 * Exécute UNE automatisation : historise l'exécution, met à jour le job, notifie
 * Telegram. `runObjective` est injectable pour les tests. Retourne le CronRun
 * final (ou null si l'exécution a été sautée pour cause de quota/verrou).
 */
export async function runCronJob(
  job: CronJob,
  runObjective: ObjectiveRunner = defaultRunObjective,
  now: Date = new Date(),
): Promise<CronRun | null> {
  // Prochaine occurrence à l'heure/au jour fixé (intraday = maintenant + N min).
  const nextRunAt = computeNextRunAt(scheduleOf(job), now);

  // Comptes Braise / fonctionnalité verrouillée : on replanifie sans exécuter
  // (les connexions héritées d'un essai ne doivent plus déclencher d'actions).
  if (!isBrasier(job.userId) || !hasFeature(job.userId, 'automations')) {
    storage.updateCronJob(job.id, { nextRunAt, updatedAt: now.toISOString() });
    return null;
  }

  // Quota d'offre : une exécution = une génération IA. Dépassé → replanifié.
  try {
    assertWithinUsage(job.userId, 'ai_generation');
  } catch {
    storage.updateCronJob(job.id, {
      nextRunAt,
      lastStatus: 'error',
      lastResult: 'Exécution sautée : quota de générations IA atteint pour ce mois-ci.',
      updatedAt: now.toISOString(),
    });
    return null;
  }

  const run: CronRun = {
    id: uuid(), cronJobId: job.id, userId: job.userId,
    status: 'running', result: null, actions: null,
    startedAt: now.toISOString(), completedAt: null,
  };
  storage.saveCronRun(run);

  try {
    const { reply, actions } = await runObjective(job);
    recordUsage(job.userId, 'ai_generation');
    const completedAt = new Date().toISOString();
    storage.updateCronRun(run.id, { status: 'ok', result: reply, actions: JSON.stringify(actions), completedAt });
    storage.updateCronJob(job.id, {
      nextRunAt, lastRunAt: completedAt, lastStatus: 'ok', lastResult: reply, updatedAt: completedAt,
    });
    // Notification best-effort sur les chats Telegram liés (l'utilisateur suit
    // ses automatisations sans ouvrir l'app).
    void notifyLinkedChats(job.userId, `🤖 Automatisation « ${job.title} » exécutée :\n\n${reply.slice(0, 1500)}`);
    return { ...run, status: 'ok', result: reply, actions: JSON.stringify(actions), completedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erreur inconnue';
    const completedAt = new Date().toISOString();
    storage.updateCronRun(run.id, { status: 'error', result: message, completedAt });
    storage.updateCronJob(job.id, {
      nextRunAt, lastRunAt: completedAt, lastStatus: 'error', lastResult: `Échec : ${message}`, updatedAt: completedAt,
    });
    return { ...run, status: 'error', result: message, completedAt };
  }
}

/**
 * Traite les automatisations dues. `runObjective` injectable pour les tests.
 * Retourne le nombre d'exécutions lancées.
 */
export async function processDueCronJobs(
  now: Date = new Date(),
  runObjective: ObjectiveRunner = defaultRunObjective,
): Promise<number> {
  const due = storage.getDueCronJobs(now.toISOString());
  let ran = 0;
  for (const job of due) {
    if (inFlight.has(job.id)) continue;
    inFlight.add(job.id);
    try {
      const result = await runCronJob(job, runObjective, now);
      if (result) ran += 1;
    } catch (err) {
      console.error(`Cron job ${job.id} error:`, err);
    } finally {
      inFlight.delete(job.id);
    }
  }
  return ran;
}

/** Démarre le worker (no-op si l'IA n'est pas configurée). */
export function startCronRunner(): boolean {
  if (timer) return true;
  if (!isAIConfigured()) {
    console.log('⏸️  Worker des automatisations inactif (OPENROUTER_API_KEY manquant)');
    return false;
  }
  timer = setInterval(() => {
    processDueCronJobs().catch((err) => console.error('Cron runner error:', err));
  }, TICK_MS);
  timer.unref?.();
  console.log('🤖 Worker des automatisations démarré (tick : 60 s)');
  return true;
}

export function stopCronRunner(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
