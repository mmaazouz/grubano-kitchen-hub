import { NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdmin } from '@/lib/admin-guard'
import { rateLimit } from '@/lib/rate-limit'
import { reconcileClaimEvidence, readClaimFinancialEffect } from '@/lib/claims'
import { claimNoticeGate } from '@/lib/claim-flags'
import { sendClaimClosureEmail, sendRestaurantRefundedEmail, type ClaimEmailResult, type ClosureEmailResult, type ClosureEvidence } from '@/lib/claim-emails'
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
    // D′ L1 (FIN-EMAIL-01, S-25): an explicit closure is always sendable, whatever the feature flags say.
    customerEmail = await sendClaimClosureEmail({ claimId: params.id, evidence, claimsOpen: claimNoticeGate('closure') })
  } catch {
    customerEmail = { status: 'failed', kind, why: 'sender_error' }
  }

  // ── (5b) D′ L8 (T-46, resto notice (3)) — THE RESTAURANT'S POST-MONEY NOTICE ─────────────────────
  //
  // WHY HERE AND NOT IN THE RAIL OR THE WEBHOOK. The webhook may send nothing (H15 — it is ingestion and
  // reconciliation, and the pins forbid it reaching a sender module at all). The L5 rail is frozen by this
  // lot's own instruction. This route is the support mechanism the spec designates (§6.3): admin-guarded,
  // idempotent, and it has ALREADY re-read the Stripe refund object read-only, in this request, which is
  // exactly the re-check §13 requires before a post-money notice.
  //
  // THREE CONDITIONS, ALL NECESSARY. The claim must be a `refunded` closure; Stripe must have answered
  // SUCCEEDED in this request (`evidence`, never a Refund row's own status); and the ledger must be able to
  // STATE the figures. The third is the one that is easy to skip: §16 says a settled refund whose ledger
  // line is missing gets NO financial e-mail, because the alternative is inventing the numbers from a
  // prediction. When that happens the skip is traced with `ledger_incomplete` and the claim keeps showing up
  // in the admin's « avis non envoyés » list — silence here is visible, not lost.
  let restaurantEmail: ClaimEmailResult | null = null
  if (kind === 'refunded' && evidence) {
    try {
      const fin = await readClaimFinancialEffect(params.id)
      if (fin.claim && fin.stripeRefundId) {
        restaurantEmail = await sendRestaurantRefundedEmail({
          claimId:        params.id,
          restaurantId:   fin.claim.restaurantId,
          orderId:        fin.claim.orderId,
          stripeRefundId: fin.stripeRefundId,
          effect:         fin.effect,
          // D′ L1 (FIN-EMAIL-01, S-25) + §11: an explicit closure is always sendable. A Claims kill-switch
          // never hides money that has already moved.
          claimsOpen:     claimNoticeGate('closure'),
        })
      } else if (!fin.claim) {
        // The claim could not be read at all — that is not « the ledger is incomplete », and saying so
        // would send an admin looking for an accounting line that may exist.
        restaurantEmail = { status: 'failed', why: 'claim_not_found' }
      } else {
        // No `re_…` on the bound row (or no binding): Stripe's own identifier is missing, so the ledger
        // line cannot even be looked up. Named as the missing STRIPE confirmation, not as a ledger gap.
        restaurantEmail = { status: 'skipped', why: 'stripe_not_confirmed' }
      }
    } catch {
      restaurantEmail = { status: 'failed', why: 'sender_error' }
    }
  }

  // (6) the trail.
  try {
    await recordAdminAudit({
      actorId:    operator.id,
      actorEmail: operator.email,
      action:     'claim.closure_notice',
      targetType: 'claim',
      targetId:   params.id,
      metadata:   {
        status: customerEmail.status, why: customerEmail.why ?? null, kind: customerEmail.kind, moneyMoved: false,
        // D′ L8: the restaurant notice's own outcome, so « was the restaurant told? » is answerable from
        // the trail and not only from the e-mail tables.
        restaurantStatus: restaurantEmail?.status ?? null, restaurantWhy: restaurantEmail?.why ?? null,
      },
      req,
    })
  } catch { /* audit is best-effort */ }

  // (7)
  return NextResponse.json({ customerEmail, restaurantEmail })
}
