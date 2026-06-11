/**
 * Assistant LaunchForge intégré (vue 💬 Assistant de la sidebar) — le même
 * cerveau outillé que le bot Telegram, mais dans l'app web avec streaming :
 * état du projet, posts, validations, emails, agenda, recherche web.
 * Sans état côté serveur : le client envoie l'historique complet.
 */

import { chatComplete, ChatMessage, isAIConfigured } from './aiClient';
import { TOOLS, executeTool } from './telegramBot';
import { storage } from './storage';

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
function actionLabel(name: string, args: any): string {
  switch (name) {
    case 'web_search':            return `🔍 ${args.query ?? 'recherche web'}`;
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
    case 'generate_image':        return '🎨 Génération du visuel';
    case 'generate_deck':         return '🎞️ Création de la présentation';
    case 'publish_post':          return '📣 Publication du post';
    case 'send_email':            return `✉️ Envoi à ${args.to ?? ''}`;
    case 'send_email_to_contact': return `✉️ Email à ${args.contactName ?? 'un contact'}`;
    case 'read_emails':           return '📬 Lecture de la boîte mail';
    case 'calendar_events':       return '📅 Lecture de l\'agenda';
    case 'create_calendar_event': return `📅 Création : ${args.title ?? 'événement'}`;
    case 'set_reminder':          return '⏰ Programmation du rappel';
    case 'list_reminders':        return '⏰ Rappels à venir';
    default:                      return `⚙️ ${name}`;
  }
}

function systemPrompt(userId: string): string {
  const project = storage.getActivePlan(userId);
  const telegramLinked = storage.getTelegramLinksByUserId(userId).length > 0;
  const now = new Date();
  return `Tu es l'assistant LaunchForge, intégré à l'application web — le copilote de promotion de l'utilisateur (startup/petite entreprise). Tu réponds de façon claire et structurée (markdown léger : **gras**, listes) mais sans verbiage. Tu tutoies l'utilisateur et tu réponds dans sa langue (français par défaut).

Date/heure actuelle : ${now.toISOString()} (utilise-la pour calculer « demain 9h », « dans 2h », etc. — l'utilisateur est en Europe/Paris).
${project ? `Projet de travail courant : « ${project.input.productName} » (${project.input.niche}) — toutes tes actions s'appliquent à ce projet.` : 'Aucun projet créé pour l\'instant — propose à l\'utilisateur d\'en créer un (bouton « Nouveau projet » de la sidebar).'}

Tu agis via tes outils : état des activités, posts programmés/récurrents, validations de contenus, lancement de tâches IA, rédaction de posts (utilise web_search proactivement pour ancrer le contenu dans l'actu, et cite tes sources), emails (lecture read_emails ; envoi send_email_to_contact ou send_email), agenda Google Calendar (calendar_events, create_calendar_event), rappels${telegramLinked ? '' : ' (les rappels sont délivrés sur Telegram — le compte n\'est pas encore lié : indique-le si on te demande un rappel, la liaison se fait dans Configuration)'}.

Règles :
- Pour toute action IRRÉVERSIBLE (publier un post, envoyer un email, valider un contenu, créer un événement), présente d'abord ce que tu vas faire et attends un « oui » explicite avant d'appeler l'outil.
- Les ids courts entre crochets [xxxxxxxx] servent de référence pour les outils.
- Médias : Instagram/TikTok/YouTube refusent un post sans visuel. Si l'utilisateur donne une URL d'image, attache-la au post avec set_post_image (ou via draft_post) AVANT de publier.
- Si un outil renvoie ERREUR, explique simplement et propose une alternative (souvent : connecter le compte dans la vue Configuration).
- Ne réponds jamais par un JSON brut : reformule pour un humain.`;
}

export async function runAssistantTurn(
  userId: string,
  history: AssistantMessage[],
  onEvent?: (event: AssistantEvent) => void,
): Promise<AssistantResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(userId) },
    ...history.slice(-16).map((m): ChatMessage => ({ role: m.role, content: m.text })),
  ];

  const actions: string[] = [];
  let fullText = '';

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    let emittedSeparator = fullText === '';

    const result = await chatComplete({
      messages,
      tools: TOOLS,
      maxTokens: 2500,
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

  return { reply: fullText, actions };
}
