import { describe, it, expect } from 'vitest';
import { clampParams, scheduleDate } from '../src/services/calendarGenerator';

describe('calendarGenerator helpers', () => {
  it('borne weeks à 1-4 et postsPerWeek à 1-7', () => {
    // 0 est invalide → retombe sur la valeur par défaut (3)
    expect(clampParams({ weeks: 99, postsPerWeek: 0 })).toEqual({ weeks: 4, postsPerWeek: 3 });
    expect(clampParams({})).toEqual({ weeks: 2, postsPerWeek: 3 });
    expect(clampParams({ weeks: -3, postsPerWeek: 12 })).toEqual({ weeks: 1, postsPerWeek: 7 });
  });

  it('programme aux jours/heures demandés dans la plage ouvrable', () => {
    const start = new Date('2026-06-15T00:00:00');
    const d = scheduleDate(start, 3, 14, 0);
    expect(d.getDate()).toBe(18);
    expect(d.getHours()).toBe(14);
  });

  it('retombe sur des heures par défaut si heure absurde', () => {
    const start = new Date('2026-06-15T00:00:00');
    expect(scheduleDate(start, 0, 3, 0).getHours()).toBe(9);   // 1er fallback
    expect(scheduleDate(start, 0, 23, 1).getHours()).toBe(12); // 2e fallback
    expect(scheduleDate(start, 0, NaN, 2).getHours()).toBe(17);
  });

  it('borne le dayOffset à 0-31', () => {
    const start = new Date('2026-06-15T00:00:00');
    expect(scheduleDate(start, -5, 9, 0).getDate()).toBe(15);
  });
});
