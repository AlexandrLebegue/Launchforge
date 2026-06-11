/**
 * Worker de synchro automatique des métriques : fenêtres d'intervalle par
 * utilisateur, garde-fous de coût, mise à jour des chiffres.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import { processDueMetricsSync } from '../src/services/metricsSync';
import app from '../src/app';

let token: string;
let userId: string;

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.COMPOSIO_MCP_URL;
  const res = await request(app).post('/api/auth/register').send({
    email: 'metrics@launchforge.dev', password: 'password123', name: 'Metrics Tester',
  });
  token = res.body.data.token;
  userId = res.body.data.user.id;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

async function createPublishedPost(extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/posts').set(auth()).send({
    platform: 'twitter', title: 'Post publié', content: 'Contenu',
    status: 'published', externalUrl: 'https://x.com/u/status/42', ...extra,
  });
  // publishedAt n'est pas posé par la création directe : on le force
  storage.updatePost(res.body.data.id, { publishedAt: new Date().toISOString() });
  return res.body.data.id as string;
}

describe('Réglage de l\'intervalle (Configuration)', () => {
  it('valide et borne l\'intervalle', async () => {
    const bad = await request(app).patch('/api/config/metrics-sync').set(auth()).send({ intervalMinutes: -5 });
    expect(bad.status).toBe(400);

    const tooSmall = await request(app).patch('/api/config/metrics-sync').set(auth()).send({ intervalMinutes: 3 });
    expect(tooSmall.body.data.intervalMinutes).toBe(15); // borne basse

    const off = await request(app).patch('/api/config/metrics-sync').set(auth()).send({ intervalMinutes: 0 });
    expect(off.body.data.intervalMinutes).toBe(0);
  });

  it('le statut expose l\'intervalle de l\'utilisateur', async () => {
    await request(app).patch('/api/config/metrics-sync').set(auth()).send({ intervalMinutes: 60 });
    const res = await request(app).get('/api/config/status').set(auth());
    expect(res.body.data.metricsSync.intervalMinutes).toBe(60);
  });
});

describe('Worker de synchro des métriques', () => {
  it('synchronise les posts dus et met les chiffres à jour', async () => {
    const postId = await createPublishedPost();
    const synced = await processDueMetricsSync(new Date(), async () => ({
      found: true, impressions: 1500, likes: 42, comments: 7, shares: 3, clicks: 12,
    }));
    expect(synced).toBeGreaterThanOrEqual(1);
    const post = storage.getPostById(postId)!;
    expect(post.likes).toBe(42);
    expect(post.impressions).toBe(1500);
  });

  it('respecte la fenêtre d\'intervalle (pas de resynchro immédiate)', async () => {
    const synced = await processDueMetricsSync(new Date(), async () => ({
      found: true, impressions: 9, likes: 9, comments: 9, shares: 9, clicks: 9,
    }));
    expect(synced).toBe(0); // tout vient d'être synchronisé
  });

  it('un échec ne sera pas réessayé avant la prochaine fenêtre', async () => {
    const postId = await createPublishedPost({ title: 'Post qui échoue', externalUrl: 'https://x.com/u/status/43' });
    let calls = 0;
    await processDueMetricsSync(new Date(), async () => { calls += 1; throw new Error('réseau'); });
    await processDueMetricsSync(new Date(), async () => { calls += 1; throw new Error('réseau'); });
    expect(calls).toBe(1); // le 2e tick ne retente pas
    storage.deletePost(postId);
  });

  it('ignore les posts sans URL, les utilisateurs désactivés et les posts anciens', async () => {
    // Sans URL
    await request(app).post('/api/posts').set(auth()).send({ platform: 'twitter', title: 'Sans URL', status: 'published' });
    // Post trop vieux (45 jours)
    const oldId = await createPublishedPost({ title: 'Vieux post', externalUrl: 'https://x.com/u/status/44' });
    storage.updatePost(oldId, { publishedAt: new Date(Date.now() - 45 * 86400e3).toISOString() });

    let calls = 0;
    await processDueMetricsSync(new Date(), async () => { calls += 1; return { found: false }; });
    expect(calls).toBe(0);

    // Synchro désactivée → même le post récent n'est plus dû
    storage.setMetricsSyncMinutes(userId, 0);
    const recent = await createPublishedPost({ title: 'Récent', externalUrl: 'https://x.com/u/status/45' });
    let calls2 = 0;
    await processDueMetricsSync(new Date(), async () => { calls2 += 1; return { found: false }; });
    expect(calls2).toBe(0);
    storage.deletePost(recent);
  });
});
