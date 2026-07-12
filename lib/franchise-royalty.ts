import { prisma } from '@/lib/prisma'

// ── P4-Franchise-A — Franchise royalty (HELD-BACK at the source) ─────────────────
// For FRANCHISED restaurants only, retain an EXTRA `rate` (the franchisor's royalty)
// in the charge's application_fee ON TOP of the Grubano commission. The composition
// happens at the orders/pay call site (total application_fee = computeApplicationFee
// (UNCHANGED) + this royalty); lib/commission.ts and lib/ledger.ts are byte-identical.
//
// CENTRAL INVARIANT — gated by FRANCHISE_ROYALTY_ENABLED (default OFF):
//   OFF → computeFranchiseRoyalty returns ZERO **without touching the DB** → no
//   held-back, no accrual, application_fee = Grubano commission alone → the charge,
//   the PaymentIntent, its idempotency key and the ledger line are ALL byte-identical
//   to today.
//
// 100% PASS-THROUGH: the royalty is owed to the franchisor, it is NOT Grubano
// revenue. It is tracked in the FranchiseRoyalty table (a 'pending' obligation),
// SEPARATELY from the restaurant-centric LedgerEntry. NO settlement here (= step B).
//
// Base = order.subtotal (cents) × rate — the SAME definition as the franchise
// my-dashboard's `royaltiesDue` (revenue = Order.subtotal × FRANCHISE_ROYALTY_RATE),
// kept deliberately consistent so the two views cannot diverge in definition.

// Default rate when a brand has no royaltyPct set. THE single source of 0.06 — the
// accrual (here) AND my-dashboard both resolve their rate through resolveFranchiseRate,
// so the dashboard estimate can never diverge from the real held-back. (B4, Agent 46.)
export const FRANCHISE_ROYALTY_RATE = 0.06
// Defensive ceiling — a corrupted/aberrant stored royaltyPct can never produce a rate
// above 50%. The edit API validates a tighter business range; this is the last guard.
export const MAX_FRANCHISE_ROYALTY_RATE = 0.5

/**
 * Effective royalty rate (a FRACTION, e.g. 0.06 = 6%) for a franchise sale, resolved
 * from the BRAND operated at the point of sale. `royaltyPct` is stored as a fraction
 * (seed/discovery convention). null/undefined/NaN → the 6% default (byte-identical to
 * the pre-B4 hardcoded constant). An explicit 0 is honoured (a 0% brand). Clamped to
 * [0, MAX] so a bad value can never blow up the held-back. The SAME helper is used by
 * the accrual and my-dashboard → the two are guaranteed consistent.
 */
export function resolveFranchiseRate(brand?: { royaltyPct?: number | null } | null): number {
  const v = brand?.royaltyPct
  if (v == null || !Number.isFinite(v)) return FRANCHISE_ROYALTY_RATE
  return Math.min(Math.max(v, 0), MAX_FRANCHISE_ROYALTY_RATE)
}

/** Kill-switch — default OFF. Only the exact string 'true' enables the rail. */
export function isFranchiseRoyaltyEnabled(): boolean {
  return process.env.FRANCHISE_ROYALTY_ENABLED === 'true'
}

export interface FranchiseRoyaltyQuote {
  /** Cents to add to the application_fee (held back for the franchisor). 0 = none. */
  royaltyCents: number
  /** The Operator that owns the franchise (PointOfSale.franchiseId), or null. */
  franchisorOperatorId: string | null
  /** Echoed POS id when a royalty applies, else null. */
  pointOfSaleId: string | null
  /** Rate applied (0 when none). */
  rate: number
}

const ZERO: FranchiseRoyaltyQuote = {
  royaltyCents: 0, franchisorOperatorId: null, pointOfSaleId: null, rate: 0,
}

