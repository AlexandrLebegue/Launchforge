/**
 * /api/agents — CRUD agents + exécution de runs Kanban
 */

import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { getCatalog, executeAgentRun } from '../services/agentService';
import { Agent, AgentRun, AgentPlatform } from '../types';

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

// ── GET /api/agents ──────────────────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  const agents = storage.getAgentsByUserId(req.user!.userId);
  res.json({ success: true, data: agents.map(sanitizeAgent) });
});

// ── POST /api/agents ─────────────────────────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  const { platform, name, apiKey } = req.body as {
    platform: AgentPlatform;
    name?: string;
    apiKey?: string;
  };

  if (!platform) {
    return res.status(400).json({ success: false, error: 'platform is required' });
  }

  const catalog = getCatalog();
  const template = catalog.find((t) => t.platform === platform);
  if (!template) {
    return res.status(400).json({ success: false, error: `Unknown platform: ${platform}` });
  }

  const agent: Agent = {
    id:        uuid(),
    userId:    req.user!.userId,
    name:      name || template.name,
    platform,
    apiKey:    apiKey || '',
    status:    apiKey ? 'active' : 'inactive',
    lastRunAt: null,
    createdAt: new Date().toISOString(),
  };

  storage.saveAgent(agent);
  res.status(201).json({ success: true, data: sanitizeAgent(agent) });
});

// ── GET /api/agents/:id ──────────────────────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  const agent = storage.getAgentById(req.params.id);
  if (!agent || agent.userId !== req.user!.userId) {
    return res.status(404).json({ success: false, error: 'Agent not found' });
  }
  res.json({ success: true, data: sanitizeAgent(agent) });
});

// ── PATCH /api/agents/:id ────────────────────────────────────────────────────
router.patch('/:id', (req: Request, res: Response) => {
  const agent = storage.getAgentById(req.params.id);
  if (!agent || agent.userId !== req.user!.userId) {
    return res.status(404).json({ success: false, error: 'Agent not found' });
  }

  const { name, apiKey, status } = req.body as Partial<Pick<Agent, 'name' | 'apiKey' | 'status'>>;
  // Une chaîne vide signifie "ne pas toucher à la clé" (le client ne la
  // connaît pas) ; pour révoquer une clé, supprimer puis recréer l'agent.
  storage.updateAgent(req.params.id, {
    name,
    apiKey: apiKey ? apiKey : undefined,
    status,
  });

  const updated = storage.getAgentById(req.params.id);
  res.json({ success: true, data: updated ? sanitizeAgent(updated) : null });
});

// ── DELETE /api/agents/:id ───────────────────────────────────────────────────
router.delete('/:id', (req: Request, res: Response) => {
  const agent = storage.getAgentById(req.params.id);
  if (!agent || agent.userId !== req.user!.userId) {
    return res.status(404).json({ success: false, error: 'Agent not found' });
  }
  storage.deleteAgent(req.params.id);
  res.json({ success: true, data: null });
});

// ── GET /api/agents/:id/runs ─────────────────────────────────────────────────
router.get('/:id/runs', (req: Request, res: Response) => {
  const agent = storage.getAgentById(req.params.id);
  if (!agent || agent.userId !== req.user!.userId) {
    return res.status(404).json({ success: false, error: 'Agent not found' });
  }
  const runs = storage.getRunsByAgentId(req.params.id);
  res.json({ success: true, data: runs });
});

// ── POST /api/agents/:id/runs ────────────────────────────────────────────────
// Assigne une carte Kanban à l'agent et déclenche l'exécution
router.post('/:id/runs', async (req: Request, res: Response) => {
  const agent = storage.getAgentById(req.params.id);
  if (!agent || agent.userId !== req.user!.userId) {
    return res.status(404).json({ success: false, error: 'Agent not found' });
  }

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

  // Exécution asynchrone (fire-and-forget)
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

  executeAgentRun(agent, card)
    .then((result) => {
      storage.updateRunStatus(run.id, 'done', result);
      storage.updateAgent(agent.id, {
        status:    'active',
        lastRunAt: new Date().toISOString(),
      });
    })
    .catch((err: Error) => {
      storage.updateRunStatus(run.id, 'failed', err.message);
      storage.updateAgent(agent.id, { status: 'error' });
    });
});

export default router;
