/**
 * OAuth 2.0 « Sign in with Google » — flux Authorization Code, sans dépendance.
 *
 * Pourquoi sans librairie : l'app est 100 % JWT-stateless (pas de session
 * serveur). On reste donc minimal :
 *   1. /api/auth/google        → redirige vers l'écran de consentement Google
 *   2. /api/auth/google/callback → échange le `code` contre un `id_token` côté
 *      serveur (avec le client_secret), puis décode le profil.
 *
 * Le `id_token` est obtenu DIRECTEMENT depuis le endpoint token de Google, en
 * TLS, en réponse à une requête authentifiée par notre client_secret : on peut
 * donc faire confiance à son contenu sans revérifier la signature (c'est le
 * propre du flux Authorization Code côté serveur).
 *
 * Le `state` CSRF est un JWT court (10 min) signé avec JWT_SECRET : aucune
 * persistance nécessaire, ce qui colle au déploiement mono-VM derrière Caddy.
 */
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../middleware/auth';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface GoogleProfile {
  /** Identifiant stable du compte Google (claim `sub`) */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Base publique de l'app (Vite en dev, domaine HTTPS en prod) */
function appBaseUrl(): string {
  return (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
}

/**
 * URI de redirection — DOIT correspondre exactement à celle déclarée dans la
 * console Google Cloud (identifiants OAuth). Dérivée de APP_URL pour rester
 * correcte en dev comme en prod.
 */
export function googleRedirectUri(): string {
  return `${appBaseUrl()}/api/auth/google/callback`;
}

/** Page front vers laquelle le callback renvoie le navigateur (avec ?token=) */
export function frontCallbackUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${appBaseUrl()}/oauth/callback?${qs}`;
}

/** Jeton CSRF anti-forgery transporté dans le paramètre `state` */
export function signState(): string {
  return jwt.sign({ k: 'oauth_state' }, JWT_SECRET, { expiresIn: '10m' });
}

export function verifyState(state: string | undefined): boolean {
  if (!state) return false;
  try {
    const payload = jwt.verify(state, JWT_SECRET) as { k?: string };
    return payload.k === 'oauth_state';
  } catch {
    return false;
  }
}

/** URL de l'écran de consentement Google */
export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: googleRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** Décode (sans revérifier) le payload d'un JWT — voir l'en-tête du fichier */
function decodeJwtPayload(token: string): Record<string, any> {
  const part = token.split('.')[1];
  if (!part) throw new Error('id_token malformé');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

/** Échange le `code` d'autorisation contre le profil Google de l'utilisateur */
export async function exchangeCodeForProfile(code: string): Promise<GoogleProfile> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: googleRedirectUri(),
    grant_type: 'authorization_code',
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Échange du code Google échoué (HTTP ${res.status})`);
  }

  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error('Réponse Google sans id_token');

  const claims = decodeJwtPayload(tokens.id_token);
  if (!claims.sub || !claims.email) throw new Error('id_token Google incomplet');

  return {
    sub: String(claims.sub),
    email: String(claims.email).toLowerCase(),
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: claims.name ? String(claims.name) : '',
  };
}
