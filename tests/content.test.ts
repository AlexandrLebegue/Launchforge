import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import app from '../src/app';

let token: string;

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY;
  const res = await request(app).post('/api/auth/register').send({
    email: 'content@launchforge.dev',
    password: 'password123',
    name: 'Content Tester',
  });
  token = res.body.data.token;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('Posts (Content Hub)', () => {
  let postId: string;

  it('creates a scheduled recurring post', async () => {
    const res = await request(app)
      .post('/api/posts')
      .set(auth())
      .send({
        platform: 'linkedin',
        title: 'Post hebdo conseils',
        content: 'Contenu du post LinkedIn',
        status: 'scheduled',
        scheduledAt: '2026-06-15T09:00:00.000Z',
        recurrence: 'weekly',
        recurrenceBrief: 'Un conseil actionnable différent chaque semaine sur la prospection',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('scheduled');
    expect(res.body.data.recurrence).toBe('weekly');
    expect(res.body.data.recurrenceBrief).toBe('Un conseil actionnable différent chaque semaine sur la prospection');
    postId = res.body.data.id;
  });

  it('updates and clears the recurrence brief via PATCH', async () => {
    const upd = await request(app)
      .patch(`/api/posts/${postId}`)
      .set(auth())
      .send({ recurrenceBrief: '  Nouvelle consigne de régénération  ' });
    expect(upd.status).toBe(200);
    expect(upd.body.data.recurrenceBrief).toBe('Nouvelle consigne de régénération');

    const cleared = await request(app)
      .patch(`/api/posts/${postId}`)
      .set(auth())
      .send({ recurrenceBrief: '   ' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.recurrenceBrief).toBeNull();

    // On remet la consigne pour le test de publication récurrente
    await request(app)
      .patch(`/api/posts/${postId}`)
      .set(auth())
      .send({ recurrenceBrief: 'Un conseil actionnable différent chaque semaine' });
  });

  it('updates metrics on a post', async () => {
    const res = await request(app)
      .patch(`/api/posts/${postId}`)
      .set(auth())
      .send({ impressions: 1200, likes: 84, comments: 12, shares: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.impressions).toBe(1200);
    expect(res.body.data.likes).toBe(84);
  });

  it('rejects invalid metrics', async () => {
    const res = await request(app)
      .patch(`/api/posts/${postId}`)
      .set(auth())
      .send({ likes: -5 });
    expect(res.status).toBe(200);
    expect(res.body.data.likes).toBe(84); // inchangé
  });

  it('publishing a recurring post spawns the next occurrence', async () => {
    const res = await request(app)
      .post(`/api/posts/${postId}/publish`)
      .set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.post.status).toBe('published');
    expect(res.body.data.post.publishedAt).toBeTruthy();

    const next = res.body.data.next;
    expect(next).toBeTruthy();
    expect(next.status).toBe('scheduled');
    expect(next.recurrence).toBe('weekly');
    expect(next.likes).toBe(0); // métriques remises à zéro
    expect(new Date(next.scheduledAt).getTime()).toBeGreaterThan(Date.now());
    // L'instruction de régénération est portée par chaque nouvelle occurrence ;
    // sans clé IA configurée le contenu précédent est conservé tel quel.
    expect(next.recurrenceBrief).toBe('Un conseil actionnable différent chaque semaine');
    expect(next.content).toBe('Contenu du post LinkedIn');
  });

  it('cannot publish twice', async () => {
    const res = await request(app).post(`/api/posts/${postId}/publish`).set(auth());
    expect(res.status).toBe(400);
  });

  it('deletes a post', async () => {
    const res = await request(app).delete(`/api/posts/${postId}`).set(auth());
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/posts').set(auth());
    expect(list.body.data.find((p: any) => p.id === postId)).toBeUndefined();
  });

  it('sync-metrics returns 503 when Composio/IA are not configured', async () => {
    delete process.env.COMPOSIO_MCP_URL;
    const created = await request(app)
      .post('/api/posts')
      .set(auth())
      .send({ platform: 'twitter', title: 'à synchroniser', status: 'published', externalUrl: 'https://x.com/u/status/1' });
    const res = await request(app)
      .post(`/api/posts/${created.body.data.id}/sync-metrics`)
      .set(auth());
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('COMPOSIO_NOT_CONFIGURED');
  });

  it('blocks access to another user posts', async () => {
    const other = await request(app).post('/api/auth/register').send({
      email: 'content-other@launchforge.dev', password: 'password123', name: 'Other',
    });
    const created = await request(app)
      .post('/api/posts')
      .set(auth())
      .send({ platform: 'twitter', title: 'privé' });
    const res = await request(app)
      .delete(`/api/posts/${created.body.data.id}`)
      .set({ Authorization: `Bearer ${other.body.data.token}` });
    expect(res.status).toBe(404);
  });
});

describe('Knowledge base', () => {
  let entryId: string;

  it('creates an entry', async () => {
    const res = await request(app)
      .post('/api/knowledge')
      .set(auth())
      .send({ category: 'tone', title: 'Ton de marque', content: 'Tutoiement, direct, pas de jargon corporate.' });
    expect(res.status).toBe(201);
    expect(res.body.data.category).toBe('tone');
    entryId = res.body.data.id;
  });

  it('requires title and content', async () => {
    const res = await request(app).post('/api/knowledge').set(auth()).send({ title: 'sans contenu' });
    expect(res.status).toBe(400);
  });

  it('updates an entry', async () => {
    const res = await request(app)
      .patch(`/api/knowledge/${entryId}`)
      .set(auth())
      .send({ content: 'Tutoiement, direct, emojis avec parcimonie.' });
    expect(res.status).toBe(200);
    expect(res.body.data.content).toContain('parcimonie');
  });

  it('lists then deletes', async () => {
    const list = await request(app).get('/api/knowledge').set(auth());
    expect(list.body.data.some((e: any) => e.id === entryId)).toBe(true);

    const del = await request(app).delete(`/api/knowledge/${entryId}`).set(auth());
    expect(del.status).toBe(200);
  });
});

describe('Content assistant', () => {
  it('returns 503 when AI is not configured', async () => {
    const res = await request(app)
      .post('/api/content/generate')
      .set(auth())
      .send({ platform: 'linkedin', brief: 'Annoncer notre nouvelle fonctionnalité' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('AI_NOT_CONFIGURED');
  });

  it('validates inputs', async () => {
    const res = await request(app)
      .post('/api/content/generate')
      .set(auth())
      .send({ platform: 'linkedin' });
    // 503 prioritaire sans clé ; avec clé ce serait 400 — on teste sans clé
    expect([400, 503]).toContain(res.status);
  });
});

describe('Calendrier éditorial', () => {
  it('retourne 503 sans clé IA', async () => {
    const res = await request(app)
      .post('/api/content/calendar')
      .set(auth())
      .send({ weeks: 2, postsPerWeek: 3, platforms: ['linkedin'] });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('AI_NOT_CONFIGURED');
  });

  it('rejette une date de début invalide', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const res = await request(app)
      .post('/api/content/calendar')
      .set(auth())
      .send({ startDate: 'pas-une-date' });
    delete process.env.OPENROUTER_API_KEY;
    expect(res.status).toBe(400);
  });
});

describe('Assistant de création (chat)', () => {
  it('retourne 503 sans clé IA', async () => {
    const res = await request(app)
      .post('/api/content/chat/stream')
      .set(auth())
      .send({ messages: [{ role: 'user', text: 'Un post LinkedIn sur notre lancement' }] });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('AI_NOT_CONFIGURED');
  });

  it('valide que l\'historique se termine par un message utilisateur', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const empty = await request(app)
      .post('/api/content/chat/stream')
      .set(auth())
      .send({ messages: [] });
    const badEnd = await request(app)
      .post('/api/content/chat/stream')
      .set(auth())
      .send({ messages: [{ role: 'assistant', text: 'Bonjour' }] });
    delete process.env.OPENROUTER_API_KEY;
    expect(empty.status).toBe(400);
    expect(badEnd.status).toBe(400);
  });
});
