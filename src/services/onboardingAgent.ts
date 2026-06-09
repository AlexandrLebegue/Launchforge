/**
 * Onboarding agent — a real conversational AI (Claude) that interviews the
 * founder, researches their company on the web when it already exists, reads
 * attached documents, and produces a structured profile used to generate the
 * launch plan.
 *
 * Architecture: manual agentic loop over the Anthropic Messages API with three
 * tools — `web_search`, `fetch_website` (both executed server-side against the
 * research service) and `complete_onboarding` (the structured extraction that
 * ends the interview).
 */

import Anthropic from '@anthropic-ai/sdk';
import { webSearch, fetchPageText } from './research';
import { OnboardingAttachment, OnboardingChatMessage, OnboardingProfile } from '../types';

const MODEL = 'claude-opus-4-8';
const MAX_TOOL_ITERATIONS = 6;

let client: Anthropic | null = null;

export function isAgentConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
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
- complete_onboarding: call this EXACTLY ONCE, when you have all six items above and the user has confirmed your summary. Before calling it, present a short recap and ask for confirmation. After the tool succeeds, tell the user their profile is ready and that they can generate their plan.

Never invent facts about a real company — research or ask. Keep the whole interview under ~8 exchanges when possible.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'web_search',
    description:
      "Search the web. Call this when the user's company already exists to find its website, description, reviews, competitors or market info, instead of asking the user to type it. Returns raw result snippets.",
    input_schema: {
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
    input_schema: {
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
    input_schema: {
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
): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = history.map((m) => ({
    role: m.role,
    content: m.text,
  }));

  // Attachments ride along with the latest user message
  if (attachments.length > 0 && messages.length > 0) {
    const last = messages[messages.length - 1];
    const docs = attachments
      .map((a) => `<document name="${a.name}">\n${a.content.slice(0, 20000)}\n</document>`)
      .join('\n');
    last.content = `${docs}\n\n${last.content}`;
  }

  return messages;
}

export interface AgentTurnResult {
  reply: string;
  actions: string[];
  profile: OnboardingProfile | null;
  completed: boolean;
}

export async function runOnboardingTurn(
  history: OnboardingChatMessage[],
  attachments: OnboardingAttachment[] = [],
): Promise<AgentTurnResult> {
  const anthropic = getClient();
  const messages = buildApiMessages(history, attachments);

  const actions: string[] = [];
  let profile: OnboardingProfile | null = null;
  let finalText = '';

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
    });

    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    );

    if (textBlocks.length > 0) {
      finalText = textBlocks.map((b) => b.text).join('\n').trim();
    }

    if (response.stop_reason !== 'tool_use' || toolUses.length === 0) break;

    messages.push({ role: 'assistant', content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tool of toolUses) {
      if (tool.name === 'complete_onboarding') {
        profile = tool.input as OnboardingProfile;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: 'Profile saved. Tell the user it is ready and they can generate their launch plan.',
        });
      } else {
        actions.push(describeToolAction(tool.name, tool.input));
        const result = await executeTool(tool.name, tool.input);
        toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: result });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  if (!finalText) {
    finalText = profile
      ? 'Votre profil est prêt ! Vous pouvez maintenant générer votre plan de lancement. / Your profile is ready — you can now generate your launch plan!'
      : "Désolé, je n'ai pas réussi à traiter votre message. Pouvez-vous reformuler ? / Sorry, I could not process that — could you rephrase?";
  }

  return { reply: finalText, actions, profile, completed: profile !== null };
}
