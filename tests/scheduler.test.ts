import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import { processDuePosts } from '../src/services/scheduler';
import app from '../src/app';

let token: string;

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.COMPOSIO_MCP_URL;
  const res = await request(app).post('/api/auth/register').send({
    email: 'scheduler@launchforge.dev',
    password: 'password123',
    name: 'Scheduler Tester',
  });
  token = res.body.data.token;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

async function createDuePost(extra: Record<string, unknown> = {}) {
  const past = new Date(Date.now() - 5 * 60_000).toISOString();
  const res = await request(app)
    .post('/api/posts')
    .set(auth())
    .send({
      platform: 'twitter',
      title: 'Post dû',
      content: 'Contenu à publier automatiquement',
      status: 'scheduled',
      scheduledAt: past,
      autoPublish: 1,
      ...extra,
    });
  return res.body.data as { id: string };
}

describe('Worker de publication automatique', () => {
  it('transmet l\'image du post au publieur (paramètre média, plus de hack texte)', async () => {
    const post = await createDuePost({ imageUrl: 'https://exemple.dev/visuel.png', title: 'Post avec image' });
    const calls: { content: string; imageUrl?: string | null }[] = [];
    await processDuePosts(new Date(), async (_u, _p, content, imageUrl) => {
      calls.push({ content, imageUrl });
      return 'OK: publié';
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].imageUrl).toBe('https://exemple.dev/visuel.png');
    expect(calls[0].content).not.toContain('[Image à joindre');
    storage.deletePost(post.id);
  });

  it('publie les posts dus quand le publieur répond OK', async () => {
    const post = await createDuePost();
    const published = await processDuePosts(new Date(), async () => 'OK: publié (id 123)');
    expect(published).toBeGreaterThanOrEqual(1);

    const fresh = storage.getPostById(post.id)!;
    expect(fresh.status).toBe('published');
    expect(fresh.publishedAt).toBeTruthy();
    expect(fresh.publishError).toBeNull();
  });

  it('désactive l\'auto-publication et trace l\'erreur en cas d\'échec (pas de boucle de retry)', async () => {
    const post = await createDuePost({ title: 'Post qui échoue' });
    await processDuePosts(new Date(), async () => 'ECHEC: compte non connecté');

    const fresh = storage.getPostById(post.id)!;
    expect(fresh.status).toBe('scheduled');     // reste programmé pour action manuelle
    expect(fresh.autoPublish).toBe(0);          // plus de retry automatique
    expect(fresh.publishError).toContain('compte non connecté');

    // Le tick suivant ne le reprend pas
    const again = await processDuePosts(new Date(), async () => 'OK: publié');
    const stillScheduled = storage.getPostById(post.id)!;
    expect(stillScheduled.status).toBe('scheduled');
    expect(again).toBe(0);
  });

  it('crée la prochaine occurrence des posts récurrents auto-publiés', async () => {
    const post = await createDuePost({ title: 'Hebdo auto', recurrence: 'weekly' });
    await processDuePosts(new Date(), async () => 'OK: publié');

    const all = storage.getPostsByUserId(storage.getPostById(post.id)!.userId);
    const next = all.find((p) => p.title === 'Hebdo auto' && p.status === 'scheduled');
    expect(next).toBeTruthy();
    expect(next!.autoPublish).toBe(1);          // l'occurrence suivante reste en auto
    expect(next!.calendarSynced).toBe(0);       // à re-synchroniser au calendrier
    expect(new Date(next!.scheduledAt!).getTime()).toBeGreaterThan(Date.now());
  });

  it('ignore les posts programmés sans auto-publication', async () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    await request(app).post('/api/posts').set(auth()).send({
      platform: 'linkedin', title: 'Manuel', status: 'scheduled', scheduledAt: past,
    });
    const published = await processDuePosts(new Date(), async () => 'OK: publié');
    expect(published).toBe(0);
  });
});
