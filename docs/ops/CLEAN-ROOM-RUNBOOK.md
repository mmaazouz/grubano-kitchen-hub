# CLEAN ROOM — RUNBOOK D'EXÉCUTION FUTURE (préparé le 2026-09-07, NON exécuté)

> **État** : préparation READ-ONLY / DRY-RUN. **Le staging actuel NE DOIT PAS être nettoyé** : la répétition Phase 2 (remboursement) dépend de la fixture `GR-N5TSM0` (`cmtju919h0001h7t6bkn5tsm0`, pilote-client@ / pilote-resto@, « Rehearsal Beta Grubano », Connect TEST `acct_…yYMY`) et la répétition Claims n'a pas commencé. **SAFE TO EXECUTE NOW = NO.**
> **Point d'exécution** : APRÈS `PHASE 2 REFUND PASS` **ET** `CLAIMS REHEARSAL PASS` (et la répétition humaine staging finale de la feuille de route), **AVANT le premier restaurant pilote réel**.

## 0 · Artefacts existants (réutilisés, pas refaits)

| Artefact | État | Preuve |
| --- | --- | --- |
| `scripts/server/clean-room.js` (1 062 lignes) | byte-identique à son unique commit `c333968` (2026-08-30) | `git diff --stat c333968 HEAD -- scripts/server/clean-room.js` = vide |
| `docs/ops/CLEAN-ROOM-ARCHITECTURE.md` (DELETE / ARCHIVE / PRESERVE, gate ORPHANS = 0) · `docs/ops/PRE-CLEAN-ROOM-PLAN.md` (5 phases) | inchangés | — |
| `tests/clean-room-guard.test.ts` | 8 gardes fail-closed en sous-processus (DSN factice jamais connecté) | vitest |
| **Preuve 2026-08-30 « prouvé sur clone »** | cycle complet **dry-run → execute (POSTCHECK 8/8) → re-run (0 suppression)** + contre-vérification SQL indépendante, sur un **clone local MariaDB de la base Z1** (`deyi0010_grubano_cleanroom_test`) — **jamais sur le vrai staging**, jamais sur une restauration de backup staging | message du commit `c333968` ; sorties conservées (scratchpad `cleanroom-dryrun.txt` / `cleanroom-execute.txt` / `cleanroom-rerun.txt`, 2026-08-30 00:31–00:32 Z) |
| **Compatibilité schéma HEAD (`997e07a`)** | **PASS** (avec notes) : 77 modèles à `c333968` et à HEAD (diff des noms = vide) ; **un seul** commit schéma dans l'intervalle = Phase 1 additive (`013a089` : `LoyaltyCustomer.recoveryOffsetPoints`, `LoyaltyTransaction.sourceEventId`/`actorId`, `@@unique([sourceEventId,type])`) ; Phase 2 (`4ce8f53`) = **0 fichier prisma** (vérifié). Le script ne `select` aucun de ces champs (LoyaltyCustomer / LoyaltyTransaction = `count()` + `deleteMany({})` seulement) ; sa liste `MODELS` = 77 = schéma. | diff sémantique + **dry-run local du 2026-09-07** ci-dessous |
| **Dry-run local 2026-09-07 (schéma HEAD)** | **PASS** : clone jetable `deyi0010_grubano_cleanroom_dry` (copie du bac à sable QA local + `phase1-loyalty-refund.sql` + `prisma db push` flagless → « already in sync ») ; 1ʳᵉ exécution = ABORT exit 2 fail-closed (aucun admin passwordless — 0 écriture, compteurs identiques) ; après `provision-admin` sur le clone : **exit 0, PLAN complet, UNEXPECTED ORPHANS prédits = 0, 0 écriture** (compteurs = avant + 1 Operator/1 AdminAuditLog du provisioning uniquement). Ce n'est **pas** le staging réel : les verdicts pilote-* n'y sont pas exercés. | scratchpad `cleanroom-dryrun.log` / `cleanroom-dryrun2.log` |

## 1 · Ce qui DOIT survivre jusqu'à la fin des répétitions (refund + Claims)

Tant que les répétitions ne sont pas closes, **rien n'est exécuté** ; la liste ci-dessous est ce que la répétition lit/écrit et que le Clean Room toucherait :

