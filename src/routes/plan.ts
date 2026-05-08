import { Router, Request, Response } from 'express';
import { createLaunchPlan, getLaunchPlan, getPlansByUserId } from '../services/planGenerator';
import { validatePlanInput } from '../middleware/validation';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { PlanInput, ApiResponse, LaunchPlan, AuthPayload } from '../types';

const router = Router();

router.post('/', requireAuth, validatePlanInput, (req: Request, res: Response) => {
  try {
    const input = req.body as PlanInput;
    const user = req.user as AuthPayload;
    const plan = createLaunchPlan(input, user.userId);

    const response: ApiResponse<LaunchPlan> = { success: true, data: plan };
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

export default router;
