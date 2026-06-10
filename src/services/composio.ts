/**
 * Intégration Composio (MCP) — publication réelle + synchronisation des
 * métriques des posts.
 *
 * Principe : LaunchForge se connecte au serveur MCP Composio de l'utilisateur
 * (COMPOSIO_MCP_URL), liste les outils disponibles (selon les comptes
 * connectés sur dashboard.composio.dev), et laisse le modèle OpenRouter
 * choisir et appeler les bons outils. Aucun nom d'action codé en dur :
 * ce qui est connecté chez Composio fonctionne.
 */

import { chatComplete, ChatMessage, ToolDef, sanitizeJson, isAIConfigured } from './aiClient';
import { McpSession, McpTool, isComposioConfigured } from './mcpClient';

export { isComposioConfigured };

const MAX_TOOL_ITERATIONS = 8;
const MAX_TOOLS_EXPOSED = 30;

/** Mots-clés par plateforme pour ne montrer au modèle que les outils utiles */
const PLATFORM_KEYWORDS: Record<string, string[]> = {
  twitter:      ['twitter', 'tweet'],
  linkedin:     ['linkedin'],
  instagram:    ['instagram'],
  facebook:     ['facebook'],
  reddit:       ['reddit'],
  youtube:      ['youtube'],
  tiktok:       ['tiktok'],
  discord:      ['discord'],
  slack:        ['slack'],
  github:       ['github'],
  producthunt:  ['producthunt', 'product_hunt'],
  hackernews:   ['hackernews', 'hacker_news'],
  indiehackers: ['indiehackers', 'indie_hackers'],
};

export function platformKeywords(platform: string): string[] {
  return PLATFORM_KEYWORDS[platform] || [platform];
}

function filterTools(tools: McpTool[], keywords: string[], priorityKeywords: string[] = []): McpTool[] {
  const matched = tools.filter((t) =>
    keywords.some((k) => t.name.toLowerCase().includes(k))
  );
  // SÉCURITÉ : pas de repli vers la totalité des outils — exposer des outils
  // sans rapport (ex. envoi Gmail pour une mission « publier sur LinkedIn »)
  // est dangereux. Mieux vaut un échec explicite qui guide l'utilisateur.
  if (matched.length === 0) {
    throw new Error(`Aucun compte ${keywords[0]} connecté sur Composio — connectez-le depuis la vue Configuration`);
  }
  const pool = matched;
  // Le plafond MAX_TOOLS_EXPOSED coupait la liste alphabétiquement : sur un
  // toolkit Gmail de 64 outils, GMAIL_SEND_EMAIL passait à la trappe. On place
  // d'abord les outils correspondant à l'intention de la tâche.
  if (priorityKeywords.length > 0) {
    const score = (t: McpTool) =>
      priorityKeywords.some((k) => t.name.toLowerCase().includes(k)) ? 0 : 1;
    pool.sort((a, b) => score(a) - score(b));
  }
  return pool.slice(0, MAX_TOOLS_EXPOSED);
}

function toToolDefs(tools: McpTool[]): ToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description.slice(0, 1024),
    parameters: t.inputSchema,
  }));
}

export interface McpTaskResult {
  reply: string;
  /** Appels d'outils MCP ayant réellement abouti */
  okCalls: number;
  /** Appels d'outils MCP ayant échoué */
  failedCalls: number;
}

/**
 * Boucle agentique générique : le modèle reçoit les outils MCP filtrés par
 * mots-clés et une mission ; il appelle les outils via la session jusqu'à
 * conclure. Réutilisée pour la publication, les métriques et la boîte mail.
 *
 * Le compteur okCalls permet aux appelants de détecter les FAUX SUCCÈS :
 * un modèle peut déclarer « OK » sans avoir exécuté la moindre action
 * (observé en test réel) — un succès sans appel d'outil réussi est rejeté.
 */
