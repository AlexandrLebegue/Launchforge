import { Router, Request, Response } from 'express';
import { createLaunchPlan, createAILaunchPlan, getLaunchPlan, getPlansByUserId } from '../services/planGenerator';
import { validatePlanInput } from '../middleware/validation';
import { storage } from '../services/storage';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { generateContentCalendar } from '../services/calendarGenerator';
import { platformsForNiche } from '../services/bootstrap';
import { notifyLinkedChats } from '../services/telegramBot';
import { PlanInput, ApiResponse, LaunchPlan, AuthPayload, KanbanState, Post } from '../types';

const router = Router();

router.post('/', requireAuth, validatePlanInput, async (req: Request, res: Response) => {
  try {
    const input = req.body as PlanInput;
    const user = req.user as AuthPayload;
    // AI generation by default when configured; createAILaunchPlan falls back
    // to templates internally, and mode=template forces the static templates.
    const mode = (req.body as any).mode
      || (process.env.OPENROUTER_API_KEY ? 'ai' : 'template');

    const plan = mode === 'ai'
      ? await createAILaunchPlan(input, user.userId)
      : createLaunchPlan(input, user.userId);

    // Bootstrap automatique du Hub de contenu : l'IA rédige et date les
    // premières idées de posts (brouillons à valider) dans la même requête —
    // le splashscreen côté client couvre l'attente, et l'utilisateur arrive
    // sur un hub déjà rempli.
    let bootstrappedPosts: Post[] = [];
    if (mode === 'ai' && process.env.OPENROUTER_API_KEY) {
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
        notifyLinkedChats(
          user.userId,
          `🚀 Ton plan « ${input.productName} » est prêt !\n📝 ${bootstrappedPosts.length} idées de posts ont été rédigées et datées dans ton Hub de contenu — relis-les et valide. Demande-moi « mes brouillons » pour les voir ici.`,
        ).catch(() => { /* best-effort */ });
      } catch { /* le plan reste valide même si le bootstrap contenu échoue */ }
    }

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

router.get('/:id', optionalAuth, (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const plan = getLaunchPlan(id);

    if (!plan) {
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
  if (!plan || plan.userId !== user.userId) {
    return res.status(404).json({ success: false, error: `Plan with id "${id}" not found` });
  }
  storage.setActivePlan(user.userId, id);
  res.json({ success: true, data: { activePlanId: id } });
});

// Runs des agents pour ce plan (badges temps réel sur le Kanban)
router.get('/:id/runs', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const user = req.user as AuthPayload;
  const plan = getLaunchPlan(id);
  if (!plan || plan.userId !== user.userId) {
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
    if (!plan || plan.userId !== user.userId) {
      const response: ApiResponse<null> = { success: false, error: `Plan with id "${id}" not found` };
      res.status(404).json(response);
      return;
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
