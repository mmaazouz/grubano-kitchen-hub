# STRIPE LIVE — CHECKLIST DU PREMIER PAIEMENT COMMERCIAL

> **AUCUNE transaction LIVE n'a été exécutée ni ne doit l'être sans le GO
> explicite du fondateur.** Ce document sépare strictement :
> **TECHNICAL STRIPE LIVE READINESS** (le code) et **BUSINESS / LEGAL LIVE
> READINESS** (l'opérateur juridique). Le second bloque le premier paiement réel.

---

## 0. 🔴 PRÉ-REQUIS ABSOLU — L'OPÉRATEUR JURIDIQUE GRUBANO (D0)

**Statut : NOT YET ESTABLISHED.** L'entité juridique dédiée à Grubano n'a pas
encore été créée. **Hotelstaff est une activité distincte du fondateur, sans
lien juridique avec Grubano — son SIRET, son compte bancaire, son identité
Stripe ou ses mentions ne doivent JAMAIS être utilisés pour Grubano.**

Systèmes qui dépendent de l'entité (rien d'autre n'est bloqué) :

1. **Compte Stripe plateforme LIVE** — le titulaire (merchant of record des
   application fees, responsable Connect) doit être l'entité Grubano.
2. **Compte bancaire** de payout plateforme.
3. **Mentions légales / pages légales** (`lib/legal-info.ts` — placeholders).
4. **Facturation** — l'émetteur des factures de commission (`lib/invoice.ts`
   lit `LEGAL_INFO.editor`, aujourd'hui placeholders).
5. **Contrats** (CGV conso, conditions partenaires, accord bêta).
6. **Stripe Connect** — la plateforme signe les CGU Connect en tant qu'entité.

⛔ Tant que ce bloc n'est pas résolu :
**FIRST COMMERCIAL LIVE PAYMENT = BLOCKED — GRUBANO LEGAL OPERATOR NOT YET ESTABLISHED.**

## 1. Technique — côté dashboard Stripe (mode LIVE)

- [ ] Compte plateforme LIVE activé (KYB de l'entité §0), capacités carte + Connect.
- [ ] `STRIPE_SECRET_KEY` = `sk_live_…` et `STRIPE_PUBLISHABLE_KEY` = `pk_live_…`
      posées dans `.env.local` du serveur de production (jamais affichées, jamais commit).
- [ ] **Endpoint webhook « Your account »** → `https://grubano.com/api/webhooks/stripe`
      — events : `payment_intent.succeeded`, `payment_intent.amount_capturable_updated`,
      `payment_intent.canceled`, `charge.refunded` (+ `charge.dispute.*` si
      `CHARGEBACKS_ENABLED` un jour) → `STRIPE_WEBHOOK_SECRET` (whsec live).
- [ ] **Endpoint webhook « Connected accounts »** → même URL — event
      `account.updated` → `STRIPE_CONNECT_WEBHOOK_SECRET`. Sans lui, un compte
      resto restreint reste « active » en DB jusqu'à l'ouverture de sa carte réglages.
- [ ] Statement descriptor de la plateforme (libellé sur le relevé du client) —
      choix fondateur, cohérent avec l'entité §0.
- [ ] Accès refund vérifié (rôle du compte admin Stripe).

## 2. Technique — restaurant pilote (Connect LIVE)

⚠️ **Les comptes Express TEST ne valent RIEN en live** : le pilote doit refaire
l'onboarding Connect en mode live, avec **SES PROPRES informations juridiques**
(entreprise, représentant, IBAN — jamais celles de Grubano ni du fondateur,
sauf si cette identité EST juridiquement l'exploitant du restaurant). Les
pièces se saisissent **uniquement dans le parcours hébergé Stripe** — jamais
par chat/email.

- [ ] `POST /api/restaurants/[id]/connect` → onboarding hébergé complété.
- [ ] Statut synchronisé : `stripeAccountStatus='active'`
      (= `details_submitted` ∧ `charges_enabled` ∧ `payouts_enabled`).
- [ ] `requirements.currently_due` vide (dashboard → compte connecté) ;
      noter `eventually_due` pour anticiper.
- [ ] Compte bancaire de payout du restaurant vérifié (payouts quotidiens actifs).
- [ ] Rappel gate D5 : sans ce statut, la création de commande et les /pay
      répondent 409 `restaurant_not_payable` — c'est voulu.

## 3. Technique — env serveur production (argent)

- [ ] `REFUNDS_ENABLED=true` · `ADMIN_AUDIT_ENABLED=true` · `ALERT_EMAIL` posé
- [ ] `CLAIMS_ENABLED=false` (D4) · `GHOST_ORDER_AUTO_REFUND_ENABLED=false`
      · `PUNITIVE_CAPTURE_ENABLED` absent (D1)
- [ ] `ALLOW_PLATFORM_FALLBACK` **ABSENT** (danger-flag QA)
- [ ] `RATE_LIMIT_ENABLED=true` · `INTERNAL_CRON_TOKEN` absent
- [ ] `node scripts/check-flags.mjs` sans erreur
- [ ] Restaurant pilote : carte remplie (plats + allergènes), `pickupEnabled=true`,
      horaires, géocodage OK (checklist 7.1 du runbook closed beta).

## 4. Procédure du PREMIER paiement commercial (après GO fondateur explicite)

1. Opérateur juridique établi (§0) — vérifié.
2. Compte plateforme LIVE cohérent avec l'entité (§1).
3. Restaurant pilote Connect-ready LIVE (§2).
4. Choisir un **petit produit réel** (ex. 6,50 €).
5. **GO fondateur écrit** → une vraie carte (celle du fondateur de préférence).
6. Commande → paiement → vérifier le webhook (`paymentStatus='paid'`, reveal).
7. Vérifier la commande côté restaurant (`/orders`).
8. Vérifier le transfer au dashboard (PI → charge → transfer → compte pilote).
9. Vérifier la ligne ledger (R1/R3 du MONEY-FLOW runbook, montants au cent).
10. Vérifier « Collected fees » = commission attendue.
11. Le lendemain : payout quotidien arrivé sur le compte du pilote.
12. Option (décision fondateur) : refund TEST contrôlé du même ordre pour
    valider le rail refund LIVE (⚠️ post-payout = solde négatif, cf. runbook §4.3).

**⛔ STOP avant toute vraie charge : les étapes 5-12 n'ont lieu qu'après le GO
explicite. Rien dans le code ne déclenche de LIVE automatiquement — la bascule
est 100 % environnement (clés) + dashboard.**
