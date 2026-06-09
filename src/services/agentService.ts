/**
 * agentService — Catalogue d'agents pré-configurés + exécution via Composio
 *
 * Chaque entrée du catalogue décrit une plateforme cible.
 * L'exécution réelle envoie un prompt à l'API Composio pour lancer l'action
 * sur la plateforme (post, tweet, message, etc.).
 */

import Anthropic from '@anthropic-ai/sdk';
import { storage } from './storage';
import { Agent, AgentPlatform, AgentTemplate, KanbanCard, LaunchPlan } from '../types';

// ── Catalogue ────────────────────────────────────────────────────────────────

export const AGENT_CATALOG: AgentTemplate[] = [
  {
    platform:    'reddit',
    name:        'Reddit Agent',
    icon:        '🟠',
    description: 'Poste et commente sur les subreddits ciblés',
    composioApp: 'REDDIT',
  },
  {
    platform:    'twitter',
    name:        'Twitter / X Agent',
    icon:        '🐦',
    description: 'Publie des tweets, répond et lance des threads',
    composioApp: 'TWITTER',
  },
  {
    platform:    'linkedin',
    name:        'LinkedIn Agent',
    icon:        '💼',
    description: 'Publie des posts professionnels et engage la communauté',
    composioApp: 'LINKEDIN',
  },
  {
    platform:    'instagram',
    name:        'Instagram Agent',
    icon:        '📸',
    description: 'Publie des images, reels et stories',
    composioApp: 'INSTAGRAM',
  },
  {
    platform:    'producthunt',
    name:        'Product Hunt Agent',
    icon:        '🐱',
    description: 'Lance, upvote et commente sur Product Hunt',
    composioApp: 'PRODUCTHUNT',
  },
  {
    platform:    'hackernews',
    name:        'Hacker News Agent',
    icon:        '🟧',
    description: 'Soumets et commente sur Hacker News',
    composioApp: 'HACKERNEWS',
  },
  {
    platform:    'indiehackers',
    name:        'Indie Hackers Agent',
    icon:        '🔨',
    description: 'Partage des milestones et engage la communauté IH',
    composioApp: 'INDIEHACKERS',
  },
  {
    platform:    'discord',
    name:        'Discord Agent',
    icon:        '💬',
    description: 'Poste dans les serveurs et canaux Discord',
    composioApp: 'DISCORD',
  },
  {
    platform:    'slack',
    name:        'Slack Agent',
    icon:        '💛',
    description: 'Envoie des messages dans les workspaces Slack',
    composioApp: 'SLACK',
  },
  {
    platform:    'github',
    name:        'GitHub Agent',
    icon:        '🐙',
    description: 'Gère issues, PRs et releases GitHub',
    composioApp: 'GITHUB',
  },
];

export function getCatalog(): AgentTemplate[] {
  return AGENT_CATALOG;
}

export function getCatalogByPlatform(platform: AgentPlatform): AgentTemplate | undefined {
  return AGENT_CATALOG.find((t) => t.platform === platform);
}

// ── Exécution ─────────────────────────────────────────────────────────────────

/**
 * Exécute une tâche Kanban via l'agent.
 *
 * 1. Si ANTHROPIC_API_KEY est présente : Claude rédige le contenu réel, prêt
 *    à publier, adapté à la plateforme et au produit du plan.
 * 2. Si COMPOSIO_API_KEY + clé de l'agent : tentative de publication via
 *    Composio en plus du brouillon.
 * 3. Sans aucune clé : message expliquant comment activer la rédaction.
 *
 * Retourne le résultat affiché dans l'historique des runs.
 */
