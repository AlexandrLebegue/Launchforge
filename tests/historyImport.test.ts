/**
 * Import d'historique (anciens posts) : normalisation déterministe par plateforme
 * via un exécuteur factice (aucun appel réseau), déduplication au niveau du
 * stockage, et garde-fous de la route /api/posts/import-history.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import { listHistory, isImportablePlatform, HISTORY_CAPABILITIES } from '../src/services/historyImport';
import { ToolExecutor } from '../src/services/composioDirect';
import { Post } from '../src/types';
import app from '../src/app';

let userId: string;
let token: string;

beforeAll(async () => {
  await initEngine();
  // La route renvoie 503 sans clé Composio : on s'assure de l'absence pour le test.
  delete process.env.COMPOSIO_API_KEY;
  const res = await request(app).post('/api/auth/register').send({
    email: 'history@launchforge.dev', password: 'password123', name: 'History Tester',
  });
  userId = res.body.data.user.id; // l'inscription pose l'identité Composio lf-<id>
  token = res.body.data.token;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

/** Exécuteur factice : réponses canalisées par slug (Error => throw). */
function recorder(responses: Record<string, unknown>) {
  const calls: { slug: string; args: Record<string, unknown> }[] = [];
  const exec: ToolExecutor = async (_uid, slug, args) => {
    calls.push({ slug, args });
    if (!(slug in responses)) throw new Error(`outil inattendu : ${slug}`);
    const r = responses[slug];
    if (r instanceof Error) throw r;
    return r;
  };
  return { calls, exec };
}

describe('listHistory — normalisation par plateforme', () => {
  it('YouTube : résout la chaîne via playlists puis liste vidéos + statistiques', async () => {
    const { calls, exec } = recorder({
      YOUTUBE_LIST_USER_PLAYLISTS: { response_data: { items: [{ snippet: { channelId: 'UC_abc' } }] } },
      YOUTUBE_LIST_CHANNEL_VIDEOS: {
        response_data: {
          items: [{ id: { videoId: 'vid1' }, snippet: { title: 'Ma vidéo', description: 'desc', publishedAt: '2026-01-01T00:00:00Z', thumbnails: { high: { url: 'http://t/1.jpg' } } } }],
          nextPageToken: '',
        },
      },
      YOUTUBE_VIDEO_DETAILS: { response_data: { items: [{ id: 'vid1', statistics: { viewCount: '100', likeCount: '10', commentCount: '2' } }] } },
    });
    const out = await listHistory(userId, 'youtube', {}, exec);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      externalId: 'vid1',
      externalUrl: 'https://youtu.be/vid1',
      title: 'Ma vidéo',
      impressions: 100, likes: 10, comments: 2,
    });
    expect(calls.map((c) => c.slug)).toContain('YOUTUBE_LIST_CHANNEL_VIDEOS');
  });

  it('TikTok : mappe les compteurs inclus dans l\'objet vidéo', async () => {
    const { exec } = recorder({
      TIKTOK_LIST_VIDEOS: {
        response_data: {
          videos: [{ id: 't1', title: 'T', video_description: 'desc', cover_image_url: 'http://c', share_url: 'http://tt/t1', view_count: 50, like_count: 5, comment_count: 1, share_count: 3, create_time: 1700000000 }],
          cursor: '', has_more: false,
        },
      },
    });
    const out = await listHistory(userId, 'tiktok', {}, exec);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ externalId: 't1', externalUrl: 'http://tt/t1', impressions: 50, likes: 5, comments: 1, shares: 3 });
    expect(out[0].publishedAt).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('Instagram : résout l\'id puis liste les médias', async () => {
    const { exec } = recorder({
      INSTAGRAM_GET_USER_INFO: { id: 'IG1' },
      INSTAGRAM_GET_USER_MEDIA: {
        data: [{ id: 'm1', caption: 'cap', permalink: 'http://ig/m1', media_url: 'http://img', timestamp: '2026-01-02T00:00:00Z', like_count: 7, comments_count: 2 }],
        paging: { cursors: { after: '' } },
      },
    });
    const out = await listHistory(userId, 'instagram', {}, exec);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ externalId: 'm1', externalUrl: 'http://ig/m1', content: 'cap', likes: 7, comments: 2 });
  });

  it('Facebook : résout la Page puis pagine jusqu\'à épuisement', async () => {
    let postsCall = 0;
    const exec: ToolExecutor = async (_uid, slug) => {
      if (slug === 'FACEBOOK_GET_USER_PAGES') return { data: [{ id: 'PAGE1', name: 'My Page' }] };
      if (slug === 'FACEBOOK_GET_PAGE_POSTS') {
        postsCall += 1;
        if (postsCall === 1) {
          return { data: [{ id: 'PAGE1_1', message: 'hello', created_time: '2026-01-03T00:00:00Z', permalink_url: 'http://fb/1', likes: { summary: { total_count: 4 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 } }] };
        }
        return { data: [] }; // deuxième page vide → arrêt
      }
      throw new Error(`inattendu ${slug}`);
    };
    const out = await listHistory(userId, 'facebook', {}, exec);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ externalId: 'PAGE1_1', externalUrl: 'http://fb/1', content: 'hello', likes: 4, comments: 2, shares: 1 });
  });

  it('X/Twitter : résout le username puis recherche from:<user>', async () => {
    const { calls, exec } = recorder({
      TWITTER_USER_LOOKUP_ME: { data: { username: 'meuser' } },
      TWITTER_RECENT_SEARCH: {
        data: [{ id: 'tw1', text: 'hello', created_at: '2026-01-04T00:00:00Z', public_metrics: { impression_count: 200, like_count: 9, reply_count: 1, retweet_count: 2, quote_count: 1 } }],
        meta: { next_token: '' },
      },
    });
    const out = await listHistory(userId, 'twitter', {}, exec);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ externalId: 'tw1', externalUrl: 'https://x.com/meuser/status/tw1', impressions: 200, likes: 9, comments: 1, shares: 3 });
    expect(String(calls[1].args.query)).toContain('from:meuser');
    // Le bon nom de paramètre Composio est tweet_fields (simple underscore),
    // sinon l'API X ignore le champ et renvoie des tweets sans métriques ni date.
    expect(calls[1].args.tweet_fields).toEqual(['public_metrics', 'created_at']);
    expect(calls[1].args).not.toHaveProperty('tweet__fields');
  });

  it('Reddit : recherche par auteur et ne garde que les posts de l\'utilisateur', async () => {
    const { exec } = recorder({
      REDDIT_SEARCH_ACROSS_SUBREDDITS: {
        search_results: { data: { children: [
          { data: { name: 't3_r1', id: 'r1', author: 'myuser', title: 'RT', selftext: 'body', permalink: '/r/test/comments/r1/rt/', subreddit: 'test', score: 12, num_comments: 3, created_utc: 1700000000 } },
          { data: { name: 't3_x9', id: 'x9', author: 'someoneelse', title: 'Autre', selftext: '', subreddit: 'test', score: 1, num_comments: 0 } },
        ] } },
      },
    });
    const out = await listHistory(userId, 'reddit', { handle: 'u/myuser' }, exec);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ externalId: 't3_r1', subreddit: 'test', likes: 12, comments: 3 });
    expect(out[0].externalUrl).toContain('/r/test/comments/r1/');
  });

  it('Reddit : exige le nom d\'utilisateur', async () => {
    const { exec } = recorder({});
    await expect(listHistory(userId, 'reddit', {}, exec)).rejects.toThrow(/utilisateur Reddit/i);
  });

  it('LinkedIn : non importable (lève une erreur explicite)', async () => {
    const { exec } = recorder({});
    await expect(listHistory(userId, 'linkedin', {}, exec)).rejects.toThrow(/LinkedIn/i);
  });

  it('compte non connecté → message actionnable', async () => {
    const exec: ToolExecutor = async () => { throw new Error('No connected account found for user'); };
    await expect(listHistory(userId, 'tiktok', {}, exec)).rejects.toThrow(/connecté/i);
  });
});

