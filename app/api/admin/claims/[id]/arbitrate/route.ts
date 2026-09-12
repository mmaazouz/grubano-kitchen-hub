import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdmin } from '@/lib/admin-guard'
import { isClaimsEnabled, arbitrateClaim } from '@/lib/claims'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit } from '@/lib/admin-audit'
import { sendClaimDecisionEmail, type ClaimEmailResult } from '@/lib/claim-emails'
import { refusalEmailKind, type ClaimFacts } from '@/lib/claim-action-rules'

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

  // ── T43 (vague 3) + ROUND 13 (H03) — the decision e-mail, post-success, best-effort: the decision, the engine and the
  // transition are already played; an e-mail failure changes nothing in the response.
  // Kind by provenance: a refuse_final is « Refus confirmé » (refused_final) only when the restaurant itself refused on
  // record, otherwise refused_by_grubano. 'refunded' is sent only when triggerClaimRefund returned state 'refunded'
  // (engine ok, T3 'ours', T4 CAS count 1), with the ENGINE's amount (never the requested amount). Every other approval —
  // attempt_superseded, identity_unverified, resume_mismatch, 202 pending, every T2 outcome — sends claim_decision_approved,
  // which states only the approval the arbitrate CAS wrote. The lease is read at send time (R-D7): one that closed since
  // the entry gate skips the e-mail as claims_disabled. Idempotent (dedupeKey claim:<id>).
  const c = result.claim as { id: string; consumerId: string; orderId: string }
  const refunded = result.refund?.state === 'refunded'
  let customerEmail: ClaimEmailResult
  try {
    customerEmail = await sendClaimDecisionEmail({
      claimId:       c.id,
      consumerId:    c.consumerId,
      orderId:       c.orderId,
      decision:      parsed.data.decision === 'refuse_final' ? refusalEmailKind(result.claim as ClaimFacts | null) : (refunded ? 'refunded' : 'approved'),
      reason:        parsed.data.reason ?? null,
      refundedCents: refunded && result.refund?.state === 'refunded' ? result.refund.amountCents : null,
      claimsOpen:    isClaimsEnabled(),
    })
  } catch {
    customerEmail = { status: 'failed', why: 'sender_error' }
  }

  return NextResponse.json({ claim: result.claim, refund: result.refund ?? null, customerEmail })
}
