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
| **1** | Modèle financier fidélité (sûr sous refund) | **OPÉRATIONNELLEMENT COMPLET** ✅ (migré + mergé `e244275` + déployé) | `a1/loyalty-refund` → develop | `LOYALTY-REFUND-CONTRACT.md` ✅ · `PHASE-2-HANDOFF.md` ✅ |
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

## PHASE 1 — MODÈLE FINANCIER FIDÉLITÉ — **OPÉRATIONNELLEMENT COMPLET** ✅

Décisions fondateur reçues et LOCKÉES (D1 reversal earned prorata, D2 restore spent prorata, D3 offset interne, funding GRUBANO, cash-cap ≤ Stripe). Implémenté sur `a1/loyalty-refund` (worktree isolé), banké, **non mergé** (le merge suit la migration staging exécutée par le fondateur, gate order).

**Faits** :
- Cash-cap **structurel** (order.total = charge.amount) → Phase 1 = points-only. Prorata sur `charge.amount` (jamais foodTotal). Modèle cible-cumulatif télescopant comme `computeRefundSplit`.
- Idempotence = `LoyaltyTransaction.sourceEventId` (re_… Stripe) + `@@unique([sourceEventId,type])` ; `@@unique([orderId,type])` REJETÉ. Schéma **purement additif** ; **rehearsal local disposable PASS** (no --accept-data-loss, no dedup, multi-NULL, zéro drift).
- Webhook `charge.refunded` = point UNIQUE de reconciliation, NON gaté (reconcilie la vérité Stripe quelle que soit l'origine) ; `executeRefund` ne touche pas la fidélité (un seul propriétaire).
- **Revue adversariale (E financier / F migration)** : 4 défauts corrigés — grandfather des commandes legacy-remboursées, `FOR UPDATE` + deltas relatifs (concurrence), guard earn-sur-commande-remboursée, waiver key scopée client. E confirme : points-only, funding, arrondi cumulatif, replay tiennent.

**Livrables** : `LOYALTY-REFUND-CONTRACT.md` (23 §), `prisma/manual-migrations/phase1-loyalty-refund.sql` (artefact reviewable), `PHASE1-STAGING-PROCEDURE.md` (backup+migrate+verify+rollback fondateur, 0 secret).

**Gates** : suites Phase 1 (math 25 + apply 8 + waiver 5) + full vitest + cold build — verts (voir verdict). tsc baseline 37 (0 erreur produit Phase 1). `main`/prod/Stripe LIVE jamais touchés ; **freeze remboursement staging ACTIF**.

**Blocage Phase 2 enregistré** (non touché) : `orders/[id]/refund` non royalty-aware → double-versement franchise ; `REFUNDS_ENABLED` reste OFF jusqu'à Phase 2.

**OPÉRATION STAGING — méthode établie (addendum « remote execution discovery ») :**
- **Transport de déploiement réel = FTPS** (GitHub Actions, `SamKirkland/FTP-Deploy-Action`, `deploy-temp/` → `/app.grubano.com/`). Le payload shippe `scripts/server/*.js` **automatiquement** — mais **pas les `.sh`** ni `prisma/manual-migrations/*.sql` (exclus explicitement, `deploy-staging.yml:117-130`).
- **Shell distant depuis l'environnement Claude = NON PROUVÉ** : SSH direct vers `109.234.165.222:22` → timeout (testé IP + hostname). L'`appleboy/ssh-action` du runner GHA existe mais est `continue-on-error` et documentée comme **intermittemment firewallée** — pas fiable pour porter une migration financière. → **Pas d'exécution directe par Claude** (aucun accès inventé).
- **Méthode retenue = ONE-SHOT FOUNDER EXECUTION** : `scripts/server/phase1-staging-migrate.js` (`.js` → shippé auto), **fail-closed, idempotent, 0 secret**, décide PASS/FAIL seul. Shippé sur develop `49cea68` (merge ops-only `a1/phase1-migrate-operator`, aucun code applicatif). **Testé en répétition locale** : PASS end-to-end (doublons `orderId,type` survivent = multi-NULL), 2ᵉ run `ALREADY_APPLIED_AND_VERIFIED`, **6 contrôles négatifs FAIL fermés** (base prod, URL prod, tables absentes, dump 0-INSERT, état partiel `PARTIAL`, mysqldump cassé `DATABASE CHANGED: NO`).
- **Commande unique fondateur** (cPanel Terminal) : `~/nodevenv/app.grubano.com/24/bin/node ~/app.grubano.com/scripts/server/phase1-staging-migrate.js` → coller le bloc PASS/FAIL dans le chat. Doc : `docs/ops/PHASE1-STAGING-ONE-COMMAND.md`.

**CLÔTURE STAGING PHASE 1 — preuves (2026-09-03) :**
- **Migration staging = PASS** (opérateur one-shot, exécuté par le fondateur en UNE commande, sortie authoritative) : backup **VÉRIFIÉ** `staging-pre-phase1-2026-09-03-13-21-22.sql.gz` (63.2 KB, 44 INSERTs, « Dump completed », gzip OK) dans `~/grubano-backups/`, 30/08 préservé. **Baseline** capturée et **conservée** après migration : order=66 · loyaltyTransaction=21 · loyaltyCustomer=4 · refund=3 · ledgerEntry=72 · Σpoints=370. Migration appliquée : `+sourceEventId +actorId +recoveryOffsetPoints +LoyaltyTransaction_sourceEventId_type_key`. Intégrité post-migration PASS.
- **Vérification indépendante pré-merge (limites honnêtes)** : pas de canal DB/shell depuis l'environnement Claude → la vérification colonnes/index/counts est celle exécutée **sur le serveur** par l'opérateur fail-closed ; en plus, prouvé à distance : l'app pré-Phase-1 (`49cea68`) lit la base migrée (public `/api/restaurants` 200, fiche rehearsal charge name+1 item, `/fr/eat` 200 = compatibilité additive live) et **Stripe TEST : 0 refund** sur le PI rehearsal (freeze intact, aucun refund initié).
- **Merge** : `a1/loyalty-refund` → develop = **`e244275`** (merge-tree propre sur `49cea68`, les 7 commits `7d4344b 013a089 83a7384 446e750 22f4cd5 f585fe3 4f0dd87` prouvés ancêtres). `main` intouché.
- **Gates frais sur l'arbre mergé / déploiement / SHA / healthcheck / intégrité post-deploy** : voir le bloc « CLÔTURE — RÉSULTATS DÉPLOIEMENT » ci-dessous (rempli à la fin de l'opération).
- **Gel remboursement : ACTIF. `REFUNDS_ENABLED=FALSE`.** Le PASS migration n'autorise aucun refund. Blocage Phase 2 (double-versement franchise `orders/[id]/refund`) reste à fermer avant toute activation.

