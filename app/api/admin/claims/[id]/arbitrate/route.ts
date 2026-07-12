import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { isClaimsEnabled, arbitrateClaim } from '@/lib/claims'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit } from '@/lib/admin-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/claims/[id]/arbitrate (P4.5-C2) ───────────────────────────────
// A NEUTRAL Grubano admin (never the resto, never the client) decides a contested
// claim: approve → the SAME idempotent engine refund (≤1 per claim) / refuse_final →
// terminal, no refund. Gated by CLAIMS_ENABLED. ADMIN-ONLY (session role/roles). The
// real refund still moves money only when REFUNDS_ENABLED is ON (else 'approved' pending).
const bodySchema = z.object({
  decision: z.enum(['approve', 'refuse_final']),
  reason:   z.string().max(1000).optional(),
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // Flag-gated rate limit (ADM7; no-op when RATE_LIMIT_ENABLED is off → byte-identical).
  const limited = rateLimit(req, 'admin_claims_arbitrate', { limitDefault: 30, windowDefault: 60 })
  if (limited) return limited

  if (!isClaimsEnabled()) {
    return NextResponse.json({ error: 'Réclamations indisponibles', gated: true }, { status: 403 })
  }
  const session = await getServerSession(authOptions)
  const user = session?.user as { id?: string; role?: string; roles?: string[] } | undefined
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const isAdmin = user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin'))
  if (!isAdmin || !user.id) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

  const result = await arbitrateClaim({
    claimId:  params.id,
    adminId:  user.id,
    decision: parsed.data.decision,
    reason:   parsed.data.reason,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  await recordAdminAudit({
    actorId:    user.id,
    actorEmail: session?.user?.email ?? null,
    action:     'claim.arbitrate',
    targetType: 'claim',
    targetId:   params.id,
    metadata:   { decision: parsed.data.decision, refunded: result.refund != null },
    req,
  })
  return NextResponse.json({ claim: result.claim, refund: result.refund ?? null })
}
