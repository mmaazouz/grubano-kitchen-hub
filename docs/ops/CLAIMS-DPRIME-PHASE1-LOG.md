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

## Lots suivants
(complété lot par lot : SHA, preuves, CI, SHA déployé)
