import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { isClaimsEnabled, respondToClaim } from '@/lib/claims'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/claims/[id]/respond (P4.5-C1 · P0-24) ───────────────────────────────
// The owning restaurant accepts or refuses a claim. Gated by CLAIMS_ENABLED.
// Owner-scoped via the establishment scope → a claim on another operator's order is
// INVISIBLE (404, not 403 — no IDOR/enumeration).
// P0-24 (Q3 volet 2) : ACCEPT ne déclenche PLUS aucun remboursement — il route la
// réclamation vers la FILE ADMIN ('arbitration') où seul un admin Grubano décide et
// déclenche (POST /api/admin/claims/[id]/arbitrate). `refund` est donc toujours null
// sur un accept. REFUSE → terminal 'refused' + motive (contest = C2).
const bodySchema = z.object({
  action: z.enum(['accept', 'refuse']),
  reason: z.string().max(1000).optional(),
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!isClaimsEnabled()) {
    return NextResponse.json({ error: 'Réclamations indisponibles', gated: true }, { status: 403 })
  }
  const scope = await resolveEstablishmentScope(null)
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

  const result = await respondToClaim({
    claimId:       params.id,
    restaurantIds: scope.ownedIds,
    action:        parsed.data.action,
    reason:        parsed.data.reason,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  return NextResponse.json({
    claim:  result.claim,
    refund: result.refund ?? null,
  })
}
