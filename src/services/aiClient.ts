/**
 * Client IA unique — OpenRouter (API compatible OpenAI).
 *
 * Toutes les fonctionnalités IA du site passent par ici : onboarding,
 * génération de plans, assistant de contenu, agents, intégration Composio.
 *
 * Routage par offre : les comptes « Brasier PLUS » (et l'essai) sont servis par
 * le modèle premium (Claude Opus), les autres par le modèle standard. Les
 * appelants passent `userId` dans ChatParams ; sans userId (tâches système),
 * c'est le modèle standard qui est utilisé.
 *
 * Env :
 *   OPENROUTER_API_KEY   — requis pour activer l'IA
 *   OPENROUTER_MODEL     — modèle standard (défaut : deepseek/deepseek-v4-flash)
 *   OPENROUTER_MODEL_PLUS — modèle premium (défaut : anthropic/claude-opus-4.8)
 */

import { hasPremiumModel } from './entitlements';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export function isAIConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/** Modèle standard (offres Braise et Brasier, tâches système) */
export function getModel(): string {
  return process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash';
}

/** Modèle premium (offre Brasier PLUS et essai reverse trial) */
export function getPlusModel(): string {
  return process.env.OPENROUTER_MODEL_PLUS || 'anthropic/claude-opus-4.8';
}

/** Modèle effectif pour un utilisateur (standard sans userId) */
export function modelForUser(userId?: string): string {
  return userId && hasPremiumModel(userId) ? getPlusModel() : getModel();
}

// ── Types (format OpenAI) ─────────────────────────────────────────────────────

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'file'; file: { filename: string; file_data: string } }
  | { type: 'image_url'; image_url: { url: string } };

export interface ToolCall {
  id: string;
  name: string;
  /** Arguments JSON déjà parsés */
  args: any;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  /** Message assistant brut à réinjecter dans l'historique pour la boucle d'outils */
  rawAssistantMessage: ChatMessage;
}

export interface ChatParams {
  messages: ChatMessage[];
  /** Route vers le modèle premium si l'utilisateur est en offre PLUS (ou essai) */
  userId?: string;
  /** Force un modèle précis (prioritaire sur le routage par offre) */
  model?: string;
  tools?: ToolDef[];
  maxTokens?: number;
  /** Force une réponse JSON (json_object) */
  jsonMode?: boolean;
  /** Si fourni, la réponse est streamée et chaque delta de texte est transmis */
  onDelta?: (text: string) => void;
  timeoutMs?: number;
  /** Annulation externe (ex. déconnexion du client SSE) — coupe l'appel modèle */
  signal?: AbortSignal;
}

function buildBody(params: ChatParams, stream: boolean) {
  const body: any = {
    model: params.model || modelForUser(params.userId),
    messages: params.messages,
    max_tokens: params.maxTokens ?? 2048,
    stream,
  };
  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  if (params.jsonMode) {
    body.response_format = { type: 'json_object' };
  }
  // Les PDF joints nécessitent le parseur de fichiers d'OpenRouter
  const hasFile = params.messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'file')
  );
  if (hasFile) {
    body.plugins = [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }];
  }
  return body;
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'HTTP-Referer': 'https://launchforge.app',
    'X-Title': 'LaunchForge',
  };
}

function parseToolCalls(raw: any[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const tc of raw || []) {
    try {
      calls.push({
        id: tc.id,
        name: tc.function?.name,
        args: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
      });
    } catch {
      calls.push({ id: tc.id, name: tc.function?.name, args: {} });
    }
  }
  return calls;
}

export async function chatComplete(params: ChatParams): Promise<ChatResult> {
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 120000);
  // Annulation externe (client SSE déconnecté) → on coupe la requête modèle
  const onExternalAbort = () => controller.abort();
  if (params.signal) {
    if (params.signal.aborted) controller.abort();
    else params.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    if (params.onDelta) {
      return await streamRequest(params, controller.signal);
    }

    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(buildBody(params, false)),
      signal: controller.signal,
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${txt.slice(0, 300)}`);
    }

    const data: any = await res.json();
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error('OpenRouter: réponse vide');

    return {
      content: typeof msg.content === 'string' ? msg.content : '',
      toolCalls: parseToolCalls(msg.tool_calls),
      rawAssistantMessage: {
        role: 'assistant',
        content: typeof msg.content === 'string' ? msg.content : null,
        tool_calls: msg.tool_calls,
      },
    };
  } finally {
    clearTimeout(timeout);
    params.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/** Variante streaming : SSE, accumulation des deltas texte + tool_calls */
async function streamRequest(params: ChatParams, signal: AbortSignal): Promise<ChatResult> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(buildBody(params, true)),
    signal,
  });

  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${txt.slice(0, 300)}`);
  }

  let content = '';
  // tool_calls arrivent en deltas indexés qu'il faut recoller
  const toolAcc: Record<number, { id: string; name: string; argsStr: string }> = {};

  const reader = (res.body as any).getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;

      let chunk: any;
      try { chunk = JSON.parse(payload); } catch { continue; }
      const delta = chunk?.choices?.[0]?.delta;
      if (!delta) continue;

      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        params.onDelta!(delta.content);
      }
      for (const tc of delta.tool_calls || []) {
        const idx = tc.index ?? 0;
        if (!toolAcc[idx]) toolAcc[idx] = { id: '', name: '', argsStr: '' };
        if (tc.id) toolAcc[idx].id = tc.id;
        if (tc.function?.name) toolAcc[idx].name += tc.function.name;
        if (tc.function?.arguments) toolAcc[idx].argsStr += tc.function.arguments;
      }
    }
  }

  const rawToolCalls = Object.keys(toolAcc)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => {
      const t = toolAcc[Number(k)];
      return { id: t.id, type: 'function' as const, function: { name: t.name, arguments: t.argsStr } };
    });

  return {
    content,
    toolCalls: parseToolCalls(rawToolCalls),
    rawAssistantMessage: {
      role: 'assistant',
      content: content || null,
      tool_calls: rawToolCalls.length > 0 ? rawToolCalls : undefined,
    },
  };
}

/** Nettoie une réponse censée être du JSON (retire les éventuelles fences) */
export function sanitizeJson(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  // Certains modèles ajoutent du texte autour — isole le premier objet JSON.
  // start !== -1 (et pas > 0) pour aussi retirer la prose en QUEUE quand la
  // réponse commence directement par « { ».
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end > start) cleaned = cleaned.slice(start, end + 1);
  return cleaned.trim();
}
