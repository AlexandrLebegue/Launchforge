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
import { draftEmailForContact, sendEmailViaComposio, MAIL_KEYWORDS } from './leadAnalysis';
import { markPublished } from './postPublisher';
import { publishViaComposio, syncMetricsViaComposio, extractPublishedRef, isComposioConfigured, runMcpTask } from './composio';
import { webSearch, fetchPageText } from './research';
import { generateImage, isImageGenConfigured } from './imageGen';
import { generateDeckMarkdown, themeForUser } from './decks';
import { analyzePost, generateCampaignReport } from './analytics';
import { renderDeckGif, renderDeckMp4 } from './deckMedia';
import { saveMediaFile } from './mediaStore';
import { uploadPublicImage } from './imageGen';
import { AgentRun, Post, Reminder } from '../types';

const API = 'https://api.telegram.org';
const POLL_TIMEOUT_S = 30;
const HISTORY_LIMIT = 14;
const MAX_TOOL_ITERATIONS = 6;

/**
 * Multi-utilisateur : chaque utilisateur peut brancher SON bot (@BotFather) —
 * un poller dédié tourne par bot. Le bot global (env) reste le bot partagé
 * des comptes sans bot personnel.
 */
export function isTelegramConfigured(userId?: string): boolean {
  if (process.env.TELEGRAM_BOT_TOKEN) return true;
  return Boolean(userId && storage.getTelegramBot(userId));
}

/** Token du bot à utiliser pour un utilisateur : le sien, sinon le global */
export function tokenForUser(userId: string): string | null {
  return storage.getTelegramBot(userId)?.token ?? process.env.TELEGRAM_BOT_TOKEN ?? null;
}

function api(token: string, method: string): string {
  return `${API}/bot${token}/${method}`;
}

export async function sendTelegramMessage(chatId: string, text: string, token?: string): Promise<void> {
  const t = token ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!t) return;
  // Texte brut (pas de parse_mode) : aucun risque d'erreur d'échappement
  await fetch(api(t, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
  }).catch(() => { /* best-effort */ });
}

