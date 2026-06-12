/**
 * RGPD : export de toutes les données (art. 20) et effacement complet du
 * compte (art. 17) — re-authentification, transaction sur toutes les tables,
 * suppression des médias locaux, étanchéité entre utilisateurs.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import { saveMediaFile, uploadsDir } from '../src/services/mediaStore';
import app from '../src/app';

let token: string;
let userId: string;
let otherToken: string;
let mediaFileName: string;

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.COMPOSIO_API_KEY;

  const res = await request(app).post('/api/auth/register').send({
    email: 'rgpd@launchforge.dev', password: 'password123', name: 'RGPD Tester',
  });
  token = res.body.data.token;
  userId = res.body.data.user.id;

  const other = await request(app).post('/api/auth/register').send({
    email: 'rgpd-temoin@launchforge.dev', password: 'password123', name: 'Témoin',
  });
  otherToken = other.body.data.token;

  // Un échantillon de données dans chaque table principale
  await request(app).post('/api/plan').set(auth()).send({
    productName: 'RGPDApp', description: 'App de test de conformité',
    targetAudience: 'DPO', niche: 'saas', goals: ['conformité'], pricing: 'gratuit', mode: 'template',
  });
  const media = saveMediaFile(Buffer.alloc(2048, 1), 'mp4');
  mediaFileName = media.fileName;
  const post = await request(app).post('/api/posts').set(auth()).send({
    platform: 'linkedin', title: 'Post à effacer', content: 'Contenu', status: 'published', imageUrl: media.url,
  });
  storage.recordMetricSnapshot(storage.getPostById(post.body.data.id)!);
  await request(app).post('/api/knowledge').set(auth()).send({
    category: 'audience', title: 'Cible', content: 'Des DPO exigeants',
  });
  await request(app).post('/api/contacts').set(auth()).send({
    name: 'Contact RGPD', email: 'contact@exemple.fr', source: 'test',
  });
  storage.saveTelegramLink({ chatId: 'rgpd-chat', userId, createdAt: new Date().toISOString() });
  storage.saveReminder({ id: 'rgpd-rem', userId, text: 'Rappel', dueAt: new Date().toISOString(), sent: 0, createdAt: new Date().toISOString() });

  // Données du témoin (ne doivent JAMAIS être touchées)
  await request(app).post('/api/posts').set({ Authorization: `Bearer ${otherToken}` }).send({
    platform: 'twitter', title: 'Post du témoin',
  });
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('Export des données (portabilité)', () => {
  it('renvoie toutes les sections en JSON téléchargeable', async () => {
    const res = await request(app).get('/api/auth/export').set(auth());
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('launchforge-mes-donnees.json');
    expect(res.body.user.email).toBe('rgpd@launchforge.dev');
    expect(res.body.plans).toHaveLength(1);
    expect(res.body.posts.length).toBeGreaterThanOrEqual(1);
    // La création du plan amorce des fiches : la nôtre + celles du bootstrap
    expect(res.body.knowledge.length).toBeGreaterThanOrEqual(1);
    expect(res.body.knowledge.some((k: { title: string }) => k.title === 'Cible')).toBe(true);
    expect(res.body.contacts).toHaveLength(1);
    expect(res.body.telegramLinks).toHaveLength(1);
    expect(res.body.reminders).toHaveLength(1);
    expect(res.body.metricHistory.length).toBeGreaterThanOrEqual(1);
    // Jamais de secrets dans l'export
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('exige une authentification', async () => {
    expect((await request(app).get('/api/auth/export')).status).toBe(401);
  });
});

describe('Suppression du compte (effacement)', () => {
  it('exige le bon mot de passe', async () => {
    expect((await request(app).delete('/api/auth/account').set(auth()).send({})).status).toBe(400);
    expect((await request(app).delete('/api/auth/account').set(auth())
      .send({ password: 'mauvais-mdp' })).status).toBe(401);
    // Rien n'a été supprimé
    expect(storage.getUserById(userId)).toBeDefined();
  });

  it('efface tout : compte, données, médias — sans toucher aux autres utilisateurs', async () => {
    expect(fs.existsSync(path.join(uploadsDir(), mediaFileName))).toBe(true);

    const res = await request(app).delete('/api/auth/account').set(auth())
      .send({ password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);

    // Compte et session morts
    expect(storage.getUserById(userId)).toBeUndefined();
    expect((await request(app).get('/api/auth/me').set(auth())).status).toBe(404);

    // Plus une seule ligne dans aucune table
    expect(storage.getPostsByUserId(userId)).toHaveLength(0);
    expect(storage.getKnowledgeByPlan(userId, null)).toHaveLength(0);
    expect(storage.getContactsByPlan(userId, null)).toHaveLength(0);
    expect(storage.getTelegramLinksByUserId(userId)).toHaveLength(0);
    expect(storage.getPendingRemindersByUserId(userId)).toHaveLength(0);
    expect(storage.getMetricSnapshots(userId, null)).toHaveLength(0);

    // Média local supprimé du disque
    expect(fs.existsSync(path.join(uploadsDir(), mediaFileName))).toBe(false);

    // Le témoin est intact
    const witness = await request(app).get('/api/posts').set({ Authorization: `Bearer ${otherToken}` });
    expect(witness.body.data).toHaveLength(1);
    expect(witness.body.data[0].title).toBe('Post du témoin');
  });
});
