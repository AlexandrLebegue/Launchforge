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
import { composioUserIdFor } from './composioConnect';
import { publishDirect, syncMetricsDirect } from './composioDirect';
import { CommentItem } from '../types';

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
  // Les outils Composio sont nommés TOOLKIT_ACTION : on filtre sur le préfixe
  // toolkit uniquement. Filtrer sur le nom complet faisait matcher des outils
  // d'autres toolkits (ex. « event » → GITHUB_*_EVENT pour la synchro calendrier,
  // « email » → GITHUB_*_EMAIL_* pour le scan Gmail).
  const matched = tools.filter((t) => {
    const toolkit = t.name.split('_')[0].toLowerCase();
    return keywords.some((k) => toolkit.includes(k));
  });
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
  userId: string,
  keywords: string[],
  systemPrompt: string,
  userPrompt: string,
  priorityKeywords: string[] = [],
): Promise<McpTaskResult> {
  if (!isComposioConfigured()) throw new Error('COMPOSIO_NOT_CONFIGURED');
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');

  // Chaque utilisateur parle à SES comptes connectés (entité Composio dédiée)
  const session = new McpSession(composioUserIdFor(userId));
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

/** Plateformes qui refusent toute publication sans média */
const MEDIA_REQUIRED: Record<string, string> = {
  instagram: 'Instagram exige une image — attachez un visuel au post (champ Image du Hub, ou donnez une URL d\'image à l\'assistant)',
  tiktok:    'TikTok exige un média (vidéo, ou image pour un post photo) — attachez-le au post avant de publier',
  youtube:   'YouTube exige une vidéo — attachez l\'URL du média au post avant de publier',
};

export async function publishViaComposio(
  userId: string,
  platform: string,
  content: string,
  imageUrl?: string | null,
  title?: string,
  subreddit?: string | null,
): Promise<string> {
  // Garde-fou AVANT tout appel modèle : inutile de lancer une mission vouée
  // à l'échec (observé en usage réel sur Instagram sans image)
  if (!imageUrl && MEDIA_REQUIRED[platform]) {
    return `ECHEC: ${MEDIA_REQUIRED[platform]}`;
  }
  // Reddit EXIGE un subreddit cible. Sans lui, l'opérateur IA bloquait en
  // demandant « dans quel subreddit ? » → échec de l'auto-publication. On
  // exige le champ en amont avec un message actionnable.
  if (platform === 'reddit' && !(subreddit && subreddit.trim())) {
    return 'ECHEC: indiquez le subreddit cible (champ « Subreddit » de l\'éditeur) avant de publier sur Reddit.';
  }

  // Les plateformes récupèrent le média par son URL : elle doit être PUBLIQUE.
  // Un média servi par l'app (/uploads/…) n'est résolvable qu'avec APP_URL.
  let mediaUrl = imageUrl ?? null;
  if (mediaUrl && mediaUrl.startsWith('/')) {
    const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
    if (!appUrl) {
      return 'ECHEC: le média est hébergé localement (/uploads) — les plateformes ne peuvent pas le télécharger. Configurez APP_URL (URL publique du serveur) ou utilisez une URL de média publique.';
    }
    mediaUrl = `${appUrl}${mediaUrl}`;
  }

  // Publication DIRECTE (API Composio, déterministe, sans appel modèle) pour
  // les plateformes au schéma vérifié — l'opérateur IA reste le repli des autres.
  if (process.env.COMPOSIO_API_KEY) {
    const direct = await publishDirect(userId, platform, content, mediaUrl, title ?? '', undefined, undefined, undefined, subreddit);
    if (direct.handled) return direct.result!;
  }

  const mediaIsVideo = mediaUrl ? /\.(mp4|webm|mov)(\?|#|$)/i.test(mediaUrl) : false;
  const mediaRequired = Boolean(MEDIA_REQUIRED[platform]);
  const mediaInstruction = mediaUrl
    ? (mediaIsVideo
      ? `\nUne VIDÉO est jointe au post : passe son URL dans le paramètre vidéo/média approprié (video_url, media_url, video…) et privilégie l'outil de publication qui accepte la vidéo (vidéo, reel, upload). ${mediaRequired
        ? 'Cette plateforme EXIGE le média : si aucun outil n\'accepte la vidéo, réponds ECHEC (ne publie pas le texte seul).'
        : 'Si aucun outil de cette plateforme n\'accepte de vidéo, publie le texte et signale clairement que la vidéo n\'a pas pu être jointe.'}`
      : `\nUne image est jointe au post : passe son URL dans le paramètre média approprié de l'outil de publication (image_url, media_url, photo…). ${mediaRequired
        ? 'Cette plateforme EXIGE le média : si aucun outil n\'accepte d\'image, réponds ECHEC (ne publie pas le texte seul).'
        : 'Si l\'outil de publication choisi n\'accepte aucun média, publie le texte et signale-le dans ta réponse.'}`)
    : '';
  // Reddit : le subreddit cible est fourni par l'utilisateur (champ dédié) —
  // l'opérateur ne doit plus le demander ni en inventer un.
  const sub = subreddit?.trim();
  const redditInstruction = platform === 'reddit' && sub
    ? `\nReddit : publie un post TEXTE (self post) dans le subreddit « ${sub} » — paramètre subreddit = "${sub}" EXACTEMENT. Tu disposes de TOUT le nécessaire : NE POSE AUCUNE QUESTION, n'attends aucune confirmation, appelle directement l'outil de création de post. ${title?.trim()
      ? `Titre du post = « ${title.trim()} » ; le texte fourni est le corps (selftext/text).`
      : 'Première ligne du texte = titre du post Reddit ; le reste = corps (selftext/text).'} C'est un post texte, jamais un post lien — ignore toute mention type « lien en bio ».`
    : '';
  const result = await runMcpTask(
    userId,
    platformKeywords(platform),
    `Tu es un opérateur de publication. Tu disposes des outils Composio de l'utilisateur pour la plateforme ${platform}.
Mission : publier le contenu fourni, tel quel (ne le réécris pas), via l'outil de création de post/tweet/message approprié.${mediaInstruction}${redditInstruction}
Si la publication réussit, réponds en une phrase avec le résultat, préfixée par "OK:". Si la réponse de l'outil contient l'URL ou l'identifiant du post créé, inclus-le TEL QUEL dans ta phrase (il sera enregistré pour la synchro des métriques).
Si aucun outil ne permet de publier sur ${platform} ou si la publication échoue, réponds préfixé par "ECHEC:" avec la raison.
IMPÉRATIF : ta réponse finale commence par "OK:" ou "ECHEC:" — rien avant, pas de markdown.`,
    `Publie ce contenu sur ${platform} :\n\n${content}${sub ? `\n\n--- Subreddit cible ---\n${sub}` : ''}${mediaUrl ? `\n\n--- ${mediaIsVideo ? 'Vidéo' : 'Image'} à joindre (paramètre média de l'outil) ---\n${mediaUrl}` : ''}`,
    ['create', 'post', 'tweet', 'publish', 'send', 'message', 'submit', 'media', 'photo', 'video', 'reel', 'upload'],
  );
  return guardedReply(result);
}

/**
 * Extrait l'URL (ou l'identifiant) du post créé depuis la réponse de
 * publication — enregistrée dans externalUrl pour la synchro des métriques.
 *
 * L'URN LinkedIn est préservé ENTIER (urn:li:share:…) : l'amputer du préfixe
 * « urn: » cassait à la fois le lien cliquable ET la lecture des métriques
 * (dont le regex attend urn:li:…).
 */
export function extractPublishedRef(reply: string): string | null {
  if (!reply.trim().toUpperCase().startsWith('OK')) return null;
  const url = reply.match(/https?:\/\/[^\s)\]»"']+/);
  if (url) return url[0].replace(/[.,;:!?]+$/, '');
  // URN complet (LinkedIn : urn:li:share:…, urn:li:activity:…, urn:li:ugcPost:…)
  const urn = reply.match(/urn:[a-z]+:[a-zA-Z]+:[\w-]+/i);
  if (urn) return urn[0];
  // À défaut : identifiant long renvoyé par l'outil (id média Instagram, etc.)
  const id = reply.match(/\b(?:id|urn)\s*[:=]?\s*([\w:.-]{8,})/i);
  return id ? id[1] : null;
}

/**
 * Reconstruit une URL publique CLIQUABLE à partir de la référence renvoyée à
 * la publication, quand la plateforme le permet de façon déterministe — pour
 * que l'utilisateur puisse constater le résultat depuis le Hub.
 *
 * Garantit que l'URL produite contient toujours l'identifiant nécessaire à la
 * synchro des métriques (le regex de syncMetricsDirect continue de matcher).
 * Renvoie null si aucune URL fiable ne peut être construite (Instagram/TikTok :
 * l'API ne renvoie qu'un id non résolvable en permalien public).
 */
export function canonicalPostUrl(platform: string, ref: string | null): string | null {
  if (!ref) return null;
  const r = ref.trim();
  if (/^https?:\/\//i.test(r)) return r.replace(/[.,;:!?]+$/, '');

  switch (platform) {
    case 'linkedin': {
      // urn:li:share:123 | li:share:123 (préfixe historiquement perdu) | share:123
      const m = r.match(/(?:urn:)?(?:li:)?(share|ugcPost|activity):(\d+)/i);
      return m ? `https://www.linkedin.com/feed/update/urn:li:${m[1]}:${m[2]}/` : null;
    }
    case 'twitter': {
      const id = r.match(/(\d{8,})/)?.[1];
      return id ? `https://x.com/i/web/status/${id}` : null;
    }
    case 'youtube': {
      const id = /^[\w-]{11}$/.test(r) ? r : r.match(/(?:youtu\.be\/|v=|\/shorts\/)([\w-]{11})/)?.[1];
      return id ? `https://youtu.be/${id}` : null;
    }
    default:
      // facebook & reddit renvoient déjà une URL (gérée plus haut) ;
      // instagram & tiktok n'ont qu'un id non résolvable → pas de lien.
      return null;
  }
}

/**
 * Référence à enregistrer dans externalUrl après une publication réussie :
 * une URL cliquable quand on peut la reconstruire, sinon l'identifiant brut
 * (qui reste utile à la synchro des métriques). Point d'entrée unique partagé
 * par le worker auto, la route publish-now et le bot Telegram — pour que les
 * trois voies produisent exactement le même résultat.
 */
export function resolvePublishedUrl(platform: string, reply: string): string | null {
  const ref = extractPublishedRef(reply);
  if (!ref) return null;
  return canonicalPostUrl(platform, ref) ?? ref;
}

// ── Synchronisation des métriques ─────────────────────────────────────────────

/**
 * Spécificités API par plateforme — évite les abandons sur des 403 attendus
 * (observé en réel : stats LinkedIn refusées pour un post personnel alors que
 * les réactions restent lisibles par un autre endpoint).
 */
const METRICS_HINTS: Record<string, string> = {
  linkedin: `Spécifique LinkedIn :
- LINKEDIN_GET_SHARE_STATS ne fonctionne QUE pour les pages ORGANISATION — un 403 sur un post personnel est NORMAL et attendu : n'abandonne pas, continue avec les autres outils.
- Post personnel : appelle LINKEDIN_LIST_REACTIONS avec l'URN du post (urn:li:share:<id> ou urn:li:activity:<id>, extrais-le de l'URL si besoin) et COMPTE les réactions retournées → c'est la valeur "likes". LINKEDIN_GET_POST_CONTENT permet de vérifier le post.
- L'API LinkedIn n'expose PAS les impressions ni le détail des commentaires d'un post personnel : mets 0 pour ces champs et explique-le dans "note". found=true dès que les réactions ont pu être lues.`,
  twitter: `Spécifique X/Twitter : l'id du tweet est le nombre final de l'URL /status/<id>. Les métriques publiques (public_metrics) couvrent vues, likes, réponses, reposts.`,
  reddit: `Spécifique Reddit :
- L'identifiant du post est la partie après /comments/ dans l'URL (ex. https://www.reddit.com/r/test/comments/1u4zw0e/... → id = "1u4zw0e").
- Appelle REDDIT_RETRIEVE_POST_COMMENTS avec article=<id> : la réponse contient le post (post_listing) ET ses commentaires. Mappe : likes = score du post (post_listing → children[0] → data.score, c'est le nombre de votes nets) ; comments = num_comments du post (ou le nombre de commentaires retournés). À défaut, REDDIT_RETRIEVE_REDDIT_POST avec subreddit=<sous-reddit> et sort="new" liste les posts récents : retrouve celui dont l'id correspond et lis score + num_comments.
- L'API Reddit n'expose PAS le nombre de vues (pas de view_count) : mets impressions=0 et précise-le dans "note". shares et clicks = 0.
- found=true dès que le score OU le nombre de commentaires a pu être lu (même s'ils valent 0).`,
};

export interface SyncedMetrics {
  found: boolean;
  impressions?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  clicks?: number;
  note?: string;
  /** Contenu réel des commentaires — rempli uniquement si withComments=true */
  commentItems?: CommentItem[];
}

export interface SyncMetricsOptions {
  /** Récupère aussi le CONTENU des commentaires (déclenché par l'utilisateur,
   *  jamais par la synchro automatique des compteurs) */
  withComments?: boolean;
}

/** Normalise le tableau de commentaires renvoyé par l'opérateur IA */
function parseOperatorComments(value: unknown): CommentItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((c: any) => ({
      author: c && c.author != null && String(c.author).trim() ? String(c.author).trim().slice(0, 200) : null,
      text: c && c.text != null ? String(c.text).trim().slice(0, 4000) : '',
      externalId: c && c.id != null ? String(c.id) : null,
    }))
    .filter((c) => c.text.length > 0)
    .slice(0, 50);
}

export async function syncMetricsViaComposio(
  userId: string,
  platform: string,
  externalUrl: string,
  title: string,
  opts: SyncMetricsOptions = {},
): Promise<SyncedMetrics> {
  const withComments = Boolean(opts.withComments);
  // Lecture DIRECTE (API Composio, déterministe) quand la référence externe
  // est exploitable — l'opérateur IA reste le repli (référence illisible,
  // outil en erreur, plateforme sans stratégie).
  if (process.env.COMPOSIO_API_KEY) {
    const direct = await syncMetricsDirect(userId, platform, externalUrl, undefined, undefined, withComments);
    if (direct.handled && direct.metrics) return direct.metrics;
  }

  const commentInstruction = withComments
    ? `\nRécupère AUSSI le contenu réel des commentaires/réponses du post (auteur + texte) avec l'outil de lecture des commentaires/réponses, et renvoie-les dans "commentTexts" (50 max). Laisse "commentTexts" vide si aucun outil ne les expose.`
    : '';
  const commentField = withComments ? `, "commentTexts": [{"author": "string", "text": "string"}]` : '';

  const { reply, okCalls } = await runMcpTask(
    userId,
    platformKeywords(platform),
    `Tu es un analyste social media. Tu disposes des outils Composio de l'utilisateur pour ${platform}.
Mission : retrouver le post publié indiqué (via son URL/identifiant) et récupérer ses métriques de performance avec les outils de lecture/lookup disponibles.
IMPORTANT :
- N'accède JAMAIS à l'URL par une requête web directe (fetch/scraping) : les plateformes renvoient 403 aux accès non authentifiés. Utilise UNIQUEMENT les outils Composio (API authentifiée).
- Si un outil attend un identifiant plutôt qu'une URL, extrais-le de l'URL (X/Twitter : le nombre final de /status/<id> ; LinkedIn : l'identifiant d'activité urn:li:activity:<id> ; etc.).
- Si la recherche directe échoue, liste tes propres posts récents avec les outils disponibles et retrouve celui qui correspond au titre indiqué.${commentInstruction}
${METRICS_HINTS[platform] ? `${METRICS_HINTS[platform]}\n` : ''}Mapping attendu : impressions = vues/impressions ; likes = likes/réactions/favoris ; comments = commentaires/réponses ; shares = partages/retweets/reposts ; clicks = clics sur lien si disponible.
Réponds UNIQUEMENT avec un objet JSON, sans texte autour :
{"found": boolean, "impressions": number, "likes": number, "comments": number, "shares": number, "clicks": number, "note": "explication courte"${commentField}}
Mets 0 pour une métrique indisponible. found=false si le post est introuvable ou si aucun outil ne permet la lecture.`,
    `Récupère les métriques de ce post ${platform} :\nURL : ${externalUrl}\nTitre (indice) : ${title || '—'}`,
    ['lookup', 'get', 'search', 'fetch', 'retrieve', 'analytics', 'metrics', 'reactions', 'stats',
      ...(withComments ? ['comment', 'comments', 'replies', 'thread'] : [])],
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
      // Pas de commentaires retenus si aucun outil n'a réellement tourné (anti-hallucination)
      ...(withComments && okCalls > 0 ? { commentItems: parseOperatorComments(parsed.commentTexts) } : {}),
    };
  } catch {
    return { found: false, note: `Réponse illisible du modèle : ${reply.slice(0, 200)}` };
  }
}