| Entité | Rôle dans la répétition | Traitement par `clean-room.js` au jour J (après répétitions) |
| --- | --- | --- |
| `Operator` pilote-client@ / pilote-resto@ | identités de la commande payée et du restaurant | **ARCHIVE** (suspendu + password null + tokens purgés + sessions supprimées) — jamais PRESERVE (postcheck exige `REHEARSAL ACTIVE ACCOUNT = 0`) |
| `Restaurant` « Rehearsal Beta Grubano » (`acct_…yYMY`) | destination des paiements ; `LedgerEntry.restaurantId`, `Refund.restaurantId` | **ARCHIVE** (`archivedAt`, `isActive=false`, `approvedAt=null`, `stripeAccountId` **conservé**, aucun appel Stripe) |
| `Brand` / `MenuItem` / `Category` / horaires / tables du restaurant pilote | fixtures de menu et d'onboarding | **CONSERVÉS** (le script ne supprime les marques/enfants que des opérateurs DELETE et des restos DELETE) |
| `Order` `GR-N5TSM0` (+ `cmtj52ewh…` = `GR-GBZE1X` canonique, « GR-BZE1X » dans les docs) | commandes payées (PI non nul) | **PRESERVE** tel quel (aucune mise à jour) |
| `LedgerEntry` (ligne `payment` `pi_…` existante ; future ligne `refund` `re_…`) | vérité argent, append-only | **JAMAIS touché** (équation gross = fee + net vérifiée avant/après) |
| `Refund` (future ligne `refund:<orderId>:0`, 500 c, `re_…`) · `FranchiseRoyalty` · `Dispute` · `Payout` | curseur cumul / audit du split | **JAMAIS touchés** |
| `AdminAuditLog` (`refund.run`), `EmailLog` / `EmailDispatch` (`refund_confirmation`, dedupeKey `order:<id>:500`) | preuve de la décision humaine et des envois | **JAMAIS touchés** (⚠ conservent les e-mails pilote — doctrine à ratifier, §5) |
| `LoyaltyCustomer` (email = pilote-client@) · `LoyaltyTransaction` (`redeem` −8, `earn` +14 ; futures `earn_reversal` −5 / `refund` +3 clés `re_…`) | vecteur fidélité de la répétition (restore 3 / reversal 5) | **DELETE totalité** (lot 2) — d'où l'ordre : **répétition d'abord, backup, puis clean** |
| `Claim` (future répétition Claims) | une ligne par réclamation, `activeOrderKey` unique | **JAMAIS touché** par le script ; la répétition Claims exige `CLAIMS_ENABLED=true` + une **nouvelle commande payée** (fenêtre 48 h) — fixtures Claims = **PAS ENCORE REQUISES** |
| Objets Stripe TEST (`pi_…CMfy`, `ch_…HBjy`, `fee_…QdVo`, `tr_…GDCe`, futur `re_…`/`trr_…`, `acct_…yYMY`, endpoints `we_…`) | oracle de statut et curseur `amount_refunded` | **INTOUCHÉS** — `clean-room.js` n'appelle **jamais** Stripe ; politique future = idem (référence Connect gardée sur la ligne archivée) |

Conséquence identitaire (à savoir) : `Operator.email` et `Restaurant.stripeAccountId` sont `@unique` et **restent** sur les lignes archivées → **pilote-client@ / pilote-resto@ et `acct_…yYMY` ne pourront plus être ré-enregistrés après le clean**. Toute répétition Claims doit donc se faire **AVANT** le clean (mêmes identités) ou avec de **nouvelles identités** après.

## 2 · Classification cible avant le premier pilote réel (exacte, telle que codée)

**KEEP (système / admin / config)** : admin permanent (`role=admin` **ET** `password=null` **ET** `status=active` — sinon il entre dans la boucle opérateurs !) + ses `Session`/`Account`/`VerificationToken` ; `Invoice`, `InvoiceCounter`, `ServiceInvoiceCounter`, `ServiceInvoice` (numérotation légale) ; `AdminAuditLog` ; `LedgerEntry` ; `Refund` ; `Payout` ; `Dispute` ; `Claim` ; `FranchiseRoyalty` ; `EmailLog` / `EmailDispatch` ; `LlmUsage` ; commandes payées/référencées (`stripePaymentIntentId` ≠ null OU `paymentStatus` ≠ null OU référencées par Refund/Claim/FranchiseRoyalty/Dispute) ; `Creator`/`Referral`/`Affiliate`/`PointOfSale`/`LogisticsProfile`/`PrestataireProfile`/`SupplierProfile` **avec** payout/accrual/facture (conservés + désactivés/suspendus) ; `Restaurant.stripeAccountId` des restos archivés.

**ARCHIVE (ligne conservée, neutralisée)** : opérateurs avec historique (consommateur d'une commande conservée, propriétaire d'un resto archivé, acteur/cible `AdminAuditLog`, payout, royalty, POS conservé, résa avec empreinte, affiliation survivante…) ; restaurants avec commandes conservées / ledger / Connect ; leurs marques, menus, horaires, tables, réservations, `Address`, `OperatorRole` **survivent**.

