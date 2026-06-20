/**
 * Profil (RGPD art. 16 — rectification) : mise à jour du nom, de l'email et du
 * mot de passe via PATCH /api/auth/me. Vérifie les garde-fous (mot de passe
 * actuel pour les changements sensibles, unicité et format de l'email), la
 * réémission du jeton au changement d'email, et l'authentification requise.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import app from '../src/app';

let token: string;
let userId: string;

beforeAll(async () => {
  await initEngine();

  const res = await request(app).post('/api/auth/register').send({
    email: 'profil@launchforge.dev', password: 'password123', name: 'Profil Initial',
  });
  token = res.body.data.token;
  userId = res.body.data.user.id;

  // Un témoin, pour le test d'unicité d'email
  await request(app).post('/api/auth/register').send({
    email: 'profil-temoin@launchforge.dev', password: 'password123', name: 'Témoin',
  });
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('PATCH /api/auth/me — rectification', () => {
  it('expose hasPassword=true pour un compte local', async () => {
    const me = await request(app).get('/api/auth/me').set(auth());
    expect(me.body.data.hasPassword).toBe(true);
    // Le hash du mot de passe ne fuit jamais
    expect(JSON.stringify(me.body)).not.toContain('password123');
  });

  it('exige une authentification', async () => {
    expect((await request(app).patch('/api/auth/me').send({ name: 'X' })).status).toBe(401);
  });

  it('met à jour le nom librement', async () => {
    const res = await request(app).patch('/api/auth/me').set(auth()).send({ name: 'Nom Modifié' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.name).toBe('Nom Modifié');
    expect(storage.getUserById(userId)!.name).toBe('Nom Modifié');
    // Pas de changement d'email → pas de nouveau jeton
    expect(res.body.data.token).toBeUndefined();
  });

  it('refuse un email mal formé', async () => {
    const res = await request(app).patch('/api/auth/me').set(auth())
      .send({ email: 'pas-un-email', currentPassword: 'password123' });
    expect(res.status).toBe(400);
  });

  it('refuse un email déjà utilisé par un autre compte', async () => {
    const res = await request(app).patch('/api/auth/me').set(auth())
      .send({ email: 'profil-temoin@launchforge.dev', currentPassword: 'password123' });
    expect(res.status).toBe(409);
  });

  it('exige le mot de passe actuel pour changer d\'email', async () => {
    expect((await request(app).patch('/api/auth/me').set(auth())
      .send({ email: 'profil-v2@launchforge.dev' })).status).toBe(401);
    expect((await request(app).patch('/api/auth/me').set(auth())
      .send({ email: 'profil-v2@launchforge.dev', currentPassword: 'mauvais' })).status).toBe(401);
    // Rien n'a changé
    expect(storage.getUserById(userId)!.email).toBe('profil@launchforge.dev');
  });

  it('change l\'email avec le bon mot de passe et réémet un jeton', async () => {
    const res = await request(app).patch('/api/auth/me').set(auth())
      .send({ email: 'Profil-V2@launchforge.dev', currentPassword: 'password123' });
    expect(res.status).toBe(200);
    // Email normalisé en minuscules
    expect(res.body.data.user.email).toBe('profil-v2@launchforge.dev');
    expect(typeof res.body.data.token).toBe('string');
    // La connexion fonctionne avec le nouvel email, plus avec l'ancien
    expect((await request(app).post('/api/auth/login')
      .send({ email: 'profil-v2@launchforge.dev', password: 'password123' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login')
      .send({ email: 'profil@launchforge.dev', password: 'password123' })).status).toBe(401);
    token = res.body.data.token; // suite des tests avec le jeton à jour
  });

  it('change le mot de passe (ancien requis, nouveau ≥ 6 caractères)', async () => {
    expect((await request(app).patch('/api/auth/me').set(auth())
      .send({ newPassword: '12345' })).status).toBe(400); // trop court
    expect((await request(app).patch('/api/auth/me').set(auth())
      .send({ newPassword: 'nouveau-mdp', currentPassword: 'mauvais' })).status).toBe(401);

    const ok = await request(app).patch('/api/auth/me').set(auth())
      .send({ newPassword: 'nouveau-mdp', currentPassword: 'password123' });
    expect(ok.status).toBe(200);

    // Le nouveau mot de passe fonctionne, l'ancien non
    expect((await request(app).post('/api/auth/login')
      .send({ email: 'profil-v2@launchforge.dev', password: 'nouveau-mdp' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login')
      .send({ email: 'profil-v2@launchforge.dev', password: 'password123' })).status).toBe(401);
  });
});
