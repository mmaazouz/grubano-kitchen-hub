import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveAdmin } from '@/lib/admin-guard'
import { recoverStrandedClaimReconciliations } from '@/lib/claims'
import { isInternalCronRequest } from '@/lib/safe-compare'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/claims/reconcile-refunds (Claims batch 2) ─────────────────────
//
// RECOVERY for a Refund → Claim reconciliation that never happened because its Stripe
// webhook was delayed, rejected or lost. Stripe does not guarantee delivery, so without
// this a claim could stay in `refunding` for ever while its Refund row is long terminal.
//
// ROUND 13 (AMF-1, slice W5): the same run then re-verifies, READ-ONLY toward Stripe, the claims settled in the last
// 35 days (at most 100 per run) and marks — claim only — a settled claim whose refund Stripe now reports failed or
// canceled. The summary carries the counts under `settledReverify`.
//
// DELIBERATELY NOT GATED BY CLAIMS_ENABLED: the money already moved (or already failed)
// whatever the feature flag says, and a flag must never block the reconciliation of
// financial truth that already exists. It is gated by the internal token (the daily cron) OR an admin session
// (resolveAdmin): on staging, which has no cron, the operator's action is the trigger.
//
// It cannot move money: no engine call, no Stripe write, no Refund row write, no customer e-mail.
export async function POST(req: NextRequest) {
  let actor: { id: string; email: string | null } | undefined
  if (!isInternalCronRequest(req)) {
    // AMF-1 (f): no session → 401; a session that is not an admin → 403.
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    const operator = await resolveAdmin()
    if (!operator) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    actor = { id: operator.id, email: operator.email }
  }
  try {
    const summary = await recoverStrandedClaimReconciliations(200, { actor })
    return NextResponse.json({ ok: true, ...summary })
  } catch (e) {
    console.error('[claims reconcile-refunds] recovery failed —', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Recovery error' }, { status: 500 })
  }
}
