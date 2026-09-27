// lib/order-refund-summary.ts — D′ L9 / T-45 · V-02: what a CONSUMER may be told about a refund.
//
// THE DEFECT THIS CLOSES (GO-LIVE-TICKETS T-45, found in the FULL-refund rehearsal GR-GBZE1X). After a
// refund the consumer app said nothing at all, and worse, it kept asserting the opposite:
//   • `GET /api/orders/[id]` returns `paymentStatus: 'paid'` — it AFFIRMS the payment stands;
//   • `Order.pointsEarned` is NEVER decremented, and /eat/track renders « +14 points fidélité crédités »
//     on an order whose points were clawed straight back (measured with the repository's own canonical
//     figures: T=1410, E=14, refunded in full ⇒ `earn_reversal` −14, net 0 points, still « +14 »);
//   • no consumer surface reads the `Refund` table or the ledger, so 14,50 € could return to a customer's
//     bank with every screen still showing « Total payé 14,50 € » and « Livrée ».
// The only truthful consumer channel was the confirmation e-mail.
//
// WHAT THIS MODULE IS. An ADDITIVE READ-MODEL, derived, never persisted. `Order.paymentStatus` is NOT
// touched (founder §2, firm): it describes the PAYMENT of the order and continues to. A refund is a
// separate fact, and this file is the only place that assembles it for a consumer.
//
// WHERE THE NUMBERS COME FROM, and why each source was chosen:
//   refundedCents     Σ of `Refund` rows the SHARED PROOF accepts — `refundRowSettled` in
//                     lib/claim-action-rules, the same primitive the claim surfaces use since S-20. A
//                     `pending`, `failed`, released or id-less row is NOT money the customer received.
//   pendingCents      Σ of rows still in flight (`pending` WITH a Stripe id — the exact shape
//                     `boundRowShowsInProgress` already treats as « en cours »). Never added to
//                     refundedCents; never worded « remboursé ».
//   unattributedCents Σ of ledger `refund` lines on this order's PaymentIntent whose `re_` belongs to NO
//                     `Refund` row of the order. That is real Stripe money with no certain product origin
//                     — a Dashboard refund, typically. Disjoint from refundedCents BY CONSTRUCTION (a
//                     given `re_` is on one side or the other), so §6's « ne pas double-compter » holds
//                     without a subtraction anywhere.
//   chargeCents       the ledger `payment` line of the PaymentIntent, else `round(order.total × 100)` —
//                     the SAME rule and the same fallback order as the frozen §24 set in
//                     lib/loyalty-prorata.buildDbKnownRefundSet. Never `charge.amount_refunded`, which is
//                     a running total and would double-count.
//   pointsReversed /  read from `LoyaltyTransaction` ROWS, never from `Order.pointsEarned` (the column the
//   pointsRestored    old copy trusted) and never from `pointsBalance` (which is not Σ(rows) and never
//                     was). The L6.1 cumulative path stays THE authority: this file only reads what that
//                     authority wrote, and recomputes nothing.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not call Stripe (§3: a consumer GET must not depend on
// Stripe's availability — the tracking page polls this every 15 s). It writes nothing. It reads no
// `metadata`, so it cannot tell a Dashboard refund from ours by the engine's `grubano_refund_row` stamp —
// which is exactly why the unattributed copy is neutral rather than a guess about origin.
import {
  refundRowSettled, provenStripeRefundId,
} from '@/lib/claim-action-rules'

/** Order statuses at which a refund read-model is worth assembling (§9). */
export const REFUND_SUMMARY_TERMINAL_STATUSES = ['delivered', 'cancelled', 'expired'] as const

/**
 * Where a refund came from, as far as a CONSUMER may be told. Deliberately coarse: these four words carry
 * no operator identity, no claim id and no internal reason string.
 *  claim    — a réclamation the customer filed (the engine stamps `reason = claim:<id>`);
 *  system   — Grubano's own automatic give-back (today: the abandoned-checkout « ghost order »);
 *  external — a refund issued outside the product and later mirrored into our base;
 *  support  — a human at Grubano issued it. The DEFAULT, because a row with no reason at all is the
 *             commonest support row (`/api/admin/refunds/run` makes `reason` optional).
 */
