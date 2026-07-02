/**
 * Analyse de leads & emailing — détecte les prospects/partenaires les plus
 * intéressés à partir de commentaires/messages ou de la boîte mail (via le
 * serveur MCP Composio), et envoie des emails depuis la boîte de l'utilisateur.
 */

import { chatComplete, sanitizeJson, isAIConfigured, ChatMessage } from './aiClient';
import { runMcpTask, guardedReply, platformKeywords, isComposioConfigured } from './composio';
import { executeComposioTool } from './composioDirect';
import { composioUserIdFor } from './composioConnect';
import { buildCompanyContext, buildKnowledgeContext } from './contentAssistant';
import { Contact, ContactType, LeadCandidate, STAGE_LABELS } from '../types';

export const MAIL_KEYWORDS = ['gmail', 'mail', 'outlook', 'email'];

const CANDIDATE_JSON_SPEC = `Réponds UNIQUEMENT avec un objet JSON :
{"candidates": [{
  "name": "nom de la personne (ou pseudo)",
  "email": "email si présent, sinon null",
  "company": "entreprise si identifiable, sinon null",
  "suggestedType": "prospect" | "client" | "partner",
  "score": 0-100,
  "summary": "1-2 phrases : pourquoi ce score, quel est son besoin/intérêt",
  "excerpt": "courte citation du message qui justifie le score"
}]}

Barème du score d'intérêt :
- 90-100 : intention d'achat explicite, demande de démo/devis/prix, proposition de partenariat concrète
- 70-89  : questions précises sur le produit, cas d'usage décrit, demande d'informations
- 40-69  : intérêt général, compliments avec engagement, partage spontané
- 0-39   : commentaire vague, simple like verbal, hors sujet
Ignore les spams, bots et messages purement négatifs. candidates vide si personne d'intéressant.`;

function parseCandidates(raw: string): LeadCandidate[] {
  let parsed: any;
  try {
    parsed = JSON.parse(sanitizeJson(raw));
  } catch {
    // Le modèle a répondu en prose (ex. outil indisponible, compte non
    // connecté) : on remonte son explication plutôt qu'une erreur de parsing.
    throw new Error(raw.replace(/^[\s*_#>`]+/, '').slice(0, 250) || 'Réponse illisible du modèle');
  }
  const list = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
  const types: ContactType[] = ['prospect', 'client', 'partner'];
  return list
    .filter((c: any) => c && typeof c.name === 'string' && c.name.trim())
    .map((c: any): LeadCandidate => ({
      name: String(c.name).trim().slice(0, 120),
      email: typeof c.email === 'string' && c.email.includes('@') ? c.email.trim() : null,
      company: typeof c.company === 'string' && c.company.trim() ? c.company.trim().slice(0, 120) : null,
      suggestedType: types.includes(c.suggestedType) ? c.suggestedType : 'prospect',
      score: Math.max(0, Math.min(100, Math.round(Number(c.score) || 0))),
      summary: typeof c.summary === 'string' ? c.summary.slice(0, 400) : '',
      excerpt: typeof c.excerpt === 'string' ? c.excerpt.slice(0, 400) : '',
    }));
}

/**
 * Analyse un bloc de texte (commentaires d'un post, DMs, emails collés…)
 * et en extrait les personnes intéressées, scorées.
 */
export async function analyzeMessages(
  userId: string,
  text: string,
  source: string,
): Promise<LeadCandidate[]> {
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const company = buildCompanyContext(userId);

  const result = await chatComplete({
    messages: [
      {
        role: 'system',
        content: `Tu es un analyste commercial. On te donne des messages reçus par une startup (commentaires, DMs, emails). Identifie chaque personne réelle et évalue son niveau d'intérêt pour devenir client ou partenaire.${company ? `\n\n## L'entreprise concernée\n${company}` : ''}\n\n${CANDIDATE_JSON_SPEC}`,
      },
      {
        role: 'user',
        content: `Source : ${source}\n\n--- Messages reçus ---\n${text.slice(0, 30000)}`,
      },
    ],
    userId,
    maxTokens: 4000,
    jsonMode: true,
  });

  return parseCandidates(result.content);
}

/**
 * (Ré)évalue le score d'intérêt d'UN SEUL contact, à partir de ce qu'on sait de
 * lui (entreprise, notes, derniers échanges). Renvoie score + justification.
 */
export async function scoreContact(userId: string, contact: Contact): Promise<{ score: number; summary: string }> {
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const material = [
    contact.company ? `Entreprise : ${contact.company}` : '',
    contact.notes ? `Notes : ${contact.notes}` : '',
    contact.manualLog ? `Échanges saisis à la main :\n${contact.manualLog}` : '',
    contact.lastInteraction ? `Emails reçus récents :\n${contact.lastInteraction}` : '',
  ].filter(Boolean).join('\n\n');
  if (!material.trim()) {
    throw new Error('Rien à analyser — synchronisez ses emails (onglet Emails) ou ajoutez des « Échanges manuels » avant de scorer.');
  }

  const company = buildCompanyContext(userId);
  const result = await chatComplete({
    messages: [
      {
        role: 'system',
        content: `Tu es un analyste commercial. Évalue le niveau d'intérêt de « ${contact.name} » à devenir client, à partir des éléments fournis.${company ? `\n\n## L'entreprise concernée (ce qu'on vend)\n${company}` : ''}

Réponds UNIQUEMENT avec un objet JSON : {"score": 0-100, "summary": "1-2 phrases justifiant le score : son besoin/intérêt et le signal décisif"}

Barème du score d'intérêt :
- 90-100 : intention d'achat explicite (demande de démo/devis/prix, proposition concrète)
- 70-89  : questions précises sur le produit, cas d'usage décrit, demande d'informations
- 40-69  : intérêt général, compliments avec engagement
- 0-39   : vague, hors sujet, aucun signal d'achat`,
      },
      { role: 'user', content: material.slice(0, 20000) },
    ],
    userId,
    maxTokens: 400,
    jsonMode: true,
  });

  const parsed = JSON.parse(sanitizeJson(result.content));
  return {
    score: Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0))),
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 500) : '',
  };
}

