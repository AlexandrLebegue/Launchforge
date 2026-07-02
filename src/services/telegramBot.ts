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
import { markPublished, generateOccurrenceContent, crosspostTo, cleanupPublishedVideo } from './postPublisher';
import { publishViaComposio, syncMetricsViaComposio, resolvePublishedUrl, isComposioConfigured, runMcpTask } from './composio';
import { fetchHubSpotDeals, fetchHubSpotContacts, fetchHubSpotCrm, upsertHubSpotCandidates } from './hubspotCrm';
import { webSearch, fetchPageText } from './research';
import { generateImage, isImageGenConfigured } from './imageGen';
import { generateDeckMarkdown, themeForUser } from './decks';
import { analyzePost, generateCampaignReport } from './analytics';
import { buildMemoryContext, refreshAssistantMemory } from './assistantMemory';
import { toTelegramMarkdownV2 } from './telegramFormat';
import { assertWithinUsage, recordUsage, assertFeature, QuotaError, FeatureError, Feature } from './entitlements';
import { renderDeckGif, renderDeckMp4 } from './deckMedia';
import { saveMediaFile } from './mediaStore';
import { uploadPublicImage } from './imageGen';
import { AgentRun, Contact, CronJob, CronFrequency, CRON_FREQUENCY_MINUTES, DealStage, DEAL_STAGES, KnowledgeCategory, KnowledgeEntry, Post, Recurrence, Reminder, STAGE_LABELS } from '../types';
import { normalizeSchedule, computeNextRunAt, describeCronSchedule, scheduleOf, nominalMinutes } from './cronSchedule';

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

