import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import app from '../src/app';

let token: string;

beforeAll(async () => {
  await initEngine();
  delete process.env.ANTHROPIC_API_KEY;

  const res = await request(app).post('/api/auth/register').send({
    email: 'onboarding@launchforge.dev',
    password: 'password123',
    name: 'Onboarding Tester',
  });
  token = res.body.data.token;
});

describe('Onboarding', () => {
  it('POST /api/onboarding requires auth', async () => {
    const res = await request(app).post('/api/onboarding');
    expect(res.status).toBe(401);
  });

  it('POST /api/onboarding returns 503 when AI is not configured', async () => {
    const res = await request(app)
      .post('/api/onboarding')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('AI_NOT_CONFIGURED');
  });

  it('GET /api/onboarding/:id returns 404 for unknown session', async () => {
    const res = await request(app)
      .get('/api/onboarding/does-not-exist')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
