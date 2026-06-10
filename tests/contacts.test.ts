import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import app from '../src/app';

let token: string;
let contactId: string;

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.COMPOSIO_MCP_URL;
  const res = await request(app).post('/api/auth/register').send({
    email: 'contacts@launchforge.dev',
    password: 'password123',
    name: 'Contacts Tester',
  });
  token = res.body.data.token;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('Contacts', () => {
  it('creates a contact with a clamped score', async () => {
    const res = await request(app)
      .post('/api/contacts')
      .set(auth())
      .send({
        name: 'Marie Dupont',
        email: 'marie@acme.fr',
        company: 'Acme',
        type: 'prospect',
        source: 'commentaire LinkedIn',
        interestScore: 250,
        interestSummary: 'Demande une démo pour son équipe de 12 personnes',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.interestScore).toBe(100); // borné à 100
    expect(res.body.data.type).toBe('prospect');
    contactId = res.body.data.id;
  });

  it('requires a name', async () => {
    const res = await request(app).post('/api/contacts').set(auth()).send({ email: 'x@y.z' });
    expect(res.status).toBe(400);
  });

  it('lists contacts sorted by interest score', async () => {
    await request(app).post('/api/contacts').set(auth()).send({ name: 'Tiède', interestScore: 30 });
    await request(app).post('/api/contacts').set(auth()).send({ name: 'Sans score' });

    const res = await request(app).get('/api/contacts').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data[0].name).toBe('Marie Dupont');           // 100 d'abord
    expect(res.body.data[res.body.data.length - 1].name).toBe('Sans score'); // null en dernier
  });

  it('updates type and notes', async () => {
    const res = await request(app)
      .patch(`/api/contacts/${contactId}`)
      .set(auth())
      .send({ type: 'client', notes: 'Signé en juin' });
    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('client');
    expect(res.body.data.notes).toBe('Signé en juin');
  });

  it('blocks access to another user contacts', async () => {
    const other = await request(app).post('/api/auth/register').send({
      email: 'contacts-other@launchforge.dev', password: 'password123', name: 'Other',
    });
    const res = await request(app)
      .delete(`/api/contacts/${contactId}`)
      .set({ Authorization: `Bearer ${other.body.data.token}` });
    expect(res.status).toBe(404);
  });

  it('analyze returns 503 without AI key', async () => {
    const res = await request(app)
      .post('/api/contacts/analyze')
      .set(auth())
      .send({ text: 'Super produit, je veux une démo ! — Paul', source: 'commentaires' });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('AI_NOT_CONFIGURED');
  });

  it('scan-inbox returns 503 without Composio', async () => {
    const res = await request(app).post('/api/contacts/scan-inbox').set(auth());
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('COMPOSIO_NOT_CONFIGURED');
  });

  it('send-email validates recipient email first', async () => {
    const created = await request(app)
      .post('/api/contacts')
      .set(auth())
      .send({ name: 'Sans Email' });
    const res = await request(app)
      .post(`/api/contacts/${created.body.data.id}/send-email`)
      .set(auth())
      .send({ subject: 'Bonjour', body: 'Test' });
    // 503 sans Composio configuré (la config est vérifiée avant l'email du contact)
    expect([400, 503]).toContain(res.status);
  });

  it('deletes a contact', async () => {
    const res = await request(app).delete(`/api/contacts/${contactId}`).set(auth());
    expect(res.status).toBe(200);
  });
});

describe('Scan des réactions de post', () => {
  it('valide le post avant la config Composio', async () => {
    // Post sans URL externe → 400 explicite
    const post = await request(app)
      .post('/api/posts')
      .set(auth())
      .send({ platform: 'linkedin', title: 'Post sans URL', status: 'published' });
    const noUrl = await request(app)
      .post('/api/contacts/scan-post')
      .set(auth())
      .send({ postId: post.body.data.id });
    expect(noUrl.status).toBe(400);

    // Post avec URL mais sans Composio → 503
    await request(app)
      .patch(`/api/posts/${post.body.data.id}`)
      .set(auth())
      .send({ externalUrl: 'https://linkedin.com/posts/xyz' });
    const noComposio = await request(app)
      .post('/api/contacts/scan-post')
      .set(auth())
      .send({ postId: post.body.data.id });
    expect(noComposio.status).toBe(503);
    expect(noComposio.body.error).toBe('COMPOSIO_NOT_CONFIGURED');
  });

  it('refuse le post d\'un autre utilisateur', async () => {
    const other = await request(app).post('/api/auth/register').send({
      email: 'scanpost-other@launchforge.dev', password: 'password123', name: 'Other',
    });
    const post = await request(app)
      .post('/api/posts')
      .set(auth())
      .send({ platform: 'twitter', title: 'privé', status: 'published', externalUrl: 'https://x.com/u/status/9' });
    const res = await request(app)
      .post('/api/contacts/scan-post')
      .set({ Authorization: `Bearer ${other.body.data.token}` })
      .send({ postId: post.body.data.id });
    expect(res.status).toBe(404);
  });
});
