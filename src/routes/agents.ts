/**
 * /api/agents — CRUD agents + exécution de runs Kanban
 */

import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { getCatalog, processAgentRun } from '../services/agentService';
import { Agent, AgentRun, AgentPlatform, ApprovalMode } from '../types';

const router = Router();

// Toutes les routes agents nécessitent une authentification
router.use(requireAuth);

/**
 * La clé API ne quitte JAMAIS le serveur. Le client ne reçoit qu'un booléen
 * hasApiKey (la clé est par ailleurs chiffrée au repos, voir secrets.ts).
 */
function sanitizeAgent(agent: Agent): Omit<Agent, 'apiKey'> & { hasApiKey: boolean } {
  const { apiKey, ...rest } = agent;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

// ── GET /api/agents/catalog ──────────────────────────────────────────────────
// Retourne les 10 templates de plateforme (sans auth nécessaire une fois connecté)
router.get('/catalog', (_req: Request, res: Response) => {
  res.json({ success: true, data: getCatalog() });
});

/** Charge un agent accessible (perso ou d'équipe) ; bloque les Lecteurs si write. */
function loadAgent(req: Request, res: Response, write: boolean): Agent | null {
  const agent = storage.getAgentById(req.params.id);
  const role = agent ? storage.accessRole(req.user!.userId, agent.planId, agent.userId) : null;
  if (!agent || !role) {
    res.status(404).json({ success: false, error: 'Agent not found' });
    return null;
  }
  if (write && role === 'viewer') {
    res.status(403).json({ success: false, error: 'Rôle Lecteur : action non autorisée' });
    return null;
  }
  return agent;
}

// ── GET /api/agents ──────────────────────────────────────────────────────────
// Les agents (et leur mode de validation) sont propres au projet actif
router.get('/', (req: Request, res: Response) => {
  const ctx = storage.resolveActiveProject(req.user!.userId);
  const agents = storage.getAgentsByPlan(ctx.ownerUserId, ctx.planId);
  res.json({ success: true, data: agents.map(sanitizeAgent) });
});

// ── POST /api/agents ─────────────────────────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  const { platform, name, apiKey, approvalMode } = req.body as {
    platform: AgentPlatform;
    name?: string;
    apiKey?: string;
    approvalMode?: ApprovalMode;
  };

  if (!platform) {
    return res.status(400).json({ success: false, error: 'platform is required' });
  }

  const catalog = getCatalog();
  const template = catalog.find((t) => t.platform === platform);
  if (!template) {
    return res.status(400).json({ success: false, error: `Unknown platform: ${platform}` });
  }

  const ctx = storage.resolveActiveProject(req.user!.userId);
  if (ctx.role === 'viewer') {
    return res.status(403).json({ success: false, error: 'Rôle Lecteur : action non autorisée' });
  }

  const agent: Agent = {
    id:           uuid(),
    userId:       ctx.ownerUserId,
    planId:       ctx.planId,
    name:         name || template.name,
    platform,
    apiKey:       apiKey || '',
    status:       'active',
    approvalMode: approvalMode === 'auto' ? 'auto' : 'manual',
    lastRunAt:    null,
    createdAt:    new Date().toISOString(),
  };

  storage.saveAgent(agent);
  res.status(201).json({ success: true, data: sanitizeAgent(agent) });
});

// ── GET /api/agents/:id ──────────────────────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  const agent = loadAgent(req, res, false);
  if (!agent) return;
  res.json({ success: true, data: sanitizeAgent(agent) });
});

// ── PATCH /api/agents/:id ────────────────────────────────────────────────────
router.patch('/:id', (req: Request, res: Response) => {
  const agent = loadAgent(req, res, true);
  if (!agent) return;

  const { name, apiKey, status, approvalMode } = req.body as Partial<Pick<Agent, 'name' | 'apiKey' | 'status' | 'approvalMode'>>;
  // Une chaîne vide signifie "ne pas toucher à la clé" (le client ne la
  // connaît pas) ; pour révoquer une clé, supprimer puis recréer l'agent.
  storage.updateAgent(req.params.id, {
    name,
    apiKey: apiKey ? apiKey : undefined,
    status,
    approvalMode: approvalMode === 'auto' || approvalMode === 'manual' ? approvalMode : undefined,
  });

  const updated = storage.getAgentById(req.params.id);
  res.json({ success: true, data: updated ? sanitizeAgent(updated) : null });
});

// ── DELETE /api/agents/:id ───────────────────────────────────────────────────
router.delete('/:id', (req: Request, res: Response) => {
  const agent = loadAgent(req, res, true);
  if (!agent) return;
  storage.deleteAgent(req.params.id);
  res.json({ success: true, data: null });
});

// ── GET /api/agents/:id/runs ─────────────────────────────────────────────────
router.get('/:id/runs', (req: Request, res: Response) => {
  const agent = loadAgent(req, res, false);
  if (!agent) return;
  const runs = storage.getRunsByAgentId(req.params.id);
  res.json({ success: true, data: runs });
});

