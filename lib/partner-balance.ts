import { prisma } from '@/lib/prisma'

// ── Partner balance (rail financier P4.2, Agent 38) — READ-ONLY aggregation ───
//
// computePartnerBalance(role, refId) reads the EXISTING earnings sources (never
// modifies them) + the Payout table, and returns a cent-exact balance:
//   earnedCents    = lifetime earnings recorded for this partner (role-specific)
//   paidCents      = Σ Payout rows status='paid' for this partner (EMPTY in P4.2)
//   availableCents = max(0, earned − paid)   (clamped ≥ 0, never negative)
//
// NO money movement, NO write — pure read. Money routing/transfer = P4.3.
//
// Per-role semantics (caveats are deliberate; P4.3 refines them):
//   • creator    — Σ creatorEarning of ReferralOrder + DishSale rows that have
//                  MATURED (status ∈ {matured, paid}); pending gains are excluded
//                  until the maturation cron promotes them. creatorEarning is a
//                  euro Float → rounded to cents PER ROW (no float accumulation).
//   • supplier   — Σ SupplyOrder.supplierPayoutCents of PAID supply orders
//                  (already integer cents).
//   • restaurant — Σ LedgerEntry.netToRestaurant (integer cents; refund lines are
//                  negative, so the sum is the cumulative net). NOTE: lines with
//                  routed=true were settled to the resto directly by Stripe; this
//                  P4.2 layer reports the gross recorded net — the routed-vs-
//                  platform split that determines what Grubano still OWES is a
//                  P4.3 concern.
//
//   • logistics  — Σ CourierEarning.netCents of rows that have MATURED (status ∈
//                  {matured, paid}); pending gains are excluded until the maturation
//                  pass promotes them (lib/courier-earnings). Native integer cents (NO
//                  Float). Anti-double-pay is the SAME as creator/affiliate: available
//                  nets the Σ Payout(role='logistics') sum via the shared payoutPaidCents
//                  path — the row's 'paid' status is a later reporting nicety, never the
//                  balance's guard. Empty table (P4.3 ÉTAPE 2) → 0.
//
// FRANCHISE is intentionally NOT supported here (flagged): the franchise royalty is
// computed inline inside GET /api/franchise/my-dashboard (not a reusable source — and it
// must stay byte-identical, so it cannot be extracted or duplicated), and it represents a
// royalty owed BY the franchise (revenue × rate), not an amount paid TO it. Its payable
// balance is defined by lib/franchise-settlement (a separate engine).

export type PartnerBalanceRole = 'creator' | 'supplier' | 'restaurant' | 'affiliate' | 'logistics'

export interface PartnerBalance {
  role:           PartnerBalanceRole
  refId:          string
  earnedCents:    number
  paidCents:      number
  availableCents: number
  currency:       string
}

const CURRENCY = 'eur'

/** Euro Float → integer cents (per-row rounding keeps the sum cent-exact). */
function eurosToCents(eur: number): number {
  return Math.round(eur * 100)
}

async function creatorEarnedCents(creatorId: string): Promise<number> {
  const matured = { in: ['matured', 'paid'] }
  const [refs, dishes] = await Promise.all([
    prisma.referralOrder.findMany({
      where:  { status: matured, referral: { creatorId } },
      select: { creatorEarning: true },
    }),
    prisma.dishSale.findMany({
      where:  { status: matured, adoption: { creatorDish: { creatorId } } },
      select: { creatorEarning: true },
    }),
  ])
  let cents = 0
  for (const r of refs)   cents += eurosToCents(r.creatorEarning)
  for (const d of dishes) cents += eurosToCents(d.creatorEarning)
  return cents
}

async function supplierEarnedCents(supplierProfileId: string): Promise<number> {
  const orders = await prisma.supplyOrder.findMany({
    where:  { supplierProfileId, paymentStatus: 'paid' },
    select: { supplierPayoutCents: true },
  })
  return orders.reduce((sum, o) => sum + o.supplierPayoutCents, 0)
}

