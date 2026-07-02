/**
 * Assistant LaunchForge intégré (vue 💬 Assistant de la sidebar) — le même
 * cerveau outillé que le bot Telegram, mais dans l'app web avec streaming :
 * état du projet, posts, validations, emails, agenda, recherche web.
 * Sans état côté serveur : le client envoie l'historique complet.
 */

import { chatComplete, ChatMessage, ContentPart, isAIConfigured } from './aiClient';
import { TOOLS, executeTool, buildSalesContext } from './telegramBot';
import { storage } from './storage';
import { ChatAttachment, buildAttachmentParts } from './attachments';
import { buildMemoryContext, refreshAssistantMemory } from './assistantMemory';

const MAX_TOOL_ITERATIONS = 6;

export { isAIConfigured };

export interface AssistantMessage {
  role: 'user' | 'assistant';
  text: string;
}

export type AssistantEvent =
  | { type: 'delta'; text: string }
  | { type: 'action'; text: string };

export interface AssistantResult {
  reply: string;
  actions: string[];
}

/** Libellé court affiché dans le chat pendant qu'un outil tourne */
export function actionLabel(name: string, args: any): string {
  switch (name) {
    case 'web_search':            return `🔍 ${args.query ?? 'recherche web'}`;
    case 'search_conversations':  return `🧠 Mémoire : ${args.query ?? ''}`;
    case 'fetch_website':         return `🌐 ${args.url ?? 'lecture de page'}`;
    case 'get_overview':          return '📊 État du projet';
    case 'list_upcoming_posts':   return '🗓️ Posts programmés';
    case 'list_pending_approvals':return '✋ Validations en attente';
    case 'approve_run':           return '✅ Validation du contenu';
    case 'reject_run':            return '🚫 Rejet du contenu';
    case 'list_agents':           return '🤖 Agents du projet';
    case 'run_agent':             return `🤖 Tâche IA : ${args.taskTitle ?? ''}`;
    case 'draft_post':            return `✍️ Rédaction ${args.platform ?? ''}`;
    case 'set_post_image':        return '🖼️ Image attachée au post';
    case 'sync_post_metrics':     return '📈 Synchro des métriques';
    case 'analyze_post':          return '🔎 Analyse du post';
    case 'campaign_report':       return '🗞️ Rapport de campagne';
    case 'generate_image':        return '🎨 Génération du visuel';
    case 'generate_deck':         return '🎞️ Création de la présentation';
    case 'render_deck_media':     return `🎬 Rendu ${args.format === 'mp4' ? 'vidéo' : 'GIF'} du deck`;
    case 'publish_post':          return '📣 Publication du post';
    case 'send_email':            return `✉️ Envoi à ${args.to ?? ''}`;
    case 'send_email_to_contact': return `✉️ Email à ${args.contactName ?? 'un contact'}`;
    case 'list_pipeline':         return '📊 Pipeline de vente';
    case 'move_deal':             return `📈 Deal ${args.contactName ?? ''} → ${args.stage ?? ''}`;
    case 'hubspot_list_deals':    return '🟠 Deals HubSpot';
    case 'hubspot_list_contacts': return '🟠 Contacts HubSpot';
    case 'hubspot_import_crm':    return '⤓ Import du CRM HubSpot';
    case 'read_emails':           return '📬 Lecture de la boîte mail';
    case 'calendar_events':       return '📅 Lecture de l\'agenda';
    case 'create_calendar_event': return `📅 Création : ${args.title ?? 'événement'}`;
    case 'set_reminder':          return '⏰ Programmation du rappel';
    case 'list_reminders':        return '⏰ Rappels à venir';
    case 'create_cron_job':       return `🤖 Automatisation : ${args.title ?? ''}`;
    case 'list_cron_jobs':        return '🤖 Automatisations configurées';
    case 'update_cron_job':       return '🤖 Mise à jour d\'une automatisation';
    case 'delete_cron_job':       return '🗑️ Suppression d\'une automatisation';
    case 'run_cron_job':          return '▶️ Exécution d\'une automatisation';
    default:                      return `⚙️ ${name}`;
  }
}

function systemPrompt(userId: string): string {
  const project = storage.getActivePlan(userId);
  const telegramLinked = storage.getTelegramLinksByUserId(userId).length > 0;
  const memory = buildMemoryContext(userId, storage.getActivePlanId(userId));
  const now = new Date();
  return `Tu es l'assistant LaunchForge, intégré à l'application web — le copilote de croissance et de vente de l'utilisateur (startup/petite entreprise). Ton objectif : l'aider à décrocher des clients et faire grandir son chiffre d'affaires. Tu réponds de façon claire et structurée (markdown léger : **gras**, listes) mais sans verbiage. Tu tutoies l'utilisateur et tu réponds dans sa langue (français par défaut).

Date/heure actuelle : ${now.toISOString()} (utilise-la pour calculer « demain 9h », « dans 2h », etc. — l'utilisateur est en Europe/Paris).
${project ? `Projet de travail courant : « ${project.input.productName} » (${project.input.niche}) — toutes tes actions s'appliquent à ce projet.` : 'Aucun projet créé pour l\'instant — propose à l\'utilisateur d\'en créer un (bouton « Nouveau projet » de la sidebar).'}${buildSalesContext(userId)}