/**
 * Scanne la boîte mail de l'utilisateur via ses outils Composio (Gmail/Outlook)
 * et en extrait les prospects/partenaires intéressés.
 */
export async function scanInbox(userId: string): Promise<LeadCandidate[]> {
  const company = buildCompanyContext(userId);

  const { reply, okCalls } = await runMcpTask(
    userId,
    MAIL_KEYWORDS,
    `Tu es un analyste commercial avec accès à la boîte mail de l'utilisateur via les outils Composio.
Mission : liste les emails REÇUS récents (30 derniers jours, ~20 emails max), repère ceux qui montrent un intérêt commercial pour l'entreprise (questions produit, demandes de démo/prix, propositions de partenariat, clients existants qui écrivent), et évalue chaque expéditeur.
Ignore newsletters, notifications automatiques, spam et emails envoyés par l'utilisateur lui-même.${company ? `\n\n## L'entreprise de l'utilisateur\n${company}` : ''}

${CANDIDATE_JSON_SPEC}`,
    'Scanne ma boîte de réception et identifie les personnes les plus intéressées (prospects, clients, partenaires potentiels).',
    ['fetch', 'list', 'search', 'get', 'thread', 'message'],
  );

  const candidates = parseCandidates(reply);
  // Anti-hallucination : des leads sans la moindre lecture réussie de la
  // boîte mail sont forcément inventés.
  if (candidates.length > 0 && okCalls === 0) {
    throw new Error('Le modèle a proposé des leads sans avoir pu lire la boîte mail — résultat rejeté par sécurité');
  }
  return candidates;
}

/**
 * Scanne les réactions d'un post publié (likes + commentaires) via les outils
 * Composio de la plateforme et en extrait les personnes intéressées.
 */
export async function scanPostEngagement(
  userId: string,
  platform: string,
  externalUrl: string,
  title: string,
): Promise<LeadCandidate[]> {
  const company = buildCompanyContext(userId);

  const { reply, okCalls } = await runMcpTask(
    userId,
    platformKeywords(platform),
    `Tu es un analyste commercial avec accès aux outils ${platform} de l'utilisateur via Composio.
Mission : retrouve le post indiqué (via son URL/identifiant), récupère ses COMMENTAIRES et, si les outils le permettent, la liste des personnes qui ont liké/réagi ou repartagé. Évalue ensuite chaque personne.
Pondération : un commentaire avec question ou besoin exprimé pèse bien plus qu'un like ; un like seul vaut au mieux 30-45 ; un repartage avec texte 50-70. Regroupe les signaux d'une même personne (like + commentaire = score renforcé).
Ignore les bots, les comptes spam et les commentaires purement négatifs.${company ? `\n\n## L'entreprise de l'utilisateur\n${company}` : ''}

${CANDIDATE_JSON_SPEC}`,
    `Analyse les réactions de ce post ${platform} et identifie les personnes les plus intéressées :\nURL : ${externalUrl}\nTitre (indice) : ${title || '—'}`,
    ['comment', 'replies', 'lookup', 'get', 'search', 'fetch', 'like'],
  );

  const candidates = parseCandidates(reply);
  if (candidates.length > 0 && okCalls === 0) {
    throw new Error('Le modèle a proposé des leads sans avoir pu lire les réactions du post — résultat rejeté par sécurité');
  }
  return candidates;
}

// ── Emails sortants ───────────────────────────────────────────────────────────

export interface EmailDraft {
  subject: string;
  body: string;
}

/** Rédige un brouillon d'email personnalisé pour un contact */
export async function draftEmailForContact(
  userId: string,
  contact: Contact,
  goal: string,
): Promise<EmailDraft> {
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const company = buildCompanyContext(userId);
  const knowledge = buildKnowledgeContext(userId, 5000);

  const typeLabel = { prospect: 'prospect', client: 'client existant', partner: 'partenaire' }[contact.type];
  const contactContext = [
    `Nom : ${contact.name}`,
    contact.company && `Entreprise : ${contact.company}`,
    `Relation : ${typeLabel}`,
    contact.interestScore !== null && `Score d'intérêt estimé : ${contact.interestScore}/100`,
    contact.interestSummary && `Analyse : ${contact.interestSummary}`,
    contact.lastInteraction && `Derniers échanges :\n${contact.lastInteraction.slice(0, 2000)}`,
    contact.notes && `Notes : ${contact.notes.slice(0, 1000)}`,
  ].filter(Boolean).join('\n');

  const result = await chatComplete({
    messages: [
      {
        role: 'system',
        content: `Tu rédiges des emails commerciaux courts, personnalisés et humains pour une startup — jamais de template impersonnel ni de jargon marketing. Tu écris en français sauf si les échanges précédents sont dans une autre langue. Adapte le ton à la relation (prospect = donner envie sans forcer ; client = soigner ; partenaire = collaboratif).${company ? `\n\n## L'entreprise\n${company}` : ''}${knowledge ? `\n\n## Base de connaissances (source de vérité)\n${knowledge}` : ''}\n\nRéponds UNIQUEMENT avec un objet JSON : {"subject": "objet de l'email", "body": "corps de l'email en texte simple, signé au nom de l'utilisateur"}`,
      },
      {
        role: 'user',
        content: `## Destinataire\n${contactContext}\n\n## Objectif de l'email\n${goal}`,
      },
    ],
    userId,
    maxTokens: 1500,
    jsonMode: true,
  });

  const parsed = JSON.parse(sanitizeJson(result.content));
  if (!parsed.subject || !parsed.body) throw new Error('Brouillon vide');
  return { subject: String(parsed.subject).slice(0, 200), body: String(parsed.body) };
}

