# PHASE-2-HANDOFF — Refund financial rail / royalty (fresh session)

> **Self-contained** handoff for a new Claude Code session. Phase 1 is OPERATIONALLY COMPLETE on staging; Phase 2 opens with a known **financial P0 blocker** that must be closed before `REFUNDS_ENABLED` can ever be TRUE. Read this whole file, then `BETA-PRODUCT-FINAL-CLOSEOUT.md`, then `LOYALTY-REFUND-CONTRACT.md`, then `BETA-CLAIMS-REFUND-FACTUAL-INVENTORY.md`. Use `scripts/notion-sync.js read` at start (CLAUDE.md sync protocol).

---

## 0 · State you inherit (facts, 2026-09-03)

- **Staging** (`app.grubano.com` + `business.grubano.com`) serves develop with **Phase 1 merged** (`e244275` + docs) on a **migrated DB** (additive: `LoyaltyTransaction.sourceEventId?`, `actorId?`, `@@unique([sourceEventId,type])`, `LoyaltyCustomer.recoveryOffsetPoints Int @default(0)`). Backup `staging-pre-phase1-2026-09-03-13-21-22.sql.gz` (63.2 KB, 44 INSERTs) in `~/grubano-backups/`; 30/08 backup preserved.
- **`main` / production / Stripe LIVE: never touched.** Stripe TEST only.
- **`REFUNDS_ENABLED = FALSE`. `CLAIMS_ENABLED = FALSE`. REFUND INITIATION FREEZE = ACTIVE.** Forbidden until Phase 2 PASS: Stripe Dashboard refund, Grubano admin refund UI, `POST /api/admin/refunds/run`, manual `executeRefund`, raw Stripe refund API, any staging op initiating a refund.
- Rehearsal order `cmtj52ewh000320fboagbze1x` (PI `pi_***xQDiB9` succeeded 14,50 €, `application_fee` 116, destination `acct_***byyYMY`, **0 refunds**) remains the disposable candidate for the eventual human refund rehearsal (AFTER Phase 2 PASS).
- Access truth (do NOT re-investigate): deployment transport = **FTPS** via GitHub Actions; `scripts/server/*.js` ships automatically (`.sh` and `prisma/manual-migrations/*.sql` do NOT); **no remote shell** from the Claude environment (SSH :22 filtered; GHA SSH intermittent). Server DB ops = a **fail-closed `.js` operator** the founder runs in ONE cPanel command (pattern: `scripts/server/phase1-staging-migrate.js`).

## 1 · THE BLOCKER Phase 2 opens with (P0)

`POST /api/orders/[id]/refund` → `lib/refunds.ts refundPayment` (rail A) is **not royalty-aware**: it never updates `FranchiseRoyalty.refundedCents`. On a **franchised** order, Stripe returns the commission (royalty slice included) to the customer via `refund_application_fee`, and the settlement then pays `royaltyCents` in full → **royalty returned twice**. Only `lib/refund.ts executeRefund` (rail B, `POST /api/admin/refunds/run`) is royalty-aware (`recomputeRoyaltyRefundedCents`, clawback). Both routes are gated by the SAME `REFUNDS_ENABLED` flag → the moment it flips TRUE, choosing rail A on a franchised order is a double-payment. Anchors: `app/api/orders/[id]/refund/route.ts:72`, `lib/refunds.ts` (0 royalty), `lib/refund.ts:359`.

Also open (Phase 0 inventory §1.g / §4.g): no tripartite conservation test (customer+restaurant+Grubano = post-refund state); Stripe processing fee not modelled on partial refunds; partial refund reverses a fraction of a fee that includes the courier tip while tip clawback fires only on FULL refund; `lib/refunds.ts`/`lib/refund.ts` headers still say "UNGATED, LIVE today" (stale — all routes gate on `REFUNDS_ENABLED`).

## 2 · Phase 1 invariants you MUST preserve (they are deployed)

