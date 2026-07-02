import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import { processDueCronJobs, runCronJob, ObjectiveRunner } from '../src/services/cronRunner';
import { computeNextRunAt, normalizeSchedule } from '../src/services/cronSchedule';
import { CRON_FREQUENCY_MINUTES } from '../src/types';
import app from '../src/app';

/** Heure/minute/jour d'un ISO tels que vus à Paris. */
function parisParts(iso: string): { hour: string; minute: string; weekday: string } {
  const m: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(new Date(iso))) m[p.type] = p.value;
  return { hour: m.hour, minute: m.minute, weekday: m.weekday };
}

let token: string;
let userId: string;
const auth = () => ({ Authorization: `Bearer ${token}` });

// Exécuteur d'objectif factice (aucun appel IA) — c'est ce que le worker
// injecte à la place de la vraie boucle agentique.
const fakeRunner: ObjectiveRunner = async () => ({ reply: 'Compte rendu factice.', actions: ['🔍 recherche web'] });

beforeAll(async () => {
  await initEngine();
  delete process.env.OPENROUTER_API_KEY;
  // Compte fondateur → tier « brasier » garanti (feature automations + quota),
  // indépendamment de l'essai. founderEmails() relit l'env à chaque appel.
  process.env.ADMIN_EMAILS = 'cron@launchforge.dev';
  const res = await request(app).post('/api/auth/register').send({
    email: 'cron@launchforge.dev', password: 'password123', name: 'Cron Tester',
  });
  token = res.body.data.token;
  userId = res.body.data.user.id;
});

async function createJob(extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/cron').set(auth()).send({
    title: 'Veille secteur', objective: 'Fais une veille du secteur.', frequency: 'hourly', ...extra,
  });
  return res.body.data as { id: string; intervalMinutes: number; enabled: number; nextRunAt: string };
}

describe('Planification (heure de la journée + périodicité, Europe/Paris)', () => {
  it('daily : prochaine occurrence à l\'heure fixée, dans le futur', () => {
    const from = new Date('2026-07-01T20:00:00Z'); // 22h Paris (été)
    const iso = computeNextRunAt(normalizeSchedule({ frequency: 'daily', timeOfDay: '09:00' }), from);
    expect(new Date(iso).getTime()).toBeGreaterThan(from.getTime());
    expect(parisParts(iso)).toMatchObject({ hour: '09', minute: '00' });
  });

  it('weekly : tombe le bon jour de la semaine à la bonne heure', () => {
    const from = new Date('2026-07-01T08:00:00Z'); // mercredi
    const iso = computeNextRunAt(normalizeSchedule({ frequency: 'weekly', weekday: 1, timeOfDay: '09:30' }), from);
    const parts = parisParts(iso);
    expect(parts.weekday).toBe('Mon');
    expect(parts).toMatchObject({ hour: '09', minute: '30' });
    expect(new Date(iso).getTime()).toBeGreaterThan(from.getTime());
  });

  it('intraday (hourly) : simplement maintenant + 60 min', () => {
    const from = new Date('2026-07-01T10:00:00Z');
    const iso = computeNextRunAt(normalizeSchedule({ frequency: 'hourly' }), from);
    expect(new Date(iso).getTime()).toBe(from.getTime() + 60 * 60_000);
  });

  it('normalizeSchedule nettoie les ancres hors-famille', () => {
    expect(normalizeSchedule({ frequency: 'daily', timeOfDay: '07:15', weekday: 3, dayOfMonth: 9 }))
      .toEqual({ frequency: 'daily', timeOfDay: '07:15', weekday: null, dayOfMonth: null });
    expect(normalizeSchedule({ frequency: 'hourly', timeOfDay: '07:15' }))
      .toEqual({ frequency: 'hourly', timeOfDay: null, weekday: null, dayOfMonth: null });
  });
});

