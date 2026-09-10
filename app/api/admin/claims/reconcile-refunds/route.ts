import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
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
// DELIBERATELY NOT GATED BY CLAIMS_ENABLED: the money already moved (or already failed)
// whatever the feature flag says, and a flag must never block the reconciliation of
// financial truth that already exists. It IS gated by the internal token, exactly like the
// other internal maintenance routes.
//
// It cannot move money: no engine call, no Stripe write, no retry. It only applies the same
// idempotent CAS the webhook applies, bound to the claim's real Refund identity.
export async function POST(req: NextRequest) {
  if (!isInternalCronRequest(req)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  }
  try {
    const summary = await recoverStrandedClaimReconciliations()
    return NextResponse.json({ ok: true, ...summary })
  } catch (e) {
    console.error('[claims reconcile-refunds] recovery failed —', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Recovery error' }, { status: 500 })
  }
}
