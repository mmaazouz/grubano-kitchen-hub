import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdmin } from '@/lib/admin-guard'
import { resolveStuckClaim } from '@/lib/claims'
import { recordAdminAudit } from '@/lib/admin-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/claims/[id]/resolve-stuck (Claims batch 2) ────────────────────
//
// `resolveStuckClaim` was written in batch 1 but exposed by NO route, so the dead end it
// exists to unblock stayed a dead end: a claim whose refund FAILED (or whose engine resumed
// an older refund) could be resolved by nothing, and it kept `activeOrderKey`, locking the
// customer out of ever re-filing on that order. This is that missing door.
//
// It NEVER moves money: no engine call, no Stripe write, no retry — a blind re-drive could
// double-refund because the engine's cumulative cursor may already have advanced. The admin
// states what is TRUE and the claim closes accordingly:
//   settled_out_of_band → the customer WAS paid another way ⇒ refunded
//   closed_no_payment   → nothing is owed / closed unpaid   ⇒ refused_final
//
// NOT gated by CLAIMS_ENABLED: a stuck refund is stuck whatever the feature flag says, and
// gating the only exit behind the flag is how it stayed unresolvable in the first place.
const schema = z.object({
  resolution: z.enum(['settled_out_of_band', 'closed_no_payment']),
  reason:     z.string().max(1000).optional(),
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // RE-AUDIT FIX (batch 2). This route used to re-read `Operator.role` directly and require it
  // to equal 'admin'. That looked stricter than the other admin routes and was in fact BROKEN:
  // `scripts/server/provision-admin.js` grants admin by INSERTING an OperatorRole row and
  // deliberately never touches `Operator.role`, so the only admin the project's own script
  // creates was refused 403 here — while still being able to approve claims and move real money
  // through /arbitrate. The stuck-money escape hatch was therefore unreachable for the real
  // admin, which is precisely the dead end this route exists to open. `resolveAdmin` keeps the
  // property that mattered (resolved from the SESSION and re-read from the DB, never from a
  // stale JWT claim) and reads the real role SET (Operator.role ∪ OperatorRole).
  const operator = await resolveAdmin()
  if (!operator) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

  const result = await resolveStuckClaim({
    claimId:    params.id,
    adminId:    operator.id,
    resolution: parsed.data.resolution,
    reason:     parsed.data.reason,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  // Closing a money case is an admin decision: it leaves a trail (best-effort, never throws).
  try {
    await recordAdminAudit({
      actorId:    operator.id,
      actorEmail: operator.email,
      action:     'claim.resolve_stuck',
      targetType: 'claim',
      targetId:   params.id,
      // ROUND-10 AUDIT FIX (P3): the operator's note is kept HERE, admin-side; it is no longer written
      // to the claim's arbitrationReason, which the customer's own claim payload carries.
      metadata:   { resolution: parsed.data.resolution, moneyMoved: false, note: parsed.data.reason ?? null },
      req,
    })
  } catch { /* audit is best-effort */ }

  return NextResponse.json({ claim: result.claim })
}
