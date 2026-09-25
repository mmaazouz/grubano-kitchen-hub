# LOYALTY-REFUND-CONTRACT — PHASE 1

> **Amendment D-15 (founder decision 2026-09-22, implemented in D′ lot L6 — see §24 and `CLAIMS-DPRIME-SPEC-v2.md`).** §9 is unchanged and remains the ONLY rounding rule (cumulative target, never per event). The §11 precondition and the E-P2d residual of §23 are superseded by §24: an order refunded BEFORE delivery is credited the prorata of the cash actually kept, by replaying the D1 clawback over the DB-known succeeded refunds right after the `earn` credit.

> The authoritative contract for how the loyalty programme behaves under refunds. Established from a read-only forensic pass (agents A/B/C + adversarial critic, `sufficient = PASS`) and implemented on branch `a1/loyalty-refund`. All money in **integer cents**, all points **whole**. Founder decisions of 2026-09-02 are LOCKED.

---

## 1 · Earning formula (actual)
`pointsEarned = floor(foodTotal)` where `foodTotal = max(0, round2(subtotal + effectiveDeliveryFee − welcomeReferralDiscount − promoDiscount))` — [app/api/orders/route.ts:463](app/api/orders/route.ts:463),[:467](app/api/orders/route.ts:467). Frozen on `Order.pointsEarned` at creation; **credited once at `delivered`** (one `earn` `LoyaltyTransaction`, `[orderId,'earn']` guard) — [status/route.ts:157](app/api/orders/[id]/status/route.ts:157). The base **includes the delivery fee** and **excludes** the small-order fee, tip and loyalty credit.

## 2 · Spending formula (actual)
`resolveLoyaltyCredit` — [lib/loyalty.ts:104](lib/loyalty.ts:104). `cap = min(pointsToCents(balance), subtotalCents, commissionFeeCents − committedClaims)`; `pointsSpent = floor(cap / centsPerPoint)`; `creditCents = pointsSpent × centsPerPoint`. Redemption is **exclusive with promos** and requires the customer's `usePoints` intention. Points are **debited at the confirmed payment** (webhook `charge.succeeded`), never on the browser return — [webhook:506](app/api/webhooks/stripe/route.ts:506).

## 3 · Points ↔ value conversion
`centsPerPoint() = env LOYALTY_CENTS_PER_POINT || 5` (100 pts = 5,00 €). `pointsToCents(p) = floor(p) × cpp`; `centsToPoints(c) = floor(c / cpp)` — [lib/loyalty.ts:13-27](lib/loyalty.ts:13). Whole points only; the double-floor is non-reversible (a credit lands on a point boundary ≤ cap, by design).

## 4 · Grubano funding rule
Loyalty (and the welcome/referral discount) is **GRUBANO-financed**, not the restaurant's. The credit reduces the **net application fee**, never the restaurant net nor the commission base: `baseFee = max(0, grossFee − loyaltyCreditCents) + smallFee + tip + courierWithheld` — [pay/route.ts:272](app/api/orders/[id]/pay/route.ts:272). (A *promo*, by contrast, is restaurant-financed and shrinks the commission base — [pay/route.ts:199-200](app/api/orders/[id]/pay/route.ts:199).)

## 5 · Cash funding rule
The customer's cash = `Order.total = round2(foodTotal + smallFee/100 + tip/100 − loyaltyCreditCents/100)` — [orders/route.ts:730](app/api/orders/[id]/route.ts). The **loyalty credit is subtracted from `total`**, so the loyalty-funded value is **never charged to the card**. The PaymentIntent amount = `eurosToCents(order.total)` — [pay/route.ts:120](app/api/orders/[id]/pay/route.ts:120).

## 6 · Cash refund cap — STRUCTURAL
`cash refundable ≤ cash captured`. Both refund libs derive the refundable **live from Stripe**: `refundable = charge.amount − charge.amount_refunded`, and `amount > refundable` is rejected (400) — [lib/refund.ts:450-455](lib/refund.ts:450), [lib/refunds.ts:52](lib/refunds.ts:52). `charge.amount = order.total` (the cash captured). Neither lib reads the gross (`subtotal/deliveryFee`). **No code path can refund the loyalty-funded value as cash** (it was never charged). ⇒ the founder's cash-cap invariant is satisfied by construction; Phase 1 moves **points only**.

