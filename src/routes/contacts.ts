/**
 * /api/contacts — prospects, clients et partenaires.
 *
 * - CRUD des contacts
 * - POST /analyze       : scoring IA d'un bloc de messages/commentaires collés
 * - POST /scan-inbox    : détection des leads dans la boîte mail (Composio MCP)
 * - POST /:id/draft-email : brouillon d'email personnalisé par l'IA
 * - POST /:id/send-email  : envoi réel depuis la boîte mail (Composio MCP)
 */

import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { isAIConfigured } from '../services/aiClient';
import { isComposioConfigured } from '../services/composio';
import {
  analyzeMessages, scanPostEngagement, draftEmailForContact, sendEmailViaComposio, fetchContactEmails, scoreContact, fetchInboxMessages,
  runNextActionChatTurn, NextActionChatMessage,
} from '../services/leadAnalysis';
import { getOrCreateCompany, domainFromEmail } from '../services/companies';
import { assertWithinUsage, recordUsage, assertFeature, hasUsage } from '../services/entitlements';
import { handleQuota } from '../middleware/quota';
import { Contact, ContactType, DealStage, DEAL_STAGES, LeadCandidate } from '../types';
import { fetchHubSpotCrm, upsertHubSpotCandidates } from '../services/hubspotCrm';
import { enrichPersonWithApollo, enrichOrganizationWithApollo } from '../services/apollo';
import { apolloPhoneWebhookUrl } from './webhooks';

const router = Router();
router.use(requireAuth);

const TYPES: ContactType[] = ['prospect', 'client', 'partner'];

function loadOwnedContact(req: Request, res: Response): Contact | null {
  const contact = storage.getContactById(req.params.id);
  const role = contact ? storage.accessRole(req.user!.userId, contact.planId, contact.userId) : null;
  if (!contact || !role) {
    res.status(404).json({ success: false, error: 'Contact not found' });
    return null;
  }
  if (role === 'viewer') {
    res.status(403).json({ success: false, error: 'Rôle Lecteur : action non autorisée' });
    return null;
  }
  return contact;
}

const str = (v: unknown, max = 300): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;

// ── CRUD ─────────────────────────────────────────────────────────────────────

// Les contacts sont propres au projet actif
router.get('/', (req: Request, res: Response) => {
  const ctx = storage.resolveActiveProject(req.user!.userId);
  res.json({ success: true, data: storage.getContactsByPlan(ctx.ownerUserId, ctx.planId) });
});

router.post('/', (req: Request, res: Response) => {
  const body = req.body as Partial<Contact>;
  const name = str(body.name, 120);
  if (!name) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }

  const ctx = storage.resolveActiveProject(req.user!.userId);
  if (ctx.role === 'viewer') {
    return res.status(403).json({ success: false, error: 'Rôle Lecteur : création non autorisée' });
  }

  const score = Number(body.interestScore);
  const amount = Number((body as { amount?: unknown }).amount);
  const email = str(body.email, 200);
  const companyName = str(body.company, 120);
  // Rattachement au compte : trouve ou crée l'entreprise du projet.
  const companyId = companyName
    ? getOrCreateCompany(ctx.ownerUserId, ctx.planId, companyName, domainFromEmail(email)).id
    : null;
  const now = new Date().toISOString();
  const contact: Contact = {
    id:              uuid(),
    userId:          ctx.ownerUserId,
    planId:          ctx.planId,
    name,
    email,
    company:         companyName,
    companyId,
    type:            TYPES.includes(body.type as ContactType) ? (body.type as ContactType) : 'prospect',
    stage:           DEAL_STAGES.includes(body.stage as DealStage) ? (body.stage as DealStage) : 'new',
    amount:          Number.isFinite(amount) && amount >= 0 ? amount : null,
    externalId:      null,
    expectedCloseDate: str(body.expectedCloseDate, 30),
    nextAction:        str(body.nextAction, 300),
    nextActionAt:      str(body.nextActionAt, 30),
    source:          str(body.source, 200),
    title:           str(body.title, 200),
    linkedinUrl:     str(body.linkedinUrl, 300),
    phone:           str(body.phone, 40),
    interestScore:   Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
    interestSummary: str(body.interestSummary, 500),
    notes:           str(body.notes, 2000),
    lastInteraction: str(body.lastInteraction, 4000),
    manualLog:       str(body.manualLog, 4000),
    createdAt:       now,
    updatedAt:       now,
  };
  storage.saveContact(contact);
  res.status(201).json({ success: true, data: contact });
});

