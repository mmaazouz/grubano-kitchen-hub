# MONEY FLOW — RUNBOOK CLOSED BETA (état au 2026-08-27, mission Money Flow Final)

> Source de vérité opérationnelle du circuit argent pendant la closed beta.
> Complète `CLOSED-BETA-RUNBOOK.md` (§7bis) — en cas de divergence, CE fichier
> fait foi sur l'argent. Tout est **Stripe TEST** tant que le GO LIVE fondateur
> n'a pas été donné (`STRIPE-LIVE-FIRST-ORDER-CHECKLIST.md`).

---

## 1. Architecture en une page

- **Commande** : Order `awaiting_payment` → `POST /api/orders/[id]/pay` crée un
  PaymentIntent **capture automatique**, montant 100 % serveur (re-pricing DB).
  **DESTINATION CHARGE** vers le compte Stripe Connect **Express** du restaurant
  (`transfer_data.destination` + `on_behalf_of` + `application_fee_amount`).
  Confirmation **uniquement** par webhook signé (double secret) → ledger d'abord,
  puis `paymentStatus='paid'` et révélation atomique `awaiting_payment→received`.
- **CONNECT-READY GATE (D5)** : un restaurant **sans Connect actif**
  (`stripeAccountId` + `stripeAccountStatus='active'`) est **refusé** à la
  création de commande carte ET aux deux routes de paiement
  (409 `restaurant_not_payable`) — le fallback plateforme encaissait 100 % de
  l'argent chez Grubano **sans rail de reversement**. Escape hatch QA uniquement :
  `ALLOW_PLATFORM_FALLBACK=true` (danger-flag, **jamais en production**).
- **Versement restaurant** : intrinsèque à la destination charge — le net
  (`amount − application_fee`) arrive sur le solde Express du resto, **payout
  automatique quotidien** (schedule posé à la création du compte). Grubano ne
  déclenche aucun payout.
