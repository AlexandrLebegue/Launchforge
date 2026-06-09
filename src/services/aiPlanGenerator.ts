/**
 * AI plan generation — Claude (Anthropic API) with structured JSON output.
 * Falls back to the static templates when no API key is configured or the
 * request fails, so plan creation never hard-fails.
 */

import Anthropic from '@anthropic-ai/sdk';
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

const MODEL = 'claude-opus-4-8';

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

export interface AIPlanData {
  weekly_plan: WeeklyAction[];
  community_targets: CommunityTarget[];
  content_angles: ContentAngle[];
  outreach_strategy: OutreachStrategy[];
  launch_sequencing: LaunchSequencing[];
  validation_checklist: ValidationChecklist[];
  first_users_tactics: FirstUsersTactic[];
}

const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    weekly_plan: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          week: { type: 'integer' },
          theme: { type: 'string' },
          actions: { type: 'array', items: { type: 'string' } },
          kpis: { type: 'array', items: { type: 'string' } },
        },
        required: ['week', 'theme', 'actions', 'kpis'],
      },
    },
    community_targets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          platform: { type: 'string' },
          communities: { type: 'array', items: { type: 'string' } },
          approach: { type: 'string' },
          frequency: { type: 'string' },
        },
        required: ['platform', 'communities', 'approach', 'frequency'],
      },
    },
    content_angles: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          format: { type: 'string' },
          platforms: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
        },
        required: ['title', 'format', 'platforms', 'description'],
      },
    },
    outreach_strategy: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          phase: { type: 'string' },
          tactics: { type: 'array', items: { type: 'string' } },
          target: { type: 'string' },
        },
        required: ['phase', 'tactics', 'target'],
      },
    },
    launch_sequencing: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          phase: { type: 'string' },
          timeline: { type: 'string' },
          activities: { type: 'array', items: { type: 'string' } },
        },
        required: ['phase', 'timeline', 'activities'],
      },
    },
    validation_checklist: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          item: { type: 'string' },
          status: { type: 'string', enum: ['pending'] },
          details: { type: 'string' },
        },
        required: ['item', 'status', 'details'],
      },
    },
    first_users_tactics: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tactic: { type: 'string' },
          effort: { type: 'string', enum: ['low', 'medium', 'high'] },
          expectedResult: { type: 'string' },
        },
        required: ['tactic', 'effort', 'expectedResult'],
      },
    },
  },
  required: [
    'weekly_plan',
    'community_targets',
    'content_angles',
    'outreach_strategy',
    'launch_sequencing',
    'validation_checklist',
    'first_users_tactics',
  ],
} as const;

const SYSTEM_PROMPT = `You are a startup launch & promotion strategist. Generate a tactical, highly specific launch plan for the company described by the user.

Rules:
- Be concrete: name actual communities (subreddits, Slack/Discord groups, newsletters), actual platforms, actual content titles. No generic advice like "post on social media".
- Adapt everything to the company's niche, audience, stage and location. A local French business should get French-speaking channels and local tactics; a global SaaS gets Product Hunt / HN / niche communities.
- Write the plan content in the same language as the company description (French input → French plan).
- 4 weeks in weekly_plan, each with 3-5 actions and 2-3 measurable KPIs.
- Each other array needs at least 3 well-differentiated items.
- first_users_tactics: prioritize low-effort/high-impact tactics first.`;

function buildUserPrompt(input: PlanInput): string {
  const lines = [
    `Product: ${input.productName}`,
    `Description: ${input.description}`,
    `Target audience: ${input.targetAudience}`,
    `Niche: ${input.niche}`,
    `Goals: ${input.goals.join(', ')}`,
    `Pricing: ${input.pricing}`,
  ];
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
  const keys = Object.keys(PLAN_SCHEMA.properties);
  return keys.every((k) => Array.isArray(data?.[k]) && data[k].length > 0);
}

export async function generateAIPlan(input: PlanInput): Promise<AIPlanData> {
  const anthropic = getClient();
  if (!anthropic) return generatePlan(input);

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      output_config: {
        format: { type: 'json_schema', schema: PLAN_SCHEMA as any },
      },
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const parsed = JSON.parse(text);
    if (!isValidPlan(parsed)) return generatePlan(input);
    return parsed;
  } catch {
    return generatePlan(input);
  }
}
