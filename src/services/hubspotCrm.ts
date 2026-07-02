/**
 * Synchro CRM depuis HubSpot (Composio, lecture DÉTERMINISTE — aucun coût IA).
 *
 * Importe les deals (→ entrées de pipeline avec montant + étape) et les contacts
 * (→ personnes avec email pour la relance) et les mappe sur le modèle `Contact`
 * de LaunchForge. Dédup par `externalId`. Faisabilité documentée dans la mémoire
 * projet HubSpot : slugs à préfixes redondants, réponse `{ results:[{id,properties}] }`.
 */

import { v4 as uuid } from 'uuid';
import { executeComposioTool, ToolExecutor } from './composioDirect';
import { composioUserIdFor } from './composioConnect';
import { storage } from './storage';
import { getOrCreateCompany } from './companies';
import { ContactType, DealStage } from '../types';

const DEALS_SLUG = 'HUBSPOT_HUBSPOT_LIST_DEALS';
// Le slug exact des contacts varie selon la version de la toolkit : on essaie
// les variantes connues dans l'ordre, la première qui répond gagne.
const CONTACTS_SLUGS = ['HUBSPOT_HUBSPOT_LIST_CONTACTS_PAGE', 'HUBSPOT_HUBSPOT_LIST_CONTACTS'];

export interface HubSpotCandidate {
  /** Clé de déduplication stable (`hs-deal:<id>` ou `hs-contact:<id>`) */
  externalId: string;
  name: string;
  email: string | null;
  company: string | null;
  type: ContactType;
  stage: DealStage;
  amount: number | null;
  expectedCloseDate: string | null;
  source: string;
  summary: string | null;
}

/** Extrait les enregistrements HubSpot (toutes formes de réponse) → {id, props}. */
function records(data: any): { id: string; props: Record<string, any> }[] {
  const rows: any[] =
    Array.isArray(data?.results) ? data.results
      : Array.isArray(data?.objects) ? data.objects
        : Array.isArray(data?.items) ? data.items
          : Array.isArray(data) ? data : [];
  return rows
    .map((r: any) => ({
      id: String(r?.id ?? r?.properties?.hs_object_id ?? ''),
      props: r?.properties && typeof r.properties === 'object' ? r.properties : (r ?? {}),
    }))
    .filter((r) => r.id);
}

/** Mappe une étape de deal HubSpot (id de stage, souvent custom) → DealStage. */
export function mapDealStage(hs: string): DealStage {
  const s = hs.toLowerCase();
  if (s.includes('won')) return 'won';
  if (s.includes('lost')) return 'lost';
  if (s.includes('contract') || s.includes('proposal') || s.includes('presentation') || s.includes('decision')) return 'proposal';
  if (s.includes('qualif')) return 'qualified';
  if (s.includes('appointment') || s.includes('scheduled') || s.includes('discov')) return 'discussion';
  return 'new';
}

/** Mappe un lifecyclestage HubSpot → (étape de pipeline, type de contact). */
export function mapLifecycle(hs: string): { stage: DealStage; type: ContactType } {
  const s = hs.toLowerCase();
  if (s === 'customer') return { stage: 'won', type: 'client' };
  if (s === 'opportunity' || s === 'salesqualifiedlead') return { stage: 'qualified', type: 'prospect' };
  if (s === 'evangelist') return { stage: 'won', type: 'partner' };
  return { stage: 'new', type: 'prospect' };
}

function num(v: any): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: any, max = 200): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

