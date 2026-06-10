/**
 * Client MCP minimal (Streamable HTTP) — utilisé pour se connecter au serveur
 * MCP Composio de l'utilisateur (https://mcp.composio.dev/...).
 *
 * Env :
 *   COMPOSIO_MCP_URL — URL du serveur MCP fournie par le dashboard Composio
 *                      (les identifiants des comptes connectés vivent chez
 *                      Composio, rien à stocker côté LaunchForge).
 *   COMPOSIO_API_KEY — clé API Composio (ak_…), envoyée en header x-api-key :
 *                      requise par les serveurs MCP Composio.
 *
 * Implémente le strict nécessaire du protocole : initialize → tools/list →
 * tools/call, avec gestion des réponses JSON ou SSE et du header de session.
 */

const PROTOCOL_VERSION = '2025-03-26';

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export function isComposioConfigured(): boolean {
  return Boolean(process.env.COMPOSIO_MCP_URL);
}

interface JsonRpcResponse {
  id?: number | string;
  result?: any;
  error?: { code: number; message: string };
}

/** Une session MCP éphémère : initialisée à la demande, jetée après usage */
export class McpSession {
  private url: string;
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(url?: string) {
    const target = url || process.env.COMPOSIO_MCP_URL;
    if (!target) throw new Error('COMPOSIO_MCP_URL not configured');
    this.url = target;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (process.env.COMPOSIO_API_KEY) h['x-api-key'] = process.env.COMPOSIO_API_KEY;
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    return h;
  }

  /** POST JSON-RPC ; la réponse peut être du JSON direct ou un flux SSE */
  private async rpc(method: string, params: any, expectReply = true): Promise<any> {
    const id = expectReply ? this.nextId++ : undefined;
    const body: any = { jsonrpc: '2.0', method };
    if (params !== undefined) body.params = params;
    if (id !== undefined) body.id = id;

    const res = await fetch(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    const sid = res.headers.get('mcp-session-id');
    if (sid) this.sessionId = sid;

    if (!expectReply) {
      // notification : 202/200 sans corps utile
      return null;
    }

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`MCP ${res.status}: ${txt.slice(0, 300)}`);
    }

    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('text/event-stream')) {
      return await this.readSseReply(res, id!);
    }

    const json = (await res.json()) as JsonRpcResponse;
    if (json.error) throw new Error(`MCP error: ${json.error.message}`);
    return json.result;
  }

  /** Lit un flux SSE jusqu'à la réponse JSON-RPC portant notre id */
  private async readSseReply(res: Response, id: number | string): Promise<any> {
    const reader = (res.body as any).getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        for (const line of event.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          let payload: JsonRpcResponse;
          try { payload = JSON.parse(trimmed.slice(5).trim()); } catch { continue; }
          if (payload.id === id) {
            try { reader.cancel(); } catch { /* flux déjà clos */ }
            if (payload.error) throw new Error(`MCP error: ${payload.error.message}`);
            return payload.result;
          }
        }
      }
    }
    throw new Error('MCP: réponse introuvable dans le flux SSE');
  }

  async initialize(): Promise<void> {
    await this.rpc('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'launchforge', version: '1.0.0' },
    });
    await this.rpc('notifications/initialized', undefined, false);
  }

  async listTools(): Promise<McpTool[]> {
    const result = await this.rpc('tools/list', {});
    return (result?.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description || '',
      inputSchema: t.inputSchema || { type: 'object', properties: {} },
    }));
  }

  /** Appelle un outil et concatène le contenu texte du résultat */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.rpc('tools/call', { name, arguments: args });
    const parts: string[] = [];
    for (const block of result?.content || []) {
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    }
    if (result?.isError) {
      throw new Error(`Tool ${name} failed: ${parts.join('\n').slice(0, 300) || 'unknown error'}`);
    }
    return parts.join('\n') || JSON.stringify(result ?? {});
  }
}
