/**
 * Import d'historique : récupère les ANCIENS posts déjà publiés par l'utilisateur
 * sur ses comptes connectés (Composio) pour les rapatrier dans le Content Hub.
 *
 * 100 % DÉTERMINISTE (API Composio `tools/execute`, aucun appel modèle → aucun
 * coût IA) — même philosophie que `composioDirect.ts`. Chaque stratégie pagine
 * la plateforme et renvoie une liste normalisée `ImportedPost[]` ; la route se
 * charge de la déduplication et de l'insertion.
 *
 * Faisabilité par plateforme (catalogue Composio vérifié) :
 *  - 🟢 YouTube   : LIST_USER_PLAYLISTS (→ channelId) puis LIST_CHANNEL_VIDEOS
 *                   (pagination pageToken) + VIDEO_DETAILS (statistics).
 *  - 🟢 Instagram : GET_USER_INFO (→ ig id) puis GET_USER_MEDIA (curseur after).
 *  - 🟢 Facebook  : GET_USER_PAGES (→ page) puis GET_PAGE_POSTS (pagination par
 *                   `until` = plus ancien post du lot ; métriques via fields).
 *  - 🟢 TikTok    : LIST_VIDEOS (curseur) — compteurs inclus dans l'objet vidéo.
 *  - 🟡 X/Twitter : USER_LOOKUP_ME (→ username) puis RECENT_SEARCH `from:` —
 *                   limité aux 7 derniers jours par l'API X (et palier payant).
 *  - 🟡 Reddit    : SEARCH_ACROSS_SUBREDDITS `author:<u>` (best-effort ; le
 *                   username est demandé à l'utilisateur).
 *  - 🔴 LinkedIn  : l'API ne liste pas les posts d'un membre (scope r_member_social
 *                   restreint) → import à l'unité par URL uniquement.
 */

import { executeComposioTool, ToolExecutor } from './composioDirect';
import { composioUserIdFor } from './composioConnect';

/** Post normalisé récupéré chez la plateforme, prêt à être inséré. */
export interface ImportedPost {
  /** Identifiant natif chez la plateforme (clé de dédup) */
  externalId: string;
  externalUrl: string | null;
  title: string;
  content: string;
  imageUrl: string | null;
  /** Date de publication d'origine (ISO) si disponible */
  publishedAt: string | null;
  subreddit: string | null;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
}

export interface ImportHistoryOptions {
  /** YouTube : handle de chaîne (@nom) ; Reddit : nom d'utilisateur. */
  handle?: string;
  /** Plafond de posts récupérés (défaut 200, max 500) */
  limit?: number;
}

export interface HandleField {
  label: string;
  placeholder: string;
  required: boolean;
}

/** Capacité d'import par plateforme — exposée au front pour piloter la modale. */
export interface HistoryCapability {
  platform: string;
  label: string;
  importable: boolean;
  /** Champ d'aide à saisir (handle YouTube, username Reddit) si nécessaire */
  handleField?: HandleField;
  note: string;
}

export const HISTORY_CAPABILITIES: HistoryCapability[] = [
  { platform: 'youtube',   label: 'YouTube',     importable: true,
    handleField: { label: 'Handle de la chaîne (optionnel)', placeholder: '@machaine', required: false },
    note: 'Toutes vos vidéos, avec vues, likes et commentaires.' },
  { platform: 'instagram', label: 'Instagram',   importable: true,
    note: 'Tout votre historique (compte Business/Creator requis).' },
  { platform: 'facebook',  label: 'Facebook',    importable: true,
    note: 'Les posts de votre Page (l\'API ne couvre pas les profils perso).' },
  { platform: 'tiktok',    label: 'TikTok',      importable: true,
    note: 'Toutes vos vidéos, avec vues, likes, commentaires et partages.' },
  { platform: 'twitter',   label: 'X / Twitter', importable: true,
    note: 'Vos posts des 7 derniers jours (limite de l\'API X).' },
  { platform: 'reddit',    label: 'Reddit',      importable: true,
    handleField: { label: 'Votre nom d\'utilisateur Reddit', placeholder: 'u/pseudo', required: true },
    note: 'Vos posts récents (recherche par auteur, best-effort).' },
  { platform: 'linkedin',  label: 'LinkedIn',    importable: false,
    note: 'L\'API LinkedIn ne permet pas de lister vos anciens posts — importez-les un par un via leur URL.' },
];

