import { NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getStripe, mapAccountStatus, retrieveChargeFacts, type DepositStatus } from '@/lib/stripe'
import { releaseHold } from '@/lib/deposit'
import { recordLedgerEntry, type LedgerEntryInput } from '@/lib/ledger'
import { reconcileLoyaltyOnRefund } from '@/lib/loyalty-refund-apply'
import { isChargebacksEnabled, handleDisputeEvent } from '@/lib/dispute'
import { isGhostOrderAutoRefundEnabled, executeRefund } from '@/lib/refund'
import { clawbackCourierTip } from '@/lib/courier-accrual'
import { sendAdminGhostOrderAlert, sendAdminStalePiAlert } from '@/lib/admin-alerts'

// ── POST /api/webhooks/stripe ─────────────────────────────────────────────────
// Stripe pushes PaymentIntent lifecycle events here so payment state is synced
// RELIABLY in the DB. Two distinct flows share this endpoint, told apart by the
// PaymentIntent metadata:
//
//   • RESERVATION EMPREINTE (manual-capture hold) — metadata.reservationId, NO
//     ticketId. Maps amount_capturable_updated→authorized, canceled→released,
//     succeeded→captured. (Removes the root cause of the "Mourad" bug where
//     depositStatus stayed 'none' after the card was confirmed.)
//   • BILL PAYMENT (automatic-capture real charge, Brique 2) — metadata.ticketId.
//     On succeeded → mark the TableTicket paid AND auto-release the linked
//     reservation's empreinte (Mohammed's rule: never charge the meal AND keep
//     the guarantee held).
//
// PREMIUM-TABLE CYCLE (étape 2): the empreinte now stays ACTIVE from arrival
// until the bill is paid — PATCH status='arrived' no longer releases it. The
// release below (bill paid → releaseHold) is therefore the SOLE normal release
// moment. On an unpaid walk-out the operator settles the hold explicitly at
// POST /api/tickets/[id]/close (capture or release).
//
// SECURITY: a webhook MUST be public (Stripe calls it with no session). Trust comes
// from VERIFYING THE SIGNATURE, not from auth. /api/* is excluded from the
// middleware matcher, so this route is public by default. Node runtime + RAW body
// are REQUIRED for signature verification (never JSON-parse before constructEvent).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Terminal deposit states: once a hold is settled (captured, or released with
// nothing charged), a late/duplicated event must NEVER regress it to 'authorized'.
const TERMINAL = new Set<DepositStatus>(['captured', 'released'])

// Empreinte (manual-capture) PaymentIntent events → coarse depositStatus.
const EVENT_TO_STATUS: Record<string, DepositStatus> = {
  'payment_intent.amount_capturable_updated': 'authorized', // card authorised (hold is live)
  'payment_intent.canceled':                  'released',    // hold cancelled — nothing charged
  'payment_intent.succeeded':                 'captured',    // captured (no-show penalty taken)
}

