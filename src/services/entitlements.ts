/**
 * Entitlements — règles des offres « Braise » (gratuite), « Brasier » (payante)
 * et « Brasier PLUS » (payante, IA premium Claude Opus).
 *
 * Le tier EFFECTIF d'un utilisateur est :
 *   • 'plus'    — compte fondateur (ADMIN_EMAILS), abonnement PLUS actif, ou
 *                 essai « reverse trial » en cours (l'essai fait goûter le
 *                 meilleur, Claude Opus inclus) ;
 *   • 'brasier' — abonnement Brasier actif (ou résilié mais pas encore expiré) ;
 *   • 'braise'  — sinon (limité).
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
  brasier: {
    monthly: 29,        // €/mois en mensuel
    annualMonthly: 24,  // €/mois facturé annuellement
    annualTotal: 288,   // €/an
  },
  plus: {
    monthly: 59,        // €/mois en mensuel
    annualMonthly: 49,  // €/mois facturé annuellement
    annualTotal: 588,   // €/an
  },
} as const;

// Libellés marketing des modèles IA par offre (l'ID technique vit dans aiClient)
export const AI_MODEL_LABELS = {
  standard: 'DeepSeek V4 Flash',
  plus: 'Claude Opus 4.8',
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
  // Braise : « goûter le moteur » — peu de génération, fonctionnalités verrouillées
  braise: {
    projects: 1,
    aiGenerationsPerMonth: 30,
    aiImagesPerMonth: 2,
  },
  // Brasier : usage IA en « illimité équitable » — plafonds très au-dessus d'un
  // usage intensif réel, calés sur les coûts (≈0,015 €/génération, 0,04 €/image)
  // pour rester margé même au plafond et bloquer l'abus/scripting.
  brasier: {
    projects: UNLIMITED,
    aiGenerationsPerMonth: 1000,
    aiImagesPerMonth: 50,
  },
  // PLUS : mêmes principes, plafonds doublés — le modèle premium (Claude Opus,
  // ≈0,05 €/génération) reste margé même au plafond à 59 €/mois.
  plus: {
    projects: UNLIMITED,
    aiGenerationsPerMonth: 2000,
    aiImagesPerMonth: 100,
  },
};

// ── Fonctionnalités par offre (verrous au-delà des quotas) ────────────────────
export type Feature = 'publish' | 'analytics' | 'leads' | 'recurring' | 'telegram' | 'automations';

const FEATURES: Record<PlanTier, Record<Feature, boolean>> = {
  braise:  { publish: false, analytics: false, leads: false, recurring: false, telegram: false, automations: false },
  brasier: { publish: true,  analytics: true,  leads: true,  recurring: true,  telegram: true,  automations: true  },
  plus:    { publish: true,  analytics: true,  leads: true,  recurring: true,  telegram: true,  automations: true  },
};

const FEATURE_LABEL: Record<Feature, string> = {
  publish:     'La publication et la connexion de comptes sociaux',
  analytics:   'Les analyses et la synchronisation des métriques',
  leads:       'La détection de leads',
  recurring:   'Les séries récurrentes',
  telegram:    'Le pilotage depuis Telegram',
  automations: 'Les automatisations (cron jobs IA)',
};

/** Erreur de fonctionnalité verrouillée — traduite en HTTP 402 par le routeur */
export class FeatureError extends Error {
  code = 'FEATURE_LOCKED';
  constructor(public feature: Feature, message: string) {
    super(message);
    this.name = 'FeatureError';
  }
}

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
  // Fondateur : 'plus' par défaut, mais il peut simuler n'importe quelle offre
  // depuis la page Abonnement (test des verrous, quotas et du modèle IA).
  if (isFounder(userId)) return storage.getFounderTierOverride(userId) ?? 'plus';
  const sub = storage.getSubscription(userId);
  if (!sub) return 'braise';
  if (hasPaidAccess(sub)) return sub.plan === 'plus' ? 'plus' : 'brasier';
  // Reverse trial : accès complet au MEILLEUR (Claude Opus inclus) pendant 15 j
  return trialActive(sub) ? 'plus' : 'braise';
}

/** Le tier qui s'applique pour les quotas (tout débloqué si enforcement désactivé) */
function effectiveTierForLimits(userId: string): PlanTier {
  if (!enforcementEnabled()) return 'plus';
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
    const upsell = tier === 'braise'
      ? 'Passez à Brasier pour un usage étendu.'
      : 'Passez à Brasier PLUS pour des plafonds doublés.';
    const tierLabel = tier === 'braise' ? 'Braise' : tier === 'brasier' ? 'Brasier' : 'Brasier PLUS';
    throw new QuotaError(
      kind, used, limit,
      `Limite de l'offre ${tierLabel} atteinte : ${limit} ${label} ce mois-ci. ${tier === 'plus' ? 'Le compteur se réinitialise le mois prochain.' : upsell}`,
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

/** Vrai si l'utilisateur a (effectivement) accès à Brasier — utilisé par les
 *  workers de fond pour ne PAS traiter les comptes Braise (un essai ayant connecté
 *  des comptes garde ses connexions après bascule : sans ce filtre, les workers
 *  publieraient / synchroniseraient / généreraient encore, hors quota). Respecte
 *  l'interrupteur d'enforcement. */
export function isBrasier(userId: string): boolean {
  return effectiveTierForLimits(userId) !== 'braise';
}

/** Vrai si l'utilisateur a droit au modèle IA premium (Claude Opus).
 *  Se base sur le tier RÉEL (pas l'interrupteur d'enforcement) : désactiver
 *  les limites ne doit pas router tout le monde vers le modèle cher. */
export function hasPremiumModel(userId: string): boolean {
  return getEffectiveTier(userId) === 'plus';
}

/** Vrai si l'offre effective de l'utilisateur inclut cette fonctionnalité */
export function hasFeature(userId: string, feature: Feature): boolean {
  return FEATURES[effectiveTierForLimits(userId)][feature];
}

/** Vérifie l'accès à une fonctionnalité, sinon lève FeatureError (→ HTTP 402) */
export function assertFeature(userId: string, feature: Feature): void {
  if (!hasFeature(userId, feature)) {
    throw new FeatureError(
      feature,
      `${FEATURE_LABEL[feature]} est réservé à l'offre Brasier. Passez à Brasier pour en profiter.`,
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
    status: 'none', plan: null, stripeCustomerId: null, stripeSubscriptionId: null, interval: null,
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
    plan: sub.plan,
    founder,
    // Offre simulée par le fondateur (null = plus par défaut) — pilote la liste
    // déroulante de la page Abonnement.
    founderTierOverride: founder ? storage.getFounderTierOverride(userId) : null,
    features: FEATURES[tier],
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
    aiModels: AI_MODEL_LABELS,
    trialDays: TRIAL_DAYS,
    refundDays: REFUND_DAYS,
  };
}
