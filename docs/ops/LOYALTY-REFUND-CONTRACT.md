# LOYALTY-REFUND-CONTRACT — PHASE 1

> **Amendment D-15 (founder decision 2026-09-22, implemented in D′ lot L6 — see §24 and `CLAIMS-DPRIME-SPEC-v2.md`).** §9 is unchanged and remains the ONLY rounding rule (cumulative target, never per event). The §11 precondition and the E-P2d residual of §23 are superseded by §24: an order refunded BEFORE delivery is credited the prorata of the cash actually kept, by reconciling the D1 clawback over the DB-known succeeded refunds right after the `earn` credit.

> **Amendment L6.1 (founder decision 2026-09-25, option (a), implemented in D′ lot L6.1).** The §9 ROUNDING RULE is still unchanged. What changed is how the effect is PERSISTED: the reconciliation no longer sums per-event deltas keyed by the Stripe `re_`, it **converges to the cumulative target** — target for the proven set, minus the effect really applied, written as one new append-only row when the difference is non-zero. This closes the §24 (7) residual (an EARLIER refund becoming provable after a later one settled one point off the target, permanently). Amended sections: **§9, §10, §11, §12, §13, §16, §17, §24 (3)(4)(7)(8)**. The composition of D-15 with the `recoveryOffsetPoints` debt (§24 (8)) is **DEFERRED TO T-44 PRE-LIVE**: detected and alerted, never claimed certified.

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
`loyaltyPointsCumulative(base, charge, cum) = min(round(base × cum / charge), base)`, clamped `[0, base]` — the exact telescoping of `computeRefundSplit.feeCum`. **Never round per event independently** — the TARGET is what is rounded, so `partial A + B + C == one cumulative refund` and a full refund lands exactly on the whole integer base. [lib/loyalty-refund.ts](lib/loyalty-refund.ts).

> **AMENDMENT L6.1 (founder decision 2026-09-25, option (a)) — the rounding rule above is UNCHANGED; how it is PERSISTED is.** Until L6.1 each refund event was persisted as its own delta, `cumulative(through this) − cumulative(through previous)` over prefix sums sorted by `(created, id)`. That is exact only for a writer that sees the WHOLE set in one pass, and this one does not: an EARLIER refund can become provable AFTER a later one (a Dashboard refund whose webhook has not landed, beside a rail refund whose row is written), and nothing ever recomputes a keyed row. Measured: T=1410, E=14, two refunds of 470 ⇒ **10 booked where the target is 9**.
>
> The persistence model is therefore **CONVERGENCE TO THE TARGET**, not a sum of per-event deltas. Every reconciliation pass:
> 1. reduces the proven set to ONE number — Σ of the refunded cents, **deduplicated by `re_`** (`cumulativeRefundedCents`), so the same refund proven by two sources counts once and no arrival order can change it ;
> 2. computes `target = loyaltyPointsCumulative(base, T, cum)` with the rule above, untouched ;
> 3. **reads the effect REALLY APPLIED** from the ledger (Σ of the rows on that side for that order) — never assumes it from the events ;
> 4. writes **only `target − applied`**, as ONE new row, when that difference is non-zero.
>
> Properties, each pinned by a test: **order-independent** (the target depends on the sum) · **idempotent** (at the target the difference is 0 and NOTHING is written — that, not a key, is what makes a replay free) · **convergent** (any arrival order lands on the same state) · **exact** to the cumulative target · **safe when an older refund arrives late** · **append-only** (past rows are never rewritten; a correction is a new compensating movement). Signed: a difference can be NEGATIVE, and then the exact arithmetic inverse is applied (§13 amendment).

## 10 · Cumulative partial-refund algorithm
**AMENDED BY L6.1.** Σ the succeeded refunds' amounts, deduplicated by `re_`; `earnTarget = cumulative(pointsEarned, Σ)`, `spentTarget = cumulative(pointsRedeemed, Σ)`; write the difference between each target and what the ledger already holds. No sort, no prefix sums, no per-event delta. [lib/loyalty-refund.ts](lib/loyalty-refund.ts) — `cumulativeRefundedCents` + `loyaltyConvergenceDelta`.

