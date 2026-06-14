/**
 * Mise à jour automatique de la base de connaissances — sources (CRUD,
 * isolation par projet, rôle Lecteur), validation de l'analyse et application
 * des propositions. Aucun appel réseau ni IA : on teste les chemins
 * déterministes (la récupération/analyse réelle est couverte hors tests).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import app from '../src/app';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function register(email: string): Promise<{ token: string; id: string }> {
  const r = await request(app).post('/api/auth/register').send({ email, password: 'password123', name: email.split('@')[0] });
  return { token: r.body.data.token, id: r.body.data.user.id };
}

async function createPlan(token: string, productName: string): Promise<string> {
  const r = await request(app).post('/api/plan').set(auth(token)).send({
    productName, description: 'desc', targetAudience: 'tous', niche: 'saas', goals: ['lancer'], pricing: 'gratuit',
  });
  return r.body.data.id;
}

let owner: { token: string; id: string };
let viewer: { token: string; id: string };
let planA: string;
let githubSourceId: string;

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY; // garantit le chemin « IA non configurée »
  owner = await register('kbsync-owner@launchforge.dev');
  viewer = await register('kbsync-viewer@launchforge.dev');
  planA = await createPlan(owner.token, 'Projet A'); // auto-activé pour owner
});

describe('Sources — CRUD & isolation par projet', () => {
  it('ajoute une source GitHub (non encore synchronisée)', async () => {
    const res = await request(app).post('/api/knowledge/sources').set(auth(owner.token))
      .send({ type: 'github', url: 'github.com/vercel/next.js' });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('github');
    expect(res.body.data.lastSyncedAt).toBeNull();
    githubSourceId = res.body.data.id;
  });

  it('refuse une URL GitHub invalide', async () => {
    const res = await request(app).post('/api/knowledge/sources').set(auth(owner.token))
      .send({ type: 'github', url: 'justonesegment' });
    expect(res.status).toBe(400);
  });

  it('refuse un type de source inconnu', async () => {
    const res = await request(app).post('/api/knowledge/sources').set(auth(owner.token))
      .send({ type: 'rss', url: 'https://x.com' });
    expect(res.status).toBe(400);
  });

  it('ajoute une source site web', async () => {
    const res = await request(app).post('/api/knowledge/sources').set(auth(owner.token))
      .send({ type: 'website', url: 'https://example.com' });
    expect(res.status).toBe(201);
    expect(res.body.data.type).toBe('website');
  });

  it('liste les sources du projet actif', async () => {
    const res = await request(app).get('/api/knowledge/sources').set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
  });

  it('déduplique une source identique (même type + URL)', async () => {
    const res = await request(app).post('/api/knowledge/sources').set(auth(owner.token))
      .send({ type: 'github', url: 'github.com/vercel/next.js' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(githubSourceId);
    const list = await request(app).get('/api/knowledge/sources').set(auth(owner.token));
    expect(list.body.data.length).toBe(2); // toujours 2, pas de doublon
  });

  it('isole les sources par projet', async () => {
    await createPlan(owner.token, 'Projet B'); // active B
    const onB = await request(app).get('/api/knowledge/sources').set(auth(owner.token));
    expect(onB.body.data.length).toBe(0);

    await request(app).post(`/api/plan/${planA}/activate`).set(auth(owner.token)); // retour sur A
    const onA = await request(app).get('/api/knowledge/sources').set(auth(owner.token));
    expect(onA.body.data.length).toBe(2);
  });

  it('supprime une source', async () => {
    const res = await request(app).delete(`/api/knowledge/sources/${githubSourceId}`).set(auth(owner.token));
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/knowledge/sources').set(auth(owner.token));
    expect(list.body.data.length).toBe(1);
  });

  it('canonise les URLs équivalentes (pas de doublon)', async () => {
    await createPlan(owner.token, 'Projet C'); // nouvelle base de sources vide
    await request(app).post('/api/knowledge/sources').set(auth(owner.token))
      .send({ type: 'github', url: 'github.com/foo/bar' });
    const dup = await request(app).post('/api/knowledge/sources').set(auth(owner.token))
      .send({ type: 'github', url: 'https://github.com/foo/bar/' }); // forme équivalente
    expect(dup.status).toBe(201);
    const list = await request(app).get('/api/knowledge/sources').set(auth(owner.token));
    expect(list.body.data.length).toBe(1);
    await request(app).post(`/api/plan/${planA}/activate`).set(auth(owner.token)); // restaure A
  });
});

describe('Catégorie « news » via le CRUD', () => {
  it('persiste la catégorie Veille & actus (régression : était coercée en « other »)', async () => {
    const res = await request(app).post('/api/knowledge').set(auth(owner.token))
      .send({ title: 'Veille concurrentielle', content: 'Actu marché', category: 'news' });
    expect(res.status).toBe(201);
    expect(res.body.data.category).toBe('news');
  });
});

describe('Analyse — validation', () => {
  it('refuse une analyse sans aucune source', async () => {
    const res = await request(app).post('/api/knowledge/sync/analyze').set(auth(owner.token)).send({});
    expect(res.status).toBe(400);
  });

  it('signale l\'IA non configurée avant tout appel réseau', async () => {
    const res = await request(app).post('/api/knowledge/sync/analyze').set(auth(owner.token))
      .send({ github: 'github.com/vercel/next.js' });
    expect(res.status).toBe(503);
  });
});

describe('Application des propositions', () => {
  it('crée des fiches à partir des propositions validées', async () => {
    const res = await request(app).post('/api/knowledge/sync/apply').set(auth(owner.token)).send({
      suggestions: [{ action: 'create', category: 'product', title: 'Fiche auto', content: 'Contenu importé', source: 's', reason: 'r' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.applied).toHaveLength(1);
    expect(res.body.data.applied[0].title).toBe('Fiche auto');

    const kb = await request(app).get('/api/knowledge').set(auth(owner.token));
    expect(kb.body.data.map((e: any) => e.title)).toContain('Fiche auto');
  });

  it('met à jour une fiche existante (action update)', async () => {
    const created = await request(app).post('/api/knowledge').set(auth(owner.token))
      .send({ title: 'Original', content: 'Texte original', category: 'company' });
    const id = created.body.data.id;

    const res = await request(app).post('/api/knowledge/sync/apply').set(auth(owner.token)).send({
      suggestions: [{ action: 'update', targetId: id, category: 'company', title: 'Mis à jour', content: 'Texte révisé', source: 's', reason: 'r' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.applied[0].id).toBe(id);
    expect(res.body.data.applied[0].title).toBe('Mis à jour');
  });

  it('bascule en création si la cible de mise à jour est invalide', async () => {
    const res = await request(app).post('/api/knowledge/sync/apply').set(auth(owner.token)).send({
      suggestions: [{ action: 'update', targetId: 'cible-inexistante', category: 'other', title: 'Sans cible', content: 'Contenu', source: 's', reason: 'r' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.applied).toHaveLength(1);
    expect(res.body.data.applied[0].id).not.toBe('cible-inexistante');
  });

  it('refuse une liste vide', async () => {
    const res = await request(app).post('/api/knowledge/sync/apply').set(auth(owner.token)).send({ suggestions: [] });
    expect(res.status).toBe(400);
  });
});

describe('Rôle Lecteur', () => {
  beforeAll(async () => {
    // Rattache le projet A à une équipe, y ajoute viewer en Lecteur
    await request(app).post(`/api/plan/${planA}/activate`).set(auth(owner.token));
    const team = await request(app).post('/api/teams').set(auth(owner.token)).send({ name: 'KB Sync Team' });
    await request(app).post(`/api/plan/${planA}/team`).set(auth(owner.token)).send({ teamId: team.body.data.id });
    const inv = await request(app).post(`/api/teams/${team.body.data.id}/invites`).set(auth(owner.token)).send({ role: 'editor' });
    await request(app).post('/api/teams/join').set(auth(viewer.token)).send({ code: inv.body.data.code });
    await request(app).patch(`/api/teams/${team.body.data.id}/members/${viewer.id}`).set(auth(owner.token)).send({ role: 'viewer' });
    await request(app).post(`/api/plan/${planA}/activate`).set(auth(viewer.token));
  });

  it('un Lecteur peut voir les sources (lecture seule)', async () => {
    const res = await request(app).get('/api/knowledge/sources').set(auth(viewer.token));
    expect(res.status).toBe(200);
  });

  it('un Lecteur ne peut pas ajouter de source', async () => {
    const res = await request(app).post('/api/knowledge/sources').set(auth(viewer.token))
      .send({ type: 'website', url: 'https://interdit.com' });
    expect(res.status).toBe(403);
  });

  it('un Lecteur ne peut pas intégrer de propositions', async () => {
    const res = await request(app).post('/api/knowledge/sync/apply').set(auth(viewer.token)).send({
      suggestions: [{ action: 'create', category: 'product', title: 'X', content: 'Y', source: 's', reason: 'r' }],
    });
    expect(res.status).toBe(403);
  });
});
