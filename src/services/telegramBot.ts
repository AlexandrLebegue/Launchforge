/**
 * Bot Telegram — pilotage de LaunchForge depuis un chat.
 *
 * Transport : API Bot officielle de Telegram en long polling (TELEGRAM_BOT_TOKEN
 * via @BotFather) — Composio ne peut pas nous pousser les messages entrants.
 * Actions : boucle agentique OpenRouter outillée sur les services existants
 * (posts, validations, agents, contacts/emails, rappels) — les actions
 * externes (publication, emails) passent donc par le MCP Composio.
 *
 * Liaison compte ↔ chat : l'utilisateur génère un code dans l'app web et
 * l'envoie au bot (/start CODE ou le code seul).
 */

import { v4 as uuid } from 'uuid';
import { storage } from './storage';
import { chatComplete, ChatMessage, ToolDef, isAIConfigured } from './aiClient';
import { generateContent } from './contentAssistant';
import { processAgentRun, publishContent } from './agentService';
import { draftEmailForContact, sendEmailViaComposio } from './leadAnalysis';
import { markPublished } from './postPublisher';
import { publishViaComposio, isComposioConfigured } from './composio';
import { AgentRun, Post, Reminder } from '../types';

const API = 'https://api.telegram.org';
const POLL_TIMEOUT_S = 30;
const HISTORY_LIMIT = 14;
const MAX_TOOL_ITERATIONS = 6;

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

