/**
 * Billing — intégration Stripe pour l'offre payante « Brasier ».
 *
 * Flux : l'utilisateur clique « Passer à Brasier » → Checkout Stripe (hébergé)
 * → webhook `checkout.session.completed` → on enregistre l'abonnement. La
 * gestion (résiliation, moyen de paiement, factures) passe par le portail
 * client Stripe. Remboursement : self-service sous 14 jours (garantie).
 *
 * Tout est optionnel : sans STRIPE_SECRET_KEY, les fonctions lèvent
 * `BILLING_NOT_CONFIGURED` (les routes répondent alors 503) — le reste de
 * l'app (essai, offre Braise) continue de fonctionner.
 *
 * Note typage : le package `stripe` est en `export =` ; on type le client via
 * InstanceType<typeof Stripe> et on manipule les objets Stripe en `any` (accès
 * de champs explicites) pour rester robuste à la config TS du projet.
 */

import Stripe from 'stripe';
import { storage } from './storage';
import { refundEligible, REFUND_DAYS } from './entitlements';
import { SubscriptionStatus } from '../types';

type StripeClient = InstanceType<typeof Stripe>;

let client: StripeClient | null = null;

function stripe(): StripeClient {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('BILLING_NOT_CONFIGURED');
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
}

/** Identifiants de prix Stripe (créés dans le dashboard, posés en .env) */
function priceId(interval: 'month' | 'year'): string {
  const id = interval === 'year' ? process.env.STRIPE_PRICE_ANNUAL : process.env.STRIPE_PRICE_MONTHLY;
  if (!id) throw new Error('BILLING_NOT_CONFIGURED');
  return id;
}

/** Stripe configuré ET au moins un prix renseigné ? (affichage côté front) */
export function isBillingConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
    (process.env.STRIPE_PRICE_MONTHLY || process.env.STRIPE_PRICE_ANNUAL),
  );
}

const appUrl = () => (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');

/** Statut Stripe → notre union resserrée */
function mapStatus(s: string): SubscriptionStatus {
  switch (s) {
    case 'active': return 'active';
    case 'trialing': return 'trialing';
    case 'past_due': return 'past_due';
    case 'canceled':
    case 'unpaid':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'past_due'; // incomplete / paused : accès suspendu jusqu'à résolution
  }
}

const toIso = (unixSeconds: number | null | undefined): string | null =>
  unixSeconds ? new Date(unixSeconds * 1000).toISOString() : null;

/** Récupère ou crée le client Stripe de l'utilisateur (mémorisé en base) */
async function ensureCustomer(userId: string, email: string): Promise<string> {
  const sub = storage.getSubscription(userId);
  if (sub?.stripeCustomerId) return sub.stripeCustomerId;
  const customer = await stripe().customers.create({
    email,
    metadata: { userId },
  });
  storage.setStripeCustomerId(userId, customer.id);
  return customer.id;
}

/** Session Stripe Checkout pour souscrire à Brasier — renvoie l'URL hébergée */
export async function createCheckoutSession(
  userId: string,
  email: string,
  interval: 'month' | 'year',
): Promise<string> {
  const customer = await ensureCustomer(userId, email);
  const session = await stripe().checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: priceId(interval), quantity: 1 }],
    client_reference_id: userId,
    subscription_data: { metadata: { userId } },
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
    success_url: `${appUrl()}/billing?checkout=success`,
    cancel_url: `${appUrl()}/billing?checkout=cancel`,
  });
  if (!session.url) throw new Error('Création de la session de paiement impossible');
  return session.url;
}

/** Session du portail client Stripe (gérer/résilier l'abonnement) */
export async function createPortalSession(userId: string): Promise<string> {
  const sub = storage.getSubscription(userId);
  if (!sub?.stripeCustomerId) throw new Error('NO_CUSTOMER');
  const session = await stripe().billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: `${appUrl()}/billing`,
  });
  return session.url;
}

/** Applique l'état d'un objet Subscription Stripe à l'utilisateur.
 *  Compat API : depuis Stripe 2025, `current_period_end` est porté par les
 *  ITEMS de l'abonnement (et non plus au niveau racine) ; et une résiliation
 *  « en fin de période » pose `cancel_at` (timestamp) plutôt que le booléen
 *  `cancel_at_period_end`. On lit donc l'item en priorité, et on considère
 *  l'abonnement « résilié » dès que `cancel_at` est posé. */
function applySubscription(userId: string, sub: any): void {
  const item = sub.items?.data?.[0];
  const interval = (item?.price?.recurring?.interval as 'month' | 'year' | undefined) ?? null;
  const periodEnd = toIso(item?.current_period_end ?? sub.current_period_end);
  const cancelAt = sub.cancel_at
    ? toIso(sub.cancel_at)
    : (sub.cancel_at_period_end ? periodEnd : null);
  storage.updateSubscription(userId, {
    status: mapStatus(sub.status),
    stripeSubscriptionId: sub.id,
    interval,
    currentPeriodEnd: periodEnd,
    cancelAt,
  });
}

