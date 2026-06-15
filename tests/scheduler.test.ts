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

describe('Nettoyage de la vidéo locale après publication', () => {
  it('supprime le fichier et le champ média une fois la vidéo récupérée, garde le lien publié', async () => {
    const { saveMediaFile, uploadsDir } = await import('../src/services/mediaStore');
    const fs = await import('fs');
    const path = await import('path');

    const { fileName, url } = saveMediaFile(Buffer.alloc(4096, 1), 'mp4');
    const post = await createDuePost({ imageUrl: url, title: 'Vidéo YouTube' });

    const published = await processDuePosts(new Date(), async () =>
      'OK: vidéo publiée https://youtu.be/abc123XYZ');
    expect(published).toBe(1);

    const fresh = storage.getPostById(post.id)!;
    expect(fresh.externalUrl).toBe('https://youtu.be/abc123XYZ'); // lien cliquable conservé
    expect(fresh.imageUrl).toBeNull();                            // média nettoyé
    expect(fs.existsSync(path.join(uploadsDir(), fileName))).toBe(false); // disque libéré
  });

  it('conserve le fichier tant qu\'un exemplaire multi-plateformes non publié l\'utilise', async () => {
    const { saveMediaFile, uploadsDir } = await import('../src/services/mediaStore');
    const fs = await import('fs');
    const path = await import('path');

    const { fileName, url } = saveMediaFile(Buffer.alloc(4096, 1), 'mp4');
    const first = await createDuePost({ imageUrl: url, title: 'Exemplaire 1' });
    // Exemplaire jumeau PAS encore dû (programmé plus tard, même vidéo)
    const futureRes = await request(app).post('/api/posts').set(auth()).send({
      platform: 'instagram', title: 'Exemplaire 2', content: 'Même vidéo',
      status: 'scheduled', scheduledAt: new Date(Date.now() + 3600_000).toISOString(),
      autoPublish: 1, imageUrl: url,
    });

    await processDuePosts(new Date(), async () => 'OK: publié https://youtu.be/keep1');
    // Le jumeau attend encore : fichier conservé
    expect(fs.existsSync(path.join(uploadsDir(), fileName))).toBe(true);
    expect(storage.getPostById(first.id)!.imageUrl).toBe(url);

    // Le jumeau publie à son tour : plus personne n'attend → suppression
    await processDuePosts(new Date(Date.now() + 7200_000), async () => 'OK: publié https://instagram.com/p/keep2');
    expect(fs.existsSync(path.join(uploadsDir(), fileName))).toBe(false);
    expect(storage.getPostById(futureRes.body.data.id)!.externalUrl).toBe('https://instagram.com/p/keep2');
  });

  it('ne touche pas aux images ni aux URL externes', async () => {
    const post = await createDuePost({ imageUrl: 'https://cdn.exemple.dev/visuel.png', title: 'Image externe' });
    await processDuePosts(new Date(), async () => 'OK: publié https://x.com/i/web/status/1');
    expect(storage.getPostById(post.id)!.imageUrl).toBe('https://cdn.exemple.dev/visuel.png');
  });
});

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

  it('enregistre l\'URL du post créé renvoyée par le publieur (synchro métriques sans saisie)', async () => {
    const post = await createDuePost({ title: 'Post avec URL retour' });
    await processDuePosts(new Date(), async () => 'OK: publié sur X — https://x.com/lf/status/9876543210.');
    const fresh = storage.getPostById(post.id)!;
    expect(fresh.status).toBe('published');
    expect(fresh.externalUrl).toBe('https://x.com/lf/status/9876543210');
    storage.deletePost(post.id);
  });

  it('LinkedIn auto-publié : reconstruit l\'URL cliquable du feed depuis l\'URN renvoyé', async () => {
    const post = await createDuePost({ platform: 'linkedin', title: 'Post LinkedIn auto' });
    await processDuePosts(new Date(), async () => 'OK: post LinkedIn publié urn:li:share:7123456789 (image jointe)');
    const fresh = storage.getPostById(post.id)!;
    expect(fresh.status).toBe('published');
    // URN seul → URL du feed, cliquable depuis le Hub ET lisible par les métriques
    expect(fresh.externalUrl).toBe('https://www.linkedin.com/feed/update/urn:li:share:7123456789/');
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
