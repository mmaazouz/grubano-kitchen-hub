import { NextResponse } from 'next/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { reconcileClaimEvidence } from '@/lib/claims'
import { recordAdminAudit } from '@/lib/admin-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/claims/[id]/reconcile (T-49, founder decision 2026-09-10) ──────
//
// THE RECOVERY EXIT for a claim whose refund attempt was interrupted before its identity was
// bound, or that is parked in FINANCIAL VERIFICATION.
//
// AUTHORITY, exactly: read Stripe and our own Refund rows, identify which refund belongs to this
// claim, and apply the truth that already exists. It CANNOT create money. There is no engine
// call behind it, no Stripe write, no retry — a blind re-drive could double-refund because the
// engine's cumulative cursor may already have advanced.
//
// Ambiguity is not resolved by the operator pressing a button: if evidence cannot attribute the
// transaction, the claim lands in FINANCIAL VERIFICATION and stays there. That is the founder's
// fail-closed rule, and this route implements it rather than working around it.
//
// NOT gated by CLAIMS_ENABLED. The money question exists whatever the feature flag says, and
// gating the only exit behind the flag is how the dead end was created in the first place.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  // Resolved from the SESSION and re-read from the DB, over the real role set
  // (Operator.role ∪ OperatorRole) — the primary-column check locked out the admins the
  // provisioning script actually creates.
  const operator = await resolveAdmin()
  if (!operator) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const result = await reconcileClaimEvidence({ claimId: params.id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  // Every reconciliation leaves a trail, including the ones that conclude "still unknown".
  try {
    await recordAdminAudit({
      actorId:    operator.id,
      actorEmail: operator.email,
      action:     'claim.reconcile_evidence',
      targetType: 'claim',
      targetId:   params.id,
      metadata:   {
        outcome:    result.outcome,
        moneyMoved: false, // this route never moves money, whatever the outcome
        ...(result.outcome === 'financial_verification' ? { ambiguity: result.reason } : {}),
      },
      req,
    })
  } catch { /* audit is best-effort; it must never undo a completed reconciliation */ }

  return NextResponse.json({ result })
}
