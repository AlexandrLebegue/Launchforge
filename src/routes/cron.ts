/**
 * /api/cron — automatisations (cron jobs IA).
 *
 * Une automatisation est une tâche IA récurrente : un objectif en langage
 * naturel exécuté à intervalle régulier par la boucle agentique outillée
 * (cronRunner.ts + telegramBot.ts). Chaque automatisation est personnelle à
 * l'utilisateur et s'exécute dans le contexte de SON projet actif (comme
 * l'assistant).
 *
 *   GET    /            — liste des automatisations du projet actif
 *   POST   /            — crée une automatisation (feature « automations »)
 *   PATCH  /:id         — modifie (titre, objectif, cadence, pause/reprise)
 *   DELETE /:id         — supprime (et son historique)
 *   POST   /:id/run     — exécute maintenant (synchrone) et renvoie le compte rendu
 *   GET    /:id/runs    — historique des exécutions
 */

import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { assertFeature } from '../services/entitlements';
import { handleQuota } from '../middleware/quota';
import { runCronJob } from '../services/cronRunner';
import { computeNextRunAt, normalizeSchedule, nominalMinutes, scheduleOf, CronSchedule } from '../services/cronSchedule';
import { CronJob, CronFrequency, CRON_FREQUENCY_MINUTES } from '../types';

const router = Router();
router.use(requireAuth);

const FREQUENCIES = Object.keys(CRON_FREQUENCY_MINUTES) as CronFrequency[];

/** Valide + normalise la planification d'une requête, ou null si invalide. */
function resolveSchedule(body: { frequency?: unknown; timeOfDay?: unknown; weekday?: unknown; dayOfMonth?: unknown }): CronSchedule | null {
  if (typeof body.frequency !== 'string' || !FREQUENCIES.includes(body.frequency as CronFrequency)) return null;
  return normalizeSchedule({
    frequency: body.frequency as CronFrequency,
    timeOfDay: typeof body.timeOfDay === 'string' ? body.timeOfDay : null,
    weekday: body.weekday != null ? Number(body.weekday) : null,
    dayOfMonth: body.dayOfMonth != null ? Number(body.dayOfMonth) : null,
  });
}

/** Charge une automatisation appartenant à l'utilisateur, sinon répond 404. */
function loadOwnedJob(req: Request, res: Response): CronJob | null {
  const job = storage.getCronJobById(req.params.id);
  if (!job || job.userId !== req.user!.userId) {
    res.status(404).json({ success: false, error: 'Automatisation introuvable' });
    return null;
  }
  return job;
}

// ── Liste ──────────────────────────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  const planId = storage.getActivePlanId(req.user!.userId);
  res.json({ success: true, data: storage.getCronJobsByPlan(req.user!.userId, planId) });
});

// ── Création ───────────────────────────────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  try {
    assertFeature(req.user!.userId, 'automations');
  } catch (err) {
    if (handleQuota(res, err)) return;
    throw err;
  }

  const body = req.body as { title?: unknown; objective?: unknown; frequency?: unknown; timeOfDay?: unknown; weekday?: unknown; dayOfMonth?: unknown; enabled?: unknown };
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 120) : '';
  const objective = typeof body.objective === 'string' ? body.objective.trim().slice(0, 4000) : '';
  const schedule = resolveSchedule(body);
  if (!title) return res.status(400).json({ success: false, error: 'Le titre est requis' });
  if (!objective) return res.status(400).json({ success: false, error: 'L\'objectif est requis' });
  if (!schedule) return res.status(400).json({ success: false, error: 'Cadence invalide' });

  const now = new Date();
  const nowIso = now.toISOString();
  const job: CronJob = {
    id: uuid(),
    userId: req.user!.userId,
    planId: storage.getActivePlanId(req.user!.userId),
    title,
    objective,
    frequency: schedule.frequency,
    timeOfDay: schedule.timeOfDay,
    weekday: schedule.weekday,
    dayOfMonth: schedule.dayOfMonth,
    intervalMinutes: nominalMinutes(schedule.frequency),
    enabled: body.enabled === false ? 0 : 1,
    nextRunAt: computeNextRunAt(schedule, now),
    lastRunAt: null, lastStatus: null, lastResult: null,
    createdAt: nowIso, updatedAt: nowIso,
  };
  storage.saveCronJob(job);
  res.json({ success: true, data: job });
});

