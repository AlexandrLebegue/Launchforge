import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine, getDb } from '../src/db';
import app from '../src/app';

beforeAll(async () => {
  await initEngine();
  getDb();
});

const testUser = {
  email: 'test@launchforge.dev',
  password: 'password123',
  name: 'Test User',
};

const validPlanPayload = {
  productName: 'TaskFlow',
  description: 'A project management tool for remote teams with AI-powered task assignments',
  targetAudience: 'Remote software teams of 5-50 people',
  niche: 'saas',
  goals: ['first 100 users', 'product hunt launch', '10 paying customers'],
  pricing: '$29/month per team',
};

let token: string;
let planId: string;

describe('Health', () => {
  it('GET /api/health returns ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Auth', () => {
  it('POST /api/auth/register creates a user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(testUser);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    expect(res.body.data.user.email).toBe(testUser.email);
    token = res.body.data.token;
  });

  it('POST /api/auth/register rejects duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send(testUser);
    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
  });

  it('POST /api/auth/login returns token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testUser.email, password: testUser.password });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTruthy();
    token = res.body.data.token;
  });

  it('POST /api/auth/login rejects wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: testUser.email, password: 'wrongpass' });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('GET /api/auth/me returns user with valid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(testUser.email);
  });

  it('GET /api/auth/me rejects without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('Templates', () => {
  it('GET /api/templates returns templates', async () => {
    const res = await request(app).get('/api/templates');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);
  });
});

describe('Plans', () => {
  it('POST /api/plan requires auth', async () => {
    const res = await request(app)
      .post('/api/plan')
      .send(validPlanPayload);
    expect(res.status).toBe(401);
  });

  it('POST /api/plan creates plan with auth', async () => {
    const res = await request(app)
      .post('/api/plan')
      .set('Authorization', `Bearer ${token}`)
      .send(validPlanPayload);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.weekly_plan).toHaveLength(4);
    expect(res.body.data.userId).toBeTruthy();
    planId = res.body.data.id;
  });

  it('POST /api/plan rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/plan')
      .set('Authorization', `Bearer ${token}`)
      .send({ productName: 'Test' });
    expect(res.status).toBe(400);
  });

  it('GET /api/plan returns user plans', async () => {
    const res = await request(app)
      .get('/api/plan')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/plan/:id returns plan', async () => {
    const res = await request(app).get(`/api/plan/${planId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(planId);
  });

  it('GET /api/plan/:id returns 404 for missing', async () => {
    const res = await request(app).get('/api/plan/non-existent-id');
    expect(res.status).toBe(404);
  });
});

describe('Feedback', () => {
  it('POST /api/feedback requires auth', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .send({ planId, rating: 5 });
    expect(res.status).toBe(401);
  });

  it('POST /api/feedback submits with auth', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .set('Authorization', `Bearer ${token}`)
      .send({ planId, rating: 5, comment: 'Excellent plan!' });
    expect(res.status).toBe(201);
    expect(res.body.data.rating).toBe(5);
    expect(res.body.data.planId).toBe(planId);
  });

  it('POST /api/feedback rejects invalid rating', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .set('Authorization', `Bearer ${token}`)
      .send({ planId, rating: 6 });
    expect(res.status).toBe(400);
  });

  it('POST /api/feedback rejects missing plan', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .set('Authorization', `Bearer ${token}`)
      .send({ planId: 'fake-id', rating: 3 });
    expect(res.status).toBe(404);
  });

  it('GET /api/feedback/:planId returns feedback', async () => {
    const res = await request(app).get(`/api/feedback/${planId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Research', () => {
  it('POST /api/research requires auth', async () => {
    const res = await request(app)
      .post('/api/research')
      .send({ productName: 'TestApp', description: 'A test app', niche: 'saas' });
    expect(res.status).toBe(401);
  });

  it('POST /api/research returns research data with auth', async () => {
    const res = await request(app)
      .post('/api/research')
      .set('Authorization', `Bearer ${token}`)
      .send({ productName: 'TaskFlow', description: 'A project management tool for remote teams', niche: 'saas' })
      .timeout(15000);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('productName', 'TaskFlow');
    expect(res.body.data).toHaveProperty('competitors');
    expect(res.body.data).toHaveProperty('communities');
    expect(res.body.data).toHaveProperty('trends');
    expect(res.body.data).toHaveProperty('potentialAngles');
  });

  it('POST /api/research validates productName', async () => {
    const res = await request(app)
      .post('/api/research')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'no name here', niche: 'saas' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('Research', () => {
  it('POST /api/research requires auth', async () => {
    const res = await request(app)
      .post('/api/research')
      .send({ productName: 'TestApp', description: 'A test app', niche: 'saas' });
    expect(res.status).toBe(401);
  });

  it('POST /api/research returns research data with auth', async () => {
    const res = await request(app)
      .post('/api/research')
      .set('Authorization', `Bearer ${token}`)
      .send({ productName: 'TaskFlow', description: 'A project management tool for remote teams', niche: 'saas' })
      .timeout(15000);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('productName', 'TaskFlow');
    expect(res.body.data).toHaveProperty('competitors');
    expect(res.body.data).toHaveProperty('communities');
    expect(res.body.data).toHaveProperty('trends');
    expect(res.body.data).toHaveProperty('potentialAngles');
  });

  it('POST /api/research validates productName', async () => {
    const res = await request(app)
      .post('/api/research')
      .set('Authorization', `Bearer ${token}`)
      .send({ description: 'no name here', niche: 'saas' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
