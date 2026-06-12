/**
 * Analyse de leads & emailing — détecte les prospects/partenaires les plus
 * intéressés à partir de commentaires/messages ou de la boîte mail (via le
 * serveur MCP Composio), et envoie des emails depuis la boîte de l'utilisateur.
 */

import { chatComplete, sanitizeJson, isAIConfigured } from './aiClient';
import { runMcpTask, guardedReply, platformKeywords, isComposioConfigured } from './composio';
import { buildCompanyContext, buildKnowledgeContext } from './contentAssistant';
import { Contact, ContactType, LeadCandidate } from '../types';

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
    maxTokens: 4000,
    jsonMode: true,
  });

  return parseCandidates(result.content);
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
    maxTokens: 1500,
    jsonMode: true,
  });

  const parsed = JSON.parse(sanitizeJson(result.content));
  if (!parsed.subject || !parsed.body) throw new Error('Brouillon vide');
  return { subject: String(parsed.subject).slice(0, 200), body: String(parsed.body) };
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

export { isComposioConfigured };
