# BETA-CLAIMS-REFUND-FACTUAL-INVENTORY

> **PHASE 0 (ADDENDUM FONDATEUR) — read-only.** Inventaire factuel ancré `fichier:ligne` établi @ `ec3891f` (= staging `app.grubano.com` + `business.grubano.com`) par 5 agents forensiques isolés + 1 critique adversarial de complétude. Aucune modification de code. Aucune activation.
>
> **VERDICT : PHASE 0 = PASS** (critique : `inventory_sufficient = PASS`). Aucune implémentation avant ce PASS — atteint.

---

## 0 · Résumé exécutif — ce que Phase 0 change dans le plan

Le cycle **remboursement** est **bâti, testé et cent-exact** ; le cycle **Claims** est **complet de bout en bout** mais gaté OFF ; la **fidélité sous remboursement** porte **trois défauts réels** ; le socle **légal technique** est **sain** (pas de tracker tiers → pas de bannière) mais **sans CGV ni preuve d'acceptation**.

**Découverte structurante du critique (ratée à moitié par chaque agent) :** le handler webhook `charge.refunded` **n'a AUCUN gate `REFUNDS_ENABLED`** ([`app/api/webhooks/stripe/route.ts:622`](app/api/webhooks/stripe/route.ts:622)). Il se déclenche sur **tout** évènement Stripe `charge.refunded` — **y compris un remboursement émis à la main depuis le Dashboard Stripe**, hors de toute route applicative. Donc le rail fidélité-au-refund (re-crédit **100 %** de `pointsRedeemed` même sur un remboursement partiel), les lignes ledger négatives et le clawback pourboire livreur **sont LIVE aujourd'hui**, indépendamment des flags. → **Les correctifs fidélité (Phase 1) ne peuvent pas attendre un flip de flag** : tout refund Dashboard exerce déjà le rail. Cela **impose** l'ordre 1 → 2 → 3.

---

## 1 · RAIL DE REMBOURSEMENT (financier) — BÂTI & PROUVÉ

**Deux rails coexistent, volontairement NON fusionnés** (en-têtes « DO NOT MERGE » [`lib/refund.ts:3-12`](lib/refund.ts:3), [`lib/refunds.ts:1-8`](lib/refunds.ts:1)) :

| | **Rail B — moteur** `lib/refund.ts` `executeRefund` | **Rail A — simple** `lib/refunds.ts` `refundPayment` |
|---|---|---|
| Clé | `orderId` | `paymentIntentId` |
| Royalty franchise | **aware** (clawback + `refundedCents`) | **UNAWARE** |
| Ledger | **eager** (`recordRefundLedgerEntry`) + webhook backstop | webhook seulement |
| Route | `POST /api/admin/refunds/run` | `POST /api/orders/[id]/refund`, `…/tickets/[id]/refund`, `…/reservations/[id]/refund-deposit` |

