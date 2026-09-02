# BETA-PRODUCT-FINAL-CLOSEOUT — état vivant (checkpoint de reprise)

> Document de reprise imposé par l'ADDENDUM FONDATEUR (§5). Toute intervention Claude Code qui atteint sa capacité **doit** pouvoir reprendre depuis ce document sans re-découvrir le travail fait. Mis à jour à la fin de **chaque** phase.
>
> **Modèle d'exécution** : LEAD/orchestrateur + agents spécialisés + relecteurs adversariaux indépendants. Branches isolées, worktrees isolés, aucune worktree mutable partagée, aucune opération git destructive. Investigation/test/revue parallélisés ; changements de code **sérialisés** dès qu'une dépendance argent/schéma se recouvre.
>
> **Portée absolue** : jamais `main`, jamais production, jamais Stripe LIVE. Fusion `develop` + déploiement staging autorisés par le fondateur **seulement si** toutes les portes requises PASS, invariants financiers PASS, sécurité PASS, aucun P0, design approuvé là où requis.

---

## HARD PHASE GATES — tableau de bord

| Phase | Objet | Statut | Branche | Livrable |
| --- | --- | --- | --- | --- |
| **0** | Inventaire factuel (read-only) | **PASS** ✅ | `a1/beta-closeout` (docs) | `BETA-CLAIMS-REFUND-FACTUAL-INVENTORY.md` ✅ |
| **1** | Modèle financier fidélité (sûr sous refund) | **IMPLÉMENTÉ** ✅ (attend migration staging fondateur) | `a1/loyalty-refund` | `LOYALTY-REFUND-CONTRACT.md` ✅ |
| **2** | Rail financier de remboursement | À FAIRE | — | `REFUND-FINANCIAL-CONTRACT.md` |
| **3** | Claims : domaine / sécurité / admin | À FAIRE | — | (revue sécurité adversariale) |
| **4** | Claims : UX consommateur | À FAIRE | — | pack Claude Design si visuellement faible |
| **5** | Nettoyage produit | À FAIRE | — | — |
| **6** | Hooks légaux techniques | À FAIRE | — | `CHECKOUT-CONTRACT-FORMATION-FACTS.md` |

Règle d'or : **une phase doit être indépendamment complète avant de commencer la suivante.** Une phase antérieure terminée vaut mieux que six domaines à moitié faits.

---

## PRÉ-REQUIS DÉJÀ EN LIGNE (staging `ec3891f`, `main` intouché)

Train de fusion précédent, une fusion à la fois, CI verte + healthcheck au SHA exact à chaque étape :

- **Sécurité** `148b28c` — auth `/api/menu` + `/api/menu/scan-dish`.
- **S1.1** `c855673` — fiche restaurant + menu conso. **FINAL VISUAL PASS = PASS** (inspection fondateur staging réel, 1440/768/390 × empty/cart/product). Déviations acceptées consignées dans `docs/design/handoffs/S1.1-ref/CONTRACT.md` §22, dont **Sur place `EXPLICITLY ACCEPTED — SUR PLACE OUT OF BETA`**. **Ne pas rouvrir sans régression prouvée.**
- **D2.1** `8107ca9` — éditeur de plat pixel-fidèle (arbitrages photo/allergènes consignés).
- **Italien** `216699d` — bloc `eat` au registre formel (Lei), convergence 55→0.
- **Lot véracité** `ec3891f` — temps promis retirés (durée de préparation saisie exposée à la place), référence de commande unifiée `lib/order-ref` (`GR-`+6, 15 sites), pass de retrait à état terminal « Récupérée » (QR retiré après remise), carte « Sur place » masquée si non réservable, frais/distance honnêtes, phrases empreinte contradictoires retirées au checkout.

---

## PHASE 0 — INVENTAIRE FACTUEL (read-only) — **PASS** ✅

**Livrable** : [`docs/ops/BETA-CLAIMS-REFUND-FACTUAL-INVENTORY.md`](BETA-CLAIMS-REFUND-FACTUAL-INVENTORY.md) (5 agents forensiques isolés + critique adversarial, `inventory_sufficient = PASS`). Aucun code modifié.

**Faits saillants** :
- Rail de remboursement **bâti, testé, cent-exact** (moteur `executeRefund` royalty-aware ; split prorata prouvé par `tests/refund-split.test.ts` + `tests/refund-engine.test.ts`). L'invariant fondateur (full → fee 100 % ; partial → prorata) est **déjà satisfait par le moteur**.
- Cycle **Claims complet** mais gaté OFF (byte-identical) ; trou majeur : **resto qui ignore une claim** la bloque indéfiniment (admin ne peut pas agir).
- **Fidélité sous refund = 3 défauts** : (A) points gagnés jamais repris, (B) re-crédit 100 % des points dépensés sur refund partiel, (C) solde négatif possible + idempotence non-DB.
- **Légal-tech sain** : **COOKIE CONSENT REQUIRED = NON** prouvé (0 tracker tiers) → pas de bannière ; mais **aucune CGV ni preuve d'acceptation**, libellé `/eat/cart` ambigu.

