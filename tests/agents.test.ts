import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine, getDb } from '../src/db';
import { encryptSecret, decryptSecret } from '../src/services/secrets';
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
