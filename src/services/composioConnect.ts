/**
 * Connexion des comptes Composio directement depuis l'application :
 * trouve (ou crée) la configuration d'auth gérée par Composio du toolkit,
 * rattache le toolkit au serveur MCP de l'app, puis génère le lien OAuth
 * pour le user_id utilisé par LaunchForge — l'utilisateur n'a plus qu'à
 * autoriser dans son navigateur, sans passer par le dashboard Composio.
 */

const COMPOSIO_API = 'https://backend.composio.dev/api/v3';

import { storage } from './storage';

/** user_id Composio legacy de l'application (extrait de COMPOSIO_MCP_URL) */
export function composioUserId(): string | null {
  try {
    return new URL(process.env.COMPOSIO_MCP_URL || '').searchParams.get('user_id');
  } catch {
    return null;
  }
}

/**
 * Identité Composio d'un utilisateur LaunchForge :
 *  - comptes récents → entité dédiée `lf-<id>` (posée à l'inscription) ;
 *  - comptes d'avant le multi-utilisateur (colonne NULL) → user_id de l'URL
 *    env, pour que leurs connexions existantes continuent de fonctionner.
 */
export function composioUserIdFor(userId: string): string | null {
  return storage.getComposioUserId(userId) ?? composioUserId();
}

/** Identifiant du serveur MCP (extrait du chemin de COMPOSIO_MCP_URL) */
export function mcpServerId(): string | null {
  try {
    const path = new URL(process.env.COMPOSIO_MCP_URL || '').pathname;
    const m = path.match(/\/mcp\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

async function composioApi(path: string, init?: RequestInit): Promise<any> {
  const key = process.env.COMPOSIO_API_KEY;
  if (!key) throw new Error('COMPOSIO_NOT_CONFIGURED');
  const res = await fetch(`${COMPOSIO_API}${path}`, {
    ...init,
    headers: {
      'x-api-key': key,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* page HTML d'erreur */ }
  if (!res.ok) {
    const msg = body?.error?.message || `Composio API ${res.status}`;
    throw new Error(msg);
  }
  return body;
}

/** Config d'auth existante pour ce toolkit, sinon création (auth gérée Composio) */
async function ensureAuthConfig(toolkit: string): Promise<string> {
  const list = await composioApi('/auth_configs?limit=100');
  const existing = (list?.items || []).find(
    (a: any) => String(a?.toolkit?.slug).toLowerCase() === toolkit
  );
  if (existing?.id) return existing.id;

  // Le toolkit doit proposer une auth gérée par Composio — sinon il faut
  // créer sa propre app développeur (ex. X/Twitter, TikTok)
  const tk = await composioApi(`/toolkits/${toolkit}`).catch(() => null);
  if (!tk) throw new Error(`La plateforme « ${toolkit} » n'existe pas chez Composio`);
  if (!Array.isArray(tk.composio_managed_auth_schemes) || tk.composio_managed_auth_schemes.length === 0) {
    throw new Error(
      `${toolkit} nécessite votre propre app développeur (OAuth non géré par Composio) — créez la config sur dashboard.composio.dev`
    );
  }

  const created = await composioApi('/auth_configs', {
    method: 'POST',
    body: JSON.stringify({
      toolkit: { slug: toolkit },
      auth_config: { type: 'use_composio_managed_auth' },
    }),
  });
  const id = created?.auth_config?.id || created?.id;
  if (!id) throw new Error('Création de la configuration d\'authentification échouée');
  return id;
}

/** Ajoute le toolkit + sa config d'auth au serveur MCP s'ils n'y sont pas déjà */
async function ensureServerToolkit(toolkit: string, authConfigId: string): Promise<void> {
  const serverId = mcpServerId();
  if (!serverId) return; // URL MCP atypique : les outils existants continuent de fonctionner
  const server = await composioApi(`/mcp/${serverId}`);
  const toolkits: string[] = Array.isArray(server?.toolkits) ? server.toolkits : [];
  const authIds: string[] = Array.isArray(server?.auth_config_ids) ? server.auth_config_ids : [];
  if (toolkits.includes(toolkit) && authIds.includes(authConfigId)) return;
  await composioApi(`/mcp/${serverId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      toolkits: [...new Set([...toolkits, toolkit])],
      auth_config_ids: [...new Set([...authIds, authConfigId])],
    }),
  });
}

/**
 * Déconnecte un toolkit pour un utilisateur LaunchForge : supprime TOUS ses
 * comptes connectés de ce toolkit chez Composio (y compris expirés/en échec,
 * pour repartir proprement). Retourne le nombre de comptes supprimés.
 * Cas d'usage : re-autoriser avec de nouveaux droits OAuth (ex. mise à jour
 * des scopes LinkedIn) — déconnecter puis reconnecter.
 */
export async function disconnectToolkit(lfUserId: string, toolkit: string): Promise<number> {
  const userId = composioUserIdFor(lfUserId);
  if (!userId) throw new Error('COMPOSIO_NOT_CONFIGURED');

  const list = await composioApi(`/connected_accounts?limit=100&user_ids=${encodeURIComponent(userId)}`);
  // Garde-fou multi-utilisateur : uniquement les comptes de SON identité
  const targets = (list?.items || []).filter((a: any) =>
    a?.id && a?.user_id === userId && String(a?.toolkit?.slug).toLowerCase() === toolkit);

  for (const account of targets) {
    await composioApi(`/connected_accounts/${account.id}`, { method: 'DELETE' });
  }
  return targets.length;
}

/**
 * RGPD : supprime chez Composio TOUS les comptes connectés de l'utilisateur.
 * Uniquement pour une identité PROPRE (lf-<id>) — jamais pour l'identité
 * legacy de l'env, partagée avec la boîte système de l'application.
 */
export async function disconnectAllToolkits(lfUserId: string): Promise<number> {
  const ownIdentity = storage.getComposioUserId(lfUserId);
  if (!ownIdentity || !process.env.COMPOSIO_API_KEY) return 0;

  const list = await composioApi(`/connected_accounts?limit=100&user_ids=${encodeURIComponent(ownIdentity)}`);
  const targets = (list?.items || []).filter((a: any) => a?.id && a?.user_id === ownIdentity);
  for (const account of targets) {
    await composioApi(`/connected_accounts/${account.id}`, { method: 'DELETE' }).catch(() => { /* best-effort */ });
  }
  return targets.length;
}

/**
 * Prépare la connexion d'un compte POUR un utilisateur LaunchForge donné et
 * retourne le lien d'autorisation OAuth à ouvrir dans son navigateur.
 */
export async function createConnectLink(lfUserId: string, toolkit: string): Promise<string> {
  const userId = composioUserIdFor(lfUserId);
  if (!userId) {
    throw new Error('COMPOSIO_MCP_URL ne contient pas de user_id — impossible de rattacher le compte');
  }

  const authConfigId = await ensureAuthConfig(toolkit);
  await ensureServerToolkit(toolkit, authConfigId);

  const account = await composioApi('/connected_accounts', {
    method: 'POST',
    body: JSON.stringify({
      auth_config: { id: authConfigId },
      connection: { user_id: userId },
    }),
  });
  const redirectUrl =
    account?.connectionData?.val?.redirectUrl || account?.redirect_url || account?.redirectUrl;
  if (!redirectUrl) {
    throw new Error('Composio n\'a pas fourni de lien d\'autorisation pour ce compte');
  }
  return redirectUrl;
}
