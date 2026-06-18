import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthPayload, ApiResponse } from '../types';

export const JWT_SECRET = process.env.JWT_SECRET || 'launchforge-dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

// ── Sécurité : un JWT_SECRET par défaut/faible rend les jetons forgeables ──────
// (n'importe qui connaissant la valeur peut usurper tout compte, admin inclus).
const WEAK_JWT_SECRETS = new Set([
  '',
  'changez-moi-avec-openssl-rand-hex-32',
  'launchforge-dev-secret-change-in-production',
]);

/** Le secret JWT est-il absent, trop court, ou une valeur par défaut connue ? */
export function jwtSecretIsWeak(): boolean {
  const s = process.env.JWT_SECRET ?? '';
  return WEAK_JWT_SECRETS.has(s) || s.length < 16;
}

if (jwtSecretIsWeak()) {
  console.warn(
    '⚠️  JWT_SECRET faible ou par défaut : générez une valeur aléatoire forte ' +
    '(`openssl rand -hex 32`). Le démarrage est REFUSÉ en production (voir index.ts).',
  );
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, JWT_SECRET) as AuthPayload;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    const response: ApiResponse<null> = {
      success: false,
      error: 'Authentication required. Provide a Bearer token.',
    };
    res.status(401).json(response);
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = verifyToken(token);
    req.user = payload;
    next();
  } catch {
    const response: ApiResponse<null> = {
      success: false,
      error: 'Invalid or expired token.',
    };
    res.status(401).json(response);
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    try {
      req.user = verifyToken(token);
    } catch {
      // Token invalid, continue without auth
    }
  }

  next();
}