// ── Copilote « prochaine action » (chat streaming) ───────────────────────────

export interface NextActionChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

/** Construit le bloc de contexte d'un contact injecté dans le copilote de vente. */
function buildContactContext(contact: Contact): string {
  const typeLabel = { prospect: 'prospect', client: 'client existant', partner: 'partenaire' }[contact.type];
  return [
    `Nom : ${contact.name}`,
    contact.company && `Entreprise : ${contact.company}`,
    `Relation : ${typeLabel}`,
    `Étape du pipeline : ${STAGE_LABELS[contact.stage]}`,
    contact.amount != null && `Montant du deal : ${contact.amount} €`,
    contact.expectedCloseDate && `Clôture estimée : ${contact.expectedCloseDate}`,
    contact.nextAction && `Prochaine action déjà notée : ${contact.nextAction}${contact.nextActionAt ? ` (échéance ${contact.nextActionAt})` : ''}`,
    contact.interestScore !== null && `Score d'intérêt : ${contact.interestScore}/100`,
    contact.interestSummary && `Analyse du score : ${contact.interestSummary}`,
    contact.source && `Origine du contact : ${contact.source}`,
    contact.lastInteraction && `Emails reçus récents :\n${contact.lastInteraction.slice(0, 3000)}`,
    contact.manualLog && `Échanges saisis à la main (appels, réunions) :\n${contact.manualLog.slice(0, 2000)}`,
    contact.notes && `Notes internes : ${contact.notes.slice(0, 1000)}`,
  ].filter(Boolean).join('\n');
}