router.patch('/:id', (req: Request, res: Response) => {
  const contact = loadOwnedContact(req, res);
  if (!contact) return;

  const body = req.body as Partial<Contact>;
  const patch: Partial<Contact> = {};
  if (str(body.name, 120)) patch.name = str(body.name, 120)!;
  if (body.email !== undefined)   patch.email = str(body.email, 200);
  if (body.company !== undefined) {
    const companyName = str(body.company, 120);
    patch.company = companyName;
    patch.companyId = companyName
      ? getOrCreateCompany(contact.userId, contact.planId, companyName, domainFromEmail(contact.email)).id
      : null;
  }
  if (TYPES.includes(body.type as ContactType)) patch.type = body.type as ContactType;
  if (DEAL_STAGES.includes(body.stage as DealStage)) patch.stage = body.stage as DealStage;
  if (body.amount !== undefined) {
    const amount = Number(body.amount);
    patch.amount = Number.isFinite(amount) && amount >= 0 ? amount : null;
  }
  if (body.expectedCloseDate !== undefined) patch.expectedCloseDate = str(body.expectedCloseDate, 30);
  if (body.nextAction !== undefined)        patch.nextAction = str(body.nextAction, 300);
  if (body.nextActionAt !== undefined)      patch.nextActionAt = str(body.nextActionAt, 30);
  if (body.source !== undefined)      patch.source = str(body.source, 200);
  if (body.title !== undefined)       patch.title = str(body.title, 200);
  if (body.linkedinUrl !== undefined) patch.linkedinUrl = str(body.linkedinUrl, 300);
  if (body.phone !== undefined)       patch.phone = str(body.phone, 40);
  if (body.interestScore !== undefined) {
    const score = Number(body.interestScore);
    patch.interestScore = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
  }
  if (body.interestSummary !== undefined) patch.interestSummary = str(body.interestSummary, 500);
  if (body.notes !== undefined)           patch.notes = str(body.notes, 2000);
  if (body.lastInteraction !== undefined) patch.lastInteraction = str(body.lastInteraction, 4000);
  if (body.manualLog !== undefined)       patch.manualLog = str(body.manualLog, 4000);

  storage.updateContact(contact.id, patch);
  res.json({ success: true, data: storage.getContactById(contact.id) });
});

router.delete('/:id', (req: Request, res: Response) => {
  const contact = loadOwnedContact(req, res);
  if (!contact) return;
  storage.deleteContact(contact.id);
  res.json({ success: true, data: null });
});

// ── Import du CRM HubSpot (Composio, déterministe — aucun coût IA) ────────────

/** Gardes communes preview/import : Composio configuré + rôle non-lecteur. */
function hubSpotImportContext(req: Request, res: Response): { planId: string | null; ownerUserId: string } | null {
  if (!process.env.COMPOSIO_API_KEY) {
    res.status(503).json({ success: false, error: 'COMPOSIO_NOT_CONFIGURED' });
    return null;
  }
  const ctx = storage.resolveActiveProject(req.user!.userId);
  if (ctx.role === 'viewer') {
    res.status(403).json({ success: false, error: 'Rôle Lecteur : import non autorisé' });
    return null;
  }
  return ctx;
}