// ── Modification ───────────────────────────────────────────────────────────
router.patch('/:id', (req: Request, res: Response) => {
  const job = loadOwnedJob(req, res);
  if (!job) return;

  const body = req.body as { title?: unknown; objective?: unknown; frequency?: unknown; timeOfDay?: unknown; weekday?: unknown; dayOfMonth?: unknown; enabled?: unknown };
  const patch: Partial<CronJob> = { updatedAt: new Date().toISOString() };
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 120);
  if (typeof body.objective === 'string' && body.objective.trim()) patch.objective = body.objective.trim().slice(0, 4000);

  const scheduleTouched = body.frequency !== undefined || body.timeOfDay !== undefined || body.weekday !== undefined || body.dayOfMonth !== undefined;
  if (scheduleTouched) {
    // Fusionne les champs fournis avec la planification actuelle avant de normaliser.
    const merged = {
      frequency: (body.frequency ?? job.frequency) as CronFrequency,
      timeOfDay: body.timeOfDay !== undefined ? (body.timeOfDay as string | null) : job.timeOfDay,
      weekday: body.weekday !== undefined ? (body.weekday != null ? Number(body.weekday) : null) : job.weekday,
      dayOfMonth: body.dayOfMonth !== undefined ? (body.dayOfMonth != null ? Number(body.dayOfMonth) : null) : job.dayOfMonth,
    };
    const schedule = resolveSchedule(merged);
    if (!schedule) return res.status(400).json({ success: false, error: 'Cadence invalide' });
    patch.frequency = schedule.frequency;
    patch.timeOfDay = schedule.timeOfDay;
    patch.weekday = schedule.weekday;
    patch.dayOfMonth = schedule.dayOfMonth;
    patch.intervalMinutes = nominalMinutes(schedule.frequency);
    patch.nextRunAt = computeNextRunAt(schedule, new Date());
  }
  if (typeof body.enabled === 'boolean') {
    patch.enabled = body.enabled ? 1 : 0;
    // Reprise après pause (sans changement de cadence) : recale la prochaine échéance.
    if (body.enabled && patch.nextRunAt === undefined) {
      patch.nextRunAt = computeNextRunAt(scheduleOf(job), new Date());
    }
  }
  storage.updateCronJob(job.id, patch);
  res.json({ success: true, data: storage.getCronJobById(job.id) });
});

// ── Suppression ────────────────────────────────────────────────────────────
router.delete('/:id', (req: Request, res: Response) => {
  const job = loadOwnedJob(req, res);
  if (!job) return;
  storage.deleteCronJob(job.id);
  res.json({ success: true, data: { deleted: true } });
});

// ── Exécution immédiate (synchrone) ────────────────────────────────────────
router.post('/:id/run', async (req: Request, res: Response) => {
  const job = loadOwnedJob(req, res);
  if (!job) return;
  try {
    assertFeature(req.user!.userId, 'automations');
  } catch (err) {
    if (handleQuota(res, err)) return;
    throw err;
  }
  try {
    const run = await runCronJob(job);
    if (!run) {
      return res.status(402).json({
        success: false,
        error: 'Exécution impossible : quota de générations IA atteint ou fonctionnalité indisponible.',
        code: 'QUOTA_EXCEEDED',
      });
    }
    res.json({ success: true, data: run });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Échec de l\'exécution' });
  }
});

// ── Historique des exécutions ──────────────────────────────────────────────
router.get('/:id/runs', (req: Request, res: Response) => {
  const job = loadOwnedJob(req, res);
  if (!job) return;
  res.json({ success: true, data: storage.getCronRunsByJob(job.id, 30) });
});

export default router;