// ── POST /api/agents/assign-platform ─────────────────────────────────────────
// Assigne une tâche Kanban à une PLATEFORME : l'agent correspondant est trouvé
// ou créé silencieusement (le concept d'agent est invisible pour l'utilisateur,
// seule la plateforme compte).
router.post('/assign-platform', async (req: Request, res: Response) => {
  const { platform, planId, cardId, cardTitle, cardDescription, cardCategory, cardEffort } = req.body as {
    platform:        AgentPlatform;
    planId:          string;
    cardId:          string;
    cardTitle:       string;
    cardDescription: string;
    cardCategory:    string;
    cardEffort:      'low' | 'medium' | 'high';
  };

  const template = getCatalog().find((t) => t.platform === platform);
  if (!template) {
    return res.status(400).json({ success: false, error: `Unknown platform: ${platform}` });
  }
  if (!planId || !cardId || !cardTitle) {
    return res.status(400).json({ success: false, error: 'planId, cardId and cardTitle are required' });
  }

  // Accès au projet (perso ou d'équipe) ; l'agent est rattaché au propriétaire
  const role = storage.getProjectRole(req.user!.userId, planId);
  if (!role) return res.status(404).json({ success: false, error: 'Projet introuvable' });
  if (role === 'viewer') return res.status(403).json({ success: false, error: 'Rôle Lecteur : action non autorisée' });
  const ownerUserId = storage.getPlanMeta(planId)!.userId;

  // L'agent (et son mode de validation) est propre au projet de la carte
  let agent = storage.getAgentsByPlan(ownerUserId, planId).find((a) => a.platform === platform);
  if (!agent) {
    // Mode hérité du réglage du projet (auto si tous les agents existants le sont)
    const others = storage.getAgentsByPlan(ownerUserId, planId);
    const mode: ApprovalMode = others.length > 0 && others.every((a) => a.approvalMode === 'auto') ? 'auto' : 'manual';
    agent = {
      id:           uuid(),
      userId:       ownerUserId,
      planId,
      name:         template.name,
      platform,
      apiKey:       '',
      status:       'active',
      approvalMode: mode,
      lastRunAt:    null,
      createdAt:    new Date().toISOString(),
    };
    storage.saveAgent(agent);
  }

  const run: AgentRun = {
    id:          uuid(),
    agentId:     agent.id,
    planId,
    cardId,
    cardTitle,
    status:      'running',
    result:      null,
    startedAt:   new Date().toISOString(),
    completedAt: null,
  };
  storage.saveAgentRun(run);
  storage.updateAgent(agent.id, { lastRunAt: run.startedAt });
  res.status(202).json({ success: true, data: run });

  const card = {
    id: cardId, title: cardTitle,
    description: cardDescription || '', category: cardCategory || 'General',
    effort: (cardEffort || 'medium') as 'low' | 'medium' | 'high',
    column: 'in_progress' as const, order: 0,
    createdAt: new Date().toISOString(),
  };
  processAgentRun(run.id, agent, card, planId).catch((err: Error) => {
    storage.updateRunStatus(run.id, 'failed', err.message);
  });
});

// ── POST /api/agents/:id/runs ────────────────────────────────────────────────
// Assigne une carte Kanban à l'agent et déclenche l'exécution
router.post('/:id/runs', async (req: Request, res: Response) => {
  const agent = loadAgent(req, res, true);
  if (!agent) return;

  const { planId, cardId, cardTitle, cardDescription, cardCategory, cardEffort } = req.body as {
    planId:          string;
    cardId:          string;
    cardTitle:       string;
    cardDescription: string;
    cardCategory:    string;
    cardEffort:      'low' | 'medium' | 'high';
  };

  if (!planId || !cardId || !cardTitle) {
    return res.status(400).json({ success: false, error: 'planId, cardId and cardTitle are required' });
  }

  const run: AgentRun = {
    id:          uuid(),
    agentId:     agent.id,
    planId,
    cardId,
    cardTitle,
    status:      'running',
    result:      null,
    startedAt:   new Date().toISOString(),
    completedAt: null,
  };

  storage.saveAgentRun(run);

  // Mise à jour du lastRunAt de l'agent
  storage.updateAgent(agent.id, { lastRunAt: run.startedAt });

  // Répondre immédiatement avec le run en status "running"
  res.status(202).json({ success: true, data: run });

  // Pipeline asynchrone : rédaction → publication auto OU mise en validation
  const card = {
    id:          cardId,
    title:       cardTitle,
    description: cardDescription || '',
    category:    cardCategory    || 'General',
    effort:      (cardEffort     || 'medium') as 'low' | 'medium' | 'high',
    column:      'in_progress'   as const,
    order:       0,
    createdAt:   new Date().toISOString(),
  };

  processAgentRun(run.id, agent, card, planId).catch((err: Error) => {
    storage.updateRunStatus(run.id, 'failed', err.message);
    storage.updateAgent(agent.id, { status: 'error' });
  });
});

export default router;
