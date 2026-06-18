/**
 * Configuration Stripe one-shot pour l'offre « Brasier ».
 * La clé secrète est lue dans STRIPE_SECRET_KEY (jamais en dur).
 *   STRIPE_SECRET_KEY=sk_test_... APP_URL=https://... node scripts/stripe-setup.mjs
 * Idempotent-ish : relancer crée de NOUVEAUX objets (Stripe n'a pas d'upsert
 * natif), donc à n'exécuter qu'une fois par environnement.
 */
import Stripe from 'stripe';

const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error('STRIPE_SECRET_KEY manquante'); process.exit(1); }
const stripe = new Stripe(key);
const APP_URL = (process.env.APP_URL || 'https://launchforge.alexandre-lebegue.com').replace(/\/$/, '');

const out = {};

// Compte (valide la clé)
const acct = await stripe.accounts.retrieve();
out.account = acct.id;

// Produit + 2 prix
const product = await stripe.products.create({
  name: 'Brasier',
  description: 'LaunchForge — accès complet, sans aucune limite.',
});
out.product = product.id;

const monthly = await stripe.prices.create({
  product: product.id, currency: 'eur', unit_amount: 2000,
  recurring: { interval: 'month' }, nickname: 'Brasier mensuel (20 €/mois)',
});
out.monthly = monthly.id;

const annual = await stripe.prices.create({
  product: product.id, currency: 'eur', unit_amount: 18000,
  recurring: { interval: 'year' }, nickname: 'Brasier annuel (180 €/an · 15 €/mois)',
});
out.annual = annual.id;

// Portail client (pour que « Gérer mon abonnement » fonctionne)
try {
  const portal = await stripe.billingPortal.configurations.create({
    business_profile: { headline: 'LaunchForge — gérez votre abonnement Brasier' },
    features: {
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      customer_update: { enabled: true, allowed_updates: ['email', 'address', 'name'] },
    },
  });
  out.portal = portal.id;
} catch (e) { out.portalError = e.message; }

// Endpoint webhook (URL de prod) — le secret n'est renvoyé qu'à la création
try {
  const wh = await stripe.webhookEndpoints.create({
    url: `${APP_URL}/api/billing/webhook`,
    description: 'LaunchForge billing',
    enabled_events: [
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.paid',
      'invoice.payment_failed',
    ],
  });
  out.webhookId = wh.id;
  out.webhookSecret = wh.secret;
} catch (e) { out.webhookError = e.message; }

console.log('LF_STRIPE_RESULT ' + JSON.stringify(out));
