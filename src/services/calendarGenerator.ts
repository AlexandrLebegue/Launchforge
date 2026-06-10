/**
 * Générateur de calendrier éditorial — transforme le plan de lancement +
 * la base de connaissances en un lot de posts rédigés et programmés dans
 * le Hub de contenu. Le chaînon entre la stratégie (plan) et l'exécution.
 */

import { v4 as uuid } from 'uuid';
import { chatComplete, sanitizeJson, isAIConfigured } from './aiClient';
import { buildCompanyContext, buildKnowledgeContext } from './contentAssistant';
import { storage } from './storage';
import { Post } from '../types';

export interface CalendarParams {
  userId: string;
  weeks: number;          // 1-4
  postsPerWeek: number;   // 1-7
  platforms: string[];    // plateformes choisies
  startDate: Date;
  /** 'draft' = idées à valider par l'utilisateur (bootstrap auto), 'scheduled' = programmées */
  status?: 'draft' | 'scheduled';
}

interface PlannedPost {
  platform: string;
  title: string;
  content: string;
  dayOffset: number;  // jours après startDate
  hour: number;       // heure locale de publication (0-23)
}

/** Heures de publication par défaut si le modèle en propose d'absurdes */
const FALLBACK_HOURS = [9, 12, 17];

export function clampParams(p: { weeks?: number; postsPerWeek?: number }): Pick<CalendarParams, 'weeks' | 'postsPerWeek'> {
  return {
    weeks: Math.max(1, Math.min(4, Math.round(Number(p.weeks) || 2))),
    postsPerWeek: Math.max(1, Math.min(7, Math.round(Number(p.postsPerWeek) || 3))),
  };
}

/** Date programmée d'un post à partir de son offset, bornée aux heures ouvrables */
export function scheduleDate(start: Date, dayOffset: number, hour: number, index: number): Date {
  const d = new Date(start);
  d.setDate(d.getDate() + Math.max(0, Math.min(31, Math.round(dayOffset))));
  const h = Number.isFinite(hour) && hour >= 7 && hour <= 21
    ? Math.round(hour)
    : FALLBACK_HOURS[index % FALLBACK_HOURS.length];
  d.setHours(h, 0, 0, 0);
  return d;
}

function buildPlanContext(userId: string): string {
  const plan = storage.getActivePlan(userId);
  if (!plan) return '';

  const lines: string[] = ['## Plan de lancement de l\'utilisateur'];
  for (const week of plan.weekly_plan.slice(0, 4)) {
    lines.push(`Semaine ${week.week} — ${week.theme} : ${week.actions.slice(0, 4).join(' ; ')}`);
  }
  if (plan.content_angles.length > 0) {
    lines.push('', 'Angles de contenu recommandés :');
    for (const angle of plan.content_angles.slice(0, 6)) {
      lines.push(`- ${angle.title} (${angle.format}) : ${angle.description}`);
    }
  }
  if (plan.community_targets.length > 0) {
    lines.push('', 'Communautés cibles :');
    for (const target of plan.community_targets.slice(0, 4)) {
      lines.push(`- ${target.platform} : ${target.communities.slice(0, 3).join(', ')} — ${target.approach}`);
    }
  }
  return lines.join('\n');
}

export async function generateContentCalendar(params: CalendarParams): Promise<Post[]> {
  if (!isAIConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const { weeks, postsPerWeek } = clampParams(params);
  const total = Math.min(weeks * postsPerWeek, 20);
  const platforms = params.platforms.length > 0 ? params.platforms : ['linkedin', 'twitter'];

  const company   = buildCompanyContext(params.userId);
  const knowledge = buildKnowledgeContext(params.userId, 6000);
  const planCtx   = buildPlanContext(params.userId);

  const systemParts = [
    `Tu es le responsable éditorial d'une startup. Tu produis un calendrier de ${total} posts COMPLETS et prêts à publier (pas des idées : le contenu final), répartis sur ${weeks} semaine(s) à raison d'environ ${postsPerWeek} posts/semaine.`,
    `Plateformes autorisées (uniquement celles-ci) : ${platforms.join(', ')}. Varie les plateformes et les formats. Respecte les codes de chaque plateforme (thread X numéroté, accroche LinkedIn avant le « voir plus », post Reddit authentique sans ton publicitaire, etc.).`,
    'Construis une progression cohérente (teasing → valeur/éducation → preuve sociale → conversion). Chaque post doit être autonome et apporter de la valeur. Écris dans la langue du contexte entreprise (français si la description est en français).',
  ];
  if (company)   systemParts.push(`## Contexte entreprise\n${company}`);
  if (planCtx)   systemParts.push(planCtx);
  if (knowledge) systemParts.push(`## Base de connaissances (source de vérité)\n${knowledge}`);
  systemParts.push(
    'Réponds UNIQUEMENT avec un objet JSON :\n' +
    '{"posts": [{"platform": "...", "title": "titre interne court", "content": "contenu complet prêt à publier", "dayOffset": 0, "hour": 9}]}\n' +
    `dayOffset = jours après la date de début (0 à ${weeks * 7 - 1}), répartis régulièrement (pas tout le même jour). hour entre 8 et 19.`
  );

  const result = await chatComplete({
    messages: [
      { role: 'system', content: systemParts.join('\n\n') },
      { role: 'user', content: `Génère le calendrier de ${total} posts.` },
    ],
    maxTokens: 8192,
    jsonMode: true,
    timeoutMs: 240000,
  });

  const parsed = JSON.parse(sanitizeJson(result.content));
  const raw: any[] = Array.isArray(parsed?.posts) ? parsed.posts : [];
  if (raw.length === 0) throw new Error('Le modèle n\'a généré aucun post');

  const now = new Date().toISOString();
  const created: Post[] = [];

  raw.slice(0, total).forEach((p, i) => {
    if (!p || typeof p.content !== 'string' || !p.content.trim()) return;
    const platform = platforms.includes(p.platform) ? p.platform : platforms[i % platforms.length];
    const scheduled = scheduleDate(params.startDate, Number(p.dayOffset) || Math.floor((i / total) * weeks * 7), Number(p.hour), i);

    const post: Post = {
      id:          uuid(),
      userId:      params.userId,
      planId:      storage.getActivePlan(params.userId)?.id ?? null,
      platform,
      title:       typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, 150) : `Post ${i + 1}`,
      content:     p.content.trim(),
      status:      params.status ?? 'scheduled',
      scheduledAt: scheduled.toISOString(),
      publishedAt: null,
      externalUrl: null,
      imageUrl:    null,
      recurrence:  'none',
      recurrenceBrief: null,
      autoPublish: 0,
      publishError: null,
      calendarSynced: 0,
      impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0,
      createdAt:   now,
      updatedAt:   now,
    };
    storage.savePost(post);
    created.push(post);
  });

  if (created.length === 0) throw new Error('Aucun post valide généré');
  return created;
}
