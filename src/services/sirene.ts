/**
 * Identité légale des entreprises françaises — via l'API publique
 * recherche-entreprises.api.gouv.fr (gratuite, sans clé, données SIRENE).
 *
 * Pipeline déterministe (aucun coût IA ni quota) : recherche par nom
 * (+ département si déductible), scoring des résultats par similarité de nom,
 * puis extraction SIREN / raison sociale / code NAF / adresse du siège.
 */

const API_BASE = 'https://recherche-entreprises.api.gouv.fr';

/** Fetch injectable pour les tests */
export type FetchLike = typeof fetch;

export interface CompanyLegal {
  siren: string;
  legalName: string | null;
  /** Code NAF/APE de l'activité principale (ex. « 62.01Z ») */
  naf: string | null;
  /** Adresse du siège social */
  address: string | null;
  /**
   * CA du dernier exercice publié à l'INPI, formaté (« 311,4 M€ (2024) »).
   * Null si l'entreprise a déposé ses comptes avec option de confidentialité
   * (fréquent chez les TPE/PME) — dans ce cas le CA n'est pas public.
   */
  revenue: string | null;
}

const s = (v: unknown, max = 300): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** Normalise un nom d'entreprise pour la comparaison (casse, accents, forme juridique). */
export function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(sas|sasu|sarl|eurl|sa|sci|scop|snc|selarl|gie|ei|micro[- ]?entreprise)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

interface SearchResult {
  siren?: string;
  nom_complet?: string;
  nom_raison_sociale?: string;
  activite_principale?: string;
  siege?: { adresse?: string; activite_principale?: string };
  /** Comptes annuels publiés (INPI) : { "2024": { ca, resultat_net } } */
  finances?: Record<string, { ca?: number | null; resultat_net?: number | null }>;
}

/** Montant compact à la française (« 311,4 M€ », « 850 k€ »). */
function compactEur(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Md€`;
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M€`;
  if (n >= 1e3) return `${Math.round(n / 1e3).toLocaleString('fr-FR')} k€`;
  return `${Math.round(n).toLocaleString('fr-FR')} €`;
}

/** CA du dernier exercice publié (« 311,4 M€ (2024) ») — null si non publié. */
export function latestRevenue(finances: SearchResult['finances']): string | null {
  if (!finances || typeof finances !== 'object') return null;
  const years = Object.keys(finances).filter((y) => /^\d{4}$/.test(y)).sort();
  for (let i = years.length - 1; i >= 0; i--) {
    const ca = finances[years[i]]?.ca;
    if (typeof ca === 'number' && ca > 0) return `${compactEur(ca)} (${years[i]})`;
  }
  return null;
}

/**
 * Choisit le résultat le plus proche du nom cherché — null si rien d'assez
 * proche (mieux vaut pas de SIREN qu'un SIREN d'une autre entreprise).
 */
export function pickBestLegalMatch(name: string, results: SearchResult[]): SearchResult | null {
  // Recherche directe par SIREN (ré-enrichissement d'une fiche déjà identifiée)
  if (/^\d{9}$/.test(name.trim())) {
    return results.find((r) => r?.siren === name.trim()) ?? null;
  }
  const target = normalizeCompanyName(name);
  if (!target) return null;
  const targetTokens = new Set(target.split(' '));

  let best: SearchResult | null = null;
  let bestScore = 0;
  for (const r of results) {
    if (!r?.siren || !/^\d{9}$/.test(r.siren)) continue;
    for (const candidate of [r.nom_complet, r.nom_raison_sociale]) {
      const norm = candidate ? normalizeCompanyName(candidate) : '';
      if (!norm) continue;
      let score = 0;
      if (norm === target) score = 3;
      else if (norm.includes(target) || target.includes(norm)) score = 2;
      else {
        // Recouvrement de mots : au moins la moitié des mots cherchés présents
        const tokens = norm.split(' ');
        const hits = tokens.filter((t) => targetTokens.has(t)).length;
        if (hits >= Math.max(1, Math.ceil(targetTokens.size / 2))) score = 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
    if (bestScore === 3) break; // correspondance exacte : inutile de continuer
  }
  return bestScore >= 1 ? best : null;
}

/**
 * Recherche l'identité légale (SIREN…) d'une entreprise par son nom.
 * Renvoie null si l'entreprise est introuvable ou trop ambiguë — n'invente
 * jamais. Les erreurs réseau/API sont avalées (l'enrichissement continue sans).
 */
export async function lookupCompanyLegal(
  name: string,
  fetchFn: FetchLike = fetch,
): Promise<CompanyLegal | null> {
  const q = name.trim();
  if (q.length < 2) return null;
  try {
    const res = await fetchFn(
      `${API_BASE}/search?q=${encodeURIComponent(q)}&per_page=10&page=1`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    const results: SearchResult[] = Array.isArray(data?.results) ? data.results : [];
    const match = pickBestLegalMatch(q, results);
    if (!match?.siren) return null;
    return {
      siren: match.siren,
      legalName: s(match.nom_raison_sociale, 200) ?? s(match.nom_complet, 200),
      naf: s(match.activite_principale ?? match.siege?.activite_principale, 10),
      address: s(match.siege?.adresse, 300),
      revenue: latestRevenue(match.finances),
    };
  } catch {
    return null; // API injoignable : l'enrichissement continue sans identité légale
  }
}

/** SIREN affichable « 123 456 789 » (les données SIRENE le stockent compact). */
export function formatSiren(siren: string): string {
  return siren.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
}
