/**
 * Équipes (Phase 1) — création, invitations par code, jointure, rôles et
 * contrôle d'accès. Aucun appel réseau : tout passe par l'API Express + SQLite.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import app from '../src/app';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function register(email: string): Promise<{ token: string; id: string }> {
  const r = await request(app).post('/api/auth/register').send({ email, password: 'password123', name: email.split('@')[0] });
  return { token: r.body.data.token, id: r.body.data.user.id };
}

let owner: { token: string; id: string };
let member: { token: string; id: string };
let outsider: { token: string; id: string };
let teamId: string;

beforeAll(async () => {
  await initEngine();
  owner    = await register('team-owner@launchforge.dev');
  member   = await register('team-member@launchforge.dev');
  outsider = await register('team-outsider@launchforge.dev');
});

describe('Équipes — création & appartenance', () => {
  it('crée une équipe et inscrit le créateur comme propriétaire', async () => {
    const res = await request(app).post('/api/teams').set(auth(owner.token)).send({ name: 'Studio NeoPot' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Studio NeoPot');
    teamId = res.body.data.id;

    const list = await request(app).get('/api/teams').set(auth(owner.token));
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ id: teamId, role: 'owner', memberCount: 1 });
  });

  it('refuse un nom vide', async () => {
    const res = await request(app).post('/api/teams').set(auth(owner.token)).send({ name: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('Équipes — invitations & jointure', () => {
  let code: string;

  it('le propriétaire génère un lien d\'invitation (éditeur)', async () => {
    const res = await request(app).post(`/api/teams/${teamId}/invites`).set(auth(owner.token)).send({ role: 'editor' });
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('editor');
    expect(typeof res.body.data.code).toBe('string');
    code = res.body.data.code;
  });

  it('régénérer un lien du même rôle renvoie le MÊME (anti-accumulation)', async () => {
    const again = await request(app).post(`/api/teams/${teamId}/invites`).set(auth(owner.token)).send({ role: 'editor', expiresInDays: 7 });
    expect(again.body.data.code).toBe(code);
  });

  it('un non-propriétaire ne peut pas inviter', async () => {
    const res = await request(app).post(`/api/teams/${teamId}/invites`).set(auth(member.token)).send({ role: 'editor' });
    expect(res.status).toBe(403);
  });

  it('refuse un rôle d\'invitation invalide (pas de owner via invite)', async () => {
    const res = await request(app).post(`/api/teams/${teamId}/invites`).set(auth(owner.token)).send({ role: 'owner' });
    expect(res.status).toBe(400);
  });

  it('rejoindre avec un code invalide → 404', async () => {
    const res = await request(app).post('/api/teams/join').set(auth(member.token)).send({ code: 'nope-xxxx' });
    expect(res.status).toBe(404);
  });

  it('un autre utilisateur rejoint via le code (devient éditeur)', async () => {
    const res = await request(app).post('/api/teams/join').set(auth(member.token)).send({ code });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ role: 'editor', alreadyMember: false });

    const list = await request(app).get('/api/teams').set(auth(member.token));
    expect(list.body.data.map((t: any) => t.id)).toContain(teamId);
  });

  it('rejoindre une seconde fois est idempotent (alreadyMember)', async () => {
    const res = await request(app).post('/api/teams/join').set(auth(member.token)).send({ code });
    expect(res.status).toBe(200);
    expect(res.body.data.alreadyMember).toBe(true);
  });
});

describe('Équipes — détail & contrôle d\'accès', () => {
  it('le propriétaire voit les membres ET les invitations', async () => {
    const res = await request(app).get(`/api/teams/${teamId}`).set(auth(owner.token));
    expect(res.status).toBe(200);
    expect(res.body.data.members.length).toBe(2);
    expect(res.body.data.invites.length).toBeGreaterThanOrEqual(1);
  });

  it('un membre voit les membres mais pas les invitations', async () => {
    const res = await request(app).get(`/api/teams/${teamId}`).set(auth(member.token));
    expect(res.status).toBe(200);
    expect(res.body.data.members.length).toBe(2);
    expect(res.body.data.invites).toHaveLength(0);
  });

  it('un non-membre ne peut pas voir l\'équipe (403)', async () => {
    const res = await request(app).get(`/api/teams/${teamId}`).set(auth(outsider.token));
    expect(res.status).toBe(403);
  });
});

describe('Équipes — rôles & retrait', () => {
  it('le propriétaire change le rôle d\'un membre', async () => {
    const res = await request(app).patch(`/api/teams/${teamId}/members/${member.id}`).set(auth(owner.token)).send({ role: 'viewer' });
    expect(res.status).toBe(200);
    const detail = await request(app).get(`/api/teams/${teamId}`).set(auth(owner.token));
    expect(detail.body.data.members.find((m: any) => m.userId === member.id).role).toBe('viewer');
  });

  it('le rôle du propriétaire ne peut pas être changé', async () => {
    const res = await request(app).patch(`/api/teams/${teamId}/members/${owner.id}`).set(auth(owner.token)).send({ role: 'viewer' });
    expect(res.status).toBe(400);
  });

  it('le propriétaire ne peut pas être retiré', async () => {
    const res = await request(app).delete(`/api/teams/${teamId}/members/${owner.id}`).set(auth(owner.token));
    expect(res.status).toBe(400);
  });

  it('un membre peut quitter l\'équipe lui-même', async () => {
    const res = await request(app).delete(`/api/teams/${teamId}/members/${member.id}`).set(auth(member.token));
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/teams').set(auth(member.token));
    expect(list.body.data.map((t: any) => t.id)).not.toContain(teamId);
  });

  it('le propriétaire supprime l\'équipe', async () => {
    const res = await request(app).delete(`/api/teams/${teamId}`).set(auth(owner.token));
    expect(res.status).toBe(200);
    const list = await request(app).get('/api/teams').set(auth(owner.token));
    expect(list.body.data).toHaveLength(0);
  });
});

describe('Équipes — partage de projet (Phase 2)', () => {
  let teamId2: string;
  let projectId: string;
  let ownerPostId: string;

  it('le propriétaire crée un projet et un post', async () => {
    const plan = await request(app).post('/api/plan').set(auth(owner.token)).send({
      productName: 'Marque Commune', description: 'Projet partagé', targetAudience: 'tous', niche: 'saas', goals: ['lancer'], pricing: 'gratuit',
    });
    expect(plan.status).toBe(201);
    projectId = plan.body.data.id;
    const post = await request(app).post('/api/posts').set(auth(owner.token)).send({ platform: 'linkedin', title: 'Post équipe' });
    ownerPostId = post.body.data.id;
    expect(post.body.data.planId).toBe(projectId);
  });

  it('rattache le projet à une équipe', async () => {
    const t = await request(app).post('/api/teams').set(auth(owner.token)).send({ name: 'Brand Team' });
    teamId2 = t.body.data.id;
    const res = await request(app).post(`/api/plan/${projectId}/team`).set(auth(owner.token)).send({ teamId: teamId2 });
    expect(res.status).toBe(200);
  });

  it('un membre éditeur rejoint et voit le projet + ses posts', async () => {
    const inv = await request(app).post(`/api/teams/${teamId2}/invites`).set(auth(owner.token)).send({ role: 'editor' });
    await request(app).post('/api/teams/join').set(auth(member.token)).send({ code: inv.body.data.code });

    const ov = await request(app).get('/api/overview').set(auth(member.token));
    expect(ov.body.data.projects.map((p: any) => p.id)).toContain(projectId);

    await request(app).post(`/api/plan/${projectId}/activate`).set(auth(member.token));
    const posts = await request(app).get('/api/posts').set(auth(member.token));
    expect(posts.body.data.map((p: any) => p.id)).toContain(ownerPostId);
  });

  it('un éditeur crée un post, visible par le propriétaire', async () => {
    const created = await request(app).post('/api/posts').set(auth(member.token)).send({ platform: 'twitter', title: 'Post du membre' });
    expect(created.status).toBe(201);
    expect(created.body.data.planId).toBe(projectId);

    await request(app).post(`/api/plan/${projectId}/activate`).set(auth(owner.token));
    const ownerPosts = await request(app).get('/api/posts').set(auth(owner.token));
    expect(ownerPosts.body.data.map((p: any) => p.title)).toContain('Post du membre');
  });

  it('un non-membre ne voit pas le projet (404 + absent de l\'overview)', async () => {
    const res = await request(app).get(`/api/plan/${projectId}`).set(auth(outsider.token));
    expect(res.status).toBe(404);
    const ov = await request(app).get('/api/overview').set(auth(outsider.token));
    expect(ov.body.data.projects.map((p: any) => p.id)).not.toContain(projectId);
  });

  it('un Lecteur ne peut pas créer de post (403)', async () => {
    await request(app).patch(`/api/teams/${teamId2}/members/${member.id}`).set(auth(owner.token)).send({ role: 'viewer' });
    await request(app).post(`/api/plan/${projectId}/activate`).set(auth(member.token));
    const res = await request(app).post('/api/posts').set(auth(member.token)).send({ platform: 'linkedin', title: 'interdit' });
    expect(res.status).toBe(403);
  });
});

describe('Équipes — comptes Composio au niveau projet (Phase 3)', () => {
  let teamId3: string;
  let projectId3: string;

  it('le propriétaire gère les comptes de son projet d\'équipe (canManage=true)', async () => {
    const plan = await request(app).post('/api/plan').set(auth(owner.token)).send({
      productName: 'Projet P3', description: 'd', targetAudience: 't', niche: 'saas', goals: ['g'], pricing: 'gratuit',
    });
    projectId3 = plan.body.data.id;
    const t = await request(app).post('/api/teams').set(auth(owner.token)).send({ name: 'Team P3' });
    teamId3 = t.body.data.id;
    await request(app).post(`/api/plan/${projectId3}/team`).set(auth(owner.token)).send({ teamId: teamId3 });

    const st = await request(app).get('/api/config/status').set(auth(owner.token));
    expect(st.body.data.composio.canManage).toBe(true);
  });

  it('un membre voit les comptes du propriétaire en lecture seule (canManage=false)', async () => {
    const inv = await request(app).post(`/api/teams/${teamId3}/invites`).set(auth(owner.token)).send({ role: 'editor' });
    await request(app).post('/api/teams/join').set(auth(member.token)).send({ code: inv.body.data.code });
    await request(app).post(`/api/plan/${projectId3}/activate`).set(auth(member.token));

    const st = await request(app).get('/api/config/status').set(auth(member.token));
    expect(st.body.data.composio.canManage).toBe(false);
    expect(st.body.data.composio.ownerName).toBeTruthy();
  });
});

describe('Équipes — aperçu public d\'invitation (page Rejoindre)', () => {
  it('expose le nom de l\'équipe SANS authentification', async () => {
    const t = await request(app).post('/api/teams').set(auth(owner.token)).send({ name: 'Public Preview Team' });
    const inv = await request(app).post(`/api/teams/${t.body.data.id}/invites`).set(auth(owner.token)).send({ role: 'viewer' });
    const res = await request(app).get(`/api/teams/invite/${inv.body.data.code}`); // pas de header Authorization
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ valid: true, teamName: 'Public Preview Team', role: 'viewer' });
  });

  it('404 sur un code d\'invitation inconnu', async () => {
    const res = await request(app).get('/api/teams/invite/code-inexistant');
    expect(res.status).toBe(404);
  });
});
