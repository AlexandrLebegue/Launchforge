/**
 * Rendu GIF/MP4 des decks + stockage médias : parsing des slides, SVG,
 * GIF animé hors-ligne, purge à 90 jours, validations de la route.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import { parseSlides, svgForSlide, renderDeckGif } from '../src/services/deckMedia';
import { saveMediaFile, cleanupOldMedia, uploadsDir } from '../src/services/mediaStore';
import { SAMPLE_DECK } from '../src/services/decks';
import app from '../src/app';
import { v4 as uuid } from 'uuid';

let token: string;
let userId: string;

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY;
  process.env.UPLOADS_DIR = fs.mkdtempSync(path.join('/tmp', 'lf-uploads-'));
  const res = await request(app).post('/api/auth/register').send({
    email: 'media@launchforge.dev', password: 'password123', name: 'Media Tester',
  });
  token = res.body.data.token;
  userId = res.body.data.user.id;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('Parsing et SVG des slides', () => {
  it('parse le deck d\'exemple (lead, puces, citation)', () => {
    const slides = parseSlides(SAMPLE_DECK);
    expect(slides).toHaveLength(3);
    expect(slides[0].lead).toBe(true);
    expect(slides[0].title).toBe('Aperçu du thème');
    expect(slides[1].bullets).toHaveLength(3);
    expect(slides[1].quote).toContain('citation');
  });

  it('produit un SVG valide avec la palette du thème', () => {
    const svg = svgForSlide(parseSlides(SAMPLE_DECK)[1], 'launchforge', 320);
    expect(svg).toContain('<svg');
    expect(svg).toContain('#7c5cfc');
    expect(svg).toContain('Des puces courtes et percutantes');
  });
});

describe('Rendu GIF', () => {
  it('assemble un GIF animé avec fondus (hors-ligne)', async () => {
    const gif = await renderDeckGif(SAMPLE_DECK, 'launchforge', 160);
    expect(gif.subarray(0, 6).toString()).toBe('GIF89a');
    expect(gif.length).toBeGreaterThan(10_000);
  }, 30000);
});

describe('Stockage des médias (purge 90 jours)', () => {
  it('écrit puis purge les fichiers anciens, garde les récents', () => {
    const recent = saveMediaFile(Buffer.from('recent'), 'gif');
    const old = saveMediaFile(Buffer.from('vieux'), 'gif');
    // Vieillit artificiellement le second fichier (100 jours)
    const oldPath = path.join(uploadsDir(), old.fileName);
    const past = new Date(Date.now() - 100 * 86400_000);
    fs.utimesSync(oldPath, past, past);

    const removed = cleanupOldMedia(90);
    expect(removed).toBe(1);
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(path.join(uploadsDir(), recent.fileName))).toBe(true);
  });
});

describe('Route de rendu', () => {
  it('rend un deck en GIF, le stocke et le sert sur /uploads', async () => {
    storage.saveDeck({
      id: uuid(), userId, planId: storage.getActivePlanId(userId),
      title: 'Deck média', markdown: SAMPLE_DECK, createdAt: new Date().toISOString(),
    });
    const list = await request(app).get('/api/decks').set(auth());
    const deckId = list.body.data[0].id;

    const bad = await request(app).post(`/api/decks/${deckId}/render`).set(auth()).send({ format: 'avi' });
    expect(bad.status).toBe(400);

    const res = await request(app).post(`/api/decks/${deckId}/render`).set(auth()).send({ format: 'gif' });
    expect(res.status).toBe(200);
    expect(res.body.data.url).toMatch(/^\/uploads\/.+\.gif$/);

    const served = await request(app).get(res.body.data.url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/gif');
  }, 60000);

  it('404 pour le deck d\'un autre utilisateur', async () => {
    const list = await request(app).get('/api/decks').set(auth());
    const other = await request(app).post('/api/auth/register').send({
      email: 'media-other@launchforge.dev', password: 'password123', name: 'Other',
    });
    const res = await request(app)
      .post(`/api/decks/${list.body.data[0].id}/render`)
      .set({ Authorization: `Bearer ${other.body.data.token}` })
      .send({ format: 'gif' });
    expect(res.status).toBe(404);
  });
});
