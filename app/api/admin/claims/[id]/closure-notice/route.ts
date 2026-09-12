import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdmin } from '@/lib/admin-guard'
import { rateLimit } from '@/lib/rate-limit'
import { isClaimsEnabled, reconcileClaimEvidence } from '@/lib/claims'
import { sendClaimClosureEmail, type ClosureEmailResult, type ClosureEvidence } from '@/lib/claim-emails'
import { claimClosureKind, type ClaimFacts } from '@/lib/claim-action-rules'
import { recordAdminAudit } from '@/lib/admin-audit'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/claims/[id]/closure-notice (ROUND 13, H08 / D10 (iv)) ──────────
//
// THE PER-CLAIM RESEND of a closure notice that was not dispatched. It is the only path for one: no sweep, no cron, no
// webhook or recovery send exists (H09). The body is EMPTY: the notice's content comes from the database and, for a
// refunded claim, from Stripe's own refund object read in this request — never from operator input.
//
// Eligibility is the sender's: THIS build's closure record (H05, AMF-2), never an audit row. A claim that is not a closure
// (its state changed, or REVERTED_AFTER_REFUND) is refused 409 and nothing is sent or audited.
//
// For a refunded claim the Stripe refund is re-read first (reconcileClaimEvidence, R0: read-only at Stripe, no engine, no
// Refund write). The notice goes out only when Stripe reports it SUCCEEDED with an integer amount; a reversal marks the
// claim instead (409, nothing sent).
//
// NOT gated by CLAIMS_ENABLED: the sender enforces R-D7 (skipped as claims_disabled). It never moves money: from lib/claims
// it imports only isClaimsEnabled and reconcileClaimEvidence. IMPLEMENTATION NOTE (W6): step 3 reads the claim through
// prisma (a read only) to decide 404 / kind before any Stripe read.

const NOT_A_CLOSURE = 'Cette réclamation n’appelle pas d’avis de clôture (son état a changé) — rechargez la liste.'
const REVERTED = 'Aucun avis envoyé : Stripe rapporte que le remboursement lié a échoué ou a été annulé. La réclamation vient d’être marquée et apparaît dans « Vérification financière requise ». Quand les réclamations sont ouvertes, le client lit « vérification manuelle » ; sinon il ne voit aucune réclamation.'
const CHANGED = 'La réclamation a changé pendant la lecture : aucun avis envoyé. Rechargez la liste.'
const UNREADABLE = 'La réclamation n’a pas pu être lue : aucun avis envoyé. Réessayez.'

const bodySchema = z.object({}).strict()

export async function POST(req: Request, { params }: { params: { id: string } }) {
  // (1) admin, re-read from the DB over the real role set; then the flag-gated rate limit.
  const operator = await resolveAdmin()
  if (!operator) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  const limited = rateLimit(req, 'admin_claims_closure_notice', { limitDefault: 30, windowDefault: 60 })
  if (limited) return limited

  // (2) an empty body — or `{}` — only. Any field (an amount, a note, an outcome) is refused.
  let raw: unknown = {}
  try {
    const text = await req.text()
    raw = text.trim() === '' ? {} : JSON.parse(text)
  } catch {
    raw = null
  }
  if (!bodySchema.safeParse(raw).success) return NextResponse.json({ error: 'Requête invalide.' }, { status: 400 })

  // (3) the claim and its closure kind.
  let claim: { id: string; status: string; refundError: string | null; arbitrationDecision: string | null; restaurantResponse: string | null } | null
  try {
    claim = await prisma.claim.findUnique({
      where:  { id: params.id },
      select: { id: true, status: true, refundError: true, arbitrationDecision: true, restaurantResponse: true },
    })
  } catch {
    return NextResponse.json({ error: UNREADABLE }, { status: 500 })
  }
  if (!claim) return NextResponse.json({ error: 'Réclamation introuvable.' }, { status: 404 })
  const kind = claimClosureKind(claim as ClaimFacts)
  if (!kind) return NextResponse.json({ error: NOT_A_CLOSURE }, { status: 409 })

  // (4) a refunded claim: Stripe's refund object, read in this request, is the only evidence.
  let evidence: ClosureEvidence | undefined
  if (kind === 'refunded') {
    let ev: Awaited<ReturnType<typeof reconcileClaimEvidence>> | null = null
    try {
      ev = await reconcileClaimEvidence({ claimId: params.id })
    } catch {
      ev = null
    }
    if (ev && ev.ok && ev.outcome === 'reverted_after_refund') {
      // The claim was marked by this request's read (G11): the same trail as the reconcile route's R0 marking.
      try {
        await recordAdminAudit({
          actorId: operator.id, actorEmail: operator.email, action: 'claim.reconcile_evidence', targetType: 'claim', targetId: params.id,
          metadata: { outcome: ev.outcome, moneyMoved: false, via: 'closure_notice' }, req,
        })
      } catch { /* audit is best-effort */ }
      return NextResponse.json({ error: REVERTED }, { status: 409 })
    }
    if (ev && ev.ok && ev.outcome === 'changed_during_read') return NextResponse.json({ error: CHANGED }, { status: 409 })
    if (ev && ev.ok && ev.outcome === 'refund_still_standing' && ev.stripeStatus === 'succeeded'
      && Number.isInteger(ev.amountCents) && ev.amountCents > 0) {
      evidence = { basis: 'stripe_read', amountCents: ev.amountCents }
    }
  }

  // (5) the sender decides the rest (record, gate, row, evidence, recipient). It never throws; the catch is a belt.
  let customerEmail: ClosureEmailResult
  try {
    customerEmail = await sendClaimClosureEmail({ claimId: params.id, evidence, claimsOpen: isClaimsEnabled() })
  } catch {
    customerEmail = { status: 'failed', kind, why: 'sender_error' }
  }

  // (6) the trail.
  try {
    await recordAdminAudit({
      actorId:    operator.id,
      actorEmail: operator.email,
      action:     'claim.closure_notice',
      targetType: 'claim',
      targetId:   params.id,
      metadata:   { status: customerEmail.status, why: customerEmail.why ?? null, kind: customerEmail.kind, moneyMoved: false },
      req,
    })
  } catch { /* audit is best-effort */ }

  // (7)
  return NextResponse.json({ customerEmail })
}
