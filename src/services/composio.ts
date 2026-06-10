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

const MAX_TOOL_ITERATIONS = 6;
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

function filterTools(tools: McpTool[], keywords: string[]): McpTool[] {
  const matched = tools.filter((t) =>
    keywords.some((k) => t.name.toLowerCase().includes(k))
  );
  return (matched.length > 0 ? matched : tools).slice(0, MAX_TOOLS_EXPOSED);
}

function toToolDefs(tools: McpTool[]): ToolDef[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description.slice(0, 1024),
    parameters: t.inputSchema,
  }));
}

/**
 * Boucle agentique générique : le modèle reçoit les outils MCP filtrés par
 * mots-clés et une mission ; il appelle les outils via la session jusqu'à
 * conclure. Réutilisée pour la publication, les métriques et la boîte mail.
 */
export async function runMcpTask(
  keywords: string[],
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  if (!isComposioConfigured()) throw new Error('COMPOSIO_NOT_CONFIGURED');
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const session = new McpSession();
  await session.initialize();
  const allTools = await session.listTools();
  if (allTools.length === 0) {
    throw new Error('Aucun outil disponible sur le serveur MCP Composio — connectez vos comptes sur dashboard.composio.dev');
  }
  const tools = toToolDefs(filterTools(allTools, keywords));

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let lastContent = '';
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const result = await chatComplete({ messages, tools, maxTokens: 2048 });
    if (result.content) lastContent = result.content;

    if (result.toolCalls.length === 0) break;

    messages.push(result.rawAssistantMessage);
    for (const call of result.toolCalls) {
      let output: string;
      try {
        output = await session.callTool(call.name, call.args);
      } catch (err) {
        output = `ERREUR: ${err instanceof Error ? err.message : 'tool call failed'}`;
      }
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: output.slice(0, 12000),
      });
    }
  }

  return lastContent;
}

// ── Publication ───────────────────────────────────────────────────────────────

export async function publishViaComposio(platform: string, content: string): Promise<string> {
  const reply = await runMcpTask(
    platformKeywords(platform),
    `Tu es un opérateur de publication. Tu disposes des outils Composio de l'utilisateur pour la plateforme ${platform}.
Mission : publier le contenu fourni, tel quel (ne le réécris pas), via l'outil de création de post/tweet/message approprié.
Si la publication réussit, réponds en une phrase avec le résultat (et l'URL/id du post si disponible), préfixée par "OK:".
Si aucun outil ne permet de publier sur ${platform} ou si la publication échoue, réponds préfixé par "ECHEC:" avec la raison.`,
    `Publie ce contenu sur ${platform} :\n\n${content}`,
  );
  return reply || 'ECHEC: aucune réponse du modèle';
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
  const reply = await runMcpTask(
    platformKeywords(platform),
    `Tu es un analyste social media. Tu disposes des outils Composio de l'utilisateur pour ${platform}.
Mission : retrouver le post publié indiqué (via son URL/identifiant) et récupérer ses métriques de performance avec les outils de lecture/lookup disponibles.
Mapping attendu : impressions = vues/impressions ; likes = likes/réactions/favoris ; comments = commentaires/réponses ; shares = partages/retweets/reposts ; clicks = clics sur lien si disponible.
Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"found": boolean, "impressions": number, "likes": number, "comments": number, "shares": number, "clicks": number, "note": "explication courte"}
Mets 0 pour une métrique indisponible. found=false si le post est introuvable ou si aucun outil ne permet la lecture.`,
    `Récupère les métriques de ce post ${platform} :\nURL : ${externalUrl}\nTitre (indice) : ${title || '—'}`,
  );

  try {
    const parsed = JSON.parse(sanitizeJson(reply));
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
    };
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