/** Notifie tous les chats Telegram liés à un compte (no-op si aucun bot) */
export async function notifyLinkedChats(userId: string, text: string): Promise<void> {
  const token = tokenForUser(userId);
  if (!token) return;
  for (const link of storage.getTelegramLinksByUserId(userId)) {
    await sendTelegramMessage(link.chatId, text, token);
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

export const TOOLS: ToolDef[] = [
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
    name: 'web_search',
    description: 'Recherche sur le web : actualités du secteur, chiffres, tendances, inspiration pour un post. Utilise des requêtes ciblées, puis exploite les résultats dans ta rédaction.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Requête, ex. "tendances SaaS France 2026"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_website',
    description: 'Lit le contenu texte d\'une page web précise (article, étude) pour s\'en inspirer ou en citer des éléments.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string', description: 'URL complète' } },
      required: ['url'],
    },
  },
  {
    name: 'draft_post',
    description: 'Rédige un post complet pour une plateforme (base de connaissances + projet actif ; combine avec web_search pour ancrer le post dans l\'actu) et l\'enregistre en brouillon dans le Hub. Renvoie le contenu rédigé — montre-le à l\'utilisateur.',
    parameters: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        brief: { type: 'string', description: 'Sujet, angle, objectif du post' },
        imageUrl: { type: 'string', description: 'URL du visuel à joindre si l\'utilisateur en a fourni un (obligatoire pour Instagram)' },
      },
      required: ['platform', 'brief'],
    },
  },
  {
    name: 'publish_post',
    description: 'Publie immédiatement un post du Hub via Composio (donne l\'id court renvoyé par draft_post ou list_upcoming_posts). L\'image attachée au post est transmise à la plateforme. Instagram/TikTok/YouTube REFUSENT un post sans média : attache d\'abord un visuel avec set_post_image. Demande TOUJOURS confirmation avant.',
    parameters: { type: 'object', properties: { postId: { type: 'string' } }, required: ['postId'] },
  },
  {
    name: 'set_post_image',
    description: 'Attache (ou remplace) le visuel d\'un post du Hub à partir d\'une URL d\'image. À utiliser quand l\'utilisateur fournit une URL d\'image pour un post — indispensable avant de publier sur Instagram.',
    parameters: {
      type: 'object',
      properties: {
        postId:   { type: 'string', description: 'Id court du post' },
        imageUrl: { type: 'string', description: 'URL https de l\'image' },
      },
      required: ['postId', 'imageUrl'],
    },
  },
  {
    name: 'generate_image',
    description: 'GÉNÈRE un visuel par IA (~0,04 $) et retourne son URL publique hébergée. Si postId est fourni, l\'image est directement attachée au post (indispensable pour Instagram). Pour « génère une image pour ce post », « crée un visuel sur… ».',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Description du visuel souhaité (sujet, ambiance, style)' },
        postId: { type: 'string', description: 'Id court du post auquel attacher le visuel (optionnel)' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_deck',
    description: 'Crée une PRÉSENTATION (slides Marp stylées avec le thème de l\'utilisateur) : pitch deck, carrousel LinkedIn, slides produit. Le deck apparaît dans l\'onglet Slides du Hub (mode Présenter plein écran + export PDF). Pour « fais-moi un pitch deck sur… », « un carrousel de 8 slides ».',
    parameters: {
      type: 'object',
      properties: {
        brief: { type: 'string', description: 'Sujet, objectif et audience de la présentation' },
        slides: { type: 'number', description: 'Nombre de slides (3-15, défaut 8)' },
      },
      required: ['brief'],
    },
  },
  {
    name: 'render_deck_media',
    description: 'Transforme une présentation (deck) en GIF ANIMÉ ou MP4 avec fondus entre les slides — média prêt pour un post. Le GIF reçoit une URL publique et peut être attaché à un post via postId. Pour « transforme ce deck en gif/vidéo », « fais-en un post animé ».',
    parameters: {
      type: 'object',
      properties: {
        deckId: { type: 'string', description: 'Id du deck (liste : onglet Slides, ou celui que tu viens de créer)' },
        format: { type: 'string', enum: ['gif', 'mp4'], description: 'gif = universel (URL publique) ; mp4 = meilleure qualité (serveur, nécessite ffmpeg)' },
        postId: { type: 'string', description: 'Id court du post auquel attacher le GIF (optionnel)' },
      },
      required: ['deckId', 'format'],
    },
  },
  {
    name: 'analyze_post',
    description: 'POST-MORTEM IA d\'un post publié : pourquoi il a performé (ou pas), quoi refaire, réécriture d\'accroche suggérée. Les enseignements alimentent automatiquement la base de connaissances. Pour « pourquoi ce post a marché/floppé ? », « analyse mon dernier post ».',
    parameters: {
      type: 'object',
      properties: { postId: { type: 'string', description: 'Id court du post publié' } },
      required: ['postId'],
    },
  },
  {
    name: 'campaign_report',
    description: 'RAPPORT DE CAMPAGNE complet du projet : tendance, ce qui marche/ne marche pas, attribution posts → leads, 3 recommandations pour la semaine. Pour « analyse mes campagnes », « bilan de la semaine », « comment performent mes posts ? ».',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'sync_post_metrics',
    description: 'Synchronise les métriques réelles (vues, likes, commentaires, partages) d\'un post PUBLIÉ via les comptes Composio. Le post doit avoir son URL renseignée (sinon demande-la à l\'utilisateur). Pour « combien de likes sur mon dernier post ? », « synchronise les métriques ».',
    parameters: {
      type: 'object',
      properties: {
        postId: { type: 'string', description: 'Id court du post publié' },
      },
      required: ['postId'],
    },
  },
  {
    name: 'send_email_to_contact',
    description: 'Rédige (IA, avec le contexte du contact) puis ENVOIE un email à un contact du carnet d\'adresses. Pour une adresse email directe, utilise send_email. Demande TOUJOURS confirmation explicite avant d\'appeler cet outil, en montrant à qui et dans quel but.',
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
    name: 'send_email',
    description: 'ENVOIE un email à N\'IMPORTE QUELLE adresse depuis la boîte mail de l\'utilisateur. Rédige d\'abord l\'objet et le corps DANS le chat, fais-les valider explicitement par l\'utilisateur, puis appelle cet outil avec le texte validé tel quel.',
    parameters: {
      type: 'object',
      properties: {
        to:      { type: 'string', description: 'Adresse email du destinataire' },
        subject: { type: 'string', description: 'Objet validé par l\'utilisateur' },
        body:    { type: 'string', description: 'Corps validé par l\'utilisateur (texte simple)' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'read_emails',
    description: 'Lit la boîte mail de l\'utilisateur via Composio : derniers emails reçus, ou recherche ciblée. Pour « lis mes mails », « des nouvelles de X ? », « j\'ai reçu quoi ? ».',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Recherche optionnelle (expéditeur, sujet, mot-clé) — vide pour les plus récents' },
      },
    },
  },
  {
    name: 'calendar_events',
    description: 'Lit l\'agenda Google Calendar de l\'utilisateur via Composio : prochains événements, ou recherche ciblée. Pour « mon agenda », « j\'ai quoi demain ? », « mes rendez-vous de la semaine ».',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Période ou recherche optionnelle, ex. "demain", "cette semaine", "rendez-vous client" — vide pour les prochains événements' },
      },
    },
  },
  {
    name: 'create_calendar_event',
    description: 'Crée un événement dans le Google Calendar de l\'utilisateur. Demande TOUJOURS confirmation (titre, date/heure, durée) avant d\'appeler cet outil.',
    parameters: {
      type: 'object',
      properties: {
        title:           { type: 'string', description: 'Titre de l\'événement' },
        startsAt:        { type: 'string', description: 'Début en ISO 8601 (calcule-le depuis la date courante, fuseau Europe/Paris)' },
        durationMinutes: { type: 'number', description: 'Durée en minutes (défaut 60)' },
        description:     { type: 'string', description: 'Description optionnelle' },
      },
      required: ['title', 'startsAt'],
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

export async function executeTool(userId: string, _chatId: string, name: string, args: any): Promise<string> {
  // Le bot travaille dans le contexte du projet actif, comme l'app web
  const planId = storage.getActivePlanId(userId);
  switch (name) {
    case 'get_overview': {
      const posts = storage.getPostsByPlan(userId, planId);
      const scheduled = posts.filter((p) => p.status === 'scheduled');
      const nextPost = scheduled
        .filter((p) => p.scheduledAt)
        .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))[0];
      const approvals = storage.getPendingApprovalsByPlan(userId, planId);
      const hotLeads = storage.getContactsByPlan(userId, planId).filter((c) => (c.interestScore ?? 0) >= 70);
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
      const posts = storage.getPostsByPlan(userId, planId)
        .filter((p) => p.status === 'scheduled')
        .slice(0, 10);
      if (posts.length === 0) return 'Aucun post programmé.';
      return posts.map((p) =>
        `[${shortId(p.id)}] « ${p.title || '(sans titre)'} » — ${p.platform}, ${fmtDate(p.scheduledAt)}${p.recurrence !== 'none' ? ` · récurrent (${p.recurrence})` : ''}${p.autoPublish ? ' · ⚡ auto' : ''}`
      ).join('\n');
    }

    case 'list_pending_approvals': {
      const items = storage.getPendingApprovalsByPlan(userId, planId);
      if (items.length === 0) return 'Aucun contenu en attente de validation.';
      return items.map((r) =>
        `[${shortId(r.id)}] ${r.agentName} (${r.agentPlatform}) — « ${r.cardTitle} »\nExtrait : ${(r.result || '').slice(0, 200)}…`
      ).join('\n\n');
    }

    case 'approve_run': {
      const items = storage.getPendingApprovalsByPlan(userId, planId);
      const run = findByShortId(items as (AgentRun & { agentName: string })[], String(args.runId || ''));
      if (!run) return 'ERREUR : run introuvable parmi les validations en attente.';
      const agent = storage.getAgentById(run.agentId)!;
      const result = await publishContent(agent, run.result || '');
      storage.updateRunStatus(run.id, 'done', result);
      storage.updateAgent(agent.id, { status: 'active', lastRunAt: new Date().toISOString() });
      return `Validé et traité : ${result.slice(0, 300)}`;
    }

    case 'reject_run': {
      const items = storage.getPendingApprovalsByPlan(userId, planId);
      const run = findByShortId(items as AgentRun[], String(args.runId || ''));
      if (!run) return 'ERREUR : run introuvable.';
      const reason = typeof args.reason === 'string' ? args.reason : '';
      storage.updateRunStatus(run.id, 'rejected', `🚫 Rejeté via Telegram${reason ? ` : ${reason}` : ''}\n\n— Contenu proposé —\n${run.result || ''}`);
      return 'Contenu rejeté.';
    }

    case 'list_agents': {
      const agents = storage.getAgentsByPlan(userId, planId);
      if (agents.length === 0) return 'Aucun agent configuré. Créez-en depuis l\'app web (page Agents IA).';
      return agents.map((a) =>
        `${a.name} — ${a.platform} · ${a.approvalMode === 'auto' ? '⚡ publication directe' : '✋ validation requise'} · ${a.status}`
      ).join('\n');
    }

    case 'run_agent': {
      const platform = String(args.platform || '').toLowerCase();
      const agent = storage.getAgentsByPlan(userId, planId).find((a) => a.platform === platform)
        || storage.getAgentsByPlan(userId, planId).find((a) => a.name.toLowerCase().includes(platform));
      if (!agent) return `ERREUR : aucun agent pour « ${platform} ». Agents : ${storage.getAgentsByPlan(userId, planId).map((a) => a.platform).join(', ') || 'aucun'}.`;

      const run: AgentRun = {
        id: uuid(), agentId: agent.id, planId: planId ?? '',
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

    case 'set_post_image': {
      const url = String(args.imageUrl || '').trim();
      if (!/^https?:\/\/\S+$/i.test(url)) return 'ERREUR : URL d\'image invalide (http/https attendu).';
      const posts = storage.getPostsByPlan(userId, planId);
      const post = findByShortId(posts, String(args.postId || ''));
      if (!post) return 'ERREUR : post introuvable.';
      storage.updatePost(post.id, { imageUrl: url });
      return `Image attachée au post [${shortId(post.id)}] — prêt à publier (y compris sur Instagram).`;
    }

    case 'web_search': {
      const results = await webSearch(String(args.query || ''));
      return results.length > 0
        ? results.map((r, i) => `[${i + 1}] ${r}`).join('\n')
        : 'Aucun résultat.';
    }

    case 'fetch_website': {
      const text = await fetchPageText(String(args.url || ''));
      return text || 'Page inaccessible.';
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
        planId,
        platform: String(args.platform || 'linkedin'),
        title: generated.title, content: generated.content,
        status: 'draft', scheduledAt: null, publishedAt: null, externalUrl: null,
        imageUrl: typeof args.imageUrl === 'string' && /^https?:\/\//i.test(args.imageUrl.trim()) ? args.imageUrl.trim() : null,
        recurrence: 'none', recurrenceBrief: null, autoPublish: 0, publishError: null, calendarSynced: 0,
        impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0,
        createdAt: now, updatedAt: now,
      };
      storage.savePost(post);
      return `Brouillon [${shortId(post.id)}] enregistré dans le Hub.\n\n${generated.content.slice(0, 1500)}`;
    }

    case 'publish_post': {
      const posts = storage.getPostsByPlan(userId, planId).filter((p) => p.status !== 'published');
      const post = findByShortId(posts, String(args.postId || ''));
      if (!post) return 'ERREUR : post introuvable (ou déjà publié).';
      if (!isComposioConfigured()) return 'ERREUR : Composio non configuré — publication impossible depuis le chat, utilisez le copier-coller depuis l\'app.';
      const result = await publishViaComposio(userId, post.platform, post.content, post.imageUrl);
      if (result.trim().toUpperCase().startsWith('OK')) {
        markPublished(post);
        // URL/id du post créé enregistré pour la synchro des métriques
        const ref = extractPublishedRef(result);
        if (ref) storage.updatePost(post.id, { externalUrl: ref });
        return `Publié sur ${post.platform} : ${result.replace(/^OK:\s*/i, '')}${ref ? `\n🔗 URL enregistrée — les métriques se synchroniseront automatiquement.` : ''}`;
      }
      return `Échec de publication : ${result.replace(/^ECHEC:\s*/i, '')}`;
    }

    case 'generate_image': {
      if (!isImageGenConfigured()) return 'ERREUR : génération d\'images non configurée (OPENROUTER_API_KEY).';
      const prompt = String(args.prompt || '').trim();
      if (!prompt) return 'ERREUR : décris le visuel souhaité.';
      const { url } = await generateImage(userId, prompt);
      if (args.postId) {
        const posts = storage.getPostsByPlan(userId, planId);
        const post = findByShortId(posts, String(args.postId));
        if (post) {
          storage.updatePost(post.id, { imageUrl: url });
          return `Visuel généré et attaché au post [${shortId(post.id)}] : ${url}`;
        }
      }
      return `Visuel généré : ${url}\n(Utilise set_post_image pour l'attacher à un post.)`;
    }

    case 'generate_deck': {
      const brief = String(args.brief || '').trim();
      if (!brief) return 'ERREUR : décris le sujet de la présentation.';
      const { title, markdown } = await generateDeckMarkdown(userId, brief, Number(args.slides) || 8);
      const deck = {
        id: uuid(), userId, planId,
        title, markdown, createdAt: new Date().toISOString(),
      };
      storage.saveDeck(deck);
      const slideCount = (markdown.match(/^---$/gm) || []).length;
      return `Présentation « ${title} » créée (${slideCount} slides) — id [${shortId(deck.id)}], visible dans l'onglet Slides du Hub.
Pour en faire un média de post : render_deck_media avec deckId="${shortId(deck.id)}" (format gif ou mp4).`;
    }

    case 'render_deck_media': {
      const deckRef = String(args.deckId || '').trim();
      const decks = storage.getDecksByPlan(userId, planId);
      const summary = decks.find((d) => d.id === deckRef || d.id.startsWith(deckRef))
        ?? decks.find((d) => deckRef.length > 3 && d.title.toLowerCase().includes(deckRef.toLowerCase()))
        ?? (decks.length === 1 ? decks[0] : undefined);
      const deck = summary ? storage.getDeckById(summary.id) : undefined;
      if (!deck) return `ERREUR : deck introuvable. Decks du projet : ${decks.map((d) => `[${shortId(d.id)}] ${d.title}`).join(' · ') || 'aucun'}`;
      const { theme } = themeForUser(userId);
      const format = String(args.format) === 'mp4' ? 'mp4' : 'gif';
      if (format === 'mp4') {
        const mp4 = await renderDeckMp4(deck.markdown, theme);
        const { url } = saveMediaFile(mp4, 'mp4');
        return `Vidéo MP4 générée : ${url} (stockée sur le serveur, purge à 90 jours).`;
      }
      const gif = await renderDeckGif(deck.markdown, theme);
      const { url } = saveMediaFile(gif, 'gif');
      let publicUrl: string | null = null;
      try { publicUrl = await uploadPublicImage(gif.toString('base64')); } catch { /* copie locale dispo */ }
      if (args.postId && publicUrl) {
        const posts = storage.getPostsByPlan(userId, planId);
        const post = findByShortId(posts, String(args.postId));
        if (post) {
          storage.updatePost(post.id, { imageUrl: publicUrl });
          return `GIF animé généré et attaché au post [${shortId(post.id)}] : ${publicUrl}\n(copie serveur : ${url})`;
        }
      }
      return `GIF animé généré : ${publicUrl ?? url}${publicUrl ? `\n(copie serveur : ${url})` : ''}\nUtilise set_post_image pour l'attacher à un post.`;
    }

    case 'analyze_post': {
      const posts = storage.getPostsByPlan(userId, planId).filter((p) => p.status === 'published');
      const post = findByShortId(posts, String(args.postId || ''));
      if (!post) return `ERREUR : post publié introuvable. Publiés : ${posts.slice(0, 5).map((p) => `[${shortId(p.id)}] ${p.title}`).join(' · ') || 'aucun'}`;
      const { analysis, learnings } = await analyzePost(userId, post);
      return `${analysis}${learnings.length > 0 ? `\n\n📚 ${learnings.length} enseignement(s) ajouté(s) à la base de connaissances — les prochaines générations en tiendront compte.` : ''}`;
    }

    case 'campaign_report': {
      const { report } = await generateCampaignReport(userId);
      return report;
    }

    case 'sync_post_metrics': {
      if (!isComposioConfigured()) return 'ERREUR : Composio non configuré — synchro impossible.';
      const posts = storage.getPostsByPlan(userId, planId).filter((p) => p.status === 'published');
      const post = findByShortId(posts, String(args.postId || ''));
      if (!post) return 'ERREUR : post publié introuvable.';
      if (!post.externalUrl) return `ERREUR : le post [${shortId(post.id)}] n'a pas d'URL — demande à l'utilisateur l'URL du post publié, enregistre-la via le Hub, ou donne-la moi pour mémoire.`;
      const metrics = await syncMetricsViaComposio(userId, post.platform, post.externalUrl, post.title);
      if (!metrics.found) return `ERREUR : métriques introuvables — ${metrics.note || 'le post n\'a pas pu être retrouvé via les outils connectés'}`;
      storage.updatePost(post.id, {
        impressions: metrics.impressions, likes: metrics.likes,
        comments: metrics.comments, shares: metrics.shares, clicks: metrics.clicks,
      });
      storage.markMetricsSynced(post.id, new Date().toISOString());
      return `Métriques de « ${post.title} » synchronisées : ${metrics.impressions ?? 0} vues · ${metrics.likes ?? 0} likes · ${metrics.comments ?? 0} commentaires · ${metrics.shares ?? 0} partages${metrics.note ? ` (${metrics.note})` : ''}`;
    }

    case 'send_email_to_contact': {
      const ref = String(args.contactName || '').toLowerCase();
      const contact = storage.getContactsByPlan(userId, planId)
        .find((c) => c.name.toLowerCase().includes(ref));
      if (!contact) return `ERREUR : contact « ${args.contactName} » introuvable.`;
      if (!contact.email) return `ERREUR : ${contact.name} n'a pas d'adresse email.`;
      const draft = await draftEmailForContact(userId, contact, String(args.goal || ''));
      const result = await sendEmailViaComposio(userId, contact.email, draft.subject, draft.body);
      if (result.trim().toUpperCase().startsWith('OK')) {
        const stamp = new Date().toLocaleString('fr-FR');
        storage.updateContact(contact.id, {
          lastInteraction: [contact.lastInteraction, `[${stamp}] Email envoyé via Telegram — ${draft.subject}`].filter(Boolean).join('\n\n').slice(-4000),
        });
        return `Email envoyé à ${contact.name} <${contact.email}>.\nObjet : ${draft.subject}`;
      }
      return `Échec d'envoi : ${result.replace(/^ECHEC:\s*/i, '')}\n\nBrouillon préparé :\nObjet : ${draft.subject}\n${draft.body.slice(0, 800)}`;
    }

    case 'send_email': {
      const to = String(args.to || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return 'ERREUR : adresse email invalide.';
      const subject = String(args.subject || '').trim().slice(0, 200);
      const body = String(args.body || '').trim();
      if (!subject || !body) return 'ERREUR : rédige d\'abord l\'objet et le corps, fais-les valider, puis rappelle cet outil.';
      if (!isComposioConfigured()) return 'ERREUR : Composio non configuré — connectez Gmail depuis la vue Configuration.';
      const result = await sendEmailViaComposio(userId, to, subject, body);
      if (result.trim().toUpperCase().startsWith('OK')) {
        return `Email envoyé à ${to}.\nObjet : ${subject}`;
      }
      return `Échec d'envoi : ${result.replace(/^ECHEC:\s*/i, '')}`;
    }

    case 'read_emails': {
      if (!isComposioConfigured()) return 'ERREUR : Composio non configuré — connectez Gmail depuis la vue Configuration pour lire la boîte mail.';
      const query = String(args.query || '').trim();
      const result = await runMcpTask(
        userId,
        MAIL_KEYWORDS,
        `Tu es l'assistant boîte mail de l'utilisateur. Tu disposes de ses outils Gmail/Outlook via Composio.
Mission : récupère ${query ? `les emails correspondant à « ${query} »` : 'les 10 derniers emails reçus'} avec les outils de listing/recherche, puis présente-les en liste courte : expéditeur — objet — date — l'essentiel en une ligne.
Ne fabrique JAMAIS d'emails : uniquement ce que les outils retournent réellement. Si la lecture échoue, réponds "ERREUR :" avec la raison.`,
        query ? `Cherche et résume les emails : ${query}` : 'Liste et résume mes derniers emails reçus.',
        ['list', 'fetch', 'search', 'get', 'thread'],
      );
      // Anti-hallucination : un résumé sans le moindre appel d'outil réussi est inventé
      if (result.okCalls === 0) {
        return `ERREUR : impossible d'interroger la boîte mail — ${result.reply.replace(/^ERREUR\s*:\s*/i, '').slice(0, 300) || 'vérifiez que Gmail est connecté (vue Configuration)'}`;
      }
      return result.reply;
    }

    case 'calendar_events': {
      if (!isComposioConfigured()) return 'ERREUR : Composio non configuré — connectez Google Calendar depuis la vue Configuration.';
      const query = String(args.query || '').trim();
      const result = await runMcpTask(
        userId,
        ['calendar'],
        `Tu es l'assistant agenda de l'utilisateur. Tu disposes de ses outils Google Calendar via Composio.
Date/heure actuelle : ${new Date().toISOString()} (l'utilisateur est en Europe/Paris).
Mission : récupère ${query ? `les événements correspondant à « ${query} »` : 'les 10 prochains événements à venir'} avec les outils de listing du calendrier principal, puis présente-les en liste courte : date/heure — titre — lieu/détail en une ligne.
Ne fabrique JAMAIS d'événements : uniquement ce que les outils retournent réellement. Si la lecture échoue, réponds "ERREUR :" avec la raison.`,
        query ? `Cherche dans mon agenda : ${query}` : 'Liste mes prochains événements.',
        ['list', 'events', 'get', 'find', 'search'],
      );
      // Anti-hallucination : un agenda résumé sans appel d'outil réussi est inventé
      if (result.okCalls === 0) {
        return `ERREUR : impossible d'interroger l'agenda — ${result.reply.replace(/^ERREUR\s*:\s*/i, '').slice(0, 300) || 'vérifiez que Google Calendar est connecté (vue Configuration)'}`;
      }
      return result.reply;
    }

    case 'create_calendar_event': {
      if (!isComposioConfigured()) return 'ERREUR : Composio non configuré — connectez Google Calendar depuis la vue Configuration.';
      const title = String(args.title || '').trim().slice(0, 200);
      const starts = new Date(String(args.startsAt || ''));
      if (!title) return 'ERREUR : titre requis.';
      if (Number.isNaN(starts.getTime())) return 'ERREUR : date de début invalide (attendu ISO 8601).';
      const duration = Number.isFinite(Number(args.durationMinutes)) && Number(args.durationMinutes) > 0
        ? Math.min(Math.round(Number(args.durationMinutes)), 24 * 60)
        : 60;
      const description = String(args.description || '').trim().slice(0, 500);
      const result = await runMcpTask(
        userId,
        ['calendar'],
        `Tu es l'assistant agenda de l'utilisateur. Tu disposes de ses outils Google Calendar via Composio.
Mission : créer UN événement dans le calendrier principal, exactement avec le titre, le début (fourni en ISO UTC — laisse l'outil gérer le fuseau), la durée et la description fournis. N'invente rien d'autre.
Si la création réussit, réponds "OK:" suivi d'une confirmation courte. Sinon "ECHEC:" avec la raison.
IMPÉRATIF : ta réponse finale commence par "OK:" ou "ECHEC:" — rien avant.`,
        `Crée cet événement :\nTitre : ${title}\nDébut : ${starts.toISOString()}\nDurée : ${duration} minutes${description ? `\nDescription : ${description}` : ''}`,
        ['create', 'event', 'quick', 'add', 'insert'],
      );
      const ok = result.reply.trim().toUpperCase().startsWith('OK') && result.okCalls > 0;
      if (ok) return `Événement créé : « ${title} » le ${fmtDate(starts.toISOString())} (${duration} min).`;
      return `Échec de création : ${result.reply.replace(/^(OK|ECHEC)\s*:\s*/i, '').slice(0, 300)}`;
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

Tu agis via tes outils : état des activités, posts programmés/récurrents, validations de contenus, lancement d'agents, rédaction de posts (avec recherche web : actus, chiffres, tendances — utilise web_search proactivement quand ça renforce le contenu, et cite tes sources), emails (lecture de la boîte avec read_emails ; envoi à un contact avec send_email_to_contact ou à n'importe quelle adresse avec send_email), agenda Google Calendar (calendar_events, create_calendar_event), métriques des posts publiés (sync_post_metrics), analyse de performance (analyze_post pour un post, campaign_report pour le bilan global — leurs enseignements améliorent automatiquement les générations suivantes), visuels IA (generate_image — indispensable pour Instagram), présentations/carrousels (generate_deck, puis render_deck_media pour en faire un GIF/MP4 animé), rappels.
Règles :
- Pour toute action IRRÉVERSIBLE (publier un post, envoyer un email, valider un contenu), présente d'abord ce que tu vas faire et attends un « oui » explicite avant d'appeler l'outil.
- Les ids courts entre crochets [xxxxxxxx] servent de référence pour les outils.
- Médias : Instagram/TikTok/YouTube refusent un post sans visuel. Si l'utilisateur donne une URL d'image, attache-la au post avec set_post_image (ou via draft_post) AVANT de publier.
- Post avec GIF/vidéo de slides : enchaîne generate_deck (qui te renvoie l'id [xxxxxxxx] du deck) PUIS render_deck_media avec ce deckId — et postId pour attacher directement le GIF au post. Montre l'URL du média à l'utilisateur (elle s'affiche en aperçu).
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
• « Cherche une actu de mon secteur et fais un post dessus »
• « Envoie un mail à Marie pour proposer une démo »
• « Envoie un mail à contact@exemple.com »
• « Lis mes derniers mails »
• « Combien de likes sur mon dernier post ? »
• « Pourquoi mon post de mardi a floppé ? »
• « Fais-moi le bilan de mes campagnes »
• « Génère une image pour ce post »
• « Fais-moi un pitch deck de 8 slides »
• « J'ai quoi dans mon agenda demain ? »
• « Ajoute un rdv client vendredi 14h »
• « Rappelle-moi demain 9h de relancer les leads »

/reset — repartir de zéro · /aide — ce message`;

async function processUpdate(update: any, token: string, ownerUserId: string | null): Promise<void> {
  const msg = update?.message;
  const chatId = msg?.chat?.id != null ? String(msg.chat.id) : null;
  const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
  if (!chatId || !text) return;

  let link = storage.getTelegramLinkByChatId(chatId);

  // Bot personnel : tout message appartient au propriétaire du token —
  // liaison automatique du chat, pas de code à saisir.
  if (!link && ownerUserId) {
    storage.saveTelegramLink({ chatId, userId: ownerUserId, createdAt: new Date().toISOString() });
    link = storage.getTelegramLinkByChatId(chatId);
    if (text === '/start') {
      await sendTelegramMessage(chatId, `✅ Chat lié à ton compte LaunchForge !\n\n${HELP}`, token);
      return;
    }
  }

  // Commandes
  if (text === '/reset') {
    conversations.delete(chatId);
    await sendTelegramMessage(chatId, '🔄 Conversation réinitialisée.', token);
    return;
  }
  if (text === '/aide' || text === '/help' || (text === '/start' && link)) {
    await sendTelegramMessage(chatId, HELP, token);
    return;
  }

  // Liaison du compte (bot global : par code généré dans l'app)
  if (!link) {
    const codeCandidate = text.replace(/^\/start\s*/i, '').trim();
    if (/^[A-Z0-9]{6}$/i.test(codeCandidate)) {
      const userId = consumeLinkCode(codeCandidate);
      if (userId) {
        storage.saveTelegramLink({ chatId, userId, createdAt: new Date().toISOString() });
        await sendTelegramMessage(chatId, `✅ Compte lié !\n\n${HELP}`, token);
      } else {
        await sendTelegramMessage(chatId, '❌ Code invalide ou expiré. Générez-en un nouveau dans l\'app (vue Configuration).', token);
      }
      return;
    }
    await sendTelegramMessage(chatId, '👋 Bienvenue ! Pour lier ton compte LaunchForge : ouvre l\'app web, vue Configuration, et envoie-moi le code à 6 caractères.', token);
    return;
  }

  if (!isAIConfigured()) {
    await sendTelegramMessage(chatId, '⚠️ L\'IA n\'est pas configurée côté serveur (OPENROUTER_API_KEY).', token);
    return;
  }

  try {
    const reply = await handleUserMessage(chatId, link.userId, text);
    await sendTelegramMessage(chatId, reply, token);
  } catch (err) {
    await sendTelegramMessage(chatId, `⚠️ Erreur : ${err instanceof Error ? err.message : 'inconnue'}`, token);
  }
}

// ── Rappels ───────────────────────────────────────────────────────────────────

type SendFn = (chatId: string, text: string, token?: string) => Promise<void>;

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
    // Le rappel part par le bot de l'utilisateur (personnel sinon global)
    const token = tokenForUser(reminder.userId) ?? undefined;
    for (const link of links) {
      await send(link.chatId, `⏰ Rappel : ${reminder.text}`, token);
    }
    storage.markReminderSent(reminder.id);
    sent += 1;
  }
  return sent;
}

// ── Démarrage : un poller par bot (global + personnels) ──────────────────────

/** clé : 'global' ou userId du propriétaire → fonction d'arrêt du poller */
const pollers = new Map<string, () => void>();
let remindersStarted = false;

function startPolling(key: string, token: string, ownerUserId: string | null): void {
  if (pollers.has(key)) return;
  const state = { running: true };
  pollers.set(key, () => { state.running = false; pollers.delete(key); });

  (async () => {
    let offset = 0;
    while (state.running) {
      try {
        const res = await fetch(
          `${api(token, 'getUpdates')}?timeout=${POLL_TIMEOUT_S}&offset=${offset}&allowed_updates=["message"]`,
          { signal: AbortSignal.timeout((POLL_TIMEOUT_S + 10) * 1000) },
        );
        const data: any = await res.json();
        for (const update of data?.result || []) {
          offset = Math.max(offset, update.update_id + 1);
          processUpdate(update, token, ownerUserId).catch(() => { /* isolé par message */ });
        }
      } catch {
        await new Promise((r) => setTimeout(r, 5000)); // réseau : on respire puis on repart
      }
    }
  })();
}

/**
 * Valide le token d'un bot personnel via getMe, l'enregistre (chiffré) et
 * démarre son poller. Retourne le @username du bot.
 */
export async function setUserBot(userId: string, token: string): Promise<string> {
  let username = '';
  try {
    const res = await fetch(api(token, 'getMe'), { signal: AbortSignal.timeout(8000) });
    const data: any = await res.json();
    if (!data?.ok || !data?.result?.username) {
      throw new Error('Token refusé par Telegram — vérifiez-le auprès de @BotFather');
    }
    username = `@${data.result.username}`;
  } catch (err) {
    if (err instanceof Error && err.message.includes('BotFather')) throw err;
    throw new Error('Impossible de vérifier le token auprès de Telegram — réessayez');
  }

  // Remplacer l'éventuel poller existant de cet utilisateur
  pollers.get(userId)?.();
  storage.setTelegramBot(userId, token, username);
  startPolling(userId, token, userId);
  ensureRemindersLoop();
  return username;
}

/** Arrête et supprime le bot personnel de l'utilisateur */
export function removeUserBot(userId: string): void {
  pollers.get(userId)?.();
  storage.setTelegramBot(userId, null, null);
}

function ensureRemindersLoop(): void {
  if (remindersStarted) return;
  remindersStarted = true;
  const reminderTimer = setInterval(() => {
    dispatchDueReminders().catch(() => { /* best-effort */ });
  }, 60_000);
  reminderTimer.unref?.();
}

export function startTelegramBot(): boolean {
  // Bot global (env) — le bot partagé des comptes sans bot personnel
  if (process.env.TELEGRAM_BOT_TOKEN) {
    startPolling('global', process.env.TELEGRAM_BOT_TOKEN, null);
    console.log('💬 Bot Telegram global démarré (long polling)');
  } else {
    console.log('⏸️  Bot Telegram global inactif (TELEGRAM_BOT_TOKEN manquant)');
  }

  // Bots personnels enregistrés en base
  let personal = 0;
  try {
    for (const bot of storage.getAllTelegramBots()) {
      startPolling(bot.userId, bot.token, bot.userId);
      personal += 1;
    }
  } catch { /* base pas prête : les bots personnels démarreront à l'enregistrement */ }
  if (personal > 0) console.log(`💬 ${personal} bot(s) Telegram personnel(s) démarré(s)`);

  if (pollers.size === 0) return false;
  ensureRemindersLoop();
  return true;
}

export function stopTelegramBot(): void {
  for (const stop of [...pollers.values()]) stop();
}
