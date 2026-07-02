import { Router, Request, Response } from 'express';
import { createLaunchPlan, createAILaunchPlan, getLaunchPlan, getPlansByUserId } from '../services/planGenerator';
import { validatePlanInput } from '../middleware/validation';
import { storage } from '../services/storage';
import { requireAuth } from '../middleware/auth';
import { generateContentCalendar } from '../services/calendarGenerator';
import { platformsForNiche, bootstrapKnowledgeFromProfile } from '../services/bootstrap';
import { notifyLinkedChats } from '../services/telegramBot';
import { logEvent } from '../services/adminLogger';
import { assertCanCreateProject, hasUsage, recordUsage, QuotaError } from '../services/entitlements';
import { PlanInput, ApiResponse, LaunchPlan, AuthPayload, KanbanState, Post } from '../types';

const router = Router();

router.post('/', requireAuth, validatePlanInput, async (req: Request, res: Response) => {
  try {
    const input = req.body as PlanInput;
    const user = req.user as AuthPayload;

    // Quota d'offre : Braise est limitée à 1 projet (Brasier illimité)
    try {
      assertCanCreateProject(user.userId);
    } catch (e) {
      if (e instanceof QuotaError) {
        return res.status(402).json({ success: false, error: e.message, code: e.code, resource: e.resource, used: e.used, limit: e.limit });
      }
      throw e;
    }

    // AI generation by default when configured; createAILaunchPlan falls back
    // to templates internally, and mode=template forces the static templates.
    const mode = (req.body as any).mode
      || (process.env.OPENROUTER_API_KEY ? 'ai' : 'template');

    const plan = mode === 'ai'
      ? await createAILaunchPlan(input, user.userId)
      : createLaunchPlan(input, user.userId);

    // Nouveau projet → devient le projet actif de l'utilisateur
    storage.setActivePlan(user.userId, plan.id);

    // La base de connaissances DU PROJET se remplit toute seule depuis le
    // profil — avant le bootstrap du calendrier, qui s'appuie dessus.
    try {
      bootstrapKnowledgeFromProfile(user.userId, plan.id, {
        company:        input.company ?? { name: input.productName, exists: false },
        productName:    input.productName,
        description:    input.description,
        targetAudience: input.targetAudience,
        niche:          input.niche,
        goals:          input.goals,
        pricing:        input.pricing,
        // Contexte commercial (optionnel) — oriente les fiches vers la vente.
        buyer:            input.buyer,
        primaryObjective: input.primaryObjective,
        traction:         input.traction,
        salesMotion:      input.salesMotion,
        bottleneck:       input.bottleneck,
        revenueGoal:      input.revenueGoal,
      });
    } catch { /* best-effort */ }

    // Bootstrap automatique du Hub de contenu : l'IA rédige et date les
    // premières idées de posts (brouillons à valider) dans la même requête —
    // le splashscreen côté client couvre l'attente, et l'utilisateur arrive
    // sur un hub déjà rempli.
    // Amorçage du Hub (6 posts) compté dans le quota IA. On ne l'exécute que si
    // le quota le permet (sinon le plan est quand même créé, sans posts auto) —
    // sans ce garde-fou, supprimer/recréer un projet contournerait la limite.
    let bootstrappedPosts: Post[] = [];
    const BOOTSTRAP_POSTS = 6; // weeks 2 × postsPerWeek 3
    if (mode === 'ai' && process.env.OPENROUTER_API_KEY && hasUsage(user.userId, 'ai_generation', BOOTSTRAP_POSTS)) {
      try {
        const start = new Date();
        start.setDate(start.getDate() + 1);
        bootstrappedPosts = await generateContentCalendar({
          userId: user.userId,
          weeks: 2,
          postsPerWeek: 3,
          platforms: platformsForNiche(input.niche),
          startDate: start,
          status: 'draft',
        });
        for (let i = 0; i < bootstrappedPosts.length; i++) recordUsage(user.userId, 'ai_generation');
        notifyLinkedChats(
          user.userId,
          `🚀 Ton plan « ${input.productName} » est prêt !\n📝 ${bootstrappedPosts.length} idées de posts ont été rédigées et datées dans ton Hub de contenu — relis-les et valide. Demande-moi « mes brouillons » pour les voir ici.`,
        ).catch(() => { /* best-effort */ });
      } catch { /* le plan reste valide même si le bootstrap contenu échoue */ }
    }

    logEvent(user.userId, 'plan.created', plan.id, { productName: input.productName, niche: input.niche });

    const response: ApiResponse<LaunchPlan> & { bootstrappedPosts?: number } = {
      success: true,
      data: plan,
      bootstrappedPosts: bootstrappedPosts.length,
    };
    res.status(201).json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    };
    res.status(500).json(response);
  }
});

