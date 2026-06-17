/**
 * Publication DIRECTE via l'API Composio (`tools/execute`) — déterministe,
 * sans appel modèle. Les arguments sont mappés sur les schémas RÉELS des
 * outils (vérifiés sur l'API) :
 *
 *  - X/Twitter   : TWITTER_CREATION_OF_A_POST (texte ; le toolkit n'expose
 *                  pas d'upload de média → média signalé comme non joint)
 *  - LinkedIn    : LINKEDIN_GET_MY_INFO (URN auteur, mis en cache) puis
 *                  LINKEDIN_CREATE_LINKED_IN_POST en version d'outil 'latest'
 *                  — la version épinglée par défaut sur le projet date de
 *                  2024 et son en-tête LinkedIn-Version est désactivé
 *                  (NONEXISTENT_VERSION). Les images du post sont jointes :
 *                  téléversées sur l'infra de fichiers Composio (s3key) puis
 *                  passées dans le paramètre images de l'outil. Si l'erreur
 *                  de version revient malgré tout : secours via le serveur
 *                  MCP Composio qui expose l'outil legacy
 *                  LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE (v2/ugcPosts non
 *                  versionnée) — toujours en déterministe (tools/call
 *                  direct, aucun modèle) ; clé proxy en dernier recours.
 *  - Instagram   : INSTAGRAM_GET_USER_INFO (compte, mis en cache) puis
 *                  CREATE_MEDIA_CONTAINER (image_url/video_url public) —
 *                  attente du traitement pour la vidéo — puis CREATE_POST
 *  - YouTube     : YOUTUBE_UPLOAD_VIDEO (le binaire est récupéré par
 *                  Composio depuis l'URL publique passée en videoFilePath)
 *  - Reddit      : REDDIT_CREATE_REDDIT_POST — le subreddit cible se déclare
 *                  en mentionnant r/<nom> dans le titre ou le contenu. Texte
 *                  → post 'self' ; média → post 'link' vers l'URL du média
 *                  (Reddit l'affiche comme post image), le texte partant en
 *                  premier commentaire. L'API YouTube Data v3 n'expose pas
 *                  les « community posts » (limite Google) : seul l'upload
 *                  de vidéo existe.
 *  - Facebook    : FACEBOOK_GET_USER_PAGES (première Page gérée, en cache —
 *                  l'API Graph ne publie pas sur un profil personnel) puis
 *                  CREATE_POST (texte) / CREATE_PHOTO_POST (url) /
 *                  CREATE_VIDEO_POST (file_url)
 *  - TikTok      : TIKTOK_PUBLISH_VIDEO (URL publique) + suivi
 *                  FETCH_PUBLISH_STATUS, ou TIKTOK_POST_PHOTO (DIRECT_POST)
 *                  pour une image
 *
 * Métriques (syncMetricsDirect) — lecture déterministe likes/commentaires/
 * vues par plateforme : TWITTER_POST_LOOKUP_BY_POST_ID (public_metrics),
 * YOUTUBE_VIDEO_DETAILS (statistics), REDDIT_RETRIEVE_SPECIFIC_COMMENT
 * (score, num_comments via t3_<id>), INSTAGRAM_GET_POST_INSIGHTS
 * (reach/likes/comments/shares), FACEBOOK_GET_POST (résumés likes/
 * commentaires/partages), LINKEDIN_LIST_REACTIONS (serveur MCP — l'API
 * LinkedIn n'expose pas plus pour un post personnel). TikTok reste sur
 * l'opérateur IA (pas de lecture par identifiant de publication).
 *
 * Blog, newsletter, Product Hunt, Hacker News : pas d'API de publication
 * exposée par Composio (HN et PH n'en ont pas d'officielle) → opérateur IA.
 */

import { createHash } from 'crypto';
import { composioUserIdFor } from './composioConnect';
import { McpSession, isComposioConfigured } from './mcpClient';
import { CommentItem } from '../types';

const COMPOSIO_API = 'https://backend.composio.dev/api/v3';

export type ToolExecutor = (
  composioUserId: string,
  slug: string,
  args: Record<string, unknown>,
  /** Version de l'outil Composio ('latest', '20260424_00'…) — défaut : version épinglée du projet */
  version?: string,
) => Promise<any>;

/** Exécute un outil Composio pour une identité donnée (API REST, pas de modèle) */
export const executeComposioTool: ToolExecutor = async (composioUserId, slug, args, version) => {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error('COMPOSIO_NOT_CONFIGURED');
  const res = await fetch(`${COMPOSIO_API}/tools/execute/${slug}`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: composioUserId, arguments: args, ...(version ? { version } : {}) }),
    signal: AbortSignal.timeout(180_000), // l'upload YouTube peut être long
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message || body?.message || `Composio API ${res.status}`);
  if (body?.successful === false) {
    throw new Error(String(body?.error || 'Échec de l\'outil').slice(0, 400));
  }
  return body?.data;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fichier téléversé sur l'infra Composio, prêt à être passé à un outil */
export interface ComposioFile {
  name: string;
  mimetype: string;
  s3key: string;
}

export type FileUploader = (
  toolkitSlug: string,
  toolSlug: string,
  fileUrl: string,
) => Promise<ComposioFile>;

const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
};

/**
 * Téléverse un fichier (URL publique) sur l'infra de fichiers Composio :
 * files/upload/request fournit le s3key et une URL présignée, on y PUT les
 * octets. Le s3key est ensuite passé dans les paramètres FileUploadable des
 * outils (ex. images de LINKEDIN_CREATE_LINKED_IN_POST).
 */
