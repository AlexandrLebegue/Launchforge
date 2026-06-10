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
