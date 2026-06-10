import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { storage } from '../services/storage';
import { requireAuth } from '../middleware/auth';
import { isAgentConfigured, runOnboardingTurn } from '../services/onboardingAgent';
import { bootstrapKnowledgeFromProfile } from '../services/bootstrap';
import {
  ApiResponse,
  AuthPayload,
  OnboardingAttachment,
  OnboardingSession,
} from '../types';

const router = Router();

const WELCOME_MESSAGE =
  "👋 Bonjour ! Je suis l'assistant LaunchForge. Je vais préparer votre plan de promotion — et faire un maximum de recherches à votre place.\n\n" +
  'Pour commencer : votre entreprise (ou produit) existe-t-elle déjà ? Si oui, donnez-moi son nom ou son site web et je pars en recherche. ' +
  'Sinon, décrivez-moi votre idée en une phrase. Vous pouvez aussi joindre un document (pitch, business plan, page de présentation).\n\n' +
  '_(I also speak English — just write in your language.)_';

function notConfigured(res: Response): void {
  const response: ApiResponse<null> = {
    success: false,
    error: 'AI_NOT_CONFIGURED',
  };
  res.status(503).json(response);
}

function loadOwnedSession(req: Request, res: Response): OnboardingSession | null {
  const user = req.user as AuthPayload;
  const session = storage.getOnboardingSession(req.params.id);
  if (!session || session.userId !== user.userId) {
    const response: ApiResponse<null> = { success: false, error: 'Session not found' };
    res.status(404).json(response);
    return null;
  }
  return session;
}

// Start a new onboarding conversation
router.post('/', requireAuth, (req: Request, res: Response) => {
  if (!isAgentConfigured()) return notConfigured(res);

  const user = req.user as AuthPayload;
  const now = new Date().toISOString();
  const session: OnboardingSession = {
    id: uuidv4(),
    userId: user.userId,
    status: 'active',
    messages: [{ role: 'assistant', text: WELCOME_MESSAGE }],
    profile: null,
    createdAt: now,
    updatedAt: now,
  };
  storage.saveOnboardingSession(session);

  const response: ApiResponse<OnboardingSession> = { success: true, data: session };
  res.status(201).json(response);
});

// Fetch an existing session (e.g. after page reload)
router.get('/:id', requireAuth, (req: Request, res: Response) => {
  const session = loadOwnedSession(req, res);
  if (!session) return;
  res.json({ success: true, data: session } satisfies ApiResponse<OnboardingSession>);
});

/** Validate the message payload; sends the error response itself on failure */
function parseMessageBody(
  req: Request,
  res: Response,
): { text: string; docs: OnboardingAttachment[] } | null {
  const { message, attachments } = req.body as {
    message?: string;
    attachments?: OnboardingAttachment[];
  };

  const text = typeof message === 'string' ? message.trim() : '';
  const docs: OnboardingAttachment[] = Array.isArray(attachments)
    ? attachments
        .filter((a) => a && typeof a.name === 'string' && typeof a.content === 'string')
        .slice(0, 3)
    : [];

  if (!text && docs.length === 0) {
    res.status(400).json({ success: false, error: 'message or attachments required' });
    return null;
  }
  return { text, docs };
}

function applyTurn(
  session: OnboardingSession,
  turn: Awaited<ReturnType<typeof runOnboardingTurn>>,
): void {
  session.messages.push({
    role: 'assistant',
    text: turn.reply,
    actions: turn.actions.length > 0 ? turn.actions : undefined,
  });
  if (turn.completed && turn.profile) {
    session.status = 'completed';
    session.profile = turn.profile;
    // La base de connaissances se remplit toute seule depuis le profil validé
    try {
      bootstrapKnowledgeFromProfile(session.userId, turn.profile as OnboardingProfileFull);
    } catch { /* best-effort */ }
  }
  session.updatedAt = new Date().toISOString();
  storage.updateOnboardingSession(session);
}

type OnboardingProfileFull = import('../types').OnboardingProfile;

// Send a user message (optionally with attached documents) and get the AI reply
router.post('/:id/message', requireAuth, async (req: Request, res: Response) => {
  if (!isAgentConfigured()) return notConfigured(res);

  const session = loadOwnedSession(req, res);
  if (!session) return;

  if (session.status === 'completed') {
    res.status(400).json({ success: false, error: 'This onboarding is already completed' });
    return;
  }

  const parsed = parseMessageBody(req, res);
  if (!parsed) return;
  const { text, docs } = parsed;

  const userText = text || `(document joint : ${docs.map((d) => d.name).join(', ')})`;
  session.messages.push({ role: 'user', text: userText });

  try {
    const turn = await runOnboardingTurn(session.messages, docs);
    applyTurn(session, turn);

    const response: ApiResponse<OnboardingSession> = { success: true, data: session };
    res.json(response);
  } catch (err) {
    // Don't persist the failed turn — let the user retry the same message
    session.messages.pop();
    const response: ApiResponse<null> = {
      success: false,
      error: err instanceof Error ? err.message : 'AI request failed',
    };
    res.status(502).json(response);
  }
});

// Same as /message but streams the reply over Server-Sent Events:
//   data: {"type":"action","text":"🔍 ..."}   — a web search/fetch the agent runs
//   data: {"type":"delta","text":"..."}        — text chunk of the reply
//   data: {"type":"done","session":{...}}      — final persisted session
//   data: {"type":"error","error":"..."}       — turn failed (nothing persisted)
router.post('/:id/message/stream', requireAuth, async (req: Request, res: Response) => {
  if (!isAgentConfigured()) return notConfigured(res);

  const session = loadOwnedSession(req, res);
  if (!session) return;

  if (session.status === 'completed') {
    res.status(400).json({ success: false, error: 'This onboarding is already completed' });
    return;
  }

  const parsed = parseMessageBody(req, res);
  if (!parsed) return;
  const { text, docs } = parsed;

  const userText = text || `(document joint : ${docs.map((d) => d.name).join(', ')})`;
  session.messages.push({ role: 'user', text: userText });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (payload: unknown) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const turn = await runOnboardingTurn(session.messages, docs, send);
    applyTurn(session, turn);
    send({ type: 'done', session });
  } catch (err) {
    session.messages.pop();
    send({ type: 'error', error: err instanceof Error ? err.message : 'AI request failed' });
  } finally {
    res.end();
  }
});

export default router;