// Préversion : liste les deals + contacts lus dans HubSpot SANS rien importer —
// l'utilisateur choisit ce qu'il ramène dans son pipeline. `existing` signale
// qu'un ré-import mettra la fiche à jour au lieu d'en créer une.
router.get('/import-hubspot/preview', async (req: Request, res: Response) => {
  const ctx = hubSpotImportContext(req, res);
  if (!ctx) return;
  try {
    const candidates = await fetchHubSpotCrm(ctx.ownerUserId);
    res.json({
      success: true,
      data: candidates.map((c) => ({
        ...c,
        existing: Boolean(storage.getContactByExternalId(ctx.ownerUserId, ctx.planId, c.externalId)),
      })),
    });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Lecture HubSpot échouée' });
  }
});

// Importe deals (→ pipeline avec montant/étape) et contacts (→ personnes) du
// compte HubSpot connecté, dédupliqués par externalId sur le projet actif.
// `externalIds` (optionnel) restreint l'import à la sélection de la préversion.
router.post('/import-hubspot', async (req: Request, res: Response) => {
  const ctx = hubSpotImportContext(req, res);
  if (!ctx) return;

  const externalIds = Array.isArray(req.body?.externalIds)
    ? new Set((req.body.externalIds as unknown[]).map(String))
    : null;

  try {
    let candidates = await fetchHubSpotCrm(ctx.ownerUserId);
    if (externalIds) candidates = candidates.filter((c) => externalIds.has(c.externalId));
    const { imported, updated } = upsertHubSpotCandidates(ctx.ownerUserId, ctx.planId, candidates);
    res.json({ success: true, data: { imported, updated } });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Import HubSpot échoué' });
  }
});

// ── Analyse IA de messages collés ────────────────────────────────────────────

router.post('/analyze', async (req: Request, res: Response) => {
  if (!isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }
  const { text, source } = req.body as { text?: string; source?: string };
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ success: false, error: 'text is required' });
  }

  try {
    assertFeature(req.user!.userId, 'leads');
    assertWithinUsage(req.user!.userId, 'ai_generation');
    const candidates = await analyzeMessages(
      storage.resolveActiveProject(req.user!.userId).ownerUserId,
      text,
      str(source, 100) || 'messages collés',
    );
    recordUsage(req.user!.userId, 'ai_generation');
    res.json({ success: true, data: candidates });
  } catch (err) {
    if (handleQuota(res, err)) return;
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Analyse failed' });
  }
});

// ── Scan de la boîte mail via Composio MCP ───────────────────────────────────