async function restaurantEarnedCents(restaurantId: string): Promise<number> {
  const lines = await prisma.ledgerEntry.findMany({
    where:  { restaurantId },
    select: { netToRestaurant: true },
  })
  return lines.reduce((sum, l) => sum + l.netToRestaurant, 0)
}

// ── Affiliate (Brique B, Agent 59) — Σ matured ReferralOrder.creatorEarning ────────
// A top-level affiliate's earnings are the matured ReferralOrders attributed to them.
// `refId` is the affiliate's OPERATOR id (Affiliate is 1:1 with Operator) =
// ReferralOrder.affiliateId. creatorEarning (a euro Float) holds the earning for EITHER
// rail — the affiliate rows are the ones tagged with affiliateId. READ-ONLY; per-row
// rounding keeps the sum cent-exact, exactly like the creator path.
async function affiliateEarnedCents(operatorId: string): Promise<number> {
  const rows = await prisma.referralOrder.findMany({
    where:  { status: { in: ['matured', 'paid'] }, affiliateId: operatorId },
    select: { creatorEarning: true },
  })
  return rows.reduce((sum, r) => sum + eurosToCents(r.creatorEarning), 0)
}

// ── Logistics (P4.3 ÉTAPE 2) — Σ matured CourierEarning.netCents for this courier ──────
// The courier's owed amount = the NET (gross − Grubano commission) of the MATURED earnings
// (status ∈ {matured, paid}, matching the creator's set). `refId` is the courier's
// LogisticsProfile id (owner scope). Already integer cents → NO rounding, NO Float. Empty
// table returns 0. READ-ONLY, exactly like every other earned-fn here.
async function logisticsEarnedCents(logisticsProfileId: string): Promise<number> {
  const rows = await prisma.courierEarning.findMany({
    where:  { courierId: logisticsProfileId, status: { in: ['matured', 'paid'] } },
    select: { netCents: true },
  })
  return rows.reduce((sum, r) => sum + r.netCents, 0)
}

async function payoutPaidCents(role: PartnerBalanceRole, refId: string): Promise<number> {
  // Build the where field-by-field (TS-safe) — exactly one ref column per role.
  const where: {
    role: string; status: string
    creatorId?: string; supplierProfileId?: string; restaurantId?: string; operatorId?: string
    logisticsProfileId?: string
  } = { role, status: 'paid' }
  if (role === 'creator')          where.creatorId = refId
  else if (role === 'supplier')    where.supplierProfileId = refId
  else if (role === 'affiliate')   where.operatorId = refId   // Brique B — Payout.operatorId, role='affiliate' (Brique D writes these)
  else if (role === 'logistics')   where.logisticsProfileId = refId // P4.3 ÉTAPE 2 — Payout.logisticsProfileId, role='logistics'
  else                             where.restaurantId = refId

  const payouts = await prisma.payout.findMany({ where, select: { amountCents: true } })
  return payouts.reduce((sum, p) => sum + p.amountCents, 0)
}

/**
 * Read the partner's balance. READ-ONLY (no write, no money movement). `refId` is
 * the partner entity id resolved by the caller from the SESSION (never a client
 * id). Returns integer-cent amounts; availableCents is clamped at 0.
 */
export async function computePartnerBalance(
  role: PartnerBalanceRole,
  refId: string,
): Promise<PartnerBalance> {
  let earnedCents = 0
  if (role === 'creator')        earnedCents = await creatorEarnedCents(refId)
  else if (role === 'supplier')  earnedCents = await supplierEarnedCents(refId)
  else if (role === 'affiliate') earnedCents = await affiliateEarnedCents(refId)
  else if (role === 'logistics') earnedCents = await logisticsEarnedCents(refId)
  else                           earnedCents = await restaurantEarnedCents(refId)

  const paidCents      = await payoutPaidCents(role, refId)
  const availableCents = Math.max(0, earnedCents - paidCents)

  return { role, refId, earnedCents, paidCents, availableCents, currency: CURRENCY }
}