Tu agis via tes outils : état des activités, posts programmés/récurrents, validations de contenus, lancement de tâches IA, rédaction de posts (utilise web_search proactivement pour ancrer le contenu dans l'actu, et cite tes sources), détection et relance de leads (send_email_to_contact), pipeline de vente (list_pipeline pour l'état des deals/CA, move_deal pour faire avancer un deal), CRM HubSpot connecté (hubspot_list_deals / hubspot_list_contacts pour lire directement le CRM, hubspot_import_crm pour l'importer dans le pipeline — avec confirmation), emails (lecture read_emails ; envoi send_email_to_contact ou send_email), agenda Google Calendar (calendar_events, create_calendar_event), rappels${telegramLinked ? '' : ' (les rappels sont délivrés sur Telegram — le compte n\'est pas encore lié : indique-le si on te demande un rappel, la liaison se fait dans Configuration)'}, automatisations récurrentes (create_cron_job pour programmer une tâche IA qui se relance toute seule à intervalle régulier — ex. « chaque lundi, rédige un post sur les actus du secteur » ; list_cron_jobs / update_cron_job / delete_cron_job / run_cron_job pour les gérer).

Règles :
- Sois orienté VENTE : priorise ce qui rapproche d'un client payant ; si un frein commercial est indiqué ci-dessus, attaque-le ; propose proactivement de relancer les leads chauds et de faire avancer les deals du pipeline.
- Pour toute action IRRÉVERSIBLE (publier un post, envoyer un email, valider un contenu, créer un événement), présente d'abord ce que tu vas faire et attends un « oui » explicite avant d'appeler l'outil.
- Les ids courts entre crochets [xxxxxxxx] servent de référence pour les outils.
- Médias : Instagram/TikTok/YouTube refusent un post sans visuel. Si l'utilisateur donne une URL d'image, attache-la au post avec set_post_image (ou via draft_post) AVANT de publier.
- Post avec GIF/vidéo de slides : enchaîne generate_deck (qui te renvoie l'id [xxxxxxxx] du deck) PUIS render_deck_media avec ce deckId — et postId pour attacher directement le GIF au post. Montre l'URL du média à l'utilisateur (elle s'affiche en aperçu).
- Si un outil renvoie ERREUR, explique simplement et propose une alternative (souvent : connecter le compte dans la vue Configuration).
- Ne réponds jamais par un JSON brut : reformule pour un humain.
- Tu peux retrouver ce dont vous avez déjà parlé dans d'anciens fils avec search_conversations (« on avait dit quoi sur… ? »).${memory}`;
}

export async function runAssistantTurn(
  userId: string,
  history: AssistantMessage[],
  onEvent?: (event: AssistantEvent) => void,
  signal?: AbortSignal,
  attachments: ChatAttachment[] = [],
): Promise<AssistantResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(userId) },
    ...history.slice(-16).map((m): ChatMessage => ({ role: m.role, content: m.text })),
  ];

  // Les pièces jointes accompagnent le dernier message utilisateur : on
  // transforme son contenu en blocs (image/fichier/texte extrait + le texte tapé).
  if (attachments.length > 0 && messages.length > 1) {
    const last = messages[messages.length - 1];
    const parts: ContentPart[] = await buildAttachmentParts(attachments);
    if (parts.length > 0) {
      parts.push({ type: 'text', text: String(last.content || '') });
      last.content = parts;
    }
  }

  const actions: string[] = [];
  let fullText = '';

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    if (signal?.aborted) break; // client déconnecté → on arrête la boucle agentique
    let emittedSeparator = fullText === '';

    const result = await chatComplete({
      messages,
      userId,
      tools: TOOLS,
      maxTokens: 2500,
      signal,
      onDelta: onEvent
        ? (delta) => {
            if (!emittedSeparator) {
              emittedSeparator = true;
              onEvent({ type: 'delta', text: '\n\n' });
            }
            onEvent({ type: 'delta', text: delta });
          }
        : undefined,
    });

    const iterText = result.content.trim();
    if (iterText) fullText = fullText ? `${fullText}\n\n${iterText}` : iterText;

    if (result.toolCalls.length === 0) break;
    if (signal?.aborted) break; // ne pas exécuter d'outils si le client a coupé

    messages.push(result.rawAssistantMessage);
    for (const call of result.toolCalls) {
      const action = actionLabel(call.name, call.args);
      actions.push(action);
      onEvent?.({ type: 'action', text: action });

      let output: string;
      try {
        output = await executeTool(userId, '', call.name, call.args);
      } catch (err) {
        output = `ERREUR: ${err instanceof Error ? err.message : 'tool failed'}`;
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: output.slice(0, 10000) });
    }
  }

  if (!fullText) {
    fullText = 'Je n\'ai pas réussi à traiter ta demande — reformule ?';
    onEvent?.({ type: 'delta', text: fullText });
  }

  // Mémoire inter-sessions : on replie le dernier échange en tâche de fond
  // (throttlée, best-effort) — jamais bloquant pour la réponse.
  if (!signal?.aborted) {
    const turns = [...history, { role: 'assistant' as const, text: fullText }];
    void refreshAssistantMemory(userId, storage.getActivePlanId(userId), turns);
  }

  return { reply: fullText, actions };
}