## 7 · Mixed-funding allocator (points side)
The single unwind fraction is `f = charge.amount_refunded / charge.amount` (cumulative, cash-based — **never** the pre-credit `foodTotal`, which would desync points from the cash actually refunded). Both the earned reversal and the spent restoration prorate on this same `f`, so points and cash unwind by the identical fraction.

## 8 · Item-level allocator
`planLoyaltyRefund` treats each Stripe refund object as an eligible-value slice: its `amountCents` (a fraction of `charge.amount`) maps to that fraction of points. An item refund (Phase 3 "article manquant") is just a refund whose amount is the item's price → its points fall out of the same cumulative formula. Deterministic; the remainder rule is the cumulative-target rounding of §9 (no per-line residue to distribute at the points layer because points are derived from the cumulative refunded cents, not summed per line). `lib/loyalty-refund.ts`.

## 9 · Rounding algorithm — CUMULATIVE TARGET (drift-free)
`loyaltyPointsCumulative(base, charge, cum) = min(round(base × cum / charge), base)`, clamped `[0, base]` — the exact telescoping of `computeRefundSplit.feeCum`. Each refund event's delta = `cumulative(through this) − cumulative(through previous)` over refund prefix sums sorted by `(created, id)`. **Never round per event independently** — the target is rounded, the deltas telescope, so `partial A + B + C == one cumulative refund` and full refund lands exactly on the whole integer base. [lib/loyalty-refund.ts:33](lib/loyalty-refund.ts:33).

## 10 · Cumulative partial-refund algorithm
Sort succeeded refunds by `(createdUnix, id)`; prefix-sum their amounts; for each, `earnDelta = Δcumulative(pointsEarned)`, `spentDelta = Δcumulative(pointsRedeemed)`. Out-of-order webhook delivery is safe: refunds are immutable and a new one only appends in the sorted order, so already-applied deltas are unchanged; the unique key makes replays no-ops. [lib/loyalty-refund.ts:planLoyaltyRefund](lib/loyalty-refund.ts).

## 11 · Earned-point reversal (D1)
On refund, reverse `pointsEarned × f` (cumulative), keyed by the refund `re_…`. Full → 100 %; partial → the attributable part. **Precondition**: only if the `earn` row exists (delivered) — a refund before delivery reverses 0 (no phantom negative). Type `earn_reversal` (−points). [lib/loyalty-refund-apply.ts](lib/loyalty-refund-apply.ts).

## 12 · Spent-point restoration (D2)
On refund, restore `pointsRedeemed × f` (cumulative) — no longer 100 % on a partial. Type `refund` (+points), credited to the visible balance (does **not** repay the offset — only earnings do, §14). Keyed by `re_…`. This replaces the pre-Phase-1 full re-credit.

## 13 · Already-spent earned-point recovery (D3)
If a D1 clawback would push `pointsBalance` below 0 (the points were spent elsewhere), `applyReversalWithOffset` floors the visible balance at 0 and books the unrecovered remainder into `LoyaltyCustomer.recoveryOffsetPoints` (internal debt). Visible balance never goes negative. [lib/loyalty-refund.ts:applyReversalWithOffset](lib/loyalty-refund.ts).

## 14 · Future-earn offset mechanism (D3)
A future earning **repays the offset first**; only the remainder becomes spendable — `applyEarnWithOffsetRepay(earned, offset)`. Wired into the `delivered` earn credit ([status/route.ts:184](app/api/orders/[id]/status/route.ts:184)). The offset reaches 0 exactly once, never over-recovers.

## 15 · Goodwill waiver (D3)
`POST /api/admin/loyalty/waiver` — admin-only. Forgives `min(amountPoints, offset)`; reduces the debt, **does not** credit spendable balance. Audited in `AdminAuditLog` (`loyalty.waiver`: actor, reason, amount, timestamp) + a signed `offset_waiver` `LoyaltyTransaction` (`actorId`). Idempotent via a caller-supplied `idempotencyKey` (unique `(sourceEventId,'offset_waiver')`). [app/api/admin/loyalty/waiver/route.ts](app/api/admin/loyalty/waiver/route.ts).

