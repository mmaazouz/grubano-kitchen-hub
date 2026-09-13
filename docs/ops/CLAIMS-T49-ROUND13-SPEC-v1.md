# ROUND 13 IMPLEMENTATION SPEC v1 — T-49 Claims (FROZEN 2026-09-12)

> Source: design workflow run `wf_37c4911a-7b4` (pass 2 and the convergence stage), on HEAD `40da45e` plus the independent round-13 fixes. Frozen under the founder’s CONVERGENCE MODE order. Rule ids are stable: cite them in code comments and tests. `lib/refund.ts`, the money writes of the Stripe webhook and `prisma/schema.prisma` are NOT changed in round 13.

## CONVERGENCE REPORT

```text
PROGRAM = ROUND 13 CONVERGENCE
CURRENT DESIGN PASS = COMPLETE
CONFIRMED DESIGN P0 =
  - R-A0-1
  - R-A1-1
  - R-A1-2
  - R-A2-1
  - R-X0-1
CONFIRMED DESIGN P1 =
  - R-A0-2
  - R-A0-3
  - R-A0-4
  - R-A0-5
  - R-A1-3
  - R-A1-4
  - R-A1-5
  - R-A2-2
  - R-A2-3
  - R-A2-4
  - R-A2-5
  - R-B0-1
  - R-B0-2
  - R-B0-3
  - R-B0-4
  - R-B1-1
  - R-X0-2
  - R-X0-3
  - R-X0-4
  - R-X0-5
  - R-X0-6
  - R-X0-7
  - V-A-1
  - N-M-1
  - N-C-1
  - N-C-2
P0 ACCOUNTED IN SPEC =
  - R-A0-1 → A-S31d G1 G10 G11 D7 E-07 J-M36 J-M40 J-M50
  - R-A1-1 → G11 D12 G1 G10 A-S31d A-S31e-1 A-S31e-2 A-S31f-2 E-08 E-09 G13 J-M36 J-M40 J-M48 J-C43 J-M50
  - R-A1-2 → C5 B6 A-S41 E-11 I-03 C2 J-M22 J-M17 J-C41
  - R-A2-1 → C6 C7 C10 B6 D8 A-S42 C8 J-M23 J-M24 J-M25 J-M10
  - R-X0-1 → G11 D12 D10 H06 H08 E-08 E-09 I-05 J-M40 J-C43 J-C27 J-C24 J-M50
P1 ACCOUNTED IN SPEC =
  - R-A0-2 → G5 G9 G3 G8 A-S00 A-S10 A-S10c A-S13b I-06 I-07 J-M02 J-M04 J-M47 J-M53
  - R-A0-3 → C3 A-S38-1 A-S38-2 G1 D4 D2 J-M20 J-M43 J-M33
  - R-A0-4 → E-04 A-S19 E-03 J-M50 J-M15 J-M35
  - R-A0-5 → A-S16a A-S00 J-M03
  - R-A1-3 → G5 B3 A-S07 A-S04 A-S08a J-M08 J-M02
  - R-A1-4 → G1 D4 D1 D14 D0 J-M33 J-M29 J-M28 J-M31
  - R-A1-5 → E-10 C3 A-S30c-1 A-S30c-2 A-S14b I-01 D1 J-M05 J-M19 J-M30 J-M32 J-C46
  - R-A2-2 → G1 G10 G11 A-S31d A-S31e-1 A-S31e-2 E-07 E-09 D7 J-M36 J-M40 J-M50 J-C45
  - R-A2-3 → G1 D4 D1 A-S30 E-01 J-M33 J-M29
  - R-A2-4 → D14 G8 G9 J-M31 J-M47 J-M28
  - R-A2-5 → A-S13b A-S16a A-S05c-1 A-S05c-2a A-S05c-2b A-S30b-2a A-S30b-2b A-S36-1 A-S36-2 A-S36b A-S12 A-S12b A-S00 A-S30c-1 C3 J-M01 J-M03 J-M04 J-M05
  - R-B0-1 → H12 F09 F10 H04 J-C12 J-C32 J-C11
  - R-B0-2 → I-01 I-07 I-06 E-13 E-14 E-15 E-01 J-M52 J-C39 J-M53 J-C35
  - R-B0-3 → E-10 I-01 D2 D13 D14 F12 J-M30 J-M32 J-M52 J-C39 J-C15 J-C46
  - R-B0-4 → E-09 A-S31e-1 A-S31e-2 D7 D10 H06 H08 F11 J-M36 J-M50 J-C27 J-C24 J-C18
  - R-B1-1 → H05 D10 D11 C6 C7 D8 E-16 E-18 I-07 I-06 H06 H10 H16 J-C23 J-C24 J-C30 J-M23 J-M38 J-M39 J-M53 J-C35
  - R-X0-2 → A-S31d G1 G10 G11 D7 E-07 H06 J-M36 J-M40 J-C24
  - R-X0-3 → F02 F04 F01 A-S31-1 D11 J-C01 J-C06 J-C07 J-M51 J-M41 J-M39
  - R-X0-4 → G11 F16 F14 G10 D7 J-M40 J-M31 J-C14
  - R-X0-5 → D13 E0 H10 E-13 E-07 G1 J-M41 J-C30 J-M50 J-C45
  - R-X0-6 → E0 E-06 E-07 I-05 I-09 J-M41 J-M50 J-C43
  - R-X0-7 → E-10 D1 D2 E0 J-M30 J-M28 J-C46
  - V-A-1 → C3 A-S30e-1 A-S30e-2 A-S30e-3 A-S30e-4 E-01 F05 F12 J-M19 J-M20 J-M43 J-M47
  - N-M-1 → F15 A-S01 E-10 G2 J-M31
  - N-C-1 → H05 D10 D11 C6 C7 D8 E-16 E-18 I-07 J-C23 J-M38 J-M39 J-M23 J-M53 J-C35
  - N-C-2 → I-01 D2 E-10 F12 J-M52 J-C39 J-M32 J-C15
DESIGN P0 UNACCOUNTED =
  []
DESIGN P1 UNACCOUNTED =
  []
ROUND 13 SPEC = FROZEN
ARCHITECTURE INVALIDATED = NO
SCHEMA CHANGE REQUIRED = NO
REFUND ENGINE CHANGE REQUIRED = NO
READY TO IMPLEMENT = YES
```

## FREEZE NOTES (2026-09-12)

### Accounting recomputed
The workflow's report printed `DESIGN P1 UNACCOUNTED = [N-M-1, N-C-1, N-C-2]` with the reason "no ledger entry". These are the three new P1s the freeze verifiers raised. The fix-up answered each one FIXED, with rule ids, in its `answers`. The script, however, accounted for new items only through `ledger_updates`.

Recomputed from the same run data with the same `account()` code:
- fix-up answers converted to ledger entries;
- every cited id checked to exist in the patched specification;
- the targeted re-verifier's checks applied: 7/7 hold, verdict READY, gate complete, no new P0/P1.

Result: `DESIGN P0 UNACCOUNTED = []`, `DESIGN P1 UNACCOUNTED = []`.

### AMF-1 — reversal of a settled refund whose failure event was lost (closes E-09 / REG-7) [CORE]
E-09 was left NOT fail-visible for two reasons: R-D8 excluded a scheduled Stripe read, and R-D6 forbids scripts from calling Stripe. Both were implementer defaults, not founder rules. The fix needs neither a refund-engine change nor a schema change, so it is closed here.

**`lib/claims.ts` `reverifySettledClaimRefunds({ lookbackDays = 35, take = 100 })`** (exported)
- **Selection:** claims with
  - status `refunded`,
  - `refundError` null,
  - `refundId` not null,
  - a bound Refund row on the claim's own order,
  - that row `succeeded` (or `pending` with a `stripeRefundId` or a `grubano_refund_row` tag),
  - `settledAt` (or `createdAt` when `settledAt` is null) within `lookbackDays`.
  Oldest first; `take` is bounded and `truncated` is reported.
- **Per claim:**
  - Runs exactly the D7 evidence reads, read-only toward Stripe: R0b for a pending row, R0c for a succeeded row (`refundRowTruth`).
  - On failed/canceled evidence only, calls `markClaimsForRevertedRefundRow` (G11: claim-only compare-and-set on the exact pre-image). It sends the same I-01 alert (cause `reverted_after_refund`) and writes the same audit `claim.reconcile_evidence {moneyMoved: false}` as D7.
  - Standing, within-window, unreadable and contradiction outcomes write nothing and are counted.
- **Summary:** `{ checked, reverted, standing, unreadable, unproven, truncated }`, merged into `ClaimRecoverySummary` under `settledReverify`.
- **Call site:** `recoverStrandedClaimReconciliations` calls it AFTER its existing pass. G13's sentence « There is no pass over refunded claims » is superseded. The existing daily cron call on main therefore runs it with no CI change.

**Route and console**
- `POST /api/admin/claims/reconcile-refunds` accepts `isInternalCronRequest(req)` OR `resolveAdmin()`. It is still not gated by CLAIMS_ENABLED, as today.
- The « Vérification financière requise » card gets a button « Revérifier les remboursements soldés (35 jours) ». Its toast states the counts and « Aucune action ici ne déplace d'argent. ».
- On staging, which has no cron, this operator action is the trigger. The Mode-A precheck runs it before any window and records `reverted = 0`.

**Never:** an engine call, a Stripe write, a Refund row write, a customer e-mail.

**E-09 becomes:**
- **Detection:** at the next pass (daily in production, on demand elsewhere).
- **Visibility:** the pass summary and the I-01 alert at marking.
- **Residual:** a failure that Stripe reports more than `lookbackDays` after settlement, and whose event was lost. This is stated in `docs/ops/REFUND-FINANCIAL-CONTRACT.md`.

**Tests (J-M-AMF1)**
- **(a)** A succeeded row whose retrieve returns failed: the claim is marked, I-01 is sent, and `executeRefund` / `refunds.create` are not called.
- **(b)** Retrieve returns succeeded: no write.
- **(c)** Unreadable: counted, no write.
- **(d)** A row outside `lookbackDays`: not selected.
- **(e)** The `take` bound is reached: `truncated` is true.
- **(f)** Route: an admin session gives 200, a non-admin gives 403 (401 without a session), the cron token gives 200.
- **Break/restore:** removing the call from `recoverStrandedClaimReconciliations` turns (a) red when driven through the route.

IMPLEMENTATION NOTE (W5) on AMF-1: landed in lib/claims.ts reverifySettledClaimRefunds({ lookbackDays = 35, take = 100, actor? }). Claim has no settledAt column: the settled instant is Claim.decidedAt (written by every refunded CAS), else createdAt; the DB order is decidedAt then createdAt ascending (MySQL sorts a null decidedAt first), and the selection is restated on the rows read. The row selection keeps succeeded and pending rows of the claim's own order (a pending row without a recorded id is read by its tag, R0b). Summary counts: a within-window pending row counts in `unproven` (not established at Stripe yet), a lost CAS only in `checked`, a DB failure of the helper in `unreadable`. The audit actor is the admin for an operator run and 'system:cron' for the token. The route distinguishes « no session » (401) from « not an admin » (403) with getServerSession before resolveAdmin. J-M41's « no operator route re-verifies E-09 claims in bulk » is superseded by this amendment. Pinned by tests/claims-t49-round13-amf1.test.ts (J-M-AMF1 (a)-(f) and the route break/restore witness).
IMPLEMENTATION NOTE (W5 fixer) on AMF-1: (1) the selection is applied BEFORE the bound — `take` and `truncated` count eligible claims (bound row of the claim's own order, succeeded or pending); the lookback window is read in pages of take + 1 (decidedAt, createdAt, id ascending) until more than `take` eligible claims are found or the window is exhausted (a page with no new claim ends the read; at most 50 pages, beyond which truncated is true), so an ineligible settled claim (A-S31c on a failed row, E-13 on a missing or other-order row) never uses a slot. Pinned by tests/claims-t49-round13-amf1.test.ts (e′) and (e″) with a paged findMany. (2) The residual sentence is stated in docs/ops/REFUND-FINANCIAL-CONTRACT.md §21. (3) The Mode-A precheck step (POST /api/admin/claims/reconcile-refunds as admin on staging before any window, record settledReverify.reverted = 0) is written in docs/ops/CLAIMS-R13-OPERATOR-PRECHECK.md. The console button stays W7.
IMPLEMENTATION NOTE (W7) on AMF-1: the console button « Revérifier les remboursements soldés (35 jours) » is rendered at the top of AdminFinancialVerification whatever the queue holds (an E-09 claim is in no list, so a button inside the red card alone would be unreachable on an empty queue). It calls POST /api/admin/claims/reconcile-refunds with the admin session; its toast (settledReverifyToast) states the settledReverify counts (checked, reverted, standing, unproven, unreadable, truncated) and the stranded pass counts, then « Aucune action ici ne déplace d’argent. ». A reversal, an unreadable read, a truncated pass or a missing summary uses the error tone; a refused or failed call says its result is not established. Pinned by tests/claims-closure-ui.test.ts.
IMPLEMENTATION NOTE (W7 fixer) on AMF-1: reverifySettledClaimRefunds has no cursor (eligible claims are read oldest first, and a claim still standing stays eligible), so no console text names a relaunch as the remedy of a truncated pass. The caption reads « Relit chez Stripe, sans rien y écrire, au plus les 100 réclamations remboursées les plus anciennes des 35 derniers jours, et marque celles dont Stripe rapporte le remboursement échoué ou annulé ; lance aussi le rattrapage des réclamations en cours liées à une ligne de remboursement. Aucune action ici ne déplace d’argent. » and a truncated pass adds « Liste incomplète : ce passage relit au plus les 100 réclamations remboursées les plus anciennes de la fenêtre ; un nouveau passage relit les mêmes en premier tant qu’elles restent soldées, et ne relit pas les plus récentes — vérifiez-les dans Stripe. ». The counts are worded as measured: `checked` is « examinée(s) » (it includes a read that threw and a lost compare-and-set), and the stranded pass reads « Rattrapage des réclamations en cours liées à une ligne de remboursement : X réconciliée(s) ou marquée(s) sur Y examinée(s) » (`scanned` includes pending and missing rows; `reconciled` includes reversal markings). No cursor was added (the AMF-1 selection is unchanged): the eligible claims beyond the oldest 100 of a truncated pass stay a stated residual. Pinned by tests/claims-closure-ui.test.ts (AMF-1 describe; negative control on the round-1 « : relancez. » clause).
IMPLEMENTATION NOTE (W8) on AMF-1: the Mode-A precheck no longer tells the operator to relaunch until `truncated = false`. Each pass re-reads the 100 oldest eligible claims of that moment, with no cursor, and its summary carries counts only (no claim id). While the claims already re-read stay eligible, a relaunch re-reads the same ones and not the more recent ones; while more than 100 eligible claims remain in the window, or the 50-page bound is reached again, truncated stays true, so a relaunch does not lift it. A pass reaches more recent claims only once older ones leave the selection (marked after a reversal, or aged out of the window). docs/ops/CLAIMS-R13-OPERATOR-PRECHECK.md Étape 2 now states: the bound (AT MOST the 100 oldest eligible claims found; when the 50-page bound ends the read, every eligible claim found was re-read, possibly fewer than 100, and settled claims past those pages were not examined); what `truncated` means; and a check the operator can carry out without ids (verify in the Stripe Dashboard the refund of every refunded claim settled in the window, at least those after the oldest 100 by decidedAt then createdAt). docs/ops/REFUND-FINANCIAL-CONTRACT.md §25 states the same residual. The W7 fixer toast says the same in short (« tant qu’elles restent soldées »); its scope omits the aging-out case, which can only make a later pass read more recent claims, never fewer. No cursor is added (the selection is unchanged). The E-09 residual sentence (a failure reported beyond lookbackDays) is present in §21.

### AMF-2 — closure-notice eligibility (supersedes the AdminAuditLog clause of binding rule 12)
H05 is authoritative. The only eligibility record is `EmailDispatch {trigger 'claim_closure_record', dedupeKey 'claim:<id>'}`, written by this build after a closure compare-and-set.

The binding-rule-12 sentence « Closure-notice eligibility is the AdminAuditLog row … » is superseded, for two reasons:
- HEAD already writes audit rows for legacy closures, so using them would readmit the backlog.
- `recordAdminAudit` returns false while auditing is off.

`EmailDispatch` already exists with `@@unique([trigger, dedupeKey])`, so no schema change is needed.

### Binding rule 11 — REG-7 superseded by AMF-1; E-08 stated as a bounded residual
**The case:** a Stripe failure event arrives for the SUCCEEDED bound row of a refunded claim, and the helper's database write throws.

**What happens:** the webhook answers 503 and Stripe redelivers. For that window (a database failure), the claim still reads « Remboursée » even though a failure signal was received.

**Mitigations:**
- bounded by Stripe's redelivery;
- alerted by I-05 with `claimIds`, sent before the helper;
- backstopped by AMF-1 if redelivery is exhausted.

**No money can move:**
- the claim is terminal;
- the engine refuses at E2 / E6;
- T2 H1 holds later claims on the order.

### Change rules after the freeze (founder)
If implementation exposes a defect: fix it locally when that is consistent with the frozen invariants, update the relevant rule in this file, and add a regression test.

Architecture is reopened only if implementation proves a frozen invariant impossible or unsafe (ARCHITECTURE INVALIDATED = YES, with the invariant named).

### ERRATA — P2/P3 found by the freeze verifiers (resolve locally during implementation)
Each erratum is resolved during implementation, consistently with the frozen invariants: update the rule it names and add a regression test.

An erratum is treated as [CORE] when it is:
- a false sentence about money;
- a false sentence about what the system or the engine would do;
- a contradiction between two rules;
- a test that cannot pass as written.

- **ER-M01** [P2] {C3 G7 E-04 A-S19 A-S20 A-S38-1} A liveness regression is undisclosed and misregistered. T2(e') runs on null pre-images, so the first approval of any claim on an order with a prior standing refund not explained by a settled claim lands in FV refund_moved_unattributed. Examples: an admin-rail partial refund row, or a rowless Stripe Dashboard partial refund. N3 requires exactly one refunded null-error claim binder. The claim then sits permanently in E-04: no declaration, activeOrderKey held, customer reads FVc indefinitely. At HEAD the engine paid within refundable (E4/E5). Section A has no state for this entry path (A-S38 is v13-only; A-S19/A-S20 are described as reached by reconcile). E-04 calls its population one that needs 'an external data correction', which does not exist for a legitimate claim on a partially refunded order. createClaim/buildClaimScope still offer such claims (claims.ts 334-338). — evidence: G7 N3 EXPLAINED rule and N5; C3(e') 'for EVERY pre-image, null or v13'; E-04 CONDITION; claims.ts 97-109 (scope subtracts refunded, so claims on partially refunded orders are offered)
- **ER-M02** [P2] {D8 C6 C7 C1 J-M23} D8 contradicts C6/C7 on the binding transaction, so the loser path cannot be implemented as one rule. (1) D8's in-transaction CAS is where {id, status FV} without refundError; C1 and C6 require the refundError pre-image. (2) On any thrown error with a re-read showing refunded + refundId === row, D8 answers 200 « Ce remboursement est déjà appliqué à cette réclamation : rien de plus n’a été écrit. » C7 answers 409 « Cette réclamation est déjà liée à ce remboursement … », and J-M23 pins 'never 200, never ok'. For a commit that landed but was reported lost, D8's « rien de plus n’a été écrit » is not established by the code. — evidence: D8 step (7) and 'ON ANY THROWN ERROR' vs C6 transaction body and C7 mapping; J-M23 assertion list
- **ER-M03** [P2] {C4 D3 J-M21} The Q-INSTANT refusal is specified twice, incompatibly. C4 uses proofInstant(), the regex /… ([\d:.]+Z) \(UTC\)/, and the texts « Approbation prématurée … » and « Approbation impossible : l’heure … ». D3 uses parseQuiescenceInstant(), a different regex, and the texts « Approbation refusée jusqu’au … » and « Approbation refusée : l’instant … ». J-M21 pins the D3 text while C4 is the [CORE] enforcement rule. — evidence: C4 enforcement bullet vs D3 PARSER and texts; J-M21 ASSERTION
- **ER-M04** [P2] {G5 J-M04 A-S10c} J-M04 cannot pass as written. Its negative control asserts that a clawback-eligible pending row at 1 h is 'NOT clawback-locked'. G5 classes succeeded_at_stripe_clawback at any age, and J-M04's own break/restore requires a 2 h clawback row to stay locked. This is the parity pin for R-A0-2. — evidence: G5 pendingEvidence 'whatever the age (fail closed)'; J-M04 NEGATIVE CONTROL and BREAK/RESTORE; ledger note on R-A0-2
- **ER-M05** [P2] {J-M28 D1 E-10} The hard-invariant test J-M28 cannot pass against D1. (2) requires 'approve' to be absent or refused whenever ENGINE ACCEPTS is NO. Yet D1 rows 1-2 offer approve on A-S12 (approved null variant, E3), A-S30b-1 (PIX), A-S30b-2b (E3), A-S30e-3 (E3) and A-S38-2 (E4/E5), where T2, not the engine, blocks. (1) requires exactly one refunds.create for every approvable state, which A-S30b-*, A-S30e-3 and A-S38-1 cannot produce. The flagship 'no exit the engine would refuse' pin is therefore not implementable. — evidence: J-M28 ASSERTION (1)(2); D1 rows 1-2; A-S30b-1/A-S30b-2b/A-S30e-3/A-S38-2 engine fields
- **ER-M06** [P2] {D1 D0 J-M30 A-S00} D1 says acceptedExits 'returns exactly these sets' and replaces the exit table, but omits non-terminal shapes that the current EXIT_TABLE and G1 keep. Omitted: approved or refunding bound with null error; legacyStranded; attemptedUnrecorded; arbitration and silence-expired restaurant_review (approve / refuse_final). Section A also has no state for the canonical 202 outcome: claim refunding, bound to its own stamped row pending at Stripe, refundError null (engine E3 / resume YES; exits webhook or reconcile 'bound'). The founder gate lists 'a pending refund'. With D0's approvable = acceptedExits ∋ 'approve', a literal D1 would hide « Approuver » on arbitration claims that arbitrateClaim accepts. — evidence: tests/claims-t49-round10.test.ts 140-159 (rows 'approved — bound, no error', 'refunding — legacy stranded', 'refunding — bound, no error', 'arbitration', 'restaurant_review — delay expired'); claim-action-rules.ts 75-81; D1 rows 1-14; D0 PARITY approvable formula; B7/C5 item 6 writes the 202 'ours' state
- **ER-M07** [P3] {G9 G8 A-S10b A-S30e-2} The AWAITING lock (G9, A-S10b, A-S30e-2) is justified by 'the webhook or an engine resume finalizes' the other row. But only refund.updated with status succeeded calls finalizeRefundRowFromStripe; charge.refunded does not finalize rows. A refund that succeeded at creation but whose create response was lost may emit no refund.updated (route.ts 104-105), and Claims never calls the engine on that order. Only an admin-rail resume ends it, so « Relancez … lorsque cette ligne ne sera plus « en attente » » presupposes an event nothing in Claims produces. It is closable by declaration, so no money risk. — evidence: app/api/webhooks/stripe/route.ts:953 is the only finalizeRefundRowFromStripe caller; no prisma.refund.update in app/; G9 text
- **ER-M08** [P3] {C8 D9 B11} Adoption reporting. When the C8 transaction aborts and the re-read finds a mirror with reason claim:<id>, the concurrent winner's mirror is treated as this call's commit: trace.wrote = true and the adopt audit is written a second time. wrote:true is then false for this call. D9(1) 'no local row has stripeRefundId === re_' also contradicts B11(a), which keeps the existing-mirror 'ours' branch. — evidence: C8 'Any other error → re-read … found with reason claim:<id> → trace.wrote = true, continue as a commit'; D9 (1) vs B11 (a); claims.ts 2079-2111
- **ER-M09** [P3] {D14 G1 D11} D14(2) and its predicate. It is selected 'when reconcileRefusal === null', which admits v13 proofs (G1(i)); unless v13 is excluded, D2(1)(c) is unreachable. On approved claims carrying a reconcile marker (listReconcileRequiredClaims includes status approved), its sentence « « Clôturer ce dossier… » enregistre votre déclaration » names a control that isStuckResolvable refuses (marker). — evidence: D14 (2); G1 (i); claims.ts 1552 and 1287
- **ER-M10** [P3] {D2 I-01 J-M24 J-M06 G10 I-06} Wrong references and test statements. D2(1)(a) cites 'approveClaim CAS, claims.ts 640' for the arbitration decision; that is arbitrateClaim's CAS at 924, and D2(2)/I-01 attribute refunds_disabled to approveClaim, whereas the arbitrate route calls arbitrateClaim. J-M24's negative control calls the omitted isolation level ReadCommitted; the MySQL/MariaDB default is REPEATABLE READ. J-M06 asserts 'the succeeded branch never answers 5xx', contradicting the unchanged 503s at route.ts 945, 957 and 959. The R0b 'census refundedRowUnproven' note (G10, D7) is wrong because I-06's predicate is DB-only. — evidence: claims.ts 638-646 vs 924-932; app/api/admin/claims/[id]/arbitrate/route.ts 41; route.ts 945/957/959; I-06 refundedRowUnproven definition
- **ER-M11** [P3] {C3 A-S30c-1} The C3(b') / A-S30c-1 no_charge sentence quotes E1, else E1b, else E1c, but refund.ts checks E2 (a failed row with a Stripe id) before the PI read. On such an order the engine refuses at E2 while the hold quotes « Paiement non débité » or « Charge introuvable ». This is anomaly-only data. — evidence: refund.ts 744-750 precede 753-761; C3 (b') S for no_charge; A-S30c-1
- **ER-M12** [ENGINE MISMATCH] A-S13b ENGINE RESUMES: a succeeded foreign refund does NOT book a ledger line on resume. resolveFeeTruth lists refunds of the order's PI (refund.ts 402), the foreign refund is absent so feeBackCents is null, and the eager ledger is skipped (refund.ts 588, 615). The clawback createReversal (524-559), the row going succeeded (619) and the royalty recompute (627-651) are correct.
- **ER-M13** [ENGINE MISMATCH] C3(b') / A-S30c-1 quoted refusal: on a no-charge order that carries a failed Refund row with a stripeRefundId, the engine answers E2 (refund.ts 744-750), which precedes PIX/E1b/E1c. The quoted « Paiement non débité » / « Charge introuvable » is then not the first refusal (anomaly-only).
- **ER-C14** [P2] {F10 R-B0-1 R-D9} Customer copy that F10(1) forbids (promising a follow-up) is kept and not guarded. The copy says Grubano will decide or review, but a contested claim can only be decided through the CLAIMS-gated arbitrate route. — evidence: messages/*.json claims.client.contestSuccess: « Contestation envoyée. Grubano va trancher. » / « Grubano will decide. » / « Grubano decidirá. » / « Grubano deciderà. » / « ستبتّ Grubano. ». claims.client.contestDescription: « Grubano examinera votre réclamation… » ×5. eat.help.refundEstimate: « Votre demande sera examinée » ×5. claimEmails.orderCancelledPaid.bodyExisting: « elle suit son circuit normal ». eat.help.refundOffBody: « nous vous répondrons personnellement ». Arbitrate answers 403 while CLAIMS is closed (route.ts 28-30). F09 and H12 do not reword these, and J-C12's NOTIFY_BY_LOCALE does not match them.
- **ER-C15** [P2] {F13 J-C16 R-D9} J-C16 cannot pass on the copy F13 specifies: the ar approvedFailed and approvedResumeMismatch strings keep « المحرك » after their last sentence is deleted. — evidence: F13 only deletes the last sentence of approvedFailed and approvedResumeMismatch. Current ar values: « تمت الموافقة على الشكوى، لكن المحرك رفض ردّ المبلغ… » and « …لكن المحرك انتهى إلى ردّ مبلغ… ». J-C16 asserts « the ar values do not contain « المحرك » » over a set that includes both keys.
- **ER-C16** [P2] {I-07 C3 J-C35 R-D8} The legacy-population alert channel (I-07) and its test (J-C35) contradict the existing precheck script, so the C3 census alert cannot be implemented as written. — evidence: scripts/server/phase2-claims-gate.js: A() pushes to anomalies (line 48). Precheck returns done(anomalies.length ? 'FAIL' : 'PASS'), and window mode refuses on `if (anomalies.length)`. I-07 requires A() lines for non-zero counts but says « Anomalies do not change RESULT ». approvedUnpaid counts every beta approval, so every Mode A window would be refused. J-C35 asserts « the script never imports lib/stripe or calls fetch », but the script fetches the app's gate probes (lines 79, 242).
- **ER-C17** [P2] {H15 H10 H16 J-C21 J-C29} The import-topology pins contradict where H10 and H16 place the missing-notice list, and J-C21's file set is wrong. — evidence: H10 puts listMissingClaimClosureNotices in lib/claim-emails and has financial-verification/route.ts call it. H16 has census/route.ts use it. H15 and J-C29 pin the importers of lib/claim-emails to exactly 8 routes, which exclude both. J-C21 claims the files calling sendClaimAckEmail, sendClaimDecisionEmail or sendClaimClosureEmail are « exactly the 8 routes listed in H15 », but app/api/orders/[id]/status/route.ts imports only sendOrderCancelledPaidEmail and sendOrderCancelledPaidOffEmail.
- **ER-C18** [P3] {H10 E-18 J-C30} Two different « exact » intro texts for the missing-notice section, and J-C30 pins one of them. — evidence: H10 intro ends « Les clôtures antérieures à cette version ne sont pas listées et ne recevront aucun avis. ». E-18's « exact text » is « Les clôtures qui n’ont pas été enregistrées par cette version (dont toutes les clôtures antérieures à celle-ci) ne sont pas listées… ». J-C30 asserts the E-18 sentence verbatim.
- **ER-C19** [P3] {I-08 H03 H06 J-C24 J-C44} The e-mail miss-signal contract is inconsistent: I-08, H03/H06 and J-C24 disagree on the why values and on the one-EmailLog-row-per-attempt rule. — evidence: I-08 lists why ∈ {claims_disabled, no_address, smtp_disabled, not_eligible, refunded_row_unproven, duplicate}; H03's ClaimEmailWhy has no no_address, not_eligible or duplicate, and J-C44 asserts they never appear. J-C24 asserts « every fixture produces exactly one EmailLog row », but H06 step 2 returns not_applicable with no trace, and sendTransactional returns 'duplicate' before writing any EmailLog row (transactional-emails.ts 143-147).
- **ER-C20** [P3] {H13 R-D7 J-C33} H13 does not cover the case where claims were closed at request entry but open at send. That paid cancellation would fall through to the generic cancellation e-mail, which says nothing about the money. The claimAmountCents > 0 condition is also left unspecified. — evidence: orders/[id]/status/route.ts 123-125: paidCancellation = paidCancelled && claimsOn && claimAmountCents > 0, else if paidCancelled && !claimsOn → Off variant, else generic sendOrderStatusEmail. H13 specifies only (claimsOn && claimsOpenNow) → Paid variant and (!claimsOpenNow) → Off variant. J-C33 tests (true,true), (true,false) and (false,false), not (false,true).
- **ER-C21** [P3] {H06 H08} The resend of a refunded notice depends on an outcome field that no visible rule defines, and the cross-reference points to the wrong section. — evidence: H06: « Section E must extend refund_still_standing with stripeStatus and amountCents. Without that extension, the resend fails closed. » Section E is the registry. F14 defines stripeStatus branches but never amountCents. If amountCents is missing, every H08 resend of a refunded claim ends as stripe_not_confirmed, so claims settled by webhook or recovery never get a notice.
- **ER-C22** [P3] {H10 H06 E-13 F03} The H10 blocker and E-13 condition diverge from the sender's own proof rules. — evidence: H10 sets blocker only from row status and refundedRowProven. It ignores binders ≥ 2 (A-S43), so « Envoyer l’avis au client » is enabled while H06 step 6 answers refunded_row_unproven. E-13 CONDITION lists specific shapes but omits rows whose status is neither succeeded, pending nor failed, which refundedRowProven rejects and H10's list includes.
- **ER-C23** [P3] {J-C29 J-C48 H09 I-10} The J-C29 and J-C48 cron roots point at a directory that does not exist, and they miss a claims route that cron actually calls. — evidence: app/api/cron does not exist. .github/workflows/cron.yml calls /api/admin/claims/stale-alerts (line 145) and /api/admin/claims/reconcile-refunds (line 154). stale-alerts is not a J-C29 root.
- **ER-C24** [P3] {F16 F15 J-C14} Contradictory wording rule for the engine-resume sentence in operator text. — evidence: F16(6), A-S07 and A-S31d mandate « si le moteur la reprend (il reprend la plus ancienne ligne…) ». tests/claims-t49-round10.test.ts PROMISES contains /la reprend/i and scans lib/claims.ts, and F15 and J-C14 require « reprend cette ligne ».
- **ER-C25** [P3] {E-16 E-10 F12 F13} Two registry entries describe surface or alert signals that the specified code does not produce. — evidence: E-16 ALERT « I-08 at write time »: closures settled by webhook, recovery or sweep attempt no send, so no I-08 signal exists for them. E-10 SURFACE « approve toast reporting refunds_disabled »: F12 maps refunds_disabled to approvedNotSent, whose F13 text (« aucun remboursement n’a été lancé par cette action ») names no cause.
- **ER-R26** [P2] {G8 G5 A-S10c J-M04 J-M46} The G8 clawback sentence claims more than the code establishes. It is used for every row G5 classes succeeded_at_stripe_clawback (A-S10c, A-S30e-1): « sa finalisation doit d'abord reprendre au franchiseur une royalty déjà réglée : le moteur peut la refuser à chaque appel ». G5 assigns that class at any age from royaltyStatus in {settled, settling} and royaltyRefundCents>0 alone, without reading the transfer, the amount already recovered or the reversals. In the over-lock variants the engine takes nothing from the franchisor and finalizes. This is an admin sentence about what the system will do that the code has not established. No money moves and no false exit is offered. — evidence: refund.ts 525-526 and 574-583: no locatable transfer means no reversal. 529 and 571-573: capClawback 0 means no reversal. 'settling' is not « déjà réglée ». J-M04 (g3) documents the over-lock but the G8 text is not hedged. Fix: « peut devoir reprendre au franchiseur une royalty (si un transfert de règlement existe) ».
- **ER-R27** [P2] {F15 A-S08b J-M31} The F15 GUIDANCE and MONEY label for absence_proven_payable say Stripe reported « aucun remboursement non expliqué », with no qualifier. A-S08b (non-routed payment, an ownerless failed or canceled Dashboard refund re_D in the complete list) writes a v13 payable proof, so the sentence is literally false on that state. HEAD_A and the F14 toast restrict themselves to refunds « abouti ou en attente »; the F15 texts do not. No false exit, and payment stays gated by T2. — evidence: G5: H2 applies only when routed===true. G7 N3/N5 examine standing refunds only. So A-S08b reaches N8 payable, and F15's classification then renders both texts. J-M31 pins the unqualified texts verbatim. Fix: insert « abouti ou en attente » in both F15 texts and in the pins.
- **ER-R28** [P2] {H05 D10 J-M38} The ARCHITECTURE DECISION still defines closure-notice eligibility as AdminAuditLog, in both the binding rule NO SCHEMA CHANGE and schema_reason: « Closure-notice eligibility is the AdminAuditLog row that this build's closing route writes … If recordAdminAudit returns false, the claim is not eligible and stays listed ». The fix-up declares this superseded, but a frozen v1 would carry two binding definitions. Following the AdminAuditLog one re-creates the legacy backlog that R-D6(d) forbids. — evidence: arbitrate/route.ts at HEAD writes 'claim.arbitrate' for every arbitration, so legacy closures already have audit rows. H05 and D10 exclude AdminAuditLog. The J-M38 break/restore test mitigates this. Amend the binding rule text when freezing ROUND 13 IMPLEMENTATION SPEC v1.
- **ER-R29** [P3] {H05 J-C23 G2 C9} H05 site 2 puts noNoticeSource on every refunded CAS inside reconcileClaimForRefund, which logs « settled by the Stripe webhook or the recovery sweep: no customer notice is sent from this path ». But applyRowTruth's row_terminal succeeded branch settles through reconcileClaimForRefund, and C9(a) keeps that delegation. A reconcile-route settlement, which does attempt a notice, therefore logs a false EMAIL MISS line. J-C23's assertions also conflict: site 3 lists applyRowTruth row_terminal, yet 'no other site logs it'. — evidence: claims.ts 1741-1745: bind write, then reconcileClaimForRefund(...). C9(a): « After its own bind write, the next write (reconcileClaimForRefund, or a park) ». Fix: the webhook and recovery callers pass noNoticeSource, not reconcileClaimForRefund itself.
- **ER-R30** [P3] {C3 F12 F13 J-C15} F12 maps every 'attempt_superseded' to approvedSuperseded. Its F13 text, « la réclamation ne reflète pas ce que cette tentative a obtenu du moteur », assumes the engine returned something. But C3 also returns attempt_superseded from T2, when a CAS count is 0 or step (f)'s re-read differs, and there the engine was NOT called. That happens if T2's Stripe reads outlast RECONCILE_GRACE_MS and a reconcile writes meanwhile. The toast's instruction (« Ne relancez rien ») stays safe. — evidence: C3: « count 0 → no further write, return { state: 'failed', error: 'attempt_superseded' }, engine NOT called »; (f) « anything other than { 'refunding', M } → 'attempt_superseded' ». F12 maps attempt_superseded to approvedSuperseded.
- **ER-R31** [P3] {D11 B1} D11's WHY NO MONEY says of a declaration that « boundToWhere counts it as a binder, so a refundId it keeps cannot settle another claim ». That is false for a declared resume_mismatch claim. resolveStuckClaim keeps refundError, and boundToWhere excludes resume_mismatch, so such a claim is not a binder. Money-wise this is harmless: the binding was already disowned, and the declared claim keeps a non-null refundError, so it never settles. — evidence: claims.ts 1313-1326: the resolveStuckClaim data has no refundError field, so the resume_mismatch text survives. B1 boundToWhere: OR [refundError null, NOT startsWith 'resume_mismatch'].
- **ER-R32** [P3] {A-S27-1b A-S27-2 A-S41 J-M01} C5 requires a state whose variants give different engine answers to be split. A few rows still give both answers inline: A-S27-1b (YES canonical / NO for E4/E5), A-S27-2 (E2 / E3), A-S29-2 (YES canonical) and A-S41 (YES / 202 variant NO). The answers are explicit and consistent with refund.ts; this is formatting only. — evidence: The A-S27-1b, A-S27-2, A-S29-2 and A-S41 ENGINE fields. J-M01 already treats variants as separate fixture entries.

## ARCHITECTURE DECISION (binding)

- **Architecture invalidated:** NO — Every invariant in the CONVERGENCE block can be implemented safely with the engine and the schema left closed.

(1) One Refund settles at most one Claim.
- Stamped rows. A row stamped for a claim can settle only that claim. Refund.reason is written only at creation (refund.ts 808-822; the adoption mirror at claims.ts 2190-2206). The only Refund updates are refund.ts 458, 513 and 619, and none of them writes reason. Attribution refuses another claim's stamp (claim-attribution-rules.ts 34-39), and T3 checks the stamp.
- Unstamped rows. Only attribution can bind one, and it becomes a single Serializable transaction holding the binder read and the FV→refunded CAS. It is correct on o2switch's InnoDB (MariaDB 12.3); schema_reason gives the failure modes.
- Legacy rows bound to several claims. They are detected (findMany → ambiguous_binding) and counted. They are not rewritten.

(2) A late attempt cannot overwrite a newer state. Every claim write after the engine returns becomes updateMany on {id, status 'refunding', refundError: M}, where M is unique to the attempt.

(3) A payable proof is fresh at the moment of payment.
- T2 re-reads Stripe and our rows and re-derives the proof immediately before executeRefund.
- The engine then reads the charge again itself (refund.ts 755).
- A proof also cannot be used before its quiescence instant (engine_guard_disposition).

(4) No exit is promised that the engine refuses. The rules module mirrors refund.ts 724-839 in order. A parity test runs the real executeRefund against it.

(5) The engine stays closed. No confirmed P0/P1 needs an engine change (engine_reason).

Two residuals remain. Any design that keeps the engine closed, the webhook's money writes unchanged and no scheduled Stripe read has them. They must be documented, not designed away:
- A refund issued outside the system (Stripe Dashboard) can land between the last Claims read and the engine's own charge read, or while an attempt is stalled.
- A settled refund can fail at Stripe while its row stays 'succeeded' and the failure event is never processed (REG-7, needs founder acceptance).
Neither makes an invariant impossible. The first is money created by a human outside the system. The second is a visibility gap: no money moves from it.

- **Schema change required:** NO — No confirmed P0/P1 needs a Prisma schema change.

R-A2-1 (two concurrent attributions let one Refund settle two claims). A Prisma 5.22.0 interactive transaction is enough, under the conditions below: prisma.$transaction(async (tx) => ..., { isolationLevel: 'Serializable' }). The type exists in node_modules/.prisma/client/index.d.ts line 520, and the runtime passes the option to the engine.

Why it works:
- The database is provider mysql (schema.prisma:7) running on o2switch MariaDB 12.3 (docs/ops/LOYALTY-REFUND-CONTRACT.md:93).
- Under SERIALIZABLE, InnoDB turns every plain SELECT inside an explicit transaction into a shared locking read.
- Claim.refundId has no index. The Claim indexes are consumerId+createdAt, restaurantId+status, status+responseDeadlineAt, orderId, and activeOrderKey @unique.
- So the binder read (refundId = row AND id ≠ self) must read the other claim's row, and it holds a shared lock on it until commit.

How a lost race fails:
- Interleaved: transaction A's UPDATE of claim A waits on B's shared lock on A. Transaction B's UPDATE of claim B waits on A's shared lock on B. InnoDB deadlock detection rolls the victim back completely (MySQL error 1213). Prisma raises PrismaClientKnownRequestError P2034 (TransactionWriteConflict); that string is present in all four query-engine binaries.
- Sequential: the second binder read sees the committed binding. The callback throws, the transaction rolls back, and the caller gets 409 bound_to_other_claim.
- Other aborts, all full rollbacks:
  - A lock wait longer than Prisma's interactive-transaction timeout (default 5000 ms) gives P2028.
  - If innodb_snapshot_isolation is ON, the error is ER_CHECKREAD 1020, which is not P2034.
  - If innodb_deadlock_detect is OFF, both sides can time out. Neither binds, which is safe, and the operator retries.
  - A connection lost during COMMIT leaves the outcome unknown.

Conditions:
- The transaction contains only the binder read and the CAS. No Stripe call, audit, alert or e-mail runs inside it.
- Every error is caught, and the claim is re-read before the operator is told anything.
- No other path creates a settling binding of an unstamped row (binding rule 5).
- Vitest with a mocked Prisma cannot prove lock behaviour. The exactly-one outcome must be rehearsed with two real connections.

A unique index would be the wrong fix:
- @@unique on Claim.refundId would fail on legacy rows that bind several claims. Those include resume_mismatch claims bound to another claim's row, and declarations that keep refundId.
- @@unique([orderId, reason]) on Refund would refuse legitimate partial refunds from the admin rail that repeat the same reason.

The other P0/P1 need no schema change either:
- T4 CAS uses updateMany.
- The quiescence instant and the reversal markers live in Claim.refundError (@db.Text), as the reconcile marker timestamp already does (claims.ts 235-236, claim-action-rules.ts 50-59).
- Closure-notice eligibility (R-B1-1, C4) is the AdminAuditLog row written by this build's closing route; recordAdminAudit already returns a boolean in the round-13 tree. No deploy-epoch constant is needed.
- R-A0-2 reads existing fields only: FranchiseRoyalty.status, Refund.royaltyRefundCents and Refund.createdAt.

- **Refund engine change required:** NO — No confirmed P0/P1 needs a change to lib/refund.ts or to the webhook's money writes. Each one resolves on the Claims side:
- **Settled refund that later fails or is canceled** (R-A0-1, R-A1-1, R-A2-2, R-X0-1, R-X0-2, R-B0-4, R-X0-6): claim-only marking from the webhook, placed after its unchanged money writes, plus read-only R0a/R0b/R0c evidence on the ungated reconcile route. What remains is REG-7, a refund that succeeded, later failed, and whose event was lost. It is a visibility gap from which no money moves. Closing it would need a scheduled Stripe read (forbidden by R-D8) or a webhook row write. Money safety needs neither.
- **R-A0-2:** classify the resume clawback (refund.ts 524-561) in the mirror; the engine itself does not change.
- **R-A0-3, R-A0-5, R-A2-5 and verifier A's engine mismatches:** T2 re-derivation plus a strict mirror of the refund.ts order.
- **R-A1-2:** CAS on the attempt token.
- **R-A2-1:** Serializable attribution.
- **R-A1-3, R-A1-4, R-A1-5, R-A2-3, R-A2-4, R-B0-1, R-B0-2, R-B0-3, R-B1-1, R-X0-3, R-X0-4, R-X0-5, R-X0-7:** rules, copy and registry.
- **V-A-1:** T2 writes the derived locked or awaiting proof instead of reverting.

**The stalled-attempt double refund that the exclusiveReason guard targets is not a confirmed pass-2 P0/P1.** No pass-2 refuter or verifier raised it; pass 1 rated it P2.

Re-derived, the race needs four things in order:
1. Attempt 1 is still before its row insert (refund.ts 724-808) once RECONCILE_GRACE_MS has passed (claim-action-rules.ts 46).
2. An operator runs reconcile.
3. The claim is re-approved with both leases open.
4. All of this happens before attempt 1 resumes.

How long can attempt 1 sit before its insert?
- The Stripe part is bounded. lib/stripe.ts:17 calls new Stripe(key) with no options, so stripe-node 22.2.0 defaults apply: a timeout of 80000 ms and 2 network retries (stripe.core.js:170). That is about 4 minutes, which fits inside the 5-minute grace with little margin.
- The database reads have no socket timeout, because lib/prisma.ts passes no datasource options.
- A process can also be suspended.

So the race is reachable, with low likelihood. It already exists at HEAD: HEAD writes the same payable proof, with refundAttempted false, under the same 5-minute gate (claims.ts 2363-2386).

It can also be resolved on the Claims side (see engine_guard_disposition). A quiescence instant of at least 60 minutes on every payable proof limits the race to a stall longer than that. This residual is of the same kind as the guard's own, since the guard also cannot see money moved outside the system during a stall.

The condition "cannot be resolved any other way" is therefore false. The design does not stop. The CONVERGENCE block withdraws R-D1 for round 13; the guard can go to the founder later as a separate engine decision.

- **Engine guard disposition:** WITHDRAWN for round 13 and replaced on the Claims side. lib/refund.ts stays byte-identical, with no exclusiveReason input and no E5b.

**Guard ordering proof, re-derived against refund.ts.** Each attempt runs charge read (755), then guard read (placed after 790), then insert (808), then create (836). If each guard misses the other attempt's insert, both charge reads come before both creates. Both attempts then compute the same key refund:<order>:<amount_refunded>, and the second insert fails with P2002. The proof holds except when amount_refunded changes between the two charge reads through something other than an engine create that holds the earlier reader's key.

**Claims-side rules that replace the guard:**
- **Q1, quiescence instant.** Every PROOF_PAYABLE_V13 text carries « payable au plus tôt le <ISO> (UTC) » = U + ATTEMPT_QUIESCENCE_MS.
  - U is the reconcile-marker timestamp in the pre-image, when it is readable.
  - Otherwise U is the instant already carried by a v13 pre-image, including one restored by a T2 revert.
  - Otherwise U is the write time. That is a valid upper bound, because every engine attempt begins with its T1 marker write, before any later pre-image exists.
  - ATTEMPT_QUIESCENCE_MS is a named constant of at least 60 min (the value of ENGINE_DEAD_MARGIN_MS), far above the roughly 4-minute Stripe budget of the pre-insert path.
- **Q2, enforcement.**
  - arbitrationRefusal(approve) refuses before the instant, with a revisable message that states it.
  - T1 returns already_handled without writing.
  - The guidance, the money label and the reconcile toast all state the instant.
  - An unreadable instant refuses approval.
- **Q3, kept from the procedure.**
  - T2(a) runs the stamped-row query immediately before executeRefund.
  - N8 re-runs the stamped query and writes with a CAS on the values it read.
  - T4 writes every post-engine claim update as a CAS on {id, 'refunding', M}, with M unique to the attempt.
  - claim_attempt_superseded fires when a superseded attempt returns ok or 202.

**Residual with the Claims-side rules:**
- **Same-claim double refund.** Needs an attempt whose pre-insert path (refund.ts 724-808) stays stalled longer than ATTEMPT_QUIESCENCE_MS, with a proof and a re-approval completed inside that window. Plausible causes are a DB read with no socket timeout or a suspended process. The REFUNDS lease is checked only at entry (claims.ts 504), so a closed lease does not stop the attempt.
- **Out-of-band money during a stall.** A Dashboard refund, an admin-rail refund, or attribution of an unstamped row while an attempt is stalled.
- **Dashboard refund in the T2 gap.** A Dashboard refund landing between T2's read and the engine's charge read.
- **Routed E2 race.** On a routed payment, a refund passes E2 just before a concurrent markRefundRowFailed.

**Residual with the guard itself, for comparison:**
- **Re-approval variant.** Covered whatever the stall length, except when the cursor moves between the two charge reads without an engine create. That happens with a Dashboard refund, with a failure followed by markRefundRowFailed renaming the key, or with an intermediate engine create whose own read came after a non-engine move (verifier P3).
- **Other variants.** Out-of-band money during a stall, the T2 gap and the routed variant stay open, just as they do without the guard.

**Net comparison.** The guard does not depend on stall length for one variant, at the cost of an engine change and a parity test across four callers. The Claims-side rules depend on stall length and change nothing in the engine. Both leave the out-of-band class open.

- **Webhook disposition:** The webhook has no event-level dedupe: POST sends refund.updated, refund.failed and charge.refund.updated straight to handleRefundStatusEvent (route.ts 118-120). Any 5xx makes Stripe redeliver and re-run the whole handler. None of the planned changes below counts as an engine change.

**(1) Failed or canceled event, row pending (985-996).**
- Planned: after the existing markRefundRowFailed and reconcileClaimForRefund, call markClaimsForRevertedRefundRow(failed_row). Return 503 only if a DB call inside it threw.
- Money writes: nothing added, nothing reordered.
- Redelivery: the row is now 'failed', so the pending branch is not entered again. markRefundRowFailed is idempotent anyway: status guard at 456, suffix guard at 463, alert inside the guard. Only the claim CAS helper runs.

**(2) Failed or canceled event, row already failed** (a redelivery, or a row marked failed by an engine resume at refund.ts 509).
- Planned: run only the helper.
- Do not re-run reconcileClaimForRefund here. Its CAS (claims.ts 1140-1146) does not check the refundError pre-image, so it could overwrite a later error.

**(3) Failed or canceled event, row succeeded (997-1006).**
- Planned: send the existing refund_failed alert first, then call helper(stripe_object), and return 503 if a DB call threw.
- The alert keeps dedupe key refund:<re>. sendOnce releases the dedupe only when the send did not go out (transactional-emails.ts 177-183). Its facts gain claimIds from a best-effort read.
- This branch writes no Refund row and no ledger entry today, and still writes none.

**(4) Status 'succeeded' branch (930-978).**
- No change, and no new 5xx.
- Any redelivery of this branch re-runs handleChargeRefunded, which writes ledger, loyalty, royalty and tip entries.

**Helper constraints.**
- It returns failed=true only when a DB call threw.
- No target, a lost CAS or a skip all mean failed=false and a 200 response.
- Its writes are updateMany calls on the exact pre-image.
- It never writes a Refund row, never calls the engine and never calls Stripe.

**Limit of the 503.** Redelivery narrows the gap but does not close it. Stripe retries for up to 3 days in live mode, but only a few times over a few hours in test mode, which is where the beta runs.

**CONVERGED RULE for detecting that a settled refund was reversed.**
- **(a) Event delivered:** steps (1) to (3) above.
- **(b) Event lost:** the ungated POST /api/admin/claims/[id]/reconcile admits a refunded claim with refundError null and a bound row on the claim's own order. Every read is read-only.
  - Bound row failed with an id: the local row is the evidence.
  - Bound row pending: read refunds.retrieve on the recorded id, else the tag in the PI list. These are the engine's own identity rules (refund.ts 335, 338-345), plus the PI anchor (claims.ts 1706-1710).
  - Bound row succeeded: read refunds.retrieve on the recorded id.
  - Stripe says failed or canceled: mark the claim only. The row is untouched: no key rename, no lock.
  - Succeeded, pending or requires_action: write nothing.
  - Absent within the idempotency window: write nothing, and return a distinct outcome whose toast is not the « toujours ABOUTI ou en attente » one.
  - Unreadable: retry.
  - Where the control lives: on the listUnfinalizedClaimRefundRows row for pending rows, and on listActionableRefundClaims for failed rows.
- **(c) Succeeded row whose event was never processed: nothing detects it.**
  - No surface, no alert, and the census cannot count it.
  - It cannot be fixed within the rules: a scheduled job is forbidden (R-D8), scripts may not call Stripe (R-D6), and writing the row from the webhook would change money truth.
  - This is REG-7, and it needs explicit founder acceptance as not fail-visible.
  - The only mitigation that avoids both the engine and a schedule is an operator-triggered read-only re-verify. That is a founder choice, not the default.
- **(d) C6 breach during the 503 window.** After a failure event has been received but before the marking is written (503 until redelivery), the customer still reads « Remboursée ». The spec must state this as a C6 breach bounded by redelivery.

### Binding rules

1. ENGINE CLOSED. lib/refund.ts is byte-identical in round 13: no exclusiveReason input and no E5b. R-D1 is superseded by the ROUND 13 CONVERGENCE block. Delete E5b from §0, §1, §2, §3 (engineRefusalOnReapproval and ownStampedRowIds), §9, §10 (the engine call and the E5b own-row copy), §18 and the docs addendum. Recompute under C5 every ENGINE WOULD ACCEPT field that answered NO only because of E5b. That protection now belongs in NEW MONEY ALLOWED (rules 3 and 4).
2. ENGINE MIRROR, first refusal wins, in refund.ts order.
(1) 404: no order (728).
(2) E1: paymentStatus not in {paid, reconcile_manual}, or no PI (734-738).
(3) E2: a row with status 'failed' AND a non-null stripeRefundId (744-750). A failed row without an id is not E2, and can still hold an E6 key.
(4) PI retrieve throws: 502/500 (753-758).
(5) E1b: pi.status is not succeeded (759).
(6) E1c: no latest_charge (760-761).
(7) E3: the oldest pending row by createdAt (765-780), through driveRefund (332-364) and finalizeRefund (506-570), including the resume clawback (532-548).
(8) E4 (786).
(9) E5 (788-790).
(10) E6: key refund:<orderId>:<amount_refunded>, rejected with P2002 (805-828).
(11) A create that throws leaves a pending row with no id (834-839).
Any refusal quoted to an operator is the first one the engine reaches on that state's facts. A payment with no charge is E1 or E1b, never E1c alone. Never write « aucun code ne sort une ligne de l’état échoué »: the update at 619-622 is unconditional. A parity test runs the real executeRefund on each mirrored refusal, including the 20-21 h band and the resume clawback at 21 h with no tagged reversal.
3. STALLED-ATTEMPT QUIESCENCE (replaces E5b). Every PROOF_PAYABLE_V13 text carries « payable au plus tôt le <ISO> (UTC) », computed as U + ATTEMPT_QUIESCENCE_MS. U is chosen in this order:
(1) the reconcile-marker timestamp in the pre-image, when readable;
(2) otherwise the instant carried by a v13 pre-image, including one a T2 revert restored;
(3) otherwise the write time.
ATTEMPT_QUIESCENCE_MS is a named constant of at least 60 min, pinned by a test. Enforcement: arbitrationRefusal(approve) refuses before the instant, with a REVISABLE message that states it; T1 returns already_handled and writes nothing; T2 checks it again. The guidance, the money label and the reconcile toast state the instant. An unreadable instant refuses approval, and reconcile re-derives it.
4. ATTEMPT TOKEN. The T1 marker M is unique per attempt: its ISO timestamp plus a random nonce. reconcileMarkerAge still parses the timestamp. After executeRefund returns, every claim write is updateMany where {id, status: 'refunding', refundError: M}; no prisma.claim.update remains in triggerClaimRefund. If the count is 0, write nothing to the claim. If the engine returned ok or 202, also send claim_attempt_superseded, deduped per claim and refund row. Its facts say this attempt created a refund row that the claim's current state does not reflect. The REFUNDS lease is checked only at entry (claims.ts 504), so no copy may say that closing the lease stops an attempt already in flight.
5. ONE REFUND, ONE CLAIM.
- Refund.reason is never written after creation. A source-scan test pins that only refund.ts 458, 513 and 619 update Refund rows.
- A binding that settles a claim on a row, making the claim 'refunded' with refundError null, is CREATED only in two ways: (a) the row's reason is claim:<thatClaim>; (b) inside the attribution transaction.
- Paths that APPLY an existing binding (webhook, recovery sweep, reconcile of a bound claim) are counted as non-terminal binders by that transaction.
- A legacy row bound to 2 or more claims without resume_mismatch returns ambiguous_binding: no write, and it is counted by the census.
- The customer status of such a claim is derived at read time as financial_verification (refundedRow null), never « Remboursée ».
6. SERIALIZABLE TRANSACTIONS. This applies to attribution's PROVEN write and to adoption's mirror insert. Use prisma.$transaction(async (tx) => ..., { isolationLevel: 'Serializable', maxWait <= 2000, timeout <= 5000 }).
The callback contains only:
- for attribution, the binder read (boundTo where, select id) and the FV→refunded updateMany;
- for adoption, the stamped-row read and the mirror insert.
Read Stripe evidence before the transaction. Write the audit, the alerts, the closure notice and the success toast only after a commit has been observed. Abort by throwing inside the callback. The timeout must stay far below innodb_lock_wait_timeout. The reason: adoption's read takes a shared lock on the order's Refund index range, and executeRefund rethrows any non-P2002 insert error (refund.ts 829).
7. LOST RACE. Catch every error from $transaction, not only P2034. That covers 1213 (surfaced as P2034), P2028 timeouts, ER_CHECKREAD 1020, and a connection lost during COMMIT. Then re-read the claim and report only what that read shows:
- bound to this row and refunded → « déjà appliqué », with no notice and no second audit;
- unchanged → « rien n’a été écrit »;
- the read fails → « état non établi — relisez la file ».
Vitest pins the call shape and the error mapping. The exactly-one outcome is rehearsed once with two real connections on a disposable MariaDB of the o2switch major version, with no Stripe call and no staging data.
8. T2 NEVER RESTORES A PRE-IMAGE NO EXIT ACCEPTS (V-A-1). After steps (a), (b), (b') and (c), T2 runs deriveNoRowOutcome on the fresh facts for every pre-image, null or v13. Then:
- payable, and past the quiescence instant for a v13 pre-image → call executeRefund;
- locked or awaiting proof → write it, with refundAttempted false and a claim_payment_blocked alert;
- park → financial_verification;
- revert to the pre-image only on transient unreadability or unconfirmed_within_window.
The 'awaiting_other_row' revert is deleted.
9. WEBHOOK.
- In handleRefundStatusEvent, the calls and their order stay byte-identical for handleChargeRefunded, finalizeRefundRowFromStripe, markRefundRowFailed and reconcileClaimForRefund.
- The 'succeeded' status branch gets no new 5xx.
- New code goes only in the failed/canceled branch, after that branch's existing writes.
- markClaimsForRevertedRefundRow returns failed=true only when a DB call threw, and that answers 503. No target, a lost CAS or a skip returns failed=false and answers 200.
- On a redelivery where the row is already 'failed', only the helper runs: not reconcileClaimForRefund, not markRefundRowFailed.
- The helper writes Claim rows only, with updateMany on the exact pre-image. It never writes a Refund row, calls the engine or calls Stripe.
- Evidence: stripe_object needs a 'succeeded' row whose stripeRefundId equals the event's refund id. failed_row needs a 'failed' row with an id. pending_row_stripe needs a 'pending' row with a matching id or grubano_refund_row tag, and refund.payment_intent equal to the order's PI.
10. REVERSAL EXIT. POST /api/admin/claims/[id]/reconcile stays ungated. It admits a claim with status refunded, refundError null, and a bound row on the claim's own order that is failed with an id, pending, or succeeded.
- Reads are read-only: retrieve by the recorded id, otherwise the tag in the PI refund list.
- It writes only the claim marker, and only when Stripe reports failed/canceled or the row is failed with an id.
- Each no-write outcome has its own toast. absent_within_window never reuses « toujours ABOUTI ou en attente ».
- The control appears on listUnfinalizedClaimRefundRows (pending rows) and listActionableRefundClaims (failed rows), with reconcilable equal to the server gate.
11. NOT FAIL-VISIBLE MUST BE SAID. REG-7 is a refunded claim on a 'succeeded' row whose failure event was never processed. Present it to the founder as NOT fail-visible and needing explicit acceptance: no surface, no alert, and the census cannot count it. Never present it as a compliant registry entry. The window between a received failure event and a written marking lasts from the 503 until redelivery, and Stripe test mode retries only a few times over a few hours. State that window as a C6 breach bounded by redelivery. [FREEZE: SUPERSEDED for E-09 / REG-7 by AMF-1; the E-08 bounded-window statement stands.]
12. NO SCHEMA CHANGE.
- No @@unique on Claim.refundId, and none on Refund (orderId, reason).
- Timestamps and markers go into the Claim.refundError text, parsed with a regex literal as reconcileMarkerAge does.
- Closure-notice eligibility is the AdminAuditLog row that this build's closing route writes in the same request. If recordAdminAudit returns false, the claim is not eligible and stays listed.
- No deploy-epoch constant. [FREEZE: the AdminAuditLog eligibility clause is SUPERSEDED by AMF-2 / H05 (EmailDispatch claim_closure_record).]
13. C3 ALERTS. A write by this build can leave a claim in a state whose only exits are gated or time-based. Examples: a v13 payable proof, a T2 revert, a locked or awaiting proof. Every such write sends sendAdminMoneyReviewAlert at write time, deduped per claim and prefix, unless the registry names an explicit founder waiver for it. The check-flags line and the phase2 rehearsal residue are not per-claim alerts.
14. RESIDUAL TEXT. docs/ops/REFUND-FINANCIAL-CONTRACT.md and the race test's it.skip reasons state these residuals verbatim:
- a same-claim double refund when an attempt's pre-insert path (refund.ts 724-808) stays suspended longer than ATTEMPT_QUIESCENCE_MS while a proof and a re-approval happen;
- a refund outside the system (Dashboard, admin rail, or attribution of an unstamped row) during a stalled attempt;
- a Dashboard refund between T2's read and the engine's charge read (refund.ts 755);
- E2 passed just before a concurrent markRefundRowFailed on a routed payment, which can reverse the restaurant transfer twice.

# SECTIONS A–J

## A. AUTHORITATIVE STATE TABLE

One rule per Claims money state. Engine answers are recomputed against lib/refund.ts byte-identical (no exclusiveReason, no E5b) under C5. Every state names an evidence exit or its FAIL CLOSED + FAIL VISIBLE registry entry (REG-n). Abbreviations are fixed by A-S00.

IMPLEMENTATION NOTE (W1): ER-M06 — Section A has no row for the canonical 202 outcome; the D1 note registers it: claim refunding, bound to its own stamped row pending at Stripe, refundError null (ENGINE E3 / resume YES; exits: the webhook, or reconcile 'bound'; the customer reads « remboursement en cours » only while boundRowShowsInProgress). The resolved wordings of ER-M04 (J-M04 note), ER-C24 (A-S07, A-S31d notes) and ER-R27 (A-S01 note) are the ones to implement, not the superseded text of the rows below.

### A-S00 [CORE] Conventions used by every A rule
ENGINE = executeRefund({orderId, amountCents: requested, reason: claim:<id>}) on the state's facts, lib/refund.ts unchanged, before any Claims guard. Steps in order: 404 (728); E1 paymentStatus∉{paid,reconcile_manual} or no PI 409 (734-738); E2 row failed AND stripeRefundId not null 409 (744-750); PIX PI retrieve throw 502 (753-758); E1b pi.status≠succeeded 409 « Paiement non débité — rien à rembourser. » (759); E1c no latest_charge 502 (760-761, quoted only when E1/E1b do not fire first); E3 oldest pending row by createdAt → driveRefund/finalizeRefund incl. resume clawback (765-780, 332-364, 506-570); E4 refundable≤0 409 (786); E5 400 (788-790); E6 key refund:<orderId>:<amount_refunded> held → P2002 409 « Un remboursement est déjà en cours sur ce montant cumulé. » (805-828); CX create throw after insert → row pending without id, 502 (834-839). Adoption mirror keys are external:<re_id> (claims.ts 2196) and never collide at E6. | CUSTOMER keys: FVc = claims.status.financial_verification (fr « Votre demande nécessite une vérification manuelle par notre équipe. » / en « Your request requires a manual check by our team. » / es « Su solicitud requiere una verificación manual por parte de nuestro equipo. » / it « La Sua richiesta richiede una verifica manuale da parte del nostro team. » / ar « يتطلب طلبك تحققًا يدويًا من فريقنا. »); RFc = claims.status.refunded (Remboursée / Refunded / Reembolsada / Rimborsata / تم رد المبلغ); APc = claims.status.approved (« Approuvée — remboursement en attente de traitement » + existing 4 locales); CBS = claims.status.closed_by_support; RUc = claims.status.refund_unconfirmed (Track B). Every customer field means: shown while CLAIMS_ENABLED is on, nothing while it is off. | ALERT-B = sendAdminMoneyReviewAlert kind 'claim_payment_blocked', title « Réclamation non payée par le rail — décision admin requise », dedupe claim_blocked:<claimId>:<refundError prefix>, best-effort, sent after a successful CAS only. ALERT-FV = 'claim_financial_verification' on entry and on relabel with a NEW reason (claim_fv:<id>:<reason>). ALERT-S = 'claim_attempt_superseded' (claim_attempt:<claimId>:<refundRowId>). | Q-INSTANT = « payable au plus tôt le <ISO> (UTC) » = U + ATTEMPT_QUIESCENCE_MS (≥ 60 min), U per the binding quiescence rule. | T2 = T1 pre-image CAS; (a) own stamped row; (b) transient unreadable → revert pre-image + ALERT-B; (b') permanent unreadable → SAFETY_HOLD; (c) holds H1/H2/H3/H5 → SAFETY_HOLD; (e') deriveNoRowOutcome for EVERY pre-image (null or v13): payable (+ past Q-INSTANT for v13) → engine; locked/awaiting → write proof, refundAttempted false, ALERT-B; park → FV; no_write unconfirmed_within_window → revert + ALERT-B. 'awaiting_other_row' does not exist. T4 = every post-engine claim write is updateMany where {id, status 'refunding', refundError: M}. | E2 SENTENCE (replaces « aucun code ne sort… définitif »): « la ligne ${ids} est ÉCHOUÉE avec un identifiant Stripe : le moteur refuse tout remboursement sur une commande qui porte une telle ligne, et aucune action des réclamations ne modifie cette ligne. » | REG-n = registry entries (registry updated per the notes).
IMPLEMENTATION NOTE (W8): the ENGINE convention is exercised against the real lib/refund.ts on every state — tests/claims-r13-no-false-exit.test.ts drives arbitrateClaim → T1 → T2 → executeRefund on each J-M01 world with every D1 pre-image, both leases open, and checks that an engine refusal quoted in a rendered text is the step the table names (ENGINE_QUOTES of tests/fixtures/claims-r13-states.ts). The CUSTOMER keys FVc, RFc (5 locales) and APc (fr) are read out of this row and compared with messages/*.json claims.status by tests/claims-r13-residuals.test.ts; a customer status « refunded » is rendered only after an engine success on the claim's own row or a succeeded Stripe refund read for its bound row (J-M28 run).

### A-S01 [CORE] No Stripe refund at all — v13 payable proof
STRIPE: pi succeeded; charge 2000, captured 2000, not disputed, amount_refunded 0; the complete list has no refund in any status. | DB REFUNDS: none, or only failed rows without id whose keys ≠ refund:o:0 (a key-holding one is A-S01b). | CLAIM: approved, refundAttempted false, refundId null, 'no_refund_proven:v13: '+HEAD_A+PAYABLE tail+Q-INSTANT. | ENGINE ACCEPTS A NEW REFUND: YES (E1-E5 pass, E6 refund:o:0 free → create). | ENGINE RESUMES: NO (no pending row). | SAFE EXIT: after Q-INSTANT, approve (arbitrate route, CLAIMS lease; triggerClaimRefund, REFUNDS lease) → T1 → T2 (e') re-derives on fresh reads → engine. Before Q-INSTANT, approve is refused with the C4 REVISABLE text stating the instant and T1 returns already_handled. reconcile (i) re-proves at any time. refuse_final refused (AM-B3); stuck_close refused; sweep skips. While a lease is closed or before Q-INSTANT: FAIL CLOSED + FAIL VISIBLE E-10. | NEW MONEY: YES only via re-approval past Q-INSTANT with both leases open and T2 passing. | CUSTOMER: FVc. | ADMIN: detail HEAD_A « Stripe ne rapporte aujourd’hui aucun remboursement abouti ni en attente sur ce paiement (liste complète lue). » + PAYABLE tail + « payable au plus tôt le <ISO> (UTC) ». Toast said.no_refund_proven (F14 text, with the instant). moneyState absence_proven_payable (F15 classification: the 'no_refund_proven:v13:' prefix only), which renders the F15 GUIDANCE « Rien à clôturer : approuvée et non payée ; à la preuve, Stripe ne rapportait aucun remboursement non expliqué. … » and the F15 MONEY label « Aucun remboursement non expliqué rapporté par Stripe à la preuve (liste complète lue) — approuvée, non payée. … au plus tôt le ${instant} (UTC), relue avant le moteur ». None of these texts says that no refund moved money: never « jamais déplacé », « n’a déplacé d’argent » or « Absence de remboursement PROUVÉE » (G2, J-M31). | RECONCILIATION: N0 loadOrderMoneyFacts → N1-N7 pass → N8 payable → refund.count {orderId, reason claim:<id>} = 0 → CAS on read values → PROOF_PAYABLE_V13; ALERT-B (prefix no_refund_proven:v13:, C3). No engine, no Stripe write.
IMPLEMENTATION NOTE (W1): ER-R27 — the GUIDANCE and MONEY label quoted in ADMIN read « … aucun remboursement abouti ou en attente non expliqué … » (F15 note); the unqualified wording above is superseded.

### A-S01b [CORE] No Stripe refund, legacy failed row WITHOUT id still holds the cursor key (split from S01, verifier A)
STRIPE: amount_refunded 0; no refund on the list. | DB REFUNDS: row failed, stripeRefundId null, idempotencyKey refund:o:0 (never renamed: only markRefundRowFailed renames, and it always writes an id). | CLAIM: approved, refundAttempted false, refundId null, 'no_refund_proven_rail_locked: '+HEAD_A+LOCKED(E6). | ENGINE ACCEPTS A NEW REFUND: NO (E2 does not fire: no id; E6 refund:o:0 held → P2002 409). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile (i) (E6 ceases only if the cursor moves) + stuck_close; approve refused REVISABLE (2); sweep skips. FAIL CLOSED + FAIL VISIBLE REG-1. | NEW MONEY: NO (approve refused). | CUSTOMER: FVc. | ADMIN: HEAD_A + « MAIS une nouvelle approbation ne paierait pas cette réclamation : » + E6 sentence naming the failed row + LOCKED tail; toast said.no_refund_proven_rail_locked; guidance refund_error_recorded. | RECONCILIATION: N8 E6 mirror checks every row's idempotencyKey regardless of status → locked CAS + ALERT-B. Pin: fixture failed-without-id holding the key → locked, never payable.

### A-S02 [CORE] Proof of absence where all Stripe money is explained by other settled claims (P1-3)
STRIPE: charge 2000, amount_refunded 300; list [re_O succeeded 300]; Σsucc ≤ 300 ≤ Σstanding. | DB REFUNDS: rf_o succeeded re_O key refund:o:0; binders = exactly one claim cl_X refunded, refundError null; rf_o.reason absent or claim:cl_X; no pending row; no failed row with id; no row holds refund:o:300. | CLAIM: approved, refundAttempted false, refundId null, 'no_refund_proven:v13: '+HEAD_B+PAYABLE+Q-INSTANT. | ENGINE ACCEPTS A NEW REFUND: YES (E4 1700>0, E5 pass, E6 refund:o:300 free). | ENGINE RESUMES: NO. | SAFE EXIT: as A-S01 (REG-8 while gated or before Q-INSTANT). Attribution of rf_o → 409 bound_to_other_claim inside the Serializable transaction; adoption refuses an owned refund. | NEW MONEY: YES as A-S01; the new refund is a new row stamped claim:<id>, never rf_o. | CUSTOMER: FVc. | ADMIN: HEAD_B « Stripe rapporte 300 c remboursés sur ce paiement, et chacun de ses remboursements aboutis ou en attente est rattaché à une AUTRE réclamation, soldée sur sa ligne : re_O (ligne rf_o, réclamation cl_X, liaison seule), 300 c. Aucun n’est rattaché à celle-ci. » + PAYABLE tail + instant. | RECONCILIATION: N3 explanation rule → N4 → N8 payable CAS + ALERT-B.

### A-S03 [CORE] Row succeeded here for another claim, failed at Stripe, key held (P1-1, P1-4, P1-7, P3-22)
STRIPE: retrieve(re_O) failed|canceled on the order PI; amount_refunded 0; re_O not standing. | DB REFUNDS: rf_o succeeded re_O key refund:o:0 (webhook leaves it, route.ts 997-1006); reason not claim:<this>. | CLAIM: approved, refundAttempted false, refundId null, 'no_refund_proven_rail_locked: '+HEAD_A+LOCKED(E6 + ' De plus, ' + H1 reverted + ROUTED). | ENGINE ACCEPTS A NEW REFUND: NO (E6 refund:o:0 held by rf_o). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile (i) + stuck_close; approve refused REVISABLE (2); sweep skips. FAIL CLOSED + FAIL VISIBLE REG-1. | NEW MONEY: NO (approve refused; T2 H1 would also hold). | CUSTOMER: FVc. | ADMIN: E6 sentence + « De plus, » + H1 « la ligne rf_o est marquée ABOUTIE dans notre base, mais Stripe ne la compte pas sur ce paiement (son remboursement re_O est « failed » chez Stripe) ; notre base la compte toujours comme remboursée et aucune action de l’application n’est prévue pour la corriger ; l’approbation est refusée par sûreté (blocage de sûreté, pas un refus du moteur). » + ROUTED + LOCKED tail; toast said.no_refund_proven_rail_locked; MONEY_LABEL refund_error_recorded. Never « jamais déplacé », never « relèvent d’AUTRES réclamations ». | RECONCILIATION: refundRowTruth(absenceIsEvidence) → reverted → succeededNotCounted → N8 locked CAS + ALERT-B.

### A-S04 [CORE] Row succeeded here, failed at Stripe, key free — safety hold H1
STRIPE: re_O failed|canceled; amount_refunded 0. | DB REFUNDS: rf_o succeeded re_O key refund:o:500; no row holds refund:o:0; reason not claim:<this>. | CLAIM: approved, refundAttempted false, refundId null, 'no_refund_proven_rail_locked: '+HEAD_A+LOCKED(H1 reverted + ROUTED). | ENGINE ACCEPTS A NEW REFUND: YES (E1-E6 pass; with reverse_transfer when routed, 355-363). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile (i) + stuck_close; approve refused (2); sweep skips. REG-1. A later claim on the order is held at T2(c) H1. | NEW MONEY: NO (H1 is Claims-side; approve refused). | CUSTOMER: FVc. | ADMIN: H1 sentence + ROUTED + LOCKED tail. | RECONCILIATION: N8 locked CAS + ALERT-B.

### A-S05a-1 [CORE] No-row branch: succeeded row whose refund Stripe does not know on this payment, key free
STRIPE: PI and complete list readable; retrieve(re_X) 404 and L omits re_X, or re_X.payment_intent ≠ order PI; amount_refunded 0. | DB REFUNDS: row succeeded re_X key refund:o:500, reason null or claim:<other>. | CLAIM: approved, refundAttempted false, refundId null, locked +H1 absent|other_payment (no ROUTED). | ENGINE ACCEPTS A NEW REFUND: YES (E6 refund:o:0 free). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile (i) + stuck_close; REG-1. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: H1 with how absent « son remboursement re_X est introuvable parmi les remboursements de ce paiement, lus en entier avec la clé qui lit ce paiement » or other_payment « son remboursement re_X porte sur un autre paiement ». | RECONCILIATION: not_on_payment → succeededNotCounted → N8 locked CAS + ALERT-B.

### A-S05a-2 [CORE] As A-S05a-1, row holds the cursor key
STRIPE: as A-S05a-1. | DB REFUNDS: row succeeded re_X key refund:o:0. | CLAIM: locked E6 + ' De plus, ' + H1. | ENGINE ACCEPTS A NEW REFUND: NO (E6). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile (i) + stuck_close; REG-1. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: E6 sentence + « De plus, » + H1. | RECONCILIATION: as A-S05a-1.

### A-S05b-1 [CORE] Mine/bound succeeded row unreadable with this server's key (wrong key or mode)
STRIPE: retrieve 404/401 and PI retrieve throws with this key. | DB REFUNDS: row succeeded re_X; stamped claim:<this> or unstamped and bound. | CLAIM: FV stripe_refund_contradiction, refundId kept. | ENGINE ACCEPTS A NEW REFUND: NO (PIX 502). | ENGINE RESUMES: NO (PIX precedes E3). | SAFE EXIT: reconcile after the key/mode fix → A-S23a-1/A-S24-1/A-S05b-2/A-S05c-2a/A-S05c-2b. No declaration (FV); activeOrderKey held. FAIL CLOSED + FAIL VISIBLE REG-3 (time-bound). | NEW MONEY: NO (FV). | CUSTOMER: FVc. | ADMIN: « La ligne rf est marquée ABOUTIE et enregistre le remboursement Stripe re_X, que Stripe ne connaît pas avec la clé de ce serveur. Vérifiez que cette clé est celle du compte et du mode (test / live) où il a été créé, puis relancez la réconciliation ; sinon, anomalie de données à instruire. Aucune conclusion tirée. » | RECONCILIATION: applyRowTruth contradiction park (ALERT-FV); re-runs relabel same reason or N1 no-write.

### A-S05b-2 [CORE] Mine/bound: right key, succeeded row's id unknown or on another PI, row holds the cursor
STRIPE: PI readable, amount_refunded 0; retrieve 404 or other PI. | DB REFUNDS: row succeeded key refund:o:0; stamped claim:<this> or unstamped bound. | CLAIM: FV stripe_refund_contradiction. | ENGINE ACCEPTS A NEW REFUND: NO (E6 refund:o:0 held, both variants). | ENGINE RESUMES: NO. | SAFE EXIT: STAMPED: every reconcile takes the mine path → relabel; attribution 409; REG-3 permanent (founder acceptance list). UNSTAMPED: next reconcile of the FV claim runs the no-row branch → not_on_payment → H1 + E6 → locked proof, refundId null → REG-1 (reconcile + stuck_close). | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: §6 404 or other-PI text « Le remboursement Stripe re_X, enregistré comme ABOUTI sur la ligne rf, ne porte pas sur le paiement de cette commande. Anomalie de données à instruire. Aucune conclusion tirée. »; unstamped after the second reconcile: A-S05a-2 copy. | RECONCILIATION: contradiction park; unstamped re-run N0-N8 locked CAS + ALERT-B.

### A-S05c-1 [CORE] As A-S05b-1, other refunds moved the cursor
STRIPE: PI unreadable with this key; true amount_refunded N>0. | DB REFUNDS: row succeeded key refund:o:0. | CLAIM: FV stripe_refund_contradiction. | ENGINE ACCEPTS A NEW REFUND: NO (PIX). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile after key fix → A-S05c-2a/A-S05c-2b/A-S23a-1/A-S24-*; REG-3 time-bound. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: as A-S05b-1. | RECONCILIATION: as A-S05b-1.

### A-S05c-2a [CORE] Right key; UNSTAMPED bound succeeded row unknown/other PI; cursor moved
STRIPE: amount_refunded N>0 from other standing refunds; retrieve 404 or other PI. | DB REFUNDS: row succeeded key refund:o:0, unstamped; refund:o:N free. | CLAIM: FV stripe_refund_contradiction, refundId kept. | ENGINE ACCEPTS A NEW REFUND: YES (E6 refund:o:N free). | ENGINE RESUMES: NO. | SAFE EXIT: next reconcile runs the no-row branch: others explained → H1 locked proof (REG-1); any unexplained → N5 park (REG-3, attribute/adopt). | NEW MONEY: NO (FV, then approve refused). | CUSTOMER: FVc. | ADMIN: §6 text; then HEAD_B+LOCKED(H1) or DETAIL_UNATTRIBUTED. | RECONCILIATION: contradiction park; FV re-run N0-N8 + ALERT-B or ALERT-FV.

### A-S05c-2b [CORE] As A-S05c-2a, row stamped claim:<this>
STRIPE: as A-S05c-2a. | DB REFUNDS: row succeeded reason claim:<this> key refund:o:0; refund:o:N free. | CLAIM: FV stripe_refund_contradiction. | ENGINE ACCEPTS A NEW REFUND: YES (no E5b; E6 refund:o:N free). | ENGINE RESUMES: NO. | SAFE EXIT: FAIL CLOSED + FAIL VISIBLE REG-3 permanent (founder acceptance list): mine path relabels; attribution 409 contradiction; adoption stamped count >0 → 409; no declaration; activeOrderKey held. | NEW MONEY: NO (status FV; any later re-approval meets T2(a) own_row_exists). | CUSTOMER: FVc. | ADMIN: §6 text. | RECONCILIATION: contradiction relabel, same reason, no new alert.

### A-S06a [CORE] Failed Stripe refund whose row locks the engine — no-row lock
STRIPE: the row's refund failed|canceled; other money none or explained. | DB REFUNDS: row failed with stripeRefundId, key ':failed:re_…'. | CLAIM: approved, refundAttempted false, refundId null, 'no_refund_proven_rail_locked: '+HEAD+LOCKED(E2 SENTENCE + ROUTED). | ENGINE ACCEPTS A NEW REFUND: NO (E2 on every call). | ENGINE RESUMES: NO (E2 precedes E3). | SAFE EXIT: reconcile (i) + stuck_close; attribution 409 row_failed; REG-1. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: E2 SENTENCE (A-S00) + ROUTED + LOCKED tail; the LOCKED tail says « une cause qui ne dépend pas d’une action ultérieure ne cessera pas » instead of « dite définitive ». | RECONCILIATION: N8 locked CAS + ALERT-B; refund_failed alert only if markRefundRowFailed ran.

### A-S06b [CORE] Failed Stripe refund on the claim's own/bound row — stripe_failed
STRIPE: failed|canceled. | DB REFUNDS: bound row failed with id. | CLAIM: approved, refundId row, stripe_failed text. | ENGINE ACCEPTS A NEW REFUND: NO (E2). | ENGINE RESUMES: NO. | SAFE EXIT: stuck_close only; approve PERMANENT (3); FAIL CLOSED + FAIL VISIBLE REG-2. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: stripe_failed text + guidance stripe_failed. | RECONCILIATION: applyRowTruth row_terminal failed or reconcileClaimForRefund → CAS + ALERT-B.

### A-S07 [CORE] Oldest pending row's Stripe refund failed/canceled, row not yet marked
STRIPE: failed|canceled (recorded id or tag). | DB REFUNDS: row pending (oldest). | CLAIM: no-row: locked with E3 failed_at_stripe + ROUTED. Own/bound: approved, refundId row, stripe_failed, row stays pending. | ENGINE ACCEPTS A NEW REFUND: NO (E3 → markRefundRowFailed 409; E2 afterwards). | ENGINE RESUMES: YES (resume ends in the lock). | SAFE EXIT: no-row: reconcile (i) + stuck_close, REG-1. Own/bound: stuck_close, approve PERMANENT (3), REG-2. Attribution 409, no write. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: « …la plus ancienne ligne en attente de la commande, rf_fail, est reprise par le moteur avant tout nouveau remboursement ; son remboursement Stripe a ÉCHOUÉ ou a été annulé : si le moteur la reprend, il la marquera en échec, ce qui verrouille la commande. » + ROUTED; no H2. | RECONCILIATION: N8 locked CAS / applyRowTruth at_stripe failed + ALERT-B.
IMPLEMENTATION NOTE (W1): ER-C24 — the conditional reads « si le moteur reprend cette ligne (il reprend la plus ancienne ligne en attente d’une commande avant tout nouveau remboursement) » (F16 note): round10's PROMISES pin /la reprend/i scans lib/claims.ts. The « si le moteur la reprend » wording above is superseded.

### A-S08a [CORE] External failed/canceled refund owning no row, routed
STRIPE: re_D failed|canceled untagged; routed. | DB REFUNDS: no row owns re_D. | CLAIM: locked H2 + ROUTED. | ENGINE ACCEPTS A NEW REFUND: YES (E2 reads local rows only). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile (i) + stuck_close; REG-1. | NEW MONEY: NO (H2, approve refused). | CUSTOMER: FVc. | ADMIN: H2 « sur ce paiement routé, Stripe rapporte un remboursement « ${status} » (re_D) qui ne correspond à aucune ligne de notre base ; le moteur ne le voit pas, et l’approbation est refusée par sûreté (blocage de sûreté). » + ROUTED. | RECONCILIATION: N8 locked CAS + ALERT-B.

### A-S08b [CORE] External failed/canceled refund owning no row, non-routed
STRIPE: as A-S08a, routed false. | DB REFUNDS: no row owns re_D. | CLAIM: v13 payable (HEAD_A or HEAD_B) + Q-INSTANT. | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: as A-S01 (REG-8). | NEW MONEY: YES as A-S01. | CUSTOMER: FVc. | ADMIN: A-S01 copy. | RECONCILIATION: N8 payable CAS + ALERT-B.

### A-S09a [CORE] Refund explained by another settled claim still pending at Stripe, row pending (legacy-reachable)
STRIPE: re_P pending|requires_action. | DB REFUNDS: rf_P pending; single refunded binder cl_Z (legacy bind-first only). | CLAIM: FV refund_moved_unattributed, N7 in-flight detail. | ENGINE ACCEPTS A NEW REFUND: NO (E3 → 202). | ENGINE RESUMES: YES. | SAFE EXIT: exit by time: reconcile once re_P terminal → A-S10b/A-S10c/A-S02/A-S07/A-S06a. Attribution 409; adoption refuses non-succeeded. REG-3 time-bound. | NEW MONEY: NO (FV). | CUSTOMER: FVc. | ADMIN: « Stripe rapporte 800 c remboursés sur ce paiement ; re_P est rattaché à une AUTRE réclamation (re_P → cl_Z) mais encore EN ATTENTE chez Stripe : aucune conclusion pour cette réclamation avant qu’il soit terminal. Relancez alors « Réconcilier d’après la preuve ». » | RECONCILIATION: N7 park, ALERT-FV.

### A-S09b [CORE] Row succeeded here that Stripe reports pending (data anomaly)
STRIPE: retrieve pending|requires_action; counted in amount_refunded. | DB REFUNDS: row succeeded, key ≠ cursor; single refunded binder cl_Z. | CLAIM: FV refund_moved_unattributed, N7 detail. | ENGINE ACCEPTS A NEW REFUND: YES (no pending row; E6 free). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile when Stripe is terminal; REG-3 time-bound; a later first approval holds on H1 pending_at_stripe. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: as A-S09a. | RECONCILIATION: contradiction tagged pending_at_stripe → succeededNotCounted → N7 park.

### A-S10 [CORE] Succeeded Stripe refund, incomplete finalization — THIS claim's row
STRIPE: refund of rf (claim:<this>) succeeded. | DB REFUNDS: rf pending (lost response or clawback failure). | CLAIM: refunded, refundId rf, refundError null, activeOrderKey null; outcome refunded {stripe_read, amount}; alert claim_refunded_row_unfinalized. | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES (same refund; non-clawback finalizes; clawback variant may refuse 409 ResumeIdempotencyExpired(row:clawback) or 502 on every call, then rf stays pending). | SAFE EXIT: terminal refunded (money moved). Unfinalized-rows list offers « Réconcilier d’après la preuve » (reconcileRefusal iii) → R0b: succeeded/pending → refund_still_standing; within window → unconfirmed_within_window (existing toast, not « toujours ABOUTI »); failed → A-S31d. Later claim on the order: T2(e') → A-S30e-1/A-S30e-2. | NEW MONEY: NO (refunded terminal). | CUSTOMER: RFc. | ADMIN: alert « Réclamation … soldée d’après Stripe — ligne de remboursement … encore en attente »; unfinalized caption « La seule action proposée ici est « Réconcilier d’après la preuve » : elle relit ce remboursement chez Stripe et ne déplace aucun argent. » | RECONCILIATION: applyRowTruth at_stripe succeeded; later R0b read-only.

### A-S10b [CORE] Another claim's pending row succeeded at Stripe, no settled-royalty clawback
STRIPE: re_A succeeded; money explained. | DB REFUNDS: rf_A pending oldest; royaltyRefundCents 0 or royalty not settled|settling; single refunded binder cl_A. | CLAIM: approved, refundAttempted false, refundId null, AWAITING_FINALIZATION + HEAD_B + AWAITING tail. | ENGINE ACCEPTS A NEW REFUND: NO (E3 finalizes rf_A, ok resumed:true). | ENGINE RESUMES: YES. | SAFE EXIT: reconcile (i) once rf_A is no longer pending → A-S02; stuck_close meanwhile; approve refused (2). If rf_A never finalizes the state persists: REG-1 (declaration exit stays). | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: AWAITING text « …rf_A (identité claim:cl_A)…: son remboursement Stripe re_A est ABOUTI mais la ligne n’est pas finalisée ici ; le moteur finaliserait cette ligne, pas un remboursement de cette réclamation, tant qu’elle reste en attente. Relancez « Réconcilier d’après la preuve » lorsque cette ligne ne sera plus « en attente »… »; toast awaiting. | RECONCILIATION: N8 AWAITING CAS + ALERT-B.

### A-S10c [CORE] Another claim's pending row succeeded at Stripe, settled-royalty clawback
STRIPE: rf_A's refund succeeded. | DB REFUNDS: rf_A pending, royaltyRefundCents>0, royalty settled|settling. | CLAIM: locked (not AWAITING) E3 succeeded_at_stripe_clawback. | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES (may finalize or refuse forever). | SAFE EXIT: reconcile (i) (→ A-S02 once finalized) + stuck_close; REG-1. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: §9 clawback sentence + LOCKED tail. | RECONCILIATION: N8 locked CAS + ALERT-B.

### A-S11 [CORE] Dead pending row without id (≥ 21 h) or engine list truncated
STRIPE: no tagged refund, list complete; or >100 refunds with the oldest row id-less. | DB REFUNDS: row pending, no id. | CLAIM: no-row: locked E3 dead/truncated. Own/bound: approved + engine_row_dead. | ENGINE ACCEPTS A NEW REFUND: NO (E3 ResumeIdempotencyExpired 409 / ResumeListUnavailable 502). | ENGINE RESUMES: YES (never creates). | SAFE EXIT: no-row: reconcile (i) + stuck_close, REG-1. Own/bound: stuck_close, approve PERMANENT (3), REG-2. Attribution 409. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: §9 dead / truncated sentences (« aucun code de l’application ne retire cette ligne »). | RECONCILIATION: N8 locked CAS / applyRowTruth absent_dead + ALERT-B.

### A-S12 [CORE] Pending row without id inside the idempotency window (< 20 h)
STRIPE: no tagged refund yet. | DB REFUNDS: row pending, no id, age < 20 h. | CLAIM: unchanged; reconcile outcome unconfirmed_within_window {until createdAt+21 h}. At T2(e'): revert pre-image + ALERT-B. | ENGINE ACCEPTS A NEW REFUND: NO (E3 re-sends create under the row key). | ENGINE RESUMES: YES. | SAFE EXIT: exit by time: reconcile (or re-approve) after `until` → A-S12b/A-S11/A-S07/A-S09a/A-S10/A-S10b/A-S10c. The claim stays in its bucket (REG-3 FV, REG-4 marker, REG-1 lock, REG-8 approved). | NEW MONEY: NO. | CUSTOMER: FVc (or APc for an approved null pre-image). | ADMIN: toast « … Conclusion possible à partir du <date> : relancez alors la réconciliation. » | RECONCILIATION: N7 no-write / applyRowTruth absent_within_window.

### A-S12b [CORE] Pending row without id, 20 h ≤ age < 21 h
STRIPE: no tagged refund. | DB REFUNDS: row pending, no id. | CLAIM: unchanged; unconfirmed_within_window. | ENGINE ACCEPTS A NEW REFUND: NO (E3 ResumeIdempotencyExpired 409). | ENGINE RESUMES: YES (refuses). | SAFE EXIT: exit by time → A-S11 or the Stripe state reached. | NEW MONEY: NO. | CUSTOMER: as A-S12. | ADMIN: as A-S12. | RECONCILIATION: as A-S12.

### A-S13a [CORE] Pending row's recorded id unknown to Stripe (404)
STRIPE: retrieve(re_X) 404. | DB REFUNDS: row pending with re_X. | CLAIM: FV stripe_refund_contradiction. | ENGINE ACCEPTS A NEW REFUND: NO (E3 retrieve throws → 502 every call). | ENGINE RESUMES: YES (fails). | SAFE EXIT: reconcile after key/mode fix; if the key is right, data anomaly, permanent. REG-3. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: « La ligne rf enregistre le remboursement Stripe re_X, que Stripe ne connaît pas avec la clé de ce serveur. … Aucune conclusion tirée. » | RECONCILIATION: N6 / applyRowTruth park, ALERT-FV.

### A-S13b [CORE] Pending row's recorded id is a refund on another PaymentIntent
STRIPE: retrieve returns a refund whose payment_intent ≠ the order PI. | DB REFUNDS: row pending with that id. | CLAIM: FV stripe_refund_contradiction. | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES. driveRefund retrieves the recorded id with no PaymentIntent check (refund.ts 334-335), then by the foreign refund's status:
- failed/canceled → markRefundRowFailed → 409; E2 on every later call.
- pending → 202, row stays pending.
- succeeded → finalizeRefund:
  (a) royalty clawback: when the order's FranchiseRoyalty is settled|settling, row.royaltyRefundCents > 0 and the settlement transfer is locatable, transfers.createReversal MOVES MONEY from the franchisor (524-559). On this resume path a reversal tagged with the row is adopted instead; with none, ≥ 20 h → 409 ResumeIdempotencyExpired(row:clawback); a reversals list unavailable or truncated → 502; a reversal failure → 502 with the row left pending;
  (b) ledger: resolveFeeTruth lists only the refunds of the ORDER's PaymentIntent (402), does not find the foreign refund and returns feeBackCents null, so the eager ledger line is skipped (588, 615: warn « eager ledger line skipped … ») — this path writes NO ledger line;
  (c) the row is marked succeeded with the foreign stripeRefundId (619);
  (d) the royalty accrual recompute runs (627+).
| SAFE EXIT: FAIL CLOSED + FAIL VISIBLE E-04 permanent (founder acceptance list). H3 blocks every claim path; an admin-rail or ghost-order engine call on the order is unguarded (residual). | NEW MONEY: NO from Claims (FV; H3). | CUSTOMER: FVc. | ADMIN: « Le remboursement Stripe re_X, enregistré sur la ligne rf, ne porte pas sur le paiement de cette commande. Anomalie de données à instruire. Aucune conclusion tirée. » | RECONCILIATION: N6 park (ALERT-FV). Pin: J-M04 (i).
IMPLEMENTATION NOTE (W8): ER-M12 resolved. On resume the foreign succeeded refund books NO ledger line: resolveFeeTruth lists the refunds of the order's PaymentIntent (refund.ts 402), the foreign refund is not among them, feeBackCents is null and the eager ledger line is skipped with a console warning (refund.ts 588, 615). The clawback createReversal (524-559), the row going succeeded (619) and the royalty recompute (627-651) happen as the row states; any reading of it that books a ledger line on resume is superseded. Pinned by tests/claims-r13-engine-parity.test.ts (J-M04 (i): ledger not called, the « eager ledger line skipped » warning).

### A-S14a-1 [CORE] PI retrieve transiently throws (no-row branch)
STRIPE: unknown. | DB REFUNDS: any. | CLAIM: unchanged; N1 stripe_unreadable_retry. | ENGINE ACCEPTS A NEW REFUND: NO (PIX). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile once readable; claim stays in its bucket; an approval hits T2(b) → A-S30b-1. | NEW MONEY: NO. | CUSTOMER: per current status. | ADMIN: « Stripe n’a pas pu être lu complètement : rien n’est conclu, rien n’a été modifié. Relancez la réconciliation. » | RECONCILIATION: N1 no write.

### A-S14a-2a [CORE] PI readable; list or a row read unreadable; no pending row
STRIPE: truth readable; L null or a row retrieve fails. | DB REFUNDS: no pending row. | CLAIM: amount_refunded 0 → no write; >0 → FV refund_moved_unattributed (N1 detail). | ENGINE ACCEPTS A NEW REFUND: YES (engine lists nothing on the fresh path). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile once readable; approval → T2(b) revert. REG-3 when parked. | NEW MONEY: NO (T2(b) blocks). | CUSTOMER: per status (FVc when parked). | ADMIN: N1 detail « Stripe rapporte ${r} c remboursés sur ce paiement, mais la liste complète de ses remboursements, ou la lecture d’une ligne de remboursement, n’a pas pu être lue : aucune attribution n’est établie. Relancez « Réconcilier d’après la preuve ». » | RECONCILIATION: N1.

### A-S14a-2b [CORE] As A-S14a-2a with a pending row
STRIPE: as A-S14a-2a. | DB REFUNDS: pending row. | CLAIM: as A-S14a-2a. | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES. | SAFE EXIT: as A-S14a-2a. | NEW MONEY: NO. | CUSTOMER: as A-S14a-2a. | ADMIN: as A-S14a-2a. | RECONCILIATION: N1.

### A-S14b [CORE] PaymentIntent without latest_charge — closable proof (verifier A: no absorbing park)
STRIPE: PI readable, latest_charge null (normally pi.status ≠ succeeded). | DB REFUNDS: canonical none. Variant: a row carrying a stripeRefundId or a pending row exists. | CLAIM: reconcile (N1 permanent no_charge): canonical → approved, refundAttempted false, refundId null, 'no_refund_proven_rail_locked: ' + HEAD_C « Le paiement Stripe de cette commande n’a pas de charge : aucun remboursement ne peut exister sur ce paiement. » + « MAIS une nouvelle approbation ne paierait pas cette réclamation : » + refusal sentence chosen from facts (E1 if paymentStatus∉{paid,reconcile_manual}; else E1b « le paiement Stripe de cette commande est au statut « ${piStatus} », et le moteur ne rembourse qu’un paiement « succeeded » (« Paiement non débité — rien à rembourser. »). »; E1c « Charge introuvable sur le paiement. » only when piStatus is succeeded) + LOCKED tail. Variant → park stripe_refund_contradiction « La ligne ${row} enregistre un remboursement alors que le paiement Stripe de cette commande n’a pas de charge. Aucune conclusion tirée. » | ENGINE ACCEPTS A NEW REFUND: NO (E1, else E1b, else E1c). | ENGINE RESUMES: NO (all precede E3). | SAFE EXIT: canonical: reconcile (i) + stuck_close, REG-1. Variant: REG-3 permanent (founder acceptance list). | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: as CLAIM; toast said.no_refund_proven_rail_locked. | RECONCILIATION: N1 no_charge → N8-style locked CAS on the read pre-image (FV, v13, lock or SAFETY_HOLD) + ALERT-B; replaces the truth-null park for no_charge only.

### A-S15a [CORE] Resume-first drove another row, still pending (identity read OK)
STRIPE: rf9's refund pending. | DB REFUNDS: older pending rf9 stamped ≠ claim:<this>. | CLAIM: refunding, refundAttempted true, refundId rf9, resume_mismatch (T4 CAS won). | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES. | SAFE EXIT: stuck_close (boundRow read, reason ≠ own); approve « pas en arbitrage »; reconcile refused. REG-2. Reachable only if rf9 appears after T2(e') or from legacy data. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: toast approvedResumeMismatch; detail resume_mismatch text. | RECONCILIATION: none; reconcileClaimForRefund excludes it; ALERT-B at the T4 write.

### A-S15b [CORE] As A-S15a, rf9 finalized succeeded
STRIPE: succeeded. | DB REFUNDS: rf9 succeeded. | CLAIM: as A-S15a. | ENGINE ACCEPTS A NEW REFUND: YES (E6 on the moved cursor free). | ENGINE RESUMES: NO. | SAFE EXIT: stuck_close; REG-2. | NEW MONEY: NO (refunding; T1 CAS). | CUSTOMER: FVc. | ADMIN: as A-S15a. | RECONCILIATION: none.

### A-S16a [CORE] Identity read fails after engine success on a resumed row (P1-2)
STRIPE: resumed row R's refund succeeded. | DB REFUNDS: R succeeded; stamp unread. | CLAIM: refunding, refundAttempted true, refundId null, refundError M + « Moteur : le remboursement de la ligne R a abouti chez Stripe ; l’identité de cette ligne n’a pas pu être relue (lecture de la base en échec) : il n’est ni attribué à cette réclamation, ni écarté. Seule la preuve (« Réconcilier d’après la preuve ») établira à quelle réclamation il appartient. » Never « n’appartient PAS ». | ENGINE ACCEPTS A NEW REFUND: YES (no pending row; E6 on moved cursor free). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile after RECONCILE_GRACE_MS → mine (R stamped own) or no-row (N5 park → attribute/adopt). REG-4. | NEW MONEY: NO (refunding; T1 CAS; approve refused). | CUSTOMER: FVc. | ADMIN: toast approvedIdentityUnverified. | RECONCILIATION: none at write; ALERT-B at the T4 write.

### A-S16b [CORE] Identity read fails on the 202 path
STRIPE: R pending. | DB REFUNDS: R pending with id. | CLAIM: as A-S16a with « a été accepté par Stripe et reste en attente ». | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES. | SAFE EXIT: reconcile after grace; REG-4. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: approvedIdentityUnverified. | RECONCILIATION: as A-S16a.

### A-S17 [CORE] FV claim; operator attributes a row already bound to settled claim Z
STRIPE: row's refund succeeded, counted. | DB REFUNDS: rf succeeded, reason absent or claim:Z; Z refunded null error bound to rf; no pending/failed-with-id row. | CLAIM: attribution 409 bound_to_other_claim, nothing written; stays FV. | ENGINE ACCEPTS A NEW REFUND: YES (E6 free). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile → N3 explains rf by Z → A-S02 or A-S26; or attribute a provable row / adopt. REG-3 while FV. | NEW MONEY: NO (FV). | CUSTOMER: FVc. | ADMIN: « Ce remboursement est déjà lié à la réclamation cl_Z — une même somme ne peut pas solder deux réclamations. » | RECONCILIATION: attributionRefusal pre-check (boundTo OR-form) and the Serializable in-transaction count give the same 409.

### A-S18 [CORE] Standing row linked only through a disowned binding (Z resume_mismatch) (P3-22)
STRIPE: standing succeeded refund. | DB REFUNDS: row succeeded unstamped, bound to Z whose refundError starts resume_mismatch. | CLAIM: FV refund_moved_unattributed (N3 no refunded null-error binder → N5). | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: attribute (OR-form excludes Z) → Stripe proves succeeded → A-S23a-1. Not this claim's: REG-3 permanent. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: DETAIL_UNATTRIBUTED naming re_X; no sentence asserts another claim's ownership. | RECONCILIATION: N5 park; attribution Serializable write.

### A-S19 [CORE] External Dashboard refund succeeded, no local row
STRIPE: re_D succeeded untagged, counted. | DB REFUNDS: none for re_D. | CLAIM: FV refund_moved_unattributed → adopt → refunded, refundId mirror, activeOrderKey null. | ENGINE ACCEPTS A NEW REFUND: YES (before adoption; after adoption still YES: mirror key external:re_D, E6 free). | ENGINE RESUMES: NO. | SAFE EXIT: adopt (operator supplies re_D): DB guards → Stripe retrieve (PI, charge, succeeded, amount ≤ captured) → Serializable stamped count (>0 → 409 nothing written) + mirror insert → attributeWithEvidence Serializable → refunded. Not adopted: REG-3 permanent. | NEW MONEY: NO (FV; after adoption refunded terminal; T2(a) own row). | CUSTOMER: FVc; after adoption RFc. | ADMIN: DETAIL_UNATTRIBUTED; adoption preview/success toasts; stamped refusal « Un remboursement porte déjà l’identité de cette réclamation sur cette commande : aucune ligne miroir n’a été écrite. Relancez « Réconcilier d’après la preuve ». » | RECONCILIATION: N5 park; adoption §12; closure notice attempted per Track B.

### A-S20 [CORE] Unexplained admin-rail row standing
STRIPE: succeeded, counted. | DB REFUNDS: row succeeded, reason admin:… / ghost_order_expired, unbound. | CLAIM: FV refund_moved_unattributed. | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: attribute (Stripe proves) → A-S23a-1; race loser A-S42. Not this claim's: REG-3 permanent. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: DETAIL_UNATTRIBUTED naming re_A; attribute success toast. | RECONCILIATION: N5 park.

### A-S21 [CORE] Attribution of a PENDING row that Stripe proves SUCCEEDED (P1-5, P2-14)
STRIPE: retrieve(recorded id) succeeded on order PI, or PI list refund tagged grubano_refund_row=row succeeded. | DB REFUNDS: rf9 pending, not bound elsewhere (OR-form). | CLAIM: Stripe read BEFORE any write; one Serializable transaction: bound count 0 → updateMany {id, status FV} → refunded, refundId rf9, refundError null, activeOrderKey null. After observed commit: alert claim_refunded_row_unfinalized, audit {stripeStatus succeeded, rowStatusBefore pending, moneyMoved false}. Any transaction error → re-read claim → report. | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES (finalizes; clawback variant may refuse forever → row stays pending, A-S10 shape). | SAFE EXIT: terminal refunded; unfinalized list R0b → refund_still_standing; later failure → A-S31b/A-S31c/A-S31d. | NEW MONEY: NO. | CUSTOMER: RFc. | ADMIN: « Remboursement attribué : Stripe rapporte ce remboursement ABOUTI ; la réclamation reflète désormais ce remboursement réel. La ligne reste « en attente » dans notre base (cette action n’a appliqué ni ligne de ledger ni reprise de royalty). » | RECONCILIATION: attributeClaimRefund PROVEN branch; pins: retrieve path (P1-5) and tag path; bound-elsewhere id:{not: claim.id} guard exercised (P1-6).

### A-S22 [CORE] Attribution of a pending row Stripe does NOT prove succeeded (P2-14)
STRIPE: pending/requires_action, within window, dead, failed/canceled, unreadable, or contradiction. | DB REFUNDS: row pending. | CLAIM: UNCHANGED, no write, no audit; stays FV, activeOrderKey held. | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES. | SAFE EXIT: reconcile (→ A-S07/A-S09a/A-S11/A-S12/A-S13a/A-S13b), attribute again when terminal, adopt. REG-3 time-bound or permanent. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: §11 NOT PROVEN 409 texts (pending / failed / dead / within window / unreadable / contradiction). The attribute toast renders body.error for every 409 (replaces the reason-blind toast). | RECONCILIATION: none.

### A-S22b [CORE] Attribution of a local FAILED row
STRIPE: failed|canceled. | DB REFUNDS: row failed with id. | CLAIM: unchanged; 409 row_failed; « Attribuer » disabled. | ENGINE ACCEPTS A NEW REFUND: NO (E2). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile (→ A-S06a when money otherwise explained); else REG-3. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: « Cette ligne est ÉCHOUÉE : elle ne verse rien et ne peut solder aucune réclamation. Rien n’a été écrit. « Réconcilier d’après la preuve » tient compte de cette ligne pour toute la commande. » | RECONCILIATION: none.

### A-S23a-1 [CORE] Attribution of an unstamped SUCCEEDED row confirmed at Stripe
STRIPE: retrieve succeeded on order PI. | DB REFUNDS: row succeeded, reason not claim:<other>, unbound; key refund:o:<earlier cursor>. | CLAIM: Serializable transaction → refunded {stripe_read, amount}; lost race → A-S42. | ENGINE ACCEPTS A NEW REFUND: YES (E6 free). | ENGINE RESUMES: NO. | SAFE EXIT: terminal refunded; later reversal → A-S31-1/A-S31-2 or A-S31e-*. | NEW MONEY: NO (refunded terminal). | CUSTOMER: RFc. | ADMIN: « Remboursement attribué : Stripe confirme ce remboursement ABOUTI ; la réclamation reflète désormais ce remboursement réel. » | RECONCILIATION: attributeClaimRefund PROVEN write.

### A-S23a-2 [CORE] Attribution of a SUCCEEDED row stamped claim:<this> confirmed at Stripe
STRIPE: retrieve succeeded. | DB REFUNDS: row succeeded reason claim:<this>, key refund:o:<earlier cursor>. | CLAIM: as A-S23a-1. | ENGINE ACCEPTS A NEW REFUND: YES (no E5b; cursor moved by this refund, E6 free). | ENGINE RESUMES: NO. | SAFE EXIT: as A-S23a-1 (reconcile mine===1 reaches the same). | NEW MONEY: NO (terminal; T2(a) own row). | CUSTOMER: RFc. | ADMIN: as A-S23a-1. | RECONCILIATION: as A-S23a-1.

### A-S23b-1 [CORE] Attribution of a SUCCEEDED row reverted at Stripe, row key = current cursor
STRIPE: failed|canceled; amount_refunded dropped back. | DB REFUNDS: row succeeded key refund:o:<amount_refunded> (any stamp). | CLAIM: unchanged; 409; stays FV. | ENGINE ACCEPTS A NEW REFUND: NO (E6). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile: bound/mine → A-S24-1 (REG-2); unbound → no-row H1 → A-S03 (REG-1). REG-3 while FV. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: « La ligne rf est marquée ABOUTIE ici, mais Stripe rapporte aujourd’hui son remboursement re_X « failed » : il ne solde rien. La réclamation n’a pas été modifiée. » | RECONCILIATION: none from attribution.

### A-S23b-2 [CORE] As A-S23b-1, row key ≠ current cursor (any stamp)
STRIPE: failed|canceled; cursor elsewhere. | DB REFUNDS: row succeeded key refund:o:<older>. | CLAIM: unchanged; 409; FV. | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: reconcile → A-S24-2 (bound/mine) or A-S04 (unbound). REG-3 while FV. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: as A-S23b-1. | RECONCILIATION: none.

### A-S24-1 [CORE] Own/bound SUCCEEDED row reverted at Stripe on a non-terminal claim, key = current cursor
STRIPE: failed|canceled; amount_refunded dropped. | DB REFUNDS: row succeeded key refund:o:<amount_refunded>. | CLAIM: approved, refundId row, STRIPE_REVERTED_TEXT; actualRefundedCents null; money line bound_reverted. | ENGINE ACCEPTS A NEW REFUND: NO (E6). | ENGINE RESUMES: NO. | SAFE EXIT: stuck_close; approve PERMANENT (3). REG-2. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: STRIPE_REVERTED_TEXT + ROUTED; money line « un remboursement est lié, mais Stripe rapporte ce remboursement échoué ou annulé : il ne verse rien au titre de cette ligne. Lisez le détail enregistré. »; toast refund_failed. | RECONCILIATION: applyRowTruth reverted CAS {id, status∈RECONCILABLE} + ALERT-B; or webhook helper stripe_object after the existing alert.

### A-S24-2 [CORE] As A-S24-1, key ≠ current cursor
STRIPE: failed|canceled; cursor elsewhere. | DB REFUNDS: row succeeded key refund:o:<older>. | CLAIM: as A-S24-1. | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: as A-S24-1 (REG-2); later claims on the order hold on T2 H1. | NEW MONEY: NO (approve PERMANENT refusal). | CUSTOMER: FVc. | ADMIN: as A-S24-1. | RECONCILIATION: as A-S24-1.

### A-S25 [CORE] Approval reaches the engine, engine refuses before creating (drift or unmirrored step)
STRIPE: per refusing step (e.g. a refund moved amount_refunded after T2). | DB REFUNDS: no own row, no pending row. | CLAIM: T4 CAS → approved, `engine_failed: <engine text> — aucune relance possible depuis les réclamations ; décision humaine requise.` + ALERT-B; CAS lost → A-S41. | ENGINE ACCEPTS A NEW REFUND: NO (first of E1, E2, PIX, E1b, E4, E5, E6 on live facts). | ENGINE RESUMES: NO. | SAFE EXIT: stuck_close; approve PERMANENT (3). REG-2. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: toast approvedFailed; guidance refund_error_recorded. | RECONCILIATION: none.

### A-S26 [CORE] No-row proof, money explained, engine refuses (E1/E1b/E4/E5/E6)
STRIPE: HEAD_A or HEAD_B facts with full refund (E4), refundable < requested (E5), pi not succeeded (E1b), or a row holds the cursor key (E6). | DB REFUNDS: no pending row, no failed-with-id row. | CLAIM: approved, refundAttempted false, refundId null, RAIL_LOCKED + HEAD + LOCKED(refusal). | ENGINE ACCEPTS A NEW REFUND: NO (first of E1/E1b/E4/E5/E6). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile (i) + stuck_close; approve REVISABLE (2). REG-1. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: HEAD + « MAIS une nouvelle approbation ne paierait pas cette réclamation : » + §9 refusal sentence + LOCKED tail; toast rail_locked. | RECONCILIATION: N8 stamped re-query + CAS + ALERT-B.

### A-S27-1a [CORE] Several rows stamped claim:<this>, none pending, one failed with id
STRIPE: any. | DB REFUNDS: ≥2 rows claim:<this>, one failed with id. | CLAIM: FV multiple_candidate_refunds. | ENGINE ACCEPTS A NEW REFUND: NO (E2). | ENGINE RESUMES: NO. | SAFE EXIT: attribute a stamped succeeded row Stripe proves → refunded; else REG-3 permanent. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: « Plusieurs remboursements portent l’identité de cette réclamation. » + « 2 lignes Refund portent l'identité de cette réclamation (rf_1, rf_2). Attribution impossible sans décision humaine. » | RECONCILIATION: mine>1 park (relabel).

### A-S27-1b [CORE] Several rows stamped claim:<this>, none pending, none failed with id
STRIPE: canonical two succeeded mirrored refunds. | DB REFUNDS: ≥2 stamped rows succeeded (keys external:… or earlier cursors). | CLAIM: FV multiple_candidate_refunds. | ENGINE ACCEPTS A NEW REFUND: YES canonical (no E5b; E6 free), NO when E4/E5 hold. | ENGINE RESUMES: NO. | SAFE EXIT: as A-S27-1a; the other stamped row is counted by census refundedBoundToOtherClaimStamp. | NEW MONEY: NO (FV; T2(a)). | CUSTOMER: FVc. | ADMIN: as A-S27-1a. | RECONCILIATION: as A-S27-1a.

### A-S27-2 [CORE] Several rows stamped claim:<this>, one pending
STRIPE: pending stamped row any state. | DB REFUNDS: ≥2 stamped rows, ≥1 pending. | CLAIM: FV multiple_candidate_refunds. | ENGINE ACCEPTS A NEW REFUND: NO (E2 if a failed-with-id row, else E3). | ENGINE RESUMES: YES unless E2. | SAFE EXIT: attribute a row Stripe proves succeeded (A-S21/A-S23a-2); else REG-3. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: as A-S27-1a; §11 NOT PROVEN texts. | RECONCILIATION: mine>1 park.

### A-S29-1 [CORE] Standing refund owned by a local FAILED row
STRIPE: re_X succeeded or pending. | DB REFUNDS: owner row failed with re_X. | CLAIM: FV stripe_refund_contradiction « La ligne rf est ÉCHOUÉE dans notre base, mais Stripe rapporte son remboursement re_X « succeeded ». Aucune conclusion tirée. » | ENGINE ACCEPTS A NEW REFUND: NO (E2). | ENGINE RESUMES: NO. | SAFE EXIT: REG-3 permanent (founder acceptance list). | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: contradiction cause + detail. | RECONCILIATION: N3 park, ALERT-FV.

### A-S29-2 [CORE] Stripe reads disagree (N2 other charge / N4 bracket)
STRIPE: standing refund on charge ≠ latest_charge, or Σ bracket fails. | DB REFUNDS: canonical none blocking. | CLAIM: FV (N2 contradiction; N4 0 → contradiction, >0 → refund_moved_unattributed). | ENGINE ACCEPTS A NEW REFUND: YES canonical. | ENGINE RESUMES: NO. | SAFE EXIT: reconcile re-reads (time-bound for lag); attribute/adopt when proven. REG-3. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: §8 N2/N4 texts. | RECONCILIATION: N2/N4 park.

### A-S29-3 [CORE] Changed during read
STRIPE: new row's refund not yet read. | DB REFUNDS: a row claim:<this> just inserted pending, or the claim changed. | CLAIM: no write; changed_during_read. | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES. | SAFE EXIT: relaunch reconcile → mine===1 → A-S33-1/A-S33-2; otherwise the pre-image's registry entry. | NEW MONEY: NO. | CUSTOMER: per pre-image (FVc). | ADMIN: « La réclamation ou les lignes de remboursement de sa commande ont changé pendant la lecture : rien n’a été écrit. Relisez sa ligne, puis relancez si la réconciliation est encore proposée. » | RECONCILIATION: N8 stamped re-query >0 or CAS ≠1.

### A-S30 [CORE] Approval with no pending row whose facts carry a safety hold (H1/H2/H3 succeeded/H5)
STRIPE: e.g. reverted succeeded row with free key; routed ownerless failed refund; succeeded-row contradiction; disputed charge or requested > captured − refunded. | DB REFUNDS: no pending row, no own row, no failed-with-id row. | CLAIM: T2(c) CAS {refunding, M} → approved, refundAttempted true, SAFETY_HOLD + ' Aucun remboursement n’a été lancé pour cette réclamation : ' + holds + ROUTED + ' Décision humaine requise ; « Clôturer ce dossier… » enregistre votre déclaration.' + ALERT-B. | ENGINE ACCEPTS A NEW REFUND: YES (engine does not model holds; for H5 Stripe refuses after insert → CX). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile (i-b) → N0-N8 (refundAttempted reset false) + stuck_close; approve REVISABLE (2). REG-1. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: toast approvedNotSent (error tone; ApprovalToast type widened to tone 'success'|'error'); detail hold sentences. | RECONCILIATION: reconcile (i-b).

### A-S30b-1 [CORE] T2 cannot read the PaymentIntent (transient)
STRIPE: PI retrieve throws. | DB REFUNDS: any. | CLAIM: T2(b) CAS {refunding, M} → pre-image restored (approved, refundAttempted false, refundError null or v13) + ALERT-B (prefix safety_check_unreadable); CAS lost → marker stays (REG-4). | ENGINE ACCEPTS A NEW REFUND: NO (PIX). | ENGINE RESUMES: NO. | SAFE EXIT: approve again (gated, REG-8); v13 also reconcile (i). | NEW MONEY: NO at this moment. | CUSTOMER: APc (null) / FVc (v13). | ADMIN: toast approvedNotSent (success tone). | RECONCILIATION: none.

### A-S30b-2a [CORE] T2: PI readable, list/row transiently unreadable, no pending row
STRIPE: L null (not overCap) or row retrieve throws. | DB REFUNDS: no pending, no own, no failed-with-id row. | CLAIM: as A-S30b-1. | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: approve again (REG-8); v13 reconcile (i). | NEW MONEY: NO at this moment (T2(b)). | CUSTOMER: as A-S30b-1. | ADMIN: as A-S30b-1. | RECONCILIATION: none.

### A-S30b-2b [CORE] T2: list/row transiently unreadable with a pending row
STRIPE: as A-S30b-2a. | DB REFUNDS: pending row not stamped own. | CLAIM: as A-S30b-1. | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES. | SAFE EXIT: approve again: next T2 (e') derives → A-S30e-*; v13 reconcile (i). REG-8. | NEW MONEY: NO. | CUSTOMER: as A-S30b-1. | ADMIN: as A-S30b-1. | RECONCILIATION: none.

### A-S30c-1 [CORE] Approval on a PI without latest_charge
STRIPE: PI readable, latest_charge null. | DB REFUNDS: canonical none. Variant: a failed row with a stripeRefundId (anomaly data). | CLAIM: T2(b') → approved, refundAttempted true, SAFETY_HOLD + ' Aucun remboursement n’a été lancé pour cette réclamation : ' + the C3(b') no_charge S sentence, whose refusal is the first the engine reaches on the facts: E1 « (« Commande non payée — rien à rembourser. »). » if paymentStatus ∉ {paid, reconcile_manual}; else, for the variant, the E2 clause naming the failed row; else E1b « (« Paiement non débité — rien à rembourser. »). »; else E1c « (« Charge introuvable sur le paiement. »). » + ' Décision humaine requise ; « Clôturer ce dossier… » enregistre votre déclaration.' + ALERT-B. | ENGINE ACCEPTS A NEW REFUND: NO (E1, else E2 for the variant, else E1b, else E1c — refund.ts 734-761 order). | ENGINE RESUMES: NO (all precede E3). | SAFE EXIT: stuck_close; reconcile (i-b) → canonical: G6 locked proof (A-S14b, still closable, E-01); variant: G6 park stripe_refund_contradiction (A-S14b variant, E-04; the D4 caption warns before the click that a closable state can become an FV park). E-01 before reconcile. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: approvedNotSent error tone; detail as CLAIM. | RECONCILIATION: reconcile (i-b) → N1 no_charge → A-S14b. Pin: J-M05 (a)-(d).

### A-S30c-2 [CORE] Approval where the refund list exceeds 10 pages
STRIPE: >1 000 refunds on the PI. | DB REFUNDS: no pending, no failed-with-id row. | CLAIM: T2(b') SAFETY_HOLD list_over_cap + ALERT-B. | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: stuck_close; reconcile (i-b) → N1 list_over_cap FV park (REG-3 permanent, no declaration: operator told in the toast that closing first keeps the declaration exit). REG-1. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: « Stripe rapporte plus de 1 000 remboursements sur ce paiement : leur liste complète ne peut pas être lue, et aucune vérification n’est établie. » | RECONCILIATION: as CLAIM.

### A-S30d [CORE] DB throw after T1, before any row insert
STRIPE: nothing created. | DB REFUNDS: no row for this attempt. | CLAIM: refunding, refundAttempted true, refundError M, refundId null; arbitrate 500. | ENGINE ACCEPTS A NEW REFUND: YES canonical. | ENGINE RESUMES: NO. | SAFE EXIT: reconcile after grace → no-row N0-N8. REG-4. | NEW MONEY: NO (refunding; T1 CAS). | CUSTOMER: FVc. | ADMIN: 500 + guidance reconcile_required. | RECONCILIATION: catch sends best-effort ALERT-B then rethrows.
IMPLEMENTATION NOTE (W2, round-1 fix): the catch is not limited to a throw before any row insert: it also covers a throw from executeRefund and from a T4 write, where a row may exist and money may have moved. Its ALERT-B facts carry engineCalled (true once executeRefund was invoked); the ENGINE and NEW MONEY fields above describe the engineCalled false variant only. With engineCalled true the claim is money-unknown on its token M, and reconcile after the grace applies the own row if one exists (A-S33, A-S35) or proves absence.

### A-S30e-1 [CORE] First approval, pending row of another claim that will not finish (dead, truncated, clawback-refusing, failed_at_stripe) (verifier A P1)
STRIPE: per evidence (none/expired, >100 refunds id-less, succeeded with settled clawback, failed|canceled). | DB REFUNDS: pending row not stamped own; no hold. | CLAIM: T2(e') deriveNoRowOutcome → locked proof: approved, refundAttempted false, refundId null, RAIL_LOCKED + HEAD + LOCKED(E3 sentence) + ALERT-B; {failed,'proof_stale'}. Never reverted to null. | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES (refuses). | SAFE EXIT: reconcile (i) + stuck_close; approve REVISABLE (2). REG-1. | NEW MONEY: NO. | CUSTOMER: FVc (not APc). | ADMIN: approvedNotSent error tone; detail E3 sentence; guidance refund_error_recorded. | RECONCILIATION: T2(e') write; later reconcile (i).

### A-S30e-2 [CORE] First approval, another claim's pending row succeeded at Stripe, finalizable (no clawback)
STRIPE: succeeded. | DB REFUNDS: pending row, royaltyRefundCents 0 or royalty unsettled. | CLAIM: T2(e') AWAITING proof, refundAttempted false + ALERT-B. | ENGINE ACCEPTS A NEW REFUND: NO (E3 finalizes that row). | ENGINE RESUMES: YES. | SAFE EXIT: reconcile (i) once the row is no longer pending, stuck_close anytime (declaration exit even if the row never finalizes). REG-1. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: AWAITING tail; approvedNotSent error tone. | RECONCILIATION: as A-S10b.

### A-S30e-3 [CORE] First approval, another claim's pending row within the window
STRIPE: no tagged refund yet. | DB REFUNDS: pending row, no id, age < 21 h. | CLAIM: T2(e') no_write → revert pre-image (approved, refundAttempted false, null) + ALERT-B (prefix unconfirmed_within_window). | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES. | SAFE EXIT: approve again after `until` (gated) → A-S30e-1/A-S30e-2/A-S30e-4 or engine. REG-8 time-bound. | NEW MONEY: NO now. | CUSTOMER: APc. | ADMIN: approvedNotSent success tone + « Conclusion possible à partir du <date> ». | RECONCILIATION: none.

### A-S30e-4 [CORE] First approval, another claim's pending row pending at Stripe
STRIPE: pending|requires_action. | DB REFUNDS: pending row with id or tag. | CLAIM: T2(e') N7 park → FV refund_moved_unattributed via enterFinancialVerification (ALERT-FV). | ENGINE ACCEPTS A NEW REFUND: NO (E3 → 202). | ENGINE RESUMES: YES. | SAFE EXIT: reconcile when terminal (as A-S09a). REG-3 time-bound. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: approvedNotSent error tone; N7 detail. | RECONCILIATION: T2(e') park.

### A-S30g [CORE] Approval on an order whose pending row is contradicted at Stripe
STRIPE: pending row's id unknown or on another PI. | DB REFUNDS: pending row not own. | CLAIM: T2(c) H3 SAFETY_HOLD + ALERT-B. | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES (502, or foreign-refund finalize as A-S13b). | SAFE EXIT: reconcile (i-b) → N6 park (REG-3) or stuck_close; approve REVISABLE. REG-1. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: H3 sentence; approvedNotSent error. | RECONCILIATION: reconcile (i-b).

### A-S31-1 [CORE] Refunded claim, bound SUCCEEDED row later failed at Stripe, marked; key = current cursor
STRIPE: failed|canceled; amount_refunded dropped. | DB REFUNDS: row succeeded key refund:o:<amount_refunded>. | CLAIM: refunded + REVERTED_AFTER_REFUND succeeded-row text (webhook helper stripe_object or R0c). | ENGINE ACCEPTS A NEW REFUND: NO (E6). | ENGINE RESUMES: NO. | SAFE EXIT: stuck_close via terminal exemption: settled_out_of_band → refunded + DECLARED_AFTER_REVERT; closed_no_payment → refused_final, error kept; CAS on read refundError. REG-5. No customer e-mail on the reversal (R-D3). | NEW MONEY: NO (refunded terminal). | CUSTOMER: FVc (derived at read time from the marker); after a declaration CBS. | ADMIN: REVERTED_AFTER_REFUND succeeded-row text + ROUTED + CUSTOMER sentence; money line bound_reverted; alert « Remboursement Stripe passé en échec APRÈS finalisation » (+ claimIds). | RECONCILIATION: helper CAS {id, refunded, null} → text; no Refund write.

### A-S31-2 [CORE] As A-S31-1, key ≠ current cursor
STRIPE: failed|canceled; cursor elsewhere. | DB REFUNDS: row succeeded key refund:o:<older>. | CLAIM: as A-S31-1. | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: as A-S31-1; later claims hold on T2 H1; admin rail unguarded (residual). | NEW MONEY: NO. | CUSTOMER: as A-S31-1. | ADMIN: as A-S31-1. | RECONCILIATION: as A-S31-1.

### A-S31b [CORE] Refunded claim on a pending row, Stripe failed it, row now failed, claim MARKED
STRIPE: failed|canceled. | DB REFUNDS: row failed with id, key renamed. | CLAIM: refunded + REVERTED_AFTER_REFUND failed-row text. | ENGINE ACCEPTS A NEW REFUND: NO (E2). | ENGINE RESUMES: NO. | SAFE EXIT: declarations as A-S31-1. REG-5. | NEW MONEY: NO. | CUSTOMER: FVc; after declaration CBS. | ADMIN: failed-row text with E2 SENTENCE wording (« le moteur refuse tout nouveau remboursement sur cette commande tant que cette ligne reste échouée ») instead of « définitif »; refund_failed alert. | RECONCILIATION: webhook helper failed_row (also on redelivery of an already-failed row, helper only) or R0a; ALERT-B via R0a.

### A-S31c [CORE] Refunded claim, bound row FAILED with id, NOT marked
STRIPE: failed|canceled. | DB REFUNDS: row failed with id (engine resume, or helper retries exhausted). | CLAIM: refunded, refundError null. | ENGINE ACCEPTS A NEW REFUND: NO (E2). | ENGINE RESUMES: NO. | SAFE EXIT: FV card otherUnsettled « Réconcilier d’après la preuve » (iii) → R0a → A-S31b → declaration. REG-6. | NEW MONEY: NO. | CUSTOMER: RUc until marked (refundedRow false), then FVc, then CBS. | ADMIN: guidance stripe_failed; toast reverted_after_refund. | RECONCILIATION: R0a helper failed_row, audit moneyMoved false, ALERT-B.

### A-S31d [CORE] Refunded claim on a PENDING row, Stripe failed it, event lost, no engine call
STRIPE: failed|canceled. | DB REFUNDS: row pending. | CLAIM: refunded, null → after R0b: refunded + REVERTED_AFTER_REFUND pending-row text; row untouched. | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES (marks failed → E2). | SAFE EXIT: unfinalized list « Réconcilier d’après la preuve » → R0b → marked → stuck_close. REG-6. | NEW MONEY: NO. | CUSTOMER: RFc before reconcile (the code has read no failure signal: C6-compliant); FVc after; CBS after declaration. | ADMIN: pending-row text with « si le moteur la reprend (il reprend la plus ancienne ligne en attente d’une commande avant tout nouveau remboursement), il la marquera en échec, ce qui verrouille la commande » (conditional, not « quand »). | RECONCILIATION: R0b read-only refundRowTruth; helper pending_row_stripe; ALERT-B.
IMPLEMENTATION NOTE (W1): ER-C24 — the ADMIN conditional reads « si le moteur reprend cette ligne (il reprend la plus ancienne ligne en attente d’une commande avant tout nouveau remboursement), il la marquera en échec, ce qui verrouille la commande » (F16 note); the « la reprend » wording above is superseded.

### A-S31e-1 [CORE] Refunded claim on SUCCEEDED row whose failure was never processed; key = current cursor — NOT FAIL-VISIBLE
STRIPE: failed|canceled; amount_refunded lowered. | DB REFUNDS: row succeeded key refund:o:<amount_refunded>. | CLAIM: refunded, null. | ENGINE ACCEPTS A NEW REFUND: NO (E6). | ENGINE RESUMES: NO. | SAFE EXIT: route-only POST /api/admin/claims/[id]/reconcile R0c → A-S31-1. Listed nowhere, no alert, not countable: REG-7 NOT FAIL-VISIBLE, requires explicit founder acceptance; never presented as a compliant registry entry. | NEW MONEY: NO (refunded terminal; later claims hold on H1). | CUSTOMER: RFc (stale; no failure signal read). | ADMIN: none proactively. | RECONCILIATION: R0c on demand only.

### A-S31e-2 [CORE] As A-S31e-1, key ≠ current cursor — NOT FAIL-VISIBLE
STRIPE: as A-S31e-1. | DB REFUNDS: row succeeded key refund:o:<older>. | CLAIM: refunded, null. | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: as A-S31e-1 (REG-7). | NEW MONEY: NO. | CUSTOMER: RFc (stale). | ADMIN: none. | RECONCILIATION: as A-S31e-1.

### A-S31f-1 [CORE] Webhook failed event on pending bound row; row marked failed; helper DB error
STRIPE: failed|canceled. | DB REFUNDS: row failed with id. | CLAIM: refunded, null; webhook 503 → redelivery → helper only → A-S31b; retries exhausted → A-S31c. | ENGINE ACCEPTS A NEW REFUND: NO (E2). | ENGINE RESUMES: NO. | SAFE EXIT: redelivery, else R0a (REG-6). | NEW MONEY: NO. | CUSTOMER: RUc (row failed with id → refundedRow false). | ADMIN: refund_failed alert. | RECONCILIATION: helper failed=true → 503.

### A-S31f-2 [CORE] Webhook failed event on succeeded bound row, helper DB error; key = current cursor — C6 BREACH bounded by redelivery
STRIPE: failed|canceled. | DB REFUNDS: row succeeded key refund:o:<amount_refunded>. | CLAIM: refunded, null; alert sent first; 503 → redelivery → A-S31-1; exhausted → A-S31e-1 (REG-7). | ENGINE ACCEPTS A NEW REFUND: NO (E6). | ENGINE RESUMES: NO. | SAFE EXIT: redelivery; else R0c on demand. REG-6 transient. | NEW MONEY: NO. | CUSTOMER: RFc — a C6 breach: a failure signal was received but could not be recorded; bounded by redelivery (Stripe test mode retries a few times over a few hours). Stated to the founder, not claimed compliant. | ADMIN: alert « Remboursement Stripe passé en échec APRÈS finalisation » (claimIds). | RECONCILIATION: helper failed=true → 503.

### A-S31f-3 [CORE] As A-S31f-2, key ≠ current cursor
STRIPE: as A-S31f-2. | DB REFUNDS: row succeeded key refund:o:<older>. | CLAIM: as A-S31f-2 (→ A-S31-2). | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: as A-S31f-2. | NEW MONEY: NO. | CUSTOMER: as A-S31f-2 (C6 breach bounded by redelivery). | ADMIN: as A-S31f-2. | RECONCILIATION: as A-S31f-2.

### A-S32-1 [CORE] Legacy payable proof where an engine refusal applies
STRIPE: canonical 0/0 with another claim's reverted row holding refund:o:0. | DB REFUNDS: succeeded reverted row key refund:o:<amount_refunded>. | CLAIM: approved, refundAttempted false, 'no_refund_proven:' (no v13). | ENGINE ACCEPTS A NEW REFUND: NO (E6; or E4/E5). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile (i) only; approve suspended (1); stuck_close refused; sweep skips. REG-1. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: « Approbation suspendue : la preuve d’absence de cette réclamation a été écrite par une version antérieure… » ; guidance reconcile_required. | RECONCILIATION: N0-N8 CAS on legacy text; census legacyPayableProofs (C3 pre-deploy).

### A-S32-2 [CORE] Legacy payable proof, no engine refusal applies
STRIPE: refundable ≥ requested. | DB REFUNDS: no blocking row. | CLAIM: as A-S32-1. | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: as A-S32-1 (REG-1). | NEW MONEY: NO (approve suspended). | CUSTOMER: FVc. | ADMIN: as A-S32-1. | RECONCILIATION: as A-S32-1.

### A-S33-1 [CORE] Stalled attempt's own row inserted late, finalized succeeded
STRIPE: first attempt's refund succeeded. | DB REFUNDS: row claim:<this> succeeded. | CLAIM: N8 stamped re-query/CAS usually prevents the proof (A-S29-3); Q-INSTANT ≥ 60 min refuses re-approval inside the window; a re-approval meets T2(a) own_row_exists; stalled T4 CAS matches nothing → A-S41. | ENGINE ACCEPTS A NEW REFUND: YES (no E5b; cursor moved, E6 free). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile (v13 (i) or marker after grace) → mine===1 → refunded. REG-4. | NEW MONEY: NO from Claims (T2(a) stamped query immediately before executeRefund). Residual: a pre-insert stall longer than ATTEMPT_QUIESCENCE_MS plus proof and re-approval inside it; out-of-band refund during a stall; Dashboard refund in the T2 gap; routed E2 race. | CUSTOMER: FVc until reconciled, then RFc. | ADMIN: « ${M'} Vérification avant moteur : la ligne rf porte déjà l’identité de cette réclamation ; aucun nouveau remboursement n’a été lancé. Seule la preuve (« Réconcilier d’après la preuve ») établira ce qui a été versé. » | RECONCILIATION: mine===1 applyRowTruth.

### A-S33-2 [CORE] As A-S33-1, late own row still pending
STRIPE: not terminal. | DB REFUNDS: row claim:<this> pending. | CLAIM: as A-S33-1. | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES (same refund). | SAFE EXIT: as A-S33-1 (REG-4). | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: as A-S33-1. | RECONCILIATION: applyRowTruth pending branch.

### A-S34 [CORE] Adoption mirror written, claim write refused
STRIPE: re_D succeeded. | DB REFUNDS: mirror external:re_D, reason claim:<this>, succeeded. | CLAIM: unchanged; 409 wrote:true; still FV or refunded elsewhere. | ENGINE ACCEPTS A NEW REFUND: YES when refundable ≥ requested (mirror key never collides at E6). | ENGINE RESUMES: NO. | SAFE EXIT: FV: reconcile → mine===1 → refunded; refunded elsewhere: terminal, orphan counted (census) and parks later claims (A-S37). REG-3 while FV. | NEW MONEY: NO (FV; T2(a)). | CUSTOMER: FVc or RFc. | ADMIN: « La ligne miroir rf (remboursement re_D ABOUTI chez Stripe, identité de cette réclamation) a été enregistrée, mais la réclamation n’a pas été modifiée : elle a changé d’état entre-temps. Si elle est encore en vérification financière, « Réconcilier d’après la preuve » appliquera cette ligne, qui porte son identité. » | RECONCILIATION: mine path later.

### A-S35 [CORE] Stripe refuses create after the engine inserted the claim's row
STRIPE: no refund created. | DB REFUNDS: row claim:<this> pending, no id. | CLAIM: T4 CAS appends « Moteur : « <engine text> » — la ligne X existe ; seule la preuve établira ce qui a été versé ou non. » + ALERT-B (REG-4) → reconcile after grace: within window no write; 20-21 h no write; then engine_row_dead (REG-2) + ALERT-B. | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES (< 20 h re-sends create; ≥ 20 h 409). | SAFE EXIT: reconcile → engine_row_dead → stuck_close. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: approvedFailed; engine_row_dead text. | RECONCILIATION: applyRowTruth.

### A-S36-1 [CORE] Legacy resume_mismatch on the claim's OWN row, row succeeded (P1 verifier B)
STRIPE: own refund succeeded. | DB REFUNDS: row claim:<this> succeeded. | CLAIM: refunding, refundId own row, legacy resume_mismatch. | ENGINE ACCEPTS A NEW REFUND: YES (no E5b; E6 free). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile (ii) → mine===1 → refunded. stuck_close refused. REG-4. | NEW MONEY: NO (refunding). | CUSTOMER: FVc until reconciled, then RFc. | ADMIN: money line identity_unread « un remboursement est lié et sa ligne porte l’identité de cette réclamation ; une version antérieure a écrit le contraire après un échec de lecture. Seule la preuve (« Réconcilier d’après la preuve ») établira ce qui a été versé. » | RECONCILIATION: mine path; census ownRowResumeMismatch (C3 legacy).

### A-S36-2 [CORE] Legacy resume_mismatch on own row, row failed with id
STRIPE: failed|canceled. | DB REFUNDS: row claim:<this> failed with id. | CLAIM: as A-S36-1. | ENGINE ACCEPTS A NEW REFUND: NO (E2). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile (ii) → approved + stripe_failed (REG-2) → stuck_close. REG-4 until then. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: as A-S36-1. | RECONCILIATION: as A-S36-1 + ALERT-B.

### A-S36b [CORE] Legacy resume_mismatch on own PENDING row
STRIPE: any. | DB REFUNDS: row claim:<this> pending. | CLAIM: as A-S36-1. | ENGINE ACCEPTS A NEW REFUND: NO (E3). | ENGINE RESUMES: YES. | SAFE EXIT: reconcile (ii) → applyRowTruth per truth; webhook reconcileClaimForRefund admits it (AM-A6). REG-4. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: identity_unread line. | RECONCILIATION: applyRowTruth.

### A-S37 [CORE] Standing row stamped claim:Y without a refunded binder Y (orphan / bound to X ≠ Y)
STRIPE: standing succeeded re_X. | DB REFUNDS: row succeeded reason claim:Y; Y refused_final/missing/refunded elsewhere, or bound to refunded X ≠ Y. | CLAIM: FV refund_moved_unattributed (AM-A5 detail). | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: REG-3 permanent (founder acceptance list): attribution stamped_for_other_claim; adoption refuses; no declaration. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: §8 AM-A5 detail. | RECONCILIATION: N3 park; census refundedBoundToOtherClaimStamp.

### A-S38-1 [CORE] v13 payable proof, then an out-of-band refund succeeded (stale payable proof)
STRIPE: new succeeded refund unexplained. | DB REFUNDS: none (Dashboard) or unstamped admin-rail row. | CLAIM: v13 proof (stale). Re-approval: T2(e') → N5 park → FV {failed,'proof_stale'}; reconcile (i) same park. | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: reconcile → adopt (A-S19) / attribute (A-S23a-1). REG-3 while FV. | NEW MONEY: NO (T2(e') re-derives before the engine). | CUSTOMER: FVc. | ADMIN: approvedNotSent error; DETAIL_UNATTRIBUTED. | RECONCILIATION: N5 park, ALERT-FV.

### A-S38-2 [CORE] As A-S38-1, remaining refundable < requested
STRIPE: refundable < requested or ≤ 0. | DB REFUNDS: as A-S38-1. | CLAIM: as A-S38-1 (N5 precedes N8). | ENGINE ACCEPTS A NEW REFUND: NO (E4 or E5). | ENGINE RESUMES: NO. | SAFE EXIT: as A-S38-1. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: as A-S38-1. | RECONCILIATION: as A-S38-1.
IMPLEMENTATION NOTE (W2, round-1 fix): the row stands as written — re-approval gives T2 (e') → N5 park → FV {failed,'proof_stale'} + ALERT-FV. The J-M20 W2 note that pinned a SAFETY_HOLD for this state is superseded (G5 note: H5 captured does not hold where E5 applies).

### A-S39 [CORE] Disputed charge or requested above captured remainder (H5)
STRIPE: disputed, or requested > captured − refunded. | DB REFUNDS: no pending, no failed-with-id row. | CLAIM: reconcile: locked H5; approval: SAFETY_HOLD. | ENGINE ACCEPTS A NEW REFUND: YES (Stripe refuses after insert → CX → A-S35). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile ((i)/(i-b); a closed dispute lifts H5) + stuck_close. REG-1. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: §9 H5 sentences. | RECONCILIATION: N8 locked CAS / T2(c) + ALERT-B.

### A-S40 [CORE] Rowless Dashboard refund still pending at Stripe
STRIPE: re_P pending, counted. | DB REFUNDS: none for re_P; no pending row. | CLAIM: FV refund_moved_unattributed with the pending sentence. | ENGINE ACCEPTS A NEW REFUND: YES (no pending ROW; E4/E5 on reduced refundable). | ENGINE RESUMES: NO. | SAFE EXIT: reconcile when terminal: succeeded → adopt (A-S19); failed → routed A-S08a / non-routed A-S08b. REG-3 time-bound. | NEW MONEY: NO. | CUSTOMER: FVc. | ADMIN: DETAIL_UNATTRIBUTED + « Un remboursement de ce paiement est encore en attente chez Stripe : relancez « Réconcilier d’après la preuve » lorsqu’il sera terminal. » | RECONCILIATION: N5 park.

### A-S41 [CORE] Stalled attempt returns after the claim changed
STRIPE: canonical own fresh refund succeeded. | DB REFUNDS: own row claim:<this> succeeded. | CLAIM: unchanged (T4 CAS count 0). | ENGINE ACCEPTS A NEW REFUND: YES canonical (no E5b; cursor moved); 202 variant NO (E3). | ENGINE RESUMES: NO canonical; YES 202 variant. | SAFE EXIT: v13/FV: reconcile → mine===1 → refunded (re-approval meets T2(a)); refunded/closed: terminal, human money review. REG-9. | NEW MONEY: NO (T2(a), Q-INSTANT). | CUSTOMER: per current status. | ADMIN: ALERT-S « Tentative de remboursement terminée après un changement d’état de la réclamation »; until reconcile a v13 proof label is stale. | RECONCILIATION: none at return; alert on ok/202, log on refusal.

### A-S42 [CORE] Two operators attribute the same row to two claims concurrently
STRIPE: succeeded (both read it before their transactions). | DB REFUNDS: row succeeded unstamped, unbound before the race. | CLAIM: Serializable transactions (binder read + CAS only): exactly one commits refunded; the loser is rolled back (P2034/P2028/1020/lost commit) or sees bound_to_other_claim; loser re-reads its claim and reports only what the read shows (« déjà appliqué » / « rien n’a été écrit » / « état non établi — relisez la file »); no notice, audit or success toast before an observed commit. | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: winner terminal; loser REG-3 → reconcile (N3 explains by the winner) or attribute/adopt another. | NEW MONEY: NO. | CUSTOMER: winner RFc; loser FVc. | ADMIN: loser « Cette réclamation, ou ce remboursement, a changé entre-temps — rien n’a été écrit. Relisez sa ligne dans la file. » or bound_to_other_claim text. | RECONCILIATION: attributeClaimRefund; two-connection rehearsal on disposable MariaDB.

### A-S43 [CORE] Legacy row bound to two or more claims without resume_mismatch
STRIPE: canonical succeeded. | DB REFUNDS: row succeeded unstamped, bound to ≥2 claims. | CLAIM: statuses unchanged; reconcileClaimForRefund ambiguous_binding no write. | ENGINE ACCEPTS A NEW REFUND: YES. | ENGINE RESUMES: NO. | SAFE EXIT: REG-10; refunded claims terminal, non-terminal → FV REG-3 permanent. | NEW MONEY: NO. | CUSTOMER: FVc for EVERY claim bound to that row, derived at read time (refundedRow null when the bound row has ≥2 non-mismatch binders); never RFc (verifier A). No data rewrite (R-D6). | ADMIN: [MONEY REVIEW] ambiguous_binding; census rowsBoundToMultipleClaims. | RECONCILIATION: none.

## B. REFUND ↔ CLAIM IDENTITY RULES

How a Refund row or a Stripe refund is proven to belong to a claim, and why one Refund can financially settle at most one Claim. Vocabulary: a STAMP is Refund.reason = claim:<id>. A BINDING is Claim.refundId = Refund.id. A SETTLING binding is a claim with status refunded, refundError null and refundId set. The OWNER of a Stripe refund is the local row that records it. A BINDER of a row is a claim counted by B1. Engine steps E1-E6 are those of A-S00. Concurrency is in section C; evidence is in section G.

### B1 [CORE] One binder query
lib/claims.ts exports boundToWhere(rowId, exceptClaimId) = { refundId: rowId, id: { not: exceptClaimId }, OR: [{ refundError: null }, { NOT: { refundError: { startsWith: 'resume_mismatch' } } }] }. The OR is required because NOT startsWith excludes NULL in SQL. A claim matched by it is a BINDER, whatever its status, terminal ones included (fail closed).
A resume_mismatch claim is never a binder of any row: the engine disowned that binding. The own-row legacy case is handled on its own claim only (B8).
Every binder read uses this where, and nothing else does:
- the attributionRefusal pre-check (replaces 1912-1915);
- the attribution transaction (C6);
- the console bindings query (1487-1498);
- the explanation rule (G7);
- the ambiguity and binder checks (B9).
lib/claim-attribution-rules.ts adds stampedClaimId(reason) = reason starts with 'claim:' ? reason.slice(6) : null.
Pin (P3-22): fixture with row R bound to claim Z, Z.refundError 'resume_mismatch: …'. Expected: attribution of R to FV claim C is not refused bound_to_other_claim; the no-row detail for C never names Z; the console binding for R is empty. Negative control: set Z.refundError null → all three name Z.
IMPLEMENTATION NOTE (W1): lib/claims exports BINDER_OR (one clause per line, the prefix imported as RESUME_MISMATCH, so the claim-money-line writer extractor reads no literal) and boundToWhere. attributeClaimRefund's pre-check, listFinancialVerificationClaims' bindings, getClaimEligibility's claim.count and listConsumerClaims' claim.groupBy use it now; the attribution transaction, the G3 loader and B9 use it in their slices. ER-R31: a declared resume_mismatch claim is not a binder (boundToWhere excludes it); harmless, because it keeps a non-null refundError and never settles. The P3-22 pin runs in tests/claims-exit-parity.test.ts.

### B2 [CORE] What proves that a Refund row belongs to claim C
Exactly three proofs, each sufficient for IDENTITY only. What the row paid is decided by evidence (section G), never by identity.
(P-stamp) row.reason === claim:C. The stamp is written only at creation: lib/refund.ts from the reason passed to executeRefund, and the adoption mirror (B11).
(P-bind) C.refundId === row.id, C is not resume_mismatch (or is B8's own-row case), and stampedClaimId(row.reason) ∈ {null, C}. A binding to a row stamped claim:Y with Y ≠ C proves nothing for C: that is the G7 AM-A5 park, counted by the census as refundedBoundToOtherClaimStamp.
(P-attr) the settling binding written by the attribution transaction (C6), after Stripe proved that row's refund SUCCEEDED on the order's PaymentIntent (G12).
Nothing else proves identity: not an equal amount, the same order, timing, or the operator's word. Code must not derive « rattaché à cette réclamation » or « relève d’une autre réclamation » from anything but P-stamp, P-bind or P-attr.

### B3 [CORE] Owner of a Stripe refund
owners(s) = the order's rows with stripeRefundId === s.id, or with id === s.metadata.grubano_refund_row, whatever the row status.
- Exactly one owner: s belongs to whatever claim that owner belongs to under B2.
- Zero or two or more owners: s belongs to no claim and is UNEXPLAINED (G7 N3/N5).
- A rowless Stripe refund (Dashboard) belongs to no claim until adoption writes a mirror row stamped for the claim (B11).
- An engine-tagged refund (metadata.grubano_refund_row set) is never adopted: its identity is its row's.
The same owners function (lib/claims.ts ownersOf(refund, rows)) serves H2 (ownerless = zero owners), N3, and the webhook helper's pending_row_stripe evidence (G11).
IMPLEMENTATION NOTE (W1): ownersOf lives in lib/claim-attribution-rules.ts (beside stampedClaimId and identityProof), not in lib/claims.ts: lib/claim-action-rules (G5 H2, G7 N3) must import nothing from lib/claims, which imports it. Unit tests: tests/claim-attribution-identity.test.ts (id match, tag match, failed-status owner, zero and two owners; identityProof stamp / bind / foreign stamp / resume_mismatch).

### B4 [CORE] Refund.reason is never written after creation
New test tests/claims-identity-writers.test.ts, a source scan of app/, lib/ and scripts/ (excluding tests/):
(a) The only prisma.refund.update / updateMany / tx.refund.update* calls are the three in lib/refund.ts: the markRefundRowFailed update, the resume write and the finalize write (today 458, 513, 619). None of their data objects contains the key reason.
(b) The only prisma.refund.create / tx.refund.create calls are the engine insert in lib/refund.ts and the adoption mirror in lib/claims.ts.
Break/restore control: add `reason: 'x'` to the finalize data in a temp copy → red; restore → green. A new Refund writer anywhere makes the test red until it is listed and shown to leave reason alone.
IMPLEMENTATION NOTE (W4): pinned by tests/claims-identity-writers.test.ts (J-M09), a TypeScript-AST scan of app/, lib/ and scripts/. The only Refund updates are markRefundRowFailed and the two finalizeRefund writes (resume, finalize) of lib/refund.ts, none writing reason; the only creates are executeRefund and tx.refund.create in adoptStripeRefundInner (C8). scripts/ holds no Refund writer. The break/restore runs on an in-memory copy.

### B5 [CORE] Closed list of Claim.refundId writers
Only these writes set Claim.refundId to a non-null value. Every one is a CAS (section C).
W1 T4 success when T3 = 'ours' (stamped row) → settling.
W2 T4 202 when T3 = 'ours' (stamped) → non-settling.
W3 T4 not_ours → resume_mismatch (disowned; never a binder).
W4 T4 engine_failed with the claim's own failed row (stamped).
W5 applyRowTruth, on the stamped row (mine===1) or the row already bound.
W6 enterFinancialVerification relabel with input.refundId. Callers may pass only the stamped row or the already-bound row: applyRowTruth, reconcileBoundClaim.
W7 the attribution transaction (C6): settling; the row is unstamped or stamped claim:C.
W8 adoption, only through W7 on its own stamped mirror.
These keep refundId: reconcileClaimForRefund (CAS on refundId = row), resolveStuckClaim, markClaimsForRevertedRefundRow, the T2 reverts and holds, identity_unverified (refundId stays null).
N8 proof writes and T2(e') proof writes set refundId null.
The round-11 bind-first write in attributeClaimRefund (1929-1933) is deleted.
Pin: a source scan lists every claim update / updateMany whose data has the key refundId and fails on any site outside W1-W8, N8, T2(e').
IMPLEMENTATION NOTE (W4): W7 is tx.claim.updateMany inside attributeWithEvidence (C6); the round-11 bind-first write of attributeClaimRefund is deleted. J-M10 pins the exact count per function: triggerClaimRefund 8 (the T2 (e′) proof write and the seven T4 writes that set refundId, found through the t4Write forwarder), applyRowTruth 6 (W5), enterFinancialVerification 1 (W6), reconcileNoRowByDerivation 1 (N8), attributeWithEvidence 1 (W7). markClaimsForRevertedRefundRow (G11) does not exist yet: its slice adds it to the negative control.

### B6 [CORE] One Refund settles at most one Claim
INVARIANT, for every Refund row R: the number of claims with {refundId: R, status: 'refunded', refundError: null} is ≤ 1, except in legacy data (B9).
Enforcement:
(1) Stamped R: only claim C of the stamp can hold a settling binding (W1, W5-stamped). Attribution refuses stamped_for_other_claim (claim-attribution-rules.ts 34-39); adoption refuses an existing row stamped for another claim (2085-2088).
(2) Unstamped R: a settling binding is CREATED only by W7, whose transaction finds no binder of R, in any status, before its CAS (C6).
(3) Paths that APPLY an existing binding never create one: W5-bound, reconcileClaimForRefund (webhook), the recovery sweep. The claims they settle are already binders, so any W7 on R is refused.
(4) A late engine attempt cannot re-bind a settled claim, and cannot unbind one so its row becomes free for another claim (T4 CAS, C5; test R-A1-2).
Tests:
- a two-claim race on unstamped R → exactly one refunded (C6; C10 rehearsal);
- attribution of R when a non-terminal binder exists → 409 bound_to_other_claim;
- a late not_ours return after attribution → claim.refundId unchanged, and a third claim's attribution of R is still refused.
IMPLEMENTATION NOTE (W4): (2) landed — attributeWithEvidence is the only creator of a settling binding of an unstamped row; the binder read and the CAS share one Serializable transaction (C6). The two-claim race is pinned with a lock simulator (tests/claims-r13-attribution.test.ts, J-M23); the real two-connection rehearsal (C10, J-M24) is opt-in and has not been run yet.

### B7 [CORE] T3: identity after the engine replaces refundRowBelongsToClaim
lib/claims.ts: delete refundRowBelongsToClaim (491-499). Add refundRowIdentity(rowId, claimId, result): Promise<'ours' | 'not_ours' | 'unknown'>.
- result.ok && result.resumed === false → 'ours', with no read: a fresh engine create carries the reason this call passed.
- Otherwise, including every 202: prisma.refund.findUnique({ where: { id: rowId }, select: { reason: true } }) inside try. Throw or null row → 'unknown'. reason === claim:<claimId> → 'ours'. Otherwise → 'not_ours'.
The amount-mismatch checks (534 resumedIgnoredAmount; 571 amount ≠ requested) run before T3, as today, and write resume_mismatch through C5.
'not_ours' keeps the two existing resume_mismatch texts (551, 588). These are the ONLY places « n’appartient PAS » may appear.
'unknown' writes, via the C5 CAS: `${M} Moteur : le remboursement de la ligne ${rowId} ${result.ok ? 'a abouti chez Stripe' : 'a été accepté par Stripe et reste en attente'} ; l’identité de cette ligne n’a pas pu être relue (lecture de la base en échec) : il n’est ni attribué à cette réclamation, ni écarté. Seule la preuve (« Réconcilier d’après la preuve ») établira à quelle réclamation il appartient.` refundId unchanged (null). Returns { state: 'failed', error: 'identity_unverified' }. ALERT-B after the CAS succeeds.
Pins:
- a mocked findUnique that rejects → the 'unknown' text; no string containing « n’appartient PAS »;
- a source scan: « n’appartient PAS » occurs only in the two not_ours data literals (P1-2).
IMPLEMENTATION NOTE (W2): refundRowIdentity is exported; refundRowBelongsToClaim is deleted. The ok not_ours literal keeps its structure but drops « De l'argent A bougé, mais pas au titre de cette réclamation. » for « Le remboursement a abouti chez Stripe, mais pas au titre de cette réclamation. », because F16 (1) forbids « De l'argent A bougé » and the W1 note on F16 assigns that string to this slice. The literals keep their ASCII apostrophe in « n'appartient PAS » (the count pins match both apostrophes). Pinned by tests/claims-r13-trigger.test.ts (J-M11).

### B8 [CORE] Legacy resume_mismatch on the claim's OWN row (AM-A6)
Pure predicate in lib/claim-action-rules.ts: ownRowMismatch(c) = c.status === 'refunding' && !!c.refundId && startsWith(c.refundError, 'resume_mismatch') && c.boundRow !== undefined && c.boundRow?.reason === `claim:${c.id}`. ClaimFacts gains id, orderId and boundRow (undefined = not read).
Consequences:
- reconcileRefusal admits it (G1 (ii)).
- isStuckResolvable returns false for it: identity is established, so a declaration is not needed.
- reconcileClaimForRefund counts it as a candidate (B9). The webhook applies its row.
- The G2 mine===1 path applies its row's truth.
- Money line identity_unread.
A resume_mismatch whose bound row is read and is not stamped for the claim is a true mismatch: stuck_close only, never reconcile, never settled by the webhook.
boundRow read throws → B12, and both reconcile and stuck_close refuse for that request.
The census counts ownRowResumeMismatch {nonTerminal, terminal}; no data is rewritten (R-D6).
IMPLEMENTATION NOTE (W2): reconcileClaimEvidence and resolveStuckClaim read the bound row (a throw → the B12 409, nothing written) and apply reconcileRefusal / isStuckResolvable of lib/claim-action-rules with it; listActionableRefundClaims computes reconcilable and resolvable from the same row. reconcileClaimForRefund reads the stamp of a resume_mismatch claim's row and counts it only when the stamp is its own (an unreadable stamp → not_bound, no write); the B9 findMany / ambiguous_binding rewrite stays with its slice. G1 (iii) stays refused: reconcileClaimEvidence withholds the bound row of a refunded claim until the W3 R0 dispatch. The census counts ((d) of J-M12) belong to the census slice. Pinned by tests/claims-r13-identity.test.ts (J-M12).
IMPLEMENTATION NOTE (W2, round-1 fix): (ii) settles only on Stripe evidence. reconcileClaimEvidence reads a resume_mismatch claim's own row through refundRowTruth (G4, never absenceIsEvidence): succeeded → settle, outcome evidence 'stripe_read'; failed or canceled → the G2 STRIPE_REVERTED write (approved, refundId, the G8 stripe_reverted text with the conditional ROUTED sentence, ALERT-B stripe_reverted, outcome refund_failed); 404, another payment or pending at Stripe → contradiction park. B9 interim for this population: reconcileClaimForRefund counts an own-stamp mismatch only while boundToWhere(row, claim) matches no other claim (else not_bound, no write), and applyRowTruth parks reconcile_not_applied with the B9 (b) detail before any settling write when another binder exists; a reconciliation the reconciler applied to ANOTHER claim of a legacy two-binder row is never reported as this claim's. The round-12 isStuckResolvable of lib/claims is deleted: the name re-exports the lib/claim-action-rules predicate the route and the list flags apply. Pinned by tests/claims-r13-identity.test.ts (J-M12).

### B9 [CORE] A row with two or more binders
(a) reconcileClaimForRefund (1089-1149): claim.findMany({ where: { refundId }, select: { id, status, refundError } }) replaces findFirst. The row is read once, select { status, reason }. candidates = claims that are not resume_mismatch, plus a resume_mismatch claim whose stampedClaimId(row.reason) === its id.
- 0 candidates → { reconciled: false, reason: 'not_bound' }.
- ≥2 candidates → { reconciled: false, reason: 'ambiguous_binding' }; no write; console.error('[MONEY REVIEW] ambiguous_binding', rowId, ids). The webhook still answers 200.
- 1 candidate → the existing branches, with the C9 pre-image CAS.
(b) applyRowTruth, before any write that settles (row_terminal succeeded, at_stripe succeeded): count = prisma.claim.count({ where: boundToWhere(row.id, claim.id) }); count > 0 → park reconcile_not_applied through C9. Detail: « La ligne ${row} est liée à au moins une autre réclamation : cette réclamation ne peut pas être soldée sur elle sans décision humaine. Aucune conclusion tirée. » Nothing settles.
(c) Customer read-time derivation (A-S43). listConsumerClaims and getClaimEligibility load binder counts for the bound rows in one query: prisma.claim.groupBy({ by: ['refundId'], where: { refundId: { in: ids }, OR: [boundToWhere's OR] }, _count: { _all: true } }). A count ≥2 sets refundedRow = null, so customerClaimStatus returns financial_verification for every claim bound to that row, never « Remboursée ».
(d) The census counts rowsBoundToMultipleClaims; no rewrite.
Pins:
- a two-binder fixture → webhook no write;
- applyRowTruth parks instead of settling;
- both claims read financial_verification.
Negative control: one binder → refunded.
IMPLEMENTATION NOTE (W4): (a) landed — reconcileClaimForRefund reads every bound claim with claim.findMany and the row once ({ status, reason }, in try: a throw → not_bound, no write, B12). No bound claim at all keeps the existing no_claim answer; zero candidates → not_bound; two or more candidates → ambiguous_binding with console.error [MONEY REVIEW] ambiguous_binding, checked BEFORE the terminal check (a terminal binder is still a binder, fail closed); one candidate → the existing branches with the C9 CAS. (b) and (c) were landed by W2 / W1; (d) belongs to the census slice. Pinned by tests/webhook-refund-reconciliation.test.ts (J-M13).
IMPLEMENTATION NOTE (W4, fixer round 1): no bound claim at all keeps { reconciled: false, reason: 'no_claim' } rather than (a)'s 'not_bound'. It is the same no-write, 200 outcome; 'no_claim' separates « nothing is bound to this row » (an ordinary admin-rail, ghost-order or external refund) from « bound claims exist, none is a candidate », and the webhook's finalize answer (its claim field) and tests/claims-state-machine.test.ts already expose it. A thrown row read (→ not_bound, no write, B12) now logs console.warn('[claims] refund row read failed — no claim reconciled', rowId, code), so a bound claim left on that row is visible before the recovery sweep.

### B10 [CORE] Attribution identity refusals
lib/claim-attribution-rules.ts attributionRefusal, evaluated in this order:
(1) row on another order → 400 (existing text);
(2) stamped_for_other_claim (existing);
(3) own stamp beside an unstamped row (existing);
(4) bound_to_other_claim, with boundToOtherClaimId from prisma.claim.findFirst({ where: boundToWhere(row.id, claim.id), select: { id: true } }): « Ce remboursement est déjà lié à la réclamation ${id} — une même somme ne peut pas solder deux réclamations. »;
(5) unusable_status (existing);
(6) NEW row_failed: row.status === 'failed' → 409 « Cette ligne est ÉCHOUÉE : elle ne verse rien et ne peut solder aucune réclamation. Rien n’a été écrit. « Réconcilier d’après la preuve » tient compte de cette ligne pour toute la commande. » REFUSAL_LEGEND row_failed: 'ligne échouée — ne peut solder aucune réclamation, sera refusé'.
The refusal of a pending row without a Stripe id is REMOVED. Stripe proves such a row through the grubano_refund_row tag (G4); the console legend for pending rows becomes « lié seulement si Stripe le rapporte ABOUTI ».
The pure rule is applied by the server and by the console with the same inputs (existing parity test extended with row_failed).
IMPLEMENTATION NOTE (W1): the pure rule carries the whole order, (1) included (code other_order, status 400, the existing text), with claimOrderId and row.orderId as inputs; the server's inline anchor moved into it and a failed binder or stamp read refuses with the B12 text. The console legend for row_failed is added. The pending-row legend « lié seulement si Stripe le rapporte ABOUTI » is NOT added in W1: attributeClaimRefund still binds first (the write B5 deletes), so the sentence would be false until G12's evidence-before-write lands with it. [SUPERSEDED by the W4 note below: G12 landed and the legend is added.]
IMPLEMENTATION NOTE (W4): the pending-row legend « lié seulement si Stripe le rapporte ABOUTI » is added now (PENDING_ROW_LEGEND in lib/claim-attribution-rules), rendered for a pending candidate the pre-check does not refuse; it is true since G12 reads the evidence before any write. Pinned by tests/claims-r13-attribution.test.ts (J-M14).

### B11 [CORE] Adoption mirror identity
adoptStripeRefundInner keeps its DB guards (2075-2124) and Stripe anchors (2126-2183). Changes:
(a) 'ours' branch (existing mirror row: external: key, reason claim:C, succeeded): set trace.wrote = false before any refusal; call attributeWithEvidence(claim, existing, undefined), which reads Stripe per G12; delete the unreachable check at 2109; the 'refunded' result carries evidence 'stripe_read' and amountCents from attributeWithEvidence.
(b) Fresh branch: the stamped-row check and the mirror insert run in the C8 transaction. The pre-transaction findFirst at 2118-2124 is kept as a fast refusal. The mirror is stamped claim:C with key `external:${re}`; adoption keys never collide with E6.
(c) After the mirror commits: attributeWithEvidence(claim, row, refund), reusing the retrieve at 2129.
- 'refunded' → 200.
- Any refusal → 409 wrote: true « La ligne miroir ${row} (remboursement ${re} ABOUTI chez Stripe, identité de cette réclamation) a été enregistrée, mais la réclamation n’a pas été modifiée : elle a changé d’état entre-temps. Si elle est encore en vérification financière, « Réconcilier d’après la preuve » appliquera cette ligne, qui porte son identité. »
An orphan mirror stamped for a claim settled elsewhere is never deleted. G7 treats it as the AM-A5 park, and the census counts it (refundedBoundToOtherClaimStamp).
IMPLEMENTATION NOTE (W4): (a) the success facts are the Stripe object attributeWithEvidence read (source stripe); the local_row facts remain only for the dry-run preview, where Stripe is not read. (c) ER-M08 / truthfulness: the exact B11 (c) sentence is kept when the claim was proven unmodified by a change (not FV any more, claim_changed, bound_to_other_claim, an unchanged re-read). Where « elle a changé d’état entre-temps » is not what was established, the sentence keeps its head (« La ligne miroir … a été enregistrée ») and says what was: an identity read that failed (« la base n’a pas pu être relue pour établir l’identité du remboursement »), a commit reported lost whose re-read shows the claim bound to the mirror (« la réclamation est déjà liée à cette ligne (statut actuel : « x ») », with the closure-record variant), a re-read that failed (« la base n’a pas pu confirmer ce qui a été écrit sur la réclamation »). Pinned by tests/claims-r13-adoption.test.ts (J-M15).
IMPLEMENTATION NOTE (W4, fixer round 1): corrects the W4 note above. (a) « set trace.wrote = false before any refusal » is wrong for two C7 outcomes of the binding transaction this call ran: a commit reported lost whose re-read shows the claim bound to the row (already_bound), and a re-read that failed (unestablished). Neither establishes that nothing was written, so adoption answers wrote: null after them on BOTH branches — on the fresh branch the mirror exists and the server text says so, but « la liaison n’a pas abouti » is not established either. wrote false (existing mirror) / true (fresh mirror) is kept for every other refusal, an unchanged re-read included. The console sentence is one pure mapping, adoptionRefusalWroteText (lib/claim-attribution-rules): false « Rien n’a été écrit. », true « La ligne miroir a été enregistrée ; la liaison n’a pas abouti — relisez la ligne dans la file. », null « L’état a pu changer : relisez la ligne dans la file. ». A refusal on the existing-mirror branch carries the facts of the Stripe refund object attributeWithEvidence read for the row (source stripe), or no facts when it refused before any Stripe read — never the local row's: the local_row facts serve the dry-run preview only, where Stripe is not read. The console refusal card names the source (« Stripe rapporte » / « notre ligne enregistre »), and the unreachable local_row success toast is removed. (c) variants: identity_unread and unestablished as in the W4 note; already_bound « …, et la réclamation est déjà liée à cette ligne (statut actuel : « x »). Cette action n’a tenté aucun e-mail ; sa clôture est enregistrée. Relisez sa ligne dans la file. » (record written; it names no console section, see the C7 fixer note) or « … ; l’enregistrement de sa clôture a échoué : aucun avis client ne pourra lui être envoyé. Relisez sa ligne dans la file. » (record failed); not_written, an unchanged re-read after a transaction error, « …, mais la réclamation n’a pas été modifiée : la liaison n’a pas pu être enregistrée (écriture concurrente ou erreur de la base). Si elle est encore en vérification financière, « Réconcilier d’après la preuve » appliquera cette ligne, qui porte son identité. ». The frozen B11 (c) sentence stays for a claim proven changed (not FV any more, claim_changed, bound_to_other_claim). Pinned by tests/claims-r13-adoption.test.ts (block « B11 (a)/(c) W4 fixer »: every variant on the fresh branch with its exact text, status 409, wrote and no second adoption audit; already_bound and unestablished on the existing-mirror branch; negative controls claim_changed and not_written; J-M15 (b): the refusal facts carry Stripe's status) and tests/claims-t49-round9.test.ts (the console mapping).

### B12 [CORE] A failed identity read is never a negative identity
Every read that establishes identity is inside try: T3 reason, the boundRow read, binder reads, the owners and stamped rows loaded by G3, the stamped re-query of N8 and T2.
When a read throws:
- T3 → 'unknown' (B7).
- reconcileClaimEvidence, resolveStuckClaim, attributeClaimRefund, adoptStripeRefundInner → { ok: false, status: 409, error: 'La base n’a pas pu être lue : l’identité du remboursement n’est pas établie et rien n’a été modifié. Réessayez.' }. No claim write, audit or alert.
- loadOrderMoneyFacts → { readable: false, permanent: null } (G3 → N1 / T2(b)).
No code path turns a thrown read into not_ours, bound_to_other_claim, « relève d’une autre réclamation » or a proof of absence.
Pin: each listed read mocked to reject → the stated outcome, with 0 claim updateMany calls.
IMPLEMENTATION NOTE (W1, round-1 fix): attributeClaimRefund's candidate-row read (it carries the stamp) is inside the B12 try as well: a rejecting refund.findUnique → 409 with the B12 text, no binder read, 0 updateMany (tests/claims-exit-parity.test.ts).
IMPLEMENTATION NOTE (W2): T2 (a)/(f) stamped query → a throw is transient (C3 (b) revert); every loadOrderMoneyFacts read → { readable: false, permanent: null }; the (f) claim re-read → transient; the own-row read after an engine refusal → see C5 (item 8). Pinned by tests/claims-r13-identity.test.ts (J-M16).
IMPLEMENTATION NOTE (W2, round-1 fix): adoptStripeRefundInner's two identity reads — the existing mirror by stripeRefundId (it carries the stamp) and the stamped-row read — are inside try → { ok: false, status: 409, error: the B12 text } with wrote false, before any Stripe read, write, audit or alert. The binder counts of the B8 interim (reconcileClaimForRefund: a throw → not_bound, no write; applyRowTruth: a throw → the B12 409) follow the same rule. Pinned by tests/claims-r13-identity.test.ts (J-M16 adoption fixture).

## C. CONCURRENCY / CAS RULES

Every claim write on a money path is a compare-and-set on what its decision read. A lost write writes nothing more and says so. One Refund is bound under a Serializable transaction. A stalled or late engine attempt cannot overwrite a claim reconciled, bound or closed since it started. A payable proof is re-derived from fresh Stripe and DB reads immediately before executeRefund, and cannot be used before its quiescence instant. Prisma only (C2): interactive transactions and updateMany; no raw SQL, no schema change. lib/refund.ts is byte-identical (no exclusiveReason, no E5b).

### C1 [CORE] CAS discipline on every money-path claim write
In triggerClaimRefund, reconcileClaimEvidence, applyRowTruth, reconcileBoundClaim, enterFinancialVerification, attributeClaimRefund/attributeWithEvidence, adoptStripeRefundInner, reconcileClaimForRefund, markClaimsForRevertedRefundRow, resolveStuckClaim and runClaimAutoApproval, every Claim write is prisma.claim.updateMany (or tx.claim.updateMany).
The where clause is {id} plus the exact pre-image the decision read: status and refundError always; refundId and refundAttempted whenever the decision read them.
count !== 1 → no further write for that decision: no alert, audit, closure notice or success outcome. The function returns its 'changed' outcome:
- reconcile/apply: { ok: true, outcome: 'changed_during_read' } (replaces movedOn / 'already_parked_or_moved');
- attribution: C7;
- T1: already_handled;
- T2/T4: attempt_superseded;
- close: the existing 409 « Cette réclamation a déjà été traitée. »
Alerts (ALERT-B, ALERT-FV, claim_refunded_row_unfinalized) are sent only after count === 1, so two concurrent reconciles or approvals of one claim produce one write and one alert.
Pin: a source scan finds no prisma.claim.update( in these functions. Break control: reintroduce one → red.
IMPLEMENTATION NOTE (W2): every claim write of triggerClaimRefund, reconcileClaimEvidence, applyRowTruth, reconcileBoundClaim, enterFinancialVerification, attributeClaimRefund, reconcileClaimForRefund and resolveStuckClaim is an updateMany whose where carries status and refundError (plus refundId / refundAttempted where read); no prisma.claim.update remains (source scan, tests/claims-r13-cas.test.ts). adoptStripeRefundInner and runClaimAutoApproval write no claim. markClaimsForRevertedRefundRow does not exist yet (G11, webhook slice). A lost reconcile / apply CAS still answers { outcome: 'financial_verification', reason: 'already_parked_or_moved' } with « Rien n’a été écrit … »: the rename to 'changed_during_read' needs the F14 console toast and lands with W3.
IMPLEMENTATION NOTE (W2, round-1 fix): supersedes the note above. Every lost reconcile / apply CAS returns { ok: true, outcome: 'changed_during_read' }: applyRowTruth, reconcileBoundClaim, every park of reconcileClaimEvidence, the round-12 ladder proof CAS and the D4 N8 writer. When applyRowTruth's own bind had matched before the loss the outcome carries boundRowId (this action wrote the bind only). The FV console renders « Rien n’a été écrit : la réclamation a changé d’état pendant la lecture des preuves. Relisez sa ligne dans la file. », or with boundRowId « Cette action a lié la réclamation à la ligne X, puis la réclamation a changé d’état pendant la lecture des preuves : rien d’autre n’a été écrit. Relisez sa ligne dans la file. », error tone; the old « a quitté les états modifiables (peut-être clôturée) » is deleted. attributeClaimRefund maps it to a 409 that states its bind; the reconcile route writes no audit for it. The source scan adds reconcileNoRowByDerivation and requires refundId in applyRowTruth's where and refundAttempted in every T1/T2 where and in the N8 writer. Pinned by tests/claims-r13-cas.test.ts (J-M17, J-M26) and tests/claims-t49-round7-routes.test.ts.
IMPLEMENTATION NOTE (W2, round-2 fix): the round-1 note above was not yet true for the LAST park of reconcileClaimEvidence (refund_moved_unattributed), which still answered a lost CAS with { outcome: 'financial_verification', reason: 'already_parked_or_moved' }: the console rendered the generic FV toast (« … aucune clôture … ») for a claim that had closed concurrently, and the reconcile route audited a decision that wrote nothing. That park now returns { ok: true, outcome: 'changed_during_read' } like every other; 'already_parked_or_moved' is removed from AmbiguityReason, so no writer can return it (this also supersedes the « financial_verification / already_parked_or_moved » wording of the W1 round-1 note under G1). Pinned by tests/claims-r13-cas.test.ts (J-M17 / J-M26 « the refund_moved_unattributed park »: claim moved to refunded, refundError relabelled, entry lost to a close, a two-reconcile race, a negative control, and a source pin that every `!parked.entered && !parked.relabelled` branch answers changed_during_read), tests/claims-t49-round7.test.ts (the round-7 terminal fixture now expects changed_during_read), tests/claims-t49-routes.test.ts (no audit for changed_during_read) and tests/claims-t49-round7-routes.test.ts.

### C2 [CORE] Attempt token M and T1
lib/claims.ts reconcileRequiredMarker(now, nonce) = `reconcile_required: tentative de remboursement démarrée à ${now.toISOString()} (tentative ${nonce}) — identité du remboursement pas encore liée. Ceci n'est PAS un échec : la vérité argent doit être PROUVÉE (Stripe), jamais devinée.`, with nonce = crypto.randomUUID(). The ISO comes first. reconcileMarkerAge's regex matches it and cannot match a UUID. Pin: parse, and two markers built at the same instant differ.
T1 in triggerClaimRefund, after the unchanged REFUNDS entry check (504):
1. before = claim.findUnique select { status, refundError, refundAttempted, refundId, orderId, requestedAmountCents }. Missing → already_handled.
2. Return already_handled (no write) when any of these holds:
- before.refundId !== null;
- before.refundError !== null && !startsWith(PROOF_PAYABLE_V13);
- before.refundError is v13 && (proofInstant(before.refundError) === null || now < proofInstant) (C4).
3. M = reconcileRequiredMarker(new Date(), randomUUID()), computed once.
4. updateMany where { id, status: 'approved', refundAttempted: false, refundId: null, refundError: before.refundError } → data { status: 'refunding', refundAttempted: true, refundError: M }. count 0 → already_handled.
No copy anywhere states that closing the REFUNDS lease stops an attempt already past step 4.
IMPLEMENTATION NOTE (W2): the nonce is globalThis.crypto.randomUUID(); reconcileRequiredMarker(now, nonce) is exported. T1 also returns already_handled without writing when the claim is not 'approved', has refundAttempted true or a refundId (the CAS would match nothing anyway). Pinned by tests/claims-r13-trigger.test.ts (J-M18, and the T1 halves of J-M21 and J-M47).

### C3 [CORE] T2: the payable proof is re-derived immediately before money authority
Runs after T1, before executeRefund. Read-only except its CAS writes. Every read is in try: a throw counts as transient unreadable. Every T2 write is updateMany where { id, status: 'refunding', refundAttempted: true, refundError: M }. count 0 → no further write, return { state: 'failed', error: 'attempt_superseded' }, engine NOT called.
(a) prisma.refund.findFirst({ where: { orderId, reason: claim:<id> }, select: { id } }) found → data { refundError: `${M} Vérification avant moteur : la ligne ${own} porte déjà l’identité de cette réclamation ; aucun nouveau remboursement n’a été lancé. Seule la preuve (« Réconcilier d’après la preuve ») établira ce qui a été versé.` } + ALERT-B → 'own_row_exists'.
(b) facts = loadOrderMoneyFacts (G3), transient unreadable → data { status: 'approved', refundAttempted: false, refundError: before.refundError } + ALERT-B (cause safety_check_unreadable) → 'safety_check_unreadable'.
(b') Permanent unreadable → data { status: 'approved', refundError: 'refund_safety_hold: Aucun remboursement n’a été lancé pour cette réclamation : ' + S + ' Décision humaine requise ; « Clôturer ce dossier… » enregistre votre déclaration.' }. refundAttempted stays true. ALERT-B → 'safety_hold'.
- S for no_charge: « le paiement Stripe de cette commande n’a pas de charge : aucune vérification ne peut être lue, et le moteur refuserait » + the FIRST refusal refund.ts reaches on the facts (G3 returns rows, paymentStatus and piStatus with no_charge):
  - paymentStatus ∉ {paid, reconcile_manual} → « (« Commande non payée — rien à rembourser. »). »;
  - else a row with status 'failed' and a stripeRefundId (E2, refund.ts 744-750, precedes the PI read) → « : la ligne ${ids} est ÉCHOUÉE avec un identifiant Stripe, et le moteur refuse tout remboursement sur une commande qui porte une telle ligne ; aucune action des réclamations ne modifie cette ligne. »;
  - else piStatus ≠ succeeded → « (« Paiement non débité — rien à rembourser. »). »;
  - else « (« Charge introuvable sur le paiement. »). ».
- S for list_over_cap: « Stripe rapporte plus de 1 000 remboursements sur ce paiement : leur liste complète ne peut pas être lue, et aucune vérification n’est établie. »
(c) reapprovalSafetyHolds(facts) non-empty (H1/H2/H3/H5, G5) → the (b') data with the G8 hold sentences + ROUTED (G8) + ALERT-B → 'safety_hold'.
(e') o = deriveNoRowOutcome(facts, claimId, requestedCents) for EVERY pre-image, null or v13:
- o is a payable proof and (before.refundError === null || now ≥ proofInstant(before.refundError)) → go to (f) with no write;
- o is a locked or awaiting proof → data { status: 'approved', refundAttempted: false, refundId: null, refundError: prefix + ' ' + text } + ALERT-B → 'proof_stale';
- o is a park → enterFinancialVerification({ …, expect: { status: 'refunding', refundError: M } }) (C9) → 'proof_stale';
- o is no_write unconfirmed_within_window, or a v13 pre-image before its instant → data { status: 'approved', refundAttempted: false, refundError: before.refundError } + ALERT-B (cause unconfirmed_within_window) → { state: 'failed', error: 'unconfirmed_within_window', until } (F12: approvedNotSentUntil, success tone).
(f) Last reads before the engine, in this order: repeat (a) (found → (a)'s write); then claim.findUnique select { status, refundError }; anything other than { 'refunding', M } → 'attempt_superseded', no write. Then call executeRefund({ orderId, amountCents: requestedAmountCents, reason: `claim:${id}` }) with no await in between.
The old step (d) 'awaiting_other_row' is DELETED (V-A-1).
Conditions that invalidate a payable proof at T2, exhaustively: an own stamped row; the claim is no longer { refunding, M }; any transient or permanent unreadability; H1, H2, H3 or H5; the E1/E2/E1b/E3 (any pending row)/E4/E5/E6 mirror; an unexplained standing refund, an N2/N4/N6 contradiction, an N7 in-flight refund or window; a v13 pre-image before its instant.
One residual stays: Stripe drift after these reads is refused by the engine itself (A-S25), or is documented (C11).
Pin: step order, and each branch calls executeRefund 0 times (J-M19); the no_charge quote order including E2 (J-M05 (d)).
IMPLEMENTATION NOTE (W2): landed in triggerClaimRefund, with deriveNoRowOutcome( called in its body before executeRefund( (RELEASE GATE). ER-M11 / ER-M13 resolved as (b') states: the no_charge clause quotes E1 (unpaid, or no PaymentIntent), then E2 (a failed row with a Stripe id, refund.ts 744 precedes the PI read), then E1b, then E1c. (e') no_write 'changed_during_read' (a standing refund owned by a row stamped for this claim) takes (a)'s write on that row. A park whose enterFinancialVerification CAS does not match returns attempt_superseded. ER-R30 resolved in the copy: approvedSuperseded no longer presupposes an engine result (« la réclamation ne reflète pas cette tentative »), since T2 returns attempt_superseded before any engine call.
IMPLEMENTATION NOTE (W2, round-1 fix): (c) no longer holds where E4/E5 apply (G5 note), so a full-capture E4/E5 state reaches (e'): A-S38-2 parks N5, and without an unexplained refund the E4/E5 lock is written. The v13 instant re-check of (e') reverts with no `until` (approvedNotSent, success tone): approvedNotSentUntil names an older row in its confirmation window, which is not this cause.

### C4 [CORE] Quiescence instant of a payable proof (replaces E5b)
lib/claim-action-rules.ts:
- export const ATTEMPT_QUIESCENCE_MS = 60 * 60 * 1000 (pin: ≥ 3 600 000);
- proofInstant(e) = /payable au plus tôt le (\d{4}-\d{2}-\d{2}T[\d:.]+Z) \(UTC\)/.exec(e) → Date, or null when absent or unparsable. It is a regex literal, never a string-built RegExp.
lib/claims.ts proofInstantFor(preImage, now), used by N8 and T2(e') when they write PROOF_PAYABLE_V13:
(1) the marker timestamp read by reconcileMarkerAge's regex in the pre-image → timestamp + Q;
(2) otherwise proofInstant(preImage), when the pre-image is v13;
(3) otherwise now + Q.
Why this is sound: every engine call is preceded by T1's M. Only N8 writes v13. A T2 revert restores a pre-image only before the engine is called. So the time of a pre-image that carries no marker is later than the start of any attempt that could still be stalled.
Enforcement:
- T1 (C2 step 2) and T2(e');
- arbitrationRefusal(approve), placed before the existing checks, for an approved claim whose refundError is v13:
  - instant unreadable → « Approbation impossible : l’heure à partir de laquelle cette preuve d’absence permet un paiement n’a pas pu être lue. Relancez « Réconcilier d’après la preuve » (section « Vérification financière requise »). »
  - now < instant (REVISABLE) → « Approbation prématurée : la preuve d’absence de cette réclamation ne permet un paiement qu’à partir du ${iso} (UTC) ; ce délai sépare toute nouvelle tentative de remboursement d’une éventuelle tentative antérieure. Rien n’est payé avant cette heure ; approuvez-la à nouveau ensuite. »
- runClaimAutoApproval step 2 selects { id, refundError } and skips (`continue`) any claim with a refundError, so the sweep never drives a proof.
Pins: instant rules (1)(2)(3); approve refused at instant − 1 ms and allowed at instant; the sweep calls triggerClaimRefund 0 times for a v13 claim.
IMPLEMENTATION NOTE (W1): ER-M03 resolved as D3 states — one parser (proofInstant, a regex literal) and the two C4 texts; no parseQuiescenceInstant. proofInstantFor is a pure function of lib/claim-action-rules, re-exported by lib/claims for the N8/T2 writers. Rule (1) reads the marker timestamp only when the pre-image starts with the reconcile_required prefix: a v13 pre-image also carries an ISO instant, and reading it as a marker would push the instant a second Q later (pinned, tests/claims-r13-quiescence.test.ts). T1, T2 (e') and the runClaimAutoApproval skip are wired by the T1/T2 slice.
IMPLEMENTATION NOTE (W1, round-1 fix): the runClaimAutoApproval skip is landed in W1 (select { id, refundError }, `continue` on any refundError), pinned in tests/claims-r13-quiescence.test.ts: 0 triggerClaimRefund calls for a v13 proof before or after its instant, a legacy proof, a lock, AWAITING and a safety hold; one call for a null-error claim (negative control). RELEASE GATE (ordering): T1 (C2) and T2 (C3, with the C5 CAS) land no later than the first writer of PROOF_PAYABLE_V13 — until then triggerClaimRefund is the round-12 path (no fresh derivation, no holds, no pre-image CAS) and must never receive a v13 pre-image. The same test file fails when any non-test file writes a v13 proof (calls proofPrefixFor / deriveNoRowOutcome, or composes the v13 prefix) while triggerClaimRefund calls executeRefund with no deriveNoRowOutcome before it, or while the sweep skip is absent. The GUIDANCE « seulement si la relecture avant moteur confirme encore la preuve » and the MONEY label « relue avant le moteur » are true from that slice on; no v13 claim can exist before it.
IMPLEMENTATION NOTE (W2): T1 (no write) and T2 (e') (revert, cause unconfirmed_within_window) enforce the instant; T1 before the instant is pinned (tests/claims-r13-trigger.test.ts).

### C5 [CORE] T4: a late or stalled attempt never overwrites a newer claim state
After executeRefund returns, every claim write in triggerClaimRefund is updateMany where { id, status: 'refunding', refundError: M }. The data of each write:
1. resumedIgnoredAmount (534) → { refundId: result.refundId, refundError: existing text }.
2. T3 not_ours on ok (547) → the same shape.
3. T3 'ours' on ok (556) → { status: 'refunded', refundId, refundError: null, activeOrderKey: null, decidedAt: new Date() }.
4. 202 amount ≠ requested (572) → resume_mismatch text.
5. 202 not_ours (584) → resume_mismatch text.
6. 202 'ours' (593) → { refundId, refundError: null }.
7. T3 unknown, ok or 202 → B7 text.
8. Own row not failed (615-628) → { refundError: `${M} Moteur : « ${result.error} » — la ligne ${own.id} existe ; seule la preuve établira ce qui a été versé ou non.` }. The re-read at 621 is deleted.
9. engine_failed (630-633) → { status: 'approved', refundId: own?.id when own exists, refundError: existing text }.
ALERT-B after count === 1 for 1, 2, 4, 5, 7, 8 and 9.
count === 0 → no claim write, and:
- ok or 202 → sendAdminMoneyReviewAlert({ kind: 'claim_attempt_superseded', dedupeKey: `claim_attempt:${claimId}:${result.refundId}`, title: 'Tentative de remboursement terminée après un changement d’état de la réclamation', facts: { claimId, orderId, refundRow: result.refundId, stripeRefundId: result.stripeRefundId ?? null, engineStatus: ok ? 'succeeded' : 'pending', resumed: result.resumed ?? null, claimStatusNow } }), where claimStatusNow is read best-effort;
- a refusal → console.warn only.
Return { state: 'failed', error: 'attempt_superseded' }.
Test (R-A1-2): a mocked executeRefund held open; meanwhile the claim is parked FV then attributed row R2 (refunded); release with resumed not_ours on R9. Expected: claim.refundId stays R2, status stays refunded, 0 matched writes, ALERT-S sent once, and a third claim's attribution of R2 → 409 bound_to_other_claim.
IMPLEMENTATION NOTE (W2): all post-engine writes go through ONE CAS helper (t4Write) where { id, status: 'refunding', refundError: M }. I-03's facts are used as I-03 lists them (refundRowId, engineStatus 'ok' | 'pending', claimStatusNow, claimRefundIdNow, claimRefundErrorPrefixNow = the first token of the current refundError), not C5's refundRow / 'succeeded'. Item 8 when the own-row read itself throws: B12 forbids reading it as absent (item 9 would make the claim closable by declaration), so the token is kept with « ${M} Moteur : « ${error} » — les lignes de remboursement de cette commande n’ont pas pu être relues ; seule la preuve établira ce qui a été versé ou non. » and ALERT-B cause engine_own_row. The ok not_ours literal drops « De l'argent A bougé » (F16 (1)); see B7.
IMPLEMENTATION NOTE (W8): ER-R32 resolved as formatting only. A-S27-1b, A-S27-2, A-S29-2 and A-S41 keep both variant answers inline in their rows; the J-M01 entry of each carries the canonical variant's executable facts (A-S27-1b, A-S29-2 and A-S41: engine YES in J-M03; A-S27-2: resume-first in J-M04), and the J-M28 run drives every D1 pre-image on each world. No row is split further and no engine answer changes.

### C6 [CORE] The Serializable transaction that binds a Refund to a claim
lib/claims.ts attributeWithEvidence(claim, row, stripeRefund?).
Before the transaction: the claim is read { id, orderId, status FV, refundError }; B10 refusals; the Stripe evidence (G12) proves PROVEN.
Transaction:
await prisma.$transaction(async (tx) => {
  const other = await tx.claim.findFirst({ where: boundToWhere(row.id, claim.id), select: { id: true } })
  if (other) throw new AttributionAbort('bound_to_other_claim', other.id)
  const done = await tx.claim.updateMany({ where: { id: claim.id, status: 'financial_verification', refundError: claim.refundError }, data: { status: 'refunded', refundId: row.id, refundError: null, activeOrderKey: null, decidedAt: new Date() } })
  if (done.count !== 1) throw new AttributionAbort('claim_changed')
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 })
The callback references only tx: no prisma.*, Stripe, record, audit, alert or e-mail inside it (source-scan pin). AttributionAbort is a local Error subclass.
Abort outcomes:
- bound_to_other_claim → 409 with the B10 (4) text;
- claim_changed → 409 « Cette réclamation a changé d’état entre-temps — elle n’a pas été modifiée. Relisez sa ligne dans la file. »;
- any other error → C7.
Only after the promise resolves, in this order:
1. recordClaimClosure(claim.id) (H05 closure record; eligibility for the customer notice);
2. pending row → alert claim_refunded_row_unfinalized (I-04, existing shape);
3. recordAdminAudit('claim.attribute_refund', { refundRowId, stripeRefundId, stripeStatus: 'succeeded', rowStatusBefore, moneyMoved: false }) — its boolean never decides notice eligibility;
4. return { ok: true, outcome: 'refunded', refundId: row.id, rowStatusBefore, evidence: 'stripe_read', amountCents: s.amount }.
The attribute route then attempts the closure notice (D10 (iii), H07). It answers 200 only for that result, so no success UI exists without an observed commit.
Why exactly one of two concurrent binders wins: Claim.refundId has no index, so the findFirst takes shared locks on the claim rows it scans. Two crossing updates then deadlock and one is rolled back (P2034). A sequential second binder sees the committed binding and aborts.
IMPLEMENTATION NOTE (W4): attributeWithEvidence(claim, row, stripeRefund?, opts) is exported; opts carries the audit actor (adminId, note), dryRun (D8 (6)) and the Prisma client (the C10 rehearsal passes one per connection; the app uses the singleton). It re-reads the claim itself (the CAS pre-image), applies B10 with the one binder where, then the G12 evidence. A supplied Stripe refund (adoption, rehearsal) proves only the row whose id or grubano_refund_row tag it carries; otherwise it is a contradiction (NOT PROVEN). The transaction options are inline: { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2000, timeout: 5000 }. The outcome is { ok, outcome refunded | preview, refundId, rowStatusBefore, evidence stripe_read, amountCents }. Pinned by J-M23 (call shape, AST pin of the callback, simulator races) and J-M37.
IMPLEMENTATION NOTE (W4, fixer round 1): a supplied Stripe refund is evidence only for a SUCCEEDED row — the adoption mirror, anchored by its caller to the order's PaymentIntent and charge, and the C10 rehearsal. For a PENDING row it is ignored and the evidence is refundRowTruth, which anchors the PaymentIntent (G4): an id or tag match alone is never at_stripe evidence. A not-proven refusal carries the Stripe refund object it read (stripeRead) for the adoption refusal facts (B11 fixer note). Pinned by tests/claims-r13-attribution.test.ts (block « C6 (W4 fixer) », with its negative control).

### C7 [CORE] Lost race: a clean failure, never an ambiguous success
Any error from the C6 or C8 $transaction that is not an AttributionAbort or AdoptionAbort is treated as « nothing proven written »: P2034 (1213), P2028, 1020 / ER_CHECKREAD, a connection lost during COMMIT, or anything else.
console.warn('[claims] binding transaction aborted', code). Then re-read claim.findUnique select { status, refundId, refundError } in try, and report only what that read shows:
- read throws → 409 « État non établi : la base n’a pas pu confirmer ce qui a été écrit. Relisez la ligne de cette réclamation dans la file avant toute autre action. »
- status ∈ {refunded, refused_final} && refundId === row.id → r = await recordClaimClosure(claim.id) (H05; idempotent on P2002). This closure is by this build: the claim was FV at this request's pre-transaction read, and only C6 or a later this-build write can bind it to this row. Then 409:
  - r true: « Cette réclamation est déjà liée à ce remboursement (statut actuel : « ${status} »). Cette action n’a tenté aucun e-mail et n’a écrit aucune trace d’audit ; si l’avis client manque, la réclamation apparaît dans « Avis client non envoyés ». Relisez sa ligne dans la file. »
  - r false: « Cette réclamation est déjà liée à ce remboursement (statut actuel : « ${status} »). Cette action n’a tenté aucun e-mail et n’a écrit aucune trace d’audit ; l’enregistrement de sa clôture a échoué : aucun avis client ne pourra lui être envoyé. Relisez sa ligne dans la file. »
- anything else → 409 « Cette réclamation, ou ce remboursement, a changé entre-temps — rien n’a été écrit. Relisez sa ligne dans la file. » This is true: a committed C6 write can only become refunded or refused_final with the same refundId.
None of these sends an alert, writes an audit, attempts a notice or returns ok. The console renders body.error for every 409.
Vitest pins the call shape (isolationLevel, maxWait ≤ 2000, timeout ≤ 5000) and each mapping, with a mocked $transaction rejecting with each code (J-M23).
IMPLEMENTATION NOTE (W4): implemented with the exact texts. The C6 bound_to_other_claim abort answers the B10 (4) text naming the claim the transaction found. console.warn carries the error code (P2034, P2028, 1020, …) or the error name. Pinned by tests/claims-r13-attribution.test.ts (J-M23: P2034, P2028, 1020, a generic error, a lost commit with the record written and failed, a failed re-read).
IMPLEMENTATION NOTE (W4, fixer round 1): two texts differ from the frozen ones, because they said more than the code establishes. (1) The r true variant named the console section « Avis client non envoyés », which does not exist in this tree (H10, email slice, has not landed, while the attribute route and the console are ungated). It reads « Cette réclamation est déjà liée à ce remboursement (statut actuel : « ${status} »). Cette action n’a tenté aucun e-mail et n’a écrit aucune trace d’audit ; sa clôture est enregistrée. Relisez sa ligne dans la file. »; the H10 slice may name the section again once it renders. (2) « anything else » — the re-read shows the claim not bound to this row after a non-abort error — establishes that nothing was written, not that the claim or the refund changed: the error can be a deadlock caused by the binding of a DIFFERENT row (the binder read share-locks every claim row) or precede the transaction. It reads « La liaison n’a pas pu être enregistrée (écriture concurrente ou erreur de la base) — rien n’a été écrit. Relisez sa ligne dans la file, puis réessayez. ». The C8 path logs the same console.warn('[claims] binding transaction aborted', code). Pinned by tests/claims-r13-attribution.test.ts (J-M23 mappings; block « C7 (W4 fixer) »: the not-written text asserts no change, and no operator text names a console section the console does not render, with a negative control restoring the former tail).

### C8 [CORE] Adoption mirror insert under a Serializable transaction
adoptStripeRefundInner fresh branch, after every DB guard and Stripe anchor (2075-2185) and only when dryRun is false:
row = await prisma.$transaction(async (tx) => {
  const stamped = await tx.refund.findFirst({ where: { orderId: order.id, reason: claim:<id> }, select: { id: true } })
  if (stamped) throw new AdoptionAbort('stamped_exists')
  return tx.refund.create({ data: <existing mirror data 2191-2206>, select: { id: true } })
}, { isolationLevel: Serializable, maxWait: 2000, timeout: 5000 })
Outcomes:
- stamped_exists → 409 wrote: false « Un remboursement porte déjà l’identité de cette réclamation sur cette commande : aucune ligne miroir n’a été écrite. Relancez « Réconcilier d’après la preuve ». »
- P2002 → 409 wrote: false, with the existing text at 2211.
- Any other error → re-read refund.findFirst({ where: { stripeRefundId: refund.id }, select: { id, reason } }) in try:
  - found with reason claim:<id> → trace.wrote = true, continue as a commit;
  - not found → 409 wrote: false « L’enregistrement de la ligne miroir n’a pas pu être confirmé : aucune ligne miroir n’existe, rien n’a été écrit. Réessayez. »;
  - read throws → the C7 « État non établi » text, wrote: null.
After commit: trace.wrote = true, then the audit (existing), then attributeWithEvidence(claim, row, refund) (B11 (c)).
The 5 s timeout is far below innodb_lock_wait_timeout, so an engine insert (refund.ts 808) that waits on this transaction's range lock waits at most about 5 s. It is not turned into a rethrown non-P2002 error.
IMPLEMENTATION NOTE (W4): implemented with tx.refund.findFirst (C8), not the tx.refund.count of D9 (4) — same lock, same answer. ER-M08 resolved: when a transaction error is followed by a re-read that finds the mirror with reason claim:<id>, trace.wrote is true because wrote means « the mirror row exists » (adoptStripeRefundForClaim), but the adoption audit is NOT written a second time — whether this call or a concurrent one committed it is not established. A re-read that finds the Stripe refund recorded under another claim’s stamp answers the existing « Ce remboursement Stripe vient d’être enregistré par ailleurs — rechargez la file. » with wrote false. Pinned by tests/claims-r13-adoption.test.ts (J-M25).
IMPLEMENTATION NOTE (W4, fixer round 1): the mirror transaction's error log is C7's console.warn('[claims] binding transaction aborted', code); the former « adoption mirror transaction aborted » variant is gone. J-M25 (c) pins it.

### C9 [CORE] Pre-images of reconcile, apply, park and close writes
(a) applyRowTruth(claim, row, truth, relation): claim carries { id, status, refundError, refundId }. Every write (bind 1741, at_stripe succeeded 1763, failed 1785, pending 1798, reverted, absent_dead 1818) uses where { id, status: claim.status, refundError: claim.refundError, refundId: claim.refundId }. After its own bind write, the next write (reconcileClaimForRefund, or a park) expects the post-bind values.
(b) reconcileClaimForRefund: both CASes add refundError: <the value read for that candidate> to where { id, refundId, status: { in: ['refunding', 'approved'] } }.
(c) enterFinancialVerification gains a REQUIRED input expect: { status: string; refundError: string | null }.
- Entry: where { id, status: expect.status, refundError: expect.refundError }, admitted only when expect.status ∈ {approved, refunding}.
- Relabel: where { id, status: 'financial_verification', refundError: expect.refundError }, only when expect.status === 'financial_verification'.
- After a successful relabel with a reason different from the pre-image's reason: the claim_financial_verification alert, dedupeKey claim_fv:<id>:<reason>.
- Neither CAS matched → { entered: false }; the caller returns changed_during_read.
- Every caller passes the pre-image it read (TypeScript makes the field required).
(d) N8 proof write: G8.
(e) resolveStuckClaim: where { id, status: claim.status, refundError: claim.refundError } (replaces refundError: { not: null }). The refunded + REVERTED_AFTER_REFUND declarations use the same where.
(f) markClaimsForRevertedRefundRow: G11.
Pin: for each function, a fixture that changes refundError between read and write → 0 writes and the changed outcome.
IMPLEMENTATION NOTE (W2): (a) applyRowTruth takes { id, status, refundId, refundError } and every write is a CAS on it (the bind count is now checked; the park after it expects the post-bind status); (b) both reconcileClaimForRefund CASes carry the refundError read; (c) enterFinancialVerification requires expect (a ts-expect-error fixture pins it), entry only from approved / refunding, relabel only from financial_verification, and the relabel alerts once per NEW reason (I-02); (e) resolveStuckClaim CASes on the refundError read. (d) is the N8 writer (W3); (f) is G11 (webhook slice). Pinned by tests/claims-r13-cas.test.ts (J-M26).

### C10 [CORE] Exactly-one binding rehearsal on a real database
tests/claims-attribution-race.db.test.ts uses describe.skipIf(!process.env.CLAIMS_RACE_DATABASE_URL). No CI, cron or infra change: CI never sets the variable.
It runs against a disposable MariaDB of o2switch's major version, never staging data. Two PrismaClient instances (two connections); prisma db push on the disposable schema; no Stripe call (evidence injected into attributeWithEvidence).
Fixture: one unstamped succeeded Refund row R, two FV claims C1 and C2 on the same order.
Run attributeWithEvidence(C1, R) and attributeWithEvidence(C2, R) concurrently, 20 iterations, resetting between them.
Assert every iteration:
- exactly one claim { refunded, refundId R };
- the other is unchanged FV with its original refundError;
- the loser's result is a C6 abort or C7 409, never ok.
The run is recorded once in docs/ops/REFUND-FINANCIAL-CONTRACT.md with the server version, before any window opens.
IMPLEMENTATION NOTE (W4): tests/claims-attribution-race.db.test.ts exists. It runs only with CLAIMS_RACE_DATABASE_URL set and refuses any URL whose host is not a loopback host, that names a Grubano or o2switch resource, or that equals DATABASE_URL / DATABASE_URL_STAGING / DATABASE_URL_PROD (the guard itself is always tested). The schema is pushed with node node_modules/prisma/build/index.js db push --skip-generate (the .bin/prisma shim is a shell script on Windows). No raw SQL is allowed, so the test does not read the server version: the operator records it with the counts the test logs. OPEN: the rehearsal has not been run (no disposable MariaDB in the implementation environment); its one-time pre-window run and its record in docs/ops/REFUND-FINANCIAL-CONTRACT.md remain to be done.
IMPLEMENTATION NOTE (W4, fixer round 1): the OPEN item above is CLOSED — the rehearsal RAN on a disposable MariaDB 12.3.2 (127.0.0.1:3310, database claims_race, pushed with Prisma 5.22.0). 20/20 iterations had exactly one claim {refunded, R}; the loser was unchanged with its original refundError and never ok; the loser answer was the C7 not-written 409 ×20 (abort codes P2034 ×19, one PrismaClientUnknownRequestError with no code). The REPEATABLE READ negative control bound R to both claims in 20/20. The break/restore (binder read outside the transaction) went red at iteration 0 with two refunded claims. Recorded with the server version in docs/ops/REFUND-FINANCIAL-CONTRACT.md §20. The target guard is stronger: it refuses the o2switch account prefix (a hosted database through a loopback tunnel), any database name that is not claims_race…, and any URL or database name equal to a DATABASE_URL* read from process.env, .env.local or .env (vitest loads no env file). Each of those cases is in the always-run guard test.
IMPLEMENTATION NOTE (W8): the orchestrator re-ran the rehearsal on commit d555f6f (local disposable MariaDB 12.3.2, server default isolation REPEATABLE-READ, CLAIMS_RACE_NEGATIVE=1): in 20/20 iterations exactly one claim was refunded and bound and the other stayed unchanged (financial_verification, original refundError); the loser was always the C7 409 « La liaison n’a pas pu être enregistrée (écriture concurrente ou erreur de la base) — rien n’a été écrit. Relisez sa ligne dans la file, puis réessayez. » (winners 9 / 11); the negative control with the isolation level omitted bound the Refund to BOTH claims in 20/20. Recorded in docs/ops/REFUND-FINANCIAL-CONTRACT.md §20 and §24. The rehearsal is re-run on the final certified release-candidate SHA before any Claims window (docs/ops/CLAIMS-R13-OPERATOR-PRECHECK.md Étape 3) and never targets staging or production (the always-run target guard). The record and the re-run sentence are pinned by tests/claims-r13-residuals.test.ts (J-M27).

### C11 [CORE] Residuals stated verbatim
docs/ops/REFUND-FINANCIAL-CONTRACT.md, section « Résidus round 13 », and the it.skip reasons of the stalled-attempt race test state, one each:
(R1) a same-claim double refund when an attempt's pre-insert path (refund.ts 724-808) stays suspended longer than ATTEMPT_QUIESCENCE_MS while a proof and a re-approval happen;
(R2) a refund made outside the system during a stalled attempt: Dashboard, admin rail, or attribution of an unstamped row;
(R3) a Dashboard refund landing between T2(f)'s reads and the engine's charge read (refund.ts 755);
(R4) on a routed payment, E2 passed just before a concurrent markRefundRowFailed, which can reverse the restaurant transfer twice;
(R5) an engine key collision is not guaranteed when the charge cursor moved through something other than an engine create between two attempts' charge reads: a Dashboard refund, a failure renamed by markRefundRowFailed, or an intermediate engine create whose own charge read followed such a move (verifier A P3).
The engine guard (exclusiveReason) is recorded there as a founder decision for a later round, not part of round 13.
IMPLEMENTATION NOTE (W8): landed. docs/ops/REFUND-FINANCIAL-CONTRACT.md §24 « Résidus round 13 » states R1-R5 verbatim (one bullet each), records the engine guard (exclusiveReason) as a founder decision for a later round, and records the J-M24 rehearsal (MariaDB 12.3.2, 20/20, negative control 20/20) with its re-run on the certified release-candidate SHA before any window. tests/claims-r13-stale-attempt.test.ts carries four it.skip blocks whose reasons are R1-R4 verbatim: J-M27 and binding rule 14 list four skips, and R5 (the guard comparison, verifier A P3) names no stalled-attempt scenario a skip could describe, so it is stated in the doc only — « one each » is read as one doc sentence for each of R1-R5 and one skip for each of R1-R4. Pinned by tests/claims-r13-residuals.test.ts (J-M27).

## D. EXACT SAFE EXITS

Every exit a section-A state may take. ENGINE answers follow A-S00 (lib/refund.ts byte-identical, no exclusiveReason, no E5b). Only D2 can reach executeRefund. Every other exit writes no Refund row except the adoption mirror (D9), calls neither the engine nor any Stripe write, and records moneyMoved:false. Gate status follows C7. The console offers a control only where the server function behind that route accepts. Registry ids (E-xx) are defined in section E; REG-n in section A maps to them through E0.

### D0 [CORE] Routes, gates and the control-parity rule
PAGE: /[locale]/admin/claims (app/[locale]/admin/claims/page.tsx).
- CARD = AdminFinancialVerification. Always mounted; data from GET /api/admin/claims/financial-verification, resolveAdmin only.
- ARB = AdminClaimsArbitration. Mounted only while claimsOpen.

ROUTES:
- POST /api/admin/claims/[id]/arbitrate. GATED by CLAIMS (route 27-29 answers 403 {gated:true}). Payment is additionally GATED by REFUNDS: triggerClaimRefund returns {state:'pending', reason:'refunds_disabled'} before any write (claims.ts 504).
- Ungated (resolveAdmin only): POST /api/admin/claims/[id]/reconcile; POST /api/admin/claims/[id]/attribute (row attribution with {refundRowId}, adoption with {stripeRefundId}; both accept dryRun); POST /api/admin/claims/[id]/resolve-stuck; POST /api/admin/claims/[id]/closure-notice.
- Webhook POST /api/webhooks/stripe: ungated, not an operator exit.

PARITY: every row payload carries server-computed flags from the SAME pure functions the routes call:
- reconcilable = reconcileRefusal({claim, boundRow}) === null;
- resolvable = isStuckResolvable({claim, boundRow});
- each attribution candidate: attributionRefusal pre-check === null;
- approvable = acceptedExits includes 'approve' && arbitrationRefusal('approve', claim, now) === null.
A control is rendered iff its flag is true. A refused action renders the refusal text, never a disabled button that hides the reason.

TEST (tests/claims-exit-parity.test.ts): for every D1 fixture, the rendered controls equal the actions the server accepts. Break/restore: flip one flag computation in a temp copy → red.
IMPLEMENTATION NOTE (W7): the console half landed. listActionableRefundClaims, listReconcileRequiredClaims and listFinancialVerificationClaims carry approvable = acceptedExits ∋ 'approve' && arbitrationRefusal('approve') === null on the same facts (the bound row as read; the card never renders « Approuver »); listUnfinalizedClaimRefundRows carries rowId (refundRowId kept, same id). AdminFinancialVerification and AdminClaimsArbitration take an optional payload (initialData / initial) so tests render the consoles from the route payload (react-dom/server): a control is rendered iff its flag, a refused reconcile renders the server text, « Envoyer l’avis au client » is disabled iff a blocker and the blocker line is shown. Pinned by tests/claims-exit-parity.test.ts (J-M29, W7 block: one fixture per D1 row), tests/claims-closure-ui.test.ts and tests/claims-registry-visibility.test.ts.

### D1 [CORE] Exit table (lib/claim-action-rules.ts acceptedExits)
acceptedExits({claim, boundRow, orderId, now}) returns exactly these sets. It replaces the Track A §3 table; 'awaiting_other_row' and every E5b dependency are removed.
1. approved, refundAttempted false, refundError null, refundId null → ['approve' (gated; E-10)].
2. approved, refundAttempted false, refundId null, startsWith(PROOF_PAYABLE_V13) → ['approve' (gated; refused before Q-INSTANT; E-10), 'reconcile'].
3. approved, refundAttempted false, refundId null, legacy payable ('no_refund_proven:' without the v13 tag) → ['reconcile'] (E-01).
4. approved, refundAttempted false, refundId null, startsWith('no_refund_proven_rail_locked:') (AWAITING included) → ['reconcile', 'stuck_close'] (E-01).
5. approved, refundAttempted true, refundId null, startsWith(SAFETY_HOLD) → ['reconcile', 'stuck_close'] (E-01).
6. approved with refundError stripe_failed / engine_row_dead / STRIPE_REVERTED / engine_failed → ['stuck_close'] (E-02).
7. refunding, startsWith('resume_mismatch'), boundRow read and boundRow.reason !== `claim:${id}` → ['stuck_close'] (E-02).
8. refunding, startsWith('resume_mismatch'), boundRow.reason === `claim:${id}` → ['reconcile'] (E-05).
9. refunding with a reconcile marker (M, or M + appended text) → [] while reconcileMarkerAge < RECONCILE_GRACE_MS, then ['reconcile'] (E-05).
10. financial_verification → ['reconcile'], plus 'attribute' when at least one order row passes the attributionRefusal pre-check, plus 'adopt' (operator-supplied re_ id) (E-03 / E-04).
11. refunded, refundError null, refundId set, boundRow.orderId === orderId:
   - boundRow failed with stripeRefundId, or pending → ['reconcile'] (E-07);
   - boundRow succeeded → ['reconcile'], route-only with no console control (E-09).
12. refunded + REVERTED_AFTER_REFUND → ['stuck_close'] (E-06).
13. Every other terminal shape → [].
14. boundRow undefined wherever a row above needs it → [].

TEST: every set that is empty or gated-only must name an E id. An unregistered shape fails the test.
IMPLEMENTATION NOTE (W1): acceptedExits is computed from the same predicates the routes apply (reconcileRefusal, isStuckResolvable, arbitrationRefusal, the FV-only attribute/adopt routes), so D0 parity holds by construction; tests/claims-t49-round10.test.ts pins the sets. ER-M06 resolved: the table also carries the shapes D1 omitted — approved or refunding bound with a null error, legacyStranded, attemptedUnrecorded and the canonical 202 (refunding, bound to its own row pending at Stripe, null error) → ['reconcile']; arbitration and an expired restaurant delay → ['approve', 'refuse_final']; a running delay → [] and refused → []. exitRegistry names every empty or gated-only set with an E id, 'terminal', a non-money note ('not_money:awaiting_decision', 'not_money:restaurant_delay', 'not_money:refused_contestable'), 'unread:bound_row' (row 14) or 'unknown_status'. The input attributableRows carries row 10's pre-check count. 'approve' stays in the set before Q-INSTANT for the canonical v13 shape only (approved, refundAttempted false, refundId null); a v13 text on any other shape gets D14 (2)/(3).
IMPLEMENTATION NOTE (W1, round-1 fix): the « approved … bound with a null error → ['reconcile'] » row covers refundAttempted false as well as true (D2 (1)(b): approve refused; J-M30 fixture). A canonical v13 proof whose instant cannot be read → ['reconcile']: approve is refused until reconcile re-derives the instant, so it is not a revisable approval; a readable instant keeps ['approve', 'reconcile'] before and after it.

### D2 [CORE] APPROVE — the only exit that can move new money
ROUTE: POST /api/admin/claims/[id]/arbitrate {decision:'approve'}. GATED by the CLAIMS lease (route 27-29 answers 403), and by the REFUNDS lease for any payment. Server order:
(1) arbitrationRefusal('approve', claim, now) must be null (D14 order). It is null only for:
   (a) an arbitration-status claim, or a restaurant_review claim whose response delay expired, on the existing decision path: arbitrateClaim casWhere + updateMany to 'approved' with the arbitration metadata (lib/claims.ts ~897-924);
   (b) approved && refundAttempted false && refundError null && refundId null (arbitrateClaim legacyApproved CAS, same updateMany);
   (c) approved && refundAttempted false && refundId null && startsWith(PROOF_PAYABLE_V13) && proofInstant readable && now ≥ instant (C4).
   A decision CAS with count ≠ 1 returns 409 « Cette réclamation a déjà été arbitrée. » and nothing else runs.
(2) REFUNDS gate: after the decision CAS (count 1), arbitrateClaim calls triggerClaimRefund, which returns {state:'pending', reason:'refunds_disabled'} at lib/claims.ts 504 before any claim write. arbitrateClaim then sends I-01 cause 'refunds_disabled' (alertClaimPaymentBlocked) and returns ok with that refund result. The route's toast is approvedNotSent, success tone (F12: never approvedPending); the decision e-mail kind is 'approved' (H03). approveClaim (runClaimAutoApproval, autoResolveSmallClaim; flags off in the beta) does the same after its own CAS. State: E-10.
(3) T1 (C2): before.refundError must be null or v13; the CAS is on the pre-image; M is unique (ISO timestamp + nonce). Otherwise already_handled, with no write.
(4) T2 steps (a), (b), (b'), (c), (e'), (f) (C3), on fresh loadOrderMoneyFacts reads made in this request, for EVERY pre-image. The engine is called only when deriveNoRowOutcome is payable and, for a v13 pre-image, now ≥ instant is re-checked. Every other outcome writes per C3 and sends I-01.
(5) executeRefund({orderId, amountCents: requestedAmountCents, reason: `claim:${id}`}), unchanged. The engine re-reads the PaymentIntent and charge itself (refund.ts 753-761) and applies E1-E6.
(6) T4 (C5): every post-engine claim write is updateMany where {id, status:'refunding', refundError: M}. Count 0 → no claim write; an ok or 202 result sends I-03.
REACHED FROM: A-S01, A-S02, A-S08b (after Q-INSTANT); A-S30b-1, A-S30b-2a, A-S30b-2b; A-S30e-3 (after `until`); approved_not_driven.
CONSOLE: « Approuver » only in ARB, only when approvable (D0). CARD never renders approve. Toasts per F12: approvedRefunded only on state 'refunded' (engine ok + T3 'ours' + T4 count 1); approvedPending only on {state:'pending', reason:'stripe_pending'}; approvedNotSent (tone per F12) otherwise. No text before the engine call says the claim will be paid.
WHY NO UNINTENDED MONEY: T2 re-derives immediately before the engine, so a stale proof parks (A-S38-1, A-S38-2); Q-INSTANT (≥ 60 min) keeps a stalled attempt from being overtaken by a re-approval; T2(a) runs the stamped-row query; T4 stops a late attempt from overwriting a claim bound or reconciled meanwhile.
RESIDUALS: C11, verbatim, in docs/ops/REFUND-FINANCIAL-CONTRACT.md.
IMPLEMENTATION NOTE (W2): ER-M10 resolved — the refunds_disabled I-01 alert is sent by arbitrateClaim (the arbitrate route's caller) after its own decision CAS, and by approveClaim after its CAS; neither ever alerts on a lost decision CAS. The legacyApproved decision CAS now also carries the refundError the refusal read ((1)(b)/(c)). Minimal wiring for server/console consistency: the F12 approvalToast mapping and the four new F13 keys (approvedPending, approvedIdentityUnverified, approvedSuperseded, approvedNotSentUntil) in five locales; the approvedNotSent / approvedFailed / approvedResumeMismatch rewording of F13 stays with the console slice. Pinned by tests/claims-r13-approve-route.test.ts (J-M32).

### D3 [CORE] Q-INSTANT enforcement (one parser, one set of texts: C4)
PARSER: C4's proofInstant (regex literal /payable au plus tôt le (\d{4}-\d{2}-\d{2}T[\d:.]+Z) \(UTC\)/; no match or Date NaN → null). No second parser is created (no parseQuiescenceInstant).
TEXTS: exactly C4's two texts:
- unreadable: « Approbation impossible : l’heure à partir de laquelle cette preuve d’absence permet un paiement n’a pas pu être lue. Relancez « Réconcilier d’après la preuve » (section « Vérification financière requise »). »
- now < instant, REVISABLE (the exit table keeps 'approve'): « Approbation prématurée : la preuve d’absence de cette réclamation ne permet un paiement qu’à partir du ${iso} (UTC) ; ce délai sépare toute nouvelle tentative de remboursement d’une éventuelle tentative antérieure. Rien n’est payé avant cette heure ; approuvez-la à nouveau ensuite. »
APPLIED BY: arbitrationRefusal('approve') as D14 (0); T1 (C2 step 2: already_handled, no write); T2 (e') re-check before executeRefund (C3).
PIN (J-M21): ATTEMPT_QUIESCENCE_MS ≥ 3 600 000; one fixture 1 ms before the instant (refused with the C4 REVISABLE text) and one at the instant (accepted); the parser is a regex literal.

### D4 [CORE] RECONCILE an approved claim — proofs, locks, holds (admissions i, i-b)
ROUTE: POST /api/admin/claims/[id]/reconcile, ungated.

SERVER: reconcileRefusal admits
(i) approved && refundAttempted === false && refundId === null && (startsWith('no_refund_proven:') || startsWith('no_refund_proven_rail_locked:'));
(i-b) approved && refundAttempted === true && refundId === null && startsWith(SAFETY_HOLD).
Then N0-N8: loadOrderMoneyFacts, then deriveNoRowOutcome.

WRITES:
- N8 stamped count {orderId, reason `claim:${id}`} > 0 → changed_during_read, no write.
- A proof is a CAS where {id, status, refundError, refundAttempted, refundId as read}, setting refundAttempted false and refundId null.
- A park goes through enterFinancialVerification.
- A no_write outcome writes nothing.

REACHED FROM: A-S01, A-S01b, A-S02, A-S03, A-S04, A-S05a-1, A-S05a-2, A-S06a, A-S07 (no-row), A-S08a, A-S08b, A-S10b, A-S10c, A-S11 (no-row), A-S14b (canonical), A-S26, A-S30, A-S30c-1, A-S30c-2, A-S30e-1, A-S30e-2, A-S30g, A-S32-1, A-S32-2, A-S38-1, A-S38-2, A-S39.

CONSOLE: « Réconcilier d’après la preuve » on the CARD otherUnsettled row iff reconcilable. The button carries this caption, shown before the click (verifier A P2: a closable state can become an FV park): « Relire la preuve peut placer la réclamation en vérification financière (si un remboursement n’y est pas rattaché ou si Stripe ne peut pas être lu entièrement) ; « Clôturer ce dossier… » n’y est alors plus proposé. »

Toasts: the `said` texts of A-S01, A-S01b, A-S10b and A-S29-3.

WHY NO MONEY:
- Source-scan pin: the call graph of reconcileClaimEvidence contains no executeRefund, driveRefund, finalizeRefund, markRefundRowFailed, refunds.create or transfers.createReversal.
- A written proof grants no authority. Payment happens only through D2, whose T2 re-derives on fresh reads.
IMPLEMENTATION NOTE (W2, round-1 fix): landed in W2 for (i)/(i-b), dispatched after G2 (3)'s mine and no-PaymentIntent checks (G8 note). The pre-click caption and the A-S29-3 toast stay with the console slice.
IMPLEMENTATION NOTE (W3): the (i)/(i-b) filter is gone: every admitted no-row pre-image takes N0-N8 (G2 note). (i) and (i-b) are pinned through the route (tests/claims-r13-rules.test.ts, J-M33): a proof resets refundAttempted false only through the N8 write, a park uses the read pre-image, and a stamped row appearing before the write gives changed_during_read with 0 updateMany. The caption stays with the console slice.

### D5 [CORE] RECONCILE a refunding claim — marker after grace, own-row legacy mismatch (ii)
SERVER:
- the existing marker admission (reconcileMarkerAge >= RECONCILE_GRACE_MS). The marker regex must accept M = ISO timestamp + nonce (ATTEMPT TOKEN), and reconcileMarkerAge parses only the timestamp;
- (ii) refunding && refundId && startsWith('resume_mismatch') && boundRow?.reason === `claim:${id}`.
The mine / bound / no-row paths run per section A. A mine===1 write is a CAS on the read pre-image.

REACHED FROM: A-S12 and A-S12b (refunding pre-image), A-S16a, A-S16b, A-S30d, A-S33-1, A-S33-2, A-S35 (marker stage), A-S36-1, A-S36-2, A-S36b.

CONSOLE:
- During grace: CARD otherUnsettled row, moneyState reconcile_required, no button, and the server's grace refusal text.
- After grace: reconcileRequired bucket with « Réconcilier d’après la preuve ».
- A-S36-1, A-S36-2, A-S36b: the identity_unread money line.

WHY NO MONEY:
- status refunding: approve answers « Cette réclamation n’est pas en arbitrage. » (claim-action-rules.ts 119-121); the sweep selects approved only; the T1 CAS requires refundAttempted false.
- isStuckResolvable is false while a marker stands.
- A late attempt cannot overwrite what reconcile wrote: T4 CAS, then I-03.
IMPLEMENTATION NOTE (W3): the marker admission needs a READABLE age ≥ RECONCILE_GRACE_MS; an unreadable instant is refused with its own text (G1 W3 note). A marker past its grace takes the mine path (A-S35: within the window no write with until = createdAt + 21 h; dead → engine_row_dead + ALERT-B) or N0-N8, where a payable proof's instant is the marker timestamp + ATTEMPT_QUIESCENCE_MS (C4 (1)). The own-row mismatch (ii) takes the mine path on refundRowTruth. The grace refusal's absent button and the « Conclusion possible à partir du » toast are console texts (F14): W3 pins the outcomes, the until and zero writes (tests/claims-r13-rules.test.ts, J-M34).
IMPLEMENTATION NOTE (W3, round-2 fix): the unreadable-marker refusal is carried to every surface. The CARD reconcileRequired bucket renders the refusal text and no control (round-1 fix). listActionableRefundClaims classifies the claim 'reconcile_marker_unreadable' (F15 W3 round-2 note), so ARB's guidance line no longer names reconcile for a claim the gate refuses for a reason other than the grace.

### D6 [CORE] RECONCILE a financial_verification claim (evidence and time exits)
SERVER: the existing FV admission, then the bound / mine / no-row derivation of section A.

WRITES:
- relabel via enterFinancialVerification (I-02 on a NEW reason only);
- mine===1 → refunded;
- a no-row proof → approved, refundAttempted false. It grants nothing until D2.

EVIDENCE EXITS: A-S05c-2a, A-S17, A-S23b-1, A-S23b-2, A-S29-3, A-S34 (mine===1).

TIME EXITS (reconcile once Stripe is terminal or readable, or the key/mode is fixed): A-S05b-1, A-S05c-1, A-S09a, A-S09b, A-S12 and A-S12b (FV pre-image), A-S13a, A-S14a-2a, A-S14a-2b, A-S22 (pending / within window / unreadable), A-S29-2, A-S30e-4, A-S38-1, A-S38-2, A-S40.
The only date any copy states is `until` = row.createdAt + 21 h (UTC).

CONSOLE: CARD bucket financialVerification. « Réconcilier d’après la preuve », plus the attribution panel (D8) and the adoption panel (D9).

WHY NO MONEY: FV is refused by arbitrationRefusal (« pas en arbitrage »); the sweep selects approved only; the T1 CAS requires approved; reconcile never calls the engine.
IMPLEMENTATION NOTE (W3): landed. An FV pre-image takes the mine path or N0-N8. A relabel alerts only on a NEW reason (I-02). A proof written from FV is approved, with refundAttempted false and refundId null, and grants nothing before its instant. An FV claim approved earlier (arbitrationDecision 'approved') is refused by the finalization lock (« déjà été arbitrée — décision définitive ») before « pas en arbitrage »; both refuse. Pinned by tests/claims-r13-reconcile.test.ts (J-M35): ten FV states run blocking, then resolved.

### D7 [CORE] RECONCILE a refunded claim — R0a / R0b / R0c (admission iii) and the unfinalized-rows control
SERVER (iii): status refunded && refundError === null && refundId && boundRow && boundRow.orderId === claim.orderId && ((boundRow.status === 'failed' && boundRow.stripeRefundId) || boundRow.status === 'pending' || boundRow.status === 'succeeded').

OUTCOMES, all read-only toward Stripe:
- R0a, failed row with id → markClaimsForRevertedRefundRow {failed_row, onlyClaimId} → 'reverted_after_refund', or 'changed_during_read' when the CAS count is 0.
- R0b, pending row → refundRowTruth without absenceIsEvidence:
  - at_stripe failed or canceled → helper pending_row_stripe (row untouched) → 'reverted_after_refund';
  - at_stripe succeeded, pending or requires_action → 'refund_still_standing' {stripeStatus};
  - absent_within_window → 'unconfirmed_within_window' {until}, with the existing toast. NEVER « toujours ABOUTI ou en attente » (verifier A P3);
  - unreadable → 'stripe_unreadable_retry';
  - absent_dead or contradiction → 'refunded_row_unproven' {detail}.
- R0c, succeeded row → retrieve:
  - row_terminal succeeded → 'refund_still_standing' {stripeStatus:'succeeded'};
  - reverted → helper stripe_object → 'reverted_after_refund';
  - unreadable → retry;
  - contradiction → 'refunded_row_unproven'.
Every R0 write sends I-01 with cause 'reverted_after_refund'.

REACHED FROM:
- A-S31c and A-S31f-1 (after retries are exhausted) via R0a;
- A-S31d, A-S10 and A-S21 via R0b;
- A-S31e-1, A-S31e-2 and A-S23a-* via R0c (route only; E-09).

CONSOLE:
- A-S31c: CARD otherUnsettled row (listActionableRefundClaims OR clause) with a button iff reconcilable.
- Pending rows: listUnfinalizedClaimRefundRows returns {rowId, claimId, claimStatus, refundError, orderId, rowReason, reconcilable}, with a button iff reconcilable. The caption replaces AdminFinancialVerification line 365: « La seule action proposée ici est « Réconcilier d’après la preuve » : elle relit la preuve chez Stripe et dans nos lignes, et ne déplace aucun argent. » This is true for refunded claims and for FV claims that kept their refundId.
- No list offers R0c.

Toast reverted_after_refund per A-S31-1, with the conditional customer sentence « Quand les réclamations sont ouvertes, le client lit « vérification manuelle » ; sinon il ne voit aucune réclamation. » (R-X0-4).

WHY NO MONEY: the helper writes Claim rows only, with updateMany on the exact pre-image. It never writes a Refund row, never calls the engine and never writes to Stripe. The claim stays status refunded, which is terminal for approve (110-112), the sweep and T1.
IMPLEMENTATION NOTE (W5): SERVER as the G10 note. CONSOLE, minimal wiring of this slice: listActionableRefundClaims gains the two I-09 OR clauses (refunded + REVERTED_AFTER_REFUND; refunded + null error + refundId among the failed-with-id rows), keeps a settled claim only when its bound row is on its own order (E-07 / E-13 stay disjoint) and passes the row's orderId to the gate — A-S31c is listed reconcilable, moneyState stripe_failed; an E-06 claim is listed resolvable, not reconcilable. listUnfinalizedClaimRefundRows carries refundError, rowReason, reconcilable and reconcileRefusal (its existing keys refundRowId / claimId / claimStatus are kept: the console reads them). AdminFinancialVerification renders « Réconcilier d’après la preuve » on an unfinalized row iff reconcilable, the server's refusal text otherwise, and the caption above replaces « Aucune action n’est proposée ici. ». The other I-09 payload fields (refundedUnproven, closureNotices) stay with their slices. Pinned by tests/claims-t49-round13-r0.test.ts (listing, E-09 negative pin).

### D8 [CORE] ATTRIBUTE a Refund row to a financial_verification claim
ROUTE: POST /api/admin/claims/[id]/attribute {refundRowId, dryRun?}, ungated.
SERVER ORDER:
(1) Claim status is FV; otherwise 409 unusable_status.
(2) Row on the claim's order.
(3) attributionRefusal (B10), with boundToWhere (B1) for bound_to_other_claim.
(4) t = refundRowTruth(row), without absenceIsEvidence, read BEFORE any write (G12).
(5) PROVEN = (row pending && t at_stripe succeeded) || (row succeeded && t row_terminal succeeded). Not proven → 409 with the G12 NOT PROVEN text: no write, no audit.
(6) dryRun → preview, no write.
(7) attributeWithEvidence: the C6 Serializable transaction (binder read + FV→refunded CAS on {id, status FV, refundError as read}). Its abort outcomes are C6's; every other error is mapped by C7. There is NO 200 path other than C6's observed commit: a commit observed only through the C7 re-read answers 409 (C7 texts), never 200.
AFTER AN OBSERVED COMMIT ONLY, in C6 order: recordClaimClosure (H05), I-04 (pending row), audit claim.attribute_refund {moneyMoved:false}; then the route's closure-notice attempt (D10 (iii)) and the success toast per A-S21 / A-S23a-1 (G12 texts).
REACHED FROM: A-S18, A-S20, A-S21, A-S23a-1, A-S23a-2, A-S27-1a, A-S27-1b, A-S27-2 (a stamped row Stripe proves), A-S42.
REFUSALS: A-S17, A-S22, A-S22b, A-S23b-1, A-S23b-2.
CONSOLE: « Attribuer » is enabled only for candidates that pass the pre-check. Failed and bound rows show REFUSAL_LEGEND. Only 'refunded' renders a success toast; every 409 renders body.error.
ONE REFUND, ONE CLAIM: the binder count and the CAS share one Serializable transaction (C6). Refund.reason is never re-written (B4). Tests: J-M23 (mocked call shape and mappings), J-M24 (two-connection rehearsal), J-M37 (evidence before write).
IMPLEMENTATION NOTE (W4): ER-M02 resolved as C6 / C7 state — the in-transaction CAS carries the refundError pre-image, and a commit observed only through the C7 re-read answers 409 with the C7 « déjà liée » text, never 200 and never « rien de plus n’a été écrit ». The row branch of the route accepts dryRun (strict schema kept). The closure-notice attempt of D10 (iii) / H07 is not wired: sendClaimClosureEmail does not exist yet (email slice); the attribute result already carries evidence and amountCents for it. The console renders body.error for every 409 and a success toast only for refunded (attributionSuccessText).
IMPLEMENTATION NOTE (W4, fixer round 1): (6) is pinned. attributeClaimRefund({ dryRun: true }) and the route's { refundRowId, dryRun: true } answer the preview with rowStatusBefore and Stripe's amount, and write nothing: 0 transaction, 0 claim write, 0 closure record, 0 audit, 0 alert. The negative control, dryRun false, answers refunded (tests/claims-r13-attribution.test.ts). STILL OPEN for the email slice: after an observed 'refunded' commit, the route's closure-notice attempt (D10 (iii) / H07) on the row branch and the adoption branch — never on a C7 409 or the A-S34 409. J-M38 (iii) must cover both branches, and a commit observed only through the C7 re-read, which answers 409 and sends nothing.
IMPLEMENTATION NOTE (W8): the item the W4 fixer note left « STILL OPEN for the email slice » is closed by W6. POST /api/admin/claims/[id]/attribute attempts the closure notice (sendClaimClosureEmail) after an observed 'refunded' commit on both the row branch and the adoption branch (dryRun excluded), and never on a C7 409 or the A-S34 409 (D10 W6 note). Pinned by tests/claim-emails-routes-closure.test.ts (J-M38).

### D9 [CORE] ADOPT a Stripe refund with no local row
ROUTE: POST /api/admin/claims/[id]/attribute {stripeRefundId, dryRun?}, ungated.

SERVER ORDER:
(1) Claim FV; no local row has stripeRefundId === re_ or id === metadata.grubano_refund_row.
(2) stripe.refunds.retrieve(re_), read only. Requires payment_intent === the order PI, charge === the PI's latest_charge, status succeeded, amount <= amount captured, and no grubano_refund_row tag (engine-tagged refunds are refused).
(3) dryRun → preview.
(4) prisma.$transaction(Serializable, maxWait 2000, timeout 5000): tx.refund.count({orderId, reason `claim:${id}`}) > 0 → throw → 409 « Un remboursement porte déjà l’identité de cette réclamation sur cette commande : aucune ligne miroir n’a été écrite. Relancez « Réconcilier d’après la preuve ». » (wrote:false). Otherwise the existing mirror insert (idempotencyKey external:<re_>, reason claim:<id>, status succeeded, stripeRefundId re_).
(5) Any other transaction error → 409, nothing written.
(6) attributeWithEvidence (D8 steps 7 onward) with the refund read in (2). A refusal after the mirror → the A-S34 text, wrote:true. A-S34 then exits via D6 mine===1.

REACHED FROM: A-S19, A-S38-1, A-S40 (once succeeded).

ONE REFUND, ONE CLAIM: idempotencyKey external:<re_> is @unique, so a second adoption of the same re_ for another claim fails with P2002 → 409, nothing written.

WHY NO MONEY: no engine and no Stripe write. The mirror records a refund Stripe already reports succeeded. A later payment for the claim meets T2(a) (own stamped row).

Do not adopt a refund that belongs to something else; that claim stays in E-04.
IMPLEMENTATION NOTE (W4): (1) is read together with B11 (a) — an existing mirror row stamped for this claim is bound through attributeWithEvidence, which reads Stripe; the fresh branch applies only when no local row records the refund. (4) uses tx.refund.findFirst (C8). (6) as B11 (c), with the W4 variants noted there.

### D10 [CORE] CLOSURE NOTICE attempts (no money; the exit of E-16)
ATTEMPTED ONLY FROM:
(i) resolve-stuck route, after resolveStuckClaim returned ok (its CAS count 1; the H05 record is written inside it) and after recordAdminAudit, WHATEVER that boolean (it only feeds noteRecorded);
(ii) reconcile route, on outcome 'refunded';
(iii) attribute route, not dryRun, outcome 'refunded' (row and adoption branches) — i.e. a C6 commit observed by the resolved promise; the C7 re-read branch attempts nothing;
(iv) POST /api/admin/claims/[id]/closure-notice, the explicit per-claim resend, with an empty body.
No sweep, no cron, no webhook send, no recovery send (R-D6(d), R-D8).
ELIGIBILITY (C4 / CONVERGENCE « closure e-mails tied to actual new-build closure events »): ONLY the H05 closure record (EmailDispatch trigger 'claim_closure_record', dedupeKey claim:<id>), which only this build writes, at closure time (H05 sites). AdminAuditLog NEVER decides eligibility: HEAD already writes claim.arbitrate, claim.resolve_stuck, claim.attribute_refund and claim.adopt_stripe_refund rows for legacy closures, and recordAdminAudit returns false whenever ADMIN_AUDIT_ENABLED is off. With no record the sender answers 'no_closure_record' (H06 step 3): the claim is not listed as a missing notice and is counted in census closure.terminalWithoutRecord (E-18).
CLAIMS lease closed: every attempt is skipped with the logged reason 'claims_disabled' (H02, I-08); the operator toast says the e-mail was not sent because claims are closed.
REFUNDED KIND: (iv) first calls reconcileClaimEvidence (R0, D7). It sends only when that call returns 'refund_still_standing' with stripeStatus 'succeeded' and an integer amountCents > 0 from a Stripe read made in the same request (H08). Otherwise no send and nothing marked beyond what R0 did (R-X0-1). It never sends over REVERTED_AFTER_REFUND, and never for E-13 claims.
WHY NO MONEY: lib/claim-emails.ts imports neither lib/refund, lib/stripe nor lib/claims (H15 source guard). The closure-notice route calls only reconcileClaimEvidence, sendClaimClosureEmail and recordAdminAudit.
IMPLEMENTATION NOTE (W6): (i)-(iv) landed (H07, H08). A record-write failure, a closure observed only through the C7 re-read and a webhook or recovery settlement attempt nothing. Pinned by tests/claim-emails-routes-closure.test.ts (J-M38) and tests/claims-resolve-stuck-route.test.ts (J-M39: the attempt runs with the audit boolean true and false).

### D11 [CORE] STUCK CLOSE — the declaration exit (resolve-stuck)
ROUTE: POST /api/admin/claims/[id]/resolve-stuck {resolution: 'settled_out_of_band' | 'closed_no_payment', note}, ungated.
SERVER: read the claim and boundRow, then isStuckResolvable:
- false for a reconcile marker;
- false for any 'no_refund_proven:' error;
- false for resume_mismatch unless boundRow is read and boundRow.reason !== `claim:${id}`;
- true for approved or refunding with any other refundError;
- true for refunded + REVERTED_AFTER_REFUND;
- false otherwise.
WRITES (resolveStuckClaim): updateMany where {id, status: read, refundError: read}.
- approved or refunding: the existing settled_out_of_band / closed_no_payment data.
- refunded + REVERTED_AFTER_REFUND: settled_out_of_band → status refunded, refundError `${DECLARED_AFTER_REVERT} déclaration admin : payé autrement après l’échec chez Stripe du remboursement lié. ` + the original; closed_no_payment → refused_final, refundError kept.
- count 0 → 409 « Cette réclamation a changé d’état entre-temps — rien n’a été écrit. Relisez sa ligne dans la file. »
- count 1 → recordClaimClosure(id) inside resolveStuckClaim (H05; a claim settled, reverted then declared keeps its first record via P2002).
ROUTE after ok: recordAdminAudit (boolean → noteRecorded, existing round-13 route code), then the D10 (i) attempt whatever the audit boolean.
REACHED FROM: every E-01, E-02 and E-06 state.
CONSOLE: « Clôturer ce dossier… » iff resolvable.
WHY NO MONEY: no engine and no Stripe call. A declaration is never money evidence: claimClosureKind → settled_by_declaration or closed_by_declaration → customer closed_by_support (R-D4); N3 never counts a binder with a non-null refundError as explaining a refund; boundToWhere counts it as a binder, so a refundId it keeps cannot settle another claim.
IMPLEMENTATION NOTE (W5 fixer): the terminal exemption lands with W5, the first slice that writes REVERTED_AFTER_REFUND (without it every E-06 marking offered « Clôturer ce dossier… », which the server refused). resolveStuckClaim admits refunded + startsWith(REVERTED_AFTER_REFUND) past its terminal guard; every other terminal claim keeps the existing « Cette réclamation est déjà clôturée. » refusal before the predicate (refunded + DECLARED_AFTER_REVERT and refunded + null error included: no re-declaration). The CAS is where {id, status: read, refundError: read}; settled_out_of_band on E-06 writes refunded + `${DECLARED_AFTER_REVERT} déclaration admin : payé autrement après l’échec chez Stripe du remboursement lié. ` + the original text; closed_no_payment writes refused_final and keeps refundError; count 0 → the D11 409 text for every declaration (the C9 (e) pin in tests/claims-r13-cas.test.ts now reads it); count 1 → recordClaimClosure (H05 site 7) for every declaration. The route is unchanged (recordAdminAudit → noteRecorded); the D10 (i) notice attempt belongs to the e-mail slice — until it lands, a declaration has its closure record and no notice, and is counted in census closure.missing (E-16). Pinned by tests/claims-r13-declaration-after-revert.test.ts: the listActionableRefundClaims flag equals the POST resolve-stuck verdict on the E-06 fixture, both resolutions 200, a count-0 fixture, P2002 silent, and the negative controls (DECLARED_AFTER_REVERT, null error) refused; break/restore run (removing `&& !settledThenReverted` turns both 200 fixtures red; the local name avoids the E0 REMOVED identifier revertedAfterRefund).
IMPLEMENTATION NOTE (W6) on ER-R31: the WHY NO MONEY clause « boundToWhere counts it as a binder, so a refundId it keeps cannot settle another claim » is false for a declared resume_mismatch claim: resolveStuckClaim keeps its refundError and boundToWhere excludes resume_mismatch. Corrected statement: a declaration keeps a non-null refundError, so the declared claim never settles on its row; a declared resume_mismatch claim was already disowned and is not a binder of that row, which settles no other claim through it (attribution and settlement read the row's binders and stamp). No money consequence. Pinned by the ER-R31 case of tests/claim-closure-record.test.ts. The D10 (i) attempt after the audit landed with the e-mail slice (W6).

### D12 [CORE] WEBHOOK marking exit (non-operator)
FILE: app/api/webhooks/stripe/route.ts handleRefundStatusEvent. The money writes and their order are byte-identical (WEBHOOK binding rule).

FAILED OR CANCELED EVENT:
- Row pending: the existing markRefundRowFailed + reconcileClaimForRefund, then markClaimsForRevertedRefundRow(failed_row).
- Row already failed (redelivery, or failed by an engine resume): the helper only.
- Row succeeded: the existing alert first (I-05, facts gain claimIds), then helper(stripe_object).
- helper failed === true (a DB call threw) → 503 {received:false}. No target, a lost CAS or a skip → 200.

REACHED FROM:
- A-S24-1 and A-S24-2: approved or refunding with a null error → STRIPE_REVERTED;
- A-S31-1, A-S31-2 and A-S31b: refunded with a null error → REVERTED_AFTER_REFUND;
- A-S31f-1, A-S31f-2 and A-S31f-3: via redelivery.

WHY NO MONEY: the helper writes Claim rows only (updateMany on the exact pre-image). It never writes a Refund row, never calls the engine and never writes to Stripe. Pins: helper rejects → 503; a second delivery → claim marked; pending_row_stripe evidence leaves the row untouched.
IMPLEMENTATION NOTE (W5): landed in app/api/webhooks/stripe/route.ts handleRefundStatusEvent. The failed / canceled branch keeps its calls and their order (markRefundRowFailed → reconcileClaimForRefund; the refund_failed alert), then: row pending → helper(failed_row); row succeeded → the existing alert with facts.claimIds (a comma-joined id list, or 'unread' — MoneyReview facts are scalars) then helper(stripe_object, ROUTED true only when the event's refund carries a transfer_reversal, unknown otherwise); row failed → the helper only. helper failed → 503 {received:false}; every other response body is unchanged (no new key). The succeeded branch is untouched (its three 503 exits, J-M06). ER-R29 / H05 site 2: reconcileClaimForRefund records the closure itself with noNoticeSource unless its caller says it records it (applyRowTruth passes closureRecordedByCaller) — inverted from « the webhook and recovery callers pass noNoticeSource » so that the webhook's reconcileClaimForRefund call stays byte-identical (binding rule 9). Pinned by tests/claims-t49-round13-reversal.test.ts (J-M40), tests/webhook-refund-reconciliation.test.ts (J-C43), tests/claims-closure-webhook.test.ts (J-C28) and tests/claims-r13-engine-closed.test.ts (J-M06 order).

### D13 [CORE] Exits that do not exist in round 13
- No « annuler l’approbation » power (R-D5).
- No refuse_final on an approved claim: AM-B3 text « Cette réclamation a été approuvée — elle ne peut plus être refusée. Selon son état : approuvez-la à nouveau (réclamations et remboursements ouverts), réconciliez-la, ou clôturez le dossier (« Clôturer ce dossier… ») si le détail le propose. » This also removes the exit for approvals with arbitrationDecision null (R-B0-3; E-10).
- No apply-row-failure route or button, no recovery pass 2, no revertedAfterRefund list (R-X0-5, R-X0-6).
- recoverStrandedClaimReconciliations stays cron-only and is NOT an exit.
- No declaration exit from financial_verification (E-03, E-04).
- No operator-triggered re-verify for E-09. That is a founder choice, not designed here.
IMPLEMENTATION NOTE (W5 fixer): superseded by AMF-1 — POST /api/admin/claims/reconcile-refunds accepts the internal token OR resolveAdmin and runs the stranded pass plus reverifySettledClaimRefunds; « recoverStrandedClaimReconciliations stays cron-only » and « No operator-triggered re-verify for E-09 » no longer hold. Neither pass creates money authority (claim-only marking, never an engine call, a Stripe write or a Refund write), and the re-verification is still not an exit of any E entry (its markings land in E-06, whose exit is D11).

### D14 [CORE] Refusal copy and the no-false-exit pin
arbitrationRefusal('approve'), in this order:
(0) approved && refundAttempted false && refundId null && startsWith('no_refund_proven:v13:') → only the C4 / D3 checks apply (unreadable instant, premature); (1)-(3) never apply to a v13 proof.
(1) LEGACY: approved && startsWith('no_refund_proven:') && !startsWith('no_refund_proven:v13:') → « Approbation suspendue : la preuve d’absence de cette réclamation a été écrite par une version antérieure de la réconciliation, qui ne vérifiait pas toutes les conditions du moteur. Relancez « Réconcilier d’après la preuve » (section « Vérification financière requise ») avant toute approbation. »
(2) REVISABLE: approved && refundError !== null, when reconcileRefusal === null, or when its only refusal is the RECONCILE_GRACE_MS delay of a marker → « Approbation impossible dans l’état enregistré : une nouvelle approbation ne paierait pas cette réclamation, ou n’est pas établie comme sûre (la cause est dans le détail de la réclamation). Rien n’est payé tant que cet état est enregistré. « Réconcilier d’après la preuve » (section « Vérification financière requise ») relit Stripe et nos lignes et réévalue toutes les conditions. » + (isStuckResolvable ? ' « Clôturer ce dossier… » enregistre votre déclaration.' : '').
(3) PERMANENT: any other approved claim with refundError !== null → « Approbation impossible : une nouvelle approbation ne paierait pas cette réclamation (la cause est dans le détail de la réclamation). Rien ne sera payé par le rail pour elle. » + (isStuckResolvable ? ' Clôturez le dossier (« Clôturer ce dossier… »).' : ' Aucune action de l’application ne la clôt : vérifiez la commande dans Stripe.').
Then the existing checks (approved + refundAttempted true + refundError null keeps the existing finalization-lock text; refunding or FV → « Cette réclamation n’est pas en arbitrage. »; terminal; restaurant delay).
Refused reconcile or resolve-stuck: the existing server texts, and no control rendered (D0).
PIN (tests/claims-exit-copy.test.ts, J-M31). An enumerated list, never a whole file: the texts of C4, D4, D7, D8, D11 and D14; said.*, MONEY_LABEL, GUIDANCE and the approval toasts; the attribute and adopt texts; the REVERTED_AFTER_REFUND texts and the unfinalized caption. None may contain, case-insensitively: « payable à nouveau », « à nouveau payable », « de nouveau payable », « peut maintenant être rembours », « relancez le remboursement », « réessayez le remboursement », « sera remboursée », « sera payée », « jamais déplacé », « n’a déplacé d’argent », « Absence de remboursement PROUVÉE ».
Selection pins: a v13 proof never gets (1)-(3); a legacy approved claim with a marker in grace gets (2) without the « Clôturer » sentence.
Negative control: a copy with « elle est à nouveau payable » → red. Break/restore on one real string.
IMPLEMENTATION NOTE (W1): (0) applies to the canonical v13 shape only (approved, refundAttempted false, refundId null); a v13 text on any other shape — never written by N8 or T2 — falls to (2)/(3), fail closed. ER-M09 resolved: (0) precedes (2), so a v13 proof never reaches (2); the « Clôturer » sentence reads isStuckResolvable, false for a reconcile marker, so an approved claim with a marker in grace gets (2) without it (pinned, tests/claims-exit-copy.test.ts). The existing finalization-lock text « Cette réclamation a déjà été arbitrée — décision définitive. » is kept verbatim (round-1 fix: an earlier W1 draft reworded it on the belief that J-M31's « définitif » is a substring of « définitive »; it is not — pinned in tests/claims-exit-copy.test.ts). The suffix uses the pure D11 predicate (lib/claim-action-rules isStuckResolvable); until the D11 slice switches resolveStuckClaim to it, lib/claims isStuckResolvable keeps its round-12 form, and the two agree on every approved shape except approved + resume_mismatch, which no writer produces (resume_mismatch is written on refunding claims only) — pinned by tests/claims-exit-parity.test.ts. arbitrateClaim now selects refundId (D2 (1)(c)). refuse_final on an approved claim returns AM-B3 first (D13).
IMPLEMENTATION NOTE (W1, round-1 fix): D2 (1)(b) is enforced as written — the unpaid-approval admission requires refundId null in arbitrationRefusal and in arbitrateClaim's legacyApproved CAS ({ id, status 'approved', refundAttempted false, refundId null }). An approved, not-attempted claim bound to a row with a null error gets the finalization-lock text when decided and « pas en arbitrage » otherwise, and its exit set is ['reconcile'] (tests/claims-exit-parity.test.ts; J-M30 row). RELEASE GATE: the D14 (1)/(2) sentences that name « Réconcilier d’après la preuve » for proofs, locks and holds describe the reconcile slice's G2-G8; W1 is not released without it (G1 note).
IMPLEMENTATION NOTE (W3, round-1 fix): selection pin added. Since W3, reconcileRefusal refuses a reconcile marker whose instant cannot be read (malformed, or in the future: D5). That refusal is neither null nor the grace delay, so an approved claim carrying such a marker gets (3) PERMANENT (« … Aucune action de l’application ne la clôt : vérifiez la commande dans Stripe. »), never (2) naming « Réconcilier d’après la preuve »; its exit set is []. Negative controls: the same claim with an aged marker (reconcile admitted) and with a marker in grace both get (2). Pinned in tests/claims-exit-copy.test.ts; break/restore verified (selecting REVISABLE on `admitted` alone turns the pin red).

## E. EXACT FAIL-CLOSED STATES

ONE registry merging the Track A registry (REG-1 to REG-10) and the Track B registry (B1 to B10). An entry is acceptable under R-D2 only with a true surface, true customer copy (C6), an I-rule alert and a code-level no-money reason. E-08 and E-09 are NOT compliant; they are presented for founder decision. E-04 is the founder acceptance list of permanent states. Common surfaces, audience and customer copy are fixed once in E0.

### E0 [CORE] Mapping, common surfaces, audience, customer copy, removed surfaces
MAPPING:
- REG-1 → E-01; REG-2 → E-02; REG-3 → E-03 (time-bound) ∪ E-04 (permanent); REG-4 → E-05; REG-5 → E-06; REG-6 → E-07 ∪ E-08; REG-7 → E-09; REG-8 → E-10; REG-9 → E-11; REG-10 → E-12.
- B1 → E-13; B2 → E-01 to E-05; B3 → E-06 to E-08; B4 → E-09; B5 → E-10; B6 → E-14; B7 → E-15; B8 → E-16; B9 → E-17; B10 → E-18.

CARD: /[locale]/admin/claims, AdminFinancialVerification, always mounted, heading « Vérification financière requise (n) ».
- n = counts.total = financialVerification + reconcileRequired + otherUnsettled.
- Suffix « · k ligne(s) de remboursement encore en attente », k = counts.unfinalizedRefundRows.
- Sections rendered outside the red heading and kept out of total: « Réclamations remboursées dont la ligne liée n’est pas établie (n[+]) » (counts.refundedUnproven) and « Avis client non envoyés (n[+]) » (counts.closureNoticesMissing).
- Visible iff financialVerificationCardVisible({claimRows, unfinalizedRows, closureNotices, refundedUnproven}).

ARB (mounted only while claims are open): « En arbitrage — à trancher (n) » and « Remboursements à traiter (n) ».

ADMIN = operators passing resolveAdmin.

CUSTOMER copy is shown only while CLAIMS_ENABLED is on; while it is off, GET /api/claims answers {enabled:false} and the customer sees no claim. Keys and 5-locale texts:
- FVc, RFc, APc per A-S00;
- CBS = claims.status.closed_by_support « Dossier clôturé par notre équipe — contactez le support pour toute question. »;
- RUc = claims.status.refund_unconfirmed « Remboursement non confirmé par nos registres — contactez le support pour toute question. »

NM0 (base no-money reason for every entry): no registry surface calls executeRefund, driveRefund, finalizeRefund or markRefundRowFailed, or writes to Stripe. Reconcile, attribute, adopt, resolve-stuck, closure-notice and the webhook helper audit or record moneyMoved:false.

REMOVED (never cite): the section « Réclamations soldées dont le remboursement a échoué ensuite chez Stripe », dedupe refund_reverted_claim:<re>, apply-row-failure, recovery pass 2, listRevertedAfterRefundClaims, the revertedAfterRefund key, epoch census fields, E5b.

### E-01 [CORE] Approved, non-payable recorded error with reconcile + declaration exits (REG-1)
STATES: A-S01b, A-S03, A-S04, A-S05a-1, A-S05a-2, A-S05b-2 (unstamped, after the second reconcile), A-S05c-2a (H1 lock), A-S06a, A-S07 (no-row), A-S08a, A-S10b, A-S10c, A-S11 (no-row), A-S14b (canonical), A-S26, A-S30, A-S30c-1, A-S30c-2, A-S30e-1, A-S30e-2, A-S30g, A-S32-1, A-S32-2, A-S39. Track B J15, J17.

CONDITION: approved && refundId null &&
- (refundAttempted false && refundError startsWith 'no_refund_proven_rail_locked:' (AWAITING included) or is a legacy 'no_refund_proven:'),
- or (refundAttempted true && startsWith SAFETY_HOLD).
Independent of the leases: its exits D4 and D11 are ungated (the legacy proof has D4 only). AWAITING (A-S10b, A-S30e-2) persists if the other row never finalizes; D11 stays available.

SURFACE: CARD bucket otherUnsettled (counted in n). moneyState refund_error_recorded, or reconcile_required for A-S32-*. « Détail enregistré », money line, guidance, plus the D0-flagged « Réconcilier d’après la preuve » and « Clôturer ce dossier… ». While claims are open, also ARB « Remboursements à traiter (n) ».

AUDIENCE: ADMIN. CUSTOMER: FVc.

ALERT: I-01 at write time (N8 locked or AWAITING; T2(b'), (c) or (e') writes). Legacy A-S32-*: I-07 census anomaly legacyPayableProofs (C3). Conditional: I-05 refund_failed once markRefundRowFailed has run (A-S06a, A-S07).

NO MONEY: NM0.
- arbitrationRefusal: (1) legacy, (2) REVISABLE, or the finalization lock (103-121) for refundAttempted true.
- T1 refuses a non-v13 error; the T6 sweep skips any refundError.
- Engine, where the facts give it: E2 (A-S06a), E3 (A-S07, A-S10b, A-S10c, A-S11, A-S30e-1, A-S30e-2), E6 (A-S01b, A-S03, A-S05a-2), E1/E1b/E1c (A-S14b, A-S30c-1), E4/E5 (A-S26).
- States the engine would accept (A-S04, A-S05a-1, A-S08a, A-S30, A-S30c-2, A-S39): blocked Claims-side only, by the approve refusal and the T2 holds.

### E-02 [CORE] Recorded error with declaration-only exit (REG-2)
STATES: A-S06b, A-S07 (own/bound), A-S11 (own/bound), A-S15a, A-S15b, A-S24-1, A-S24-2, A-S25, A-S35 (engine_row_dead stage), A-S36-2 (after reconcile).

CONDITION:
- approved && refundId && refundError stripe_failed / engine_row_dead / STRIPE_REVERTED;
- approved && engine_failed;
- refunding && resume_mismatch && boundRow.reason !== `claim:${id}`.
Exit: D11 only. Independent of the leases.

SURFACE: CARD otherUnsettled (counted in n). Detail, money line (bound_reverted for A-S24-*), guidance refund_error_recorded or stripe_failed, and « Clôturer ce dossier… ». No reconcile control. Also ARB while open.

AUDIENCE: ADMIN. CUSTOMER: FVc.

ALERT: I-01 at write time (T4 resume_mismatch / own-row fatal / engine_failed; applyRowTruth stripe_failed / engine_row_dead / STRIPE_REVERTED). Webhook-driven: I-05.

NO MONEY: NM0.
- Approve: PERMANENT (3), or « Cette réclamation n’est pas en arbitrage. » for refunding. Sweep skip; T1.
- Engine: E2 (A-S06b), E3 (A-S15a, A-S35), E6 (A-S24-1), where the facts give it.
- A-S15b, A-S24-2, A-S25 (engine would accept): approve refused, and other claims on the order meet T2 H1.

### E-03 [CORE] financial_verification, time-bound or evidence-bound (REG-3 part 1)
STATES: A-S05b-1, A-S05c-1, A-S09a, A-S09b, A-S12 and A-S12b (FV pre-image), A-S13a (until the key/mode fix), A-S14a-2a, A-S14a-2b (parked), A-S17, A-S22 (pending / within window / unreadable), A-S23b-1, A-S23b-2, A-S29-2, A-S30e-4, A-S34 (FV), A-S38-1, A-S38-2, A-S40, A-S42 (loser). Track B J15.

CONDITION: status FV, while Stripe is not terminal or readable, or until the operator runs D6, D8 or D9. No declaration exit (isStuckResolvable refuses FV). activeOrderKey stays held, so the customer cannot file another claim on the order. Independent of the leases.

SURFACE: CARD bucket financialVerification (counted in n): « Cause : », « Détail enregistré : » (after `financial_verification:<reason>: `), the attribution panel, the adoption panel and « Réconcilier d’après la preuve ».

AUDIENCE: ADMIN. CUSTOMER: FVc.

ALERT: I-02 on entry and on relabel with a NEW reason.

NO MONEY: NM0.
- FV → arbitrationRefusal « pas en arbitrage »; the sweep selects approved only; the T1 CAS requires approved.
- D8 and D9 write only after a Stripe read of a succeeded refund, inside a Serializable transaction.
- A proof written by D6 needs D2 with fresh T2.

### E-04 [CORE] financial_verification, permanent unless new data — FOUNDER ACCEPTANCE LIST (REG-3 part 2)
STATES:
- A-S05b-2 (stamped), A-S05c-2a (an unexplained refund remains), A-S05c-2b, A-S13a (right key), A-S13b, A-S14b (variant with a row), A-S29-1, A-S30c-2 (after D4: list_over_cap park);
- A-S18, A-S20 and A-S22, when the row is not this claim's;
- A-S19 when not adopted (R-A0-4): a Dashboard refund belonging to something else; the operator must not adopt;
- A-S22b, when reconcile cannot explain the order's money;
- A-S27-1a, A-S27-1b, A-S27-2 with no provable stamped row;
- A-S37;
- the non-terminal claims of A-S43.

CONDITION: status FV, and no evidence exit can change the outcome without an external data correction.

SURFACE: as E-03 (CARD bucket financialVerification, counted in n).

AUDIENCE: ADMIN; founder (acceptance).

CUSTOMER: FVc, indefinitely. The customer cannot file another claim on the order.

ALERT: I-02 (write time). Legacy orphans: I-07 anomalies refundedBoundToOtherClaimStamp and rowsBoundToMultipleClaims (C3).

IMPLEMENTATION NOTE (W1): ER-M01 registered. ENTRY PATH (added to STATES): T2 (e') on a NULL pre-image — the first approval of a claim on an order that carries a standing refund no settled claim explains (an admin-rail partial refund row, or a rowless Stripe Dashboard partial refund) → N3/N5 → financial_verification refund_moved_unattributed. It is the A-S20 / A-S19 park reached by approval instead of by reconcile. CUSTOMER: FVc indefinitely; activeOrderKey stays held. ALERT: I-02 at write time. NO MONEY: NM0 — the park writes no Refund row and calls no engine. EXITS: reconcile (the same outcome while the facts stand); attribute and adopt apply only when that refund was in fact made for this claim; no declaration (D13). For a refund made for another purpose no exit exists: at round 12 the engine would have paid within refundable (E4/E5), so this is a liveness regression. ROUTED TO THE FOUNDER ACCEPTANCE LIST, to be accepted before the T2 slice wires (e') on null pre-images; createClaim / buildClaimScope still offer such claims. The pure behaviour is pinned in tests/claims-t49-round13-reconcile.test.ts (ER-M01).

NO MONEY: as E-03.
A-S13b residual: H3 blocks every claim path, but an admin-rail or ghost-order engine call on that order resumes the foreign refund (engine unchanged, refund.ts 335 has no PI check). That is not a Claims path.

PRESENTED AS: an absorbing state accepted for the beta, not as an exit.
IMPLEMENTATION NOTE (W3, round-1 fix): FOUNDER ACCEPTANCE LIST entry added (registry note 'E-04:malformed_marker'). STATE: status approved or refunding with a reconcile marker whose start instant is MALFORMED (no parsable ISO instant). CONDITION: reconcile refuses it (D5: the marker admission needs a readable age; RECONCILE_MARKER_UNREADABLE_TEXT), approve refuses it (refunding: « pas en arbitrage »; approved: D14 (3) PERMANENT), and isStuckResolvable is false under a marker, so acceptedExits is []. No exit exists until the recorded data is corrected. SURFACE: CARD bucket reconcileRequired, counted in n, with the server refusal text and no control. CUSTOMER: FVc. ALERT: none new (the marker was written by C2 with its I-01 context; C2 always writes a valid ISO, so only corrupt or hand-edited data reaches this). NO MONEY: NM0 — nothing admits the claim to T1 (refundAttempted true), and reconcile never runs on it. Pinned by tests/claims-exit-copy.test.ts and tests/claims-exit-parity.test.ts.

### E-05 [CORE] refunding with a reconcile marker, or legacy own-row resume_mismatch (REG-4)
STATES: A-S12 and A-S12b (refunding pre-image), A-S16a, A-S16b, A-S30d, A-S33-1, A-S33-2, A-S35 (marker stage), A-S36-1, A-S36-2, A-S36b.

CONDITION: refunding && (reconcileMarkerAge < RECONCILE_GRACE_MS, or a marker after grace, or resume_mismatch on boundRow.reason === `claim:${id}`). Exit: D5 after grace. Independent of the leases.

SURFACE: CARD. During grace: otherUnsettled (moneyState reconcile_required, grace refusal text, no button). After grace: reconcileRequired bucket with the button. A-S36-*: identity_unread money line. Counted in n.

AUDIENCE: ADMIN. CUSTOMER: FVc.

ALERT: I-01 at write time (T4 identity_unverified / own-row fatal; T2(a) own_row_exists). A-S30d: I-01 best-effort in the catch, plus the 500 to the acting operator. Legacy A-S36-*: I-07 anomaly ownRowResumeMismatch.nonTerminal.

NO MONEY: NM0.
- refunding → approve « pas en arbitrage »; sweep; T1 CAS requires refundAttempted false.
- isStuckResolvable is false under a marker.
- A later re-approval meets Q-INSTANT and T2(a).
- A late attempt is held by the T4 CAS (then I-03).
IMPLEMENTATION NOTE (W3, round-1 fix): a marker whose start instant lies in the FUTURE (clock skew) has no accepted exit while that instant is ahead: reconcile refuses it with RECONCILE_MARKER_UNREADABLE_TEXT (« … n’a pas pu être lue, ou est postérieure à maintenant … »), approve refuses it (D14 (3) on an approved claim, « pas en arbitrage » on a refunding one), and isStuckResolvable is false under a marker. Its exit is still D5: once the instant has passed and RECONCILE_GRACE_MS elapsed, the gate admits it. It stays registered here (exitRegistry 'E-05') and listed in reconcileRequired with reconcilable false and the refusal text (no control). A MALFORMED instant never becomes readable: it is registered in E-04 (founder acceptance, 'E-04:malformed_marker').
IMPLEMENTATION NOTE (W7): an approved claim whose marker instant is READABLE but in the future no longer gets D14 (3)’s « Aucune action de l’application ne la clôt » (false here: D5 admits reconcile once the instant has passed and RECONCILE_GRACE_MS has elapsed). arbitrationRefusal returns approveMarkerFutureText(markerIso, markerIso + grace): « Approbation impossible : l’heure de début de la tentative de remboursement enregistrée sur cette réclamation (<ISO> UTC) est postérieure à maintenant, et cette tentative n’est pas établie comme terminée. Rien n’est payé tant que cet état est enregistré. « Réconcilier d’après la preuve » (section « Vérification financière requise ») est refusée tant que cette heure n’est pas passée et que le délai de 5 minutes ne s’est pas écoulé ensuite, soit jusqu’au <ISO> (UTC). ». A malformed instant keeps (3) (E-04:malformed_marker). Pinned in tests/claims-exit-copy.test.ts (selection pin E-05, W7, with its negative control).

### E-06 [CORE] refunded + REVERTED_AFTER_REFUND (REG-5)
STATES: A-S31-1, A-S31-2, A-S31b. Track B J10b, J24.

CONDITION: status refunded && startsWith(REVERTED_AFTER_REFUND). Exit: D11 only. Independent of the leases.

SURFACE: CARD otherUnsettled (listActionableRefundClaims OR clause, counted in n), money line bound_reverted (both consoles), guidance refund_error_recorded, « Clôturer ce dossier… ».

AUDIENCE: ADMIN.

CUSTOMER: FVc, derived at read time from the marker; after either declaration, CBS. No e-mail on the reversal (R-D3).

ALERT: I-05 (webhook): « Remboursement Stripe passé en échec APRÈS finalisation » with claimIds, or refund_failed from markRefundRowFailed. Via D7: I-01 with cause reverted_after_refund.

NO MONEY: NM0.
- refunded is TERMINAL for arbitrationRefusal (110-112), the sweep and T1.
- Engine: E2 (A-S31b), E6 (A-S31-1).
- A-S31-2 (the engine would accept): later claims on the order meet T2 H1. The admin rail is unguarded (residual).
IMPLEMENTATION NOTE (W5 fixer): the D11 exit exists in this tree (resolveStuckClaim terminal exemption, see D11), so the « Clôturer ce dossier… » control, GUIDANCE refund_error_recorded, the R0 toast and the G11 marker tail name an exit the server accepts.

### E-07 [CORE] refunded, bound refund failed, not yet marked (REG-6 part 1)
STATES: A-S31c, A-S31d, A-S31f-1. Track B J23.

CONDITION: refunded && refundError null &&
- (boundRow failed with stripeRefundId — A-S31c, and A-S31f-1 once retries are exhausted),
- or (boundRow pending and its Stripe refund failed or canceled with the event lost — A-S31d).
Exit: D7 (R0a / R0b) → E-06 → D11. Independent of the leases.

SURFACE:
- A-S31c: CARD otherUnsettled (OR clause refundId in failed-with-id rows), moneyState stripe_failed, reconcile control; counted in n.
- A-S31d: the unfinalized rows list with its reconcile control; counted in k.
- A-S31f-1: transient, the webhook answers 503.

AUDIENCE: ADMIN.

CUSTOMER: A-S31c and A-S31f-1: RUc (refundedRow false). A-S31d: RFc until R0b. That is C6-compliant: no failure signal has been read. FVc after marking.

ALERT: I-05 refund_failed (from markRefundRowFailed); I-01 at the R0 write. A-S31d has no alert (event lost); its durable signal is k. Pre-deploy failed-row claims: I-07 anomaly refundedBoundToFailedRow.

NO MONEY: NM0. Terminal for approve, the sweep and T1. Engine: E2 (A-S31c, A-S31f-1); E3 resumes A-S31d's row and marks it failed, after which E2 applies.

### E-08 [CORE] C6 BREACH bounded by redelivery — NOT COMPLIANT, stated to the founder (REG-6 part 2)
STATES: A-S31f-2, A-S31f-3.

CONDITION: a failed or canceled event on a SUCCEEDED bound row of a refunded claim, where the helper's DB write threw. The webhook answers 503 until a redelivery marks the claim (→ E-06). If the retries are exhausted → E-09.

SURFACE: none durable. Only the alert, sent before the helper.

AUDIENCE: ADMIN (alert recipients).

CUSTOMER: RFc. A failure signal was received and could not be recorded. This is a literal C6 breach, bounded by Stripe redelivery: live mode retries for up to 3 days; test mode, where the beta runs, retries only a few times over a few hours. Not claimed compliant.

ALERT: I-05 « Remboursement Stripe passé en échec APRÈS finalisation » with claimIds.

NO MONEY: NM0. Terminal for approve, the sweep and T1. Engine E6 (A-S31f-2). A-S31f-3 (the engine would accept): later claims meet T2 H1.

### E-09 [CORE] NOT FAIL-VISIBLE — founder acceptance required (REG-7)
STATES: A-S31e-1, A-S31e-2. Track B B4, J25.

This is NOT a compliant registry entry and is presented to the founder as such.

CONDITION: refunded && refundError null && boundRow succeeded, while Stripe has since failed or canceled that refund, and the event was never processed or predates the deploy.

SURFACE: none. It appears in no list, card, count or alert. The census cannot count it without a Stripe read (R-D6), and a scheduled read is forbidden (R-D8).

EXITS:
- D7 R0c via POST /api/admin/claims/[id]/reconcile, by an operator who has the claim id (from customer contact or the Stripe Dashboard);
- the D10(iv) pre-send read, if the claim sits in « Avis client non envoyés ».

AUDIENCE: none proactively; ADMIN on demand.

CUSTOMER: RFc, stale; the code has read no failure signal.

ALERT: none.

NO MONEY: NM0. Terminal for approve, the sweep and T1. Engine E6 (A-S31e-1). A-S31e-2 (the engine would accept): later claims on the order meet T2 H1 once their approval reads the reverted row.

FOUNDER DECISION: accept, or order an operator-triggered read-only re-verify (not the default; not designed in round 13).

**FREEZE AMENDMENT AMF-1:** this entry is no longer « NOT FAIL-VISIBLE »: the bounded read-only re-verification (daily cron on main, operator button « Revérifier les remboursements soldés (35 jours) ») detects it and marks it with the I-01 alert; residual = a failure reported more than 35 days after settlement whose event was lost.
IMPLEMENTATION NOTE (W5): the re-verification landed (reverifySettledClaimRefunds; POST /api/admin/claims/reconcile-refunds with the internal token or an admin session — no session 401, a non-admin 403). The operator button is the console slice's (W7). E-09 still appears in no list, bucket or census key (the J-M50 negative pin stays true): the re-verification is a pass, not a surface. The docs/ops/REFUND-FINANCIAL-CONTRACT.md residual sentence is not part of this slice.
IMPLEMENTATION NOTE (W5 fixer): the residual sentence is in docs/ops/REFUND-FINANCIAL-CONTRACT.md §21; the Mode-A precheck step is in docs/ops/CLAIMS-R13-OPERATOR-PRECHECK.md. The console button remains W7.

### E-10 [CORE] Approved, unpaid, payable only through a gated or time-bound approval (REG-8, B5)
STATES: A-S01, A-S02, A-S08b, A-S30b-1, A-S30b-2a, A-S30b-2b, A-S30e-3, and approved_not_driven (approved, refundAttempted false, refundError null, including legacy approvals with arbitrationDecision null). Track B J16.
CONDITION: any of
- the CLAIMS lease is closed;
- the REFUNDS lease is closed (claims open included, R-B0-3);
- for a v13 proof, now < Q-INSTANT;
- for A-S30e-3, now < `until`.
Once both leases are open and the instants have passed, D2 applies. AM-B3 removes refuse_final on EVERY approved claim, including arbitrationDecision null (D13), and D13 adds no annulment; so with REFUNDS closed this population has no exit but a later approval — hence this entry.
SURFACE: CARD otherUnsettled (counted in n): moneyState approved_not_driven (F15 GUIDANCE) for a null error; absence_proven_payable for a v13 proof only (F15 classification; F15 GUIDANCE and MONEY label state the approval and instant rule and never that no refund moved money); reconcile control for v13. While claims are open: ARB « En arbitrage — à trancher (n) » (queueReason legacy_pending_money_decision, lib/claims.ts ~1006) and « Remboursements à traiter (n) ». The acting operator of an approve while REFUNDS is closed reads toast approvedNotSent, success tone (F12/F13: « Réclamation approuvée — aucun remboursement n’a été lancé par cette action. »): it states that nothing was started, not why; the cause is carried by the I-01 alert.
AUDIENCE: ADMIN.
CUSTOMER: claims closed → nothing. Claims open → FVc (v13 proof) or APc (null error). The last e-mail received is the money-free decision e-mail 'approved' (H03).
ALERT: I-01 at write time:
- cause refunds_disabled — sent by arbitrateClaim after its decision CAS (count 1) when triggerClaimRefund returns {state:'pending', reason:'refunds_disabled'} (the beta writer with claims open), and by approveClaim on the auto paths (flags off);
- cause no_refund_proven:v13: (N8, and a T2 revert to a v13 pre-image);
- cause safety_check_unreadable;
- cause unconfirmed_within_window.
Pre-deploy population: I-07 census line approvedUnpaid (C3, non-blocking). The check-flags line is configuration, not a per-claim alert.
NO MONEY: NM0.
- arbitrate answers 403 while CLAIMS is closed (route 27-29).
- triggerClaimRefund returns refunds_disabled before its T1 CAS while REFUNDS is closed (claims.ts 504).
- Sweep step 2 runs only while REFUNDS is on and skips any refundError (C4).
- C4 / D3 refuse before Q-INSTANT.
- With both leases open: T1, then T2 on fresh reads, before executeRefund.
IMPLEMENTATION NOTE (W7) on ER-C25: confirmed as written — the acting operator reads approvedNotSent (« aucun remboursement n’a été lancé par cette action »), which says nothing was started and names no cause; the cause is carried by the I-01 alert (refunds_disabled). J-C46 pins, in tests/claims-registry-visibility.test.ts: arbitrate 403 while CLAIMS is closed; refunds_disabled before any claim write and the approvedNotSent success tone; the Q-INSTANT refusal carrying the instant and T1 already_handled without a write; APc / FVc; AM-B3; and a negative control where executeRefund is called exactly once.

### E-11 [CORE] Attempt superseded (REG-9)
STATES: A-S41.

CONDITION: a stalled engine attempt returned ok or 202 after its claim was reconciled, attributed or closed. The T4 CAS count was 0.

SURFACE: the claim stays in its current bucket (a refunded claim is not listed), plus the alert.

AUDIENCE: ADMIN.

CUSTOMER: per the current status (RFc, FVc or APc).

ALERT: I-03.

NO MONEY: NM0.
- The late attempt's claim writes are refused by T4, and nothing retries.
- The refund the engine already drove is the only movement. It is a human money review, carried in I-03's facts.
- Any further payment needs D2, which T1 refuses on a terminal or error-bearing claim, and T2(a) refuses because the own stamped row now exists.

### E-12 [CORE] Legacy row bound to two or more claims (REG-10)
STATES: A-S43.

CONDITION: one Refund row with at least 2 binders whose refundError is null or not resume_mismatch. Data from before D8 only. No rewrite (R-D6).

SURFACE: I-07 anomaly rowsBoundToMultipleClaims; non-terminal binders in their E-03/E-04 bucket; the reconcileClaimForRefund console.error [MONEY REVIEW] ambiguous_binding.

AUDIENCE: ADMIN; founder (precheck).

CUSTOMER: FVc for EVERY claim bound to that row, derived at read time (refundedRow null), never RFc.

ALERT: I-07 (C3 legacy).

NO MONEY: NM0.
- reconcileClaimForRefund returns ambiguous_binding without writing.
- The D8 bound-where refuses the row.
- N3 treats it as unexplained (2 or more binders).

### E-13 [CORE] Refunded, bound row not established (legacy; B1)
STATES: Track B B1 / J10.

CONDITION: refunded && refundError null && (refundId null || row missing || row.orderId !== claim.orderId || row.amountCents <= 0 || (row.status 'failed' && stripeRefundId null)).
Disjoint from E-07: a failed row WITH an id is E-07 (R-X0-5); a parity test proves the two lists do not overlap. No current writer creates this state.

SURFACE: CARD section « Réclamations remboursées dont la ligne liée n’est pas établie (n[+]) » (counts.refundedUnproven; no action control, apply-row-failure deleted), and a blocked row in « Avis client non envoyés ».

AUDIENCE: ADMIN; founder (census).

CUSTOMER: claims open → RUc. No e-mail.

ALERT: I-07 anomaly refundedRowUnproven (C3 legacy), plus the section count.

NO MONEY: NM0.
- Terminal (110-112); the trigger CAS requires approved (507-511); the sweep selects approved only.
- resolveStuckClaim refuses terminal claims; admission (iii) refuses a missing or other-order row.
- D8 and D9 require FV; the D10 sender refuses refunded_row_unproven.
- Same-order pending or succeeded rows with amount <= 0: D7 reads only.
IMPLEMENTATION NOTE (W7 fixer) (ER-C22, second half): the CONDITION also covers a same-order row whose status is none of succeeded, pending or failed — refundedRowProven rejects it and listRefundedClaimsWithUnprovenRow lists it; no writer produces such a status (lib/refund.ts writes pending, succeeded and failed; the adoption mirror is written after a succeeded Stripe read). The section A text names it « a un statut inconnu » (H10 W7 fixer note (2)). A row with two or more binders is excluded from the section (H10 W7 note (3)).

### E-14 [CORE] Legacy terminal claim closed on its OWN row's resume_mismatch (B6)
STATES: Track B B6 / J13 (legacy, closed).

CONDITION: refunded or refused_final && startsWith('resume_mismatch') && the bound row's reason === `claim:${id}`.

SURFACE: I-07 anomalies ownRowResumeMismatch.terminal and closure.terminalWithoutRecord. If the row is still pending, the CARD unfinalized rows list (k).

AUDIENCE: founder; ADMIN.

CUSTOMER: claims open → CBS. No notice (no closure record, D10).

ALERT: I-07 (C3 legacy).

NO MONEY: NM0. Terminal. A later refund on the order first resumes the oldest pending row (E3). A new attempt for this claim is refused by T1 (terminal) and T2(a) (own stamped row). E5b is not cited.

### E-15 [CORE] Legacy DB-only attribution after a contradiction park (B7)
STATES: Track B B7.

CONDITION: refunded && refundError null && the row succeeded in the DB, attributed by the pre-round-13 bind-first path while Stripe last reported a contradiction.

SURFACE: I-07 anomaly refundedAfterContradictionAttribution: a lower bound, null when ADMIN_AUDIT_ENABLED was off; plus AdminAuditLog 'claim.attribute_refund' rows.

AUDIENCE: founder.

CUSTOMER: claims open → RFc. The code has read no failure signal, but it never established the refund at Stripe either. Founder review requested whenever the count is > 0 or null.

ALERT: I-07 (C3 legacy).

NO MONEY: NM0. Terminal. Exit: D7 R0c by claim id (a read-only re-read that marks a reversal).

### E-16 [CORE] Closure of this build without a dispatched notice (B8)
STATES: Track B B8 / J22.
CONDITION: terminal claim with claimClosureKind non-null, an H05 closure record (EmailDispatch 'claim_closure_record', claim:<id>), and no EmailDispatch row under CLOSURE_TRIGGER[kind] for claim:<id>. Causes: the CLAIMS lease closed at the attempt (R-D7); SMTP disabled; no recipient; refunded kind not confirmed by Stripe in the request; a send that failed; settlement by the webhook or the recovery sweep (no notice source); a closure observed only through the C7 re-read (no e-mail attempted).
NOT IN E-16:
- a record write that failed → no record → E-18 (counted in closure.terminalWithoutRecord);
- a crash mid-send that left a dispatch row → not listed; the resend answers duplicate (residual, stated in docs).
SURFACE: CARD section « Avis client non envoyés (n[+]) » (counts.closureNoticesMissing, outside total) with « Envoyer l’avis au client » (D10 (iv)), disabled per H10 blocker.
AUDIENCE: ADMIN; founder (census).
CUSTOMER: nothing new; the app status per journey while claims are open.
ALERT (write time): I-08 for an attempted send that did not go out; for a webhook or recovery settlement, the H05 console.error « [EMAIL MISS] [claim_decision_refunded] … settled by the Stripe webhook or the recovery sweep … »; for the C7 branch, the 409 shown to the acting operator names the list. Durable signals: the section count and the I-07 census line closure.missing.
NO MONEY: NM0. D10 source guard; the closure-notice route calls only reconcileClaimEvidence (read-only), sendClaimClosureEmail and recordAdminAudit, with an empty body.
IMPLEMENTATION NOTE (W6) on ER-C25: the ALERT field already names the H05 console line for webhook and recovery settlements; I-08 applies only to an attempted send. The « Avis client non envoyés » section and counts.closureNoticesMissing are the console slice's (H10); until they land, the durable signal is the census closure.missing.
IMPLEMENTATION NOTE (W6 fixer) on E-16 SURFACE: the surface is absent in the W6 build, so W6 is never deployed with CLAIMS open: no CLAIMS lease opens on any environment before W7 lands H10 and J-C30 (docs/ops/CLAIMS-R13-OPERATOR-PRECHECK.md, Étape 0; see the H11 ordering note).
IMPLEMENTATION NOTE (W8 fixer): two quotations of this rule are superseded, with no behaviour change. (1) ALERT: the H05 console line no longer reads « … settled by the Stripe webhook or the recovery sweep … »; it reads « [EMAIL MISS] [claim_decision_refunded] claim <id> settled on its refund row by a path that sends no customer notice (the Stripe webhook, the recovery sweep, or a reconciliation run for another claim bound to the same row) — … » (lib/claims.ts recordClaimClosure; see the H05 W8 and W8 fixer notes). (2) SURFACE ordering: the W6 fixer note's « no CLAIMS lease opens on any environment before W7 » is now checked through the verifiable condition in docs/ops/CLAIMS-R13-OPERATOR-PRECHECK.md Étape 0. The deployed version.json commit must have 4d3e442 as an ancestor (git merge-base --is-ancestor, in a clone fetched with develop and main), and GET /api/admin/claims/financial-verification must carry counts.closureNoticesMissing. The « Avis client non envoyés » section renders only while a notice is missing or its list is unreadable, so it is not the check.

### E-17 [CORE] Non-terminal claim e-mail skipped as claims_disabled (B9)
STATES: Track B B9 / J26.

CONDITION: an ack, accepted, refused or approved e-mail attempted after the CLAIMS lease expired between the route's entry gate and the send.

SURFACE: EmailLog row with status 'skipped', recipient « (non envoyé : claims_disabled) », subject « claim <id> ». On arbitrate, also the operator toast claimsDisabled. No list: the notice list holds terminal claims only.

AUDIENCE: ADMIN (e-mail log, toast).

CUSTOMER: nothing while claims are closed. When a lease reopens, the claim status per J18, J19, J01 or J16.

ALERT: I-08.

NO MONEY: an e-mail skip changes no claim or money state. The decision it reports was already written by its own CAS.

### E-18 [CORE] Terminal claim closed without a closure record (B10)
STATES: Track B B10: every closure before this deploy, plus this build's closures whose H05 record write failed.
CONDITION: terminal && claimClosureKind non-null && no H05 closure record. No clock and no epoch (C4). AdminAuditLog rows do not count as a record.
SURFACE: I-07 census line closure.terminalWithoutRecord. The « Avis client non envoyés » intro is H10's text verbatim; its sentence « Les clôtures antérieures à cette version ne sont pas listées et ne recevront aucun avis. » states the legacy exclusion, and the intro does not claim that the list is complete. A record-write failure of this build is logged at write time (H05 console.error « [EMAIL MISS] [claim_closure_record] … record NOT written … ») and, for an attribution observed through C7, told to the acting operator in the 409.
AUDIENCE: founder; ADMIN.
CUSTOMER: their existing app status; never a notice (R-D6(d)).
ALERT: legacy population → I-07 (C3 pre-deploy census); this build's record-write failure → the H05 console.error at write time, then I-07.
NO MONEY: the D10 sender refuses a claim without a record (H06 step 3) before any money read; no notice path calls the engine or writes to Stripe.
IMPLEMENTATION NOTE (W6) on ER-C18: the section intro is H10's text, which J-C30 (console slice) pins; this entry adds no second text. The census count terminalWithoutRecord is measured from EmailDispatch only: tests/claim-emails-routes-closure.test.ts counts a legacy claim that carries a HEAD audit row.

## F. CUSTOMER / ADMIN COPY CONTRACT

This section defines one customer status contract and the admin copy rules.
- Pure functions live in lib/claim-action-rules.ts. That file does no I/O and imports nothing from lib/claims.
- Copy lives in messages/{fr,en,es,it,ar}.json. One agent edits those files, one after the other.
- The en/es/it/ar strings are drafts for native review (R-D9). They must pass npm run check:i18n, the PROMISES_BY_LOCALE scan and the FORBIDDEN scan in tests/claims-t49-round7-routes.test.ts.
- Section A owns the refundError texts and the state ids; this section cites them. Section H owns e-mail copy and the customerEmail toasts.

### F01 [CORE] Closed set of customer status keys
customerClaimStatus (F04) returns exactly one value of `export const CUSTOMER_STATUSES = ['restaurant_review','refused','arbitration','approved','refunding','refunded','refund_unconfirmed','refused_final','refused_by_grubano','closed_by_support','financial_verification'] as const`.

Delete messages/*.json claims.status.refund_failed and claims.status.refund_pending_stripe in all 5 locales. No code returns them: ClaimSection renders `status.${s}` only from customerClaimStatus.

There is no settled_by_support key and no eat.help.claimSettledBySupport key (R-D4).

Tests:
- (a) For every value, a key exists in claims.status in all 5 locales, and the help page has a branch for it (F07).
- (b) A source scan finds no string literal 'settled_by_support', 'refund_failed' or 'refund_pending_stripe' passed to t('status.…') or eligibilityLabel.
IMPLEMENTATION NOTE (W1): the two keys are deleted and refused_by_grubano / refund_unconfirmed added in the 5 locales with the F06 texts, plus eat.help.claimRefundUnconfirmed; the help page maps refund_unconfirmed and refused_by_grubano (F07) in the same change, so no status customerClaimStatus returns renders a raw key.

### F02 [CORE] claimClosureKind, closure triggers, refusal e-mail kind
Add to lib/claim-action-rules.ts:
```ts
export type ClosureKind = 'refunded'|'settled_by_declaration'|'closed_by_declaration'|'refused_confirmed'|'refused_by_grubano'
export function claimClosureKind(c: ClaimFacts): ClosureKind|null {
  if (c.status==='refunded') {
    if (typeof c.refundError==='string' && c.refundError.startsWith(MARKERS.REVERTED_AFTER_REFUND)) return null
    return c.refundError ? 'settled_by_declaration' : 'refunded'
  }
  if (c.status==='refused_final') {
    if (c.arbitrationDecision!=='refused_final') return 'closed_by_declaration'
    return c.restaurantResponse==='refused' ? 'refused_confirmed' : 'refused_by_grubano'
  }
  return null
}
export const CLOSURE_TRIGGER: Record<ClosureKind,string> = { refunded:'claim_decision_refunded', settled_by_declaration:'claim_closed_by_support', closed_by_declaration:'claim_closed_by_support', refused_confirmed:'claim_decision_refused_final', refused_by_grubano:'claim_decision_refused_final' }
export function refusalEmailKind(c: ClaimFacts|null|undefined): 'refused_final'|'refused_by_grubano' { return c && claimClosureKind(c)==='refused_confirmed' ? 'refused_final' : 'refused_by_grubano' }
```
ClaimFacts gains optional restaurantResponse and reason.

Why the rules hold:
- restaurantResponse 'refused' has one writer: respondToClaim (lib/claims.ts ~679).
- arbitrationDecision 'refused_final' is written only together with status refused_final (~911).
- resolveStuckClaim never writes arbitrationDecision.
- DECLARED_AFTER_REVERT texts start with 'declared_settled_after_revert:', so they classify as settled_by_declaration, never null.

### F03 [CORE] Refunded-row proof, including the ambiguous binding case (A-S43)
Add:
```ts
export function refundedRowProven(row: {orderId:string;status:string;amountCents:number}|null|undefined, claimOrderId: string): boolean {
  return !!row && row.orderId===claimOrderId && (row.status==='succeeded'||row.status==='pending') && Number.isInteger(row.amountCents) && row.amountCents>0
}
export function refundedRowTruth(row: Parameters<typeof refundedRowProven>[0], binders: number|null, claimOrderId: string): boolean|null {
  if (binders===null) return null
  if (binders>=2) return null            // A-S43: never « Remboursée » for any claim on an ambiguous row
  return refundedRowProven(row, claimOrderId)
}
```
Both functions are computed only when claimClosureKind(claim)==='refunded'.

In lib/claims.ts getClaimEligibility:
- row: `refund.findUnique({where:{id:refundId}, select:{id,orderId,status,amountCents}})`. A null refundId gives false.
- binders: `claim.count({where:{refundId:row.id, OR:[{refundError:null},{NOT:{refundError:{startsWith:'resume_mismatch'}}}]}})`. The explicit null branch is required: Prisma's NOT(LIKE) drops NULL rows on MySQL.
- If either read throws, the result is null.

In listConsumerClaims, use one `refund.findMany({where:{id:{in}}})` and one `claim.groupBy({by:['refundId'], where:{refundId:{in}, OR:[same]}, _count:{_all:true}})`. If either throws, every refunded claim on that page gets null.

A failed row, with or without a Stripe id, gives false. That yields refund_unconfirmed (A-S31c, A-S31f-1).
IMPLEMENTATION NOTE (W1): wired in getClaimEligibility and listConsumerClaims in the same change as F04. The listConsumerClaims row read serves both boundRowShowsInProgress and refundedRowTruth (one refund.findMany, one claim.groupBy per page); a refundId absent from the groupBy result counts 0 binders.

### F04 [CORE] customerClaimStatus: the single merged body
Replace lib/claim-action-rules.ts customerClaimStatus with:
```ts
export type CustomerStatus = typeof CUSTOMER_STATUSES[number]
export function customerClaimStatus(c: ClaimFacts, boundRowInProgress: boolean|null, refundedRow: boolean|null = null): CustomerStatus {
  const FV = MARKERS.FINANCIAL_VERIFICATION as 'financial_verification'
  if (c.status===FV) return FV
  if (c.status==='refunding') return !c.refundError && !!c.refundId && boundRowInProgress===true ? 'refunding' : FV
  if (c.status==='approved') return (c.refundError || c.refundAttempted===true) ? FV : 'approved'
  const kind = claimClosureKind(c)
  if (c.status==='refunded' && kind===null) return FV            // REVERTED_AFTER_REFUND
  if (kind==='refunded') return refundedRow===true ? 'refunded' : refundedRow===false ? 'refund_unconfirmed' : FV
  if (kind==='settled_by_declaration' || kind==='closed_by_declaration') return 'closed_by_support'
  if (kind==='refused_confirmed') return 'refused_final'
  if (kind==='refused_by_grubano') return 'refused_by_grubano'
  if (c.status==='restaurant_review' || c.status==='refused' || c.status==='arbitration') return c.status
  return FV                                                      // unknown raw status: fail closed, never a raw key path
}
```
Call sites:
- getClaimEligibility: `customerClaimStatus(existing, existingBoundConfirmed, refundedRowTruth(...))`.
- listConsumerClaims: the same call per claim.

Eligibility (canContest, active claim) still reads the raw status. customerClaimStatus is display only.

### F05 [CORE] Derivation table: raw state → key → producing writers
Each line reads: raw state → key : producing writers (Section A states / Track B journeys).

1. status financial_verification → financial_verification : enterFinancialVerification; T2(e') park (A-S30e-4, A-S38-*); N1-N7 parks (A-S05b/c, A-S09*, A-S13*, A-S14a, A-S17-A-S20, A-S27, A-S29, A-S37, A-S40, A-S42 loser).
2. refunding, no error, refundId set, row pending with a Stripe id → refunding : T4 202 own (A-S14 shape).
3. Any other refunding (marker M, identity_unverified, resume_mismatch, own-row engine text) → financial_verification : A-S15, A-S16, A-S30d, A-S33, A-S35, A-S36.
4. approved + any refundError → financial_verification : v13 proof (A-S01, A-S02, A-S08b), locks and AWAITING (A-S01b, A-S03-A-S08a, A-S10b/c, A-S11, A-S14b, A-S26, A-S30e-1/2), SAFETY_HOLD (A-S30, A-S30c, A-S30g, A-S39), stripe_failed, engine_failed, engine_row_dead, STRIPE_REVERTED (A-S06b, A-S24, A-S25), legacy proofs (A-S32).
5. approved + refundAttempted true → financial_verification : legacy, or an interrupted applyRowTruth bind.
6. approved, refundAttempted false, no error → approved : arbitrate approve with a closed lease; approveClaim; T2(b) revert (A-S30b-*); T2(e') within-window revert (A-S30e-3). T2(d)/awaiting_other_row no longer exists.
7. refunded + REVERTED_AFTER_REFUND → financial_verification : webhook helper, R0a/R0b/R0c (A-S31-*, A-S31b, A-S31d after reconcile).
8. refunded, no error, refundedRowTruth true → refunded : T4 own success, reconcileClaimForRefund, applyRowTruth at_stripe, attribution/adoption (A-S10, A-S19, A-S21, A-S23a).
9. refunded, no error, refundedRowTruth false → refund_unconfirmed : legacy shapes (Track B J10) and failed rows (A-S31c, A-S31f-1).
10. refunded, no error, refundedRowTruth null → financial_verification : read throw, or ≥2 non-mismatch binders (A-S43).
11. refunded + any other refundError (including DECLARED_AFTER_REVERT) → closed_by_support : resolveStuckClaim settled_out_of_band.
12. refused_final + arbitrationDecision ≠ refused_final → closed_by_support : resolveStuckClaim closed_no_payment.
13. refused_final + refused_final + restaurantResponse 'refused' → refused_final : arbitrateClaim after a contest.
14. refused_final + refused_final + any other restaurantResponse → refused_by_grubano : arbitrateClaim after an accept, silence, a system claim, or a legacy approval.
15. restaurant_review / refused / arbitration → the same key : createClaim, respondToClaim, contestClaim, createSystemClaim.

A test pins one fixture per line.

### F06 [CORE] Customer status copy (claims.status.*), all 5 locales
Unchanged existing values, all 5 locales:
- restaurant_review « En attente de réponse du restaurant »
- refused « Refusée »
- arbitration « En arbitrage Grubano »
- approved « Approuvée — remboursement en attente de traitement »
- refunding « Remboursement en cours »
- refunded « Remboursée »
- refused_final « Refus confirmé »
- closed_by_support « Dossier clôturé par notre équipe — contactez le support pour toute question. »
- financial_verification « Votre demande nécessite une vérification manuelle par notre équipe. »

NEW refused_by_grubano:
- fr « Refusée par Grubano — décision définitive »
- en « Declined by Grubano — final decision »
- es « Rechazada por Grubano — decisión definitiva »
- it « Rifiutata da Grubano — decisione definitiva »
- ar « رفضتها Grubano — قرار نهائي »

NEW refund_unconfirmed:
- fr « Remboursement non confirmé par nos registres — contactez le support pour toute question. »
- en « Refund not confirmed by our records — contact support with any questions. »
- es « Reembolso no confirmado por nuestros registros — contacte con el soporte para cualquier pregunta. »
- it « Rimborso non confermato dai nostri archivi — contatti l’assistenza per qualsiasi domanda. »
- ar « الاسترداد غير مؤكد في سجلاتنا — تواصل مع الدعم لأي استفسار. »

Nothing renders while CLAIMS_ENABLED is off: GET /api/claims returns {enabled:false}, and ClaimSection returns null.

Rationale:
- refused_final keeps « Refus confirmé » only for kind refused_confirmed, where the restaurant did refuse (P2-10).
- « Remboursée » requires F03 true.

### F07 [CORE] Help page lines
In app/[locale]/eat/order/[orderId]/help/page.tsx eligibilityLabel, the existing-claim branch maps exactly:
- restaurant_review → claimAlreadyFiled
- financial_verification | arbitration → claimInReview
- refunding → claimRefunding
- approved → claimApproved
- refunded → claimRefunded
- refund_unconfirmed → NEW claimRefundUnconfirmed
- closed_by_support → claimClosedBySupport
- refused | refused_final | refused_by_grubano → claimRefused

NEW eat.help.claimRefundUnconfirmed uses the same 5 strings as claims.status.refund_unconfirmed (F06).

Existing lines stay unchanged:
- claimRefused « Réclamation refusée. »
- claimInReview « Réclamation en cours d'examen. »
- claimClosedBySupport as closed_by_support

The help page stays gated: it fetches eligibility only when enabled.

Consequence: a REVERTED_AFTER_REFUND claim is terminal in eligibility, so within the claim window the form is offered (Track B J10b). Money safety comes from E2/E3/T2 H1 (A-S31-*), not from copy.

### F08 [CORE] Reasons shown to the customer, and who wrote them
Add to lib/claim-action-rules.ts:
```ts
export function customerClaimReasons(c: ClaimFacts & {restaurantResponseReason?: string|null; arbitrationReason?: string|null}) {
  const k = claimClosureKind(c); const declaration = k==='settled_by_declaration'||k==='closed_by_declaration'
  return { restaurantResponseReason: c.restaurantResponse==='refused' ? (c.restaurantResponseReason ?? null) : null,
           arbitrationReason: c.arbitrationDecision && !declaration ? (c.arbitrationReason ?? null) : null }
}
```
getClaimEligibility and listConsumerClaims spread these into the consumer payload. The eligibility select adds restaurantResponse, reason and arbitrationReason. CONSUMER_HIDDEN_CLAIM_FIELDS is still applied.

components/claims/ClaimSection.tsx:
- `const showRefusalReason = !!ec.restaurantResponseReason`.
- After the arbitration line, render `{ec.arbitrationReason && <p …><span className='font-semibold'>{t('client.grubanoDecisionReason')}:</span> {ec.arbitrationReason}</p>}`.

NEW claims.client.grubanoDecisionReason:
- fr « Motif de la décision de Grubano »
- en « Reason for Grubano’s decision »
- es « Motivo de la decisión de Grubano »
- it « Motivo della decisione di Grubano »
- ar « سبب قرار Grubano »

Admin (components/claims/AdminClaimsArbitration.tsx): the reason label reads `t(c.restaurantResponse==='accepted' ? 'admin.restaurantNote' : 'admin.refusalReason')`. listArbitrationQueue already spreads restaurantResponse.

NEW claims.admin.restaurantNote:
- fr « Note du restaurant (en acceptant) »
- en « Restaurant’s note (when accepting) »
- es « Nota del restaurante (al aceptar) »
- it « Nota del ristorante (all’accettazione) »
- ar « ملاحظة المطعم (عند القبول) »

Test: arbitrationReason is never in a consumer payload for a declaration kind; restaurantResponseReason only when restaurantResponse==='refused' (P3-21).
IMPLEMENTATION NOTE (W6): landed. customerClaimReasons (lib/claim-action-rules) is spread into getClaimEligibility's existingClaim and every listConsumerClaims item; ClaimSection shows the restaurant reason whenever the payload carries it and Grubano's reason on its own line; the arbitration console labels a note written while accepting « Note du restaurant (en acceptant) ». Pinned by tests/claims-closure-copy.test.ts (F08).

### F09 [CORE] Customer client-copy rewordings (provenance-neutral, no promise)
Replace in all 5 locales:

claims.client.statusTitle:
- fr « Dossier lié à cette commande »
- en « Case linked to this order »
- es « Expediente vinculado a este pedido »
- it « Pratica collegata a questo ordine »
- ar « ملف مرتبط بهذا الطلب »

claims.client.arbitrationInfo:
- fr « Ce dossier est en cours d’examen par Grubano. »
- en « This case is being reviewed by Grubano. »
- es « Este expediente está siendo examinado por Grubano. »
- it « Questa pratica è in fase di esame da parte di Grubano. »
- ar « هذا الملف قيد المراجعة من طرف Grubano. »

claims.client.refusalReasonShown:
- fr « Motif du refus du restaurant »
- en « Restaurant’s reason for refusal »
- es « Motivo del rechazo del restaurante »
- it « Motivo del rifiuto del ristorante »
- ar « سبب رفض المطعم »

claims.client.success (was « …suivez sa réponse sur cette page »):
- fr « Réclamation envoyée. Le restaurant l’examine. »
- en « Claim submitted. The restaurant is reviewing it. »
- es « Reclamación enviada. El restaurante la está revisando. »
- it « Reclamo inviato. Il ristorante lo sta esaminando. »
- ar « تم إرسال الشكوى. المطعم يراجعها. »

claims.client.description (was « …sa réponse s’affichera ici »):
- fr « Dites-nous ce qui s’est passé. Le restaurant examine votre demande. »
- en « Tell us what happened. The restaurant reviews your request. »
- es « Cuéntenos qué pasó. El restaurante revisa su solicitud. »
- it « Ci dica cosa è successo. Il ristorante esamina la richiesta. »
- ar « أخبرنا بما حدث. يراجع المطعم طلبك. »

eat.help.claimFiledSub (was « …Vous serez informé de la suite. »):
- fr « Votre réclamation est en cours d'examen. »
- en « Your claim is under review. »
- es « Tu reclamación está en revisión. »
- it « Il Suo reclamo è in fase di revisione. »
- ar « مطالبتك قيد المراجعة. »

Caveat, stated in docs/ops: « Le restaurant l’examine » is true only while CLAIM_AUTO_RESOLVE_ENABLED is off. Reword before that flag opens.
IMPLEMENTATION NOTE (W6): the values landed in 5 locales (tests/claims-closure-copy.test.ts, F09). The caveat on « Le restaurant l’examine » is stated in docs/ops/REFUND-FINANCIAL-CONTRACT.md §23.

### F10 [CORE] Forbidden customer sentences and their guards
A customer string (claims.status.*, claims.client.*, eat.help.*, claimEmails.*) must never do any of the following:
- (1) promise a notification, an in-app display or a follow-up. The CLAIMS lease lasts at most 60 min, and R-D7 or R-D3 can withhold any send;
- (2) attribute a refusal to the restaurant unless restaurantResponse==='refused';
- (3) state paid, not paid, refunded or « émis » unless F03 or H06 established it;
- (4) carry a refund or no-refund sentence on a declaration (R-D4);
- (5) say « votre réclamation » about a system claim, in the status title or in the refusedByGrubano copy.

Guards (new test, 5 locales):
- (a) Over claimEmails.*, eat.help.* and claims.client.*, no match for /vous serez informé|dès qu’une décision|s’affichera ici|suivez sa réponse|will be notified|will appear here|check this page|le informaremos|le avisaremos|aparecerá aquí|sarà informato|la informeremo|apparirà|سيتم إبلاغك|سنُعلمك|سيظهر|تابع رده/i.
- (b) No « Grubano arbitrera » without the « Si la contestation vous est proposée » condition.
- (c) « votre réclamation » and its 4 translations are absent from claimEmails.refundRecorded.*, refundedLinked.* and refusedByGrubano.*.
- (d) « Refus confirmé » and « a confirmé le refus » are reachable only for kind refused_confirmed. This is a unit test on customerClaimStatus plus refusalEmailKind.

Negative control: the current values of ack.next, orderCancelledPaid.next, claimFiledSub, client.success and client.description fail (a).

Extend tests/claims-t49-round12.test.ts PROMISES_BY_LOCALE to flatten m.claimEmails as well.
IMPLEMENTATION NOTE (W6) on ER-C14: F10 (1) also covers five customer strings that promised a decision, a review or a reply the code cannot establish. They are reworded in 5 locales: claims.client.contestSuccess (« Contestation envoyée : la réclamation est transmise à Grubano pour arbitrage. »), claims.client.contestDescription (« En contestant, vous transmettez la réclamation à Grubano pour un arbitrage neutre. »), eat.help.refundEstimate (« sera examinée » removed), eat.help.refundOffBody (« nous vous répondrons personnellement » removed) and claimEmails.orderCancelledPaid.bodyExisting (« elle suit son circuit normal » removed). Guards (a)-(d), and a per-locale guard of that class with HEAD negative controls, are in tests/claims-closure-copy.test.ts (J-C12, J-C13); tests/claims-t49-round12.test.ts PROMISES_BY_LOCALE flattens m.claimEmails.

### F11 [CORE] Customer copy that stays wrong and must be disclosed, not claimed compliant
Copy cannot fix these. They are stated in docs/ops/REFUND-FINANCIAL-CONTRACT.md and in the founder report:
- (1) A-S31e-1/2 (REG-7): « Remboursée » is stale after a Stripe reversal whose event was never processed. It is NOT fail-visible and needs explicit founder acceptance.
- (2) A-S31f-2/3: « Remboursée » is shown after a received failure event whose claim marking failed (webhook 503). This is a C6 breach, bounded by Stripe redelivery (a few retries over a few hours in test mode).

A-S31d (pending row, no failure signal read) and A-S10/A-S21 (pending row, Stripe read succeeded) are compliant: the code has read no failure.

No admin or doc string may say that these states show only true copy.
IMPLEMENTATION NOTE (W6): stated in docs/ops/REFUND-FINANCIAL-CONTRACT.md §22, pinned by J-C18 in tests/claims-closure-copy.test.ts. The adjacency scan covers the messages, lib/claims.ts, both consoles and docs/ops, except this specification, which states the rule itself.

### F12 [CORE] Approval toast contract (lib/claim-approval-toast.ts)
Input type: `export type ApprovalRefundOutcome = { state?: string; amountCents?: number; error?: string; reason?: string; until?: string } | null | undefined`. RefundTriggerResult (lib/claims.ts ~284) gains `{ state: 'failed'; error: 'unconfirmed_within_window'; until: string }` (C3 (e')).
Widen the output type:
```ts
export type ApprovalToast =
 | { key:'approvedRefunded'; tone:'success'; amountCents:number }
 | { key:'approvedPending'; tone:'success' }
 | { key:'approvedResumeMismatch'; tone:'error' }
 | { key:'approvedIdentityUnverified'; tone:'error' }
 | { key:'approvedSuperseded'; tone:'error' }
 | { key:'approvedNotSentUntil'; tone:'success'; until:string }
 | { key:'approvedNotSent'; tone:'success'|'error' }
 | { key:'approvedFailed'; tone:'error' }
```
approvalToast(refund) maps, in order:
- state 'refunded' → approvedRefunded (amountCents). triggerClaimRefund returns 'refunded' only when its T4 CAS to refunded matched 1 row.
- state 'pending' && reason === 'stripe_pending' → approvedPending (own 202, T3 'ours', T4 won).
- state 'pending' with any other reason, including 'refunds_disabled' → approvedNotSent, success tone. triggerClaimRefund returns {state:'pending', reason:'refunds_disabled'} at claims.ts 504 before any write; approvedPending there would say Stripe accepted a refund that was never started.
- state 'already_handled' → approvedNotSent, success tone.
- state 'failed' with error:
  - 'resume_mismatch' → approvedResumeMismatch (A-S15);
  - 'identity_unverified' → approvedIdentityUnverified (A-S16);
  - 'attempt_superseded' → approvedSuperseded (A-S41);
  - 'unconfirmed_within_window' with until → approvedNotSentUntil (A-S30e-3); without until → approvedNotSent, success tone;
  - 'safety_check_unreadable' → approvedNotSent, success tone (A-S30b-*);
  - 'safety_hold', 'proof_locked', 'proof_awaiting', 'proof_stale', 'financial_verification' or 'own_row_exists' → approvedNotSent, error tone (A-S30, A-S30c, A-S30e-1/2/4, A-S30g, A-S33, A-S38);
  - any other error → approvedFailed.
- null, undefined or any other state → approvedNotSent, success tone.
These result shapes are a contract: triggerClaimRefund returns exactly them. A test gives each Section A approval state its toast (J-C15).

### F13 [CORE] Admin approval toast copy (claims.admin.*), all 5 locales
REWORD approvedNotSent. The current « aucun remboursement confirmé… À vérifier dans « Remboursements à traiter » » was true for 'pending' only by vagueness.
- fr « Réclamation approuvée — aucun remboursement n’a été lancé par cette action. »
- en « Claim approved — no refund was started by this action. »
- es « Reclamación aprobada — esta acción no inició ningún reembolso. »
- it « Reclamo approvato — nessun rimborso è stato avviato da questa azione. »
- ar « تمت الموافقة على الشكوى — لم يُطلَق أي استرداد بهذا الإجراء. »

approvedFailed and approvedResumeMismatch: in each locale, delete the last sentence, the one that names the « Remboursements à traiter » section. No approval toast names a console section.

NEW approvedPending:
- fr « Réclamation approuvée — Stripe a accepté le remboursement de cette réclamation, qui reste en attente chez Stripe : aucun montant n’est encore établi. »
- en « Claim approved — Stripe accepted this claim’s refund, which is still pending at Stripe: no amount is established yet. »
- es « Reclamación aprobada — Stripe aceptó el reembolso de esta reclamación, que sigue pendiente en Stripe: aún no se ha establecido ningún importe. »
- it « Reclamo approvato — Stripe ha accettato il rimborso di questo reclamo, che è ancora in attesa su Stripe: nessun importo è ancora stabilito. »
- ar « تمت الموافقة على الشكوى — قبلت Stripe استرداد هذه الشكوى، ولا يزال معلَّقًا لدى Stripe: لم يُحدَّد أي مبلغ بعد. »

NEW approvedIdentityUnverified:
- fr « Réclamation approuvée : le moteur a rendu un remboursement pour cette commande, mais l’identité de sa ligne n’a pas pu être relue (lecture de la base en échec). Ce remboursement n’est ni attribué à cette réclamation, ni écarté ; le détail enregistré dit s’il a abouti ou reste en attente chez Stripe. Ne relancez rien : seule « Réconcilier d’après la preuve » peut établir à quelle réclamation il appartient. »
- en « Claim approved: the refund engine returned a refund for this order, but the identity of its row could not be re-read (database read failed). This refund is neither attributed to this claim nor ruled out; the recorded detail says whether it completed or is still pending at Stripe. Do not retry: only « Réconcilier d’après la preuve » can establish which claim it belongs to. »
- es « Reclamación aprobada: el motor de reembolsos devolvió un reembolso para este pedido, pero no se pudo releer la identidad de su línea (lectura de la base fallida). Este reembolso no se atribuye a esta reclamación ni se descarta; el detalle registrado indica si se completó o sigue pendiente en Stripe. No reintente nada: solo « Réconcilier d’après la preuve » puede establecer a qué reclamación pertenece. »
- it « Reclamo approvato: il motore dei rimborsi ha restituito un rimborso per quest’ordine, ma l’identità della sua riga non ha potuto essere riletta (lettura del database non riuscita). Questo rimborso non è né attribuito a questo reclamo né escluso; il dettaglio registrato indica se è andato a buon fine o è ancora in attesa su Stripe. Non ritenti nulla: solo « Réconcilier d’après la preuve » può stabilire a quale reclamo appartiene. »
- ar « تمت الموافقة على الشكوى: أعاد نظام الاسترداد استردادًا لهذا الطلب، لكن تعذّرت إعادة قراءة هوية سطره (فشل القراءة من قاعدة البيانات). هذا الاسترداد غير منسوب إلى هذه الشكوى وغير مستبعد؛ يوضّح التفصيل المسجَّل ما إذا اكتمل أو لا يزال معلَّقًا لدى Stripe. لا تُعِد أي محاولة: وحده « Réconcilier d’après la preuve » يمكنه تحديد الشكوى التي ينتمي إليها. »

NEW approvedSuperseded:
- fr « Réclamation approuvée, MAIS son état a changé pendant cette tentative : la réclamation ne reflète pas ce que cette tentative a obtenu du moteur. Ne relancez rien ; lisez la ligne de la réclamation et, si elle est proposée, lancez « Réconcilier d’après la preuve ». »
- en « Claim approved, BUT its state changed during this attempt: the claim does not reflect what this attempt obtained from the refund engine. Do not retry; read the claim’s line and, if offered, run « Réconcilier d’après la preuve ». »
- es « Reclamación aprobada, PERO su estado cambió durante este intento: la reclamación no refleja lo que este intento obtuvo del motor de reembolsos. No reintente nada; lea la línea de la reclamación y, si se ofrece, lance « Réconcilier d’après la preuve ». »
- it « Reclamo approvato, MA il suo stato è cambiato durante questo tentativo: il reclamo non riflette ciò che questo tentativo ha ottenuto dal motore dei rimborsi. Non ritenti nulla; legga la riga del reclamo e, se proposto, avvii « Réconcilier d’après la preuve ». »
- ar « تمت الموافقة على الشكوى، لكن حالتها تغيّرت أثناء هذه المحاولة: لا تعكس الشكوى ما حصلت عليه هذه المحاولة من نظام الاسترداد. لا تُعِد أي محاولة؛ اقرأ سطر الشكوى، وإن عُرض عليك، شغّل « Réconcilier d’après la preuve ». »

NEW approvedNotSentUntil ({date}):
- fr « Réclamation approuvée — aucun remboursement n’a été lancé par cette action : une ligne de remboursement plus ancienne de cette commande est encore dans sa fenêtre de confirmation. Conclusion possible à partir du {date}. »
- en « Claim approved — no refund was started by this action: an older refund row on this order is still within its confirmation window. A conclusion is possible from {date}. »
- es « Reclamación aprobada — esta acción no inició ningún reembolso: una línea de reembolso más antigua de este pedido sigue dentro de su ventana de confirmación. Conclusión posible a partir del {date}. »
- it « Reclamo approvato — nessun rimborso è stato avviato da questa azione: una riga di rimborso più vecchia di quest’ordine è ancora nella sua finestra di conferma. Conclusione possibile a partire dal {date}. »
- ar « تمت الموافقة على الشكوى — لم يُطلَق أي استرداد بهذا الإجراء: لا يزال سطر استرداد أقدم لهذا الطلب ضمن نافذة التأكيد الخاصة به. يمكن الاستنتاج ابتداءً من {date}. »

Drafting constraints come from the existing regexes:
- ar drafts never use « المحرك »;
- es and it drafts put no future-tense verb within 60 characters after motor/motore.
IMPLEMENTATION NOTE (W2): approvedNotSent is reworded as specified above, in all five locales (round-1 fix: F12 routes the T2 (e') financial-verification park to it, and « Remboursements à traiter » never lists a financial_verification claim). approvedSuperseded ships without « ce que cette tentative a obtenu du moteur » (ER-R30: T2 also returns attempt_superseded before any engine call); shipped strings — fr « Réclamation approuvée, MAIS son état a changé pendant cette tentative : la réclamation ne reflète pas cette tentative. Ne relancez rien ; lisez la ligne de la réclamation et, si elle est proposée, lancez « Réconcilier d’après la preuve ». »; en « Claim approved, BUT its state changed during this attempt: the claim does not reflect this attempt. Do not retry; read the claim’s line and, if offered, run « Réconcilier d’après la preuve ». »; es « Reclamación aprobada, PERO su estado cambió durante este intento: la reclamación no refleja este intento. No reintente nada; lea la línea de la reclamación y, si se ofrece, lance « Réconcilier d’après la preuve ». »; it « Reclamo approvato, MA il suo stato è cambiato durante questo tentativo: il reclamo non riflette questo tentativo. Non ritenti nulla; legga la riga del reclamo e, se proposto, avvii « Réconcilier d’après la preuve ». »; ar « تمت الموافقة على الشكوى، لكن حالتها تغيّرت أثناء هذه المحاولة: لا تعكس الشكوى هذه المحاولة. لا تُعِد أي محاولة؛ اقرأ سطر الشكوى، وإن عُرض عليك، شغّل « Réconcilier d’après la preuve ». ». A console slice implementing F13 must keep these, not the frozen text. The approvedFailed / approvedResumeMismatch deletions stay with the console slice (those claims are listed in the section they name). Pinned by tests/claim-approval-toast.test.ts and tests/claims-t49-round9.test.ts.
IMPLEMENTATION NOTE (W7): approvedFailed loses its last sentence (the « Remboursements à traiter » pointer) in all five locales. approvedResumeMismatch loses only the section-naming clause of its last sentence: « Ne relancez aucun remboursement — ouvrez « Remboursements à traiter ». » becomes « Ne relancez aucun remboursement. » (en « Do not issue another refund. », es « No emita otro reembolso. », it « Non emetta un altro rimborso. », ar « لا تُصدر ردًا آخر. ») — deleting the whole sentence would drop the never-retry instruction (pinned since round 7). ER-C15 resolved: the ar values of both keys replace « المحرك » with « نظام الاسترداد » (the approvedIdentityUnverified wording). ER-R30: the W2 approvedSuperseded strings are confirmed (T2 returns attempt_superseded before any engine call). Pinned by tests/claims-copy-contract.test.ts (J-C16), tests/claim-approval-toast.test.ts (J-C15) and tests/claims-t49-round9.test.ts.

### F14 [CORE] Financial-verification console toasts (AdminFinancialVerification.tsx, fr literals)
The reconcile `said` map is keyed by outcome. Values:

- refunded, evidence 'stripe_read': « Preuve trouvée : Stripe rapporte ce remboursement abouti. Réclamation réconciliée sur son identité exacte. »
- refunded, otherwise: « Réclamation réconciliée sur son identité exacte d’après notre ligne liée (Stripe n’a pas été relu pour cette conclusion ; aucun avis client ne peut partir sans relecture Stripe). »
- no_refund_proven (v13 only): « Preuve d’absence : Stripe ne rapporte aujourd’hui aucun remboursement abouti ou en attente qui ne soit expliqué (liste complète lue), et aucune ligne de la commande n’arrête le moteur. La réclamation repasse en « approuvée, non payée ». Rien ne la paiera automatiquement : une nouvelle approbation admin, réclamations et remboursements ouverts, est acceptée au plus tôt le ${payableFrom} (UTC) ; juste avant le moteur, Stripe et nos lignes sont relus, et le paiement n’est lancé que si cette relecture confirme encore la preuve. »
  - payableFrom is the reconcile result's Q-INSTANT.
  - If it is absent, render « instant illisible — relancez la réconciliation » instead of the date.
- no_refund_proven_rail_locked: « Stripe ne rapporte aucun remboursement non expliqué sur ce paiement, MAIS une nouvelle approbation ne paierait pas cette réclamation : refus du moteur ou blocage de sûreté, la cause est dans le détail de la réclamation. Rien n’a été payé par cette action. « Clôturer ce dossier… » enregistre votre déclaration ; « Réconcilier d’après la preuve » relit la preuve si la cause peut cesser. »
  - The old « le moteur refusera tout remboursement » was false for the H1/H2/H5 holds (A-S04, A-S08a, A-S39: the engine accepts).
- awaiting_finalization: « Stripe rapporte ABOUTI le remboursement d’une ligne d’une AUTRE réclamation, encore en attente dans notre base ; tant qu’elle le reste, le moteur finaliserait cette ligne au lieu de payer cette réclamation. Rien n’a été payé par cette action. Relancez « Réconcilier d’après la preuve » lorsque cette ligne ne sera plus en attente ; « Clôturer ce dossier… » reste possible. »
- refund_failed: « Preuve trouvée : Stripe rapporte cette ligne de remboursement ÉCHOUÉE ; elle n’a rien versé au titre de cette ligne (cela ne dit rien des autres remboursements de la commande). Le détail enregistré dit si le moteur refuse désormais tout remboursement sur cette commande ; « Clôturer ce dossier… » enregistre votre déclaration. »
  - Replaces « La réclamation redevient traitable ».
- engine_row_dead: « Stripe ne connaît aucun remboursement pour cette ligne, et le moteur ne la créera plus : elle n’a rien versé. Tant qu’elle reste en attente, le moteur ne lance aucun nouveau remboursement sur cette commande. Le dossier est désormais clôturable (« Clôturer ce dossier… »). »
  - Replaces « rien ne sera payé par Grubano ».
- reverted_after_refund: « Stripe rapporte que le remboursement lié a échoué ou a été annulé : la réclamation est marquée et reste dans « Vérification financière requise ». Rien n’a été déplacé par cette action. Quand les réclamations sont ouvertes, le client lit « vérification manuelle » ; sinon il ne voit aucune réclamation. « Clôturer ce dossier… » enregistre votre déclaration. »
- refund_still_standing:
  - stripeStatus 'succeeded': « Stripe rapporte ce remboursement ABOUTI : rien n’a été modifié. »
  - 'pending' or 'requires_action': « Stripe rapporte ce remboursement EN ATTENTE : rien n’a été modifié. Relancez « Réconcilier d’après la preuve » lorsqu’il sera terminal. »
  - 'not_at_stripe_yet': the existing unconfirmed_within_window toast with its date. Never « toujours ABOUTI ou en attente ».

Tone: needsAttention adds no_refund_proven_rail_locked, awaiting_finalization and reverted_after_refund.

The attribute and adopt toasts render body.error for every 409 (the A-S21/A-S23a success texts, the A-S22 refusals). The reason-blind toast is deleted (P2 toasts).
IMPLEMENTATION NOTE (W2, round-1 fix): landed in AdminFinancialVerification.tsx with D4, C1 and G2: refunded (stripe_read, or our row with « Stripe n’a pas été relu »), no_refund_proven with payableFrom (v13; the round-12 ladder's legacy proof keeps its old text until W3), no_refund_proven_rail_locked, refund_failed, the awaiting text under the G8 outcome name no_refund_proven_awaiting_finalization, and changed_during_read (C1 note). refund_still_standing, reverted_after_refund and the engine_row_dead rewording stay with the console slice.
IMPLEMENTATION NOTE (W7): the said map, its tone and the AMF-1 toast are the pure lib/claim-console-copy.ts (reconcileSaid / reconcileToast / settledReverifyToast), which the card calls. Values as F14, with these readings: (1) no_refund_proven_rail_locked takes ER-R27’s qualifier (« aucun remboursement abouti ou en attente non expliqué »): an ownerless failed external refund can hold the lock (H2, A-S08a); (2) reverted_after_refund keeps G10’s toast (W5 note: R0a’s evidence may be our failed row, not a Stripe read); (3) refund_still_standing with a status other than succeeded / pending / requires_action reads « Stripe rapporte ce remboursement au statut « s » : rien n’a été modifié. », and not_at_stripe_yet reuses the unconfirmed_within_window toast — never « toujours ABOUTI ou en attente »; (4) payableFrom absent renders « (instant illisible — relancez la réconciliation) » in place of the date, and the round-12 legacy branch is deleted. A lost compare-and-set with no bind of this action reads A-S29-3’s ADMIN text; an unknown outcome reads « Réponse inattendue : rien n’est confirmé. Relisez sa ligne dans la file. » with the error tone. The D4 pre-click caption is rendered under « Réconcilier d’après la preuve » on an approved row (J-M33). Pinned by tests/claims-t49-round10.test.ts (J-C17: values read out of F14, G10 and A-S29-3) and tests/claims-exit-copy.test.ts (J-M31).

### F15 [CORE] Money state classification, money labels, guidance and money line
CLASSIFICATION (lib/claims.ts listActionableRefundClaims, ~1192-1195, the single moneyState site used by the FV card and ARB): after the reconcile-required and FV checks,
- refundError starts with 'no_refund_proven:v13:' → 'absence_proven_payable';
- else isNoRefundProven(refundError) (a legacy 'no_refund_proven:' proof) → 'reconcile_required' (A-S32);
- 'no_refund_proven_rail_locked:' (AWAITING included) is not matched by isNoRefundProven (its prefix is `no_refund_proven:`) → 'refund_error_recorded'.
AdminClaimsArbitration.tsx MONEY label absence_proven_payable (replaces line 186): « Aucun remboursement non expliqué rapporté par Stripe à la preuve (liste complète lue) — approuvée, non payée. Rien ne la paiera automatiquement : nouvelle approbation admin, réclamations et remboursements ouverts, au plus tôt le ${instant} (UTC), relue avant le moteur ».
- ${instant} comes from C4's proofInstant applied to the claim's refundError.
- If it is unreadable: « — instant illisible : approbation refusée, relancez « Réconcilier d’après la preuve » ».
lib/claim-action-rules.ts GUIDANCE (rendered by AdminFinancialVerification.tsx 490 and AdminClaimsArbitration.tsx 272):
- absence_proven_payable (replaces line 176): « Rien à clôturer : approuvée et non payée ; à la preuve, Stripe ne rapportait aucun remboursement non expliqué. Elle ne se paie que par une nouvelle approbation admin, réclamations et remboursements ouverts, au plus tôt à l’instant écrit dans son détail, et seulement si la relecture avant moteur confirme encore la preuve. »
- approved_not_driven: « Approuvée, jamais payée. Elle ne se paie que par l’approbation admin (file d’arbitrage), réclamations et remboursements ouverts, et seulement si la vérification avant moteur le permet à ce moment. Aucune clôture manuelle sur cet état. »
Why these are true on every v13 state: HEAD_A (A-S01) and HEAD_B (A-S02: Stripe money explained by other settled claims) both have no UNEXPLAINED refund at the proof; a later out-of-band refund (A-S38-*) does not falsify « à la preuve ». Neither text says no refund moved money.
lib/claim-money-line.ts moneyLineFor, and the same branch at AdminClaimsArbitration.tsx ~228:
- a resume_mismatch whose boundRow.reason === `claim:${claimId}` returns {certainty:'identity_unread'} with the A-S36-1 text;
- any other resume_mismatch keeps bound_but_not_ours;
- the line takes boundRow (undefined → 'unknown' « INDÉTERMINÉ — à établir par preuve Stripe. »);
- a REVERTED_AFTER_REFUND or STRIPE_REVERTED claim returns bound_reverted with the A-S24-1 text.
PINS: (1) a legacy 'no_refund_proven:' fixture classifies reconcile_required, a v13 fixture absence_proven_payable, a rail_locked fixture refund_error_recorded; (2) GUIDANCE, the MONEY labels and the said map contain none of « n’a déplacé d’argent », « jamais déplacé », « Absence de remboursement PROUVÉE » (G2, J-M31); negative control: the HEAD line 176 and line 186 strings fail. Guidance and messages must not contain /la reprend/ (tests/claims-t49-round10.test.ts); a guidance line needing it writes « reprend cette ligne ».
IMPLEMENTATION NOTE (W1): ER-R27 resolved — the GUIDANCE reads « … Stripe ne rapportait aucun remboursement abouti ou en attente non expliqué … » and the MONEY label « Aucun remboursement abouti ou en attente non expliqué rapporté par Stripe à la preuve … »; pinned by J-M31. The MONEY label is rendered by lib/claim-action-rules absenceProvenPayableLabel(refundError), which AdminClaimsArbitration calls per claim. moneyLineFor's « boundRow undefined → unknown » applies in the resume_mismatch branch, where the row decides identity; a plain bound row keeps 'bound'. listActionableRefundClaims reads the bound row's reason and carries refundIdentityUnread; the ARB amount line renders the A-S36-1 text for it. Round-1 fix: the FV card calls cardMoneyLine(r) (lib/claim-money-line), which passes claimId, boundRow { reason } from listActionableRefundClaims' refund payload (a payload without the reason reads as not read → INDÉTERMINÉ) and the row's reconcilable flag, so a not-ours resume_mismatch reads bound_but_not_ours again. The A-S36-1 sentence names « Réconcilier d’après la preuve » only when reconcilable === true (identityUnreadText); while (ii) is refused (W1: no boundRow in the gate) both consoles render the fact without the exit (IDENTITY_UNREAD_NO_EXIT_TEXT), pinned by the D0 / F16 (7) parity test in tests/claims-exit-parity.test.ts. A-S24-1 in ARB: listActionableRefundClaims nulls actualRefundedCents for STRIPE_REVERTED / REVERTED_AFTER_REFUND, and the amount line branch is the pure amountLineKind ('reverted' → BOUND_REVERTED_TEXT). The declaration close still offered on an own-row resume_mismatch comes from the round-12 predicate (D11 slice); switching it before (ii) is admitted would leave that state with no exit.
IMPLEMENTATION NOTE (W3, round-2 fix): CLASSIFICATION gains one state. A reconcile marker whose start instant cannot be read (malformed, or later than now) is refused by the gate with RECONCILE_MARKER_UNREADABLE_TEXT (D5 W3 note), and acceptedExits is []. It classifies 'reconcile_marker_unreadable', never 'reconcile_required': the reconcile_required GUIDANCE names « Réconcilier d’après la preuve » as refused only by the grace, and ARB renders it whenever !resolvable (D0 / F16 (7)). Its GUIDANCE is « Argent non établi. » + RECONCILE_MARKER_UNREADABLE_TEXT + « Aucune clôture manuelle sur cet état. ». Its ARB MONEY label states the unreadable instant and the refusal, with no control. listActionableRefundClaims reads the gate verdict once, for both the state and the reconcilable flag. Pinned in tests/claims-exit-parity.test.ts (D0 / F16 (7): malformed and future markers, approved and refunding, stay out of violations(); the negative control maps them back to reconcile_required and gets exactly those four ids). The guided-state enumerations in tests/claims-t49-round10.test.ts and tests/claims-exit-copy.test.ts include the new state.

### F16 [CORE] refundError and admin text rules, with a source scan
Writers owned by Section A/E follow these rules.

(1) Never write « jamais déplacé », « aucun remboursement n’a déplacé d’argent », « relèvent d’AUTRES réclamations », « aucun code ne sort », « dite définitive », « le moteur refusera tout remboursement », « redevient traitable », « rien ne sera payé par Grubano », « quand le moteur la reprendra », « Le client lit désormais », « De l'argent A bougé » or « exclusiveReason ».

(2) « n’appartient PAS » appears only in:
- the resume_mismatch writers of triggerClaimRefund, when the identity read returned not-ours;
- claim-money-line bound_but_not_ours and its AdminClaimsArbitration mirror;
- claims.admin.approvedResumeMismatch.
The identity-read failure writes the A-S16a/b text (P1-2).

(3) The customer-visibility sentence is always « Quand les réclamations sont ouvertes, le client lit « vérification manuelle » ; sinon il ne voit aucune réclamation. »

(4) An engine refusal is quoted as the first refusal A-S00 reaches on the facts:
- « Charge introuvable sur le paiement. » only when piStatus==='succeeded';
- otherwise E1 « Commande non payée — rien à rembourser. » or E1b « Paiement non débité — rien à rembourser. »

(5) The E2 lock uses the A-S00 E2 SENTENCE.

(6) The pending-row reversal uses the conditional « si le moteur la reprend (il reprend la plus ancienne ligne en attente d’une commande avant tout nouveau remboursement) ».

(7) Every text naming a later exit names an action that exists for that state in Section A.

Test: extend the FORBIDDEN list of tests/claims-t49-round7-routes.test.ts with (1), apply it to its FILES plus lib/claim-email-toast.ts and app/api/admin/claims/[id]/closure-notice/route.ts, and pin the allowed file set of (2) by occurrence count.

Negative control: the HEAD strings at lib/claims.ts ~551, ~2384 and AdminFinancialVerification.tsx ~136 fail.
IMPLEMENTATION NOTE (W1): ER-C24 resolved — (6) is written « si le moteur reprend cette ligne (il reprend la plus ancienne ligne en attente d’une commande avant tout nouveau remboursement) », because the round-10 PROMISES pin /la reprend/i scans lib/claims.ts; G11's pending-row TEXT, A-S07, A-S31d and G8's E3 failed_at_stripe continuation take that wording in their slices. The J-C14 FORBIDDEN extension over lib/claims.ts, AdminFinancialVerification.tsx, lib/claim-email-toast.ts and the closure-notice route lands with the slices that rewrite or create those files: their round-12 strings (« De l'argent A bougé », « jamais déplacé », « relèvent d’AUTRES réclamations », « refusera tout remboursement ») belong to the ladder, T3 and the F14 toasts.

### F17 [CORE] Arbitration console decision labels
Replace in all 5 locales:

claims.admin.refuseFinal (was « Confirmer le refus »):
- fr « Refuser définitivement »
- en « Decline definitively »
- es « Rechazar definitivamente »
- it « Rifiutare definitivamente »
- ar « رفض نهائي »

claims.admin.refusedFinalDone:
- fr « Réclamation refusée définitivement. »
- en « Claim declined definitively. »
- es « Reclamación rechazada definitivamente. »
- it « Reclamo rifiutato definitivamente. »
- ar « تم رفض الشكوى نهائياً. »

claims.admin.decisionReasonLabel:
- fr « Motivation (facultatif) — visible par le client (e-mail de décision et suivi de sa commande), sauf si le dossier est ensuite clôturé par déclaration »
- en « Reasoning (optional) — visible to the customer (decision email and order tracking), unless the case is later closed by declaration »
- es « Justificación (opcional) — visible para el cliente (correo de decisión y seguimiento de su pedido), salvo si el expediente se cierra después por declaración »
- it « Motivazione (facoltativo) — visibile al cliente (email di decisione e monitoraggio del Suo ordine), salvo se la pratica viene poi chiusa per dichiarazione »
- ar « التبرير (اختياري) — يراه العميل (بريد القرار ومتابعة طلبه)، إلا إذا أُغلق الملف لاحقاً بتصريح »

The « sauf si… » clause covers only in-app display. An e-mail already sent stays sent.

### F18 [CORE] Copy contract tests
Add tests/claims-copy-contract.test.ts:
- (a) The F05 fixture table: every line gives its key.
- (b) Every CUSTOMER_STATUSES value has a claims.status key in all 5 locales and an F07 help branch.
- (c) customerClaimStatus with refundedRow null on a refunded claim gives financial_verification; with an ambiguous row (binders 2) it gives financial_verification.
- (d) The Prisma call shape of the F03 binder count includes the {refundError:null} branch.
- (e) F10 guards with their negative controls.
- (f) The F12 mapping table, one case per error code.
- (g) The F16 scan.
- (h) Parity: for a refunded claim with a closure record, claims open and a readable row, customerClaimStatus === 'refund_unconfirmed' exactly when sendClaimClosureEmail answers why 'refunded_row_unproven' (H06).

Run npm run check:i18n and a fresh cold npm run build before commit.
IMPLEMENTATION NOTE (W7 fixer) on F18 (h): pinned by J-C25 in tests/claims-closure-emails.test.ts (slice W6) and not duplicated in tests/claims-copy-contract.test.ts; tests/claims-closure-ui.test.ts carries the cross-reference.

## G. RECONCILIATION RULES

Evidence-only reconciliation. It reads our rows and Stripe, writes only Claim rows through CAS (section C), never calls executeRefund/driveRefund/finalizeRefund/markRefundRowFailed, and never writes to Stripe. The only Refund write on these paths is the adoption mirror (B11, C8). A proof of absence is PAYABLE only when the engine mirror E1-E6 and the holds are clear, and only from its quiescence instant (C4). Every lock is permanent unless G9 establishes it as temporary. State ids refer to section A.

### G1 [CORE] Reconcile gate: reconcileRefusal admissions
reconcileClaimEvidence reads the claim { id, orderId, status, refundId, refundAttempted, requestedAmountCents, refundError }. When refundId is set it also reads boundRow = refund.findUnique select { id, orderId, status, stripeRefundId, reason, amountCents, createdAt } (throw → B12). Then gate = reconcileRefusal({ ...claim, boundRow }).
Keep the existing admissions: FV; marker with RECONCILE_GRACE_MS; legacyStranded; bound (approved|refunding, refundId, no error); attemptedUnrecorded.
Add:
(i) status approved && refundAttempted === false && !refundId && refundError starts with 'no_refund_proven:' (v13 or legacy) or 'no_refund_proven_rail_locked:' (including AWAITING);
(i-b) status approved && refundAttempted === true && !refundId && refundError starts with 'refund_safety_hold:';
(ii) ownRowMismatch (B8);
(iii) status refunded && refundError === null && refundId && boundRow && boundRow.orderId === claim.orderId && (boundRow.status === 'pending' || boundRow.status === 'succeeded' || (boundRow.status === 'failed' && !!boundRow.stripeRefundId)).
boundRow undefined, where a rule needs it → refused.
listActionableRefundClaims, listUnfinalizedClaimRefundRows and listFinancialVerificationClaims compute reconcilable = reconcileRefusal(same facts) === null. Pin: the list flag equals the server verdict for one fixture per admission, and for approved-unpaid-no-error (refused).
IMPLEMENTATION NOTE (W1): reconcileRefusal implements every admission. The server gate (reconcileClaimEvidence) and listActionableRefundClaims call the same function; in W1 neither passes boundRow yet, so (ii) and (iii) refuse on both sides alike until the reconcile slice reads boundRow together with the G2/G10 dispatch — admitting (iii) into the round-12 dispatch would run a settled claim through the no-row ladder. (i) and (i-b) are admitted now, because D14 (1)/(2) name « Réconcilier d’après la preuve » for exactly these claims and a copy may not name a refused exit. Until the G2 rewrite lands, an admitted proof runs the round-12 ladder: claim-only writes (no Refund write, no engine, no Stripe write), and the legacy proofs it writes stay suspended by D14 (1).
IMPLEMENTATION NOTE (W1, round-1 fix): RELEASE GATE. W1 is never committed or deployed apart from the reconcile slice (G2 dispatch, G3 loadOrderMoneyFacts, G6-G8 writer with the C9 pre-image CAS). Until that slice is in the same tree, (i)/(i-b) run the round-12 no-row ladder: it re-writes a legacy proof (an A-S32-2 claim stays suspended by D14 (1)), it checks no E4/E5/E6 and no H1-H5, and some of its sentences are F16 (1) sentences, so the D14 (1)/(2) promise « relit Stripe et nos lignes et réévalue toutes les conditions » is not yet true. What W1 does establish: the ladder's proof write is a compare-and-set on the claim as read ({ id, status, refundAttempted, refundId, refundError }), a lost CAS writes nothing and answers changed_during_read (corrected in W3: the C1 round-2 note replaced the former financial_verification / already_parked_or_moved answer) (tests/claims-exit-parity.test.ts, « C9 »), and runClaimAutoApproval skips every recorded refundError (C4), so no T1 can race an admitted proof. (ii) stays refused on both sides until the boundRow read; the A-S36-1 money line names reconcile only when reconcilable === true (F15 note).
IMPLEMENTATION NOTE (W2, round-1 fix): supersedes the W1 release-gate note for (i)/(i-b): they no longer run the round-12 ladder — reconcileClaimEvidence dispatches them to the D4 derivation and N8 writer (G8 note). (ii) is admitted and settles only on a Stripe read (B8 note). (iii) stays refused until W3's R0 dispatch.
IMPLEMENTATION NOTE (W3): reconcileClaimEvidence passes the bound row it read for every non-refunded claim, so (ii) is admitted on both sides (J-M29 list parity). For a refunded claim the row is still withheld and (iii) stays refused until the R0 dispatch (G10) lands with its slice (W5): G2 (1) is unreachable in W3 (tests/claims-r13-reconcile.test.ts, J-M42). D5 applied to the marker admission: a reconcile marker whose instant reconcileMarkerAge cannot read (malformed, or in the future) is refused with RECONCILE_MARKER_UNREADABLE_TEXT « L’heure de début de la tentative de remboursement enregistrée sur cette réclamation n’a pas pu être lue, ou est postérieure à maintenant : la réconciliation est refusée, car cette tentative n’est pas établie comme terminée. Vérifiez la commande dans Stripe. » and is never read as aged (J-M34 negative control).
IMPLEMENTATION NOTE (W3, round-1 fix): corrects the sentence that followed here (« it stays listed (fail visible, E-05), and approve on such an approved claim stays REVISABLE (D14 (2)) »), which misread D14. D14 (2) applies only when reconcileRefusal === null or its only refusal is the grace delay; an unreadable marker instant is a different refusal, so approve on such an approved claim gets D14 (3) PERMANENT, never the text naming « Réconcilier d’après la preuve » (arbitrationRefusal selects REVISABLE on `admitted && !markerUnreadable`; tests/claims-exit-copy.test.ts, with the aged and in-grace markers as negative control). The claim stays listed in reconcileRequired (fail visible), but the list now carries the gate's own verdict: reconcilable false and reconcileRefusal = that text. The console renders the reconcile control only where reconcilable === true, on every bucket (listFinancialVerificationClaims carries the flag too), and renders the server's refusal text otherwise (D14, D0; tests/claims-exit-parity.test.ts: list flag false and route 409 with the same text, aged marker admitted as control). Registry: a malformed instant never becomes readable, so exitRegistry names it 'E-04:malformed_marker' (founder acceptance, E-04 W3 note); a future-dated instant stays E-05, its exit arriving once the instant has passed and the grace elapsed (E-05 W3 note). The round-11 pin that admitted a future marker is superseded (tests/claims-t49-round11.test.ts, round10 marker-recognition pin).

### G2 [CORE] Dispatch after the gate
(1) status refunded → R0 (G10).
(2) refundId && refundError === null && status ∈ {approved, refunding} → reconcileBoundClaim (existing): a row that is missing or on another order → bound_row_missing park (C9 expect); otherwise applyRowTruth(relation 'bound').
(3) rows = refund.findMany({ where: { orderId }, select: { id, status, amountCents, stripeRefundId, reason, idempotencyKey, createdAt, royaltyRefundCents }, orderBy: { createdAt: 'asc' } }); mine = rows stamped claim:<id>:
- mine.length > 1 → park multiple_candidate_refunds (existing detail);
- mine.length === 1 → applyRowTruth(relation 'stamped'); this covers (ii) and a stalled attempt's late row (A-S33);
- mine.length === 0 and no PaymentIntent → the no_payment_intent park (existing);
- otherwise N0-N8.
applyRowTruth changes:
- the pre-image CAS (C9) and the binder check (B9 (b));
- truth 'reverted' → CAS → { status: 'approved', refundId: row.id, refundError: STRIPE_REVERTED_TEXT (G8) } → outcome refund_failed + ALERT-B;
- ALERT-B after stripe_failed and engine_row_dead writes;
- every write that sets status refunded is followed, after count === 1, by recordClaimClosure (H05);
- the 'refunded' outcomes carry evidence 'stripe_read' and amountCents = the Stripe amount.
Deleted: boundElsewhere, otherClaimRows, mayMoveMoney, mayMoveMoneyHere, noRowEverMoved, the unconditional write at 2367-2386 and its ladder, the nothingAtStripe branch at 2394-2410.
Deleted strings (P1-1, P1-4, P1-7, P3-22): « relèvent d’AUTRES réclamations »; « aucun remboursement n’a jamais déplacé d’argent » (claims.ts 2384, AdminFinancialVerification.tsx 136); « aucun remboursement n’a déplacé d’argent » (claim-action-rules.ts 176); « Absence de remboursement PROUVÉE » (AdminClaimsArbitration.tsx 186) — replaced by G8, F14 and F15.
Pin: none of « relèvent d’AUTRES réclamations », « jamais déplacé », « n’a déplacé d’argent », « Absence de remboursement PROUVÉE » exists in lib/, components/ or messages/ (J-M31, J-M42).
IMPLEMENTATION NOTE (W3): landed in lib/claims.ts reconcileClaimEvidence.
- (1) is not reachable until W5 (G1 W3 note).
- (2) is exactly refundId && refundError === null && status ∈ {approved, refunding}.
- (3) reads the rows with the G2 select inside the B12 try. mine > 1 parks. mine === 1 → applyRowTruth('stamped') on refundRowTruth, without absenceIsEvidence, for EVERY pre-image: a reversal writes STRIPE_REVERTED, a 404 or another payment parks, and a settlement carries evidence 'stripe_read' with the Stripe amount. This is needed by the 'reverted' and 'stripe_read' clauses above and by J-M44 (A-S05c-2b). reconcileBoundClaim and attributeClaimRefund keep the temporary boundPathRowTruth until W5. No PaymentIntent parks. Every other admitted pre-image (FV, v13 or legacy proof, lock, safety hold, marker past its grace, stranded, attempted-unrecorded) goes to reconcileNoRowByDerivation (N0-N8); the (i)/(i-b) filter is removed.
- Deleted: the ladder with its sentences, the stripeCashTruthForOrder call from reconcile, boundElsewhere, otherClaimRows, mayMoveMoney, mayMoveMoneyHere, noRowEverMoved and nothingAtStripe (source pins J-M42, J-C14).
- applyRowTruth: the B9 (b) binder count now runs before every settling write, not only on resume_mismatch. ALERT-B follows the stripe_failed writes (at_stripe failed/canceled, and row_terminal failed applied to this claim by reconcileClaimForRefund) and the engine_row_dead write, never a lost CAS (tests/claims-t49-round13-alerts.test.ts).
- recordClaimClosure (H05) does not exist in this tree: the closure record after a refunded CAS, and ER-R29 (where noNoticeSource is passed), land with the closure slice.
IMPLEMENTATION NOTE (W3, round-1 fix): supersedes the previous bullet. lib/claims.ts now carries recordClaimClosure exactly as H05 writes it, and applyRowTruth calls it at H05 site 3 after each refunded write it won: after the at_stripe succeeded CAS (count === 1), and after reconcileClaimForRefund reports its refunded CAS won for THIS claim (row_terminal succeeded). A lost CAS records nothing; a failed record never changes the reconcile outcome. RELEASE GATE: tests/claims-r13-reconcile.test.ts fails when a `status: 'refunded'` write or a reconcileClaimForRefund call in applyRowTruth has no recordClaimClosure before its refunded outcome (negative control: either call removed in memory). Still with the closure slice: H05 sites 1, 2, 4-7, and ER-R29 — site 2 inside reconcileClaimForRefund with noNoticeSource passed by the webhook and recovery callers only, so a reconcile-route settlement (already recorded at site 3, P2002 on the second write) never logs the false EMAIL MISS line.
- Existing tests whose expectations G2 changed cite it: round 7/9/10/11/12, recovery, r13-cas, r13-identity, claim-money-line. Their harnesses now give the loader a paid order, a succeeded PaymentIntent and the royalty read.

### G3 [CORE] loadOrderMoneyFacts: the one read-only loader used by reconcile and T2
lib/claims.ts loadOrderMoneyFacts(orderId, claimId, requestedCents, cache). It never throws: any throw → { readable: false, permanent: null }.
Reads, in order:
1. The order { paymentStatus, stripePaymentIntentId }.
2. The rows (G2 select).
3. franchiseRoyalty.findFirst({ where: { orderId }, select: { status } }) → royaltyStatus, or null.
4. readOrderChargeState(pi): 'no_charge' → { readable: false, permanent: 'no_charge', rows, paymentStatus, piStatus }; 'unreadable' → transient. The ok truth adds chargeId, chargeAmountCents, amountCapturedCents (amount_captured ?? amount), chargeDisputed, piStatus, routed (!!pi.transfer_data), refundedCents, pendingCents.
5. L = loadOrderStripeRefunds with the overCap flag: overCap → permanent 'list_over_cap'; null → transient.
6. refundRowTruth(row, …, { absenceIsEvidence: true }) for every pending and succeeded row; any 'unreadable' → transient.
7. For each standing refund s in L: owners(s) (B3). For each single owner row, binders = claim.findMany({ where: boundToWhere(owner.id, claimId), select: { id, status, refundError, refundId } }). When the owner's reason is claim:Y and Y is not among the binders: claim.findUnique({ where: { id: Y }, select: { status, refundId } }).
Returns ReapprovalFacts:
- orderId, requestedAmountCents, orderPaymentStatus, hasPaymentIntent, piStatus, chargeId, chargeAmountCents, amountCapturedCents, chargeDisputed, amountRefundedCents, routed, royaltyStatus, stripeListLength;
- rows, L, truths, owners, binders, stampedClaims;
- pendingEvidence, rowContradictions, succeededNotCounted, ownerlessFailedRefunds (a failed or canceled refund in L with zero owners).
No ownStampedRowIds field (E5b is deleted). Reconcile and T2 call this loader and the same pure deriveNoRowOutcome; a parity pin runs both on each fixture.
IMPLEMENTATION NOTE (W2): lib/claims.ts loadOrderMoneyFacts is exported and used by T2 in this slice; reconcile moves onto it in W3. An order with no PaymentIntent returns permanent 'no_charge' with hasPaymentIntent false (the engine refuses it at E1, refund.ts 736), and both deriveNoRowOutcome and the C3 (b') clause quote E1 for it. A missing order is transient. A null Order.paymentStatus is read as ''. Step 6 reads succeeded rows too (G4), so the loader fills succeededNotCounted (reverted, absent, other_payment, pending_at_stripe) and rowContradictions; step 7 reads binders with the B1 where and a stamped claim only when it is not a binder and not this claim. Pinned by tests/claims-r13-reconcile.test.ts (J-M43) and tests/claims-r13-identity.test.ts (J-M16).

### G4 [CORE] refundRowTruth: absence as evidence, reversal and not-on-payment
refundRowTruth(row, orderId, cache, anchorPi?, opts?: { absenceIsEvidence?: boolean }).
Failed row → row_terminal failed, with no Stripe read.
Pending row → as today: recorded id → retrieve with the PaymentIntent anchor, otherwise the tag in L. The kinds are at_stripe, absent_within_window { until = createdAt + 21 h }, absent_dead, contradiction, unreadable.
Succeeded row WITH an id → refunds.retrieve(id):
- 404/resource_missing: absenceIsEvidence && L omits the id → not_on_payment { how: 'absent' }; otherwise contradiction « La ligne ${row} est marquée ABOUTIE et enregistre le remboursement Stripe ${id}, que Stripe ne connaît pas avec la clé de ce serveur. Vérifiez que cette clé est celle du compte et du mode (test / live) où il a été créé, puis relancez la réconciliation ; sinon, anomalie de données à instruire. Aucune conclusion tirée. »;
- any other throw → unreadable;
- payment_intent ≠ the order's PI: absenceIsEvidence → not_on_payment { how: 'other_payment' }; otherwise contradiction « Le remboursement Stripe ${id}, enregistré comme ABOUTI sur la ligne ${row}, ne porte pas sur le paiement de cette commande. Anomalie de données à instruire. Aucune conclusion tirée. »;
- succeeded → row_terminal succeeded { refund };
- failed or canceled → reverted { refund };
- pending or requires_action → contradiction « La ligne ${row} est marquée ABOUTIE dans notre base, mais Stripe rapporte son remboursement ${id} « ${status} ». Aucune conclusion tirée. », tagged pendingAtStripe: true.
Succeeded row WITHOUT an id: L null → unreadable; tagged refund in L → the same mapping; not found → absenceIsEvidence ? not_on_payment absent : contradiction.
Only loadOrderMoneyFacts passes absenceIsEvidence. The mine/bound path, attribution, R0 and the recovery sweep never pass it.
IMPLEMENTATION NOTE (W2): refundRowTruth implements the whole mapping and is exported. Three cases the text leaves open are closed fail-safe: a 404 with absenceIsEvidence while the list itself is unreadable → unreadable; absenceIsEvidence with the order PaymentIntent unknown → unreadable; a succeeded row without an id whose tag is absent, without the flag → contradiction « La ligne ${row} est marquée ABOUTIE sans identifiant Stripe enregistré, et aucun remboursement de ce paiement ne porte son étiquette. Aucune conclusion tirée. ». Until W3 wires 'reverted' into applyRowTruth, the round-12 mine / bound / attribution callers go through boundPathRowTruth, which reads a SUCCEEDED row as terminal with no Stripe read (round-12 behaviour) and gives pending rows exactly the G4 reading; none of them passes absenceIsEvidence (AST pin, tests/claims-r13-rowtruth.test.ts). The A-S05b-2 / A-S05c-2b second-reconcile assertions of J-M44 land with W3.
IMPLEMENTATION NOTE (W2, round-1 fix): applyRowTruth handles 'reverted' per G2 (the STRIPE_REVERTED write and ALERT-B) instead of the no-write stripe_unreadable_retry, and a 'refunded' outcome carries evidence 'stripe_read' with the Stripe amount whenever a refund object was read. The resume_mismatch own-row path (B8 (ii)) calls refundRowTruth; boundPathRowTruth remains only for the non-mismatch mine, bound and attribution callers until W3, whose 'refunded' toast says Stripe was not re-read (F14 note). The J-M44 pin now catches every absenceIsEvidence token (any value, a variable or a spread) outside the loader and the two functions that declare the option, and every refundRowTruth call with a 5th argument outside the loader; its negative control also runs through attributeClaimRefund (a 404 row → contradiction park, never not_on_payment). Pinned by tests/claims-r13-rowtruth.test.ts.
IMPLEMENTATION NOTE (W3) [attribution half SUPERSEDED by the W4 note below]: the mine path (G2 (3)) now calls refundRowTruth; boundPathRowTruth remains only for reconcileBoundClaim and attributeClaimRefund until W5. The J-M44 second-reconcile assertions are pinned (tests/claims-r13-rowtruth.test.ts): A-S05b-2 unstamped → E6 + H1 lock with refundId null; A-S05c-2b stamped → the contradiction relabel with the same reason, no alert, never settled.
IMPLEMENTATION NOTE (W4): supersedes the attribution half of the W3 note above. Attribution (attributeWithEvidence, reached from attributeClaimRefund and from adoption) reads refundRowTruth for the row it binds (G12); boundPathRowTruth remains only for reconcileBoundClaim, until W5 (G11).

### G5 [CORE] Engine mirror, holds and verdict (pure, lib/claim-action-rules.ts)
engineRefusalOnReapproval(f) returns the first match, in refund.ts order:
- E1: paymentStatus ∉ {paid, reconcile_manual} or no PI;
- E2: a row that is failed && stripeRefundId;
- E1b: piStatus ≠ succeeded;
- E3: { oldestRowIds (every pending row at the minimum createdAt), evidenceByRow, otherPendingRowIds, engineListTruncated = an oldest row with no id && stripeListLength > 100 };
- E4: chargeAmountCents − amountRefundedCents ≤ 0;
- E5: requested is not an integer, is ≤ 0, or is > refundable;
- E6: `refund:${orderId}:${amountRefundedCents}` equals the idempotencyKey of ANY row, whatever its status (A-S01b).
E1c is never returned: the loader makes no_charge permanent (G6).
pendingEvidence per pending row:
- failed_at_stripe (at_stripe failed/canceled);
- dead (absent_dead);
- within_window (absent_within_window);
- pending_at_stripe;
- succeeded_at_stripe_clawback = at_stripe succeeded && royaltyRefundCents > 0 && royaltyStatus ∈ {settled, settling}, whatever the age (fail closed: the resume clawback may refuse on every call, R-A0-2);
- otherwise succeeded_at_stripe.
reapprovalSafetyHolds(f):
- H1: each succeededNotCounted entry { how: reverted | absent | other_payment | pending_at_stripe };
- H2: routed === true && ownerlessFailedRefunds non-empty (zero owners only: a pending owner is E3 failed_at_stripe, a succeeded owner is H1);
- H3: each rowContradictions entry;
- H5: chargeDisputed === true, or requested > amountCapturedCents − amountRefundedCents.
reapprovalVerdict = no refusal && no holds ? 'payable' : { locked, refusal, holds }.
Parity test (tests/claims-engine-mirror.test.ts): the real executeRefund with mocked Stripe and Prisma on each fixture returns the mirrored status and message. Fixtures:
- E1, E2, E1b, E4, E5, E6 (including a failed row without id holding refund:o:0);
- E3 at 19 h (re-sends create), 20.5 h (409 ResumeIdempotencyExpired) and dead;
- a resume with a settled royalty at 21 h and no tagged reversal → 409, with createReversal called 0 times;
- routed pending failed_at_stripe → E3 and no H2.
IMPLEMENTATION NOTE (W1): ER-M04 resolved — G5 stands: succeeded_at_stripe_clawback is assigned at any age (fail closed). J-M04's negative control must read « a NON-clawback pending row (royaltyRefundCents 0, or royalty not settled|settling) at 1 h is not clawback-locked »; regression pinned in tests/claims-r13-engine-mirror.test.ts (a clawback row created 1 h ago is clawback and never temporary). A pending row whose evidence is missing, contradicted or unreadable is classed 'unclassified' (N6 / N1 decide first; N7 parks it). H2 is computed from L with the B3 ownersOf rule (zero owners), so the owners rule has one implementation.
IMPLEMENTATION NOTE (W2, round-1 fix): H5 captured holds only where the engine would insert its row: requested > amountCapturedCents − amountRefundedCents, AND refundable = chargeAmountCents − amountRefundedCents > 0, AND requested is a positive integer ≤ refundable. On a full capture the old H5 region was exactly E4/E5, where refund.ts refuses before any insert (783-790), so the G8 H5 captured sentence (« enregistrerait sa ligne avant que Stripe refuse ») was false there and A-S38-2 could not park; the E4/E5 refusal speaks instead. Pinned by tests/claims-r13-trigger.test.ts (the E5 lock, and the partial-capture H5 negative control) and tests/claims-r13-fresh-proof.test.ts (J-M20 (2)).

### G6 [CORE] N0-N1: readability, and the closable no-charge proof
N0: facts = loadOrderMoneyFacts. Admitted pre-images: FV, v13 or legacy payable, locks (including AWAITING), SAFETY_HOLD, marker, legacyStranded, attemptedUnrecorded.
N1:
- Transient unreadable: refundedCents unknown or 0 → { ok: true, outcome: 'stripe_unreadable_retry', refundId: null }, no write. > 0 → park refund_moved_unattributed « Stripe rapporte ${r} c remboursés sur ce paiement, mais la liste complète de ses remboursements, ou la lecture d’une ligne de remboursement, n’a pas pu être lue : aucune attribution n’est établie. Relancez « Réconcilier d’après la preuve ». »
- Permanent list_over_cap → park refund_moved_unattributed « Stripe rapporte plus de 1 000 remboursements sur ce paiement : leur liste complète ne peut pas être lue, aucune attribution n’est établie. » (REG-3).
- Permanent no_charge, canonical (no row with a stripeRefundId and no pending row) → the G8 lock write: text 'no_refund_proven_rail_locked: Le paiement Stripe de cette commande n’a pas de charge : aucun remboursement ne peut exister sur ce paiement. MAIS une nouvelle approbation ne paierait pas cette réclamation : ' + the first applicable sentence (E1 sentence; else E1b sentence; else « le moteur refuserait (« Charge introuvable sur le paiement. »). ») + the LOCKED tail. ALERT-B. Outcome no_refund_proven_rail_locked (A-S14b; it replaces the truth-null park for no_charge).
- Permanent no_charge, variant (a row with a stripeRefundId, or a pending row) → park stripe_refund_contradiction « La ligne ${row} enregistre un remboursement alors que le paiement Stripe de cette commande n’a pas de charge. Aucune conclusion tirée. »
Every park goes through enterFinancialVerification with expect = the read pre-image (C9).
IMPLEMENTATION NOTE (W3): N0 admits every pre-image listed above through G2 (3). A transient read with refunded unknown or 0 writes nothing; the round-12 stripe_unreadable park is gone. Refunded > 0 and list_over_cap park. Canonical no_charge writes the G6 lock through the N8 CAS + ALERT-B; the variant parks. Every park carries expect = the read pre-image, pinned on the where clause (tests/claims-r13-rules.test.ts J-M33, tests/claims-r13-reconcile.test.ts J-M43).

### G7 [CORE] N2-N7: pure derivation (deriveNoRowOutcome)
deriveNoRowOutcome(facts, claimId) → { kind: 'park', reason, detail } | { kind: 'proof', prefix, text } | { kind: 'no_write', outcome, until? }. standing = refunds in L with status succeeded, pending or requires_action.
N2: some standing refund is on a charge ≠ chargeId → park stripe_refund_contradiction « Stripe rapporte sur ce paiement ${ids} sur une autre charge que ${chargeId}, la charge dont il compte ${r} c remboursés. Aucune conclusion tirée. »
N3, for each standing s with its owners (B3):
- a failed owner → park stripe_refund_contradiction « La ligne ${row} est ÉCHOUÉE dans notre base, mais Stripe rapporte son remboursement ${s.id} « ${status} ». Aucune conclusion tirée. »
- EXPLAINED iff: exactly one owner; binders of that owner = exactly one claim X, with X.status refunded && X.refundError === null; and stampedClaimId(owner.reason) ∈ {null, X}.
- AM-A5, owner stamped claim:Y with no refunded binder Y, or bound to a refunded X ≠ Y → park refund_moved_unattributed « Le remboursement ${re} (ligne ${row}) porte l’identité de la réclamation ${Y}${Yfound ? `, dont le statut est « ${status} »${YrefundId && YrefundId !== row ? ` et qui est soldée sur une autre ligne (${YrefundId})` : ''}` : ', introuvable'}${X ? ` ; il est lié à la réclamation ${X}` : ''} : cet argent n’est ni attribuable à cette réclamation ni, de façon établie, à une autre. Anomalie à instruire ; aucune conclusion tirée. »
N4: require Σsucceeded(standing) ≤ refundedCents ≤ Σ(standing). Otherwise:
- refundedCents === 0 → park stripe_refund_contradiction « Stripe rapporte ${r} c remboursés sur la charge ${chargeId}, mais la liste complète des remboursements du paiement totalise ${Σsucc} c aboutis et ${Σ} c aboutis ou en attente. Les deux lectures se contredisent ; aucune conclusion tirée. Relancez la réconciliation. »;
- refundedCents > 0 → park refund_moved_unattributed with DETAIL_UNATTRIBUTED.
N5: any standing refund not explained → park refund_moved_unattributed with DETAIL_UNATTRIBUTED = « Des remboursements existent sur cette commande (Stripe : ${r} c remboursés ; liste du paiement : ${Σsucc} c aboutis, ${Σpend} c en attente ; ${n} ligne(s) Refund). Au moins un remboursement (${unexplainedIds}) n’est rattaché ni à l’identité de cette réclamation ni, de façon établie, à une autre réclamation soldée${explained.length ? ' ; rattachés à d’autres réclamations soldées : ' + explainedList : ''}. L’attribution ne peut pas être prouvée. » When a standing pending refund exists, append « Un remboursement de ce paiement est encore en attente chez Stripe : relancez « Réconcilier d’après la preuve » lorsqu’il sera terminal. »
N6: rowContradictions non-empty → park stripe_refund_contradiction with the first detail.
N7: inflight = the standing non-succeeded refunds ∪ pending rows at_stripe pending/requires_action ∪ succeeded rows tagged pendingAtStripe.
- inflight non-empty → park refund_moved_unattributed « Stripe rapporte ${r} c remboursés sur ce paiement ; ${ids} est rattaché à une AUTRE réclamation (${re → claim}) mais encore EN ATTENTE chez Stripe : aucune conclusion pour cette réclamation avant qu’il soit terminal. Relancez alors « Réconcilier d’après la preuve ». »;
- else, any pending row within_window → { kind: 'no_write', outcome: 'unconfirmed_within_window', until: the latest until };
- else, every remaining pending row must be failed_at_stripe, dead, succeeded_at_stripe or succeeded_at_stripe_clawback; otherwise park stripe_refund_contradiction « La ligne ${row} est en attente sans preuve classable ; aucune conclusion tirée. »
N8 (verdict → proof): G8.
IMPLEMENTATION NOTE (W1): deriveNoRowOutcome is pure (lib/claim-action-rules) and also covers G6 N1. A proof outcome carries {prefix, verdict, explained} (or {basis 'no_charge', noChargeStep} for G6); its text is rendered by the G8 writer, because the PAYABLE tail needs proofInstantFor(preImage, now). A standing refund owned by a row stamped for THIS claim returns {no_write, changed_during_read}: the no-row branch no longer applies (the same guard as N8 step 1). AM-A5 says « et qui est soldée sur une autre ligne » only when Y's status is refunded — a refused_final Y holding a refundId is not settled. DETAIL_UNATTRIBUTED reached through N4 with every standing refund explained reads « Au moins un remboursement (non identifié dans la liste) ». explainedList and the N7 map are `${re} → ${claimId}` joined with ', '. ER-M01 disclosed, not changed: N3/N5 fail closed on any standing refund that no settled claim explains, so a first approval on an order carrying a legitimate admin-rail or Dashboard partial refund made for another purpose parks in financial verification with no declaration exit (E-04 founder acceptance list) — a liveness regression versus round 12 that needs founder acceptance.
IMPLEMENTATION NOTE (W1, round-1 fix): N7 — an in-flight refund id that no settled claim explains (a pending row at Stripe whose refund is absent from L by read skew, or a succeeded row tagged pendingAtStripe) is not « rattaché à une AUTRE réclamation »: it parks refund_moved_unattributed with DETAIL_UNATTRIBUTED naming those ids plus the pending sentence (tests/claims-t49-round13-reconcile.test.ts). ER-M01 is now registered in E-04 (see its note).
IMPLEMENTATION NOTE (W3), W1 verifier P3: in N7, an in-flight refund whose row is stamped claim:<this> is never described with DETAIL_UNATTRIBUTED (« n’est rattaché ni à l’identité de cette réclamation »), which would be false. Two cases: a pending row at Stripe pending/requires_action whose refund is absent from L by read skew, and a succeeded row stamped for this claim that Stripe reports pending. Both return {no_write, changed_during_read}, the own-stamp outcome; T2 then writes own_row_exists on that row. Pinned in tests/claims-t49-round13-reconcile.test.ts, with the other-claim negative control.

### G8 [CORE] N8: the proof of absence write and its exact text
Verdict (G5) → prefix: payable → 'no_refund_proven:v13:'; lockIsTemporary (G9) → 'no_refund_proven_rail_locked:awaiting_finalization:'; otherwise 'no_refund_proven_rail_locked:'.
WRITE, in reconcile:
1. refund.count({ where: { orderId, reason: claim:<id> } }) > 0 → { ok: true, outcome: 'changed_during_read' }.
2. updateMany where { id, status, refundError, refundAttempted, refundId } as read → data { status: 'approved', refundAttempted: false, refundId: null, refundError: prefix + ' ' + text }. count ≠ 1 → changed_during_read.
3. After count === 1: ALERT-B (prefix; this covers the payable proof too, per C3).
4. Outcome no_refund_proven | no_refund_proven_awaiting_finalization { rowIds } | no_refund_proven_rail_locked.
TEXT = HEAD + tail.
HEAD_A: « Stripe ne rapporte aujourd’hui aucun remboursement abouti ni en attente sur ce paiement (liste complète lue). »
HEAD_B: « Stripe rapporte ${r} c remboursés sur ce paiement, et chacun de ses remboursements aboutis ou en attente est rattaché à une AUTRE réclamation, soldée sur sa ligne : ${items joined ' ; '}. Aucun n’est rattaché à celle-ci. » item = `${re} (ligne ${row}, réclamation ${X}, ${stamped ? 'identité portée par la ligne' : 'liaison seule'}), ${n} c`.
PAYABLE tail: « Aucune ligne de remboursement de cette commande n’est en attente, et au moment de cette lecture aucune condition de refus du moteur ni aucun blocage de sûreté n’était rempli pour le montant de cette réclamation (${req} c). La réclamation repasse en « approuvée, non payée ». Rien ne la paiera automatiquement : elle devra être approuvée à nouveau par un admin, réclamations et remboursements ouverts ; une vérification relira alors Stripe et nos lignes avant le moteur. Elle est payable au plus tôt le ${proofInstantFor(preImage, now).toISOString()} (UTC). »
LOCKED tail: « MAIS une nouvelle approbation ne paierait pas cette réclamation : » + the refusal sentence, then each hold sentence prefixed « De plus, », then ROUTED when the causes include E2, E3 failed_at_stripe, H1 reverted or H2, then « Rien ne sera payé par le rail pour cette réclamation tant que cet état est enregistré : l’approbation est refusée et le balayage automatique l’ignore. « Réconcilier d’après la preuve » réévalue toutes les conditions ; une cause qui ne dépend d’aucune action ultérieure ne cessera pas. Si elle a été remboursée hors système (Dashboard Stripe), déclarez-le (« Clôturer ce dossier… ») ; sinon clôturez sans paiement. Décision humaine requise. »
AWAITING tail: « MAIS une nouvelle approbation ne paierait pas cette réclamation tant que » + the E3 sentence + « Relancez « Réconcilier d’après la preuve » lorsque cette ligne ne sera plus « en attente » dans notre base : la réconciliation réévaluera alors toutes les conditions. En attendant, rien ne sera payé par le rail pour cette réclamation (approbation refusée, balayage automatique ignoré). Si elle a été remboursée hors système (Dashboard Stripe), déclarez-le (« Clôturer ce dossier… »). »
REFUSAL SENTENCES:
- E1: « le moteur refuse tout remboursement sur cette commande, dont le statut de paiement enregistré est « ${s} » (« Commande non payée — rien à rembourser. »). »
- E2: « la ligne ${ids} est ÉCHOUÉE avec un identifiant Stripe : le moteur refuse tout remboursement sur une commande qui porte une telle ligne, et aucune action des réclamations ne modifie cette ligne. »
- E1b: « le paiement Stripe de cette commande est au statut « ${piStatus} », et le moteur ne rembourse qu’un paiement « succeeded » (« Paiement non débité — rien à rembourser. »). »
- E3 opener: « la plus ancienne ligne en attente de la commande, ${id}${stamp ? ' (identité ' + stamp + ')' : ''}, est reprise par le moteur avant tout nouveau remboursement ». Tie: « les plus anciennes lignes en attente de la commande, créées au même instant (${ids}), sont reprises par le moteur avant tout nouveau remboursement (il prend l’une d’elles) ».
- E3 continuation by evidence:
  - truncated: « ; Stripe rapporte plus de 100 remboursements sur ce paiement et cette ligne n’a pas d’identifiant Stripe enregistré : le moteur refuse alors la reprise (« Reprise impossible pour l’instant (liste Stripe indisponible) — réessayez. ») ; aucun code de l’application ne retire cette ligne. »
  - failed_at_stripe: « ; son remboursement Stripe ${re} a ÉCHOUÉ ou a été annulé : si le moteur la reprend, il la marquera en échec, ce qui verrouille la commande. »
  - dead: « : Stripe ne connaît aucun remboursement pour elle et le moteur ne la créera plus (fenêtre d’idempotence expirée) ; il refuse donc sa reprise (« Reprise impossible : la fenêtre d’idempotence Stripe du remboursement initial a expiré… ») ; aucun code de l’application ne retire cette ligne. »
  - succeeded_at_stripe: « : son remboursement Stripe ${re} est ABOUTI mais la ligne n’est pas finalisée ici ; le moteur finaliserait cette ligne, pas un remboursement de cette réclamation, tant qu’elle reste en attente. »
  - succeeded_at_stripe_clawback: « : son remboursement Stripe ${re} est ABOUTI mais la ligne n’est pas finalisée ici, et sa finalisation doit d’abord reprendre au franchiseur une royalty déjà réglée : le moteur peut la refuser à chaque appel, et la ligne reste alors en attente ; sa finalisation n’est pas établie. »
  - plus « (ligne(s) aussi en attente : ${others}) » when others exist.
- E4: « le paiement est déjà intégralement remboursé chez Stripe (${r} c sur ${a} c) ; le moteur refuserait (« Paiement déjà intégralement remboursé. »). »
- E5: « le montant de cette réclamation (${req} c) dépasse ce qui reste remboursable sur ce paiement (${refundable} c) ; le moteur refuserait (« Montant invalide »). »
- E6: « le moteur calculerait la clé ${key} pour un nouveau remboursement, et la ligne ${rowId} la détient déjà ; il refuserait (« Un remboursement est déjà en cours sur ce montant cumulé. ») tant que le montant remboursé rapporté par Stripe reste ${r} c. »
HOLD SENTENCES:
- H1: « la ligne ${id} est marquée ABOUTIE dans notre base, mais Stripe ne la compte pas sur ce paiement (${how}) ; notre base la compte toujours comme remboursée et aucune action de l’application n’est prévue pour la corriger ; l’approbation est refusée par sûreté (blocage de sûreté, pas un refus du moteur). » ${how}: reverted/pending_at_stripe « son remboursement ${re} est « ${status} » chez Stripe »; absent « son remboursement ${re} est introuvable parmi les remboursements de ce paiement, lus en entier avec la clé qui lit ce paiement »; other_payment « son remboursement ${re} porte sur un autre paiement ».
- H2: « sur ce paiement routé, Stripe rapporte un remboursement « ${status} » (${id}) qui ne correspond à aucune ligne de notre base ; le moteur ne le voit pas, et l’approbation est refusée par sûreté (blocage de sûreté). »
- H3: « la ligne ${row} (« ${rowStatus} » dans notre base) enregistre un remboursement dont la lecture chez Stripe se contredit (${detail}) ; l’approbation est refusée par sûreté (blocage de sûreté). »
- H5 disputed: « Stripe rapporte un litige sur la charge ${chargeId} de ce paiement : Stripe peut refuser le remboursement après que le moteur a enregistré sa ligne, qui resterait alors en attente et bloquerait la reprise sur cette commande ; l’approbation est refusée par sûreté (blocage de sûreté). »
- H5 captured: « le montant de cette réclamation (${req} c) dépasse ce qui reste remboursable sur le montant capturé de ce paiement (${captured − refunded} c) ; le moteur calcule sur le montant de la charge et enregistrerait sa ligne avant que Stripe refuse, ligne qui resterait en attente ; l’approbation est refusée par sûreté (blocage de sûreté). »
ROUTED: routed true → « Ce paiement est routé : un remboursement échoué a pu laisser le transfert du restaurant inversé, et Stripe ne le restaure pas — vérifiez-le dans le Dashboard Stripe. »; false → ''; unknown → « Si ce paiement est routé, un remboursement échoué a pu laisser le transfert du restaurant inversé (Stripe ne le restaure pas) — vérifiez-le dans le Dashboard Stripe. »
STRIPE_REVERTED_TEXT: « stripe_reverted: la ligne ${row} est marquée ABOUTIE dans notre base, mais Stripe rapporte aujourd’hui son remboursement ${id} « ${status} » : il ne verse rien au titre de cette ligne. Notre base la compte toujours comme remboursée ; le webhook laisse ce cas à une révision humaine, sans action automatique. ${ROUTED}Cela ne dit RIEN des autres remboursements de la commande : vérifiez la commande dans Stripe avant tout paiement. Décision admin requise, aucun nouvel essai automatique. »
Every engine quote is pinned verbatim against lib/refund.ts. Copy pins check these exact strings only; they never scan a whole file.
IMPLEMENTATION NOTE (W2): the texts are rendered by pure functions of lib/claim-action-rules (absenceProofText, refusalSentence, e3Sentence, holdSentence, routedSentence, safetyHoldText, noChargeClause, holdsClause); T2 writes the LOCKED and AWAITING texts, the N8 writer (W3) the PAYABLE one. ER-R26 resolved: the clawback continuation reads « sa finalisation peut devoir d’abord reprendre au franchiseur une royalty (si un transfert de règlement existe) ». ER-C24 applied: the failed_at_stripe continuation reads « si le moteur reprend cette ligne, il la marquera en échec » (the round-10 PROMISES pin forbids « la reprend »). A tie renders each oldest row with its own continuation; other pending rows go in the parenthesis before the final period. ER-M07 disclosed, not changed: the AWAITING tail names no mechanism that finalizes the row, and stuck_close stays accepted on AWAITING (D1 row 4), so a row that never finalizes keeps the declaration exit.
IMPLEMENTATION NOTE (W2, round-1 fix): D4 landed with W2 so that the LOCKED, AWAITING and SAFETY_HOLD texts T2 writes are true (« Réconcilier d’après la preuve » réévalue toutes les conditions). reconcileClaimEvidence dispatches every (i)/(i-b) pre-image — approved and unbound, a proof or lock with refundAttempted false, or a safety hold with refundAttempted true — to reconcileNoRowByDerivation after G2 (3)'s mine and no-PaymentIntent checks: loadOrderMoneyFacts, deriveNoRowOutcome, then the G8 WRITE — the stamped re-query (a findFirst, the same test as the count; a throw → the B12 409), the CAS on { id, status, refundAttempted, refundId, refundError } as read, ALERT-B per prefix after count 1, outcomes no_refund_proven { payableFrom } | no_refund_proven_awaiting_finalization { rowIds } | no_refund_proven_rail_locked; a park goes through enterFinancialVerification with the read pre-image; a no_write outcome writes nothing. The round-12 ladder keeps FV, marker, stranded and attempted-unrecorded pre-images until W3 and can no longer rewrite a T2 pre-image into a legacy proof that no approval accepts. RELEASE GATE: a test fails if triggerClaimRefund writes G8 lock or hold texts while reconcileClaimEvidence does not dispatch, before the ladder, to a derivation that calls the loader, deriveNoRowOutcome and absenceProofText. Pinned by tests/claims-r13-reconcile.test.ts (gate, SAFETY_HOLD → v13, reconcile / T2 text parity) and tests/claims-t49-round13-alerts.test.ts (N8 × 3).
IMPLEMENTATION NOTE (W3): the N8 writer now serves every no-row pre-image (G2 note).
- Step 1: the stamped re-query, a findFirst inside the B12 try.
- Step 2: the CAS on { id, status, refundAttempted, refundId, refundError } as read (C9 (d)), setting refundAttempted false and refundId null.
- Step 3: ALERT-B per prefix after count 1, the payable prefix included.
- Outcomes: no_refund_proven { payableFrom = the C4 instant written } | no_refund_proven_awaiting_finalization { rowIds } | no_refund_proven_rail_locked.
- The round-12 ladder's legacy proof writer is deleted, so nothing writes a proof without « payable au plus tôt le ».
- Pinned by tests/claims-t49-round13-copy.test.ts (J-M46) and tests/claims-reconcile-no-money.test.ts (J-M49).
IMPLEMENTATION NOTE (W7): STRIPE_REVERTED_TEXT carries the F16 (3) customer-visibility sentence (« Quand les réclamations sont ouvertes, le client lit « vérification manuelle » ; sinon il ne voit aucune réclamation. ») just before « Cela ne dit RIEN … », as J-M31 requires (the approved claim reads FVc while claims are open). No other word changes. Pinned by tests/claims-exit-copy.test.ts (J-M31 W7) and tests/claims-r13-identity.test.ts.

### G9 [CORE] Temporary versus permanent locks
lockIsTemporary(verdict) = holds empty && refusal is E3 && every oldestRowId's evidence === 'succeeded_at_stripe' (not clawback) && !engineListTruncated. Only this state gets the AWAITING prefix and tail. Its cause can cease: the webhook or an engine resume finalizes a row whose Stripe refund succeeded and which needs no settled-royalty clawback.
Every other lock is written with 'no_refund_proven_rail_locked:' and the LOCKED tail. That tail never says a cause will cease; it says reconcile re-evaluates, and that a cause which depends on no later action will not cease. This covers:
- E2, dead, truncated, failed_at_stripe, clawback;
- H1, H2, H3;
- E1, E1b, E4, E5, E6, H5 (causes that may change only through a later Stripe event).
The approval refusal selects REVISABLE for a claim reconcile admits and PERMANENT otherwise (arbitrationRefusal). G8's copy is the same in both cases.
Neither kind is payable: approve is refused, the sweep skips any refundError (C4), and T1 refuses any non-v13 error.
When a cause has ceased, the only road back to payable is reconcile writing a new v13 proof, with a new instant (C4), and then a gated re-approval that passes T2.
IMPLEMENTATION NOTE (W1): ER-M07 — the AWAITING cause ceases only when the other row is finalized: by the webhook's refund.updated succeeded branch (finalizeRefundRowFromStripe) or by an engine resume (the admin rail, or E3 during a later approval of another claim). No Claims action produces it, and a lost create response may never emit refund.updated. The G8 AWAITING tail stays conditional (« lorsque cette ligne ne sera plus « en attente » ») and D1 row 4 keeps the declaration exit, so the state is neither absorbing nor promised to end.

### G10 [CORE] R0: reversal of a settled claim, detected without a money write
R0 runs for a gate (iii) claim and reads only.
R0a, bound row failed with an id → markClaimsForRevertedRefundRow({ rowId, evidence: { kind: 'failed_row' }, onlyClaimId }).
R0b, bound row pending → t = refundRowTruth(row), without absenceIsEvidence:
- at_stripe failed/canceled → the helper with { kind: 'pending_row_stripe', refund: t.refund }. The row is not touched: no markRefundRowFailed, no key rename.
- at_stripe succeeded, pending or requires_action → { outcome: 'refund_still_standing' }, no write.
- absent_within_window → { outcome: 'unconfirmed_within_window', until }, no write. It uses the existing « Conclusion possible à partir du … » toast, never refund_still_standing.
- unreadable → stripe_unreadable_retry.
- absent_dead or contradiction → { outcome: 'refunded_row_unproven', detail }, no write (legacy only; census refundedRowUnproven).
R0c, bound row succeeded → t = refundRowTruth(row):
- row_terminal succeeded → refund_still_standing;
- reverted → the helper with { kind: 'stripe_object', refund };
- unreadable → retry;
- contradiction → refunded_row_unproven { detail }.
Helper result:
- written → outcome reverted_after_refund, ALERT-B, and recordAdminAudit('claim.reconcile_evidence', { moneyMoved: false });
- not written → changed_during_read;
- failed (a DB call threw) → { ok: false, status: 409, error: 'La base n’a pas pu être lue ou écrite : rien n’est établi. Réessayez.' }.
Toasts:
- reverted_after_refund: « Preuve trouvée : le remboursement lié à cette réclamation soldée est ÉCHOUÉ ou annulé (d’après Stripe, ou d’après notre ligne marquée échouée avec son identifiant Stripe) — il ne verse rien au titre de cette ligne. La réclamation est marquée ; quand les réclamations sont ouvertes, le client lit « vérification manuelle » ; sinon il ne voit aucune réclamation. Le dossier est clôturable sur déclaration (« Clôturer ce dossier… »). »
- refund_still_standing: « Stripe rapporte toujours ce remboursement ABOUTI ou en attente : rien n’a été modifié. »
- refunded_row_unproven: « La ligne liée n’a pas pu être établie chez Stripe (le détail dit pourquoi) : rien n’a été modifié. »
Surfaces for the control (ungated): pending rows on listUnfinalizedClaimRefundRows; failed-with-id rows on listActionableRefundClaims. Caption: « La seule action proposée ici est « Réconcilier d’après la preuve » : elle relit ce remboursement chez Stripe et ne déplace aucun argent. »
A refunded claim on a succeeded row is listed nowhere. R0c is reachable only by POST /api/admin/claims/[id]/reconcile with the claim id: that is REG-7, NOT fail-visible, and needs founder acceptance.
R-D3: no customer e-mail from R0.
Pins: 0 executeRefund calls, 0 Stripe write methods and 0 Refund updates across the R0a/R0b/R0c fixtures.
IMPLEMENTATION NOTE (W5): landed in lib/claims.ts reconcileSettledClaim, reached from reconcileClaimEvidence G2 (1): the bound row is now passed to reconcileRefusal for every claim, so (iii) admits the settled claim on both sides (route and list flags). The outcome table is implemented as written. Readings the text leaves open, closed fail-safe: an at_stripe status that is none of failed / canceled / succeeded / pending / requires_action → refunded_row_unproven « Stripe rapporte le remboursement ${re} de la ligne ${row} au statut « ${s} », non reconnu. Aucune conclusion tirée. »; absent_dead → refunded_row_unproven « Stripe ne connaît aucun remboursement pour la ligne ${row}, et le moteur ne la créera plus (fenêtre d’idempotence expirée le ${windowEnd}). Aucune conclusion tirée. »; a helper that writes nothing (the evidence no longer holds on its fresh read, or a lost CAS) → changed_during_read. refund_still_standing carries stripeStatus and amountCents from the Stripe object read in the same request (ER-C21 resolved). ROUTED is true only when the Stripe refund object carries a transfer_reversal, unknown otherwise; R0a passes unknown. The audit claim.reconcile_evidence {outcome, moneyMoved:false} is the reconcile route's; I-01 (cause reverted_after_refund, registry E-06) follows the won CAS only. ER-M10 (the R0b « census refundedRowUnproven » note) resolved: I-06 refundedRowUnproven is DB-only, and R0's dead / contradiction outcomes are not census counts. Console: the three G10 toasts are rendered from lib/claim-action-rules R0_TOASTS, refund_still_standing split by stripeStatus as F14 says; F14's reverted_after_refund wording (« Stripe rapporte que … ») is not used because R0a's evidence is our failed row, not a Stripe read — the rest of F14 stays with the console slice. Pinned by tests/claims-t49-round13-r0.test.ts (J-M36).
IMPLEMENTATION NOTE (W5 fixer): C9 (f) pinned — an R0a fixture whose refundError changes between the read and the helper's CAS answers 200 changed_during_read, with 0 writes, no I-01 alert and no audit (tests/claims-t49-round13-r0.test.ts).

### G11 [CORE] markClaimsForRevertedRefundRow (claim-only marking)
lib/claims.ts markClaimsForRevertedRefundRow({ rowId, evidence, onlyClaimId? }): Promise<{ claimIds: string[]; written: boolean; failed: boolean }>.
failed = true only when a DB read or write threw (caught inside). It never calls the engine, never writes to Stripe, never writes a Refund row, and sends no customer e-mail (R-D3).
It re-reads the row { status, stripeRefundId, orderId } and the order's PaymentIntent.
Evidence must hold on that fresh read, otherwise nothing is written:
- stripe_object { refund }: row.status 'succeeded' && row.stripeRefundId === refund.id && refund.status ∈ {failed, canceled};
- failed_row: row.status 'failed' && !!row.stripeRefundId;
- pending_row_stripe { refund }: row.status 'pending' && (row.stripeRefundId === refund.id || (!row.stripeRefundId && refund.metadata.grubano_refund_row === row.id)) && refund.payment_intent === the order's PI && refund.status ∈ {failed, canceled}.
Targets: claim.findMany({ where: { refundId: rowId, ...(onlyClaimId ? { id: onlyClaimId } : {}) }, select: { id, status, refundError } }).
- resume_mismatch → skip.
- refunded with refundError null → updateMany where { id, status: 'refunded', refundError: null } → data { refundError: TEXT } (the status is unchanged).
- refunding or approved with refundError null, stripe_object evidence only → updateMany where { id, status, refundError: null } → data { status: 'approved', refundError: STRIPE_REVERTED_TEXT }.
- Anything else → skip.
CUSTOMER = « Quand les réclamations sont ouvertes, le client lit « vérification manuelle » ; sinon il ne voit aucune réclamation. »
TEXT when the row succeeded: « stripe_reverted_after_refund: la réclamation a été soldée sur la ligne ${rowId}, mais Stripe rapporte aujourd’hui son remboursement ${re} « ${status} » : il ne verse rien au titre de cette ligne. Notre ligne reste marquée ABOUTIE (le webhook ne la modifie pas). Vérifiez dans le ledger et la reprise de royalty ce qui a pu être écrit pour cette ligne ; révision humaine. ${ROUTED}${CUSTOMER} Aucune action ici ne déplace d’argent : si le client a été payé autrement (Dashboard Stripe), déclarez-le ; sinon clôturez sans paiement. »
TEXT when the row failed: « stripe_reverted_after_refund: la réclamation a été soldée sur la ligne ${rowId}, mais notre ligne est désormais ÉCHOUÉE avec l’identifiant Stripe ${re} (statut enregistré d’après Stripe : échoué ou annulé) : ce remboursement ne verse rien au titre de cette ligne, et le moteur refuse tout nouveau remboursement sur cette commande tant que cette ligne reste échouée. Vérifiez dans le ledger et la reprise de royalty ce qui a pu être écrit pour cette ligne. ${ROUTED if routed !== false}${CUSTOMER} Aucune action ici ne déplace d’argent : si le client a été payé autrement (Dashboard Stripe), déclarez-le ; sinon clôturez sans paiement. »
TEXT when the row is pending: « stripe_reverted_after_refund: la réclamation a été soldée sur la ligne ${rowId}, encore « en attente » dans notre base, mais Stripe rapporte aujourd’hui son remboursement ${re} « ${status} » : il ne verse rien au titre de cette ligne. Cette action ne modifie pas la ligne : si le moteur la reprend (il reprend la plus ancienne ligne en attente d’une commande avant tout nouveau remboursement), il la marquera en échec, ce qui verrouille la commande. Vérifiez dans le ledger et la reprise de royalty ce qui a pu être écrit pour cette ligne. ${ROUTED}${CUSTOMER} Aucune action ici ne déplace d’argent : si le client a été payé autrement (Dashboard Stripe), déclarez-le ; sinon clôturez sans paiement. »
Callers: R0 (G10); the recovery sweep (G13); the webhook failed/canceled branches, placed after their unchanged money writes, answering 503 when failed is true.
Pins:
- pending_row_stripe leaves the row byte-identical;
- a redelivery after a helper failure marks the claim exactly once;
- a lost CAS returns written false and failed false.
IMPLEMENTATION NOTE (W5): lib/claims.ts markClaimsForRevertedRefundRow, exported, returning exactly { claimIds, written, failed }; the texts are rendered by lib/claim-action-rules reversalMarkerText (the E0 REMOVED pin forbids the identifier `revertedAfterRefund`). Deviations, each consistent with the frozen invariants: (1) the TEXT sentence « si le client a été payé autrement (Dashboard Stripe), déclarez-le » reads « si le client a reçu un paiement par un autre moyen (Dashboard Stripe), déclarez-le » — the same condition; the round-7 FORBIDDEN customer-outcome pin (/le client a été (remboursé|payé)/) matches the frozen wording; (2) the pending variant reads « si le moteur reprend cette ligne (…) » (ER-C24 / F16 note); (3) stripe_object also accepts a SUCCEEDED row with no recorded id whose refund carries grubano_refund_row = the row on the order's PaymentIntent — the identity rule of pending_row_stripe — because R0c reads such a row by its tag (G4) and a proven reversal must not answer changed_during_read; a row that records an id still needs that exact id (the webhook's negative control); (4) the order's PaymentIntent is read only where the evidence needs it (pending_row_stripe, and the tag form of stripe_object). A DB throw after one won CAS still answers failed: the redelivery re-reads the non-null error and writes nothing more. Pinned by tests/claims-t49-round13-reversal.test.ts (J-M40), tests/claims-reconcile-no-money.test.ts (G14 run, every evidence kind) and tests/claims-identity-writers.test.ts (no refundId write).
IMPLEMENTATION NOTE (W5 fixer): regression pins for deviations (1) and (3) — the reworded tail is pinned verbatim with the round-7 FORBIDDEN pattern /le client a été (remboursé|payé)/i it avoids, and stripe_object on an id-less succeeded row is written for this row's tag on the order's PaymentIntent and refused for a tag on pi_OTHER, a tag of another row, or no tag (tests/claims-t49-round13-reversal.test.ts).

### G12 [CORE] Manual reconciliation: attribution reads evidence before any write
attributeClaimRefund:
1. Read the claim and require status FV.
2. Read the row; check its order.
3. B10 refusals.
4. t = refundRowTruth(row), without absenceIsEvidence. Stripe is read BEFORE any claim write (P2-14).
PROVEN = (row pending && t at_stripe succeeded) || (row succeeded && t row_terminal succeeded).
PROVEN → the C6 transaction; success copy:
- row pending before: « Remboursement attribué : Stripe rapporte ce remboursement ABOUTI ; la réclamation reflète désormais ce remboursement réel. La ligne reste « en attente » dans notre base (cette action n’a appliqué ni ligne de ledger ni reprise de royalty). »;
- otherwise: « Remboursement attribué : Stripe confirme ce remboursement ABOUTI ; la réclamation reflète désormais ce remboursement réel. »
NOT PROVEN → 409, no claim write, no audit:
- at_stripe pending/requires_action: « Stripe rapporte le remboursement ${id} de la ligne ${row} EN ATTENTE : rien n’est prouvé, la réclamation n’a pas été modifiée. Réessayez lorsqu’il sera terminal. »
- at_stripe failed/canceled: « Stripe rapporte le remboursement ${id} de la ligne ${row} « ${status} » : cette ligne ne verse rien et ne peut solder aucune réclamation. La réclamation n’a pas été modifiée. « Réconcilier d’après la preuve » tient compte de cette ligne pour toute la commande. »
- reverted: « La ligne ${row} est marquée ABOUTIE ici, mais Stripe rapporte aujourd’hui son remboursement ${id} « ${status} » : il ne solde rien. La réclamation n’a pas été modifiée. »
- contradiction: `${detail} La réclamation n’a pas été modifiée.`
- absent_within_window: « Stripe ne connaît pas encore de remboursement pour la ligne ${row}. La réclamation n’a pas été modifiée. Conclusion possible à partir du ${until} (UTC). »
- absent_dead: « Stripe ne connaît aucun remboursement pour la ligne ${row}, et le moteur ne la créera plus (fenêtre d’idempotence expirée le ${windowEnd}) : elle ne verse rien et ne peut solder aucune réclamation. La réclamation n’a pas été modifiée. »
- unreadable: « Stripe n’a pas pu être lu pour la ligne ${row} : rien n’est conclu, la réclamation n’a pas été modifiée. Réessayez. »
Deleted: the bind-first write (1929-1933), the reconcileBoundClaim call (1958-1970) and the failed-row branch (1971-1973).
The outcome union becomes { ok: true, outcome: 'refunded', refundId, rowStatusBefore, evidence, amountCents } | { ok: false, … }. The console treats only 'refunded' as success and renders body.error for every error (P2 toasts).
Pins:
- P1-5: a pending row with a recorded Stripe id, retrieve → succeeded → refunded; negative control retrieve → pending → 409 and 0 writes;
- the tag path for a pending row without an id;
- P1-6: the bound-elsewhere guard: a binder on another claim → 409; a binder equal to this claim (id: { not }) → not refused.
There is no money authority on these paths: no approve, no refundAttempted reset, no engine call.
IMPLEMENTATION NOTE (W4): landed. The evidence is refundRowTruth on the row it binds (W3 note), never with absence as evidence, read before any write. Two readings the text leaves open are closed fail-safe: an at_stripe status that is neither pending / requires_action nor failed / canceled → « Stripe rapporte le remboursement X de la ligne Y au statut « s », non reconnu : rien n’est prouvé. La réclamation n’a pas été modifiée. »; a reading this path cannot produce (not_on_payment, a failed row the B10 rule already refused) → the unreadable text. The outcome union is { refunded | preview }; the deleted outcomes (refund_failed, still_pending, parks) no longer exist on this path. Pinned by tests/claims-r13-attribution.test.ts (J-M37).
IMPLEMENTATION NOTE (W8): stale prose corrected. The round-11 docblock kept above ClaimAttributionOutcome in lib/claims.ts said the system « reads that row's OWN status and amount and applies it » and that « the outcome comes from the row »; it now says the binding follows Stripe's evidence for the row, read by this request, and binds only a refund Stripe reports succeeded. Prose only. B10's W1 note on the pending-row legend is already marked SUPERSEDED by its W4 note.

### G13 [CORE] Recovery sweep never settles a claim on a reverted refund
recoverStrandedClaimReconciliations (2426-2458) is cron-only and never an exit (R-D8). Its selection is unchanged. For each candidate:
- row failed → reconcileClaimForRefund (as today, with the C9 pre-image).
- row succeeded → t = refundRowTruth(row):
  - row_terminal succeeded → reconcileClaimForRefund (as today);
  - reverted → markClaimsForRevertedRefundRow({ rowId, evidence: { kind: 'stripe_object', refund: t.refund } });
  - unreadable or contradiction → skipped++, details.push(`${claimId}: ${t.kind}`).
- row pending → skipped (as today).
There is no pass over refunded claims.
Pin: a succeeded row whose retrieve returns failed → the claim becomes approved with STRIPE_REVERTED_TEXT, never refunded.

**FREEZE AMENDMENT AMF-1:** « There is no pass over refunded claims » is SUPERSEDED — recoverStrandedClaimReconciliations calls reverifySettledClaimRefunds after its existing pass (see FREEZE NOTES).
IMPLEMENTATION NOTE (W5): landed. The stranded pass (recoverStrandedPass, selection unchanged) re-reads a succeeded row with refundRowTruth (read-only, never absenceIsEvidence) BEFORE reconcileClaimForRefund: row_terminal succeeded → reconcileClaimForRefund (H05 site 2 records the closure with noNoticeSource); reverted → the helper (stripe_object, no onlyClaimId), counted reconciled when it wrote, detail `${claimId}: reverted → approved(stripe_reverted)`; any other truth → skipped with `${claimId}: ${kind}`. recoverStrandedClaimReconciliations(limit, { actor }) then runs reverifySettledClaimRefunds and returns its counts under settledReverify; a failed selection read propagates (POST reconcile-refunds answers 500, never « ok »). The stranded pass's STRIPE_REVERTED write sends no alert: E-02 keeps the declaration exit and I-10 says the sweep is no visibility. J-M48's « the where clause excludes refunded claims » is pinned on the stranded selection; a refunded claim is re-verified only by AMF-1, within its lookback. Pinned by tests/claims-t49-recovery.test.ts (J-M48) and tests/claims-t49-round13-amf1.test.ts.

### G14 [CORE] No reconciliation path can create money authority
Test tests/claims-reconcile-no-money.test.ts. The fixture set covers each G state class: A-S01, S01b, S02, S03, S06a, S07, S10b, S10c, S11, S14b, S19, S21, S22, S31b, S31d, S33-1, S42 and S43.
Run reconcileClaimEvidence, attributeClaimRefund, adoptStripeRefundForClaim, resolveStuckClaim, recoverStrandedClaimReconciliations and markClaimsForRevertedRefundRow. The mocked Stripe client throws on every create / update / cancel / createReversal method.
Assert:
- executeRefund, driveRefund, finalizeRefund and markRefundRowFailed are called 0 times;
- Stripe write methods are called 0 times;
- prisma.refund.update* is called 0 times;
- prisma.refund.create is called only by adoption;
- no write leaves a claim { approved, refundAttempted: false, refundError: null }.
The only way into approved + refundAttempted false is a v13 or lock text written by N8 or T2(e'), or a T2 revert to the pre-image. A payable proof is never written without « payable au plus tôt le ».
Break control: make N8 write refundError null → red.
IMPLEMENTATION NOTE (W3): tests/claims-reconcile-no-money.test.ts covers the 18 state classes with every pre-image the surfaces meet (lock, legacy proof, safety hold, FV, marker, stranded, bound, refunded, recorded failure). Reconcile runs through its route, so its audit is checked; attribution runs on every order row, adoption on every Stripe refund of the payment, resolveStuckClaim on both resolutions, and the recovery sweep once. The Stripe double throws on every write. The call-graph pin walks lib/claims.ts function bodies from reconcileClaimEvidence. markClaimsForRevertedRefundRow (G11) and the closure-notice route (H) do not exist in this tree; they join the run with their slices.

## H. CLOSURE-EMAIL RULES

This section covers every customer claim e-mail: when it is sent, how it is gated, what evidence it rests on, and what is never sent.
- There is no clock, no sweep and no backlog (R-D6, C4).
- Nothing is sent while claims are closed (R-D7) or on a reversal (R-D3).
- Senders live only in lib/claim-emails.ts and are called only from app routes. The Stripe webhook bundle never reaches them.

### H01 [CORE] Inventory of customer claim e-mails
Every claim e-mail is sent through sendTransactional with the dedupe key `claim:<id>`, and only from the send site listed. Format: trigger — templates — send sites and conditions — amount.
- claim_ack — claimEmails.ack.* — app/api/claims/route.ts after create — amount = the requested amount, labelled « montant demandé ».
- claim_decision_accepted — accepted.* — respond/route.ts on accept — no amount.
- claim_decision_refused — refused.* — respond/route.ts on refuse — no amount.
- claim_decision_approved — approved.* — arbitrate/route.ts approve when the outcome is not 'refunded'; claims/route.ts auto 'pending' (flag off) — no amount.
- claim_decision_refunded — two templates:
  - refunded.* engine decision: arbitrate/route.ts approve (H03) and claims/route.ts auto 'refunded'; amount = result.refund.amountCents, which the engine read from Stripe in that call;
  - refundedLinked.* or refundRecorded.* closure notice (H06): reconcile, attribute and closure-notice routes; amount only from Stripe evidence read in that request.
- claim_decision_refused_final — refusedFinal.* (kind refused_confirmed) or the refusedFinal.subject + refusedByGrubano.title/body variant (kind refused_by_grubano) — arbitrate/route.ts refuse_final, and the closure-notice delegate — no amount.
- claim_closed_by_support — closedBySupport.* — resolve-stuck/route.ts, and closure-notice — no amount.
- order_cancelled, dedupe `order:<id>` (not a claim key) — orderCancelledPaid.* / orderCancelledPaidOff.* — app/api/orders/[id]/status/route.ts (H14) — no amount.

The record trigger claim_closure_record (H05) is never sent.

At most two closure notices exist for one claim, in this order only: claim_decision_refunded, then claim_closed_by_support, and only after that claim passed through REVERTED_AFTER_REFUND and was declared (either declaration kind).

### H02 [CORE] CLAIMS_ENABLED skip (R-D7)
sendClaimAckEmail, sendClaimDecisionEmail and sendClaimClosureEmail take a required `claimsOpen: boolean`.

Every call under app/ passes the literal expression `claimsOpen: isClaimsEnabled()`, evaluated immediately before the call.

When claimsOpen is false:
- the sender calls `traceMiss(trigger, claimId, 'claims_disabled')`, which writes one EmailLog row with status 'skipped' and recipient « (non envoyé : claims_disabled) »;
- it returns `{status:'skipped', why:'claims_disabled'}` without calling sendTransactional.

Order inside sendClaimClosureEmail: the closure-record check runs first (H06).

The operator sees toast claims.admin.customerEmail.claimsDisabled (H11) on arbitrate, resolve-stuck, reconcile, attribute and closure-notice. Consumer and restaurant routes show no operator toast; that case is Track B J26, and there is no resend of a non-terminal e-mail.

Test: a source scan flags any sender call without `claimsOpen: isClaimsEnabled()` (control: `claimsOpen: true` is flagged). A unit test proves no sendTransactional call when the flag is false.
IMPLEMENTATION NOTE (W6): landed. Every call under app/ passes `claimsOpen: isClaimsEnabled()` (J-C21 in tests/claims-closure-imports.test.ts scans the call expressions of the 7 calling routes). While claimsOpen is false each claim sender traces one EmailLog row through logEmailSkipped(trigger, `claim ${id}`, context, 'claims_disabled') and returns {status:'skipped', why:'claims_disabled'} before any read (sendClaimClosureEmail after its record check). The operator toast is wired in both consoles for arbitrate, resolve-stuck, reconcile and attribute; the closure-notice control is the console slice's (H10). Pinned by tests/claim-emails.test.ts (J-C20).

### H03 [CORE] Decision e-mail at arbitrate (kind and evidence)
app/api/admin/claims/[id]/arbitrate/route.ts, after a successful arbitrateClaim:
```ts
const refunded = result.refund?.state==='refunded'
const email = await sendClaimDecisionEmail({ claimId:c.id, consumerId:c.consumerId, orderId:c.orderId,
  decision: parsed.data.decision==='refuse_final' ? refusalEmailKind(result.claim as ClaimFacts|null) : (refunded ? 'refunded' : 'approved'),
  reason: parsed.data.reason ?? null, refundedCents: refunded ? result.refund.amountCents : null, claimsOpen: isClaimsEnabled() })
return NextResponse.json({ claim: result.claim, refund: result.refund ?? null, customerEmail: email })
```

'refunded' is sent only when triggerClaimRefund returned state 'refunded'. That state exists only after executeRefund ok, T3 'ours', and a T4 CAS count of 1.

Not a 'refunded' e-mail: attempt_superseded (A-S41), identity_unverified (A-S16), resume_mismatch (A-S15), 202 pending, and every T2 outcome. These send claim_decision_approved (« Grubano a tranché en votre faveur sur la commande {ref}. »), which states only the approval the arbitrate CAS wrote.

claims/route.ts auto path and respond/route.ts: only the claimsOpen argument is added.

lib/claim-emails.ts:
- ClaimDecisionKind adds 'refused_by_grubano'.
- `DECISION_TRIGGER: Record<ClaimDecisionKind,string>` maps refused_by_grubano → 'claim_decision_refused_final' and every other kind → `claim_decision_${kind}`. It is used for the trigger and in every traceMiss.
- The refused_by_grubano variant renders subject refusedFinal.subject, title refusedByGrubano.title and body refusedByGrubano.body, plus « Motif : » when a reason is given.
- ack.next, refused.contest and orderCancelledPaid.next are rendered with { ref }.

Sender return type: `{status: SendStatus|'not_applicable'; why?: ClaimEmailWhy}` with `ClaimEmailWhy = 'claims_disabled'|'no_recipient'|'smtp_disabled'|'refunded_row_unproven'|'refunded_row_failed'|'stripe_not_confirmed'|'claim_not_found'|'no_closure_record'|'not_a_closure'|'sender_error'`.

Mapping from sendTransactional: 'skipped' → smtp_disabled; 'failed' → sender_error.
IMPLEMENTATION NOTE (W6): lib/claim-emails exports ClaimEmailWhy, ClaimEmailResult ({status, why?}), ClosureEmailResult (the same plus kind), ClosureEvidence and DECISION_TRIGGER. sendClaimAckEmail and sendClaimDecisionEmail return ClaimEmailResult: no_recipient, a throw (sender_error), the rail's skipped (smtp_disabled) and failed (sender_error) carry why; sent and duplicate carry none. The two order-cancellation senders keep {status} and take no claimsOpen (H13). arbitrate/route.ts wraps the send (a throw gives customerEmail {failed, sender_error}) and returns customerEmail. Pinned by tests/claim-emails-routes.test.ts (J-C22).

### H04 [CORE] New e-mail templates (claimEmails.*), all 5 locales
refusedByGrubano.title:
- fr « Refusée par Grubano »
- en « Declined by Grubano »
- es « Rechazada por Grubano »
- it « Rifiutata da Grubano »
- ar « رفضتها Grubano »

refusedByGrubano.body:
- fr « Grubano a examiné la réclamation concernant votre commande {ref} et ne l’a pas acceptée. Cette décision est définitive. »
- en « Grubano reviewed the claim concerning your order {ref} and did not accept it. This decision is final. »
- es « Grubano ha examinado la reclamación relativa a su pedido {ref} y no la ha aceptado. Esta decisión es definitiva. »
- it « Grubano ha esaminato il reclamo relativo al Suo ordine {ref} e non lo ha accettato. Questa decisione è definitiva. »
- ar « راجعت Grubano الشكوى المتعلقة بطلبك {ref} ولم تقبلها. هذا القرار نهائي. »

closedBySupport.subject:
- fr « Réclamation {ref} : dossier clôturé par notre équipe »
- en « Claim {ref}: case closed by our team »
- es « Reclamación {ref}: expediente cerrado por nuestro equipo »
- it « Reclamo {ref}: pratica chiusa dal nostro team »
- ar « الشكوى {ref}: أغلق فريقنا الملف »

closedBySupport.title:
- fr « Dossier clôturé »
- en « Case closed »
- es « Expediente cerrado »
- it « Pratica chiusa »
- ar « تم إغلاق الملف »

closedBySupport.body:
- fr « Notre équipe a clôturé la réclamation concernant votre commande {ref}. Cette réclamation n’est plus en cours de traitement. »
- en « Our team has closed the claim concerning your order {ref}. This claim is no longer being processed. »
- es « Nuestro equipo ha cerrado la reclamación relativa a su pedido {ref}. Esta reclamación ya no está en trámite. »
- it « Il nostro team ha chiuso il reclamo relativo al Suo ordine {ref}. Questo reclamo non è più in lavorazione. »
- ar « أغلق فريقنا الشكوى المتعلقة بطلبك {ref}. لم تعد هذه الشكوى قيد المعالجة. »

closedBySupport.next:
- fr « Pour toute question, répondez à cet e-mail ou écrivez à contact@grubano.com en indiquant la référence {ref}. »
- en « If you have any questions, reply to this email or write to contact@grubano.com, quoting reference {ref}. »
- es « Si tiene alguna pregunta, responda a este correo o escriba a contact@grubano.com indicando la referencia {ref}. »
- it « Per qualsiasi domanda, risponda a questa email o scriva a contact@grubano.com indicando il riferimento {ref}. »
- ar « لأي استفسار، رُدّ على هذه الرسالة أو راسلنا على contact@grubano.com مع ذكر المرجع {ref}. »

refundedLinked.body (subject and title reuse refunded.subject and refunded.title):
- fr « Un remboursement de {euros} a été émis vers le moyen de paiement utilisé pour votre commande {ref}, et rattaché à cette réclamation. »
- en « A refund of {euros} has been issued to the payment method used for your order {ref}, and linked to this claim. »
- es « Se ha emitido un reembolso de {euros} al método de pago utilizado para su pedido {ref}, vinculado a esta reclamación. »
- it « È stato emesso un rimborso di {euros} verso il metodo di pagamento utilizzato per il Suo ordine {ref}, collegato a questo reclamo. »
- ar « تم إصدار استرداد بقيمة {euros} إلى وسيلة الدفع المستخدمة في طلبك {ref}، وتم ربطه بهذه الشكوى. »

refundedLinked.next:
- fr « Pour toute question sur ce remboursement, répondez à cet e-mail en indiquant la référence {ref}. »
- en « If you have any questions about this refund, reply to this email quoting reference {ref}. »
- es « Si tiene alguna pregunta sobre este reembolso, responda a este correo indicando la referencia {ref}. »
- it « Per qualsiasi domanda su questo rimborso, risponda a questa email indicando il riferimento {ref}. »
- ar « لأي استفسار بخصوص هذا الاسترداد، رُدّ على هذه الرسالة مع ذكر المرجع {ref}. »

refundRecorded.subject:
- fr « Réclamation {ref} : remboursement rattaché »
- en « Claim {ref}: refund linked »
- es « Reclamación {ref}: reembolso vinculado »
- it « Reclamo {ref}: rimborso collegato »
- ar « الشكوى {ref}: تم ربط الاسترداد »

refundRecorded.title:
- fr « Remboursement rattaché »
- en « Refund linked »
- es « Reembolso vinculado »
- it « Rimborso collegato »
- ar « تم ربط الاسترداد »

refundRecorded.body:
- fr « La réclamation concernant votre commande {ref} a été clôturée : elle est rattachée à un remboursement enregistré dans nos registres. »
- en « The claim concerning your order {ref} has been closed: it is linked to a refund recorded in our records. »
- es « La reclamación relativa a su pedido {ref} se ha cerrado: está vinculada a un reembolso registrado en nuestros registros. »
- it « Il reclamo relativo al Suo ordine {ref} è stato chiuso: è collegato a un rimborso registrato nei nostri archivi. »
- ar « تم إغلاق الشكوى المتعلقة بطلبك {ref}: وهي مرتبطة باسترداد مسجَّل في سجلاتنا. »

refundRecorded.next:
- fr « Si ce remboursement n’apparaît pas sur votre relevé, répondez à cet e-mail en indiquant la référence {ref}. »
- en « If this refund does not appear on your statement, reply to this email quoting reference {ref}. »
- es « Si este reembolso no aparece en su extracto, responda a este correo indicando la referencia {ref}. »
- it « Se questo rimborso non compare sul Suo estratto conto, risponda a questa email indicando il riferimento {ref}. »
- ar « إذا لم يظهر هذا الاسترداد في كشف حسابك، رُدّ على هذه الرسالة مع ذكر المرجع {ref}. »

No declaration template carries a refund or no-refund sentence, an amount, or the operator note (R-D4). There is no closedBySupport.noPayment key and no settledBySupport.* key.

### H05 [CORE] Closure record: this build's proof of closure, with no clock (C4)
lib/claim-action-rules.ts exports:
- `CLOSURE_RECORD_TRIGGER = 'claim_closure_record'`
- `closureRecordKey = (id: string) => `claim:${id}``
lib/claims.ts adds the internal recordClaimClosure. It never throws:
```ts
async function recordClaimClosure(claimId: string, opts?: { noNoticeSource?: true }): Promise<boolean> {
  let ok = false
  try { await prisma.emailDispatch.create({ data: { trigger: CLOSURE_RECORD_TRIGGER, dedupeKey: closureRecordKey(claimId) } }); ok = true }
  catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') ok = true
    else console.error('[EMAIL MISS] [claim_closure_record] claim ' + claimId + ' — record NOT written: no closure notice can be sent for it')
  }
  if (ok && opts?.noNoticeSource) console.error('[EMAIL MISS] [claim_decision_refunded] claim ' + claimId + ' settled by the Stripe webhook or the recovery sweep: no customer notice is sent from this path — it appears in « Avis client non envoyés » while no refunded notice is recorded')
  return ok
}
```
Call it only after a closure CAS matched 1 row, outside any transaction, at exactly these sites:
1. triggerClaimRefund T4 'ours' success to refunded (C5 item 3);
2. reconcileClaimForRefund, each CAS that sets status refunded, with { noNoticeSource: true } (webhook and recovery sweep);
3. applyRowTruth, each write that sets status refunded (row_terminal succeeded, at_stripe succeeded);
4. attributeWithEvidence, after the observed commit of its C6 transaction (row attribution and adoption);
5. attributeWithEvidence's C7 re-read branch (status ∈ {refunded, refused_final} && refundId === row.id);
6. arbitrateClaim refuse_final;
7. resolveStuckClaim settled_out_of_band and closed_no_payment, including the DECLARED_AFTER_REVERT and refunded + REVERTED declarations.
Rules:
- THE record is the only closure-notice eligibility source (D10). AdminAuditLog is never one: HEAD already writes claim.arbitrate, claim.resolve_stuck, claim.attribute_refund and claim.adopt_stripe_refund rows for legacy closures, and recordAdminAudit returns false while ADMIN_AUDIT_ENABLED is off.
- Nothing else writes, sends or deletes that trigger. sendTransactional deletes only the failed send's own (trigger, dedupeKey) (transactional-emails.ts 181), so the record survives a failed notice. scripts/server/clean-room.js wipes EmailDispatch together with claims (full data wipe, out of scope).
- A record failure never changes the caller's return value, except C7's operator text, which says the notice cannot be sent.
- A claim closed, reverted, then declared keeps its first record (P2002); the declaration is also a closure by this build.
- No deploy-epoch constant. Legacy closures have no record; they are never listed and never sent (E-18).
- Schema unchanged: EmailDispatch (id, trigger, dedupeKey, createdAt, @@unique([trigger, dedupeKey])). Only Prisma; lib/claims imports only the two constants from lib/claim-action-rules (H15).
Pin: J-C23.
IMPLEMENTATION NOTE (W6): all seven sites are wired. W6 adds (1) triggerClaimRefund after the T4 'ours' refunded CAS and (6) arbitrateClaim refuse_final after its CAS. (2) is reconcileClaimForRefund with noNoticeSource unless the caller passes closureRecordedByCaller (ER-R29, resolved in W5 in the inverted form so the webhook call stays byte-identical; applyRowTruth passes it and logs nothing). (3) applyRowTruth (W3); (4) and (5) attributeWithEvidence and its C7 helper bindingNotObserved (W4); (7) resolveStuckClaim (W5). tests/claim-closure-record.test.ts (J-C23) pins the call-site map by top-level function (bindingNotObserved names site 5), no call inside any $transaction callback, no writer, sender or deleter of the trigger elsewhere in lib/, app/, scripts/ or components/ (scripts/server/phase2-claims-gate.js only reads it), and the P2002 / error behaviour with the caller's return unchanged. ER-R28 was resolved at the freeze (AMF-2); J-M38 pins that an audit row never makes a claim eligible.
IMPLEMENTATION NOTE (W6 fixer) on H05 site 2 / ER-R29: the caller's opt-out is scoped to one claim. reconcileClaimForRefund takes `closureRecordedFor?: string` (was `closureRecordedByCaller?: true`) and skips its own record only when that id equals the claim it settles; applyRowTruth passes its own claim.id. Any other claim the reconciler settles on the row (the « appliquée à une autre réclamation » branch of applyRowTruth, latent under the reconcile gate) still writes its record with noNoticeSource, so no closure by this build is left without a record. The console line of that case names the webhook or the recovery sweep although the reconcile route reached site 2; the operator signal for it is applyRowTruth's financial_verification park of the caller's claim. Pinned by tests/claim-closure-record.test.ts (the second-bound-claim regression and its negative control; break/restore: reverting to a boolean opt-out turns the regression red).
IMPLEMENTATION NOTE (W8) on H05 site 2: the noNoticeSource console line no longer names only the webhook or the recovery sweep. It reads « [EMAIL MISS] [claim_decision_refunded] claim <id> settled on its refund row by a path that sends no customer notice (the Stripe webhook, the recovery sweep, or a reconciliation run for another claim bound to the same row) — it appears in « Avis client non envoyés » while no refunded notice is recorded », which is also true in the applyRowTruth case of the W6 fixer note: the reconcile route runs for claim A, reconcileClaimForRefund settles claim B on the shared row and logs the line for B, and A is parked in financial_verification, not settled (W8 fixer: the W8 wording « a reconciliation that settled another claim » described A as settled and is corrected in lib/claims.ts and docs/ops/REFUND-FINANCIAL-CONTRACT.md §25). Log wording only; tests/claim-closure-record.test.ts and tests/claims-closure-webhook.test.ts pin the new prefix.

### H06 [CORE] sendClaimClosureEmail: check order and evidence
lib/claim-emails.ts: `export type ClosureEvidence = { basis:'stripe_read'; amountCents:number }`.

`sendClaimClosureEmail(p:{claimId; evidence?: ClosureEvidence; claimsOpen: boolean}): Promise<{status: SendStatus|'not_applicable'; kind: ClosureKind|null; why?: ClaimEmailWhy}>`

It receives only an id, server-produced evidence and the gate. It never receives an operator amount, outcome or note. Steps, in order:
1. claim.findUnique selecting id, status, consumerId, orderId, refundId, refundError, arbitrationDecision, restaurantResponse, arbitrationReason. Missing → traceMiss 'claim_not_found', return skipped.
2. kind = claimClosureKind. null → `{status:'not_applicable', why:'not_a_closure'}`. This covers REVERTED_AFTER_REFUND.
3. emailDispatch.findFirst for the record. Absent → traceMiss(CLOSURE_TRIGGER[kind], 'no_closure_record'), return skipped.
4. !claimsOpen → 'claims_disabled'.
5. Refusal kinds → delegate to sendClaimDecisionEmail({decision: refusalEmailKind(c), reason: c.arbitrationReason ?? null, claimsOpen}).
6. kind 'refunded' → read row {orderId,status,amountCents,stripeRefundId}.
   - status 'failed' → 'refunded_row_failed'.
   - Otherwise, !refundedRowProven → 'refunded_row_unproven'.
   - Also count binders as in F03; ≥2 → 'refunded_row_unproven'.
7. kind 'refunded' → evidence must be basis 'stripe_read' with an integer amountCents > 0, else 'stripe_not_confirmed'.
   - amountCents === row.amountCents → refunded.subject/title + refundedLinked.body/next with {euros}.
   - Otherwise → refundRecorded.*, with no amount.
8. resolveConsumer; none → 'no_recipient'.
9. Declaration kinds → closedBySupport.*.
10. sendTransactional({trigger: CLOSURE_TRIGGER[kind], dedupeKey: `claim:${id}`}). 'skipped' → why smtp_disabled; 'failed' → sender_error. For these two, the sender only logs a console line.

The outer catch traces sender_error and returns failed.

Evidence sources (Stripe object read in that same request, never row.amountCents):
- reconcile outcome 'refunded' with evidence 'stripe_read': at_stripe s.amount, or row_terminal retrieved refund.amount;
- attribution/adoption outcome 'refunded': s.amount;
- closure-notice (H08): refund_still_standing with stripeStatus 'succeeded' and amountCents.
An outcome with evidence 'ledger_row', or none, → stripe_not_confirmed.

Section E must extend refund_still_standing with stripeStatus and amountCents. Without that extension, the resend fails closed.
IMPLEMENTATION NOTE (W6): landed in lib/claim-emails.ts. (1) Step 6 counts the binders before the failed-row check: a row with two or more binders (A-S43) answers refunded_row_unproven whatever its status, so the sender agrees with refundedRowTruth, where the customer reads the manual review (the J-C25 parity; ER-C22's binder half). Both answers map to the rowUnproven toast. The binder where is F03's (refundError null OR NOT startsWith 'resume_mismatch'), restated in the module because lib/claim-emails may not import lib/claims (H15). (2) A claim that is not a closure returns not_applicable and writes no EmailLog row; a claim whose read throws traces sender_error under the tag claim_closure_notice (its kind is unknown). (3) ER-C21: refund_still_standing already carries stripeStatus and amountCents (W5). Pinned by tests/claims-closure-emails.test.ts (J-C24, J-C25, J-C44).

### H07 [CORE] Closure send sites
Each site runs after the route's own success and audit, inside `try { customerEmail = await sendClaimClosureEmail(...) } catch {}`. It never changes the HTTP status. The response adds `customerEmail`.
- resolve-stuck/route.ts: after recordAdminAudit, `sendClaimClosureEmail({claimId, claimsOpen: isClaimsEnabled()})`. parsed.data.reason reaches only recordAdminAudit.
- reconcile/route.ts: only when result.outcome==='refunded', with `evidence: result.evidence==='stripe_read' ? {basis:'stripe_read', amountCents: result.amountCents} : undefined`. Any other outcome sends nothing, including reverted_after_refund, the proofs and the parks.
- attribute/route.ts: the adopt branch and the row branch, only when !dryRun and outcome==='refunded', with evidence from result.evidence and result.amountCents. Previews, refusals, lost races (A-S42) and the mirror-written 409 (A-S34) send nothing.
- arbitrate/route.ts: H03. Its refuse_final e-mail is the closure notice of kinds refused_confirmed and refused_by_grubano.

Operator console: after each success, `const e = customerEmailLine(body.customerEmail); if (e) toast[e.tone](…)`.
- AdminClaimsArbitration uses t(`admin.customerEmail.${e.key}`).
- AdminFinancialVerification uses CUSTOMER_EMAIL_FR[e.key].
IMPLEMENTATION NOTE (W6): landed. resolve-stuck, reconcile and attribute (row and adopt branches) return customerEmail, null where no attempt is made; a sender throw is reported as {status:'failed', kind:null, why:'sender_error'} and never changes the HTTP status. Console: AdminClaimsArbitration toasts t(`admin.customerEmail.${key}`) after a decision and after a declaration; AdminFinancialVerification toasts CUSTOMER_EMAIL_FR[key] after reconcile, attribute, adopt and a declaration. Pinned by tests/claims-t49-routes.test.ts and tests/claims-resolve-stuck-route.test.ts (J-C26) and tests/claim-emails-routes-closure.test.ts (J-M38).

### H08 [CORE] Per-claim resend: POST /api/admin/claims/[id]/closure-notice (NEW)
The route is NOT gated by CLAIMS_ENABLED; the sender enforces R-D7. Steps:
1. resolveAdmin, else 403. Then `rateLimit(req,'admin_claims_closure_notice',{limitDefault:30,windowDefault:60})`.
2. Body `z.object({}).strict()`, else 400.
3. Read the claim. Missing → 404. claimClosureKind null → 409 « Cette réclamation n’appelle pas d’avis de clôture (son état a changé) — rechargez la liste. »
4. Kind 'refunded' → `const ev = await reconcileClaimEvidence({claimId, adminId})`. This is Section A R0: read-only at Stripe, no engine, no Refund write.
   - refund_still_standing with stripeStatus 'succeeded' and an integer amountCents > 0 → evidence {stripe_read, amountCents}.
   - reverted_after_refund → 409 « Aucun avis envoyé : Stripe rapporte que le remboursement lié a échoué ou a été annulé. La réclamation vient d’être marquée et apparaît dans « Vérification financière requise ». Quand les réclamations sont ouvertes, le client lit « vérification manuelle » ; sinon il ne voit aucune réclamation. »
   - changed_during_read → 409 « La réclamation a changé pendant la lecture : aucun avis envoyé. Rechargez la liste. »
   - Anything else → evidence undefined.
5. `sendClaimClosureEmail({claimId, evidence, claimsOpen: isClaimsEnabled()})`.
6. recordAdminAudit({action:'claim.closure_notice', targetType:'claim', targetId, metadata:{status, why, kind, moneyMoved:false}}).
7. 200 {customerEmail}.

Imports from lib/claims: only isClaimsEnabled and reconcileClaimEvidence. Never executeRefund. A guard test pins this.

This resend is the only path for a closure whose notice was not dispatched. It covers what A-S31e cannot: a stale refunded claim is marked (409) and no notice goes out.
IMPLEMENTATION NOTE (W6): landed as app/api/admin/claims/[id]/closure-notice/route.ts. (1) Step 3 reads the claim through prisma (a read only) to answer 404 or 409 before any Stripe read; beyond its guards and that read the route calls only reconcileClaimEvidence, sendClaimClosureEmail and recordAdminAudit. (2) reconcileClaimEvidence takes {claimId}: no adminId parameter exists. (3) A missing body and `{}` are both accepted; a non-JSON body or any field answers 400. (4) The reverted_after_refund marking written by the R0 read is audited as claim.reconcile_evidence {outcome, moneyMoved:false, via:'closure_notice'}, the same trail as the reconcile route, then 409; a 409 writes no claim.closure_notice audit. Pinned by tests/claims-closure-notice-route.test.ts (J-C27), tests/claims-reconcile-no-money.test.ts (the route joins the G14 run) and tests/claim-emails-routes-closure.test.ts (J-M38).

### H09 [CORE] What is never sent
No customer e-mail is sent from any of these:
- (1) the Stripe webhook, including reconcileClaimForRefund settlement, markClaimsForRevertedRefundRow and the 503 redelivery (R-D3, R-D8);
- (2) recoverStrandedClaimReconciliations and app/api/admin/claims/reconcile-refunds/route.ts;
- (3) any cron, script or scripts/server/phase2-claims-gate.js;
- (4) a reversal after settlement, whatever writes the marker (webhook helper, R0a/R0b/R0c, closure-notice step 4). The customer status becomes financial_verification (F05 line 7), and an earlier notice is not corrected;
- (5) non-terminal money states: FV entry or relabel, v13, locked or AWAITING proofs, SAFETY_HOLD, T2 reverts and parks, identity_unverified, resume_mismatch, attempt_superseded, ambiguous_binding, still_pending, unconfirmed_within_window;
- (6) a closure without a closure record (legacy: no backlog, R-D6(d));
- (7) anything while claimsOpen is false;
- (8) a resend of a non-terminal e-mail (ack, accepted, refused, approved). closure-notice answers 409;
- (9) an automatic closure-notice sweep. None exists anywhere.

Test: the import walk of H16, plus a spy on sendTransactional across the webhook and reconcile-refunds suites showing no claim trigger.

### H10 [CORE] Missing-notice list and the operator console sections
lib/claim-emails.ts gets the read-only `listMissingClaimClosureNotices()`:
- Page emailDispatch.findMany where trigger = CLOSURE_RECORD_TRIGGER, ordered [{createdAt:'desc'},{id:'desc'}], with an id cursor (skip 1), 500 per page. Stop at 5000 scanned and set scanTruncated.
- Take claims from the dedupeKey (claim.findMany {id in}) and keep those with claimClosureKind not null.
- Drop claims that have an emailDispatch row for (CLOSURE_TRIGGER[kind], claim:<id>).
- For 'refunded', read the bound rows in one findMany and set blocker:
  - 'refunded_row_failed' when row.status==='failed';
  - else 'refunded_row_unproven' when !refundedRowProven;
  - else null.
- Return `{items:[{claimId, orderId, kind, decidedAt, blocker}] (first 200, decidedAt desc), total, scanTruncated}`.

lib/claims.ts gets `listRefundedClaimsWithUnprovenRow()`: claims that are refunded with refundError null and !refundedRowProven, EXCLUDING a row with status 'failed' and a stripeRefundId (that claim is in the FV card otherUnsettled, A-S31c). reconcilable = reconcileRefusal(facts with boundRow) === null.

financial-verification/route.ts runs both lists after its money Promise.all, each in its own catch → {error:'unreadable'}. counts gains closureNoticesMissing and refundedUnproven (number or null), both outside `total`.

The red heading « Vérification financière requise (n) » renders only for claim rows or unfinalized rows.

Section A — heading « Réclamations remboursées dont la ligne liée n’est pas établie ({total}{+}) », amber.
- Text: « La réclamation est clôturée « remboursée », mais sa ligne liée est absente, porte sur une autre commande, est échouée sans identifiant Stripe, ou n’a pas de montant exploitable. Quand les réclamations sont ouvertes, le client lit « Remboursement non confirmé par nos registres ». Aucune action ici ne déplace d’argent. »
- When reconcilable: button « Réconcilier d’après la preuve » with caption « relit ce remboursement chez Stripe, sans rien y écrire ». Otherwise « Aucune action de l’application : vérifiez la commande dans Stripe. »

Section B — heading « Avis client non envoyés ({total}{+}) ».
- Intro, as Track B I3: « Ces réclamations ont été clôturées par cette version de l’application (remboursées, refusées ou clôturées sur déclaration), et aucun e-mail correspondant n’est enregistré comme envoyé au client : envoi en échec, e-mails désactivés, client sans adresse, réclamations fermées au moment de la clôture, relecture Stripe non concluante, ou réclamation soldée automatiquement (webhook Stripe ou récupération), qui n’envoie aucun e-mail. Les clôtures antérieures à cette version ne sont pas listées et ne recevront aucun avis. Envoyer l’avis n’agit sur aucun argent ; son contenu est tiré de la base, jamais de votre saisie. Pour une réclamation remboursée, le serveur relit d’abord le remboursement chez Stripe (sans rien y écrire) et n’envoie l’avis que si Stripe le rapporte abouti ; s’il rapporte un échec, la réclamation est marquée à la place. Rien n’est envoyé tant que les réclamations sont fermées. »
- Kind labels: « Remboursée », « Clôturée sur déclaration », « Refus confirmé », « Refusée par Grubano ».
- Button « Envoyer l’avis au client », disabled when a blocker is set, with a line per blocker:
  - refunded_row_unproven: « Non envoyable : la ligne de remboursement liée n’est pas établie (voir « Réclamations remboursées dont la ligne liée n’est pas établie »). »
  - refunded_row_failed: « Non envoyable : la ligne de remboursement liée est ÉCHOUÉE (voir « Vérification financière requise », où « Réconcilier d’après la preuve » la relit). »

Both sections: scanTruncated « Liste incomplète : plus de 5000 … ont été parcourues. »; {error} « Liste illisible pour l’instant — rechargez. »

Known residuals, stated in docs:
- a dispatch row left by a crash mid-send hides the claim (the resend answers duplicate);
- a record-write failure makes the claim unsendable (it is counted, H17).
IMPLEMENTATION NOTE (W7): landed. (1) ER-C17: listMissingClaimClosureNotices lives in lib/claim-closure-lists.ts (prisma and the pure rules only), so the importers of lib/claim-emails stay the 8 H15 routes; a census parity test runs it and lib/claims-census closure.missing on one fixture. (2) ER-C22: blockers follow the sender’s order — two or more binders → refunded_row_ambiguous, whose line « Non envoyable : la ligne de remboursement liée est liée à plusieurs réclamations — rien ne peut être annoncé au client pour aucune d’elles. Aucune action de l’application ne la rattache : vérifiez la commande dans Stripe. » names no section; refunded_row_failed only for a failed row WITH a Stripe id on the claim’s own order (the A-S31c row the card lists); any other unproven row → refunded_row_unproven (listed in section A); H11 rowUnproven names the multi-binder cause (H11 note). (3) listRefundedClaimsWithUnprovenRow excludes a failed row with a Stripe id on the claim’s own order AND a row with two or more binders (those claims read the manual review, not RUc, so the section text would be false for them; E-12 stays visible through rowsBoundToMultipleClaims and the ambiguous blocker); it reads settled claims in pages of 500 up to 5000 scanned and returns {items (first 200), total, scanTruncated}. (4) An unreadable list renders its section (count « ? ») with « Liste illisible pour l’instant — rechargez. », and counts as visible (fail visible). (5) ER-C18: the intro is H10’s text. (6) The truncation lines read « Liste incomplète : plus de 5000 réclamations remboursées ont été parcourues. » and « Liste incomplète : plus de 5000 clôtures enregistrées ont été parcourues. ». (7) F16 (3) / J-C14: section A’s sentence « Quand les réclamations sont ouvertes, le client lit « Remboursement non confirmé par nos registres ». » is the one other visibility sentence the scan accepts (it names what those claims read, F05 line 9). Pinned by tests/claim-closure-lists.test.ts, tests/claims-closure-ui.test.ts, tests/claims-t49-routes.test.ts and tests/claims-registry-visibility.test.ts.
IMPLEMENTATION NOTE (W7 fixer) on H10: (1) correction of W7 note (2) — the blockers do not follow the sender’s order. closureNoticeBlocker is non-null exactly when H06 step 6 refuses (two or more binders, a failed row, or !refundedRowProven), but its VALUE follows the section that lists the claim: the sender answers refunded_row_failed for any failed row, while the blocker answers refunded_row_unproven for a failed row without a Stripe id or on another order (section A lists both shapes); both values block the button and map to the rowUnproven toast. Pinned by the step-6 parity test in tests/claim-closure-lists.test.ts. (2) ER-C22, second half: listRefundedClaimsWithUnprovenRow carries a same-order row whose status is none of succeeded, pending or failed (no writer produces one), so the section A text gains « a un statut inconnu, »: « La réclamation est clôturée « remboursée », mais sa ligne liée est absente, porte sur une autre commande, est échouée sans identifiant Stripe, a un statut inconnu, ou n’a pas de montant exploitable. Quand les réclamations sont ouvertes, le client lit « Remboursement non confirmé par nos registres ». Aucune action ici ne déplace d’argent. » (3) Paging: the unproven list pages with an id cursor (skip 1), as the notice list does, so a claim leaving {refunded, refundError null} between two pages hides no later claim. (4) A section whose items are fewer than its total (the 200 cap) says « N premières affichées sur T (les plus anciennes | les plus récemment clôturées) — les autres sont comptées dans le titre mais ne sont pas listées ici. ». Residual: the refunded_row_unproven blocker line names section A for a claim that section A counts but may not list past its first 200 (the capped line says so). (5) getClaimEligibility counts binders by refundId even when the row is missing (ER-C22: a missing row shared by two claims now reads FVc on the help page, as in listConsumerClaims, the sender and the H10 lists). Pinned by tests/claim-closure-lists.test.ts, tests/claims-closure-ui.test.ts and tests/claims-eligibility-stripe-truth.test.ts (J-C05).
IMPLEMENTATION NOTE (W8) on H10: correction of the W7 fixer note (3). The id cursor with skip: 1 does not guarantee that no later claim is hidden. When the claim that ended a page leaves {refunded, refundError null} before the next page is read, Prisma still places the next page after that claim's position, and skip: 1 then skips the first matching claim instead of the cursor row: that one claim is neither listed nor counted in that load (the total can be one short per such event), and the next load lists it. Stated as a residual in docs/ops/REFUND-FINANCIAL-CONTRACT.md §25; no money moves from it and no code is changed. listMissingClaimClosureNotices has no such residual (a claim_closure_record row never leaves its filter). §25 also records the W7 deviations: the AMF-1 button at the top of the card, F14 reverted_after_refund keeping the G10 toast, F13 approvedResumeMismatch keeping « Ne relancez aucun remboursement. », and the refunded_row_ambiguous blocker.

### H11 [CORE] Trace rule, toast mapping and admin e-mail result copy
lib/transactional-emails.ts `logEmailSkipped(trigger, subject, context, why?)`:
- console: `[EMAIL MISS] [trigger] ${why && why!=='no_recipient' ? `not sent (${why})` : 'no recipient'} — SKIPPED`;
- recipient: `(non envoyé : ${why})`, or '(aucun destinataire)'.
The 3 other callers are unchanged.

traceMiss runs only when sendTransactional was never reached. Exactly one EmailLog row per attempt.

NEW lib/claim-email-toast.ts (pure; no lib/refund, lib/stripe or lib/claims import):

`customerEmailLine(r) → {tone, key}|null`:
- sent → sent, success
- duplicate → duplicate, info
- skipped + claims_disabled → claimsDisabled
- skipped + no_recipient → noRecipient
- skipped + smtp_disabled → smtpDisabled
- skipped + refunded_row_unproven or refunded_row_failed → rowUnproven
- skipped + stripe_not_confirmed → stripeNotConfirmed
- skipped + claim_not_found, no_closure_record or no why → notSent
- failed → failed
- not_applicable or null → null
Every non-null key other than sent and duplicate has error tone.

It exports CUSTOMER_EMAIL_FR, pinned equal to messages/fr.json claims.admin.customerEmail.

claims.admin.customerEmail.* (fr / en / es / it / ar):

sent:
- fr « E-mail client transmis au serveur d’envoi. »
- en « Customer email handed to the mail server. »
- es « Correo al cliente entregado al servidor de envío. »
- it « Email al cliente consegnata al server di invio. »
- ar « سُلِّم بريد العميل إلى خادم الإرسال. »

duplicate:
- fr « Aucun nouvel e-mail : un e-mail de même nature est déjà enregistré pour cette réclamation (envoyé ou en cours d’envoi) — vérifiez le journal e-mail. »
- en « No new email: an email of the same kind is already recorded for this claim (sent or being sent) — check the email log. »
- es « Ningún correo nuevo: ya hay registrado un correo del mismo tipo para esta reclamación (enviado o en curso de envío) — consulte el registro de correos. »
- it « Nessuna nuova email: un’email dello stesso tipo è già registrata per questo reclamo (inviata o in corso di invio) — verifichi il registro email. »
- ar « لا بريد جديد: بريد من النوع نفسه مسجَّل بالفعل لهذه الشكوى (أُرسل أو قيد الإرسال) — راجع سجل البريد. »

claimsDisabled:
- fr « E-mail client NON envoyé : les réclamations sont fermées, et aucun e-mail de réclamation n’est envoyé tant qu’elles le sont. »
- en « Customer email NOT sent: claims are closed, and no claim email is sent while they are. »
- es « Correo al cliente NO enviado: las reclamaciones están cerradas y no se envía ningún correo de reclamación mientras lo estén. »
- it « Email al cliente NON inviata: i reclami sono chiusi e nessuna email di reclamo viene inviata finché lo sono. »
- ar « لم يُرسَل بريد العميل: الشكاوى مغلقة، ولا يُرسَل أي بريد خاص بالشكاوى ما دامت مغلقة. »

noRecipient:
- fr « E-mail client NON envoyé : ce client n’a pas d’adresse e-mail enregistrée. Informez-le par un autre moyen. »
- en « Customer email NOT sent: this customer has no email address on file. Inform them another way. »
- es « Correo al cliente NO enviado: este cliente no tiene dirección de correo registrada. Infórmele por otro medio. »
- it « Email al cliente NON inviata: questo cliente non ha un indirizzo email registrato. Lo informi in altro modo. »
- ar « لم يُرسَل بريد العميل: لا يوجد عنوان بريد مسجَّل لهذا العميل. أبلغه بوسيلة أخرى. »

smtpDisabled:
- fr « E-mail client NON envoyé : l’envoi d’e-mails est désactivé sur ce serveur. Informez le client par un autre moyen. »
- en « Customer email NOT sent: email sending is disabled on this server. Inform the customer another way. »
- es « Correo al cliente NO enviado: el envío de correos está desactivado en este servidor. Informe al cliente por otro medio. »
- it « Email al cliente NON inviata: l’invio di email è disattivato su questo server. Informi il cliente in altro modo. »
- ar « لم يُرسَل بريد العميل: إرسال البريد معطَّل على هذا الخادم. أبلغ العميل بوسيلة أخرى. »

rowUnproven:
- fr « E-mail client NON envoyé : la ligne de remboursement liée est absente, porte sur une autre commande, est échouée, n’est ni aboutie ni en attente, ou n’a pas de montant exploitable — rien ne peut être annoncé au client. »
- en « Customer email NOT sent: the linked refund row is missing, belongs to another order, has failed, is neither completed nor pending, or has no usable amount — nothing can be announced to the customer. »
- es « Correo al cliente NO enviado: la línea de reembolso vinculada no existe, pertenece a otro pedido, ha fallado, no está completada ni pendiente, o no tiene un importe utilizable — no se puede anunciar nada al cliente. »
- it « Email al cliente NON inviata: la riga di rimborso collegata è assente, riguarda un altro ordine, è fallita, non è né completata né in attesa, o non ha un importo utilizzabile — non si può annunciare nulla al cliente. »
- ar « لم يُرسَل بريد العميل: سطر الاسترداد المرتبط غير موجود، أو يخص طلبًا آخر، أو فشل، أو ليس مكتملًا ولا معلَّقًا، أو لا يحمل مبلغًا صالحًا — لا يمكن إعلان أي شيء للعميل. »

stripeNotConfirmed:
- fr « E-mail client NON envoyé : Stripe n’a pas été relu, ou ne rapporte pas dans cette lecture ce remboursement comme abouti (en attente ou illisible) — rien n’est annoncé au client. Réessayez « Envoyer l’avis au client » plus tard. »
- en « Customer email NOT sent: Stripe was not re-read, or does not report this refund as completed in this read (pending or unreadable) — nothing is announced to the customer. Try « Envoyer l’avis au client » again later. »
- es « Correo al cliente NO enviado: Stripe no se ha releído, o en esta lectura no informa este reembolso como completado (pendiente o ilegible) — no se anuncia nada al cliente. Vuelva a intentar « Envoyer l’avis au client » más tarde. »
- it « Email al cliente NON inviata: Stripe non è stato riletto, o in questa lettura non riporta questo rimborso come completato (in attesa o illeggibile) — nulla viene annunciato al cliente. Riprovi « Envoyer l’avis au client » più tardi. »
- ar « لم يُرسَل بريد العميل: لم تُعَد قراءة Stripe، أو لا تُفيد في هذه القراءة بأن هذا الاسترداد مكتمل (معلَّق أو تعذّرت قراءته) — لا يُعلَن أي شيء للعميل. أعد محاولة « Envoyer l’avis au client » لاحقًا. »

notSent:
- fr « E-mail client NON envoyé (trace dans le journal e-mail) : informez le client par un autre moyen. »
- en « Customer email NOT sent (trace in the email log): inform the customer another way. »
- es « Correo al cliente NO enviado (traza en el registro de correos): informe al cliente por otro medio. »
- it « Email al cliente NON inviata (traccia nel registro email): informi il cliente in altro modo. »
- ar « لم يُرسَل بريد العميل (الأثر في سجل البريد): أبلغ العميل بوسيلة أخرى. »

failed:
- fr « E-mail client NON envoyé (erreur lors de la préparation ou de l’envoi — trace dans le journal e-mail ou les journaux du serveur) : informez le client par un autre moyen. »
- en « Customer email NOT sent (error while preparing or sending — trace in the email log or the server logs): inform the customer another way. »
- es « Correo al cliente NO enviado (error al preparar o enviar — traza en el registro de correos o en los registros del servidor): informe al cliente por otro medio. »
- it « Email al cliente NON inviata (errore durante la preparazione o l’invio — traccia nel registro email o nei log del server): informi il cliente in altro modo. »
- ar « لم يُرسَل بريد العميل (خطأ أثناء التحضير أو الإرسال — الأثر في سجل البريد أو سجلات الخادم): أبلغ العميل بوسيلة أخرى. »
IMPLEMENTATION NOTE (W6): landed. logEmailSkipped takes an optional fourth why; without it, or with 'no_recipient', the console line and the row are byte-identical to HEAD, so a no_recipient skip keeps the recipient « (aucun destinataire) ». lib/claim-email-toast.ts has no import at all: its CustomerEmailWhy restates ClaimEmailWhy and a type test pins them equal. customerEmailLine maps a skipped why it does not name (sender_error, not_a_closure) to notSent and an unknown status to null. The stripeNotConfirmed text names « Envoyer l’avis au client », the control the console slice adds with H10. Pinned by tests/claim-email-toast.test.ts and tests/email-idempotency.test.ts (J-C31).
IMPLEMENTATION NOTE (W6 fixer) on H11 / H06 (A-S43 copy gap): a refunded claim whose bound row has two or more binders answers refunded_row_unproven (H06 note (1)) even when the row is present, on the claim's own order, succeeded and has a usable amount, and that why maps to rowUnproven, whose frozen text lists missing, other order, failed, neither completed nor pending, or no usable amount, but not « liée à plusieurs réclamations ». The operator can read a wrong cause; no money truth is stated and the case is reachable only on legacy multi-binder rows. The copy change (adding « …ou est liée à plusieurs réclamations… » in 5 locales, with J-C31 updated) is DEFERRED to W7, together with the ER-C22 blocker fix of H10, so the toast, the list blocker and the sender change together. IMPLEMENTATION NOTE (W6 fixer) on H11 / H10 (ordering): the stripeNotConfirmed text names « Envoyer l’avis au client », which no console control calls before W7. It cannot surface while claims are closed (the sender answers claims_disabled at step 4, before stripe_not_confirmed at step 7), so W6 keeps the frozen copy. W7 must land H10 (both sections, the button wired to the closure-notice route, counts.closureNoticesMissing) and J-C30 before any CLAIMS lease opens on any environment; this is recorded as a blocking step in docs/ops/CLAIMS-R13-OPERATOR-PRECHECK.md (Étape 0) and in docs/ops/REFUND-FINANCIAL-CONTRACT.md §23. If W7 slips past a lease window, the trailing « Réessayez … plus tard » sentence is held until the control exists. Pinned by tests/claim-closure-record.test.ts (the claims_disabled-before-stripe_not_confirmed behaviour, and a conditional pin: while no component calls the route, the precheck must carry « AUCUN bail CLAIMS avant W7 (H10) »).
IMPLEMENTATION NOTE (W7) on ER-C22: rowUnproven names the multi-binder cause — fr « …porte sur une autre commande, est liée à plusieurs réclamations, est échouée… », en « …belongs to another order, is linked to several claims, has failed… », es « …pertenece a otro pedido, está vinculada a varias reclamaciones, ha fallado… », it « …riguarda un altro ordine, è collegata a più reclami, è fallita… », ar « …أو يخص طلبًا آخر، أو مرتبط بعدة شكاوى، أو فشل… »; CUSTOMER_EMAIL_FR follows. tests/claim-email-toast.test.ts derives each expected value from the frozen text plus exactly that clause, with a negative control on the frozen value. stripeNotConfirmed’s « Réessayez « Envoyer l’avis au client » plus tard » now names the H10 control, which exists (the W6 ordering condition is met).
IMPLEMENTATION NOTE (W8 fixer): the W6 fixer ordering note is superseded where it quotes the precheck. The operator precheck no longer carries « AUCUN bail CLAIMS avant W7 (H10) »: W7 (4d3e442) wired the control, and docs/ops/CLAIMS-R13-OPERATOR-PRECHECK.md Étape 0 now states the verifiable condition « AUCUN bail CLAIMS sur un environnement dont le build déployé ne contient pas le commit W7 `4d3e442`. » To check it, the deployed version.json commit must have 4d3e442 as an ancestor (git merge-base --is-ancestor, in a clone fetched with develop and main, because production's commit is on main), and GET /api/admin/claims/financial-verification must carry counts.closureNoticesMissing. tests/claim-closure-record.test.ts pins that line (ORDER_LINE). The conditional pin still holds: a precheck without it fails only while no console component calls the closure-notice route.

### H12 [CORE] Promise sentences in existing e-mail copy, reworded
Nothing guarantees a later e-mail: webhook and recovery settlements send nothing, R-D7 skips sends while claims are closed, and review states never notify. The following are reworded in all 5 locales, rendered with {ref}.

claimEmails.ack.next and claimEmails.orderCancelledPaid.next take the same strings:
- fr « Pour toute question, répondez à cet e-mail en indiquant la référence {ref}. »
- en « If you have any questions, reply to this email quoting reference {ref}. »
- es « Si tiene alguna pregunta, responda a este correo indicando la referencia {ref}. »
- it « Per qualsiasi domanda, risponda a questa email indicando il riferimento {ref}. »
- ar « لأي استفسار، رُدّ على هذه الرسالة مع ذكر المرجع {ref}. »

claimEmails.refused.contest (the contest path can be withheld by the 48 h window or a closed lease):
- fr « Si la contestation vous est proposée dans le suivi de votre commande, vous pouvez l’y contester : la réclamation est alors transmise à Grubano pour arbitrage. Pour toute question, répondez à cet e-mail en indiquant la référence {ref}. »
- en « If contesting is offered on your order tracking page, you can contest it there: the claim is then passed to Grubano for arbitration. If you have any questions, reply to this email quoting reference {ref}. »
- es « Si en el seguimiento de su pedido se le ofrece la impugnación, puede impugnarla allí: la reclamación se transmite entonces a Grubano para arbitraje. Si tiene alguna pregunta, responda a este correo indicando la referencia {ref}. »
- it « Se nella pagina di monitoraggio del Suo ordine Le viene proposta la contestazione, può contestarlo lì: il reclamo viene allora trasmesso a Grubano per l’arbitrato. Per qualsiasi domanda, risponda a questa email indicando il riferimento {ref}. »
- ar « إذا عُرض عليك الاعتراض في صفحة متابعة طلبك، يمكنك الاعتراض عليها هناك: تُحال الشكوى حينها إلى Grubano للتحكيم. لأي استفسار، رُدّ على هذه الرسالة مع ذكر المرجع {ref}. »

eat.help.claimFiledSub, claims.client.success and claims.client.description are reworded in F09.

Kept, each established when sent:
- approved.body « Grubano a tranché en votre faveur sur la commande {ref}. » (the approval CAS);
- refunded.body (engine ok, H03);
- refusedFinal.body (kind refused_confirmed only);
- accepted.body « …transmise à Grubano pour décision de remboursement » (the CAS to arbitration).

The F10 guard runs over claimEmails.*.

### H13 [CORE] Paid-cancellation e-mail variant chosen at send time (R-D7)
app/api/orders/[id]/status/route.ts, send branch:
- Replace the `paidCancellation` / `paidCancelled && !claimsOn` split with `const claimsOpenNow = isClaimsEnabled()`, evaluated immediately before sending.
- paidCancelled && claimsOn(entry) && claimsOpenNow → sendOrderCancelledPaidEmail (unchanged shape).
- paidCancelled && !claimsOpenNow → sendOrderCancelledPaidOffEmail. Its copy names no claim and stays true whether or not a hidden system claim was created.

Both variants keep trigger order_cancelled and dedupe `order:<id>`, so exactly one is sent. createSystemClaim gating (claimsOn at entry) is unchanged.

Test: the lease closes between entry and send → the Off variant is sent, never the claim-mentioning one.
IMPLEMENTATION NOTE (W6) on ER-C20: `if (paidCancellation && claimsOpenNow)` sends the claim-mentioning variant and `else if (paidCancelled)` sends the Off variant. A lease closed at entry but open at send, and a paid cancellation with no amount to claim, therefore get the Off variant, never the generic e-mail that says nothing about the money. createSystemClaim gating (the entry value) is unchanged. Pinned by tests/email-order-status-variant.test.ts (the four lease sequences) and the source pin in tests/email-order-status.test.ts (J-C33).

### H14 [CORE] Operator declaration panel copy
AdminClaimsArbitration.tsx panel (~277) and AdminFinancialVerification.tsx panel (~460) literal: « Aucune de ces actions ne rembourse ni ne relance quoi que ce soit. Elles enregistrent votre déclaration, libèrent la commande pour le client et tentent de lui envoyer un e-mail de clôture, sans votre note ni aucun montant — aucun e-mail n’est envoyé tant que les réclamations sont fermées (le résultat de l’envoi s’affiche ensuite). »

Placeholder in both panels: « Ce qui s’est réellement passé (facultatif, jamais montré au client)… ».

The existing declaration toasts « Cette action n’a déplacé aucun argent… » stay unchanged; they are true of the action. The customerEmailLine toast follows them.
IMPLEMENTATION NOTE (W7): landed in both panels as one string literal (the source scan reads it verbatim), with the placeholder « Ce qui s’est réellement passé (facultatif, jamais montré au client)… »; the declaration toasts are unchanged and the customerEmailLine toast follows them. Pinned by tests/claims-closure-ui.test.ts (J-C34).

### H15 [CORE] Import topology: senders never in the webhook bundle
lib/claim-emails.ts imports only:
- lib/claim-action-rules
- lib/prisma
- lib/transactional-emails
- lib/order-ref
- lib/onboarding-nudge
- next-intl/server

It never imports lib/claims, lib/refund or lib/stripe.

lib/claims.ts never imports lib/claim-emails or lib/claim-email-toast, directly or transitively. The webhook imports lib/claims, and lib/claims imports only the pure constants CLOSURE_RECORD_TRIGGER and closureRecordKey from lib/claim-action-rules.

The only importers of lib/claim-emails are these app routes:
- app/api/claims/route.ts
- app/api/claims/[id]/respond/route.ts
- app/api/admin/claims/[id]/arbitrate/route.ts
- app/api/orders/[id]/status/route.ts
- app/api/admin/claims/[id]/resolve-stuck/route.ts
- app/api/admin/claims/[id]/reconcile/route.ts
- app/api/admin/claims/[id]/attribute/route.ts
- app/api/admin/claims/[id]/closure-notice/route.ts

Test: a static import walk from app/api/webhooks/stripe/route.ts, app/api/admin/claims/reconcile-refunds/route.ts and every app/api/cron/** route never reaches lib/claim-emails. Negative control: a synthetic import added to a temp copy of lib/claim-action-rules is detected. A source scan pins the importer list above.
IMPLEMENTATION NOTE (W6) on ER-C17: the importer list stays the 8 routes above. The files that CALL a claim sender are these routes minus app/api/orders/[id]/status/route.ts, which imports only the order-cancellation senders. H10 / H16's missing-notice list is not in this slice: when it lands it must either live outside lib/claim-emails or extend this pinned list with its routes. The walk (tests/claims-closure-imports.test.ts, J-C29) follows '@/…' and relative static, re-export and dynamic imports from the webhook, reconcile-refunds and every route .github/workflows/cron.yml calls (ER-C23: app/api/cron does not exist), and pins that lib/claim-emails reaches none of lib/claims, lib/refund and lib/stripe transitively.

### H16 [CORE] No backlog; census counts in the operator precheck
GET /api/admin/claims/census adds claims.closure with two counts:
- missing = listMissingClaimClosureNotices().total;
- terminalWithoutRecord = terminal claims with claimClosureKind not null and no closure record. This counts legacy closures plus record-write failures; none of them is ever sent.

claims.legacy adds:
- refundedRowUnproven: the F03-false predicate, count only;
- ownRowResumeMismatch: {nonTerminal, terminal};
- terminalDeclarationWithArbitrationReason;
- refundedAfterContradictionAttribution: null when !isAdminAuditEnabled(); otherwise a lower bound.

Each field has its own catch; an unmeasured count is null, never 0.

scripts/server/phase2-claims-gate.js prints every non-zero closure count and legacy count as a census anomaly. It makes no Stripe call and marks no data. That is the C3 alert for the pre-deploy populations.

docs/ops operator precheck: read and report these counts in the inbox on EACH environment before any CLAIMS lease opens there.
IMPLEMENTATION NOTE (W5): the census and precheck halves landed with I-06 / I-07 (see their notes). closure.missing does not go through listMissingClaimClosureNotices, which the email slice adds to lib/claim-emails. The docs/ops operator-precheck text is not part of this slice.
IMPLEMENTATION NOTE (W5 fixer): the docs/ops operator-precheck text is written in docs/ops/CLAIMS-R13-OPERATOR-PRECHECK.md (report the census counts and every « !! CENSUS: » line in the inbox, per environment, before any CLAIMS lease; then the AMF-1 re-verification with reverted = 0).

### H17 [DEFER] Off-variant cancellation body: drop the process promise
claimEmails.orderCancelledPaidOff.body (all 5 locales): delete the trailing clause « — chaque demande est traitée par un membre de l’équipe pendant la bêta » and its translations. It states what the team will do, which the code cannot establish.

The remaining sentence (contact support, or reply) is unchanged. The e-mail is not a claim e-mail and is not gated by R-D7.
IMPLEMENTATION NOTE (W8): landed. The trailing clause is deleted in the 5 locales (messages/*.json claimEmails.orderCancelledPaidOff.body); the remaining sentence is byte-identical to HEAD. The EMAIL-FACTUAL-PACK copies (EMAIL-COPY-VERBATIM.md, E1/E1-COPY.md, EMAIL-CLAIMS-REFUNDS-FACTS.md) follow, and current-renders/CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_OFF.html was regenerated by EMAIL-FACTUAL-PACK/tools/render-current.test.ts (13/13; only that render changed). Pinned by tests/claims-closure-copy.test.ts (J-C38).
IMPLEMENTATION NOTE (W8 fixer): the W8 note above missed four pack files that described or showed the deleted clause. (1) EMAIL-FACTUAL-PACK/EMAIL-MANIFEST.md and E1/E1-MANIFEST.md (row CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_OFF) called the e-mail truthful with the clause; the cell now reads « Truthful: contact support (contact@grubano.com) or reply; no process promise, no delay (H17, round 13 …) ». (2) E1/E1-HANDOFF.md told the designer to keep « money is handled by a human at support during the beta »; it now says the customer contacts support or replies, with no statement of who handles the request or how. (3) current-renders/png/CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_OFF@600.png and @390.png (linked by current-gallery.html) still showed the clause; both were re-shot from the regenerated HTML with the wrapper, widths and browser flags of EMAIL-FACTUAL-PACK/tools/screenshot.mjs (only those two PNGs changed). They were missed because they spell the clause with an ASCII apostrophe or in English. Pinned by tests/claims-closure-copy.test.ts (W8 fixer describe: no Markdown file of EMAIL-FACTUAL-PACK states the clause in either apostrophe form or in its English glosses, and neither PNG has its 4d3e442 sha256; negative control on the 4d3e442 manifest cell and handoff line).

### H18 [CORE] Closure e-mail tests
Add tests/claims-closure-emails.test.ts:

(a) sendClaimClosureEmail check order, one fixture per step:
- not found
- not a closure (including REVERTED_AFTER_REFUND)
- no record (legacy)
- claims closed
- refusal delegate with the right kind
- failed row
- unproven row
- ambiguous binders
- no or ledger evidence
- differing amount → refundRecorded with no « € »
- equal amount → refundedLinked
- no recipient
- smtp skipped
- sender failed
Each asserts exactly one EmailLog row.

(b) H03: arbitrate never sends claim_decision_refunded for attempt_superseded, identity_unverified, resume_mismatch, pending or T2 outcomes.

(c) H05: CLOSURE_RECORD_TRIGGER is written only by recordClaimClosure, which is called only at the listed sites. A rejected record write leaves every caller's return unchanged.

(d) H08:
- sendTransactional is reached for kind refunded only after refund_still_standing with stripeStatus 'succeeded';
- reverted_after_refund → 409 with no send;
- kind null → 409 with no audit;
- a non-empty body → 400.

(e) At most two notices, in the H01 order.

(f) H10:
- the red heading is absent when only notices exist;
- the blocker split between refunded_row_failed and refunded_row_unproven;
- the unproven list is disjoint from the failed-with-id claims in listActionableRefundClaims;
- cursor paging is stable when a claim is inserted between pages.

(g) H13 variant choice.

(h) H15 import walk.

(i) EMAIL-FACTUAL-PACK/tools/render-current.test.ts: every call passes claimsOpen: true; renders for refused_by_grubano, closure refunded × {linked, recorded}, and a declaration.
IMPLEMENTATION NOTE (W8): H18 is implemented by the J tests that pin each item, not in one file: (a) tests/claims-closure-emails.test.ts (J-C24, and J-C44 for one EmailLog row per attempt); (b) tests/claim-emails-routes.test.ts (J-C22, the arbitrate e-mail kind by provenance, « refunded » only on the engine's CAS-won result); (c) tests/claim-closure-record.test.ts (J-C23); (d) tests/claims-closure-notice-route.test.ts (J-C27); (e) tests/claim-closure-record.test.ts (J-C37); (f) tests/claim-closure-lists.test.ts and tests/claims-closure-ui.test.ts (J-C30, with the W7 fixer cursor-paging pin); (g) J-C33; (h) J-C29 / J-C21; (i) EMAIL-FACTUAL-PACK/tools/render-current.test.ts (J-C36, its own config; re-run in W8 after H17, 13/13).

## I. ALERT / REGISTRY RULES

Every alert, its trigger (a write by this build, or the census anomaly for a pre-deploy population, C3), sender, dedupe key, facts and forbidden content; the durable ungated surfaces and census counts that make each E entry visible. No alert, count or exit depends on a scheduled job (R-D8).

### I-01 [CORE] claim_payment_blocked (new MoneyReviewKind)
lib/admin-alerts.ts: MoneyReviewKind adds 'claim_payment_blocked'.
SENDER: sendAdminMoneyReviewAlert (console.error first, best-effort, never throws), through helper alertClaimPaymentBlocked(claimId, cause, facts) in lib/claims.ts.
TITLE: « Réclamation non payée par le rail — décision admin requise ».
DEDUPE: `claim_blocked:${claimId}:${cause}`. sendOnce dedupe is permanent, so a claim re-entering the same cause does not alert again; the E surface stays the durable signal.
CAUSE (closed enum):
- proof markers: 'no_refund_proven:v13:', 'no_refund_proven_rail_locked:awaiting_finalization:', 'no_refund_proven_rail_locked:';
- outcome codes: 'safety_hold', 'safety_check_unreadable', 'unconfirmed_within_window', 'own_row_exists', 'resume_mismatch', 'identity_unverified', 'engine_own_row', 'engine_failed', 'stripe_failed', 'engine_row_dead', 'stripe_reverted', 'reverted_after_refund', 'refunds_disabled', 'attempt_crashed'.
TRIGGERS (only after a write whose updateMany count === 1; never inside a $transaction; never on a lost CAS):
- reconcile N8 proof writes, all three prefixes;
- T2 (a), (b) revert, (b'), (c), (e') proof write, (e') no_write revert;
- T4 resume_mismatch, identity_unverified, own-row fatal, engine_failed;
- applyRowTruth stripe_failed, engine_row_dead, STRIPE_REVERTED;
- D7 R0a / R0b / R0c helper writes;
- arbitrateClaim approve (lib/claims.ts ~920-926): after its decision updateMany to 'approved' returned count 1, when triggerClaimRefund returned {state:'pending', reason:'refunds_disabled'} → cause 'refunds_disabled'. This is the beta writer of E-10 with claims open and refunds closed; a decision CAS with count ≠ 1 returns 409 before triggerClaimRefund, so it never alerts;
- approveClaim (lib/claims.ts 638; reached only from runClaimAutoApproval and autoResolveSmallClaim, flags off): the same check after its own CAS;
- the triggerClaimRefund catch after T1 (A-S30d, 'attempt_crashed'), best-effort before the rethrow.
FACTS: claimId, orderId, claimStatusAfter, cause, refundRowIds, stripeRefundIds, firstEngineRefusal (mirror id such as 'E6', or null), holds (such as 'H1,H5'), routed (true/false/'unknown'), quiescenceInstant (v13 only), exits (acceptedExits joined, gated ones suffixed ' (réclamations+remboursements ouverts)'), engineCalled (boolean), registry (E id). For refunds_disabled: claimStatusAfter 'approved', engineCalled false, firstEngineRefusal null, registry 'E-10', exits 'approve (réclamations+remboursements ouverts)'.
NEVER SAYS: that the claim is or will be paid or payable; « réessayez »; that a refund belongs to another claim unless N3 established it; any customer name, e-mail or address; an amount presented as owed.
PINS: J-M52, J-C39 — one test per trigger (count 1 → sent, count 0 → not sent), with break/restore on the dedupe key.
IMPLEMENTATION NOTE (W2): lib/claims.ts alertClaimPaymentBlocked(claimId, cause, input) computes exits and registry from the state the write left (acceptedExits / exitRegistry), routed 'unknown' when not read, quiescenceInstant only for a v13 state. Triggers landed: T2 (a), (b), (b'), (c), (e') proof, (e') revert; T4 resume_mismatch, identity_unverified, engine_own_row, engine_failed; arbitrateClaim and approveClaim refunds_disabled; the attempt_crashed catch. The N8, applyRowTruth and R0 triggers land with their slices. Pinned by tests/claims-t49-round13-alerts.test.ts (J-M52 / J-C39).
IMPLEMENTATION NOTE (W2, round-1 fix): the triggerClaimRefund catch after T1 covers T2, the engine call and the T4 writes. engineCalled is a local flag set to true immediately before executeRefund (no await in between), so attempt_crashed reports engineCalled true for a throw from the engine (a non-P2002 insert error, refund.ts 829, or a finalize write after the Stripe create) or from a T4 write, and false only for a throw before the engine. The N8 trigger (all three prefixes, D4) and the applyRowTruth STRIPE_REVERTED trigger (B8 (ii)) landed in W2; stripe_failed / engine_row_dead and R0 stay with W3 and the webhook slice. [W3: the applyRowTruth stripe_failed and engine_row_dead triggers landed — see the G2 W3 note; R0 stays with W5.] T2 lock and N8 alerts carry stripeRefundIds (E3 rows read at Stripe, H1 and H2 refunds); own_row_exists carries the text written as claimAfter. The exits suffix stays on approve only: refuse_final is never accepted on the approved / refunding states this alert describes (AM-B3), and attribute, adopt, reconcile and resolve-stuck are ungated, so the suffix would be false on them. Pinned by tests/claims-t49-round13-alerts.test.ts (engineCalled fixtures: a T2 write throw → false, an engine throw → true, a T4 write throw after ok → true; N8 × 3).
IMPLEMENTATION NOTE (W3, round-1 fix): facts hygiene. applyRowTruth’s STRIPE_REVERTED alert ('reverted' branch) reports claimAfter.refundAttempted from the pre-image (`claim.refundAttempted ?? true`), like its stripe_failed and engine_row_dead siblings; W3 makes that branch reachable from a v13 or lock pre-image whose refundAttempted is false. Exits and registry are unchanged.
IMPLEMENTATION NOTE (W7 fixer, W2 carry-over): for a v13 proof whose C4 instant is readable, the gated approve exit states its time bound — `approve (réclamations+remboursements ouverts, au plus tôt le <ISO> UTC)`; every other approve keeps « (réclamations+remboursements ouverts) » (the refunds_disabled facts still read `approve (réclamations+remboursements ouverts)`). The instant also still travels in quiescenceInstant. Pinned by tests/claims-t49-round13-alerts.test.ts (v13 facts).

### I-02 [CORE] claim_financial_verification (existing) on entry and relabel
SENDER: enterFinancialVerification (lib/claims.ts ~1429), unchanged: title `Vérification financière requise — réclamation ${id}`, dedupe `claim_fv:${claimId}:${reason}`.

NEW: the relabel branch (FV → FV) sends the same alert after a successful relabel CAS, only when the reason differs from the pre-image reason. The same reason sends nothing.

TRIGGERS: every park written by reconcile (N1-N7, applyRowTruth contradiction), T2(e') park, entry from approved or refunding.

FACTS: unchanged (claimId, orderId, claimState, ambiguity, detail, refundRowId).

NEVER SAYS: that another refund may be issued (existing comment: « NEVER another refund »).
IMPLEMENTATION NOTE (W3): the relabel branch landed in W2 (C9 note). In W3 every reconcile park (N1-N7, the mine-path and bound-path contradiction parks) goes through it with the read pre-image. The facts keys are the shipped set: claimId, orderId, claimState, ambiguity, detail, refundRowId, stripeRefundId, requestedCents, moneyMoved, nextAction. Pinned by tests/claims-t49-round13-alerts.test.ts (J-C40) and tests/claims-r13-reconcile.test.ts (J-M35).

### I-03 [CORE] claim_attempt_superseded (new MoneyReviewKind)
TRIGGER: triggerClaimRefund T4, when the CAS where {id, status:'refunding', refundError: M} returns count 0 AND the engine result was ok or 202. A refusal result logs only: console.warn [claims] attempt_superseded.

SENDER: sendAdminMoneyReviewAlert kind 'claim_attempt_superseded'.
TITLE: « Tentative de remboursement terminée après un changement d’état de la réclamation ».
DEDUPE: `claim_attempt:${claimId}:${refundRowId}`.

FACTS: claimId, orderId, refundRowId, stripeRefundId, engineStatus ('ok' | 'pending'), resumed, claimStatusNow, claimRefundIdNow, claimRefundErrorPrefixNow.

SAYS: this attempt created or drove a refund row that the claim's current state does not reflect; human money review.

NEVER SAYS: that the customer was paid twice, or that a refund is owed or must be reversed. Neither is established by this code.
IMPLEMENTATION NOTE (W2): engineStatus is 'ok' | 'pending' (C5's 'succeeded' reads as 'ok'); dedupe claim_attempt:<claimId>:<refundRowId>; a refusal logs console.warn [claims] attempt_superseded only. Pinned by tests/claims-r13-stale-attempt.test.ts (J-M22) and tests/claims-t49-round13-alerts.test.ts (J-C41).

### I-04 [CORE] claim_refunded_row_unfinalized (existing)
TRIGGERS:
- applyRowTruth at_stripe succeeded (existing, ~1772);
- D8 PROVEN write on a PENDING row, after the observed commit only.
Not sent by D9 adoption: the mirror row is succeeded.

DEDUPE and TITLE: unchanged.

NEVER SAYS: that the ledger or the royalty clawback was applied.

### I-05 [CORE] Webhook refund alerts (existing kinds, no new kind)
app/api/webhooks/stripe/route.ts:
- The succeeded-row failed/canceled branch sends the existing alert FIRST (dedupe refund:<re_id>, unchanged). Its facts gain claimIds from a best-effort claim.findMany {refundId: row.id} select id; a read failure → claimIds 'unread'. Then the D12 helper runs.
- markRefundRowFailed's refund_failed alert and the external failed-refund alert are unchanged.
- No refund_reverted_claim key; no new sender; no new JSON response key.

These alerts are the visibility of E-06, E-07 and E-08. They cannot cover E-09, because the event was not processed.

### I-06 [CORE] Census counts (GET /api/admin/claims/census, internal token, counts only)
The route keeps its convention: counts only, no ids, null when unmeasured (a query threw), never 0 on failure. It adds claims.legacy and claims.closure. All reads are Prisma: no raw SQL, no Stripe.

claims.legacy:
- legacyPayableProofs: claim.count {status 'approved', refundError startsWith 'no_refund_proven:', NOT startsWith 'no_refund_proven:v13:'}.
- refundedBoundToFailedRow: ids = refund.findMany {status 'failed', stripeRefundId not null} select id; claim.count {status 'refunded', refundError null, refundId in ids}.
- refundedRowUnproven: E-13 predicate, evaluated in JS over claim.findMany {status 'refunded', refundError null} select id, orderId, refundId and refund.findMany {id in refundIds} select id, orderId, status, stripeRefundId, amountCents.
- ownRowResumeMismatch {nonTerminal, terminal}: claims with refundError startsWith 'resume_mismatch' and refundId, whose row reason === `claim:${id}`, split by TERMINAL_STATUSES.
- terminalDeclarationWithArbitrationReason, refundedAfterContradictionAttribution: Track B definitions, unchanged.
- refundedBoundToOtherClaimStamp: rows {status 'succeeded', reason startsWith 'claim:'} where no claim with id = reason.slice(6) has status 'refunded' && refundId === row.id.
- rowsBoundToMultipleClaims: claim.groupBy {by ['refundId'], where {refundId not null, OR:[{refundError:null}, {NOT:{refundError:{startsWith:'resume_mismatch'}}}]}, having refundId _count > 1} → number of groups.
- pendingRowsOver20hWithSettledRoyalty: refund rows {status 'pending', royaltyRefundCents gt 0, createdAt lt now − RESUME_CREATE_WINDOW_MS} whose order has a franchiseRoyalty with status in ['settled', 'settling'].
- approvedUnpaid: claim.count {status 'approved', refundAttempted false}. This includes the claims of this build.

claims.closure:
- missing: Track B's eligible-without-dispatch definition;
- terminalWithoutRecord: terminal claims with no D10 closure record.
These replace terminalBeforeEpoch and terminalDecidedFromEpochBeforeLive (C4).

NOT COUNTED (stated in the route comment): E-09, which needs a Stripe read.
IMPLEMENTATION NOTE (W5): landed in lib/claims-census.ts (claimsLegacyCensus, claimsClosureCensus), called by the census route; each field has its own catch (null, never 0 — a population with nothing to read is a measured 0). The two « Track B definitions » are not in this file; implemented as: terminalDeclarationWithArbitrationReason = terminal claims whose F02 kind is settled_by_declaration or closed_by_declaration and whose arbitrationReason is set (the customer payload carries arbitrationReason; the round-10 fix moved the operator note out of it); refundedAfterContradictionAttribution = null while admin audit is off, otherwise the refunded claims with no recorded error on a SUCCEEDED row whose audit trail shows a claim.reconcile_evidence park with ambiguity 'stripe_refund_contradiction' followed by a claim.attribute_refund audit without stripeStatus (the pre-round-13 bind-first path; round 13 audits stripeStatus) — a lower bound. refundedRowUnproven uses the H10 predicate (F03 false, excluding a failed-with-id row of the claim's own order), which also counts an unknown row status (ER-C22). closure.missing uses the E-16 predicate on EmailDispatch directly (ER-C17: the census route does not import lib/claim-emails). B9 (d) rowsBoundToMultipleClaims is this groupBy (OR form). Pinned by tests/claims-t49-round13-census.test.ts (J-M53) and tests/claims-t49-round12.test.ts (J-C35).
IMPLEMENTATION NOTE (W5 fixer): the two « Track B definitions » were found in the Track B source (design pass 2, section « §M Read-only census », and its revised pass) and replace the reconstruction above: terminalDeclarationWithArbitrationReason = terminal claims (TERMINAL_STATUSES) with refundError not null AND arbitrationReason not null; refundedAfterContradictionAttribution = null while !isAdminAuditEnabled(), otherwise refunded claims with an AdminAuditLog 'claim.attribute_refund' AND an EmailDispatch {trigger 'admin_money_review_claim_financial_verification', dedupeKey 'claim_fv:<id>:stripe_refund_contradiction'} — a LOWER BOUND (sendOnce releases the key of an unsent alert; relabels into that reason sent no alert before round 13). Same predicates in lib/claims-census.ts and scripts/server/phase2-claims-gate.js (parity test). Pinned with near-miss fixtures in tests/claims-t49-round13-census.test.ts: a declaration without arbitrationReason, an arbitrated refusal with a reason and no refundError, an attribution audit without the park dispatch, a park dispatch of another reason, and a park + audit on a non-refunded claim are not counted; an attribution audit carrying stripeStatus is counted (the source does not read it).
IMPLEMENTATION NOTE (W8): the two Track B definitions of the W5 fixer note are confirmed in the code (lib/claims-census.ts and scripts/server/phase2-claims-gate.js, same predicate) and are documented outside this file, in docs/ops/REFUND-FINANCIAL-CONTRACT.md §25, with the lower-bound caveat and the founder-review rule (E-15). The census reads are unpaged — refundedBoundToFailedRow, refundedRowUnproven, ownRowResumeMismatch, refundedAfterContradictionAttribution, refundedBoundToOtherClaimStamp, rowsBoundToMultipleClaims (one claim.groupBy), pendingRowsOver20hWithSettledRoyalty and claims.closure each read their whole population with unpaged queries (one to three per field; no page, no cap; W8 fixer correction of « in one query » and of the two missing fields), and legacyPayableProofs, terminalDeclarationWithArbitrationReason and approvedUnpaid are single count queries — which is sized for the beta volume; a read that throws makes its field null, never 0 (stated in §25).

### I-07 [CORE] Operator precheck census lines (scripts/server/phase2-claims-gate.js)
WHEN: in REHEARSAL PRECHECK mode, before any window (and reprinted, unchanged in effect, at window start). The script computes the I-06 counts itself with read-only Prisma queries on its own DB handle: no Stripe call, no new fetch (the existing gate probes at lines 79 and 242 are unchanged), no write.
CHANNEL (does not block): a new printer `const census = []; const C = (k, v, m) => { F(k, v === null ? 'NOT MEASURED' : v); if (v === null || v > 0) { census.push(k + ': ' + (v === null ? 'NOT MEASURED' : m)); console.log('  !! CENSUS: ' + k + ' — ' + (v === null ? 'NOT MEASURED' : m)) } }`. done() prints, after the ANOMALIES block, 'CENSUS (C3 — legacy and closure populations; report them in the inbox; they do not change RESULT) (' + census.length + '):' and each line. C never pushes to `anomalies`, so RESULT (lines 311, 408), WINDOW READINESS (307) and the window refusal (325) are unchanged by any census value — approvedUnpaid counts every beta approval and must not refuse every window.
MESSAGES (English, log convention):
- legacyPayableProofs: 'N pre-v13 absence proofs, approval suspended; run reconcile on each (E-01)'.
- refundedBoundToFailedRow: 'N refunded claims on a failed Stripe-id row, unmarked; reconcile from the FV card (E-07)'.
- refundedRowUnproven: 'N refunded claims whose bound row is not established (E-13)'.
- ownRowResumeMismatch.nonTerminal / .terminal: 'N own-row resume_mismatch claims (E-05 / E-14)'.
- refundedAfterContradictionAttribution: 'N (lower bound; null if admin audit was off): FOUNDER REVIEW (E-15)'.
- refundedBoundToOtherClaimStamp: 'N standing rows stamped for a claim not settled on them (E-04)'.
- rowsBoundToMultipleClaims: 'N rows bound to two or more claims (E-12)'.
- pendingRowsOver20hWithSettledRoyalty: 'N pending rows over 20 h with a settled royalty: engine resume may refuse forever (E-01 A-S10c)'.
- approvedUnpaid: 'N approved and unpaid claims, exits gated by CLAIMS+REFUNDS (E-10)'.
- closure.missing: 'N closures of this build without a dispatched notice (E-16)'.
- closure.terminalWithoutRecord: 'N terminal claims without a this-build closure record (legacy, or record write failed): never notified (E-18)'.
No line about ADMIN_AUDIT_ENABLED: closure-notice eligibility is the H05 record, independent of admin audit. The script never calls Stripe and never marks data (R-D6). Pins: J-M53, J-C35.
IMPLEMENTATION NOTE (W5): ER-C16 resolved as this rule states — the printer C never pushes to `anomalies`, and done() prints the CENSUS block after the ANOMALIES block. The script computes the counts (censusCounts) with the definitions of lib/claims-census.ts, pinned equal on one fixture, and its resume-window constant is pinned equal to lib/refund RESUME_CREATE_WINDOW_MS. The census runs in step [2], so it prints in precheck and again at window start. Printed keys are prefixed « CENSUS »; ownRowResumeMismatch prints one line per field, each with the message above; terminalDeclarationWithArbitrationReason, which has no message above, prints « N terminal declaration closures carrying an arbitration reason the customer payload shows (Track B) ». The two gate probes stay the only fetch calls.
IMPLEMENTATION NOTE (W5 fixer): terminalDeclarationWithArbitrationReason has no E registry entry; its line reads « N terminal claims with a recorded refund error and an arbitration reason (Track B census; no E entry: F08 hides the reason on a declaration kind) ». J-M53's « sweep skip » for A-S32-* is pinned in tests/claims-t49-recovery.test.ts (runClaimAutoApproval, REFUNDS open, skips a legacy proof; negative control: the same claim with a null error is driven).

### I-08 [CORE] Customer e-mail miss signals (write time)
Every customer claim e-mail attempt that does not send is recorded in the same request:
- EmailLog row with status 'skipped', recipient `(non envoyé : ${why})`, subject `claim ${claimId}`, whenever the send was never reached (why ∈ claims_disabled, no_address, smtp_disabled, not_eligible, refunded_row_unproven, duplicate);
- or sendTransactional's own row for smtp or failed;
- plus console.error `[EMAIL MISS] [${template}] claim ${claimId} ${why}`;
- plus the operator toast when the attempt came from an operator route (claimsDisabled, or the D10 skip text).
An e-mail skip never changes claim state. No scheduled pass retries it: the only retry is D10(iv).
IMPLEMENTATION NOTE (W6) on ER-C19: the why values are H03's ClaimEmailWhy; I-08's no_address, not_eligible and duplicate never occur (no_recipient, the not_applicable result and the rail's 'duplicate' status stand for them). Exactly one EmailLog row per attempt that reaches a template: traceMiss when sendTransactional is never reached, the rail's own row otherwise; a not_applicable claim and a duplicate leave none. The console line is logEmailSkipped's « [EMAIL MISS] [trigger] not sent (why) — SKIPPED » with the claim id in its context, or, after the rail, « [EMAIL MISS] [trigger] claim <id> <why> ». Pinned by tests/claims-closure-emails.test.ts (J-C44).

### I-09 [CORE] Durable ungated surfaces and the payload that backs them
GET /api/admin/claims/financial-verification (resolveAdmin) returns:
- items financialVerification, reconcileRequired, otherUnsettled, unfinalizedRefundRows, refundedUnproven and closureNotices ({items, total, scanTruncated});
- per row, the D0 flags reconcilable, resolvable and approvable;
- counts {financialVerification, reconcileRequired, otherUnsettled, total, unfinalizedRefundRows, refundedUnproven, closureNoticesMissing}. total counts claims in the first three only.

listActionableRefundClaims OR gains:
- {status 'refunded', refundError startsWith REVERTED_AFTER_REFUND};
- {status 'refunded', refundError null, refundId in failed-with-id row ids}.

PIN (tests/claims-registry-visibility.test.ts): for one fixture per E entry, the claim appears in the bucket and count E names. E-09 appears in no bucket, a negative pin that documents the gap. E-13 and E-07 lists are disjoint. financialVerificationCardVisible is true for each of its four inputs alone.
IMPLEMENTATION NOTE (W7): the payload carries refundedUnproven and closureNotices as {items, total, scanTruncated} or {error: 'unreadable'}, read after the money Promise.all, each in its own catch; counts.refundedUnproven and counts.closureNoticesMissing are numbers or null, outside total. Per-row flags: reconcilable (every claim list), resolvable (otherUnsettled), approvable (every claim list). Pinned by tests/claims-registry-visibility.test.ts (J-M50 / J-C45 / J-C46) and tests/claim-closure-lists.test.ts (J-C30).

### I-10 [CORE] No scheduled job, no infra change (R-D8)
- No new cron entry, CI step or workflow change. The schedules of reconcile-refunds, stale-alerts and auto-approve are unchanged, and those routes gain no alert logic for these states.
- recoverStrandedClaimReconciliations is not an exit and is not the visibility of any E entry.
- Every I-01 to I-05 and I-08 signal is sent from the request or webhook that performs the write. I-06 and I-07 run only when an operator or the internal token asks.

SOURCE-SCAN PIN: the strings 'claim_payment_blocked' and 'claim_attempt_superseded' appear only in lib/admin-alerts.ts, lib/claims.ts and their tests.
IMPLEMENTATION NOTE (W5): ER-C23 resolved in J-M54 / J-C48 — app/api/cron does not exist; the cron routes are read from .github/workflows/cron.yml (reconcile-refunds and stale-alerts included) plus the auto-approve route. The I-05 refund:<re> key is also sent by lib/refund.ts markRefundRowFailed (the unchanged engine, I-05 « unchanged »), so the sender-site pin lists the webhook route and lib/refund.ts. POST reconcile-refunds now also accepts an admin session (AMF-1); its schedule is unchanged. Pinned by tests/claims-r13-absent-surfaces.test.ts and tests/claims-closure-imports.test.ts.
IMPLEMENTATION NOTE (W5 fixer): superseded in part by AMF-1 — the reconcile-refunds route (cron schedule unchanged) now also runs reverifySettledClaimRefunds, which sends the I-01 claim_payment_blocked alert (cause reverted_after_refund) from the request that writes each marking. « those routes gain no alert logic for these states » therefore no longer holds for reconcile-refunds; the alert is still sent at write time by the writing request, never by a schedule of its own, and stale-alerts and auto-approve gain nothing.

## J. TEST MATRIX — MONEY

One rule = one vitest file block (or one describe). Covers sections A, B, C, D, E, G, I. Every [CORE] rule of those sections is pinned by at least one test below. Shared fixture source: tests/fixtures/claims-r13-states.ts (new), with one entry per section-A state: {order, rows, royalty, claim pre-image, Stripe PI / charge / list / retrieve map, requested, expected {engineAccept: 'YES' | step, engineResume, exits, registry, customerKey, reconcileOutcome}}. The tests call the real lib/refund.ts, which is byte-identical (J-M06), against a mocked Prisma whose in-memory Refund store enforces @unique idempotencyKey (P2002) and a mocked Stripe client whose write methods are spies. Gate order (unchanged infra): vitest with its real exit status (${PIPESTATUS[0]}), then tsc, npm run check:i18n, check-flags and a cold build. J-M24 is the only test that needs a real database; CI never runs it.

### J-M01 [CORE] State-table fixture completeness
FILE: tests/claims-r13-state-table.test.ts (new)
PINS: A-S00, E0 (mapping). Presence of every A-S* id.
FIXTURE: tests/fixtures/claims-r13-states.ts, plus a list of the section-A rule ids extracted from the spec addendum docs/ops/CLAIMS-T49-FAIL-CLOSED-RECOVERY.md (round-13 table).
ASSERTION: every A id has exactly one fixture entry (variants are separate entries: A-S27-1b canonical and E4). All 10 expected fields are non-empty. Each registry value is one of E-01..E-18. No entry or expected text contains 'E5b', 'exclusiveReason' or 'awaiting_other_row'.
NEGATIVE CONTROL: the table with the A-S31d entry removed → red.
BREAK/RESTORE: delete the A-S01b entry → red; restore → green.
FINDINGS: R-A2-5 (split variants), C5, verifier A engine-field mismatches.
IMPLEMENTATION NOTE (W3): the addendum docs/ops/CLAIMS-T49-FAIL-CLOSED-RECOVERY.md has no round-13 table (it names no A-S id), so the id list is this spec's own `### A-S` headings minus A-S00, the conventions row (95 states). Each entry's ten fields are generated from its row with the withdrawn-guard vocabulary removed. Its registry ids are mapped by E0: REG-3 → E-03 or E-04 by « time-bound » / « permanent », and REG-6 adds E-08 when the row names the C6 breach. A row that only says « as A-Sxx » inherits that row's ids; terminal rows carry none. The same entries carry the executable facts that J-M03, J-M04, J-M43 and J-M49 run (tests/fixtures/claims-r13-states.ts, tests/claims-r13-state-table.test.ts).

### J-M02 [CORE] Engine mirror: refusal order, evidence classes, holds (pure)
FILE: tests/claims-r13-engine-mirror.test.ts (new; replaces the Track A predicate draft)
PINS: G5, G9, A-S00
FIXTURE: payable baseline = paid, PI present, piStatus succeeded, charge 2000 with amount_refunded 0, captured 2000, not disputed, routed false, requested 500, rows [], L []. Each case flips ONE fact:
- paymentStatus pending, or no PI → E1 (control: reconcile_manual → null);
- failed row with stripeRefundId → E2 (control: failed row without id, key ≠ refund:o:0 → null);
- piStatus requires_capture → E1b;
- pending oldest row per evidence: failed_at_stripe, dead, within_window, pending_at_stripe, succeeded_at_stripe, succeeded_at_stripe_clawback (royaltyRefundCents 300 + royalty settled; controls: royalty pending, or cents 0 → succeeded_at_stripe), truncated (no id + stripeListLength 101; control 100);
- tie at the same createdAt → both ids in oldestRowIds;
- refunded 2000 → E4;
- requested 0 / 1.5 / 1901 with 100 refunded → E5;
- failed-without-id row holding refund:o:0 → E6;
- succeeded row holding refund:o:0 → E6 (control: key 'refund:o:0:failed:re_x' → null).
Holds: H1 for each how (reverted, pending_at_stripe, absent, other_payment); H2 (routed + zero-owner failed refund); H3 (pending and succeeded contradiction); H5 disputed; H5 captured 1000 / refunded 600 / requested 500 (control: requested 400 → no hold).
ASSERTION:
- engineRefusalOnReapproval returns the first of E1, E2, E1b, E3, E4, E5, E6 on every pairwise overlap; never E1c; never E5b.
- reapprovalVerdict is 'payable' only with no refusal and no hold.
- lockIsTemporary is true only when: no hold, refusal E3, every oldest row succeeded_at_stripe (not clawback), not truncated.
NEGATIVE CONTROL: the failed-without-id key-holding fixture must NOT be payable.
BREAK/RESTORE: swap the E2 and E1b clauses → overlap fixture red. Restrict the E6 scan to non-failed rows → A-S01b red. Classify clawback as succeeded_at_stripe → lockIsTemporary true → red. Restore → green.
FINDINGS: P1-4, P1-7, R-A0-2, R-A2-5, verifier A engine mismatches.

### J-M03 [CORE] Engine parity: real executeRefund on every state without a pending row
FILE: tests/claims-r13-engine-parity.test.ts (new)
PINS: A-S00. ENGINE ACCEPTS / ENGINE RESUMES of A-S01, A-S01b, A-S02, A-S03, A-S04, A-S05a-1, A-S05a-2, A-S05b-2, A-S05c-2a, A-S05c-2b, A-S06a, A-S06b, A-S08a, A-S08b, A-S09b, A-S15b, A-S16a, A-S17, A-S18, A-S19, A-S20, A-S22b, A-S23a-1, A-S23a-2, A-S23b-1, A-S23b-2, A-S24-1, A-S24-2, A-S25, A-S26, A-S27-1a, A-S27-1b, A-S29-1, A-S29-2, A-S30, A-S30b-2a, A-S30c-2, A-S30d, A-S31-1, A-S31-2, A-S31b, A-S31c, A-S31e-1, A-S31e-2, A-S31f-1, A-S31f-2, A-S31f-3, A-S32-1, A-S32-2, A-S33-1, A-S34, A-S36-1, A-S36-2, A-S37, A-S38-1, A-S38-2, A-S39, A-S40, A-S41, A-S42, A-S43; G5 parity.
FIXTURE: the J-M01 table entry of each state. executeRefund({orderId, amountCents: requested, reason: claim:<id>}) is called with lib/refund.ts unchanged.
ASSERTION:
- Expected YES ⇔ refunds.create is called exactly once, idempotencyKey refund:<orderId>:<amount_refunded>, reverse_transfer set iff routed (A-S04, A-S31-2).
- Expected NO(step) ⇔ refunds.create is called 0 times, and status + message equal the A-S00 quote of that step.
- ENGINE RESUMES is NO for all of these: no driveRefund / refunds.retrieve on a pending row.
- The G5 mirror run on loadOrderMoneyFacts of the same fixture returns the same step.
- A-S39 disputed: Stripe create throws after the insert → 502, and the row stays pending with no id (CX).
- A-S34: mirror key external:re_D never collides at E6.
NEGATIVE CONTROL: A-S01b with its key renamed ':failed:re_x' → the engine creates (YES).
BREAK/RESTORE: set A-S05c-2b expected to NO (the withdrawn E5b answer) → red. Set A-S16a expected to NO (R-A0-5) → red. Restore YES → green.
FINDINGS: R-A0-5, R-A2-5, R-A1-3 (A-S04 routed), verifier A engine-field mismatches.

### J-M04 [CORE] Engine parity: resume-first (E3) states
FILE: tests/claims-r13-engine-parity.test.ts
PINS: A-S00 E3, G5 (clawback class), A-S13b. Engine fields of A-S07, A-S09a, A-S10, A-S10b, A-S10c, A-S11, A-S12, A-S12b, A-S13a, A-S13b, A-S14a-2b, A-S15a, A-S16b, A-S21, A-S22, A-S27-2, A-S29-3, A-S30b-2b, A-S30e-1, A-S30e-2, A-S30e-3, A-S30e-4, A-S30g, A-S31d, A-S33-2, A-S35, A-S36b.
FIXTURE: per state, plus:
(a) no-id pending row at 19 h → create re-sent under the row key;
(b) the same at 20.5 h;
(c) dead at 22 h;
(d) >100 refunds, oldest row id-less;
(e) failed_at_stripe;
(f) another claim's row succeeded at Stripe, royaltyRefundCents 0;
(g) clawback: royalty settled, royaltyRefundCents 300, settlement transfer locatable, age 21 h, listReversals without a tagged reversal;
(g2) the same clawback at age 1 h;
(g3) royalty settled, royaltyRefundCents 300, locateSettlementTransfer returns null;
(g4) royalty settled, royaltyRefundCents 300, listReversals has_more;
(h) recorded id 404 (A-S13a);
(i) recorded id on pi_OTHER, succeeded (A-S13b), without and with the (g) royalty facts.
ASSERTION:
- every case: ENGINE RESUMES YES (driveRefund reached), no fresh-key create;
- (a) create under the row key; (b) 409 ResumeIdempotencyExpired while refundRowTruth on the same row returns absent_within_window {until createdAt+21h} (A-S12b band); (c) 409; (d) 502 ResumeListUnavailable;
- (e) markRefundRowFailed then 409; a second call → E2 409;
- (f) ok resumed:true on the OTHER row;
- (g) 409 ResumeIdempotencyExpired(row:clawback), transfers.createReversal 0, row still pending, second call identical;
- (g2) createReversal once (idempotencyKey refund-claw:<row>), row succeeded: the engine CAN finish below 20 h. G5 still classes the row succeeded_at_stripe_clawback (any age, fail closed: the mirror reads neither the transfer nor its reversals, and a reversal failure leaves the row pending with 502) and lockIsTemporary is false;
- (g3) engine finalizes with createReversal 0; G5 classes clawback (documented fail-closed over-lock; exits reconcile + stuck_close);
- (g4) 502, row pending; G5 clawback;
- (h) 502 on every call;
- (i) without royalty: row marked succeeded with the foreign stripeRefundId, recordRefundLedgerEntry called 0 times and the warn « eager ledger line skipped » logged (resolveFeeTruth lists the order PI's refunds only); with the (g) royalty facts below 20 h: createReversal called once (money moves from the franchisor), ledger still 0;
- G5 returns step E3 with the same evidence class as J-M02 on every case.
NEGATIVE CONTROL: the (g2) row with royaltyRefundCents 0, and separately with royalty status 'pending' → engine finalizes with createReversal 0, and G5 classes succeeded_at_stripe with lockIsTemporary true (sole oldest row, no hold). The class boundary is royalty facts; age is never an input.
BREAK/RESTORE: add an age condition (≥ RESUME_CREATE_WINDOW_MS) to G5's clawback class → (g2) classes succeeded_at_stripe and lockIsTemporary true while (g) shows the same row can refuse forever → red; make A-S13b's fixture expect a ledger line → red; restore → green.
FINDINGS: R-A0-2, R-A2-5 (20-21 h band, A-S13b resume without ledger), V-A-1.
IMPLEMENTATION NOTE (W1): ER-M04 — any reading of the negative control as « a clawback-eligible pending row at 1 h is NOT clawback-locked » is superseded: G5 classes succeeded_at_stripe_clawback at any age (fail closed). The negative control is the (g2) row with royaltyRefundCents 0, or with royalty status 'pending', as stated above; the 1 h clawback row stays locked.

### J-M05 [CORE] Engine parity: PIX, E1, E2, E1b and E1c, and the facts-chosen quote
FILE: tests/claims-r13-engine-parity.test.ts
PINS: A-S05b-1, A-S05c-1, A-S14a-1, A-S14a-2a, A-S14b, A-S30b-1, A-S30c-1, G6 (no_charge), C3 (b') S sentence.
FIXTURE:
- PI retrieve throws with a pending row present (A-S05b-1, A-S05c-1, A-S14a-1);
- PI readable, list null (A-S14a-2a);
- latest_charge null with (a) paymentStatus pending, (b) piStatus requires_payment_method, (c) piStatus succeeded, (d) piStatus requires_payment_method plus a failed Refund row with a stripeRefundId.
ASSERTION:
- PI throw → 502, and driveRefund is not reached even with a pending row (PIX precedes E3);
- (a) E1 « Commande non payée — rien à rembourser. »; (b) E1b « Paiement non débité — rien à rembourser. »; (c) E1c « Charge introuvable sur le paiement. »; (d) E2 409 (refund.ts 744-750 precede the PI read);
- the C3 (b') SAFETY_HOLD text (A-S30c-1) embeds, for (a)-(c), exactly the quote the engine returned, and for (d) the E2 clause naming the failed row and no « Paiement non débité »;
- the G6 lock text (A-S14b) for (a)-(c) embeds the engine's quote; (d) is the G6 variant park stripe_refund_contradiction (a row with a stripeRefundId);
- loadOrderMoneyFacts returns {readable:false, permanent:'no_charge'} with rows, paymentStatus and piStatus for (a)-(d), and transient for a PI throw.
NEGATIVE CONTROL: variant (b) must NOT carry the E1c quote; variant (d) must NOT carry the E1b quote.
BREAK/RESTORE: select the E1c sentence unconditionally → (b) red; drop the E2 branch from C3 (b') → (d) red; restore → green.
FINDINGS: R-A1-5, verifier A (E1c only when E1/E1b do not fire), freeze verifier engine mismatch (E2 precedes E1b/E1c).
IMPLEMENTATION NOTE (W3), on J-M03 / J-M04 / J-M05: all three run in tests/claims-r13-engine-parity.test.ts on tests/support/claims-engine-world.ts. That harness runs the real lib/refund.ts against the same in-memory order, rows, royalty and Stripe objects the loader reads.
- Where the facts are not readable, J-M03's « the G5 mirror returns the same step » is asserted as « no step concluded ». This covers PIX (A-S05b-1, A-S05c-1, A-S14a-1), a list down and the over-cap list. On no_charge facts the step is deriveNoRowOutcome's noChargeStep.
- A-S25 and A-S26 are pinned on their E4 variant.
- For J-M04, G5's evidence is 'unclassified' on the contradiction states (A-S13a, A-S13b, A-S30g), and the loader is transient on A-S14a-2b and A-S30b-2b; those are asserted instead of a J-M02 class.
IMPLEMENTATION NOTE (W3, round-1 fix): the J-M04 extra cases now also run G5 on the loader of the same world and assert step E3 with the evidence class of the resumed row: (a) 19 h and (b) 20.5 h within_window, (c) 22 h dead, (e) failed_at_stripe, (f) succeeded_at_stripe, (g4) succeeded_at_stripe_clawback, (h) A-S13a and (i) A-S13b unclassified (tests/claims-r13-engine-parity.test.ts).

### J-M06 [CORE] Engine and webhook money writes stay closed
FILE: tests/claims-r13-engine-closed.test.ts (new)
PINS: C11 (guard recorded as a later decision), B4 (engine writers), D12 (money writes byte-identical), G11 (helper after the money writes).
FIXTURE: lib/refund.ts content with CRLF normalized to LF; SHA256_REFUND_40DA45E, a constant computed once from git blob 40da45e:lib/refund.ts by the implementer. handleRefundStatusEvent is driven with every collaborator spied, over four events: succeeded; failed on a pending row; failed on a succeeded row; failed redelivery on an already-failed row.
ASSERTION:
- sha256 of the file equals the constant;
- 'exclusiveReason' and 'E5b' occur nowhere in lib/, app/, scripts/ or messages/;
- per event, the ordered calls to handleChargeRefunded, finalizeRefundRowFromStripe, markRefundRowFailed and reconcileClaimForRefund equal the HEAD snapshot; markClaimsForRevertedRefundRow appears only AFTER them, and only in the failed/canceled branches;
- the succeeded branch never answers 5xx and never calls the helper;
- on the redelivery on a failed row, only the helper runs.
NEGATIVE CONTROL: redelivery on the failed row → markRefundRowFailed and reconcileClaimForRefund are called 0 times.
BREAK/RESTORE: add `exclusiveReason?: boolean` to the executeRefund input → hash red. Move the helper call above markRefundRowFailed → snapshot red. Restore → green.
FINDINGS: ARCHITECTURE DECISION (engine closed, R-D1 withdrawn), webhook_disposition (1)-(4).
IMPLEMENTATION NOTE (W3): ER-M10, J-M06 part, resolved. « the succeeded branch never answers 5xx » is pinned as « no NEW 5xx »: the branch's three HEAD 503 exits are counted and unchanged. The hash constant is the LF-normalized sha256 of git blob 40da45e:lib/refund.ts (1745dee70e936871beb23608b3bdf024ec4b0eae23c42ed1e98849108bd3a252). handleChargeRefunded is internal, so its place in the call order is observed through its first collaborator. markClaimsForRevertedRefundRow does not exist yet: the order pin accepts its absence, and once the webhook slice adds it the pin requires it after the money calls and only in the failed/canceled branch. The two comments in lib/claim-action-rules.ts that named the withdrawn guard were reworded, so the name occurs nowhere in lib/, app/, scripts/ or messages/ (tests/claims-r13-engine-closed.test.ts).

### J-M07 [CORE] One binder query and the three identity proofs
FILE: tests/claims-r13-identity.test.ts (new)
PINS: B1, B2, A-S18
FIXTURE:
- FV claim C, order o;
- row R succeeded, unstamped, bound to claim Z whose refundError is 'resume_mismatch: …';
- row R2 stamped claim:Y, bound to C;
- a row with amount and order equal to C's but no stamp or binding.
ASSERTION:
- boundToWhere(R, C) matches no claim;
- attributionRefusal pre-check for R → not bound_to_other_claim;
- deriveNoRowOutcome detail for C never names Z;
- the console bindings query for R is empty;
- B2 proves nothing for C from R2 (stamp ≠ C): G7 AM-A5 park;
- the equal-amount row proves nothing: no « rattaché », no « relève d’une autre réclamation ».
NEGATIVE CONTROL: set Z.refundError null → all three checks name Z (bound_to_other_claim, detail, console).
BREAK/RESTORE: replace the OR with a bare NOT startsWith → the null-error control is no longer a binder → red. Restore → green.
FINDINGS: P3-22, P1-6.
IMPLEMENTATION NOTE (W4): pinned in tests/claims-r13-identity.test.ts. DETAIL_UNATTRIBUTED (G7, frozen) says « n’est rattaché ni à l’identité de cette réclamation ni, de façon établie, à une autre réclamation » — a negated « rattaché » — so the equal-amount assertion pins that no sentence ASSERTS an attachment (« est rattaché à une AUTRE réclamation », « rattachés à d’autres réclamations soldées », « relève d’une autre réclamation »). The break/restore is run on the where itself (a bare NOT startsWith does not match the null-error binder under SQL NULL semantics).

### J-M08 [CORE] Owners of a Stripe refund; H2 only for zero owners
FILE: tests/claims-r13-identity.test.ts
PINS: B3, G5 (H2), A-S07, A-S08a, A-S08b
FIXTURE: routed payment. A failed Stripe refund re_F owned by:
(a) a pending row with stripeRefundId re_F;
(b) a pending id-less row whose id equals re_F.metadata.grubano_refund_row;
(c) a succeeded row;
(d) no row (A-S08a);
(e) two rows;
plus (f) = (d) not routed (A-S08b).
ASSERTION:
- ownersOf gives (a)(b)(c) one owner, (d) zero, (e) two;
- (e) is unexplained under N3/N5;
- H2 fires only for (d);
- (a)(b) give E3 failed_at_stripe and no H2 sentence;
- (c) gives H1 reverted;
- (f) gives no hold and a v13 payable proof carrying Q-INSTANT.
NEGATIVE CONTROL: (b) must NOT raise H2.
BREAK/RESTORE: drop the metadata clause from ownersOf → (b) gains H2 → red; restore → green.
FINDINGS: R-A1-3.
IMPLEMENTATION NOTE (W4): pinned in tests/claims-r13-identity.test.ts. « (e) is unexplained under N3/N5 » is asserted on a STANDING refund with two owners (N3/N5 examine standing refunds only; the failed re_F of (e) is not standing).

### J-M09 [CORE] Refund.reason is never written after creation (source scan)
FILE: tests/claims-identity-writers.test.ts (new)
PINS: B4, B6(1)
FIXTURE: a TypeScript-AST scan of app/, lib/ and scripts/, excluding tests/.
ASSERTION:
- the only prisma.refund.update / updateMany / tx.refund.update* call sites are the three in lib/refund.ts (markRefundRowFailed, resume, finalize), and none of their data objects has the key reason;
- the only refund.create sites are the engine insert and the adoption mirror (tx.refund.create in lib/claims.ts).
NEGATIVE CONTROL: a synthetic source string `prisma.refund.updateMany({ data: { reason: 'x' } })` fed to the scanner → reported.
BREAK/RESTORE: add `reason: 'x'` to the finalize data in a temp copy → red; restore → green.
FINDINGS: R-A2-1 (stamp immutability underpins one-refund-one-claim).

### J-M10 [CORE] Closed list of Claim.refundId writers (source scan)
FILE: tests/claims-identity-writers.test.ts
PINS: B5
FIXTURE: AST scan for every claim update / updateMany / tx.claim.updateMany whose data object has the key refundId.
ASSERTION: every site is one of W1-W8, the N8 proof write, or a T2(e') proof write (N8 and T2(e') write refundId null). The round-11 bind-first write in attributeClaimRefund is absent.
NEGATIVE CONTROL: resolveStuckClaim and markClaimsForRevertedRefundRow data objects contain no refundId key.
BREAK/RESTORE: re-insert `prisma.claim.updateMany({where:{id}, data:{refundId: row.id}})` before the Stripe read in attributeClaimRefund → red; restore → green.
FINDINGS: P2-14, R-A2-1.

### J-M11 [CORE] T3 identity after the engine is three-way (unknown ≠ not ours)
FILE: tests/claims-r13-trigger.test.ts (new)
PINS: B7, B12 (T3), A-S15a, A-S15b, A-S16a, A-S16b, I-01 (identity_unverified, resume_mismatch)
FIXTURE: claim at T4 (refunding, M). The engine returns:
(a) ok resumed:false;
(b) ok resumed:true, refund.findUnique rejects;
(c) 202, findUnique rejects;
(d) ok resumed:true, row null;
(e) ok resumed:true, reason claim:OTHER (A-S15b);
(f) 202, reason claim:OTHER, row pending (A-S15a);
(g) reason claim:<this>.
ASSERTION:
- (a) → refunded, findUnique never called;
- (b)(d) → CAS where {id, status 'refunding', refundError: M}, data refundError = M + the B7 text containing « n’a pas pu être relue » and « a abouti chez Stripe », refundId unchanged (null), result {failed, 'identity_unverified'}, ALERT-B cause identity_unverified;
- (c) → the same with « reste en attente »;
- (e)(f) → resume_mismatch texts, ALERT-B cause resume_mismatch;
- (g) → refunded or 202 bound;
- source scan: « n’appartient PAS » occurs only in the two not_ours data literals.
NEGATIVE CONTROL: (b) output must NOT contain « n’appartient PAS » or « mais pas au titre de cette réclamation ».
BREAK/RESTORE: map a thrown read to 'not_ours' → (b) red; restore → green.
FINDINGS: P1-2.

### J-M12 [CORE] Legacy resume_mismatch on the claim's own row
FILE: tests/claims-r13-identity.test.ts
PINS: B8, D5 (ii), A-S36-1, A-S36-2, A-S36b, E-05, E-14
FIXTURE: refunding claim C, refundId R, refundError 'resume_mismatch: …'. R reason claim:C with status (a) succeeded / (b) failed with id / (c) pending. Terminal variant (d): refunded + resume_mismatch on its own row.
ASSERTION:
- ownRowMismatch true;
- reconcileRefusal null; isStuckResolvable false; moneyLineFor → identity_unread;
- reconcile: (a) mine===1 → refunded; (b) approved + stripe_failed + ALERT-B; (c) applyRowTruth per truth;
- reconcileClaimForRefund counts C as a candidate;
- (d) is not listed in otherUnsettled and is counted in census ownRowResumeMismatch.terminal.
NEGATIVE CONTROL: R reason claim:OTHER → ownRowMismatch false, reconcile refused, stuck_close accepted, reconcileClaimForRefund not_bound. boundRow read rejects → both reconcile and stuck_close answer the B12 409.
BREAK/RESTORE: drop the reason comparison from ownRowMismatch → the OTHER control is admitted to reconcile → red; restore → green.
FINDINGS: verifier B P1 (own-row mismatch closable only by assertion).
IMPLEMENTATION NOTE (W2): (a)-(c), the webhook candidate, the refused declaration, the list flags and the B12 negative control are pinned (tests/claims-r13-identity.test.ts). The ALERT-B after the (b) stripe_failed write is the applyRowTruth trigger of W3; (d) is the census slice.

### J-M13 [CORE] A row with two or more binders settles nothing
FILE: tests/webhook-refund-reconciliation.test.ts (extended)
PINS: B9, A-S43, E-12
FIXTURE: row R succeeded, unstamped, bound to claims C1 (refunding, null error) and C2 (approved, null error); webhook finalize event for R. Second fixture: C1 FV reconciled with R as its bound row. Third: listConsumerClaims for C1 and C2 both refunded on R (legacy).
ASSERTION:
- reconcileClaimForRefund uses claim.findMany → {reconciled:false, reason:'ambiguous_binding'}, 0 updateMany, console.error '[MONEY REVIEW] ambiguous_binding'; the webhook answers 200;
- applyRowTruth, before settling, counts boundToWhere(R, C1) > 0 → park reconcile_not_applied with the B9(b) detail, nothing refunded;
- the customer groupBy count ≥ 2 → refundedRow null → both read financial_verification, never refunded.
NEGATIVE CONTROL: only C1 bound → C1 refunded and its customer reads refunded.
BREAK/RESTORE: revert to findFirst → C1 settled → red; restore → green.
FINDINGS: R-A2-1 (legacy multi-binder), verifier A (A-S43 never RFc).
IMPLEMENTATION NOTE (W4): pinned in tests/webhook-refund-reconciliation.test.ts through the real webhook route (the money writes untouched), reconcileClaimEvidence and listConsumerClaims.
IMPLEMENTATION NOTE (W4, fixer round 1): the second fixture « C1 FV reconciled with R as its bound row » cannot reach the B9 (b) count as written. reconcileClaimEvidence takes the bound path (reconcileBoundClaim → applyRowTruth) only for approved / refunding with a null error (G2 (2)); an FV pre-image takes G2 (3) — mine, then N0-N8 — where the unstamped R is not its row. The B9 (b) park is therefore pinned on the refunding entry, and the FV variant is pinned as never settled on R (no claim refunded). The describe's claim.findFirst mock now answers from the same world, so the BREAK/RESTORE (the reconciler reverted to findFirst) reaches the settling CAS: C1 settles (reconciled true) and the test fails on the invariant itself — run and observed red, then restored byte-identical.

### J-M14 [CORE] Attribution identity refusals: order and server/console parity
FILE: tests/claims-r13-attribution.test.ts (new)
PINS: B10, D8 (1)-(3), A-S17, A-S22b
FIXTURE: FV claim C, with one row per refusal: other order; stamped claim:Y; own stamp beside an unstamped row; bound to settled Z (A-S17); claim not FV; failed row with id (A-S22b); a pending row without id (must NOT be refused).
ASSERTION:
- codes returned in order (1)..(6) when several apply;
- A-S17 → 409 with the B10(4) text naming Z;
- A-S22b → 409 row_failed with the exact B10(6) text, REFUSAL_LEGEND row_failed, « Attribuer » disabled;
- the pending id-less row passes the pre-check;
- the console candidate flag equals the server pre-check for every fixture.
NEGATIVE CONTROL: bound only to a resume_mismatch claim → not refused.
BREAK/RESTORE: remove the row_failed clause → the failed row reaches the Stripe read → red; restore → green.
FINDINGS: P2-14, P3-22, A-S22b gap.

### J-M15 [CORE] Adoption mirror identity and the post-mirror refusal
FILE: tests/claims-r13-adoption.test.ts (new)
PINS: B11, D9, A-S19, A-S34
FIXTURE: FV claim C; re_D succeeded, untagged, on the order PI and latest charge, amount ≤ captured. Variants:
(a) fresh;
(b) an existing mirror external:re_D stamped claim:C;
(c) the mirror commits, then C changes status before attributeWithEvidence;
(d) re_D tagged grubano_refund_row;
(e) re_D pending.
ASSERTION:
- (a) mirror key `external:${re_D}`, reason claim:C → attributeWithEvidence → refunded {evidence 'stripe_read', amountCents re_D.amount}; refunds.retrieve called once;
- (b) trace.wrote false before any refusal, attributeWithEvidence reads Stripe, and the dead check formerly at 2109 is absent (source pin);
- (c) 409 wrote:true with the exact B11(c) text containing « La ligne miroir »; the mirror is not deleted;
- (d)(e) refused, refund.create called 0 times.
NEGATIVE CONTROL: a second adoption of re_D for claim C2 → P2002 → 409, wrote:false, one mirror total.
BREAK/RESTORE: skip the tag check → (d) creates a mirror → red; restore → green.
FINDINGS: R-A0-4 (non-adopted variant), P1-3.
IMPLEMENTATION NOTE (W4): pinned in tests/claims-r13-adoption.test.ts. The negative control’s sequential second adoption of re_D for C2 is refused by the existing-row guard (the mirror carries claim:C) with wrote false and one mirror; the P2002 answer is J-M25 (b). (c) is pinned twice: C closed after the mirror commit, and C relabelled inside the binding transaction (a relabel before attributeWithEvidence reads the claim is simply its new pre-image: the claim is still FV and binding the mirror is right).
IMPLEMENTATION NOTE (W4, fixer round 1): the B11 (a)/(c) variants and wrote semantics of the B11 fixer note are pinned in the same file (block « B11 (a)/(c) W4 fixer »). (b) also pins that a refusal's facts are Stripe's (status failed, source stripe), and that a refusal before any Stripe read carries none.

### J-M16 [CORE] A failed identity read is never a negative identity
FILE: tests/claims-r13-identity.test.ts
PINS: B12, G3 (never throws)
FIXTURE: one rejecting mock per read: the T3 reason; boundRow; binder findFirst / findMany; the owners' rows; the stamped rows of G3; the N8 stamped re-query; the T2(a) stamped query. Callers: reconcileClaimEvidence, resolveStuckClaim, attributeClaimRefund, adoptStripeRefundInner, triggerClaimRefund, loadOrderMoneyFacts.
ASSERTION:
- route functions → {ok:false, 409, error 'La base n’a pas pu être lue : l’identité du remboursement n’est pas établie et rien n’a été modifié. Réessayez.'}, with 0 claim updateMany, 0 audit, 0 alert;
- T3 → 'unknown';
- loadOrderMoneyFacts → {readable:false, permanent:null};
- T2 → transient revert (C3(b));
- no output contains not_ours, bound_to_other_claim, « relève d’une autre réclamation » or a 'no_refund_proven' prefix.
NEGATIVE CONTROL: the same reads resolving empty → the normal outcomes, not the 409.
BREAK/RESTORE: catch the binder read as `null` (no binder) in attributeClaimRefund → attribution proceeds → red; restore → green.
FINDINGS: P1-2, P3-22.
IMPLEMENTATION NOTE (W2, round-1 fix): the adoptStripeRefundInner fixture — the existing-mirror read and the stamped-row read rejecting → the B12 409 with wrote false, 0 claim writes, 0 refund.create, 0 audit, 0 alert; a dry-run negative control with both reads resolving — is in tests/claims-r13-identity.test.ts.

### J-M17 [CORE] CAS discipline on every money-path claim write
FILE: tests/claims-r13-cas.test.ts (new)
PINS: C1
FIXTURE:
- AST scan of triggerClaimRefund, reconcileClaimEvidence, applyRowTruth, reconcileBoundClaim, enterFinancialVerification, attributeClaimRefund, attributeWithEvidence, adoptStripeRefundInner, reconcileClaimForRefund, markClaimsForRevertedRefundRow, resolveStuckClaim, runClaimAutoApproval;
- behavioural: two concurrent reconcileClaimEvidence calls on one v13 claim (mock: first updateMany count 1, second 0); two concurrent approvals of one approved claim.
ASSERTION:
- no prisma.claim.update( in these functions;
- every updateMany where carries status and refundError, plus refundId / refundAttempted when the decision read them;
- reconcile race → exactly one write, one ALERT-B, and the loser returns {ok:true, outcome:'changed_during_read'};
- approval race → one T1 CAS, loser already_handled, executeRefund called once.
NEGATIVE CONTROL: the loser sends no alert, no audit and no success outcome.
BREAK/RESTORE: replace one applyRowTruth write with update({where:{id}}) → scan red and the race writes twice → red; restore → green.
FINDINGS: R-A1-2, CONVERGENCE (no duplicate finalization).
IMPLEMENTATION NOTE (W2): the source scan resolves where clauses with balanced braces and through `where: <identifier>`. The reconcile race asserts one matched write, a loser with no audit and no proof outcome; the ALERT-B of the N8 write is W3's.
IMPLEMENTATION NOTE (W2, round-1 fix): the scan also requires refundId in applyRowTruth's where and refundAttempted in every T1/T2 where and in the N8 writer (negative controls for both); a second race reaches applyRowTruth (an own stamped row): one bind, one settle, the loser changed_during_read, no alert. The v13 reconcile race asserts the winner's single ALERT-B (D4) and the loser's changed_during_read.

### J-M18 [CORE] Attempt token M and T1
FILE: tests/claims-r13-trigger.test.ts
PINS: C2, D2 (3)
FIXTURE: reconcileRequiredMarker(now, uuid) twice at the same instant. Approved claim pre-images: null; v13 past instant; v13 before instant; v13 with unreadable instant; AWAITING; RAIL_LOCKED; SAFETY_HOLD; refundId set; missing claim. A concurrent change of refundError between read and CAS.
ASSERTION:
- the two markers differ;
- reconcileMarkerAge parses the ISO and ignores the nonce; the ISO precedes « (tentative »;
- null and v13-past → updateMany where {id, status 'approved', refundAttempted false, refundId null, refundError: before} → data {refunding, true, M};
- every other pre-image → already_handled, 0 writes, executeRefund 0;
- concurrent change → count 0 → already_handled;
- no copy in messages/fr.json or lib/ says closing the REFUNDS lease stops an attempt in flight (regex /ferm\w+ .*(bail|remboursements).*arr[êe]t/ on the enumerated D14 list).
NEGATIVE CONTROL: a refundError 'no_refund_proven:v13:' with a unique nonce marker is still refused before its instant.
BREAK/RESTORE: drop refundError from the T1 where → the concurrent change fixture writes → red; restore → green.
FINDINGS: R-A1-2, CONVERGENCE (T1 approval is not T2 authority).

### J-M19 [CORE] T2: step order, every branch writes by CAS on M and never calls the engine
FILE: tests/claims-r13-trigger.test.ts
PINS: C3, A-S30, A-S30b-1, A-S30b-2a, A-S30b-2b, A-S30c-1, A-S30c-2, A-S30e-1, A-S30e-2, A-S30e-3, A-S30e-4, A-S30g, A-S33-1, A-S33-2, A-S39, I-01 (T2 causes)
FIXTURE: approved claim, pre-image null (and v13 past instant), T1 passed. Facts per state from J-M01. Overlap fixtures:
- own stamped row + Stripe unreadable;
- transient unreadable + H1;
- H3 + pending row of another claim.
ASSERTION:
- (a) own row (A-S33-*) → own_row_exists text « Vérification avant moteur », where {id, refunding, true, M};
- (b) transient → status approved, refundAttempted false, refundError EXACTLY before, cause safety_check_unreadable, toast success tone;
- (b') no_charge / list_over_cap → SAFETY_HOLD, refundAttempted true, error tone;
- (c) H1/H2/H3/H5 → SAFETY_HOLD with the G8 hold sentences + ROUTED;
- (e') A-S30e-1 locked and A-S30e-2 AWAITING → approved, refundAttempted false, refundId null, {failed,'proof_stale'}, never reverted to null;
- A-S30e-4 → FV via enterFinancialVerification expect {refunding, M};
- A-S30e-3 → revert, cause unconfirmed_within_window, « Conclusion possible à partir du »;
- overlaps resolve in the order a < b < b' < c < e';
- executeRefund called 0 times in every branch;
- 'awaiting_other_row' is absent from lib/ and messages/;
- every T2 write with count 0 → attempt_superseded and no further write.
NEGATIVE CONTROL: baseline payable with no hold → executeRefund called once, reason claim:<id>, no T2 write.
BREAK/RESTORE: restore the deleted step (d) revert → A-S30e-1 reverts to null → red; remove the T2 call → the H1 fixture calls executeRefund → red; restore → green.
FINDINGS: V-A-1, R-A1-5, R-A2-3, verifier A P1 (S30e).

### J-M20 [CORE] HARD INVARIANT: a payable proof invalidated between approval and the money call
FILE: tests/claims-r13-fresh-proof.test.ts (new)
PINS: C3 (e')(f), C4, D2 (4)-(5), A-S01, A-S02, A-S08b, A-S38-1, A-S38-2, G14
FIXTURE: claim approved with a v13 proof whose Q-INSTANT has passed (arbitrationRefusal null). The approve route runs T1. Then, between T1 and T2's reads, the mocks inject ONE change:
(1) a new succeeded untagged Dashboard refund;
(2) the same with refundable < requested (A-S38-2);
(3) an admin-rail row succeeded, unstamped;
(4) a pending row of another claim (dead);
(5) a pending row within the window;
(6) a row now holding refund:o:<amount_refunded>;
(7) a failed row with stripeRefundId;
(8) the bound row of the other claim (HEAD_B) reverted at Stripe (H1);
(9) a dispute on the charge;
(10) an own stamped row;
(11) at step (f) the claim is changed to FV by another request;
(12) the pending row succeeded at Stripe without clawback.
ASSERTION: executeRefund and refunds.create are called 0 times in all 12 variants. Results:
- (1)(2)(3) → FV refund_moved_unattributed {failed,'proof_stale'} + ALERT-FV;
- (4)(6)(7) → 'no_refund_proven_rail_locked:' + ALERT-B;
- (12) → AWAITING;
- (5) → pre-image v13 restored + ALERT-B unconfirmed_within_window;
- (8)(9) → SAFETY_HOLD;
- (10) → own_row_exists;
- (11) → attempt_superseded, no write.
The approve response never renders a success toast.
NEGATIVE CONTROL: no injected change → executeRefund called exactly once with amountCents = requested, then T4 refunded.
BREAK/RESTORE: skip (e') when the pre-image is v13 (the round-12 « E1-E6 not pre-checked » behaviour) → variant (1) calls executeRefund → red; restore → green.
FINDINGS: R-A0-3, V-A-1, CONVERGENCE (payable proof must be fresh).
IMPLEMENTATION NOTE (W2): variant (2) cannot land in FV as written. C3 runs (c) before (e'), and H5 captured (requested > amount_captured − amount_refunded) holds whenever E5 does while amount_captured = amount, so the variant is written as SAFETY_HOLD (H5 captured). No money moves either way; the test pins the SAFETY_HOLD outcome.
IMPLEMENTATION NOTE (W2, round-1 fix): supersedes the note above — variant (2) lands in FV refund_moved_unattributed (proof_stale, ALERT-FV) as specified, because H5 captured is restricted to states where the engine would insert (G5 note). Variants (3), (6) and (7) now also assert ALERT-FV, the 'no_refund_proven_rail_locked:' prefix and ALERT-B.

### J-M21 [CORE] Quiescence instant of a payable proof
FILE: tests/claims-r13-quiescence.test.ts (new)
PINS: C4, D3, D14 (0), A-S01 (instant in copy), I-01 (quiescenceInstant fact)
FIXTURE:
- ATTEMPT_QUIESCENCE_MS;
- proofInstantFor with pre-images: (1) marker at T0 → T0+Q; (2) v13 carrying instant I → I; (3) null → now+Q;
- arbitrationRefusal('approve') at instant−1 ms, at instant, with the instant text removed, with an unparsable date;
- runClaimAutoApproval with a v13 claim.
ASSERTION:
- ATTEMPT_QUIESCENCE_MS ≥ 3 600 000;
- rules (1)(2)(3) as stated;
- every N8 / T2(e') PROOF_PAYABLE_V13 text contains « payable au plus tôt le <ISO> (UTC) » parsable by C4's proofInstant;
- instant−1 ms → the C4 text « Approbation prématurée : la preuve d’absence de cette réclamation ne permet un paiement qu’à partir du … (UTC) ; … », 'approve' still in acceptedExits, and none of D14 (1)-(3);
- at instant → null;
- unreadable or unparsable → the C4 text « Approbation impossible : l’heure à partir de laquelle cette preuve d’absence permet un paiement n’a pas pu être lue. … »;
- T1 before instant → already_handled, 0 writes;
- the sweep calls triggerClaimRefund 0 times;
- source scan: exactly one instant parser (proofInstant) exists, it is a regex literal (no `new RegExp(`), and no parseQuiescenceInstant identifier exists.
NEGATIVE CONTROL: a legacy 'no_refund_proven:' (no v13) is never admitted by the instant check; it gets D14 (1).
BREAK/RESTORE: set ATTEMPT_QUIESCENCE_MS to 5 min → red; make proofInstantFor ignore the marker (rule 1) → a proof written 10 min after an attempt start is payable before start+Q → red; restore → green.
FINDINGS: engine_guard_disposition (Q1/Q2 replace E5b), R-A0-3, freeze verifier (C4/D3 duplicate).
IMPLEMENTATION NOTE (W1, round-1 fix): the « one parser » scan is a lexer-light pass that finds the phrase inside every RegExp construction — regex literal, RegExp(...) / new RegExp(...) arguments, String.raw template — and its negative control runs that same scanner on synthetic parsers (quoted, String.raw, loosened literal) and writers. The sweep assertion is landed (C4 note), with the RELEASE GATE pin. « T1 before instant → already_handled, 0 writes » lands with the T1 slice.

### J-M22 [CORE] HARD INVARIANT: a late or stalled attempt never overwrites a claim bound, reconciled or closed since
FILE: tests/claims-r13-stale-attempt.test.ts (new)
PINS: C5, B6(4), A-S41, E-11, I-03
FIXTURE: executeRefund mock held open (deferred promise) after T1 wrote M to claim Y. While it is held:
(A) Y is parked FV, then attributed to R2 (refunded);
(B) Y is reconciled to a v13 proof;
(C) Y is closed by resolve-stuck closed_no_payment;
(D) Y is parked FV.
Release with:
(i) ok resumed:true on R9 stamped claim:OTHER;
(ii) ok resumed:false own row;
(iii) 202 pending;
(iv) refusal 409;
(v) own row not failed;
(vi) engine_failed.
Then FV claim W attributes R2.
ASSERTION:
- every post-engine write is updateMany where {id, status 'refunding', refundError: M} (AST pin over writes 1-9 of C5), count 0;
- Y's status, refundId and refundError are byte-identical to the state before release;
- (i)(ii)(iii) → claim_attempt_superseded sent once, dedupe claim_attempt:<Y>:<refundRowId>, facts {claimId, orderId, refundRowId, stripeRefundId, engineStatus, resumed, claimStatusNow};
- (iv)(v)(vi) → console.warn only, no alert;
- result {failed,'attempt_superseded'};
- W's attribution of R2 → 409 bound_to_other_claim;
- the I-03 title and facts never say paid twice / owed / must be reversed.
NEGATIVE CONTROL: no concurrent change → (ii) writes refunded with refundId = own row (count 1).
BREAK/RESTORE: revert the not_ours write to prisma.claim.update({where:{id}}) → (A)(i) rewrites Y.refundId to R9, and W's attribution of R2 succeeds → red; restore → green.
FINDINGS: R-A1-2, CONVERGENCE (a late attempt must not overwrite).

### J-M23 [CORE] HARD INVARIANT: two concurrent bindings of one Refund — exactly one succeeds (mocked)
FILE: tests/claims-r13-attribution.test.ts
PINS: C6, C7, B6(2), D8, H05 (sites 4-5), A-S42, I-04
FIXTURE: an unstamped succeeded row R (and a pending variant proven succeeded) on order o. FV claims B1 and B2. Stripe evidence read before the transaction. The $transaction mock simulates shared locks: two interleaved callbacks deadlock and the second rejects with PrismaClientKnownRequestError P2034. Sequential mode commits the first; the second's findFirst sees the binding. Additional rejections: P2028; code 1020; 'Connection lost' after the callback resolved (the commit landed); a generic Error; recordClaimClosure resolving true and false.
ASSERTION:
- prisma.$transaction is called with isolationLevel Serializable, maxWait ≤ 2000, timeout ≤ 5000;
- AST pin: the callback references only tx (no prisma., stripe, recordClaimClosure, recordAdminAudit, send*);
- exactly one claim ends {refunded, refundId R}; the other keeps status FV and its original refundError;
- loser outcomes: P2034/P2028/1020/generic with the re-read unchanged → 409 « Cette réclamation, ou ce remboursement, a changé entre-temps — rien n’a été écrit. Relisez sa ligne dans la file. »; claim_changed abort → 409 « Cette réclamation a changé d’état entre-temps — elle n’a pas été modifiée. … »; sequential → 409 bound_to_other_claim naming the winner; re-read throws → 409 « État non établi … »;
- lost commit with a re-read showing {refunded, R} → recordClaimClosure called once, then 409 with the C7 « déjà liée à ce remboursement » text: record true → the variant naming « Avis client non envoyés »; record false → the variant « l’enregistrement de sa clôture a échoué ». Never 200, never ok; 0 audit, 0 I-04, 0 notice attempt;
- a loser whose claim is unchanged: 0 records, 0 audits, 0 notices, 0 I-04, no success toast;
- the winner, only after the resolved promise and in this order: recordClaimClosure, I-04 (pending row only), audit {moneyMoved:false}; then the route's notice attempt;
- the console renders body.error for every 409.
NEGATIVE CONTROL: two different rows R and R' → both commit.
BREAK/RESTORE: move the binder findFirst before prisma.$transaction → both callbacks commit in the interleaved mode → red; answer 200 on the lost-commit re-read → red; restore → green.
FINDINGS: R-A2-1, CONVERGENCE (one Refund never settles two claims), P2 toasts, freeze verifier (D8 vs C6/C7), R-B1-1.
IMPLEMENTATION NOTE (W4): pinned in tests/claims-r13-attribution.test.ts with tests/support/serializable-sim.ts (shared locks on every scanned claim row, exclusive writes, a deadlock victim rolled back) and the AST pin tests/support/tx-callback-pin.ts. The negative control (two different rows) commits both when run sequentially. Interleaved bindings of two DIFFERENT rows can also deadlock, because the binder read share-locks every claim row (no index on refundId): the victim writes nothing and states it, and a retry commits (pinned).
IMPLEMENTATION NOTE (W4, fixer round 1): the loser texts follow the C7 fixer note. The unchanged re-read (P2034, P2028, 1020, a generic error, the different-row deadlock) answers « La liaison n’a pas pu être enregistrée (écriture concurrente ou erreur de la base) — rien n’a été écrit. Relisez sa ligne dans la file, puis réessayez. »; the lost commit with the record written ends « … ; sa clôture est enregistrée. Relisez sa ligne dans la file. ».
IMPLEMENTATION NOTE (W8): the different-row residual of the W4 note (two attributions of different rows can deadlock on the full binder scan; the victim writes nothing and states it, and a retry commits) is stated in docs/ops/REFUND-FINANCIAL-CONTRACT.md §25.

### J-M24 [CORE] HARD INVARIANT: two concurrent bindings — real two-connection rehearsal
FILE: tests/claims-attribution-race.db.test.ts (new; describe.skipIf(!process.env.CLAIMS_RACE_DATABASE_URL))
PINS: C10, C6, B6, A-S42
FIXTURE: a disposable MariaDB of o2switch's major version (12.x), never staging data. The schema is pushed with ./node_modules/.bin/prisma db push. Two PrismaClient instances. Row R unstamped succeeded; FV claims C1 and C2 on the same order. Evidence is injected into attributeWithEvidence (no Stripe). 20 iterations with a reset between them, both calls started through Promise.all behind a shared barrier.
ASSERTION: every iteration has exactly one claim {refunded, refundId R}; the other is unchanged (FV, original refundError); the loser's result is an AttributionAbort or C7 409, never ok. Server version and outcome counts are logged for docs/ops/REFUND-FINANCIAL-CONTRACT.md.
NEGATIVE CONTROL: the same run with isolationLevel omitted (ReadCommitted) is recorded, expecting at least one iteration with two refunded claims or zero failures. It documents why Serializable is required, and runs only under CLAIMS_RACE_NEGATIVE=1.
BREAK/RESTORE: the binder read outside the transaction → an iteration with two refunded claims → red; restore → green.
FINDINGS: R-A2-1, schema_reason (no @@unique). Not a CI test (R-D8); a one-time pre-window gate.
IMPLEMENTATION NOTE (W4): ER-M10 (J-M24 part) — the negative control omits isolationLevel, i.e. the server default, REPEATABLE READ on MySQL / MariaDB, not ReadCommitted. See the C10 note: not run yet (OPEN).
IMPLEMENTATION NOTE (W4, fixer round 1): RUN (C10 fixer note; docs/ops/REFUND-FINANCIAL-CONTRACT.md §20). The invariant held in 20/20 iterations, the negative control bound R twice in 20/20, and the break/restore went red at iteration 0. The negative control's proxy now calls $transaction bound to the real client: a detached call would not have been the client the code uses.
IMPLEMENTATION NOTE (W8): CLOSED — the « not run yet (OPEN) » of the W4 note is superseded by its fixer note (RUN) and by the orchestrator's re-run on d555f6f (C10 W8 note: MariaDB 12.3.2, 20/20 with exactly one winner, winners 9 / 11, negative control 20/20 both bound). The rehearsal is re-run on the final certified release-candidate SHA before any Claims window (docs/ops/CLAIMS-R13-OPERATOR-PRECHECK.md Étape 3); it is never a CI test and never targets staging or production.

### J-M25 [CORE] Adoption mirror insert under a Serializable transaction
FILE: tests/claims-r13-adoption.test.ts
PINS: C8, D9 (4)-(6)
FIXTURE: fresh adoption of re_D for FV claim C. The $transaction mock variants:
(a) the stamped-row read inside tx finds a row claim:C;
(b) the insert raises P2002;
(c) a generic error, then re-read finds stripeRefundId re_D with reason claim:C;
(d) a generic error, re-read finds nothing;
(e) a generic error, re-read throws;
(f) two concurrent adoptions of two different refunds for C.
ASSERTION:
- call shape Serializable, maxWait ≤ 2000, timeout ≤ 5000; the callback holds only the stamped read and tx.refund.create;
- (a) 409 wrote:false « Un remboursement porte déjà l’identité de cette réclamation sur cette commande : aucune ligne miroir n’a été écrite. … », refund.create 0;
- (b) 409 wrote:false with the existing text;
- (c) treated as a commit, trace.wrote true, attributeWithEvidence called;
- (d) 409 wrote:false « L’enregistrement de la ligne miroir n’a pas pu être confirmé … »;
- (e) 409 wrote:null « État non établi … »;
- (f) exactly one mirror stamped claim:C;
- dryRun → 0 transactions.
NEGATIVE CONTROL: no stamped row → one mirror, then refunded.
BREAK/RESTORE: move the stamped read outside the transaction → (f) writes two mirrors → red; restore → green.
FINDINGS: R-A2-1, A-S34.
IMPLEMENTATION NOTE (W4): pinned in tests/claims-r13-adoption.test.ts. (c) also asserts that the adoption audit is not written a second time (ER-M08, C8 note).
IMPLEMENTATION NOTE (W4, fixer round 1): (c) pins C7's log line '[claims] binding transaction aborted' on the C8 path (C8 fixer note).

### J-M26 [CORE] Pre-images of reconcile, apply, park and close writes
FILE: tests/claims-r13-cas.test.ts
PINS: C9, I-02
FIXTURE: for each of applyRowTruth (bind, at_stripe succeeded/failed/pending, reverted, absent_dead), reconcileClaimForRefund (both CASes), enterFinancialVerification (entry, relabel), N8 proof write, resolveStuckClaim (approved, and the refunded REVERTED declarations) and markClaimsForRevertedRefundRow: the mock changes claim.refundError between the decision read and the write.
ASSERTION:
- each write's where contains the read status, refundError and refundId; count 0 → 0 further writes, changed outcome (changed_during_read / {entered:false} / 409 « a changé d’état entre-temps »), no alert;
- tsc: enterFinancialVerification without `expect` fails to compile (a ts-expect-error fixture);
- entry admitted only from approved or refunding;
- relabel with a NEW reason → claim_financial_verification dedupe claim_fv:<id>:<reason>; same reason → no alert.
NEGATIVE CONTROL: unchanged refundError → count 1 and the normal outcome.
BREAK/RESTORE: restore resolveStuckClaim's `refundError: { not: null }` where → the changed fixture writes → red; restore → green.
FINDINGS: R-A1-2, R-A2-1.

### J-M27 [CORE] Residuals stated verbatim
FILE: tests/claims-r13-residuals.test.ts (new)
PINS: C11, D2 (RESIDUALS)
FIXTURE: docs/ops/REFUND-FINANCIAL-CONTRACT.md; the it.skip blocks in tests/claims-r13-stale-attempt.test.ts.
ASSERTION:
- the section « Résidus round 13 » contains R1-R5 verbatim as listed in C11;
- it records the exclusiveReason guard as a founder decision for a later round;
- it records the J-M24 rehearsal (server version + result) before any window;
- the it.skip reasons are R1, R2, R3 and R4, and each skip reason string equals its doc sentence.
NEGATIVE CONTROL: the doc without R5 → red.
BREAK/RESTORE: edit one word of R3 in the doc → red; restore → green.
FINDINGS: engine_guard_disposition residuals, verifier A P3 (cursor moved without an engine create).
IMPLEMENTATION NOTE (W8): pinned in tests/claims-r13-residuals.test.ts. The five texts are read out of C11 and compared with the bullets « - **(Rn)** … » of docs/ops/REFUND-FINANCIAL-CONTRACT.md §24 and with the it.skip reasons of tests/claims-r13-stale-attempt.test.ts (R1-R4; R5 in the doc only, C11 note). Negative controls: the doc without R5, one word of R3 changed, a skip reason reworded, the section renamed and the re-run sentence removed are each red. Break/restore run in W8: « Dashboard » → « Stripe » in the doc's R3 turned the file red; restored byte-identical, green. The same file carries the W8 sweep: every B-I rule cited outside this file or noted, every J rule names an existing file or is noted, no deleted round-12 surface or withdrawn-guard word in lib/, app/, components/, scripts/ or messages/ (comments stripped), and the A-S00 customer keys.

### J-M28 [CORE] HARD INVARIANT: no exit offered that the engine would refuse
FILE: tests/claims-r13-no-false-exit.test.ts (new)
PINS: D1, D2 (1), D14, G9, A-S00, and the SAFE EXIT fields of every A state
FIXTURE: every J-M01 table entry, both leases open, now = max(Q-INSTANT, until) + 1 ms.
ASSERTION, for each state:
(1) If acceptedExits contains 'approve' and arbitrationRefusal('approve') is null, the full approve path runs (T1 → T2 on the fixture's fresh facts → real executeRefund). It must end in exactly one refunds.create with no engine refusal, and the engine answer must equal the table's YES.
(2) If the table's ENGINE ACCEPTS is NO(step), then 'approve' is absent, or arbitrationRefusal returns D14(1)/(2)/(3) or « pas en arbitrage ».
(3) For each reconcile, attribute or stuck_close in acceptedExits, the corresponding server function accepts (not 409 for the gate reason).
(4) Any state whose exit set is empty or gated-only names its E id.
(5) The D14 phrase scan passes on every text the state renders: detail, MONEY_LABEL, GUIDANCE, toast.
Specific pins: A-S01b, A-S03, A-S32-1 and A-S26 never approvable. A-S04, A-S08a, A-S30 and A-S39 (engine YES, holds) are refused Claims-side by D14(2).
NEGATIVE CONTROL: the round-12 otherClaimRows fixture (A-S03) with the proof written as 'no_refund_proven:v13:' → (1) runs into T2 → locked, and must not reach a 409 from the engine; the test asserts the refusal happened before the engine call.
BREAK/RESTORE: add 'approve' to exit row 4 (rail_locked) → A-S01b reaches executeRefund → P2002 409 → red. Change D14(2) copy to « elle est à nouveau payable » → phrase scan red. Restore → green.
FINDINGS: P1-4, P1-7, R-A1-4, R-A2-4, R-A0-3, CONVERGENCE (never promise an exit the engine refuses).
IMPLEMENTATION NOTE (W1): ER-M05 resolved — (1) reads: approve is offered only on a pre-image T2 re-derives (null or a canonical v13 proof), and T2 calls the engine only when deriveNoRowOutcome on the fresh facts is payable, which the G5 mirror says the engine accepts; (2) reads: when the facts make the engine refuse, approve is absent, refused Claims-side (D14 (1)-(3) or « pas en arbitrage »), or blocked by that T2 derivation (A-S12, A-S30b-*, A-S30e-*, A-S38-2). W1 pins it with the pure checker of tests/claims-r13-no-false-exit.test.ts; the run through T1 → T2 → the real executeRefund lands with the T2 slice.
IMPLEMENTATION NOTE (W1, round-1 fix): OPEN. (3) is pinned for the W1 fixture set: for each state, reconcileClaimEvidence and resolveStuckClaim accept (not the gate / predicate refusal) exactly when the set contains reconcile / stuck_close. (5) scans the approve refusal, the GUIDANCE and the console MONEY label (read out of AdminClaimsArbitration.tsx) per state. Still to do: the fixture set is the W1 subset, not every J-M01 entry (J-M01 is not built yet); the detail texts belong to G8; (1) runs through the real engine with the T2 slice.
IMPLEMENTATION NOTE (W8): CLOSED. The last describe of tests/claims-r13-no-false-exit.test.ts runs every J-M01 entry (the 95 worlds of tests/fixtures/claims-r13-states.ts) with 13 pre-images (approved null, v13 past and before its instant, arbitration, rail-locked, AWAITING, legacy proof, safety hold, stripe_failed, financial_verification, reconcile marker, bound, refunded): arbitrateClaim → T1 → T2 → the REAL lib/refund.ts executeRefund behind a spy, on the in-memory engine world (Prisma and Stripe doubles), both leases open. Per run: the engine is reached only where approve is offered (acceptedExits ∋ approve and arbitrationRefusal null), at most once, never on a resume-first (E3) or NO state of the table, and there it accepts with exactly one refunds.create; the claim reads refunded only after that success on its own row; an empty or gated-only set names its registry entry. (3) runs reconcileClaimEvidence and resolveStuckClaim on every world × pre-image: each accepts exactly when the set holds its exit, and neither reaches the engine. (5) scans every rendered text — the written detail, the approval toast (approvalToast → messages fr claims.admin), the approve refusal, the MONEY label and GUIDANCE of listActionableRefundClaims, the customer status (fr claims.status) and, on a reconcile run of every world, the reconcile toast — for the D14 phrases, for HEAD_A on a payment with a standing refund, and for an engine refusal quoted where the table's engine answer differs; a reconciliation settles only on a succeeded Stripe refund for the bound row. Negative control: A-S03 with a v13 proof is approvable and T2 (c) holds it before the engine; the engine's own P2002 409 on A-S01b and a « à nouveau payable » text are caught by the checker. Break/restore run in W8: the E6 clause of engineRefusalOnReapproval disabled → A-S01b reaches the real engine and gets the P2002 409 → red; « Elle est à nouveau payable. » appended to approveRevisableText → red; both restored byte-identical, green. Attribute and adopt are not driven here (their parity is J-M14 / J-M15). No regression against W1-W7 was found.
IMPLEMENTATION NOTE (W8 fixer) on BREAK/RESTORE: the rule's first named mutation, « add 'approve' to exit row 4 (rail_locked) », cannot turn the run red, so the W8 note above replaced it without saying so. arbitrateClaim (lib/claims.ts) gates on arbitrationRefusal only, never on acceptedExits. arbitrationRefusal refuses an approved claim whose refundError starts with 'no_refund_proven_rail_locked:' through its D14 (2)/(3) branch (isNoRefundProofText matches only 'no_refund_proven:'), before T1 runs, and T2 would re-derive through reapprovalVerdict in any case. The mutation was run in the W8 fixer pass (acceptedExits in lib/claim-action-rules.ts also adds approve when the refundError starts with 'no_refund_proven_rail_locked:'): tests/claims-r13-no-false-exit.test.ts stayed green, 158/158, exit 0. The file was restored byte-identical (sha256 65ef3e7eba7362419ceddc1031a3fb475498ab1f6eedb51338397b58b86e4943). The mutation is caught only by the W1 BREAK test, and there only because that test also mutates arbitrationRefusal to null for the same claim. The real-engine break/restore that replaces it is the E6-clause mutation of engineRefusalOnReapproval: A-S01b reaches the real engine, gets the P2002 409, and the run is red. The second named mutation (the D14 (2) copy) was run as written.

### J-M29 [CORE] Control parity: console controls equal the server verdicts
FILE: tests/claims-exit-parity.test.ts (new)
PINS: D0, G1 (list reconcilable), I-09 (row flags)
FIXTURE: one fixture per D1 row, rendered through AdminFinancialVerification and AdminClaimsArbitration with the GET /api/admin/claims/financial-verification payload. Server functions: reconcileRefusal, isStuckResolvable, attributionRefusal, arbitrationRefusal.
ASSERTION:
- reconcilable === (reconcileRefusal === null), resolvable === isStuckResolvable, candidate enabled === pre-check null, approvable === (acceptedExits ∋ approve && arbitrationRefusal null);
- a control is rendered iff its flag is true;
- a refused action renders the server refusal text, never a disabled button without text;
- the CARD never renders « Approuver »;
- listUnfinalizedClaimRefundRows rows carry {rowId, claimId, claimStatus, refundError, orderId, rowReason, reconcilable}.
NEGATIVE CONTROL: approved + SAFETY_HOLD with refundId set → reconcilable false, and no button.
BREAK/RESTORE: compute reconcilable in listActionableRefundClaims as `status !== 'refunded'` → A-S31c row mismatch → red; restore → green.
FINDINGS: R-A1-4, R-A2-3, R-X0-5.
IMPLEMENTATION NOTE (W1, round-1 fix): OPEN. Added in W1: a row whose rendered text (GUIDANCE, MONEY label, amount line, card money line) names « Réconcilier d’après la preuve » has reconcilable === true or is refused only for the marker grace (negative control: the own-row resume_mismatch with the A-S36-1 sentence forced); the D2 (1)(b) bound approval. Still to do, in the console slice: rendering the consoles, « a refused action renders the server refusal text », the listUnfinalizedClaimRefundRows payload {rowId, claimId, claimStatus, refundError, orderId, rowReason, reconcilable}, one fixture per D1 row including refunded and FV rows, and boundRow passed by the lists and the server gate.
IMPLEMENTATION NOTE (W3, round-1 fix): listReconcileRequiredClaims and listFinancialVerificationClaims now carry reconcilable = reconcileRefusal(same facts) === null (G1), and reconcile_required rows also carry reconcileRefusal, the gate’s own text. The console renders « Réconcilier d’après la preuve » only where reconcilable === true, on every bucket, and the server refusal text otherwise. Pinned in tests/claims-exit-parity.test.ts: malformed and future markers give flag false and the route answers 409 with the same text, reading and writing nothing; an aged marker gives flag true and the route answers 200; a FV row gives flag true. The source pins in tests/claims-t49-round10.test.ts and tests/claims-t49-routes.test.ts supersede the round-9 condition `r.kind !== 'other_unsettled' || r.reconcilable === true`, with a negative control on that condition. Break/restore verified: forcing the list flag true turns the parity test red.
IMPLEMENTATION NOTE (W7): CLOSED. The console half is in tests/claims-exit-parity.test.ts (W7 block): one fixture per D1 row run through the shipped list builders, the payload assembled as the route assembles it, the card rendered from it; « Réconcilier d’après la preuve » count = the reconcilable flags (claim rows + unfinalized rows), « Clôturer ce dossier… » = resolvable, « Attribuer » enabled = pre-check null, no « Approuver »; every flag equals acceptedExits on the same facts; the unfinalized payload keys; the negative control and the break witness (`status !== 'refunded'` misreads A-S31c).
IMPLEMENTATION NOTE (W7 fixer): the ARB rendered half covers « Remboursements à traiter » too — rows whose resolvable flag is the server’s isStuckResolvable verdict on the same facts, rendered through AdminClaimsArbitration: the « Clôturer ce dossier… » count equals the resolvable rows and every other row shows its moneyStateGuidance line (negative control: every flag false → no button). Pinned in tests/claims-closure-ui.test.ts.

### J-M30 [CORE] Exit table and registry ids
FILE: tests/claims-t49-round10.test.ts (EXIT_TABLE rewrite)
PINS: D1, D13, E0 (mapping), E-10
FIXTURE: the 14 D1 rows with boundRow and orderId; approved + arbitrationDecision null; approved + arbitrationDecision + refundAttempted true; refunding + marker within and after grace.
ASSERTION:
- acceptedExits equals the D1 sets exactly;
- every empty or gated-only set carries an E id (row 1 and row 2 → E-10; row 3 → E-01; row 9 in grace → E-05; row 11 succeeded → E-09; row 13 → registry or terminal);
- refuse_final on every approved claim → the exact AM-B3 text;
- the successes count at the former line 245 is updated;
- markers use startsWith (an includes mutant → red);
- no row lists 'annuler', 'apply_row_failure' or a declaration from FV.
NEGATIVE CONTROL: an FV claim with no attributable row → ['reconcile', 'adopt'], never 'attribute'.
BREAK/RESTORE: remove the E-id requirement from one gated-only row → the registry assertion goes red; restore → green.
FINDINGS: R-X0-7, R-A1-5, V-A-1.

### J-M31 [CORE] Refusal copy and the no-false-exit phrase pin
FILE: tests/claims-exit-copy.test.ts (new)
PINS: D14, D3/C4 (texts), D4/D7 (captions), F14, F15, G2, G8/G10/G11/G12 (enumerated texts)
FIXTURE: an enumerated list, never a whole file: the C4, D4, D7, D8, D11 and D14 texts; said.*; MONEY_LABEL (AdminClaimsArbitration.tsx, including absence_proven_payable); GUIDANCE (lib/claim-action-rules.ts, every key, including absence_proven_payable and approved_not_driven); the approval toasts; the G12 attribute 409 and success texts; the B11/C8 adopt texts; the three G11 REVERTED texts; STRIPE_REVERTED_TEXT; the unfinalized caption.
ASSERTION:
- D14 (0)-(3) exact, selected in order: v13 → C4 only, legacy, REVISABLE iff reconcileRefusal null or only the marker grace, PERMANENT;
- no listed text contains (case-insensitive) « payable à nouveau », « à nouveau payable », « de nouveau payable », « peut maintenant être rembours », « relancez le remboursement », « réessayez le remboursement », « sera remboursée », « sera payée », « jamais déplacé », « n’a déplacé d’argent », « Absence de remboursement PROUVÉE », « relèvent d’AUTRES », « Aucun ne paie celle-ci », « refusera tout remboursement », « aucun code ne sort une ligne de l’état échoué », « définitif »;
- GUIDANCE absence_proven_payable and MONEY_LABEL absence_proven_payable equal the F15 texts verbatim;
- the reverted texts contain « Quand les réclamations sont ouvertes » and lack « Le client lit désormais »;
- source scan (G2): none of « jamais déplacé », « n’a déplacé d’argent », « Absence de remboursement PROUVÉE », « relèvent d’AUTRES réclamations » exists in lib/, components/ or messages/.
NEGATIVE CONTROL: the synthetic copy « elle est à nouveau payable » → red; the HEAD GUIDANCE « Rien à clôturer : approuvée et non payée, aucun remboursement n’a déplacé d’argent. … » → red; the HEAD label « Absence de remboursement PROUVÉE (lignes + Stripe) — … » → red.
BREAK/RESTORE: restore HEAD claim-action-rules.ts line 176 → red; reintroduce « si le détail dit que la cause peut cesser » into D14 (2) without the selection → selection fixture red; replace one real toast with « … sera remboursée » → red; restore → green.
FINDINGS: P1-1, P1-4, R-A1-4, R-A2-4, R-X0-4, N-M-1, verifier A E2 sentence.
IMPLEMENTATION NOTE (W1, round-1 fix): OPEN. The enumerated list also carries the approval toasts (the messages/fr.json keys approvalToast can return) and the A-S36-1 no-exit text; the finalization-lock text is pinned verbatim. Each remaining text (said.*, D4/D7/D8/D11, the G11/G12 attribute and adopt texts, STRIPE_REVERTED_TEXT with its « Quand les réclamations sont ouvertes » assertion, the unfinalized caption) joins the list in the slice that writes it, and the G2 scan's two exemptions (lib/claims.ts, AdminFinancialVerification.tsx) are removed when those files are rewritten.
IMPLEMENTATION NOTE (W7): CLOSED. The enumerated list now carries said.* (every outcome, six payload variants), the AMF-1 toast, the D4 caption, the D7 unfinalized caption, the H10 texts and blocker lines, the declaration panel and toasts, every literal of attributeWithEvidence / attributeClaimRefund / adoptStripeRefundForClaim / resolveStuckClaim / attributionNotProvenText (G12, B11 / C8, C7 and D11 texts), and the three G11 REVERTED texts with STRIPE_REVERTED_TEXT (all four carry « Quand les réclamations sont ouvertes » and lack « Le client lit désormais »). The G2 scan has no exemption left; components/ is also scanned by tests/claims-r13-reconcile.test.ts, with a negative control on a copy of the card.
IMPLEMENTATION NOTE (W7 fixer): correction of the W7 note. At W7 round 1 the G2 describe still exempted lib/claims.ts and AdminFinancialVerification.tsx, and the approval-toast outcomes reached four keys only. Both now hold as the W7 note states: the G2 describe scans lib/, components/ and messages/ with no exemption (negative control: a copy of lib/claims.ts carrying « jamais déplacé » in code is an offender; break/restore run on the real file: red, then green), and TOAST_OUTCOMES covers every F12 shape, so all eight ApprovalToast keys (approvedRefunded, approvedPending, approvedResumeMismatch, approvedIdentityUnverified, approvedSuperseded, approvedNotSentUntil, approvedNotSent, approvedFailed) are pinned and phrase-scanned from messages/fr.json with {amount} and {date} substituted.

### J-M32 [CORE] Approve: server order, leases, drift refusal and success-only-on-commit
FILE: tests/claims-r13-approve-route.test.ts (new)
PINS: D2, E-10, A-S25, I-01 (refunds_disabled, engine_failed), F12
FIXTURE: POST /api/admin/claims/[id]/arbitrate {decision:'approve'} with:
(a) CLAIMS off;
(b) CLAIMS on, REFUNDS off, arbitration-status claim; (b2) the same on a legacy approved claim with arbitrationDecision null; (b3) the same with a decision CAS count 0;
(c) both on, null pre-image, payable;
(d) both on, and a Dashboard refund lands AFTER T2(f) so the engine returns E5 or E6 (A-S25);
(e) approved + v13 before instant;
(f) approved + RAIL_LOCKED.
ASSERTION:
- (a) 403 {gated:true}, no write;
- (b)(b2) arbitrateClaim's decision CAS writes approved; triggerClaimRefund returns {state:'pending', reason:'refunds_disabled'} with no claim write (no M, refundAttempted false); arbitrateClaim sends I-01 once, cause refunds_disabled, dedupe claim_blocked:<id>:refunds_disabled, facts registry 'E-10', engineCalled false; the toast is approvedNotSent with success tone, never approvedPending; the decision e-mail kind is 'approved';
- (b3) 409 « Cette réclamation a déjà été arbitrée. », triggerClaimRefund not called, no alert;
- (c) T1 → T2 → executeRefund once → T3 'ours' → T4 count 1 → approvedRefunded;
- (d) T4 CAS → approved, `engine_failed: … — aucune relance possible depuis les réclamations ; décision humaine requise.` + ALERT-B; then acceptedExits ['stuck_close'] with the PERMANENT refusal;
- (e) the C4 premature refusal, 0 writes;
- (f) D14 (2), 0 writes.
No text emitted before the engine call says the claim will be paid.
NEGATIVE CONTROL: (c) with T4 count 0 → no success toast (J-M22 path).
BREAK/RESTORE: remove the alert call from arbitrateClaim → (b) red; move the REFUNDS gate after T1 → (b) writes the marker M → red; restore → green.
FINDINGS: R-X0-7, R-A1-5, R-B0-3, N-C-2, CONVERGENCE (T1 approval is not T2 authority).

### J-M33 [CORE] Reconcile gate and approved admissions (i), (i-b)
FILE: tests/claims-r13-rules.test.ts (new)
PINS: G1, D4
FIXTURE: approved, refundAttempted false, no refundId, with v13 / legacy / RAIL_LOCKED / AWAITING. Approved, refundAttempted true, no refundId, SAFETY_HOLD. Controls: refundAttempted flipped; refundId set; approved-unpaid null error. Existing admissions (FV, marker after grace, legacyStranded, bound, attemptedUnrecorded). (ii) and (iii) fixtures from J-M12 and J-M36. Route POST /reconcile on (i) and (i-b) fixtures.
ASSERTION:
- each admission true exactly as stated;
- boundRow undefined where needed → refused;
- (i-b) run → N0-N8, refundAttempted reset false only through a proof write;
- a park via enterFinancialVerification;
- N8 stamped count > 0 → changed_during_read with 0 updateMany;
- the caption shown before the click contains « peut placer la réclamation en vérification financière »;
- listed reconcilable equals the verdict for one fixture per admission.
NEGATIVE CONTROL: approved + null error + refundAttempted false → refused, not listed as reconcilable.
BREAK/RESTORE: drop the (i-b) clause → SAFETY_HOLD fixture 409 → red; restore → green.
FINDINGS: R-A1-4, R-A2-3, V-A-1, verifier A P2 (FV park warning).
IMPLEMENTATION NOTE (W3): pinned in tests/claims-r13-rules.test.ts, except two parts. The list flag equal to the verdict for one fixture per admission is the existing J-M29 pin (tests/claims-exit-parity.test.ts). The caption shown before the click is the console slice's.

### J-M34 [CORE] Reconcile a refunding claim: marker after grace
FILE: tests/claims-r13-rules.test.ts
PINS: D5, E-05, A-S12, A-S12b, A-S30d, A-S35
FIXTURE:
- refunding with M (ISO + nonce) at age grace−1 s and grace+1 s;
- M + « Moteur : … la ligne X existe » (A-S35) with row X claim:C pending id-less at 2 h, 20.5 h and 22 h;
- A-S30d: executeRefund rejects after T1 (a DB throw) → route 500;
- A-S12 refunding pre-image with another claim's id-less pending row at 10 h.
ASSERTION:
- within grace → reconcileRefusal refused with the grace text and no button;
- after grace → admitted;
- A-S30d: the claim stays {refunding, true, M, null}, the catch sends ALERT-B cause attempt_crashed then rethrows (500), no Refund row; reconcile after grace → no-row proof;
- A-S35 at 2 h and 20.5 h → unconfirmed_within_window with until = createdAt+21h, no write; at 22 h → engine_row_dead + ALERT-B → stuck_close only;
- A-S12 → no write, the toast « Conclusion possible à partir du »;
- approve on refunding → « n’est pas en arbitrage »;
- isStuckResolvable false under a marker.
NEGATIVE CONTROL: a marker with a nonce but a malformed ISO → reconcileMarkerAge null → refused (never treated as aged).
BREAK/RESTORE: make the marker regex require the pre-round-13 marker (no « (tentative ») → the nonce marker is never admitted → red; restore → green.
FINDINGS: R-A1-2 (token), verifier A (A-S12b band).
IMPLEMENTATION NOTE (W3): pinned in tests/claims-r13-rules.test.ts. The negative control holds because D5's marker admission now refuses an unreadable age (G1 W3 note). A-S30d is driven through triggerClaimRefund, whose rethrow is the route's 500. The A-S12 toast text is the console's; W3 pins the outcome, the until and zero writes.

### J-M35 [CORE] Reconcile a financial_verification claim: evidence and time exits
FILE: tests/claims-r13-reconcile.test.ts (new)
PINS: D6, E-03, A-S05b-1, A-S05c-1, A-S09a, A-S09b, A-S13a, A-S14a-2a, A-S14a-2b, A-S29-2, A-S30e-4, A-S40
FIXTURE: FV claims per state. Each is run twice: first with Stripe still in the blocking condition, then with it resolved (key/mode fixed, refund terminal, list readable).
ASSERTION:
- first run → relabel only when the reason changes (I-02 once), otherwise no new alert;
- A-S09a/A-S40 detail contains « encore EN ATTENTE » / « lorsqu’il sera terminal »;
- the only date any copy states is createdAt+21 h (UTC);
- second run → the next state named in each A row (e.g. A-S09a → A-S02 v13 proof; A-S40 succeeded → still FV, adoption offered; A-S05b-1 → A-S23a-1 shape);
- a proof written from FV is approved with refundAttempted false and grants nothing until D2;
- approve on FV → « n’est pas en arbitrage »; isStuckResolvable false.
NEGATIVE CONTROL: FV claim with a readable, fully explained 0/0 order → payable v13 proof, not a park.
BREAK/RESTORE: make N7 ignore non-succeeded standing refunds → A-S09a writes a proof while re_P is pending → red; restore → green.
FINDINGS: R-A0-4, P1-3.
IMPLEMENTATION NOTE (W3): pinned on ten FV states in tests/claims-r13-reconcile.test.ts. A-S05b-1 and A-S05c-1 run on an unstamped row; the stamped variant takes the mine path and is J-M44's A-S05c-2b. « the only date any copy states » is pinned as « a park detail states no date »; proofs state their instant (C4).
IMPLEMENTATION NOTE (W3): the BREAK/RESTORE as written (« make N7 ignore non-succeeded standing refunds ») does not turn A-S09a red. On A-S09a, rf_P's own at-Stripe truth also puts re_P in the in-flight set, so removing only the standing-refund source changes nothing. The break verified for this slice removes every in-flight source (standing non-succeeded refunds, pending rows at Stripe pending/requires_action, succeeded rows reported pending). With it, A-S09a is no longer the N7 in-flight park, and the J-M35 run is red; restored, it is green.
IMPLEMENTATION NOTE (W3, round-1 fix): after A-S40’s second run (still FV, refund_moved_unattributed), acceptedExits contains adopt and reconcile.

### J-M36 [CORE] R0a / R0b / R0c: reversal of a settled claim, read-only
FILE: tests/claims-t49-round13-r0.test.ts (new)
PINS: D7, G10, A-S10, A-S21 (standing), A-S31c, A-S31d, A-S31e-1, A-S31e-2, E-07, E-09, I-01 (reverted_after_refund)
FIXTURE: refunded claim, refundError null, bound row on its own order. No webhook is delivered.
- R0a: row failed with id.
- R0b: row pending; retrieve returns failed / canceled / succeeded / pending / 404 within window / 404 at 22 h / pi_OTHER / ETIMEDOUT.
- R0c: row succeeded; retrieve returns succeeded / failed / 404.
- Gate negatives: row on another order; refundError non-null; failed row without id.
ASSERTION:
- R0a and R0b failed/canceled, R0c failed → reverted_after_refund; the claim stays status refunded, refundError starts with 'stripe_reverted_after_refund:' with the row-status variant text; ALERT-B; audit claim.reconcile_evidence {moneyMoved:false}.
- R0b: the row status, key and stripeRefundId are byte-identical and markRefundRowFailed is not called.
- succeeded/pending → refund_still_standing {stripeStatus}, no write.
- within window → unconfirmed_within_window {until}, and the toast is NOT « toujours ABOUTI ou en attente ».
- dead / contradiction → refunded_row_unproven {detail}, no write.
- ETIMEDOUT → stripe_unreadable_retry.
- Helper failed → 409 « La base n’a pas pu être lue ou écrite : rien n’est établi. Réessayez. »
- Across all fixtures: 0 executeRefund, 0 Stripe write methods, 0 refund.update*, 0 customer e-mail sends.
- Listing: A-S31c appears on listActionableRefundClaims and A-S31d on listUnfinalizedClaimRefundRows, both reconcilable; A-S31e-* appear on no list (the E-09 negative pin).
NEGATIVE CONTROL: other-order bound row → 409 and nothing written.
BREAK/RESTORE: remove the (iii) pending clause → A-S31d answers 409 → red. Map absent_within_window to refund_still_standing → toast red. Restore → green.
FINDINGS: R-A0-1, R-A1-1, R-A2-2, R-X0-1, R-X0-2, verifier A P1 and P3.

### J-M37 [CORE] Attribution reads Stripe evidence before any write
FILE: tests/claims-r13-attribution.test.ts
PINS: G12, D8, A-S20, A-S21, A-S22, A-S23a-1, A-S23a-2, A-S23b-1, A-S23b-2, A-S27-1a, A-S27-1b, A-S27-2, I-04
FIXTURE: FV claim C and:
(1) pending row with recorded re_9 on pi_1, retrieve succeeded (retrieve path);
(2) pending id-less row with a PI-list refund tagged with its id, succeeded (tag path);
(3) unstamped succeeded admin-rail row, retrieve succeeded;
(4) row stamped claim:C succeeded;
(5) retrieve pending / requires_action / failed / canceled / 404 within window / dead / pi_OTHER / ETIMEDOUT;
(6) succeeded row reverted at Stripe with key = cursor and with key ≠ cursor;
(7) FV claim C that kept refundId = the row (P1-6 guard: id:{not: C.id});
(8) two rows stamped claim:C, one provable.
ASSERTION:
- (1)(2)(3)(4)(8-provable) → the refund read precedes every write (call-order spy), then the C6 transaction → refunded {evidence 'stripe_read', amountCents = Stripe amount}, audit {stripeStatus 'succeeded', rowStatusBefore, moneyMoved:false}, success copy split by rowStatusBefore;
- (1) → refunds.list NOT called; (1)(2) → I-04 sent after commit; (3)(4) → no I-04;
- (5)(6) → 409 with the exact G12 NOT PROVEN text, containing « n’a pas été modifiée », with 0 updateMany, 0 audit, row snapshot unchanged;
- (7) → not refused by bound_to_other_claim;
- 'already_parked_or_moved' does not exist; the console treats only 'refunded' as success.
NEGATIVE CONTROL: (1) with retrieve pending → 409 and 0 writes.
BREAK/RESTORE: delete `id: { not: claim.id }` from boundToWhere → (7) is refused → red. Re-add the bind-first write → (5) writes refundId → red. Restore → green.
FINDINGS: P1-5, P1-6, P2-14, P2 toasts.
IMPLEMENTATION NOTE (W4, fixer round 1): (6) now carries the full (5)(6) no-write assertions — 0 claim.updateMany, 0 audit, 0 closure record, the refunds snapshot unchanged and the claim unchanged — in tests/claims-r13-attribution.test.ts.

### J-M38 [CORE] Closure notice attempts carry no money path, depend on the closure record, and never contradict Stripe
FILE: tests/claim-emails-routes.test.ts (extended)
PINS: D10, D11, H05, H06, E-16, E-17, E-18, I-08
FIXTURE: sites (i) resolve-stuck, (ii) reconcile 'refunded', (iii) attribute (row and adoption branches), (iv) POST /api/admin/claims/[id]/closure-notice. Variants: recordAdminAudit returns false (ADMIN_AUDIT_ENABLED off); a legacy terminal claim WITH a HEAD AdminAuditLog 'claim.arbitrate' row and no closure record; a closure whose record write failed; a closure observed only through the C7 re-read; a webhook settlement (reconcileClaimForRefund); CLAIMS off; refunded kind where R0 returns refund_still_standing succeeded / reverted_after_refund / refunded_row_unproven; a REVERTED_AFTER_REFUND claim.
ASSERTION:
- lib/claim-emails.ts imports none of lib/refund, lib/stripe, lib/claims (source guard);
- the closure-notice route calls only reconcileClaimEvidence, sendClaimClosureEmail and recordAdminAudit, and executeRefund 0 times;
- (i)-(iii) attempt the send after the closing write returned ok, WHATEVER recordAdminAudit returned: with audit false and a record present the notice is sent;
- eligibility is the H05 record only: the legacy claim with a HEAD audit row and no record → why 'no_closure_record', no send, not in closureNotices, counted in closure.terminalWithoutRecord;
- record-write failure → the same, plus the console.error [EMAIL MISS] [claim_closure_record] at write time;
- C7 re-read closure → no attempt, record present → listed in closureNotices;
- webhook settlement → record written, console.error [EMAIL MISS] [claim_decision_refunded] once, no send, listed;
- CLAIMS off → EmailLog 'skipped', recipient « (non envoyé : claims_disabled) », console.error [EMAIL MISS], toast claimsDisabled;
- refunded kind sends only on refund_still_standing with stripeStatus 'succeeded' read in the same request; never over REVERTED_AFTER_REFUND;
- the webhook route and the reconcile-refunds cron do not import the sender.
NEGATIVE CONTROL: eligible closure (record present), CLAIMS on, Stripe succeeded → exactly one send.
BREAK/RESTORE: make the sender's eligibility read AdminAuditLog instead of the record → the legacy fixture sends (backlog) → red; remove the pre-send R0 read in (iv) → the reverted fixture sends → red; restore → green.
FINDINGS: R-X0-1, R-B1-1, N-C-1, R-D6(d), R-D7, C4 (no clock).
IMPLEMENTATION NOTE (W6): the fixture is tests/claim-emails-routes-closure.test.ts: tests/claim-emails-routes.test.ts mocks the senders, and these sites need the real sender. The record-write failure's console line and the webhook settlement are pinned in tests/claim-closure-record.test.ts and tests/claims-closure-webhook.test.ts. « listed in closureNotices » belongs to the console slice (H10); here the census closure.terminalWithoutRecord count is asserted. The break/restore « remove the pre-send R0 read » is witnessed by the assertion that reconcileClaimEvidence ran before the 409.

### J-M39 [CORE] Stuck close: the declaration exit
FILE: tests/claims-resolve-stuck-route.test.ts (extended)
PINS: D11, D10 (i), H05 (site 7), E-01, E-02, E-06, A-S06b, A-S24-1, A-S24-2, A-S31-1, A-S31-2, A-S31b
FIXTURE: isStuckResolvable matrix: marker; v13; legacy proof; RAIL_LOCKED; AWAITING; SAFETY_HOLD; STRIPE_REVERTED; engine_failed; engine_row_dead; stripe_failed; resume_mismatch with own / other / unread stamp; refunded + REVERTED_AFTER_REFUND; refunded + DECLARED_AFTER_REVERT; refunded null. POST with settled_out_of_band and with closed_no_payment. A concurrent refundError change. recordAdminAudit returning true and false. An existing closure record (P2002).
ASSERTION:
- verdicts exactly as D11;
- write where {id, status: read, refundError: read};
- refunded + REVERTED + settled_out_of_band → status refunded, refundError starts with DECLARED_AFTER_REVERT and keeps the original text; closed_no_payment → refused_final, refundError kept;
- count 0 → 409 « Cette réclamation a changé d’état entre-temps — rien n’a été écrit. … », no record;
- count 1 → recordClaimClosure called once inside resolveStuckClaim (P2002 silent, return unchanged); route recordAdminAudit boolean → noteRecorded; the D10 (i) attempt runs with audit true AND with audit false;
- 0 executeRefund, 0 Stripe calls;
- claimClosureKind of both declarations → closed_by_support;
- G7 N3 never counts a binder with non-null refundError as explaining.
NEGATIVE CONTROL: refunded + DECLARED_AFTER_REVERT → refused (no re-declaration).
BREAK/RESTORE: gate the notice attempt on the audit boolean → the audit-false fixture sends nothing → red; drop the terminal exemption for REVERTED_AFTER_REFUND → A-S31-1 has no exit → red; restore → green.
FINDINGS: R-X0-3, R-A1-1, R-B1-1, verifier A P1 (reverted refunded claim has an exit).
IMPLEMENTATION NOTE (W6): the route half and the isStuckResolvable matrix are in tests/claims-resolve-stuck-route.test.ts; the lib half (the CAS on the pre-image, DECLARED_AFTER_REVERT, count 0 and 1, P2002, no money) runs on the real resolveStuckClaim in tests/claims-r13-declaration-after-revert.test.ts and tests/claim-closure-record.test.ts. The BREAK/RESTORE run gated the notice attempt on the audit boolean: the audit-false fixture turned red.

### J-M40 [CORE] Webhook marking: claim-only helper, 503 only on a DB throw
FILE: tests/claims-t49-round13-reversal.test.ts (new)
PINS: D12, G11, I-05, A-S24-1, A-S24-2, A-S31-1, A-S31b, A-S31f-1, A-S31f-2, A-S31f-3, E-08
FIXTURE:
- markClaimsForRevertedRefundRow evidence preconditions: stripe_object (succeeded row, matching id; mismatch); failed_row (failed with id; without id); pending_row_stripe (matching id; id-less + matching tag; tag mismatch; pi_OTHER; Stripe succeeded).
- Targets: resume_mismatch; refunded null; approved or refunding null with stripe_object; the same with failed_row.
- Webhook events: failed on a pending row bound to a refunded claim; redelivery on the now-failed row; failed on a succeeded row (key = cursor, key ≠ cursor); an event id different from row.stripeRefundId; helper DB throw followed by a successful redelivery.
ASSERTION:
- writes only when the fresh row re-read satisfies the evidence; resume_mismatch skipped;
- refunded null → text only, status unchanged; approved/refunding null → approved + STRIPE_REVERTED_TEXT only for stripe_object;
- refund.update* never called; idempotencyKey unchanged;
- DB throw → {failed:true}; webhook → 503 {received:false}; the next delivery → the claim marked exactly once;
- lost CAS → written false, failed false → 200;
- succeeded-row branch: the refund:<re> alert is sent BEFORE the helper, with facts.claimIds (or 'unread');
- no revertedClaims key in the response JSON; no claim e-mail import;
- all three texts contain « Quand les réclamations sont ouvertes » and « Vérifiez dans le ledger et la reprise de royalty ce qui a pu être écrit », and lack « déjà comptabilis » and « Le client lit désormais »;
- ROUTED true / false / unknown variants.
NEGATIVE CONTROL: event id ≠ row.stripeRefundId → no write, 200.
BREAK/RESTORE: swallow the helper throw (return failed false) → the first delivery answers 200 → red. Remove the helper call → refundError stays null → red. Restore → green.
FINDINGS: R-A1-1, R-X0-1, R-X0-4, R-X0-6, webhook_disposition (d) C6 breach bounded by redelivery.

### J-M41 [CORE] Exits and surfaces that do not exist in round 13
FILE: tests/claims-r13-absent-surfaces.test.ts (new)
PINS: D13, E0 (REMOVED list)
FIXTURE: source scan of app/, lib/, components/ and messages/.
ASSERTION:
- no route directory apply-row-failure, no « annuler l’approbation » action or key;
- no listRevertedAfterRefundClaims, revertedAfterRefund payload key, refund_reverted_claim dedupe, recovery pass 2 over refunded claims, epoch census field, settled_by_support key;
- no FV branch in isStuckResolvable;
- recoverStrandedClaimReconciliations imported only by the cron route;
- no operator route re-verifies E-09 claims in bulk.
NEGATIVE CONTROL: the ungated routes reconcile, attribute, resolve-stuck and closure-notice exist and call resolveAdmin.
BREAK/RESTORE: add messages key claims.status.settled_by_support in fr.json → red; restore → green.
FINDINGS: R-X0-3, R-X0-5, R-X0-6, R-D5, R-SURFACE.
IMPLEMENTATION NOTE (W7): pinned in tests/claims-r13-absent-surfaces.test.ts. « no operator route re-verifies E-09 claims in bulk » and « recovery pass 2 over refunded claims » are superseded by AMF-1 (D13 W5 note); what is pinned instead is their confinement — recoverStrandedClaimReconciliations imported only by the reconcile-refunds route, reverifySettledClaimRefunds called once, from it.

### J-M42 [CORE] Reconcile dispatch and the deleted round-12 ladder
FILE: tests/claims-r13-reconcile.test.ts
PINS: G2, A-S03, A-S33-1, A-S27-1a (mine>1)
FIXTURE:
- refunded claim → R0;
- approved with refundId and null error → reconcileBoundClaim, including a missing bound row → bound_row_missing park;
- mine > 1 → park multiple_candidate_refunds;
- mine === 1 (A-S33-1 late own row) → applyRowTruth 'stamped';
- no PI → no_payment_intent park;
- the round-12 A-S03 fixture: rf_o succeeded, key refund:o:0, stamped claim:OTHER, retrieve failed, routed;
- applyRowTruth reverted.
ASSERTION:
- each dispatch as stated;
- A-S03 → 'no_refund_proven_rail_locked:' containing 'refund:o:0', « blocage de sûreté » and « Ce paiement est routé »;
- applyRowTruth reverted → one CAS → approved + STRIPE_REVERTED_TEXT, outcome refund_failed, ALERT-B;
- 'refunded' outcomes carry evidence 'stripe_read' and the Stripe amount;
- source scan: boundElsewhere, otherClaimRows, mayMoveMoney, mayMoveMoneyHere, noRowEverMoved and the phrases « relèvent d’AUTRES réclamations » / « aucun remboursement n’a jamais déplacé d’argent » are absent from lib/ and messages/.
NEGATIVE CONTROL: A-S03 with transfer_data null → no ROUTED sentence; key refund:o:500 → H1 without E6 (A-S04).
BREAK/RESTORE: reintroduce the otherClaimRows ladder → A-S03 writes 'no_refund_proven:' → red; restore → green.
FINDINGS: P1-1, P1-4, P1-7, P3-22.
IMPLEMENTATION NOTE (W3, round-1 fix): the source scan now carries the four G2 pin strings (« relèvent d’AUTRES réclamations », « jamais déplacé », « n’a déplacé d’argent », « Absence de remboursement PROUVÉE ») beside the ladder identifiers, over lib/ and messages/. components/ joins with the console slice (W7), mirroring the J-C14 note: components/claims/AdminFinancialVerification.tsx still carries « aucun remboursement n’a jamais déplacé d’argent » in its no-payableFrom toast branch, unreachable from reconcile since every N8 proof returns payableFrom. The negative control runs the same scan on that file and finds exactly that string.
IMPLEMENTATION NOTE (W3): the refunded-claim → R0 dispatch belongs to W5; W3 pins the gate's refusal with nothing read or written. The applyRowTruth 'reverted' fixture runs on the mine path (G2 (3), refundRowTruth). The mine === 1 fixture's Stripe amount differs from the row's, so « the Stripe amount » is discriminated (tests/claims-r13-reconcile.test.ts).

### J-M43 [CORE] loadOrderMoneyFacts: one read-only loader, same derivation for reconcile and T2
FILE: tests/claims-r13-reconcile.test.ts
PINS: G3, C3 (b)(e') parity
FIXTURE: for each J-M01 no-row state, the facts are fed once through reconcileClaimEvidence (N0-N8) and once through triggerClaimRefund T2(e'). Loader failure variants: order read throws; royalty read throws; PI 'unreadable'; list null; list overCap; one row truth unreadable.
ASSERTION:
- the loader never throws: every throw → {readable:false, permanent:null};
- list overCap → permanent 'list_over_cap'; null → transient;
- the ReapprovalFacts shape has no ownStampedRowIds field;
- deriveNoRowOutcome gives the same kind, prefix and text body (instant excluded) on both paths;
- ownerlessFailedRefunds contains only zero-owner refunds;
- the loader makes 0 Stripe write calls.
NEGATIVE CONTROL: T2 fed a copy with one hold removed → text differs → the parity assertion is red (the test's own proof that it can fail).
BREAK/RESTORE: give T2 its own inline derivation that omits N5 → parity red for A-S38-1; restore → green.
FINDINGS: R-A0-3, V-A-1.
IMPLEMENTATION NOTE (W2): until W3 moves reconcileClaimEvidence onto the loader, the reconcile half of the parity is the pure path (deriveNoRowOutcome + absenceProofText) on the same loader output; T2's written text or park equals it on each fixture.
IMPLEMENTATION NOTE (W2, round-1 fix): the reconcile half now also runs through reconcileClaimEvidence on a lock pre-image (D4) for four fixtures — dead lock, AWAITING, N5 park, H5 disputed (a lock naming the hold on reconcile, a SAFETY_HOLD on T2) — beside the pure-path parity; the full J-M01 no-row state set lands with W3's fixture table (tests/claims-r13-reconcile.test.ts).
IMPLEMENTATION NOTE (W3): the reconcile half runs reconcileClaimEvidence on every J-M01 state that carries reconcile facts (45 or more), and T2 runs on a null pre-image of the same state. Both are checked against deriveNoRowOutcome on the loader's facts:
- reconcile writes exactly the derived text (instant excluded) or park, or nothing;
- T2 writes the same text or park for an (e') outcome;
- where T2 stops at (c), T2's SAFETY_HOLD and reconcile's lock carry the same hold sentences;
- on permanently unreadable facts T2 writes a SAFETY_HOLD;
- where the derivation is payable, the engine is called;
- where it writes nothing, T2 reverts.
IMPLEMENTATION NOTE (W3, round-1 fix): the no-row set is now an EXPLICIT list (48 ids) in tests/claims-r13-reconcile.test.ts, never « the states that carry reconcile facts »: D4 REACHED FROM, the no-row ids of D6 EVIDENCE / TIME EXITS, and the A rows whose RECONCILIATION runs N0-N8. The first test asserts every listed id has reconcile facts, that D4 REACHED FROM is inside the list, and that no other table state carries reconcile facts. A-S05c-2a (FV evidence exit; unstamped 404 row, cursor moved, re_N explained by no settled claim) now runs: N5 park refund_moved_unattributed naming re_N. The « others explained → H1 lock » variant of that row is not a separate fixture; the H1 lock branch on the same unstamped 404 row is covered by A-S05b-2, which also runs now: the E6 lock with « De plus, » the H1 absent hold, never « rattaché ni à l’identité de cette réclamation ».

### J-M44 [CORE] refundRowTruth: absence as evidence, reversal, not on payment
FILE: tests/claims-r13-rowtruth.test.ts (new)
PINS: G4, A-S05a-1, A-S05a-2, A-S05b-1, A-S05b-2, A-S05c-2a, A-S05c-2b, A-S09b, A-S13a, A-S13b
FIXTURE: succeeded row with id: retrieve 404 with absenceIsEvidence and L omitting the id; the same without the flag; pi_OTHER with and without the flag; failed; canceled; pending; requires_action; ETIMEDOUT. Succeeded row without id: L null; tagged refund in L; not found. Pending row: recorded id 404 (A-S13a); pi_OTHER (A-S13b). Failed row.
ASSERTION:
- with the flag: not_ong_payment {how 'absent' | 'other_payment'};
- without the flag: contradiction with the exact key/mode text, or the other-payment text;
- failed/canceled → reverted {refund};
- pending/requires_action → contradiction tagged pendingAtStripe;
- a failed row → row_terminal failed with 0 Stripe calls;
- AST pin: absenceIsEvidence is passed only from loadOrderMoneyFacts, never from the mine / bound path, attribution, R0 or recovery;
- A-S05b-2 unstamped → second reconcile locked (A-S05a-2 copy); stamped (A-S05c-2b) → relabel, same reason, no new alert.
NEGATIVE CONTROL: attribution of the 404 row never sees not_on_payment (contradiction → 409).
BREAK/RESTORE: pass absenceIsEvidence from attributeClaimRefund → a 404 row is treated as absent evidence there → red; restore → green.
FINDINGS: R-A2-5, verifier A missing-id states.
IMPLEMENTATION NOTE (W2, round-1 fix): see the G4 note: the AST pin covers every absenceIsEvidence token and every 5th refundRowTruth argument outside the loader, and the negative control runs through attributeClaimRefund.

### J-M45 [CORE] N0-N7: readability, no-charge proof and pure derivation
FILE: tests/claims-t49-round13-reconcile.test.ts
PINS: G6, G7, A-S02, A-S09a, A-S14a-1, A-S14a-2a, A-S14b, A-S17, A-S18, A-S19, A-S20, A-S29-1, A-S29-2, A-S37, A-S38-1, A-S38-2, A-S40
FIXTURE:
- N1 transient with refunded 0 and with >0; permanent list_over_cap; no_charge canonical; no_charge with a row carrying stripeRefundId.
- N2 standing refund on another charge.
- N3: failed local owner of a standing refund (A-S29-1); single refunded null-error binder (A-S02); binder with resume_mismatch (A-S18); binder refunded with DECLARED_AFTER_REVERT; stamp Y refused_final / unknown / refunded on another row (A-S37); stamp Y bound to refunded X ≠ Y; two owners.
- N4 bracket fail with refunded 0 and >0 (A-S29-2).
- N5 untagged Dashboard succeeded (A-S19), admin-rail row (A-S20), pending Dashboard (A-S40), mixed stamped + bound-only + unexplained.
- N6 contradiction.
- N7 other claim's refund pending (A-S09a); a within-window row; an unclassifiable pending row.
ASSERTION:
- N1: 0 → no updateMany; >0 → park with the G6 detail; overCap → park; canonical no_charge → locked CAS + ALERT-B, outcome no_refund_proven_rail_locked (not the truth-null park); variant → contradiction park;
- every park via enterFinancialVerification with expect = pre-image;
- each G7 branch returns its exact reason and detail;
- AM-A5 names Y's status, YrefundId and X;
- the mixed detail lists unexplained ids apart from explained ones;
- explained-only (A-S02) → proof; A-S17 attribution of the explained row → 409 bound_to_other_claim;
- N7 within window → {no_write, unconfirmed_within_window, until = latest};
- unclassifiable → contradiction park.
NEGATIVE CONTROL: the stamped claim refunded on THAT row → explained → payable.
BREAK/RESTORE: relax N3 to « any refunded binder » (drop the null refundError and single-binder conditions) → the DECLARED_AFTER_REVERT and two-binder fixtures become explained → red. Flip the N4 inequality → red. Restore → green.
FINDINGS: P1-3, P3-22, R-A0-4, R-A1-5.
IMPLEMENTATION NOTE (W1, round-1 fix): A-S17 is pinned — FV claim C, the row the derivation explains by refunded X → attributeClaimRefund 409 bound_to_other_claim naming X, 0 updateMany (negative control: X with resume_mismatch is not a binder). N7's unexplained in-flight id and ER-M01 have fixtures. « every park via enterFinancialVerification with expect = pre-image » lands with the reconcile slice's writer.
IMPLEMENTATION NOTE (W3): « every park via enterFinancialVerification with expect = pre-image » is pinned through the writer: J-M33 checks the where clause, and J-M43 checks the written text on every no-row state. The W1 verifier P3 own-stamp case of N7 is pinned beside the J-M45 fixtures (G7 W3 note).

### J-M46 [CORE] N8: proof-of-absence write, exact text and alert
FILE: tests/claims-t49-round13-copy.test.ts (new)
PINS: G8, A-S01, A-S01b, A-S02, A-S03, A-S04, A-S06a, A-S07, A-S08a, A-S10b, A-S10c, A-S11, A-S26, A-S29-3, A-S39, I-01 (proof prefixes)
FIXTURE: the J-M01 facts per state, rendered through absenceProofText and written by N8. Race variants: the stamped count > 0 at step 1 (A-S29-3); CAS count 0.
ASSERTION:
- prefix payable 'no_refund_proven:v13:' / AWAITING / 'no_refund_proven_rail_locked:';
- HEAD_A and HEAD_B exact, items with « identité portée par la ligne » / « liaison seule »;
- PAYABLE tail exact, including « payable au plus tôt le <ISO> (UTC) »;
- LOCKED and AWAITING tails exact;
- every refusal sentence (E1, E2, E1b, E3 opener, tie, truncated, failed_at_stripe, dead, succeeded_at_stripe, clawback, E4, E5, E6) and every hold sentence (H1 per how, H2, H3, H5 disputed and captured) exact;
- ROUTED appended when causes include E2, E3 failed_at_stripe, H1 reverted or H2;
- every engine quote appears verbatim in lib/refund.ts;
- the write where carries status, refundError, refundAttempted and refundId as read; data sets refundAttempted false and refundId null;
- ALERT-B sent after count 1 for ALL three prefixes (payable included), dedupe claim_blocked:<id>:<prefix>, never on count 0;
- A-S29-3 → changed_during_read with the exact G8/A-S29-3 text and updateMany not called;
- an alert rejection does not fail the write.
NEGATIVE CONTROL: the rendered texts contain none of « jamais », « Aucun ne paie celle-ci », « dite définitive ».
BREAK/RESTORE: skip ALERT-B for the payable prefix (the Track A draft) → red; change one engine quote character → the verbatim pin is red; restore → green.
FINDINGS: P1-1, P1-4, C3 alerts, verifier A E2 sentence.
IMPLEMENTATION NOTE (W3): pinned in tests/claims-t49-round13-copy.test.ts with the wordings of ER-R26 and ER-C24 (G8 W2 note). The A-S29-3 toast text is the console's (F14); W3 pins changed_during_read with updateMany not called.
IMPLEMENTATION NOTE (W3, round-1 fix): complete written refundError texts are now pinned verbatim, with the instant masked, through reconcileClaimEvidence on the J-M01 worlds of A-S01 (HEAD_A + PAYABLE), A-S02 (HEAD_B item + PAYABLE), A-S03 (LOCKED: E6, « De plus, » H1, ROUTED, LOCKED_CLOSE) and A-S10b (AWAITING). A structural test checks that the pinned texts are the G8 pieces joined in order (tests/claims-t49-round13-copy.test.ts).
IMPLEMENTATION NOTE (W8): the structural negative control is no longer tautological. lockedStructureViolations checks the A-S03 text — prefix + HEAD_A + LOCKED_OPEN first, the H1 hold joined with « De plus, », ROUTED then LOCKED_CLOSE last — and the text with its holds joined without « De plus, » and the text with ROUTED moved before the hold each return their violation (tests/claims-t49-round13-copy.test.ts).

### J-M47 [CORE] Temporary versus permanent locks
FILE: tests/claims-r13-rules.test.ts
PINS: G9, D14 (2)/(3), A-S10b, A-S10c, A-S30e-2
FIXTURE:
- A-S10b: another claim's pending row succeeded at Stripe, royaltyRefundCents 0;
- A-S10c: the same with royalty settled and cents 300;
- AWAITING plus H5;
- a tie where one oldest row is dead;
- truncated;
- E6 lock;
- then A-S10b after the other row finalized (the row is now succeeded).
ASSERTION:
- only A-S10b and A-S30e-2 get the AWAITING prefix and tail;
- every other lock gets 'no_refund_proven_rail_locked:' + LOCKED tail with « une cause qui ne dépend d’aucune action ultérieure ne cessera pas »;
- approve on reconcile-admitted locks → D14(2), on others (stripe_failed etc.) → D14(3);
- after finalization, reconcile writes a NEW v13 proof with a NEW Q-INSTANT (> the earlier write time + Q), and the claim is not payable before it;
- T1 refuses every lock prefix; the sweep skips it.
NEGATIVE CONTROL: A-S10c must NOT carry « lorsque cette ligne ne sera plus « en attente » ».
BREAK/RESTORE: drop the clawback exclusion from lockIsTemporary → A-S10c gets AWAITING → red; restore → green.
FINDINGS: R-A0-2, R-A2-4, V-A-1.
IMPLEMENTATION NOTE (W1, round-1 fix): OPEN. « the sweep skips it » is pinned (tests/claims-r13-quiescence.test.ts, C4 note). The LOCKED and AWAITING tail assertions, the tail negative control and « T1 refuses every lock prefix » land with the G8 writer and the T1 slice.
IMPLEMENTATION NOTE (W3): CLOSED. The following are pinned through the writer in tests/claims-r13-rules.test.ts: the LOCKED and AWAITING tails (A-S10b, A-S10c), the negative control that A-S10c carries no AWAITING tail, the NEW v13 instant after the other row finalized (with approval refused before it and T1 already_handled), and T1 refusing every lock prefix.

### J-M48 [CORE] Recovery sweep never settles on a reverted refund
FILE: tests/claims-t49-recovery.test.ts (extended)
PINS: G13
FIXTURE: candidates with the bound row (a) failed; (b) succeeded, retrieve succeeded; (c) succeeded, retrieve failed; (d) succeeded, retrieve ETIMEDOUT; (e) succeeded, 404; (f) pending. A refunded claim on a succeeded row that reverted.
ASSERTION:
- (a)(b) → reconcileClaimForRefund, as before;
- (c) → markClaimsForRevertedRefundRow stripe_object → approved + STRIPE_REVERTED_TEXT, never refunded, and reconcileClaimForRefund not called with 'succeeded';
- (d)(e) → skipped++ with `${claimId}: ${kind}`;
- (f) skipped;
- the where clause excludes refunded claims (source pin: that claim is untouched);
- the sweep is imported only by the cron route and is not referenced by any exit or I-09 surface.
NEGATIVE CONTROL: (b) still settles.
BREAK/RESTORE: remove the re-read → (c) reads refunded → red; restore → green.
FINDINGS: R-A1-1 (recovery is not an exit), verifier A P1.

### J-M49 [CORE] No reconciliation path can create money authority
FILE: tests/claims-reconcile-no-money.test.ts (new)
PINS: G14, D4 (why no money), E0 (NM0), B11 (the only create)
FIXTURE: state classes A-S01, A-S01b, A-S02, A-S03, A-S06a, A-S07, A-S10b, A-S10c, A-S11, A-S14b, A-S19, A-S21, A-S22, A-S31b, A-S31d, A-S33-1, A-S42, A-S43. Run reconcileClaimEvidence, attributeClaimRefund, adoptStripeRefundForClaim, resolveStuckClaim, recoverStrandedClaimReconciliations, markClaimsForRevertedRefundRow, and the closure-notice route. The Stripe mock throws on every create / update / cancel / createReversal.
ASSERTION:
- executeRefund, driveRefund, finalizeRefund and markRefundRowFailed are called 0 times;
- Stripe write methods 0 times;
- refund.update* 0 times; refund.create only by adoption;
- every audit written carries moneyMoved:false;
- no write leaves a claim {approved, refundAttempted:false, refundError:null};
- every payable proof written contains « payable au plus tôt le »;
- AST call-graph pin: reconcileClaimEvidence reaches none of the engine functions.
NEGATIVE CONTROL: the approve route on A-S01 past the instant is the ONE path that reaches executeRefund (proves the spy works).
BREAK/RESTORE: make N8 write refundError null → red; restore → green.
FINDINGS: P1-7, R-D1/CONVERGENCE (reconciliation never calls the engine).
IMPLEMENTATION NOTE (W3): see the G14 W3 note. markClaimsForRevertedRefundRow and the closure-notice route are absent from this tree; the test pins that absence until their slices add them to the run.
IMPLEMENTATION NOTE (W3, round-1 fix): the negative control now drives arbitrateClaim (the function POST /api/admin/claims/[id]/arbitrate calls) with decision approve on the A-S01 v13 proof. Before its instant it is refused (409) and executeRefund is not called; past its instant exactly one executeRefund call follows. The D14 / C4 refusal, the decision CAS and the REFUNDS lease are therefore part of the proof that the spy works. The route wrapper itself (CLAIMS_ENABLED, resolveAdmin, decision email) is not driven: it needs the claims flag open in the test process.
IMPLEMENTATION NOTE (W8): confirmed, no change. The negative control already drives arbitrateClaim (W3 round-1 note); the route wrapper stays gated by CLAIMS_ENABLED, which no test opens.

### J-M50 [CORE] Registry visibility: every E entry appears where it says, and E-08/E-09 are not compliant
FILE: tests/claims-registry-visibility.test.ts (new)
PINS: I-09, E0, E-01, E-02, E-03, E-04, E-05, E-06, E-07, E-08, E-09, E-10, E-11, E-12, E-13, E-14, E-15, E-16, E-17, E-18, A-S31e-1, A-S31e-2
FIXTURE: one DB fixture per E entry (a representative state each), then GET /api/admin/claims/financial-verification and the census.
ASSERTION:
- E-01/E-02/E-06/E-10 in otherUnsettled; E-03/E-04 in financialVerification; E-05 in otherUnsettled during grace, then reconcileRequired; E-07 via the OR clause with refundId in failed-with-id rows (A-S31c) and via unfinalizedRefundRows (A-S31d, counted in k); E-13 in refundedUnproven; E-16 in closureNotices; each counted in total or in its separate count;
- E-11, E-12, E-14, E-15, E-18 visible through their I-07 census key;
- E-17 as an EmailLog 'skipped' row;
- E-08 has no durable surface: only the I-05 alert, and the claim still reads refunded (pinned as the documented C6 breach);
- E-09 (A-S31e-1/2) appears in no bucket, count or census key: a negative pin documenting the gap;
- E-13 and E-07 lists are disjoint;
- financialVerificationCardVisible is true for each of its four inputs alone and false when all are zero.
NEGATIVE CONTROL: refunded claim on a succeeded row that is still succeeded at Stripe → listed nowhere and not E-09-flagged (no false alarm).
BREAK/RESTORE: remove OR clause 2 → A-S31c unlisted → red. Include failed-with-id rows in refundedUnproven → disjointness red. Restore → green.
FINDINGS: R-A0-1, R-A1-1, R-X0-5, R-X0-6, R-X0-7, R-A0-4, REG-7 founder acceptance.
IMPLEMENTATION NOTE (W7 fixer): see the W7 fixer note on J-C45 / J-M50 (union restated without rows of two or more binders; E-17 → J-C47, E-08 I-05 → J-C43, E-11 I-03 → J-C41).

### J-M51 [CORE] Customer status on money states never states an unestablished money truth
FILE: tests/claims-t49-round13-customer.test.ts (new)
PINS: E0 (customer keys), B9(c), A-S31-1, A-S31c, A-S31d, A-S43, E-06, E-07, E-12, E-13, E-14, E-15
FIXTURE: listConsumerClaims / getClaimEligibility with:
- refunded + REVERTED_AFTER_REFUND;
- refunded + DECLARED_AFTER_REVERT;
- refunded null with bound row failed with id / pending / succeeded / missing / unread;
- a row with two binders;
- approved + v13 / RAIL_LOCKED / SAFETY_HOLD / null;
- refunding + marker;
- FV;
- refused_final by declaration;
- CLAIMS off.
ASSERTION:
- REVERTED → financial_verification; declarations → closed_by_support;
- failed-with-id → refund_unconfirmed; pending and succeeded → refunded (no failure signal read); missing → refund_unconfirmed; unread → financial_verification; two binders → financial_verification for both;
- approved v13 / locks / holds / marker → financial_verification; approved null → approved;
- CLAIMS off → {enabled:false}, no claim rendered;
- 'settled_by_support' is never returned;
- fr texts of CBS and RUc contain no « rembours… payé » / « aucun remboursement » sentence;
- the five locale keys exist.
NEGATIVE CONTROL: a single-binder refunded row → refunded.
BREAK/RESTORE: turn the DECLARED startsWith into includes → misclassification → red. Drop the binder count → the two-binder fixture reads refunded → red. Restore → green.
FINDINGS: R-X0-3, R-D4, verifier A (A-S43 never RFc), C6.

### J-M52 [CORE] claim_payment_blocked: every trigger after a won CAS only
FILE: tests/claims-t49-round13-alerts.test.ts (new)
PINS: I-01, A-S30d (attempt_crashed), E-10, C3 (alerts at write time)
FIXTURE: one fixture per trigger: N8 ×3 prefixes; T2 (a), (b) revert, (b'), (c), (e') proof, (e') no_write revert; T4 resume_mismatch, identity_unverified, own-row fatal, engine_failed; applyRowTruth stripe_failed, engine_row_dead, STRIPE_REVERTED; R0a / R0b / R0c; arbitrateClaim approve with triggerClaimRefund returning {state:'pending', reason:'refunds_disabled'} (decision CAS count 1 and count 0); approveClaim via runClaimAutoApproval with the same trigger result; the triggerClaimRefund catch after T1. Each CAS-driven trigger is run with count 1 and with count 0.
ASSERTION:
- MoneyReviewKind includes 'claim_payment_blocked';
- count 1 → sent once, title « Réclamation non payée par le rail — décision admin requise », dedupe claim_blocked:<claimId>:<cause>, cause from the closed enum;
- facts {claimId, orderId, claimStatusAfter, cause, refundRowIds, stripeRefundIds, firstEngineRefusal, holds, routed, quiescenceInstant (v13 only), exits, engineCalled, registry};
- refunds_disabled from arbitrateClaim: facts claimStatusAfter 'approved', engineCalled false, registry 'E-10'; decision CAS count 0 → 409, triggerClaimRefund not called, no alert;
- count 0 → not sent;
- never called inside a $transaction callback (AST);
- a sender rejection does not fail the write or change arbitrateClaim's result;
- serialized facts contain no customer e-mail or address, and none of « réessayez », « payable », « sera payée ».
NEGATIVE CONTROL: two writes of the same cause for one claim → one send (dedupe).
BREAK/RESTORE: remove the refunds_disabled check from arbitrateClaim → red; change the dedupe key to omit the cause → the locked-then-AWAITING sequence loses its second alert → red; restore → green.
FINDINGS: C3, R-A1-5, R-B0-3, N-C-2.
IMPLEMENTATION NOTE (W2): the N8 × 3, applyRowTruth and R0 trigger fixtures land with W3 and the webhook slice; the others are pinned with count 1 and count 0 in tests/claims-t49-round13-alerts.test.ts.
IMPLEMENTATION NOTE (W2, round-1 fix): the N8 × 3 fixtures (D4) with count 1 and count 0, the attempt_crashed engineCalled fixtures and approveClaim with a lost restaurant_review CAS (already_handled, no alert) are pinned in tests/claims-t49-round13-alerts.test.ts; applyRowTruth STRIPE_REVERTED is pinned in tests/claims-r13-identity.test.ts; stripe_failed, engine_row_dead and R0 stay with W3 and the webhook slice.

### J-M53 [CORE] Census counts and the operator precheck census lines
FILE: tests/claims-t49-round13-census.test.ts (new), plus tests/phase2-claims-gate-residue.test.ts (extended)
PINS: I-06, I-07, A-S32-1, A-S32-2, E-04, E-12, E-14, E-15, E-18
FIXTURE: a DB with one member of each population: legacy payable proof; refunded on a failed-with-id row; refunded unproven; own-row resume_mismatch, non-terminal and terminal; orphan stamp claim:Y; a row with two binders; a pending row over 20 h with a settled royalty; approved unpaid; a terminal claim without an H05 closure record (and with a HEAD AdminAuditLog 'claim.arbitrate' row). Plus one variant where each count query rejects, and ADMIN_AUDIT_ENABLED off.
ASSERTION:
- GET /api/admin/claims/census returns claims.legacy and claims.closure with each count = 1, no ids, and null (never 0) for a rejected query; terminalWithoutRecord counts the claim despite its audit row;
- rowsBoundToMultipleClaims uses the OR form (a resume_mismatch second binder is not counted);
- A-S32-*: approve → D14 (1), sweep skip, reconcile (i) admitted;
- phase2-claims-gate.js REHEARSAL PRECHECK prints F(key,value) for every count and a '!! CENSUS:' line for each count > 0 or null, with its I-07 message and E id; done() prints the CENSUS block; the anomalies array, RESULT and WINDOW READINESS are identical to the all-zero run;
- no output line mentions ADMIN_AUDIT_ENABLED, with the flag on or off;
- neither file imports a Stripe client; the census adds no fetch call (the existing probes are unchanged); Prisma write methods are called 0 times;
- the round-13 claimTableReport tests stay green.
NEGATIVE CONTROL: all populations zero → no '!! CENSUS:' line.
BREAK/RESTORE: implement C with A() → approvedUnpaid 1 turns RESULT into FAIL → red; return 0 from a rejected count → red; restore → green.
FINDINGS: R-D6, C3 (pre-deploy alert), R-A0-2, R-B1-1, N-C-1.
IMPLEMENTATION NOTE (W5 fixer): the A-S32-* sweep skip is asserted in tests/claims-t49-recovery.test.ts; the census fixture carries the Track B §M shapes (C_d with a refundError, C_x with its contradiction park dispatch).

### J-M54 [CORE] No scheduled job, no infra change, alerts from the writing request
FILE: tests/claims-r13-absent-surfaces.test.ts
PINS: I-10, I-02, I-03, I-04, I-05 (sender sites)
FIXTURE: repository scan: .github/workflows/*, cron route directories, lib/, app/.
ASSERTION:
- the strings 'claim_payment_blocked' and 'claim_attempt_superseded' appear only in lib/admin-alerts.ts, lib/claims.ts and tests;
- claim_financial_verification is sent only from enterFinancialVerification; claim_refunded_row_unfinalized only from applyRowTruth and attributeWithEvidence (after commit); the refund:<re> alert only from the webhook route;
- the reconcile-refunds, stale-alerts and auto-approve cron routes gain no import of these helpers or of markClaimsForRevertedRefundRow;
- the workflow files are byte-identical to 40da45e (hash pin);
- no new cron path exists under app/api/cron.
NEGATIVE CONTROL: a synthetic import of alertClaimPaymentBlocked into app/api/cron/reconcile-refunds/route.ts (temp copy) → red.
BREAK/RESTORE: add a schedule line to deploy-staging.yml in a temp copy → hash red; restore → green.
FINDINGS: R-D8, C3.

## J. TEST MATRIX — CUSTOMER

One rule = one vitest test (or one gate). It covers sections E, F, H and I, plus the CUSTOMER column of section A.

CONVENTIONS (apply to every J rule):
- Tests run in node env under vitest.config.ts (tests/**/*.test.ts). J-C36 is the exception: it runs under EMAIL-FACTUAL-PACK/tools/vitest.config.ts.
- Source reads are CRLF-safe (read(f).replace(/\r/g,'')) and use stripComments from tests/claims-t49-round7-routes.test.ts.
- Locale loops run over LOCALES = fr, en, es, it, ar.
- NEGATIVE CONTROL is automated inside the test: the input must fail the assertion.
- BREAK/RESTORE CONTROL is executed once by the implementer before commit, and each result is recorded in the round-13 report as « red on break / green on restore ».
- Every route test asserts that executeRefund, driveRefund, finalizeRefund, markRefundRowFailed and every Stripe create/update spy are called 0 times (NM0), unless the rule says otherwise.
- Commit gate: vitest full + npm run check:i18n + a cold npm run build.

### J-C01 [CORE] Customer status derivation table, one fixture per F05 line
FILE: tests/claims-copy-contract.test.ts (new)
PINS: F04, F05, F01
FIXTURE: 15 ClaimFacts rows, one per F05 line, with (boundRowInProgress, refundedRow):
- FV;
- refunding + pending row with a Stripe id (true);
- refunding + marker M;
- refunding + resume_mismatch;
- refunding + identity_unverified;
- approved + each refundError prefix: v13, rail_locked, AWAITING, SAFETY_HOLD, stripe_failed, engine_failed, engine_row_dead, STRIPE_REVERTED, legacy 'no_refund_proven:';
- approved + refundAttempted true, no error;
- approved, clean;
- refunded + REVERTED_AFTER_REFUND;
- refunded null with refundedRow true / false / null;
- refunded + engine_failed;
- refunded + DECLARED_AFTER_REVERT;
- refused_final × arbitrationDecision {null, approved};
- refused_final + refused_final × restaurantResponse {refused, accepted, null};
- restaurant_review, refused, arbitration;
- unknown raw status 'weird'.
ASSERTION: each row returns exactly its F05 key. Every output is a member of CUSTOMER_STATUSES and a key of messages/fr.json claims.status.
NEGATIVE CONTROL:
- refunded null + refundedRow null ≠ 'refunded' and ≠ 'refund_unconfirmed';
- 'weird' ≠ 'weird' (fails closed to FV);
- refused_final + refused_final + accepted ≠ 'refused_final'.
BREAK/RESTORE CONTROL: in lib/claim-action-rules.ts replace `refundedRow===true ? 'refunded'` with `refundedRow!==false ? 'refunded'` → the null row turns red; restore → green.
FINDINGS: P2-10, R-X0-3, verifier A (A-S43 never RFc)

### J-C02 [CORE] Status grid over every writer: each claim write in lib/claims.ts maps to an F05 line
FILE: tests/claims-copy-contract.test.ts
PINS: F05, F04, A-S00 (CUSTOMER column)
FIXTURE: static scan of stripComments(lib/claims.ts). Collect every `data:` object passed to claim.update / claim.updateMany / claim.create / tx.claim.updateMany that sets status or refundError. For each, extract the literal status and the refundError template prefix (MARKERS.* identifier or string head). A hand table WRITERS maps each extracted {function, status, prefix} to an F05 line number.
ASSERTION:
- the set of extracted writers equals the keys of WRITERS: none unmapped and none stale;
- for each writer, customerClaimStatus on a synthetic claim built from {status, refundError: prefix+'x', refundAttempted as written, refundId as written} returns the key of its F05 line;
- no writer writes the status literals 'settled_by_support', 'refund_failed' or 'refund_pending_stripe'.
NEGATIVE CONTROL: append the synthetic source `prisma.claim.updateMany({where:{id},data:{status:'refunded',refundError:'new_marker: x'}})` to the scanned string → reported as unmapped.
BREAK/RESTORE CONTROL: in the scanner input, delete the WRITERS entry for resolveStuckClaim settled_out_of_band → red (unmapped writer); restore → green.
FINDINGS: R-X0-3, P2-10, P2-11
IMPLEMENTATION NOTE (W7): the scanner reads the data objects of (prisma|tx|db).claim.update/updateMany/create, the T4 helper’s call sites (t4Write({…})) and the engine_failed data object; a key is function|status|refundError head (a status not written literally reads '-', a shorthand status '(variable)'); a writer whose effective status is its CAS where (T4, relabels, the reversal marking) is mapped with that status. Pinned in tests/claims-copy-contract.test.ts.

### J-C03 [CORE] Section A customer column: every A state yields its CUSTOMER key
FILE: tests/claims-copy-contract.test.ts
PINS: A-S00 to A-S43 (CUSTOMER column), F04, E0
FIXTURE: table ASTATES built from the CLAIM field of each A rule, with {boundRowInProgress, refundedRow} as the facts give:
- A-S01/S02/S08b v13 → FVc;
- A-S01b, S03 to S08a, S10b/c, S11, S14b, S26, S30, S30c-*, S30e-1/2/4, S30g, S32-*, S39 → FVc;
- A-S06b, S24-* → FVc;
- A-S15a/b, S16a/b, S30d, S33-* (pre-reconcile), S35, S36-* → FVc;
- A-S10, S19 (adopted), S21, S23a-* → RFc (refundedRow true);
- A-S12 approved null pre-image, S30b-1 null, S30e-3 → APc; S30b-1 v13 → FVc;
- A-S31-1/2, S31b → FVc; after either declaration → CBS;
- A-S31c, S31f-1 → RUc (failed row with id → refundedRow false);
- A-S31d before R0b → RFc (pending row proven); after → FVc;
- A-S31e-1/2, S31f-2/3 → RFc (documented breach, J-C18);
- A-S43 → FVc for BOTH binders (refundedRowTruth(row, 2) = null).
ASSERTION: customerClaimStatus(...) === expected for every row, and ASTATES contains every A-S id (the parsed list of section A ids is pinned in the test).
NEGATIVE CONTROL:
- A-S43 with binders 1 → 'refunded' (proves the binder count is what flips it);
- A-S31c with refundedRow true → 'refunded' ≠ RUc.
BREAK/RESTORE CONTROL: in refundedRowTruth delete `if (binders>=2) return null` → A-S43 red; restore → green.
FINDINGS: verifier A (A-S43 customer), R-X0-2, R-X0-5, C6
IMPLEMENTATION NOTE (W7): ASTATES lists every Section A id parsed from this file; a state with several customer keys (A-S12, A-S12b, A-S19, A-S30b-1, A-S31-*, A-S31b, A-S31d, A-S42) carries one variant per key, and its first variant must equal the first key its CUSTOMER field names (checked against this file). Pinned in tests/claims-copy-contract.test.ts.

### J-C04 [CORE] refundedRowProven / refundedRowTruth and the binder-count Prisma shape
FILE: tests/claims-copy-contract.test.ts
PINS: F03, H06 step 6
FIXTURE: rows null, other order, failed with id, failed without id, pending, succeeded, amountCents 0 / 1.5 / -1 / 1250; binders null / 0 / 1 / 2 / 3. A select-aware prisma mock records the where clause of claim.count and claim.groupBy.
ASSERTION:
- proven only for same order ∧ status∈{succeeded, pending} ∧ integer amount > 0;
- truth is null for binders null or ≥2, otherwise equals proven;
- the recorded where contains OR:[{refundError:null},{NOT:{refundError:{startsWith:'resume_mismatch'}}}].
NEGATIVE CONTROL: a where without the {refundError:null} branch fails the shape assertion. The failed-with-id row → false, never true.
BREAK/RESTORE CONTROL: remove `{refundError:null},` from the OR in lib/claims.ts getClaimEligibility → shape test red; restore → green.
FINDINGS: verifier A (ambiguous binding), R-X0-5

### J-C05 [CORE] getClaimEligibility and listConsumerClaims wiring of the customer status
FILE: tests/claims-eligibility-stripe-truth.test.ts (extend)
PINS: F03, F04, F08
FIXTURE: select-aware mocks for claim.findFirst/findMany, refund.findUnique/findMany, claim.count/groupBy. Scenarios:
- refunded + succeeded row;
- refunded + failed row with id;
- row read throws;
- groupBy count 2;
- refunded + engine_failed;
- refunded + REVERTED within the window;
- declaration with arbitrationReason 'NOTE INTERNE'.
ASSERTION:
- statuses in order: refunded, refund_unconfirmed, financial_verification, financial_verification, closed_by_support, financial_verification;
- in the REVERTED scenario canClaim is true inside the window;
- the eligibility select includes restaurantResponse, reason and arbitrationReason;
- listConsumerClaims calls refund.findMany exactly once and claim.groupBy exactly once per page;
- a findMany throw → FV for refunded kinds only; other statuses unchanged;
- CONSUMER_HIDDEN_CLAIM_FIELDS keys are absent from the payload;
- the declaration payload has arbitrationReason null.
NEGATIVE CONTROL: a groupBy throw must not turn a restaurant_review claim into FV.
BREAK/RESTORE CONTROL: call customerClaimStatus(existing, existingBoundConfirmed) without the third argument → the succeeded-row fixture reads FV, red; restore → green.
FINDINGS: P3-21, R-X0-5, C6

### J-C06 [CORE] Closed customer status set; deleted keys stay deleted
FILE: tests/claims-copy-contract.test.ts
PINS: F01, F06, F07, R-D4
FIXTURE: messages/{5}.json; stripComments sources of components/claims/ClaimSection.tsx, app/[locale]/eat/order/[orderId]/help/page.tsx and lib/**.
ASSERTION:
- every CUSTOMER_STATUSES value has a non-empty claims.status key in all 5 locales;
- claims.status keys === CUSTOMER_STATUSES as a set, so refund_failed and refund_pending_stripe are absent;
- none of these exist: claims.status.settled_by_support, eat.help.claimSettledBySupport, claimEmails.settledBySupport, claimEmails.closedBySupport.noPayment;
- no source passes a literal 'settled_by_support' | 'refund_failed' | 'refund_pending_stripe' to t('status.…') or to eligibilityLabel;
- ClaimSection renders only `status.${s}` with s from the payload status.
NEGATIVE CONTROL: the HEAD fr.json status keys (which contain refund_failed and refund_pending_stripe) fail the set equality.
BREAK/RESTORE CONTROL: re-add claims.status.settled_by_support to messages/fr.json → red; remove → green.
FINDINGS: R-X0-3, R-D4

### J-C07 [CORE] Closure provenance: claimClosureKind, CLOSURE_TRIGGER, refusalEmailKind
FILE: tests/claims-closure-provenance.test.ts (new)
PINS: F02, H03, H05 constants
FIXTURE: status {refunded, refused_final, approved} × refundError {null, 'engine_failed: x', REVERTED_AFTER_REFUND+'x', 'declared_settled_after_revert: x', 'no_refund_proven:v13: x'} × arbitrationDecision {refused_final, approved, null} × restaurantResponse {refused, accepted, null, undefined}.
ASSERTION:
- refunded+REVERTED → null;
- refunded+DECLARED_AFTER_REVERT or any other error → settled_by_declaration;
- refunded+null → refunded;
- refused_final with decision ≠ refused_final → closed_by_declaration;
- refused_confirmed only with 'refused';
- every other refused_final+refused_final → refused_by_grubano;
- non-terminal statuses → null;
- CLOSURE_TRIGGER values exactly as F02;
- refusalEmailKind(null) === 'refused_by_grubano';
- CLOSURE_RECORD_TRIGGER === 'claim_closure_record';
- closureRecordKey('x') === 'claim:x'.
NEGATIVE CONTROL: the silent row (restaurantResponse null) is not refused_confirmed; DECLARED_AFTER_REVERT is not null.
BREAK/RESTORE CONTROL:
- (1) startsWith(MARKERS.REVERTED_AFTER_REFUND) → includes('revert') → DECLARED row red;
- (2) restaurantResponse==='refused' → !=='accepted' → silent row red;
restore → green.
FINDINGS: P2-10, R-X0-3

### J-C08 [CORE] Help page lines per customer status
FILE: tests/claims-closure-ui.test.ts (new)
PINS: F07, F06
FIXTURE: stripComments(app/[locale]/eat/order/[orderId]/help/page.tsx), eligibilityLabel block; messages/{5}.json eat.help.
ASSERTION:
- the existing-claim branch maps: restaurant_review→claimAlreadyFiled; financial_verification|arbitration→claimInReview; refunding→claimRefunding; approved→claimApproved; refunded→claimRefunded; refund_unconfirmed→claimRefundUnconfirmed; closed_by_support→claimClosedBySupport; refused|refused_final|refused_by_grubano→claimRefused;
- every CUSTOMER_STATUSES value has a branch;
- eat.help.claimRefundUnconfirmed === claims.status.refund_unconfirmed in each locale;
- the eligibility fetch stays behind the enabled check.
NEGATIVE CONTROL: a synthetic source without the refund_unconfirmed branch is reported (status without branch).
BREAK/RESTORE CONTROL: delete the `refund_unconfirmed` branch in page.tsx → red; restore → green.
FINDINGS: R-X0-5, P2-10

### J-C09 [CORE] Reasons shown to the customer by author, and the console reason label
FILE: tests/claims-closure-provenance.test.ts + tests/claims-closure-ui.test.ts
PINS: F08
FIXTURE: customerClaimReasons over:
- declaration kinds with arbitrationReason 'NOTE INTERNE';
- restaurantResponse 'accepted' with a reason;
- 'refused' with a reason;
- refused_by_grubano with arbitrationReason 'motif G';
- refused_confirmed.
Static sources: ClaimSection.tsx, AdminClaimsArbitration.tsx.
ASSERTION:
- declaration → arbitrationReason null;
- accepted → restaurantResponseReason null;
- refused → shown;
- refused_by_grubano → arbitrationReason 'motif G';
- ClaimSection: showRefusalReason = !!ec.restaurantResponseReason, and it renders t('client.grubanoDecisionReason') under ec.arbitrationReason;
- admin label: c.restaurantResponse==='accepted' ? 'admin.restaurantNote' : 'admin.refusalReason';
- new keys claims.client.grubanoDecisionReason and claims.admin.restaurantNote exist in 5 locales with F08 values.
NEGATIVE CONTROL: the HEAD ClaimSection condition, which shows the restaurant reason under any refusal status, fails the static pin.
BREAK/RESTORE CONTROL: in customerClaimReasons drop `&& !declaration` → 'NOTE INTERNE' leaks, red; restore → green.
FINDINGS: P3-21

### J-C10 [CORE] CLAIMS_ENABLED off: the customer sees no claim
FILE: tests/claims-window-lease.test.ts (extend)
PINS: E0 (customer shown only while CLAIMS_ENABLED), F06, A-S00 customer rule
FIXTURE: isClaimsEnabled false. GET /api/claims for a consumer holding claims in FV, refunded, refund_unconfirmed and refused_by_grubano. Static ClaimSection and help page sources.
ASSERTION:
- body deep-equals {enabled:false};
- no claim object and no status key in the body;
- ClaimSection returns null when enabled is false;
- the help page does not call the eligibility endpoint while it is disabled.
NEGATIVE CONTROL: isClaimsEnabled true → the body contains the claims and their statuses.
BREAK/RESTORE CONTROL: remove the early {enabled:false} return in app/api/claims/route.ts GET → red; restore → green.
FINDINGS: R-X0-4, R-D7

### J-C11 [CORE] Exact customer and console copy values (F06, F09, F17), 5 locales
FILE: tests/claims-copy-contract.test.ts
PINS: F06, F09, F17, R-D9
FIXTURE: an EXPECTED table transcribing the F06 new keys, the F09 rewordings and the F17 labels verbatim for fr/en/es/it/ar.
ASSERTION: messages[loc] at each path === EXPECTED[loc][path]. The unchanged F06 values stay byte-identical to HEAD: restaurant_review, refused, arbitration, approved, refunding, refunded, refused_final, closed_by_support, financial_verification.
NEGATIVE CONTROL: the HEAD values of claims.client.success/description, eat.help.claimFiledSub and claims.admin.refuseFinal (« Confirmer le refus ») fail equality.
BREAK/RESTORE CONTROL: revert claims.admin.refuseFinal fr to « Confirmer le refus » → red; restore → green.
FINDINGS: R-B0-1, P2-10
IMPLEMENTATION NOTE (W7 fixer): the nine unchanged F06 values are pinned byte-identical to HEAD in en, es, it and ar (a table read with git show ad26dac:messages/<loc>.json when the test was written; fr is pinned against the F06 list), and the negative control adds the pre-round-13 HEAD claims.client.success and claims.client.description (fr and en, read at e12c0f3). Pinned by tests/claims-copy-contract.test.ts.

### J-C12 [CORE] Promise guard over customer strings, per-locale patterns, with HEAD negative controls
FILE: tests/claims-closure-copy.test.ts (new); also extend tests/claims-t49-round12.test.ts PROMISES_BY_LOCALE to flatten m.claimEmails.
PINS: F10(1)(a)(b), H12, R-B0-1
FIXTURE: flatten(m.claimEmails), flatten(m.eat.help) and flatten(m.claims.client) per locale. NOTIFY_BY_LOCALE, which extends F10(a) because F10(a) misses three HEAD strings:
- fr: /vous serez informé|dès qu’une décision|s’affichera ici|suivez sa réponse|Grubano arbitrera/i;
- en: /(you('|’)ll|will) be (notified|informed)|will appear here|check this page|will arbitrate/i;
- es: /(le|te) (informaremos|avisaremos)|aparecerá aquí|consulte su respuesta|arbitrará/i;
- it: /sarà informato|la informeremo|apparirà|arbitrerà/i;
- ar: /سيتم إبلاغك|سنُعلمك|سيظهر|تابع رده|ستتولى Grubano/u.
The « Grubano arbitrera » class is allowed only when the same string contains the conditional (« Si la contestation vous est proposée » / « If contesting is offered » / « Si en el seguimiento » / « Se nella pagina » / « إذا عُرض عليك الاعتراض »).
ASSERTION: no hits, in every locale.
NEGATIVE CONTROL: each of these HEAD strings is caught by its own locale's pattern:
- en « Your claim is under review. You'll be notified of the outcome. »;
- es « Tu reclamación está en revisión. Te avisaremos del resultado. »;
- es « …consulte su respuesta en esta página. »;
- en « …— Grubano will arbitrate. »;
- ar « …— وستتولى Grubano التحكيم. »;
- the fr/en/es/it/ar HEAD values of ack.next, orderCancelledPaid.next, client.description, client.success and claimFiledSub.
Not caught: the H12 new ack.next and the new refused.contest.
BREAK/RESTORE CONTROL: restore HEAD en eat.help.claimFiledSub → red; put back the H12/F09 value → green.
FINDINGS: R-B0-1, P2-11

### J-C13 [CORE] Provenance and money-truth guards on new templates and statuses
FILE: tests/claims-closure-copy.test.ts
PINS: F10(2)(3)(4)(5), H04, R-D4
FIXTURE: 5 locales. Groups: claimEmails.closedBySupport.*, refusedByGrubano.*, refundRecorded.*, refundedLinked.*, claims.status.refused_by_grubano, claims.status.refund_unconfirmed.
ASSERTION:
- closedBySupport.* has no /rembours|refund|reembols|rimbors|استرداد|réglé|settled|resuelt|risolt|سُوّي|faveur|favour|favor|لصالح|paiement|payment|pago|pagamento/i;
- refusedByGrubano.* and status.refused_by_grubano have no /confirm|confirmad|confermat|تأكيد|restaurant|restaurante|ristorante|المطعم/i;
- refundRecorded.* has no /abouti|completed|completad|completat|مكتمل|moyen de paiement|payment method|método de pago|metodo di pagamento|وسيلة الدفع|€|\{euros\}/i;
- no « votre réclamation » / 'your claim' / 'su reclamación' / 'il Suo reclamo' / 'شكواك' in refundRecorded.*, refundedLinked.* or refusedByGrubano.*;
- {euros} appears only in refundedLinked.body;
- {ref} is present in every new body/next and in ack.next, orderCancelledPaid.next and refused.contest;
- contact@grubano.com is present in a locale iff present in fr;
- status.refund_unconfirmed contains no RFc value of its locale;
- unit: « Refus confirmé » and « a confirmé le refus » are reachable only when claimClosureKind==='refused_confirmed' (customerClaimStatus → 'refused_final'; refusalEmailKind → 'refused_final').
NEGATIVE CONTROL: these fail:
- the pass-1 string « …sans remboursement… » placed in closedBySupport.body;
- « Refus confirmé par Grubano » placed in status.refused_by_grubano;
- « …remboursement abouti… » placed in refundRecorded.body.
BREAK/RESTORE CONTROL: add « Aucun remboursement n’a été effectué. » to fr closedBySupport.body → red; remove → green.
FINDINGS: R-D4, P2-10, P2-11, C6

### J-C14 [CORE] refundError and admin text scan (F16), including the « la reprend » collision
FILE: tests/claims-t49-round7-routes.test.ts (extend FORBIDDEN and FILES); tests/claims-t49-round10.test.ts (keep PROMISES over lib/claims.ts)
PINS: F16, F15, A-S07, A-S31d, A-S16a/b, E0 REMOVED
FIXTURE: FILES += lib/claim-email-toast.ts and app/api/admin/claims/[id]/closure-notice/route.ts.
FORBIDDEN += /jamais déplacé/i, /aucun remboursement n[’']a déplacé d[’']argent/i, /relèvent d[’']AUTRES réclamations/i, /aucun code ne sort/i, /dite définitive/i, /le moteur refusera tout remboursement/i, /redevient traitable/i, /rien ne sera payé par Grubano/i, /quand le moteur la reprendra/i, /Le client lit désormais/i, /De l[’']argent A bougé/i, /exclusiveReason/.
ASSERTION:
- no hit in any file;
- occurrences of /n[’']appartient PAS/ are counted per file, and the map is pinned: lib/claims.ts = the resume_mismatch writer count, lib/claim-money-line.ts = 1, AdminClaimsArbitration.tsx = 1, each messages file = 1 (approvedResumeMismatch), 0 elsewhere;
- every customer-visibility sentence in lib/claims.ts and the two consoles equals « Quand les réclamations sont ouvertes, le client lit « vérification manuelle » ; sinon il ne voit aucune réclamation. »;
- the pending-row reversal and E3-failed texts use « si le moteur reprend cette ligne », because round10 PROMISES /la reprend/i scans lib/claims.ts;
- the E1c quote « Charge introuvable sur le paiement. » appears only in a branch guarded by piStatus==='succeeded' (static co-occurrence pin);
- no E0 REMOVED identifier appears in lib/, app/ or components/: listRevertedAfterRefundClaims, refund_reverted_claim, apply-row-failure, revertedAfterRefund, terminalBeforeEpoch.
NEGATIVE CONTROL: these fail:
- HEAD lib/claims.ts ~551 « De l'argent A bougé, mais pas au titre de cette réclamation »;
- ~2384 « aucun remboursement n’a jamais déplacé d’argent »;
- AdminFinancialVerification.tsx ~136;
- the synthetic « si le moteur la reprend » (round10 catches it).
BREAK/RESTORE CONTROL: write the identity-read failure branch of triggerClaimRefund with « n’appartient PAS » → occurrence count red; restore the A-S16a text → green.
FINDINGS: P1-2, P1-1, P3-22, R-X0-4, verifier A (E2 sentence, E1c order)
IMPLEMENTATION NOTE (W1, round-1 fix): OPEN. The « n’appartient PAS » map pins messages/fr.json = 1 only: en/es/it/ar carry the same key (claims.admin.approvedResumeMismatch) in their own language, which cannot contain the French phrase; the per-locale equivalents are pinned with F13 (J-C16) in that slice. The FORBIDDEN extension over lib/claims.ts and AdminFinancialVerification.tsx (dropping the W1 subset exemption), the customer-visibility sentence equality, the « si le moteur reprend cette ligne » usage and the E1c co-occurrence pin land with the slices that rewrite those files.
IMPLEMENTATION NOTE (W3): what W3 closes, in tests/claims-t49-round7-routes.test.ts:
- The FORBIDDEN scan now covers lib/claims.ts, since the round-12 ladder is deleted, together with the ladder's identifiers.
- The E1c co-occurrence pin names the exact guarded branches of lib/claim-action-rules.ts, and lib/claims.ts carries no E1c quote.
- The customer-visibility sentence equality is enforced over lib/claims.ts, which carries none yet (G11 writes it).
What stays open:
- AdminFinancialVerification.tsx stays exempt until W7.
- lib/claim-email-toast.ts and app/api/admin/claims/[id]/closure-notice/route.ts do not exist yet; the closure-notice slice adds them to FILES.
- The « si le moteur reprend cette ligne » usage is in G8's E3 continuation (W2); the pending-row reversal text is G11's.
IMPLEMENTATION NOTE (W3, round-1 fix): both W3 pins now have negative controls in tests/claims-t49-round7-routes.test.ts. (1) The customer-visibility scan is case-insensitive, so a sentence starting « Le client lit … » is caught; an injected « Le client lit désormais « vérification manuelle ». » is reported, and the injected canonical F16 (3) sentence is found and accepted. (2) The E1c pin is one predicate; swapping the derivation ternary, or moving the unguarded E1c return before the piStatus test in the C3 (b′) clause, turns it red.
IMPLEMENTATION NOTE (W8): the « What stays open » items of the W3 note are closed. AdminFinancialVerification.tsx lost its exemption with W7 (tests/claims-t49-round7-routes.test.ts, J-C14 W7 comment; J-M31 W7 fixer note: the G2 describe scans lib/, components/ and messages/ with no exemption); lib/claim-email-toast.ts and app/api/admin/claims/[id]/closure-notice/route.ts exist and are in FILES (W6); the « si le moteur reprend cette ligne » usage is the G8 E3 continuation and the G11 pending reversal text, as that note states.

### J-C15 [CORE] Approval toast mapping, one case per result shape
FILE: tests/claim-approval-toast.test.ts (extend)
PINS: F12, A-S15a, A-S16a, A-S30*, A-S33, A-S38, A-S41, E-10
FIXTURE: approvalToast over:
- {state:'refunded', amountCents:1250};
- {state:'pending', reason:'stripe_pending', refundId:'rf'};
- {state:'pending', reason:'refunds_disabled'};
- {state:'pending'} (no reason);
- {state:'already_handled'};
- {state:'failed', error} for each of resume_mismatch, identity_unverified, attempt_superseded, unconfirmed_within_window (+until, and without until), safety_check_unreadable, safety_hold, proof_locked, proof_awaiting, proof_stale, financial_verification, own_row_exists, 'x';
- null; undefined.
ASSERTION: key and tone exactly per F12:
- approvedRefunded carries amountCents; approvedPending only for reason 'stripe_pending';
- success-tone approvedNotSent: pending refunds_disabled, pending without reason, already_handled, safety_check_unreadable, unconfirmed_within_window without until, null, undefined;
- error-tone approvedNotSent: safety_hold, proof_locked, proof_awaiting, proof_stale, financial_verification, own_row_exists;
- approvedNotSentUntil carries until; 'x' → approvedFailed;
- the ApprovalToast and ApprovalRefundOutcome types are pinned (expectTypeOf).
NEGATIVE CONTROL: {state:'pending', reason:'refunds_disabled'} must not map to approvedPending; identity_unverified must not map to approvedResumeMismatch; attempt_superseded must not map to approvedRefunded.
BREAK/RESTORE: map every state 'pending' to approvedPending → red; map 'identity_unverified' to approvedResumeMismatch → red; restore → green.
FINDINGS: P1-2, P2 (toasts), R-B0-3, N-C-2, verifier A (A-S30e-1 not a success toast).

### J-C16 [CORE] Admin approval toast copy and drafting constraints
FILE: tests/claims-copy-contract.test.ts
PINS: F13, R-D9
FIXTURE: claims.admin.{approvedNotSent, approvedPending, approvedIdentityUnverified, approvedSuperseded, approvedNotSentUntil, approvedFailed, approvedResumeMismatch} in 5 locales.
ASSERTION:
- new or reworded values equal F13 verbatim;
- approvedFailed and approvedResumeMismatch contain no « Remboursements à traiter », and no translation of it, in any locale;
- no approval toast names a console section;
- the ar values do not contain « المحرك »;
- es/it values do not match the round12 es/it motor/motore future-tense patterns;
- approvedNotSentUntil contains {date}.
NEGATIVE CONTROL: the HEAD fr approvedNotSent (« …À vérifier dans « Remboursements à traiter » ») fails; the synthetic ar « …المحرك… » fails.
BREAK/RESTORE CONTROL: append the HEAD section sentence to en approvedFailed → red; remove → green.
FINDINGS: P2 (toasts), P1-2

### J-C17 [CORE] Reconcile toasts, money labels, guidance and the identity_unread money line
FILE: tests/claims-t49-round10.test.ts (extend) + tests/claim-money-line.test.ts (extend)
PINS: F14, F15, A-S36-1, A-S24-1
FIXTURE:
- stripComments(AdminFinancialVerification.tsx) `said` map;
- moneyStateGuidance(absence_proven_payable | approved_not_driven);
- AdminClaimsArbitration MONEY label;
- moneyLineFor with resume_mismatch + boundRow.reason `claim:${id}`, resume_mismatch + another reason, boundRow undefined, REVERTED_AFTER_REFUND, STRIPE_REVERTED.
ASSERTION:
- `said` values equal F14 verbatim;
- no_refund_proven renders ${payableFrom}, or « instant illisible — relancez la réconciliation » when absent;
- refund_still_standing branches: succeeded / pending|requires_action / not_at_stripe_yet, and the last reuses the unconfirmed_within_window toast;
- needsAttention ⊇ {no_refund_proven_rail_locked, awaiting_finalization, reverted_after_refund};
- guidance equals F15, and absence_proven_payable mentions « au plus tôt »;
- money line certainty identity_unread / bound_but_not_ours / unknown / bound_reverted ×2;
- a legacy 'no_refund_proven:' claim classifies reconcile_required, never absence_proven_payable;
- the attribute and adopt toasts render body.error for every 409.
NEGATIVE CONTROL:
- the HEAD toast « le moteur refusera tout remboursement », « redevient traitable » and « toujours ABOUTI ou en attente » for not_at_stripe_yet each fail;
- a resume_mismatch on the claim's own row must not yield bound_but_not_ours.
BREAK/RESTORE CONTROL: drop the own-reason branch in lib/claim-money-line.ts → A-S36-1 fixture red; restore → green.
FINDINGS: P1-4, P1-7, P2 (toasts), verifier B (legacy own-row resume_mismatch), R-X0-4

### J-C18 [CORE] Disclosure of the customer copy that stays wrong (REG-7, C6 breach)
FILE: tests/claims-closure-copy.test.ts
PINS: F11, E-08, E-09
FIXTURE: docs/ops/REFUND-FINANCIAL-CONTRACT.md; every messages/*.json; lib/claims.ts; both console components; docs/ops/*.md.
ASSERTION:
- the contract doc contains, for A-S31e-1/2, « NOT fail-visible » plus « founder acceptance »;
- for A-S31f-2/3 it contains « C6 » plus « bounded by Stripe redelivery »;
- no admin string, doc or message contains /only true copy|n’affiche que des phrases vraies|conforme C6/i adjacent to E-08/E-09/A-S31e/A-S31f.
NEGATIVE CONTROL: a synthetic doc line « E-09 … shows only true copy » is caught.
BREAK/RESTORE CONTROL: delete the REG-7 paragraph from the doc → red; restore → green.
FINDINGS: R-B0-4, R-X0-1, C6

### J-C19 [CORE] i18n and build gate
FILE: gate (no vitest file): npm run check:i18n, then a cold npm run build (rm -rf .next first), both before commit; exits read from ${PIPESTATUS[0]} or a redirect, never from a pipe tail.
PINS: F18, R-D9, H04, F06, F09, F13, F17, H11
FIXTURE: messages/{fr,en,es,it,ar}.json after all edits, made sequentially by one agent.
ASSERTION: check:i18n exits 0 (key parity across 5 locales), and the build exits 0.
NEGATIVE CONTROL: a temp copy of en.json missing claims.status.refund_unconfirmed makes scripts/check-translations.js exit non-zero (run once, recorded).
BREAK/RESTORE CONTROL: as the negative control, then restore → exit 0.
FINDINGS: R-D9
IMPLEMENTATION NOTE (W7): run. npm run check:i18n exits 0 after the W7 message edits. Negative control on a scratch copy of scripts/check-translations.js and messages/: en.json without claims.status.refund_unconfirmed → exit 1 (« ✗ en.json: 1 missing »); restored → exit 0. The cold build result is recorded in the W7 report.

### J-C20 [CORE] CLAIMS_ENABLED skip in every claim sender (R-D7)
FILE: tests/claim-emails.test.ts (update)
PINS: H02, H03, H06, H11, I-08, E-17
FIXTURE: mocks for sendTransactional, logEmailSkipped and prisma. Senders:
- sendClaimAckEmail, sendClaimDecisionEmail (each kind incl. refused_by_grubano), sendClaimClosureEmail (record present, refunded proven, stripe_read evidence), all with claimsOpen:false;
- the existing expectations updated to pass claimsOpen:true and objectContaining.
ASSERTION: with claimsOpen false:
- the result is {status:'skipped', why:'claims_disabled'};
- sendTransactional is called 0 times;
- logEmailSkipped is called once with why 'claims_disabled' → recipient « (non envoyé : claims_disabled) »;
- console [EMAIL MISS] contains « not sent (claims_disabled) ».
For sendClaimClosureEmail, the record check precedes: no record + claimsOpen false → no_closure_record.
sendOrderCancelledPaidEmail/OffEmail take no claimsOpen and keep the {status} shape.
NEGATIVE CONTROL: claimsOpen true on the same fixtures → sendTransactional called once.
BREAK/RESTORE CONTROL: remove the `if (!p.claimsOpen)` guard in sendClaimDecisionEmail → red; restore → green.
FINDINGS: R-D7, P2-11

### J-C21 [CORE] Every sender call site evaluates the lease at send time
FILE: tests/claims-closure-imports.test.ts (new)
PINS: H02, H13
FIXTURE: stripComments of every file under app/ containing sendClaimAckEmail | sendClaimDecisionEmail | sendClaimClosureEmail. Also app/api/orders/[id]/status/route.ts.
ASSERTION:
- each call expression's argument object contains `claimsOpen: isClaimsEnabled()`;
- the files containing such calls are exactly the 8 routes listed in H15;
- in orders status route, `isClaimsEnabled()` is evaluated in the send branch (claimsOpenNow) and the claim-mentioning variant requires it.
NEGATIVE CONTROL: a synthetic `sendClaimDecisionEmail({claimId, claimsOpen: true})` and a synthetic `claimsOpen: claimsOn` (entry value) are both flagged.
BREAK/RESTORE CONTROL: in respond/route.ts replace `isClaimsEnabled()` with `true` → red; restore → green.
FINDINGS: R-D7, R-B0-1
IMPLEMENTATION NOTE (W6) on ER-C17: the files containing sender calls are the 7 claim routes; the orders status route is pinned separately (claimsOpenNow in the send branch).

### J-C22 [CORE] Arbitrate decision e-mail: kind by provenance, 'refunded' only on the engine's CAS-won result
FILE: tests/claim-emails-routes.test.ts (extend) + tests/claims-c2-routes.test.ts
PINS: H03, F02, A-S15a, A-S16a, A-S41, E-10
FIXTURE: POST arbitrate with arbitrateClaim mocked to return:
- (a) refuse_final with claim.restaurantResponse 'refused';
- (b) refuse_final with null;
- (c) approve + refund {state:'refunded', amountCents:1250};
- (d) approve + refund state 'failed' with each of attempt_superseded, identity_unverified, resume_mismatch, safety_hold, proof_locked, refunds_disabled;
- (e) approve + state 'pending';
- (f) isClaimsEnabled true at the gate, then false at send.
ASSERTION:
- decision (a) refused_final, (b) refused_by_grubano, (c) refunded with refundedCents 1250, (d)(e) approved with refundedCents null;
- trigger for (b) = claim_decision_refused_final;
- (f) claimsOpen false passed, response customerEmail.why 'claims_disabled';
- the response includes customerEmail;
- executeRefund is not called by the route.
NEGATIVE CONTROL: no (d) fixture ever produces decision 'refunded'.
BREAK/RESTORE CONTROL: replace `result.refund?.state==='refunded'` with `!!result.refund` → (d) red; restore → green.
FINDINGS: P2-10, P1-2, R-D7

### J-C23 [CORE] Closure record: single writer, exact sites, only after a won CAS, never in a transaction
FILE: tests/claim-closure-record.test.ts (new)
PINS: H05, C4, C6, C7, D10, D11, F02
FIXTURE:
- static scan of lib/**, app/** and scripts/**;
- behaviour mocks per H05 site: triggerClaimRefund T4 success; reconcileClaimForRefund succeeded (webhook and recovery); applyRowTruth row_terminal succeeded and at_stripe succeeded; attributeWithEvidence after an observed commit (row and adoption); attributeWithEvidence C7 re-read showing {refunded, R}; arbitrateClaim refuse_final; resolveStuckClaim both resolutions (including DECLARED_AFTER_REVERT);
- each site run with updateMany count 1 and count 0 (C7: re-read unchanged);
- emailDispatch.create rejecting with P2002 and with a generic Error.
ASSERTION:
- 'claim_closure_record' is written (emailDispatch.create) only inside recordClaimClosure; recordClaimClosure call sites equal the seven H05 sites; none inside a $transaction callback; none in app/api/webhooks/stripe/route.ts (the webhook reaches it only through reconcileClaimForRefund); no sendTransactional uses that trigger; no code deletes it;
- count 1 (or the C7 re-read branch) → record {trigger, dedupeKey 'claim:<id>'}; count 0 / re-read unchanged → no record;
- P2002 → returns true silently; another error → returns false and console.error '[EMAIL MISS] [claim_closure_record]'; each caller's return deep-equals its success return, except C7's operator text (record-failed variant);
- reconcileClaimForRefund → exactly one console.error '[EMAIL MISS] [claim_decision_refunded] … webhook or the recovery sweep …' when the record returned true; no other site logs it;
- no deploy-epoch constant (/NOTICE_EPOCH|DEPLOY_EPOCH|noticeEpoch/) anywhere;
- no eligibility code reads adminAuditLog (source scan of lib/claim-emails.ts and the closure-notice route).
NEGATIVE CONTROL: a synthetic `emailDispatch.create({data:{trigger:'claim_closure_record'…}})` in app/x.ts is flagged.
BREAK/RESTORE: move the recordClaimClosure call in resolveStuckClaim before the count===1 check → the count-0 fixture writes → red; restore → green.
FINDINGS: R-B1-1, N-C-1, P2-11.
IMPLEMENTATION NOTE (W6): the site-5 call lives in bindingNotObserved, which attributeWithEvidence calls on a transaction error; the call-site map names it. The BREAK/RESTORE run moved the call in resolveStuckClaim before the count check: the count-0 fixture wrote a record and turned red.
IMPLEMENTATION NOTE (W6 fixer) on J-C23: « no other site logs it » is pinned twice. Statically, the only recordClaimClosure call with an options argument is the one inside reconcileClaimForRefund (an AST scan by top-level function, with a synthetic negative control). In behaviour, sites 1, 6 and 7 assert no « [EMAIL MISS] [claim_decision_refunded] » line, and site 2 gains a count-0 fixture (claim rewritten before the CAS: no record, no line).

### J-C24 [CORE] sendClaimClosureEmail check order, one fixture per step, one EmailLog row per attempt
FILE: tests/claims-closure-emails.test.ts (new; supersedes Track B's tests/claim-closure-email.test.ts)
PINS: H06, H04, H11, R-D4, R-D6(d)
FIXTURE: select-aware mocks. Fixtures:
- not found;
- approved / refunding / FV / refunded+REVERTED;
- terminal without record;
- record + claimsOpen false;
- refused_confirmed and refused_by_grubano (delegate spy);
- refunded row failed;
- other order / refundId null / amount 0;
- binders 2;
- evidence undefined / {basis:'ledger_row'} / amount 0 / 1.5;
- stripe_read 1300 vs row 1250;
- stripe_read 1250 = row;
- pending row + equal evidence;
- both declaration kinds;
- no recipient;
- sendTransactional 'skipped' / 'failed';
- prisma throw;
- locale ar.
ASSERTION, in order:
- claim_not_found; not_applicable/not_a_closure with no record read; no_closure_record; claims_disabled;
- delegate called with decision refusalEmailKind(c) and reason = DB arbitrationReason;
- refunded_row_failed; refunded_row_unproven ×2; stripe_not_confirmed;
- refundRecorded.* with no « € » and no digits of the amount;
- refundedLinked.body with « 12,50 »; pending → refundedLinked;
- declarations → trigger claim_closed_by_support, closedBySupport.*, no evidence required, no note or amount in the html;
- no_recipient; smtp_disabled; sender_error; never throws;
- ar html dir rtl;
- every fixture produces exactly one EmailLog row (traceMiss XOR sendTransactional's own).
NEGATIVE CONTROL: for the not-proven-at-Stripe refunded fixture with a succeeded row and evidence undefined, sendTransactional is called 0 times.
BREAK/RESTORE CONTROL: delete the record check (step 3) → the legacy fixture sends, red; restore → green.
FINDINGS: R-X0-1, R-X0-2, R-B0-4, R-B1-1, R-D4, P2-11
IMPLEMENTATION NOTE (W6) on ER-C19: « exactly one EmailLog row » holds for every fixture that reaches a template; the not_applicable fixtures assert no row.

### J-C25 [CORE] Parity: customer refund_unconfirmed ⇔ closure sender refunded_row_unproven/failed
FILE: tests/claims-closure-emails.test.ts
PINS: F18(h), F03, H06
FIXTURE: the cross product of refunded claims with a record, claimsOpen true and a readable row: row {missing, other order, failed with id, failed without id, pending, succeeded} × amountCents {0, 1250} × binders {1, 2}. Evidence stripe_read equal.
ASSERTION:
- customerClaimStatus === 'refund_unconfirmed' ⇔ why ∈ {refunded_row_unproven, refunded_row_failed} with binders 1;
- binders 2 → customer FV and why refunded_row_unproven;
- customer 'refunded' ⇔ the sender reaches sendTransactional.
NEGATIVE CONTROL: none of these combinations occur: customer 'refunded' with a sender refusal, or refund_unconfirmed with a send.
BREAK/RESTORE CONTROL: make refundedRowProven admit status 'failed' → parity red; restore → green.
FINDINGS: R-X0-5, C6

### J-C26 [CORE] Closure send sites in operator routes: when, with what evidence, never changing the HTTP result
FILE: tests/claims-resolve-stuck-route.test.ts, tests/claims-t49-routes.test.ts, tests/claims-t49-round12.test.ts (update)
PINS: H07, H06, H14, R-D4
FIXTURE:
- resolve-stuck: both resolutions + a note;
- reconcile outcomes: refunded/stripe_read 1300, refunded/ledger_row, no_refund_proven, rail_locked, awaiting_finalization, reverted_after_refund, refund_still_standing, park, changed_during_read;
- attribute: row and adopt branches refunded, dryRun, 409 refusal, 409 wrote:true (A-S34), lost race (A-S42);
- sender rejecting.
ASSERTION:
- resolve-stuck calls sendClaimClosureEmail once with {claimId, claimsOpen}, and no argument contains the note or an amount;
- reconcile sends only for outcome refunded, with evidence {stripe_read, 1300} for stripe_read and undefined for ledger_row;
- every other outcome → customerEmail null and the sender is not called;
- attribute sends only for !dryRun ∧ refunded, with result evidence;
- a sender rejection → same HTTP status and body plus customerEmail.why 'sender_error';
- 403/404/409/400 → not called.
NEGATIVE CONTROL: reverted_after_refund must not call the sender (R-D3).
BREAK/RESTORE CONTROL: in reconcile/route.ts send for any outcome ≠ 'refunded' → red; restore → green.
FINDINGS: P2-11, R-D3, R-D4

### J-C27 [CORE] POST /api/admin/claims/[id]/closure-notice
FILE: tests/claims-closure-notice-route.test.ts (new)
PINS: H08, H06, E-09, E-16
FIXTURE: mocks resolveAdmin, rateLimit, prisma.claim, reconcileClaimEvidence, sendClaimClosureEmail, recordAdminAudit, isClaimsEnabled. Cases:
- non-admin;
- body {amount:1} / {note:'x'};
- missing claim;
- kind null (approved, REVERTED);
- declaration and refusal kinds;
- refunded with R0 returning each of: refund_still_standing{succeeded,1250}, {pending}, stripeStatus missing, amount 12.5, reverted_after_refund, changed_during_read, a refusal, a throw;
- isClaimsEnabled false.
ASSERTION:
- 403; 400; 404;
- 409 « Cette réclamation n’appelle pas d’avis de clôture… » with no sender and no audit;
- declaration/refusal: reconcile NOT called, sender evidence undefined;
- refunded: only the succeeded integer case passes {stripe_read,1250}; every other case passes undefined;
- reverted_after_refund → 409 whose text contains « Quand les réclamations sont ouvertes », sender not called;
- changed_during_read → 409;
- audit metadata {status, why, kind, moneyMoved:false};
- claims off → 200 with customerEmail.why 'claims_disabled' (route not gated);
- imports from '@/lib/claims' are only {isClaimsEnabled, reconcileClaimEvidence}; no executeRefund or getStripe token in the file.
NEGATIVE CONTROL: the pending case must not reach sendTransactional (spied through the real sender with record + row).
BREAK/RESTORE CONTROL: accept stripeStatus 'pending' as evidence → red; restore → green.
FINDINGS: R-X0-1, R-B0-4, R-B1-1, P2-11

### J-C28 [CORE] Nothing is sent from the webhook, recovery, reconcile-refunds or a reversal
FILE: tests/claims-closure-webhook.test.ts (new)
PINS: H09, R-D3, R-D8, F05 line 7
FIXTURE: a spy on sendTransactional/sendOnce. Scenarios:
- webhook refund.updated succeeded settlement of a bound pending row;
- webhook refund.failed on a succeeded bound row (helper marks);
- webhook redelivery on an already-failed row;
- recoverStrandedClaimReconciliations;
- POST reconcile-refunds;
- reconcile R0a/R0b/R0c marking.
ASSERTION:
- no call with a trigger starting 'claim_decision' or 'claim_closed';
- the settlement writes a closure record, the reversal writes none;
- the reversal claim's customerClaimStatus is financial_verification;
- the reconcile-refunds response has no closureEmails field;
- the only webhook sends are admin alerts (I-05).
NEGATIVE CONTROL: the same spy records claim_decision_refunded on the arbitrate refunded fixture (proves the spy works).
BREAK/RESTORE CONTROL: add `sendClaimClosureEmail` to the recovery path in a temp copy → the J-C29 walk and this spy are red; restore → green.
FINDINGS: R-D3, P2-11, R-X0-6

### J-C29 [CORE] Import topology and webhook text guards
FILE: tests/claims-closure-imports.test.ts; extend tests/email-idempotency.test.ts, email-order-status.test.ts, email-resto-notif.test.ts, order-email-sweep.test.ts, order-notification-scheduler.test.ts
PINS: H15, H09, I-10
FIXTURE: a static ESM walker resolving '@/…' and relative paths, static and dynamic import(). Roots: app/api/webhooks/stripe/route.ts, app/api/admin/claims/reconcile-refunds/route.ts, every app/api/cron/**/route.ts.
ASSERTION:
- no root reaches lib/claim-emails.ts or lib/claim-email-toast.ts;
- lib/claims.ts has no /claim-emails|claim-email-toast/;
- lib/claim-emails.ts imports only lib/claim-action-rules, lib/prisma, lib/transactional-emails, lib/order-ref, lib/onboarding-nudge and next-intl/server;
- lib/claim-emails.ts and lib/claim-email-toast.ts have no /@\/lib\/(refund|stripe|claims)['"]/;
- importers of lib/claim-emails are exactly the 8 H15 routes;
- the five webhook text guards add /claim-emails|sendClaimClosureEmail|sendClaimDecisionEmail/.
NEGATIVE CONTROL: the walker over an in-memory tree where lib/claim-action-rules.ts gains `import '@/lib/claim-emails'` reports the webhook path.
BREAK/RESTORE CONTROL: add `import { sendClaimClosureEmail } from '@/lib/claim-emails'` to lib/claims.ts → red; remove → green.
FINDINGS: R-D3, R-D8
IMPLEMENTATION NOTE (W6) on ER-C23: the roots are the webhook, reconcile-refunds and the routes read from .github/workflows/cron.yml (stale-alerts included); app/api/cron does not exist.

### J-C30 [CORE] Missing-notice and unproven-row lists, FV route counts, card sections
FILE: tests/claim-closure-lists.test.ts (new) + tests/claims-t49-routes.test.ts + tests/claims-closure-ui.test.ts
PINS: H10, I-09, E0, E-13, E-16, E-18
FIXTURE:
- records for each kind, with and without a dispatch row under CLOSURE_TRIGGER[kind] and under another trigger;
- a REVERTED claim;
- a claim without a record;
- refunded rows: unproven / failed with id / failed without id;
- 5001 records;
- an insert between pages;
- FV route with each list rejecting.
ASSERTION:
- listMissingClaimClosureNotices lists record ∧ no same-trigger dispatch ∧ kind ≠ null;
- a dispatch under another trigger does not exclude;
- blocker refunded_row_failed vs refunded_row_unproven;
- paging is stable under an insert;
- scanTruncated past 5000; items ≤200 in decidedAt desc;
- listRefundedClaimsWithUnprovenRow lists the E-13 shapes, excludes failed-with-id, succeeded, pending, refundError set and REVERTED; reconcilable === (reconcileRefusal(facts+boundRow)===null);
- FV route: a list rejection → 200 with money lists intact, {error:'unreadable'} and the count null; counts.total excludes closureNoticesMissing and refundedUnproven; no revertedAfterRefund key;
- UI: « Avis client non envoyés » and « Réclamations remboursées dont la ligne liée n’est pas établie » render outside the red heading;
- the E-18 intro sentence is verbatim;
- the send button is disabled iff blocker;
- no « Appliquer l’échec de la ligne ».
NEGATIVE CONTROL: a notices-only fixture renders no « Vérification financière requise ».
BREAK/RESTORE CONTROL: move the two new lists inside the money Promise.all in financial-verification/route.ts → the rejection fixture answers 500, red; restore → green.
FINDINGS: R-X0-5, R-X0-6, R-B1-1, P2-11
IMPLEMENTATION NOTE (W7 fixer): added to the J-C30 files — the step-6 parity of closureNoticeBlocker, the id-cursor paging of listRefundedClaimsWithUnprovenRow (a claim leaving the set between pages; negative control: the offset read misses the next claim), the « a un statut inconnu » section A text, and the capped-items line of both sections (tests/claim-closure-lists.test.ts, tests/claims-closure-ui.test.ts).

### J-C31 [CORE] E-mail result toast mapping, fr mirror and logEmailSkipped
FILE: tests/claim-email-toast.test.ts (new) + tests/email-idempotency.test.ts (extend)
PINS: H11, I-08
FIXTURE:
- customerEmailLine over sent, duplicate, each ClaimEmailWhy, skipped without why, failed, not_applicable, null, undefined;
- messages/{5}.json claims.admin.customerEmail;
- logEmailSkipped(trigger, subject, ctx, why) with why claims_disabled / undefined / no_recipient;
- static sources of reservations/route.ts, reservations/[id]/cancel/route.ts, restaurants/[id]/closures/route.ts.
ASSERTION:
- mapping per H11: sent success, duplicate info, all others error;
- no_closure_record → notSent;
- CUSTOMER_EMAIL_FR has 9 keys and deep-equals fr.json claims.admin.customerEmail;
- the 5 locales have the 9 keys with H11 values;
- the toast module imports nothing from lib/refund, lib/stripe or lib/claims;
- why claims_disabled → console « not sent (claims_disabled) » and recipient « (non envoyé : claims_disabled) »;
- undefined/no_recipient output is byte-identical to HEAD;
- the three other callers still pass 3 arguments.
NEGATIVE CONTROL: 'duplicate' passed as a skip why is not a ClaimEmailWhy (type test expectTypeOf fails to compile on a synthetic literal, run via tsc).
BREAK/RESTORE CONTROL: map stripe_not_confirmed to 'sent' → red; restore → green.
FINDINGS: P2-11, R-D7
IMPLEMENTATION NOTE (W6 fixer) on J-C31: the in-test « BREAK/RESTORE witness » built its own broken mapper and passed whatever the module contained, so it was removed. The break/restore is the mutation of lib/claim-email-toast.ts itself, caught by the mapping assertion (stripe_not_confirmed → error / stripeNotConfirmed).

### J-C32 [CORE] E-mail template values and rewordings, 5 locales
FILE: tests/claims-closure-copy.test.ts
PINS: H04, H12
FIXTURE: an EXPECTED table verbatim from H04 (refusedByGrubano.title/body; closedBySupport.subject/title/body/next; refundedLinked.body/next; refundRecorded.subject/title/body/next) and H12 (ack.next, orderCancelledPaid.next, refused.contest).
ASSERTION:
- values equal EXPECTED;
- ack.next === orderCancelledPaid.next in each locale;
- rendering ack.next and refused.contest through the sender puts orderRef(orderId) in the html with no literal '{ref}';
- kept values approved.body, refunded.body, refusedFinal.body and accepted.body are byte-identical to HEAD.
NEGATIVE CONTROL: the HEAD refused.contest in each locale fails equality, and the J-C12 pattern catches it.
BREAK/RESTORE CONTROL: revert it refused.contest to HEAD « …— Grubano arbitrerà. » → red; restore → green.
FINDINGS: R-B0-1, P2-10, P2-11

### J-C33 [CORE] Paid-cancellation variant chosen at send time
FILE: tests/email-order-status.test.ts (extend)
PINS: H13, R-D7
FIXTURE: PATCH order status to cancelled on a paid order. Lease sequences for isClaimsEnabled: (true at entry, true at send), (true, false), (false, false).
ASSERTION:
- (true,true) → sendOrderCancelledPaidEmail only;
- (true,false) and (false,false) → sendOrderCancelledPaidOffEmail only;
- exactly one send per order, trigger order_cancelled, dedupe order:<id>;
- createSystemClaim gating is unchanged (entry value).
NEGATIVE CONTROL: (true,false) never calls the claim-mentioning variant.
BREAK/RESTORE CONTROL: choose the variant from the entry value claimsOn → (true,false) red; restore → green.
FINDINGS: R-D7, R-B0-1
IMPLEMENTATION NOTE (W6): the route-driven fixture is tests/email-order-status-variant.test.ts, because tests/email-order-status.test.ts mocks Prisma for the mail rail only; it also runs the (false, true) sequence of ER-C20. The source pin and the webhook text guard stay in tests/email-order-status.test.ts.

### J-C34 [CORE] Operator declaration panel copy
FILE: tests/claims-closure-ui.test.ts
PINS: H14, H07
FIXTURE: stripComments of AdminClaimsArbitration.tsx and AdminFinancialVerification.tsx.
ASSERTION:
- both panels contain the H14 literal verbatim, including « tentent de lui envoyer un e-mail de clôture » and « aucun e-mail n’est envoyé tant que les réclamations sont fermées »;
- the placeholder « Ce qui s’est réellement passé (facultatif, jamais montré au client)… » is present;
- after decide/resolveStuck/reconcile/attribute/closure-notice success, customerEmailLine(body.customerEmail) drives a toast;
- AdminClaimsArbitration uses t(`admin.customerEmail.${e.key}`), AdminFinancialVerification uses CUSTOMER_EMAIL_FR[e.key].
NEGATIVE CONTROL: the HEAD panel text (no e-mail sentence) fails.
BREAK/RESTORE CONTROL: delete the customerEmailLine toast after resolveStuck in AdminFinancialVerification → red; restore → green.
FINDINGS: P2-11, R-D4

### J-C35 [CORE] Census fields and precheck census lines (pre-deploy populations)
FILE: tests/claims-t49-round12.test.ts (CENSUS) + tests/phase2-claims-gate-residue.test.ts
PINS: H16, I-06, I-07, C3
FIXTURE:
- the census route with per-field mocks for legacyPayableProofs, refundedBoundToFailedRow, refundedRowUnproven, ownRowResumeMismatch{nonTerminal,terminal}, terminalDeclarationWithArbitrationReason, refundedAfterContradictionAttribution, refundedBoundToOtherClaimStamp, rowsBoundToMultipleClaims, pendingRowsOver20hWithSettledRoyalty, approvedUnpaid, closure{missing, terminalWithoutRecord};
- one mock rejecting at a time;
- ADMIN_AUDIT_ENABLED off;
- phase2-claims-gate.js run on a mocked Prisma handle (fetch stubbed for the existing probes) with non-zero and all-zero counts.
ASSERTION:
- each field is an integer or null, never 0 on failure; one rejection nulls only its field;
- refundedAfterContradictionAttribution is null when audit is off; closure.* are measured whatever the audit flag (they read EmailDispatch, not AdminAuditLog);
- no cuid (/c[a-z0-9]{24}/) and no dedupeKey in the payload; the route comment states E-09 is not counted;
- the script prints one '!! CENSUS:' line per non-zero or null count with the I-07 message and its E id, and a CENSUS block in done();
- census lines never enter the anomalies array: RESULT and WINDOW READINESS equal the all-zero run;
- no line mentions ADMIN_AUDIT_ENABLED;
- the census code imports no lib/stripe and adds no fetch call (the probes at lines 79 and 242 stay the only fetches); Prisma write spies (create/update/delete) = 0;
- the round-13 snapshot/claimTableReport output is unchanged.
NEGATIVE CONTROL: all-zero counts print no census line.
BREAK/RESTORE: share one try/catch across the legacy fields → one rejection nulls all → red; route census lines through A() → RESULT FAIL → red; restore → green.
FINDINGS: R-B0-2, R-B1-1, R-X0-1, N-C-1.

### J-C36 [CORE] Rendered e-mail pack: new variants and claimsOpen
FILE: EMAIL-FACTUAL-PACK/tools/render-current.test.ts (run with its own EMAIL-FACTUAL-PACK/tools/vitest.config.ts; not in the main include)
PINS: H18(i), H03, H04, H06
FIXTURE:
- every existing sender call passes claimsOpen:true;
- the db mock gains claim.findUnique, refund.findUnique, emailDispatch.findFirst (record present) and emailDispatch.create;
- renders CLAIM_DECISION_REFUSED_BY_GRUBANO, CLOSURE_REFUNDED_LINKED, CLOSURE_REFUND_RECORDED, CLOSED_BY_SUPPORT in fr and ar.
ASSERTION:
- each render captures one send;
- the html contains the H04 title and body with {ref} resolved;
- the refundRecorded render has no « € »;
- the ar render has dir rtl;
- EMAIL-MANIFEST.md lists CLAIM_CLOSED_BY_SUPPORT and CLAIM_CLOSURE_REFUND;
- EMAIL-TRIGGER-MAP.md names no webhook, cron or reconcile-refunds as a closure-notice send site.
NEGATIVE CONTROL: a call without claimsOpen fails with 'no send captured'.
BREAK/RESTORE CONTROL: render closedBySupport with an amount placeholder → the no-« € » assertion red; restore → green.
FINDINGS: P2-11, R-D4
IMPLEMENTATION NOTE (W6): render ids CLAIM_DECISION_REFUSED_BY_GRUBANO (decision sender), CLAIM_DECISION_REFUSED_BY_GRUBANO_NOTICE, CLOSURE_REFUNDED_LINKED, CLOSURE_REFUND_RECORDED and CLOSED_BY_SUPPORT, in fr and __ar. EMAIL-MANIFEST.md carries the rows CLAIM_DECISION_REFUSED_BY_GRUBANO, CLAIM_CLOSURE_REFUND and CLAIM_CLOSED_BY_SUPPORT; EMAIL-TRIGGER-MAP.md carries the closure-notice paragraph, which names only the four send sites.

### J-C37 [CORE] At most two closure notices per claim, in the only permitted order
FILE: tests/claim-closure-record.test.ts
PINS: H01, H05, H06, F02
FIXTURE: a table over kinds × prior dispatch rows. Sequences:
- (1) engine refunded e-mail sent → resend;
- (2) engine e-mail → REVERTED marker → DECLARED_AFTER_REVERT → resend;
- (3) refused_final e-mail → resend;
- (4) closed_by_declaration e-mail → resend;
- (5) refunded notice → a synthetic attempt at claim_decision_refused_final.
ASSERTION:
- (1) duplicate;
- (2) claim_closed_by_support sent as the second trigger, record kept (P2002 silent);
- (3)(4) duplicate;
- no sequence yields a third claim trigger or a closure trigger other than CLOSURE_TRIGGER[kind];
- during the REVERTED stage the resend returns 409 with no send.
NEGATIVE CONTROL: sequence (2) without the REVERTED stage (refunded → closed_by_support) is impossible: claimClosureKind never moves refunded+null to a declaration without a resolve-stuck write, and resolveStuckClaim refuses refunded without the REVERTED prefix.
BREAK/RESTORE CONTROL: let isStuckResolvable accept refunded with refundError null → (5)-style second notice appears, red; restore → green.
FINDINGS: P2-11, R-X0-3
IMPLEMENTATION NOTE (W6): the BREAK/RESTORE mutation as written cannot turn red: resolveStuckClaim refuses a terminal claim (« Cette réclamation est déjà clôturée. ») before the predicate runs (W5), so widening isStuckResolvable alone changes nothing. The run widened both the terminal exemption in resolveStuckClaim and isStuckResolvable (refunded with refundError null admitted): the declaration then went through on a settled claim and the negative control turned red. (5) is asserted through the closure sender: every attempt uses CLOSURE_TRIGGER[kind] of the claim's database state.
IMPLEMENTATION NOTE (W8): confirmed, no change. The W6 note records why the mutation as written cannot turn red (resolveStuckClaim's W5 terminal guard refuses before isStuckResolvable runs) and the widened mutation that was run instead.

### J-C38 [DEFER] Off-variant cancellation body drops the process promise
FILE: tests/claims-closure-copy.test.ts
PINS: H17
FIXTURE: claimEmails.orderCancelledPaidOff.body in 5 locales.
ASSERTION: no /traitée par un membre de l’équipe pendant la bêta|handled by a team member during the beta|la gestiona una persona del equipo durante la beta|gestita da un membro del team durante la beta|يعالج أحد أعضاء الفريق كل طلب/; {resto}, {ref} and contact@grubano.com remain.
NEGATIVE CONTROL: the HEAD fr body fails.
BREAK/RESTORE CONTROL: restore the HEAD fr body → red; reword → green.
FINDINGS: R-B0-1 (hygiene)
IMPLEMENTATION NOTE (W8): pinned in tests/claims-closure-copy.test.ts with the HEAD bodies at 4d3e442 byte-for-byte: no locale matches the promise regex, {resto}, {ref} and contact@grubano.com remain, and each body is its HEAD body minus the trailing clause. Negative control: every HEAD body fails. Break/restore run in W8: the HEAD fr body restored in messages/fr.json → red; the reworded body back → green.

### J-C39 [CORE] claim_payment_blocked: sent only after a won CAS, per cause, deduped
FILE: tests/claims-t49-round13-alerts.test.ts (new)
PINS: I-01, E-01, E-02, E-05, E-06, E-07, E-10
FIXTURE: a spy on sendAdminMoneyReviewAlert. One scenario per trigger, each with updateMany count 1 and count 0:
- N8 v13 / rail_locked / AWAITING;
- T2 (a), (b) revert, (b'), (c), (e') proof, (e') within-window revert;
- T4 resume_mismatch / identity_unverified / own-row fatal / engine_failed;
- applyRowTruth stripe_failed / engine_row_dead / STRIPE_REVERTED;
- R0a/R0b/R0c;
- arbitrateClaim approve (decision CAS) + triggerClaimRefund {state:'pending', reason:'refunds_disabled'} — the beta writer of E-10;
- approveClaim via runClaimAutoApproval + the same trigger result (flag-off path, still pinned);
- the triggerClaimRefund catch after T1 (attempt_crashed).
ASSERTION:
- count 1 → one call, kind 'claim_payment_blocked', title « Réclamation non payée par le rail — décision admin requise », dedupe `claim_blocked:${id}:${cause}`, cause in the closed enum;
- facts keys exactly as I-01, registry equal to the E id (refunds_disabled → 'E-10', engineCalled false), quiescenceInstant only for v13;
- count 0 → no call (for arbitrateClaim: 409 and triggerClaimRefund not called);
- no call inside a $transaction callback;
- facts and title have no /payable|sera payé|réessayez|@|€/i and no consumer name/email;
- the attempt_crashed call precedes the rethrow and a rejecting alert does not swallow the rethrow.
NEGATIVE CONTROL: the lost-CAS fixture must produce 0 calls.
BREAK/RESTORE: move the refunds_disabled alert from arbitrateClaim into approveClaim only → the arbitrate fixture sends nothing → red; change the dedupe key to `claim_blocked:${id}` → the two-cause fixture sends one alert instead of two → red; restore → green.
FINDINGS: R-B0-2, R-B0-3, N-C-2, C3.

### J-C40 [CORE] claim_financial_verification on entry and on relabel with a new reason only
FILE: tests/claims-t49-round13-alerts.test.ts
PINS: I-02, E-03, E-04
FIXTURE: enterFinancialVerification from approved, from refunding, FV→FV with the same reason, FV→FV with a new reason, relabel CAS lost.
ASSERTION:
- entry → alert dedupe `claim_fv:${id}:${reason}`;
- same reason → none;
- new reason → one alert with the new reason;
- lost CAS → none;
- facts keys unchanged;
- no fact or title matches /another refund|nouveau remboursement peut/i.
NEGATIVE CONTROL: the same-reason relabel produces 0 calls.
BREAK/RESTORE CONTROL: drop the reason comparison → same-reason fixture alerts, red; restore → green.
FINDINGS: R-B0-2, P1-3
IMPLEMENTATION NOTE (W3): pinned in tests/claims-t49-round13-alerts.test.ts, running the real sendAdminMoneyReviewAlert over a deduping sendOnce. « facts keys unchanged » is the shipped set listed in the I-02 W3 note.

### J-C41 [CORE] claim_attempt_superseded and the T4 attempt-token CAS
FILE: tests/claims-t49-round13-alerts.test.ts
PINS: I-03, E-11, A-S41, F12
FIXTURE: triggerClaimRefund with executeRefund returning ok / 202 / 409, and the T4 updateMany returning 0 (claim reconciled meanwhile) or 1.
ASSERTION:
- every post-engine claim write is updateMany where {id, status:'refunding', refundError:M};
- no prisma.claim.update remains in triggerClaimRefund (static);
- count 0 + ok/202 → one alert kind 'claim_attempt_superseded', dedupe `claim_attempt:${id}:${refundRowId}`, facts per I-03, return {state:'failed', error:'attempt_superseded'} → toast approvedSuperseded;
- count 0 + 409 → console.warn only;
- count 1 → no superseded alert;
- no fact matches /payé deux fois|paid twice|must be reversed|à rembourser/i;
- M carries an ISO timestamp and a nonce, and reconcileMarkerAge parses it.
NEGATIVE CONTROL: the count-1 ok fixture must not alert superseded.
BREAK/RESTORE CONTROL: replace the T4 updateMany with claim.update({where:{id}}) → the count-0 fixture overwrites, red; restore → green.
FINDINGS: CONVERGENCE (late attempt), verifier A

### J-C42 [CORE] claim_refunded_row_unfinalized triggers
FILE: tests/claims-t49-round13-alerts.test.ts
PINS: I-04, A-S10, A-S21
FIXTURE: applyRowTruth at_stripe succeeded on a pending row; attribution PROVEN on a pending row (commit observed / transaction threw); adoption D9 (mirror succeeded).
ASSERTION:
- at_stripe → one alert;
- attribution → one alert only after the observed commit, none when the transaction throws;
- adoption → none;
- no text matches /ledger (appliqué|applied)|clawback (appliqué|applied)|reprise de royalty appliquée/i.
NEGATIVE CONTROL: the thrown-transaction fixture sends 0 alerts.
BREAK/RESTORE CONTROL: send the alert inside the $transaction callback → the thrown fixture alerts, red; restore → green.
FINDINGS: P2-14, P1-5
IMPLEMENTATION NOTE (W5 fixer): the thrown-transaction fixture runs the callback, rolls its writes back and then rejects with P2034, so the break/restore mutation (the alert sent inside the callback) makes that fixture alert.

### J-C43 [CORE] Webhook failed/canceled branches: alert order, claimIds, helper 503, money writes byte-identical
FILE: tests/webhook-refund-reconciliation.test.ts (extend) + tests/webhook-money-guards.test.ts
PINS: I-05, E-06, E-07, E-08, A-S31-1, A-S31b, A-S31f-1/2/3
FIXTURE: handleRefundStatusEvent with:
- (a) failed event, bound row pending;
- (b) redelivery, row already failed;
- (c) failed event, bound row succeeded;
- (d) status succeeded.
Each with markClaimsForRevertedRefundRow {failed:false} / {failed:true} / a lost CAS; claim.findMany for claimIds resolving or throwing.
ASSERTION:
- (a) markRefundRowFailed and reconcileClaimForRefund run before the helper; helper failed → 503, else 200;
- (b) only the helper runs (no markRefundRowFailed, no reconcileClaimForRefund);
- (c) the alert (dedupe refund:<re>) is sent BEFORE the helper, facts.claimIds = ids or 'unread'; helper failed → 503;
- (d) no new 5xx path; handler calls and order identical to HEAD (call-order snapshot);
- the helper writes only claim.updateMany with the exact pre-image, never refund.*, never Stripe, never the engine;
- no customer e-mail trigger (J-C28);
- after (a) and (c) marking, customerClaimStatus of the claim is FV.
NEGATIVE CONTROL: a lost CAS with failed:false → 200, never 503.
BREAK/RESTORE CONTROL: swallow helper errors (return failed:false in catch) → the DB-throw fixture answers 200, red; restore → green.
FINDINGS: R-X0-1, R-X0-2, R-X0-6, R-B0-4, R-D3
IMPLEMENTATION NOTE (W5 fixer): the FV assertions use the real customerClaimStatus (with a negative control reading an unmarked settled claim « refunded »); the lost-CAS variant runs on the pending-row, failed-row and succeeded-row branches (200, never 503, claim untouched). tests/webhook-money-guards.test.ts is unchanged: it covers payment_intent events only (no refund status branch), and the J-M06 call-order pins of handleRefundStatusEvent stay in tests/claims-r13-engine-closed.test.ts.

### J-C44 [CORE] Customer e-mail miss signals, one row per attempt
FILE: tests/claims-closure-emails.test.ts
PINS: I-08, H11, E-16, E-17
FIXTURE: one attempt per non-send cause through each sender and route (arbitrate, resolve-stuck, reconcile, attribute, closure-notice, respond, claims POST).
ASSERTION:
- exactly one EmailLog row per attempt;
- when sendTransactional was not reached: status 'skipped', recipient `(non envoyé : ${why})`, subject `claim ${id}`, with why in the H03 ClaimEmailWhy set;
- smtp_disabled and failed: only sendTransactional's own row;
- console.error `[EMAIL MISS]` includes the claim id;
- operator routes return customerEmail driving the toast; consumer/restaurant routes return none;
- claim status is unchanged by any skip (prisma.claim write spies 0 after the decision CAS).
NEGATIVE CONTROL: I-08's names no_address, not_eligible and duplicate never appear as why values.
BREAK/RESTORE CONTROL: call traceMiss after a 'failed' sendTransactional → two rows, red; restore → green.
FINDINGS: P2-11, R-D7

### J-C45 [CORE] Registry visibility: every E entry is in its bucket and count; E-09 and E-08 pinned as not visible
FILE: tests/claims-registry-visibility.test.ts (new)
PINS: E0, E-01 to E-18, I-09, F05
FIXTURE: one claim fixture per E entry (plus one per sub-shape where the surface differs: E-05 during and after grace, E-07 A-S31c vs A-S31d). GET /api/admin/claims/financial-verification with real list builders over mocked Prisma. financialVerificationCardVisible (lib/claim-money-line.ts) widened to {claimRows, unfinalizedRows, closureNotices, refundedUnproven}.
ASSERTION:
- E-01/E-02/E-06/E-07c/E-10 → otherUnsettled, counted in total;
- E-03/E-04 → financialVerification;
- E-05 after grace → reconcileRequired; during grace → otherUnsettled with no button;
- E-07d → unfinalizedRefundRows (k);
- E-13 → refundedUnproven, outside total;
- E-16 → closureNotices, outside total;
- E-11/E-12 non-terminal → their E-03/E-04 bucket;
- E-09 fixture → in no list and no count (negative pin with comment « REG-7 NOT FAIL-VISIBLE »);
- E-08 → no durable list; only the I-05 alert;
- per row, the D0 flags reconcilable/resolvable/approvable equal the server rule verdicts;
- the customer status of each fixture equals E's CUSTOMER field (via customerClaimStatus);
- the 16-row truth table of financialVerificationCardVisible: true iff any input > 0; the red heading iff claimRows||unfinalizedRows.
NEGATIVE CONTROL:
- the E-13 list ∩ failed-with-id additions to listActionableRefundClaims = ∅;
- their union = all refunded null-error claims with !refundedRowProven or failed-with-id rows.
BREAK/RESTORE CONTROL: remove the `{status:'refunded', refundError startsWith REVERTED_AFTER_REFUND}` OR clause from listActionableRefundClaims → E-06 fixture invisible, red; restore → green.
FINDINGS: R-B0-2, R-B0-3, R-B0-4, R-X0-2, R-X0-5, R-X0-6, R-X0-7
IMPLEMENTATION NOTE (W7 fixer) on J-C45 / J-M50: the union negative control is restated as « every refunded null-error claim with !refundedRowProven or a failed-with-id row, EXCEPT a row with two or more binders (A-S43) » — such a row is in neither list (H10 W7 note (3)) and its claims read the manual review (FVc). A multi-binder unproven fixture pins it (in neither list, both claims FVc; negative control: with one binder the claim is in section A). Halves carried by other slices’ tests and not re-asserted in tests/claims-registry-visibility.test.ts: E-17 as an EmailLog skipped row → J-C47 (tests/claim-emails-routes.test.ts); E-08’s I-05 alert → J-C43 (tests/webhook-refund-reconciliation.test.ts); E-11’s I-03 alert → J-C41 (tests/claims-t49-round13-alerts.test.ts). The registry test pins E-11 as its financialVerification bucket only.

### J-C46 [CORE] No money from any registry surface (NM0) and gated exits of E-10
FILE: tests/claims-registry-visibility.test.ts
PINS: E0 NM0, E-10, E-13, E-14, E-18, R-D5
FIXTURE:
- spies on executeRefund, driveRefund, finalizeRefund, markRefundRowFailed, stripe.refunds.create/update and transfers.createReversal;
- routes reconcile, attribute (preview and write), resolve-stuck, closure-notice, the FV GET, the census GET, the webhook helper;
- E-10 fixtures: arbitrate with CLAIMS off; approve with REFUNDS off; v13 proof before Q-INSTANT; A-S30e-3 before until.
ASSERTION:
- every registry route and the helper → all money spies 0;
- the audits carry moneyMoved:false;
- arbitrate CLAIMS off → 403;
- REFUNDS off → triggerClaimRefund returns refunds_disabled before its CAS (no claim write), toast approvedNotSent success;
- before Q-INSTANT → arbitrationRefusal approve refused with a text containing the instant, and T1 returns already_handled without writing;
- the customer status is APc for a null error, FVc for v13;
- no route or rules module offers an « annuler l’approbation » action (/annuler l[’']approbation|cancel_approval/ absent);
- refuse_final on every approved claim (arbitrationDecision null or approved) → refused.
NEGATIVE CONTROL: arbitrate approve with both leases open, past Q-INSTANT and T2 passing → executeRefund called once (proves the spy).
BREAK/RESTORE CONTROL: remove the Q-INSTANT check in arbitrationRefusal → the before-instant fixture reaches T1, red; restore → green.
FINDINGS: R-B0-3, R-X0-7, CONVERGENCE (fresh payable proof)
IMPLEMENTATION NOTE (W7 fixer): tests/claims-registry-visibility.test.ts now drives POST /api/admin/claims/[id]/attribute as a WRITE through the route (the Serializable $transaction commits and the FV claim settles on the Stripe-proven row; executeRefund, refunds.create, refunds.update, transfers.createReversal and every Refund write stay 0; the audit claim.attribute_refund carries moneyMoved:false), GET /api/admin/claims/census with the internal token (200; money spies 0; no claim or dispatch write; 401 without the token), and the E-10 fixture A-S30e-3 before until through arbitrateClaim approve (T2 (e′) unconfirmed_within_window: executeRefund 0, the pre-image restored, toast approvedNotSentUntil carrying until; negative control: the same world without the pending row reaches the engine once). Still not driven through a route: the attribute preview (a lib dryRun test) and the webhook marking helper (called directly; its route half is J-C43 in tests/webhook-refund-reconciliation.test.ts). driveRefund, finalizeRefund and markRefundRowFailed have no separate spy: lib/refund is mocked as a whole with executeRefund as its only engine export, so any other engine entry would throw on a missing export.

### J-C47 [CORE] Non-terminal e-mail skipped as claims_disabled when the lease closes mid-request
FILE: tests/claim-emails-routes.test.ts (extend)
PINS: E-17, H02, I-08
FIXTURE: POST /api/claims (create) and POST respond (accept/refuse), with isClaimsEnabled true at the entry gate and false at the send.
ASSERTION:
- the claim CAS/create ran;
- the sender receives claimsOpen false;
- the EmailLog row has status skipped, recipient « (non envoyé : claims_disabled) », subject `claim <id>`;
- no sendTransactional call;
- the response status equals the success status;
- no resend route accepts a non-terminal claim (closure-notice → 409).
NEGATIVE CONTROL: the gate true + send true fixture sends once.
BREAK/RESTORE CONTROL: read the lease once at entry and reuse it for the send → red; restore → green.
FINDINGS: R-D7, R-B0-1
IMPLEMENTATION NOTE (W6): the EmailLog row is written by the real logEmailSkipped on mocked Prisma, and the real senders run with the mail rail mocked (tests/claim-emails-routes.test.ts).
IMPLEMENTATION NOTE (W6 fixer) on J-C47 / J-C44: the 201 body of POST /api/claims and the 200 body of POST respond are asserted to carry no customerEmail property (consumer and restaurant routes return none, I-08); the negative control is the arbitrate route under the same mid-request lease closure, whose 200 body carries customerEmail {skipped, claims_disabled}.

### J-C48 [CORE] No scheduled job, no infra change, alert kinds confined
FILE: tests/claims-closure-imports.test.ts
PINS: I-10, R-D8, H09(9)
FIXTURE: git-independent file reads of .github/workflows/*.yml, any cron config files in the repo (the list is pinned by the test), app/api/cron/**, app/api/admin/claims/reconcile-refunds/route.ts, lib/**, app/**.
ASSERTION:
- the workflow and cron file hashes equal the values pinned at HEAD 40da45e;
- the strings 'claim_payment_blocked' and 'claim_attempt_superseded' appear only in lib/admin-alerts.ts, lib/claims.ts and tests;
- no cron or reconcile-refunds route references listMissingClaimClosureNotices, sendClaimClosureEmail, markClaimsForRevertedRefundRow or 'claim_closure_record';
- no file matches /closure.?notice.?sweep/i.
NEGATIVE CONTROL: a synthetic occurrence of 'claim_payment_blocked' in app/api/cron/x/route.ts is flagged.
BREAK/RESTORE CONTROL: add `sendAdminMoneyReviewAlert({kind:'claim_payment_blocked'…})` to stale-alerts in a temp copy → red; restore → green.
FINDINGS: R-D8, R-B0-2

## LEDGER — every pass-2 P0/P1 (recomputed)

- **R-A0-1** [P0] ACCOUNTED — rules: A-S31d G1 G10 G11 D7 E-07; tests: J-M36 J-M40 J-M50; State A-S31d added. Gate G1(iii) admits refunded + null error + pending bound row. R0b (G10) reads refundRowTruth only; on failed/canceled it calls the G11 helper with pending_row_stripe and marks the claim only, leaving the row untouched. The control sits on the unfinalized list (D7). Registered in E-07.
- **R-A0-2** [P1] ACCOUNTED — rules: G5 G9 G3 G8 A-S00 A-S10 A-S10c A-S13b I-06 I-07; tests: J-M02 J-M04 J-M47 J-M53; G5 classes succeeded_at_stripe_clawback from the royalty facts at any age, fail closed; G9 excludes it from temporary locks; A-S10c is locked. J-M04 no longer contradicts itself. (g) at 21 h: 409 with createReversal 0. (g2) at 1 h: the engine can finish (createReversal once), yet G5 still classes clawback and lockIsTemporary is false. (g3) no locatable transfer and (g4) truncated reversals: clawback class, fail closed. The negative control flips royalty facts only (royaltyRefundCents 0 or royalty 'pending' → succeeded_at_stripe, temporary), never age. Break/restore adds an age gate to G5 and must go red. I-07's census line pendingRowsOver20hWithSettledRoyalty is non-blocking.
- **R-A0-3** [P1] ACCOUNTED — rules: C3 A-S38-1 A-S38-2 G1 D4 D2; tests: J-M20 J-M43 J-M33; T2(e') runs deriveNoRowOutcome on fresh reads for every pre-image, v13 included. An unexplained out-of-band refund parks the claim in FV (A-S38-1/2), where adopt/attribute apply. G1(i) now admits v13 payable proofs to reconcile. J-M20 pins 0 executeRefund calls across the invalidating variants.
- **R-A0-4** [P1] ACCOUNTED — rules: E-04 A-S19 E-03; tests: J-M50 J-M15 J-M35; E-04 now lists « A-S19 when not adopted (R-A0-4) », with the E-03 surface and no-money reasons: FV approve is refused, the sweep selects approved only, and adoption happens only from an operator-supplied link.
- **R-A0-5** [P1] ACCOUNTED — rules: A-S16a A-S00; tests: J-M03; A-S16a records ENGINE ACCEPTS YES (no pending row, E6 free on the moved cursor, no E5b). NEW MONEY NO is placed on Claims-side guards (refunding, T1 CAS, approve refused). J-M03 break/restore sets A-S16a to NO → red.
- **R-A1-1** [P0] ACCOUNTED — rules: G11 D12 G1 G10 A-S31d A-S31e-1 A-S31e-2 A-S31f-2 E-08 E-09 G13; tests: J-M36 J-M40 J-M48 J-C43 J-M50; (a) G11 returns failed on a DB throw → webhook 503 (D12). (c) G1(iii) + R0b cover pending rows. (b) R0c is a route-only re-verify, and E-09 is presented as NOT fail-visible for founder acceptance. G13 keeps the sweep from ever settling on a reversal.
- **R-A1-2** [P0] ACCOUNTED — rules: C5 B6 A-S41 E-11 I-03 C2; tests: J-M22 J-M17 J-C41; Every post-engine claim write in triggerClaimRefund is updateMany on {id, 'refunding', M}, with M unique per attempt (C2). On count 0 nothing is written and I-03 fires. J-M22 pins the race: R2 stays bound and W's attribution of R2 → 409 bound_to_other_claim.
- **R-A1-3** [P1] ACCOUNTED — rules: G5 B3 A-S07 A-S04 A-S08a; tests: J-M08 J-M02; G5 restricts H2 to routed refunds with zero owners. B3 owners match by stripeRefundId or grubano_refund_row, whatever the row status. A pending owner → E3 failed_at_stripe (A-S07 without H2); a succeeded owner → H1 (A-S04). J-M08 breaks the metadata clause → red.
- **R-A1-4** [P1] ACCOUNTED — rules: G1 D4 D1 D14 D0; tests: J-M33 J-M29 J-M28 J-M31; G1(i) admits 'no_refund_proven_rail_locked:' (AWAITING included) and (i-b) admits 'refund_safety_hold:'. D1 rows 4-5 give reconcile + stuck_close. D0 parity renders a control only when the server accepts it. D14(2) is selected only when reconcileRefusal is null.
- **R-A1-5** [P1] ACCOUNTED — rules: E-10 C3 A-S30c-1 A-S30c-2 A-S14b I-01 D1; tests: J-M05 J-M19 J-M30 J-M32 J-C46; E-10 registers approved-unpaid states while CLAIMS or REFUNDS is closed, naming the surface, customer copy, I-01 alert and no-money reasons. C3(b') separates permanent no_charge / list_over_cap (closable SAFETY_HOLD) from transient reverts. D1 gated-only sets must name an E id.
- **R-A2-1** [P0] ACCOUNTED — rules: C6 C7 C10 B6 D8 A-S42 C8; tests: J-M23 J-M24 J-M25 J-M10; The binder read (boundToWhere) and the FV→refunded CAS run in one Serializable prisma.$transaction. Every abort re-reads the claim and reports without ok, audit or notice (C7). J-M23 pins the mocked shape; J-M24 is the two-connection MariaDB rehearsal.
- **R-A2-2** [P1] ACCOUNTED — rules: G1 G10 G11 A-S31d A-S31e-1 A-S31e-2 E-07 E-09 D7; tests: J-M36 J-M40 J-M50 J-C45; Pending variant: G1(iii) + R0b + pending_row_stripe evidence (claim only), with the control on the unfinalized list (E-07). Succeeded variant: E-09 is explicitly NOT fail-visible and needs founder acceptance; R0c is the route-only exit. J-M50 negative-pins E-09's invisibility.
- **R-A2-3** [P1] ACCOUNTED — rules: G1 D4 D1 A-S30 E-01; tests: J-M33 J-M29; G1(i-b) admits approved + refundAttempted true + no refundId + SAFETY_HOLD, safe because T2 never called the engine. D1 row 5 = ['reconcile','stuck_close']. J-M29 pins listed reconcilable against the server verdict, with a negative control (hold with refundId set → false).
- **R-A2-4** [P1] ACCOUNTED — rules: D14 G8 G9; tests: J-M31 J-M47 J-M28; D14 splits the refusal into (1) legacy, (2) REVISABLE « Rien n’est payé tant que cet état est enregistré » when reconcileRefusal is null (AWAITING and markers included), and (3) PERMANENT. G8's LOCKED and AWAITING tails qualify with « tant que ». J-M31/J-M47 pin the selection.
- **R-A2-5** [P1] ACCOUNTED — rules: A-S13b A-S16a A-S05c-1 A-S05c-2a A-S05c-2b A-S30b-2a A-S30b-2b A-S36-1 A-S36-2 A-S36b A-S12 A-S12b A-S00 A-S30c-1 C3; tests: J-M01 J-M03 J-M04 J-M05; Split rows keep strict C5 answers. A-S13b's resume is corrected against refund.ts: - driveRefund retrieves the foreign id with no PI check; - on succeeded, the clawback createReversal can move franchisor money (524-559), with the resume refusals; - resolveFeeTruth lists only the order PI's refunds, so feeBackCents is null and the eager ledger line is skipped (588, 615): NO ledger line; - the row goes to succeeded (619), then the royalty recompute runs. J-M04 (i) asserts recordRefundLedgerEntry 0 and the skip warn; with royalty facts, createReversal once. The second engine mismatch is also resolved: C3(b') and A-S30c-1 quote E2 before E1b/E1c when a failed row with a Stripe id exists (refund.ts 744-750 precede the PI read), pinned by J-M05 (d).
- **R-B0-1** [P1] ACCOUNTED — rules: H12 F09 F10 H04; tests: J-C12 J-C32 J-C11; ack.next and orderCancelledPaid.next become « Pour toute question, répondez à cet e-mail… {ref} » (H12); eat.help.claimFiledSub is reworded (F09). F10 plus J-C12's per-locale guard over claimEmails.*, eat.help.* and claims.client.* use the HEAD strings as negative controls.
- **R-B0-2** [P1] ACCOUNTED — rules: I-01 I-07 I-06 E-13 E-14 E-15 E-01; tests: J-M52 J-C39 J-M53 J-C35; New writers (SAFETY_HOLD, locks, own-row, T2, T4) send I-01 claim_payment_blocked at write time after a won CAS. Legacy populations (E-13/E-14/E-15) alert through the I-07 precheck census anomaly, as C3 prescribes for pre-deploy data.
- **R-B0-3** [P1] ACCOUNTED — rules: E-10 I-01 D2 D13 D14 F12; tests: J-M30 J-M32 J-M52 J-C39 J-C15 J-C46; Widening: E-10 covers the CLAIMS OR REFUNDS lease closed. Surface: ARB queueReason legacy_pending_money_decision and the CARD otherUnsettled. Customer: APc/FVc. D13/E-10 state that AM-B3 removes refuse_final for arbitrationDecision-null approvals. The alert now fires from the real beta writer. I-01 and D2 place it in arbitrateClaim, after its decision updateMany (count 1), when triggerClaimRefund returns {state:'pending', reason:'refunds_disabled'} (claims.ts 504). approveClaim keeps the same check for the flag-off auto paths. J-M32 (b)(b2)(b3), J-M52 and J-C39 pin it on arbitrateClaim. F12 maps {pending, refunds_disabled} to approvedNotSent. The toast no longer claims « Stripe a accepté le remboursement »: the old F12 sent every 'pending' to approvedPending, and triggerClaimRefund returns state 'pending' for refunds_disabled. E-10 states that the toast names no cause; the alert carries it.
- **R-B0-4** [P1] ACCOUNTED — rules: E-09 A-S31e-1 A-S31e-2 D7 D10 H06 H08 F11; tests: J-M36 J-M50 J-C27 J-C24 J-C18; E-09 registers the succeeded-row lost-event state as NOT fail-visible (founder acceptance), with R0c as an ungated read-only exit. D10/H08 re-read Stripe before a refunded notice, and a reversal → 409 with no send. F11 discloses the stale « Remboursée ».
- **R-B1-1** [P1] ACCOUNTED — rules: H05 D10 D11 C6 C7 D8 E-16 E-18 I-07 I-06 H06 H10 H16; tests: J-C23 J-C24 J-C30 J-M23 J-M38 J-M39 J-M53 J-C35; One eligibility record: the H05 EmailDispatch row (trigger 'claim_closure_record', dedupeKey claim:<id>). It is written only by recordClaimClosure after a closure CAS of this build, at seven named sites, including reconcileClaimForRefund (webhook and recovery) and the C7 re-read branch. AdminAuditLog is never eligibility: HEAD already writes claim.arbitrate, claim.resolve_stuck, claim.attribute_refund and claim.adopt_stripe_refund rows for legacy closures, and recordAdminAudit returns false when ADMIN_AUDIT_ENABLED is off. D10, D11, C6, C7 and D8 now use the record, and notice attempts no longer depend on the audit boolean. E-16 and E-18 say what is listed and what is counted (closure.missing, closure.terminalWithoutRecord), with write-time console.error signals. I-07 drops the false ADMIN_AUDIT line. The census is a non-blocking CENSUS channel, since A() would FAIL every precheck. No clock and no epoch (J-C23 bans them). EmailDispatch survives failed sends (transactional-emails.ts 181 deletes only the failed send's own trigger). No schema change. Staging and production each hold only their own build's records, so the epoch-per-environment problem disappears.
- **R-X0-1** [P0] ACCOUNTED — rules: G11 D12 D10 H06 H08 E-08 E-09 I-05; tests: J-M40 J-C43 J-C27 J-C24 J-M50; G11 returns {claimIds, written, failed}, and the webhook answers 503 when failed (the alert is sent first; sendOnce dedupe prevents a storm). A refunded notice needs stripe_read evidence from R0 in the same request. E-08 is a C6 breach bounded by redelivery; E-09 is not countable, for founder acceptance.
- **R-X0-2** [P1] ACCOUNTED — rules: A-S31d G1 G10 G11 D7 E-07 H06; tests: J-M36 J-M40 J-C24; A-S31d, G1(iii) pending and R0b with pending_row_stripe evidence (matching id or tag + PI anchor), marking the claim only. The unfinalized-list control carries the same verdict (D7). The old Track B entry 7 is folded into E-07. The H06 sender refuses without Stripe evidence.
- **R-X0-3** [P1] ACCOUNTED — rules: F02 F04 F01 A-S31-1 D11; tests: J-C01 J-C06 J-C07 J-M51 J-M41 J-M39; claimClosureKind maps settled_by_declaration and closed_by_declaration → closed_by_support. F01 has no settled_by_support key. A-S31-1 customer copy after a declaration = CBS. J-M41 and J-C06 fail if a settled_by_support key reappears.
- **R-X0-4** [P1] ACCOUNTED — rules: G11 F16 F14 G10 D7; tests: J-M40 J-M31 J-C14; G11's CUSTOMER sentence, the F14/G10 reverted_after_refund toasts and F16(3) all use « Quand les réclamations sont ouvertes, le client lit « vérification manuelle » ; sinon il ne voit aucune réclamation. » F16(1) forbids « Le client lit désormais », pinned by J-M40/J-C14.
- **R-X0-5** [P1] ACCOUNTED — rules: D13 E0 H10 E-13 E-07 G1; tests: J-M41 J-C30 J-M50 J-C45; apply-row-failure and its button are removed (D13, E0 REMOVED). H10's listRefundedClaimsWithUnprovenRow excludes failed rows with a Stripe id. E-13 and E-07 are disjoint, proven by a parity test. The failed-with-id exit is reconcile G1(iii)/R0a.
- **R-X0-6** [P1] ACCOUNTED — rules: E0 E-06 E-07 I-05 I-09; tests: J-M41 J-M50 J-C43; E-06 names the otherUnsettled row of « Vérification financière requise (n) » with bound_reverted and « Clôturer ce dossier… ». Alerts are I-05 refund:<re_id> with claimIds; writers are the webhook plus R0. E0 REMOVED bans the old section, dedupe key, pass 2 and list names (J-M41).
- **R-X0-7** [P1] ACCOUNTED — rules: E-10 D1 D2 E0; tests: J-M30 J-M28 J-C46; One registry (E0 merges REG and B). E-10 holds A-S01, A-S02, A-S08b, A-S30b-*, A-S30e-3 and approved_not_driven as gated or time-bound only. D1's test requires every empty or gated-only exit set to name an E id; J-M28(4) pins it.
- **V-A-1** [P1] ACCOUNTED — rules: C3 A-S30e-1 A-S30e-2 A-S30e-3 A-S30e-4 E-01 F05 F12; tests: J-M19 J-M20 J-M43 J-M47; T2 step (d) / 'awaiting_other_row' is deleted. T2(e') runs deriveNoRowOutcome for every pre-image and writes a locked/AWAITING proof (refundAttempted false, ALERT-B, reconcile + stuck_close, E-01) instead of reverting. J-M19's break/restore restores (d) → A-S30e-1 red.
- **N-M-1** [P1] ACCOUNTED — rules: F15 A-S01 E-10 G2 J-M31; tests: —; The strings are live at HEAD: lib/claim-action-rules.ts 176 « Rien à clôturer : approuvée et non payée, aucun remboursement n’a déplacé d’argent. », rendered by AdminFinancialVerification.tsx 490 and AdminClaimsArbitration.tsx 272, and AdminClaimsArbitration.tsx 186 « Absence de remboursement PROUVÉE (lignes + Stripe) ». - F15 now names the classification site: claims.ts ~1194 maps only 'no_refund_proven:v13:' to absence_proven_payable and a legacy proof to reconcile_required. It replaces both strings with texts that are true on HEAD_A and HEAD_B (« à la preuve, Stripe ne rapportait aucun remboursement non expliqué »). - A-S01 and E-10 cite those exact texts. - G2 deletes all four phrases and pins their absence in lib/, components/ and messages/. - J-M31 adds « n’a déplacé d’argent » and « Absence de remboursement PROUVÉE » to the forbidden list, pins GUIDANCE and MONEY_LABEL verbatim, and uses the HEAD line 176 and line 186 strings as negative controls.
- **N-C-1** [P1] ACCOUNTED — rules: H05 D10 D11 C6 C7 D8 E-16 E-18 I-07 J-C23 J-M38 J-M39 J-M23 J-M53 J-C35; tests: —; The spec now has one definition: the H05 EmailDispatch 'claim_closure_record', written only by this build at closure. D10, D11, C6, C7, D8, E-16, E-18 and I-07 agree on it, and J-C23, J-M38, J-M39, J-M23, J-M53 and J-C35 pin it. NOTE on the contradiction: the ARCHITECTURE DECISION's sentence « Closure-notice eligibility is the AdminAuditLog row that this build's closing route writes » is superseded. The CONVERGENCE block (binding over earlier resolutions) requires « closure e-mails tied to actual new-build closure events », and C4 requires « a record that only this build writes ». AdminAuditLog fails both against the code: arbitrate/route.ts 48-56 writes action 'claim.arbitrate' for every arbitration, and lib/claims.ts 1936/2217 write attribution and adoption audits, so legacy closures would become eligible (backlog). recordAdminAudit also returns false while ADMIN_AUDIT_ENABLED is off (lib/admin-audit.ts 52), and the webhook and recovery write no audit. The architecture's invariants still hold: no schema change (EmailDispatch has @@unique([trigger, dedupeKey])), no deploy epoch, and a record written at closure. I-07's false ADMIN_AUDIT line is removed.
- **N-C-2** [P1] ACCOUNTED — rules: I-01 D2 E-10 F12 J-M52 J-C39 J-M32 J-C15; tests: —; The alert moves to the real writer. arbitrateClaim does updateMany to 'approved' (casWhere, lib/claims.ts ~920), then `const refund = await triggerClaimRefund(claim.id)`, which returns { state: 'pending', reason: 'refunds_disabled' } at line 504. I-01 and D2 send cause 'refunds_disabled' from arbitrateClaim after that count-1 CAS; approveClaim keeps the same check for its flag-off auto paths. J-M52, J-C39 and J-M32 fixtures now drive arbitrateClaim, with count-0 and break/restore controls. F12 and J-C15 also fix the toast on that path. The RefundTriggerResult for refunds_disabled is state 'pending', and the old F12 mapped every 'pending' to approvedPending (« Stripe a accepté le remboursement… »), which would have been false. It now maps to approvedNotSent (success tone); approvedPending is reserved for reason 'stripe_pending'.
