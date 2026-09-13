import { NextResponse } from 'next/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { listFinancialVerificationClaims, listReconcileRequiredClaims, listActionableRefundClaims, listUnfinalizedClaimRefundRows, listRefundedClaimsWithUnprovenRow } from '@/lib/claims'
// ROUND 13 (H10, slice W7): the « Avis client non envoyés » list — read-only, outside lib/claim-emails (H15).
import { listMissingClaimClosureNotices } from '@/lib/claim-closure-lists'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/admin/claims/financial-verification (T-49) ───────────────────────────
//
// The durable queue that makes the founder's fail-closed rule survivable.
//
// Parking a claim because its money truth cannot be proven is only acceptable if somebody can
// SEE it. This route is therefore deliberately NOT gated by CLAIMS_ENABLED: the sibling
// /api/admin/claims returns { enabled: false } when the flag is off, and an unresolved MONEY case
// must not vanish the moment the feature is switched off. /admin/claims keeps the card that reads
// this route mounted with the flag off (round 13 D0, tests/claims-admin-page-fv-mount.test.ts);
// only the arbitration console and GET /api/admin/claims follow the flag.
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

  // ROUND 13 (H10 / I-09, slice W7): the two sections kept out of `total`, read AFTER the money lists and each in its own
  // catch — a failure of one of them never costs the operator the money queue above ({ error: 'unreadable' }, count null).
  const unreadable = { error: 'unreadable' as const }
  const [refundedUnproven, closureNotices] = await Promise.all([
    listRefundedClaimsWithUnprovenRow().catch((e: unknown) => {
      console.error('[claims financial-verification] refundedUnproven NOT READ —', e instanceof Error ? e.message : e)
      return unreadable
    }),
    listMissingClaimClosureNotices().catch((e: unknown) => {
      console.error('[claims financial-verification] closureNotices NOT READ —', e instanceof Error ? e.message : e)
      return unreadable
    }),
  ])
  const countOf = (l: { total: number } | { error: 'unreadable' }) => ('error' in l ? null : l.total)

  return NextResponse.json({
    // Ungated on purpose — see above. `enabled` is reported for the console's information only;
    // it never suppresses the payload.
    financialVerification,
    reconcileRequired,
    otherUnsettled,
    unfinalizedRefundRows,
    refundedUnproven,
    closureNotices,
    counts: {
      financialVerification: financialVerification.length,
      reconcileRequired:     reconcileRequired.length,
      otherUnsettled:        otherUnsettled.length,
      /** Refund ROWS, not claims — kept out of `total`, which counts claims. */
      unfinalizedRefundRows: unfinalizedRefundRows.length,
      /** What an operator badge must show: every claim whose money truth is open. */
      total: financialVerification.length + reconcileRequired.length + otherUnsettled.length,
      /** H10 / E-13: settled claims whose bound row is not established — outside `total`; null when unreadable. */
      refundedUnproven:      countOf(refundedUnproven),
      /** H10 / E-16: closures of this build without a dispatched notice — outside `total`; null when unreadable. */
      closureNoticesMissing: countOf(closureNotices),
    },
  })
}
