/**
 * Onboarding agent — une vraie IA conversationnelle (via OpenRouter) qui
 * interviewe le fondateur, recherche son entreprise sur le web quand elle
 * existe déjà, lit les documents joints et produit un profil structuré
 * utilisé pour générer le plan de lancement.
 *
 * Architecture : boucle agentique sur l'API chat completions (OpenRouter)
 * avec trois outils — `web_search`, `fetch_website` (exécutés côté serveur
 * via le service research) et `complete_onboarding` (l'extraction structurée
 * qui clôt l'interview).
 */

import { chatComplete, ChatMessage, ContentPart, ToolDef, isAIConfigured } from './aiClient';
import { webSearch, fetchPageText } from './research';
import { OnboardingAttachment, OnboardingChatMessage, OnboardingProfile } from '../types';

const MAX_TOOL_ITERATIONS = 6;

export function isAgentConfigured(): boolean {
  return isAIConfigured();
}

const SYSTEM_PROMPT = `You are LaunchForge's onboarding assistant. LaunchForge helps startups and small businesses promote themselves: it turns a company profile into a tactical, personalized launch & promotion plan (weekly actions, communities to target, content angles, outreach, first-users tactics).

Your job is to interview the founder and build their profile, doing as much work FOR them as possible.

Language: always reply in the user's language (French, English, ...). Mirror whatever language they write in.

Interview rules:
- Ask ONE question at a time. Keep messages short, warm and concrete.
- Early on, find out whether the company/product already exists (has a website, social accounts, customers) or is still an idea.
- If it already exists: do NOT make the user type information you can find yourself. Ask for the company name and/or website, then use the web_search and fetch_website tools to gather the description, audience, pricing, competitors and positioning. Summarize what you found and ask the user to confirm or correct it — never present researched facts as certain.
- If the user attaches documents (pitch deck text, business plan, landing page copy...), extract everything useful from them instead of asking redundant questions.
- Only ask about things you could not find or infer: goals are usually worth asking explicitly; pricing too if not public.
- If the user doesn't know an answer, propose a sensible default and move on. Never block the interview.

Information you need before finishing (gather, infer or research it):
1. Company: name, whether it already exists, website if any, location, stage (idea / pre-launch / launched / growing).
2. Product/service: name and a clear description of what it does and the problem it solves.
3. Target audience: who exactly buys/uses it.
4. Niche: one of saas, ai, devtool, nocode, marketplace, fintech, health, education, ecommerce, content, local-business, services, other.
5. Goals: 1-5 concrete promotion goals (e.g. "100 premiers utilisateurs", "lancement Product Hunt", "10 clients payants").
6. Pricing: pricing model, or "not defined yet".

Tool usage:
- web_search: search the web. Use targeted queries (company name + site, company name + reviews, "<niche> competitors", etc.). Use it proactively whenever the company exists.
- fetch_website: read a specific page (the company's website, a competitor, a directory listing). Always fetch the company's own website when you have the URL.
- complete_onboarding: call this EXACTLY ONCE, when you have all six items above and the user has confirmed your summary. Before calling it, present a short recap and ask for confirmation. After the tool succeeds, tell the user their profile is ready, invite them to connect the social platforms they want to publish on (a connection table is shown right below your message — they can import their existing posts from there too), and let them know they can then generate their plan.

Never invent facts about a real company — research or ask. Keep the whole interview under ~8 exchanges when possible.`;

const TOOLS: ToolDef[] = [
  {
    name: 'web_search',
    description:
      "Search the web. Call this when the user's company already exists to find its website, description, reviews, competitors or market info, instead of asking the user to type it. Returns raw result snippets.",
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "Acme Robotics site officiel" or "meal-prep SaaS competitors France"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_website',
    description:
      "Fetch a web page and return its readable text. Use it on the company's own website, competitor sites, or any URL the user shares.",
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL, e.g. https://acme.com' },
      },
      required: ['url'],
    },
  },
  {
    name: 'complete_onboarding',
    description:
      'Save the final, user-confirmed company profile and end the interview. Call exactly once, only after the user confirmed your recap.',
    parameters: {
      type: 'object',
      properties: {
        company: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            exists: { type: 'boolean', description: 'true if the company/product already exists publicly' },
            website: { type: 'string' },
            description: { type: 'string' },
            location: { type: 'string' },
            stage: { type: 'string', description: 'idea | pre-launch | launched | growing' },
            socials: { type: 'array', items: { type: 'string' } },
            competitors: { type: 'array', items: { type: 'string' } },
            notes: { type: 'string', description: 'Any other useful context found during research' },
          },
          required: ['name', 'exists'],
        },
        productName: { type: 'string' },
        description: { type: 'string', description: 'What the product/service does and the problem it solves' },
        targetAudience: { type: 'string' },
        niche: {
          type: 'string',
          enum: ['saas', 'ai', 'devtool', 'nocode', 'marketplace', 'fintech', 'health', 'education', 'ecommerce', 'content', 'local-business', 'services', 'other'],
        },
        goals: { type: 'array', items: { type: 'string' }, minItems: 1 },
        pricing: { type: 'string' },
      },
      required: ['company', 'productName', 'description', 'targetAudience', 'niche', 'goals', 'pricing'],
    },
  },
];

