# PHASE-2-HANDOFF — Refund financial rail / royalty (fresh session)

> **Self-contained** handoff for a new Claude Code session. Phase 1 is **COMPLETE** on staging (migrated DB, merged code, **regenerated server Prisma client**, runtime proven, 2026-09-03); Phase 2 opens with a known **financial P0 blocker** that must be closed before `REFUNDS_ENABLED` can ever be TRUE. Read this whole file, then `BETA-PRODUCT-FINAL-CLOSEOUT.md`, then `LOYALTY-REFUND-CONTRACT.md`, then `BETA-CLAIMS-REFUND-FACTUAL-INVENTORY.md`. Use `scripts/notion-sync.js read` at start (CLAUDE.md sync protocol).

---

## 0 · State you inherit (facts, 2026-09-03)

> **AMENDMENT 2026-09-04 (Phase 2 final hardening — read first).** (1) **Evidence rule:** every runtime/config/financial fact in a verdict is tagged `SOURCE / OBSERVED / REQUIRED / STATUS`; a code default is never a staging fact until read on the server (`NOT MEASURED` otherwise). **Incident:** earlier verdicts wrote `REFUNDS_ENABLED = FALSE` without measuring it; the measured staging value was **`true`** (historical constant since ≤ 2026-08-29); no refund occurred (Stripe TEST: only the Z1 refund of 2026-08-29). The **technical** freeze is restored by the one-command operator v2 (`scripts/server/phase2-preflight.js`: writes `REFUNDS_ENABLED=false`, `ALERT_EMAIL=admin-qa@grubano.com`, `LOGISTICS_SIGNUP_ENABLED=false`, preserves everything else, re-reads, test alert, DB facts, ledger check, restart) — `docs/ops/PHASE2-PREFLIGHT-ONE-COMMAND.md`. (2) **F2 and F8 are CLOSED** (contract §19): the ledger books only Stripe's ACTUAL fee refunds and transfer reversals; a resume never creates a second Stripe refund after the idempotency window. (3) **Refund funding / payout policy** is a founder decision: `docs/ops/REFUND-FUNDING-PRE-LIVE-DECISION.md` (Stripe reverses transfers only against the connected account's AVAILABLE balance; the rehearsal restaurant's TEST payout schedule is `manual`; read the actual available balance at execution time — expected 13,34 € on 2026-09-08). (4) The refund rehearsal is **not executed** without the founder's explicit sentence « I AUTHORIZE THE STAGING REFUND REHEARSAL »; Phase 3 stays blocked (Claims Phase 0 read-only inventory allowed in an isolated session).

> **AMENDMENT 2026-09-04 (Phase 2 preflight — CORRECTIVE PASS v3, overrides (1) above where it conflicts).** The v2 operator run (founder) measured `REFUNDS_ENABLED=false` in the FILE but failed at step 9 (ledger check 401) BEFORE the restart, so the PROCESS still runs `REFUNDS_ENABLED=true` (measured 2026-09-04 from outside: `POST /api/admin/refunds/run` without credentials → 401, whereas 403 `{gated:true}` would mean false — the kill-switch is evaluated before auth). v2 also wrote `LOGISTICS_SIGNUP_ENABLED=false` by MISTAKE — **the courier WAITLIST is IN the closed beta** (`LOGISTICS_SIGNUP_ENABLED=true` required); only operational delivery is out (`LOGISTICS_COURIER_ACTIVATION_ENABLED` absent → false, never enabled) — and replaced `ALERT_EMAIL=m.maazouz@grubano.com` (the founder's monitored mailbox, measured BEFORE value) by the QA address. **v3** (`scripts/server/phase2-preflight.js`, same command) restores `LOGISTICS_SIGNUP_ENABLED=true` and `ALERT_EMAIL=m.maazouz@grubano.com`, keeps `REFUNDS_ENABLED=false`, sets `TIPS_ENABLED=false` only if the runtime would load it true without `LOGISTICS_PAYOUT_ENABLED` (courier tip, pickup-reachable, beta runbook OFF), parses the env with BOTH the strict runtime semantics (`server.js`: first occurrence, canonical lines only) and the lenient v2 semantics to explain divergences (TIPS "true" for v2 vs `tipsEnabled:false` live; ledger 401 = the process compares another token value), writes canonical lines, **restarts BEFORE any read-only check and proves the reload by live probes**, then runs the DB facts and the ledger check with the token exactly as the runtime loads it (route auth unchanged). The v3 commit is pushed with `[no-restart]` (new additive guard in `deploy-staging.yml`) so the CI cannot restart Passenger while the server file still says `LOGISTICS_SIGNUP_ENABLED=false`. `/version.json` proves file delivery only, never a process reload. See `docs/ops/PHASE2-PREFLIGHT-ONE-COMMAND.md` and the closeout section « PRÉFLIGHT CORRECTIF (v3) ».

- **Staging** (`app.grubano.com` + `business.grubano.com`) serves develop with **Phase 1 merged** (`e244275` + docs) on a **migrated DB** (additive: `LoyaltyTransaction.sourceEventId?`, `actorId?`, `@@unique([sourceEventId,type])`, `LoyaltyCustomer.recoveryOffsetPoints Int @default(0)`). Backup `staging-pre-phase1-2026-09-03-13-21-22.sql.gz` (63.2 KB, 44 INSERTs) in `~/grubano-backups/`; 30/08 backup preserved.
- **Server Prisma client = REGENERATED** (2026-09-03, founder-run `scripts/server/phase1-regen-client.js` → PASS: `recoveryOffsetPoints`, `sourceEventId`, `actorId` proven in `node_modules/.prisma/client/index.d.ts`; Passenger restarted; runtime verified). **Trap (3/3 deploys):** the FTP deploy never delivers/regenerates `.prisma/client` (`node_modules/**` excluded, nodevenv symlink) and the SSH post-deploy `prisma generate` step is `continue-on-error` and timed out on `49cea68`, `6545489`, `90472db` → **after ANY deploy that changes `prisma/schema.prisma`, read the raw SSH step log; if `Generated Prisma Client` is absent, ship/run a regen operator (pattern `phase1-regen-client.js`, `PHASE1_VERIFY_FIELDS=<new fields>`) before declaring the deploy PASS.** The regenerated client persists across deploys (FTP never touches `node_modules`). Pre-production infra blockers recorded in the closeout: deterministic Prisma client delivery, SIGTERM handling, Tiger Protect compatibility.
- **Final Phase 1 deployed SHA** = the closeout docs commit at the head of develop (verify `/version.json` on BOTH domains at session start; Phase 1 code `e244275`, regen operator `90472db`; exact final SHA banked in the Notion closeout report).
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
Staging = develop (Phase 1 merged, DB migrated, server Prisma client REGENERATED — a
deploy does NOT regenerate it: see handoff §0 trap). main/production/Stripe LIVE: NEVER.

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
If a merge changes prisma/schema.prisma: additive SQL operator first, then after the
deploy read the RAW SSH step log; no `Generated Prisma Client` there → regen operator
(pattern phase1-regen-client.js) before declaring the deploy PASS.
Never ask the founder for secrets or multi-step DB work. Do not invent access.

ONLY after all financial P0 tests PASS: report REFUNDS_ENABLED readiness for founder
decision. Do NOT flip it yourself. Do NOT start Phase 3. Founder human refund
rehearsal follows on the disposable rehearsal order.

Update BETA-PRODUCT-FINAL-CLOSEOUT.md; Notion inbox report; exact verdict block;
CAPACITY SAFE TO CONTINUE; STOP at the phase gate.
```