## 16 · Idempotency source
**One loyalty effect per immutable refund source event = the Stripe Refund id `re_…`.** Stored as `LoyaltyTransaction.sourceEventId` with `@@unique([sourceEventId, type])`. Replay of a refund → P2002 → no-op; a distinct partial refund (distinct `re_…`) → applies once. `[orderId, type]` was **REJECTED** by the critic (partial refunds share it). Waivers use `waiver:<customerId>:<caller idempotencyKey>` as the `sourceEventId` (customer-scoped, so two customers cannot collide on a reused key — review F-P2). Mirrors the ledger's proven `@@unique([sourceEventId,type])` — [schema:1762](prisma/schema.prisma:1762).

## 17 · Webhook reconciliation semantics
`charge.refunded` is the **single reconciliation point** and is **NOT gated by `REFUNDS_ENABLED`** (deliberately — per founder: `REFUNDS_ENABLED` gates who may *initiate*; it must not suppress reconciling an *established* Stripe refund). A refund initiated by the admin rail OR externally on the Stripe Dashboard reconciles identically, keyed on `re_…`. `executeRefund` does **not** separately touch loyalty (it creates the Stripe refund; the resulting webhook reconciles) — one owner, no double effect.

## 18 · Schema decision — PURELY ADDITIVE
- `LoyaltyTransaction.sourceEventId String?` + `actorId String?` + `@@unique([sourceEventId, type])`.
- `LoyaltyCustomer.recoveryOffsetPoints Int @default(0)`.
- `type` is a free `String` → new types (`earn_reversal`, `offset_waiver`) need **no** migration.
**No dedup, no `--accept-data-loss`**: all existing rows get `sourceEventId = NULL`, and MySQL/InnoDB permits many NULLs in a UNIQUE index (precedent in-repo: `Payout.idempotencyKey String? @unique`, [schema:1800](prisma/schema.prisma:1800)). `prisma validate` = OK; client regenerated with the fields.

## 19 · Migration plan
The repo has **no `prisma/migrations`** (schema managed by `db push`; deploy scripts use `--accept-data-loss` — forbidden here). **Correction (rehearsal-proven):** `prisma db push` FLAGLESS **refuses** the unique-index step — it demands `--accept-data-loss` for ANY unique index (it cannot statically prove no duplicates), even though the actual `CREATE UNIQUE INDEX` on the all-NULL column loses nothing. That refusal is exactly why we ship the reviewable SQL artifact and apply IT first. The founder applies `phase1-loyalty-refund.sql` **before** the post-merge deploy; the deploy's own `db push --accept-data-loss` (in `deploy-staging.sh`) then finds the schema **already in sync** and does nothing (flag is a no-op with no pending change). So `--accept-data-loss` never actually acts on this migration. Sequence (founder-executed, §20–21): fresh backup → baseline → `db push` → integrity check → merge → deploy → healthcheck → post-deploy loyalty check → only then consider lifting the freeze. **Local disposable rehearsal proves the push is additive before staging** (§21 evidence).

## 20 · Backup procedure (founder-executed, no secrets shared)
Before any staging schema change, in cPanel Terminal (see `docs/ops/PHASE1-STAGING-PROCEDURE.md` for the exact copy-paste):
1. `mysqldump` the staging DB to a timestamped `.sql.gz` — **keep** the 30/08 pre-rehearsal backup, do not overwrite.
2. Verify: file non-empty, `gzip -t` PASS, row-count sanity (Orders / LoyaltyTransaction / LoyaltyCustomer).
3. Record location + restore command.
Both backups (pre-rehearsal + pre-migration current) must exist before the push.

## 21 · Test evidence
- **Pure math** (`tests/loyalty-refund.test.ts`) — 25 tests: matrix A–J + cumulative/rounding + ordering.
- **Apply layer** (`tests/loyalty-refund-apply.test.ts`) — 7 tests: full/partial/multi-partial cumulative, idempotent replay, D3 offset spillover, guards.
- **Waiver route** (`tests/loyalty-waiver-route.test.ts`) — 5 tests: security 401/403, waive/clamp (O), replay idempotent (P).
- **Local migration rehearsal** — see §21 of the closeout / `PHASE1-STAGING-PROCEDURE.md` (db push additive, multi-NULL, 2 NULL + 2 distinct `re_` coexist).
- **Full suite + cold build** — recorded in the closeout at merge time.