describe('API /api/cron', () => {
  it('crée une automatisation avec la cadence choisie et une première échéance future', async () => {
    const job = await createJob({ frequency: 'daily' });
    expect(job.intervalMinutes).toBe(CRON_FREQUENCY_MINUTES.daily);
    expect(job.enabled).toBe(1);
    expect(new Date(job.nextRunAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('refuse une cadence invalide', async () => {
    const res = await request(app).post('/api/cron').set(auth()).send({
      title: 'X', objective: 'Y', frequency: 'yearly',
    });
    expect(res.status).toBe(400);
  });
});

describe('Worker des automatisations', () => {
  it('exécute une automatisation due, historise le run et replanifie', async () => {
    const job = await createJob();
    // Rendre l'échéance passée pour la rendre « due »
    storage.updateCronJob(job.id, { nextRunAt: new Date(Date.now() - 60_000).toISOString() });

    const usageBefore = storage.countUsage(userId, 'ai_generation');
    const ran = await processDueCronJobs(new Date(), fakeRunner);
    expect(ran).toBeGreaterThanOrEqual(1);

    const fresh = storage.getCronJobById(job.id)!;
    expect(fresh.lastStatus).toBe('ok');
    expect(fresh.lastResult).toBe('Compte rendu factice.');
    expect(new Date(fresh.nextRunAt).getTime()).toBeGreaterThan(Date.now()); // replanifiée

    const runs = storage.getCronRunsByJob(job.id);
    expect(runs.length).toBe(1);
    expect(runs[0].status).toBe('ok');
    expect(JSON.parse(runs[0].actions!)).toContain('🔍 recherche web');

    // Une exécution = une génération IA comptabilisée
    expect(storage.countUsage(userId, 'ai_generation')).toBe(usageBefore + 1);
  });

  it('ne rejoue pas une automatisation déjà exécutée (échéance repoussée)', async () => {
    const job = await createJob();
    storage.updateCronJob(job.id, { nextRunAt: new Date(Date.now() - 60_000).toISOString() });
    await processDueCronJobs(new Date(), fakeRunner);
    const again = await processDueCronJobs(new Date(), fakeRunner);
    // La 2e passe ne retrouve pas ce job (nextRunAt désormais futur)
    expect(storage.getDueCronJobs(new Date().toISOString()).some((j) => j.id === job.id)).toBe(false);
    expect(again).toBe(0);
  });

  it('ignore les automatisations en pause', async () => {
    const job = await createJob();
    storage.updateCronJob(job.id, { enabled: 0, nextRunAt: new Date(Date.now() - 60_000).toISOString() });
    const due = storage.getDueCronJobs(new Date().toISOString());
    expect(due.some((j) => j.id === job.id)).toBe(false);
  });

  it('capture l\'échec de l\'objectif dans le run sans casser le worker', async () => {
    const job = await createJob();
    storage.updateCronJob(job.id, { nextRunAt: new Date(Date.now() - 60_000).toISOString() });
    const boom: ObjectiveRunner = async () => { throw new Error('modèle indisponible'); };
    const run = await runCronJob(storage.getCronJobById(job.id)!, boom);
    expect(run?.status).toBe('error');
    const fresh = storage.getCronJobById(job.id)!;
    expect(fresh.lastStatus).toBe('error');
    expect(fresh.lastResult).toContain('modèle indisponible');
  });
});

describe('Suppression', () => {
  it('supprime l\'automatisation et son historique', async () => {
    const job = await createJob();
    storage.updateCronJob(job.id, { nextRunAt: new Date(Date.now() - 60_000).toISOString() });
    await processDueCronJobs(new Date(), fakeRunner);
    expect(storage.getCronRunsByJob(job.id).length).toBeGreaterThan(0);

    const res = await request(app).delete(`/api/cron/${job.id}`).set(auth());
    expect(res.body.success).toBe(true);
    expect(storage.getCronJobById(job.id)).toBeUndefined();
    expect(storage.getCronRunsByJob(job.id).length).toBe(0);
  });
});
