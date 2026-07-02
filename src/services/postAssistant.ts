/**
 * Assistant conversationnel de création de posts — un chat dans le Hub de
 * contenu qui aide à trouver des idées, cherche sur le web (actus, références,
 * inspiration), rédige et itère avec l'utilisateur, puis enregistre le post
 * en brouillon dans le projet actif quand l'utilisateur valide.
 */

import { v4 as uuid } from 'uuid';
import { chatComplete, ChatMessage, ToolDef, isAIConfigured } from './aiClient';
import { webSearch, fetchPageText } from './research';
import { buildCompanyContext, buildKnowledgeContext } from './contentAssistant';
import { storage } from './storage';
import { Post } from '../types';

const MAX_TOOL_ITERATIONS = 6;

export { isAIConfigured };

const TOOLS: ToolDef[] = [
  {
    name: 'web_search',
    description:
      'Recherche sur le web : actualités du secteur, tendances, posts viraux sur un sujet, données chiffrées, inspiration. Utilise des requêtes ciblées.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Requête, ex. "tendances marketing SaaS 2026" ou "statistiques télétravail France"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_website',
    description: 'Lit le contenu texte d\'une page web précise (article, étude, site) pour s\'en inspirer ou en citer des éléments.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL complète' },
      },
      required: ['url'],
    },
  },
  {
    name: 'save_post',
    description:
      'Enregistre le post finalisé en BROUILLON dans le Hub de contenu de l\'utilisateur. N\'appelle cet outil QUE quand l\'utilisateur a validé explicitement le contenu (« ok », « enregistre », « parfait »…). Le contenu doit être la version finale complète.',
    parameters: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['linkedin', 'twitter', 'instagram', 'facebook', 'tiktok', 'youtube', 'reddit', 'blog', 'newsletter', 'producthunt', 'hackernews', 'indiehackers'],
        },
        title: { type: 'string', description: 'Titre interne court' },
        content: { type: 'string', description: 'Le contenu complet, prêt à publier' },
        scheduledAt: { type: 'string', description: 'Date/heure ISO 8601 si l\'utilisateur a demandé une programmation, sinon omettre' },
        imageUrl: { type: 'string', description: 'URL du visuel si l\'utilisateur en a fourni un' },
        subreddit: { type: 'string', description: 'OBLIGATOIRE si platform="reddit" : le subreddit cible sans le préfixe « r/ » (ex. "SaaS"). Demande-le à l\'utilisateur s\'il manque.' },
      },
      required: ['platform', 'title', 'content'],
    },
  },
];

function systemPrompt(userId: string): string {
  const company   = buildCompanyContext(userId);
  const knowledge = buildKnowledgeContext(userId, 6000);
  const recentTitles = storage.getPostsByPlan(userId, storage.getActivePlanId(userId))
    .slice(0, 12)
    .map((p) => p.title)
    .filter(Boolean);

  const parts = [
    `Tu es l'assistant de création de contenu de LaunchForge. Tu aides l'utilisateur à imaginer, rédiger et peaufiner ses posts dans un chat — ton réactif, concret, orienté résultat. Tu réponds dans la langue de l'utilisateur (français par défaut).

Méthode :
- Si l'utilisateur cherche des idées : propose 3 angles courts et tranchés, demande lequel creuser.
- Utilise web_search proactivement quand l'actu, des chiffres ou des références renforceraient le post — et cite ce que tu utilises.
- Rédige le contenu DANS le chat (version complète, codes de la plateforme respectés : accroche LinkedIn avant le « voir plus », thread X numéroté, Reddit authentique sans ton publicitaire…).
- Itère sur ses retours. N'appelle save_post QU'APRÈS son accord explicite — jamais avant. Après l'enregistrement, confirme et propose la suite (programmer, décliner sur une autre plateforme…).

Date courante : ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`,
  ];
  if (company)   parts.push(`## Contexte entreprise (projet actif)\n${company}`);
  if (knowledge) parts.push(`## Base de connaissances (source de vérité)\n${knowledge}`);
  if (recentTitles.length > 0) {
    parts.push(`## Posts récents de l'utilisateur (évite de répéter ces angles)\n- ${recentTitles.join('\n- ')}`);
  }
  return parts.join('\n\n');
}

