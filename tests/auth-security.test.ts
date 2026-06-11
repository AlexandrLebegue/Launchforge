/**
 * Sécurité de l'authentification : réinitialisation de mot de passe
 * (jeton haché, expirant, usage unique, réponse anti-énumération) et
 * rate limiting anti force brute.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createHash, randomBytes } from 'crypto';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import app from '../src/app';

const EMAIL = 'reset@launchforge.dev';
let userId: string;

beforeAll(async () => {
  await initEngine();
  // Aucun appel externe pendant les tests : l'email de reset bascule sur le log serveur
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.COMPOSIO_MCP_URL;
  delete process.env.COMPOSIO_API_KEY;
  const res = await request(app).post('/api/auth/register').send({
    email: EMAIL, password: 'password123', name: 'Reset Tester',
  });
  userId = res.body.data.user.id;
});

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('Mot de passe oublié', () => {
  it('réponse générique, que le compte existe ou non (anti-énumération)', async () => {
    const known = await request(app).post('/api/auth/forgot-password').send({ email: EMAIL });
    const unknown = await request(app).post('/api/auth/forgot-password').send({ email: 'personne@nulle-part.dev' });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body.data.message).toBe(unknown.body.data.message);
  });

  it('le jeton est stocké haché, expire à 30 min, et change le mot de passe (usage unique)', async () => {
    // Jeton posé directement (le vrai n'est jamais renvoyé par l'API)
    const token = randomBytes(32).toString('hex');
    storage.setResetToken(userId, sha256(token), new Date(Date.now() + 30 * 60_000).toISOString());

    const reset = await request(app).post('/api/auth/reset-password')
      .send({ token, password: 'nouveau-mdp-456' });
    expect(reset.status).toBe(200);
    expect(reset.body.data.token).toBeTruthy(); // connexion directe après reset

    // Ancien mot de passe refusé, nouveau accepté
    expect((await request(app).post('/api/auth/login').send({ email: EMAIL, password: 'password123' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: EMAIL, password: 'nouveau-mdp-456' })).status).toBe(200);

    // Usage unique : le même jeton ne marche plus
    const again = await request(app).post('/api/auth/reset-password')
      .send({ token, password: 'encore-un-autre-789' });
    expect(again.status).toBe(400);
  });

  it('refuse un jeton expiré ou inconnu, et un mot de passe trop court', async () => {
    const expired = randomBytes(32).toString('hex');
    storage.setResetToken(userId, sha256(expired), new Date(Date.now() - 60_000).toISOString());
    expect((await request(app).post('/api/auth/reset-password')
      .send({ token: expired, password: 'valide-123' })).status).toBe(400);

    expect((await request(app).post('/api/auth/reset-password')
      .send({ token: 'jeton-bidon', password: 'valide-123' })).status).toBe(400);

    const ok = randomBytes(32).toString('hex');
    storage.setResetToken(userId, sha256(ok), new Date(Date.now() + 60_000).toISOString());
    expect((await request(app).post('/api/auth/reset-password')
      .send({ token: ok, password: 'court' })).status).toBe(400);
  });
});

describe('Rate limiting anti force brute', () => {
  it('bloque après 10 tentatives de connexion sur le même compte, sans toucher les autres', async () => {
    const target = 'bruteforce@launchforge.dev';
    await request(app).post('/api/auth/register').send({ email: target, password: 'password123' });

    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await request(app).post('/api/auth/login').send({ email: target, password: 'mauvais-mdp' });
      last = res.status;
      if (i < 10) expect(res.status).toBe(401);
    }
    expect(last).toBe(429);

    // La limite est par IP+email : un autre compte n'est pas affecté
    const other = await request(app).post('/api/auth/login').send({ email: EMAIL, password: 'nouveau-mdp-456' });
    expect(other.status).toBe(200);
  });

  it('limite aussi les demandes de réinitialisation (5 / 15 min)', async () => {
    const email = 'flood@launchforge.dev';
    let last = 0;
    for (let i = 0; i < 6; i++) {
      const res = await request(app).post('/api/auth/forgot-password').send({ email });
      last = res.status;
      if (i < 5) expect(res.status).toBe(200);
    }
    expect(last).toBe(429);
  });
});
