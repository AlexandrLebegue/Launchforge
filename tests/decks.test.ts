/**
 * Présentations Marp + génération de visuels : rendu hors-ligne, thèmes,
 * validations des routes (sans appel IA réseau).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import { renderDeckHtml, CUSTOM_THEMES, SAMPLE_DECK, themeForUser } from '../src/services/decks';
import app from '../src/app';
import { v4 as uuid } from 'uuid';

let token: string;
let userId: string;

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY;
  const res = await request(app).post('/api/auth/register').send({
    email: 'decks@launchforge.dev', password: 'password123', name: 'Decks Tester',
  });
  token = res.body.data.token;
  userId = res.body.data.user.id;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('Rendu Marp (hors-ligne)', () => {
  it('rend un deck HTML complet avec le thème maison', () => {
    const html = renderDeckHtml(SAMPLE_DECK, 'launchforge', CUSTOM_THEMES.launchforge.css);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Aperçu du thème');
    expect(html).toContain('#7c5cfc'); // couleur du thème launchforge
    expect((html.match(/<svg/g) || []).length).toBeGreaterThanOrEqual(3); // 3 slides
  });

  it('retombe sur le thème launchforge par défaut', () => {
    expect(themeForUser(userId).theme).toBe('launchforge');
    storage.setMarpTheme(userId, 'gaia');
    expect(themeForUser(userId)).toEqual({ theme: 'gaia', css: null });
    storage.setMarpTheme(userId, 'launchforge');
  });
});

describe('Routes decks', () => {
  it('génération : 503 sans clé IA, 400 sans brief', async () => {
    const noKey = await request(app).post('/api/decks').set(auth()).send({ brief: 'Pitch' });
    expect(noKey.status).toBe(503);

    process.env.OPENROUTER_API_KEY = 'test-key';
    const noBrief = await request(app).post('/api/decks').set(auth()).send({});
    delete process.env.OPENROUTER_API_KEY;
    expect(noBrief.status).toBe(400);
  });

  it('présente un deck en HTML via ?token= (nouvel onglet) et isole entre utilisateurs', async () => {
    storage.saveDeck({
      id: uuid(), userId, planId: storage.getActivePlanId(userId),
      title: 'Deck de test', markdown: SAMPLE_DECK, createdAt: new Date().toISOString(),
    });
    const list = await request(app).get('/api/decks').set(auth());
    expect(list.body.data).toHaveLength(1);
    const deckId = list.body.data[0].id;

    const html = await request(app).get(`/api/decks/${deckId}/html?token=${token}`);
    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.text).toContain('Aperçu du thème');

    // Sans token → 401 ; autre utilisateur → 404
    expect((await request(app).get(`/api/decks/${deckId}/html`)).status).toBe(401);
    const other = await request(app).post('/api/auth/register').send({
      email: 'decks-other@launchforge.dev', password: 'password123', name: 'Other',
    });
    const foreign = await request(app).get(`/api/decks/${deckId}/html?token=${other.body.data.token}`);
    expect(foreign.status).toBe(404);
  });

  it('aperçu du thème accessible et suppression fonctionnelle', async () => {
    const preview = await request(app).get(`/api/decks/theme-preview?token=${token}`);
    expect(preview.status).toBe(200);
    expect(preview.text).toContain('Call to action');

    const list = await request(app).get('/api/decks').set(auth());
    const del = await request(app).delete(`/api/decks/${list.body.data[0].id}`).set(auth());
    expect(del.status).toBe(200);
  });
});

describe('Thème Marp (Configuration)', () => {
  it('changement de thème validé ; custom refusé sans CSS généré', async () => {
    const ok = await request(app).patch('/api/config/marp-theme').set(auth()).send({ theme: 'bold-gradient' });
    expect(ok.status).toBe(200);

    const unknown = await request(app).patch('/api/config/marp-theme').set(auth()).send({ theme: 'comic-sans' });
    expect(unknown.status).toBe(400);

    const customWithoutCss = await request(app).patch('/api/config/marp-theme').set(auth()).send({ theme: 'custom' });
    expect(customWithoutCss.status).toBe(400);
  });
});

describe('Visuels de posts', () => {
  it('génération : 503 sans clé IA ; upload : 400 sans image', async () => {
    const gen = await request(app).post('/api/content/image').set(auth()).send({ brief: 'un visuel' });
    expect(gen.status).toBe(503);

    const up = await request(app).post('/api/content/image/upload').set(auth()).send({});
    expect(up.status).toBe(400);
  });
});