export type RefundSource = 'claim' | 'support' | 'system' | 'external'

/** One line of the customer's refund history. Three fields, and nothing that names an internal object. */
export interface ConsumerRefundLine {
  amountCents: number
  /** ISO instant the money settled (`settledAt` when we have it, else the row's creation). */
  at: string
  source: RefundSource
}

export interface OrderRefundSummary {
  refundedCents:      number
  pendingCents:       number
  unattributedCents:  number
  chargeCents:        number
  isTotal:            boolean
  isPartial:          boolean
  refunds:            ConsumerRefundLine[]
  pointsReversed:     number
  pointsRestored:     number
}

/**
 * The STABLE empty shape (§10: « forme vide/stable définie, pas undefined aléatoire selon le chemin »).
 * Every path that declines to compute returns this exact object, so a client never has to distinguish
 * « no refund » from « not computed » — both are « nothing to show », which is the same truth to a reader.
 * Frozen so a caller cannot mutate the shared instance.
 */
export const EMPTY_REFUND_SUMMARY: OrderRefundSummary = Object.freeze({
  refundedCents: 0, pendingCents: 0, unattributedCents: 0, chargeCents: 0,
  isTotal: false, isPartial: false, refunds: [] as ConsumerRefundLine[],
  pointsReversed: 0, pointsRestored: 0,
})

/** A fresh mutable copy of the empty shape. */
export const emptyRefundSummary = (): OrderRefundSummary => ({
  ...EMPTY_REFUND_SUMMARY, refunds: [],
})

// ── THE PURE DERIVATION ═══════════════════════════════════════════════════════════════════════════════

/** A `Refund` row, as much of it as this read-model is allowed to look at. */
export interface RefundRowFacts {
  status:         string | null
  stripeRefundId: string | null
  amountCents:    number | null
  reason:         string | null
  idempotencyKey: string | null
  settledAt:      Date | null
  createdAt:      Date | null
}

/** A ledger line of this order's PaymentIntent. `grossAmount` is NEGATIVE on a refund. */
export interface LedgerLineFacts {
  type:          string | null
  sourceEventId: string | null
  grossAmount:   number | null
  createdAt:     Date | null
}

/** A `LoyaltyTransaction` row of this order. `points` is SIGNED. */
export interface LoyaltyRowFacts {
  type:          string | null
  points:        number | null
  sourceEventId: string | null
}

export interface RefundSummaryInput {
  /** `round(order.total × 100)` — the fallback denominator, used when the ledger has no payment line. */
  orderTotalCents: number
  refundRows:      RefundRowFacts[]
  ledgerLines:     LedgerLineFacts[]
  loyaltyRows:     LoyaltyRowFacts[]
}

/** The prefix `adoptStripeRefundForClaim` writes on a row that MIRRORS a Stripe-Dashboard refund. */
const EXTERNAL_KEY_PREFIX = 'external:'

/** The reason the claim rail stamps. Anything else is not a claim refund. */
const CLAIM_REASON_PREFIX = 'claim:'

/** The reason the abandoned-checkout auto-refund stamps. */
const SYSTEM_REASONS = new Set(['ghost_order_expired'])

const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0)

/** The consumer-facing origin of one row. Order matters: the mirror wins over whatever reason it copied. */
export function refundSourceOf(row: Pick<RefundRowFacts, 'reason' | 'idempotencyKey'>): RefundSource {
  if ((row.idempotencyKey ?? '').startsWith(EXTERNAL_KEY_PREFIX)) return 'external'
  const reason = row.reason ?? ''
  if (reason.startsWith(CLAIM_REASON_PREFIX)) return 'claim'
  if (SYSTEM_REASONS.has(reason)) return 'system'
  return 'support'
}

/**
 * Assemble the summary from facts already read. PURE: no clock, no Prisma, no Stripe, no i18n.
 *
 * ON THE TWO CLAMPS, because a clamp that hides a contradiction is worse than no clamp. §8 says a figure
 * above the charge must not produce an incoherent representation and must not be rewritten. So:
 *   • `refundedCents` is reported AS MEASURED, even above `chargeCents` — the sum of settled rows is a
 *     fact, and shrinking it to fit a denominator would be inventing data;
 *   • `isTotal` becomes true at or above the charge, which is the honest reading of « everything came
 *     back », and the caller can see the excess for itself by comparing the two integers.
 * `overRefunded` is not a field: §3 fixes the field list, and a consumer has nothing to do with the
 * anomaly. `summaryAnomaly` below names it for a log without widening the payload.
 */
