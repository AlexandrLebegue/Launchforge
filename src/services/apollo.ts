/**
 * Enrichissement de contacts via Apollo.io — avec la clé API PERSONNELLE de
 * l'utilisateur (jamais une clé globale : les crédits consommés sont les siens).
 *
 * Lecture déterministe (aucun coût IA), deux niveaux :
 *  - enrichPersonWithApollo : POST people/match — poste, LinkedIn, email pro
 *    vérifié + fiche de l'entreprise embarquée. Peut être indisponible selon
 *    le plan Apollo (403) — l'appelant bascule alors sur l'organisation seule.
 *  - enrichOrganizationWithApollo : GET organizations/enrich — fiche entreprise
 *    (secteur, effectif, description, téléphone standard) par nom/domaine.
 *
 * Téléphones : Apollo les livre en ASYNCHRONE via webhook (reveal_phone_number
 * + webhook_url). On ne l'active que si l'appelant fournit une URL publique.
 */

const API_BASE = 'https://api.apollo.io/api/v1';

/** Fetch injectable pour les tests */
export type FetchLike = typeof fetch;

export interface ApolloOrganization {
  name: string | null;
  domain: string | null;
  industry: string | null;
  /** Effectif estimé, formaté (« ~120 pers. ») */
  size: string | null;
  description: string | null;
  linkedinUrl: string | null;
  /** Téléphone standard de l'entreprise (numéro public, pas un portable) */
  phone: string | null;
}

export interface ApolloEnrichment {
  title: string | null;
  headline: string | null;
  linkedinUrl: string | null;
  email: string | null;
  /** Téléphone direct si présent dans la réponse (sinon livré via webhook) */
  phone: string | null;
  city: string | null;
  country: string | null;
  organization: ApolloOrganization | null;
}

const s = (v: unknown, max = 300): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

function headers(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'x-api-key': apiKey,
  };
}

/** Traduit les erreurs HTTP Apollo en messages actionnables (français). */
function apolloError(status: number): Error {
  if (status === 401) return new Error('Clé API Apollo invalide ou révoquée — vérifiez-la dans Configuration › Comptes connectés');
  if (status === 402) return new Error('Crédits Apollo épuisés — rechargez votre compte Apollo.io');
  if (status === 403) return new Error('non disponible sur votre plan Apollo');
  if (status === 429) return new Error('Limite de requêtes Apollo atteinte — réessayez dans une minute');
  return new Error(`Apollo a répondu ${status} — réessayez plus tard`);
}

/** Vérifie la clé auprès d'Apollo (health check, aucun crédit consommé). */
export async function verifyApolloKey(apiKey: string, fetchFn: FetchLike = fetch): Promise<boolean> {
  const res = await fetchFn(`${API_BASE}/auth/health`, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return false;
  const data: any = await res.json().catch(() => null);
  return data?.is_logged_in === true;
}

/** Normalise l'organisation Apollo (embarquée dans person ou renvoyée seule). */
function mapOrganization(org: any): ApolloOrganization | null {
  if (!org || typeof org !== 'object') return null;
  const employees = Number(org.estimated_num_employees);
  return {
    name: s(org.name, 200),
    domain: s(org.primary_domain, 120) ?? s(org.domain, 120),
    industry: s(org.industry, 120),
    size: Number.isFinite(employees) && employees > 0 ? `~${employees} pers.` : null,
    description: s(org.short_description, 500) ?? s(org.seo_description, 500),
    linkedinUrl: s(org.linkedin_url, 300),
    phone: s(org.sanitized_phone, 40) ?? s(org.phone, 40),
  };
}

/** Premier numéro exploitable d'une liste phone_numbers Apollo. */
function firstPhone(numbers: unknown): string | null {
  if (!Array.isArray(numbers)) return null;
  for (const n of numbers) {
    const v = s((n as any)?.sanitized_number, 40) ?? s((n as any)?.raw_number, 40);
    if (v) return v;
  }
  return null;
}

/**
 * Identifie et enrichit une personne. Renvoie null si Apollo ne la trouve pas.
 * Consomme les crédits Apollo de l'utilisateur quand des données sont trouvées.
 * `webhookUrl` (URL publique) active la révélation du téléphone : Apollo
 * livre le numéro en asynchrone sur cette URL (voir routes/webhooks.ts).
 */
export async function enrichPersonWithApollo(
  apiKey: string,
  params: { name: string; email?: string | null; company?: string | null; domain?: string | null },
  webhookUrl: string | null = null,
  fetchFn: FetchLike = fetch,
): Promise<ApolloEnrichment | null> {
  const body: Record<string, unknown> = {
    name: params.name,
    reveal_personal_emails: false,
    // Le téléphone exige une URL de webhook publique (livraison asynchrone)
    reveal_phone_number: Boolean(webhookUrl),
  };
  if (webhookUrl) body.webhook_url = webhookUrl;
  if (params.email) body.email = params.email;
  if (params.company) body.organization_name = params.company;
  if (params.domain) body.domain = params.domain;

  const res = await fetchFn(`${API_BASE}/people/match`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw apolloError(res.status);

  const data: any = await res.json().catch(() => null);
  const person = data?.person;
  if (!person || typeof person !== 'object') return null;

  // Les emails masqués (plan gratuit sans crédit) sortent en « email_not_unlocked@… »
  const email = s(person.email, 200);
  return {
    title: s(person.title, 200),
    headline: s(person.headline, 300),
    linkedinUrl: s(person.linkedin_url, 300),
    email: email && !email.startsWith('email_not_unlocked') ? email : null,
    phone: firstPhone(person.phone_numbers),
    city: s(person.city, 120),
    country: s(person.country, 120),
    organization: mapOrganization(person.organization),
  };
}

/**
 * Enrichit une ENTREPRISE seule (sans passer par la personne) — utile quand
 * people/match n'est pas accessible sur le plan Apollo de l'utilisateur.
 * Renvoie null si Apollo ne trouve pas l'entreprise.
 */
export async function enrichOrganizationWithApollo(
  apiKey: string,
  params: { name?: string | null; domain?: string | null },
  fetchFn: FetchLike = fetch,
): Promise<ApolloOrganization | null> {
  const qs = new URLSearchParams();
  if (params.domain) qs.set('domain', params.domain);
  if (params.name) qs.set('name', params.name);
  if ([...qs.keys()].length === 0) return null;

  const res = await fetchFn(`${API_BASE}/organizations/enrich?${qs}`, {
    headers: headers(apiKey),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw apolloError(res.status);

  const data: any = await res.json().catch(() => null);
  return mapOrganization(data?.organization);
}
