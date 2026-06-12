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

// Identités résolues une fois par utilisateur (URN LinkedIn, compte Instagram)
const linkedinAuthorCache = new Map<string, string>();
const instagramIdCache = new Map<string, string>();

const firstLine = (text: string, max = 95) =>
  (text.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, max);

const hashtags = (text: string) =>
  [...text.matchAll(/#([\p{L}0-9_]{2,30})/gu)].map((m) => m[1]).slice(0, 10);

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
          author = me?.author_urn
            ?? me?.response_dict?.author_urn
            ?? (me?.sub ? `urn:li:person:${me.sub}` : me?.response_dict?.sub ? `urn:li:person:${me.response_dict.sub}` : undefined);
          if (!author) return { handled: true, result: 'ECHEC: impossible de déterminer votre URN LinkedIn (LINKEDIN_GET_MY_INFO) — reconnectez le compte LinkedIn dans Configuration.' };
          linkedinAuthorCache.set(uid, author);
        }
        const data = await exec(uid, 'LINKEDIN_CREATE_LINKED_IN_POST', {
          author,
          commentary: content,
          visibility: 'PUBLIC',
          lifecycleState: 'PUBLISHED',
        });
        const urn = data?.share_id ?? data?.id ?? data?.urn ?? '';
        const note = mediaUrl ? ' (média non joint : le toolkit LinkedIn de Composio ne gère que le texte)' : '';
        return { handled: true, result: `OK: post LinkedIn publié${urn ? ` ${urn}` : ''}${note}` };
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
