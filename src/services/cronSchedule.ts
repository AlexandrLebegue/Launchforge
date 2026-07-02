/**
 * Planification des automatisations : « heure de la journée + périodicité ».
 *
 * Deux familles de cadence :
 *  - intraday (hourly/every_3h/every_6h) : simple « maintenant + N minutes ».
 *  - calendaire (daily/weekly/monthly)   : ancrée à une HEURE précise de la
 *    journée en Europe/Paris (et un jour de semaine/mois), quel que soit le
 *    fuseau du serveur. Le calcul convertit l'heure « murale » de Paris en
 *    instant UTC via Intl (gère automatiquement l'heure d'été/hiver).
 */

import { CronFrequency, CronJob, CRON_FREQUENCY_MINUTES, isIntradayFrequency } from '../types';

const TZ = 'Europe/Paris';

const WEEKDAY_LABELS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

export interface CronSchedule {
  frequency: CronFrequency;
  timeOfDay: string | null;   // "HH:MM" (Europe/Paris)
  weekday: number | null;     // 1=lundi … 7=dimanche
  dayOfMonth: number | null;  // 1..28
}

/** Extrait la planification d'une automatisation. */
export function scheduleOf(job: CronJob): CronSchedule {
  return { frequency: job.frequency, timeOfDay: job.timeOfDay, weekday: job.weekday, dayOfMonth: job.dayOfMonth };
}

/** Minutes dont Paris est en avance sur UTC à cet instant (60 hiver, 120 été). */
function parisOffsetMs(date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') m[p.type] = p.value;
  let hour = Number(m.hour);
  if (hour === 24) hour = 0; // certains environnements rendent minuit en « 24 »
  const asUTC = Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), hour, Number(m.minute), Number(m.second));
  return asUTC - date.getTime();
}

/** Instant UTC correspondant à une heure « murale » de Paris (année, mois0, jour, h, min). */
function parisWallToUtc(y: number, mon0: number, d: number, h: number, min: number): Date {
  const guess = Date.UTC(y, mon0, d, h, min);
  // Deux corrections successives couvrent les bascules d'heure d'été/hiver.
  let res = guess - parisOffsetMs(new Date(guess));
  res = guess - parisOffsetMs(new Date(res));
  return new Date(res);
}

/** Parties de date à Paris (année, mois0, jour, jour de semaine 1–7) d'un instant. */
function parisParts(date: Date): { y: number; mon0: number; d: number; weekday: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') m[p.type] = p.value;
  const wd: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { y: Number(m.year), mon0: Number(m.month) - 1, d: Number(m.day), weekday: wd[m.weekday] ?? 1 };
}

/** Normalise/parse une heure « HH:MM » (défaut 09:00). */
export function parseTimeOfDay(t: string | null | undefined): { h: number; min: number } {
  const mm = /^(\d{1,2}):(\d{2})$/.exec((t ?? '').trim());
  if (!mm) return { h: 9, min: 0 };
  return { h: Math.max(0, Math.min(23, Number(mm[1]))), min: Math.max(0, Math.min(59, Number(mm[2]))) };
}

/** Minutes nominales d'une périodicité (dérivé pour stockage/affichage). */
export function nominalMinutes(freq: CronFrequency): number {
  return CRON_FREQUENCY_MINUTES[freq];
}

/**
 * Prochaine exécution (ISO) STRICTEMENT après `from`, selon la périodicité.
 * Intraday : from + N minutes. Calendaire : prochaine occurrence à l'heure fixée.
 */