/** Un appel sendMessage : renvoie true si Telegram a accepté (res.ok). */
async function postSendMessage(token: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(api(token, 'sendMessage'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.ok;
  } catch {
    return false; // best-effort (réseau) — jamais bloquant
  }
}

export async function sendTelegramMessage(chatId: string, text: string, token?: string): Promise<void> {
  const t = token ?? process.env.TELEGRAM_BOT_TOKEN;
  if (!t) return;
  const raw = text.slice(0, 4000);
  // On tente d'abord le rendu MarkdownV2 (gras, listes, liens, code…) à partir
  // du markdown de l'IA. Si Telegram rejette le parsing (400), on renvoie le
  // texte BRUT : une erreur d'échappement ne doit jamais faire perdre le message.
  const formatted = toTelegramMarkdownV2(raw);
  if (formatted.length <= 4096) {
    const ok = await postSendMessage(t, { chat_id: chatId, text: formatted, parse_mode: 'MarkdownV2' });
    if (ok) return;
  }
  await postSendMessage(t, { chat_id: chatId, text: raw });
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

// ── Contexte commercial : adapte l'assistant au besoin réel de l'utilisateur ──
const OBJECTIVE_LABELS: Record<string, string> = {
  launch: 'lancer / trouver les premiers clients',
  'grow-revenue': 'vendre plus / faire grandir le chiffre d\'affaires',
  both: 'lancer et vendre plus',
};
const TRACTION_LABELS: Record<string, string> = {
  'pre-revenue': 'pré-revenu (pas encore de client payant)',
  'first-customers': 'premiers clients',
  'early-revenue': 'revenu débutant',
  scaling: 'passage à l\'échelle',
};
const SALES_MOTION_LABELS: Record<string, string> = {
  'self-serve': 'libre-service',
  'sales-led': 'vente assistée (démos/appels)',
  hybrid: 'hybride',
};
const eur = (n: number): string => `${Math.round(n).toLocaleString('fr-FR')} €`;

/**
 * Bloc « contexte commercial + pipeline » injecté dans le prompt système de
 * l'assistant (app ET Telegram) pour qu'il s'adapte AU BESOIN de l'utilisateur :
 * son objectif, son stade, son frein, et l'état réel de son pipeline de vente.
 */
export function buildSalesContext(userId: string): string {
  const project = storage.getActivePlan(userId);
  if (!project) return '';
  const gtm = project.input;
  const need: string[] = [];
  if (gtm.primaryObjective) need.push(`- Priorité du moment : ${OBJECTIVE_LABELS[gtm.primaryObjective] ?? gtm.primaryObjective}`);
  if (gtm.traction) need.push(`- Stade commercial : ${TRACTION_LABELS[gtm.traction] ?? gtm.traction}`);
  if (gtm.salesMotion) need.push(`- Mode de vente : ${SALES_MOTION_LABELS[gtm.salesMotion] ?? gtm.salesMotion}`);
  if (gtm.buyer) need.push(`- Acheteur (qui décide) : ${gtm.buyer}`);
  if (gtm.revenueGoal) need.push(`- Objectif de chiffre d'affaires : ${gtm.revenueGoal}`);
  if (gtm.bottleneck) need.push(`- Frein n°1 à lever : ${gtm.bottleneck}`);

  const contacts = storage.getContactsByPlan(userId, project.id);
  const won = contacts.filter((c) => c.stage === 'won');
  const open = contacts.filter((c) => c.stage === 'qualified' || c.stage === 'discussion' || c.stage === 'proposal');
  const hot = contacts.filter((c) => (c.interestScore ?? 0) >= 70).length;
  const pipe: string[] = [];
  if (open.length) pipe.push(`${open.length} deals ouverts (${eur(open.reduce((s, c) => s + (c.amount ?? 0), 0))})`);
  if (won.length) pipe.push(`${won.length} gagnés (${eur(won.reduce((s, c) => s + (c.amount ?? 0), 0))} de CA)`);
  if (hot) pipe.push(`${hot} leads chauds à relancer`);

  let block = '';
  if (need.length) block += `\n\n## Contexte commercial — adapte-toi à CE besoin\n${need.join('\n')}`;
  if (pipe.length) block += `\n\n## Pipeline actuel\n- ${pipe.join(' · ')}`;
  return block;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'get_overview',
    description: 'Vue d\'ensemble : posts programmés, contenus à valider, leads chauds, pipeline de vente, prochaine publication, rappels à venir. Appelle ça pour « où en est-on ? », « statut », « résumé ».',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'list_pipeline',
    description: 'Liste les deals/contacts du pipeline de vente groupés par étape, avec montants, CA gagné et pipeline ouvert. Pour « mon pipeline », « où en sont mes deals », « combien de CA », « qui relancer ».',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'move_deal',
    description: 'Fait avancer un contact/deal dans le pipeline de vente (et fixe éventuellement son montant). Étapes : new, qualified, discussion, proposal, won, lost. Pour « passe Marie en proposition », « marque le deal Acme gagné à 5000 ».',
    parameters: {
      type: 'object',
      properties: {
        contactName: { type: 'string', description: 'Nom (ou partie du nom) du contact/deal' },
        stage: { type: 'string', description: 'new | qualified | discussion | proposal | won | lost' },
        amount: { type: 'number', description: 'Montant du deal en € (optionnel)' },
      },
      required: ['contactName', 'stage'],
    },
  },
  {
    name: 'hubspot_list_deals',
    description: 'Lit les DEALS du CRM HubSpot connecté (lecture directe Composio, sans import ni coût IA) : nom, étape, montant, date de closing. Pour « mes deals HubSpot », « qu\'est-ce qu\'il y a dans mon HubSpot ? ». Différent de list_pipeline (pipeline LaunchForge local).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'hubspot_list_contacts',
    description: 'Lit les CONTACTS du CRM HubSpot connecté (lecture directe Composio, sans import ni coût IA) : nom, email, société, étape déduite du cycle de vie. Pour « mes contacts HubSpot ».',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'hubspot_import_crm',
    description: 'IMPORTE les deals et contacts HubSpot dans le pipeline de vente LaunchForge du projet actif (dédupliqué : un ré-import met à jour étapes/montants sans écraser les notes). Même action que le bouton « Importer depuis HubSpot » du CRM. Demande confirmation à l\'utilisateur avant.',
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
    description: 'Publie immédiatement un post du Hub via Composio (donne l\'id court renvoyé par draft_post ou list_upcoming_posts). Le média attaché (image ou vidéo) est transmis à la plateforme ; une vidéo locale est supprimée du serveur après publication et le lien publié est enregistré sur le post. Instagram/TikTok/YouTube REFUSENT un post sans média : attache-le d\'abord avec set_post_image. Demande TOUJOURS confirmation avant.',
    parameters: { type: 'object', properties: { postId: { type: 'string' } }, required: ['postId'] },
  },
  {
    name: 'set_post_image',
    description: 'Attache (ou remplace) le MÉDIA d\'un post du Hub à partir d\'une URL (image, GIF ou vidéo mp4/webm/mov). À utiliser quand l\'utilisateur fournit une URL de média — indispensable avant de publier sur Instagram (média requis) ou YouTube/TikTok (vidéo requise).',
    parameters: {
      type: 'object',
      properties: {
        postId:   { type: 'string', description: 'Id court du post' },
        imageUrl: { type: 'string', description: 'URL https du média (image ou vidéo)' },
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
  {
    name: 'create_cron_job',
    description: 'Crée une AUTOMATISATION (cron job IA) : une tâche récurrente que l\'IA exécutera toute seule, en utilisant TOUS ses outils (web, base de connaissances, métriques des posts, rédaction/programmation/publication de posts, emails, agenda…). Pour « chaque lundi à 9h rédige un post sur les actus », « tous les jours à 8h vérifie mes leads chauds et relance-les », « toutes les heures surveille X ». Décris l\'objectif de façon précise et autonome (il n\'y aura personne pour préciser au moment de l\'exécution). Le fuseau est Europe/Paris.',
    parameters: {
      type: 'object',
      properties: {
        title:      { type: 'string', description: 'Titre court de l\'automatisation' },
        objective:  { type: 'string', description: 'Objectif détaillé : ce que l\'IA doit accomplir à chaque exécution, et ce qu\'elle doit produire/faire (rédiger, programmer, envoyer, prévenir…).' },
        frequency:  { type: 'string', enum: ['hourly', 'every_3h', 'every_6h', 'daily', 'weekly', 'monthly'], description: 'Périodicité. hourly/every_3h/every_6h = plusieurs fois par jour (pas d\'heure fixe) ; daily/weekly/monthly = à une heure précise (timeOfDay).' },
        timeOfDay:  { type: 'string', description: 'Heure de déclenchement « HH:MM » (Europe/Paris) pour daily/weekly/monthly. Défaut 09:00.' },
        weekday:    { type: 'number', description: 'Jour de la semaine pour weekly : 1=lundi, 2=mardi … 7=dimanche.' },
        dayOfMonth: { type: 'number', description: 'Jour du mois pour monthly : 1 à 28.' },
      },
      required: ['title', 'objective', 'frequency'],
    },
  },
  {
    name: 'list_cron_jobs',
    description: 'Liste les automatisations (cron jobs) configurées pour le projet : titre, objectif, cadence, état (active/en pause), prochaine exécution et dernier résultat.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'update_cron_job',
    description: 'Modifie une automatisation existante (donne l\'id court renvoyé par list_cron_jobs) : change son titre, son objectif, sa périodicité/heure, ou met-la en pause / réactive-la (enabled).',
    parameters: {
      type: 'object',
      properties: {
        jobId:      { type: 'string', description: 'Id court de l\'automatisation' },
        title:      { type: 'string' },
        objective:  { type: 'string' },
        frequency:  { type: 'string', enum: ['hourly', 'every_3h', 'every_6h', 'daily', 'weekly', 'monthly'] },
        timeOfDay:  { type: 'string', description: 'Heure « HH:MM » (Europe/Paris) pour daily/weekly/monthly.' },
        weekday:    { type: 'number', description: 'Jour de la semaine (weekly) : 1=lundi … 7=dimanche.' },
        dayOfMonth: { type: 'number', description: 'Jour du mois (monthly) : 1 à 28.' },
        enabled:    { type: 'boolean', description: 'true = active, false = en pause' },
      },
      required: ['jobId'],
    },
  },
  {
    name: 'delete_cron_job',
    description: 'Supprime définitivement une automatisation (et son historique). Demande confirmation avant.',
    parameters: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
  },
  {
    name: 'run_cron_job',
    description: 'Déclenche MAINTENANT une automatisation (elle s\'exécutera dans la minute qui suit) sans attendre sa prochaine échéance. Pour « lance tout de suite mon automatisation X ».',
    parameters: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] },
  },
  {
    name: 'list_recurring_posts',
    description: 'Liste les SÉRIES RÉCURRENTES du projet : cadence, prochaine occurrence, réglages IA (instruction, base de connaissances, actus, archivage veille, auto-publication) et nombre d\'occurrences déjà publiées. Pour « quels sont mes posts récurrents ? », « où en sont mes séries ? ».',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'configure_recurrence',
    description: 'Configure (ou arrête avec recurrence=none) la RÉCURRENCE d\'un post du Hub : cadence, instruction de régénération IA (le sujet/angle que l\'IA doit traiter à chaque occurrence), accès à la base de connaissances, recherche d\'actualités web, archivage des actus en fiche Veille. Pour « rends ce post hebdomadaire », « change le sujet de ma série », « active les actus sur ma série ».',
    parameters: {
      type: 'object',
      properties: {
        postId:        { type: 'string', description: 'Id court du post (draft_post ou list_upcoming_posts)' },
        recurrence:    { type: 'string', enum: ['none', 'daily', 'weekly', 'biweekly', 'monthly'], description: 'Cadence (none = arrêter la série)' },
        brief:         { type: 'string', description: 'Instruction de régénération IA (sujet, angle, ce que l\'IA doit chercher) — vide = même contenu repris' },
        useNews:       { type: 'boolean', description: 'S\'appuyer sur une recherche d\'actualités web' },
        useKnowledge:  { type: 'boolean', description: 'S\'appuyer sur la base de connaissances (défaut : oui)' },
        archiveNews:   { type: 'boolean', description: 'Archiver les actus utilisées dans la fiche 📰 Veille de la base de connaissances' },
      },
      required: ['postId', 'recurrence'],
    },
  },
  {
    name: 'simulate_recurrence',
    description: 'MODE SIMULÉ : génère la prochaine occurrence d\'une série récurrente avec ses réglages actuels SANS rien enregistrer ni publier — montre le résultat à l\'utilisateur pour valider les réglages. Pour « simule ma série », « montre-moi ce que donnerait la prochaine occurrence ».',
    parameters: {
      type: 'object',
      properties: { postId: { type: 'string', description: 'Id court du post récurrent' } },
      required: ['postId'],
    },
  },
  {
    name: 'crosspost_post',
    description: 'DÉCLINE un post du Hub vers d\'autres plateformes : un exemplaire indépendant par plateforme (mêmes date/auto-publication, métriques séparées), reliés en groupe multi-plateformes pour comparer leurs performances. Avec adapt=true (défaut conseillé), l\'IA réécrit chaque exemplaire aux codes de sa plateforme. Pour « publie aussi ce post sur X et Instagram », « décline-le partout ».',
    parameters: {
      type: 'object',
      properties: {
        postId:    { type: 'string', description: 'Id court du post à décliner' },
        platforms: { type: 'array', items: { type: 'string' }, description: 'Plateformes cibles (linkedin, twitter, instagram, facebook, reddit, blog, newsletter…)' },
        adapt:     { type: 'boolean', description: 'true = l\'IA adapte le contenu aux codes de chaque plateforme (défaut conseillé)' },
      },
      required: ['postId', 'platforms'],
    },
  },
  {
    name: 'add_knowledge',
    description: 'AJOUTE une fiche à la BASE DE CONNAISSANCES du projet actif — elle sera injectée dans TOUTES les générations de contenu futures. Pour « retiens que… », « ajoute à la base de connaissances… », « note que notre cible est… ». Reformule l\'information proprement et de façon autonome (compréhensible sans le contexte du chat) avant d\'enregistrer. Si une fiche du même titre existe déjà, le contenu y est ajouté à la suite.',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          enum: ['company', 'product', 'audience', 'tone', 'offers', 'learnings', 'news', 'other'],
          description: 'company=entreprise · product=produit/service · audience=cibles · tone=ton & style · offers=offres & tarifs · learnings=enseignements · news=veille/actus · other=divers',
        },
        title:   { type: 'string', description: 'Titre court et descriptif de la fiche' },
        content: { type: 'string', description: 'L\'information à retenir, rédigée proprement' },
      },
      required: ['category', 'title', 'content'],
    },
  },
  {
    name: 'list_knowledge',
    description: 'LISTE les fiches de la base de connaissances du projet actif (catégorie, titre, extrait) — pour vérifier ce que l\'IA sait déjà, éviter les doublons avant add_knowledge, ou répondre à « qu\'est-ce que tu sais sur nous ? ».',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'search_conversations',
    description: 'Recherche dans les ANCIENNES conversations de l\'utilisateur avec l\'assistant (remémoration inter-sessions). Pour « on avait dit quoi sur… ? », « qu\'est-ce que je t\'avais demandé à propos de X ? », retrouver une décision passée. Renvoie des extraits des fils correspondants.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Mots-clés à retrouver dans l\'historique (sujet, nom, décision…)' },
      },
      required: ['query'],
    },
  },
];

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const shortId = (id: string) => id.slice(0, 8);

