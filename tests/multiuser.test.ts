/**
 * Multi-utilisateur : chaque compte a son espace étanche (plans, posts,
 * feedbacks, overview), sa propre identité Composio et son propre bot
 * Telegram. Tout fonctionne comme avant — mais à N utilisateurs.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine, getDb } from '../src/db';
import { storage } from '../src/services/storage';
import { composioUserIdFor } from '../src/services/composioConnect';
import app from '../src/app';

let tokenA: string;
let tokenB: string;
let userAId: string;
let userBId: string;
let planAId: string;

const planPayload = {
  productName: 'IsolApp',
  description: 'Application de test pour l\'isolation entre utilisateurs',
  targetAudience: 'Testeurs',
  niche: 'saas',
  goals: ['isolation'],
  pricing: 'gratuit',
};

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY;

  const a = await request(app).post('/api/auth/register').send({
    email: 'multi-a@launchforge.dev', password: 'password123', name: 'User A',
  });
  tokenA = a.body.data.token;
  userAId = a.body.data.user.id;

  const b = await request(app).post('/api/auth/register').send({
    email: 'multi-b@launchforge.dev', password: 'password123', name: 'User B',
  });
  tokenB = b.body.data.token;
  userBId = b.body.data.user.id;

  const plan = await request(app)
    .post('/api/plan')
    .set('Authorization', `Bearer ${tokenA}`)
    .send(planPayload);
  planAId = plan.body.data.id;
});

const authA = () => ({ Authorization: `Bearer ${tokenA}` });
const authB = () => ({ Authorization: `Bearer ${tokenB}` });

describe('Isolation entre utilisateurs', () => {
  it('B ne peut pas lire le plan de A (404, existence non révélée)', async () => {
    const res = await request(app).get(`/api/plan/${planAId}`).set(authB());
    expect(res.status).toBe(404);
  });

  it('B ne peut pas lire les feedbacks du plan de A, ni en poster', async () => {
    const get = await request(app).get(`/api/feedback/${planAId}`).set(authB());
    expect(get.status).toBe(404);

    const post = await request(app)
      .post('/api/feedback')
      .set(authB())
      .send({ planId: planAId, rating: 5 });
    expect(post.status).toBe(404);

    // Le propriétaire, lui, peut noter et relire
    const ownPost = await request(app)
      .post('/api/feedback')
      .set(authA())
      .send({ planId: planAId, rating: 4, comment: 'Solide' });
    expect(ownPost.status).toBe(201);
    const ownGet = await request(app).get(`/api/feedback/${planAId}`).set(authA());
    expect(ownGet.status).toBe(200);
    expect(ownGet.body.data).toHaveLength(1);
  });

  it('les feedbacks exigent une authentification', async () => {
    const res = await request(app).get(`/api/feedback/${planAId}`);
    expect(res.status).toBe(401);
  });

  it('l\'overview de B est vide, celui de A contient son projet', async () => {
    const a = await request(app).get('/api/overview').set(authA());
    expect(a.body.data.project.id).toBe(planAId);

    const b = await request(app).get('/api/overview').set(authB());
    expect(b.body.data.project).toBeNull();
    expect(b.body.data.projects).toHaveLength(0);
  });

  it('chaque utilisateur ne voit que ses posts', async () => {
    await request(app).post('/api/posts').set(authA())
      .send({ platform: 'linkedin', title: 'Post de A' });
    const b = await request(app).get('/api/posts').set(authB());
    expect(b.body.data.find((p: any) => p.title === 'Post de A')).toBeUndefined();
  });
});

describe('Identité Composio par utilisateur', () => {
  it('les nouveaux comptes reçoivent une entité dédiée lf-<id>', () => {
    expect(storage.getComposioUserId(userAId)).toBe(`lf-${userAId}`);
    expect(storage.getComposioUserId(userBId)).toBe(`lf-${userBId}`);
    expect(composioUserIdFor(userAId)).toBe(`lf-${userAId}`);
  });

  it('les comptes d\'avant le multi-utilisateur retombent sur le user_id de l\'env', () => {
    // Simule un compte legacy : colonne composioUserId vidée
    getDb().prepare(`UPDATE users SET composioUserId = NULL WHERE id = ?`).run(userBId);
    process.env.COMPOSIO_MCP_URL = 'https://backend.composio.dev/v3/mcp/abc/mcp?user_id=legacy-user';
    expect(composioUserIdFor(userBId)).toBe('legacy-user');
    delete process.env.COMPOSIO_MCP_URL;
    expect(composioUserIdFor(userBId)).toBeNull();
    // Restaure l'entité dédiée
    storage.setComposioUserId(userBId, `lf-${userBId}`);
  });
});

describe('Publication avec média', () => {
  it('Instagram sans image → refus immédiat explicite, sans appel modèle', async () => {
    const { publishViaComposio } = await import('../src/services/composio');
    const result = await publishViaComposio(userAId, 'instagram', 'Un super post texte');
    expect(result).toMatch(/^ECHEC:/);
    expect(result).toContain('image');
  });

  it('TikTok et YouTube sans média → même garde-fou', async () => {
    const { publishViaComposio } = await import('../src/services/composio');
    expect(await publishViaComposio(userAId, 'tiktok', 'texte')).toMatch(/^ECHEC:.*vidéo/);
    expect(await publishViaComposio(userAId, 'youtube', 'texte')).toMatch(/^ECHEC:.*vidéo/);
  });
});

describe('Extraction de la référence du post publié', () => {
  it('extrait URL ou identifiant depuis la réponse de publication', async () => {
    const { extractPublishedRef } = await import('../src/services/composio');
    expect(extractPublishedRef('OK: publié — https://x.com/u/status/123456789.')).toBe('https://x.com/u/status/123456789');
    expect(extractPublishedRef('OK: post créé (id: urn:li:share:7654321098)')).toBe('urn:li:share:7654321098');
    expect(extractPublishedRef('OK: publié sans référence')).toBeNull();
    expect(extractPublishedRef('ECHEC: rien — https://x.com/doc')).toBeNull();
  });
});

describe('Bot Telegram personnel', () => {
  it('rejette un token au format invalide', async () => {
    const res = await request(app)
      .patch('/api/config/telegram-bot')
      .set(authA())
      .send({ token: 'pas-un-token' });
    expect(res.status).toBe(400);
  });

  it('le token est stocké chiffré et jamais renvoyé par l\'API', async () => {
    // Stockage direct (le PATCH vérifie le token auprès de Telegram — pas de réseau en test)
    storage.setTelegramBot(userAId, '123456789:AAE-fake-token-for-tests-0123456789', '@TestBot');
    const row = getDb().prepare(`SELECT telegramBotToken FROM users WHERE id = ?`).get(userAId) as any;
    expect(row.telegramBotToken).toMatch(/^enc:v1:/);
    expect(row.telegramBotToken).not.toContain('fake-token');

    const status = await request(app).get('/api/config/status').set(authA());
    expect(status.body.data.telegram.ownBot).toBe(true);
    expect(status.body.data.telegram.botUsername).toBe('@TestBot');
    expect(JSON.stringify(status.body)).not.toContain('fake-token');

    // B n'a pas de bot : son statut à lui reste vierge
    const statusB = await request(app).get('/api/config/status').set(authB());
    expect(statusB.body.data.telegram.ownBot).toBe(false);
  });

  it('DELETE supprime le bot personnel', async () => {
    const res = await request(app).delete('/api/config/telegram-bot').set(authA());
    expect(res.status).toBe(200);
    expect(storage.getTelegramBot(userAId)).toBeNull();
  });
});
