import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdmin } from '@/lib/admin-guard'
import { withdrawClaimApproval } from '@/lib/claims'
import { claimsSurfaceOpen, claimNoticeGate } from '@/lib/claim-flags'
import { rateLimit } from '@/lib/rate-limit'
import { sendClaimDecisionEmail, type ClaimEmailResult } from '@/lib/claim-emails'
import { schemaReady } from '@/lib/schema-ready'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/claims/[id]/withdraw-approval (D′ L4 · spec v2 T-09, §4) ──────────────────
//
// Reverse an approval BEFORE any money moved: APPROVED_AWAITING_PAYMENT → 'arbitration', decision and
// amount back to null. This is the only legitimate way to change an amount already fixed — a second
// approval is refused (409 APPROVE_ALREADY_SET), because rewriting a decided amount in place would
// leave no trace of what was decided first.
//
// WHAT THIS ROUTE NEVER DOES: move money, call the engine, read Stripe, write 'refused_final'. A
// withdrawal is not a refusal — the claim goes back to the admin queue and a human decides again.
//
// THE REFUSALS ARE THE POINT (lib/claims.withdrawClaimApproval):
//   • no admin audit (ADMIN_AUDIT_ENABLED) → 409 audit_disabled, and NOTHING is read or written (S-30);
//   • a real attempt, a recorded money state, or a Refund row carrying this claim's stamp → 409;
//   • those rows unreadable → 409 too: not knowing is not permission;
//   • the CAS pins the whole pre-image, so a rail attempt racing this call means exactly one winner (S-09);
//   • the audit row is written in the SAME transaction: if it fails, the reversal is rolled back.
//
// There is NO time limit (founder decision D-5).
const bodySchema = z.object({
  reason:  z.string().min(1).max(1000),
  confirm: z.string().max(32).optional(),
})

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // Flag-gated rate limit (spec §4: admin_claims_withdraw 10/60; no-op when RATE_LIMIT_ENABLED is off).
  const limited = rateLimit(req, 'admin_claims_withdraw', { limitDefault: 10, windowDefault: 60 })
  if (limited) return limited

  if (!claimsSurfaceOpen()) { // D′ L1: SURFACE (reversing a decision never needs the intake)
    return NextResponse.json({ error: 'Réclamations indisponibles', gated: true }, { status: 403 })
  }
  const operator = await resolveAdmin()
  if (!operator) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

  // D′ L4 (S-27): the withdrawal WRITES approvedAmountCents back to null. A process that cannot use
  // the column must not pretend to have reversed anything.
  const schema = await schemaReady()
  if (!schema.ready) {
    return NextResponse.json({
      error: 'Retrait indisponible : le schéma des réclamations n’est pas prêt sur ce serveur. Rien n’a été écrit.',
      reason: 'schema_not_ready', schemaReady: false,
    }, { status: 503 })
  }

  const result = await withdrawClaimApproval({
    claimId:    params.id,
    adminId:    operator.id,
    adminEmail: operator.email ?? null,
    reason:     parsed.data.reason,
    confirm:    parsed.data.confirm,
    ip:         req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  })
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.reason ? { reason: result.reason } : {}) },
      { status: result.status },
    )
  }
  // The audit row is already written — inside the transaction, not after it (S-30).

  // The customer is told the truth: the decision was withdrawn BEFORE any payment, the claim is being
  // looked at again. Post-success and best-effort: the reversal is already recorded, an e-mail failure
  // changes nothing. Pre-money notice (FIN-EMAIL-01), stamped with the instant of the decision it
  // reverses so a re-decided claim is never deduped against this one.
  const c = result.claim as { id: string; consumerId: string; orderId: string }
  let customerEmail: ClaimEmailResult
  try {
    customerEmail = await sendClaimDecisionEmail({
      claimId:       c.id,
      consumerId:    c.consumerId,
      orderId:       c.orderId,
      decision:      'approval_withdrawn',
      reason:        null, // the admin's motive is audit material, never customer-facing copy
      refundedCents: null,
      decisionStamp: result.previous.arbitratedAt,
      claimsOpen:    claimNoticeGate('pre_money'),
    })
  } catch {
    customerEmail = { status: 'failed', why: 'sender_error' }
  }

  // No refund field, no amount: this route moves no money and reports none.
  return NextResponse.json({ claim: result.claim, customerEmail, moneyMoved: false })
}
