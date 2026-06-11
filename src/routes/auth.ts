import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { hashPassword, verifyPassword } from '../services/password';
import { signToken, requireAuth } from '../middleware/auth';
import { authRateLimit } from '../middleware/rateLimit';
import { storage } from '../services/storage';
import { ApiResponse, User, AuthPayload } from '../types';

const router = Router();

// Anti force brute : limites par IP+email, bien au-dessus de l'usage normal
const loginLimiter    = authRateLimit({ scope: 'login',    windowMs: 10 * 60_000, max: 10 });
const registerLimiter = authRateLimit({ scope: 'register', windowMs: 60 * 60_000, max: 20 });
const forgotLimiter   = authRateLimit({ scope: 'forgot',   windowMs: 15 * 60_000, max: 5 });
const resetLimiter    = authRateLimit({ scope: 'reset',    windowMs: 15 * 60_000, max: 10 });

router.post('/register', registerLimiter, (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      const response: ApiResponse<null> = { success: false, error: 'Email and password are required.' };
      res.status(400).json(response);
      return;
    }

    if (password.length < 6) {
      const response: ApiResponse<null> = { success: false, error: 'Password must be at least 6 characters.' };
      res.status(400).json(response);
      return;
    }

    const existing = storage.getUserByEmail(email);
    if (existing) {
      const response: ApiResponse<null> = { success: false, error: 'A user with this email already exists.' };
      res.status(409).json(response);
      return;
    }

    const id = uuidv4();
    const hashed = hashPassword(password);
    const now = new Date().toISOString();

    const user: User = { id, email, name: name || '', createdAt: now };
    storage.saveUser(user, hashed);
    // Chaque nouveau compte a sa propre entité Composio (connexions isolées) ;
    // les comptes créés avant le multi-utilisateur restent sur l'identité legacy.
    storage.setComposioUserId(id, `lf-${id}`);

    const token = signToken({ userId: id, email });
    const response: ApiResponse<{ user: User; token: string }> = { success: true, data: { user, token } };
    res.status(201).json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    };
    res.status(500).json(response);
  }
});

router.post('/login', loginLimiter, (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      const response: ApiResponse<null> = { success: false, error: 'Email and password are required.' };
      res.status(400).json(response);
      return;
    }

    const user = storage.getUserByEmail(email);
    if (!user) {
      const response: ApiResponse<null> = { success: false, error: 'Invalid email or password.' };
      res.status(401).json(response);
      return;
    }

    if (!verifyPassword(password, user.password)) {
      const response: ApiResponse<null> = { success: false, error: 'Invalid email or password.' };
      res.status(401).json(response);
      return;
    }

    const token = signToken({ userId: user.id, email: user.email });
    const userData: User = { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };

    const response: ApiResponse<{ user: User; token: string }> = { success: true, data: { user: userData, token } };
    res.json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error occurred',
    };
    res.status(500).json(response);
  }
});

const RESET_TOKEN_TTL_MS = 30 * 60_000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** URL publique de l'app (lien des emails) — Vite en dev, domaine en prod */
const appBaseUrl = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

/**
 * Envoi best-effort de l'email de réinitialisation depuis la boîte SYSTÈME de
 * l'app (identité Composio legacy de l'env — l'utilisateur n'a pas besoin
 * d'avoir connecté son propre Gmail). Retourne false si l'envoi est
 * impossible/échoue : le lien est alors journalisé côté serveur pour que
 * l'admin auto-hébergé puisse le relayer.
 */
async function sendResetEmail(to: string, link: string): Promise<boolean> {
  try {
    const { sendEmailViaComposio, isComposioConfigured } = await import('../services/leadAnalysis');
    const { isAIConfigured } = await import('../services/aiClient');
    if (!isComposioConfigured() || !isAIConfigured()) return false;
    const result = await sendEmailViaComposio(
      '__system__',
      to,
      'LaunchForge — réinitialisation de votre mot de passe',
      `Bonjour,\n\nVous avez demandé la réinitialisation de votre mot de passe LaunchForge.\n\nOuvrez ce lien (valable 30 minutes) pour en choisir un nouveau :\n${link}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email — votre mot de passe reste inchangé.\n\n— LaunchForge`,
    );
    return result.trim().toUpperCase().startsWith('OK');
  } catch {
    return false;
  }
}

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
// Réponse TOUJOURS générique (pas d'énumération d'emails). Jeton stocké haché,
// valable 30 min, à usage unique.
router.post('/forgot-password', forgotLimiter, async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  const generic: ApiResponse<{ message: string }> = {
    success: true,
    data: { message: 'Si un compte existe pour cet email, un lien de réinitialisation vient d\'être envoyé.' },
  };
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ success: false, error: 'Email is required.' });
  }

  const user = storage.getUserByEmail(email.toLowerCase().trim());
  if (user) {
    const token = randomBytes(32).toString('hex');
    storage.setResetToken(user.id, sha256(token), new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString());
    const link = `${appBaseUrl()}/reset-password?token=${token}`;
    const sent = await sendResetEmail(user.email, link);
    if (!sent) {
      // Filet de sécurité auto-hébergé : l'admin retrouve le lien dans les logs
      console.log(`🔑 Réinitialisation demandée pour ${user.email} — envoi d'email indisponible, lien : ${link}`);
    }
  }
  res.json(generic);
});

// ── POST /api/auth/reset-password ────────────────────────────────────────────
router.post('/reset-password', resetLimiter, (req: Request, res: Response) => {
  const { token, password } = req.body as { token?: string; password?: string };
  if (!token || typeof token !== 'string' || !password || typeof password !== 'string') {
    return res.status(400).json({ success: false, error: 'Token and password are required.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
  }

  const user = storage.getUserByResetTokenHash(sha256(token));
  if (!user || !user.resetTokenExpiresAt || new Date(user.resetTokenExpiresAt).getTime() < Date.now()) {
    return res.status(400).json({ success: false, error: 'Lien invalide ou expiré — refaites une demande de réinitialisation.' });
  }

  storage.updateUserPassword(user.id, hashPassword(password));
  storage.setResetToken(user.id, null, null); // usage unique

  // Connexion directe : l'utilisateur vient de prouver le contrôle de l'email
  const authToken = signToken({ userId: user.id, email: user.email });
  const userData = storage.getUserById(user.id)!;
  res.json({ success: true, data: { user: userData, token: authToken } });
});

router.get('/me', requireAuth, (req: Request, res: Response) => {
  try {
    const payload = req.user as AuthPayload;
    const user = storage.getUserById(payload.userId);

    if (!user) {
      const response: ApiResponse<null> = { success: false, error: 'User not found.' };
      res.status(404).json(response);
      return;
    }

    const response: ApiResponse<User> = { success: true, data: user };
    res.json(response);
  } catch (err) {
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'An unexpected error message',
    };
    res.status(500).json(response);
  }
});

export default router;
