import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdmin } from '@/lib/admin-guard'
import { arbitrateClaim } from '@/lib/claims'
import { claimsSurfaceOpen, claimNoticeGate } from '@/lib/claim-flags'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit } from '@/lib/admin-audit'
import { sendClaimDecisionEmail, type ClaimEmailResult } from '@/lib/claim-emails'
import { refusalEmailKind, type ClaimFacts } from '@/lib/claim-action-rules'
// D′ L4 (S-27): the approved amount lives in a column added by the D′ migration. If the running
// process cannot use it, this route refuses — it never falls back on the requested amount.
import { schemaReady } from '@/lib/schema-ready'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/claims/[id]/arbitrate (P4.5-C2 · D′ L2) ───────────────────────
// A NEUTRAL Grubano admin (never the resto, never the client) decides a contested claim:
// approve → the BUSINESS DECISION only (APPROVED_AWAITING_PAYMENT — spec v2 T-07/T-08, S-02):
// this route NEVER calls the refund engine, whatever the REFUNDS lease says; the financial rail
// (POST /api/admin/claims/pay-approved, admin session, REFUNDS lease) pays later. refuse_final →
// terminal, no refund. Gated by CLAIMS_ENABLED. ADMIN-ONLY (resolveAdmin: role set re-read from the DB).
// D′ L4 (T-07): an approval carries the AMOUNT, an explicit confirmation, and a motive when reduced.
// The body is parsed, never trusted: lib/claims validates every one of them against the claim itself.
const bodySchema = z.object({
  decision:            z.enum(['approve', 'refuse_final']),
  reason:              z.string().max(1000).optional(),
  approvedAmountCents: z.number().int().optional(),
  confirm:             z.string().max(32).optional(),
  reduceReason:        z.string().max(1000).optional(),
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // Flag-gated rate limit (ADM7; no-op when RATE_LIMIT_ENABLED is off → byte-identical).
  const limited = rateLimit(req, 'admin_claims_arbitrate', { limitDefault: 30, windowDefault: 60 })
  if (limited) return limited

  if (!claimsSurfaceOpen()) { // D′ L1: SURFACE (a decision never needs the intake)
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

  // D′ L4 (S-27) — the schema probe gates the WHOLE route, not just the approval. An approval writes
  // approvedAmountCents, and the honest answer when the column is unusable is « not right now », never an
  // approval with no amount attached. A refusal writes none of the new columns — but arbitrateClaim reads
  // them: its single findUnique SELECTS approvedAmountCents before either branch, and a client that does
  // not know the column REJECTS that query. Gating only the approval would have left a refusal to crash
  // with a 500 instead of answering « not right now ». One probe, one honest answer, for both decisions.
  const schema = await schemaReady()
  if (!schema.ready) {
    return NextResponse.json({
      error: 'Décision indisponible : le schéma des réclamations n’est pas prêt sur ce serveur. Rien n’a été écrit.',
      reason: 'schema_not_ready', schemaReady: false,
    }, { status: 503 })
  }

  const result = await arbitrateClaim({
    claimId:             params.id,
    adminId:             operator.id,
    decision:            parsed.data.decision,
    reason:              parsed.data.reason,
    approvedAmountCents: parsed.data.approvedAmountCents,
    confirm:             parsed.data.confirm,
    reduceReason:        parsed.data.reduceReason,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  // D′ L4: what the CAS actually wrote — the audit, the e-mail and the response all read THIS, never the body.
  const decided = result.claim as { approvedAmountCents?: number | null; arbitratedAt?: Date | null } | null
  await recordAdminAudit({
    actorId:    operator.id,
    actorEmail: operator.email ?? null,
    action:     'claim.arbitrate',
    targetType: 'claim',
    targetId:   params.id,
    // D′ L2: the audit states the truth — an arbitration never moves money (S-02).
    // D′ L4: and it records WHAT was decided — the approved amount, and the motive of a reduction.
    metadata:   {
      decision: parsed.data.decision, moneyMoved: false,
      ...(parsed.data.decision === 'approve'
        ? { approvedAmountCents: decided?.approvedAmountCents ?? null, reduceReason: parsed.data.reduceReason ?? null }
        : {}),
    },
    req,
  })

  // ── T43 (vague 3) + ROUND 13 (H03) + D′ L2 — the decision e-mail, post-success, best-effort: the decision and the
  // transition are already played; an e-mail failure changes nothing in the response.
  // Kind by provenance: a refuse_final is « Refus confirmé » (refused_final) only when the restaurant itself refused on
  // record, otherwise refused_by_grubano. An approve ALWAYS sends claim_decision_approved (the decision the CAS wrote,
  // no amount, no promise): 'refunded' is never sent from here any more — it belongs to the financial rail, on the
  // ENGINE's amount (D′ L5). The lease is read at send time (R-D7): one that closed since the entry gate skips the
  // e-mail as claims_disabled.
  // D′ L4 (D-11, §6.4): an approval names the APPROVED amount, RE-READ FROM THE ROW the CAS wrote — never the
  // number the body sent, never the requested amount. The dedupe key carries that decision's own instant, so a
  // claim approved, withdrawn and re-approved sends a second, different notice instead of being swallowed.
  const c = result.claim as { id: string; consumerId: string; orderId: string }
  let customerEmail: ClaimEmailResult
  try {
    customerEmail = await sendClaimDecisionEmail({
      claimId:       c.id,
      consumerId:    c.consumerId,
      orderId:       c.orderId,
      decision:      parsed.data.decision === 'refuse_final' ? refusalEmailKind(result.claim as ClaimFacts | null) : 'approved',
      reason:        parsed.data.reason ?? null,
      refundedCents: null,
      approvedCents: decided?.approvedAmountCents ?? null,
      decisionStamp: decided?.arbitratedAt ?? null,
      claimsOpen:    claimNoticeGate('pre_money'), // D′ L1 (FIN-EMAIL-01): the decision notice is pre-money
    })
  } catch {
    customerEmail = { status: 'failed', why: 'sender_error' }
  }

  // D′ L2: no refund field — this route moves no money and reports none (S-02). The console's approve toast is the
  // nominal approvedNotSent (F13 v1.1).
  return NextResponse.json({ claim: result.claim, customerEmail })
}
