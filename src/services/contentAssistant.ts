/**
 * Assistant de génération de contenu — OpenRouter + base de connaissances.
 *
 * Toutes les générations (assistant du Content Hub, agents Kanban) injectent
 * la base de connaissances de l'utilisateur et le contexte entreprise de son
 * dernier plan : l'utilisateur enrichit sa base une fois, toute l'IA en profite.
 */

import { chatComplete, sanitizeJson, isAIConfigured } from './aiClient';
import { storage } from './storage';
import { webSearch } from './research';
import { KnowledgeCategory } from '../types';

export function isContentAssistantConfigured(): boolean {
  return isAIConfigured();
}

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  company:  'Entreprise',
  product:  'Produit / Service',
  audience: 'Audience',
  tone:     'Ton & style',
  offers:   'Offres & tarifs',
  learnings:'Enseignements de performance (issus de VOS résultats — applique-les en priorité)',
  other:    'Divers',
};

/** Concatène la base de connaissances du projet actif (bornée en taille) */
export function buildKnowledgeContext(userId: string, maxChars = 8000): string {
  const entries = storage.getKnowledgeByPlan(userId, storage.getActivePlanId(userId));
  if (entries.length === 0) return '';

  let out = '';
  for (const e of entries) {
    const block = `### [${CATEGORY_LABELS[e.category as KnowledgeCategory] ?? e.category}] ${e.title}\n${e.content}\n\n`;
    if (out.length + block.length > maxChars) break;
    out += block;
  }
  return out.trim();
}

/** Contexte entreprise tiré du plan le plus récent de l'utilisateur */
export function buildCompanyContext(userId: string): string {
  const plan = storage.getActivePlan(userId);
  if (!plan) return '';
  const input = plan.input;
  const lines = [
    `Produit : ${input.productName}`,
    `Description : ${input.description}`,
    `Audience cible : ${input.targetAudience}`,
    `Niche : ${input.niche}`,
    `Prix : ${input.pricing}`,
  ];
  if (input.company) {
    lines.push(`Entreprise : ${input.company.name}${input.company.website ? ` (${input.company.website})` : ''}`);
    if (input.company.location) lines.push(`Localisation : ${input.company.location}`);
  }
  return lines.join('\n');
}

const PLATFORM_GUIDELINES: Record<string, string> = {
  reddit:       'Post Reddit : authentique, valeur d\'abord, jamais publicitaire. Suggère le subreddit en première ligne du titre si pertinent.',
  twitter:      'X/Twitter : tweet ≤ 280 caractères OU thread numéroté de 3 à 6 tweets. Accroche forte, 1-2 hashtags max.',
  linkedin:     'LinkedIn : accroche en première ligne (avant le "voir plus"), paragraphes courts, storytelling, CTA final. ≤ 1300 caractères.',
  instagram:    'Instagram : légende engageante avec emojis, suggestion de visuel entre crochets, hashtags séparés.',
  facebook:     'Facebook : ton conversationnel, 1-3 paragraphes, question pour engager les commentaires.',
  tiktok:       'TikTok : script vidéo de 30-60 s — hook (3 premières secondes), déroulé, CTA. Indique les plans visuels entre crochets.',
  youtube:      'YouTube : titre accrocheur ≤ 70 caractères + description optimisée SEO + 3 idées de miniature.',
  producthunt:  'Product Hunt : tagline ≤ 60 caractères, description produit, premier commentaire maker authentique.',
  hackernews:   'Hacker News : titre Show HN sobre et factuel, texte technique honnête, zéro hype.',
  indiehackers: 'Indie Hackers : partage d\'expérience transparent, chiffres concrets, leçons apprises.',
  blog:         'Article de blog : structure H2/H3 en markdown, intro accrocheuse, conclusion avec CTA. 600-1000 mots.',
  newsletter:   'Newsletter : objet d\'email percutant, contenu scannable, un seul CTA clair.',
  discord:      'Discord : message court et conversationnel pour un canal communautaire.',
  slack:        'Slack : message concis et utile pour un workspace communautaire.',
  github:       'GitHub : README/release notes/discussion, technique et précis.',
};