- **Points-only.** Loyalty reconciliation moves points, never cash. Cash refundable ≤ cash captured is **structural** (`order.total` = `charge.amount`; `loyaltyCreditCents` was never charged; both refund libs derive refundable live from Stripe).
- **Prorate on `charge.amount`** (cumulative `f = amount_refunded / amount`), never pre-credit `foodTotal`.
- **Cumulative-target model** (`lib/loyalty-refund.ts`): deltas telescope like `computeRefundSplit`; N partials == one cumulative; no per-event rounding.
- **Idempotency = Stripe refund `re_…`** as `LoyaltyTransaction.sourceEventId` + `@@unique([sourceEventId,type])`. `@@unique([orderId,type])` is REJECTED (partials share it). Waiver key = `waiver:<customerId>:<key>`.
- **`charge.refunded` webhook is the SINGLE loyalty reconciliation point and is NOT gated by `REFUNDS_ENABLED`** (founder rule: the flag gates who may *initiate*, never reconciliation of an established Stripe refund). `executeRefund` must NOT touch loyalty (one owner).
- **Concurrency:** clawback and earn-repay `SELECT … FOR UPDATE` the customer row and apply RELATIVE deltas. **Grandfather:** an order with a legacy `(NULL,'refund')` row is left untouched. **Earn guard:** no earn credit on an order with a `refund`/`earn_reversal` row.
- D3 offset: visible balance floors at 0; `recoveryOffsetPoints` is repaid by future earnings first; admin waiver audited (`AdminAuditLog` + `offset_waiver` row), idempotent.

## 3 · Phase 2 required scope (founder-mandated)

Prove, Stripe TEST only, on **standard AND franchise** restaurants, for **full / partial / multiple partial** refunds:
1. cash refund ≤ actual captured cash;
2. Grubano-funded loyalty never cashed out;
3. spent-loyalty restoration + earned-loyalty reversal (Phase 1, must keep passing);
4. application-fee reversal per retained-GMV policy (full → 100 %, partial → proportional);
5. `reverse_transfer` semantics correct (destination charge);
6. royalty reversal correct and **never double** (close rail A: route order refunds ONLY through the royalty-aware engine, or make rail A royalty-aware, or remove rail A from the order path — decide with evidence, one engine);
7. ledger exactness (`gross = fee + net` with negatives; add the **tripartite conservation** test; model/decide the Stripe processing fee on partials; align tip clawback with partial refunds);
8. webhook idempotency + admin retry idempotency + **external Stripe refund reconciliation** (Dashboard-initiated refund → webhook → ledger + loyalty coherent, no duplicate);
9. failed/pending refund state truthfulness (no "remboursé" before Stripe success).
**No `REFUNDS_ENABLED=true` until every financial P0 test PASSes.** Then a founder human rehearsal (pickup order → claim later → partial refund → Stripe/fee/transfer/ledger/loyalty/email) before Clean Room.

## 4 · Execution model (unchanged)

Hard phase gates; multi-agent with isolated worktrees (`git worktree add … -b a1/<name> develop` + `cmd /c mklink /J node_modules`); ONE implementation owner for financial code; independent adversarial reviewers (financial + security) that must PASS; negative controls that prove the harness can fail; fresh gates on the merged tree (targeted → full vitest → cold build exit → tsc classification; baseline = 37 test-file errors, 0 product); one merge at a time, CI green, `/version.json` == exact SHA on BOTH domains; Notion inbox report + agent page (`scripts/notion-sync.js write-inbox-file`). Capacity policy: finish subtask → commit → tests → bank report → STOP.

## 5 · Long-range roadmap (authoritative, preserve)

Phase 2 refund rail/royalty → Phase 3 Claims domain/security/admin → Phase 4 Claims consumer UX (+ Claude Design gate) → Phase 5 product cleanup (pickup terminal state, canonical `GR-XXXXXX`, mobile duplicate CTA, formal French, bounded truthfulness) → Phase 6 legal-tech hooks (checkout contract facts, terms-acceptance evidence, cookie audit — no legal text invention) → FINAL STAGING HUMAN REHEARSAL → CLEAN ROOM → **EMAIL FACTUAL INVENTORY + EMAIL DESIGN TRAIN** → LEGAL FOUNDATION → GRUBANO LEGAL OPERATOR → Stripe platform/Connect/webhook LIVE → LIVE SMOKE → PRODUCTION.