export function deriveOrderRefundSummary(input: RefundSummaryInput): OrderRefundSummary {
  // ── chargeCents — the ledger payment line wins, the order total is the named fallback.
  const paymentLine = input.ledgerLines.find((l) => l.type === 'payment' && int(l.grossAmount) > 0)
  const chargeCents = paymentLine ? int(paymentLine.grossAmount) : Math.max(0, int(input.orderTotalCents))

  // ── THE LEDGER IS PROOF, and it has to be weighed FIRST ─────────────────────────────────────────────
  //
  // A `type:'refund'` ledger line exists only for a refund STRIPE reported as succeeded (the webhook filters
  // on that status before booking; the engine writes its line only past the non-succeeded early return). So
  // such a line is proof the money left — the same class of proof as a settled row, and exactly what the
  // FROZEN §24 set (`buildDbKnownRefundSet`) treats it as when it claws loyalty points back.
  //
  // WHY THIS ORDER MATTERS, measured. The first version weighed the rows first and consulted the ledger only
  // for money NO row named. It therefore trusted a ledger line enough to EXCLUDE it from the unattributed
  // figure, but not enough to move it out of « in flight »: a row left `(pending, re_A)` because our own
  // finalize write failed, beside a ledger line for `re_A`, reported pendingCents 1410 and refundedCents 0 —
  // so the tracking page said « Remboursement de 14,10 € en cours » about money the ledger already proved had
  // arrived, and the list showed nothing at all. The same Stripe object was simultaneously ours-and-settled
  // (for attribution) and not-yet-arrived (for the figure).
  const ledgerRefundCents = new Map<string, number>()
  for (const line of input.ledgerLines) {
    if (line.type !== 'refund') continue
    if (!provenStripeRefundId(line.sourceEventId)) continue          // a legacy line we cannot key on
    const amount = int(-int(line.grossAmount))                        // a refund's gross is negative
    if (amount > 0 && !ledgerRefundCents.has(line.sourceEventId as string)) {
      ledgerRefundCents.set(line.sourceEventId as string, amount)
    }
  }

  // ── the settled rows, deduplicated by `re_`. A duplicate can exist: the claim rail's own row and an
  //    external mirror of the same Stripe object both carry the same id, and counting both would double
  //    the customer's refund on screen.
  const settledById = new Map<string, RefundRowFacts>()
  const pendingIds = new Set<string>()
  let pendingCents = 0
  for (const row of input.refundRows) {
    if (refundRowSettled(row)) {
      const id = row.stripeRefundId as string
      if (!settledById.has(id)) settledById.set(id, row)
      continue
    }
    // « en cours » is the SAME shape `boundRowShowsInProgress` accepts: pending, and named at Stripe.
    // A pending row with no id is not in flight as far as anyone can prove — it is the shape the release
    // mechanism exists for — so it is counted nowhere and shown nowhere.
    if (row.status === 'pending' && provenStripeRefundId(row.stripeRefundId)) {
      const id = row.stripeRefundId as string
      // …UNLESS the ledger already proved that same object landed. Then it is not in flight, it is arrived,
      // and calling it « en cours » would be the very kind of false statement this lot exists to remove.
      if (ledgerRefundCents.has(id)) continue
      const amount = int(row.amountCents)
      if (amount > 0) { pendingIds.add(id); pendingCents += amount }
    }
  }
  const refundedCents = Array.from(settledById.values()).reduce((s, r) => s + int(r.amountCents), 0)

  // ── unattributedCents — the ledger money whose PRODUCT ORIGIN this read-model cannot establish.
  //
  // §6 defines it as a line whose `re_` « n'est attribué à aucune Refund correspondante connue ». A row that
  // is still `pending` — or `failed`, or released — is not a CORRESPONDANCE that establishes the refund: it
  // is an unfinished or abandoned attempt of ours. So the money is confirmed (the ledger says so) while its
  // origin is not — which is exactly what the neutral copy states and all it states. (D′ L10 reworded that copy:
  // it now says the refund is « confirmé auprès de notre prestataire de paiement » rather than « a été
  // enregistré », because « enregistré » read as « our own record is closed » and contradicted the
  // « Remboursement en cours » the claim widget renders three rows below on the same screen. The BUCKETS are
  // unchanged; only the sentence is.) The three buckets are therefore DISJOINT by construction: settled,
  // in-flight-and-unproven-at-the-ledger, and confirmed-but-unattributed.
  //
  // The status filter is deliberately ABSENT from the SETTLED side above: `markRefundRowFailed` writes the
  // `re_` onto a failed row, so filtering the attribution on `succeeded` would report our own refund as a
  // stranger's. What decides here is whether a SETTLED row owns the id, not whether any row mentions it.
  // Array.from rather than spread/for-of over a Map or Set: this project's TS target predates
  // downlevelIteration, and a compile error here is not worth a config change to a shared tsconfig.
  const attributedIds = new Set<string>()
  settledById.forEach((_v, id) => attributedIds.add(id))
  pendingIds.forEach((id) => attributedIds.add(id))
  let unattributedCents = 0
  ledgerRefundCents.forEach((amount, id) => {
    if (!attributedIds.has(id)) unattributedCents += amount
  })

  // ── TOTAL vs PARTIAL — from THE WHOLE CONFIRMED CUMULATIVE (§8), which is not the same thing as
  //    `refundedCents`. This distinction was got wrong first and the mistake reached a measured screen:
  //
  //    A 14,10 € order refunded by TWO rails — 10,00 € through the claim engine (a `Refund` row) and the
  //    remaining 4,10 € from the Stripe Dashboard (a ledger line and NO row, because only lib/refund and the
  //    adoption mirror ever create a row) — produced refundedCents 1000, unattributedCents 410, and flags
  //    computed from the 1000 alone: isPartial TRUE. The card then read « Remboursement partiel 10,00 € » on
  //    an order whose customer had received every cent of the charge, understated by 410 c. Worse, the
  //    loyalty side had already clawed back ALL 14 points, because the FROZEN §24 set
  //    (`buildDbKnownRefundSet`) unions the rows WITH the ledger lines — so the same build described one
  //    Stripe object two different ways on one screen. That is the T-46 defect's exact shape: a figure
  //    derived over one population while a sibling figure uses another.
  //
  //    A `type:'refund'` ledger line is only ever written for a refund Stripe reported as SUCCEEDED (the
  //    webhook filters on it; the engine writes its line only past the non-succeeded early return), so this
  //    money is confirmed — it is merely UNATTRIBUTED, which is a statement about provenance, not about
  //    whether it arrived. §8 says the flags follow the confirmed cumulative, and this is it. Pending is
  //    still excluded: nothing has been proven to have arrived there.
  const confirmedCents = refundedCents + unattributedCents
  const isTotal   = chargeCents > 0 && confirmedCents >= chargeCents
  const isPartial = confirmedCents > 0 && !isTotal

  // ── the history, newest first, three fields per line.
  const refunds: ConsumerRefundLine[] = Array.from(settledById.values())
    .map((r) => ({
      amountCents: int(r.amountCents),
      at: (r.settledAt ?? r.createdAt ?? new Date(0)).toISOString(),
      source: refundSourceOf(r),
    }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))

  // ── points. SIGNED sums, per the L6.1 convention: an `earn_reversal` is NEGATIVE when it claws back and
  //    POSITIVE when a convergence gives some back, and a `refund` row is its mirror. Summing magnitudes
  //    would read a give-back as MORE clawback — the exact mistake lib/loyalty-prorata warns about.
  //    A legacy `refund` row (sourceEventId null) is the pre-Phase-1 FULL re-credit marker; it is counted
  //    as restored because it really was restored, and no prorata figure is stated anywhere here.
  const signed = (type: string) => input.loyaltyRows
    .filter((r) => r.type === type)
    .reduce((a, r) => a + int(r.points), 0)
  const pointsReversed = Math.max(0, -signed('earn_reversal'))
  const pointsRestored = Math.max(0,  signed('refund'))

  return {
    refundedCents, pendingCents, unattributedCents, chargeCents,
    isTotal, isPartial, refunds, pointsReversed, pointsRestored,
  }
}

