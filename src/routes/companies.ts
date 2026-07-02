/**
 * /api/companies — comptes (entreprises) du CRM orienté comptes.
 *
 * - CRUD des comptes (propres au projet actif)
 * - GET /:id : la fiche + ses contacts + agrégats de pipeline
 * - POST /:id/enrich : enrichissement IA (recherche web + brief commercial)
 */

import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { isAIConfigured } from '../services/aiClient';
import { enrichCompany, lookupLegalIdentity } from '../services/companies';
import { assertWithinUsage, recordUsage, assertFeature } from '../services/entitlements';
import { handleQuota } from '../middleware/quota';
import { Company } from '../types';

const router = Router();
router.use(requireAuth);

const str = (v: unknown, max = 300): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

/** Compte enrichi de ses agrégats (nb contacts, pipeline ouvert / gagné). */
function withStats(company: Company) {
  const contacts = storage.getContactsByCompany(company.id);
  const open = contacts.filter((c) => c.stage === 'qualified' || c.stage === 'discussion' || c.stage === 'proposal');
  const won = contacts.filter((c) => c.stage === 'won');
  return {
    ...company,
    contactCount: contacts.length,
    dealCount: contacts.filter((c) => c.amount != null).length,
    openValue: open.reduce((s, c) => s + (c.amount ?? 0), 0),
    wonValue: won.reduce((s, c) => s + (c.amount ?? 0), 0),
  };
}

function loadOwned(req: Request, res: Response): Company | null {
  const company = storage.getCompanyById(req.params.id);
  const role = company ? storage.accessRole(req.user!.userId, company.planId, company.userId) : null;
  if (!company || !role) {
    res.status(404).json({ success: false, error: 'Company not found' });
    return null;
  }
  if (role === 'viewer' && req.method !== 'GET') {
    res.status(403).json({ success: false, error: 'Rôle Lecteur : action non autorisée' });
    return null;
  }
  return company;
}

// Liste des comptes du projet actif (avec agrégats)
router.get('/', (req: Request, res: Response) => {
  const ctx = storage.resolveActiveProject(req.user!.userId);
  const companies = storage.getCompaniesByPlan(ctx.ownerUserId, ctx.planId).map(withStats);
  res.json({ success: true, data: companies });
});

// Détail d'un compte : fiche + contacts + agrégats
router.get('/:id', (req: Request, res: Response) => {
  const company = loadOwned(req, res);
  if (!company) return;
  res.json({ success: true, data: { ...withStats(company), contacts: storage.getContactsByCompany(company.id) } });
});

router.post('/', (req: Request, res: Response) => {
  const ctx = storage.resolveActiveProject(req.user!.userId);
  if (ctx.role === 'viewer') {
    return res.status(403).json({ success: false, error: 'Rôle Lecteur : création non autorisée' });
  }
  const name = str((req.body as { name?: unknown }).name, 200);
  if (!name) return res.status(400).json({ success: false, error: 'name is required' });
  const now = new Date().toISOString();
  const company: Company = {
    id: randomUUID(), userId: ctx.ownerUserId, planId: ctx.planId, name,
    domain: str((req.body as { domain?: unknown }).domain, 120),
    sector: null, size: null, siren: null, legalName: null, naf: null, address: null,
    revenue: null, description: null, salesAngles: null, objections: null, intel: null, notes: null,
    createdAt: now, updatedAt: now,
  };
  storage.saveCompany(company);
  res.status(201).json({ success: true, data: withStats(company) });
});

router.patch('/:id', (req: Request, res: Response) => {
  const company = loadOwned(req, res);
  if (!company) return;
  const b = req.body as Record<string, unknown>;
  const patch: Partial<Company> = {};
  if (str(b.name, 200)) patch.name = str(b.name, 200)!;
  if (b.domain !== undefined) patch.domain = str(b.domain, 120);
  if (b.sector !== undefined) patch.sector = str(b.sector, 120);
  if (b.size !== undefined) patch.size = str(b.size, 60);
  if (b.siren !== undefined) {
    // Saisie manuelle tolérante (« 123 456 789 ») mais on ne stocke que 9 chiffres
    const digits = typeof b.siren === 'string' ? b.siren.replace(/\D/g, '') : '';
    if (b.siren !== null && !/^\d{9}$/.test(digits)) {
      return res.status(400).json({ success: false, error: 'SIREN invalide : 9 chiffres attendus' });
    }
    patch.siren = b.siren === null ? null : digits;
  }
  if (b.legalName !== undefined) patch.legalName = str(b.legalName, 200);
  if (b.naf !== undefined) patch.naf = str(b.naf, 10);
  if (b.address !== undefined) patch.address = str(b.address, 300);
  if (b.revenue !== undefined) patch.revenue = str(b.revenue, 60);
  if (b.description !== undefined) patch.description = str(b.description, 800);
  if (b.salesAngles !== undefined) patch.salesAngles = str(b.salesAngles, 2000);
  if (b.objections !== undefined) patch.objections = str(b.objections, 2000);
  if (b.intel !== undefined) patch.intel = str(b.intel, 4000);
  if (b.notes !== undefined) patch.notes = str(b.notes, 4000);
  storage.updateCompany(company.id, patch);
  res.json({ success: true, data: withStats(storage.getCompanyById(company.id)!) });
});

router.delete('/:id', (req: Request, res: Response) => {
  const company = loadOwned(req, res);
  if (!company) return;
  storage.deleteCompany(company.id);
  res.json({ success: true, data: null });
});

// Enrichissement : pipeline SIREN (registre SIRENE, gratuit) puis brief IA.
// L'identité légale est persistée AVANT l'appel IA : elle survit à son échec.
router.post('/:id/enrich', async (req: Request, res: Response) => {
  if (!isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }
  let company = loadOwned(req, res);
  if (!company) return;
  try {
    assertFeature(req.user!.userId, 'leads');
    assertWithinUsage(req.user!.userId, 'ai_generation');

    const legal = await lookupLegalIdentity(company);
    if (Object.keys(legal).length > 0) {
      storage.updateCompany(company.id, legal);
      company = { ...company, ...legal };
    }

    const patch = await enrichCompany(company.userId, company);
    storage.updateCompany(company.id, patch);
    recordUsage(req.user!.userId, 'ai_generation');
    res.json({ success: true, data: withStats(storage.getCompanyById(company.id)!) });
  } catch (err) {
    if (handleQuota(res, err)) return;
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Enrichissement échoué' });
  }
});

export default router;