// computeFranchiseRoyalty — the held-back amount + the franchisor to credit, for one
// order. Returns ZERO (and does NOT hit the DB) when the flag is OFF or the order is
// not attached to a franchise point of sale → the charge stays byte-identical. The
// only DB read (PointOfSale.franchiseId) happens exclusively on the ON + has-POS path.
export async function computeFranchiseRoyalty(input: {
  pointOfSaleId: string | null | undefined
  subtotalCents: number
}): Promise<FranchiseRoyaltyQuote> {
  if (!isFranchiseRoyaltyEnabled()) return ZERO
  const { pointOfSaleId, subtotalCents } = input
  if (!pointOfSaleId || subtotalCents <= 0) return ZERO

  const pos = await prisma.pointOfSale.findUnique({
    where:  { id: pointOfSaleId },
    select: { franchiseId: true, brand_ref: { select: { royaltyPct: true } } },
  })
  // No POS row, or a POS with no franchisor → not a franchise sale → no royalty.
  if (!pos?.franchiseId) return ZERO

  // B4: per-brand rate (the brand operated at this POS), default 6% when unset →
  // byte-identical to the pre-B4 hardcoded rate. Only the rate's SOURCE changed.
  const rate = resolveFranchiseRate(pos.brand_ref)
  const royaltyCents = Math.round(subtotalCents * rate)
  if (royaltyCents <= 0) return ZERO
  return { royaltyCents, franchisorOperatorId: pos.franchiseId, pointOfSaleId, rate }
}

// recordFranchiseRoyalty — RECONCILE-or-create a single obligation, idempotent on
// orderId (@unique). Keyed on orderId so repeated orders/pay calls accrue EXACTLY one
// row, but it does NOT merely no-op on conflict: orders/pay can cancel a stale
// PaymentIntent and recreate a fresh one with a DIFFERENT held-back (founders-offer
// expiry, Connect status toggle, post-deploy column reads…), and the accrual then
// re-runs. A create-only path would hit @unique → P2002 → leave the row pointing at the
// CANCELLED PI with a stale royalty (a lost update that @unique makes unrepairable). So:
//   1. UPDATE the existing 'pending' row to the latest charge (paymentIntentId + the live
//      held-back amount). A 'settled' row (step B) is NEVER touched — the status filter
//      skips it, so its already-disbursed economics are immutable.
//   2. If no pending row was reconciled, CREATE one. A P2002 here means a row already
//      exists (a concurrent create, or a 'settled' row we must not overwrite) → no-op.
// The caller wraps this so it can NEVER break the payment.
export async function recordFranchiseRoyalty(input: {
  orderId: string
  paymentIntentId: string | null
  franchisorOperatorId: string
  restaurantId: string
  pointOfSaleId: string
  channel: string
  baseRevenueCents: number
  royaltyCents: number
  rate: number
}): Promise<{ ok: boolean; created: boolean }> {
  const reconcile = {
    paymentIntentId:      input.paymentIntentId,
    franchisorOperatorId: input.franchisorOperatorId,
    restaurantId:         input.restaurantId,
    pointOfSaleId:        input.pointOfSaleId,
    channel:              input.channel,
    baseRevenueCents:     input.baseRevenueCents,
    royaltyCents:         input.royaltyCents,
    rate:                 input.rate,
  }
  // Reconcile an existing PENDING row to the live charge (never a 'settled' one).
  const updated = await prisma.franchiseRoyalty.updateMany({
    where: { orderId: input.orderId, status: 'pending' },
    data:  reconcile,
  })
  if (updated.count > 0) return { ok: true, created: false }

  // No pending row to reconcile → create. P2002 = a row already exists (concurrent
  // create won the race, or a 'settled' row we must not overwrite) → idempotent no-op.
  try {
    await prisma.franchiseRoyalty.create({ data: { orderId: input.orderId, status: 'pending', ...reconcile } })
    return { ok: true, created: true }
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'P2002') {
      return { ok: true, created: false }
    }
    throw err
  }
}