async function executeTool(userId: string, name: string, args: any): Promise<{ output: string; savedPost?: Post }> {
  if (name === 'web_search') {
    const results = await webSearch(String(args.query || ''));
    return { output: results.length > 0 ? results.map((r, i) => `[${i + 1}] ${r}`).join('\n') : 'Aucun résultat.' };
  }
  if (name === 'fetch_website') {
    const text = await fetchPageText(String(args.url || ''));
    return { output: text || 'Page inaccessible.' };
  }
  if (name === 'save_post') {
    const content = String(args.content || '').trim();
    if (!content) return { output: 'ERREUR : contenu vide, rien enregistré.' };

    const scheduled = args.scheduledAt ? new Date(String(args.scheduledAt)) : null;
    const now = new Date().toISOString();
    const post: Post = {
      id: uuid(),
      userId,
      planId: storage.getActivePlan(userId)?.id ?? null,
      platform: String(args.platform || 'linkedin'),
      title: String(args.title || 'Post').slice(0, 150),
      content,
      status: scheduled && !Number.isNaN(scheduled.getTime()) ? 'scheduled' : 'draft',
      scheduledAt: scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled.toISOString() : null,
      publishedAt: null,
      externalUrl: null,
      externalId: null,
      imageUrl: typeof args.imageUrl === 'string' && args.imageUrl.trim() ? args.imageUrl.trim() : null,
      subreddit: typeof args.subreddit === 'string' && args.subreddit.trim()
        ? args.subreddit.trim().replace(/^\/?r\//i, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 50) || null
        : null,
      recurrence: 'none',
      recurrenceBrief: null, seriesId: null, recurrenceUseNews: 0, recurrenceUseKnowledge: 1, recurrenceUpdateKb: 0, crossPostId: null,
      autoPublish: 0,
      publishError: null,
      calendarSynced: 0,
      impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0,
      createdAt: now,
      updatedAt: now,
    };
    storage.savePost(post);
    return {
      output: `Post enregistré (${post.status === 'scheduled' ? `programmé le ${post.scheduledAt}` : 'brouillon'}) — id ${post.id.slice(0, 8)}. Confirme à l'utilisateur.`,
      savedPost: post,
    };
  }
  return { output: `Outil inconnu : ${name}` };
}

export interface PostChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export type PostChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'action'; text: string }
  | { type: 'saved'; postId: string; title: string };

export interface PostChatResult {
  reply: string;
  actions: string[];
  savedPosts: { id: string; title: string }[];
}

export async function runPostChatTurn(
  userId: string,
  history: PostChatMessage[],
  onEvent?: (event: PostChatEvent) => void,
): Promise<PostChatResult> {
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(userId) },
    ...history.slice(-16).map((m): ChatMessage => ({ role: m.role, content: m.text })),
  ];

  const actions: string[] = [];
  const savedPosts: { id: string; title: string }[] = [];
  let fullText = '';

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    let emittedSeparator = fullText === '';

    const result = await chatComplete({
      messages,
      userId,
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
      if (call.name === 'web_search') {
        const action = `🔍 ${call.args.query}`;
        actions.push(action);
        onEvent?.({ type: 'action', text: action });
      } else if (call.name === 'fetch_website') {
        const action = `🌐 ${call.args.url}`;
        actions.push(action);
        onEvent?.({ type: 'action', text: action });
      }

      const { output, savedPost } = await executeTool(userId, call.name, call.args);
      if (savedPost) {
        savedPosts.push({ id: savedPost.id, title: savedPost.title });
        onEvent?.({ type: 'saved', postId: savedPost.id, title: savedPost.title });
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: output.slice(0, 10000) });
    }
  }

  if (!fullText) {
    fullText = 'Je n\'ai pas réussi à traiter ta demande — reformule ?';
    onEvent?.({ type: 'delta', text: fullText });
  }

  return { reply: fullText, actions, savedPosts };
}
