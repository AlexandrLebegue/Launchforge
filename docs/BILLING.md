# LaunchForge — Abonnement, Stripe & remboursement

Ce document décrit le modèle freemium de LaunchForge, sa mise en place avec
Stripe, et la politique de remboursement. Il accompagne le code :
`src/services/entitlements.ts` (règles), `src/services/billing.ts` (Stripe),
`src/routes/billing.ts` (API), et `client/src/pages/BillingPage.tsx` (UI).

---

## 1. Le modèle : trois offres

| | **Braise** (gratuite) | **Brasier** (payante) | **Brasier PLUS** (payante, IA premium) |
|---|---|---|---|
| Prix | 0 € pour toujours | **24 €/mois en annuel** (288 €/an) · **29 €/mois** en mensuel | **49 €/mois en annuel** (588 €/an) · **59 €/mois** en mensuel |
| Modèle IA | standard (DeepSeek V4 Flash) | standard (DeepSeek V4 Flash) | **Claude Opus 4.8** (Anthropic) sur les actions utilisateur |
| Projets | 1 | illimités | illimités |
| Générations de contenu IA | 30 / mois | 1000 / mois (usage équitable) | 2000 / mois (usage équitable) |
| Images IA | 2 / mois | 50 / mois (usage équitable) | 100 / mois (usage équitable) |
| Publication, analytics, leads, séries, Telegram | ❌ (réservés aux offres payantes) | ✅ | ✅ |
| Plan IA, rédaction manuelle, calendrier, export RGPD | ✅ | ✅ | ✅ |
| Support | communauté | prioritaire | prioritaire renforcé |

**Pourquoi des plafonds plutôt qu'« illimité » ?** Coûts réels : ~0,001 €/génération
texte standard (DeepSeek V4 Flash via OpenRouter), **~0,05 €/génération premium**
(Claude Opus 4.8 : 5 $/25 $ par MTok), 0,04 €/image (seedream-4.5), + Composio
**30 €/mois fixe** (amorti sur tous les payants). À 24 €, l'infra fixe est couverte
dès ~2 abonnés ; à 49 €, un compte PLUS au plafond (2000 générations Opus ≈ 30-40 €
d'inférence avant caching) reste margé. Les plafonds servent surtout de garde-fou
anti-abus/scripting, sans jamais gêner un vrai utilisateur.

**Routage du modèle** (`src/services/aiClient.ts`) : `OPENROUTER_MODEL` (défaut
`deepseek/deepseek-v4-flash`) pour tout le monde, `OPENROUTER_MODEL_PLUS` (défaut
`anthropic/claude-opus-4.8`) pour les comptes PLUS et l'essai. Les tâches de fond
(synchros, mémoire, analytics) restent sur le modèle standard quel que soit le tier.

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
Tout nouveau compte reçoit **15 jours d'accès complet Brasier PLUS** — Claude Opus
inclus — (`users.trialEndsAt` posé à l'inscription). À l'expiration, le compte
**retombe automatiquement sur Braise** — rien ne se bloque, l'utilisateur garde
tout son travail. C'est le schéma qui convertit le mieux (l'utilisateur goûte la
pleine valeur, IA premium comprise, avant le mur).

### Comptes existants (bêta)
À la première migration, les comptes déjà créés reçoivent **30 jours de grâce**
en accès complet (`trialEndsAt = now + 30 j`, posé une seule fois). Cela honore la
promesse « les premiers utilisateurs seront prévenus avant tout changement ».

### Le tier « effectif »
`getEffectiveTier()` renvoie :
1. **plus** — compte **fondateur** (`ADMIN_EMAILS`), abonnement Stripe **PLUS**
   actif (ou résilié/past_due mais période non expirée), ou **essai** non expiré ;
2. **brasier** — abonnement Stripe Brasier actif (mêmes règles de grâce) ;
3. **braise** — sinon.

L'offre souscrite est stockée dans `users.subscriptionPlan` ('brasier' | 'plus'),
déduite de l'ID de prix Stripe par le webhook. Voir `src/services/entitlements.ts`.

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

### a) Produits et prix
Dashboard Stripe → **Produits** → créer **deux produits**, chacun avec **deux prix
récurrents** :
- **« Brasier »** : mensuel 29 €/mois · annuel 288 €/an (affiché 24 €/mois) → note les IDs `price_...`
- **« Brasier PLUS »** : mensuel 59 €/mois · annuel 588 €/an (affiché 49 €/mois) → note les IDs `price_...`

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
STRIPE_PRICE_MONTHLY=price_...        # Brasier 29 €/mois
STRIPE_PRICE_ANNUAL=price_...         # Brasier 288 €/an (24 €/mois)
STRIPE_PRICE_PLUS_MONTHLY=price_...   # Brasier PLUS 59 €/mois
STRIPE_PRICE_PLUS_ANNUAL=price_...    # Brasier PLUS 588 €/an (49 €/mois)
STRIPE_WEBHOOK_SECRET=whsec_...
BILLING_ENFORCE_LIMITS=true           # 'false' = ne bride personne (lancement souple)
# Modèles IA (optionnel — les défauts conviennent)
OPENROUTER_MODEL=deepseek/deepseek-v4-flash     # standard (Braise/Brasier + fond)
OPENROUTER_MODEL_PLUS=anthropic/claude-opus-4.8 # premium (PLUS + essai)
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

- [ ] Produits « Brasier » et « Brasier PLUS » + 4 prix créés dans Stripe (mode **live**).
- [ ] `STRIPE_SECRET_KEY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`,
      `STRIPE_PRICE_PLUS_MONTHLY`, `STRIPE_PRICE_PLUS_ANNUAL`,
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
