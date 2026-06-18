/**
 * Entitlements — règles des offres « Braise » (gratuite) et « Brasier » (payante).
 *
 * Le tier EFFECTIF d'un utilisateur est « brasier » s'il bénéficie de l'accès
 * complet, c'est-à-dire :
 *   • c'est un compte fondateur (ADMIN_EMAILS), OU
 *   • il a un abonnement Stripe actif (ou résilié mais pas encore expiré), OU
 *   • son essai « reverse trial » de 15 jours n'est pas terminé.
 * Sinon il est « braise » (limité).
 *
 * Les quotas portent sur le coût variable principal — la génération IA (texte
 * et images) — et sur le nombre de projets. L'analytics, la publication et la
 * base de connaissances ne sont pas bridées (moteurs d'adoption).
 *
 * L'application des limites peut être désactivée globalement via
 * BILLING_ENFORCE_LIMITS=false (utile pour déployer le code avant d'activer
 * Stripe, ou pour une période de lancement souple).
 */

import { storage } from './storage';
import { PlanTier, SubscriptionRecord, UsageKind } from '../types';

// ── Tarifs & paramètres (source de vérité, repris par le front) ───────────────
export const PRICING = {
  currency: 'EUR',
  monthly: 20,        // €/mois en mensuel
  annualMonthly: 15,  // €/mois facturé annuellement
  annualTotal: 180,   // €/an
} as const;

export const TRIAL_DAYS = 15;
export const REFUND_DAYS = 14;

// ── Limites par offre ─────────────────────────────────────────────────────────
export interface TierLimits {
  projects: number;
  aiGenerationsPerMonth: number;
  aiImagesPerMonth: number;
}

const UNLIMITED = Number.POSITIVE_INFINITY;

export const LIMITS: Record<PlanTier, TierLimits> = {
  braise: {
    projects: 1,
    aiGenerationsPerMonth: 15,
    aiImagesPerMonth: 5,
  },
  brasier: {
    projects: UNLIMITED,
    aiGenerationsPerMonth: UNLIMITED,
    aiImagesPerMonth: UNLIMITED,
  },
};

/** Erreur de quota — le routeur la traduit en HTTP 402 (paiement requis) */
export class QuotaError extends Error {
  code = 'QUOTA_EXCEEDED';
  constructor(
    public resource: 'projects' | UsageKind,
    public used: number,
    public limit: number,
    message: string,
  ) {
    super(message);
    this.name = 'QuotaError';
  }
}

// ── Helpers internes ──────────────────────────────────────────────────────────

const now = () => Date.now();
const isFuture = (iso: string | null) => Boolean(iso && new Date(iso).getTime() > now());

/** Application des limites active ? (BILLING_ENFORCE_LIMITS=false la désactive) */
export function enforcementEnabled(): boolean {
  return process.env.BILLING_ENFORCE_LIMITS !== 'false';
}

