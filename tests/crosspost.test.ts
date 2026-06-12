/**
 * Multi-plateformes : déclinaison d'un post vers d'autres plateformes
 * (exemplaires indépendants liés par crossPostId), outil chatbot, et
 * comparaison des plateformes dans les stats du projet.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import { computeProjectStats } from '../src/services/analytics';
import { executeTool } from '../src/services/telegramBot';
import app from '../src/app';

let token: string;
let userId: string;

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY; // adapt → copie telle quelle, aucun appel IA
  const res = await request(app).post('/api/auth/register').send({
    email: 'crosspost@launchforge.dev', password: 'password123', name: 'Crosspost Tester',
  });
  token = res.body.data.token;
  userId = res.body.data.user.id;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('POST /api/posts/:id/crosspost', () => {
  it('décline un post programmé : exemplaires liés, mêmes date/auto-publication, plateformes dédupliquées', async () => {
    const when = new Date(Date.now() + 3600_000).toISOString();
    const created = await request(app).post('/api/posts').set(auth()).send({
      platform: 'linkedin', title: 'Annonce v2', content: 'On lance la v2 !',
      status: 'scheduled', scheduledAt: when, autoPublish: true, imageUrl: 'https://x.dev/v2.png',
    });
    const id = created.body.data.id as string;

    // linkedin (déjà la plateforme du post) doit être ignoré, twitter en double aussi
    const res = await request(app).post(`/api/posts/${id}/crosspost`).set(auth())
      .send({ platforms: ['twitter', 'instagram', 'linkedin', 'twitter'] });
    expect(res.status).toBe(200);
    expect(res.body.data.posts).toHaveLength(2);

    const original = storage.getPostById(id)!;
    expect(original.crossPostId).toBeTruthy();
    const group = storage.getCrossPostGroup(original.crossPostId!);
    expect(group.map((p) => p.platform).sort()).toEqual(['instagram', 'linkedin', 'twitter']);

    const twitter = group.find((p) => p.platform === 'twitter')!;
    expect(twitter.content).toBe('On lance la v2 !'); // sans IA : copie telle quelle
    expect(twitter.scheduledAt).toBe(when);
    expect(twitter.autoPublish).toBe(1);
    expect(twitter.imageUrl).toBe('https://x.dev/v2.png');
    expect(twitter.externalUrl).toBeNull();
    expect(twitter.impressions).toBe(0);

    // Re-décliner vers une plateforme déjà couverte → rien de créé
    const again = await request(app).post(`/api/posts/${id}/crosspost`).set(auth())
      .send({ platforms: ['twitter'] });
    expect(again.body.data.posts).toHaveLength(0);
  });

  it('un original publié se décline en brouillons ; validations de la route', async () => {
    const created = await request(app).post('/api/posts').set(auth()).send({
      platform: 'linkedin', title: 'Déjà publié', content: 'Contenu', status: 'published',
    });
    const id = created.body.data.id as string;
    const res = await request(app).post(`/api/posts/${id}/crosspost`).set(auth())
      .send({ platforms: ['reddit'] });
    expect(res.body.data.posts[0].status).toBe('draft');
    expect(res.body.data.posts[0].scheduledAt).toBeNull();

    expect((await request(app).post(`/api/posts/${id}/crosspost`).set(auth()).send({ platforms: [] })).status).toBe(400);
    expect((await request(app).post(`/api/posts/${id}/crosspost`).set(auth()).send({})).status).toBe(400);
  });
});

describe('Analyse multi-plateformes (computeProjectStats)', () => {
  it('compare le même contenu d\'une plateforme à l\'autre et désigne la gagnante', async () => {
    const created = await request(app).post('/api/posts').set(auth()).send({
      platform: 'linkedin', title: 'Comparatif', content: 'Le même contenu partout',
      status: 'scheduled', scheduledAt: new Date().toISOString(),
    });
    const id = created.body.data.id as string;
    const cross = await request(app).post(`/api/posts/${id}/crosspost`).set(auth())
      .send({ platforms: ['twitter'] });
    const twinId = cross.body.data.posts[0].id as string;

    // Publication + métriques contrastées : LinkedIn surperforme nettement
    const now = new Date().toISOString();
    storage.updatePost(id,     { status: 'published', publishedAt: now, impressions: 1000, likes: 80, comments: 10, shares: 5 });
    storage.updatePost(twinId, { status: 'published', publishedAt: now, impressions: 800,  likes: 8,  comments: 1,  shares: 0 });

    const stats = computeProjectStats(userId, storage.getActivePlanId(userId));
    const group = stats.crossGroups.find((g) => g.title === 'Comparatif');
    expect(group).toBeDefined();
    expect(group!.posts).toHaveLength(2);
    expect(group!.bestPlatform).toBe('linkedin');
  });
});

describe('Outil chatbot crosspost_post', () => {
  it('décline depuis le chat et liste les exemplaires créés', async () => {
    const created = await request(app).post('/api/posts').set(auth()).send({
      platform: 'linkedin', title: 'Depuis le chat', content: 'Contenu à décliner',
      status: 'scheduled', scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
    });
    const shortId = (created.body.data.id as string).slice(0, 8);

    const out = await executeTool(userId, 'chat-x', 'crosspost_post', {
      postId: shortId, platforms: ['twitter', 'reddit'], adapt: false,
    });
    expect(out).toContain('décliné sur 2 plateforme(s)');
    expect(out).toContain('twitter');
    expect(out).toContain('reddit');

    expect(await executeTool(userId, 'chat-x', 'crosspost_post', { postId: 'zzzzzzzz', platforms: ['twitter'] }))
      .toContain('ERREUR');
    expect(await executeTool(userId, 'chat-x', 'crosspost_post', { postId: shortId, platforms: [] }))
      .toContain('ERREUR');
  });
});
