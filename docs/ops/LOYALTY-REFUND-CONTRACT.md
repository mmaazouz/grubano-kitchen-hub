# LOYALTY-REFUND-CONTRACT — PHASE 1

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
**One loyalty effect per immutable refund source event = the Stripe Refund id `re_…`.** Stored as `LoyaltyTransaction.sourceEventId` with `@@unique([sourceEventId, type])`. Replay of a refund → P2002 → no-op; a distinct partial refund (distinct `re_…`) → applies once. `[orderId, type]` was **REJECTED** by the critic (partial refunds share it). Waivers use the caller's `idempotencyKey` as the `sourceEventId`. Mirrors the ledger's proven `@@unique([sourceEventId,type])` — [schema:1762](prisma/schema.prisma:1762).

## 17 · Webhook reconciliation semantics
`charge.refunded` is the **single reconciliation point** and is **NOT gated by `REFUNDS_ENABLED`** (deliberately — per founder: `REFUNDS_ENABLED` gates who may *initiate*; it must not suppress reconciling an *established* Stripe refund). A refund initiated by the admin rail OR externally on the Stripe Dashboard reconciles identically, keyed on `re_…`. `executeRefund` does **not** separately touch loyalty (it creates the Stripe refund; the resulting webhook reconciles) — one owner, no double effect.

## 18 · Schema decision — PURELY ADDITIVE
- `LoyaltyTransaction.sourceEventId String?` + `actorId String?` + `@@unique([sourceEventId, type])`.
- `LoyaltyCustomer.recoveryOffsetPoints Int @default(0)`.
- `type` is a free `String` → new types (`earn_reversal`, `offset_waiver`) need **no** migration.
**No dedup, no `--accept-data-loss`**: all existing rows get `sourceEventId = NULL`, and MySQL/InnoDB permits many NULLs in a UNIQUE index (precedent in-repo: `Payout.idempotencyKey String? @unique`, [schema:1800](prisma/schema.prisma:1800)). `prisma validate` = OK; client regenerated with the fields.

## 19 · Migration plan
The repo has **no `prisma/migrations`** (schema managed by `db push`; deploy scripts use `--accept-data-loss` — forbidden here). Because the change is additive, apply with **`prisma db push` WITHOUT `--accept-data-loss`** (`scripts/server/prisma-push.sh` already runs it flagless). Sequence (founder-executed, §20–21): fresh backup → baseline → `db push` → integrity check → merge → deploy → healthcheck → post-deploy loyalty check → only then consider lifting the freeze. **Local disposable rehearsal proves the push is additive before staging** (§21 evidence).

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