router.get('/', requireAuth, (req: Request, res: Response) => {
  try {
    const user = req.user as AuthPayload;
    const plans = getPlansByUserId(user.userId);

    const response: ApiResponse<LaunchPlan[]> = { success: true, data: plans };
    res.json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    };
    res.status(500).json(response);
  }
});

router.get('/:id', requireAuth, (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user as AuthPayload;
    const plan = getLaunchPlan(id);

    // Accès : propriétaire d'un projet perso OU membre de l'équipe propriétaire
    // (404 sinon, pour ne pas révéler l'existence du plan)
    if (!plan || !storage.getProjectRole(user.userId, id)) {
      const response: ApiResponse<null> = { success: false, error: `Plan with id "${id}" not found` };
      res.status(404).json(response);
      return;
    }

    const response: ApiResponse<LaunchPlan> = { success: true, data: plan };
    res.json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    };
    res.status(500).json(response);
  }
});

// ── POST /api/plan/:id/activate ──────────────────────────────────────────────
// Définit le projet de travail courant : le Hub, l'IA et le bot Telegram
// travaillent dans le contexte de ce projet.
router.post('/:id/activate', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const user = req.user as AuthPayload;
  const plan = getLaunchPlan(id);
  if (!plan || !storage.getProjectRole(user.userId, id)) {
    return res.status(404).json({ success: false, error: `Plan with id "${id}" not found` });
  }
  storage.setActivePlan(user.userId, id);
  res.json({ success: true, data: { activePlanId: id } });
});

// ── POST /api/plan/:id/team ──────────────────────────────────────────────────
// Rattache (teamId) ou détache (null) un projet à une équipe. Réservé au
// PROPRIÉTAIRE du projet, qui doit aussi être membre (owner/editor) de l'équipe.
router.post('/:id/team', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const user = req.user as AuthPayload;
  const plan = getLaunchPlan(id);
  if (!plan || plan.userId !== user.userId) {
    return res.status(404).json({ success: false, error: `Plan with id "${id}" not found` });
  }
  const teamId = (req.body as { teamId?: unknown }).teamId;
  if (teamId === null || teamId === undefined || teamId === '') {
    storage.setPlanTeam(id, null);
    return res.json({ success: true, data: { teamId: null } });
  }
  if (typeof teamId !== 'string') {
    return res.status(400).json({ success: false, error: 'teamId invalide' });
  }
  const role = storage.getTeamRole(teamId, user.userId);
  if (!role) return res.status(403).json({ success: false, error: 'Vous ne faites pas partie de cette équipe' });
  if (role === 'viewer') return res.status(403).json({ success: false, error: 'Rôle Lecteur : rattachement non autorisé' });
  storage.setPlanTeam(id, teamId);
  res.json({ success: true, data: { teamId } });
});

// Runs des agents pour ce plan (badges temps réel sur le Kanban)
router.get('/:id/runs', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const user = req.user as AuthPayload;
  const plan = getLaunchPlan(id);
  if (!plan || !storage.getProjectRole(user.userId, id)) {
    const response: ApiResponse<null> = { success: false, error: `Plan with id "${id}" not found` };
    res.status(404).json(response);
    return;
  }
  res.json({ success: true, data: storage.getRunsByPlanId(id) });
});

router.patch('/:id/kanban', requireAuth, (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const user = req.user as AuthPayload;
    const plan = getLaunchPlan(id);
    const role = storage.getProjectRole(user.userId, id);
    if (!plan || !role) {
      const response: ApiResponse<null> = { success: false, error: `Plan with id "${id}" not found` };
      res.status(404).json(response);
      return;
    }
    if (role === 'viewer') {
      return res.status(403).json({ success: false, error: 'Rôle Lecteur : modification non autorisée' });
    }
    const kanbanState = req.body as KanbanState;
    storage.updateKanbanState(id, kanbanState);
    const response: ApiResponse<KanbanState> = { success: true, data: kanbanState };
    res.json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false, error: err instanceof Error ? err.message : 'An unexpected error occurred',
    };
    res.status(500).json(response);
  }
});

export default router;
