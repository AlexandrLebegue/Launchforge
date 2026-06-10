/**
 * Isolation par projet : chaque projet (plan) a son propre Hub de contenu,
 * sa base de connaissances, ses contacts, ses agents et ses validations.
 * Basculer de projet change le contexte de TOUTE l'application.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import app from '../src/app';

let token: string;
let planA: string;
let planB: string;

const planPayload = (name: string) => ({
  productName: name,
  description: `Description du projet ${name} pour les tests d'isolation`,
  targetAudience: 'Des testeurs exigeants',
  niche: 'saas',
  goals: ['isoler les données'],
  pricing: 'gratuit',
});

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY;
  const res = await request(app).post('/api/auth/register').send({
    email: 'projects@launchforge.dev',
    password: 'password123',
    name: 'Projects Tester',
  });
  token = res.body.data.token;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

describe('Isolation des données par projet', () => {
  it('crée le projet A (actif) et le remplit', async () => {
    const plan = await request(app).post('/api/plan').set(auth()).send(planPayload('ProjetA'));
    expect(plan.status).toBe(201);
    planA = plan.body.data.id;

    const post = await request(app).post('/api/posts').set(auth())
      .send({ platform: 'linkedin', title: 'Post du projet A', content: 'Contenu A' });
    expect(post.body.data.planId).toBe(planA);

    const entry = await request(app).post('/api/knowledge').set(auth())
      .send({ category: 'tone', title: 'Ton projet A', content: 'Direct et concret.' });
    expect(entry.status).toBe(201);

    const contact = await request(app).post('/api/contacts').set(auth())
      .send({ name: 'Alice Dupont', email: 'alice@a.dev' });
    expect(contact.status).toBe(201);
  });

  it('la base de connaissances du projet A contient ses fiches bootstrappées', async () => {
    const res = await request(app).get('/api/knowledge').set(auth());
    const titles = res.body.data.map((e: any) => e.title);
    expect(titles).toContain('Ton projet A');
    // Bootstrap automatique à la création du projet
    expect(titles.some((t: string) => t.includes('ProjetA'))).toBe(true);
  });

  it('créer le projet B bascule le contexte : données du A invisibles', async () => {
    const plan = await request(app).post('/api/plan').set(auth()).send(planPayload('ProjetB'));
    expect(plan.status).toBe(201);
    planB = plan.body.data.id;

    const posts = await request(app).get('/api/posts').set(auth());
    expect(posts.body.data.find((p: any) => p.title === 'Post du projet A')).toBeUndefined();

    const knowledge = await request(app).get('/api/knowledge').set(auth());
    const titles = knowledge.body.data.map((e: any) => e.title);
    expect(titles).not.toContain('Ton projet A');
    expect(titles.some((t: string) => t.includes('ProjetB'))).toBe(true);

    const contacts = await request(app).get('/api/contacts').set(auth());
    expect(contacts.body.data.find((c: any) => c.name === 'Alice Dupont')).toBeUndefined();
  });

  it('les nouvelles données vont dans le projet B', async () => {
    const post = await request(app).post('/api/posts').set(auth())
      .send({ platform: 'twitter', title: 'Post du projet B' });
    expect(post.body.data.planId).toBe(planB);
  });

  it('réactiver le projet A restaure tout son contexte', async () => {
    const activate = await request(app).post(`/api/plan/${planA}/activate`).set(auth());
    expect(activate.status).toBe(200);

    const posts = await request(app).get('/api/posts').set(auth());
    const titles = posts.body.data.map((p: any) => p.title);
    expect(titles).toContain('Post du projet A');
    expect(titles).not.toContain('Post du projet B');

    const knowledge = await request(app).get('/api/knowledge').set(auth());
    expect(knowledge.body.data.map((e: any) => e.title)).toContain('Ton projet A');

    const contacts = await request(app).get('/api/contacts').set(auth());
    expect(contacts.body.data.map((c: any) => c.name)).toContain('Alice Dupont');
  });

  it('GET /api/overview agrège le contexte du projet actif en une requête', async () => {
    // Projet A actif à ce stade (réactivé au test précédent)
    const res = await request(app).get('/api/overview').set(auth());
    expect(res.status).toBe(200);
    const data = res.body.data;

    expect(data.project.id).toBe(planA);
    expect(data.project.productName).toBe('ProjetA');
    expect(data.projects.map((p: any) => p.productName)).toContain('ProjetB');
    // Les projets sont « légers » : pas de blobs JSON du plan
    expect(data.projects[0].weekly_plan).toBeUndefined();
    expect(data.projects[0].kanbanState).toBeUndefined();

    // Compteurs de posts scopés au projet A (1 brouillon créé plus haut)
    expect(data.posts.drafts).toBeGreaterThanOrEqual(1);
    expect(typeof data.approvals).toBe('number');
    expect(data.tasks).toHaveProperty('total');
  });

  it('le mode de publication est un réglage par projet', async () => {
    // Projet A (actif) : crée un agent et passe le projet en auto
    await request(app).post('/api/agents').set(auth()).send({ platform: 'linkedin' });
    await request(app).patch('/api/config/publish-mode').set(auth()).send({ mode: 'auto' });
    const statusA = await request(app).get('/api/config/status').set(auth());
    expect(statusA.body.data.publishMode).toBe('auto');

    // Projet B : aucun agent → mode par défaut (manual), non affecté par A
    await request(app).post(`/api/plan/${planB}/activate`).set(auth());
    const statusB = await request(app).get('/api/config/status').set(auth());
    expect(statusB.body.data.publishMode).toBe('manual');

    // Les agents listés sont ceux du projet actif uniquement
    const agentsB = await request(app).get('/api/agents').set(auth());
    expect(agentsB.body.data).toHaveLength(0);
  });
});
