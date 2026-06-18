/**
 * Helper commun : traduit une QuotaError (offre Braise dépassée) en réponse
 * HTTP 402 « Payment Required ». Renvoie true si l'erreur a été gérée.
 */
import { Response } from 'express';
import { QuotaError, FeatureError } from '../services/entitlements';

export function handleQuota(res: Response, err: unknown): boolean {
  if (err instanceof QuotaError) {
    res.status(402).json({
      success: false,
      error: err.message,
      code: err.code,
      resource: err.resource,
      used: err.used,
      limit: err.limit,
    });
    return true;
  }
  if (err instanceof FeatureError) {
    res.status(402).json({
      success: false,
      error: err.message,
      code: err.code,
      feature: err.feature,
    });
    return true;
  }
  return false;
}
