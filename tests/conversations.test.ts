/**
 * Historisation des conversations avec l'assistant : persistance (storage),
 * routes REST (liste/lecture/suppression + étanchéité entre utilisateurs) et
 * purge automatique après un mois d'inactivité.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine, getDb } from '../src/db';
import { storage } from '../src/services/storage';
import { purgeOldConversations, RETENTION_DAYS } from '../src/services/conversationCleanup';
import app from '../src/app';

let token: string;
let userId: string;
let otherToken: string;
let otherUserId: string;

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  await initEngine();
  const res = await request(app).post('/api/auth/register').send({
    email: 'convo@launchforge.dev', password: 'password123', name: 'Convo Tester',
  });
  token = res.body.data.token;
  userId = res.body.data.user.id;

  const other = await request(app).post('/api/auth/register').send({
    email: 'convo-temoin@launchforge.dev', password: 'password123', name: 'Témoin',
  });
  otherToken = other.body.data.token;
  otherUserId = other.body.data.user.id;
});

describe('Persistance (storage)', () => {
  it('upsert crée puis met à jour le même fil (titre dérivé du 1er message user)', () => {
    storage.upsertConversation({
      id: 'conv-1', userId, planId: null,
      messages: [
        { role: 'user', text: 'Bonjour, rédige un post LinkedIn' },
        { role: 'assistant', text: 'Voici une proposition…', actions: ['🔍 recherche'] },
      ],
    });
    let convo = storage.getConversation('conv-1', userId);
    expect(convo).toBeDefined();
    expect(convo!.title).toBe('Bonjour, rédige un post LinkedIn');
    expect(convo!.messages).toHaveLength(2);
    expect(convo!.messages[1].actions).toEqual(['🔍 recherche']);

    // Mise à jour : même id, messages enrichis — pas de doublon
    storage.upsertConversation({
      id: 'conv-1', userId, planId: null,
      messages: [
        ...convo!.messages,
        { role: 'user', text: 'Parfait' },
        { role: 'assistant', text: 'Je publie ?' },
      ],
    });
    convo = storage.getConversation('conv-1', userId);
    expect(convo!.messages).toHaveLength(4);
    expect(storage.listConversations(userId)).toHaveLength(1);
  });

  it('listConversations renvoie un résumé (aperçu + nombre de messages)', () => {
    const list = storage.listConversations(userId);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('conv-1');
    expect(list[0].messageCount).toBe(4);
    expect(list[0].preview).toContain('Je publie');
  });

  it('isole les fils par utilisateur', () => {
    expect(storage.getConversation('conv-1', otherUserId)).toBeUndefined();
    expect(storage.listConversations(otherUserId)).toHaveLength(0);
    expect(storage.deleteConversation('conv-1', otherUserId)).toBe(false);
  });
});

describe('Routes REST', () => {
  it('GET /conversations liste les fils de l\'utilisateur', async () => {
    const res = await request(app).get('/api/assistant/conversations').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe('conv-1');
  });

  it('GET /conversations/:id renvoie le fil complet', async () => {
    const res = await request(app).get('/api/assistant/conversations/conv-1').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.messages).toHaveLength(4);
  });

  it('404 sur le fil d\'un autre utilisateur', async () => {
    const res = await request(app).get('/api/assistant/conversations/conv-1').set(auth(otherToken));
    expect(res.status).toBe(404);
  });

  it('exige une authentification', async () => {
    expect((await request(app).get('/api/assistant/conversations')).status).toBe(401);
  });

  it('DELETE /conversations/:id supprime le fil', async () => {
    const res = await request(app).delete('/api/assistant/conversations/conv-1').set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);
    expect(storage.getConversation('conv-1', userId)).toBeUndefined();
    // Déjà supprimé → 404
    expect((await request(app).delete('/api/assistant/conversations/conv-1').set(auth(token))).status).toBe(404);
  });
});

describe('Purge automatique (rétention 1 mois)', () => {
  it('supprime les fils inactifs depuis plus d\'un mois, garde les récents', () => {
    storage.upsertConversation({ id: 'conv-old',    userId, planId: null, messages: [{ role: 'user', text: 'ancien' }] });
    storage.upsertConversation({ id: 'conv-recent', userId, planId: null, messages: [{ role: 'user', text: 'récent' }] });

    // Vieillit artificiellement le 1er fil au-delà de la fenêtre de rétention
    const old = new Date(Date.now() - (RETENTION_DAYS + 2) * 24 * 3600_000).toISOString();
    getDb().prepare(`UPDATE conversations SET updatedAt = ? WHERE id = 'conv-old'`).run(old);

    const removed = purgeOldConversations();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(storage.getConversation('conv-old', userId)).toBeUndefined();
    expect(storage.getConversation('conv-recent', userId)).toBeDefined();
  });
});

describe('RGPD', () => {
  it('inclut les conversations dans l\'export et les efface avec le compte', () => {
    storage.upsertConversation({ id: 'conv-rgpd', userId, planId: null, messages: [{ role: 'user', text: 'export-moi' }] });
    const data = storage.exportUserData(userId) as { conversations: unknown[] };
    expect(Array.isArray(data.conversations)).toBe(true);
    expect(data.conversations.length).toBeGreaterThanOrEqual(1);

    storage.deleteUserData(userId);
    expect(storage.listConversations(userId)).toHaveLength(0);
  });
});