- **Empreinte réservation** : PaymentIntent **manual-capture** de
  `Restaurant.defaultDepositAmount` (défaut 10 €), canal `reservation`,
  commission 0. **Capture punitive VERROUILLÉE** (`PUNITIVE_CAPTURE_ENABLED`
  absent/OFF → 403 au point d'étranglement unique `lib/deposit.captureHold` —
  l'unique `paymentIntents.capture` du dépôt). No-show flag-OFF = **libération**.

## 2. Le split, chiffré (19,00 € pickup, commission 8 %, Connect actif)

| Poste | Montant | Où le lire |
|---|---|---|
| Client paie | **19,00 €** | `Order.total` · `LedgerEntry.grossAmount` · PI `amount_received` |
| Part restaurant | **17,48 €** | `LedgerEntry.netToRestaurant` · transfer `tr_…` → solde Express |
| Part plateforme (commission 8 % du sous-total produits) | **1,52 €** | `LedgerEntry.applicationFeeAmount` · « Collected fees » Stripe |
| Frais Stripe (≈ 1,4 % + 0,25 €) | **≈ 0,52 €** | `LedgerEntry.stripeFeeAmount` — **à la charge de Grubano** (décision A0 : inclus dans la commission) |

Composantes additionnelles possibles de l'`application_fee` : − crédit fidélité
(absorbé par Grubano, plancher 0) · + frais petite commande (1,00 € sous 12 €
de plats — 100 % Grubano) · + pourboire coursier (`TIPS_ENABLED` OFF bêta) ·
+ retenue coursier case-B (`LOGISTICS_COURIER_ACCRUAL_ENABLED` OFF) · + royalty
franchise (`FRANCHISE_ROYALTY_ENABLED` OFF). La livraison n'est **jamais**
commissionnée. Aucune composante taxe au split (prix TTC ; TVA de la commission
= FOUNDER FACT, cf. pack).

## 3. Config env cible de la bêta (argent)

| Variable | Cible | Pourquoi |
|---|---|---|
| `REFUNDS_ENABLED` | **`true`** | D3 — sans lui, AUCUN remboursement in-app (403 même admin). Avec CLAIMS OFF, il n'ouvre QUE 4 rails admin-gatés et testés. |
| `ADMIN_AUDIT_ENABLED` | **`true`** | Couplé : sans lui, `refund.run`/`refund.denied` ne s'écrivent nulle part (no-op strict). |
| `ALERT_EMAIL` | **posé** | Sans lui, les alertes ghost-order / PI périmé / annulation payée sont des no-op **silencieux**. |
| `INTERNAL_CRON_TOKEN` | **absent** | Le chemin machine de `refunds/run` reste inopérant ; seul l'admin en session déclenche. |
| `CLAIMS_ENABLED` | **`false`** | D4 FINAL — réclamations en ligne OFF toute la bêta, support humain. |
| `GHOST_ORDER_AUTO_REFUND_ENABLED` | **`false`** | Encaissement post-expiration → `reconcile_manual` + alerte, décision humaine. |
| `PUNITIVE_CAPTURE_ENABLED` | **absent/`false`** | D1 — aucune capture punitive pendant la bêta. À vérifier sur les `.env.local` serveur. |
| `ALLOW_PLATFORM_FALLBACK` | **absent** | Danger-flag QA. `true` en prod = trou D5 rouvert. |

## 4. Rembourser pendant la bêta (procédure)

1. **Commande** (annulée-payée, incident, ghost encaissé) :
   `POST /api/orders/[id]/refund` en session **admin** — partiel (`amountCents`)
   ou total ; accepte `paymentStatus` `paid` **et** `reconcile_manual` ;
   `refund_application_fee` + `reverse_transfer` au prorata sur charge routée ;
   email client best-effort ; audit `refund.run`. La commande garde
   `paymentStatus='paid'` — **la vérité remboursement = lignes ledger
   `type='refund'` négatives** (webhook `charge.refunded`, auto-guérissant).
2. **File visible** : `/admin/reconciliation` — sections « ghost orders » ET
   « annulées payées — remboursement à instruire » (montant payé vs déjà
   remboursé). Une alerte email part aussi à chaque annulation payée.
3. ⚠️ **Refund > J+1 = solde Express négatif** : les payouts resto sont
   quotidiens — la reversal tire sur un solde déjà versé ; Stripe recouvre sur
   les transfers futurs ou débite la banque du resto, et **la plateforme porte
   le négatif non recouvré**. Vérifier le solde du compte connecté (dashboard
   Stripe → compte Express) avant un gros refund tardif. Politique de
   couverture = FOUNDER FACT (pack).
4. **Jamais** de remboursement hors rail (espèces, virement manuel).

## 5. Empreinte — matrice de libération (prouvée au code)

| Cas | Libération | Quand |
|---|---|---|
| Addition payée (complète) | ✅ automatique | webhook `succeeded` du PI d'addition → `releaseHold` |
| Client annule (fenêtre 2 h, gardée) | ✅ | route cancel, après la bascule d'état |
| Restaurant annule / fermeture | ✅ | PATCH opérateur / closures |
| **No-show** (flag punitif OFF) | ✅ **libérée immédiatement** | PATCH `noshow` — jamais un gel-sanction |
| Réservation expirée sans statut | ⚠️ expiry Stripe ~7 j (aucun sweep) | ticket T-M03 |
| Addition réglée hors Stripe (clôture `manual`, deposit `none`) | ⚠️ expiry ~7 j | idem |

Limite structurelle : une autorisation carte vit **~7 jours** — toute résa prise
plus de 7 jours à l'avance perd son hold **avant** la date (webhook `canceled` →
« libérée »). Connu, assumé pour la bêta (dossier hold-vs-SetupIntent au pack).
Anti-doublon : réutilisation du PI vivant + clé déterministe ; un échec de
lecture du PI stocké répond désormais **502** (jamais un 2ᵉ hold empilé).

## 6. Réconciliation — requêtes bornées (MySQL, remplacer :from/:to)

- **R1 équation d'or** (0 ligne attendue) :
  `SELECT id FROM LedgerEntry WHERE createdAt>=:from AND createdAt<:to AND grossAmount<>applicationFeeAmount+netToRestaurant;`
