import { Request, Response, NextFunction } from 'express';
import { PlanInput, FeedbackInput } from '../types';

export function validatePlanInput(req: Request, res: Response, next: NextFunction): void {
  const { productName, description, targetAudience, niche, goals, pricing } = req.body as Partial<PlanInput>;

  const errors: string[] = [];

  if (!productName || typeof productName !== 'string') errors.push('productName is required and must be a string');
  if (!description || typeof description !== 'string') errors.push('description is required and must be a string');
  if (!targetAudience || typeof targetAudience !== 'string') errors.push('targetAudience is required and must be a string');
  if (!niche || typeof niche !== 'string') errors.push('niche is required and must be a string');
  if (!Array.isArray(goals) || goals.length === 0) errors.push('goals is required and must be a non-empty array');
  if (!pricing || typeof pricing !== 'string') errors.push('pricing is required and must be a string');

  if (errors.length > 0) {
    res.status(400).json({ success: false, error: errors.join('; ') });
    return;
  }

  next();
}

export function validateFeedbackInput(req: Request, res: Response, next: NextFunction): void {
  const { planId, rating, comment } = req.body as Partial<FeedbackInput>;

  const errors: string[] = [];

  if (!planId || typeof planId !== 'string') errors.push('planId is required and must be a string');
  if (typeof rating !== 'number' || rating < 1 || rating > 5) errors.push('rating is required and must be a number between 1 and 5');
  if (comment !== undefined && typeof comment !== 'string') errors.push('comment must be a string if provided');

  if (errors.length > 0) {
    res.status(400).json({ success: false, error: errors.join('; ') });
    return;
  }

  next();
}