// Scan CRM : lit l'inbox (Gmail direct), MET À JOUR les clients déjà existants
// (échanges + score, en parallèle par lots) et PROPOSE les nouveaux expéditeurs
// comme candidats.
router.post('/scan-inbox', async (req: Request, res: Response) => {
  if (!process.env.COMPOSIO_API_KEY || !isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'COMPOSIO_NOT_CONFIGURED' });
  }
  const ctx = storage.resolveActiveProject(req.user!.userId);
  if (ctx.role === 'viewer') {
    return res.status(403).json({ success: false, error: 'Rôle Lecteur : action non autorisée' });
  }

  try {
    assertFeature(req.user!.userId, 'leads');

    // Options du scan (formulaire côté UI)
    const opts = req.body as { maxEmails?: unknown; daysBack?: unknown; discoverNew?: unknown };
    const maxEmails = Math.min(200, Math.max(5, Math.round(Number(opts.maxEmails)) || 50));
    const daysBack = Math.min(365, Math.max(1, Math.round(Number(opts.daysBack)) || 30));
    const discoverNew = opts.discoverNew !== false; // défaut : true

    // 1) Lecture déterministe de l'inbox (Gmail direct)
    const { messages, rawCount, replyPreview } = await fetchInboxMessages(ctx.ownerUserId, maxEmails, daysBack);

    // 2) Regrouper les emails reçus par expéditeur
    const bySender = new Map<string, typeof messages>();
    for (const m of messages) {
      if (!m.fromEmail) continue;
      const arr = bySender.get(m.fromEmail) ?? [];
      arr.push(m);
      bySender.set(m.fromEmail, arr);
    }

    // 3) Contacts existants du projet, indexés par email
    const contacts = storage.getContactsByPlan(ctx.ownerUserId, ctx.planId);
    const byEmail = new Map(contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]));

    const matched: { contact: Contact; msgs: typeof messages }[] = [];
    const newSenders: { email: string; msgs: typeof messages }[] = [];
    for (const [email, msgs] of bySender) {
      const c = byEmail.get(email);
      if (c) matched.push({ contact: c, msgs });
      else newSenders.push({ email, msgs });
    }

    // 4) MAJ des clients existants — par lots de 4 (multithread)
    const updated: { id: string; name: string; score: number | null }[] = [];
    const now = new Date().toISOString();
    for (let i = 0; i < matched.length; i += 4) {
      const results = await Promise.all(matched.slice(i, i + 4).map(async ({ contact, msgs }) => {
        // 4a) « Derniers échanges » = digest des emails reçus + timeline
        const digest = msgs.slice(0, 10)
          .map((m) => `[reçu · ${new Date(m.sentAt).toLocaleDateString('fr-FR')}] ${m.subject || ''}\n${m.snippet || ''}`.trim())
          .join('\n\n').slice(0, 4000);
        storage.updateContact(contact.id, { lastInteraction: digest });
        for (const m of msgs) {
          if (m.externalId && storage.getContactEmailByExternalId(contact.id, m.externalId)) continue;
          storage.saveContactEmail({ id: uuid(), userId: contact.userId, contactId: contact.id, direction: 'received', subject: m.subject, snippet: m.snippet, sentAt: m.sentAt, externalId: m.externalId, createdAt: now });
        }
        // 4b) Ré-analyse du score (IA) si le quota le permet
        let score: number | null = contact.interestScore;
        if (hasUsage(req.user!.userId, 'ai_generation')) {
          try {
            const fresh = storage.getContactById(contact.id)!;
            const r = await scoreContact(fresh.userId, fresh);
            storage.updateContact(contact.id, { interestScore: r.score, interestSummary: r.summary });
            recordUsage(req.user!.userId, 'ai_generation');
            score = r.score;
          } catch { /* on garde le score existant */ }
        }
        return { id: contact.id, name: contact.name, score };
      }));
      updated.push(...results);
    }

    // 5) Découverte de nouveaux clients potentiels (1 seul appel IA global) — optionnel
    let candidates: LeadCandidate[] = [];
    if (discoverNew && newSenders.length > 0 && hasUsage(req.user!.userId, 'ai_generation')) {
      const text = newSenders.slice(0, 15)
        .map((s) => `De : ${s.email}\n` + s.msgs.slice(0, 3).map((m) => `Objet : ${m.subject || ''}\n${m.snippet || ''}`).join('\n'))
        .join('\n\n---\n\n');
      candidates = await analyzeMessages(ctx.ownerUserId, text, 'boîte mail');
      recordUsage(req.user!.userId, 'ai_generation');
    }

    console.log('[scan-inbox] résultat', JSON.stringify({ scanned: messages.length, matched: matched.length, updated: updated.length, newSenders: newSenders.length, candidates: candidates.length }));
    res.json({ success: true, data: { updated, candidates, scanned: messages.length, debug: { rawCount, replyPreview } } });
  } catch (err) {
    if (handleQuota(res, err)) return;
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Scan échoué' });
  }
});

// ── Scan des réactions d'un post (likes + commentaires) via Composio MCP ─────

