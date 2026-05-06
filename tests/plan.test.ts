import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../src/app';

const validPlanPayload = {
  productName: 'TaskFlow',
  description: 'A project management tool for remote teams with AI-powered task assignments',
  targetAudience: 'Remote software teams of 5-50 people',
  niche: 'saas',
  goals: ['first 100 users', 'product hunt launch', '10 paying customers'],
  pricing: '$29/month per team',
};

describe('GET /api/health', () => {
  it('should return health status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });
});

describe('GET /api/templates', () => {
  it('should return all templates', async () => {
    const res = await request(app).get('/api/templates');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);
    expect(res.body.data[0]).toHaveProperty('id');
    expect(res.body.data[0]).toHaveProperty('name');
    expect(res.body.data[0]).toHaveProperty('sections');
  });
});

describe('POST /api/plan', () => {
  it('should create a launch plan with valid input', async () => {
    const res = await request(app)
      .post('/api/plan')
      .send(validPlanPayload);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data).toHaveProperty('weekly_plan');
    expect(res.body.data).toHaveProperty('community_targets');
    expect(res.body.data).toHaveProperty('content_angles');
    expect(res.body.data).toHaveProperty('outreach_strategy');
    expect(res.body.data).toHaveProperty('launch_sequencing');
    expect(res.body.data).toHaveProperty('validation_checklist');
    expect(res.body.data).toHaveProperty('first_users_tactics');
    expect(res.body.data.weekly_plan).toHaveLength(4);
    expect(res.body.data.input.productName).toBe('TaskFlow');
  });

  it('should reject request with missing fields', async () => {
    const res = await request(app)
      .post('/api/plan')
      .send({ productName: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeTruthy();
  });

  it('should reject empty request body', async () => {
    const res = await request(app)
      .post('/api/plan')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('GET /api/plan/:id', () => {
  it('should return a plan by id', async () => {
    const createRes = await request(app)
      .post('/api/plan')
      .send(validPlanPayload);
    const planId = createRes.body.data.id;

    const res = await request(app).get(`/api/plan/${planId}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(planId);
  });

  it('should return 404 for non-existent plan', async () => {
    const res = await request(app).get('/api/plan/non-existent-id');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe('POST /api/feedback', () => {
  it('should submit feedback for an existing plan', async () => {
    const createRes = await request(app)
      .post('/api/plan')
      .send(validPlanPayload);
    const planId = createRes.body.data.id;

    const res = await request(app)
      .post('/api/feedback')
      .send({ planId, rating: 5, comment: 'Great plan!' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.rating).toBe(5);
    expect(res.body.data.planId).toBe(planId);
  });

  it('should return 404 for feedback on non-existent plan', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .send({ planId: 'fake-id', rating: 3 });
    expect(res.status).toBe(404);
  });

  it('should reject invalid rating', async () => {
    const res = await request(app)
      .post('/api/feedback')
      .send({ planId: 'some-id', rating: 6 });
    expect(res.status).toBe(400);
  });
});
