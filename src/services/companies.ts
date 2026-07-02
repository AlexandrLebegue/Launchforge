/**
 * Comptes (entreprises) du CRM orienté comptes.
 *  - getOrCreateCompany : rattache un contact à une entreprise (par nom).
 *  - lookupLegalIdentity : pipeline SIREN (API SIRENE publique, gratuit, sans IA)
 *    → siren, raison sociale, NAF, adresse du siège.
 *  - enrichCompany : recherche web (research) + synthèse IA → brief commercial
 *    structuré (description, angles de vente, objections probables, activité).
 *    Déterministe côté recherche, IA pour la synthèse (compte le quota IA,
 *    gate `leads` côté route).
 */

import { randomUUID } from 'crypto';
import { storage } from './storage';
import { Company } from '../types';
import { chatComplete, sanitizeJson, isAIConfigured } from './aiClient';
import { webSearch, fetchPageText } from './research';
import { buildCompanyContext } from './contentAssistant';
import { lookupCompanyLegal } from './sirene';

const GENERIC_MAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'yahoo.fr', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr',
  'live.com', 'free.fr', 'orange.fr', 'sfr.fr', 'laposte.net', 'icloud.com', 'me.com',
  'proton.me', 'protonmail.com', 'wanadoo.fr', 'aol.com',
]);

/** Domaine d'entreprise déduit d'un email (null pour les webmails génériques). */
export function domainFromEmail(email: string | null): string | null {
  if (!email || !email.includes('@')) return null;
  const d = email.split('@')[1]?.trim().toLowerCase();
  if (!d || GENERIC_MAIL_DOMAINS.has(d)) return null;
  return d;
}

/** Trouve (par nom, insensible à la casse) ou crée un compte pour le projet actif. */
export function getOrCreateCompany(
  userId: string,
  planId: string | null,
  name: string,
  domain: string | null = null,
): Company {
  const clean = name.trim();
  const existing = storage.getCompanyByName(userId, planId, clean);
  if (existing) {
    if (domain && !existing.domain) {
      storage.updateCompany(existing.id, { domain });
      return { ...existing, domain };
    }
    return existing;
  }
  const now = new Date().toISOString();
  const company: Company = {
    id: randomUUID(), userId, planId, name: clean.slice(0, 200), domain,
    sector: null, size: null, siren: null, legalName: null, naf: null, address: null,
    revenue: null, description: null, salesAngles: null, objections: null, intel: null, notes: null,
    createdAt: now, updatedAt: now,
  };
  storage.saveCompany(company);
  return company;
}

/**
 * Pipeline SIREN : interroge le registre SIRENE (API publique, sans clé ni
 * quota IA) et renvoie l'identité légale + le CA publié (comptes INPI) à
 * fusionner dans la fiche. Une fiche déjà identifiée est re-cherchée par son
 * SIREN (les comptes d'un nouvel exercice peuvent paraître) ; les champs
 * saisis à la main priment toujours.
 */
export async function lookupLegalIdentity(company: Company): Promise<Partial<Company>> {
  const legal = await lookupCompanyLegal(company.siren ?? company.legalName ?? company.name);
  if (!legal) return {};
  return {
    siren: company.siren ?? legal.siren,
    legalName: company.legalName ?? legal.legalName,
    naf: company.naf ?? legal.naf,
    address: company.address ?? legal.address,
    revenue: legal.revenue ?? company.revenue,
  };
}

const ENRICH_SPEC = `Réponds UNIQUEMENT avec un objet JSON :
{
  "description": "2-3 phrases : ce que fait l'entreprise, pour qui, comment elle gagne de l'argent",
  "sector": "secteur d'activité (ex. « SaaS RH », « e-commerce mode »), sinon null",
  "size": "taille estimée (ex. « 10-50 pers. », « ETI »), sinon null",
  "domain": "domaine web sans http (ex. acme.io), sinon null",
  "salesAngles": "3-4 puces markdown (- …) : angles de vente CONCRETS adaptés à notre offre — pourquoi cette entreprise a besoin de nous, par où attaquer",
  "objections": "2-3 puces markdown (- …) : objections probables de cette entreprise, chacune suivie d'une parade en une phrase",
  "intel": "brief markdown : **Activité** (détail de l'offre, clients, positionnement), **Actualités** (si trouvées, sinon omets cette section). Concret et factuel."
}
N'invente rien : base-toi sur les extraits fournis. Mets null si tu ne sais pas.`;

/** Recherche web + synthèse IA d'un compte cible. Lève si l'IA n'est pas configurée. */
export async function enrichCompany(userId: string, company: Company): Promise<Partial<Company>> {
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const queries = [
    company.domain ? `${company.name} ${company.domain}` : `${company.name} entreprise`,
    `${company.name} secteur activité clients`,
    // Requête dédiée aux actualités — sans elle, la section « Actualités » du
    // brief ne sort presque jamais (les 2 requêtes profil n'en remontent pas)
    `${company.name} actualités ${new Date().getFullYear()}`,
  ];
  const snippets: string[] = [];
  for (const q of queries) {
    try {
      const r = await webSearch(q);
      snippets.push(...r.slice(0, 4));
    } catch { /* une requête peut échouer sans bloquer */ }
  }
  if (company.domain) {
    try {
      const text = await fetchPageText(`https://${company.domain}`);
      if (text) snippets.push(`[site ${company.domain}]\n${text.slice(0, 4000)}`);
    } catch { /* site injoignable : on continue */ }
  }
  const research = snippets.join('\n\n').slice(0, 12000);
  const ourCompany = buildCompanyContext(userId);

  const legalLines = [
    company.legalName && `Raison sociale : ${company.legalName}`,
    company.siren && `SIREN : ${company.siren}`,
    company.naf && `Code NAF : ${company.naf}`,
    company.address && `Siège : ${company.address}`,
    company.revenue && `Chiffre d'affaires publié : ${company.revenue}`,
  ].filter(Boolean).join('\n');

  const result = await chatComplete({
    messages: [
      {
        role: 'system',
        content: `Tu es un analyste commercial. On te donne des infos web sur une entreprise CIBLE ; produis un brief pour aider à lui vendre.${ourCompany ? `\n\n## Notre entreprise (à qui adapter les angles de vente)\n${ourCompany}` : ''}\n\n${ENRICH_SPEC}`,
      },
      {
        role: 'user',
        content: `Entreprise cible : ${company.name}${company.domain ? ` (${company.domain})` : ''}${legalLines ? `\n${legalLines}` : ''}\n\n--- Infos web ---\n${research || '(aucune info trouvée)'}`,
      },
    ],
    userId,
    maxTokens: 1800,
    jsonMode: true,
  });

  const parsed = JSON.parse(sanitizeJson(result.content));
  const s = (v: unknown, max = 300): string | null =>
    typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim().slice(0, max) : null;

  return {
    description: s(parsed.description, 800),
    sector: s(parsed.sector, 120),
    size: s(parsed.size, 60),
    domain: company.domain ?? s(parsed.domain, 120),
    salesAngles: s(parsed.salesAngles, 2000),
    objections: s(parsed.objections, 2000),
    intel: s(parsed.intel, 4000),
  };
}