/**
 * The anomaly a caller may log. Returns null when the summary is coherent. Never shown to a consumer, and
 * never a reason to rewrite a figure — §8: « signaler l'anomalie sans réécrire la donnée ».
 */
export function summaryAnomaly(s: OrderRefundSummary): string | null {
  if (s.chargeCents > 0 && s.refundedCents > s.chargeCents) {
    return `refunded_above_charge: ${s.refundedCents}c confirmed against a ${s.chargeCents}c charge`
  }
  if (s.refundedCents > 0 && s.chargeCents === 0) return 'refunded_with_no_charge_reference'
  return null
}

/**
 * The minimal shape a LIST may carry (§11). No `refunds[]` and no pending figure — a card is not the place
 * to explain a refund.
 *
 * `unattributedCents` IS carried, and it has to be. Without it a card holding `refundedCents` and the flags
 * cannot tell « fully refunded, 14,10 € » from « fully refunded, of which only 10,00 € is ours to name », and
 * it would print the smaller figure as though it were the whole refund. The card does not state that money's
 * origin (§6 keeps that copy neutral) — it uses the field to know that it must NOT state an amount at all.
 */
export interface RefundListBadge {
  refundedCents:     number
  unattributedCents: number
  isTotal:           boolean
  isPartial:         boolean
}