/** Erreur d'import « propre » (message destiné à l'utilisateur). */
export class ImportError extends Error {}

export function isImportablePlatform(platform: string): boolean {
  return HISTORY_CAPABILITIES.some((c) => c.platform === platform && c.importable);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const str = (v: unknown): string => (v == null ? '' : String(v)).trim();
const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};
const asArray = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const isImageUrl = (u: string): boolean => /\.(jpe?g|png|gif|webp)(\?|#|$)/i.test(u);

interface Ctx {
  uid: string;
  limit: number;
  opts: ImportHistoryOptions;
  exec: ToolExecutor;
}

// ── YouTube ──────────────────────────────────────────────────────────────────

async function listYouTube(c: Ctx): Promise<ImportedPost[]> {
  const { uid, limit, opts, exec } = c;

  // 1. Résoudre l'id de chaîne : handle fourni, sinon via une playlist (mine=true)
  let channelId = '';
  if (opts.handle) {
    try {
      const data = await exec(uid, 'YOUTUBE_GET_CHANNEL_ID_BY_HANDLE', { channel_handle: opts.handle.replace(/^@/, '') });
      channelId = str(data?.items?.[0]?.id ?? data?.response_data?.items?.[0]?.id ?? data?.channelId ?? data?.id);
    } catch { /* on retombe sur la résolution par playlist */ }
  }
  if (!channelId) {
    try {
      const pl = await exec(uid, 'YOUTUBE_LIST_USER_PLAYLISTS', { part: 'snippet', maxResults: 1 });
      const items = pl?.response_data?.items ?? pl?.items ?? pl?.data?.items ?? [];
      channelId = str(items?.[0]?.snippet?.channelId);
    } catch { /* aucune playlist */ }
  }
  if (!channelId) {
    throw new ImportError('Impossible de déterminer votre chaîne YouTube — indiquez son handle (ex. @machaine) dans le champ prévu.');
  }

  // 2. Lister les vidéos (pagination)
  const videos: { vid: string; sn: any }[] = [];
  let pageToken = '';
  let guard = 0;
  do {
    const data = await exec(uid, 'YOUTUBE_LIST_CHANNEL_VIDEOS', {
      part: 'snippet', channelId, maxResults: 50, ...(pageToken ? { pageToken } : {}),
    });
    const rd = data?.response_data ?? data;
    for (const it of asArray(rd?.items)) {
      const vid = str(it?.id?.videoId ?? it?.contentDetails?.videoId ?? it?.snippet?.resourceId?.videoId ?? it?.id);
      if (vid) videos.push({ vid, sn: it?.snippet ?? {} });
    }
    pageToken = str(rd?.nextPageToken);
    guard += 1;
  } while (pageToken && videos.length < limit && guard < 12);

  // 3. Statistiques par lots de 50 (l'API YouTube accepte des ids séparés par virgule)
  const stats = new Map<string, any>();
  for (let i = 0; i < videos.length; i += 50) {
    const ids = videos.slice(i, i + 50).map((v) => v.vid).join(',');
    try {
      const d = await exec(uid, 'YOUTUBE_VIDEO_DETAILS', { id: ids, part: 'statistics' });
      const items = d?.response_data?.items ?? d?.items ?? d?.data?.items ?? [];
      for (const it of asArray(items)) stats.set(str(it.id), it.statistics ?? {});
    } catch { /* lot sans stats : compteurs à 0 */ }
  }

  return videos.slice(0, limit).map(({ vid, sn }) => {
    const st = stats.get(vid) ?? {};
    return {
      externalId: vid,
      externalUrl: `https://youtu.be/${vid}`,
      title: str(sn.title),
      content: str(sn.description),
      imageUrl: str(sn?.thumbnails?.high?.url ?? sn?.thumbnails?.medium?.url ?? sn?.thumbnails?.default?.url) || null,
      publishedAt: str(sn.publishedAt) || null,
      subreddit: null,
      impressions: toNum(st.viewCount),
      likes: toNum(st.likeCount),
      comments: toNum(st.commentCount),
      shares: 0,
      clicks: 0,
    };
  });
}

// ── TikTok ───────────────────────────────────────────────────────────────────

async function listTikTok(c: Ctx): Promise<ImportedPost[]> {
  const { uid, limit, exec } = c;
  const out: ImportedPost[] = [];
  let cursor = '';
  let guard = 0;
  do {
    const data = await exec(uid, 'TIKTOK_LIST_VIDEOS', { max_count: 20, ...(cursor ? { cursor } : {}) });
    const rd = data?.response_data ?? data?.data ?? data;
    const videos = rd?.videos ?? rd?.data?.videos ?? [];
    for (const v of asArray(videos)) {
      const id = str(v.id ?? v.video_id);
      if (!id) continue;
      out.push({
        externalId: id,
        externalUrl: str(v.share_url ?? v.embed_link) || `https://www.tiktok.com/@me/video/${id}`,
        title: str(v.title ?? v.video_description).slice(0, 300),
        content: str(v.video_description ?? v.title),
        imageUrl: str(v.cover_image_url ?? v.cover) || null,
        publishedAt: v.create_time ? new Date(Number(v.create_time) * 1000).toISOString() : null,
        subreddit: null,
        impressions: toNum(v.view_count),
        likes: toNum(v.like_count),
        comments: toNum(v.comment_count),
        shares: toNum(v.share_count),
        clicks: 0,
      });
    }
    cursor = str(rd?.cursor);
    const hasMore = rd?.has_more === true || rd?.has_more === 'true';
    guard += 1;
    if (!hasMore) break;
  } while (cursor && out.length < limit && guard < 15);
  return out.slice(0, limit);
}

// ── Instagram ────────────────────────────────────────────────────────────────

async function listInstagram(c: Ctx): Promise<ImportedPost[]> {
  const { uid, limit, exec } = c;
  const me = await exec(uid, 'INSTAGRAM_GET_USER_INFO', {});
  const igId = str(me?.id ?? me?.user_id ?? me?.data?.id);
  if (!igId) {
    throw new ImportError('Compte Instagram Business introuvable — connectez un compte professionnel dans Configuration.');
  }
  const out: ImportedPost[] = [];
  let after = '';
  let guard = 0;
  do {
    const data = await exec(uid, 'INSTAGRAM_GET_USER_MEDIA', { ig_user_id: igId, limit: 25, ...(after ? { after } : {}) });
    const list = data?.data ?? data?.response_data?.data ?? [];
    for (const m of asArray(list)) {
      const id = str(m.id);
      if (!id) continue;
      out.push({
        externalId: id,
        externalUrl: str(m.permalink) || null,
        title: '',
        content: str(m.caption),
        imageUrl: str(m.media_url ?? m.thumbnail_url) || null,
        publishedAt: str(m.timestamp) || null,
        subreddit: null,
        impressions: 0,
        likes: toNum(m.like_count),
        comments: toNum(m.comments_count),
        shares: 0,
        clicks: 0,
      });
    }
    after = str(data?.paging?.cursors?.after ?? data?.response_data?.paging?.cursors?.after);
    guard += 1;
  } while (after && out.length < limit && guard < 14);
  return out.slice(0, limit);
}

// ── Facebook (Pages) ─────────────────────────────────────────────────────────

async function listFacebook(c: Ctx): Promise<ImportedPost[]> {
  const { uid, limit, exec } = c;
  const pages = await exec(uid, 'FACEBOOK_GET_USER_PAGES', {});
  const first = (pages?.data ?? pages?.pages ?? pages?.response_data?.data ?? [])[0];
  const pageId = str(first?.id);
  if (!pageId) {
    throw new ImportError('Aucune Page Facebook gérée par ce compte — l\'API Facebook ne permet d\'importer que des posts de Page.');
  }
  const out: ImportedPost[] = [];
  let until = '';
  let guard = 0;
  do {
    const data = await exec(uid, 'FACEBOOK_GET_PAGE_POSTS', {
      page_id: pageId,
      limit: 25,
      fields: 'id,message,created_time,permalink_url,full_picture,shares,likes.summary(true),comments.summary(true)',
      ...(until ? { until } : {}),
    });
    const rd = data?.response_data ?? data;
    const list = rd?.data ?? [];
    if (!Array.isArray(list) || list.length === 0) break;
    for (const p of list) {
      const id = str(p.id);
      if (!id) continue;
      out.push({
        externalId: id,
        externalUrl: str(p.permalink_url) || `https://www.facebook.com/${id}`,
        title: '',
        content: str(p.message),
        imageUrl: str(p.full_picture) || null,
        publishedAt: str(p.created_time) || null,
        subreddit: null,
        impressions: 0,
        likes: toNum(p?.likes?.summary?.total_count),
        comments: toNum(p?.comments?.summary?.total_count),
        shares: toNum(p?.shares?.count),
        clicks: 0,
      });
    }
    // Pagination chronologique inverse : `until` = instant du plus ancien post du lot
    const oldest = str(list[list.length - 1]?.created_time);
    const ts = oldest ? Math.floor(new Date(oldest).getTime() / 1000) : NaN;
    if (!Number.isFinite(ts)) break;
    until = String(ts - 1);
    guard += 1;
  } while (out.length < limit && guard < 14);
  return out.slice(0, limit);
}

// ── X / Twitter ──────────────────────────────────────────────────────────────

async function listTwitter(c: Ctx): Promise<ImportedPost[]> {
  const { uid, limit, exec } = c;
  const me = await exec(uid, 'TWITTER_USER_LOOKUP_ME', {});
  const username = str(me?.data?.username ?? me?.username ?? me?.response_data?.data?.username);
  if (!username) {
    throw new ImportError('Impossible de lire votre compte X — le palier de l\'API X connectée ne permet pas la lecture (essayez un compte avec un accès API Basic).');
  }
  const out: ImportedPost[] = [];
  let nextToken = '';
  let guard = 0;
  do {
    const data = await exec(uid, 'TWITTER_RECENT_SEARCH', {
      query: `from:${username} -is:retweet`,
      max_results: 100,
      tweet_fields: ['public_metrics', 'created_at'],
      ...(nextToken ? { next_token: nextToken } : {}),
    });
    const list = data?.data ?? data?.response_data?.data ?? [];
    for (const t of asArray(list)) {
      const id = str(t.id);
      if (!id) continue;
      const m = t.public_metrics ?? {};
      out.push({
        externalId: id,
        externalUrl: `https://x.com/${username}/status/${id}`,
        title: '',
        content: str(t.text),
        imageUrl: null,
        publishedAt: str(t.created_at) || null,
        subreddit: null,
        impressions: toNum(m.impression_count),
        likes: toNum(m.like_count),
        comments: toNum(m.reply_count),
        shares: toNum(m.retweet_count) + toNum(m.quote_count),
        clicks: 0,
      });
    }
    nextToken = str(data?.meta?.next_token ?? data?.response_data?.meta?.next_token);
    guard += 1;
  } while (nextToken && out.length < limit && guard < 10);
  return out.slice(0, limit);
}

// ── Reddit ───────────────────────────────────────────────────────────────────

async function listReddit(c: Ctx): Promise<ImportedPost[]> {
  const { uid, limit, opts, exec } = c;
  const username = str(opts.handle).replace(/^\/?u\//i, '').trim();
  if (!username) {
    throw new ImportError('Indiquez votre nom d\'utilisateur Reddit pour importer vos posts.');
  }
  const data = await exec(uid, 'REDDIT_SEARCH_ACROSS_SUBREDDITS', {
    search_query: `author:${username}`,
    restrict_sr: false,
    sort: 'new',
    limit: Math.min(100, limit),
  });
  const children = data?.search_results?.data?.children
    ?? data?.response_data?.data?.children
    ?? data?.data?.children
    ?? data?.children
    ?? [];
  const out: ImportedPost[] = [];
  for (const ch of asArray(children)) {
    const d = ch?.data ?? ch;
    if (!d) continue;
    // La recherche par auteur peut ramener des commentaires/posts d'autres comptes : on filtre
    if (str(d.author).toLowerCase() !== username.toLowerCase()) continue;
    if (d.selftext === undefined && d.title === undefined) continue; // ignorer les commentaires
    const id = str(d.name) || (d.id ? `t3_${d.id}` : '');
    if (!id) continue;
    const link = d.permalink ? `https://www.reddit.com${d.permalink}` : str(d.url);
    out.push({
      externalId: id,
      externalUrl: link || null,
      title: str(d.title),
      content: str(d.selftext),
      imageUrl: d.url && isImageUrl(String(d.url)) ? String(d.url) : null,
      publishedAt: d.created_utc ? new Date(Number(d.created_utc) * 1000).toISOString() : null,
      subreddit: str(d.subreddit) || null,
      impressions: 0,
      likes: toNum(d.score ?? d.ups),
      comments: toNum(d.num_comments),
      shares: toNum(d.num_crossposts),
      clicks: 0,
    });
  }
  return out.slice(0, limit);
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

/**
 * Récupère l'historique des posts de l'utilisateur sur une plateforme.
 * Lève `ImportError` (message destiné à l'UI) si la plateforme n'est pas
 * importable, si le compte n'est pas connecté, ou si l'identité est introuvable.
 */
export async function listHistory(
  userId: string,
  platform: string,
  opts: ImportHistoryOptions = {},
  exec: ToolExecutor = executeComposioTool,
): Promise<ImportedPost[]> {
  const uid = composioUserIdFor(userId);
  if (!uid) throw new ImportError('Composio n\'est pas configuré pour ce compte.');
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 500);
  const c: Ctx = { uid, limit, opts, exec };

  try {
    switch (platform) {
      case 'youtube':   return await listYouTube(c);
      case 'tiktok':    return await listTikTok(c);
      case 'instagram': return await listInstagram(c);
      case 'facebook':  return await listFacebook(c);
      case 'twitter':   return await listTwitter(c);
      case 'reddit':    return await listReddit(c);
      case 'linkedin':
        throw new ImportError('LinkedIn ne permet pas l\'import automatique de l\'historique — importez chaque post via son URL.');
      default:
        throw new ImportError(`Import d'historique non disponible pour « ${platform} ».`);
    }
  } catch (err) {
    if (err instanceof ImportError) throw err;
    const msg = err instanceof Error ? err.message : 'Erreur inconnue';
    if (/no connected account/i.test(msg)) {
      const label = HISTORY_CAPABILITIES.find((cap) => cap.platform === platform)?.label ?? platform;
      throw new ImportError(`Aucun compte ${label} connecté — rattachez-le dans Configuration avant d'importer.`);
    }
    if (msg === 'COMPOSIO_NOT_CONFIGURED') {
      throw new ImportError('Composio n\'est pas configuré (clé API absente).');
    }
    throw new ImportError(`Récupération impossible : ${msg}`);
  }
}
