/**
 * Séries récurrentes : réglages IA par série (connaissances, actus, archivage
 * veille), filiation des occurrences (seriesId), mémoire de série, et mode
 * simulé (preview sans écriture).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import { markPublished } from '../src/services/postPublisher';
import { upsertNewsArchive } from '../src/services/analytics';
import app from '../src/app';

let token: string;
let userId: string;

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY;
  const res = await request(app).post('/api/auth/register').send({
    email: 'recurrence@launchforge.dev', password: 'password123', name: 'Recurrence Tester',
  });
  token = res.body.data.token;
  userId = res.body.data.user.id;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('Réglages IA d\'une série récurrente', () => {
  it('création : défauts sûrs (connaissances ON, actus/veille OFF) et roundtrip PATCH', async () => {
    const created = await request(app).post('/api/posts').set(auth()).send({
      platform: 'linkedin', title: 'Conseil hebdo', recurrence: 'weekly',
      recurrenceBrief: 'Un conseil de prospection différent chaque semaine',
    });
    const post = created.body.data;
    expect(post.recurrenceUseKnowledge).toBe(1);
    expect(post.recurrenceUseNews).toBe(0);
    expect(post.recurrenceUpdateKb).toBe(0);
    expect(post.seriesId).toBeNull();

    const patched = await request(app).patch(`/api/posts/${post.id}`).set(auth()).send({
      recurrenceUseNews: true, recurrenceUpdateKb: true, recurrenceUseKnowledge: false,
    });
    expect(patched.body.data.recurrenceUseNews).toBe(1);
    expect(patched.body.data.recurrenceUpdateKb).toBe(1);
    expect(patched.body.data.recurrenceUseKnowledge).toBe(0);
  });
});

describe('Filiation et mémoire de série', () => {
  it('chaque occurrence pointe vers le post d\'origine, les réglages sont hérités', async () => {
    const created = await request(app).post('/api/posts').set(auth()).send({
      platform: 'twitter', title: 'Astuce du jour', recurrence: 'daily', status: 'scheduled',
      scheduledAt: new Date().toISOString(),
      recurrenceBrief: 'Une astuce différente chaque jour', recurrenceUseNews: true,
    });
    const origin = storage.getPostById(created.body.data.id)!;

    const { next: next1 } = markPublished(origin);
    expect(next1).not.toBeNull();
    expect(next1!.seriesId).toBe(origin.id);
    expect(next1!.recurrenceUseNews).toBe(1);
    expect(next1!.recurrenceBrief).toBe('Une astuce différente chaque jour');

    // 2e génération : le seriesId reste celui du post d'origine
    const { next: next2 } = markPublished(storage.getPostById(next1!.id)!);
    expect(next2!.seriesId).toBe(origin.id);

    // La mémoire de série ne contient que les occurrences PUBLIÉES
    const history = storage.getSeriesHistory(origin.id);
    expect(history).toHaveLength(2);
    expect(history.every((p) => p.status === 'published')).toBe(true);
    expect(history.map((p) => p.id)).toContain(origin.id);
    expect(history.map((p) => p.id)).toContain(next1!.id);
    expect(history.map((p) => p.id)).not.toContain(next2!.id);
  });
});

describe('Mode simulé (preview)', () => {
  it('400 sans instruction, 503 sans clé IA, 404 sur le post d\'autrui', async () => {
    const noBrief = await request(app).post('/api/posts').set(auth()).send({
      platform: 'linkedin', title: 'Sans brief', recurrence: 'weekly',
    });
    const r400 = await request(app).post(`/api/posts/${noBrief.body.data.id}/recurrence/preview`).set(auth()).send({});
    expect(r400.status).toBe(400);

    const withBrief = await request(app).post('/api/posts').set(auth()).send({
      platform: 'linkedin', title: 'Avec brief', recurrence: 'weekly', recurrenceBrief: 'Un sujet chaque semaine',
    });
    const r503 = await request(app).post(`/api/posts/${withBrief.body.data.id}/recurrence/preview`).set(auth()).send({});
    expect(r503.status).toBe(503);

    // Le brief peut venir du corps de requête (réglages non sauvés) → plus 400 mais 503 (pas de clé)
    const override = await request(app).post(`/api/posts/${noBrief.body.data.id}/recurrence/preview`).set(auth())
      .send({ recurrenceBrief: 'Brief de test non sauvegardé' });
    expect(override.status).toBe(503);

    const other = await request(app).post('/api/auth/register').send({
      email: 'recurrence-b@launchforge.dev', password: 'password123', name: 'B',
    });
    const r404 = await request(app).post(`/api/posts/${withBrief.body.data.id}/recurrence/preview`)
      .set({ Authorization: `Bearer ${other.body.data.token}` }).send({});
    expect(r404.status).toBe(404);
  });
});

describe('Fiche 📰 Veille (archivage des actus)', () => {
  it('fusionne dans UNE fiche news, datée et dédupliquée', () => {
    const planId = storage.getActivePlanId(userId);
    const added1 = upsertNewsArchive(userId, planId, ['LinkedIn a lancé une nouvelle API de métriques vidéo']);
    expect(added1).toBe(1);
    // Doublon (même fait) → ignoré ; nouveau fait → ajouté
    const added2 = upsertNewsArchive(userId, planId, [
      'LinkedIn a lancé une nouvelle API de métriques vidéo (bis)',
      'Instagram impose les images en média natif',
    ]);
    expect(added2).toBe(1);

    const entries = storage.getKnowledgeByPlan(userId, planId).filter((e) => e.category === 'news');
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toContain('API de métriques vidéo');
    expect(entries[0].content).toContain('Instagram impose');
    // Chaque ligne est datée (réinjectée dans les prompts avec sa fraîcheur)
    expect(entries[0].content).toContain(new Date().toLocaleDateString('fr-FR'));
  });
});
