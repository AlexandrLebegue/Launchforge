/**
 * /api/billing — abonnement « Brasier » (Stripe) et état de l'offre.
 *
 * Le webhook (`billingWebhookHandler`) est monté À PART dans app.ts, AVANT le
 * parser JSON global, car la vérification de signature Stripe exige le corps
 * brut (Buffer). Toutes les autres routes utilisent l'auth + JSON habituels.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { storage } from '../services/storage';
import { logEvent } from '../services/adminLogger';
import { getEntitlementsView } from '../services/entitlements';
import {
  isBillingConfigured,
  isPlusConfigured,
  createCheckoutSession,
  changeSubscriptionPlan,
  createPortalSession,
  processRefund,
  constructEvent,
  handleWebhookEvent,
} from '../services/billing';

const router = Router();

// ── GET /api/billing/status — offre, essai, usage, prix (front) ───────────────
router.get('/status', requireAuth, (req: Request, res: Response) => {
  const view = getEntitlementsView(req.user!.userId);
  res.json({
    success: true,
    data: { ...view, billingConfigured: isBillingConfigured(), plusConfigured: isPlusConfigured() },
  });
});

// ── POST /api/billing/checkout — démarre le paiement (renvoie l'URL Stripe) ───
router.post('/checkout', requireAuth, async (req: Request, res: Response) => {
  if (!isBillingConfigured()) {
    return res.status(503).json({ success: false, error: 'BILLING_NOT_CONFIGURED' });
  }
  const body = req.body as { interval?: string; plan?: string };
  const interval = body.interval === 'month' ? 'month' : 'year';
  const plan = body.plan === 'plus' ? 'plus' : 'brasier';
  if (plan === 'plus' && !isPlusConfigured()) {
    return res.status(503).json({ success: false, error: 'BILLING_NOT_CONFIGURED' });
  }
  try {
    const user = storage.getUserById(req.user!.userId);
    if (!user) return res.status(404).json({ success: false, error: 'Compte introuvable.' });
    // Déjà abonné → changement d'offre sur l'abonnement existant (prorata),
    // sinon Checkout créerait un SECOND abonnement en parallèle.
    const sub = storage.getSubscription(user.id);
    const hasLiveSub = Boolean(sub?.stripeSubscriptionId) &&
      (sub!.status === 'active' || sub!.status === 'trialing' || sub!.status === 'past_due');
    if (hasLiveSub) {
      await changeSubscriptionPlan(user.id, interval, plan);
      logEvent(user.id, 'billing.plan_changed', user.id, { interval, plan });
      return res.json({ success: true, data: { upgraded: true } });
    }
    const url = await createCheckoutSession(user.id, user.email, interval, plan);
    logEvent(user.id, 'billing.checkout_started', user.id, { interval, plan });
    res.json({ success: true, data: { url } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur de paiement';
    res.status(msg === 'BILLING_NOT_CONFIGURED' ? 503 : 502).json({ success: false, error: msg });
  }
});

// ── POST /api/billing/portal — portail client Stripe (gérer/résilier) ─────────
router.post('/portal', requireAuth, async (req: Request, res: Response) => {
  if (!isBillingConfigured()) {
    return res.status(503).json({ success: false, error: 'BILLING_NOT_CONFIGURED' });
  }
  try {
    const url = await createPortalSession(req.user!.userId);
    res.json({ success: true, data: { url } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erreur portail';
    if (msg === 'NO_CUSTOMER') {
      return res.status(400).json({ success: false, error: "Aucun abonnement à gérer pour l'instant." });
    }
    res.status(502).json({ success: false, error: msg });
  }
});

// ── POST /api/billing/refund — remboursement self-service (garantie 14 j) ─────
router.post('/refund', requireAuth, async (req: Request, res: Response) => {
  if (!isBillingConfigured()) {
    return res.status(503).json({ success: false, error: 'BILLING_NOT_CONFIGURED' });
  }
  try {
    const result = await processRefund(req.user!.userId);
    if (!result.refunded) {
      return res.status(400).json({ success: false, error: result.reason || 'Remboursement impossible.' });
    }
    logEvent(req.user!.userId, 'billing.refunded', req.user!.userId, { amount: result.amount, currency: result.currency });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(502).json({ success: false, error: err instanceof Error ? err.message : 'Remboursement échoué' });
  }
});

export default router;

// ── Webhook Stripe (monté à part, corps brut) ─────────────────────────────────
// req.body est un Buffer (express.raw). On vérifie la signature puis on traite.
export async function billingWebhookHandler(req: Request, res: Response): Promise<void> {
  const signature = req.headers['stripe-signature'];
  if (!signature || typeof signature !== 'string') {
    res.status(400).send('Missing stripe-signature');
    return;
  }
  let event;
  try {
    event = constructEvent(req.body as Buffer, signature);
  } catch (err) {
    console.error('Stripe webhook signature invalide:', err instanceof Error ? err.message : err);
    res.status(400).send('Invalid signature');
    return;
  }
  try {
    await handleWebhookEvent(event);
  } catch (err) {
    // On répond 200 quand même : Stripe ne doit pas re-livrer en boucle une
    // erreur applicative non récupérable. Les erreurs sont journalisées.
    console.error('Stripe webhook traitement échoué:', err instanceof Error ? err.message : err);
  }
  res.json({ received: true });
}
