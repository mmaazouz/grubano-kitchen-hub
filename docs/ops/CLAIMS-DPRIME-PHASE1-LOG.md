# CLAIMS D′ — PHASE 1 LOG (L0 → L2 → L1 → L3a) — base `dab754d`

Journal factuel des lots autorisés le 2026-09-22 (GO Phase 1). Toute valeur ci-dessous est MESURÉE et
datée ; « NOT MEASURED » quand elle ne l'est pas. Aucune écriture DB, aucune gate, aucun Stripe
pendant cette phase.

## L0 — Recensement staging MESURÉ (2026-09-22T17:11:18Z, `claims-census.yml` run 35759026504, HTTP 200)

```json
{"measuredAt":"2026-09-22T17:11:18.585Z",
 "claims":{"total":9,"active":0,"nonTerminal":3,
  "byStatus":{"refunded":4,"refused":3,"refused_final":2},"byStatusMeasured":true,
  "refunding":0,"restaurantReview":0,"arbitration":0,"silenceExpired":0,
  "financialVerification":0,"reconcileMarked":0,"t49Shape":0,
  "legacy":{"legacyPayableProofs":0,"refundedBoundToFailedRow":0,"refundedRowUnproven":0,
   "ownRowResumeMismatch":{"nonTerminal":0,"terminal":0},"terminalDeclarationWithArbitrationReason":0,
   "refundedAfterContradictionAttribution":0,"refundedBoundToOtherClaimStamp":0,"rowsBoundToMultipleClaims":0,
   "pendingRowsOver20hWithSettledRoyalty":0,"approvedUnpaid":0,"voidedRefundRows":0},
  "closure":{"missing":0,"terminalWithoutRecord":4}},
 "gates":{"claimsEnabled":false,"claimsGate":"CLOSED (flag_off)","refundsEnabled":false}}
```

| Point de compatibilité (spec v2 §9) | Hypothèse | Mesure | Verdict |
|---|---|---|---|
| Distribution des statuts | 4 refunded / 3 refused / 2 refused_final | 4 / 3 / 2 | ✅ |
| `approvedUnpaid` (forme E-10 / héritée à ratifier) | 0 | 0 | ✅ |
| `refunding`, FV, forme T-49, marquées | 0 | 0 / 0 / 0 / 0 | ✅ |
| active | 0 | 0 | ✅ |
| `closure.missing` / `terminalWithoutRecord` | 0 / 4 (population pré-R13, informative) | 0 / 4 | ✅ |
| Gates | CLOSED / CLOSED | `flag_off` / false | ✅ |

Staging au moment de la mesure : `version.json` = `dab754de25ad024ea41b4b81220f4793bf8ea75d` (develop, run 35615258398) ; `POST /api/claims {}` → 403 ; `POST /api/admin/refunds/run {}` → 403 (sondes non authentifiées, lecture seule). Aucune contradiction avec la spec → L2 autorisé.

## L0 — Baseline typecheck

`npm run typecheck` (`tsc --noEmit --pretty false`, sortie normalisée `tr -d '\r'`, lignes `error TS` triées) à `dab754d` : **39 erreurs, toutes sous `tests/`** (0 erreur produit). Fichier de référence : `docs/ops/TSC-BASELINE-dab754d.txt`. Règle de certification par lot : (a) `grep -v '^tests/'` de la liste courante est VIDE ; (b) `comm -13 baseline courant` est VIDE (aucune nouvelle erreur).

## L0 — Documents amendés
- `docs/ops/CLAIMS-DPRIME-SPEC-v2.md` (nouveau, spec figée).
- `docs/ops/CLAIMS-T49-ROUND13-SPEC-v1.md` : bloc « v1.1 AMENDMENTS — D′ » + pointeurs sur D1, D2, D13/AM-B3, E-10, F13, H02, H09 (§23→§26). Textes gelés conservés.
- `docs/ops/LOYALTY-REFUND-CONTRACT.md` : amendement D-15 (§24), §11/E-P2d/résiduel supersédés, §9 inchangé.
- `docs/ops/POST-BETA-CLAIMS-BACKLOG.md` : D4 abandonnée ; dette ANTI-REPEAT ITEM CLAIM POLICY — POST-BETA.
- Docs périmées : `CLAUDE.md` §7/§9/§10 (`prisma-push.sh`), `docs/ops/redeploiement.md`, `docs/ops/PHASE1-STAGING-PROCEDURE.md` (artefact SQL non livré), `docs/ops/CLAIMS-DELTA-CHECK-2026-09-07.md` (population legacy mesurée vide), commentaire d'en-tête `app/api/orders/[id]/status/route.ts` (« any state → cancelled » faux). `prisma/schema.prisma:2107/2249` : différé à L3b (aucune modification de schema.prisma avant L3b).
- `package.json` : script `typecheck`.