function api(method: string): string {
  return `${API}/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<void> {
  // Texte brut (pas de parse_mode) : aucun risque d'erreur d'échappement
  await fetch(api('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
  }).catch(() => { /* best-effort */ });
}

/** Notifie tous les chats Telegram liés à un compte (no-op si bot inactif) */
export async function notifyLinkedChats(userId: string, text: string): Promise<void> {
  if (!isTelegramConfigured()) return;
  for (const link of storage.getTelegramLinksByUserId(userId)) {
    await sendTelegramMessage(link.chatId, text);
  }
}

// ── Codes de liaison (générés dans l'app web, valables 10 min) ───────────────

const linkCodes = new Map<string, { userId: string; expires: number }>();

export function createLinkCode(userId: string): string {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  linkCodes.set(code, { userId, expires: Date.now() + 10 * 60_000 });
  return code;
}

export function consumeLinkCode(code: string): string | null {
  const entry = linkCodes.get(code.toUpperCase());
  if (!entry) return null;
  linkCodes.delete(code.toUpperCase());
  if (entry.expires < Date.now()) return null;
  return entry.userId;
}

// ── Outils LaunchForge exposés au modèle ──────────────────────────────────────

const TOOLS: ToolDef[] = [
  {
    name: 'get_overview',
    description: 'Vue d\'ensemble : posts programmés, contenus à valider, leads chauds, prochaine publication, rappels à venir. Appelle ça pour « où en est-on ? », « statut », « résumé ».',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_upcoming_posts',
    description: 'Liste les posts programmés à venir (avec récurrence et auto-publication). Pour « tâches récurrentes », « prochains posts », « calendrier ».',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_pending_approvals',
    description: 'Liste les contenus rédigés par les agents qui attendent la validation de l\'utilisateur (avec leur id court).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'approve_run',
    description: 'Valide et publie un contenu en attente. Utilise l\'id court donné par list_pending_approvals. Demande TOUJOURS confirmation à l\'utilisateur avant.',
    parameters: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] },
  },
  {
    name: 'reject_run',
    description: 'Rejette un contenu en attente de validation.',
    parameters: { type: 'object', properties: { runId: { type: 'string' }, reason: { type: 'string' } }, required: ['runId'] },
  },
  {
    name: 'list_agents',
    description: 'Liste les agents IA de l\'utilisateur (plateforme, mode de validation).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'run_agent',
    description: 'Lance un agent IA sur une nouvelle tâche : il rédige le contenu pour sa plateforme (puis publication directe ou validation selon son mode). Pour « lance l\'agent reddit sur… ».',
    parameters: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Plateforme de l\'agent (reddit, twitter, linkedin…)' },
        taskTitle: { type: 'string', description: 'Titre court de la tâche' },
        taskDescription: { type: 'string', description: 'Contexte/consignes pour la rédaction' },
      },
      required: ['platform', 'taskTitle'],
    },
  },
  {
    name: 'draft_post',
    description: 'Rédige un post complet pour une plateforme (via la base de connaissances) et l\'enregistre en brouillon dans le Hub de contenu. Renvoie le contenu rédigé.',
    parameters: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        brief: { type: 'string', description: 'Sujet, angle, objectif du post' },
      },
      required: ['platform', 'brief'],
    },
  },
  {
    name: 'publish_post',
    description: 'Publie immédiatement un post du Hub via Composio (donne l\'id court renvoyé par draft_post ou list_upcoming_posts). Demande TOUJOURS confirmation avant.',
    parameters: { type: 'object', properties: { postId: { type: 'string' } }, required: ['postId'] },
  },
  {
    name: 'send_email_to_contact',
    description: 'Rédige (IA) puis ENVOIE un email à un contact existant depuis la boîte mail de l\'utilisateur. Demande TOUJOURS confirmation explicite avant d\'appeler cet outil, en montrant à qui et dans quel but.',
    parameters: {
      type: 'object',
      properties: {
        contactName: { type: 'string', description: 'Nom (ou début du nom) du contact' },
        goal: { type: 'string', description: 'Objectif de l\'email' },
      },
      required: ['contactName', 'goal'],
    },
  },
  {
    name: 'set_reminder',
    description: 'Programme un rappel envoyé sur ce chat Telegram à la date/heure donnée.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        dueAt: { type: 'string', description: 'Date/heure ISO 8601 (calcule-la à partir de la date courante fournie)' },
      },
      required: ['text', 'dueAt'],
    },
  },
  {
    name: 'list_reminders',
    description: 'Liste les rappels à venir de l\'utilisateur.',
    parameters: { type: 'object', properties: {} },
  },
];

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const shortId = (id: string) => id.slice(0, 8);

function findByShortId<T extends { id: string }>(items: T[], ref: string): T | undefined {
  return items.find((i) => i.id === ref || i.id.startsWith(ref));
}

async function executeTool(userId: string, _chatId: string, name: string, args: any): Promise<string> {
  switch (name) {
    case 'get_overview': {
      const posts = storage.getPostsByUserId(userId);
      const scheduled = posts.filter((p) => p.status === 'scheduled');
      const nextPost = scheduled
        .filter((p) => p.scheduledAt)
        .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))[0];
      const approvals = storage.getPendingApprovalsByUserId(userId);
      const hotLeads = storage.getContactsByUserId(userId).filter((c) => (c.interestScore ?? 0) >= 70);
      const reminders = storage.getPendingRemindersByUserId(userId);
      return [
        `Posts programmés : ${scheduled.length}${nextPost ? ` (prochain : « ${nextPost.title} » sur ${nextPost.platform} le ${fmtDate(nextPost.scheduledAt)})` : ''}`,
        `Posts publiés : ${posts.filter((p) => p.status === 'published').length}`,
        `Contenus à valider : ${approvals.length}`,
        `Leads chauds (score ≥ 70) : ${hotLeads.length}${hotLeads[0] ? ` (top : ${hotLeads[0].name})` : ''}`,
        `Rappels à venir : ${reminders.length}`,
      ].join('\n');
    }

    case 'list_upcoming_posts': {
      const posts = storage.getPostsByUserId(userId)
        .filter((p) => p.status === 'scheduled')
        .slice(0, 10);
      if (posts.length === 0) return 'Aucun post programmé.';
      return posts.map((p) =>
        `[${shortId(p.id)}] « ${p.title || '(sans titre)'} » — ${p.platform}, ${fmtDate(p.scheduledAt)}${p.recurrence !== 'none' ? ` · récurrent (${p.recurrence})` : ''}${p.autoPublish ? ' · ⚡ auto' : ''}`
      ).join('\n');
    }

    case 'list_pending_approvals': {
      const items = storage.getPendingApprovalsByUserId(userId);
      if (items.length === 0) return 'Aucun contenu en attente de validation.';
      return items.map((r) =>
        `[${shortId(r.id)}] ${r.agentName} (${r.agentPlatform}) — « ${r.cardTitle} »\nExtrait : ${(r.result || '').slice(0, 200)}…`
      ).join('\n\n');
    }

    case 'approve_run': {
      const items = storage.getPendingApprovalsByUserId(userId);
      const run = findByShortId(items as (AgentRun & { agentName: string })[], String(args.runId || ''));
      if (!run) return 'ERREUR : run introuvable parmi les validations en attente.';
      const agent = storage.getAgentById(run.agentId)!;
      const result = await publishContent(agent, run.result || '');
      storage.updateRunStatus(run.id, 'done', result);
      storage.updateAgent(agent.id, { status: 'active', lastRunAt: new Date().toISOString() });
      return `Validé et traité : ${result.slice(0, 300)}`;
    }

    case 'reject_run': {
      const items = storage.getPendingApprovalsByUserId(userId);
      const run = findByShortId(items as AgentRun[], String(args.runId || ''));
      if (!run) return 'ERREUR : run introuvable.';
      const reason = typeof args.reason === 'string' ? args.reason : '';
      storage.updateRunStatus(run.id, 'rejected', `🚫 Rejeté via Telegram${reason ? ` : ${reason}` : ''}\n\n— Contenu proposé —\n${run.result || ''}`);
      return 'Contenu rejeté.';
    }

    case 'list_agents': {
      const agents = storage.getAgentsByUserId(userId);
      if (agents.length === 0) return 'Aucun agent configuré. Créez-en depuis l\'app web (page Agents IA).';
      return agents.map((a) =>
        `${a.name} — ${a.platform} · ${a.approvalMode === 'auto' ? '⚡ publication directe' : '✋ validation requise'} · ${a.status}`
      ).join('\n');
    }

    case 'run_agent': {
      const platform = String(args.platform || '').toLowerCase();
      const agent = storage.getAgentsByUserId(userId).find((a) => a.platform === platform)
        || storage.getAgentsByUserId(userId).find((a) => a.name.toLowerCase().includes(platform));
      if (!agent) return `ERREUR : aucun agent pour « ${platform} ». Agents : ${storage.getAgentsByUserId(userId).map((a) => a.platform).join(', ') || 'aucun'}.`;

      const run: AgentRun = {
        id: uuid(), agentId: agent.id, planId: '',
        cardId: `tg-${Date.now()}`, cardTitle: String(args.taskTitle).slice(0, 150),
        status: 'running', result: null,
        startedAt: new Date().toISOString(), completedAt: null,
      };
      storage.saveAgentRun(run);
      const card = {
        id: run.cardId, title: run.cardTitle,
        description: String(args.taskDescription || ''), category: 'Telegram',
        effort: 'medium' as const, column: 'in_progress' as const, order: 0,
        createdAt: new Date().toISOString(),
      };
      // Fire-and-forget : la rédaction prend du temps, on n'attend pas ici
      processAgentRun(run.id, agent, card).catch(() => {
        storage.updateRunStatus(run.id, 'failed', 'Erreur lors de la rédaction');
      });
      return `Agent ${agent.name} lancé sur « ${run.cardTitle} ». ${agent.approvalMode === 'manual' ? 'Le contenu arrivera dans les validations (je peux te les lister dans une minute).' : 'Publication automatique après rédaction.'}`;
    }

    case 'draft_post': {
      const generated = await generateContent({
        userId,
        platform: String(args.platform || 'linkedin'),
        brief: String(args.brief || ''),
      });
      const now = new Date().toISOString();
      const post: Post = {
        id: uuid(), userId,
        planId: storage.getActivePlan(userId)?.id ?? null,
        platform: String(args.platform || 'linkedin'),
        title: generated.title, content: generated.content,
        status: 'draft', scheduledAt: null, publishedAt: null, externalUrl: null,
        imageUrl: null, recurrence: 'none', autoPublish: 0, publishError: null, calendarSynced: 0,
        impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0,
        createdAt: now, updatedAt: now,
      };
      storage.savePost(post);
      return `Brouillon [${shortId(post.id)}] enregistré dans le Hub.\n\n${generated.content.slice(0, 1500)}`;
    }

    case 'publish_post': {
      const posts = storage.getPostsByUserId(userId).filter((p) => p.status !== 'published');
      const post = findByShortId(posts, String(args.postId || ''));
      if (!post) return 'ERREUR : post introuvable (ou déjà publié).';
      if (!isComposioConfigured()) return 'ERREUR : Composio non configuré — publication impossible depuis le chat, utilisez le copier-coller depuis l\'app.';
      const result = await publishViaComposio(post.platform, post.content);
      if (result.trim().toUpperCase().startsWith('OK')) {
        markPublished(post);
        return `Publié sur ${post.platform} : ${result.replace(/^OK:\s*/i, '')}`;
      }
      return `Échec de publication : ${result.replace(/^ECHEC:\s*/i, '')}`;
    }

    case 'send_email_to_contact': {
      const ref = String(args.contactName || '').toLowerCase();
      const contact = storage.getContactsByUserId(userId)
        .find((c) => c.name.toLowerCase().includes(ref));
      if (!contact) return `ERREUR : contact « ${args.contactName} » introuvable.`;
      if (!contact.email) return `ERREUR : ${contact.name} n'a pas d'adresse email.`;
      const draft = await draftEmailForContact(userId, contact, String(args.goal || ''));
      const result = await sendEmailViaComposio(contact.email, draft.subject, draft.body);
      if (result.trim().toUpperCase().startsWith('OK')) {
        const stamp = new Date().toLocaleString('fr-FR');
        storage.updateContact(contact.id, {
          lastInteraction: [contact.lastInteraction, `[${stamp}] Email envoyé via Telegram — ${draft.subject}`].filter(Boolean).join('\n\n').slice(-4000),
        });
        return `Email envoyé à ${contact.name} <${contact.email}>.\nObjet : ${draft.subject}`;
      }
      return `Échec d'envoi : ${result.replace(/^ECHEC:\s*/i, '')}\n\nBrouillon préparé :\nObjet : ${draft.subject}\n${draft.body.slice(0, 800)}`;
    }

    case 'set_reminder': {
      const due = new Date(String(args.dueAt || ''));
      if (Number.isNaN(due.getTime())) return 'ERREUR : date invalide (attendu ISO 8601).';
      if (due.getTime() < Date.now()) return 'ERREUR : la date est déjà passée.';
      const reminder: Reminder = {
        id: uuid(), userId,
        text: String(args.text || 'Rappel').slice(0, 500),
        dueAt: due.toISOString(), sent: 0,
        createdAt: new Date().toISOString(),
      };
      storage.saveReminder(reminder);
      return `Rappel programmé le ${fmtDate(reminder.dueAt)} : « ${reminder.text} » (envoyé sur ce chat Telegram).`;
    }

    case 'list_reminders': {
      const reminders = storage.getPendingRemindersByUserId(userId);
      if (reminders.length === 0) return 'Aucun rappel à venir.';
      return reminders.map((r) => `• ${fmtDate(r.dueAt)} — ${r.text}`).join('\n');
    }

    default:
      return `Outil inconnu : ${name}`;
  }
}