/**
 * Un tour du copilote commercial « prochaine action » : à partir de la fiche du
 * contact, de son entreprise, des emails échangés et de la base de connaissances,
 * l'IA aide l'utilisateur à décider et préparer la meilleure action suivante.
 * Streame la réponse via `onDelta`.
 */
export async function runNextActionChatTurn(
  userId: string,
  contact: Contact,
  history: NextActionChatMessage[],
  onDelta: (text: string) => void,
): Promise<string> {
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const company = buildCompanyContext(userId);
  const knowledge = buildKnowledgeContext(userId, 4000);

  const system = `Tu es un copilote commercial. Tu aides l'utilisateur (le vendeur) à décider et préparer la PROCHAINE ACTION concrète à mener avec ce contact pour faire avancer la vente.

Méthode :
- Appuie-toi UNIQUEMENT sur les échanges réels et la fiche fournis ci-dessous (ne présume pas ce qui n'y est pas).
- Propose 1 à 3 options d'action classées par pertinence, chacune avec en une ligne le « pourquoi ».
- Rends l'action immédiatement exécutable : ébauche le texte d'email/message, les points d'un appel, la question clé à poser, ou l'étape logistique (devis, relance, démo…).
- Si des informations manquent pour trancher, pose UNE question ciblée à l'utilisateur.
- Sois direct, chaleureux et pro, en français. Pas de blabla générique, pas de remplissage.${company ? `\n\n## Ce qu'on vend / notre entreprise\n${company}` : ''}${knowledge ? `\n\n## Base de connaissances (source de vérité)\n${knowledge}` : ''}\n\n## Fiche du contact ciblé\n${buildContactContext(contact)}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    ...history.slice(-20).map((m): ChatMessage => ({ role: m.role, content: m.text.slice(0, 8000) })),
  ];

  const result = await chatComplete({ messages, userId, maxTokens: 1400, onDelta });
  return result.content;
}

/** Envoie un email depuis la boîte de l'utilisateur via ses outils Composio */
export async function sendEmailViaComposio(
  userId: string,
  to: string,
  subject: string,
  body: string,
): Promise<string> {
  // Voie directe (API Composio, sans appel modèle) : Gmail au schéma vérifié.
  // Échec ou boîte non-Gmail → l'opérateur IA cherche le bon outil mail (MCP).
  if (process.env.COMPOSIO_API_KEY) {
    const { sendEmailDirect } = await import('./composioDirect');
    const direct = await sendEmailDirect(userId, to, subject, body);
    if (direct.handled) return direct.result!;
  }

  const result = await runMcpTask(
    userId,
    MAIL_KEYWORDS,
    `Tu es un opérateur d'envoi d'emails. Tu disposes des outils de la boîte mail de l'utilisateur via Composio.
Mission : envoyer l'email EXACTEMENT tel que fourni (destinataire, objet, corps — ne réécris rien) avec l'outil d'envoi approprié.
Si l'envoi réussit, réponds "OK:" suivi d'une confirmation courte. Sinon "ECHEC:" suivi de la raison.
IMPÉRATIF : ta réponse finale commence par "OK:" ou "ECHEC:" — rien avant, pas de markdown, pas d'explication préalable.`,
    `Envoie cet email :\nÀ : ${to}\nObjet : ${subject}\n\nCorps :\n${body}`,
    ['send', 'reply', 'draft', 'message'],
  );
  return guardedReply(result);
}

// ── Suivi des emails d'un contact (envoyés + reçus) ──────────────────────────

export interface ContactEmailItem {
  direction: 'sent' | 'received';
  subject: string | null;
  snippet: string | null;
  sentAt: string;
  externalId: string | null;
}

export interface ContactEmailsSync {
  items: ContactEmailItem[];
  /** Trace de diagnostic remontée jusqu'à l'UI pour débogage */
  debug: {
    address: string;
    okCalls: number;
    failedCalls: number;
    parsedEmails: number;
    replyPreview: string;
    parseError?: string;
    warning?: string;
    /** Chemin utilisé : 'gmail-direct' (déterministe) ou 'mcp-operator' (IA) */
    source?: string;
  };
}

// ── Parsing Gmail (déterministe) ──────────────────────────────────────────────

const sTrim = (v: unknown, max = 300): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max)
    : (v != null && typeof v !== 'object' ? String(v).slice(0, max) : null);

/** Extrait le tableau de messages de la réponse GMAIL_FETCH_EMAILS (formes variées). */
function gmailRows(data: any): any[] {
  const d = data?.data ?? data?.response_data ?? data;
  return Array.isArray(d?.messages) ? d.messages
    : Array.isArray(d?.emails) ? d.emails
      : Array.isArray(d?.results) ? d.results
        : Array.isArray(d) ? d : [];
}

