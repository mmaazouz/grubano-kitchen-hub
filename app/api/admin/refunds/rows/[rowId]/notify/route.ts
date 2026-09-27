import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveAdmin } from '@/lib/admin-guard'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit } from '@/lib/admin-audit'
import { sendAdminMoneyReviewAlert } from '@/lib/admin-alerts'
import { sendRefundConfirmation } from '@/lib/transactional-emails'
import { getStripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { resolveSupportNoticeTarget, REFUND_CONFIRMATION_TRIGGER } from '@/lib/support-refund-notices'

// ── POST /api/admin/refunds/rows/[rowId]/notify — D′ L9 / E3 ═══════════════════════════════════════════
//
// WHAT IT IS FOR. A support refund that Stripe settled ASYNCHRONOUSLY reached the customer's bank with no
// `refund_confirmation` ever dispatched: the rail answered 202 truthfully (at that instant the money had not
// moved) and the webhook that finalised it sends nothing, because H15 forbids any e-mail from a webhook and
// that ban is load-bearing. This route is the human-triggered repair. It is the ONLY sender for that gap.
//
// WHY IT IS NOT GATED (spec v2 §6.3, founder §23, S-25). Every other claims surface is behind
// CLAIMS_SURFACE_ENABLED. This one is not, and the reason is not convenience: THE MONEY HAS ALREADY LEFT. A
// kill-switch exists to stop the product from doing new things, not to stop it from telling the truth about
// something irreversible that already happened. Suppressing this notice would leave a customer refunded and
// uninformed — the precise defect the lot closes. Pre-money notices stay surface-gated; this is post-money.
//
// WHY IT RE-READS STRIPE, always (founder §20). Our `Refund` row is a record of what we asked for and of
// what we last observed. It is not proof that the money is still gone: a refund can be reverted at Stripe
// after settling, and `status` in our base would not know. Announcing a refund on the strength of a DB row
// alone is exactly how a customer is told twice about money they received once — or once about money they
// never received. So the amount in the e-mail is the amount STRIPE returns in this request, never ours, and
// a disagreement is reported rather than averaged.
//
// WHAT IT NEVER DOES. No Stripe WRITE — `refunds.retrieve` only, never create/update/cancel. No `Refund` row
// write. No Claim write. No ledger line. It imports `lib/stripe` for the read and `lib/transactional-emails`
// for the send, and it deliberately does NOT import `lib/refund` (the engine) or `lib/claim-emails` (the
// claim senders, whose importer list is pinned to ten routes and whose resto sender needs a claim id a
// support row cannot have — see the lot report for that unresolved half of §6.3).

export const dynamic = 'force-dynamic'

/** An empty, strict body: this route takes its whole input from the URL. */
const bodySchema = z.object({}).strict()

type Guarded = { ok: true; actorId: string } | { ok: false; res: NextResponse }

async function guard(req: NextRequest): Promise<Guarded> {
  // Rate limit FIRST, so an unauthenticated flood cannot cost a session lookup per request.
  const limited = rateLimit(req, 'admin_refund_notify', { limitDefault: 30, windowDefault: 60 })
  if (limited) return { ok: false, res: limited }
  const admin = await resolveAdmin()
  if (!admin) return { ok: false, res: NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) }
  return { ok: true, actorId: admin.id }
}

/**
 * GET — the read-only preview. Proves eligibility and writes nothing, so an admin can see WHY a row is or is
 * not notifiable before pressing anything. Does not call Stripe: the preview must stay cheap, and the
 * Stripe truth is what POST exists to establish.
 */
export async function GET(req: NextRequest, { params }: { params: { rowId: string } }) {
  const g = await guard(req)
  if (!g.ok) return g.res
  const resolved = await resolveSupportNoticeTarget(params.rowId)
  if (!resolved.ok) return NextResponse.json({ eligible: false, reason: resolved.refusal })
  const t = resolved.target
  // The preview names the ORDER and the AMOUNT, never the Stripe id and never the recipient's address.
  return NextResponse.json({
    eligible: true, orderRef: t.orderRef, amountCents: t.rowAmountCents,
    partial: t.partial, restaurantName: t.restaurantName,
  })
}

