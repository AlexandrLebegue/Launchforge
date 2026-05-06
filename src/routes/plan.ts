import { Router, Request, Response } from 'express';
import { createLaunchPlan, getLaunchPlan } from '../services/planGenerator';
import { storage } from '../services/storage';
import { validatePlanInput } from '../middleware/validation';
import { PlanInput, ApiResponse, LaunchPlan } from '../types';

const router = Router();

router.post('/', validatePlanInput, (req: Request, res: Response) => {
  try {
    const input = req.body as PlanInput;
    const plan = createLaunchPlan(input);

    const response: ApiResponse<LaunchPlan> = {
      success: true,
      data: plan,
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

router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const plan = getLaunchPlan(id);

    if (!plan) {
      const response: ApiResponse<null> = {
        success: false,
        error: `Plan with id "${id}" not found`,
      };
      res.status(404).json(response);
      return;
    }

    const response: ApiResponse<LaunchPlan> = {
      success: true,
      data: plan,
    };
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
