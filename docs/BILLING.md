# LaunchForge — Abonnement, Stripe & remboursement

Ce document décrit le modèle freemium de LaunchForge, sa mise en place avec
Stripe, et la politique de remboursement. Il accompagne le code :
`src/services/entitlements.ts` (règles), `src/services/billing.ts` (Stripe),
`src/routes/billing.ts` (API), et `client/src/pages/BillingPage.tsx` (UI).

---

## 1. Le modèle : deux offres

| | **Braise** (gratuite) | **Brasier** (payante) |
|---|---|---|
| Prix | 0 € pour toujours | **12,90 €/mois en annuel** (154,80 €/an) · **15,90 €/mois** en mensuel |
| Projets | 1 | illimités |
| Générations de contenu IA | 5 / mois | 300 / mois (usage équitable) |
| Images IA | 2 / mois | 50 / mois (usage équitable) |
| Publication, analytics, leads, séries, Telegram | ❌ (réservés à Brasier) | ✅ |
| Plan IA, rédaction manuelle, calendrier, export RGPD | ✅ | ✅ |

**Pourquoi des plafonds Brasier plutôt qu'« illimité » ?** Coûts réels : ~0,015 €/génération texte (OpenRouter), 0,04 €/image (seedream-4.5), + Composio **30 €/mois fixe** (amorti sur tous les payants). À 12,90 €, l'infra fixe (≈36 €/mois) est couverte dès ~3 abonnés ; les plafonds 300/50 laissent une marge ~85 % en usage normal et restent positifs même au plafond (anti-abus/scripting), sans jamais gêner un vrai utilisateur.
| Support | communauté | prioritaire |

**Principe de bridage** : seules les **quantités** qui ont un coût variable réel
sont limitées (générations IA texte/image = appels OpenRouter ; projets). Toutes
les fonctionnalités restent accessibles en Braise — on ne bride pas l'adoption,
on borne le volume. C'est honnête et facile à expliquer.

> **Compteurs d'usage** : `usage_events` compte par **mois calendaire UTC**
> (`YYYY-MM`). Toute génération IA — qu'elle vienne d'une route HTTP, de
> l'assistant intégré **ou du bot Telegram** — passe par `assertWithinUsage()` /
> `recordUsage()`. Les réinitialisations ont lieu le 1ᵉʳ du mois à 00:00 UTC.
> Les tâches système (rapport hebdo automatique, synchros) ne sont **pas**
> comptées : seules les actions initiées par l'utilisateur le sont.