router.post('/scan-post', async (req: Request, res: Response) => {
  const { postId } = req.body as { postId?: string };
  if (!postId || typeof postId !== 'string') {
    return res.status(400).json({ success: false, error: 'postId is required' });
  }

  const post = storage.getPostById(postId);
  if (!post || !storage.accessRole(req.user!.userId, post.planId, post.userId)) {
    return res.status(404).json({ success: false, error: 'Post not found' });
  }
  if (!post.externalUrl) {
    return res.status(400).json({ success: false, error: 'Renseignez d\'abord l\'URL du post publié (fiche du post, section métriques)' });
  }
  if (!isComposioConfigured() || !isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'COMPOSIO_NOT_CONFIGURED' });
  }

  try {
    assertFeature(req.user!.userId, 'leads');
    assertWithinUsage(req.user!.userId, 'ai_generation');
    const candidates = await scanPostEngagement(
      post.userId,
      post.platform,
      post.externalUrl,
      post.title,
    );
    recordUsage(req.user!.userId, 'ai_generation');
    res.json({ success: true, data: candidates });
  } catch (err) {
    if (handleQuota(res, err)) return;
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Scan failed' });
  }
});

// ── Emails sortants ──────────────────────────────────────────────────────────

router.post('/:id/draft-email', async (req: Request, res: Response) => {
  if (!isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }
  const contact = loadOwnedContact(req, res);
  if (!contact) return;

  const goal = str((req.body as any).goal, 600);
  if (!goal) {
    return res.status(400).json({ success: false, error: 'goal is required' });
  }

  try {
    assertFeature(req.user!.userId, 'leads');
    assertWithinUsage(req.user!.userId, 'ai_generation');
    const draft = await draftEmailForContact(contact.userId, contact, goal);
    recordUsage(req.user!.userId, 'ai_generation');
    res.json({ success: true, data: draft });
  } catch (err) {
    if (handleQuota(res, err)) return;
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Draft failed' });
  }
});

router.post('/:id/send-email', async (req: Request, res: Response) => {
  const contact = loadOwnedContact(req, res);
  if (!contact) return;

  if (!isComposioConfigured() || !isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'COMPOSIO_NOT_CONFIGURED' });
  }
  if (!contact.email) {
    return res.status(400).json({ success: false, error: 'Ce contact n\'a pas d\'adresse email' });
  }

  const { subject, body } = req.body as { subject?: string; body?: string };
  if (!str(subject, 200) || !body || typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ success: false, error: 'subject and body are required' });
  }

  try {
    const result = await sendEmailViaComposio(contact.userId, contact.email, subject!.trim(), body.trim());
    const ok = result.trim().toUpperCase().startsWith('OK');

    if (ok) {
      const stampIso = new Date().toISOString();
      storage.saveContactEmail({
        id: uuid(), userId: contact.userId, contactId: contact.id, direction: 'sent',
        subject: subject!.trim().slice(0, 300), snippet: body.trim().slice(0, 500),
        sentAt: stampIso, externalId: null, createdAt: stampIso,
      });
      return res.json({ success: true, data: { result: result.replace(/^OK:\s*/i, ''), contact: storage.getContactById(contact.id) } });
    }
    res.status(502).json({ success: false, error: result.replace(/^ECHEC:\s*/i, '') });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Send failed' });
  }
});

