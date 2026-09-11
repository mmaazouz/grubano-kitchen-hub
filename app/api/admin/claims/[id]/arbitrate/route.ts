import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdmin } from '@/lib/admin-guard'
import { isClaimsEnabled, arbitrateClaim } from '@/lib/claims'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit } from '@/lib/admin-audit'
import { sendClaimDecisionEmail } from '@/lib/claim-emails'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/claims/[id]/arbitrate (P4.5-C2) ───────────────────────────────
// A NEUTRAL Grubano admin (never the resto, never the client) decides a contested
// claim: approve → the SAME idempotent engine refund (≤1 per claim) / refuse_final →
// terminal, no refund. Gated by CLAIMS_ENABLED. ADMIN-ONLY (resolveAdmin: role set re-read from the DB). The
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
  // ROUND-8 AUDIT FIX (P2): approve can move money, and it was authorised from sign-in JWT claims
  // (never refreshed, NextAuth's 30-day default) — an operator whose admin OperatorRole row is
  // removed kept approve power for up to a month. Every other admin claims route re-reads the role
  // set from the DB; this one now does too.
  const operator = await resolveAdmin()
  if (!operator) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

  const result = await arbitrateClaim({
    claimId:  params.id,
    adminId:  operator.id,
    decision: parsed.data.decision,
    reason:   parsed.data.reason,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  await recordAdminAudit({
    actorId:    operator.id,
    actorEmail: operator.email ?? null,
    action:     'claim.arbitrate',
    targetType: 'claim',
    targetId:   params.id,
    metadata:   { decision: parsed.data.decision, refunded: result.refund != null },
    req,
  })

  // ── T43 (vague 3) — notification de DÉCISION au client, STRICTEMENT ADDITIVE,
  // post-succès, BEST-EFFORT (même position que recordAdminAudit ci-dessus : la
  // décision, le moteur et la transition sont déjà JOUÉS et INTOUCHÉS — un échec
  // d'email ne change rien à la réponse). L'email dit PAR QUI (Grubano) et CE QUI
  // a été décidé : remboursement ÉMIS (refund.state 'refunded', montant), accepté
  // sans émission encore (pending/failed — aucune promesse de délai), ou refus
  // DÉFINITIF. Idempotent (trigger dédié par décision, dedupeKey claim:<id>).
  {
    const c = result.claim as { id: string; consumerId: string; orderId: string; requestedAmountCents: number }
    const refunded = result.refund?.state === 'refunded'
    // Email truthfulness hotfix (2026-09-06): the amount shown is the ENGINE's actual succeeded
    // cash refund (result.refund.amountCents), never the claim's REQUESTED amount.
    const refundedCents = result.refund?.state === 'refunded' ? result.refund.amountCents : null
    await sendClaimDecisionEmail({
      claimId:       c.id,
      consumerId:    c.consumerId,
      orderId:       c.orderId,
      decision:      parsed.data.decision === 'refuse_final' ? 'refused_final' : (refunded ? 'refunded' : 'approved'),
      reason:        parsed.data.reason ?? null,
      refundedCents,
    })
  }

  return NextResponse.json({ claim: result.claim, refund: result.refund ?? null })
}
