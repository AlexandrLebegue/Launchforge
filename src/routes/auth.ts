import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { createHash, randomBytes } from 'crypto';
import { hashPassword, verifyPassword } from '../services/password';
import { signToken, requireAuth } from '../middleware/auth';
import { authRateLimit } from '../middleware/rateLimit';
import { storage } from '../services/storage';
import { logEvent } from '../services/adminLogger';
import {
  isGoogleOAuthConfigured,
  buildGoogleAuthUrl,
  signState,
  verifyState,
  exchangeCodeForProfile,
  frontCallbackUrl,
} from '../services/oauthGoogle';
import { ApiResponse, User, AuthPayload } from '../types';

const router = Router();

// Anti force brute : limites par IP+email, bien au-dessus de l'usage normal
const loginLimiter    = authRateLimit({ scope: 'login',    windowMs: 10 * 60_000, max: 10 });
const registerLimiter = authRateLimit({ scope: 'register', windowMs: 60 * 60_000, max: 20 });
const forgotLimiter   = authRateLimit({ scope: 'forgot',   windowMs: 15 * 60_000, max: 5 });
const resetLimiter    = authRateLimit({ scope: 'reset',    windowMs: 15 * 60_000, max: 10 });
const deleteLimiter   = authRateLimit({ scope: 'delete',   windowMs: 15 * 60_000, max: 5 });

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
    logEvent(id, 'user.register', id, { email });

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
    logEvent(user.id, 'user.login', user.id, { email: user.email });

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

// ── OAuth « Sign in with Google » ───────────────────────────────────────────
// Flux Authorization Code, stateless (state = JWT court). Voir
// src/services/oauthGoogle.ts pour les détails du flux et de la confiance.

// Le front n'affiche le bouton Google que si le serveur est configuré.
router.get('/oauth-status', (_req: Request, res: Response) => {
  res.json({ success: true, data: { google: isGoogleOAuthConfigured() } });
});

// Démarrage : redirige le navigateur vers l'écran de consentement Google.
router.get('/google', (_req: Request, res: Response) => {
  if (!isGoogleOAuthConfigured()) {
    return res.redirect(frontCallbackUrl({ error: 'google_not_configured' }));
  }
  res.redirect(buildGoogleAuthUrl(signState()));
});

// Retour de Google : échange le code, crée/retrouve le compte, signe un JWT et
// renvoie le navigateur vers le front avec le token (ou une erreur).
router.get('/google/callback', async (req: Request, res: Response) => {
  const { code, state, error: googleError } = req.query as Record<string, string | undefined>;

  if (googleError) return res.redirect(frontCallbackUrl({ error: 'access_denied' }));
  if (!code || !verifyState(state)) {
    return res.redirect(frontCallbackUrl({ error: 'invalid_state' }));
  }

  try {
    const profile = await exchangeCodeForProfile(code);
    // Email non vérifié chez Google : on refuse (anti-usurpation de compte).
    if (!profile.emailVerified) {
      return res.redirect(frontCallbackUrl({ error: 'email_unverified' }));
    }

    // 1. Compte déjà rattaché à ce Google
    let user = storage.getUserByProvider('google', profile.sub);

    // 2. Sinon, compte local existant avec le même email (vérifié) → rattachement
    if (!user) {
      const byEmail = storage.getUserByEmail(profile.email);
      if (byEmail) {
        storage.linkProvider(byEmail.id, 'google', profile.sub);
        user = storage.getUserById(byEmail.id);
        logEvent(byEmail.id, 'user.oauth_link', byEmail.id, { provider: 'google' });
      }
    }

    // 3. Sinon, création d'un nouveau compte (même init que /register)
    if (!user) {
      const id = uuidv4();
      const now = new Date().toISOString();
      const newUser: User = { id, email: profile.email, name: profile.name, createdAt: now };
      storage.saveOAuthUser(newUser, 'google', profile.sub);
      storage.setComposioUserId(id, `lf-${id}`);
      logEvent(id, 'user.register', id, { email: profile.email, provider: 'google' });
      user = newUser;
    }

    const token = signToken({ userId: user!.id, email: user!.email });
    logEvent(user!.id, 'user.login', user!.id, { email: user!.email, provider: 'google' });
    res.redirect(frontCallbackUrl({ token }));
  } catch (err) {
    console.error('OAuth Google callback:', err instanceof Error ? err.message : err);
    res.redirect(frontCallbackUrl({ error: 'oauth_failed' }));
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

// ── GET /api/auth/export — RGPD art. 20 (portabilité) ───────────────────────
// Toutes les données de l'utilisateur en un JSON téléchargeable.
router.get('/export', requireAuth, (req: Request, res: Response) => {
  const data = storage.exportUserData(req.user!.userId);
  res.setHeader('Content-Disposition', 'attachment; filename="launchforge-mes-donnees.json"');
  res.json(data);
});

// ── DELETE /api/auth/account — RGPD art. 17 (droit à l'effacement) ──────────
// Suppression DÉFINITIVE de tout : compte, projets, posts, contacts,
// connaissances, médias locaux, liaisons Telegram, comptes Composio (identité
// propre uniquement). Re-authentification par mot de passe exigée.
router.delete('/account', deleteLimiter, requireAuth, async (req: Request, res: Response) => {
  const { password } = req.body as { password?: string };
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ success: false, error: 'Confirmez votre mot de passe pour supprimer le compte.' });
  }
  const me = storage.getUserById(req.user!.userId);
  if (!me) return res.status(404).json({ success: false, error: 'Compte introuvable.' });
  const withPassword = storage.getUserByEmail(me.email);
  if (!withPassword || !verifyPassword(password, withPassword.password)) {
    return res.status(401).json({ success: false, error: 'Mot de passe incorrect.' });
  }

  // 1. Services externes, best-effort (l'effacement local n'attend pas leur succès)
  try {
    const { removeUserBot } = await import('../services/telegramBot');
    removeUserBot(me.id); // arrête le poller du bot personnel
  } catch { /* best-effort */ }
  let composioRemoved = 0;
  try {
    const { disconnectAllToolkits } = await import('../services/composioConnect');
    composioRemoved = await disconnectAllToolkits(me.id); // identité propre uniquement
  } catch { /* best-effort */ }

  // 2. Effacement transactionnel de toutes les données + médias locaux
  const mediaFiles = storage.deleteUserData(me.id);
  try {
    const { deleteMediaFile } = await import('../services/mediaStore');
    for (const f of mediaFiles) deleteMediaFile(f);
  } catch { /* best-effort */ }

  console.log(`🗑️  RGPD : compte ${me.email} supprimé (${mediaFiles.length} média(s), ${composioRemoved} compte(s) Composio)`);
  logEvent(me.id, 'user.delete', me.id, { email: me.email });
  res.json({ success: true, data: { deleted: true } });
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