export interface GeneratedContent {
  title: string;
  content: string;
  hashtags: string[];
}

export interface GenerateParams {
  userId: string;
  platform: string;
  brief: string;
  tone?: string;
  /** Contenu existant à améliorer plutôt que créer de zéro */
  baseContent?: string;
  /** Enrichir avec une recherche d'actualités web sur le sujet */
  useNews?: boolean;
}

export async function generateContent(params: GenerateParams): Promise<GeneratedContent> {
  if (!isAIConfigured()) {
    throw new Error('AI_NOT_CONFIGURED');
  }

  const knowledge = buildKnowledgeContext(params.userId);
  const company   = buildCompanyContext(params.userId);
  const guideline = PLATFORM_GUIDELINES[params.platform] || `Adapte le contenu aux codes de la plateforme ${params.platform}.`;

  const systemParts = [
    'Tu es le rédacteur de contenu d\'une startup. Tu produis du contenu prêt à publier, percutant et authentique — jamais de langue de bois marketing.',
    'Tu écris dans la langue du brief de l\'utilisateur (français si le brief est en français).',
    guideline,
  ];
  if (company)   systemParts.push(`## Contexte entreprise\n${company}`);
  if (knowledge) systemParts.push(`## Base de connaissances de l'utilisateur (source de vérité — utilise ces informations en priorité)\n${knowledge}`);
  if (params.tone) systemParts.push(`Ton demandé : ${params.tone}`);

  // Variabilité : même brief ≠ même post. On interdit les angles déjà
  // utilisés et on impose un angle neuf à chaque génération.
  const recentTitles = storage.getPostsByPlan(params.userId, storage.getActivePlanId(params.userId))
    .slice(0, 15)
    .map((p) => p.title)
    .filter(Boolean);
  if (recentTitles.length > 0 && !params.baseContent) {
    systemParts.push(
      `## Angles déjà utilisés (NE PAS répéter — trouve un angle réellement différent : autre accroche, autre format, autre bénéfice mis en avant)\n- ${recentTitles.join('\n- ')}`
    );
  }
  systemParts.push(`Contexte temporel : nous sommes le ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}. Chaque génération doit être unique.`);

  // Actualités du web : ancrer le post dans l'actu du sujet
  if (params.useNews && !params.baseContent) {
    try {
      const companyName = company.match(/Entreprise : ([^\n(]+)/)?.[1]?.trim() ?? '';
      const snippets = await webSearch(`${params.brief.slice(0, 80)} ${companyName} actualité ${new Date().getFullYear()}`, 6);
      if (snippets.length > 0) {
        systemParts.push(
          `## Actualités du web sur le sujet (résultats de recherche bruts — sers-t'en pour ancrer le post dans l'actualité, ne cite que ce qui est crédible)\n${snippets.map((s) => `- ${s.slice(0, 220)}`).join('\n')}`
        );
      }
    } catch { /* la génération reste possible sans actus */ }
  }
  systemParts.push(
    'Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour ni fences markdown :\n' +
    '{"title": "titre court du post (usage interne)", "content": "le contenu complet prêt à publier", "hashtags": ["hashtag", "sans", "le", "diese"]}\n' +
    'hashtags : tableau vide si non pertinent pour la plateforme.'
  );

  const userPrompt = params.baseContent
    ? `Améliore ce contenu existant en suivant ces consignes : ${params.brief}\n\n--- Contenu actuel ---\n${params.baseContent}`
    : `Brief : ${params.brief}`;

  const result = await chatComplete({
    messages: [
      { role: 'system', content: systemParts.join('\n\n') },
      { role: 'user', content: userPrompt },
    ],
    maxTokens: 3000,
    jsonMode: true,
  });

  const parsed = JSON.parse(sanitizeJson(result.content)) as GeneratedContent;
  if (!parsed.content) throw new Error('Empty generation');
  return {
    title: parsed.title || params.brief.slice(0, 60),
    content: parsed.content,
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
  };
}