### Essai « reverse trial » (15 jours, sans carte)
Tout nouveau compte reçoit **15 jours d'accès complet Brasier** (`users.trialEndsAt`
posé à l'inscription). À l'expiration, le compte **retombe automatiquement sur
Braise** — rien ne se bloque, l'utilisateur garde tout son travail. C'est le
schéma qui convertit le mieux (l'utilisateur goûte la pleine valeur avant le mur).

### Comptes existants (bêta)
À la première migration, les comptes déjà créés reçoivent **30 jours de grâce**
en accès complet (`trialEndsAt = now + 30 j`, posé une seule fois). Cela honore la
promesse « les premiers utilisateurs seront prévenus avant tout changement ».

### Le tier « effectif »
`getEffectiveTier()` renvoie **brasier** si :
1. compte **fondateur** (`ADMIN_EMAILS`), OU
2. abonnement Stripe **actif** (ou résilié/past_due mais période non expirée), OU
3. **essai** non expiré.

Sinon **braise**. Voir `src/services/entitlements.ts`.

---

## 2. Pourquoi Stripe (et pas Paddle / Lemon Squeezy)

| Critère | **Stripe** ✅ recommandé | Paddle / Lemon Squeezy (Merchant of Record) |
|---|---|---|
| Frais | ~1,5 % + 0,25 € (EU cards) | ~5 % + 0,50 € |
| TVA UE / mondiale | À gérer (Stripe Tax, ~0,5 %) ou via comptable | **Gérée et reversée par le MoR** |
| Portail client (résiliation, factures, RIB) | **Inclus**, sans code | Inclus |
| Flexibilité (essais, coupons, webhooks) | **Maximale** | Bonne mais plus fermée |
| Intégration | SDK mûr, docs excellentes | Correcte |

**Recommandation : Stripe.** Pour un fondateur solo qui maîtrise déjà son infra,
Stripe offre les frais les plus bas, le meilleur DX, un portail client clé en
main (résiliation/factures en self-service) et **Stripe Tax** pour la TVA. Le seul
avantage d'un MoR (Paddle/Lemon Squeezy) est de **déléguer toute la conformité TVA
mondiale** ; si tu vends massivement hors UE et veux zéro paperasse fiscale,
c'est l'alternative — au prix de ~3,5 points de marge en plus. Le code actuel est
écrit pour **Stripe**.

---

## 3. Mise en place Stripe (pas à pas)

### a) Produit et prix
Dashboard Stripe → **Produits** → créer un produit **« Brasier »** avec **deux prix
récurrents** :
- **Mensuel** : 15,90 € / mois → note l'ID `price_...`
- **Annuel** : 154,80 € / an (affiché 12,90 €/mois) → note l'ID `price_...`

### b) Clé API
Dashboard → **Développeurs → Clés API** → copie la **clé secrète** (`sk_live_...`
en prod, `sk_test_...` en test).

### c) Webhook
Dashboard → **Développeurs → Webhooks** → **Ajouter un endpoint** :
- URL : `https://launchforge.alexandre-lebegue.com/api/billing/webhook`
- Événements à écouter :
  `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.paid`, `invoice.payment_failed`
- Copie le **secret de signature** (`whsec_...`).

> Le webhook est monté **avant** `express.json()` dans `src/app.ts` et reçoit le
> **corps brut** (Buffer) — indispensable pour vérifier la signature Stripe.

### d) Portail client
Dashboard → **Paramètres → Facturation → Portail client** → active :
résiliation, mise à jour du moyen de paiement, historique des factures.
(C'est ce portail qu'ouvre le bouton « Gérer mon abonnement ».)

### e) TVA (optionnel mais recommandé en UE)
Active **Stripe Tax** (Paramètres → Tax). En B2C UE, les prix s'entendent **TTC** ;
Stripe calcule et collecte la TVA selon le pays du client.

### f) Variables d'environnement
Dans `.env` (local) **et** `/root/launchforge/.env` (prod) :
```bash
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PRICE_MONTHLY=price_...      # 15,90 €/mois
STRIPE_PRICE_ANNUAL=price_...       # 154,80 €/an (12,90 €/mois)
STRIPE_WEBHOOK_SECRET=whsec_...
BILLING_ENFORCE_LIMITS=true         # 'false' = ne bride personne (lancement souple)
# APP_URL doit être correct : sert aux URLs de retour Checkout/portail.
```
Sans `STRIPE_SECRET_KEY`, l'app fonctionne quand même : l'essai et l'offre Braise
marchent, mais le bouton de paiement affiche « bientôt disponible ».

### g) Test en local
```bash
npm i -g stripe              # CLI Stripe
stripe login
stripe listen --forward-to localhost:3000/api/billing/webhook
# → copie le whsec_... affiché dans STRIPE_WEBHOOK_SECRET
# Carte de test : 4242 4242 4242 4242, date future, CVC quelconque.
```

---

## 4. Politique de remboursement

**Garantie 14 jours satisfait ou remboursé**, en plus des 15 jours d'essai
gratuit. Deux raisons de la proposer même avec un essai :
- elle **rassure à l'achat** (réduit la friction de conversion) ;
- en droit UE, le droit de rétractation de 14 j sur un service numérique est
  écarté si le client a demandé l'exécution immédiate et y a renoncé — mais
  offrir une garantie volontaire reste un fort argument commercial.

### Comment ça marche (self-service)
Page **Abonnement** → si l'utilisateur est dans la fenêtre (1er paiement < 14 j),
un bouton « Demander un remboursement » :
1. vérifie l'éligibilité (`refundEligible` : `firstPaidAt` < 14 j, abonnement présent) ;
2. rembourse le **dernier paiement** via l'API Stripe ;
3. **résilie immédiatement** l'abonnement (l'accès Brasier s'arrête, retour Braise).

Au-delà de 14 jours, l'utilisateur **résilie** via le portail client Stripe : il
garde l'accès **jusqu'à la fin de la période déjà payée**, sans renouvellement.

### Risque d'abus
Faible : l'essai de 15 jours filtre déjà la majorité des regrets ; le
remboursement est **à usage unique par fenêtre** et résilie l'abonnement. Surveiller
les éventuels cycles « payer / se faire rembourser » via le journal admin
(`billing.refunded`).

---

## 5. Cycle de vie d'un abonnement (côté code)

```
Inscription ──► trialEndsAt = +15 j (accès Brasier) ──► (J+15) ──► Braise (limité)
     │
     └─► « Passer à Brasier » ─► Checkout Stripe ─► webhook checkout.session.completed
            └─► subscriptionStatus=active, currentPeriodEnd, firstPaidAt ─► accès Brasier
                   ├─ invoice.paid (renouvellement) ─► prolonge currentPeriodEnd
                   ├─ invoice.payment_failed ─► past_due (grâce jusqu'à fin de période)
                   ├─ Portail : résiliation ─► cancel_at_period_end ─► accès jusqu'à la date
                   └─ Remboursement < 14 j ─► refund + cancel immédiat ─► Braise
```

---

## 6. Checklist de mise en production

- [ ] Produit « Brasier » + 2 prix créés dans Stripe (mode **live**).
- [ ] `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`,
      `STRIPE_WEBHOOK_SECRET` posés dans `/root/launchforge/.env`.
- [ ] Endpoint webhook live créé et pointant sur le domaine de prod.
- [ ] Portail client configuré (résiliation + factures).
- [ ] `APP_URL=https://launchforge.alexandre-lebegue.com` correct.
- [ ] (Option) Stripe Tax activé pour la TVA.
- [ ] Décider `BILLING_ENFORCE_LIMITS` : `false` pour un lancement souple
      (personne n'est bridé, on observe), puis `true` quand on active vraiment le freemium.
- [ ] Tester un cycle complet en test (checkout → webhook → accès → portail → remboursement).
- [ ] Vérifier le backfill : les comptes bêta ont bien 30 jours de grâce.

---

## 7. Idées d'évolution (non implémentées)
- **Offre « Fondateurs »** : -50 % à vie ou *lifetime deal* (199-299 € one-time) pour
  les 100 premiers — amorce les revenus et les avis.
- **Packs d'images à l'usage** (overage) au-delà du quota Brasier si un jour un
  plafond d'usage équitable est introduit — protège la marge sur le seul vrai coût variable.
- **Surveiller le coût Composio par utilisateur** : c'est la seule variable qui
  peut éroder la marge ; envisager un plafond de comptes connectés si nécessaire.