function findByShortId<T extends { id: string }>(items: T[], ref: string): T | undefined {
  return items.find((i) => i.id === ref || i.id.startsWith(ref));
}

// Outils Telegram qui consomment une génération IA (mêmes quotas que les routes
// HTTP — le bot est une interface à part qui ne passe pas par leur garde).
const AI_GEN_TOOLS = new Set([
  'simulate_recurrence', 'crosspost_post', 'draft_post', 'generate_deck', 'analyze_post', 'campaign_report',
]);
const AI_IMAGE_TOOLS = new Set(['generate_image']);

// Outils réservés à Brasier (mêmes verrous que les routes HTTP) — un compte
// Braise ayant lié Telegram pendant l'essai ne doit pas les contourner ensuite.
const FEATURE_TOOLS: Record<string, Feature> = {
  publish_post: 'publish',
  simulate_recurrence: 'recurring',
  configure_recurrence: 'recurring',
  analyze_post: 'analytics',
  campaign_report: 'analytics',
  sync_post_metrics: 'analytics',
  send_email_to_contact: 'leads',
  create_cron_job: 'automations',
  update_cron_job: 'automations',
  run_cron_job: 'automations',
};

/**
 * Garde de quota + fonctionnalités autour du dispatcher : un compte Braise au-delà
 * de sa limite (ou sans la fonctionnalité) reçoit un message clair au lieu d'agir
 * (sinon Telegram contournerait l'offre freemium). L'usage IA n'est compté
 * qu'après une exécution réussie.
 */
