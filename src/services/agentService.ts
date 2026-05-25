/**
 * agentService — Catalogue d'agents pré-configurés + exécution via Composio
 *
 * Chaque entrée du catalogue décrit une plateforme cible.
 * L'exécution réelle envoie un prompt à l'API Composio pour lancer l'action
 * sur la plateforme (post, tweet, message, etc.).
 */

import { Agent, AgentPlatform, AgentTemplate, KanbanCard } from '../types';

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
 * Si COMPOSIO_API_KEY est présent, l'appel réel sera envoyé à Composio.
 * Sinon, on simule l'exécution pour le développement local.
 *
 * Retourne un message de résultat (succès ou erreur).
 */
export async function executeAgentRun(agent: Agent, card: KanbanCard): Promise<string> {
  const template = getCatalogByPlatform(agent.platform);
  const composioKey = process.env.COMPOSIO_API_KEY;

  // ── Mode Composio (production) ────────────────────────────────────────────
  if (composioKey && template) {
    try {
      const prompt = buildPrompt(agent, card, template);

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
          input:      { prompt },
        }),
      });

      if (!response.ok) {
        const txt = await response.text();
        throw new Error(`Composio ${response.status}: ${txt}`);
      }

      const data = await response.json() as any;
      return data?.data?.output || data?.output || '✅ Action exécutée avec succès';
    } catch (err: any) {
      throw new Error(`Composio error: ${err.message}`);
    }
  }

  // ── Mode simulation (dev sans clé Composio) ───────────────────────────────
  await new Promise((r) => setTimeout(r, 800)); // simule la latence réseau

  const platform = template?.name ?? agent.platform;
  return `[SIMULATION] Agent ${platform} — tâche "${card.title}" prise en charge. Connectez votre clé API ${agent.platform.toUpperCase()} dans les paramètres de l'agent pour activer les actions réelles.`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildPrompt(agent: Agent, card: KanbanCard, template: AgentTemplate): string {
  return `Tu es un agent marketing spécialisé sur ${template.name}.

Tâche assignée : ${card.title}
Contexte : ${card.description}
Catégorie : ${card.category}
Effort estimé : ${card.effort}

Effectue cette action sur ${template.name} de manière professionnelle et engageante.
Adapte le ton à la plateforme ${agent.platform}.
Sois concis et percutant.`;
}
