/**
 * Génération de plan par IA — OpenRouter, sortie JSON validée.
 * Retombe sur les templates statiques si aucune clé n'est configurée ou si
 * la requête échoue : la création de plan ne casse jamais.
 */

import { chatComplete, sanitizeJson, isAIConfigured } from './aiClient';
import {
  PlanInput,
  WeeklyAction,
  CommunityTarget,
  ContentAngle,
  OutreachStrategy,
  LaunchSequencing,
  ValidationChecklist,
  FirstUsersTactic,
} from '../types';
import { generatePlan } from '../templates';

export interface AIPlanData {
  weekly_plan: WeeklyAction[];
  community_targets: CommunityTarget[];
  content_angles: ContentAngle[];
  outreach_strategy: OutreachStrategy[];
  launch_sequencing: LaunchSequencing[];
  validation_checklist: ValidationChecklist[];
  first_users_tactics: FirstUsersTactic[];
}

const REQUIRED_KEYS: (keyof AIPlanData)[] = [
  'weekly_plan', 'community_targets', 'content_angles', 'outreach_strategy',
  'launch_sequencing', 'validation_checklist', 'first_users_tactics',
];

const SYSTEM_PROMPT = `You are a startup growth & sales strategist. Generate a tactical, highly specific plan to win customers and grow revenue for the company described by the user — adapted to whether they are still launching or already selling.

Rules:
- Be concrete: name actual communities (subreddits, Slack/Discord groups, newsletters), actual platforms, actual content titles. No generic advice like "post on social media".
- Adapt everything to the company's niche, audience, stage and location. A local French business should get French-speaking channels and local tactics; a global SaaS gets Product Hunt / HN / niche communities.
- Weight the plan by the company's primary objective, traction stage and sales motion. A pre-revenue idea needs launch & first-customer tactics; a business that already sells needs tactics that turn reach into leads and CLOSE more sales — lead magnets, outreach sequences, demo/call CTAs, follow-up cadences, reactivation. Make outreach_strategy and first_users_tactics reflect this (for a selling business, read first_users_tactics as "next-customers tactics").
- If a bottleneck is given, make the plan attack it head-on (e.g. "traffic doesn't convert" → conversion & qualification tactics, not more reach).
- launch_sequencing is the phased ROADMAP shown to the user. For an idea / pre-launch: pre-launch → launch day → post-launch. For a business that already sells: a growth roadmap whose phases follow the funnel (e.g. "Renforcer l'acquisition" → "Améliorer la conversion" → "Closer & relancer" → "Fidéliser & étendre"). Name the phases for the company's REAL stage — never label a selling business "pre-launch".
- outreach_strategy is the acquisition & SALES playbook (also shown to the user): concrete ways to reach the buyer, qualify interest and close — cold/warm outreach, demo & call CTAs, follow-up sequences, partnerships, reactivation of cold leads. Set target to the actual buyer.
- Write the plan content in the same language as the company description (French input → French plan).
- 4 weeks in weekly_plan, each with 3-5 actions and 2-3 measurable KPIs.
- Each other array needs at least 3 well-differentiated items.
- first_users_tactics: prioritize low-effort/high-impact tactics first.

Return ONLY a valid JSON object with exactly these 7 keys (no markdown fences, no commentary):
{
  "weekly_plan": [{"week": number, "theme": string, "actions": string[], "kpis": string[]}],
  "community_targets": [{"platform": string, "communities": string[], "approach": string, "frequency": string}],
  "content_angles": [{"title": string, "format": string, "platforms": string[], "description": string}],
  "outreach_strategy": [{"phase": string, "tactics": string[], "target": string}],
  "launch_sequencing": [{"phase": string, "timeline": string, "activities": string[]}],
  "validation_checklist": [{"item": string, "status": "pending", "details": string}],
  "first_users_tactics": [{"tactic": string, "effort": "low"|"medium"|"high", "expectedResult": string}]
}`;

function buildUserPrompt(input: PlanInput): string {
  const lines = [
    `Product: ${input.productName}`,
    `Description: ${input.description}`,
    `Target audience: ${input.targetAudience}`,
    `Niche: ${input.niche}`,
    `Goals: ${input.goals.join(', ')}`,
    `Pricing: ${input.pricing}`,
  ];
  // Commercial context — steers the plan toward sales/revenue, not just reach.
  if (input.buyer) lines.push(`Buyer (who pays/decides): ${input.buyer}`);
  if (input.primaryObjective) lines.push(`Primary objective: ${input.primaryObjective}`);
  if (input.traction) lines.push(`Traction stage: ${input.traction}`);
  if (input.salesMotion) lines.push(`Sales motion: ${input.salesMotion}`);
  if (input.revenueGoal) lines.push(`Revenue goal: ${input.revenueGoal}`);
  if (input.bottleneck) lines.push(`Biggest bottleneck to more revenue: ${input.bottleneck}`);
  if (input.company) {
    const c = input.company;
    lines.push(
      '',
      'Company context (gathered during onboarding):',
      `- Name: ${c.name} (${c.exists ? 'already exists' : 'idea / not launched yet'})`,
    );
    if (c.website) lines.push(`- Website: ${c.website}`);
    if (c.location) lines.push(`- Location: ${c.location}`);
    if (c.stage) lines.push(`- Stage: ${c.stage}`);
    if (c.competitors?.length) lines.push(`- Known competitors: ${c.competitors.join(', ')}`);
    if (c.socials?.length) lines.push(`- Social accounts: ${c.socials.join(', ')}`);
    if (c.notes) lines.push(`- Notes: ${c.notes}`);
  }
  return lines.join('\n');
}

function isValidPlan(data: any): data is AIPlanData {
  return REQUIRED_KEYS.every((k) => Array.isArray(data?.[k]) && data[k].length > 0);
}

export async function generateAIPlan(input: PlanInput, userId?: string): Promise<AIPlanData> {
  if (!isAIConfigured()) return generatePlan(input);

  try {
    const result = await chatComplete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      userId,
      maxTokens: 8192,
      jsonMode: true,
      timeoutMs: 180000,
    });

    const parsed = JSON.parse(sanitizeJson(result.content));
    if (!isValidPlan(parsed)) return generatePlan(input);
    return parsed;
  } catch {
    return generatePlan(input);
  }
}