// ── Boucle agentique par message ──────────────────────────────────────────────

const conversations = new Map<string, ChatMessage[]>();

function systemPrompt(): string {
  const now = new Date();
  return `Tu es l'assistant Telegram de LaunchForge, le hub de promotion de l'utilisateur (startup/petite entreprise). Tu réponds court et utile — c'est un chat mobile, pas un rapport. Tu tutoies l'utilisateur et tu réponds dans sa langue (français par défaut).

Date/heure actuelle : ${now.toISOString()} (utilise-la pour calculer « demain 9h », « dans 2h », etc. — l'utilisateur est en Europe/Paris).

Tu agis via tes outils : état des activités, posts programmés/récurrents, validations de contenus, lancement d'agents, rédaction de posts, envoi d'emails, rappels.
Règles :
- Pour toute action IRRÉVERSIBLE (publier un post, envoyer un email, valider un contenu), présente d'abord ce que tu vas faire et attends un « oui » explicite avant d'appeler l'outil.
- Les ids courts entre crochets [xxxxxxxx] servent de référence pour les outils.
- Si un outil renvoie ERREUR, explique simplement et propose une alternative.
- Ne réponds jamais par un JSON brut : reformule pour un humain.`;
}

async function handleUserMessage(chatId: string, userId: string, text: string): Promise<string> {
  const history = conversations.get(chatId) ?? [];
  history.push({ role: 'user', content: text });

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt() },
    ...history.slice(-HISTORY_LIMIT),
  ];

  let reply = '';
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const result = await chatComplete({ messages, tools: TOOLS, maxTokens: 1200 });
    if (result.content) reply = result.content;
    if (result.toolCalls.length === 0) break;

    messages.push(result.rawAssistantMessage);
    history.push(result.rawAssistantMessage);
    for (const call of result.toolCalls) {
      let output: string;
      try {
        output = await executeTool(userId, chatId, call.name, call.args);
      } catch (err) {
        output = `ERREUR : ${err instanceof Error ? err.message : 'échec de l\'outil'}`;
      }
      const toolMsg: ChatMessage = { role: 'tool', tool_call_id: call.id, content: output.slice(0, 6000) };
      messages.push(toolMsg);
      history.push(toolMsg);
    }
  }

  if (!reply) reply = 'Je n\'ai pas réussi à traiter ta demande — reformule ?';
  history.push({ role: 'assistant', content: reply });
  conversations.set(chatId, history.slice(-HISTORY_LIMIT * 2));
  return reply;
}

