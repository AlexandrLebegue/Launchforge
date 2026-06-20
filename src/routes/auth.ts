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
const profileLimiter  = authRateLimit({ scope: 'profile',  windowMs: 15 * 60_000, max: 30 });

// Validation d'email volontairement simple (présence d'un « x@y.z ») — la
// confiance vient de l'usage, pas d'une regex exhaustive.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    storage.saveUser({ id, email, name: name || '', createdAt: now }, hashed);
    // Chaque nouveau compte a sa propre entité Composio (connexions isolées) ;
    // les comptes créés avant le multi-utilisateur restent sur l'identité legacy.
    storage.setComposioUserId(id, `lf-${id}`);
    // Essai « reverse trial » : 15 jours d'accès complet (Brasier), puis Braise.
    storage.startTrial(id);
    logEvent(id, 'user.register', id, { email });

    const token = signToken({ userId: id, email });
    // Relecture : porte tutorialPending=true (déclenche le tutoriel d'accueil
    // côté client, après la création du 1er projet).
    const user = storage.getUserById(id)!;
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
    // getUserById : porte tutorialPending (false pour un compte déjà passé par
    // le tutoriel) sans jamais exposer le hash du mot de passe.
    const userData = storage.getUserById(user.id)!;
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
      // Essai « reverse trial » : 15 jours d'accès complet (Brasier), puis Braise.
      storage.startTrial(id);
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
// propre uniquement). La session JWT authentifie la demande ; la confirmation
// se fait côté client (pop-up oui/non).
router.delete('/account', deleteLimiter, requireAuth, async (req: Request, res: Response) => {
  const me = storage.getUserById(req.user!.userId);
  if (!me) return res.status(404).json({ success: false, error: 'Compte introuvable.' });

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

// ── POST /api/auth/tutorial-seen ─────────────────────────────────────────────
// Le client appelle ce point dès qu'il lance le tutoriel d'accueil : on consomme
// le drapeau pour qu'il ne se repropose jamais (autres sessions/appareils inclus).
router.post('/tutorial-seen', requireAuth, (req: Request, res: Response) => {
  storage.clearTutorialPending(req.user!.userId);
  res.json({ success: true, data: { tutorialPending: false } });
});

// ── PATCH /api/auth/me — RGPD art. 16 (rectification) ───────────────────────
// Met à jour le profil : nom, email, et/ou mot de passe. Les changements
// sensibles (email, mot de passe) exigent le mot de passe actuel quand le compte
// en possède un (les comptes Google seuls n'en ont pas — la session JWT fait foi
// et leur permet d'en définir un). Un changement d'email réémet un JWT : le
// jeton porte l'email dans ses claims, l'ancien deviendrait incohérent.
router.patch('/me', profileLimiter, requireAuth, (req: Request, res: Response) => {
  const { name, email, currentPassword, newPassword } = req.body as {
    name?: string; email?: string; currentPassword?: string; newPassword?: string;
  };

  const me = storage.getUserById(req.user!.userId);
  if (!me) return res.status(404).json({ success: false, error: 'Compte introuvable.' });
  // Ligne avec le hash (getUserById ne l'expose pas) pour vérifier le mot de passe
  const account = storage.getUserByEmail(me.email);
  const hasPassword = Boolean(account && account.password);

  const updates: { name?: string; email?: string } = {};
  let emailChanged = false;

  // Le mot de passe actuel n'est demandé/vérifié qu'une fois, mutualisé entre le
  // changement d'email et de mot de passe.
  const verifyCurrent = (): boolean =>
    !hasPassword || (typeof currentPassword === 'string' && verifyPassword(currentPassword, account!.password));

  // ── Nom (libre) ──
  if (typeof name === 'string' && name.trim() !== me.name) {
    updates.name = name.trim().slice(0, 120);
  }

  // ── Email ──
  if (typeof email === 'string' && email.trim().toLowerCase() !== me.email.toLowerCase()) {
    const normalized = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normalized)) {
      return res.status(400).json({ success: false, error: 'Adresse email invalide.' });
    }
    const taken = storage.getUserByEmail(normalized);
    if (taken && taken.id !== me.id) {
      return res.status(409).json({ success: false, error: 'Cette adresse email est déjà utilisée.' });
    }
    if (!verifyCurrent()) {
      return res.status(401).json({ success: false, error: 'Mot de passe actuel incorrect.' });
    }
    updates.email = normalized;
    emailChanged = true;
  }

  // ── Mot de passe ──
  if (typeof newPassword === 'string' && newPassword.length > 0) {
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Le mot de passe doit faire au moins 6 caractères.' });
    }
    if (!verifyCurrent()) {
      return res.status(401).json({ success: false, error: 'Mot de passe actuel incorrect.' });
    }
    storage.updateUserPassword(me.id, hashPassword(newPassword));
  }

  if (updates.name !== undefined || updates.email !== undefined) {
    storage.updateUserProfile(me.id, updates);
  }

  const updated = storage.getUserById(me.id)!;
  logEvent(me.id, 'user.profile_update', me.id, {
    fields: [
      ...(updates.name !== undefined ? ['name'] : []),
      ...(emailChanged ? ['email'] : []),
      ...(typeof newPassword === 'string' && newPassword.length > 0 ? ['password'] : []),
    ],
  });

  const data: { user: User; token?: string } = { user: updated };
  if (emailChanged) data.token = signToken({ userId: me.id, email: updated.email });
  res.json({ success: true, data });
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
