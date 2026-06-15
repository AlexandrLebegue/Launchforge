/**
 * Mise à jour automatique de la base de connaissances : réglage de l'intervalle
 * (Configuration), fenêtres par utilisateur, garde-fous de coût et application
 * directe des fiches. Les récupérateurs/analyseur sont injectés — aucun appel
 * réseau ni IA.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import { processDueKnowledgeSync } from '../src/services/knowledgeSyncWorker';
import { FetchedSource } from '../src/services/knowledgeSync';
import { KnowledgeSuggestion } from '../src/types';
import app from '../src/app';

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let token: string;
let userId: string;

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY;
  const reg = await request(app).post('/api/auth/register').send({
    email: 'kbworker@launchforge.dev', password: 'password123', name: 'KB Worker',
  });
  token = reg.body.data.token;
  userId = reg.body.data.user.id;
  await request(app).post('/api/plan').set(auth(token)).send({
    productName: 'Produit', description: 'desc', targetAudience: 'tous', niche: 'saas', goals: ['lancer'], pricing: 'gratuit',
  });
});

const stubFetch = async (): Promise<FetchedSource> => ({
  type: 'website', url: 'https://example.com', label: 'Example', text: 'Texte de la source',
});

const stubAnalyze = (suggestions: KnowledgeSuggestion[]) =>
  async (): Promise<KnowledgeSuggestion[]> => suggestions;

const oneSuggestion: KnowledgeSuggestion[] = [{
  action: 'create', targetId: null, category: 'product',
  title: 'Fiche auto', content: 'Contenu importé', source: 'Example', reason: 'r',
}];

describe('Réglage de l\'intervalle (Configuration)', () => {
  it('valide et borne l\'intervalle', async () => {
    const bad = await request(app).patch('/api/config/knowledge-sync').set(auth(token)).send({ intervalMinutes: -5 });
    expect(bad.status).toBe(400);

    const tooSmall = await request(app).patch('/api/config/knowledge-sync').set(auth(token)).send({ intervalMinutes: 5 });
    expect(tooSmall.body.data.intervalMinutes).toBe(60); // borne basse

    const off = await request(app).patch('/api/config/knowledge-sync').set(auth(token)).send({ intervalMinutes: 0 });
    expect(off.body.data.intervalMinutes).toBe(0);
  });

  it('le statut expose l\'intervalle de l\'utilisateur', async () => {
    await request(app).patch('/api/config/knowledge-sync').set(auth(token)).send({ intervalMinutes: 10080 });
    const res = await request(app).get('/api/config/status').set(auth(token));
    expect(res.body.data.knowledgeSync.intervalMinutes).toBe(10080);
  });
});

describe('Worker de mise à jour de la base', () => {
  it('applique les fiches des sources dues et horodate la source', async () => {
    await request(app).patch('/api/config/knowledge-sync').set(auth(token)).send({ intervalMinutes: 1440 });
    const src = await request(app).post('/api/knowledge/sources').set(auth(token)).send({ type: 'website', url: 'https://example.com' });
    expect(src.body.data.lastSyncedAt).toBeNull();

    const applied = await processDueKnowledgeSync(new Date(), {
      fetchWebsite: stubFetch, fetchGitHub: stubFetch, analyze: stubAnalyze(oneSuggestion),
    });
    expect(applied).toBeGreaterThanOrEqual(1);

    const refreshed = storage.getKnowledgeSourceById(src.body.data.id)!;
    expect(refreshed.lastSyncedAt).not.toBeNull();

    const kb = await request(app).get('/api/knowledge').set(auth(token));
    expect(kb.body.data.map((e: any) => e.title)).toContain('Fiche auto');
  });

  it('respecte la fenêtre d\'intervalle (pas de re-synchro immédiate)', async () => {
    let calls = 0;
    const applied = await processDueKnowledgeSync(new Date(), {
      fetchWebsite: async () => { calls += 1; return stubFetch(); },
      analyze: stubAnalyze(oneSuggestion),
    });
    expect(calls).toBe(0); // la source vient d'être synchronisée
    expect(applied).toBe(0);
  });

  it('ne retente pas une source en échec avant la prochaine fenêtre', async () => {
    const src = await request(app).post('/api/knowledge/sources').set(auth(token)).send({ type: 'github', url: 'github.com/foo/bar' });
    expect(src.body.data.lastSyncedAt).toBeNull();

    let calls = 0;
    const failFetch = async () => { calls += 1; throw new Error('réseau'); };
    await processDueKnowledgeSync(new Date(), { fetchGitHub: failFetch, fetchWebsite: failFetch, analyze: stubAnalyze([]) });
    await processDueKnowledgeSync(new Date(), { fetchGitHub: failFetch, fetchWebsite: failFetch, analyze: stubAnalyze([]) });
    expect(calls).toBe(1); // horodatée dès le 1er tick → plus due au 2e
  });

  it('ignore les utilisateurs qui ont désactivé la mise à jour', async () => {
    storage.setKnowledgeSyncMinutes(userId, 0);
    let calls = 0;
    const applied = await processDueKnowledgeSync(new Date(), {
      fetchWebsite: async () => { calls += 1; return stubFetch(); },
      fetchGitHub: async () => { calls += 1; return stubFetch(); },
      analyze: stubAnalyze(oneSuggestion),
    });
    expect(calls).toBe(0);
    expect(applied).toBe(0);
  });
});
