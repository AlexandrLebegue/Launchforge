/**
 * /api/assistant — assistant LaunchForge intégré (vue 💬 Assistant).
 *
 * POST /chat/stream (SSE) :
 *   data: {"type":"delta","text":…}   — texte de la réponse en continu
 *   data: {"type":"action","text":…}  — outil en cours (recherche, agenda…)
 *   data: {"type":"done","reply":…,"actions":[…]}
 *   data: {"type":"error","error":…}
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { runAssistantTurn, isAIConfigured, AssistantMessage } from '../services/assistant';

const router = Router();
router.use(requireAuth);

router.post('/chat/stream', async (req: Request, res: Response) => {
  if (!isAIConfigured()) {
    return res.status(503).json({ success: false, error: 'AI_NOT_CONFIGURED' });
  }

  const raw = (req.body as { messages?: unknown }).messages;
  const history: AssistantMessage[] = Array.isArray(raw)
    ? raw
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
        .map((m: any) => ({ role: m.role, text: String(m.text).slice(0, 8000) }))
    : [];

  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    return res.status(400).json({ success: false, error: 'messages must end with a user message' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // L'utilisateur peut interrompre : à la fermeture de la connexion, on coupe
  // l'appel modèle en cours (économie de tokens) et on n'écrit plus rien.
  const ac = new AbortController();
  req.on('close', () => ac.abort());

  const send = (payload: unknown) => {
    if (!ac.signal.aborted && !res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const result = await runAssistantTurn(req.user!.userId, history, send, ac.signal);
    if (!ac.signal.aborted) send({ type: 'done', reply: result.reply, actions: result.actions });
  } catch (err) {
    if (!ac.signal.aborted) send({ type: 'error', error: err instanceof Error ? err.message : 'Chat failed' });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

export default router;
