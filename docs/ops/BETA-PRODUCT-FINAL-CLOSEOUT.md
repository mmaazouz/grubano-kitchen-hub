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
| **1** | Modèle financier fidélité (sûr sous refund) | **COMPLET** ✅ (migré + mergé `e244275` + déployé + client Prisma régénéré + runtime prouvé, 2026-09-03) | `a1/loyalty-refund` → develop | `LOYALTY-REFUND-CONTRACT.md` ✅ · `PHASE-2-HANDOFF.md` ✅ |
| **2** | Rail financier de remboursement / royalty | **IMPLÉMENTÉ + GATES PASS** ✅ (contrat critiqué 4 rounds → PASS ; revues financière + sécurité indépendantes PASS ; fusion/déploiement : voir bloc « CLÔTURE PHASE 2 ») — `REFUNDS_ENABLED` reste **FALSE** (décision fondateur, readiness §13) | `a1/refund-rail` → develop | `REFUND-FINANCIAL-CONTRACT.md` ✅ |
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

## PHASE 1 — MODÈLE FINANCIER FIDÉLITÉ — **COMPLET** ✅ (clôturé 2026-09-03)

Décisions fondateur reçues et LOCKÉES (D1 reversal earned prorata, D2 restore spent prorata, D3 offset interne, funding GRUBANO, cash-cap ≤ Stripe). Implémenté sur `a1/loyalty-refund` (worktree isolé), banké, puis **mergé `e244275`** après la migration staging (gate order respecté).

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

