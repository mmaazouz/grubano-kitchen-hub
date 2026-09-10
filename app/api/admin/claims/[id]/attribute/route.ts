import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdmin } from '@/lib/admin-guard'
import { attributeClaimRefund } from '@/lib/claims'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/claims/[id]/attribute (T-49 audit fix) ────────────────────────
//
// THE ESCALATION EXIT. The audit proved FINANCIAL VERIFICATION was an absorbing state: once a
// claim was parked because no refund carried its identity, the automatic branches could never
// fire again — nothing can create a row stamped for that claim afterwards, and nothing deletes
// refund rows — so the claim, the order lock and the money-review row were permanent. The
// founder's condition was explicit: fail-closed is acceptable ONLY if a real recovery path
// exists. This is it.
//
// It is NOT the guess the policy forbids. The operator supplies the missing LINK — which existing
// refund of THIS order belongs to this claim — and the system reads that row's own status and
// amount and applies it. The operator states no outcome, states no amount, and moves no money:
// there is no engine call, no Stripe write and no retry behind this route.
//
// A refund from another order is refused outright, so a claim can never be settled by an
// unrelated payment. Every attribution is recorded in the admin audit log.
//
// NOT gated by CLAIMS_ENABLED: the money question outlives the feature flag, and gating the only
// exit behind the flag is how the previous dead end was built.
const schema = z.object({
  refundRowId: z.string().min(1).max(200),
  note:        z.string().max(1000).optional(),
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const operator = await resolveAdmin()
  if (!operator) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

  const result = await attributeClaimRefund({
    claimId:     params.id,
    refundRowId: parsed.data.refundRowId,
    adminId:     operator.id,
    note:        parsed.data.note,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ result })
}