export async function executeAgentRun(agent: Agent, card: KanbanCard, planId?: string): Promise<string> {
  const template = getCatalogByPlatform(agent.platform);
  const plan = planId ? storage.getPlan(planId) : undefined;

  const draft = await draftContent(agent, card, template, plan);

  // ── Publication via Composio (si configuré) ───────────────────────────────
  const composioKey = process.env.COMPOSIO_API_KEY;
  if (composioKey && agent.apiKey && template && draft) {
    try {
      const response = await fetch('https://backend.composio.dev/api/v1/actions/execute/CLAUDE', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'x-api-key':     composioKey,
        },
        body: JSON.stringify({
          appName:    template.composioApp,
          entityId:   agent.userId,
          authConfig: { api_key: agent.apiKey },
          input:      { prompt: draft },
        }),
      });

      if (!response.ok) {
        const txt = await response.text();
        return `⚠️ Publication Composio échouée (${response.status}: ${txt.slice(0, 200)}) — voici le contenu à publier manuellement :\n\n${draft}`;
      }

      const data = await response.json() as any;
      const output = data?.data?.output || data?.output || 'Action exécutée';
      return `✅ Publié via Composio : ${output}\n\n— Contenu publié —\n${draft}`;
    } catch (err: any) {
      return `⚠️ Publication Composio échouée (${err.message}) — voici le contenu à publier manuellement :\n\n${draft}`;
    }
  }

  if (draft) {
    return `📝 Contenu prêt à publier sur ${template?.name ?? agent.platform} (copier-coller) :\n\n${draft}`;
  }

  return `Aucune IA configurée (ANTHROPIC_API_KEY manquante) — impossible de rédiger le contenu pour "${card.title}". Configurez la clé côté serveur pour activer la rédaction automatique.`;
}

// ── Rédaction du contenu par Claude ──────────────────────────────────────────

const MODEL = 'claude-opus-4-8';
let anthropicClient: Anthropic | null = null;

function getAnthropic(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
}

const PLATFORM_GUIDELINES: Partial<Record<AgentPlatform, string>> = {
  reddit:       'Format Reddit : titre accrocheur + corps de post authentique, pas de ton publicitaire (les subreddits détestent ça), apporte de la valeur avant de mentionner le produit. Suggère 2-3 subreddits pertinents.',
  twitter:      'Format X/Twitter : tweet unique ≤ 280 caractères OU thread de 3-5 tweets numérotés. Accroche forte en premier tweet, hashtags pertinents (2 max).',
  linkedin:     'Format LinkedIn : post professionnel avec accroche en première ligne, paragraphes courts, storytelling, call-to-action final. 1300 caractères max.',
  instagram:    'Format Instagram : légende engageante avec emojis, hashtags en fin (10-15), suggestion du visuel à créer.',
  producthunt:  'Format Product Hunt : tagline (60 car. max), description du produit, premier commentaire du maker (authentique, raconte le pourquoi).',
  hackernews:   'Format Hacker News : titre Show HN sobre et factuel, texte de présentation technique et honnête, sans marketing. HN déteste le hype.',
  indiehackers: 'Format Indie Hackers : post de milestone ou de partage d\'expérience, chiffres concrets, leçons apprises, ton transparent.',
  discord:      'Format Discord : message court et conversationnel, adapté à un canal communautaire, pas de spam.',
  slack:        'Format Slack : message concis et utile pour un workspace communautaire.',
  github:       'Format GitHub : texte de README/release notes ou issue/discussion, technique et précis.',
};

async function draftContent(
  agent: Agent,
  card: KanbanCard,
  template: AgentTemplate | undefined,
  plan: LaunchPlan | undefined,
): Promise<string | null> {
  const anthropic = getAnthropic();
  if (!anthropic) return null;

  const productContext = plan
    ? `Produit : ${plan.input.productName}
Description : ${plan.input.description}
Audience cible : ${plan.input.targetAudience}
Niche : ${plan.input.niche}
Prix : ${plan.input.pricing}${plan.input.company ? `
Entreprise : ${plan.input.company.name}${plan.input.company.website ? ` (${plan.input.company.website})` : ''}` : ''}`
    : 'Produit : (contexte indisponible — reste générique mais actionnable)';

  const guidelines = PLATFORM_GUIDELINES[agent.platform] || `Adapte le contenu aux codes de la plateforme ${agent.platform}.`;

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: `Tu rédiges du contenu de promotion prêt à publier pour des startups. Tu écris dans la langue du contexte produit (français si la description est en français). Tu produis UNIQUEMENT le contenu final, sans préambule ni commentaire. ${guidelines}`,
      messages: [{
        role: 'user',
        content: `${productContext}

Tâche du plan de lancement : ${card.title}
Détails : ${card.description || '—'}
Catégorie : ${card.category}

Rédige le contenu correspondant pour ${template?.name ?? agent.platform}.`,
      }],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return text || null;
  } catch {
    return null;
  }
}
