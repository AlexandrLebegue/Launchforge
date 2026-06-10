/**
 * agentService — Catalogue d'agents pré-configurés + exécution via Composio
 *
 * Chaque entrée du catalogue décrit une plateforme cible.
 * L'exécution réelle envoie un prompt à l'API Composio pour lancer l'action
 * sur la plateforme (post, tweet, message, etc.).
 */

import { chatComplete, isAIConfigured } from './aiClient';
import { publishViaComposio, isComposioConfigured } from './composio';
import { storage } from './storage';
import { buildKnowledgeContext } from './contentAssistant';
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
 * Pipeline d'exécution d'une tâche Kanban assignée à un agent :
 *
 *   1. Claude rédige le contenu prêt à publier (adapté plateforme + produit).
 *   2a. approvalMode = 'auto'   → publication immédiate (Composio si dispo).
 *   2b. approvalMode = 'manual' → run en 'awaiting_approval' ; l'utilisateur
 *       valide ou rejette depuis la page Validations.
 *
 * Le statut et le résultat sont persistés sur le run au fil du pipeline.
 */
export async function processAgentRun(runId: string, agent: Agent, card: KanbanCard, planId?: string): Promise<void> {
  const template = getCatalogByPlatform(agent.platform);
  const plan = planId ? storage.getPlan(planId) : undefined;

  const draft = await draftContent(agent, card, template, plan);

  if (!draft) {
    storage.updateRunStatus(
      runId,
      'failed',
      `Aucune IA configurée (OPENROUTER_API_KEY manquante) — impossible de rédiger le contenu pour "${card.title}".`
    );
    storage.updateAgent(agent.id, { status: 'error' });
    return;
  }

  if (agent.approvalMode === 'auto') {
    const result = await publishContent(agent, draft);
    storage.updateRunStatus(runId, 'done', result);
    storage.updateAgent(agent.id, { status: 'active', lastRunAt: new Date().toISOString() });
    return;
  }

  // Validation manuelle : le brouillon attend l'utilisateur
  storage.updateRunStatus(runId, 'awaiting_approval', draft);
}

/**
 * Publication du contenu (appelée en mode auto, ou à la validation par
 * l'utilisateur). Tente le serveur MCP Composio si configuré ; sinon le
 * contenu est fourni à copier-coller.
 */
export async function publishContent(agent: Agent, content: string): Promise<string> {
  const template = getCatalogByPlatform(agent.platform);

  if (isComposioConfigured()) {
    try {
      const result = await publishViaComposio(agent.platform, content);
      if (result.trim().toUpperCase().startsWith('OK')) {
        return `✅ Publié via Composio — ${result.replace(/^OK:\s*/i, '')}\n\n— Contenu publié —\n${content}`;
      }
      return `⚠️ Publication Composio non aboutie (${result.replace(/^ECHEC:\s*/i, '')}) — voici le contenu à publier manuellement :\n\n${content}`;
    } catch (err: any) {
      return `⚠️ Publication Composio échouée (${err.message}) — voici le contenu à publier manuellement :\n\n${content}`;
    }
  }

  return `📝 Contenu validé, prêt à publier sur ${template?.name ?? agent.platform} (copier-coller) :\n\n${content}`;
}

// ── Rédaction du contenu par l'IA ─────────────────────────────────────────────

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
  if (!isAIConfigured()) return null;

  const productContext = plan
    ? `Produit : ${plan.input.productName}
Description : ${plan.input.description}
Audience cible : ${plan.input.targetAudience}
Niche : ${plan.input.niche}
Prix : ${plan.input.pricing}${plan.input.company ? `
Entreprise : ${plan.input.company.name}${plan.input.company.website ? ` (${plan.input.company.website})` : ''}` : ''}`
    : 'Produit : (contexte indisponible — reste générique mais actionnable)';

  const guidelines = PLATFORM_GUIDELINES[agent.platform] || `Adapte le contenu aux codes de la plateforme ${agent.platform}.`;
  const knowledge = buildKnowledgeContext(agent.userId, 6000);

  try {
    const result = await chatComplete({
      messages: [
        {
          role: 'system',
          content: `Tu rédiges du contenu de promotion prêt à publier pour des startups. Tu écris dans la langue du contexte produit (français si la description est en français). Tu produis UNIQUEMENT le contenu final, sans préambule ni commentaire. ${guidelines}${knowledge ? `\n\n## Base de connaissances de l'utilisateur (source de vérité)\n${knowledge}` : ''}`,
        },
        {
          role: 'user',
          content: `${productContext}

Tâche du plan de lancement : ${card.title}
Détails : ${card.description || '—'}
Catégorie : ${card.category}

Rédige le contenu correspondant pour ${template?.name ?? agent.platform}.`,
        },
      ],
      maxTokens: 1500,
    });

    return result.content.trim() || null;
  } catch {
    return null;
  }
}