**DELETE (15 lots FK-sûrs, une transaction par lot, paquets de 200 ids)** — ordre exact du code (`executePlan` :672-854) :
1. configs `ReferralConfig`/`AdoptionConfig` (**UPDATE** réalignement empreinte seed 0.22 → défauts, jamais delete) · 2. `LoyaltyTransaction` → `Reward` → `LoyaltyOrder` → `LoyaltyCustomer` (totalité) · 3. `DishSale` → `DishAdoption` → `AdoptionWaitlist` → `CreatorCampaign` → `CreatorDish` → `CreatorFollow` → `Creator` (sous-ensemble) · 4. `ReferralClick` → `ReferralOrder` (des commandes supprimées) → `Referral` (sous-ensemble) → `AudienceVerificationRequest` → `Affiliate` (sous-ensemble) · 5. `CourierPosition` → `CourierEarning` → `MissionDecline` → `Mission` → `LogisticsProfile` (sans payout) · 6. `ServiceReview` → `ServiceMission` (non facturées) → `ServiceOffering` → `PrestataireUnavailability` → `PrestataireProfile` (sous-ensemble) · 7. `SupplyOrderLine` → `SupplyOrder` → `SupplierCatalogItem` → `SupplierProfile` (sans payout) · 8. `SupplierProduct` → `SupplierOrder` → `Supplier` · 9. `Review` → `Waitlist` → `PromoRedemption` → `EmailOtp` → `OnboardingNudge` → `FranchiseApplication` → `CreatorApplication` → `FranchiseeApplication` · 10. `Order` **jamais payées et non référencées** · 11. `TicketItem` → `TableTicket` → `Reservation` → `RestaurantTable` → `OpeningHour`/`ClosureException` (restos DELETE seulement) · 12. `MenuItem`/`Promotion`/`StockItem` → `Brand` (opérateurs DELETE ; `Category` en cascade) · 13. `Restaurant` DELETE puis ARCHIVE · 14. `PointOfSale` · 15. `Operator` ARCHIVE (+ `Session`/`Account` deleteMany) puis `Operator` DELETE (`Address`/`OperatorRole` en cascade).

**RESET** : uniquement les deux configs ci-dessus (update). Aucun TRUNCATE, aucune séquence/compteur touché (les compteurs de factures sont KEEP).