// ── Réception des messages (long polling) ────────────────────────────────────

const HELP = `🚀 LaunchForge — ton hub de promotion, en chat.

Tu peux me demander par exemple :
• « Où en est-on ? » — état des activités
• « Mes prochains posts » / « mes tâches récurrentes »
• « Quoi à valider ? » puis « valide le premier »
• « Lance l'agent reddit sur l'annonce de la v2 »
• « Écris un post LinkedIn sur [sujet] »
• « Envoie un mail à Marie pour proposer une démo »
• « Rappelle-moi demain 9h de relancer les leads »

/reset — repartir de zéro · /aide — ce message`;

async function processUpdate(update: any): Promise<void> {
  const msg = update?.message;
  const chatId = msg?.chat?.id != null ? String(msg.chat.id) : null;
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (!chatId || !text) return;

  const link = storage.getTelegramLinkByChatId(chatId);

  // Commandes
  if (text === '/reset') {
    conversations.delete(chatId);
    await sendTelegramMessage(chatId, '🔄 Conversation réinitialisée.');
    return;
  }
  if (text === '/aide' || text === '/help' || (text === '/start' && link)) {
    await sendTelegramMessage(chatId, HELP);
    return;
  }

  // Liaison du compte
  if (!link) {
    const codeCandidate = text.replace(/^\/start\s*/i, '').trim();
    if (/^[A-Z0-9]{6}$/i.test(codeCandidate)) {
      const userId = consumeLinkCode(codeCandidate);
      if (userId) {
        storage.saveTelegramLink({ chatId, userId, createdAt: new Date().toISOString() });
        await sendTelegramMessage(chatId, `✅ Compte lié !\n\n${HELP}`);
      } else {
        await sendTelegramMessage(chatId, '❌ Code invalide ou expiré. Générez-en un nouveau dans l\'app (bouton Telegram dans la barre latérale).');
      }
      return;
    }
    await sendTelegramMessage(chatId, '👋 Bienvenue ! Pour lier ton compte LaunchForge : ouvre l\'app web, clique sur « 🤖 Bot Telegram » dans la barre latérale, et envoie-moi le code à 6 caractères.');
    return;
  }

  if (!isAIConfigured()) {
    await sendTelegramMessage(chatId, '⚠️ L\'IA n\'est pas configurée côté serveur (OPENROUTER_API_KEY).');
    return;
  }

  try {
    const reply = await handleUserMessage(chatId, link.userId, text);
    await sendTelegramMessage(chatId, reply);
  } catch (err) {
    await sendTelegramMessage(chatId, `⚠️ Erreur : ${err instanceof Error ? err.message : 'inconnue'}`);
  }
}