**Suite** : Phase 2 = **session dédiée** (`docs/ops/PHASE-2-HANDOFF.md` + prompt copy-paste). Ne pas démarrer Phase 2 dans cette session (capacité déclarée NON).

---

## PHASE 2..6 — à ouvrir séquentiellement après déblocage Phase 1

*(Chaque phase : faits · décisions · fichiers · commits · tests · contrôles négatifs · risques ouverts · état de fusion — remplis à sa clôture. Correctifs par phase pré-listés dans l'inventaire §8.)*

---

## FEUILLE DE ROUTE LONGUE (authoritative — préserver)

Phase 2 rail refund/royalty (session fraîche) → Phase 3 Claims domaine/sécurité/admin → Phase 4 Claims UX conso (+ porte Claude Design) → Phase 5 nettoyage produit (état terminal retrait, réf canonique `GR-XXXXXX`, CTA mobile dupliqué, français formel, véracité bornée) → Phase 6 hooks légaux techniques (faits formation contrat, preuve d'acceptation CGV, audit cookies — aucun texte légal inventé) → **RÉPÉTITION HUMAINE STAGING FINALE** → **CLEAN ROOM** → **INVENTAIRE FACTUEL EMAILS + TRAIN DESIGN EMAILS** → FONDATION LÉGALE → OPÉRATEUR LÉGAL GRUBANO → Stripe plateforme/Connect/webhook LIVE → LIVE SMOKE → PRODUCTION.

### 🔴 Chantier EMAILS — exigence enregistrée, NE PAS OUBLIER, NE PAS DÉMARRER MAINTENANT
Claude Design a **arrêté** la refonte emails faute de faits et a demandé un pack factuel. Il ne démarre **qu'après** stabilisation du comportement bêta qui génère les notifications (Claims/Refunds encore mouvants). Claude Code (jamais le fondateur) produit `EMAIL-FACTUAL-PACK/` : `EMAIL-MANIFEST.md`, `EMAIL-TRIGGER-MAP.md`, `EMAIL-COPY-VERBATIM.md`, `EMAIL-DATA-CONTRACTS.md`, `EMAIL-INFRASTRUCTURE.md`, `EMAIL-AUTH-FACTS.md`, `EMAIL-CLAIMS-REFUNDS-FACTS.md`, `EMAIL-CURRENT-VISUALS.md`, `CLAUDE-DESIGN-EMAIL-HANDOFF.md`. Taxonomie obligatoire par candidat : **A** LIVE_CODE_CONFIRMED_SEND / **B** CODE_EXISTS_NOT_SEND_PROVEN / **C** CURRENT_BETA_TRAIN_CONFIRMED / **D** DEAD_OR_ORPHANED / **E** NOT_CONFIRMED — un template n'est pas « réel » parce qu'un fichier existe : le chemin d'envoi atteignable doit être prouvé. Familles : AUTH/COMPTE, COMMANDE CONSO, PARTENAIRE, CLAIMS/SAV, REMBOURSEMENTS, SÉCURITÉ/ALLERGÈNE, ADMIN — transactionnel/opérationnel uniquement (0 newsletter/marketing). Puis Claude Design bâtit le système d'emails Grubano (email-safe 600–640 px, tables, CSS inline, images-off, ZEST/INK/BASIL, langage de statut jamais couleur seule, `GR-XXXXXX` cohérent, Claim ≠ Refund, jamais « remboursement effectué » avant succès Stripe, alerte allergène prioritaire sans ton marketing) → **porte fondateur** sur `email-gallery.html` → implémentation seulement après PASS visuel.

### Politique d'intervention fondateur (jusqu'à la clôture bêta)
Claude Code possède : investigation repo, code, tests, scripts DB, automatisation de migration, deploy, healthchecks, vérification technique/financière/sécurité, inventaire emails, handoffs. Le fondateur possède **uniquement** : décisions de politique produit, approbation visuelle Claude Design, décisions légales/business, répétition humaine réelle, actions compte/KYC externes. Toute action fondateur inévitable = expliquer exactement pourquoi, la réduire à l'action minimale, jamais en faire un opérateur technique.

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