export async function runMcpTask(
  keywords: string[],
  systemPrompt: string,
  userPrompt: string,
  priorityKeywords: string[] = [],
): Promise<McpTaskResult> {
  if (!isComposioConfigured()) throw new Error('COMPOSIO_NOT_CONFIGURED');
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const session = new McpSession();
  await session.initialize();
  const allTools = await session.listTools();
  if (allTools.length === 0) {
    throw new Error('Aucun outil disponible sur le serveur MCP Composio — connectez vos comptes sur dashboard.composio.dev');
  }
  const tools = toToolDefs(filterTools(allTools, keywords, priorityKeywords));

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let lastContent = '';
  let okCalls = 0;
  let failedCalls = 0;
  let exhausted = true;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const result = await chatComplete({ messages, tools, maxTokens: 2048 });
    // Certains modèles décorent leur réponse de markdown (« **ECHEC :** … ») :
    // on neutralise les décorations de tête pour que les préfixes OK:/ECHEC:
    // restent détectables par tous les appelants.
    if (result.content) lastContent = result.content.replace(/^[\s*_#>`]+/, '');

    if (result.toolCalls.length === 0) { exhausted = false; break; }

    messages.push(result.rawAssistantMessage);
    for (const call of result.toolCalls) {
      let output: string;
      try {
        output = await session.callTool(call.name, call.args);
        okCalls += 1;
      } catch (err) {
        output = `ERREUR: ${err instanceof Error ? err.message : 'tool call failed'}`;
        failedCalls += 1;
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: output.slice(0, 12000),
      });
    }
  }

  // Limite d'itérations atteinte en pleine exploration (observé en test réel :
  // la dernière réponse était un message d'étape, pas la conclusion). On force
  // une réponse finale, sans outils, à partir de ce qui a déjà été collecté.
  if (exhausted) {
    messages.push({
      role: 'user',
      content: 'Tu as atteint la limite d\'appels d\'outils. Donne MAINTENANT ta réponse finale au format exact demandé dans ta mission (JSON ou OK:/ECHEC:), en te basant uniquement sur les données déjà obtenues. N\'appelle plus aucun outil.',
    });
    const final = await chatComplete({ messages, maxTokens: 2048 });
    if (final.content) lastContent = final.content.replace(/^[\s*_#>`]+/, '');
  }

  return { reply: lastContent, okCalls, failedCalls };
}

const HALLUCINATION_GUARD = 'ECHEC: succès déclaré par le modèle sans aucune action réellement exécutée — opération rejetée par sécurité';

/** Rejette les « OK » fantômes : un succès exige au moins un outil exécuté */
export function guardedReply(result: McpTaskResult): string {
  const reply = result.reply || 'ECHEC: aucune réponse du modèle';
  if (reply.trim().toUpperCase().startsWith('OK') && result.okCalls === 0) {
    return HALLUCINATION_GUARD;
  }
  return reply;
}

// ── Publication ───────────────────────────────────────────────────────────────

export async function publishViaComposio(platform: string, content: string): Promise<string> {
  const result = await runMcpTask(
    platformKeywords(platform),
    `Tu es un opérateur de publication. Tu disposes des outils Composio de l'utilisateur pour la plateforme ${platform}.
Mission : publier le contenu fourni, tel quel (ne le réécris pas), via l'outil de création de post/tweet/message approprié.
Si la publication réussit, réponds en une phrase avec le résultat (et l'URL/id du post si disponible), préfixée par "OK:".
Si aucun outil ne permet de publier sur ${platform} ou si la publication échoue, réponds préfixé par "ECHEC:" avec la raison.
IMPÉRATIF : ta réponse finale commence par "OK:" ou "ECHEC:" — rien avant, pas de markdown.`,
    `Publie ce contenu sur ${platform} :\n\n${content}`,
    ['create', 'post', 'tweet', 'publish', 'send', 'message', 'submit'],
  );
  return guardedReply(result);
}

// ── Synchronisation des métriques ─────────────────────────────────────────────

export interface SyncedMetrics {
  found: boolean;
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  note?: string;
}

export async function syncMetricsViaComposio(
  platform: string,
  externalUrl: string,
  title: string,
): Promise<SyncedMetrics> {
  const { reply, okCalls } = await runMcpTask(
    platformKeywords(platform),
    `Tu es un analyste social media. Tu disposes des outils Composio de l'utilisateur pour ${platform}.
Mission : retrouver le post publié indiqué (via son URL/identifiant) et récupérer ses métriques de performance avec les outils de lecture/lookup disponibles.
Mapping attendu : impressions = vues/impressions ; likes = likes/réactions/favoris ; comments = commentaires/réponses ; shares = partages/retweets/reposts ; clicks = clics sur lien si disponible.
Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"found": boolean, "impressions": number, "likes": number, "comments": number, "shares": number, "clicks": number, "note": "explication courte"}
Mets 0 pour une métrique indisponible. found=false si le post est introuvable ou si aucun outil ne permet la lecture.`,
    `Récupère les métriques de ce post ${platform} :\nURL : ${externalUrl}\nTitre (indice) : ${title || '—'}`,
    ['lookup', 'get', 'search', 'fetch', 'retrieve', 'analytics', 'metrics'],
  );

  try {
    const parsed = JSON.parse(sanitizeJson(reply));
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
    };
    // Anti-hallucination : des métriques "trouvées" sans le moindre appel
    // d'outil réussi sont forcément inventées.
    if (Boolean(parsed.found) && okCalls === 0) {
      return { found: false, note: 'Le modèle a déclaré des métriques sans avoir interrogé la plateforme — rejeté par sécurité' };
    }
    return {
      found: Boolean(parsed.found),
      impressions: num(parsed.impressions),
      likes: num(parsed.likes),
      comments: num(parsed.comments),
      shares: num(parsed.shares),
      clicks: num(parsed.clicks),
      note: typeof parsed.note === 'string' ? parsed.note.slice(0, 300) : undefined,
    };
  } catch {
    return { found: false, note: `Réponse illisible du modèle : ${reply.slice(0, 200)}` };
  }
}
