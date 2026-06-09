/**
 * Assistant de génération de contenu — Claude + base de connaissances.
 *
 * Toutes les générations (assistant du Content Hub, agents Kanban) injectent
 * la base de connaissances de l'utilisateur et le contexte entreprise de son
 * dernier plan : l'utilisateur enrichit sa base une fois, toute l'IA en profite.
 */

import Anthropic from '@anthropic-ai/sdk';
import { storage } from './storage';
import { KnowledgeCategory } from '../types';

const MODEL = 'claude-opus-4-8';

let client: Anthropic | null = null;

export function isContentAssistantConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  company:  'Entreprise',
  product:  'Produit / Service',
  audience: 'Audience',
  tone:     'Ton & style',
  offers:   'Offres & tarifs',
  other:    'Divers',
};

/** Concatène la base de connaissances de l'utilisateur (bornée en taille) */
export function buildKnowledgeContext(userId: string, maxChars = 8000): string {
  const entries = storage.getKnowledgeByUserId(userId);
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
  const plans = storage.getPlansByUserId(userId);
  if (plans.length === 0) return '';
  const input = plans[0].input;
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

const GENERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title:    { type: 'string', description: 'Titre court du post (usage interne / titre de la publication)' },
    content:  { type: 'string', description: 'Le contenu complet, prêt à publier' },
    hashtags: { type: 'array', items: { type: 'string' }, description: 'Hashtags suggérés sans le #, vide si non pertinent' },
  },
  required: ['title', 'content', 'hashtags'],
} as const;

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
}

export async function generateContent(params: GenerateParams): Promise<GeneratedContent> {
  const anthropic = getClient();
  if (!anthropic) {
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

  const userPrompt = params.baseContent
    ? `Améliore ce contenu existant en suivant ces consignes : ${params.brief}\n\n--- Contenu actuel ---\n${params.baseContent}`
    : `Brief : ${params.brief}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 3000,
    system: systemParts.join('\n\n'),
    output_config: {
      format: { type: 'json_schema', schema: GENERATION_SCHEMA as any },
    },
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const parsed = JSON.parse(text) as GeneratedContent;
  if (!parsed.content) throw new Error('Empty generation');
  return {
    title: parsed.title || params.brief.slice(0, 60),
    content: parsed.content,
    hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
  };
}