function founderEmails(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Compte fondateur (accès complet permanent) */
export function isFounder(userId: string): boolean {
  const emails = founderEmails();
  if (emails.size === 0) return false;
  const user = storage.getUserById(userId);
  return user ? emails.has(user.email.toLowerCase()) : false;
}

/** Abonnement payant donnant accès (actif, ou résilié mais période non expirée) */
function hasPaidAccess(sub: SubscriptionRecord): boolean {
  switch (sub.status) {
    case 'active':
    case 'trialing':
      return true; // résiliation programmée incluse : accès jusqu'à la fin de période
    case 'past_due':
    case 'canceled':
      // Grâce : accès maintenu jusqu'à la fin de la période déjà payée
      return isFuture(sub.currentPeriodEnd);
    default:
      return false;
  }
}

/** Essai « reverse trial » encore en cours */
export function trialActive(sub: SubscriptionRecord): boolean {
  return isFuture(sub.trialEndsAt);
}

// ── API publique ──────────────────────────────────────────────────────────────

/** Tier EFFECTIF de l'utilisateur (réel, indépendant de l'enforcement) */
export function getEffectiveTier(userId: string): PlanTier {
  if (isFounder(userId)) return 'brasier';
  const sub = storage.getSubscription(userId);
  if (!sub) return 'braise';
  return hasPaidAccess(sub) || trialActive(sub) ? 'brasier' : 'braise';
}

/** Le tier qui s'applique pour les quotas (brasier si enforcement désactivé) */
function effectiveTierForLimits(userId: string): PlanTier {
  if (!enforcementEnabled()) return 'brasier';
  return getEffectiveTier(userId);
}

/** Vérifie qu'une (ou `count`) génération(s) IA est permise, sinon lève QuotaError.
 *  `count` borne les opérations par lot (ex. calendrier) pour ne pas dépasser. */
export function assertWithinUsage(userId: string, kind: UsageKind, count = 1): void {
  const tier = effectiveTierForLimits(userId);
  const limit = kind === 'ai_image'
    ? LIMITS[tier].aiImagesPerMonth
    : LIMITS[tier].aiGenerationsPerMonth;
  if (limit === UNLIMITED) return;
  const used = storage.countUsage(userId, kind);
  if (used + count > limit) {
    const label = kind === 'ai_image' ? 'images IA' : 'générations IA';
    throw new QuotaError(
      kind, used, limit,
      `Limite de l'offre Braise atteinte : ${limit} ${label} ce mois-ci. Passez à Brasier pour un usage illimité.`,
    );
  }
}

/** Variante NON bloquante : true si l'opération tient dans le quota */
export function hasUsage(userId: string, kind: UsageKind, count = 1): boolean {
  try { assertWithinUsage(userId, kind, count); return true; }
  catch { return false; }
}

/** Comptabilise une unité d'usage (après une génération réussie) */
export function recordUsage(userId: string, kind: UsageKind): void {
  storage.recordUsage(userId, kind);
}

/** Vérifie qu'un nouveau projet est permis, sinon lève QuotaError */
export function assertCanCreateProject(userId: string): void {
  const tier = effectiveTierForLimits(userId);
  const limit = LIMITS[tier].projects;
  if (limit === UNLIMITED) return;
  const used = storage.countOwnedPlans(userId);
  if (used >= limit) {
    throw new QuotaError(
      'projects', used, limit,
      `L'offre Braise est limitée à ${limit} projet. Passez à Brasier pour en créer plusieurs.`,
    );
  }
}

/** Remboursement possible : abonnement ACTIF, payé, et dans la fenêtre de garantie.
 *  Le statut doit être strictement 'active' — un abonnement déjà 'canceled'
 *  (donc potentiellement déjà remboursé) ou 'past_due' n'est PAS remboursable
 *  (protection anti-rejeu : après un remboursement, le statut passe à 'canceled'). */
export function refundEligible(sub: SubscriptionRecord): boolean {
  if (!sub.firstPaidAt) return false;
  if (!sub.stripeSubscriptionId || !sub.stripeCustomerId) return false;
  if (sub.status !== 'active') return false;
  const ageMs = now() - new Date(sub.firstPaidAt).getTime();
  return ageMs >= 0 && ageMs <= REFUND_DAYS * 86_400_000;
}

const safeLimit = (n: number) => (n === UNLIMITED ? null : n); // null = illimité côté JSON

/** Vue complète de l'abonnement + usage pour le front (page Abonnement / badge) */
export function getEntitlementsView(userId: string) {
  const sub = storage.getSubscription(userId) ?? {
    status: 'none', stripeCustomerId: null, stripeSubscriptionId: null, interval: null,
    currentPeriodEnd: null, cancelAt: null, trialEndsAt: null, firstPaidAt: null,
  } as SubscriptionRecord;

  const tier = getEffectiveTier(userId);
  const founder = isFounder(userId);
  const isTrialing = trialActive(sub) && !hasPaidAccess(sub) && !founder;
  const trialMsLeft = sub.trialEndsAt ? new Date(sub.trialEndsAt).getTime() - now() : 0;
  const trialDaysLeft = isTrialing ? Math.max(0, Math.ceil(trialMsLeft / 86_400_000)) : 0;

  const limits = LIMITS[tier];
  const usage = {
    aiGenerations: { used: storage.countUsage(userId, 'ai_generation'), limit: safeLimit(limits.aiGenerationsPerMonth) },
    aiImages:      { used: storage.countUsage(userId, 'ai_image'),      limit: safeLimit(limits.aiImagesPerMonth) },
    projects:      { used: storage.countOwnedPlans(userId),             limit: safeLimit(limits.projects) },
  };

  return {
    tier,
    status: sub.status,
    founder,
    trial: { active: isTrialing, endsAt: sub.trialEndsAt, daysLeft: trialDaysLeft },
    subscription: {
      interval: sub.interval,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAt: sub.cancelAt,
    },
    refundEligible: refundEligible(sub),
    enforcement: enforcementEnabled(),
    usage,
    pricing: PRICING,
    trialDays: TRIAL_DAYS,
    refundDays: REFUND_DAYS,
  };
}