## L0 — déployé
Commit `b5ff49c4d924c79cd3a3c2d629960a52e464c663` ; CI staging run 35760935576 = success ; `https://app.grubano.com/version.json` → `b5ff49c` (buildDate 2026-09-22T17:35:57Z). Docs seulement : 0 changement de comportement.

## L2 — approve = décision métier seule (S-02/S-03/S-13, D1 v1.1)
**Périmètre livré** : `arbitrateClaim(approve)` n'appelle plus ni `triggerClaimRefund` ni `executeRefund` (0 alerte « refunds_disabled », plus de champ `refund` dans la réponse, audit `moneyMoved:false`, e-mail `claim_decision_approved` sans montant) ; ratification d'une approuvée non payée sans réécriture des décisions (S-06) ; `approveClaim` supprimé ; balayage → `routeClaimToArbitration` (jamais d'approbation machine, étape 2 supprimée) ; `autoResolveSmallClaim` inerte ; cause `refunds_disabled` retirée ; table des sorties v1.1 (`ratify` / `withdraw`+`pay`, `APPROVE_ALREADY_SET`) ; copies v1.1 (AM-B3, C4/D14, F15, G8, F14 `said.*`, T-56) sans « approuvez-la à nouveau » / « nouvelle approbation » / « sera payée » ; toast nominal `approvedNotSent` ×5, clé morte `admin.approved` supprimée ×5. `lib/refund.ts` intact (SHA épinglé vert). 0 schéma, 0 flag.

**Preuves** : `tests/claims-dprime-l2-approve-decision-only.test.ts` 15/15 (moteur RÉEL derrière un espion, 2 baux OUVERTS : approve → 0 executeRefund / 0 refunds.create / 0 ligne Refund ; contrôle négatif : `triggerClaimRefund` à la main → 1/1/1, réclamation `refunded`). 90 pins hérités inversés dans 23 fichiers, chacun avec contrôle négatif prouvant que l'ancien comportement (appel moteur inline après le CAS, étape 2 du balayage, copie v1) serait rouge. Suite complète : **465 fichiers / 6227 tests verts** (11 skipped, 17 todo — préexistants). `tsc` : 39 = 39 (baseline dab754d, 0 nouvelle erreur, 0 erreur produit). `next lint` 0 ; `check:i18n` 5/5 complètes ; `check:flags` OK ; build à froid OK.

**Constats de la revue (groupe B) corrigés dans le même lot** : (1) la première rédaction v1.1 de AM-B3 / `APPROVE_ALREADY_SET` promettait « elle sera payée par le rail financier » — phrase interdite par le pin gelé J-M31 → « elle relève du rail financier » (amendement R13 corrigé et tracé, J-M31 inchangé) ; (2) `said.no_refund_proven` / `said.no_refund_proven_rail_locked` (lib/claim-console-copy.ts) et le texte T-56 (`deadText`) nommaient encore « une nouvelle approbation » comme voie de paiement → rail financier (amendement v1.1 F14 tracé, valeurs v1 conservées) ; le scan statique L2 couvre désormais TOUTES les sources de copie réclamations + messages ×5 (commentaires exclus).

**Écarts de spec** : aucun sur spec v2. Sur R13 v1.1 : correction de wording AM-B3 (J-M31) et F13 (le toast livré est plus long que l'échantillon de l'amendement ; spec v2 §7 n'impose que « réécrit ») — tous deux tracés dans le bloc « v1.1 AMENDMENTS ».

## L1 — flags produit (SURFACE / INTAKE), spec v2 §3
**Périmètre livré** : nouveau `lib/claim-flags.ts` (lit `process.env` SEULEMENT, n'importe rien) — `isClaimsSurfaceEnabled`, `isClaimsIntakeEnabled`, `claimsSurfaceOpen`, `claimsIntakeOpen`, `claimNoticeGate(cls)`, `claimsFlagsSnapshot`, plus le bail legacy (`isClaimsEnabled`, `claimsGateState`, `CLAIMS_WINDOW_MAX_MS`) DÉPLACÉ là et ré-exporté par `lib/claims.ts` (mêmes fonctions). 25 sites migrés : POST /api/claims (SURFACE puis INTAKE → 403 `{error, gated:false, enabled:true, intakeOpen:false, reason:'intake_closed'}`, lu AVANT l'auth, sonde = UNKNOWN jamais CLOSED), GET /api/claims (+ overlay `intake_closed` sauf `not_owner`, `existingClaim`/`scope` conservés), contest / restaurant / respond / stale-alerts / arbitrate (SURFACE), GET /api/admin/claims **scindé** (fermé ⇒ `enabled:false`, listes workflow vides, **`actionableRefunds` toujours renvoyée** et comptée ; non-admin fermé ⇒ `{enabled:false}`), pages /orders et /admin/claims (console montée INCONDITIONNELLEMENT avec `surfaceOpen`), `lib/admin-overview` (états workflow sous SURFACE, états argent jamais gatés), `lib/admin-establishments` (idem, `MONEY_CLAIM_STATUSES` toujours comptés), route statut commande (réclamation SYSTÈME sous SURFACE, variante e-mail au send sous `claimNoticeGate('pre_money')`), census (tous les états de portes). E-mails FIN-EMAIL-01 : `pre_money` (ack, décisions, resto) suit la surface ; `closure` (closure-notice, reconcile, attribute, resolve-stuck) TOUJOURS envoyable (S-25). `auto-approve` reste le SEUL lecteur du bail legacy (S-13). Opérateurs : Mode A, Mode B et `refund-gate` (precheck ET window) REFUSENT en NOMMANT le flag ; Mode A distingue `UNKNOWN(403) = intake_closed` ; `refund-gate` sonde désormais `POST /api/claims` ; `WATCHED_SECRET_KEYS` +2. `check-flags` : ERREUR `CLAIMS_INTAKE_ENABLED ⇒ CLAIMS_SURFACE_ENABLED` (21 règles), WARNING bail legacy inerte sous SURFACE, WARNING valeur ≠ `'true'`. i18n ×5 : `eat.help.claimIntakeClosed`, `claims.admin.surfaceClosedEmpty`. Docs : `flags.md`, précheck opérateur R13, runbook répétition refund (en-têtes « valides uniquement SURFACE/INTAKE absents », historique figé Mode A/B).

**Preuves** : `tests/claims-dprime-l1-flags.test.ts` 30/30 — matrice pure, **S-12** (flags produit absents ⇒ `claimsSurfaceOpen ≡ claimsIntakeOpen ≡ isClaimsEnabled` sur 7 états de bail, raisons T-53 préservées), **S-13** (auto-resolve inerte sous SURFACE+INTAKE+flag+plafond ; auto-approve 403 ; 0 couplage à REFUNDS), **S-14** (refus opérateurs par nom, pins statiques), **S-23** (403 `intake_closed` avant auth + overlay + `not_owner` intact), **S-24** (workflow complet sous SURFACE+INTAKE=false), **S-25** (`post_money`/`closure` toujours vrais), `'TRUE'`/`'1'`/`''` = OFF, scan statique des 25 sites et des classes d'e-mail par fichier. 69 pins hérités inversés dans 15 fichiers (chacun avec contrôle négatif sur la forme 05152b6). Suite complète **466 fichiers / 6284 tests verts** ; `tsc` 39 = 39 (baseline dab754d, 0 erreur produit) ; `next lint` 0 ; `check:i18n` 5/5 ; `check:flags` OK et `CLAIMS_INTAKE_ENABLED=true` seul ⇒ **exit 1** ; build à froid OK.

**Écarts de spec** : aucun. Précision tracée : `CLAIMS_SURFACE_ENABLED='false'` (explicite) n'est pas « flag produit présent » au sens de la matrice — seul `'true'` rend le bail legacy inerte ; le kill-switch exige donc bien SURFACE=false **et** INTAKE=false **et** bail absent (procédure §3.5 inchangée), et le test le pin.

## L3a — opérateurs serveur (aucune migration exécutée)
**Périmètre livré** : `scripts/server/dprime-staging-migrate.js` et `scripts/server/dprime-regen-client.js` UNIQUEMENT. **`prisma/schema.prisma` n'est PAS touché** (c'est L3b) et **aucune migration n'a été exécutée** : rien n'a été lancé sur la DB staging.

`dprime-staging-migrate.js` — fail-closed, idempotent, STAGING seulement. SQL COMPILÉ dans le fichier (hash `43cdb3bb51fbe95b`) : exactement 3 `ALTER TABLE … ADD COLUMN IF NOT EXISTS … NULL` (`Claim.approvedAmountCents` INTEGER, `Claim.selection` JSON, `Order.deliveredAt` DATETIME(3)). Étapes : 1 env + auto-contrôle du SQL (toute instruction non purement additive ⇒ refus AVANT toute connexion) · 2/3 preuve STAGING (refus si nom de base OU URL production, refus si ambigu) · 4 épingles fondateur `DPRIME_EXPECT_DB` / `DPRIME_EXPECT_SHA` (lit `public/version.json`) · 5 tables présentes · 6 état partiel ⇒ refus, état complet ⇒ `ALREADY_APPLIED_AND_VERIFIED` · 7 sauvegarde mysqldump VÉRIFIÉE et horodatée (taille, marqueur « Dump completed », ≥ 1 INSERT, présence de `CREATE TABLE Claim` et `Order`, aller-retour gzip) · 8 baseline · 9 application · 10 vérification `information_schema` (présente, NULLABLE, sans défaut, type attendu — MariaDB `longtext` accepté pour JSON) · 11 préservation des comptes + **chaque nouvelle colonne NULL partout** (aucun backfill). Jamais `--accept-data-loss`, jamais `db push`, jamais `prisma-push.sh`. Aucun flag, aucune gate, aucun Stripe, aucun e-mail, aucune écriture dans `.env.local` ; DSN masquée dans toute sortie.

`dprime-regen-client.js` — vérifie que le schéma DÉPLOYÉ porte les 3 champs **sur leur propre modèle** (refus « D′ L3b non déployé » au lieu de certifier un client périmé), régénère avec `prisma@5.22.0` (la commande exacte du workflow, sans shell), exige le marqueur « Generated Prisma Client », **prouve** les champs dans `index.d.ts` via `ClaimScalarFieldEnum` / `OrderScalarFieldEnum` (un simple `includes` passerait sur un client périmé), puis touche `tmp/restart.txt`. N'emprunte rien au contrat Phase 1 (les champs fidélité sont absents du fichier).

**Preuves** : `tests/claims-dprime-l3a-operators.test.ts` 16/16 — les DEUX opérateurs exécutés en VRAIS processus enfants dans un faux monde isolé (racine temporaire, `mysqldump` qui ne doit jamais exister, DSN jamais joignable) : refus base production / URL production / cible ambiguë / base ≠ épingle / `version.json` absent / SHA ≠ épingle / `DATABASE_URL` absente, DSN masquée (ni utilisateur ni mot de passe imprimés), **0 sauvegarde écrite et `mysqldump` jamais exécuté** ; SQL compilé conforme + contrôle négatif (DROP / NOT NULL / DEFAULT / CREATE INDEX rejetés par le garde) ; regen : refus d'un schéma pré-L3b, refus d'un champ posé sur le MAUVAIS modèle (qu'un scan par sous-chaîne aurait laissé passer), jamais de PASS sans génération, contrôle négatif `DPRIME_VERIFY_FIELDS`. Suite complète **467 fichiers / 6300 tests verts** ; `tsc` 39 = 39 (baseline `dab754d`) ; `next lint` 0 ; `check:i18n` 5/5 ; `check:flags` OK ; build à froid OK.

**⛔ ARRÊT OBLIGATOIRE ICI** (autorisation fondateur limitée à L0 → L2 → L1 → L3a) : la migration staging n'est pas exécutée, la DB staging n'est pas modifiée, aucune gate n'est ouverte, aucune opération Stripe n'a eu lieu.

## Lots suivants
(complété lot par lot : SHA, preuves, CI, SHA déployé)