// ── Enrichissement Apollo.io (clé API personnelle de l'utilisateur) ──────────
// Déterministe (aucun coût IA) : complète poste, LinkedIn, email pro vérifié,
// téléphone (livré en asynchrone via webhook si APP_URL est publique) et la
// fiche entreprise — SANS écraser les champs déjà renseignés à la main.
// Si people/match n'est pas accessible sur le plan Apollo de la clé (403) ou
// que la personne est introuvable, on bascule sur l'entreprise seule
// (organizations/enrich) pour enrichir au moins le compte.
router.post('/:id/enrich-apollo', async (req: Request, res: Response) => {
  const contact = loadOwnedContact(req, res);
  if (!contact) return;

  const apiKey = storage.getApolloApiKey(req.user!.userId);
  if (!apiKey) {
    return res.status(400).json({ success: false, error: 'APOLLO_NOT_CONFIGURED' });
  }

  try {
    assertFeature(req.user!.userId, 'leads');
    const domain = domainFromEmail(contact.email);
    const warnings: string[] = [];

    // 1) La personne (poste, LinkedIn, email, téléphone via webhook)
    let enrichment = null;
    try {
      enrichment = await enrichPersonWithApollo(
        apiKey,
        { name: contact.name, email: contact.email, company: contact.company, domain },
        apolloPhoneWebhookUrl(contact.id),
      );
      if (!enrichment) warnings.push('Personne introuvable chez Apollo — précisez l\'entreprise ou l\'email pour aider la correspondance.');
    } catch (err) {
      warnings.push(`Fiche personne : ${err instanceof Error ? err.message : 'échec Apollo'}.`);
    }

    // 2) L'entreprise : celle embarquée dans la personne, sinon lecture directe
    let org = enrichment?.organization ?? null;
    if (!org && (contact.company || domain)) {
      try {
        org = await enrichOrganizationWithApollo(apiKey, { name: contact.company, domain });
        if (!org) warnings.push('Entreprise introuvable chez Apollo.');
      } catch (err) {
        warnings.push(`Fiche entreprise : ${err instanceof Error ? err.message : 'échec Apollo'}.`);
      }
    }

    if (!enrichment && !org) {
      return res.status(404).json({ success: false, error: warnings.join(' ') || 'Rien trouvé chez Apollo' });
    }

    // Contact : Apollo actualise poste + LinkedIn ; les saisies manuelles priment
    const patch: Partial<Contact> = {};
    if (enrichment?.title) patch.title = enrichment.title;
    if (enrichment?.linkedinUrl) patch.linkedinUrl = enrichment.linkedinUrl;
    if (enrichment?.email && !contact.email) patch.email = enrichment.email;
    if (enrichment?.phone && !contact.phone) patch.phone = enrichment.phone;
    if (org?.name && !contact.company) {
      patch.company = org.name.slice(0, 120);
      patch.companyId = getOrCreateCompany(contact.userId, contact.planId, patch.company, org.domain).id;
    }
    if (Object.keys(patch).length > 0) storage.updateContact(contact.id, patch);

    // Compte (entreprise) : complète les champs encore vides
    let company = null;
    const companyId = patch.companyId ?? contact.companyId;
    if (org && companyId) {
      const existing = storage.getCompanyById(companyId);
      if (existing) {
        const companyPatch: Record<string, string> = {};
        if (org.domain && !existing.domain) companyPatch.domain = org.domain;
        if (org.industry && !existing.sector) companyPatch.sector = org.industry;
        if (org.size && !existing.size) companyPatch.size = org.size;
        if (org.description && !existing.description) companyPatch.description = org.description;
        if (Object.keys(companyPatch).length > 0) storage.updateCompany(existing.id, companyPatch);
        company = storage.getCompanyById(companyId);
      }
    }

    res.json({
      success: true,
      data: { contact: storage.getContactById(contact.id), company, enrichment, organization: org, warnings },
    });
  } catch (err) {
    if (handleQuota(res, err)) return;
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Enrichissement Apollo échoué' });
  }
});

// ── (Ré)analyse du score d'intérêt d'un seul contact ─────────────────────────

router.post('/:id/score', async (req: Request, res: Response) => {
  if (!isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }
  const contact = loadOwnedContact(req, res);
  if (!contact) return;
  try {
    assertFeature(req.user!.userId, 'leads');
    assertWithinUsage(req.user!.userId, 'ai_generation');
    const { score, summary } = await scoreContact(contact.userId, contact);
    storage.updateContact(contact.id, { interestScore: score, interestSummary: summary });
    recordUsage(req.user!.userId, 'ai_generation');
    res.json({ success: true, data: storage.getContactById(contact.id) });
  } catch (err) {
    if (handleQuota(res, err)) return;
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Analyse échouée' });
  }
});