## 22 · Negative controls (the harness proves it can fail)
- Naive per-event round **drifts** (470×3 → 5+5+5 = 15 ≠ 14) — the cumulative model removes it.
- Old 100 %-restore-on-10 %-partial is wrong (8 vs the correct 1).
- A reversal without the offset would push the balance to −8 — the floor keeps it at 0.
- Waiver replay would double-forgive (20−8−8) — the key forgives exactly once (12).

## 23 · Hardening from adversarial review + known residuals
- **Concurrency (E-P1b / E-P2c):** the clawback and the earn-repay both `SELECT … FOR UPDATE` the customer row and apply RELATIVE deltas → no negative balance, no lost offset under concurrent distinct-event webhooks.
- **Legacy grandfather (E-P1a / F-P1):** an order carrying a pre-Phase-1 `(NULL,'refund')` loyalty row is left untouched (`grandfathered`) — never double-restored, never retro-clawed. New orders reconcile normally.
- **Earn on a refunded order (E-P2d) — SUPERSEDED by §24 (D-15):** until L6 ships, the `delivered` earn skips crediting when a `refund`/`earn_reversal` row already exists for the order (credits 0 on a PARTIAL pre-delivery refund with points spent, and the FULL earn when no marker exists because no points were spent). After L6: skip only when an `earn` row exists or the legacy `(NULL,'refund')` marker exists; otherwise credit, then replay.
- **Residual (SUPERSEDED by §24, D-15):** the former note « never an over-credit » was wrong for a TOTAL refund before delivery with no points spent: no marker exists, the full earn is credited at `delivered` and no later refund event can reverse it (verified 2026-09-22 against `dab754d`, audit V-01). §24 closes it.
- **Bound (NIT):** the telescoping needs the full refund prefix; if a charge ever has > 100 refunds AND the Stripe list refetch fails, an early frozen delta could be wrong. Test/beta volumes never approach this; the webhook already refetches on `has_more`.
- **DDL:** the SQL artifact uses `ADD COLUMN IF NOT EXISTS` (MariaDB — o2switch is MariaDB 12.3, confirmed). A true MySQL 8 target would need the guarded form.

---

### Financial vector (never one number) — Phase 1 owns C/D/E
| | Component | Owner |
|---|---|---|
| A | order value refunded | (derived) |
| B | customer cash refunded | Stripe (`charge.amount` capped) |
| **C** | **loyalty value restored to customer** | **Phase 1** (D2, points) |
| **D** | **points earned reversed** | **Phase 1** (D1) |
| **E** | **Grubano-funded discount reconciled** | **Phase 1** (structural: never charged ⇒ never refunded as cash) |
| F | restaurant share reversed | Phase 2 (`reverse_transfer`) |
| G | application fee reversed | Phase 2 (`refund_application_fee`) |
| H | royalty reversed | Phase 2 (royalty-aware engine; **fix the `orders/[id]/refund` double-return**) |

**Open Phase 2 blocker (recorded, not touched here):** `orders/[id]/refund` (rail A) is not royalty-aware → franchise double-return once refunds activate. `REFUNDS_ENABLED` stays OFF until Phase 2 closes it.