describe('Déduplication au stockage (getImportedPost)', () => {
  const mkPost = (over: Partial<Post>): Post => ({
    id: over.id!, userId, planId: null, platform: 'youtube', title: '', content: '',
    status: 'published', scheduledAt: null, publishedAt: '2026-01-01T00:00:00Z',
    externalUrl: null, externalId: null, imageUrl: null, subreddit: null,
    recurrence: 'none', recurrenceBrief: null, seriesId: null,
    recurrenceUseNews: 0, recurrenceUseKnowledge: 1, recurrenceUpdateKb: 0, crossPostId: null,
    autoPublish: 0, publishError: null, calendarSynced: 0,
    impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  });

  it('retrouve par identifiant natif, mais pas un id différent', () => {
    storage.savePost(mkPost({ id: 'p-dedup-1', externalId: 'EX1', externalUrl: 'http://yt/EX1' }));
    expect(storage.getImportedPost(userId, null, 'youtube', 'EX1', null)?.id).toBe('p-dedup-1');
    expect(storage.getImportedPost(userId, null, 'youtube', 'EX2', null)).toBeUndefined();
    // un autre type de plateforme ne matche pas le même id
    expect(storage.getImportedPost(userId, null, 'tiktok', 'EX1', null)).toBeUndefined();
  });

  it('retrouve par URL externe (dédup partagée avec l\'import par URL)', () => {
    storage.savePost(mkPost({ id: 'p-dedup-2', externalId: null, externalUrl: 'http://x.com/status/42' }));
    expect(storage.getImportedPost(userId, null, 'twitter', null, 'http://x.com/status/42')?.id).toBe('p-dedup-2');
    expect(storage.getImportedPost(userId, null, 'twitter', null, 'http://x.com/status/999')).toBeUndefined();
  });
});

describe('Route /api/posts/import-history', () => {
  it('GET options : liste les capacités (YouTube importable, LinkedIn non)', async () => {
    const res = await request(app).get('/api/posts/import-history/options').set(auth());
    expect(res.status).toBe(200);
    const platforms = res.body.data.platforms as { platform: string; importable: boolean }[];
    expect(platforms.find((p) => p.platform === 'youtube')?.importable).toBe(true);
    expect(platforms.find((p) => p.platform === 'linkedin')?.importable).toBe(false);
  });

  it('POST : refuse une plateforme non importable (400)', async () => {
    const res = await request(app).post('/api/posts/import-history').set(auth()).send({ platform: 'linkedin' });
    expect(res.status).toBe(400);
  });

  it('POST : refuse une plateforme inconnue (400)', async () => {
    const res = await request(app).post('/api/posts/import-history').set(auth()).send({ platform: 'myspace' });
    expect(res.status).toBe(400);
  });

  it('POST : 503 sans Composio configuré', async () => {
    const res = await request(app).post('/api/posts/import-history').set(auth()).send({ platform: 'youtube' });
    expect(res.status).toBe(503);
  });

  it('helpers exportés cohérents', () => {
    expect(isImportablePlatform('tiktok')).toBe(true);
    expect(isImportablePlatform('linkedin')).toBe(false);
    expect(HISTORY_CAPABILITIES.some((c) => c.platform === 'reddit' && c.handleField?.required)).toBe(true);
  });
});
