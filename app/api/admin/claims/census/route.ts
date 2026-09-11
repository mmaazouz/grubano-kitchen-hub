import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isInternalCronRequest } from '@/lib/safe-compare'
import { isClaimsEnabled, claimsGateState, FINANCIAL_VERIFICATION, RECONCILE_REQUIRED, TERMINAL_STATUSES } from '@/lib/claims'
import { isRefundsEnabled } from '@/lib/refund'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/admin/claims/census — READ-ONLY COUNTS, internal token ───────────────
//
// The Mode A precheck needs the staging claim population, and the database is not reachable
// from a developer workstation (o2switch MySQL and SSH are both closed to it). Rather than ask
// the founder to run commands, this route exposes the same counts the operator's own read-only
// precheck computes, behind the internal token that the other maintenance routes already use.
//
// COUNTS ONLY. No claim ids, no order ids, no consumer ids, no amounts, no free text — nothing
// that could leak a customer or a case through a CI log. Purely how many rows sit in each state.
//
// NOT gated by CLAIMS_ENABLED: measuring the population is exactly what you need to do while
// the feature is off, and a census that hides itself behind the flag would answer the wrong
// question. It writes nothing.
export async function GET(req: NextRequest) {
  if (!isInternalCronRequest(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }
  try {
    const [total, byStatus, refunding, t49Shape, reconcileMarked, financialVerification, restaurantReview, arbitration, silenceExpired] =
      await Promise.all([
        prisma.claim.count(),
        // ROUND-10 AUDIT FIX (P3): a failed groupBy used to become [] — reported as a MEASURED empty
        // population (active 0, byStatus {}). It is now reported as not measured.
        prisma.claim.groupBy({ by: ['status'], _count: true }).catch(() => null),
        prisma.claim.count({ where: { status: 'refunding' } }),
        // The EXACT T-49 shape: refunding, no binding, no marker. A row of this shape predates
        // the self-labelling CAS, so it is the population that needs manual attention.
        prisma.claim.count({ where: { status: 'refunding', refundId: null, refundError: null } }),
        prisma.claim.count({ where: { refundError: { startsWith: RECONCILE_REQUIRED } } }),
        prisma.claim.count({ where: { status: FINANCIAL_VERIFICATION } }),
        prisma.claim.count({ where: { status: 'restaurant_review' } }),
        prisma.claim.count({ where: { status: 'arbitration' } }),
        prisma.claim.count({ where: { status: 'restaurant_review', responseDeadlineAt: { lte: new Date() } } }),
      ])

    const ACTIVE = ['restaurant_review', 'approved', 'refunding', 'arbitration', FINANCIAL_VERIFICATION]
    const grouped = byStatus as Array<{ status: string; _count: number }> | null
    const counts: Record<string, number> | null = grouped ? Object.fromEntries(grouped.map((g) => [g.status, g._count])) : null
    const active = counts ? ACTIVE.reduce((n, s) => n + (counts[s] ?? 0), 0) : null
    // ROUND-9 AUDIT FIX (P2): `nonTerminal` was `active`, silently dropping 'refused' — which the library
    // treats as NON-terminal (the customer may still contest). It is now total minus the library's own
    // terminal set, the set the rehearsal operator's residue report uses too.
    const terminal = counts ? TERMINAL_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0) : null

    return NextResponse.json({
      measuredAt: new Date().toISOString(),
      claims: {
        total,
        active,
        nonTerminal: terminal === null ? null : total - terminal,
        byStatus: counts,
        byStatusMeasured: counts !== null,
        refunding,
        restaurantReview,
        arbitration,
        silenceExpired,
        financialVerification,
        reconcileMarked,
        /** Pre-T-49 stranded shape: refunding with neither a binding nor a marker. */
        t49Shape,
      },
      gates: {
        claimsEnabled:  isClaimsEnabled(),
        claimsGate:     claimsGateState().open ? 'OPEN' : `CLOSED (${(claimsGateState() as { reason?: string }).reason ?? 'closed'})`,
        refundsEnabled: isRefundsEnabled(),
      },
    })
  } catch (e) {
    console.error('[claims census] failed —', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Census error' }, { status: 500 })
  }
}