async function executeTool(name: string, input: any): Promise<string> {
  if (name === 'web_search') {
    const results = await webSearch(String(input.query || ''));
    return results.length > 0
      ? results.map((r, i) => `[${i + 1}] ${r}`).join('\n')
      : 'No results found.';
  }
  if (name === 'fetch_website') {
    const text = await fetchPageText(String(input.url || ''));
    return text || 'Could not fetch this page (unreachable or blocked).';
  }
  return `Unknown tool: ${name}`;
}

function describeToolAction(name: string, input: any): string {
  if (name === 'web_search') return `🔍 ${input.query}`;
  if (name === 'fetch_website') return `🌐 ${input.url}`;
  return name;
}

function buildApiMessages(
  history: OnboardingChatMessage[],
  attachments: OnboardingAttachment[],
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.map((m): ChatMessage => ({ role: m.role, content: m.text })),
  ];

  // Les pièces jointes accompagnent le dernier message utilisateur.
  // PDF → bloc fichier natif (parsé par OpenRouter) ; texte → inliné.
  if (attachments.length > 0 && messages.length > 1) {
    const last = messages[messages.length - 1];
    const parts: ContentPart[] = [];

    for (const a of attachments) {
      if (a.type === 'pdf') {
        parts.push({
          type: 'file',
          file: { filename: a.name, file_data: `data:application/pdf;base64,${a.content}` },
        });
      } else {
        parts.push({
          type: 'text',
          text: `<document name="${a.name}">\n${a.content.slice(0, 20000)}\n</document>`,
        });
      }
    }

    parts.push({ type: 'text', text: String(last.content) });
    last.content = parts;
  }

  return messages;
}

export interface AgentTurnResult {
  reply: string;
  actions: string[];
  profile: OnboardingProfile | null;
  completed: boolean;
}

/** Live events emitted while the agent works, for SSE streaming to the UI */
export type AgentTurnEvent =
  | { type: 'delta'; text: string }
  | { type: 'action'; text: string };

export async function runOnboardingTurn(
  history: OnboardingChatMessage[],
  attachments: OnboardingAttachment[] = [],
  onEvent?: (event: AgentTurnEvent) => void,
): Promise<AgentTurnResult> {
  const messages = buildApiMessages(history, attachments);

  const actions: string[] = [];
  let profile: OnboardingProfile | null = null;
  // La réponse persistée accumule le texte de chaque itération (texte avant
  // un appel d'outil + réponse finale) — identique à ce qui est streamé.
  let fullText = '';

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    let emittedSeparator = fullText === '';

    const result = await chatComplete({
      messages,
      tools: TOOLS,
      maxTokens: 2048,
      onDelta: onEvent
        ? (delta) => {
            if (!emittedSeparator) {
              emittedSeparator = true;
              onEvent({ type: 'delta', text: '\n\n' });
            }
            onEvent({ type: 'delta', text: delta });
          }
        : undefined,
    });

    const iterText = result.content.trim();
    if (iterText) {
      fullText = fullText ? `${fullText}\n\n${iterText}` : iterText;
    }

    if (result.toolCalls.length === 0) break;

    messages.push(result.rawAssistantMessage);

    for (const call of result.toolCalls) {
      if (call.name === 'complete_onboarding') {
        profile = call.args as OnboardingProfile;
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: 'Profile saved. Tell the user it is ready and they can generate their launch plan.',
        });
      } else {
        const action = describeToolAction(call.name, call.args);
        actions.push(action);
        onEvent?.({ type: 'action', text: action });
        const output = await executeTool(call.name, call.args);
        messages.push({ role: 'tool', tool_call_id: call.id, content: output.slice(0, 12000) });
      }
    }
  }

  if (!fullText) {
    fullText = profile
      ? 'Votre profil est prêt ! Vous pouvez maintenant générer votre plan de lancement. / Your profile is ready — you can now generate your launch plan!'
      : "Désolé, je n'ai pas réussi à traiter votre message. Pouvez-vous reformuler ? / Sorry, I could not process that — could you rephrase?";
    onEvent?.({ type: 'delta', text: fullText });
  }

  return { reply: fullText, actions, profile, completed: profile !== null };
}