/** Jeton de page suivante d'une réponse GMAIL_FETCH_EMAILS (formes variées). */
function gmailNextPageToken(data: any): string | undefined {
  const d = data?.data ?? data?.response_data ?? data;
  const t = d?.nextPageToken ?? d?.next_page_token;
  return typeof t === 'string' && t ? t : undefined;
}

/** Lit un header d'un message Gmail (payload.headers) si présent. */
function headerOf(m: any, name: string): string | null {
  const headers = m?.payload?.headers ?? m?.headers;
  if (Array.isArray(headers)) {
    const h = headers.find((x: any) => String(x?.name).toLowerCase() === name.toLowerCase());
    if (h?.value) return String(h.value);
  }
  return null;
}

function normDate(v: any): string {
  if (v == null || v === '') return new Date().toISOString();
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) { const d = new Date(n); if (!Number.isNaN(d.getTime())) return d.toISOString(); }
  const d2 = new Date(s);
  return Number.isNaN(d2.getTime()) ? new Date().toISOString() : d2.toISOString();
}

function gmailToItem(m: any, address: string): ContactEmailItem {
  const labels: string[] = Array.isArray(m?.labelIds) ? m.labelIds : (Array.isArray(m?.label_ids) ? m.label_ids : []);
  const sender = String(m?.sender ?? m?.from ?? headerOf(m, 'From') ?? '').toLowerCase();
  let direction: 'sent' | 'received';
  if (labels.includes('SENT')) direction = 'sent';
  else if (sender) direction = sender.includes(address.toLowerCase()) ? 'received' : 'sent';
  else direction = 'received';
  return {
    direction,
    subject: sTrim(m?.subject ?? headerOf(m, 'Subject'), 300),
    snippet: sTrim(m?.snippet ?? m?.preview?.body ?? m?.messageText ?? m?.body ?? m?.text, 500),
    sentAt: normDate(m?.messageTimestamp ?? m?.message_timestamp ?? m?.internalDate ?? m?.internal_date ?? headerOf(m, 'Date')),
    externalId: sTrim(m?.messageId ?? m?.message_id ?? m?.id, 200),
  };
}

/**
 * Lecture Gmail DIRECTE (déterministe, sans LLM) des emails échangés avec une
 * adresse. Repli opérateur volontairement DÉSACTIVÉ pour l'instant (mode test) :
 * les erreurs remontent telles quelles.
 */
export async function fetchContactEmails(userId: string, address: string): Promise<ContactEmailsSync> {
  const uid = composioUserIdFor(userId);
  if (!uid) throw new Error('Compte Composio introuvable — connectez Gmail dans Configuration.');

  const data = await executeComposioTool(uid, 'GMAIL_FETCH_EMAILS', {
    user_id: 'me',
    query: `from:${address} OR to:${address}`,
    max_results: 20,
    include_payload: false,
  });

  const rows = gmailRows(data);
  const items = rows.map((m) => gmailToItem(m, address)).filter((it) => it.subject || it.snippet);

  const debug = {
    address,
    okCalls: 1,
    failedCalls: 0,
    parsedEmails: rows.length,
    replyPreview: JSON.stringify(data).slice(0, 1500),
    source: 'gmail-direct',
    warning: rows.length === 0 ? 'GMAIL_FETCH_EMAILS a renvoyé 0 message — vérifiez la forme exacte dans replyPreview.' : undefined,
  };
  console.log('[emails/sync] gmail-direct', JSON.stringify({ address, rows: rows.length, items: items.length }));
  return { items, debug };
}

export interface InboxMessage {
  fromEmail: string | null;
  subject: string | null;
  snippet: string | null;
  sentAt: string;
  externalId: string | null;
}