// ── Copilote « prochaine action » (chat SSE) ─────────────────────────────────
// Assistant conversationnel qui aide à trouver/préparer la prochaine action
// commerciale pour ce contact, avec le contexte de la personne + son entreprise.
//   data: {"type":"delta","text":…}  — réponse en continu
//   data: {"type":"done","reply":…}
//   data: {"type":"error","error":…}
router.post('/:id/next-action/stream', async (req: Request, res: Response) => {
  if (!isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }
  const contact = loadOwnedContact(req, res);
  if (!contact) return;

  const raw = (req.body as { messages?: unknown }).messages;
  const history: NextActionChatMessage[] = Array.isArray(raw)
    ? raw
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
        .map((m: any) => ({ role: m.role, text: String(m.text) }))
    : [];
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return res.status(400).json({ success: false, error: 'messages must end with a user message' });
  }

  try {
    assertFeature(req.user!.userId, 'leads');
    assertWithinUsage(req.user!.userId, 'ai_generation');
  } catch (err) {
    if (handleQuota(res, err)) return;
    throw err;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload: unknown) => { res.write(`data: ${JSON.stringify(payload)}\n\n`); };

  try {
    const reply = await runNextActionChatTurn(contact.userId, contact, history, (t) => send({ type: 'delta', text: t }));
    recordUsage(req.user!.userId, 'ai_generation');
    send({ type: 'done', reply, actions: [] });
  } catch (err) {
    send({ type: 'error', error: err instanceof Error ? err.message : 'Chat failed' });
  } finally {
    res.end();
  }
});

// ── Emails d'un contact (timeline envoyés + reçus) ───────────────────────────

router.get('/:id/emails', (req: Request, res: Response) => {
  const contact = loadOwnedContact(req, res);
  if (!contact) return;
  res.json({ success: true, data: storage.getEmailsByContact(contact.id) });
});

// Synchronise depuis la boîte mail les emails échangés avec l'adresse du contact
router.post('/:id/emails/sync', async (req: Request, res: Response) => {
  const contact = loadOwnedContact(req, res);
  if (!contact) return;
  if (!contact.email) {
    return res.status(400).json({ success: false, error: 'Ce contact n\'a pas d\'adresse email' });
  }
  if (!isComposioConfigured() || !isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'COMPOSIO_NOT_CONFIGURED' });
  }

  try {
    assertFeature(req.user!.userId, 'leads');
    assertWithinUsage(req.user!.userId, 'ai_generation');
    const { items, debug } = await fetchContactEmails(contact.userId, contact.email);
    recordUsage(req.user!.userId, 'ai_generation');
    let added = 0;
    const now = new Date().toISOString();
    for (const it of items) {
      if (it.externalId && storage.getContactEmailByExternalId(contact.id, it.externalId)) continue;
      storage.saveContactEmail({
        id: uuid(), userId: contact.userId, contactId: contact.id,
        direction: it.direction, subject: it.subject, snippet: it.snippet,
        sentAt: it.sentAt, externalId: it.externalId, createdAt: now,
      });
      added++;
    }
    // « Derniers échanges » automatique : digest des emails REÇUS (nourrit le scoring)
    const received = storage.getEmailsByContact(contact.id).filter((e) => e.direction === 'received').slice(0, 10);
    if (received.length > 0) {
      const digest = received
        .map((e) => `[reçu · ${new Date(e.sentAt).toLocaleDateString('fr-FR')}] ${e.subject || ''}\n${e.snippet || ''}`.trim())
        .join('\n\n')
        .slice(0, 4000);
      storage.updateContact(contact.id, { lastInteraction: digest });
    }
    console.log(`[emails/sync] contact=${contact.id} added=${added} received=${received.length}`, JSON.stringify(debug));
    res.json({ success: true, data: { added, emails: storage.getEmailsByContact(contact.id), debug } });
  } catch (err) {
    console.error('[emails/sync] ERREUR', err);
    if (handleQuota(res, err)) return;
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Synchro emails échouée' });
  }
});

export default router;