> **The claim this section used to make was FALSE and is retracted.** It said: « Out-of-order webhook delivery is safe: refunds are immutable and a new one only appends in the sorted order, so already-applied deltas are unchanged. » A new refund does NOT only append: Stripe's `refund.created` is the refund's own instant, so a refund created EARLIER can become provable LATER and then sorts BEFORE rows that are already written and frozen. That is the defect L6 measured and L6.1 closes. `planLoyaltyRefund` and `loyaltyPointsDelta` are KEPT as the pure statement of the per-event model (Σ deltas == the target for an in-order prefix, which is what the refund-gate operator's expected vector mirrors), but they no longer persist anything.

## 11 · Earned-point reversal (D1)
On refund, the total reversed converges to `pointsEarned × f` (cumulative). Full → 100 %; partial → the attributable part. **Precondition**: only if the `earn` row exists (delivered) — a refund before delivery reverses 0 (no phantom negative), and the SAME cumulative then asks for the whole clawback in one adjustment once the earn row appears (§24). Type `earn_reversal`: NEGATIVE points when clawing back, **POSITIVE points on a give-back** (L6.1), so the applied effect is always the SIGNED sum and never a sum of magnitudes. **L6.1: keyed by the target transition, not by the `re_`** — see §16. [lib/loyalty-refund-apply.ts](lib/loyalty-refund-apply.ts).

## 12 · Spent-point restoration (D2)
On refund, the total restored converges to `pointsRedeemed × f` (cumulative) — no longer 100 % on a partial. Type `refund`: POSITIVE points when restoring, NEGATIVE on a take-back (L6.1), credited to the visible balance (does **not** repay the offset — only earnings do, §14). **L6.1: keyed by the target transition, not by the `re_`** — see §16. This replaces the pre-Phase-1 full re-credit.

## 13 · Already-spent earned-point recovery (D3)
If a D1 clawback would push `pointsBalance` below 0 (the points were spent elsewhere), `applyReversalWithOffset` floors the visible balance at 0 and books the unrecovered remainder into `LoyaltyCustomer.recoveryOffsetPoints` (internal debt). Visible balance never goes negative. [lib/loyalty-refund.ts:applyReversalWithOffset](lib/loyalty-refund.ts).

> **AMENDMENT L6.1 — the INVERSE, for a convergence that must GIVE BACK.** When the applied effect exceeds the target, the difference is returned by `applyGiveBackAgainstOffset(give, offset)`: it takes the debt off FIRST (`min(give, offset)`) and credits only the remainder to the spendable balance. This is the exact arithmetic inverse of `applyReversalWithOffset` — walked by a round-trip test (reverse, then give back the same amount, returns to the starting state) beside a negative control showing that the naive « credit the balance and leave the debt » does NOT round-trip — and **not a reinterpretation of the D3 rule**, which is untouched: only future EARNINGS repay a debt that is genuinely owed (§14). **Its precondition, stated because it is not automatic**: it is an inverse only when the debt handed in is the debt THAT reversal created. `recoveryOffsetPoints` is a CUSTOMER-level pool and can hold other orders' debt, so the writer bounds the release by the order's OWN clawback total (`min(give, offset, applied)`); full attribution would need the per-row spill, which the schema does not store — a T-44 item, reported, never assumed away. Crediting the balance without unwinding the debt would leave the customer holding the points AND still owing them. Every use of this inverse is REPORTED (`loyalty_offset_t44_review`) because the composition of D-15 with the debt contract is DEFERRED — §24 (8).

## 14 · Future-earn offset mechanism (D3)
A future earning **repays the offset first**; only the remainder becomes spendable — `applyEarnWithOffsetRepay(earned, offset)`. Wired into the `delivered` earn credit ([status/route.ts:184](app/api/orders/[id]/status/route.ts:184)). The offset reaches 0 exactly once, never over-recovers.

## 15 · Goodwill waiver (D3)
`POST /api/admin/loyalty/waiver` — admin-only. Forgives `min(amountPoints, offset)`; reduces the debt, **does not** credit spendable balance. Audited in `AdminAuditLog` (`loyalty.waiver`: actor, reason, amount, timestamp) + a signed `offset_waiver` `LoyaltyTransaction` (`actorId`). Idempotent via a caller-supplied `idempotencyKey` (unique `(sourceEventId,'offset_waiver')`). [app/api/admin/loyalty/waiver/route.ts](app/api/admin/loyalty/waiver/route.ts).

## 16 · Idempotency source
**AMENDED BY L6.1 — the unit of work is the TARGET, not the event.** Phase 1 keyed one loyalty effect per immutable refund source event (the Stripe Refund id `re_…`) and relied on P2002 to stop a replay. Under convergence that is both unnecessary and wrong: unnecessary because a converged order computes a difference of ZERO and writes nothing (so a replay never reaches a key), and wrong because a key naming ONE event cannot express a total that a LATER-PROVEN EARLIER event must move.

Idempotency now rests on three independent layers, in this order:
1. **the zero-difference guard** — at the target nothing is written, however often the order is reconciled ;
2. **the customer row lock** — `SELECT pointsBalance, recoveryOffsetPoints FROM LoyaltyCustomer WHERE id = ? FOR UPDATE`, taken BEFORE the applied effect is read, so two concurrent reconciliations of the same customer serialise and the second sees the first's write instead of racing it ;
3. **`@@unique([sourceEventId, type])`** on a key derived from the OBSERVED STATE: `prorata:v1:<orderId>:<seq>:<applied>:<target>`, where `seq` is the number of rows already on that side for that order. Two runs that computed the same transition from the same state cannot both write it; `seq` is monotone, so a later legitimate transition can never be mistaken for a replay of an earlier one even if the proven set oscillates. On a collision the writer RE-READS and re-converges (bounded by `CONVERGENCE_ATTEMPTS`), so a superseded pass never returns short.

Rows written by the pre-L6.1 code keep their `re_` keys, count normally in the applied effect, and can never collide with a new key. `[orderId, type]` remains **REJECTED** as a key (it cannot express successive transitions). Waivers are unchanged: `waiver:<customerId>:<caller idempotencyKey>` (customer-scoped, review F-P2). Mirrors the ledger's proven `@@unique([sourceEventId,type])` — [schema](prisma/schema.prisma).

## 17 · Webhook reconciliation semantics
`charge.refunded` is the **single reconciliation point** and is **NOT gated by `REFUNDS_ENABLED`** (deliberately — per founder: `REFUNDS_ENABLED` gates who may *initiate*; it must not suppress reconciling an *established* Stripe refund). A refund initiated by the admin rail OR externally on the Stripe Dashboard reconciles identically — L6.1: by converging the same proven set to the same target, so the webhook, the `delivered` replay and the admin repair route cannot land on different states. `executeRefund` does **not** separately touch loyalty (it creates the Stripe refund; the resulting webhook reconciles) — one owner, no double effect.

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
Rule: at the `delivered` transition, (1) the `earn` credit is skipped only if an `earn` row exists for the order OR the legacy `(NULL,'refund')` marker exists (grandfathered, §23); a `refund`/`earn_reversal` row carrying a `re_` no longer blocks the earn. (2) Otherwise the existing earn transaction runs unchanged (full `pointsEarned`, offset repay, `FOR UPDATE`) and COMMITS. (3) ALWAYS afterwards, on the ROOT client (never nested — the tx client has no `$transaction`), `reconcileLoyaltyOnRefund(prisma, { orderId, chargeAmountCents, refunds })` CONVERGES the D1/D2 effect to the cumulative target of the DB-known set (§9 amendment L6.1 — it no longer replays a per-event plan): the union, deduplicated by `re_`, of `Refund { orderId, status:'succeeded', stripeRefundId ~ re_ }` and `LedgerEntry { type:'refund', stripePaymentIntentId = order PI, sourceEventId ~ re_ }` (amount = −grossAmount); never a pending/failed row, never `charge.amount_refunded`; `createdUnix` = ledger `createdAt` else `settledAt ?? createdAt`; `chargeAmountCents` = the ledger `payment` line `grossAmount` for the PI, else `round(order.total × 100)`. No Stripe call from the status route. (4) Net credited points = `E − min(round(E × ΣR / T), E)` — the §9 cumulative target; pinned: T=1410, E=14, refunds 470×3 proven ONE AT A TIME ⇒ `earn_reversal` −5/−4/−5, net 0, and the same three proven AT ONCE ⇒ a single −14, net 0 (the total is what the contract fixes, not the number of rows); 705 ⇒ −7; a later NEW refund writes only the difference to the new target; a replay with the same set writes NOTHING (the difference is 0 — §16 amendment). (5) Failure after the earn committed: one immediate retry, then `[LOYALTY MISS] earn_prorata_incomplete` + admin alert `loyalty_prorata_incomplete` (dedupe `loyalty:<orderId>:prorata`); repair path = `POST /api/admin/loyalty/reconcile { orderId }` (admin session, DB only, no Stripe, not gated by any claims flag) which replays (3). (6) Tests (L6): no refund; partial before delivered; total before delivered; points spent (existing `refund` rows ⇒ P2002 skipped, balance consistent); 470×3; idempotence (webhook replay + second DB replay ⇒ 0 writes; the `[orderId,'earn']` guard is check-then-act, single-flight assumption documented); earn OK + replay throws ⇒ alert then repair ⇒ same end state as the total-refund case; legacy marker ⇒ 0 rows, `grandfathered`.

**(7) CLOSED BY L6.1 (founder decision 2026-09-25, option (a)) — was: the prefix-completeness precondition of §9.** The residual L6 named: §9's telescoping is drift-free only for a writer holding the WHOLE refund set in one pass, the set of (3) is « what the database proves » (strictly weaker), and every written `(re_, type)` row FROZE the delta it computed — so a set becoming visible in the WRONG ORDER settled one point away from the target, permanently. Measured: T=1410, E=14, two refunds of 470; the LATER one visible alone first ⇒ −5; the EARLIER one lands afterwards, sorts first, books −5 too ⇒ **10 booked where the target is 9**.

The founder chose **ADJUSTMENT TO THE CUMULATIVE TARGET** (rejecting both an accepted one-point gap and a prefix precondition that would have made the late-arriving case unrepairable). §9, §10, §11, §12, §13 and §16 are amended accordingly: the reconciliation computes the target for the proven set, reads the effect really applied, and writes only the difference — order-independent, idempotent, convergent, exact, append-only, signed. The same sequence now gives −5 then −4 ⇒ **9, not 10**.

**A GIVE-BACK NEEDS COMPLETE PROOF (L6.1, adversarial review).** Raising the effect to the target is always safe: a set that is too small simply asks for less. LOWERING it is not. The set of (3) is what the DATABASE proves, and the database cannot see a Dashboard refund whose webhook has not landed — so an order correctly clawed back for two refunds, reconciled again from a set proving only one, would hand the customer points that were rightly taken. `ReconcileInput.proofComplete` therefore decides one thing: whether a NEGATIVE difference may be written. It defaults to **false** (fail closed), and only the `charge.refunded` webhook passes true — and only when Stripe's own list call SUCCEEDED (`!listFailed`: the embedded payload carries at most the ten most recent refunds). A held give-back is reported in `heldGiveBack` and alerted (`loyalty_target_unconverged`, with `proofComplete: false` and the reason in words); it is never silently applied and never silently dropped. Two further guards from the same review: the cumulative used is `max(proven Σ, the order's high-water)`, read back from this module's own keys, so a SHRINKING proof set cannot lower a target either; and the base, the applied effect, the high-water and the target are all read inside ONE transaction under the customer's row lock — a stale base beside a fresh applied figure gave points away.

The drift comparison introduced by L6 STAYS, with a changed meaning: it is now an INDEPENDENT VERIFIER of the writer (re-read the rows, recompute §9, compare the SIGNED sum — a give-back row carries POSITIVE points and must not be counted as more clawback). After L6.1 a non-null result is **a defect, not a residual** — a row written outside the reconciliation, or a target the writer could not reach — and it is alerted as one (`[LOYALTY MISS] earn_prorata_drift` + `loyalty_prorata_incomplete`, dedupe `loyalty:<orderId>:drift`, plus a `drift` field on the repair route's response and audit). A side that cannot reach its target within `CONVERGENCE_ATTEMPTS` is itself alerted (`loyalty_target_unconverged`), so nothing is ever left silent. Grandfathered orders remain exempt and are never measured against §9 (§23).

**(8) DEFERRED TO T-44 PRE-LIVE (founder decision 2026-09-25) — composition of D3 with D-15.** When the earned points were already spent elsewhere, §13 bounds the clawback to the visible balance and books the remainder in `recoveryOffsetPoints` (a debt repaid only by FUTURE earnings, never by the balance). In the D-15 case the earning is credited and clawed back within the same second — and the sequence is more consequential than it looks, so here it is exactly. At `delivered`, `applyEarnWithOffsetRepay` makes the earning **repay any pre-existing debt FIRST** (§14), so only the remainder reaches the spendable balance. The clawback that follows then takes its points out of that already-reduced balance, and if the balance cannot cover it the shortfall becomes debt again. Net effect on a customer who carried a debt: the annulled earning **did** extinguish part of it, and the clawback was partly paid by the customer's other points. That follows §9/§13/§14 as written and is what the tests pin — but whether an ANNULLED earning should extinguish a pre-existing debt at all is **not decided by this contract and is not decided here**.

Founder ruling for the beta: keep the current behaviour; do NOT claim the composition with `recoveryOffsetPoints` is certified; keep and HARDEN the detection; raise a MONEY REVIEW alert whenever the D-15 case meets a non-zero debt needing a T-44 interpretation; no silent loss; no automatic rewrite of the debt contract. Implemented as three alert shapes, all `loyalty_offset_t44_review`, all naming the order and the amounts with `moneyMoved: false`: (a) a clawback that CREATED debt or landed on a customer who already carried one ; (b) a give-back that had to UNWIND debt — bounded to the order's own clawback total, because the pool is customer-level ; (c) at the `delivered` transition, an earning that REPAID a debt on an order whose refunds then clawed points back — the composition above, raised from the one place that knows both halves. A D2 take-back never creates debt at all: it takes only what the balance holds and REPORTS the remainder (`heldGiveBack`), because an over-restore is our arithmetic error and must not become a debt the customer repays out of a future earning. The arithmetic inverse IS applied so the customer never holds points they still owe (§13 amendment) — that is an inverse, not a reinterpretation, and it is pinned by a round-trip test.

**Status to quote: D-15 cumulative target = CERTIFIED for the normal path. D-15 × `recoveryOffsetPoints` debt = DEFERRED TO T-44 PRE-LIVE.** The deferral blocks neither L7 nor the beta, because the case is detected and visible.