function extractEmail(v: any): string | null {
  const m = String(v ?? '').match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

/**
 * Lecture Gmail DIRECTE des emails REÇUS récents de l'inbox (pour le scan CRM).
 * Déterministe, sans LLM. Les erreurs remontent (mode test).
 */
export async function fetchInboxMessages(userId: string, max = 50, daysBack = 30): Promise<{ messages: InboxMessage[]; rawCount: number; replyPreview: string }> {
  const uid = composioUserIdFor(userId);
  if (!uid) throw new Error('Compte Composio introuvable — connectez Gmail dans Configuration.');
  const query = `in:inbox newer_than:${daysBack}d`;

  // Composio plafonne la taille d'UNE réponse : demander 200 emails d'un coup
  // (corps complets) dépasse la limite. On pagine par petites pages jusqu'au
  // max demandé — chaque page reste sous la limite.
  const PAGE = 25;
  const rows: any[] = [];
  let pageToken: string | undefined;
  let firstReply = '';
  for (let guard = 0; guard < 20 && rows.length < max; guard++) {
    const data = await executeComposioTool(uid, 'GMAIL_FETCH_EMAILS', {
      user_id: 'me',
      query,
      max_results: Math.min(PAGE, max - rows.length),
      ...(pageToken ? { page_token: pageToken } : {}),
    });
    if (!firstReply) firstReply = JSON.stringify(data).slice(0, 1200);
    rows.push(...gmailRows(data));
    pageToken = gmailNextPageToken(data);
    if (!pageToken) break;
  }

  const messages: InboxMessage[] = rows
    .filter((m: any) => !(Array.isArray(m?.labelIds) && m.labelIds.includes('SENT')))
    .map((m: any): InboxMessage => ({
      fromEmail: extractEmail(m?.sender ?? m?.from ?? headerOf(m, 'From')),
      subject: sTrim(m?.subject ?? headerOf(m, 'Subject'), 300),
      snippet: sTrim(m?.snippet ?? m?.preview?.body ?? m?.messageText ?? m?.body ?? m?.text, 500),
      sentAt: normDate(m?.messageTimestamp ?? m?.message_timestamp ?? m?.internalDate ?? m?.internal_date ?? headerOf(m, 'Date')),
      externalId: sTrim(m?.messageId ?? m?.message_id ?? m?.id, 200),
    }))
    .filter((m) => m.fromEmail);
  console.log('[scan-inbox] gmail-direct', JSON.stringify({ rows: rows.length, withSender: messages.length }));
  return { messages, rawCount: rows.length, replyPreview: firstReply };
}

/**
 * Ancien chemin via l'opérateur MCP (LLM) — conservé pour le futur repli
 * « semi-déterministe ». Non branché pour l'instant.
 */
export async function fetchContactEmailsViaOperator(userId: string, address: string): Promise<ContactEmailsSync> {
  const { reply, okCalls, failedCalls } = await runMcpTask(
    userId,
    MAIL_KEYWORDS,
    `Tu as accès à la boîte mail de l'utilisateur via les outils Composio.
Mission : retrouve les emails ÉCHANGÉS avec l'adresse ${address} — envoyés PAR l'utilisateur À cette adresse, et reçus DE cette adresse (20 plus récents max).
Utilise l'outil de recherche/liste de la boîte mail avec une requête du type « from:${address} OR to:${address} ».
Pour chacun : direction ("sent" si l'utilisateur est l'expéditeur, sinon "received"), objet, court extrait (1-2 phrases), date ISO, identifiant du message.
Réponds UNIQUEMENT avec un JSON : {"emails":[{"direction":"sent"|"received","subject":"...","snippet":"...","date":"ISO","id":"messageId"}]}. emails vide si aucun.`,
    `Liste les emails échangés avec ${address}.`,
    ['fetch', 'list', 'search', 'get', 'thread', 'message'],
  );

  let parsed: any = null;
  let parseError: string | undefined;
  try {
    parsed = JSON.parse(sanitizeJson(reply));
  } catch (e) {
    parseError = e instanceof Error ? e.message : 'parse failed';
  }
  const list = Array.isArray(parsed?.emails) ? parsed.emails : [];
  const items: ContactEmailItem[] = list
    .filter((e: any) => e && (typeof e.subject === 'string' || typeof e.snippet === 'string'))
    .map((e: any): ContactEmailItem => ({
      direction: e.direction === 'sent' ? 'sent' : 'received',
      subject: typeof e.subject === 'string' ? e.subject.slice(0, 300) : null,
      snippet: typeof e.snippet === 'string' ? e.snippet.slice(0, 500) : null,
      sentAt: typeof e.date === 'string' && e.date.trim() ? e.date.trim() : new Date().toISOString(),
      externalId: typeof e.id === 'string' && e.id.trim() ? e.id.trim().slice(0, 200) : null,
    }));

  const debug = { address, okCalls, failedCalls, parsedEmails: list.length, replyPreview: reply.slice(0, 1000), parseError, source: 'mcp-operator' };
  return { items: okCalls === 0 ? [] : items, debug };
}

export { isComposioConfigured };