/** Résout l'userId d'un événement (metadata, puis client Stripe en repli) */
function resolveUserId(customerId: string | null, metaUserId?: string | null): string | null {
  if (metaUserId) return metaUserId;
  return customerId ? storage.getUserIdByStripeCustomerId(customerId) : null;
}

/** Vérifie la signature et renvoie l'événement (lève si invalide) */
export function constructEvent(rawBody: Buffer, signature: string) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new Error('BILLING_NOT_CONFIGURED');
  return stripe().webhooks.constructEvent(rawBody, signature, secret);
}

export type StripeEvent = ReturnType<typeof constructEvent>;

/**
 * Traite un événement webhook Stripe (déjà vérifié). Best-effort : tout type
 * non géré est ignoré sans erreur.
 */
export async function handleWebhookEvent(event: StripeEvent): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as any;
      const userId = resolveUserId(session.customer ?? null, session.client_reference_id);
      if (!userId || !session.subscription) break;
      // Mémorise le client (au cas où la session a créé un nouveau customer)
      if (session.customer) storage.setStripeCustomerId(userId, session.customer);
      const sub = await stripe().subscriptions.retrieve(session.subscription);
      applySubscription(userId, sub);
      // 1er paiement : démarre la fenêtre de garantie 14 jours
      storage.markFirstPaidAt(userId, new Date().toISOString());
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as any;
      const userId = resolveUserId(sub.customer ?? null, sub.metadata?.userId);
      if (!userId) break;
      applySubscription(userId, sub);
      break;
    }
    case 'invoice.paid': {
      const invoice = event.data.object as any;
      const userId = resolveUserId(invoice.customer ?? null);
      const subId = invoice.subscription as string | null;
      if (!userId || !subId) break;
      const sub = await stripe().subscriptions.retrieve(subId);
      applySubscription(userId, sub);
      storage.markFirstPaidAt(userId, new Date().toISOString());
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object as any;
      const userId = resolveUserId(invoice.customer ?? null);
      if (!userId) break;
      storage.updateSubscription(userId, { status: 'past_due' });
      break;
    }
    default:
      break; // type non géré : ignoré
  }
}

export interface RefundResult {
  refunded: boolean;
  amount: number | null;
  currency: string | null;
  reason?: string;
}

/**
 * Remboursement self-service (garantie 14 jours) : vérifie l'éligibilité,
 * rembourse le dernier paiement et résilie immédiatement l'abonnement.
 */
export async function processRefund(userId: string): Promise<RefundResult> {
  const sub = storage.getSubscription(userId);
  if (!sub) return { refunded: false, amount: null, currency: null, reason: 'NO_SUBSCRIPTION' };
  if (!refundEligible(sub)) {
    return { refunded: false, amount: null, currency: null, reason: `Hors de la fenêtre de garantie de ${REFUND_DAYS} jours.` };
  }

  const s = stripe();
  // Dernière facture payée de l'abonnement → son paiement
  const invoices = await s.invoices.list({
    customer: sub.stripeCustomerId!,
    status: 'paid',
    limit: 1,
  });
  const invoice = invoices.data[0] as any;
  const paymentIntentId = (invoice?.payment_intent as string | null) ?? null;
  if (!paymentIntentId) {
    return { refunded: false, amount: null, currency: null, reason: 'Aucun paiement remboursable trouvé.' };
  }

  // Clé d'idempotence stable par abonnement : un double-clic / retry réseau ne
  // crée PAS un second remboursement (Stripe renvoie le même refund).
  const refund = await s.refunds.create(
    { payment_intent: paymentIntentId },
    { idempotencyKey: `refund_${sub.stripeSubscriptionId}` },
  );

  const ok = refund.status === 'succeeded' || refund.status === 'pending';
  if (!ok) {
    // Échec inattendu : on NE touche PAS à l'état local (pas de résiliation fantôme)
    return { refunded: false, amount: null, currency: null, reason: `Remboursement refusé (statut ${refund.status}).` };
  }

  // Résiliation immédiate (l'accès s'arrête tout de suite après remboursement)
  if (sub.stripeSubscriptionId) {
    try { await s.subscriptions.cancel(sub.stripeSubscriptionId); } catch { /* déjà résilié */ }
  }
  const nowIso = new Date().toISOString();
  storage.updateSubscription(userId, {
    status: 'canceled',
    currentPeriodEnd: nowIso,
    cancelAt: nowIso,
  });

  return {
    refunded: true,
    amount: typeof refund.amount === 'number' ? refund.amount / 100 : null,
    currency: refund.currency ? refund.currency.toUpperCase() : null,
  };
}
