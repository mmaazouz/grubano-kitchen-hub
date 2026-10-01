import { prisma } from '@/lib/prisma'

// ── Franchise royalty EARNINGS — authoritative read-only aggregation (B6, Agent 47) ──
//
// The franchisor dashboard + the Finances page must show the REAL held-back amounts,
// read from the source-of-truth tables, NOT the live `revenue × rate` projection:
//   • FranchiseRoyalty (the accrued obligations, Franchise-A) — owner-scoped by
//     `franchisorOperatorId`. Status: pending → settling → settled.
//   • Payout role='franchise' (the executed settlements, Franchise-B) — owner-scoped
//     by `operatorId`.
//
// READ-ONLY. This module never writes a row, never triggers a settlement/transfer, and
// never touches the accrual/settlement/payment logic. A single shared helper feeds BOTH
// my-dashboard and the Finances endpoint so the two surfaces can never diverge (same
// spirit as resolveFranchiseRate in B4). All amounts are integer CENTS (the native unit
// of royaltyCents / Payout.amountCents); consumers format to euros.

export type FranchiseEarnings = {
  /** Σ royaltyCents over ALL statuses — everything ever held back for this franchisor. */
  accruedCents: number
  /** Σ royaltyCents of 'settled' lines — confirmed disbursed to the franchisor. */
  settledCents: number
  /** Σ royaltyCents of 'pending' + 'settling' — owed, not yet disbursed.
   *  ('settling' is a claimed-but-in-flight batch → still owed, not yet confirmed paid.)
   *  By construction pendingCents = accruedCents − settledCents. */
  pendingCents: number
}

/**
 * Authoritative royalty totals for ONE franchisor (ALL-TIME), read from FranchiseRoyalty.
 * Owner-scoped by `franchisorOperatorId` — the caller MUST pass the SESSION operator id,
 * never a client-supplied value. Read-only (a single groupBy).
 */
export async function getFranchiseEarnings(franchisorOperatorId: string): Promise<FranchiseEarnings> {
  const groups = await prisma.franchiseRoyalty.groupBy({
    by:    ['status'],
    where: { franchisorOperatorId },
    _sum:  { royaltyCents: true },
  })
  let accruedCents = 0
  let settledCents = 0
  let pendingCents = 0
  for (const g of groups) {
    const cents = g._sum.royaltyCents ?? 0
    accruedCents += cents
    if (g.status === 'settled') settledCents += cents
    else pendingCents += cents // 'pending' | 'settling' → still owed
  }
  return { accruedCents, settledCents, pendingCents }
}

export type FranchisePayoutRow = {
  id:               string
  amountCents:      number
  currency:         string
  status:           string
  paidAt:           Date | null
  stripeTransferId: string | null
  createdAt:        Date
}

/**
 * The franchisor's settlement history — Payout rows (role='franchise'), newest first.
 * Owner-scoped by `operatorId` (the SESSION operator). Read-only.
 */
export async function getFranchisePayouts(operatorId: string): Promise<FranchisePayoutRow[]> {
  return prisma.payout.findMany({
    where:   { role: 'franchise', operatorId },
    orderBy: { createdAt: 'desc' },
    select:  { id: true, amountCents: true, currency: true, status: true, paidAt: true, stripeTransferId: true, createdAt: true },
  })
}