export async function POST(req: NextRequest, { params }: { params: { rowId: string } }) {
  const g = await guard(req)
  if (!g.ok) return g.res
  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return NextResponse.json({ error: 'Corps invalide.' }, { status: 400 })

    // ── (1) OUR OWN CONDITIONS, re-read in this request ──────────────────────────────────────────────
    const resolved = await resolveSupportNoticeTarget(params.rowId)
    if (!resolved.ok) {
      // `claim_bound` and `already_sent` are 409 by name (§19): they are not errors, they are the system
      // refusing to duplicate a notice. The others are 409 too — nothing here is retryable by the caller.
      return NextResponse.json({ error: resolved.refusal, notified: false }, { status: 409 })
    }
    const t = resolved.target

    // ── (2) STRIPE, READ ONLY (§20) ─────────────────────────────────────────────────────────────────
    let stripeStatus: string | null = null
    let stripeAmount: number | null = null
    try {
      const refund = await getStripe().refunds.retrieve(t.stripeRefundId)
      stripeStatus = typeof refund?.status === 'string' ? refund.status : null
      stripeAmount = typeof refund?.amount === 'number' ? refund.amount : null
    } catch (e) {
      // Unreadable is NOT « reverted »: we learn nothing, so we say nothing and nothing is written.
      console.error('[admin/refunds/notify] Stripe unreadable — no e-mail sent:', t.rowId, e instanceof Error ? e.message : e)
      return NextResponse.json({ error: 'stripe_unreadable', notified: false }, { status: 502 })
    }

    // A refund that is no longer succeeded, or whose amount is not a positive integer, is not something a
    // customer may be told about. 0 mail, 409, and a human alert — a row our base calls settled while Stripe
    // does not is a money fact nobody may leave silent.
    if (stripeStatus !== 'succeeded' || !Number.isInteger(stripeAmount) || (stripeAmount as number) <= 0) {
      try {
        await sendAdminMoneyReviewAlert({
          kind: 'support_row_reverted',
          // Keyed on the REFUND, so a second attempt on the same row does not raise a second alert while a
          // different reverted row still does.
          dedupeKey: `refund:${t.stripeRefundId}`,
          title: 'Remboursement support : notre base dit réussi, Stripe dit le contraire',
          facts: {
            orderRef:     t.orderRef,
            rowId:        t.rowId,
            baseStatus:   'succeeded',
            stripeStatus: stripeStatus ?? 'unreadable',
            stripeAmount: stripeAmount ?? 'unknown',
            baseAmount:   t.rowAmountCents,
            customerNotified: false,
            moneyMoved:   false,
          },
        })
      } catch { /* the alert is a trace; its failure must not turn a refusal into a 500 */ }
      return NextResponse.json({ error: 'support_row_reverted', notified: false, stripeStatus }, { status: 409 })
    }

    // ── (3) THE SEND — with STRIPE's amount, not ours ────────────────────────────────────────────────
    // A disagreement between the two is worth a trace even though Stripe wins: it means our row drifted.
    if (stripeAmount !== t.rowAmountCents) {
      console.error(`[MONEY REVIEW] [refund_amount_drift] row ${t.rowId}: base ${t.rowAmountCents}c, Stripe ${stripeAmount}c — the e-mail states Stripe's figure`)
    }
    const sent = await sendRefundConfirmation({
      dedupeKey:      t.dedupeKey,           // refund:<re_> — the refund IS the identity of its notice (T-47)
      to:             t.recipient,
      customerName:   t.customerName,
      restaurantName: t.restaurantName,
      refundedCents:  stripeAmount as number,
      partial:        t.partial,
    })

    // ── (3b) DID THE DEDUPE MARKER ACTUALLY LAND? ───────────────────────────────────────────────────
    //
    // `sendTransactional` claims its `EmailDispatch` row BEFORE sending and, on any error that is not a
    // uniqueness violation — a missing or unmigrated table, P2021 — it logs and sends ANYWAY rather than
    // swallow the mail. For the money rail that degradation is the right trade: a one-shot side effect of an
    // operation nobody replays by hand. HERE IT IS NOT. This route's eligibility is DEFINED as « no dispatch
    // row exists for this refund », so a send whose marker never landed leaves the row back in the « avis non
    // envoyés » list, inviting an admin to press again — and §22 allows at most one notice per refund. A
    // guard that fails open cannot enforce at-most-once, so the route checks instead of assuming, and says so.
    let deduped = true
    if (sent.status === 'sent') {
      try {
        deduped = (await prisma.emailDispatch.count({
          where: { trigger: REFUND_CONFIRMATION_TRIGGER, dedupeKey: t.dedupeKey },
        })) > 0
      } catch { deduped = false }
      if (!deduped) {
        // The customer HAS been told. What is missing is the record that says so, so the danger is a SECOND
        // notice, and the only honest thing is to name it loudly and tell the caller not to retry.
        console.error(`[MONEY REVIEW] [refund_notice_not_deduplicated] row ${t.rowId}: the customer was notified but no EmailDispatch(${REFUND_CONFIRMATION_TRIGGER}, ${t.dedupeKey}) exists — do NOT resend`)
        try {
          await sendAdminMoneyReviewAlert({
            kind: 'support_row_reverted',
            dedupeKey: `refund:${t.stripeRefundId}:nodedupe`,
            title: 'Avis client envoyé SANS marqueur d’idempotence',
            facts: {
              orderRef: t.orderRef, rowId: t.rowId, customerNotified: true,
              dedupeRowWritten: false, risk: 'un second avis est possible si la ligne est renvoyée',
              moneyMoved: false,
            },
          })
        } catch { /* the alert is a trace; its failure must not change what the caller is told */ }
      }
    }

    // ── (4) THE TRACE, after the act, each in its own try/catch ──────────────────────────────────────
    try {
      await recordAdminAudit({
        actorId: g.actorId,
        action:  'refund.support_notice',
        targetType: 'refund',
        targetId: t.rowId,
        // No recipient address, no Stripe id: an audit row is read by more people than the money rail.
        metadata: { orderRef: t.orderRef, amountCents: stripeAmount, emailStatus: sent.status, moneyMoved: false },
      })
    } catch (e) {
      console.error('[admin/refunds/notify] audit write failed (the e-mail was already sent):', t.rowId, e instanceof Error ? e.message : e)
    }

    return NextResponse.json({ notified: sent.status === 'sent', status: sent.status, amountCents: stripeAmount, deduped })
  } catch (e) {
    console.error('[POST /api/admin/refunds/rows/[rowId]/notify]', e)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
