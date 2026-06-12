/**
 * Publication DIRECTE via l'API Composio (`tools/execute`) — déterministe,
 * sans appel modèle. Les arguments sont mappés sur les schémas RÉELS des
 * outils (vérifiés sur l'API) :
 *
 *  - X/Twitter   : TWITTER_CREATION_OF_A_POST (texte ; le toolkit n'expose
 *                  pas d'upload de média → média signalé comme non joint)
 *  - LinkedIn    : LINKEDIN_GET_MY_INFO (URN auteur, mis en cache) puis
 *                  LINKEDIN_CREATE_LINKED_IN_POST (texte ; pas de média
 *                  exposé par le toolkit)
 *  - Instagram   : INSTAGRAM_GET_USER_INFO (compte, mis en cache) puis
 *                  CREATE_MEDIA_CONTAINER (image_url/video_url public) —
 *                  attente du traitement pour la vidéo — puis CREATE_POST
 *  - YouTube     : YOUTUBE_UPLOAD_VIDEO (le binaire est récupéré par
 *                  Composio depuis l'URL publique passée en videoFilePath)
 *
 * Les autres plateformes (Reddit : subreddit/flair requis, Facebook :
 * page_id…) restent sur l'opérateur IA, qui sait demander le contexte.
 */

import { composioUserIdFor } from './composioConnect';

const COMPOSIO_API = 'https://backend.composio.dev/api/v3';

export type ToolExecutor = (
  composioUserId: string,
  slug: string,
  args: Record<string, unknown>,
) => Promise<any>;

/** Exécute un outil Composio pour une identité donnée (API REST, pas de modèle) */
export const executeComposioTool: ToolExecutor = async (composioUserId, slug, args) => {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error('COMPOSIO_NOT_CONFIGURED');
  const res = await fetch(`${COMPOSIO_API}/tools/execute/${slug}`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: composioUserId, arguments: args }),
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

// Identités résolues une fois par utilisateur (URN LinkedIn, compte Instagram)
const linkedinAuthorCache = new Map<string, string>();
const instagramIdCache = new Map<string, string>();

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
        const note = mediaUrl ? ' (média non joint : le toolkit LinkedIn de Composio ne gère que le texte)' : '';

        // Contournement du bug de version du toolkit Composio si la clé proxy est posée
        if (process.env.COMPOSIO_PROXY_API_KEY) {
          const accountId = await linkedinAccountId(uid);
          if (accountId) {
            const result = await publishLinkedInViaProxy(accountId, author, content);
            return { handled: true, result: result.startsWith('OK') ? result + note : result };
          }
        }

        try {
          const data = await exec(uid, 'LINKEDIN_CREATE_LINKED_IN_POST', {
            author,
            commentary: content,
            visibility: 'PUBLIC',
            lifecycleState: 'PUBLISHED',
          });
          const urn = data?.share_id ?? data?.id ?? data?.urn ?? '';
          return { handled: true, result: `OK: post LinkedIn publié${urn ? ` ${urn}` : ''}${note}` };
        } catch (err) {
          const msg = err instanceof Error ? err.message : '';
          if (/NONEXISTENT_VERSION/i.test(msg)) {
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
        await exec(uid, 'INSTAGRAM_CREATE_POST', { ig_user_id: igUserId, creation_id: creationId });
        return { handled: true, result: `OK: publication Instagram créée (id ${creationId})` };
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

      default:
        return { handled: false };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erreur inconnue';
    if (msg === 'COMPOSIO_NOT_CONFIGURED') return { handled: false };
    return { handled: true, result: `ECHEC: ${msg}` };
  }
}