/** Normalise une date HubSpot (ISO ou epoch ms) → yyyy-mm-dd. */
function hsDate(v: any): string | null {
  if (v == null || v === '') return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) {
    const d = new Date(n);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

/** Identité Composio de l'utilisateur — lève si HubSpot n'est pas connecté. */
function requireCuid(ownerUserId: string): string {
  const cuid = composioUserIdFor(ownerUserId);
  if (!cuid) throw new Error('HubSpot non connecté — connectez-le depuis la vue Configuration');
  return cuid;
}

/**
 * Lit les DEALS HubSpot du compte connecté (lecture directe, lève en cas
 * d'échec API). Réutilisée par l'import CRM et l'outil assistant
 * hubspot_list_deals.
 */
export async function fetchHubSpotDeals(
  ownerUserId: string,
  exec: ToolExecutor = executeComposioTool,
): Promise<HubSpotCandidate[]> {
  const cuid = requireCuid(ownerUserId);
  const data = await exec(cuid, DEALS_SLUG, {
    limit: 100,
    properties: ['dealname', 'amount', 'dealstage', 'pipeline', 'closedate'],
  });
  return records(data).map(({ id, props }) => ({
    externalId: `hs-deal:${id}`,
    name: str(props.dealname, 120) || `Deal HubSpot ${id}`,
    email: null,
    company: null,
    type: 'prospect' as ContactType,
    stage: mapDealStage(String(props.dealstage ?? '')),
    amount: num(props.amount),
    expectedCloseDate: hsDate(props.closedate),
    source: 'HubSpot — deal',
    summary: str(props.pipeline) ? `Pipeline HubSpot : ${str(props.pipeline)}` : null,
  }));
}

/**
 * Lit les CONTACTS HubSpot du compte connecté (essaie les variantes de slug
 * dans l'ordre, lève si toutes échouent). Réutilisée par l'import CRM et
 * l'outil assistant hubspot_list_contacts.
 */
export async function fetchHubSpotContacts(
  ownerUserId: string,
  exec: ToolExecutor = executeComposioTool,
): Promise<HubSpotCandidate[]> {
  const cuid = requireCuid(ownerUserId);
  const failures: string[] = [];
  let contactData: any = null;
  for (const slug of CONTACTS_SLUGS) {
    try {
      contactData = await exec(cuid, slug, {
        limit: 100,
        properties: ['firstname', 'lastname', 'email', 'company', 'lifecyclestage', 'hs_lead_status'],
      });
      break;
    } catch (e) {
      failures.push(`(${slug}) : ${e instanceof Error ? e.message : 'échec'}`);
    }
  }
  if (!contactData) throw new Error(failures[0] ?? 'lecture des contacts HubSpot échouée');

  return records(contactData).map(({ id, props }) => {
    const { stage, type } = mapLifecycle(String(props.lifecyclestage ?? ''));
    const fullName = [props.firstname, props.lastname]
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter(Boolean)
      .join(' ');
    const email = str(props.email, 200);
    return {
      externalId: `hs-contact:${id}`,
      name: str(fullName, 120) || email || `Contact HubSpot ${id}`,
      email: email && email.includes('@') ? email : null,
      company: str(props.company, 120),
      type,
      stage,
      amount: null,
      expectedCloseDate: null,
      source: 'HubSpot — contact',
      summary: str(props.hs_lead_status) ? `Statut HubSpot : ${str(props.hs_lead_status)}` : null,
    };
  });
}

/**
 * Lit le CRM HubSpot du compte Composio connecté et renvoie des candidats
 * normalisés (deals + contacts — l'échec d'un seul des deux est toléré).
 * `exec` est injectable pour les tests. Lève si rien d'exploitable.
 */
export async function fetchHubSpotCrm(
  ownerUserId: string,
  exec: ToolExecutor = executeComposioTool,
): Promise<HubSpotCandidate[]> {
  requireCuid(ownerUserId);

  const out: HubSpotCandidate[] = [];
  const failures: string[] = [];

  // ── Deals → entrées de pipeline (montant + étape) ──
  try {
    out.push(...await fetchHubSpotDeals(ownerUserId, exec));
  } catch (e) {
    failures.push(`deals : ${e instanceof Error ? e.message : 'échec'}`);
  }

  // ── Contacts → personnes (email pour la relance) ──
  try {
    out.push(...await fetchHubSpotContacts(ownerUserId, exec));
  } catch (e) {
    failures.push(`contacts ${e instanceof Error ? e.message : ': échec'}`);
  }

  if (out.length === 0) {
    throw new Error(`Aucune donnée HubSpot importable${failures.length ? ` (${failures[0].slice(0, 180)})` : ''}`);
  }
  return out;
}

// ── Import dans le CRM LaunchForge (upsert dédupliqué) ────────────────────────

export interface HubSpotImportResult {
  imported: number;
  updated: number;
}

/**
 * Upsert des candidats HubSpot dans le CRM du projet, dédupliqué par
 * `externalId`. Partagé par la route HTTP (bouton « Importer depuis HubSpot »,
 * avec ou sans sélection) et l'outil assistant hubspot_import_crm — pour que
 * les deux voies produisent exactement le même résultat.
 */
export function upsertHubSpotCandidates(
  ownerUserId: string,
  planId: string | null,
  candidates: HubSpotCandidate[],
): HubSpotImportResult {
  let imported = 0;
  let updated = 0;
  const now = new Date().toISOString();
  for (const c of candidates) {
    const existing = storage.getContactByExternalId(ownerUserId, planId, c.externalId);
    if (existing) {
      // Ré-import : on rafraîchit l'étape/le montant sans écraser les notes
      // ou un email déjà renseigné par l'utilisateur.
      storage.updateContact(existing.id, {
        stage:   c.stage,
        amount:  c.amount ?? existing.amount,
        company: c.company ?? existing.company,
        email:   existing.email ?? c.email,
        type:    c.type,
        expectedCloseDate: c.expectedCloseDate ?? existing.expectedCloseDate,
      });
      updated++;
    } else {
      storage.saveContact({
        id: uuid(),
        userId: ownerUserId,
        planId,
        name: c.name,
        email: c.email,
        company: c.company,
        companyId: c.company ? getOrCreateCompany(ownerUserId, planId, c.company).id : null,
        type: c.type,
        stage: c.stage,
        amount: c.amount,
        externalId: c.externalId,
        expectedCloseDate: c.expectedCloseDate,
        nextAction: null,
        nextActionAt: null,
        source: c.source,
        title: null,
        linkedinUrl: null,
        phone: null,
        interestScore: null,
        interestSummary: c.summary,
        notes: null,
        lastInteraction: null,
        manualLog: null,
        createdAt: now,
        updatedAt: now,
      });
      imported++;
    }
  }
  return { imported, updated };
}