## 24 · Earn at `delivered` after a pre-delivery refund (D-15, D′ lot L6)
Rule: at the `delivered` transition, (1) the `earn` credit is skipped only if an `earn` row exists for the order OR the legacy `(NULL,'refund')` marker exists (grandfathered, §23); a `refund`/`earn_reversal` row carrying a `re_` no longer blocks the earn. (2) Otherwise the existing earn transaction runs unchanged (full `pointsEarned`, offset repay, `FOR UPDATE`) and COMMITS. (3) ALWAYS afterwards, on the ROOT client (never nested — the tx client has no `$transaction`), `reconcileLoyaltyOnRefund(prisma, { orderId, chargeAmountCents, refunds })` replays the D1/D2 plan over the DB-known set: the union, deduplicated by `re_`, of `Refund { orderId, status:'succeeded', stripeRefundId ~ re_ }` and `LedgerEntry { type:'refund', stripePaymentIntentId = order PI, sourceEventId ~ re_ }` (amount = −grossAmount); never a pending/failed row, never `charge.amount_refunded`; `createdUnix` = ledger `createdAt` else `settledAt ?? createdAt`; `chargeAmountCents` = the ledger `payment` line `grossAmount` for the PI, else `round(order.total × 100)`. No Stripe call from the status route. (4) Net credited points = `E − min(round(E × ΣR / T), E)` — the §9 cumulative telescoping; pinned: T=1410, E=14, refunds 470×3 ⇒ `earn_reversal` −5/−4/−5, net 0; 705 ⇒ −7; a later NEW refund reverses only its cumulative delta; a webhook replay with the same set writes nothing (unique `(re_, type)`). (5) Failure after the earn committed: one immediate retry, then `[LOYALTY MISS] earn_prorata_incomplete` + admin alert `loyalty_prorata_incomplete` (dedupe `loyalty:<orderId>:prorata`); repair path = `POST /api/admin/loyalty/reconcile { orderId }` (admin session, DB only, no Stripe, not gated by any claims flag) which replays (3). (6) Tests (L6): no refund; partial before delivered; total before delivered; points spent (existing `refund` rows ⇒ P2002 skipped, balance consistent); 470×3; idempotence (webhook replay + second DB replay ⇒ 0 writes; the `[orderId,'earn']` guard is check-then-act, single-flight assumption documented); earn OK + replay throws ⇒ alert then repair ⇒ same end state as the total-refund case; legacy marker ⇒ 0 rows, `grandfathered`.

**(7) OPEN RESIDUAL — the prefix-completeness precondition of §9 (named by the L6 adversarial review, NO RULE ABOVE IS CHANGED; closing it is a founder decision).** §9's telescoping is drift-free for a writer holding the WHOLE refund set in one pass — which is why the refund webhook re-reads Stripe's list and answers 503 rather than proceed on a partial one. The set of (3) is « what the database proves », strictly weaker, and every written `(re_, type)` row FREEZES the delta it computed (nothing recomputes a keyed row, by §16). So a set that becomes visible in the WRONG ORDER can settle one point away from the §9 target, permanently, in either direction. Measured by the product, not asserted: T=1410, E=14, two refunds of 470; the LATER one visible alone first ⇒ its delta is priced from a cumulative of zero (−5); the EARLIER one lands afterwards and, being first in the sorted prefix, also books −5 ⇒ **booked 10 where §9 wants 9**. Cause: a Dashboard refund whose webhook has not landed beside a rail refund whose row is written. Closing it requires a change to §9 (a top-up-to-target effect) or to §16 (an explicit prefix precondition, e.g. refuse to replay an incomplete set) — **out of L6's scope**. What L6 DOES: after every replay, the booked `earn_reversal` total is compared with the §9 target for the set now known; any gap emits `[LOYALTY MISS] earn_prorata_drift`, a distinct admin alert (`loyalty_prorata_incomplete`, dedupe `loyalty:<orderId>:drift` — NOT the failure key) and a `drift` field on the repair route's response and audit. Nothing is rewritten: rewriting a keyed row would break the one-effect-per-refund model the idempotence rests on. Grandfathered orders are exempt (§23 leaves them exactly as the pre-Phase-1 code wrote them). Pinned by 6 tests including TWO negative controls (three refunds seen in order, and a later refund arriving after a replay, both raise no drift and no alert).

**(8) OPEN QUESTION — composition of D3 with D-15 (reported by the same review, unchanged).** When the earned points were already spent elsewhere, §9 bounds the clawback to the visible balance and books the remainder in `recoveryOffsetPoints` (a debt repaid only by FUTURE earnings, never by the balance). In the D-15 case the earning is credited and clawed back within the same second, so the clawback settles against the balance the customer has just received rather than against a carried debt. That follows §9 as written and is what the L6 tests pin — but whether an ANNULLED earning should be allowed to extinguish a pre-existing offset debt is not decided by this contract. Reported, not changed.