### 🔴 Email chantier — must not be forgotten (do NOT start before Claims/Refunds are stable)
Claude Design STOPPED the email redesign for lack of facts and requested a factual pack. When beta notification behaviour is stable, Claude Code (never the founder) produces `EMAIL-FACTUAL-PACK/`: `EMAIL-MANIFEST.md`, `EMAIL-TRIGGER-MAP.md`, `EMAIL-COPY-VERBATIM.md`, `EMAIL-DATA-CONTRACTS.md`, `EMAIL-INFRASTRUCTURE.md`, `EMAIL-AUTH-FACTS.md`, `EMAIL-CLAIMS-REFUNDS-FACTS.md`, `EMAIL-CURRENT-VISUALS.md`, `CLAUDE-DESIGN-EMAIL-HANDOFF.md`. Every candidate classified A LIVE_CODE_CONFIRMED_SEND / B CODE_EXISTS_NOT_SEND_PROVEN / C CURRENT_BETA_TRAIN_CONFIRMED / D DEAD_OR_ORPHANED / E NOT_CONFIRMED — a template is not "real" because a file exists; the reachable send path must be proven. Families: AUTH/ACCOUNT, CONSUMER ORDER, PARTNER, CLAIMS/SAV, REFUNDS, SAFETY/ALLERGEN, ADMIN. Transactional only. Then Claude Design builds the Grubano email design system (email-safe, 600–640 px, table-safe, inline CSS, images-off, ZEST/INK/BASIL, status language never colour-alone, `GR-XXXXXX`, Claim ≠ Refund, never "remboursement effectué" before Stripe success) → founder visual gate on `email-gallery.html` → only then implementation.

---

## 6 · COPY-PASTE PROMPT — fresh Phase 2 session

```
MASTER — PHASE 2 REFUND FINANCIAL RAIL / ROYALTY
GRUBANO CLOSED BETA FINAL PRODUCT CLOSEOUT — fresh session.

START: run `node scripts/notion-sync.js read` (CLAUDE.md sync protocol), then read in order:
docs/ops/PHASE-2-HANDOFF.md → docs/ops/BETA-PRODUCT-FINAL-CLOSEOUT.md →
docs/ops/LOYALTY-REFUND-CONTRACT.md → docs/ops/BETA-CLAIMS-REFUND-FACTUAL-INVENTORY.md.
Staging = develop (Phase 1 merged, DB migrated). main/production/Stripe LIVE: NEVER.

FROZEN STATE (do not change): REFUNDS_ENABLED=FALSE, CLAIMS_ENABLED=FALSE, refund
initiation freeze ACTIVE (no Dashboard/admin/API/manual refund on staging until this
phase PASSes). Phase 1 loyalty invariants are deployed and must keep passing
(points-only, prorate on charge.amount, cumulative-target, re_… idempotency,
ungated charge.refunded reconciliation, FOR UPDATE + relative deltas, grandfather).

OPEN WITH THE P0 BLOCKER: app/api/orders/[id]/refund (lib/refunds.ts, rail A) is not
royalty-aware → on a FRANCHISED order the royalty slice is returned twice once refunds
are enabled (rail B lib/refund.ts executeRefund is royalty-aware). Establish with
evidence, then close it with ONE refund engine on the order path.

PHASE 0 (read-only, multi-agent forensics + adversarial critic): exact refund rails,
computeRefundSplit, reverse_transfer/refund_application_fee construction, royalty
clawback/settlement, ledger writers, webhook charge.refunded, tip clawback, Stripe fee
on partials, admin retry/idempotency, external Stripe refund reconciliation. Deliver
REFUND-FINANCIAL-CONTRACT.md draft facts. PASS/INCOMPLETE gate.

PHASE 2 implementation (one financial owner, isolated worktree a1/refund-rail off
develop): close the franchise double-return; tripartite conservation test
(CUSTOMER + RESTAURANT + GRUBANO reconcile exactly, cent rounding); decide/model the
Stripe processing fee on partial refunds; align courier-tip clawback with partials;
fix stale "UNGATED" headers; failed/pending refund truthfulness; external-refund
reconciliation test (webhook-only path, no duplicate ledger/loyalty). Matrix on
STANDARD and FRANCHISE restaurants × full / partial / multiple partial, Stripe TEST
only, negative controls that prove the harness can fail. Independent financial +
security adversarial reviewers must PASS.

GATES before any merge: targeted → full vitest → cold build exit 0 → tsc (baseline
37 test-file errors, 0 product) → merge-tree clean → one merge → CI green →
/version.json == exact SHA on app.grubano.com AND business.grubano.com → healthchecks.
If a staging DB step is ever needed: fail-closed .js operator in scripts/server/
(pattern phase1-staging-migrate.js), founder runs ONE command, script decides PASS/FAIL.
Never ask the founder for secrets or multi-step DB work. Do not invent access.

ONLY after all financial P0 tests PASS: report REFUNDS_ENABLED readiness for founder
decision. Do NOT flip it yourself. Do NOT start Phase 3. Founder human refund
rehearsal follows on the disposable rehearsal order.

Update BETA-PRODUCT-FINAL-CLOSEOUT.md; Notion inbox report; exact verdict block;
CAPACITY SAFE TO CONTINUE; STOP at the phase gate.
```
