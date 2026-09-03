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
- ✅ **Item L — compatibilité code + schéma + client** : chaîne de preuves (1) le client régénéré sur disque porte les 3 champs (opérateur, côté serveur) ; (2) le FTP exclut `node_modules/**` (symlink nodevenv) → le client régénéré **persiste** à tout déploiement ultérieur ; (3) recyclage du processus observé (Passenger `restart.txt` + déploiement docs suivant : nouveau build servi ⇒ nouveau processus qui charge `.prisma/client` depuis le disque) ; (4) lectures DB réelles servies par ce processus via ce client (un client mal généré / mauvais binaryTarget = 500 sur toute route DB). **Limite dite explicitement** : aucune route read-only ne SELECT les nouveaux champs sans session staging (non détenue, non demandée) → l'exercice runtime champ-par-champ est le **premier test Phase 2** (webhook `charge.refunded`, Stripe TEST). L = **PASS** sur cette chaîne, pas sur la seule sortie de génération.
- ✅ **Données existantes** : baseline migration préservée côté serveur (order 66 · loyaltyTransaction 21 · loyaltyCustomer 4 · refund 3 · ledgerEntry 72 · Σpoints 370 ; offset = 0 partout) ; **aucun chemin de mutation fidélité au déploiement/restart** (aucun hook de migration, 0 cron fidélité dans `scripts/cron`, `server.js` sans effet de bord). Lectures `Order` / `LoyaltyCustomer` par API exigent une session (401) → non exercées ici, prouvées côté serveur par l'opérateur de migration.
- ✅ **Stripe TEST / gel** : 0 refund sur les 6 dernières heures, dernier refund du compte TEST = 29/08 (Z1 `re_…WF7p`, 14,50 €) → **aucun refund initié pendant la clôture**, `REFUNDS_ENABLED=FALSE`, freeze ACTIF, `refund = 3` inchangé.
- **PHASE 1 OPÉRATIONNELLE = COMPLÈTE.** SHA final déployé = ce commit de clôture sur develop (vérifié `/version.json` ×2 domaines dans le rapport Notion de clôture) ; code Phase 1 = `e244275`, opérateur regen = `90472db`.

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
