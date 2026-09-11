import { NextResponse } from 'next/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { listFinancialVerificationClaims, listReconcileRequiredClaims, listActionableRefundClaims, listUnfinalizedClaimRefundRows } from '@/lib/claims'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/admin/claims/financial-verification (T-49) ───────────────────────────
//
// The durable queue that makes the founder's fail-closed rule survivable.
//
// Parking a claim because its money truth cannot be proven is only acceptable if somebody can
// SEE it. This route is therefore deliberately NOT gated by CLAIMS_ENABLED: the sibling
// /api/admin/claims returns { enabled: false } and /admin/claims redirects away when the flag is
// off, which would make an unresolved MONEY case vanish the moment the feature was switched off.
// The money question does not care about the feature flag.
//
// Read-only. It states no conclusion about whether cash moved — that is exactly what is
// unresolved — and it never offers an action that would move money.
export async function GET() {
  const operator = await resolveAdmin()
  if (!operator) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  // AUDIT FIX (T-49 audit, convergent finding). Returning only the parked and marked claims left
  // a hole exactly where the reconciler is most useful: its own SUCCESS outcomes move a claim out
  // of both lists — a still-pending refund, for instance, lands back in 'refunding' with the
  // marker cleared — and `/api/admin/claims` is gated, so with CLAIMS_ENABLED off the case became
  // invisible again. The same hole swallowed the LEGACY stranded rows that predate the marker.
  // The ungated queue therefore carries EVERY claim whose money is unsettled.
  const [financialVerification, reconcileRequired, actionableRefunds, unfinalizedRefundRows] = await Promise.all([
    listFinancialVerificationClaims(),
    listReconcileRequiredClaims(),
    listActionableRefundClaims(),
    // ROUND-10 AUDIT FIX (P2): pending Refund rows whose claim has moved on — ungated, read-only.
    listUnfinalizedClaimRefundRows(),
  ])
  // A claim can legitimately appear in more than one list; the operator should see it once.
  const markedIds = new Set([...financialVerification, ...reconcileRequired].map((c) => c.id))
  const otherUnsettled = actionableRefunds.filter((c) => !markedIds.has(c.id))

  return NextResponse.json({
    // Ungated on purpose — see above. `enabled` is reported for the console's information only;
    // it never suppresses the payload.
    financialVerification,
    reconcileRequired,
    otherUnsettled,
    unfinalizedRefundRows,
    counts: {
      financialVerification: financialVerification.length,
      reconcileRequired:     reconcileRequired.length,
      otherUnsettled:        otherUnsettled.length,
      /** Refund ROWS, not claims — kept out of `total`, which counts claims. */
      unfinalizedRefundRows: unfinalizedRefundRows.length,
      /** What an operator badge must show: every claim whose money truth is open. */
      total: financialVerification.length + reconcileRequired.length + otherUnsettled.length,
    },
  })
}
