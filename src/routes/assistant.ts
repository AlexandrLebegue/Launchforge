/**
 * /api/assistant — assistant LaunchForge intégré (vue 💬 Assistant).
 *
 * Historisation : chaque tour est persisté dans la table `conversations`
 * (purge automatique après un mois d'inactivité, cf. conversationCleanup.ts).
 *   GET    /conversations      — liste des fils de l'utilisateur
 *   GET    /conversations/:id  — un fil complet
 *   DELETE /conversations/:id  — supprime un fil
 *
 * POST /chat/stream (SSE) :
 *   data: {"type":"delta","text":…}   — texte de la réponse en continu
 *   data: {"type":"action","text":…}  — outil en cours (recherche, agenda…)
 *   data: {"type":"done","reply":…,"actions":[…]}
 *   data: {"type":"error","error":…}
 * Le corps peut inclure `conversationId` : le fil est alors créé/mis à jour à la
 * fin du tour (sans cet id, le tour n'est pas historisé).
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { runAssistantTurn, isAIConfigured, AssistantMessage } from '../services/assistant';
import { ChatAttachment } from '../services/attachments';
import { storage } from '../services/storage';
import { ConversationMessage } from '../types';

const router = Router();
router.use(requireAuth);

// ── Historique ───────────────────────────────────────────────────────────────

router.get('/conversations', (req: Request, res: Response) => {
  res.json({ success: true, data: storage.listConversations(req.user!.userId) });
});

router.get('/conversations/:id', (req: Request, res: Response) => {
  const convo = storage.getConversation(req.params.id, req.user!.userId);
  if (!convo) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  res.json({ success: true, data: convo });
});

router.delete('/conversations/:id', (req: Request, res: Response) => {
  const deleted = storage.deleteConversation(req.params.id, req.user!.userId);
  if (!deleted) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  res.json({ success: true, data: { deleted: true } });
});

// ── Chat ─────────────────────────────────────────────────────────────────────

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

  // Identifiant du fil à historiser (fourni par le client). Absent → tour non sauvegardé.
  const rawConvId = (req.body as { conversationId?: unknown }).conversationId;
  const conversationId = typeof rawConvId === 'string' && rawConvId.length <= 64 ? rawConvId : null;

  const rawAtt = (req.body as { attachments?: unknown }).attachments;
  const attachments: ChatAttachment[] = Array.isArray(rawAtt)
    ? rawAtt
        .filter((a: any) => a && typeof a.name === 'string' && typeof a.mime === 'string' && typeof a.data === 'string')
        .slice(0, 4)
        .map((a: any) => ({ name: String(a.name), mime: String(a.mime), data: String(a.data) }))
    : [];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // L'utilisateur peut interrompre : à la fermeture de la connexion, on coupe
  // l'appel modèle en cours (économie de tokens) et on n'écrit plus rien.
  // ⚠️ On écoute 'close' sur la RÉPONSE, pas sur req : une fois le corps POST
  // entièrement lu par express.json(), req peut émettre 'close' immédiatement
  // alors que la connexion est saine — ce qui annulait le tour et supprimait
  // l'événement {done}, d'où un faux « connexion interrompue » côté client.
  // res 'close' survient aussi en fin normale : le garde-fou writableEnded
  // distingue une vraie déconnexion d'une réponse déjà terminée.
  const ac = new AbortController();
  res.on('close', () => { if (!res.writableEnded) ac.abort(); });

  const send = (payload: unknown) => {
    if (!ac.signal.aborted && !res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    const result = await runAssistantTurn(req.user!.userId, history, send, ac.signal, attachments);
    if (!ac.signal.aborted) {
      send({ type: 'done', reply: result.reply, actions: result.actions });

      // Historisation : on persiste le fil complet (échanges précédents + ce
      // tour). Best-effort — un échec d'écriture ne doit pas casser la réponse.
      if (conversationId) {
        try {
          const messages: ConversationMessage[] = [
            ...history.map((m): ConversationMessage => ({ role: m.role, text: m.text })),
            { role: 'assistant', text: result.reply, actions: result.actions.length ? result.actions : undefined },
          ];
          storage.upsertConversation({
            id: conversationId,
            userId: req.user!.userId,
            planId: storage.getActivePlanId(req.user!.userId),
            messages,
          });
        } catch (persistErr) {
          console.error('Conversation persist error:', persistErr);
        }
      }
    }
  } catch (err) {
    if (!ac.signal.aborted) send({ type: 'error', error: err instanceof Error ? err.message : 'Chat failed' });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

export default router;
