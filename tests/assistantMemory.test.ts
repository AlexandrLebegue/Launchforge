/**
 * Mémoire inter-sessions de l'assistant + boucle d'apprentissage autonome.
 * On teste les chemins DÉTERMINISTES (aucun appel IA) : stockage/lecture de la
 * mémoire, recherche dans les fils passés, et dérivation des enseignements à
 * partir des agrégats de performance.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { initEngine } from '../src/db';
import { storage } from '../src/services/storage';
import { deriveStatsLearnings, ProjectStats } from '../src/services/analytics';

beforeAll(async () => {
  await initEngine();
});

describe('Mémoire inter-sessions (stockage)', () => {
  const userId = 'mem-user-1';

  it('renvoie null quand aucune mémoire n\'existe', () => {
    expect(storage.getAssistantMemory(userId, null)).toBeNull();
  });

  it('écrit puis relit la mémoire pour (utilisateur, projet)', () => {
    storage.saveAssistantMemory(userId, null, '- Préfère des réponses courtes\n- Objectif : 10 clients');
    const mem = storage.getAssistantMemory(userId, null);
    expect(mem?.content).toContain('réponses courtes');
    expect(mem?.updatedAt).toBeTruthy();
  });

  it('upsert : réécrit sans dupliquer (même clé userId+projet)', () => {
    storage.saveAssistantMemory(userId, null, 'v2');
    expect(storage.getAssistantMemory(userId, null)?.content).toBe('v2');
  });

  it('isole la mémoire par projet', () => {
    storage.saveAssistantMemory(userId, 'plan-x', 'mémoire du projet X');
    expect(storage.getAssistantMemory(userId, 'plan-x')?.content).toBe('mémoire du projet X');
    expect(storage.getAssistantMemory(userId, null)?.content).toBe('v2'); // inchangée
  });
});

describe('Recherche dans les fils passés (remémoration)', () => {
  const userId = 'mem-user-2';

  beforeAll(() => {
    storage.saveUser({ id: userId, email: 'mem2@launchforge.dev', name: 'Mem2', createdAt: new Date().toISOString() } as any, 'x');
    storage.upsertConversation({
      id: 'conv-1', userId, planId: null,
      messages: [
        { role: 'user', text: 'On lance sur Product Hunt le 12 mars, tu me rappelles la stratégie ?' },
        { role: 'assistant', text: 'Oui : teaser LinkedIn J-3, puis Show HN le jour J.' },
      ],
    });
  });

  it('retrouve un fil par mot-clé, avec extrait', () => {
    const hits = storage.searchConversations(userId, 'Product Hunt');
    expect(hits.length).toBe(1);
    expect(hits[0].id).toBe('conv-1');
    expect(hits[0].snippet.toLowerCase()).toContain('product hunt');
  });

  it('recherche insensible à la casse', () => {
    expect(storage.searchConversations(userId, 'show hn').length).toBe(1);
  });

  it('ne renvoie rien pour un terme absent, ni pour une requête trop courte', () => {
    expect(storage.searchConversations(userId, 'reddit')).toEqual([]);
    expect(storage.searchConversations(userId, 'a')).toEqual([]);
  });

  it('ne fuit pas les fils d\'un autre utilisateur', () => {
    expect(storage.searchConversations('someone-else', 'Product Hunt')).toEqual([]);
  });
});

describe('Boucle d\'apprentissage autonome (deriveStatsLearnings)', () => {
  const base: ProjectStats = {
    publishedCount: 10, withMetricsCount: 8,
    totals: { impressions: 0, likes: 0, comments: 0, shares: 0, clicks: 0 },
    avgEngagement: 3,
    byPlatform: [
      { platform: 'linkedin', posts: 4, impressions: 100, avgEngagement: 5, leads: 0 },
      { platform: 'twitter', posts: 4, impressions: 100, avgEngagement: 1, leads: 0 },
    ],
    byDay: [
      { day: 'mardi', posts: 3, avgEngagement: 6 },
      { day: 'dimanche', posts: 3, avgEngagement: 1 },
    ],
    media: {
      withMedia: { posts: 4, avgEngagement: 5 },
      withoutMedia: { posts: 4, avgEngagement: 2 },
    },
    topPosts: [], flopPosts: [],
    leads: { total: 0, fromPosts: 0, hot: 0, byPost: [] },
    lastWeek: { posts: 0, impressions: 0, likes: 0 },
    previousWeek: { posts: 0, impressions: 0, likes: 0 },
    crossGroups: [],
  };

  it('dérive média + meilleur jour + meilleure plateforme', () => {
    const lines = deriveStatsLearnings(base);
    expect(lines.some((l) => l.includes('visuel'))).toBe(true);
    expect(lines.some((l) => l.includes('mardi'))).toBe(true);
    expect(lines.some((l) => l.toLowerCase().includes('linkedin'))).toBe(true);
  });

  it('reste silencieux quand le signal est trop faible (< 3 posts avec métriques)', () => {
    expect(deriveStatsLearnings({ ...base, withMetricsCount: 2 })).toEqual([]);
  });

  it('n\'invente pas d\'écart média quand il est négligeable', () => {
    const lines = deriveStatsLearnings({
      ...base,
      media: { withMedia: { posts: 4, avgEngagement: 3.0 }, withoutMedia: { posts: 4, avgEngagement: 3.2 } },
    });
    expect(lines.some((l) => l.includes('visuel'))).toBe(false);
  });
});