- **R2 encaissé sans ligne ledger** (0) :
  `SELECT o.id FROM \`Order\` o LEFT JOIN LedgerEntry l ON l.stripePaymentIntentId=o.stripePaymentIntentId AND l.type='payment' WHERE o.paymentStatus IN ('paid','refunded','reconcile_manual') AND o.createdAt>=:from AND o.createdAt<:to AND l.id IS NULL;`
- **R3 à-cent Order↔ledger** (0) :
  `SELECT o.id FROM \`Order\` o JOIN LedgerEntry l ON l.stripePaymentIntentId=o.stripePaymentIntentId AND l.type='payment' WHERE o.createdAt>=:from AND o.createdAt<:to AND ROUND(o.total*100)<>l.grossAmount;`
- **R4 dette fallback plateforme** (0 attendu avec le gate D5 ; toute ligne = argent resto détenu par Grubano) :
  `SELECT l.restaurantId, r.name, SUM(l.netToRestaurant) owedCents, COUNT(*) n FROM LedgerEntry l LEFT JOIN Restaurant r ON r.id=l.restaurantId WHERE l.routed=0 AND l.type IN ('payment','deposit_capture','refund') GROUP BY l.restaurantId, r.name HAVING owedCents<>0;`
- **R5 file ghost** : `SELECT id,total,stripePaymentIntentId,paymentStatus FROM \`Order\` WHERE status='expired' AND paymentStatus IN ('reconcile_manual','paid');`
- **R6 refunds interrompus** : `SELECT id,orderId,amountCents FROM Refund WHERE status='pending' AND createdAt<NOW()-INTERVAL 1 HOUR;` → relancer `POST /api/admin/refunds/run` (resume-first).
- **R7 refund moteur sans ligne ledger** (0 — le webhook auto-guérit) :
  `SELECT f.id FROM Refund f LEFT JOIN LedgerEntry l ON l.sourceEventId=f.stripeRefundId AND l.type='refund' WHERE f.status='succeeded' AND l.id IS NULL;`
- **R8 preuves Stripe manquantes** (compléter au dashboard : PI→charge→transfer) :
  `SELECT id,stripePaymentIntentId FROM LedgerEntry WHERE type='payment' AND routed=1 AND (stripeChargeId IS NULL OR stripeTransferId IS NULL) AND createdAt>=:from;`
- **Hebdo** : `GET /api/admin/ledger/check?from=&to=` (admin) — équation ligne à
  ligne + réconciliation contre les PIs et refunds Stripe réels → `ok:true` attendu.

**Chaîne d'ids** : Order.id → `Order.stripePaymentIntentId` (@unique) →
`LedgerEntry` (chargeId, transferId, stripeFee réels, best-effort) →
`Restaurant.stripeAccountId`. Les payouts bancaires du resto vivent dans SON
dashboard Express (hors périmètre DB).

## 7. Incidents argent — table de lecture

| Symptôme | Où | Lecture / action |
|---|---|---|
| Client « payé » mais commande invisible resto | `/admin/reconciliation` + R5 | Webhook en retard ou heal-on-replay ; >24 h → ghost → alerte. Ne JAMAIS avancer une commande `awaiting_payment` à la main. |
| Alerte « PI périmé encaissé » | email `admin_stale_pi` | Le client a pu payer 2× : vérifier les DEUX PIs au dashboard, rembourser l'orphelin (rail admin par PI). |
| Alerte « annulation payée » | email `admin_paid_cancellation` + vue admin | Instruire le remboursement (§4.1). |
| `restaurant_not_payable` en QA | env | C'est le gate D5 : le resto n'est pas Connect-actif. QA locale : `ALLOW_PLATFORM_FALLBACK=true`. |
| Empreinte « libérée » mais client voit le hold | R8 + dashboard | Anti-cross-talk en place ; si constaté : vérifier le PI réel de la résa (`stripePaymentIntentId`), l'expiry ~7 j finit toujours par libérer. |
| Refund refusé 403 | env | `REFUNDS_ENABLED` absent → le poser (config §3). |