- **Gates route (les deux)** : `rateLimit` → `isRefundsEnabled()` **403 `{gated:true}` AVANT tout Stripe si OFF** → auth. `run` : `INTERNAL_CRON_TOKEN` (header `x-internal-token`, `safeEqual` temps constant) **OU** session `admin`. `orders/[id]/refund` : session `admin` **uniquement** (opérateur resto → 403 `not_admin` audité). Anonyme → 401 audité `refund.denied`. Réf. [`app/api/admin/refunds/run/route.ts:39-71`](app/api/admin/refunds/run/route.ts:39), [`lib/refund-route-guard.ts:29-63`](lib/refund-route-guard.ts:29).
- **CORRECTION du critique** : le fact LEDGER « rail A UNGATED/LIVE today » est **stale au niveau route** — les **trois** routes qui appellent `refundPayment` sont désormais enveloppées d'`isRefundsEnabled()` (régime P0-26) : aucun chemin HTTP n'atteint le rail A quand `REFUNDS_ENABLED=OFF`. La **lib** reste ungated (son commentaire d'en-tête décrit un état pré-P0-26 — **à corriger** dans les headers, cf. §7 nettoyage).
- **Split cent-exact** (`computeRefundSplit`, arithmétique entière, arrondi **cumulatif**) : `restaurantReverseCents + applicationFeeRefundCents === refundAmount` au centime, total **et** partiel ; royalty **nichée** dans l'application-fee (`0 ≤ royaltyRefund ≤ applicationFeeRefund`). Sur-remboursement rejeté (`refundable ≤ 0` → 409 ; `amt > refundable` → 400). N partiels somment **exactement** à `F`, `T-F`, `R`. Réf. [`lib/refund.ts:116-153`](lib/refund.ts:116).
- **Stripe** : `refunds.create({payment_intent, amount, ...(routed ? {refund_application_fee:true, reverse_transfer:true} : {})}, {idempotencyKey})`. `reverse_transfer`/`refund_application_fee` posés **seulement si `routed`** (`pi.transfer_data`). Réf. [`lib/refund.ts:241-250`](lib/refund.ts:241).
- **Anti-double-refund** : `Refund.idempotencyKey @unique = refund:<orderId>:<alreadyRefunded>` (curseur cumul lu **live** Stripe, cross-rail) = clé idempotence Stripe ; **RESUME-FIRST** re-drive une ligne `pending` avant tout nouveau refund. Réf. [`lib/refund.ts:472`](lib/refund.ts:472), [`prisma/schema.prisma:2010`](prisma/schema.prisma:2010).
- **`Order.paymentStatus` inchangé par les deux rails** (reste `paid`) ; seul le webhook ghost-order fait `reconcile_manual`/`refunded`.

**Invariants PROUVÉS par tests** : équation golden `gross = applicationFee + net` par ligne et agrégat, avec négatifs de refund ([`tests/finance-ledger-equation.test.ts`](tests/finance-ledger-equation.test.ts)) ; split client-exact total+partiel, cumul sans dérive, nesting royalty, refund routed full/settled, anti-double-refund ([`tests/refund-split.test.ts`](tests/refund-split.test.ts), [`tests/refund-engine.test.ts`](tests/refund-engine.test.ts)).

**Invariant fondateur (FULL → fee 100 % rendue ; PARTIAL → fee au prorata)** : **déjà satisfait par le moteur** (Rail B) via `refund_application_fee:true` + le split prorata. **MAIS** (gaps §1.g) le rail est incomplet sur la **conservation tripartite** et le **fee Stripe**.

### 1.g · Gaps refund (Phase 2)
1. **Aucun test de conservation TRIPARTITE** (`CLIENT récupéré + RESTO conservé + GRUBANO conservé = état initial`) comme identité unique sous refund partiel. Les tests prouvent les sous-égalités, pas la somme des 3 parts.
2. **Fee de traitement Stripe non repris** (`stripeFeeAmount=0`) : sur un refund partiel, **Grubano absorbe** la fraction `f` du fee Stripe de la portion remboursée — impact réel sur la part Grubano, non modélisé ni testé.
3. **Refund partiel + pourboire livreur** : `applicationFeeRefund` reprend une fraction du fee **qui inclut le tip**, mais le clawback tip courier **ne se déclenche que sur refund TOTAL** ([`webhook:746-753`](app/api/webhooks/stripe/route.ts:746)) → un partiel rembourse au client une part du tip détenu pour le courier **sans réduire l'obligation courier**. Désalignement non testé.
4. **🔴 DOUBLE-VERSEMENT franchise (bloquant Phase 2)** : `orders/[id]/refund` → `refundPayment` **ne met jamais à jour `FranchiseRoyalty.refundedCents`**. Sur une commande **franchisée**, Stripe rend la commission (part royalty comprise) au client via `refund_application_fee`, **puis** la settlement paie `royaltyCents` en plein → **part royalty rendue deux fois**. Seul `executeRefund` est royalty-aware. Les deux routes admin partagent le **même** flag : dès `REFUNDS_ENABLED=true`, choisir `orders/[id]/refund` sur une commande franchisée = double-versement. Réf. [`app/api/orders/[id]/refund/route.ts:72`](app/api/orders/[id]/refund/route.ts:72), [`lib/refund.ts:359`](lib/refund.ts:359).

---

## 2 · FIDÉLITÉ sous remboursement — TROIS DÉFAUTS RÉELS (Phase 1)

- **Gain** : `pointsEarned = floor(foodTotal)` figé à la création ([`orders/route.ts:467`](app/api/orders/route.ts:467)), crédité **au passage `delivered`** (`$transaction` atomique balance + `LoyaltyTransaction 'earn'`), best-effort. Idempotence = garde **applicative** `findFirst {orderId,'earn'}` — **pas** de contrainte DB.
- **Dépense** : `100 pts = 5,00 €` ; crédit plafonné à `min(solde, subtotal, commission)`, financé par Grubano ; débité **au webhook `charge.succeeded`** (jamais au retour navigateur).
- **Défaut A — points GAGNÉS jamais repris au refund.** Aucun clawback `earn` nulle part (`webhook:709-742` ne touche que `pointsRedeemed` ; `lib/refund.ts`/`lib/claims.ts` = 0 fidélité). **POLITIQUE fondateur requise.**
- **Défaut B — re-crédit 100 % des points dépensés sur un refund PARTIEL** ([`webhook:711-713`](app/api/webhooks/stripe/route.ts:711)) : un client remboursé à 10 % récupère l'argent partiel **+ l'intégralité** de ses points. **POLITIQUE fondateur requise** (prorata vs intégral).
- **Défaut C — solde négatif possible + idempotence fragile** : le débit `redeem` est un `decrement` **inconditionnel** sans `Math.max(0)` ([`webhook:517`](app/api/webhooks/stripe/route.ts:517)) **et** `LoyaltyTransaction` n'a pas de `@@unique([orderId,type])` (seulement `@@index`, [`schema:340-342`](prisma/schema.prisma:340)). Sous **rejeu concurrent** du webhook, on peut **à la fois** double-débiter **et** pousser `pointsBalance < 0`. **Correctif technique** (contrainte DB unique + `upsert` + garde solde).
- **Frontière** : le rail fidélité-refund étant **flag-indépendant** (§0), ces défauts sont **déjà atteignables en prod** dès qu'un refund Dashboard survient.

### 2.migration · Dépendance schéma Phase 1
Le correctif idempotence (`@@unique([orderId,type])` sur `LoyaltyTransaction`) passe par **`prisma db push`** (pas de dossier `prisma/migrations`, schéma géré par push, CLAUDE.md §7). Ajouter une contrainte unique **échoue si des lignes dupliquées existent déjà** → une **dé-duplication préalable en base** est requise avant le push. **La base staging/prod n'est pas joignable depuis le poste agent (o2switch, P1001).** → étape data-migration à piloter côté serveur.

---

## 3 · CLAIMS (domaine / sécurité / admin) — COMPLET, GATÉ OFF

- **Gate maître** `isClaimsEnabled() = CLAIMS_ENABLED === 'true'` ([`lib/claims.ts:25`](lib/claims.ts:25)). OFF → toutes routes 403/`{enabled:false}`, UI non montée = **byte-identical**.
- **Machine à états** : `restaurant_review → (refuse:refused | accept:arbitration) → arbitrate(admin){approve→triggerClaimRefund→refunding→refunded | refuse_final}`. Post-P0-24 **l'accept resto ne rembourse rien** (route en `arbitration`, seul l'admin décide l'argent). `triggerClaimRefund` → **`executeRefund`** (Rail B, royalty-aware), REFUNDS OFF → `{pending,'refunds_disabled'}`. Réf. [`lib/claims.ts:222-259`](lib/claims.ts:222).
- **Invariants** : ≤ 1 refund/claim (CAS atomique `refundAttempted`), ≤ 1 claim active/commande (`activeOrderKey @unique`), montant **re-dérivé serveur** (jamais l'input client), anti-IDOR (claim d'autrui → **404**). Le **bouton photo n'est PAS inerte** (upload réel → Cloudinary modéré). Reasons UI = serveur.
- **Écrivain système** : l'annulation resto d'une commande **payée** crée une `Claim system_order_cancelled` en `arbitration` dans la même transaction (gaté CLAIMS).

### 3.g · Gaps claims (Phase 3)
1. **🔴 Resto qui ignore une claim** : sans `CLAIMS_AUTO_APPROVE_ENABLED` (OFF), la claim reste `restaurant_review` **indéfiniment**, `activeOrderKey` **verrouille** l'ordre, et **l'admin ne peut PAS agir** (`listPendingRestaurantClaims` est lecture seule, aucune route de transition admin sur un `restaurant_review`). Seule sortie = `stale-alerts` (email, aucune action). **Trou fonctionnel majeur.**
2. **Échec moteur après `refundAttempted=true`** : claim revient `approved` + `refundError` mais **exclue** de la file arbitrage ET du sweep (les deux exigent `refundAttempted:false`) → bloquée, invisible, reprise **manuelle** uniquement, aucune route ne la re-drive.
3. **Aucune catégorie/sévérité sécurité alimentaire/allergène** ni priorisation urgente (modèle, moteur, file, UI = 0). **À concevoir (Phase 3, agent SAFETY).**
4. **Label stale** `RestaurantClaimsPanel` (« remboursement en attente » sur accept alors que l'accept ne rembourse plus).

---

## 4 · STRIPE / LEDGER — DESTINATION CHARGES, RÉCONCILIATION OUTILLÉE

- **Charge commande = destination charge Connect** (`application_fee_amount` + `transfer_data.destination` + `on_behalf_of`) **si** resto Connect actif ; sinon 409 `restaurant_not_payable` **avant** Stripe (gate D5). Capture **automatique** (débit immédiat), pas d'empreinte. Réf. [`lib/stripe.ts:92-99`](lib/stripe.ts:92), [`app/api/orders/[id]/pay/route.ts:201-216`](app/api/orders/[id]/pay/route.ts:201).
- **Commission** `dinein 5 / pickup 8 / delivery 12 / reservation 0 %`, override par resto + `commissionFreeUntil` ; base = subtotal produits − promo (jamais le `deliveryFee`). Réf. [`lib/commission.ts:14-59`](lib/commission.ts:14).
- **Webhook** : signature vérifiée contre **2** secrets ; `charge.refunded` (ledger négatif + fidélité + tip clawback), `payment_intent.succeeded` (ledger-first puis `handleOrderPaid`). Ghost-order > 24 h → `reconcile_manual` (jamais de money-out silencieux). Réf. [`app/api/webhooks/stripe/route.ts:51-158`](app/api/webhooks/stripe/route.ts:51).
- **Détecteur `/api/admin/ledger/check`** (admin) : équation golden par ligne + agrégat, réconciliation Stripe (count+gross) et refunds. `ok:true` seulement si tout matche.

### 4.g · Gaps ledger (Phase 2, chevauche §1.g)
Conservation tripartite non isolée en test ; fee Stripe non repris au partiel ; « byte-identical quand flags OFF » affirmé par commentaire, non isolé en test pour la chaîne complète tip+smallFee+courier+royalty **simultanément** OFF.

---

## 5 · COOKIES / LÉGAL TECHNIQUE / FORMATION DU CONTRAT — SOCLE SAIN, CGV ABSENTES (Phase 6)

- **COOKIE CONSENT REQUIRED = NON**, prouvé : **0 tracker analytics/marketing tiers** (grep GTM/GA/gtag/plausible/posthog/mixpanel/segment = 0), polices **auto-hébergées**. Les 8 cookies inventoriés sont **nécessaires** (locale, 3 NextAuth, `grubano_estab` opérateur) + les 2 cookies **anti-fraude Stripe** (`__stripe_mid/sid`, posés par `js.stripe.com` **seulement** au montage du module paiement). Les 2 cookies d'attribution (`grubano_ref/chef`) sont **gatés OFF** par défaut (jamais posés en bêta). Réf. [`lib/legal-info.ts:127-136`](lib/legal-info.ts:127). **Ne pas créer de bannière = pas de théâtre de conformité.**
- **Panier + adresses conso = `localStorage`** (jamais cookie, aucun envoi serveur au chargement).
- **CGV/TERMES : AUCUNE surface, AUCUN modèle de preuve d'acceptation** (pas de `termsVersion`/`acceptedAt` lié à un user/commande ; aucun lien ni case au checkout). `Operator.consentAt` = consentement RGPD **inscription partenaire**, pas conso.
- **Formation du contrat (séquence réelle)** : panier `placeOrder` → `POST /api/orders` crée l'Order `awaiting_payment` **sans débit**, **re-prix serveur** (prix client ignoré) → écran checkout `POST /pay` crée le PaymentIntent (montant `order.total` **serveur**) → `confirmPayment` (capture auto) → **`paymentStatus='paid'` posé par le WEBHOOK**, `awaiting_payment → received`. Il n'existe **pas** d'état contractuel explicite.
- **Libellés du bouton d'engagement (par surface)** : `/eat/cart` = **« Passer la commande · XX,XX € »** (crée seulement, ne débite pas) ; `/eat/checkout` = **« Payer {amount} »** puis Elements **« Payer maintenant »** (le vrai débit) ; `eat-next/checkout` = « Payer par carte · XX,XX € » ; addition table = « Payer mon addition ». La clé `eat.checkout.payNowNote` (« Montant débité maintenant… ») **existe mais n'est rendue nulle part** — la seule réassurance affichée est « Paiement chiffré ».
- `LEGAL_INFO` **intégralement en placeholders** @ `ec3891f` → pages `/legal/*` en `noindex` + bandeau brouillon (seul l'hébergeur o2switch est renseigné).

### 5.g · Gaps légal-tech (Phase 6, technique seulement)
Aucun stockage version CGV + preuve d'acceptation (modèle dédié `version/acceptedAt/locale/relation` + capture au checkout) ; aucune page CGV à lier ; libellé `/eat/cart` **ambigu** (montant affiché mais verbe « passer la commande », débit à l'écran suivant) ; `payNowNote` non rendue → divulgation « débit immédiat » absente près du bouton ; `images.unsplash.com` = requête tierce (IP) sans notice.

---

## 6 · GRAPHE DE DÉPENDANCES & ORDRE DES PHASES (confirmé par le critique)

```
Phase 1 (loyalty sûre) ──DOIT PRÉCÉDER──▶ Phase 2 (rail refund)
   └─ imposé, pas seulement prudent : le rail fidélité-refund est FLAG-INDÉPENDANT
      (webhook charge.refunded, LIVE via Dashboard) → les 3 défauts sont déjà atteignables.
   └─ dépendance schéma : @@unique([orderId,type]) via `prisma db push` + DÉ-DUP préalable en base.

Phase 2 (rail refund) ──DOIT PRÉCÉDER──▶ Phase 3 (claims avec argent)
   └─ triggerClaimRefund délègue à executeRefund et est INERTE sous REFUNDS OFF.
   └─ Phase 2 doit fermer le DOUBLE-VERSEMENT franchise (orders/[id]/refund royalty-unaware).

CLAIMS_ENABLED et REFUNDS_ENABLED sont INDÉPENDANTS dans le code (aucun couplage forcé) ;
la branche argent d'un claim est fonctionnellement inerte sans REFUNDS.
Aucune dépendance schéma NOUVELLE Phase 2/3 (Refund.idempotencyKey, Claim.activeOrderKey déjà @unique).
```

---

## 7 · DÉCISIONS DE POLITIQUE FONDATEUR REQUISES (bloquent Phase 1)

1. **Points GAGNÉS au remboursement** : repris intégralement / au prorata du montant remboursé / **conservés** (comportement actuel) ? *(Impact : chaque commande delivered-puis-remboursée conserve déjà les points en prod.)*
2. **Points DÉPENSÉS re-crédités sur refund PARTIEL** : **intégral** (actuel) ou **au prorata** du montant remboursé ?
3. **Migration idempotence** : autorisation de la dé-duplication `LoyaltyTransaction` + `db push` sur staging (nécessite un accès serveur / une fenêtre).

> Tant que (1) et (2) ne sont pas tranchées, **Phase 1 = BLOCKED** (décision de politique, cf. addendum : « If BLOCKED on a genuine founder policy issue: STOP »).

---

## 8 · CE QU'IL FAUDRA CORRIGER (par phase, pour mémoire)

- **P1** : garde solde ≥ 0 + `@@unique([orderId,type])` + `upsert` ; décision earn-clawback ; proportionnalité re-crédit ; re-crédit dépendant de `charge.metadata.orderId` (log si absent) ; asymétrie débit manquant si pas de `LoyaltyCustomer`.
- **P2** : fermer le double-versement franchise (router les claims/refunds commande **uniquement** via le moteur royalty-aware, ou rendre `refundPayment` royalty-aware / le retirer du chemin commande) ; test de conservation tripartite ; modéliser le fee Stripe au partiel ; aligner clawback tip sur refund partiel ; corriger les en-têtes « UNGATED LIVE » stale.
- **P3** : route de transition admin sur `restaurant_review` bloqué ; re-drive d'une claim `approved`+`refundError` ; taxonomie/sévérité sécurité alimentaire + priorisation ; label `RestaurantClaimsPanel`.
- **P6** : modèle preuve CGV + version + capture checkout ; page CGV ; libellé `/eat/cart` non ambigu + rendre la divulgation « débit immédiat » ; notice image tierce.

---

## 9 · UNKNOWNS (non établissables depuis le repo — état serveur/DB/Stripe)

État réel des flags (`REFUNDS_ENABLED`, `CLAIMS_ENABLED`, `GHOST_ORDER_AUTO_REFUND_ENABLED`, `ATTRIBUTION_COOKIES_ENABLED`, `ALLOW_PLATFORM_FALLBACK`, `RATE_LIMIT_ENABLED`…) ; existence physique de la table `Claim` (push effectué ?) ; mode Stripe TEST/LIVE + statut Connect des restos ; existence d'un compte Operator `admin` staging + valeur `INTERNAL_CRON_TOKEN` ; lignes `LedgerEntry`/`Refund`/`FranchiseRoyalty` réelles + commandes `reconcile_manual` non drainées ; soldes fidélité négatifs déjà créés. **Base o2switch injoignable en local (P1001).**

---

**PHASE 0 = PASS.** Prochaine porte : **Phase 1 (loyalty)** — **BLOCKED** en attente des décisions de politique §7 (1) et (2) et de la fenêtre d'accès serveur §7 (3).
