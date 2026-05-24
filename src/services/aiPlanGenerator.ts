import { PlanInput, WeeklyAction, CommunityTarget, ContentAngle, OutreachStrategy, LaunchSequencing, ValidationChecklist, FirstUsersTactic } from '../types';
import { generatePlan } from '../templates';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MODEL = 'deepseek/deepseek-v4-flash';

function getApiKey(): string {
  return process.env.OPENROUTER_API_KEY || '';
}

function buildSystemPrompt(): string {
  return `You are a launch strategy expert. Generate a detailed launch plan as JSON only.
Return valid JSON with exactly these 7 keys (no markdown, no comments):
{
  "weekly_plan": [{"week": number, "theme": string, "actions": string[], "kpis": string[]}],
  "community_targets": [{"platform": string, "communities": string[], "approach": string, "frequency": string}],
  "content_angles": [{"title": string, "format": string, "platforms": string[], "description": string}],
  "outreach_strategy": [{"phase": string, "tactics": string[], "target": string}],
  "launch_sequencing": [{"phase": string, "timeline": string, "activities": string[]}],
  "validation_checklist": [{"item": string, "status": "pending", "details": string}],
  "first_users_tactics": [{"tactic": string, "effort": "low"|"medium"|"high", "expectedResult": string}]
}
Each array must have at least 3 items. Return ONLY the JSON object.`;
}

function buildUserPrompt(input: PlanInput): string {
  return `Generate a launch plan for:
- Product: ${input.productName}
- Description: ${input.description}
- Target Audience: ${input.targetAudience}
- Niche: ${input.niche}
- Goals: ${input.goals.join(', ')}
- Pricing: ${input.pricing}

Return only valid JSON.`;
}

function sanitizeJson(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return cleaned.trim();
}

function validateAIPlanResponse(data: any): boolean {
  const requiredKeys = ['weekly_plan', 'community_targets', 'content_angles', 'outreach_strategy', 'launch_sequencing', 'validation_checklist', 'first_users_tactics'];
  for (const key of requiredKeys) {
    if (!Array.isArray(data[key]) || data[key].length === 0) return false;
  }
  return true;
}

function castToPlanData(data: any) {
  return {
    weekly_plan: data.weekly_plan as WeeklyAction[],
    community_targets: data.community_targets as CommunityTarget[],
    content_angles: data.content_angles as ContentAngle[],
    outreach_strategy: data.outreach_strategy as OutreachStrategy[],
    launch_sequencing: data.launch_sequencing as LaunchSequencing[],
    validation_checklist: data.validation_checklist as ValidationChecklist[],
    first_users_tactics: data.first_users_tactics as FirstUsersTactic[],
  };
}

export async function generateAIPlan(input: PlanInput): Promise<{
  weekly_plan: WeeklyAction[];
  community_targets: CommunityTarget[];
  content_angles: ContentAngle[];
  outreach_strategy: OutreachStrategy[];
  launch_sequencing: LaunchSequencing[];
  validation_checklist: ValidationChecklist[];
  first_users_tactics: FirstUsersTactic[];
}> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return generatePlan(input);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://launchforge.app',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: buildSystemPrompt() },
          { role: 'user', content: buildUserPrompt(input) },
        ],
        temperature: 0.7,
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return generatePlan(input);
    }

    const result: any = await response.json();
    const content = result?.choices?.[0]?.message?.content;
    if (!content) {
      return generatePlan(input);
    }

    const cleaned = sanitizeJson(content);
    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return generatePlan(input);
    }

    if (!validateAIPlanResponse(parsed)) {
      return generatePlan(input);
    }

    return castToPlanData(parsed);
  } catch {
    clearTimeout(timeout);
    return generatePlan(input);
  }
}