export const uploadFileToComposio: FileUploader = async (toolkitSlug, toolSlug, fileUrl) => {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error('COMPOSIO_NOT_CONFIGURED');

  const file = await fetch(fileUrl, { signal: AbortSignal.timeout(120_000) });
  if (!file.ok) throw new Error(`média inaccessible (HTTP ${file.status})`);
  const bytes = Buffer.from(await file.arrayBuffer());
  const name = decodeURIComponent(new URL(fileUrl).pathname.split('/').pop() || 'media');
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const headerType = file.headers.get('content-type')?.split(';')[0]?.trim();
  const mimetype = (headerType?.startsWith('image/') ? headerType : EXT_MIME[ext]) ?? 'application/octet-stream';

  const req = await fetch(`${COMPOSIO_API}/files/upload/request`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toolkit_slug: toolkitSlug,
      tool_slug: toolSlug,
      filename: name,
      mimetype,
      md5: createHash('md5').update(bytes).digest('hex'),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const out: any = await req.json().catch(() => null);
  const presigned = out?.new_presigned_url ?? out?.newPresignedUrl;
  if (!req.ok || !out?.key || !presigned) {
    throw new Error(out?.error?.message || `téléversement Composio refusé (HTTP ${req.status})`);
  }
  const put = await fetch(presigned, {
    method: 'PUT',
    headers: { 'Content-Type': mimetype },
    body: bytes,
    signal: AbortSignal.timeout(120_000),
  });
  if (!put.ok) throw new Error(`dépôt du média refusé (HTTP ${put.status})`);
  return { name, mimetype, s3key: out.key };
};

/** Appel déterministe d'un outil du serveur MCP (tools/call, sans modèle) */
export type McpToolCaller = (
  composioUserId: string,
  tool: string,
  args: Record<string, unknown>,
) => Promise<string>;

export const callMcpToolDirect: McpToolCaller = async (composioUserId, tool, args) => {
  const session = new McpSession(composioUserId);
  await session.initialize();
  return session.callTool(tool, args);
};

/**
 * Voie de secours LinkedIn : l'outil legacy du serveur MCP (v2/ugcPosts, non
 * versionné). Son schéma EXIGE un lien partagé (media[].originalUrl) : c'est
 * un partage d'URL avec commentaire — d'où le paramètre shareUrl.
 */
async function publishLinkedInViaMcpLegacy(
  composioUid: string,
  author: string,
  commentary: string,
  shareUrl: string,
  shareTitle: string,
  mcp: McpToolCaller,
): Promise<string> {
  const out = await mcp(composioUid, 'LINKEDIN_CREATE_ARTICLE_OR_URL_SHARE', {
    author,
    lifecycleState: 'PUBLISHED',
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: commentary },
        shareMediaCategory: 'ARTICLE',
        media: [{ originalUrl: shareUrl, title: { text: shareTitle }, status: 'READY' }],
      },
    },
  });
  const urn = out.match(/urn:li:(?:share|ugcPost):[\w-]+/)?.[0] ?? '';
  return `OK: post LinkedIn publié${urn ? ` https://www.linkedin.com/feed/update/${urn}` : ''} (partage de lien ${shareUrl} — contournement du bug de version du toolkit Composio)`;
}

/**
 * Proxy Composio v3.1 : appel HTTP arbitraire authentifié avec le compte
 * connecté — NOUS contrôlons les en-têtes. Nécessite une clé API « proxy
 * execute » dédiée (réglages du projet Composio) dans COMPOSIO_PROXY_API_KEY.
 * Sert à contourner le bug du toolkit LinkedIn (version d'API périmée).
 */
async function proxyExecute(
  connectedAccountId: string,
  endpoint: string,
  method: 'GET' | 'POST',
  headers: Record<string, string>,
  body?: unknown,
): Promise<{ status: number; data: any; headers: Record<string, string> }> {
  const key = process.env.COMPOSIO_PROXY_API_KEY;
  if (!key) throw new Error('PROXY_NOT_CONFIGURED');
  const res = await fetch(`${COMPOSIO_API.replace('/v3', '/v3.1')}/tools/execute/proxy`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connected_account_id: connectedAccountId,
      endpoint,
      method,
      ...(body !== undefined ? { body } : {}),
      parameters: Object.entries(headers).map(([name, value]) => ({ name, value, in: 'header' })),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const out: any = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error?.message || `Composio proxy ${res.status}`);
  return {
    status: out?.data?.status ?? out?.status ?? 0,
    data: out?.data?.data ?? out?.data ?? out,
    headers: out?.data?.headers ?? out?.headers ?? {},
  };
}

/** Compte connecté LinkedIn (ACTIF) d'une identité — mis en cache */
const linkedinAccountCache = new Map<string, string>();
async function linkedinAccountId(composioUid: string): Promise<string | null> {
  const cached = linkedinAccountCache.get(composioUid);
  if (cached) return cached;
  const key = process.env.COMPOSIO_PROXY_API_KEY ?? process.env.COMPOSIO_API_KEY;
  if (!key) return null;
  const res = await fetch(`${COMPOSIO_API}/connected_accounts?limit=100&user_ids=${encodeURIComponent(composioUid)}`, {
    headers: { 'x-api-key': process.env.COMPOSIO_API_KEY! },
  });
  const data: any = await res.json().catch(() => null);
  const account = (data?.items || []).find((a: any) =>
    a?.toolkit?.slug === 'linkedin' && a?.status === 'ACTIVE' && a?.user_id === composioUid);
  if (account?.id) linkedinAccountCache.set(composioUid, account.id);
  return account?.id ?? null;
}

// Versions d'API LinkedIn candidates (actives ~12 mois) — la bonne est mémorisée
const LINKEDIN_VERSIONS = [process.env.LINKEDIN_VERSION, '202506', '202504', '202601'].filter(Boolean) as string[];
let workingLinkedinVersion: string | null = null;

