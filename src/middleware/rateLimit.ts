import { Request, Response, NextFunction } from 'express';

const requestCounts = new Map<string, { count: number; resetTime: number }>();
const WINDOW_MS = 60_000;
// L'app fait du polling léger (statut des runs Kanban toutes les 3 s, badge
// validations toutes les 30 s) : une limite trop basse provoquait des 429 en
// usage normal. 300/min absorbe les pollings tout en bloquant les abus.
const MAX_REQUESTS = 300;

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const record = requestCounts.get(ip);

  if (!record || now > record.resetTime) {
    requestCounts.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    next();
    return;
  }

  if (record.count >= MAX_REQUESTS) {
    res.status(429).json({
      success: false,
      error: 'Too many requests. Please try again later.',
    });
    return;
  }

  record.count++;
  next();
}

/**
 * Limiteur ciblé pour les routes d'authentification (anti force brute).
 * La clé combine l'IP et l'email du corps de requête : un attaquant ne peut
 * ni épuiser le quota d'un autre utilisateur, ni varier les emails pour
 * contourner la limite IP. En mémoire — suffisant pour un process unique.
 */
export function authRateLimit(opts: { windowMs: number; max: number; scope: string }) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  const cleaner = setInterval(() => {
    const now = Date.now();
    for (const [key, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(key);
    }
  }, opts.windowMs);
  cleaner.unref?.();

  return (req: Request, res: Response, next: NextFunction): void => {
    const email = typeof (req.body as { email?: unknown })?.email === 'string'
      ? (req.body as { email: string }).email.toLowerCase().trim()
      : '';
    const key = `${opts.scope}:${req.ip}:${email}`;
    const now = Date.now();

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
      next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > opts.max) {
      const retryS = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryS));
      res.status(429).json({
        success: false,
        error: `Trop de tentatives — réessayez dans ${Math.max(1, Math.ceil(retryS / 60))} min.`,
      });
      return;
    }
    next();
  };
}
