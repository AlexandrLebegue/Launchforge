import { Request, Response, NextFunction } from 'express';

const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? 'alexandrelebegue12@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

export function isAdminEmail(email: string): boolean {
  return ADMIN_EMAILS.has(email.toLowerCase());
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !isAdminEmail(req.user.email)) {
    res.status(403).json({ success: false, error: 'Admin access required.' });
    return;
  }
  next();
}