**Dépendances à connaître** (pourquoi cet ordre) : FK Restrict `Order.restaurantId`, `Restaurant/Brand.operatorId`, `ReferralOrder.orderId`, `PointOfSale.franchiseId`, `LoyaltyOrder/Reward.customerId` ; FK SetNull silencieuses `Brand.restaurantId`, `Order/Restaurant.pointOfSaleId`, `DishSale/Mission.orderId` ; cascades `OperatorRole`/`Address`/`Session`/`Account`/`Review`/`Waitlist`/`Category`/`PromoRedemption` ; **scalaires SANS FK** protégés uniquement par le gate orphelins du script : `Order.consumerId`, `LedgerEntry.restaurantId/…`, `Refund.orderId`, `Claim.*`, `LoyaltyTransaction.customerId/orderId`, `AdminAuditLog.actorId/targetId`… ; jointure **par valeur** `LoyaltyCustomer.email = Operator.email` (survit à l'archivage).

## 3 · Backup / restauration — état honnête

- **Backups connus** : serveur `~/backups/staging-2026-08-30-0133.sql.gz` (pré-répétition) et `~/grubano-backups/staging-pre-phase1-2026-09-03-13-21-22.sql.gz` (63,2 Ko, 44 INSERT, vérifié par l'opérateur Phase 1) — **présence actuelle côté serveur = INCONNUE** (aucun accès serveur). Deux répertoires différents dans les docs (`~/backups/` vs `~/grubano-backups/`).
- **Seule copie LOCALE** : `Downloads/staging-2026-08-30-0133.sql.gz` — intégrité re-vérifiée (gzip OK, marqueur `Dump completed`, 77 CREATE TABLE, 44 INSERT, 925 lignes) **mais STALE** : 0 occurrence de pilote-*/`GR-N5TSM0`, schéma **pré-Phase 1**. La restaurer effacerait la fixture et régresserait le schéma → **inutilisable comme point de restauration actuel**.
- **Aucun opérateur de backup autonome** : le seul `mysqldump` du repo est dans `phase1-staging-migrate.js` et n'est atteint que si la migration n'est pas appliquée (branche « déjà appliquée » = pas de dump). `clean-room.js` **ne sauvegarde pas** : `--i-confirm-local-backup` n'est qu'une **attestation** non vérifiée (ni chemin, ni sha256, ni fraîcheur).
- **Restauration** : une seule phrase (`gunzip < dump | mysql …`) dans `PHASE1-STAGING-PROCEDURE.md` ; aucun runbook, aucun opérateur, aucun exercice de restauration enregistré.
- **Verdict** : `BACKUP = FAIL` comme précondition d'exécution **aujourd'hui** (rien de frais, rien de local à jour — l'opérateur existe mais n'a pas encore tourné sur le staging, et il ne doit tourner qu'APRÈS les répétitions) ; `RESTORE PLAN = INCOMPLETE` (procédure documentée §4 étape 8 + exercice local réussi, mais aucun opérateur de restauration ni exercice sur une copie du staging réel).
- **Remède LIVRÉ (2026-09-07)** : opérateur `scripts/server/staging-backup.js` (shippé automatiquement via `scripts/server/*.js`) — pattern `phase1-staging-migrate.js` : preuve staging (refuse prod db/URL), `mysqldump --single-transaction --quick --routines --triggers` via cnf 0600 supprimé, horodaté `~/grubano-backups/staging-<label>-<ts>.sql.gz`, **jamais d'écrasement**, contrôles taille/marqueur/INSERT/gzip round-trip **+ sha256 du .gz + manifeste exact** (chaque table du schéma a son CREATE, chaque table non vide a ≥1 INSERT, COUNT(*) par table), bloc PASS/FAIL, 0 écriture DB, 0 secret. **Prouvé en local** sur le clone schéma HEAD : PASS (sha256 identique en local, `gzip -t` OK, 23 INSERT) ; 4 contrôles négatifs FAIL fermés (db prod → refus ; URL prod → refus ; mysqldump cassé → FAIL sans résidu ; base vide → FAIL « 0 INSERT ») ; **exercice de restauration** : dump rechargé dans une base jetable → 77 tables, comptes = manifeste. Voir §4 étape 1.

## 4 · Runbook d'exécution future (une commande par étape, dans cet ordre)

**Gates durs avant l'étape 1** : (a) répétition refund Phase 2 exécutée ET close (`FUNDING GATE` levé) ; (b) répétition Claims close ; (c) répétition humaine staging finale ; (d) `grep -c '^model ' prisma/schema.prisma` = 77 = liste `MODELS` du script (toute table ajoutée d'ici là ne serait ni comptée ni nettoyée) ; (e) `/version.json` au SHA attendu sur app + business ; (f) **re-déclaration fondateur** : la déclaration « tout est TEST » du script date du 2026-08-30 et le script n'applique **aucune** classification (il supprime tout `LogisticsProfile` sans payout et tout opérateur sans historique) — or les inscriptions livreur/partenaire/conso sont **LIVE** sur staging → inventaire read-only des `Operator`/`LogisticsProfile`/`Restaurant` créés après le 2026-08-30 (`staging-classification-read.js`) puis phrase explicite du fondateur avant toute exécution.

1. **Backup frais vérifié** (UNE commande, opérateur livré et prouvé) → chemin + sha256 + manifeste imprimés ; **copier le bloc** :
   ```bash
   cd ~/app.grubano.com && ~/nodevenv/app.grubano.com/24/bin/node scripts/server/staging-backup.js --label pre-cleanroom
   ```
   (lit `DATABASE_URL`/`NEXTAUTH_URL` dans `.env.local` lui-même ; sortie `RESULT: PASS` + `BACKUP FILE` + `SHA256` + `MANIFEST`, ou `RESULT: FAIL` + étape — ne rien relancer, coller le bloc.)
2. **Téléchargement local** (cPanel File Manager, hors du dépôt) + vérification locale : `gzip -t`, sha256 = celui imprimé, `zcat … | grep -c '^INSERT INTO'`. Recommandé une fois : **exercice de restauration** sur une base MariaDB locale jetable.
3. **Dry-run staging** (lecture seule, 0 écriture ; exit 2 sans admin passwordless, exit 4 si orphelin prédit) :
   ```bash
   cd ~/app.grubano.com && NEXTAUTH_URL=https://app.grubano.com ~/nodevenv/app.grubano.com/24/bin/node scripts/server/clean-room.js --dry-run
   ```
   ⚠ Le préfixe `NEXTAUTH_URL=…` est **obligatoire** : la garde 1 lit `process.env` **avant** de charger `.env.local` (ligne 41) ; sans lui → `REFUS — NEXTAUTH_URL est ABSENT` (fail-closed, inoffensif). La commande de l'en-tête du script (`source activate && node …`) est **refusée telle quelle**.
4. **Lecture du plan** (fondateur, coller le bloc) : admin permanent PRÉSENT ; **aucune ligne `role=admin` sous ARCHIVE/DELETE** (un admin avec mot de passe n'est PAS permanent) ; 7 identités compromises absentes/neutralisées ; équation ledger OK ; `IDENTITÉS REHEARSAL` : pilote-* = **ARCHIVE** attendu (jamais `PRESERVE (⚠ inattendu)`) ; compteurs PRESERVE conformes ; `UNEXPECTED ORPHANS prédits = 0`.
5. **Exécution** (le **même jour** que 1-2, aucune écriture entre-temps) :
   ```bash
   cd ~/app.grubano.com && NEXTAUTH_URL=https://app.grubano.com ~/nodevenv/app.grubano.com/24/bin/node scripts/server/clean-room.js --execute --i-confirm-local-backup
   ```
6. **Postcheck** : bloc POSTCHECK 8/8 (`PUBLIC CREDENTIAL ACTIVE = 0 · AUTHENTICATABLE TEST USER = 0 · PUBLIC TEST RESTAURANT = 0 · COMMANDABLE TEST RESTAURANT = 0 · ACTIVE TEST PARTNER = 0 · REHEARSAL ACTIVE ACCOUNT = 0 · UNEXPECTED ORPHANS = 0 · PERMANENT ADMIN = PRESENT`, `Ledger intact : OUI`, `✅ CLEAN ROOM COMPLET`) ; puis `staging-classification-read.js` → `TEST PROVED: 0` ; `rehearsal-verify.js baseline` (photo post-clean) ; `phase2-preflight.js` (DB ↔ Stripe inchangé par construction).
7. **Empty smoke** (lecture seule HTTP) : `/version.json` SHA inchangé ; `/fr/eat` 200 catalogue vide ; `/api/restaurants` liste vide ; connexion magique de l'admin permanent OK ; `/fr/business/logistics` 200 (mécanisme waitlist intact) ; aucune trace de resto/menu test en recherche.
8. **Restauration si 5/6 échoue** (procédure, opérateur à écrire si retenu) : arrêt des écritures (Passenger) → `gunzip -c <dump> | mysql --defaults-extra-file=<cnf 0600> <db>` → `touch tmp/restart.txt` → vérifier manifeste, équation ledger, `Invoice`/`InvoiceCounter`, champs Phase 1 présents (si dump pré-Phase 1 → relancer `phase1-staging-migrate.js`) → relancer `phase2-preflight.js`. **Stripe intouché** dans tous les cas (les objets `re_…` restent côté Stripe ; une restauration après un refund TEST recrée une divergence DB ↔ Stripe à re-réconcilier).

## 5 · Divergences doctrine ⇄ code à ratifier par le fondateur (avant le jour J)

- `EmailLog`/`EmailDispatch` : `PRE-CLEAN-ROOM-PLAN.md` les liste en suppression (lignes « e-mail jetable »), l'architecture et le script les **PRESERVENT** → les adresses e-mail test/pilote survivent dans `EmailLog.recipient`.
- `LoyaltyTransaction` supprimée en totalité (lot 2) alors que, depuis Phase 1, c'est le **journal d'idempotence** `re_…` des reconciliations fidélité (les `Refund`/`LedgerEntry` survivent, donc pas de perte d'argent ; mais un replay webhook post-clean re-créditerait un client fidélité qui n'existe plus → `reconcileLoyaltyOnRefund` sort tôt sans compte : à documenter).
- Protection « Riz dala » / UNKNOWN de `PRE-CLEAN-ROOM-PLAN.md` **supplantée** par la déclaration fondateur du 2026-08-30 sans trace écrite de la supplantation.
- Waitlist livreur : mécanisme conservé, **lignes supprimées** si sans payout (voir gate (f)).
- Pointeur stale : `REFUND-FINANCIAL-CONTRACT.md` cite `webhook:453` pour l'écrivain `paymentStatus='refunded'` ; à HEAD c'est `app/api/webhooks/stripe/route.ts:466` (`:453` écrit `paid`).

## 6 · Ce qui survit après le clean (PII, par construction)

Lignes archivées : `Operator.email/name/phone/city` ; `Order.deliveryAddress` des commandes conservées ; `EmailLog.recipient/subject` ; `Reservation.userId` ; métadonnées `AdminAuditLog`. Inventaire existant : `scripts/server/rehearsal-verify.js final`.
