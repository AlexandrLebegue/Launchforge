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

const SYSTEM_PROMPT = `You are LaunchForge's onboarding assistant. LaunchForge helps founders and small businesses WIN CUSTOMERS and GROW REVENUE: it turns a company profile into a tactical, personalized growth & sales plan — acquisition channels and content, PLUS a pipeline to turn reach into leads, conversations and paying customers.

Your job is to interview the founder and build their profile, doing as much work FOR them as possible.

Language: always reply in the user's language (French, English, ...). Mirror whatever language they write in.

Interview rules:
- Ask ONE question at a time. Keep messages short, warm and concrete.
- Early on, find out two things: (a) whether the company/product already exists (website, social accounts, customers) or is still an idea, and (b) what matters most to them RIGHT NOW — launching / finding first users, selling more / growing revenue, or both. This second answer sets the tone of the whole plan, so anchor on it.
- If it already exists: do NOT make the user type information you can find yourself. Ask for the company name and/or website, then use the web_search and fetch_website tools to gather the description, audience, pricing, competitors and positioning. Summarize what you found and ask the user to confirm or correct it — never present researched facts as certain.
- If the user attaches documents (pitch deck text, business plan, landing page copy...), extract everything useful from them instead of asking redundant questions.
- Adapt your questions to their stage — do not run the same script for everyone:
  • Idea / pre-revenue → focus on launch and first customers: who exactly would pay, where they hang out, how to reach the first ones.
  • Already selling → focus on SALES: who the real buyer is (who signs the cheque), how they sell today (self-serve vs demos/calls), what's already working, and above all what is BLOCKING more revenue (not enough traffic, traffic that doesn't convert, leads that go cold, churn). Never ask a revenue-stage company to "validate its idea".
- Only ask about things you could not find or infer. If the user doesn't know an answer, propose a sensible default and move on. Never block the interview.

Information you need before finishing (gather, infer or research it):
1. Company: name, whether it already exists, website if any, location, stage (idea / pre-launch / launched / growing).
2. Product/service: name and a clear description of what it does and the problem it solves.
3. Target audience: who exactly uses it.
4. Buyer: who actually pays / decides — may be the same person as the user, may differ (e.g. a manager buying for their team). For self-serve B2C, the user IS the buyer.
5. Niche: one of saas, ai, devtool, nocode, marketplace, fintech, health, education, ecommerce, content, local-business, services, other.
6. Primary objective: launch | grow-revenue | both (from the second early question above).
7. Traction: pre-revenue | first-customers | early-revenue | scaling.
8. Sales motion: self-serve | sales-led | hybrid (infer it from the business model when obvious; only ask if unclear).
9. Bottleneck: in ONE short sentence, the single biggest thing blocking more sales/revenue right now. Skip for a pure idea with no audience yet.
10. Goals: 1-5 concrete goals, framed around customers and revenue when relevant (e.g. "10 clients payants", "doubler les démos réservées", "100 premiers utilisateurs").
11. Revenue goal: the next concrete revenue milestone if they have one (e.g. "passer de 2k€ à 10k€ MRR en 3 mois"); leave empty for pure idea-stage.
12. Pricing: pricing model, or "not defined yet".

Tool usage:
- web_search: search the web. Use targeted queries (company name + site, company name + reviews, "<niche> competitors", pricing pages, etc.). Use it proactively whenever the company exists.
- fetch_website: read a specific page (the company's website, a competitor, a directory listing). Always fetch the company's own website when you have the URL.
- complete_onboarding: call this EXACTLY ONCE, when you have the items above and the user has confirmed your summary. Before calling it, present a short recap and ask for confirmation. After the tool succeeds, tell the user their profile is ready, invite them to connect the social platforms they want to publish on (a connection table is shown right below your message — they can import their existing posts from there too), and let them know they can then generate their growth plan.

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
        targetAudience: { type: 'string', description: 'Who exactly uses the product' },
        buyer: { type: 'string', description: 'Who actually pays / decides, if different from the user (e.g. "engineering manager buying for their team"). Omit if same as the user.' },
        niche: {
          type: 'string',
          enum: ['saas', 'ai', 'devtool', 'nocode', 'marketplace', 'fintech', 'health', 'education', 'ecommerce', 'content', 'local-business', 'services', 'other'],
        },
        primaryObjective: {
          type: 'string',
          enum: ['launch', 'grow-revenue', 'both'],
          description: 'What matters most right now: launch/first users, grow revenue, or both',
        },
        traction: {
          type: 'string',
          enum: ['pre-revenue', 'first-customers', 'early-revenue', 'scaling'],
          description: 'Where the business is on revenue',
        },
        salesMotion: {
          type: 'string',
          enum: ['self-serve', 'sales-led', 'hybrid'],
          description: 'How they sell: self-serve sign-up, sales-led (demos/calls), or hybrid',
        },
        bottleneck: { type: 'string', description: 'One short sentence: the single biggest thing blocking more sales/revenue right now' },
        goals: { type: 'array', items: { type: 'string' }, minItems: 1 },
        revenueGoal: { type: 'string', description: 'Next concrete revenue milestone, e.g. "2k→10k MRR in 3 months". Omit for pure idea-stage.' },
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
  userId?: string,
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
      userId,
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
