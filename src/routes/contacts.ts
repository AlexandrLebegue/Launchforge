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
  analyzeMessages, scanInbox, scanPostEngagement, draftEmailForContact, sendEmailViaComposio,
} from '../services/leadAnalysis';
import { assertWithinUsage, recordUsage } from '../services/entitlements';
import { handleQuota } from '../middleware/quota';
import { Contact, ContactType } from '../types';

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
  const now = new Date().toISOString();
  const contact: Contact = {
    id:              uuid(),
    userId:          ctx.ownerUserId,
    planId:          ctx.planId,
    name,
    email:           str(body.email, 200),
    company:         str(body.company, 120),
    type:            TYPES.includes(body.type as ContactType) ? (body.type as ContactType) : 'prospect',
    source:          str(body.source, 200),
    interestScore:   Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
    interestSummary: str(body.interestSummary, 500),
    notes:           str(body.notes, 2000),
    lastInteraction: str(body.lastInteraction, 4000),
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
  if (body.company !== undefined) patch.company = str(body.company, 120);
  if (TYPES.includes(body.type as ContactType)) patch.type = body.type as ContactType;
  if (body.source !== undefined)  patch.source = str(body.source, 200);
  if (body.interestScore !== undefined) {
    const score = Number(body.interestScore);
    patch.interestScore = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
  }
  if (body.interestSummary !== undefined) patch.interestSummary = str(body.interestSummary, 500);
  if (body.notes !== undefined)           patch.notes = str(body.notes, 2000);
  if (body.lastInteraction !== undefined) patch.lastInteraction = str(body.lastInteraction, 4000);

  storage.updateContact(contact.id, patch);
  res.json({ success: true, data: storage.getContactById(contact.id) });
});

router.delete('/:id', (req: Request, res: Response) => {
  const contact = loadOwnedContact(req, res);
  if (!contact) return;
  storage.deleteContact(contact.id);
  res.json({ success: true, data: null });
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

router.post('/scan-inbox', async (req: Request, res: Response) => {
  if (!isComposioConfigured() || !isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'COMPOSIO_NOT_CONFIGURED' });
  }

  try {
    assertWithinUsage(req.user!.userId, 'ai_generation');
    const candidates = await scanInbox(storage.resolveActiveProject(req.user!.userId).ownerUserId);
    recordUsage(req.user!.userId, 'ai_generation');
    res.json({ success: true, data: candidates });
  } catch (err) {
    if (handleQuota(res, err)) return;
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Scan failed' });
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
      // Trace l'envoi dans l'historique du contact
      const stamp = new Date().toLocaleString('fr-FR');
      const trace = `[${stamp}] Email envoyé — ${subject!.trim()}\n${body.trim().slice(0, 500)}`;
      storage.updateContact(contact.id, {
        lastInteraction: [contact.lastInteraction, trace].filter(Boolean).join('\n\n').slice(-4000),
      });
      return res.json({ success: true, data: { result: result.replace(/^OK:\s*/i, ''), contact: storage.getContactById(contact.id) } });
    }
    res.status(502).json({ success: false, error: result.replace(/^ECHEC:\s*/i, '') });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Send failed' });
  }
});

export default router;