/**
 * Publication LinkedIn via le proxy (contournement du toolkit Composio dont
 * la version d'API est périmée). Essaie les versions candidates et mémorise
 * celle qui répond.
 */
async function publishLinkedInViaProxy(accountId: string, author: string, commentary: string): Promise<string> {
  const body = {
    author,
    commentary,
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  const versions = workingLinkedinVersion ? [workingLinkedinVersion] : LINKEDIN_VERSIONS;
  let lastErr = '';
  for (const version of versions) {
    const res = await proxyExecute(accountId, 'https://api.linkedin.com/rest/posts', 'POST', {
      'LinkedIn-Version': version,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    }, body);
    if (res.status >= 200 && res.status < 300) {
      workingLinkedinVersion = version;
      const urn = res.headers['x-restli-id'] ?? res.headers['x-linkedin-id'] ?? '';
      return `OK: post LinkedIn publié${urn ? ` ${urn}` : ''} (via proxy, version ${version})`;
    }
    lastErr = JSON.stringify(res.data).slice(0, 250);
    if (!/NONEXISTENT_VERSION|version/i.test(lastErr)) break; // autre erreur : inutile d'itérer
  }
  return `ECHEC: LinkedIn a refusé la publication via le proxy — ${lastErr}`;
}

// Identités résolues une fois par utilisateur (URN LinkedIn, compte Instagram, Page Facebook)
const linkedinAuthorCache = new Map<string, string>();
const instagramIdCache = new Map<string, string>();
const facebookPageCache = new Map<string, { id: string; name: string }>();

const firstLine = (text: string, max = 95) =>
  (text.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, max);

const hashtags = (text: string) =>
  [...text.matchAll(/#([\p{L}0-9_]{2,30})/gu)].map((m) => m[1]).slice(0, 10);

/**
 * Envoi d'email DIRECT via GMAIL_SEND_EMAIL (schéma vérifié : recipient_email,
 * subject, body, user_id='me'). Toute erreur rend la main à l'opérateur IA
 * (handled=false) : contrairement à la publication, le repli a du sens ici —
 * la boîte de l'utilisateur peut être Outlook ou autre, que l'opérateur MCP
 * sait trouver.
 */
export async function sendEmailDirect(
  userId: string,
  to: string,
  subject: string,
  body: string,
  exec: ToolExecutor = executeComposioTool,
): Promise<DirectPublishResult> {
  const uid = composioUserIdFor(userId);
  if (!uid) return { handled: false };
  try {
    await exec(uid, 'GMAIL_SEND_EMAIL', {
      recipient_email: to,
      subject,
      body,
      user_id: 'me',
    });
    return { handled: true, result: `OK: email envoyé à ${to}` };
  } catch {
    return { handled: false }; // boîte non-Gmail, compte non connecté… → opérateur IA
  }
}

export interface DirectPublishResult {
  /** false = pas de stratégie directe pour cette plateforme → opérateur IA */
  handled: boolean;
  result?: string; // contrat « OK: … » / « ECHEC: … »
}

/** Nom lisible des plateformes publiées en direct (pour les messages d'erreur) */
const PLATFORM_LABELS: Record<string, string> = {
  twitter: 'X / Twitter',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  youtube: 'YouTube',
};

/**
 * Tente la publication déterministe. Toute erreur d'outil devient un
 * « ECHEC: raison » propre (pas de repli IA : mêmes comptes, même mur).
 */
export async function publishDirect(
  userId: string,
  platform: string,
  content: string,
  mediaUrl: string | null,
  title = '',
  exec: ToolExecutor = executeComposioTool,
  mcp: McpToolCaller = callMcpToolDirect,
  upload: FileUploader = uploadFileToComposio,
): Promise<DirectPublishResult> {
  const uid = composioUserIdFor(userId);
  if (!uid) return { handled: false };
  const mediaIsVideo = mediaUrl ? /\.(mp4|webm|mov)(\?|#|$)/i.test(mediaUrl) : false;

  try {
    switch (platform) {
      case 'twitter': {
        const data = await exec(uid, 'TWITTER_CREATION_OF_A_POST', { text: content });
        const id = data?.data?.id ?? data?.id;
        const note = mediaUrl ? ' (média non joint : le toolkit X de Composio n\'expose pas d\'upload de média)' : '';
        return { handled: true, result: `OK: tweet publié${id ? ` https://x.com/i/web/status/${id}` : ''}${note}` };
      }

      case 'linkedin': {
        let author = linkedinAuthorCache.get(uid);
        if (!author) {
          const me = await exec(uid, 'LINKEDIN_GET_MY_INFO', {});
          // Champ réel constaté : response_dict.author_id (urn:li:person:…)
          author = me?.response_dict?.author_id
            ?? me?.author_id
            ?? me?.author_urn
            ?? me?.response_dict?.author_urn
            ?? (me?.sub ? `urn:li:person:${me.sub}` : me?.response_dict?.sub ? `urn:li:person:${me.response_dict.sub}` : undefined);
          if (!author) return { handled: true, result: 'ECHEC: impossible de déterminer votre URN LinkedIn (LINKEDIN_GET_MY_INFO) — reconnectez le compte LinkedIn dans Configuration.' };
          linkedinAuthorCache.set(uid, author);
        }
        // Image du post : téléversée sur l'infra Composio puis jointe (s3key)
        let images: ComposioFile[] | undefined;
        let note = '';
        if (mediaUrl) {
          if (mediaIsVideo) {
            note = ' (vidéo non jointe : le toolkit LinkedIn n\'accepte que des images)';
          } else {
            try {
              images = [await upload('linkedin', 'LINKEDIN_CREATE_LINKED_IN_POST', mediaUrl)];
            } catch (err) {
              const m = err instanceof Error ? err.message : 'erreur inconnue';
              note = ` (image non jointe : ${m === 'COMPOSIO_NOT_CONFIGURED' ? 'COMPOSIO_API_KEY absente' : m})`;
            }
          }
        }

        try {
          // version 'latest' : la version de l'outil épinglée par défaut sur le
          // projet date de 2024 et déclenche NONEXISTENT_VERSION côté LinkedIn
          const data = await exec(uid, 'LINKEDIN_CREATE_LINKED_IN_POST', {
            author,
            commentary: content,
            visibility: 'PUBLIC',
            lifecycleState: 'PUBLISHED',
            ...(images ? { images } : {}),
          }, 'latest');
          const urn = data?.share_id ?? data?.id ?? data?.urn ?? '';
          return { handled: true, result: `OK: post LinkedIn publié${urn ? ` ${urn}` : ''}${images ? ' (image jointe)' : note}` };
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          if (/NONEXISTENT_VERSION/i.test(msg)) {
            // Clé proxy posée : publication texte directe sur l'API LinkedIn
            if (process.env.COMPOSIO_PROXY_API_KEY) {
              const accountId = await linkedinAccountId(uid);
              if (accountId) {
                const result = await publishLinkedInViaProxy(accountId, author, content);
                if (result.startsWith('OK')) {
                  return { handled: true, result: result + (mediaUrl ? ' (média non joint : publication texte via le proxy)' : '') };
                }
              }
            }
            // Voie de secours : l'outil legacy du serveur MCP (ugcPosts, non
            // versionné) — un partage d'URL, donc seulement si on a un lien.
            const shareUrl = mediaUrl ?? process.env.APP_URL ?? null;
            if (shareUrl && isComposioConfigured()) {
              try {
                const result = await publishLinkedInViaMcpLegacy(
                  uid, author, content,
                  shareUrl, (title || firstLine(content) || 'LaunchForge').slice(0, 95), mcp,
                );
                return { handled: true, result };
              } catch { /* secours indisponible : message actionnable ci-dessous */ }
            }
            return {
              handled: true,
              result: 'ECHEC: bug connu du toolkit LinkedIn de Composio (version d\'API périmée, erreur NONEXISTENT_VERSION — rien à voir avec votre compte). Contournement : créez une clé API « proxy execute » dans les réglages de votre projet Composio et posez-la dans COMPOSIO_PROXY_API_KEY — LaunchForge publiera alors en direct sur l\'API LinkedIn avec une version à jour.',
            };
          }
          throw err;
        }
      }

      case 'instagram': {
        if (!mediaUrl) return { handled: true, result: 'ECHEC: Instagram exige un média.' };
        let igUserId = instagramIdCache.get(uid);
        if (!igUserId) {
          const me = await exec(uid, 'INSTAGRAM_GET_USER_INFO', {});
          igUserId = String(me?.id ?? me?.user_id ?? me?.data?.id ?? '');
          if (!igUserId) return { handled: true, result: 'ECHEC: impossible de déterminer votre compte Instagram Business (INSTAGRAM_GET_USER_INFO) — le compte doit être un compte professionnel connecté dans Configuration.' };
          instagramIdCache.set(uid, igUserId);
        }
        const container = await exec(uid, 'INSTAGRAM_CREATE_MEDIA_CONTAINER', {
          ig_user_id: igUserId,
          caption: content,
          ...(mediaIsVideo
            ? { video_url: mediaUrl, content_type: 'reel', media_type: 'REELS' }
            : { image_url: mediaUrl, content_type: 'photo' }),
        });
        const creationId = String(container?.id ?? container?.creation_id ?? container?.data?.id ?? '');
        if (!creationId) return { handled: true, result: 'ECHEC: Instagram n\'a pas renvoyé d\'identifiant de média (conteneur).' };

        // Une vidéo est transcodée côté Meta : attendre avant de publier
        if (mediaIsVideo) {
          for (let i = 0; i < 12; i++) {
            await sleep(5000);
            try {
              const st = await exec(uid, 'INSTAGRAM_GET_POST_STATUS', { ig_user_id: igUserId, creation_id: creationId });
              const code = st?.status_code ?? st?.data?.status_code;
              if (code === 'FINISHED') break;
              if (code === 'ERROR') return { handled: true, result: 'ECHEC: Instagram a refusé la vidéo (transcodage en erreur) — vérifiez format/durée (Reels : mp4, ≤ 90 s).' };
            } catch { break; /* statut indisponible : on tente la publication */ }
          }
        }
        const published = await exec(uid, 'INSTAGRAM_CREATE_POST', { ig_user_id: igUserId, creation_id: creationId });
        // L'id renvoyé ici est celui du MÉDIA publié : c'est lui qu'attendent
        // les insights (GET_POST_INSIGHTS) — pas l'id du conteneur de création
        const mediaId = String(published?.id ?? published?.data?.id ?? creationId);
        return { handled: true, result: `OK: publication Instagram créée (id ${mediaId})` };
      }

      case 'youtube': {
        if (!mediaUrl || !mediaIsVideo) return { handled: true, result: 'ECHEC: YouTube exige une vidéo (mp4/webm/mov).' };
        const tags = hashtags(content);
        const data = await exec(uid, 'YOUTUBE_UPLOAD_VIDEO', {
          title: (title || firstLine(content) || 'Vidéo').slice(0, 95),
          description: content,
          tags: tags.length > 0 ? tags : ['video'],
          categoryId: '22', // People & Blogs
          privacyStatus: 'public',
          // Composio télécharge le fichier depuis l'URL publique
          videoFilePath: mediaUrl,
        });
        const videoId = data?.id ?? data?.videoId ?? data?.data?.id;
        return { handled: true, result: `OK: vidéo YouTube publiée${videoId ? ` https://youtu.be/${videoId}` : ''}` };
      }

      case 'facebook': {
        // L'API Graph ne publie que sur des PAGES (le profil personnel est fermé
        // aux apps depuis 2018) : on résout la première page gérée, en cache
        let page = facebookPageCache.get(uid);
        if (!page) {
          const pages = await exec(uid, 'FACEBOOK_GET_USER_PAGES', {});
          const first = (pages?.data ?? pages?.pages ?? [])[0];
          if (!first?.id) {
            return { handled: true, result: 'ECHEC: aucune Page Facebook gérée par ce compte — l\'API Facebook ne permet de publier que sur une Page (pas sur un profil personnel). Créez une Page ou reconnectez un compte qui en gère une.' };
          }
          page = { id: String(first.id), name: String(first.name ?? 'Page') };
          facebookPageCache.set(uid, page);
        }
        let data: any;
        if (mediaUrl && mediaIsVideo) {
          data = await exec(uid, 'FACEBOOK_CREATE_VIDEO_POST', {
            page_id: page.id,
            file_url: mediaUrl,
            description: content,
            title: (title || firstLine(content) || 'Vidéo').slice(0, 95),
          });
        } else if (mediaUrl) {
          data = await exec(uid, 'FACEBOOK_CREATE_PHOTO_POST', { page_id: page.id, url: mediaUrl, message: content });
        } else {
          data = await exec(uid, 'FACEBOOK_CREATE_POST', { page_id: page.id, message: content });
        }
        const postId = data?.post_id ?? data?.id ?? data?.data?.post_id ?? data?.data?.id ?? '';
        return { handled: true, result: `OK: post Facebook publié sur la page ${page.name}${postId ? ` https://www.facebook.com/${postId}` : ''}` };
      }

      case 'tiktok': {
        if (!mediaUrl) return { handled: true, result: 'ECHEC: TikTok exige un média (vidéo, ou image pour un post photo).' };
        if (mediaIsVideo) {
          const data = await exec(uid, 'TIKTOK_PUBLISH_VIDEO', {
            video_url: mediaUrl,
            caption: content.slice(0, 2200),
            privacy_level: 'PUBLIC_TO_EVERYONE',
          });
          const publishId = String(data?.publish_id ?? data?.data?.publish_id ?? '');
          // TikTok télécharge puis traite la vidéo : on suit le statut de publication
          if (publishId) {
            for (let i = 0; i < 12; i++) {
              await sleep(5000);
              try {
                const st = await exec(uid, 'TIKTOK_FETCH_PUBLISH_STATUS', { publish_id: publishId });
                const code = String(st?.status ?? st?.data?.status ?? '');
                if (code === 'PUBLISH_COMPLETE') return { handled: true, result: `OK: vidéo TikTok publiée (publication ${publishId})` };
                if (code === 'FAILED') {
                  const reason = st?.fail_reason ?? st?.data?.fail_reason ?? 'raison inconnue';
                  return { handled: true, result: `ECHEC: TikTok a refusé la vidéo — ${reason}` };
                }
              } catch { break; /* statut indisponible : la vidéo est partie, TikTok finit le traitement */ }
            }
          }
          return { handled: true, result: `OK: vidéo TikTok envoyée${publishId ? ` (publication ${publishId})` : ''} — traitement en cours côté TikTok` };
        }
        const data = await exec(uid, 'TIKTOK_POST_PHOTO', {
          photo_images: [mediaUrl],
          photo_cover_index: 0,
          post_mode: 'DIRECT_POST',
          privacy_level: 'PUBLIC_TO_EVERYONE',
          title: (title || firstLine(content, 85) || 'Photo').slice(0, 85),
          description: content.slice(0, 4000),
        });
        const publishId = String(data?.publish_id ?? data?.data?.publish_id ?? '');
        return { handled: true, result: `OK: post photo TikTok publié${publishId ? ` (publication ${publishId})` : ''}` };
      }

      case 'reddit': {
        // Le subreddit cible se déclare en mentionnant r/<nom> dans le titre ou le contenu
        const sub = `${title}\n${content}`.match(/(?:^|[\s("'«])r\/([A-Za-z0-9][A-Za-z0-9_]{1,20})/)?.[1];
        if (!sub) {
          return { handled: true, result: 'ECHEC: indiquez le subreddit cible en mentionnant r/<nom> dans le titre ou le contenu du post (ex. « r/startups »).' };
        }
        const postTitle = (title || firstLine(content, 295) || 'Post').slice(0, 295);
        const data = await exec(uid, 'REDDIT_CREATE_REDDIT_POST', mediaUrl
          // Un lien direct vers une image/vidéo s'affiche comme post média sur Reddit
          ? { subreddit: sub, title: postTitle, kind: 'link', url: mediaUrl }
          : { subreddit: sub, title: postTitle, kind: 'self', text: content });
        const d = data?.json?.data ?? data?.data?.json?.data ?? data ?? {};
        const thing: string = d?.name ?? (d?.id ? `t3_${d.id}` : '');
        const url: string = d?.url ?? '';
        let note = '';
        if (mediaUrl && thing && content.trim() && content.trim() !== postTitle) {
          // Un post lien n'a pas de corps de texte : le contenu part en premier commentaire
          try {
            await exec(uid, 'REDDIT_POST_REDDIT_COMMENT', { thing_id: thing, text: content });
            note = ' (texte publié en premier commentaire)';
          } catch {
            note = ' (texte non joint : l\'envoi du commentaire a échoué)';
          }
        }
        return { handled: true, result: `OK: post Reddit publié sur r/${sub}${url ? ` ${url}` : ''}${note}` };
      }

      default:
        return { handled: false };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erreur inconnue';
    if (msg === 'COMPOSIO_NOT_CONFIGURED') return { handled: false };
    // Compte non rattaché chez Composio : message actionnable plutôt que
    // l'erreur brute (qui expose l'identifiant interne lf-… sans aider).
    if (/no connected account/i.test(msg)) {
      const label = PLATFORM_LABELS[platform] ?? platform;
      return { handled: true, result: `ECHEC: aucun compte ${label} connecté — rattachez-le dans Configuration avant de publier.` };
    }
    return { handled: true, result: `ECHEC: ${msg}` };
  }
}

// ── Métriques directes ─────────────────────────────────────────────────────────

export interface DirectMetrics {
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

export interface DirectMetricsResult {
  /** false = pas de stratégie directe (ou outil en erreur) → opérateur IA */
  handled: boolean;
  metrics?: DirectMetrics;
}

const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

/**
 * URN(s) d'entité LinkedIn extraits d'une référence — URL permalien ou URN brut.
 * Le TYPE (share/activity/ugcPost) est lu DANS la référence (déterministe, sans
 * IA), car LINKEDIN_LIST_REACTIONS exige le bon type : pour un id donné, seul
 * « urn:li:share:<id> » répond pour un lien « ...-share-<id>-... », les autres
 * types renvoyant « Entity not found » (vérifié en réel).
 *  - post publié par l'app          : .../feed/update/urn:li:share:<id>  → URN brut présent
 *  - lien « copier le lien » d'un post : .../posts/<slug>-<type>-<id>-<code>/ → type dans le slug
 *  - dernier recours (id long sans type) : on tente share puis activity, dans cet ordre.
 */
export function linkedinEntityUrns(ref: string): string[] {
  // Casse canonique exigée par LinkedIn (« ugcPost » en camelCase) — un type
  // simplement mis en minuscules (« ugcpost ») produirait un URN invalide.
  const LI_TYPE: Record<string, string> = { share: 'share', activity: 'activity', ugcpost: 'ugcPost' };
  const canon = (t: string) => LI_TYPE[t.toLowerCase()] ?? t.toLowerCase();
  const direct = ref.match(/urn:li:(share|ugcPost|activity):(\d+)/i);
  if (direct) return [`urn:li:${canon(direct[1])}:${direct[2]}`];
  const slug = ref.match(/[-_/](share|activity|ugcPost)[-_/](\d{6,})(?:[-/?#]|$)/i);
  if (slug) return [`urn:li:${canon(slug[1])}:${slug[2]}`];
  const bare = ref.match(/\b(\d{15,})\b/)?.[1];
  if (bare) return [`urn:li:share:${bare}`, `urn:li:activity:${bare}`];
  return [];
}

/** Normalise et borne une liste brute de commentaires extraite d'une API */
function toCommentItems(raw: { externalId?: unknown; author?: unknown; text?: unknown; likeCount?: unknown; commentedAt?: unknown }[]): CommentItem[] {
  return raw
    .map((c) => ({
      externalId: c.externalId != null && String(c.externalId).trim() ? String(c.externalId) : null,
      author: c.author != null && String(c.author).trim() ? String(c.author).trim() : null,
      text: (c.text == null ? '' : String(c.text)).trim(),
      likeCount: toNum(c.likeCount),
      commentedAt: c.commentedAt != null && String(c.commentedAt).trim() ? String(c.commentedAt) : null,
    }))
    .filter((c) => c.text.length > 0)
    .slice(0, 50);
}

const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/**
 * Récupération best-effort du CONTENU des commentaires d'un post publié.
 * N'est appelée que lorsque l'appelant le demande (withComments) — jamais
 * dans la boucle de synchro automatique des compteurs. Ne jette jamais :
 * toute erreur (slug absent, schéma inattendu, API muette) → liste vide,
 * pour ne pas perturber la lecture des métriques.
 */
async function fetchCommentsDirect(
  uid: string,
  platform: string,
  externalRef: string,
  exec: ToolExecutor,
): Promise<CommentItem[]> {
  try {
    switch (platform) {
      case 'reddit': {
        const article = externalRef.match(/comments\/([a-z0-9]{4,})/i)?.[1];
        if (!article) return [];
        const data = await exec(uid, 'REDDIT_RETRIEVE_POST_COMMENTS', { article });
        // Reddit renvoie [post_listing, comments_listing] ; Composio peut l'envelopper
        const listings = asArray(data).length ? asArray(data)
          : asArray(data?.data).length ? asArray(data?.data)
          : asArray(data?.response_data);
        const children = listings?.[1]?.data?.children
          ?? data?.comments?.data?.children
          ?? data?.comments
          ?? [];
        return toCommentItems(asArray(children)
          .map((ch) => ch?.data ?? ch)
          .filter((c) => c && (c.body || c.text))
          .map((c) => ({
            externalId: c.name ?? (c.id ? `t1_${c.id}` : null),
            author: c.author,
            text: c.body ?? c.text,
            likeCount: c.score ?? c.ups,
            commentedAt: c.created_utc ? new Date(Number(c.created_utc) * 1000).toISOString() : null,
          })));
      }

      case 'facebook': {
        const postId = externalRef.match(/(\d{6,}_\d+)/)?.[1];
        if (!postId) return [];
        const data = await exec(uid, 'FACEBOOK_GET_POST', {
          post_id: postId,
          fields: 'comments.limit(50){message,from,created_time,like_count}',
        });
        const list = (data?.data ?? data)?.comments?.data ?? [];
        return toCommentItems(asArray(list).map((c) => ({
          externalId: c.id,
          author: c?.from?.name,
          text: c.message,
          likeCount: c.like_count,
          commentedAt: c.created_time,
        })));
      }

      case 'youtube': {
        const id = externalRef.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/)([\w-]{6,})/)?.[1]
          ?? (/^[\w-]{11}$/.test(externalRef.trim()) ? externalRef.trim() : null);
        if (!id) return [];
        for (const slug of ['YOUTUBE_LIST_COMMENT_THREADS', 'YOUTUBE_COMMENT_THREADS', 'YOUTUBE_GET_COMMENT_THREADS']) {
          try {
            const data = await exec(uid, slug, { part: 'snippet', videoId: id, maxResults: 50 });
            const items = data?.items ?? data?.response_data?.items ?? data?.data?.items ?? [];
            const mapped = toCommentItems(asArray(items).map((it) => {
              const s = it?.snippet?.topLevelComment?.snippet ?? it?.snippet ?? {};
              return { externalId: it?.id, author: s.authorDisplayName, text: s.textDisplay ?? s.textOriginal, likeCount: s.likeCount, commentedAt: s.publishedAt };
            }));
            if (mapped.length > 0) return mapped;
          } catch { /* slug suivant */ }
        }
        return [];
      }

      case 'instagram': {
        const mediaId = externalRef.match(/\b(\d{10,})\b/)?.[1];
        if (!mediaId) return [];
        for (const slug of ['INSTAGRAM_GET_COMMENTS', 'INSTAGRAM_GET_MEDIA_COMMENTS', 'INSTAGRAM_LIST_COMMENTS']) {
          try {
            const data = await exec(uid, slug, { ig_media_id: mediaId, media_id: mediaId, id: mediaId });
            const list = data?.data ?? data?.comments?.data ?? data?.response_data?.data ?? [];
            const mapped = toCommentItems(asArray(list).map((c) => ({
              externalId: c.id, author: c.username ?? c?.from?.username, text: c.text, likeCount: c.like_count, commentedAt: c.timestamp,
            })));
            if (mapped.length > 0) return mapped;
          } catch { /* slug suivant */ }
        }
        return [];
      }

      case 'twitter': {
        const tweetId = externalRef.match(/status\/(\d+)/)?.[1]
          ?? (/^\d{8,}$/.test(externalRef.trim()) ? externalRef.trim() : null);
        if (!tweetId) return [];
        for (const slug of ['TWITTER_RECENT_SEARCH', 'TWITTER_SEARCH_RECENT_TWEETS']) {
          try {
            const data = await exec(uid, slug, {
              query: `conversation_id:${tweetId}`,
              max_results: 50,
              tweet_fields: ['author_id', 'public_metrics', 'created_at'],
            });
            const list = data?.data ?? data?.response_data?.data ?? [];
            const mapped = toCommentItems(asArray(list)
              .filter((t) => String(t.id) !== String(tweetId))
              .map((t) => ({ externalId: t.id, author: t.author_id, text: t.text, likeCount: t?.public_metrics?.like_count, commentedAt: t.created_at })));
            if (mapped.length > 0) return mapped;
          } catch { /* slug suivant */ }
        }
        return [];
      }

      // LinkedIn : l'API ne livre pas les commentaires d'un post personnel
      default:
        return [];
    }
  } catch {
    return [];
  }
}

/**
 * Lecture déterministe des métriques d'un post publié (likes, commentaires,
 * vues, partages) à partir de sa référence externe (URL ou identifiant
 * enregistré à la publication). Toute erreur rend la main à l'opérateur IA :
 * pour la LECTURE, le repli a du sens (autres outils, post retrouvable par
 * son titre…).
 *
 * withComments : récupère AUSSI le contenu réel des commentaires (1 appel de
 * plus selon la plateforme). Désactivé par défaut → la synchro automatique des
 * compteurs reste strictement inchangée.
 */
export async function syncMetricsDirect(
  userId: string,
  platform: string,
  externalRef: string,
  exec: ToolExecutor = executeComposioTool,
  mcp: McpToolCaller = callMcpToolDirect,
  withComments = false,
): Promise<DirectMetricsResult> {
  const uid = composioUserIdFor(userId);
  if (!uid) return { handled: false };

  const result = await syncMetricsDirectCounts(userId, platform, externalRef, exec, mcp);
  if (withComments && result.handled && result.metrics?.found) {
    result.metrics.commentItems = await fetchCommentsDirect(uid, platform, externalRef, exec);
  }
  return result;
}

/** Lecture des compteurs seuls (impressions/likes/commentaires/partages). */
async function syncMetricsDirectCounts(
  userId: string,
  platform: string,
  externalRef: string,
  exec: ToolExecutor,
  mcp: McpToolCaller,
): Promise<DirectMetricsResult> {
  const uid = composioUserIdFor(userId);
  if (!uid) return { handled: false };

  try {
    switch (platform) {
      case 'twitter': {
        const id = externalRef.match(/status\/(\d+)/)?.[1]
          ?? (/^\d{8,}$/.test(externalRef.trim()) ? externalRef.trim() : null);
        if (!id) return { handled: false };
        const data = await exec(uid, 'TWITTER_POST_LOOKUP_BY_POST_ID', {
          id,
          tweet_fields: ['public_metrics'],
        });
        const m = data?.data?.public_metrics ?? data?.public_metrics;
        if (!m) return { handled: true, metrics: { found: false, note: 'Tweet sans métriques publiques dans la réponse' } };
        return {
          handled: true,
          metrics: {
            found: true,
            impressions: toNum(m.impression_count),
            likes: toNum(m.like_count),
            comments: toNum(m.reply_count),
            shares: toNum(m.retweet_count) + toNum(m.quote_count),
            clicks: 0,
          },
        };
      }

      case 'youtube': {
        const id = externalRef.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/)([\w-]{6,})/)?.[1]
          ?? (/^[\w-]{11}$/.test(externalRef.trim()) ? externalRef.trim() : null);
        if (!id) return { handled: false };
        const data = await exec(uid, 'YOUTUBE_VIDEO_DETAILS', { id, part: 'statistics' });
        // Forme réelle constatée : data.response_data.items[0].statistics
        const st = data?.response_data?.items?.[0]?.statistics
          ?? data?.items?.[0]?.statistics ?? data?.data?.items?.[0]?.statistics ?? data?.statistics;
        if (!st) return { handled: true, metrics: { found: false, note: 'Vidéo introuvable (statistics absentes de la réponse YouTube)' } };
        return {
          handled: true,
          metrics: {
            found: true,
            impressions: toNum(st.viewCount),
            likes: toNum(st.likeCount),
            comments: toNum(st.commentCount),
            shares: 0,
            clicks: 0,
            note: 'YouTube n\'expose pas les partages via l\'API',
          },
        };
      }

      case 'reddit': {
        const article = externalRef.match(/comments\/([a-z0-9]{4,})/i)?.[1];
        if (!article) return { handled: false };
        // RETRIEVE_SPECIFIC_COMMENT accepte aussi un POST via son fullname
        // t3_<id> — forme réelle constatée : data.things[0].data (score,
        // num_comments). L'endpoint des commentaires, lui, ne renvoie pas le post.
        const data = await exec(uid, 'REDDIT_RETRIEVE_SPECIFIC_COMMENT', { id: `t3_${article}` });
        const post = data?.things?.[0]?.data ?? data?.data?.things?.[0]?.data;
        if (!post) return { handled: true, metrics: { found: false, note: 'Post Reddit introuvable dans la réponse' } };
        return {
          handled: true,
          metrics: {
            found: true,
            impressions: 0,
            likes: toNum(post.score ?? post.ups),
            comments: toNum(post.num_comments),
            shares: toNum(post.num_crossposts),
            clicks: 0,
            note: 'Reddit n\'expose pas les impressions (score = votes nets)',
          },
        };
      }

      case 'instagram': {
        const igId = externalRef.match(/\b(\d{10,})\b/)?.[1];
        if (!igId) return { handled: false };
        // On demande EXPLICITEMENT les métriques supportées : les presets de
        // l'outil incluent « impressions », que Meta a retirée pour les médias
        // récents (erreur 400) — vérifié en réel sur un post fraîchement publié.
        const data = await exec(uid, 'INSTAGRAM_GET_POST_INSIGHTS', {
          ig_post_id: igId,
          metric: ['reach', 'likes', 'comments', 'shares', 'saved'],
        });
        const list = data?.data ?? data?.insights?.data;
        if (!Array.isArray(list) || list.length === 0) {
          return { handled: true, metrics: { found: false, note: 'Aucun insight renvoyé par Instagram pour ce média' } };
        }
        const val = (name: string) => toNum(list.find((i: any) => i?.name === name)?.values?.[0]?.value);
        return {
          handled: true,
          metrics: {
            found: true,
            impressions: val('reach'),
            likes: val('likes'),
            comments: val('comments'),
            shares: val('shares'),
            clicks: 0,
            note: 'Instagram : « reach » utilisé comme impressions',
          },
        };
      }

      case 'facebook': {
        // L'id complet d'un post de Page est pageId_postId
        const postId = externalRef.match(/(\d{6,}_\d+)/)?.[1];
        if (!postId) return { handled: false };
        const data = await exec(uid, 'FACEBOOK_GET_POST', {
          post_id: postId,
          fields: 'id,shares,likes.summary(true),comments.summary(true)',
        });
        const d = data?.data ?? data;
        if (!d?.id) return { handled: true, metrics: { found: false, note: 'Post Facebook introuvable dans la réponse' } };
        return {
          handled: true,
          metrics: {
            found: true,
            impressions: 0,
            likes: toNum(d?.likes?.summary?.total_count),
            comments: toNum(d?.comments?.summary?.total_count),
            shares: toNum(d?.shares?.count),
            clicks: 0,
            note: 'Facebook n\'expose pas les impressions d\'un post via ce point d\'accès',
          },
        };
      }

      case 'linkedin': {
        // L'API LinkedIn d'un compte personnel n'expose que les réactions —
        // lisibles via l'outil du serveur MCP (absent du catalogue REST). On
        // résout l'URN d'entité depuis l'URL (déterministe) et on tente chaque
        // candidat jusqu'à une réponse lisible — sans aucun appel modèle.
        if (!isComposioConfigured()) return { handled: false };
        const urns = linkedinEntityUrns(externalRef);
        if (urns.length === 0) return { handled: false };
        for (const urn of urns) {
          let out: string;
          try {
            out = await mcp(uid, 'LINKEDIN_LIST_REACTIONS', { entity: urn, count: 100 });
          } catch {
            continue; // URN d'un autre type → « Entity not found » : candidat suivant
          }
          let parsed: any = null;
          try { parsed = JSON.parse(out); } catch { continue; }
          if (parsed?.successful === false || parsed?.successfull === false) continue;
          const dd = parsed?.data ?? parsed;
          const total = dd?.paging?.total ?? (Array.isArray(dd?.elements) ? dd.elements.length : null);
          if (total === null || total === undefined) continue;
          return {
            handled: true,
            metrics: {
              found: true,
              impressions: 0,
              likes: toNum(total),
              comments: 0,
              shares: 0,
              clicks: 0,
              note: 'LinkedIn n\'expose ni impressions ni commentaires pour un post personnel (seules les réactions sont lisibles)',
            },
          };
        }
        return { handled: false }; // aucun URN candidat lisible → repli opérateur
      }

      default:
        return { handled: false };
    }
  } catch {
    return { handled: false }; // outil en erreur : l'opérateur IA tente sa chance
  }
}
