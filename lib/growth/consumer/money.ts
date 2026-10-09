// ── Growth / consumer — order money normaliser (net integer cents) ────────────────────
//
// PURE. No I/O, no clock reads, no Prisma import. Input is explicit; output is the
// decision whether an order COUNTS toward RFM and the net cents it contributes.
//
// Doctrine (why this file exists):
//   - RFM must only count COMPLETED, PAID, NON-CANCELLED orders. The current prod schema
//     carries status ∈ {received, preparing, ready, picked_up, delivered, cancelled} and
//     paymentStatus ∈ {null, pending, paid}. A row stuck at 'received'+'pending' is an
//     abandoned checkout and MUST NOT inflate frequency.
//   - Partial refunds must be subtracted from the gross; a fully-refunded order must drop
//     out entirely. Double-counting is a correctness bug (a single partial refund split
//     into two re_… ids must NOT subtract twice if the caller forgot to dedupe).
//   - All arithmetic is integer cents. We never multiply floats, never round late.
//   - Fail-closed: an order whose caller cannot prove is "paid" is not countable. A
//     negative gross or a negative refund is a producer bug — fail-closed, not silent clamp.
//
// SHAPE NOTE: callers project the Prisma rows into this neutral shape so this file never
// imports Prisma. The projection must convert Order.total (euros, Float) × 100 → cents AT
// THE PROJECTION BOUNDARY, never here. See docs/ops/GROWTH-CONSUMER-B2C-NEXT.md §Mapping.

export type ConsumerOrderStatus =
  | 'received' | 'preparing' | 'ready' | 'picked_up' | 'delivered' | 'cancelled'

export type ConsumerPaymentStatus = 'paid' | 'pending' | null

export interface ConsumerOrderInput {
  orderId:             string
  tenantRestaurantId:  string
  contactId:           string
  /** Order creation instant in ms since epoch (UTC). The anchor for recency windows. */
  atMs:                number
  status:              ConsumerOrderStatus
  paymentStatus:       ConsumerPaymentStatus
  /** Gross charged to the customer POST-DISCOUNT, PRE-TIP, in integer cents. */
  grossCents:          number
  /**
   * Succeeded Refund.amountCents values applied to THIS order. Caller must have already
   * filtered to status === 'succeeded' and deduped on refund id. Pending/failed refunds
   * are not applied — this file does not know the lifecycle.
   */
  refundCentsList:     readonly number[]
}

export type UncountableReason =
  | 'cancelled'
  | 'not_paid'
  | 'invalid_amount'       // gross ≤ 0 or any refund < 0 or non-finite
  | 'fully_refunded'
  | 'duplicate'            // seen a prior row with the same orderId in the same batch
  | 'tenant_mismatch'      // row belongs to a different (tenant, contact) than requested
  | 'not_completed'        // paid but still in flight — not yet countable

export interface ConsumerOrderNet {
  orderId:             string
  tenantRestaurantId:  string
  contactId:           string
  atMs:                number
  /** gross − Σ refundCents, floored at 0 integer cents (never negative). */
  netCents:            number
  countable:           boolean
  reason:              'ok' | UncountableReason
}

/** Only these statuses count as "completed and paid-through" for RFM. */
const COMPLETED_STATUSES = new Set<ConsumerOrderStatus>(['ready', 'picked_up', 'delivered'])

/**
 * Reduce ONE order to a net-cents decision. Pure.
 *
 * Rules (checked in this exact order so the `reason` is unambiguous):
 *   1. cancelled                         → not countable, reason 'cancelled'
 *   2. paymentStatus !== 'paid'          → not countable, reason 'not_paid'
 *   3. grossCents / refunds not finite,
 *      non-integer, or negative           → not countable, reason 'invalid_amount'
 *      (negative gross cannot be rescued by a refund — bail HERE)
 *   4. status not in {ready,picked_up,
 *      delivered}                         → not countable, reason 'not_completed'
 *   5. Σ refunds ≥ grossCents             → not countable, reason 'fully_refunded'
 *   6. otherwise                          → countable, net = gross − Σ refunds
 *
 * Edge: an order that was paid, then cancelled → reason 'cancelled' wins over 'not_paid'.
 * This is intentional: a cancelled order never contributes regardless of payment state,
 * and the refund rail is responsible for returning the money separately.
 */
export function orderNet(input: ConsumerOrderInput): ConsumerOrderNet {
  const base = {
    orderId:            input.orderId,
    tenantRestaurantId: input.tenantRestaurantId,
    contactId:          input.contactId,
    atMs:               input.atMs,
  }

  if (input.status === 'cancelled') {
    return { ...base, netCents: 0, countable: false, reason: 'cancelled' }
  }
  if (input.paymentStatus !== 'paid') {
    return { ...base, netCents: 0, countable: false, reason: 'not_paid' }
  }
  if (!isSafeCents(input.grossCents) || input.grossCents <= 0) {
    return { ...base, netCents: 0, countable: false, reason: 'invalid_amount' }
  }
  let refundsSum = 0
  for (const r of input.refundCentsList) {
    if (!isSafeCents(r) || r < 0) {
      return { ...base, netCents: 0, countable: false, reason: 'invalid_amount' }
    }
    refundsSum += r
  }
  if (!COMPLETED_STATUSES.has(input.status)) {
    return { ...base, netCents: 0, countable: false, reason: 'not_completed' }
  }
  if (refundsSum >= input.grossCents) {
    return { ...base, netCents: 0, countable: false, reason: 'fully_refunded' }
  }
  // Floor at 0 as a belt — refundsSum < grossCents above makes it redundant, but a future
  // caller may change this file and the invariant must survive.
  const netCents = Math.max(0, input.grossCents - refundsSum)
  return { ...base, netCents, countable: true, reason: 'ok' }
}

/**
 * Reduce a BATCH scoped to a single (tenantRestaurantId × contactId). Rows outside that
 * scope are stamped 'tenant_mismatch' and NOT merged into counts — fail-closed, so an
 * account-A row that leaked into an account-B request vector cannot inflate B's RFM.
 *
 * Duplicate orderIds (same batch) are stamped 'duplicate' and the SECOND+ occurrences are
 * discarded. The first-seen row wins because the caller controls input order.
 */
export function normaliseOrderBatch(
  scope: { tenantRestaurantId: string; contactId: string },
  rows:  readonly ConsumerOrderInput[],
): ConsumerOrderNet[] {
  const out: ConsumerOrderNet[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (r.tenantRestaurantId !== scope.tenantRestaurantId || r.contactId !== scope.contactId) {
      out.push({
        orderId: r.orderId, tenantRestaurantId: r.tenantRestaurantId, contactId: r.contactId,
        atMs: r.atMs, netCents: 0, countable: false, reason: 'tenant_mismatch',
      })
      continue
    }
    if (seen.has(r.orderId)) {
      out.push({
        orderId: r.orderId, tenantRestaurantId: r.tenantRestaurantId, contactId: r.contactId,
        atMs: r.atMs, netCents: 0, countable: false, reason: 'duplicate',
      })
      continue
    }
    seen.add(r.orderId)
    out.push(orderNet(r))
  }
  return out
}

function isSafeCents(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n)
}