export async function executeTool(userId: string, chatId: string, name: string, args: any): Promise<string> {
  const feat = FEATURE_TOOLS[name];
  if (feat) {
    try { assertFeature(userId, feat); }
    catch (e) { if (e instanceof FeatureError) return `⚠️ ${e.message}`; throw e; }
  }
  const kind: 'ai_image' | 'ai_generation' | null =
    AI_IMAGE_TOOLS.has(name) ? 'ai_image' : (AI_GEN_TOOLS.has(name) ? 'ai_generation' : null);
  if (kind) {
    try {
      assertWithinUsage(userId, kind);
    } catch (e) {
      if (e instanceof QuotaError) return `⚠️ ${e.message}`;
      throw e;
    }
  }
  const result = await executeToolInner(userId, chatId, name, args);
  if (kind) recordUsage(userId, kind);
  return result;
}

async function executeToolInner(userId: string, _chatId: string, name: string, args: any): Promise<string> {
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
      const contacts = storage.getContactsByPlan(userId, planId);
      const hotLeads = contacts.filter((c) => (c.interestScore ?? 0) >= 70);
      const openDeals = contacts.filter((c) => c.stage === 'qualified' || c.stage === 'discussion' || c.stage === 'proposal');
      const wonRevenue = contacts.filter((c) => c.stage === 'won').reduce((sum, c) => sum + (c.amount ?? 0), 0);
      const reminders = storage.getPendingRemindersByUserId(userId);
      return [
        `Posts programmés : ${scheduled.length}${nextPost ? ` (prochain : « ${nextPost.title} » sur ${nextPost.platform} le ${fmtDate(nextPost.scheduledAt)})` : ''}`,
        `Posts publiés : ${posts.filter((p) => p.status === 'published').length}`,
        `Contenus à valider : ${approvals.length}`,
        `Leads chauds (score ≥ 70) : ${hotLeads.length}${hotLeads[0] ? ` (top : ${hotLeads[0].name})` : ''}`,
        `Pipeline : ${openDeals.length} deals ouverts${wonRevenue ? ` · ${eur(wonRevenue)} de CA gagné` : ''}`,
        `Rappels à venir : ${reminders.length}`,
      ].join('\n');
    }

    case 'list_pipeline': {
      const contacts = storage.getContactsByPlan(userId, planId);
      if (contacts.length === 0) return 'Pipeline vide — importe ton CRM HubSpot ou analyse tes leads pour le remplir.';
      const lines: string[] = [];
      for (const st of DEAL_STAGES) {
        const col = contacts.filter((c) => c.stage === st);
        if (col.length === 0) continue;
        const total = col.reduce((sum, c) => sum + (c.amount ?? 0), 0);
        const items = col.slice(0, 8).map((c) => `[${shortId(c.id)}] ${c.name}${c.amount != null ? ` ${eur(c.amount)}` : ''}`).join(', ');
        lines.push(`${STAGE_LABELS[st]} (${col.length}${total ? `, ${eur(total)}` : ''}) : ${items}`);
      }
      const won = contacts.filter((c) => c.stage === 'won').reduce((sum, c) => sum + (c.amount ?? 0), 0);
      const open = contacts.filter((c) => c.stage === 'qualified' || c.stage === 'discussion' || c.stage === 'proposal').reduce((sum, c) => sum + (c.amount ?? 0), 0);
      return `${lines.join('\n')}\n\nCA gagné : ${eur(won)} · Pipeline ouvert : ${eur(open)}`;
    }

    case 'move_deal': {
      const ref = String(args.contactName || '').toLowerCase();
      const contact = storage.getContactsByPlan(userId, planId).find((c) => c.name.toLowerCase().includes(ref));
      if (!contact) return `ERREUR : contact « ${args.contactName} » introuvable.`;
      const stage = String(args.stage || '').toLowerCase() as DealStage;
      if (!DEAL_STAGES.includes(stage)) return `ERREUR : étape « ${args.stage} » invalide (new, qualified, discussion, proposal, won, lost).`;
      const patch: Partial<Contact> = { stage };
      const amt = Number(args.amount);
      if (Number.isFinite(amt) && amt >= 0) patch.amount = amt;
      storage.updateContact(contact.id, patch);
      const shownAmount = patch.amount ?? contact.amount;
      return `${contact.name} déplacé en « ${STAGE_LABELS[stage]} »${shownAmount != null ? ` (${eur(shownAmount)})` : ''}.`;
    }

    // ── CRM HubSpot (lecture directe Composio, déterministe — aucun coût IA) ──
    // Les projets d'équipe utilisent le compte HubSpot du PROPRIÉTAIRE du projet,
    // comme le bouton « Importer depuis HubSpot » du CRM web.

    case 'hubspot_list_deals': {
      try {
        const deals = await fetchHubSpotDeals(storage.resolveActiveProject(userId).ownerUserId);
        if (deals.length === 0) return 'Aucun deal dans le CRM HubSpot connecté.';
        const shown = deals.slice(0, 30);
        const total = deals.reduce((sum, d) => sum + (d.amount ?? 0), 0);
        return `${shown.map((d) =>
          `• ${d.name} — ${STAGE_LABELS[d.stage]}${d.amount != null ? ` · ${eur(d.amount)}` : ''}${d.expectedCloseDate ? ` · closing ${d.expectedCloseDate}` : ''}`
        ).join('\n')}${deals.length > shown.length ? `\n… et ${deals.length - shown.length} autres deals` : ''}\n\nTotal : ${deals.length} deals${total ? ` · ${eur(total)}` : ''} (lecture directe HubSpot — hubspot_import_crm pour les ramener dans le pipeline).`;
      } catch (e) {
        return `ERREUR : ${e instanceof Error ? e.message : 'lecture des deals HubSpot échouée'}`;
      }
    }

    case 'hubspot_list_contacts': {
      try {
        const people = await fetchHubSpotContacts(storage.resolveActiveProject(userId).ownerUserId);
        if (people.length === 0) return 'Aucun contact dans le CRM HubSpot connecté.';
        const shown = people.slice(0, 30);
        return `${shown.map((c) =>
          `• ${c.name}${c.email ? ` <${c.email}>` : ''}${c.company ? ` · ${c.company}` : ''} — ${STAGE_LABELS[c.stage]}${c.summary ? ` · ${c.summary}` : ''}`
        ).join('\n')}${people.length > shown.length ? `\n… et ${people.length - shown.length} autres contacts` : ''}\n\nTotal : ${people.length} contacts (lecture directe HubSpot — hubspot_import_crm pour les ramener dans le pipeline).`;
      } catch (e) {
        return `ERREUR : ${e instanceof Error ? e.message : 'lecture des contacts HubSpot échouée'}`;
      }
    }

    case 'hubspot_import_crm': {
      const ctx = storage.resolveActiveProject(userId);
      if (ctx.role === 'viewer') return 'ERREUR : rôle Lecteur sur ce projet — import non autorisé.';
      try {
        const candidates = await fetchHubSpotCrm(ctx.ownerUserId);
        const { imported, updated } = upsertHubSpotCandidates(ctx.ownerUserId, ctx.planId, candidates);
        return `Import HubSpot terminé : ${imported} nouvelle(s) fiche(s), ${updated} mise(s) à jour — deals et contacts sont dans le pipeline (list_pipeline pour le voir).`;
      } catch (e) {
        return `ERREUR : ${e instanceof Error ? e.message : 'import HubSpot échoué'}`;
      }
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
      if (!/^https?:\/\/\S+$/i.test(url)) return 'ERREUR : URL de média invalide (http/https attendu).';
      const posts = storage.getPostsByPlan(userId, planId);
      const post = findByShortId(posts, String(args.postId || ''));
      if (!post) return 'ERREUR : post introuvable.';
      storage.updatePost(post.id, { imageUrl: url });
      return `Média attaché au post [${shortId(post.id)}] — prêt à publier (y compris sur Instagram/YouTube).`;
    }

    case 'list_recurring_posts': {
      const posts = storage.getPostsByPlan(userId, planId);
      const heads = posts.filter((p) => p.recurrence !== 'none' && (p.status === 'scheduled' || p.status === 'draft'));
      if (heads.length === 0) return 'Aucune série récurrente sur ce projet. Transforme un post en série avec configure_recurrence.';
      return heads.map((p) => {
        const sid = p.seriesId ?? p.id;
        const publishedCount = posts.filter((x) => (x.seriesId ?? x.id) === sid && x.status === 'published').length;
        const flags = [
          p.recurrenceBrief ? `🪄 IA : « ${p.recurrenceBrief} »` : 'contenu repris tel quel (pas d\'instruction IA)',
          p.recurrenceUseKnowledge ? '📚 connaissances ON' : '📚 connaissances OFF',
          p.recurrenceUseNews ? '📰 actus ON' : '📰 actus OFF',
          p.recurrenceUpdateKb ? '📥 archivage veille ON' : null,
          p.autoPublish ? '⚡ auto-publication' : null,
        ].filter(Boolean).join(' · ');
        return `[${shortId(p.id)}] « ${p.title || '(sans titre)'} » — ${p.platform}, ${p.recurrence}, prochaine : ${fmtDate(p.scheduledAt)} · ${publishedCount} occurrence(s) publiée(s)\n${flags}`;
      }).join('\n\n');
    }

    case 'configure_recurrence': {
      const posts = storage.getPostsByPlan(userId, planId);
      const post = findByShortId(posts, String(args.postId || ''));
      if (!post) return 'ERREUR : post introuvable.';
      const rec = String(args.recurrence || '');
      if (!['none', 'daily', 'weekly', 'biweekly', 'monthly'].includes(rec)) {
        return 'ERREUR : cadence invalide (none, daily, weekly, biweekly, monthly).';
      }
      const patch: Partial<Post> = { recurrence: rec as Recurrence };
      if (args.brief !== undefined)        patch.recurrenceBrief = String(args.brief).trim().slice(0, 600) || null;
      if (args.useNews !== undefined)      patch.recurrenceUseNews = args.useNews ? 1 : 0;
      if (args.useKnowledge !== undefined) patch.recurrenceUseKnowledge = args.useKnowledge ? 1 : 0;
      if (args.archiveNews !== undefined)  patch.recurrenceUpdateKb = args.archiveNews ? 1 : 0;
      storage.updatePost(post.id, patch);
      const fresh = storage.getPostById(post.id)!;
      if (rec === 'none') return `Série arrêtée : « ${fresh.title || shortId(fresh.id)} » redevient un post ponctuel.`;
      return [
        `Série configurée : [${shortId(fresh.id)}] « ${fresh.title || '(sans titre)'} » (${fresh.platform}) — ${rec}.`,
        fresh.recurrenceBrief
          ? `🪄 À chaque occurrence l'IA régénère : « ${fresh.recurrenceBrief} » (📚 connaissances ${fresh.recurrenceUseKnowledge ? 'ON' : 'OFF'} · 📰 actus ${fresh.recurrenceUseNews ? 'ON' : 'OFF'}${fresh.recurrenceUpdateKb ? ' · 📥 archivage veille ON' : ''}).`
          : '⚠️ Pas d\'instruction IA : le même contenu sera republié tel quel — propose à l\'utilisateur d\'en définir une.',
        'Tu peux vérifier le résultat avec simulate_recurrence avant la première occurrence.',
      ].join('\n');
    }

    case 'simulate_recurrence': {
      const posts = storage.getPostsByPlan(userId, planId);
      const post = findByShortId(posts, String(args.postId || ''));
      if (!post) return 'ERREUR : post introuvable.';
      if (post.recurrence === 'none') return 'ERREUR : ce post n\'est pas récurrent — configure d\'abord la série avec configure_recurrence.';
      if (!post.recurrenceBrief) return 'ERREUR : cette série n\'a pas d\'instruction de régénération — sans elle le même contenu est repris tel quel. Définis-en une avec configure_recurrence.';
      // Simulation : jamais d'écriture en base de connaissances
      const gen = await generateOccurrenceContent({ ...post, recurrenceUpdateKb: 0 });
      const tags = gen.hashtags.length > 0 ? `\n\n${gen.hashtags.map((h) => `#${h}`).join(' ')}` : '';
      return `🧪 SIMULATION (rien n'a été enregistré ni publié) — voici ce que donnerait la prochaine occurrence :\n\nTitre : ${gen.title}\n\n${gen.content}${tags}`;
    }

    case 'crosspost_post': {
      const posts = storage.getPostsByPlan(userId, planId);
      const post = findByShortId(posts, String(args.postId || ''));
      if (!post) return 'ERREUR : post introuvable.';
      const platforms = Array.isArray(args.platforms) ? args.platforms.map(String) : [];
      if (platforms.length === 0) return 'ERREUR : indique au moins une plateforme cible.';

      const created = await crosspostTo(post, platforms, args.adapt !== false);
      if (created.length === 0) {
        return 'Aucun exemplaire créé : ces plateformes sont déjà couvertes par ce groupe multi-plateformes.';
      }
      return [
        `Post décliné sur ${created.length} plateforme(s) — groupe multi-plateformes [${shortId(post.crossPostId ?? post.id)}] :`,
        ...created.map((p) =>
          `[${shortId(p.id)}] ${p.platform} — ${p.status === 'scheduled' ? `programmé le ${fmtDate(p.scheduledAt)}${p.autoPublish ? ' · ⚡ auto' : ''}` : p.status}`),
        'Chaque exemplaire se publie et se mesure séparément ; la vue Performances comparera les plateformes sur ce même contenu.',
      ].join('\n');
    }

    case 'add_knowledge': {
      const CATEGORIES: KnowledgeCategory[] = ['company', 'product', 'audience', 'tone', 'offers', 'learnings', 'news', 'other'];
      const category = (CATEGORIES.includes(args.category) ? args.category : 'other') as KnowledgeCategory;
      const title = String(args.title || '').trim().slice(0, 120);
      const content = String(args.content || '').trim().slice(0, 4000);
      if (!title || !content) return 'ERREUR : titre et contenu requis.';

      // Même titre dans la même catégorie → on enrichit la fiche au lieu de dupliquer
      const existing = storage.getKnowledgeByPlan(userId, planId)
        .find((e) => e.category === category && e.title.toLowerCase() === title.toLowerCase());
      if (existing) {
        storage.updateKnowledge(existing.id, { content: `${existing.content}\n\n${content}`.slice(0, 8000) });
        return `Fiche existante enrichie : « ${existing.title} » (${category}). L'information sera utilisée dans les prochaines générations.`;
      }

      const now = new Date().toISOString();
      const entry: KnowledgeEntry = {
        id: uuid(), userId, planId, category, title, content, createdAt: now, updatedAt: now,
      };
      storage.saveKnowledge(entry);
      return `Fiche ajoutée à la base de connaissances : « ${title} » (${category}). Elle sera injectée dans toutes les générations de contenu du projet.`;
    }

    case 'list_knowledge': {
      const entries = storage.getKnowledgeByPlan(userId, planId);
      if (entries.length === 0) return 'Base de connaissances vide pour ce projet — propose à l\'utilisateur d\'y ajouter l\'essentiel (cible, ton, offres) avec add_knowledge.';
      return entries.map((e) =>
        `[${e.category}] « ${e.title} » — ${e.content.slice(0, 140).replace(/\n+/g, ' ')}${e.content.length > 140 ? '…' : ''}`
      ).join('\n');
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
        status: 'draft', scheduledAt: null, publishedAt: null, externalUrl: null, externalId: null,
        imageUrl: typeof args.imageUrl === 'string' && /^https?:\/\//i.test(args.imageUrl.trim()) ? args.imageUrl.trim() : null,
        subreddit: null,
        recurrence: 'none', recurrenceBrief: null, seriesId: null, recurrenceUseNews: 0, recurrenceUseKnowledge: 1, recurrenceUpdateKb: 0, crossPostId: null,
        autoPublish: 0, publishError: null, calendarSynced: 0,
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
      const result = await publishViaComposio(userId, post.platform, post.content, post.imageUrl, post.title);
      if (result.trim().toUpperCase().startsWith('OK')) {
        markPublished(post);
        // URL cliquable du post créé (reconstruite si besoin), enregistrée pour
        // la synchro des métriques et renvoyée à l'utilisateur pour vérification
        const url = resolvePublishedUrl(post.platform, result);
        if (url) storage.updatePost(post.id, { externalUrl: url });
        cleanupPublishedVideo(storage.getPostById(post.id)!);
        const link = url && /^https?:\/\//i.test(url)
          ? `\n🔗 ${url}`
          : (url ? `\n🔗 Référence enregistrée — les métriques se synchroniseront automatiquement.` : '');
        return `Publié sur ${post.platform} : ${result.replace(/^OK:\s*/i, '')}${link}`;
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

    case 'search_conversations': {
      const query = String(args.query || '').trim();
      if (query.length < 2) return 'ERREUR : précise un ou plusieurs mots-clés à rechercher.';
      const hits = storage.searchConversations(userId, query, 5);
      if (hits.length === 0) return `Aucune conversation passée ne mentionne « ${query} ».`;
      return `Fils passés mentionnant « ${query} » :\n${hits
        .map((h) => `- [${fmtDate(h.updatedAt)}] « ${h.title} »${h.snippet ? ` : ${h.snippet}` : ''}`)
        .join('\n')}`;
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
      storage.recordMetricSnapshot(storage.getPostById(post.id)!);
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

    case 'create_cron_job': {
      const title = String(args.title || '').trim().slice(0, 120);
      const objective = String(args.objective || '').trim().slice(0, 4000);
      const freq = String(args.frequency || '') as CronFrequency;
      if (!title || !objective) return 'ERREUR : titre et objectif requis.';
      if (!CRON_FREQUENCY_MINUTES[freq]) return 'ERREUR : périodicité invalide (hourly, every_3h, every_6h, daily, weekly, monthly).';
      const schedule = normalizeSchedule({ frequency: freq, timeOfDay: args.timeOfDay, weekday: args.weekday, dayOfMonth: args.dayOfMonth });
      const now = new Date();
      const nowIso = now.toISOString();
      const job: CronJob = {
        id: uuid(), userId, planId,
        title, objective,
        frequency: schedule.frequency, timeOfDay: schedule.timeOfDay, weekday: schedule.weekday, dayOfMonth: schedule.dayOfMonth,
        intervalMinutes: nominalMinutes(schedule.frequency), enabled: 1,
        nextRunAt: computeNextRunAt(schedule, now),
        lastRunAt: null, lastStatus: null, lastResult: null,
        createdAt: nowIso, updatedAt: nowIso,
      };
      storage.saveCronJob(job);
      return `Automatisation créée : [${shortId(job.id)}] « ${title} » — ${describeCronSchedule(schedule)}. Première exécution : ${fmtDate(job.nextRunAt)}. Elle tournera ensuite toute seule et t'enverra son compte rendu ici (et dans la section Automatisations de l'app).`;
    }

    case 'list_cron_jobs': {
      const jobs = storage.getCronJobsByPlan(userId, planId);
      if (jobs.length === 0) return 'Aucune automatisation configurée. Crée-en une avec create_cron_job.';
      return jobs.map((j) =>
        `[${shortId(j.id)}] « ${j.title} » — ${describeCronSchedule(scheduleOf(j))} · ${j.enabled ? 'active' : '⏸️ en pause'} · prochaine : ${fmtDate(j.nextRunAt)}` +
        `${j.lastRunAt ? `\n  Dernier : ${j.lastStatus === 'ok' ? '✅' : '⚠️'} ${fmtDate(j.lastRunAt)} — ${(j.lastResult || '').slice(0, 160).replace(/\n+/g, ' ')}` : ''}` +
        `\n  Objectif : ${j.objective.slice(0, 220)}`,
      ).join('\n\n');
    }

    case 'update_cron_job': {
      const jobs = storage.getCronJobsByPlan(userId, planId);
      const job = findByShortId(jobs, String(args.jobId || ''));
      if (!job) return 'ERREUR : automatisation introuvable.';
      const patch: Partial<CronJob> = { updatedAt: new Date().toISOString() };
      if (typeof args.title === 'string' && args.title.trim()) patch.title = args.title.trim().slice(0, 120);
      if (typeof args.objective === 'string' && args.objective.trim()) patch.objective = args.objective.trim().slice(0, 4000);
      const scheduleTouched = args.frequency !== undefined || args.timeOfDay !== undefined || args.weekday !== undefined || args.dayOfMonth !== undefined;
      if (scheduleTouched) {
        const freq = (args.frequency !== undefined ? String(args.frequency) : job.frequency) as CronFrequency;
        if (!CRON_FREQUENCY_MINUTES[freq]) return 'ERREUR : périodicité invalide.';
        const schedule = normalizeSchedule({
          frequency: freq,
          timeOfDay: args.timeOfDay !== undefined ? args.timeOfDay : job.timeOfDay,
          weekday: args.weekday !== undefined ? args.weekday : job.weekday,
          dayOfMonth: args.dayOfMonth !== undefined ? args.dayOfMonth : job.dayOfMonth,
        });
        patch.frequency = schedule.frequency;
        patch.timeOfDay = schedule.timeOfDay;
        patch.weekday = schedule.weekday;
        patch.dayOfMonth = schedule.dayOfMonth;
        patch.intervalMinutes = nominalMinutes(schedule.frequency);
        patch.nextRunAt = computeNextRunAt(schedule, new Date());
      }
      if (args.enabled !== undefined) patch.enabled = args.enabled ? 1 : 0;
      storage.updateCronJob(job.id, patch);
      const fresh = storage.getCronJobById(job.id)!;
      return `Automatisation mise à jour : [${shortId(fresh.id)}] « ${fresh.title} » — ${describeCronSchedule(scheduleOf(fresh))} · ${fresh.enabled ? 'active' : 'en pause'}.`;
    }

    case 'delete_cron_job': {
      const jobs = storage.getCronJobsByPlan(userId, planId);
      const job = findByShortId(jobs, String(args.jobId || ''));
      if (!job) return 'ERREUR : automatisation introuvable.';
      storage.deleteCronJob(job.id);
      return `Automatisation « ${job.title} » supprimée.`;
    }

    case 'run_cron_job': {
      const jobs = storage.getCronJobsByPlan(userId, planId);
      const job = findByShortId(jobs, String(args.jobId || ''));
      if (!job) return 'ERREUR : automatisation introuvable.';
      const nowIso = new Date().toISOString();
      storage.updateCronJob(job.id, { enabled: 1, nextRunAt: nowIso, updatedAt: nowIso });
      return `Automatisation « ${job.title} » planifiée pour une exécution immédiate — elle tournera dans la minute et t'enverra son compte rendu.`;
    }

    default:
      return `Outil inconnu : ${name}`;
  }
}

// ── Boucle agentique par message ──────────────────────────────────────────────

const conversations = new Map<string, ChatMessage[]>();

function systemPrompt(userId: string): string {
  const now = new Date();
  const memory = buildMemoryContext(userId, storage.getActivePlanId(userId));
  return `Tu es l'assistant LaunchForge sur Telegram — le copilote de croissance et de vente de l'utilisateur (startup/petite entreprise). Ton objectif : l'aider à décrocher des clients et faire grandir son chiffre d'affaires. Tu réponds court et utile — c'est un chat mobile, pas un rapport. Tu tutoies l'utilisateur et tu réponds dans sa langue (français par défaut).${memory}

Date/heure actuelle : ${now.toISOString()} (utilise-la pour calculer « demain 9h », « dans 2h », etc. — l'utilisateur est en Europe/Paris).${buildSalesContext(userId)}

Tu agis via tes outils : état des activités, posts programmés/récurrents, validations de contenus, lancement d'agents, rédaction de posts (avec recherche web : actus, chiffres, tendances — utilise web_search proactivement quand ça renforce le contenu, et cite tes sources), emails (lecture de la boîte avec read_emails ; envoi à un contact avec send_email_to_contact ou à n'importe quelle adresse avec send_email), pipeline de vente (list_pipeline pour l'état des deals/CA, move_deal pour faire avancer un deal), CRM HubSpot connecté (hubspot_list_deals / hubspot_list_contacts pour lire directement le CRM, hubspot_import_crm pour l'importer dans le pipeline — avec confirmation), agenda Google Calendar (calendar_events, create_calendar_event), métriques des posts publiés (sync_post_metrics), analyse de performance (analyze_post pour un post, campaign_report pour le bilan global — leurs enseignements améliorent automatiquement les générations suivantes), visuels IA (generate_image — indispensable pour Instagram), présentations/carrousels (generate_deck, puis render_deck_media pour en faire un GIF/MP4 animé), rappels, automatisations récurrentes (create_cron_job pour programmer une tâche IA qui se relance toute seule à intervalle régulier ; list_cron_jobs / update_cron_job / delete_cron_job / run_cron_job).
Règles :
- Sois orienté VENTE : priorise ce qui rapproche d'un client payant. Si un frein commercial est indiqué dans le contexte, attaque-le. Propose proactivement de relancer les leads chauds (send_email_to_contact) et de faire avancer les deals (move_deal).
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
    { role: 'system', content: systemPrompt(userId) },
    ...history.slice(-HISTORY_LIMIT),
  ];

  let reply = '';
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const result = await chatComplete({ messages, userId, tools: TOOLS, maxTokens: 1200 });
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

  const planId = storage.getActivePlanId(userId);
  // On ne retient que les tours texte utilisateur/assistant, pas les messages d'outils.
  const turns = history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.content as string }));

  // Historisation du fil Telegram dans la MÊME table que l'assistant web (un fil
  // roulant par chat, id stable) : la remémoration inter-sessions
  // (search_conversations) devient symétrique entre les deux canaux, et
  // l'historique survit aux redémarrages. Best-effort — ne casse jamais la réponse.
  try {
    if (turns.length > 0) {
      storage.upsertConversation({ id: `tg-${chatId}`, userId, planId, messages: turns });
    }
  } catch (err) {
    console.error('Telegram conversation persist error:', err);
  }

  // Mémoire inter-sessions (throttlée, best-effort).
  void refreshAssistantMemory(userId, planId, turns);

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