export const refundListBadge = (s: OrderRefundSummary): RefundListBadge => ({
  refundedCents: s.refundedCents, unattributedCents: s.unattributedCents,
  isTotal: s.isTotal, isPartial: s.isPartial,
})

// ── THE LOADERS ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * The Prisma surface this module reads. Structural on purpose, so a test injects three plain functions
 * instead of a whole PrismaClient — the query COUNT is part of this module's contract (§9) and a test must
 * be able to observe it.
 *
 * `any` here is deliberate and is the only way both directions typecheck: Prisma's generated `findMany` is
 * an overloaded generic, so a narrower parameter type (`unknown`) makes the real client unassignable by
 * contravariance, while a narrower return type makes a test double unassignable. The values are validated
 * at the boundary by the `Facts` interfaces below, which is where the real type safety lives.
 */
export interface RefundSummaryDb {
  refund:             { findMany: (args: any) => Promise<any> }
  ledgerEntry:        { findMany: (args: any) => Promise<any> }
  loyaltyTransaction: { findMany: (args: any) => Promise<any> }
}

export interface OrderFactsForSummary {
  id:                    string
  status:                string | null
  total:                 number | null
  stripePaymentIntentId: string | null
}

/**
 * §9 — whether a summary is worth assembling at all. Both conditions are required:
 *   • a PaymentIntent, because without one there is no Stripe money and no ledger line to find;
 *   • a TERMINAL status, because a refund before the order is finished is not a case any consumer surface
 *     renders, and the tracking page polls the detail route every 15 s from the moment it opens.
 * An order that fails either test gets the stable empty shape, not a partial one.
 */
export function refundSummaryApplies(order: Pick<OrderFactsForSummary, 'status' | 'stripePaymentIntentId'>): boolean {
  return !!order.stripePaymentIntentId
    && (REFUND_SUMMARY_TERMINAL_STATUSES as readonly string[]).includes(order.status ?? '')
}

const REFUND_SELECT = {
  status: true, stripeRefundId: true, amountCents: true,
  reason: true, idempotencyKey: true, settledAt: true, createdAt: true,
} as const
const LEDGER_SELECT = { type: true, sourceEventId: true, grossAmount: true, createdAt: true, stripePaymentIntentId: true } as const
const LOYALTY_SELECT = { type: true, points: true, sourceEventId: true, orderId: true } as const

const cents = (total: number | null): number => Math.max(0, Math.round(Number(total ?? 0) * 100))

/**
 * ONE order. THREE queries, and never more — no Stripe, no per-row follow-up:
 *   `Refund` by orderId (indexed), the ledger by PaymentIntent, `LoyaltyTransaction` by orderId (indexed).
 * A read that throws degrades to the empty shape rather than 500-ing the order page: a consumer must be
 * able to see their order even when the refund side is unreadable, and showing « nothing » is the honest
 * answer when we cannot prove anything. The caller logs; this returns.
 */
