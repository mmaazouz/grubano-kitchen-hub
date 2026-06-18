import { NextResponse } from 'next/server'
import { gateFranchise } from '@/lib/franchise-pos'
import { isFranchiseRoyaltyEnabled } from '@/lib/franchise-royalty'
import { getFranchiseEarnings, getFranchisePayouts } from '@/lib/franchise-earnings'

export const dynamic = 'force-dynamic'

// ── GET /api/franchise/finances — the SESSION franchisor's earnings + settlements ────
//
// READ-ONLY (B6, Agent 47). Returns the authoritative royalty totals (accrued / settled /
// pending, from FranchiseRoyalty) and the settlement history (Payout role='franchise'),
// for the signed-in franchisor ONLY. Owner-scoped via gateFranchise(): the operator id
// comes from the SESSION (never a client value → no IDOR) and the 'franchise' role is
// required (401 without a session, 403 without the role). No write, no settlement/transfer
// is ever triggered here — settlements run admin/cron (Franchise-B). `royaltyEnabled`
// surfaces the server-side held-back gate so the UI can label the figures honestly.
//
// Amounts are integer CENTS (the native unit of royaltyCents / Payout.amountCents); the
// page formats them to euros.

export async function GET() {
  const gate = await gateFranchise()
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? 'Non autorisé' : 'Accès refusé' },
      { status: gate.status },
    )
  }

  const [earnings, payouts] = await Promise.all([
    getFranchiseEarnings(gate.operatorId),
    getFranchisePayouts(gate.operatorId),
  ])

  return NextResponse.json({
    royaltyEnabled: isFranchiseRoyaltyEnabled(),
    accruedCents:   earnings.accruedCents,
    settledCents:   earnings.settledCents,
    pendingCents:   earnings.pendingCents,
    payouts,
  })
}
