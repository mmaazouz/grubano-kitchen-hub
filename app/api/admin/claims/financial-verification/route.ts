import { NextResponse } from 'next/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { listFinancialVerificationClaims, listReconcileRequiredClaims } from '@/lib/claims'

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

  const [financialVerification, reconcileRequired] = await Promise.all([
    listFinancialVerificationClaims(),
    listReconcileRequiredClaims(),
  ])

  return NextResponse.json({
    // Ungated on purpose — see above. `enabled` is reported for the console's information only;
    // it never suppresses the payload.
    financialVerification,
    reconcileRequired,
    counts: {
      financialVerification: financialVerification.length,
      reconcileRequired:     reconcileRequired.length,
      /** What an operator badge must show: every claim whose money truth is open. */
      total: financialVerification.length + reconcileRequired.length,
    },
  })
}
