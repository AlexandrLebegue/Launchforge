import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { validateFeedbackInput } from '../middleware/validation';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { FeedbackInput, Feedback, ApiResponse, AuthPayload } from '../types';

const router = Router();

router.post('/', requireAuth, validateFeedbackInput, (req: Request, res: Response) => {
  try {
    const { planId, rating, comment } = req.body as FeedbackInput;
    const user = req.user as AuthPayload;

    const plan = storage.getPlan(planId);
    if (!plan) {
      const response: ApiResponse<null> = { success: false, error: `Plan with id "${planId}" not found` };
      res.status(404).json(response);
      return;
    }

    const feedback: Feedback = {
      id: uuidv4(),
      planId,
      userId: user.userId,
      rating,
      comment: comment || null,
      createdAt: new Date().toISOString(),
    };

    storage.saveFeedback(feedback);
    const response: ApiResponse<Feedback> = { success: true, data: feedback };
    res.status(201).json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    };
    res.status(500).json(response);
  }
});

router.get('/:planId', (req: Request, res: Response) => {
  try {
    const { planId } = req.params;
    const feedbacks = storage.getFeedbacksByPlanId(planId);
    const response: ApiResponse<Feedback[]> = { success: true, data: feedbacks };
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
