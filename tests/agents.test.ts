import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine, getDb } from '../src/db';
import { encryptSecret, decryptSecret } from '../src/services/secrets';
import { storage } from '../src/services/storage';
import app from '../src/app';

let token: string;
let agentId: string;

beforeAll(async () => {
  await initEngine();
  const res = await request(app).post('/api/auth/register').send({
    email: 'agents@launchforge.dev',
    password: 'password123',
    name: 'Agents Tester',
  });
  token = res.body.data.token;
});

describe('Secrets', () => {
  it('encrypts and decrypts round-trip', () => {
    const enc = encryptSecret('my-secret-key');
    expect(enc).toMatch(/^enc:v1:/);
    expect(enc).not.toContain('my-secret-key');
    expect(decryptSecret(enc)).toBe('my-secret-key');
  });

  it('passes legacy plaintext through decryptSecret', () => {
    expect(decryptSecret('legacy-plain-key')).toBe('legacy-plain-key');
  });
});

describe('Agents API key handling', () => {
  it('never returns the API key to the client', async () => {
    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({ platform: 'reddit', apiKey: 'super-secret-reddit-key' });

    expect(res.status).toBe(201);
    expect(res.body.data.apiKey).toBeUndefined();
    expect(res.body.data.hasApiKey).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('super-secret-reddit-key');
    agentId = res.body.data.id;
  });

  it('stores the key encrypted at rest', () => {
    const row = getDb()
      .prepare('SELECT api_key FROM agents WHERE id = ?')
      .get(agentId) as { api_key: string };
    expect(row.api_key).toMatch(/^enc:v1:/);
    expect(row.api_key).not.toContain('super-secret-reddit-key');
  });

  it('keeps the stored key when PATCH sends an empty apiKey', async () => {
    const res = await request(app)
      .patch(`/api/agents/${agentId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed Agent', apiKey: '' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed Agent');
    expect(res.body.data.hasApiKey).toBe(true);

    const row = getDb()
      .prepare('SELECT api_key FROM agents WHERE id = ?')
      .get(agentId) as { api_key: string };
    expect(decryptSecret(row.api_key)).toBe('super-secret-reddit-key');
  });

  it('GET /api/agents omits keys for every agent', async () => {
    const res = await request(app)
      .get('/api/agents')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    for (const agent of res.body.data) {
      expect(agent.apiKey).toBeUndefined();
      expect(typeof agent.hasApiKey).toBe('boolean');
    }
  });
});

describe('Approval pipeline', () => {
  it('defaults new agents to manual approval and accepts auto', async () => {
    const res = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({ platform: 'twitter' });
    expect(res.body.data.approvalMode).toBe('manual');

    const auto = await request(app)
      .post('/api/agents')
      .set('Authorization', `Bearer ${token}`)
      .send({ platform: 'linkedin', approvalMode: 'auto' });
    expect(auto.body.data.approvalMode).toBe('auto');
  });

  it('lists, approves and rejects awaiting runs', async () => {
    const now = new Date().toISOString();
    const mkRun = (id: string) => {
      storage.saveAgentRun({
        id, agentId, planId: 'plan-x', cardId: `card-${id}`, cardTitle: `Tâche ${id}`,
        status: 'running', result: null, startedAt: now, completedAt: null,
      });
      storage.updateRunStatus(id, 'awaiting_approval', 'Brouillon de post Reddit');
    };
    mkRun('run-approve');
    mkRun('run-reject');

    const list = await request(app)
      .get('/api/approvals')
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const ids = list.body.data.map((i: any) => i.id);
    expect(ids).toContain('run-approve');
    expect(ids).toContain('run-reject');
    expect(list.body.data[0].agentName).toBeTruthy();

    // Validation avec contenu édité → publié (done) avec le contenu édité
    const approve = await request(app)
      .post('/api/approvals/run-approve/approve')
      .set('Authorization', `Bearer ${token}`)
      .send({ content: 'Version éditée par l\'utilisateur' });
    expect(approve.status).toBe(200);
    expect(approve.body.data.status).toBe('done');
    expect(approve.body.data.result).toContain('Version éditée par l\'utilisateur');
    expect(approve.body.data.completedAt).toBeTruthy();

    // Rejet → rejected, brouillon conservé dans l'historique
    const reject = await request(app)
      .post('/api/approvals/run-reject/reject')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Ton trop commercial' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe('rejected');
    expect(reject.body.data.result).toContain('Ton trop commercial');
    expect(reject.body.data.result).toContain('Brouillon de post Reddit');

    // Un run déjà traité ne peut plus être validé
    const again = await request(app)
      .post('/api/approvals/run-approve/approve')
      .set('Authorization', `Bearer ${token}`);
    expect(again.status).toBe(400);
  });

  it("refuse l'accès aux runs d'un autre utilisateur", async () => {
    const other = await request(app).post('/api/auth/register').send({
      email: 'other@launchforge.dev', password: 'password123', name: 'Other',
    });
    const otherToken = other.body.data.token;

    storage.saveAgentRun({
      id: 'run-foreign', agentId, planId: 'plan-x', cardId: 'card-f', cardTitle: 'Tâche privée',
      status: 'running', result: null, startedAt: new Date().toISOString(), completedAt: null,
    });
    storage.updateRunStatus('run-foreign', 'awaiting_approval', 'Contenu privé');

    const list = await request(app)
      .get('/api/approvals')
      .set('Authorization', `Bearer ${otherToken}`);
    expect(list.body.data).toHaveLength(0);

    const approve = await request(app)
      .post('/api/approvals/run-foreign/approve')
      .set('Authorization', `Bearer ${otherToken}`);
    expect(approve.status).toBe(404);
  });
});