export async function loadOrderRefundSummary(
  db: RefundSummaryDb,
  order: OrderFactsForSummary,
): Promise<OrderRefundSummary> {
  if (!refundSummaryApplies(order)) return emptyRefundSummary()
  const [refundRows, ledgerLines, loyaltyRows] = await Promise.all([
    db.refund.findMany({ where: { orderId: order.id }, select: REFUND_SELECT }) as Promise<RefundRowFacts[]>,
    db.ledgerEntry.findMany({
      where:  { stripePaymentIntentId: order.stripePaymentIntentId, type: { in: ['payment', 'refund'] } },
      select: LEDGER_SELECT,
    }) as Promise<LedgerLineFacts[]>,
    db.loyaltyTransaction.findMany({ where: { orderId: order.id }, select: LOYALTY_SELECT }) as Promise<LoyaltyRowFacts[]>,
  ])
  return deriveOrderRefundSummary({
    orderTotalCents: cents(order.total), refundRows, ledgerLines, loyaltyRows,
  })
}

/**
 * A PAGE of orders. THREE queries for the whole page — never one per order (§9: « Pas de N+1
 * Refund/Ledger/Loyalty par commande »). The shape is the one lib/admin-reconciliation and
 * /api/restaurants/[id]/finance/operations already use: collect the ids, read in bulk with `in`, group
 * into Maps, then derive per order from the maps.
 *
 * Orders that fail §9 are not even collected, so a page of active orders costs ZERO extra queries.
 */
export async function loadRefundSummariesForOrders(
  db: RefundSummaryDb,
  orders: OrderFactsForSummary[],
): Promise<Map<string, OrderRefundSummary>> {
  const out = new Map<string, OrderRefundSummary>()
  const eligible = orders.filter(refundSummaryApplies)
  for (const o of orders) if (!eligible.includes(o)) out.set(o.id, emptyRefundSummary())
  if (eligible.length === 0) return out

  const orderIds = eligible.map((o) => o.id)
  const pis = Array.from(new Set(eligible.map((o) => o.stripePaymentIntentId).filter((p): p is string => !!p)))

  const [refundRows, ledgerLines, loyaltyRows] = await Promise.all([
    db.refund.findMany({ where: { orderId: { in: orderIds } }, select: { ...REFUND_SELECT, orderId: true } }) as Promise<Array<RefundRowFacts & { orderId: string }>>,
    db.ledgerEntry.findMany({
      where:  { stripePaymentIntentId: { in: pis }, type: { in: ['payment', 'refund'] } },
      select: LEDGER_SELECT,
    }) as Promise<Array<LedgerLineFacts & { stripePaymentIntentId: string | null }>>,
    db.loyaltyTransaction.findMany({ where: { orderId: { in: orderIds } }, select: LOYALTY_SELECT }) as Promise<Array<LoyaltyRowFacts & { orderId: string | null }>>,
  ])

  const byOrder = <T,>(rows: Array<T & { orderId?: string | null }>): Map<string, T[]> => {
    const m = new Map<string, T[]>()
    for (const r of rows) {
      const k = r.orderId ?? ''
      if (!k) continue
      const list = m.get(k); if (list) list.push(r); else m.set(k, [r])
    }
    return m
  }
  const refundsByOrder = byOrder(refundRows)
  const loyaltyByOrder = byOrder(loyaltyRows)
  const ledgerByPi = new Map<string, LedgerLineFacts[]>()
  for (const l of ledgerLines) {
    const k = l.stripePaymentIntentId ?? ''
    if (!k) continue
    const list = ledgerByPi.get(k); if (list) list.push(l); else ledgerByPi.set(k, [l])
  }

  for (const o of eligible) {
    out.set(o.id, deriveOrderRefundSummary({
      orderTotalCents: cents(o.total),
      refundRows:      refundsByOrder.get(o.id) ?? [],
      ledgerLines:     ledgerByPi.get(o.stripePaymentIntentId ?? '') ?? [],
      loyaltyRows:     loyaltyByOrder.get(o.id) ?? [],
    }))
  }
  return out
}