**Découverte structurante (critique)** : le webhook `charge.refunded` **n'est pas gaté** → le rail fidélité-refund est **LIVE aujourd'hui via un remboursement Dashboard Stripe**, indépendamment des flags. → **impose l'ordre 1 → 2 → 3** ; les correctifs fidélité ne peuvent pas attendre un flip de flag.

**Dépendances d'ordre confirmées** : Phase 1 (loyalty sûre) **DOIT** précéder Phase 2 (rail refund) **DOIT** précéder Phase 3 (claims avec argent). Phase 1 requiert un `prisma db push` (`@@unique([orderId,type])`) avec **dé-duplication préalable en base** → **accès serveur requis** (o2switch injoignable en local).

**PHASE 0 = PASS.**

---

## PHASE 1 — MODÈLE FINANCIER FIDÉLITÉ — **IMPLÉMENTÉ** ✅ (attend migration staging fondateur)

Décisions fondateur reçues et LOCKÉES (D1 reversal earned prorata, D2 restore spent prorata, D3 offset interne, funding GRUBANO, cash-cap ≤ Stripe). Implémenté sur `a1/loyalty-refund` (worktree isolé), banké, **non mergé** (le merge suit la migration staging exécutée par le fondateur, gate order).

**Faits** :
- Cash-cap **structurel** (order.total = charge.amount) → Phase 1 = points-only. Prorata sur `charge.amount` (jamais foodTotal). Modèle cible-cumulatif télescopant comme `computeRefundSplit`.
- Idempotence = `LoyaltyTransaction.sourceEventId` (re_… Stripe) + `@@unique([sourceEventId,type])` ; `@@unique([orderId,type])` REJETÉ. Schéma **purement additif** ; **rehearsal local disposable PASS** (no --accept-data-loss, no dedup, multi-NULL, zéro drift).
- Webhook `charge.refunded` = point UNIQUE de reconciliation, NON gaté (reconcilie la vérité Stripe quelle que soit l'origine) ; `executeRefund` ne touche pas la fidélité (un seul propriétaire).
- **Revue adversariale (E financier / F migration)** : 4 défauts corrigés — grandfather des commandes legacy-remboursées, `FOR UPDATE` + deltas relatifs (concurrence), guard earn-sur-commande-remboursée, waiver key scopée client. E confirme : points-only, funding, arrondi cumulatif, replay tiennent.

**Livrables** : `LOYALTY-REFUND-CONTRACT.md` (23 §), `prisma/manual-migrations/phase1-loyalty-refund.sql` (artefact reviewable), `PHASE1-STAGING-PROCEDURE.md` (backup+migrate+verify+rollback fondateur, 0 secret).

**Gates** : suites Phase 1 (math 25 + apply 8 + waiver 5) + full vitest + cold build — verts (voir verdict). tsc baseline 37 (0 erreur produit Phase 1). `main`/prod/Stripe LIVE jamais touchés ; **freeze remboursement staging ACTIF**.

**Blocage Phase 2 enregistré** (non touché) : `orders/[id]/refund` non royalty-aware → double-versement franchise ; `REFUNDS_ENABLED` reste OFF jusqu'à Phase 2.

**Suite** : le fondateur exécute la migration staging (procédure), répond « migration appliquée et vérifiée » → merge + deploy + healthcheck SHA exact + check post-deploy → seulement alors, envisager la levée du freeze → Phase 2.

---

## PHASE 2..6 — à ouvrir séquentiellement après déblocage Phase 1

*(Chaque phase : faits · décisions · fichiers · commits · tests · contrôles négatifs · risques ouverts · état de fusion — remplis à sa clôture. Correctifs par phase pré-listés dans l'inventaire §8.)*

---

## POLITIQUES FONDATEUR EN ATTENTE (bloquantes potentielles)

- **Fidélité au remboursement** : les points GAGNÉS sont-ils repris au refund ? (comportement actuel = conservés — à confirmer/changer ; probable BLOCAGE Phase 1).
- **Sur place / réservation** : hors bêta fermée (arbitré) — réintroduction = train dédié plus tard.
- **Claims** : `CLAIMS_ENABLED` reste FALSE jusqu'à Phase 4 + inspection fondateur staging.

---

## ACCÈS & OUTILLAGE (pour reprise)

- Rail refund admin : `POST /api/admin/refunds/run {orderId, amountCents?}` — session admin **ou** header `X-Internal-Token = INTERNAL_CRON_TOKEN`. `POST /api/orders/[id]/refund` — session role `admin` uniquement. **`INTERNAL_CRON_TOKEN` de staging non détenu par l'agent** (le `CRON_SECRET` local ≠ ce token — sonde 401). Un compte Operator `admin` staging ou le token est requis pour exécuter le scénario ⑥.
- Commande payée de répétition : `cmtj52ewh000320fboagbze1x` (PI `pi_***xQDiB9` succeeded 14,50 €, fee 116, destination `acct_***byyYMY`, charge `ch_***Y41DeO`).
- Stripe TEST lisible localement (clé `sk_test` en `.env.local`) — lecture seule.
- Base staging **non joignable** directement (SSH 22 filtré) ; champs DB-only via `node scripts/server/rehearsal-verify.js <sub>` en cPanel Terminal.