// ── Rappels ───────────────────────────────────────────────────────────────────

type SendFn = (chatId: string, text: string) => Promise<void>;

/** Envoie les rappels dus sur les chats liés. Sender injectable pour les tests. */
export async function dispatchDueReminders(
  now: Date = new Date(),
  send: SendFn = sendTelegramMessage,
): Promise<number> {
  const due = storage.getDueReminders(now.toISOString());
  let sent = 0;
  for (const reminder of due) {
    const links = storage.getTelegramLinksByUserId(reminder.userId);
    if (links.length === 0) {
      // Pas de chat lié : on marque quand même pour ne pas accumuler
      storage.markReminderSent(reminder.id);
      continue;
    }
    for (const link of links) {
      await send(link.chatId, `⏰ Rappel : ${reminder.text}`);
    }
    storage.markReminderSent(reminder.id);
    sent += 1;
  }
  return sent;
}

// ── Démarrage ─────────────────────────────────────────────────────────────────

let running = false;

export function startTelegramBot(): boolean {
  if (running) return true;
  if (!isTelegramConfigured()) {
    console.log('⏸️  Bot Telegram inactif (TELEGRAM_BOT_TOKEN manquant)');
    return false;
  }
  running = true;
  console.log('💬 Bot Telegram démarré (long polling)');

  // Boucle de réception
  (async () => {
    let offset = 0;
    while (running) {
      try {
        const res = await fetch(
          `${api('getUpdates')}?timeout=${POLL_TIMEOUT_S}&offset=${offset}&allowed_updates=["message"]`,
          { signal: AbortSignal.timeout((POLL_TIMEOUT_S + 10) * 1000) },
        );
        const data: any = await res.json();
        for (const update of data?.result || []) {
          offset = Math.max(offset, update.update_id + 1);
          processUpdate(update).catch(() => { /* isolé par message */ });
        }
      } catch {
        await new Promise((r) => setTimeout(r, 5000)); // réseau : on respire puis on repart
      }
    }
  })();

  // Boucle des rappels
  const reminderTimer = setInterval(() => {
    dispatchDueReminders().catch(() => { /* best-effort */ });
  }, 60_000);
  reminderTimer.unref?.();

  return true;
}

export function stopTelegramBot(): void {
  running = false;
}
