/**
 * Analyse de performance : stats projet (attribution post → leads incluse),
 * boucle d'apprentissage vers la base de connaissances, validations des
 * routes, éligibilité au rapport hebdo.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import { computeProjectStats, computePerformanceSeries, upsertLearnings, dispatchWeeklyReports } from '../src/services/analytics';
import app from '../src/app';

let token: string;
let userId: string;
let planId: string | null = null;
let topPostId: string;

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY;
  const res = await request(app).post('/api/auth/register').send({
    email: 'analytics@launchforge.dev', password: 'password123', name: 'Analytics Tester',
  });
  token = res.body.data.token;
  userId = res.body.data.user.id;

  const plan = await request(app).post('/api/plan').set(auth()).send({
    productName: 'StatsApp', description: 'Appli de test des analytics et rapports',
    targetAudience: 'Analystes', niche: 'saas', goals: ['mesurer'], pricing: 'gratuit', mode: 'template',
  });
  planId = plan.body.data.id;

  // Trois posts publiés avec métriques contrastées + un lead attribué
  const mkPost = async (title: string, platform: string, metrics: Record<string, number>, imageUrl?: string) => {
    const r = await request(app).post('/api/posts').set(auth()).send({
      platform, title, content: `Contenu de ${title}`, status: 'published', imageUrl,
    });
    storage.updatePost(r.body.data.id, { publishedAt: new Date().toISOString(), ...metrics });
    return r.body.data.id as string;
  };
  topPostId = await mkPost('Post star', 'linkedin', { impressions: 1000, likes: 80, comments: 15, shares: 5 }, 'https://x.dev/img.png');
  await mkPost('Post moyen', 'linkedin', { impressions: 500, likes: 10, comments: 2, shares: 0 });
  await mkPost('Post twitter', 'twitter', { impressions: 200, likes: 4, comments: 1, shares: 1 });

  // Lead attribué au post star (source au format du scan d'engagement)
  await request(app).post('/api/contacts').set(auth()).send({
    name: 'Lead Star', email: 'lead@star.dev',
    source: `réactions post [${topPostId.slice(0, 8)}] LinkedIn`, interestScore: 85,
  });
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('Stats projet (calcul local)', () => {
  it('agrège par plateforme, média et jours, et classe les posts', () => {
    const stats = computeProjectStats(userId, planId);
    expect(stats.publishedCount).toBe(3);
    expect(stats.totals.impressions).toBe(1700);
    expect(stats.byPlatform[0].platform).toBe('linkedin');
    expect(stats.topPosts[0].title).toBe('Post star');
    expect(stats.media.withMedia.posts).toBe(1);
    expect(stats.byDay.length).toBeGreaterThan(0);
  });

  it('attribue les leads aux posts via la source « post [id] »', () => {
    const stats = computeProjectStats(userId, planId);
    expect(stats.leads.total).toBe(1);
    expect(stats.leads.fromPosts).toBe(1);
    expect(stats.leads.hot).toBe(1);
    expect(stats.leads.byPost[0]).toMatchObject({ postId: topPostId, leads: 1 });
    expect(stats.topPosts[0].leads).toBe(1);
  });
});

describe('Séries de performance (graphiques)', () => {
  it('agrège par semaine avec progression relative', () => {
    const series = computePerformanceSeries(userId, planId);
    const active = series.weekly.filter((w) => w.posts > 0);
    expect(active.length).toBeGreaterThan(0);
    const lastActive = active[active.length - 1];
    expect(lastActive.impressions).toBe(1700);
    expect(lastActive.likes).toBe(94);
    expect(series.weekly.length).toBeLessThanOrEqual(12);
  });

  it('construit la courbe quotidienne depuis les snapshots (report de la dernière valeur)', () => {
    const post = storage.getPostById(topPostId)!;
    // J1 : 100 vues — J2 : 1000 vues (le post star) + un 2e post apparaît
    storage.recordMetricSnapshot({ ...post, impressions: 100, likes: 10 }, '2026-06-01T10:00:00.000Z');
    storage.recordMetricSnapshot(post, '2026-06-02T10:00:00.000Z');
    const other = storage.getPostsByPlan(userId, planId).find((p) => p.title === 'Post moyen')!;
    storage.recordMetricSnapshot(other, '2026-06-02T11:00:00.000Z');

    const series = computePerformanceSeries(userId, planId);
    expect(series.hasHistory).toBe(true);
    const d1 = series.daily.find((d) => d.date === '2026-06-01')!;
    const d2 = series.daily.find((d) => d.date === '2026-06-02')!;
    expect(d1.impressions).toBe(100);
    // J2 = dernière valeur du post star (1000) + post moyen (500)
    expect(d2.impressions).toBe(1500);
  });

  it('la route /api/content/performance répond avec les séries', async () => {
    const res = await request(app).get('/api/content/performance').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.weekly)).toBe(true);
    expect(res.body.data.hasHistory).toBe(true);
  });

  it('la saisie manuelle de métriques enregistre un snapshot', async () => {
    const before = storage.getMetricSnapshots(userId, planId).length;
    await request(app).patch(`/api/posts/${topPostId}`).set(auth()).send({ likes: 99 });
    expect(storage.getMetricSnapshots(userId, planId).length).toBe(before + 1);
  });
});

describe('Boucle d\'apprentissage (base de connaissances)', () => {
  it('fusionne les enseignements dans UNE fiche learnings, dédupliquée et bornée', () => {
    const added1 = upsertLearnings(userId, planId, ['Les posts avec un chiffre en accroche font +40 % d\'engagement']);
    expect(added1).toBe(1);
    // Doublon (même début) → ignoré
    const added2 = upsertLearnings(userId, planId, ['Les posts avec un chiffre en accroche font mieux', 'Le mardi matin surperforme nettement']);
    expect(added2).toBe(1);

    const entries = storage.getKnowledgeByPlan(userId, planId).filter((e) => e.category === 'learnings');
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toContain('chiffre en accroche');
    expect(entries[0].content).toContain('mardi matin');
  });
});

describe('Routes d\'analyse', () => {
  it('analyse : 503 sans clé IA, 400 sur un post non publié', async () => {
    const noKey = await request(app).post(`/api/posts/${topPostId}/analyze`).set(auth());
    expect(noKey.status).toBe(503);

    process.env.OPENROUTER_API_KEY = 'test-key';
    const draft = await request(app).post('/api/posts').set(auth()).send({ platform: 'linkedin', title: 'Brouillon' });
    const notPublished = await request(app).post(`/api/posts/${draft.body.data.id}/analyze`).set(auth());
    delete process.env.OPENROUTER_API_KEY;
    expect(notPublished.status).toBe(400);
  });

  it('rapport : 503 sans clé IA', async () => {
    const res = await request(app).get('/api/content/report').set(auth());
    expect(res.status).toBe(503);
  });
});

describe('Rapport hebdomadaire', () => {
  it('cible les utilisateurs liés à Telegram dont le rapport est dû, le lundi uniquement', async () => {
    storage.saveTelegramLink({ chatId: 'chat-analytics', userId, createdAt: new Date().toISOString() });

    // Pas lundi → aucun envoi
    const tuesday = new Date('2026-06-09T09:00:00Z'); // mardi
    expect(await dispatchWeeklyReports(tuesday, async () => {})).toBe(0);

    // Lundi sans clé IA → aucun envoi non plus
    const monday = new Date('2026-06-08T09:00:00Z');
    expect(await dispatchWeeklyReports(monday, async () => {})).toBe(0);

    // Éligibilité storage : dû tant que jamais envoyé, plus dû juste après
    expect(storage.getUsersDueWeeklyReport(monday.toISOString()).some((u) => u.userId === userId)).toBe(true);
    storage.markWeeklyReportSent(userId, monday.toISOString());
    expect(storage.getUsersDueWeeklyReport(monday.toISOString()).some((u) => u.userId === userId)).toBe(false);
    // Re-dû 7 jours plus tard
    const nextMonday = new Date('2026-06-15T09:00:00Z');
    expect(storage.getUsersDueWeeklyReport(nextMonday.toISOString()).some((u) => u.userId === userId)).toBe(true);
  });
});
