/**
 * /api/approvals — pipeline de validation des contenus produits par les agents.
 *
 * Quand un agent est en mode 'manual', le contenu rédigé par Claude attend ici
 * que l'utilisateur le valide (publication) ou le rejette.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { publishContent } from '../services/agentService';
import { AgentRun } from '../types';

const router = Router();
router.use(requireAuth);

/** Charge un run en attente de validation appartenant à l'utilisateur */
function loadOwnedPendingRun(req: Request, res: Response): AgentRun | null {
  const run = storage.getRunById(req.params.runId);
  if (!run) {
    res.status(404).json({ success: false, error: 'Run not found' });
    return null;
  }
  const agent = storage.getAgentById(run.agentId);
  const role = agent ? storage.accessRole(req.user!.userId, agent.planId, agent.userId) : null;
  if (!agent || !role) {
    res.status(404).json({ success: false, error: 'Run not found' });
    return null;
  }
  if (role === 'viewer') {
    res.status(403).json({ success: false, error: 'Rôle Lecteur : action non autorisée' });
    return null;
  }
  if (run.status !== 'awaiting_approval') {
    res.status(400).json({ success: false, error: 'This run is not awaiting approval' });
    return null;
  }
  return run;
}

// ── GET /api/approvals — demandes en attente du projet actif ─────────────────
router.get('/', (req: Request, res: Response) => {
  const ctx = storage.resolveActiveProject(req.user!.userId);
  const items = storage.getPendingApprovalsByPlan(ctx.ownerUserId, ctx.planId);
  res.json({ success: true, data: items });
});

// ── GET /api/approvals/history — attestation des envois passés ───────────────
// Runs terminés du projet avec leur résultat exact (lien publié, raison
// d'échec, motif de rejet) — l'utilisateur n'a plus à faire confiance.
router.get('/history', (req: Request, res: Response) => {
  const ctx = storage.resolveActiveProject(req.user!.userId);
  const items = storage.getRunHistoryByPlan(ctx.ownerUserId, ctx.planId);
  res.json({ success: true, data: items });
});

// ── POST /api/approvals/:runId/approve ───────────────────────────────────────
// Valide le contenu (éventuellement édité par l'utilisateur) → publication
router.post('/:runId/approve', async (req: Request, res: Response) => {
  const run = loadOwnedPendingRun(req, res);
  if (!run) return;

  const agent = storage.getAgentById(run.agentId)!;
  const edited = (req.body as { content?: string }).content;
  const content = typeof edited === 'string' && edited.trim() ? edited.trim() : (run.result || '');

  const result = await publishContent(agent, content);
  storage.updateRunStatus(run.id, 'done', result);
  storage.updateAgent(agent.id, { status: 'active', lastRunAt: new Date().toISOString() });

  res.json({ success: true, data: storage.getRunById(run.id) });
});

// ── POST /api/approvals/:runId/reject ────────────────────────────────────────
router.post('/:runId/reject', (req: Request, res: Response) => {
  const run = loadOwnedPendingRun(req, res);
  if (!run) return;

  const reason = (req.body as { reason?: string }).reason;
  const result = reason
    ? `🚫 Rejeté par l'utilisateur : ${reason}\n\n— Contenu proposé —\n${run.result || ''}`
    : `🚫 Rejeté par l'utilisateur\n\n— Contenu proposé —\n${run.result || ''}`;
  storage.updateRunStatus(run.id, 'rejected', result);

  res.json({ success: true, data: storage.getRunById(run.id) });
});

export default router;