export function computeNextRunAt(s: CronSchedule, from: Date = new Date()): string {
  if (isIntradayFrequency(s.frequency)) {
    return new Date(from.getTime() + CRON_FREQUENCY_MINUTES[s.frequency] * 60_000).toISOString();
  }

  const { h, min } = parseTimeOfDay(s.timeOfDay);
  const base = parisParts(from);

  if (s.frequency === 'daily') {
    for (let add = 0; add <= 1; add++) {
      const cand = parisWallToUtc(base.y, base.mon0, base.d + add, h, min);
      if (cand.getTime() > from.getTime()) return cand.toISOString();
    }
    return parisWallToUtc(base.y, base.mon0, base.d + 1, h, min).toISOString();
  }

  if (s.frequency === 'weekly') {
    const target = s.weekday && s.weekday >= 1 && s.weekday <= 7 ? s.weekday : 1;
    for (let add = 0; add <= 7; add++) {
      const cand = parisWallToUtc(base.y, base.mon0, base.d + add, h, min);
      if (cand.getTime() > from.getTime() && parisParts(cand).weekday === target) return cand.toISOString();
    }
    // Repli : dans 7 jours à la même heure
    return parisWallToUtc(base.y, base.mon0, base.d + 7, h, min).toISOString();
  }

  // monthly
  const dom = s.dayOfMonth && s.dayOfMonth >= 1 && s.dayOfMonth <= 28 ? s.dayOfMonth : 1;
  for (let addMon = 0; addMon <= 1; addMon++) {
    const cand = parisWallToUtc(base.y, base.mon0 + addMon, dom, h, min);
    if (cand.getTime() > from.getTime()) return cand.toISOString();
  }
  return parisWallToUtc(base.y, base.mon0 + 1, dom, h, min).toISOString();
}

/** Heure « 9h00 » à partir de « 09:00 ». */
function prettyTime(t: string | null): string {
  const { h, min } = parseTimeOfDay(t);
  return min === 0 ? `${h}h` : `${h}h${String(min).padStart(2, '0')}`;
}

/** Libellé lisible d'une cadence (« Chaque lundi à 9h », « Toutes les 3 heures »…). */
export function describeCronSchedule(s: CronSchedule): string {
  switch (s.frequency) {
    case 'hourly':   return 'Toutes les heures';
    case 'every_3h': return 'Toutes les 3 heures';
    case 'every_6h': return 'Toutes les 6 heures';
    case 'daily':    return `Chaque jour à ${prettyTime(s.timeOfDay)}`;
    case 'weekly':   return `Chaque ${WEEKDAY_LABELS[s.weekday && s.weekday >= 1 && s.weekday <= 7 ? s.weekday : 1]} à ${prettyTime(s.timeOfDay)}`;
    case 'monthly':  return `Le ${s.dayOfMonth && s.dayOfMonth >= 1 && s.dayOfMonth <= 28 ? s.dayOfMonth : 1} de chaque mois à ${prettyTime(s.timeOfDay)}`;
    default:         return 'Périodique';
  }
}

/**
 * Normalise une entrée de planification (depuis l'API ou un outil IA) en un
 * schedule cohérent : ne conserve les ancres que pour la famille concernée,
 * pose des défauts raisonnables (9h, lundi, le 1er).
 */
export function normalizeSchedule(input: {
  frequency: CronFrequency;
  timeOfDay?: string | null;
  weekday?: number | null;
  dayOfMonth?: number | null;
}): CronSchedule {
  if (isIntradayFrequency(input.frequency)) {
    return { frequency: input.frequency, timeOfDay: null, weekday: null, dayOfMonth: null };
  }
  const { h, min } = parseTimeOfDay(input.timeOfDay ?? '09:00');
  const timeOfDay = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  if (input.frequency === 'weekly') {
    const wd = Number(input.weekday);
    return { frequency: 'weekly', timeOfDay, weekday: wd >= 1 && wd <= 7 ? wd : 1, dayOfMonth: null };
  }
  if (input.frequency === 'monthly') {
    const dom = Number(input.dayOfMonth);
    return { frequency: 'monthly', timeOfDay, weekday: null, dayOfMonth: dom >= 1 && dom <= 28 ? dom : 1 };
  }
  return { frequency: 'daily', timeOfDay, weekday: null, dayOfMonth: null };
}