export async function POST(req: Request) {
  // 1) RAW body + signature header — both mandatory for constructEvent. Read the
  //    untouched text; do NOT req.json() first or the signature won't match.
  const rawBody   = await req.text()
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 })
  }

  // Two signing secrets may be in play: the original endpoint ("Your account" —
  // PI events) and the Connect endpoint ("Connected accounts" — account.updated),
  // each with its OWN whsec in the Stripe dashboard. Verification tries each
  // configured secret; one match is enough (A1).
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET]
    .filter((s): s is string => !!s)
  if (secrets.length === 0) {
    console.error('[stripe webhook] STRIPE_WEBHOOK_SECRET missing')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  // 2) Verify the signature — proves the call really came from Stripe. Tampered /
  //    forged payloads match no secret → 400 (rejected).
  let event: Stripe.Event | null = null
  for (const secret of secrets) {
    try {
      event = getStripe().webhooks.constructEvent(rawBody, signature, secret)
      break
    } catch {
      // try the next configured secret
    }
  }
  if (!event) {
    console.error('[stripe webhook] signature verification failed (no configured secret matched)')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // 3-pre) CONNECT branch — account.updated carries a Stripe Account (not a PI):
  //        sync the establishment's onboarding status (rail financier A1).
  if (event.type === 'account.updated') {
    return handleAccountUpdated(event.data.object as Stripe.Account)
  }

  // 3-refund) REFUND branch (rail A5) — charge.refunded carries a Charge. One
  //        compensating NEGATIVE ledger line per refund (append-only: nothing
  //        is ever modified). Chosen over refund.updated because: (a) it fires
  //        exactly when money actually went back; (b) the Charge payload carries
  //        the full context the line needs (PI id, application fee, transfer
  //        data, metadata) in one object; (c) iterating the charge's refunds
  //        list + per-refund unique keys makes every event self-healing for any
  //        previously missed refund — refund.updated only fires on UPDATES (an
  //        immediately-succeeded card refund may never emit one) and its Refund
  //        payload lacks the charge context.
  if (event.type === 'charge.refunded') {
    return handleChargeRefunded(event.data.object as Stripe.Charge)
  }

  // 3-dispute) CHARGEBACK / DISPUTE branch (rail P4.5-B, Agent 51) — charge.dispute.*
  //        carries a Dispute (not a PI). GATED by CHARGEBACKS_ENABLED: OFF → the event
  //        is ACKNOWLEDGED without any processing — byte-identical IN BEHAVIOUR to today,
  //        where a dispute event already falls through to the EVENT_TO_STATUS lookup and
  //        returns {received:true, ignored}. This branch is ADDITIVE: it matches ONLY
  //        charge.dispute.* (which no existing handler touches), so EVERY other event
  //        takes the exact same path as before. ON → record the dispute lifecycle and,
  //        on a LOST dispute, UNWIND the sale (reverse the resto's net + clawback the
  //        franchise royalty, NO refund_application_fee — see lib/dispute).
  if (event.type.startsWith('charge.dispute.')) {
    if (!isChargebacksEnabled()) {
      return NextResponse.json({ received: true, ignored: event.type, gated: true })
    }
    try {
      const result = await handleDisputeEvent(event)
      return NextResponse.json({ received: true, ...result })
    } catch (err) {
      console.error('[stripe webhook] dispute handler error:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'Handler error' }, { status: 500 })
    }
  }

  const pi = event.data.object as Stripe.PaymentIntent

  // 3-ledger) LEDGER (rail A3) — every succeeded PI is money that ACTUALLY moved:
  //     write the immutable line FIRST, before ANY application logic, so the
  //     ledger records the fact even when downstream treats it as partial /
  //     stale / unknown. Best-effort traced: a ledger failure NEVER blocks the
  //     payment processing below (the webhook still answers 200).
  if (event.type === 'payment_intent.succeeded') {
    await recordSucceededPaymentLedger(pi)
  }

  // 3a) BILL PAYMENT branch — a succeeded PI carrying a ticketId is a real bill
  //     charge (NOT an empreinte). Checked FIRST so it never falls into the
  //     deposit mapping below (a bill PI may also carry reservationId).
  if (event.type === 'payment_intent.succeeded' && pi.metadata?.ticketId) {
    return handleTicketPaid(pi)
  }

  // 3a-bis) CHECKOUT ORDER branch (C1) — a succeeded PI carrying an orderId is a
  //     pickup/delivery order charge: confirm the order paid (at-cent guard).
  if (event.type === 'payment_intent.succeeded' && pi.metadata?.orderId) {
    return handleOrderPaid(pi)
  }

  // 3b) EMPREINTE branch — only the three deposit-lifecycle events are actioned;
  //     anything else is acknowledged with 200 so Stripe stops retrying.
  const target = EVENT_TO_STATUS[event.type]
  if (!target) {
    return NextResponse.json({ received: true, ignored: event.type })
  }

  // ── M6-03 / M1-01 — CROSS-TALK GUARD ─────────────────────────────────────────
  // Un PI d'ADDITION (tickets/pay) porte AUSSI metadata.reservationId quand le
  // ticket est lié à une résa — et /pay l'ANNULE en cancel+recreate. Sans ce
  // filtre, son payment_intent.canceled tombait ici et basculait depositStatus
  // en 'released' alors que le VRAI hold restait requires_capture : état menteur
  // + toutes les libérations légitimes sautées ensuite (gardes !=='released').
  // Un PI d'addition/commande ne pilote JAMAIS le cycle empreinte.
  if (pi.metadata?.ticketId || pi.metadata?.orderId) {
    return NextResponse.json({ received: true, ignored: 'bill_or_order_pi' })
  }

  const reservationId = pi.metadata?.reservationId || null

  try {
    // Find the reservation by the reliable metadata id (set at hold creation by
    // /api/reservations/[id]/deposit), falling back to the stored PaymentIntent id.
    const reservation = reservationId
      ? await prisma.reservation.findUnique({
          where:  { id: reservationId },
          select: { id: true, depositStatus: true, stripePaymentIntentId: true },
        })
      : await prisma.reservation.findFirst({
          where:  { stripePaymentIntentId: pi.id },
          select: { id: true, depositStatus: true, stripePaymentIntentId: true },
        })

    // Out-of-scope PaymentIntent (no matching reservation) → 200 + log. NEVER
    // fail the webhook for a PI we don't own.
    if (!reservation) {
      console.warn(`[stripe webhook] ${event.type} for ${pi.id} — no matching reservation (reservationId=${reservationId ?? 'none'})`)
      return NextResponse.json({ received: true, matched: false })
    }

    // ── Garde stale-PI (symétrique aux branches ticket/order) ────────────────
    // Un PI d'empreinte ORPHELIN (prédécesseur d'un cancel+recreate) ne doit pas
    // écraser l'état du hold COURANT de la réservation.
    if (reservation.stripePaymentIntentId && reservation.stripePaymentIntentId !== pi.id) {
      console.warn(`[stripe webhook] ${event.type}: stale deposit PI ${pi.id} for reservation ${reservation.id} (current ${reservation.stripePaymentIntentId}) — skipped`)
      return NextResponse.json({ received: true, skipped: 'stale_deposit_pi' })
    }

    const current = reservation.depositStatus as DepositStatus

    // Idempotence + ordering guards (replayed / late events).
    if (current === target) {
      return NextResponse.json({ received: true, status: current, noop: true })
    }
    if (target === 'authorized' && TERMINAL.has(current)) {
      return NextResponse.json({ received: true, status: current, skipped: 'already_settled' })
    }
    if (TERMINAL.has(target) && TERMINAL.has(current)) {
      console.warn(`[stripe webhook] ${event.type}: refusing ${current}→${target} on reservation ${reservation.id}`)
      return NextResponse.json({ received: true, status: current, skipped: 'terminal_conflict' })
    }

    // Apply. 'captured' also sets depositPaid (a real charge happened). Backfill
    // stripePaymentIntentId if the row never stored it.
    const data: Prisma.ReservationUpdateInput = { depositStatus: target }
    if (target === 'captured')              data.depositPaid = true
    if (!reservation.stripePaymentIntentId) data.stripePaymentIntentId = pi.id

    await prisma.reservation.update({ where: { id: reservation.id }, data })

    return NextResponse.json({ received: true, status: target })
  } catch (err) {
    console.error('[stripe webhook] handler error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }
}

// ── Bill paid → mark ticket paid + auto-release the reservation empreinte ──────
async function handleTicketPaid(pi: Stripe.PaymentIntent) {
  const ticketId = pi.metadata?.ticketId
  if (!ticketId) return NextResponse.json({ received: true }) // defensive (checked by caller)

  try {
    const ticket = await prisma.tableTicket.findUnique({
      where:  { id: ticketId },
      select: {
        id: true, status: true, reservationId: true,
        subtotal: true, amountPaid: true, stripePaymentIntentId: true,
      },
    })
    if (!ticket) {
      console.warn(`[stripe webhook] bill paid for ${pi.id} — ticket ${ticketId} not found`)
      return NextResponse.json({ received: true, matched: false })
    }

    // 1) Account the payment — AT-CENT GUARD (money safety net). The bill is a
    //    live document: a PI can succeed for LESS than the current subtotal (it
    //    was created before more lines landed). NEVER mark such a ticket fully
    //    paid in silence: record what was really collected, keep the ticket OPEN
    //    (the remainder stays due and /pay charges it), and log loudly. The
    //    empreinte release + reservation completion below are reserved for FULL
    //    payment. All maths in integer cents.
    if (ticket.status !== 'paid') {
      // Anti-replay / stale-PI guard: only the CURRENT PI (the one /pay last
      // persisted) is accounted. A replayed success from an older, superseded PI
      // must not double-count — surface it for manual review instead.
      if (ticket.stripePaymentIntentId && ticket.stripePaymentIntentId !== pi.id) {
        console.error(`[stripe webhook] MONEY REVIEW: succeeded PI ${pi.id} is not ticket ${ticket.id}'s current PI (${ticket.stripePaymentIntentId}) — NOT accounted`)
        // M2-03/M6-01 — argent réel capturé sur un PI périmé : alerte admin
        // idempotente (best-effort) au lieu d'un simple console.error.
        await sendAdminStalePiAlert({ kind: 'ticket', entityId: ticket.id, paymentIntentId: pi.id, currentPiId: ticket.stripePaymentIntentId, amountCents: pi.amount_received ?? pi.amount ?? 0 })
        return NextResponse.json({ received: true, accounted: false, reason: 'stale_pi' })
      }

      const receivedCents = pi.amount_received ?? pi.amount ?? 0
      const subtotalCents = Math.round(ticket.subtotal * 100)
      // G1: the bill TOTAL the customer owes = food subtotal + the dine-in service
      // that was CHARGED. The charged service is the immutable amount /pay stamped
      // on the PI (dinein_service_cents) — NOT a re-read of the rate (which may
      // have changed) — so the at-cent guard compares collected against the TRUE
      // bill total. Absent metadata (flag off / no service / pre-G1 PIs) → 0 →
      // billTotalCents === subtotalCents → byte-identical to pre-G1.
      const serviceCents   = Number(pi.metadata?.dinein_service_cents ?? 0) || 0
      const billTotalCents = subtotalCents + Math.max(0, serviceCents)
      const totalCents     = Math.round((ticket.amountPaid ?? 0) * 100) + receivedCents

      if (totalCents < billTotalCents) {
        // PARTIAL PAYMENT — the safety net fires. Ticket stays OPEN with the
        // collected amount recorded; /pay now computes the remainder from
        // (subtotal + service) − amountPaid, so the rest stays collectable.
        await prisma.tableTicket.update({
          where: { id: ticket.id },
          data:  { amountPaid: totalCents / 100, stripePaymentIntentId: pi.id },
        })
        console.error(`[stripe webhook] MONEY PARTIAL: ticket ${ticket.id} collected ${totalCents}c of ${billTotalCents}c — kept OPEN, ${billTotalCents - totalCents}c still due (PI ${pi.id})`)
        return NextResponse.json({
          received: true, ticket: 'partial',
          collected: totalCents, due: billTotalCents - totalCents,
        })
      }

      if (totalCents > billTotalCents) {
        // Over-collection (e.g. a line was cancelled after the PI synced) — the
        // bill IS settled; surface the excess for a manual gesture/refund.
        console.warn(`[stripe webhook] MONEY OVERPAID: ticket ${ticket.id} collected ${totalCents}c for ${billTotalCents}c (PI ${pi.id})`)
      }

      await prisma.tableTicket.update({
        where: { id: ticket.id },
        data:  {
          status:                'paid',
          paidAt:                new Date(),
          amountPaid:            totalCents / 100,
          stripePaymentIntentId: pi.id,
        },
      })
    }

    // 2) CRITICAL (Mohammed): paying the bill AUTO-releases the reservation's
    //    guarantee empreinte. The empreinte PI (manual capture) is
    //    reservation.stripePaymentIntentId — DISTINCT from this bill PI (pi.id).
    //    releaseHold reads the live empreinte PI and cancels it (nothing charged).
    //    Idempotent: skip when already released/captured (don't regress).
    let depositReleased: string | null = null
    if (ticket.reservationId) {
      const reservation = await prisma.reservation.findUnique({
        where:  { id: ticket.reservationId },
        select: { id: true, depositStatus: true, stripePaymentIntentId: true },
      })
      if (
        reservation?.stripePaymentIntentId &&
        reservation.depositStatus !== 'released' &&
        reservation.depositStatus !== 'captured'
      ) {
        const settle = await releaseHold(reservation.stripePaymentIntentId)
        if (settle.ok) {
          await prisma.reservation.update({
            where: { id: reservation.id },
            data:  { depositStatus: settle.depositStatus ?? 'released' },
          })
          depositReleased = settle.depositStatus ?? 'released'
        } else {
          // e.g. already captured (shouldn't happen if they paid) — log, never fail.
          console.warn(`[stripe webhook] ticket ${ticket.id}: empreinte release skipped (${settle.status}: ${settle.error})`)
        }
      }
    }

    // 3) Terminal reservation transition (fix "session collée"): once the bill is
    //    paid the table session is OVER, so move the reservation arrived→completed
    //    — otherwise it stays 'arrived' forever and keeps resurfacing as the
    //    consumer's "current session" (GET /api/eat/my-session). updateMany with a
    //    status:'arrived' guard is atomic + idempotent: it NEVER overwrites
    //    noshow/cancelled/confirmed, and a replayed event matches 0 rows.
    //    Best-effort: a failure here must never fail the webhook.
    if (ticket.reservationId) {
      try {
        await prisma.reservation.updateMany({
          where: { id: ticket.reservationId, status: 'arrived' },
          data:  { status: 'completed' },
        })
      } catch (e) {
        console.error('[stripe webhook] reservation complete failed', e instanceof Error ? e.message : e)
      }
    }

    return NextResponse.json({ received: true, ticket: 'paid', depositReleased })
  } catch (err) {
    console.error('[stripe webhook] bill paid handler error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }
}

// ── Checkout order paid (C1) — confirm the order, at-cent guard ────────────────
// A pickup/delivery order's amount is FIXED at creation (not a live document), so
// a mismatch is near-impossible — the guard is the money safety net all the same:
// an under-collection NEVER silently confirms the order. The ledger line (with
// channel) was already written by the ledger-first writer above; here we only
// flip the order's payment state. The kitchen state machine (status) is untouched.
async function handleOrderPaid(pi: Stripe.PaymentIntent) {
  const orderId = pi.metadata?.orderId
  if (!orderId) return NextResponse.json({ received: true }) // defensive (checked by caller)

  try {
    const order = await prisma.order.findUnique({
      where:  { id: orderId },
      select: { id: true, status: true, total: true, paymentStatus: true, stripePaymentIntentId: true },
    })
    if (!order) {
      console.warn(`[stripe webhook] order paid for ${pi.id} — order ${orderId} not found`)
      return NextResponse.json({ received: true, matched: false })
    }
    if (order.paymentStatus === 'paid') {
      // M2-04 — HEAL-ON-REPLAY : un crash entre paymentStatus='paid' et le
      // reveal laissait la commande payée mais JAMAIS révélée (awaiting_payment,
      // invisible du resto) — le retry Stripe prenait cette sortie noop AVANT le
      // reveal. On rejoue l'updateMany de reveal (idempotent par construction :
      // 0 ligne touchée sur une commande déjà révélée) avant de répondre noop.
      const healed = await prisma.order.updateMany({
        where: { id: order.id, status: 'awaiting_payment' },
        data:  { status: 'received' },
      })
      if (healed.count > 0) console.warn(`[stripe webhook] heal-on-replay: order ${order.id} revealed on retry (was paid+awaiting_payment)`)
      return NextResponse.json({ received: true, noop: true, ...(healed.count > 0 ? { healed: true } : {}) }) // replay — idempotent
    }

    // Anti-replay / stale-PI guard: only the CURRENT PI confirms the order.
    if (order.stripePaymentIntentId && order.stripePaymentIntentId !== pi.id) {
      console.error(`[stripe webhook] MONEY REVIEW: succeeded PI ${pi.id} is not order ${order.id}'s current PI (${order.stripePaymentIntentId}) — NOT confirmed`)
      // M2-03/M6-01 — argent réel capturé sur un PI périmé : alerte admin
      // idempotente (best-effort) — le client a pu payer DEUX fois.
      await sendAdminStalePiAlert({ kind: 'order', entityId: order.id, paymentIntentId: pi.id, currentPiId: order.stripePaymentIntentId, amountCents: pi.amount_received ?? pi.amount ?? 0 })
      return NextResponse.json({ received: true, accounted: false, reason: 'stale_pi' })
    }

    // ── WP-MONEY-01 — ghost-order expiry race ──────────────────────────────────
    // A card order lazily expired (>24h) BEFORE its payment_intent.succeeded landed.
    // The money WAS captured; the immutable 'payment' ledger line is already written
    // (ledger-first, above). We must NOT silently mark it paid-and-dead. Mark the
    // order EXPLICITLY via a paymentStatus SENTINEL — NO migration (paymentStatus is a
    // free String; a future admin reconciliation queue [WP-ADMIN-RECON] filters on it):
    //   'reconcile_manual' = captured, awaiting a manual admin decision;
    //   'refunded'         = auto-refunded via the royalty-aware engine.
    // The kitchen status STAYS 'expired' (never revealed to the resto).
    // P0-04 (vague 1) : l'auto-refund est gouverné par GHOST_ORDER_AUTO_REFUND_ENABLED
    // (défaut OFF, SÉPARÉ de REFUNDS_ENABLED qui ne gouverne plus que l'outil admin) —
    // « aucune automatisation à impact financier sans validation humaine ». OFF → the
    // money stays captured but flagged for manual reconciliation (NEVER a silent
    // money-out); the admin then decides via /api/admin/refunds/run.
    if (order.status === 'expired') {
      // (1) Idempotence — a replayed webhook after we already reconciled is a no-op.
      if (order.paymentStatus === 'refunded' || order.paymentStatus === 'reconcile_manual') {
        return NextResponse.json({ received: true, noop: true, order: order.paymentStatus })
      }
      const capturedCents = pi.amount_received ?? pi.amount ?? 0
      const refundsOn = isGhostOrderAutoRefundEnabled()
      // Admin alert (both cases) — best-effort, idempotent (never blocks).
      try {
        await sendAdminGhostOrderAlert({ orderId: order.id, paymentIntentId: pi.id, amountCents: capturedCents, refundsOn })
      } catch (e) {
        console.error('[stripe webhook] ghost-order admin alert failed (non-fatal):', order.id, e instanceof Error ? e.message : e)
      }

      if (refundsOn) {
        // executeRefund requires paymentStatus 'paid' (the money truth — the charge
        // succeeded). Set it, then auto-refund via the royalty-aware engine.
        await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'paid', stripePaymentIntentId: pi.id } })
        // (2) Any throw / non-ok outcome → mark 'reconcile_manual' (manual queue).
        // NEVER leave an expired order at a final 'paid'.
        let refunded = false
        try {
          const res = await executeRefund({ orderId: order.id, reason: 'ghost_order_expired' })
          refunded = res.ok
          if (!res.ok) {
            console.error(`[stripe webhook] MONEY REVIEW: ghost-order auto-refund not ok for ${order.id}: ${res.error}`)
          }
        } catch (e) {
          console.error('[stripe webhook] MONEY REVIEW: ghost-order auto-refund threw for', order.id, e instanceof Error ? e.message : e)
        }
        await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: refunded ? 'refunded' : 'reconcile_manual' } })
        return NextResponse.json({ received: true, order: 'expired_reconciled', refunded })
      }

      // AUTO-REFUND OFF (défaut — P0-04) → manual admin queue. Explicit marking
      // (NOT 'paid'); the money stays captured but flagged — NEVER a silent
      // money-out. Distinctly traced: gated marker + explicit log line.
      console.warn(`[stripe webhook] [P0-04] ghost-order ${order.id}: auto-refund gated OFF (GHOST_ORDER_AUTO_REFUND_ENABLED) → reconcile_manual (${capturedCents}c capturés, décision admin requise)`)
      await prisma.order.update({ where: { id: order.id }, data: { paymentStatus: 'reconcile_manual', stripePaymentIntentId: pi.id } })
      return NextResponse.json({ received: true, order: 'expired_needs_reconciliation', autoRefund: 'gated' })
    }

    const receivedCents = pi.amount_received ?? pi.amount ?? 0
    const totalCents    = Math.round(order.total * 100)
    if (receivedCents < totalCents) {
      console.error(`[stripe webhook] MONEY PARTIAL: order ${order.id} collected ${receivedCents}c of ${totalCents}c — NOT confirmed paid (PI ${pi.id})`)
      return NextResponse.json({ received: true, order: 'partial', collected: receivedCents, due: totalCents - receivedCents })
    }
    if (receivedCents > totalCents) {
      console.warn(`[stripe webhook] MONEY OVERPAID: order ${order.id} collected ${receivedCents}c for ${totalCents}c (PI ${pi.id})`)
    }

    await prisma.order.update({
      where: { id: order.id },
      data:  { paymentStatus: 'paid', stripePaymentIntentId: pi.id },
    })

    // Ghost-orders fix — THE server-side reveal: a card order is created as
    // 'awaiting_payment' (invisible to the resto); the webhook-confirmed payment
    // flips it to 'received' HERE, and that is the instant it appears in the
    // resto's Orders screen (never the customer's browser return). Guarded
    // updateMany = atomic + idempotent: replays match 0 rows, and a status the
    // kitchen already moved is never overwritten. Best-effort: a failure here
    // never fails the webhook (paymentStatus above is already the money truth).
    try {
      await prisma.order.updateMany({
        where: { id: order.id, status: 'awaiting_payment' },
        data:  { status: 'received' },
      })
    } catch (e) {
      console.error('[stripe webhook] order reveal failed', e instanceof Error ? e.message : e)
    }

    // ── Loyalty redemption DEBIT (chantier fidélité L1, D6) ─────────────────────
    // Points are debited ONLY at the confirmed payment (here) — never on the
    // browser return — so an abandoned checkout loses no points. Idempotent (one
    // 'redeem' LoyaltyTransaction per order). The balance decrement + the ledger
    // row are in the SAME DB transaction. Best-effort + column/table-tolerant: a
    // failure never fails the webhook (the money is already 'paid' above).
    try {
      const lo = await prisma.order.findUnique({
        where:  { id: order.id },
        select: { pointsRedeemed: true, consumerId: true },
      })
      if (lo && lo.pointsRedeemed > 0) {
        const already = await prisma.loyaltyTransaction.findFirst({
          where: { orderId: order.id, type: 'redeem' }, select: { id: true },
        })
        if (!already) {
          const operator = await prisma.operator.findUnique({ where: { id: lo.consumerId }, select: { email: true } })
          const lc = operator?.email
            ? await prisma.loyaltyCustomer.findUnique({ where: { email: operator.email }, select: { id: true } })
            : null
          if (lc) {
            await prisma.$transaction([
              prisma.loyaltyCustomer.update({ where: { id: lc.id }, data: { pointsBalance: { decrement: lo.pointsRedeemed } } }),
              prisma.loyaltyTransaction.create({ data: { customerId: lc.id, orderId: order.id, type: 'redeem', points: -lo.pointsRedeemed } }),
            ])
          } else {
            console.warn(`[stripe webhook] loyalty redeem: no LoyaltyCustomer for order ${order.id} — points NOT debited`)
          }
        }
      }
    } catch (e) {
      console.error('[LOYALTY MISS] redeem debit failed (table/columns missing? order stays paid):',
        order.id, e instanceof Error ? e.message : e)
    }

    return NextResponse.json({ received: true, order: 'paid' })
  } catch (err) {
    console.error('[stripe webhook] order paid handler error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }
}

// ── LEDGER (A3): one immutable line per succeeded PaymentIntent ────────────────
// type: metadata.ticketId → 'payment' (bill); else 'deposit_capture' (a captured
// empreinte — its manual-capture PI succeeds on capture). sourceEventId = THE
// PAYMENTINTENT ID: deterministic, so a replayed webhook event AND the backfill
// script land on the same @@unique([sourceEventId, type]) key → never two lines
// for one money movement. Golden equation per line: gross = applicationFee + net.
// Stripe's REAL processing fee comes from the charge's balance transaction
// (extra retrieve) — best-effort: unknown fee = null, never a failure.
async function recordSucceededPaymentLedger(pi: Stripe.PaymentIntent) {
  let payload: LedgerEntryInput | null = null
  try {
    const restaurantId = pi.metadata?.restaurantId
    if (!restaurantId) {
      console.error(`[LEDGER MISS] succeeded PI ${pi.id} carries no metadata.restaurantId — line NOT recorded (manual insert needed)`)
      return
    }

    const gross = pi.amount_received ?? pi.amount ?? 0
    const fee   = pi.application_fee_amount ?? 0
    const dest  = typeof pi.transfer_data?.destination === 'string'
      ? pi.transfer_data.destination
      : (pi.transfer_data?.destination as { id?: string } | null | undefined)?.id ?? null

    // Best-effort charge facts (real Stripe fee, charge + transfer ids).
    let chargeId: string | null = typeof pi.latest_charge === 'string' ? pi.latest_charge : null
    let stripeFeeCents: number | null = null
    let transferId: string | null = null
    try {
      const facts = await retrieveChargeFacts(pi.id)
      chargeId       = facts.chargeId ?? chargeId
      stripeFeeCents = facts.stripeFeeCents
      transferId     = facts.transferId
    } catch {
      // facts unknown — the line is still written with nulls
    }

    // C1: 'payment' covers bills (ticketId) AND checkout orders (orderId); a
    // succeeded PI with neither is a captured empreinte. The channel comes from
    // metadata.grubano_channel (set at PI creation since A2/C1); pre-channel PIs
    // get the honest derivation (bill→dinein, empreinte→reservation).
    const isPayment = !!(pi.metadata?.ticketId || pi.metadata?.orderId)
    const channel =
      pi.metadata?.grubano_channel ||
      (pi.metadata?.ticketId ? 'dinein' : !isPayment ? 'reservation' : null)

    payload = {
      type:                  isPayment ? 'payment' : 'deposit_capture',
      restaurantId,
      ticketId:              pi.metadata?.ticketId || null,
      reservationId:         pi.metadata?.reservationId || null,
      stripePaymentIntentId: pi.id,
      stripeChargeId:        chargeId,
      stripeTransferId:      transferId,
      grossAmount:           gross,
      applicationFeeAmount:  fee,
      stripeFeeAmount:       stripeFeeCents,
      netToRestaurant:       gross - fee,
      routed:                !!dest,
      destinationAccountId:  dest,
      currency:              pi.currency || 'eur',
      channel,
      sourceEventId:         pi.id,
    }

    const res = await recordLedgerEntry(payload)
    if (!res.ok) {
      console.error(`[LEDGER MISS] write failed for PI ${pi.id}: ${res.error} — payload: ${JSON.stringify(payload)}`)
    }
  } catch (err) {
    console.error(
      `[LEDGER MISS] unexpected error for PI ${pi.id}: ${err instanceof Error ? err.message : err}` +
      (payload ? ` — payload: ${JSON.stringify(payload)}` : ''),
    )
  }
}

// ── REFUNDS (A5): one compensating NEGATIVE ledger line per refund ─────────────
// gross = −refund.amount; applicationFee = −(commission actually taken back,
// read from Stripe's REAL fee refunds — created pro-rata by Stripe when the
// refund was made with refund_application_fee:true); net = gross − fee. The
// golden equation holds with negatives. sourceEventId = the refund id (re_…) →
// @@unique([sourceEventId,'refund']) makes replays silent, and iterating ALL of
// the charge's refunds self-heals previously missed events. stripeFeeAmount = 0
// (deliberate: Stripe does NOT return its processing fee on a refund — a zero
// fee MOVEMENT, affirmed, not an unknown). Failure → [LEDGER MISS] + 200.
async function handleChargeRefunded(charge: Stripe.Charge) {
  try {
    const piId         = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null
    const restaurantId = charge.metadata?.restaurantId
    if (!restaurantId) {
      console.error(`[LEDGER MISS] charge.refunded ${charge.id} carries no metadata.restaurantId — refund line(s) NOT recorded`)
      return NextResponse.json({ received: true, matched: false })
    }

    // The charge's refunds (chronological). The embedded list covers the 10 most
    // recent — beyond that, fetch the full list (test volumes never hit this).
    let refunds: Stripe.Refund[] = charge.refunds?.data ? [...charge.refunds.data] : []
    if (!refunds.length || charge.refunds?.has_more) {
      try {
        refunds = await getStripe().refunds
          .list({ payment_intent: piId ?? undefined, charge: piId ? undefined : charge.id, limit: 100 })
          .autoPagingToArray({ limit: 100 })
      } catch {
        // keep whatever the payload carried
      }
    }
    refunds.sort((a, b) => a.created - b.created)
    // Only money that actually went back.
    refunds = refunds.filter(r => r.status === 'succeeded')

    // Stripe's REAL fee refunds (commission taken back), same chronological
    // order — our flow creates exactly one per refund (refund_application_fee),
    // so index-matching is exact; a count mismatch falls back to pro-rata.
    const appFeeId = typeof charge.application_fee === 'string'
      ? charge.application_fee
      : charge.application_fee?.id ?? null
    let feeRefunds: Array<{ amount: number; created: number }> = []
    if (appFeeId) {
      try {
        const list = await getStripe().applicationFees.listRefunds(appFeeId, { limit: 100 })
        feeRefunds = list.data.map(fr => ({ amount: fr.amount, created: fr.created }))
          .sort((a, b) => a.created - b.created)
      } catch {
        // fee refunds unknown → pro-rata fallback below
      }
    }
    const totalFee = charge.application_fee_amount ?? 0

    const dest = typeof charge.transfer_data?.destination === 'string'
      ? charge.transfer_data.destination
      : (charge.transfer_data?.destination as { id?: string } | null | undefined)?.id ?? null

    let recorded = 0
    for (let i = 0; i < refunds.length; i++) {
      const r = refunds[i]
      // Commission taken back for THIS refund: Stripe's real fee refund when the
      // counts line up (our controlled flow), else the pro-rata Stripe applies.
      const feeBack = feeRefunds.length === refunds.length
        ? feeRefunds[i].amount
        : (totalFee > 0 && charge.amount > 0 ? Math.round(totalFee * (r.amount / charge.amount)) : 0)
      if (appFeeId && feeRefunds.length !== refunds.length) {
        console.warn(`[stripe webhook] refund ${r.id}: fee refunds (${feeRefunds.length}) ≠ refunds (${refunds.length}) — pro-rata fallback used`)
      }

      const res = await recordLedgerEntry({
        type:                  'refund',
        restaurantId,
        ticketId:              charge.metadata?.ticketId || null,
        reservationId:         charge.metadata?.reservationId || null,
        stripePaymentIntentId: piId,
        stripeChargeId:        charge.id,
        grossAmount:           -r.amount,
        applicationFeeAmount:  -feeBack,
        stripeFeeAmount:       0, // Stripe keeps its processing fee on refunds — zero movement, affirmed
        netToRestaurant:       -r.amount + feeBack, // gross − fee, with negatives
        routed:                !!dest,
        destinationAccountId:  dest,
        currency:              r.currency || charge.currency || 'eur',
        // C1: the refund inherits the original payment's channel (charge metadata).
        channel:               charge.metadata?.grubano_channel ||
                               (charge.metadata?.ticketId ? 'dinein' :
                                charge.metadata?.orderId ? null : 'reservation'),
        sourceEventId:         r.id,                        // re_… — replay-proof
        createdAt:             new Date(r.created * 1000),  // the refund's real date
      })
      if (!res.ok) {
        console.error(`[LEDGER MISS] refund line failed for ${r.id}: ${res.error} — charge ${charge.id}, amount ${r.amount}, feeBack ${feeBack}`)
      } else if (!res.duplicate) {
        recorded++
      }
    }

    // ── Loyalty RECONCILIATION on refund (Phase 1 — D1/D2/D3) ───────────────────
    // Reconciles the loyalty ledger to the CUMULATIVE refund state (the single
    // reconciliation point, whatever the refund's origin — admin rail or Dashboard):
    //   D1 earned points are CLAWED BACK proportionally to the refunded value;
    //   D2 spent points are RESTORED proportionally (no longer 100 % on a partial);
    //   D3 a clawback that would go below 0 floors the balance and spills the
    //      remainder into the customer's recovery offset (repaid by future earnings).
    // Idempotent per (sourceEventId = refund re_…, type); POINTS ONLY, never cash.
    // Best-effort + tolerant: a loyalty hiccup never fails the webhook (money is done).
    try {
      const orderId = charge.metadata?.orderId || null
      if (orderId) {
        await reconcileLoyaltyOnRefund(prisma, {
          orderId,
          chargeAmountCents: charge.amount,
          refunds: refunds.map(r => ({ id: r.id, amountCents: r.amount, createdUnix: r.created })),
        })
      }
    } catch (e) {
      console.error('[LOYALTY MISS] refund reconciliation failed:', e instanceof Error ? e.message : e)
    }

    // ── Courier TIP clawback on a TOTAL refund (P4.3 ÉTAPE 6) ──────────────────
    // When the WHOLE order is refunded, claw back the courier's TIP earning if it is
    // not yet paid (the COURSE stays acquired — decided). Only on a TOTAL refund
    // (charge.refunded / amount_refunded ≥ amount); a partial refund leaves the tip.
    // Best-effort + tolerant + idempotent (no-op when nothing accrued / flags OFF) —
    // NEVER fails the webhook. Mirrors the loyalty re-credit block above.
    try {
      const orderId = charge.metadata?.orderId || null
      const isTotalRefund = charge.refunded === true || (charge.amount_refunded ?? 0) >= charge.amount
      if (orderId && isTotalRefund) {
        const claw = await clawbackCourierTip(orderId)
        if (claw.status === 'clawed') {
          console.warn(`[courier tip clawback] order ${orderId}: ${claw.count} tip earning(s) cancelled on total refund`)
        }
      }
    } catch (e) {
      console.error('[TIP CLAWBACK MISS] failed (refund unaffected):', e instanceof Error ? e.message : e)
    }

    return NextResponse.json({ received: true, refunds: refunds.length, recorded })
  } catch (err) {
    console.error('[stripe webhook] charge.refunded handler error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }
}

// ── Connect: account.updated → sync the establishment's onboarding status ──────
// Stripe pushes this whenever a connected account changes (onboarding finished,
// verification passed/failed, capability toggled…). Same coarse mapping as GET
// /api/restaurants/[id]/connect: pending | active | restricted. Idempotent (same
// status = no-op); unknown account → 200 + log (NEVER fail the webhook).
async function handleAccountUpdated(acct: Stripe.Account) {
  try {
    const restaurant = await prisma.restaurant.findUnique({
      where:  { stripeAccountId: acct.id },
      select: { id: true, stripeAccountStatus: true, stripeOnboardedAt: true },
    })
    if (!restaurant) {
      console.warn(`[stripe webhook] account.updated for ${acct.id} — no matching restaurant`)
      return NextResponse.json({ received: true, matched: false })
    }

    const status = mapAccountStatus(acct)
    if (restaurant.stripeAccountStatus !== status) {
      await prisma.restaurant.update({
        where: { id: restaurant.id },
        data: {
          stripeAccountStatus: status,
          // Stamp the FIRST pass to 'active' (KYC onboarding completed).
          ...(status === 'active' && !restaurant.stripeOnboardedAt ? { stripeOnboardedAt: new Date() } : {}),
        },
      })
    }

    return NextResponse.json({ received: true, account: acct.id, status })
  } catch (err) {
    console.error('[stripe webhook] account.updated handler error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Handler error' }, { status: 500 })
  }
}
