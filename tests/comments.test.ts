/**
 * Commentaires des posts : stockage (dédup + bornage), agrégat par plateforme,
 * persistance au fil de la synchro (worker), et routes de la vue Performances.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import { computeCommentStats } from '../src/services/analytics';
import { processDueMetricsSync } from '../src/services/metricsSync';
import app from '../src/app';

let token: string;
let userId: string;
let planId: string | null = null;
let redditPostId: string;
let twitterPostId: string;

const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY;
  const res = await request(app).post('/api/auth/register').send({
    email: 'comments@launchforge.dev', password: 'password123', name: 'Comments Tester',
  });
  token = res.body.data.token;
  userId = res.body.data.user.id;

  const plan = await request(app).post('/api/plan').set(auth()).send({
    productName: 'CommentsApp', description: 'Test de la récupération des commentaires',
    targetAudience: 'Testers', niche: 'saas', goals: ['mesurer'], pricing: 'gratuit', mode: 'template',
  });
  planId = plan.body.data.id;

  const mkPost = async (platform: string, title: string) => {
    const r = await request(app).post('/api/posts').set(auth()).send({
      platform, title, content: `Contenu ${title}`, status: 'published',
      externalUrl: 'https://example.com/p',
    });
    storage.updatePost(r.body.data.id, { publishedAt: new Date().toISOString() });
    return r.body.data.id as string;
  };
  redditPostId = await mkPost('reddit', 'Post Reddit');
  twitterPostId = await mkPost('twitter', 'Post Twitter');
});

describe('Stockage des commentaires', () => {
  it('upsertPostComments déduplique par externalId et compte les nouveaux', () => {
    const post = storage.getPostById(redditPostId)!;
    const added1 = storage.upsertPostComments(post, [
      { externalId: 't1_a', author: 'u/alice', text: 'super lancement, dispo en EU ?' },
      { externalId: 't1_b', author: 'u/bob', text: 'le pricing est agressif' },
    ]);
    expect(added1).toBe(2);

    // Re-synchro : 't1_a' déjà connu (ignoré), 't1_c' nouveau
    const added2 = storage.upsertPostComments(post, [
      { externalId: 't1_a', author: 'u/alice', text: 'super lancement, dispo en EU ?' },
      { externalId: 't1_c', author: 'u/carol', text: 'comment ça marche pour les équipes ?' },
    ]);
    expect(added2).toBe(1);
    expect(storage.getPostCommentsByPlan(userId, planId).length).toBe(3);
  });

  it('déduplique aussi les commentaires sans externalId (repli sur le texte)', () => {
    const post = storage.getPostById(redditPostId)!;
    const before = storage.getPostCommentsByPlan(userId, planId).length;
    storage.upsertPostComments(post, [{ author: 'u/anon', text: 'un commentaire sans identifiant' }]);
    storage.upsertPostComments(post, [{ author: 'u/anon', text: 'un commentaire sans identifiant' }]);
    expect(storage.getPostCommentsByPlan(userId, planId).length).toBe(before + 1);
  });

  it('ignore les commentaires au texte vide', () => {
    const post = storage.getPostById(twitterPostId)!;
    const added = storage.upsertPostComments(post, [{ externalId: 'x0', author: 'spam', text: '   ' }]);
    expect(added).toBe(0);
  });
});

describe('Agrégat par type de post', () => {
  it('computeCommentStats regroupe par plateforme, total décroissant', () => {
    const tw = storage.getPostById(twitterPostId)!;
    storage.upsertPostComments(tw, [{ externalId: 'x1', author: 'marc', text: 'tuto clair, merci' }]);

    const stats = computeCommentStats(userId, planId);
    expect(stats.total).toBe(5); // 4 reddit + 1 twitter
    expect(stats.byPlatform[0].platform).toBe('reddit'); // le plus commenté en tête
    expect(stats.byPlatform.find((p) => p.platform === 'reddit')!.total).toBe(4);
    expect(stats.byPlatform.find((p) => p.platform === 'twitter')!.total).toBe(1);
  });
});

describe('Persistance au fil de la synchro (worker)', () => {
  it('le worker persiste les commentaires renvoyés par la synchro', async () => {
    storage.setMetricsSyncMinutes(userId, 60);
    const before = storage.getPostCommentsByPlan(userId, planId).length;
    // Synchroniseur injecté : renvoie des compteurs ET du contenu de commentaires
    const fakeSync = async () => ({
      found: true, impressions: 10, likes: 2, comments: 1, shares: 0, clicks: 0,
      commentItems: [{ externalId: 'wk1', author: 'worker', text: 'commentaire récupéré par le worker' }],
    });
    await processDueMetricsSync(new Date(), fakeSync as never);
    expect(storage.getPostCommentsByPlan(userId, planId).length).toBeGreaterThan(before);
  });
});

describe('Routes Performances (commentaires)', () => {
  it('GET /api/content/comments renvoie les commentaires groupés', async () => {
    const res = await request(app).get('/api/content/comments').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThan(0);
    expect(Array.isArray(res.body.data.byPlatform)).toBe(true);
  });

  it('POST /api/content/comments/analyze → 503 sans clé IA', async () => {
    const res = await request(app).post('/api/content/comments/analyze').set(auth());
    expect(res.status).toBe(503);
  });

  it('POST /api/content/comments/refresh → 503 sans Composio configuré', async () => {
    delete process.env.COMPOSIO_MCP_URL;
    delete process.env.COMPOSIO_API_KEY;
    const res = await request(app).post('/api/content/comments/refresh').set(auth());
    expect(res.status).toBe(503);
  });
});

describe('Suppression en cascade', () => {
  it('supprimer un post supprime ses commentaires', async () => {
    const before = storage.getPostCommentsByPlan(userId, planId).length;
    const redditCount = storage.getPostCommentsByPlan(userId, planId).filter((c) => c.postId === redditPostId).length;
    expect(redditCount).toBeGreaterThan(0);
    await request(app).delete(`/api/posts/${redditPostId}`).set(auth());
    const after = storage.getPostCommentsByPlan(userId, planId).length;
    expect(after).toBe(before - redditCount);
  });
});