**CLÔTURE — RÉSULTATS DÉPLOIEMENT (2026-09-03) :**
- Gates frais sur l'arbre mergé `e244275` : ciblés 38/38 · full vitest 365 fichiers / 3569 tests PASS (exit 0) · build à froid exit 0 (705/705) · tsc **0 erreur produit** (38 au total, toutes en `tests/` ; +1 vs baseline = annotation du fake Prisma dans `tests/loyalty-refund-apply.test.ts`, non bloquant).
- Docs clôture mergées (`6545489`, **diff code vide** vs `e244275` — code déployé byte-identique à l'arbre gaté). Push → CI **success** → **app.grubano.com = business.grubano.com = `6545489`** (SHA MATCH). Healthchecks PASS : `/version.json`, `/fr/eat`, `/api/restaurants`, fiche rehearsal (lecture DB réelle), `/fr/menu` 307 (auth), `/fr/eat/auth`, business. Webhook `charge.refunded` **vivant** (POST non signé → 400, zéro effet). Code Phase 1 **présent au SHA déployé** (import + appel `reconcileLoyaltyOnRefund`, schéma `sourceEventId`/`recoveryOffsetPoints`/`@@unique`, `FOR UPDATE` ×2, guard earn). **Stripe TEST : 0 refund** sur le PI rehearsal, 0 refund plateforme sur 4 h → freeze intact, aucun refund initié.
- 🔴 **Constat honnête (STEP 5) — client Prisma serveur PÉRIMÉ** : le log brut de l'étape SSH post-déploiement se termine par `dial tcp 109.234.165.222:22: i/o timeout` (idem sur `49cea68`) ; l'étape est verte par `continue-on-error`, mais `npx prisma@5.22.0 generate` **n'a pas tourné** et le FTP exclut `node_modules/.prisma`. Passenger a redémarré via le fallback FTPS. → le code Phase 1 tourne contre un client qui ignore les nouveaux champs : reconciliation fidélité + crédit earn **inertes** (catch best-effort), argent intouché, lectures existantes OK. **STEP 5 = FAIL tant que le client n'est pas régénéré.** Remédiation (canal automatisé SSH prouvé indisponible 2/2) : opérateur fail-closed `scripts/server/phase1-regen-client.js` (prouvé en local : PASS réel + 3 contrôles négatifs), shippé par ce push, **UNE commande fondateur** (voir `PHASE1-STAGING-ONE-COMMAND.md` Étape 2). L'intégrité post-déploiement **L** n'est déclarée qu'après son PASS.

**CLÔTURE FINALE (2026-09-03, après la commande fondateur unique) :**
- ✅ **Régénération du client Prisma serveur — PASS** (sortie verbatim de `phase1-regen-client.js`) : `PRISMA GENERATE: OK (local CLI node_modules/prisma/build/index.js, marker present)` · `CLIENT FIELDS: VERIFIED (recoveryOffsetPoints, sourceEventId, actorId present in node_modules/.prisma/client/index.d.ts)` · `PASSENGER RESTART: TOUCHED tmp/restart.txt`. Fait utile : le CLI pinned 5.22.0 existe dans l'arbre nodevenv du serveur (route (a) de l'opérateur, pas besoin de `npx`).
- ✅ **Runtime après restart** (17:08–17:09 UTC, 3 échantillons sur 47 s) : `/version.json` 200 = `90472db` sur les DEUX domaines · `/fr/eat` 200 (421 KB, zéro marqueur d'erreur Prisma / 500) · business `/fr/login` 307 (gate auth attendu) · `/api/restaurants?take=3` 200 données réelles (« Rehearsal Beta Grubano ») · fiche `/api/restaurants/<rehearsal>` 200 (menu réel). Latences 0,13–0,41 s stables, aucune 5xx, aucune boucle de restart.
- ✅ **Item L — compatibilité code + schéma + client** : chaîne de preuves (1) le client régénéré sur disque porte les 3 champs (opérateur, côté serveur) ; (2) le FTP exclut `node_modules/**` (symlink nodevenv) → le client régénéré **persiste** à tout déploiement ultérieur ; (3) recyclage du processus : `tmp/restart.txt` touché par l'opérateur (sémantique Passenger : mtime modifié ⇒ nouveau processus à la requête suivante, qui charge `.prisma/client` depuis le disque — mécanisme identique à celui du pipeline de déploiement) ; **non observable de l'extérieur** (aucun endpoint uptime / build-id côté processus) → dit tel quel, pas « observé » ; (4) lectures DB réelles servies par ce processus via ce client (un client mal généré / mauvais binaryTarget = 500 sur toute route DB). **Limite dite explicitement** : aucune route read-only ne SELECT les nouveaux champs sans session staging (non détenue, non demandée) → l'exercice runtime champ-par-champ est le **premier test Phase 2** (webhook `charge.refunded`, Stripe TEST). L = **PASS** sur cette chaîne, pas sur la seule sortie de génération.
- ✅ **Données existantes** : baseline migration préservée côté serveur (order 66 · loyaltyTransaction 21 · loyaltyCustomer 4 · refund 3 · ledgerEntry 72 · Σpoints 370 ; offset = 0 partout) ; **aucun chemin de mutation fidélité au déploiement/restart** (aucun hook de migration, 0 cron fidélité dans `scripts/cron`, `server.js` sans effet de bord). Lectures `Order` / `LoyaltyCustomer` par API exigent une session (401) → non exercées ici, prouvées côté serveur par l'opérateur de migration.
- ✅ **Stripe TEST / gel** : 0 refund sur les 6 dernières heures, dernier refund du compte TEST = 29/08 (Z1 `re_…WF7p`, 14,50 €) → **aucun refund initié pendant la clôture**, `REFUNDS_ENABLED=FALSE`, freeze ACTIF, `refund = 3` inchangé.
- **PHASE 1 OPÉRATIONNELLE = COMPLÈTE.** SHA final déployé = ce commit de clôture sur develop (vérifié `/version.json` ×2 domaines dans le rapport Notion de clôture) ; code Phase 1 = `e244275`, opérateur regen = `90472db`.

**Suite** : Phase 2 = **session dédiée** (`docs/ops/PHASE-2-HANDOFF.md` + prompt copy-paste). Ne pas démarrer Phase 2 dans cette session (capacité déclarée NON).

---

## PHASE 2 — RAIL FINANCIER DE REMBOURSEMENT / ROYALTY — **IMPLÉMENTÉ, GATES PASS** (2026-09-04, branche `a1/refund-rail`)

**Livrable** : [`docs/ops/REFUND-FINANCIAL-CONTRACT.md`](REFUND-FINANCIAL-CONTRACT.md) (18 §) — Phase 0 read-only (lead + 2 agents forensiques : sémantique Stripe sur docs officiels, interplay repo `file:ligne`) + **critique adversarial en 4 rounds** (INCOMPLETE ×3 → **PASS**, 1 P0 + 15 P1 de conception fermés AVANT toute ligne de code) → implémentation (propriétaire unique, worktree isolé) → **revue financière indépendante PASS** (0 P0/P1, 8 P2 dont 6 implémentés) + **revue sécurité indépendante PASS** (0 P0/P1, 3 P2 implémentés).

**Le P0 (double-versement franchise) avait DEUX portes, fermées toutes deux** :
- Porte A `POST /api/orders/[id]/refund` → passait par `lib/refunds.ts` (royalty-UNAWARE) → désormais **UN SEUL moteur sur le chemin commande** : `lib/refund.executeRefund` (D-A). `lib/refunds.ts` ne sert plus qu'aux tickets/empreintes (pas de ligne `Order`, pas de royalty possible). Contrôle négatif : le rail A n'est JAMAIS appelé depuis la route commande.
- Porte W (webhook `charge.refunded`, NON gaté = remboursement Dashboard) → ne touchait pas `FranchiseRoyalty.refundedCents` → désormais **point unique de réconciliation royalty** (D-B) : cible cumulative `royCum(Σ remboursements SUCCEEDED)` (jamais `amount_refunded`), monotone, cross-rail (lignes Refund ∨ cible Stripe + litiges), identité télescopique ⇒ même cible qu'un remboursement moteur → jamais double, jamais sous-compté. **Aucun mouvement d'argent depuis le webhook** ; royalty déjà réglée + remboursement EXTERNE → alerte MONEY REVIEW (reprise humaine).
- Preuve numérique (revue financière) : T=5000/F=900/R=300, externe 2500 puis moteur 2500 (et l'inverse) → `refundedCents = 300`, settlement paie 0, cas réglé : 150 clawback moteur + 150 flaggé humain = R.

**Autres décisions (contrat §6–§8, §15–§17)** :
- **Vérité de statut (§8)** : ligne `Refund` `succeeded`, ligne ledger et email « effectué » **uniquement si Stripe `status === 'succeeded'`** ; `pending` → variante NON-ok 202 (routes : 202 `{status:'pending'}` + audit `pending:true`, pas d'email ; claims : reste `refunding` ; ghost → `reconcile_manual`) ; `failed/canceled` → ligne `failed`, curseur libéré, **verrou fail-closed permanent** (Stripe ne restaure pas le transfert inversé → un retry aveugle débiterait le resto deux fois), MONEY REVIEW. Oracle = `refund.updated`/`refund.failed` (nouvelle branche webhook, re-joue la réconciliation complète puis finalise la ligne, adopt-only) + RESUME-FIRST.
- **Ledger = vérité Stripe** : règle d'attribution unique `lib/refund-fee-truth.ts` (webhook + ligne eager du moteur) ; ambiguïté ou prédiction → MONEY REVIEW ; le moteur SAUTE sa ligne eager plutôt que figer un centime prédit.
- **Clawback royalty (D-H v2)** plafonné sur l'argent **réellement récupéré** (`lib/royalty-recovered.ts`), jamais sur `refundedCents` (une course webhook l'aurait mis à 0) ; adoption d'une reversal déjà taguée (>24 h) ; liste indisponible en reprise → 502 fail-closed, jamais de création.
- **Fee Stripe (D-D)** : jamais restitué par Stripe (FACT docs) → mouvement zéro, coût irrécouvrable Grubano, explicité dans `computeRefundExposure`. **Pourboire (D-E, défaut fondateur-modifiable)** : partiel → le livreur garde tout, Grubano absorbe la tranche rendue ; total → clawback des tips non payés (prédicat sur Σ succeeded) ; garde d'accrual : jamais de tip sur une commande intégralement remboursée (ledger, fail-closed `ledger_unknown`).
- **Identité de conservation tripartite (§7)** : `client + resto + Grubano + franchiseur + livreur + Stripe = 0` à chaque événement et en cumul, STANDARD/FRANCHISE/livreur-B × 5 séquences à centimes impairs ; contrôles négatifs réels (split arrondi par plancher passe la tautologie mais casse Σfee=F / Σroyalty=R / resto=T−F).
- **Settlement (D-G v2)** : pas de re-plan du montant (clé d'idempotence partagée = seul garde-fou anti-double sous concurrence, `Payout` sans `updatedAt` → pas de mutex sûr sans schéma) → **détection** post-transfert + branches d'adoption (sur-versement → alerte au centime) ; `amount_mismatch` → `amount_drift` + alerte (jamais silencieux). Résiduel enregistré : fenêtre ~1 s claim→transfer détectée, non auto-corrigée.
- En-têtes « UNGATED / REJECTED » stale corrigés (`lib/refund.ts`, `lib/refunds.ts`).

**Fichiers** : `lib/refund.ts` (réécrit), `lib/refunds.ts` (en-tête), `lib/royalty-refunded.ts` (+`stripeTargetCents`), **new** `lib/royalty-recovered.ts`, `lib/refund-fee-truth.ts`, `lib/refund-exposure.ts` ; `lib/admin-alerts.ts` (+`sendAdminMoneyReviewAlert`, `escHtml` `'`), `lib/franchise-settlement.ts`, `lib/courier-accrual.ts`, `lib/claims.ts` ; `app/api/webhooks/stripe/route.ts`, `app/api/orders/[id]/refund/route.ts`, `app/api/admin/refunds/run/route.ts`. **Aucun changement de schéma.** `REFUNDS_ENABLED` jamais touché.

**Tests** : +3 suites nouvelles (`refund-conservation` 21, `refund-fee-truth` 8, `webhook-refund-reconciliation` 23 — première couverture comportementale de `handleChargeRefunded`, Phase 0 en avait trouvé ZÉRO) ; suites étendues `refund-engine` 36, `order-refund` 22, `franchise-settlement-refund` 8, `courier-tip` 14, `refunds-run-route` +2, `claims` +1, `p5-refund-humain` réécrit sur le vrai moteur. Flips attendus tous inventoriés au contrat (§11) et re-photographiés.

**Limites dites** : matrice prouvée au harnais (Stripe/DB mockés) — **aucun refund Stripe TEST déclenché** (freeze respecté, Stripe TEST : 0 refund 24 h / total 14 inchangé au début ET à la fin de session) ; la répétition humaine sur la commande jetable est l'exercice live. Résiduels enregistrés (contrat §18) : F2 phantom fee sur refund externe sans `refund_application_fee` (ledger seul, surfacé), F5 `ledger_unknown` sur commandes pré-ledger, F8 reprise moteur crée sur liste vide disponible (correct), fenêtre D-G, clawback royalty réglée sur refund externe = humain.

**CLÔTURE PHASE 2 — RÉSULTATS (2026-09-04) :**
- **Gates frais sur l'arbre final** : ciblés (engine 36 · webhook 23 · route 22 · conservation 21 · fee-truth 8 · settlement-refund 8 · tip 14 · admin-run 15 · claims 23) verts · **full vitest 368 fichiers / 3658 PASS exit 0** · **build froid exit 0** · **tsc 38 = baseline** (toutes en `tests/`, 0 produit) · `git merge-tree` develop ↔ `a1/refund-rail` = PROPRE · **fusion fast-forward `4ce8f53`** (base `f0e3c2b`, origin/develop non déplacé) · push.
- **Déploiement** : CI `33843324524` **success** (06:39 UTC) → `/version.json` = **`4ce8f53` sur app.grubano.com ET business.grubano.com** (SHA MATCH). Healthchecks : `/fr/eat` 200 · `/fr/eat/auth` 200 · `/api/restaurants?take=1` 200 (lecture DB réelle, « Rehearsal Beta Grubano ») · business `/fr/login` 307 · webhook `POST /api/webhooks/stripe` non signé → 400 (vivant, 0 effet). 2 échantillons (chaud : 0,13–0,43 s), aucune 5xx.
- **Étape SSH post-déploiement : ENCORE `dial tcp 109.234.165.222:22: i/o timeout`** (5/5 déploiements ; le bloquant infra pré-prod n° 1 reste enregistré). **Sans conséquence ici : aucun changement de `prisma/schema.prisma`**, le client Prisma régénéré en Phase 1 persiste (FTP exclut `node_modules/**`), recyclage Passenger par le fallback FTPS (sémantique, non observable — `/version.json` prouve que le nouveau build est servi).
- **Stripe TEST (lecture seule, début ET fin)** : 0 refund sur 24 h, total compte = 14 (inchangé), 0 refund sur la commande de répétition → **freeze intact, aucun refund déclenché** ; `REFUNDS_ENABLED=FALSE` ; aucune mutation de données staging (harnais mocké, pas de session staging).
- **PHASE 2 = PASS (code + gates + déploiement).** `REFUNDS_ENABLED` readiness = **décision fondateur** (liste ci-dessous) ; Phase 3 NON démarrée (capacité déclarée NON).

**READINESS `REFUNDS_ENABLED` (décision fondateur, jamais flippé par l'agent)** — contrat §13 + A13 + B8 : (1) **REQUIS** : abonner `refund.updated` + `refund.failed` sur l'endpoint Stripe TEST `we_…7ueK` (Dashboard → Webhooks → endpoint → événements) AVANT toute répétition Dashboard (porte W) ; (2) `ALERT_EMAIL` posé sur staging + alerte de test reçue ; (3) `GHOST_ORDER_AUTO_REFUND_ENABLED` et `CLAIMS_AUTO_APPROVE_ENABLED` restent OFF ; (4) décision D-E (livreur garde le tip sur partiel) ; (5) settlement franchise = `workflow_dispatch` seulement sur staging (cron `main`, mensuel) ; (6) `ledger-check` manuel après chaque refund de répétition (cron `main` seulement) ; (7) solde disponible du compte Connect TEST du resto ≥ `reverse_transfer` de la répétition (sinon la requête de refund échoue, fail-safe) ; (8) actions humaines jamais automatisées : clawback royalty réglée sur refund externe, sur-versement settlement détecté, re-transfert après refund `failed`.

**PRÉFLIGHT OPÉRATIONNEL PHASE 2 (2026-09-04, session dédiée — aucun refund, `REFUNDS_ENABLED=FALSE`, freeze ACTIF) :**
- **Résiduels P2 (revue financière indépendante) = NON-BLOQUANTS ×2.** F2 « phantom fee » : refund Dashboard EXTERNE émis SANS `refund_application_fee` → la ligne ledger du webhook attribue une commission rendue prédite (`round(F·a/T)`) alors que Stripe n'en a rendu aucune — **enregistrement ledger seul** (aucun solde Stripe faux, client/resto/Grubano intacts en argent), auto-signalé `[MONEY REVIEW] [fee_attribution_prorata]`, correction = un ajustement ledger ; conséquence royalty seulement si FRANCHISE (OFF). F8 « reprise crée sur liste vide disponible » : le chemin de reprise moteur (`driveRefund`, ligne `pending` sans `stripeRefundId`, liste Stripe DISPONIBLE mais sans refund tagué) crée le refund prévu sous la clé du curseur — correct pour le seul déclencheur réaliste (envoi perdu) ; un double exigerait une liste Stripe omettant un refund existant > 24 h + un partiel avec marge + aucun retry < 24 h (plafond Stripe du remboursable borne l'exposition) ; le chemin webhook est adopt-only. Verdict : `RESIDUALS VERDICT: NON-BLOCKING`.
- **Webhook Stripe TEST `we_…7ueK`** : `refund.updated` + `refund.failed` **ABONNÉS par l'API** (Claude Code, aucun accès inventé : clé `sk_test` du `.env.local` local), événements existants conservés, relu depuis Stripe, `livemode=false`. Endpoint `we_…tpvK` (`account.updated`) inchangé.
- **Contrôle négatif webhook (suite réelle `tests/webhook-refund-signature.test.ts`, signature Stripe RÉELLE via `generateTestHeaderString`/`constructEvent`, 10/10)** : non signé / mauvais secret / payload altéré → 400 AVANT tout handler ; `refund.failed` routé → ligne `failed` + verrou + alerte, **livraison dupliquée idempotente** (1 transition, 1 clé de dédup) ; `refund.updated` succeeded routé → réconciliation complète (ledger vérité Stripe, fidélité), **doublon → 1 seule ligne ledger** ; refund inconnu → fail-safe (503 retry / alerte seule). Aucune mutation staging.
- **Politique pourboire partiel** (D-E, livreur garde tout) : caractérisée par `tests/courier-tip.test.ts` « PARTIAL refund → the courier keeps the whole tip » et `tests/webhook-refund-reconciliation.test.ts` « PARTIAL 2500 → tip NOT clawed » + contrôle négatif A2 (l'ancien prédicat aurait clawé) — PASS ; DELIVERY hors bêta (latent, non régressé).
- **Franchise (faits repo)** : `FRANCHISE_ENABLED` gate **toutes** les routes `/api/franchise/*` (404 première ligne) et la settlement ; l'accrual royalty exige `FRANCHISE_ROYALTY_ENABLED` au `/pay` ; le compte `franchise@grubano.com` a été neutralisé → **une commande franchisée neuve = flag BETA-OUT** → **CAN TEST FRANCHISE WITHOUT BETA-OUT FLAG = NO** (sous réserve du comptage serveur : royalties/POS/commandes-POS existants, lu par l'opérateur). Répétition humaine franchise = **DEFERRED — BETA-OUT** ; le P0 franchise reste prouvé par la matrice automatisée (engine 36, webhook 23, conservation 21, revue financière traces T=5000/F=900/R=300).
- **GR-N5TSM0 (Stripe TEST, lecture seule, id `cmtju919h0001h7t6bkn5tsm0`)** : PI `pi_3UB9bPK…` **succeeded**, `amount = amount_received = 1410` (14,10 €), `application_fee_amount = 76`, `transfer_data` + `on_behalf_of` (routé), canal **pickup**, restaurant « Rehearsal Beta Grubano » (standard), **0 refund, 0 fee refund** ; frais Stripe réels 69 c ; transfert 1410 réversible 1410. Fee 76 = 8 % × 14,50 (116) − crédit fidélité 40 c ⇒ **subtotal 14,50 € / crédit 0,40 € (8 pts) / cash 14,10 € cohérents** avec les faits fondateur (les champs DB sont confirmés par l'opérateur). Candidat scénario 2 (STANDARD FULL) : **GR-BZE1X** `pi_3UAyauK…` succeeded 1450, fee 116, pickup, 0 refund.
- **🔴 Porte calendrier (règle Stripe documentée)** : « il est possible d'annuler un transfert uniquement si le solde **disponible** du compte connecté est supérieur au montant de l'annulation » et « si la demande de remboursement inclut une annulation de transfert mais que le compte connecté dispose d'un solde insuffisant, la demande de remboursement renvoie une **erreur** ». Compte Connect TEST du resto de répétition (`acct_…byyYMY`, Express FR, créé 2026-08-30) : **disponible 0 €**, en attente 13,34 € (dispo **2026-09-08**) + 13,34 € (dispo **2026-09-09**), `delay_days 7`. Le calendrier de virements `daily` aurait balayé ces fonds vers la banque test dès disponibilité → **passé à `manual` par l'API (config TEST, aucun argent, réversible)**. ⇒ **Première répétition possible : 2026-09-08** (partiel ≤ 13,34 €), TOTAL GR-BZE1X (14,50 €) à partir du **2026-09-09**. Aucun top-up plateforme→resto (mouvement d'argent TEST) sans décision fondateur explicite.
- **Premier scénario (OPTION B — GR-N5TSM0, financement MIXTE cash + fidélité, PARTIEL)** — calculé avec le code réel (`computeRefundSplit`, `loyaltyPointsCumulative`, `computeRefundExposure`) pour un geste commercial de **5,00 €** (commande à une ligne : pas de partiel article ; 5 € exerce l'arrondi sur fee/points) : cash rendu 500 c (≤ 1410 capturés, ≠ 0,40 € fidélité jamais rendu en cash) ; fee refund **27 c** ; reverse restaurant **473 c** ; royalty **0** (standard) ; points dépensés restaurés **3 sur 8** (`round(8×500/1410)`) ; points gagnés repris **5 sur 14 si** une ligne `earn` existe (crédit au `delivered` seulement — l'opérateur dit si elle existe ; sinon 0, jamais de négatif fantôme) ; résidu de conservation **0** ; ledger attendu : ligne `refund` gross −500 / fee −27 / net −473 (fee = vérité Stripe) ; Stripe : refund 500 depuis la plateforme, `transfer_reversal` 500 brut, `fee_refund` 27 crédité au compte connecté ⇒ net connecté −473 ; `Refund` row `succeeded` uniquement si Stripe `succeeded` ; `LoyaltyTransaction` `refund:+3` (et `earn_reversal:−5` le cas échéant) keyées `re_…` ; email « effectué » après succès Stripe seulement. Alternatives chiffrées : 7,05 € (50 %) → fee 38 / resto 667 / spent 4 / earned 7 ; total 14,10 € → 76 / 1334 / 8 / 14.
- **Jobs staging** : ledger-check = route lecture seule appelée par l'opérateur avec le token de l'env (jamais `main`, jamais le token au fondateur) ; settlement franchise = route gatée `FRANCHISE_SETTLEMENT_ENABLED` (OFF) → **non requise** pour les scénarios standard, chemin établi (même mécanique token) si un jour une royalty existe. **Aucun code `main` exécuté contre staging.** Aucun changement `prisma/schema.prisma`.
- **Opérateur one-shot `scripts/server/phase2-preflight.js`** (shippé par `a4dcee9`) : env + marqueur de build Phase 2 + flags effectifs (FAIL si un flag argent = true) + `ALERT_EMAIL=admin-qa@grubano.com` (seule écriture, backup, idempotent) + e-mail de TEST via SMTP de l'app + faits DB GR-N5TSM0 + faits franchise + ledger-check + restart si env changé. Contrôles négatifs locaux : 5 FAIL fermés + idempotence prouvée. **Résultat serveur : voir bloc ci-dessous (rempli après la commande fondateur unique).**

---

## PHASE 3..6 — à ouvrir séquentiellement après clôture Phase 2

*(Chaque phase : faits · décisions · fichiers · commits · tests · contrôles négatifs · risques ouverts · état de fusion — remplis à sa clôture. Correctifs par phase pré-listés dans l'inventaire §8.)*

---

## FEUILLE DE ROUTE LONGUE (authoritative — préserver)

Phase 2 rail refund/royalty (session fraîche) → Phase 3 Claims domaine/sécurité/admin → Phase 4 Claims UX conso (+ porte Claude Design) → Phase 5 nettoyage produit (état terminal retrait, réf canonique `GR-XXXXXX`, CTA mobile dupliqué, français formel, véracité bornée) → Phase 6 hooks légaux techniques (faits formation contrat, preuve d'acceptation CGV, audit cookies — aucun texte légal inventé) → **RÉPÉTITION HUMAINE STAGING FINALE** → **CLEAN ROOM** → **INVENTAIRE FACTUEL EMAILS + TRAIN DESIGN EMAILS** → FONDATION LÉGALE → OPÉRATEUR LÉGAL GRUBANO → Stripe plateforme/Connect/webhook LIVE → LIVE SMOKE → PRODUCTION.

### 🔴 Chantier EMAILS — exigence enregistrée, NE PAS OUBLIER, NE PAS DÉMARRER MAINTENANT
Claude Design a **arrêté** la refonte emails faute de faits et a demandé un pack factuel. Il ne démarre **qu'après** stabilisation du comportement bêta qui génère les notifications (Claims/Refunds encore mouvants). Claude Code (jamais le fondateur) produit `EMAIL-FACTUAL-PACK/` : `EMAIL-MANIFEST.md`, `EMAIL-TRIGGER-MAP.md`, `EMAIL-COPY-VERBATIM.md`, `EMAIL-DATA-CONTRACTS.md`, `EMAIL-INFRASTRUCTURE.md`, `EMAIL-AUTH-FACTS.md`, `EMAIL-CLAIMS-REFUNDS-FACTS.md`, `EMAIL-CURRENT-VISUALS.md`, `CLAUDE-DESIGN-EMAIL-HANDOFF.md`. Taxonomie obligatoire par candidat : **A** LIVE_CODE_CONFIRMED_SEND / **B** CODE_EXISTS_NOT_SEND_PROVEN / **C** CURRENT_BETA_TRAIN_CONFIRMED / **D** DEAD_OR_ORPHANED / **E** NOT_CONFIRMED — un template n'est pas « réel » parce qu'un fichier existe : le chemin d'envoi atteignable doit être prouvé. Familles : AUTH/COMPTE, COMMANDE CONSO, PARTENAIRE, CLAIMS/SAV, REMBOURSEMENTS, SÉCURITÉ/ALLERGÈNE, ADMIN — transactionnel/opérationnel uniquement (0 newsletter/marketing). Puis Claude Design bâtit le système d'emails Grubano (email-safe 600–640 px, tables, CSS inline, images-off, ZEST/INK/BASIL, langage de statut jamais couleur seule, `GR-XXXXXX` cohérent, Claim ≠ Refund, jamais « remboursement effectué » avant succès Stripe, alerte allergène prioritaire sans ton marketing) → **porte fondateur** sur `email-gallery.html` → implémentation seulement après PASS visuel.

### Politique d'intervention fondateur (jusqu'à la clôture bêta)
Claude Code possède : investigation repo, code, tests, scripts DB, automatisation de migration, deploy, healthchecks, vérification technique/financière/sécurité, inventaire emails, handoffs. Le fondateur possède **uniquement** : décisions de politique produit, approbation visuelle Claude Design, décisions légales/business, répétition humaine réelle, actions compte/KYC externes. Toute action fondateur inévitable = expliquer exactement pourquoi, la réduire à l'action minimale, jamais en faire un opérateur technique.

## POLITIQUES FONDATEUR EN ATTENTE (bloquantes potentielles)

- ~~**Fidélité au remboursement**~~ — **TRANCHÉ** (D1/D2/D3, Phase 1 COMPLÈTE) : points gagnés repris au prorata, points dépensés restitués au prorata, offset interne + waiver admin.
- **Sur place / réservation** : hors bêta fermée (arbitré) — réintroduction = train dédié plus tard.
- **Claims** : `CLAIMS_ENABLED` reste FALSE jusqu'à Phase 4 + inspection fondateur staging.

---

## 🔴 BLOQUANTS INFRA PRÉ-PRODUCTION (enregistrés 2026-09-03 — à fermer AVANT production ; NE PAS redesigner le pipeline maintenant)

1. **Livraison déterministe du client Prisma.** Constat : le déploiement FTP ne livre ni ne régénère `node_modules/.prisma/client` (le FTP exclut `node_modules/**`, symlink nodevenv) et l'étape SSH `prisma generate` est `continue-on-error` — elle a expiré **3/3** (`49cea68`, `6545489`, `90472db`, `dial tcp 109.234.165.222:22: i/o timeout`). Staging a tourné **nouveau schéma + nouveau code + client PÉRIMÉ** jusqu'à la régénération manuelle (`phase1-regen-client.js`, 1 commande fondateur). Acceptable pour ce staging, **inacceptable comme modèle de déploiement production**. Invariant cible : révision de code exacte + schéma Prisma correspondant + client généré correspondant + migration DB contrôlée + restart Passenger + healthcheck post-déploiement — **zéro fenêtre de client périmé**. Ne PAS exécuter automatiquement les migrations de schéma à chaque déploiement ordinaire sans mission d'architecture explicite.
2. **Gestion SIGTERM** (arrêt propre Passenger/Node : requêtes en vol, transactions Prisma `FOR UPDATE`, webhooks Stripe en cours) — backlog.
3. **Compatibilité Tiger Protect / sécurité hébergeur** (filtrage SSH :22 depuis le runner GitHub = cause probable des timeouts ; WAF / rate-limit o2switch vs webhooks Stripe et crons) — backlog.

**Règle transitoire (jusqu'à la fermeture du point 1)** : après **chaque** déploiement staging qui modifie `prisma/schema.prisma`, lire le **log brut** de l'étape SSH « Post-deploy server tasks » ; si `Generated Prisma Client` n'y figure pas dans les lignes de cette étape, exécuter l'opérateur de régénération (pattern `phase1-regen-client.js`, `PHASE1_VERIFY_FIELDS=<nouveaux champs>`) **avant** de déclarer le déploiement PASS. Un job vert ne prouve rien côté serveur.

---

## ACCÈS & OUTILLAGE (pour reprise)

- Rail refund admin : `POST /api/admin/refunds/run {orderId, amountCents?}` — session admin **ou** header `X-Internal-Token = INTERNAL_CRON_TOKEN`. `POST /api/orders/[id]/refund` — session role `admin` uniquement. **`INTERNAL_CRON_TOKEN` de staging non détenu par l'agent** (le `CRON_SECRET` local ≠ ce token — sonde 401). Un compte Operator `admin` staging ou le token est requis pour exécuter le scénario ⑥.
- Commande payée de répétition : `cmtj52ewh000320fboagbze1x` (PI `pi_***xQDiB9` succeeded 14,50 €, fee 116, destination `acct_***byyYMY`, charge `ch_***Y41DeO`).
- Stripe TEST lisible localement (clé `sk_test` en `.env.local`) — lecture seule.
- Base staging **non joignable** directement (SSH 22 filtré) ; champs DB-only via `node scripts/server/rehearsal-verify.js <sub>` en cPanel Terminal.
