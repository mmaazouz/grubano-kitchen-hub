import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isRefundsEnabled, executeRefund } from '@/lib/refund'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit, CRON_ACTOR_ID } from '@/lib/admin-audit'
import { safeEqual } from '@/lib/safe-compare'
import { sendRefundConfirmation } from '@/lib/transactional-emails'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/refunds/run — execute an order refund (TEST, P4.5-A) ──────────
// Moves REAL money (TEST mode) via lib/refund (idempotent, prorata): reverses the
// resto's share + takes Grubano's commission back + reduces/claws back the franchise
// royalty + records the ledger. ADMIN-TRIGGERED (the decision/arbitration process is
// phase 2; chargebacks are P4.5-B). NO consumer/restaurant button here.
//
// GATE ORDER (all BEFORE any refund work):
//   1. REFUNDS_ENABLED kill-switch (default OFF) → 403 gated, NO Stripe, NO write,
//      byte-identical encaissement (no refund path active).
//   2. AUTH (mirror of creator-payouts/run + franchise-settlements/run):
//      INTERNAL_CRON_TOKEN via X-Internal-Token header, OR an ADMIN session. 401
//      without either; 403 for a non-admin session.
// Body: { orderId, amountCents?, reason? } — amountCents omitted ⇒ FULL refund of the
// remaining refundable. Every split amount is DERIVED SERVER-SIDE from the live Stripe
// charge + the order; the only client inputs are which order and how much to give back.

const bodySchema = z.object({
  orderId:     z.string().min(1),
  amountCents: z.number().int().positive().optional(),
  reason:      z.string().max(500).optional(),
})

export async function POST(req: Request) {
  // 0. Flag-gated rate limit (ADM7; no-op when RATE_LIMIT_ENABLED is off → byte-identical).
  const limited = rateLimit(req, 'admin_refunds_run', { limitDefault: 20, windowDefault: 60 })
  if (limited) return limited

  // 1. Kill-switch — default OFF, checked before anything else.
  if (!isRefundsEnabled()) {
    return NextResponse.json({ error: 'Remboursements indisponibles', gated: true }, { status: 403 })
  }

  // 2. Auth — cron secret OR admin session.
  const internalToken    = req.headers.get('x-internal-token')
  const internalExpected = (process.env.INTERNAL_CRON_TOKEN ?? '').trim()
  const isInternal =
    internalExpected.length > 0 &&
    typeof internalToken === 'string' &&
    safeEqual(internalToken, internalExpected) // ADM7: constant-time

  let actorId = CRON_ACTOR_ID
  let actorEmail: string | null = null
  if (!isInternal) {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const operator = await prisma.operator.findUnique({
      where:  { email: session.user.email },
      select: { id: true, role: true },
    })
    if (!operator || operator.role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    actorId = operator.id
    actorEmail = session.user.email
  }

  try {
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Requête invalide (orderId requis, amountCents entier positif).' }, { status: 400 })
    }

    const result = await executeRefund({
      orderId:     parsed.data.orderId,
      amountCents: parsed.data.amountCents,
      reason:      parsed.data.reason,
    })
    if (!result.ok) {
      if (result.pending) {
        // PHASE 2 (§8 / §15 A4) — Stripe accepted the refund but it is NOT succeeded yet:
        // money has NOT reached the customer. Truthful 202, NO « effectué » email, but an
        // admin-created Stripe refund always leaves an audit trail (pending:true).
        await recordAdminAudit({
          actorId, actorEmail,
          action:     'refund.run',
          targetType: 'order',
          targetId:   parsed.data.orderId,
          metadata:   { amountCents: result.amountCents, refundId: result.refundId, stripeRefundId: result.stripeRefundId, pending: true, stripeStatus: result.stripeStatus },
          req,
        })
        return NextResponse.json({
          ok:             false,
          status:         'pending',
          refundId:       result.refundId,
          stripeRefundId: result.stripeRefundId,
          amountCents:    result.amountCents,
          message:        result.error,
        }, { status: 202 })
      }
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    // Best-effort audit AFTER the refund fully succeeded (flag-gated, never throws).
    await recordAdminAudit({
      actorId, actorEmail,
      action:     'refund.run',
      targetType: 'order',
      targetId:   parsed.data.orderId,
      metadata:   { amountCents: result.amountCents, resumed: result.resumed, refundId: result.refundId, ...(result.resumedIgnoredAmount ? { resumedIgnoredAmount: true, requestedCents: parsed.data.amountCents ?? null } : {}) },
      req,
    })

    // ── LOT C — transactional email, POST-success, BEST-EFFORT (never throws). ──
    // Symétrie avec POST /api/orders/[id]/refund : le client était informé quand
    // l'admin remboursait par CETTE route-là mais PAS par le moteur royalty-aware —
    // même pattern, même dedupeKey `order:<id>:<cents de CE remboursement>` (un
    // resume qui re-drive le même montant retombe sur la même clé → duplicate,
    // jamais deux emails pour un seul mouvement). Un échec ne bloque JAMAIS la
    // réponse : le remboursement a déjà eu lieu.
    try {
      const order = await prisma.order.findUnique({
        where:  { id: parsed.data.orderId },
        select: { consumerId: true, restaurantId: true },
      })
      if (order) {
        const [consumer, resto] = await Promise.all([
          prisma.operator.findUnique({
            where:  { id: order.consumerId },
            select: { email: true, name: true },
          }),
          prisma.restaurant.findUnique({ where: { id: order.restaurantId }, select: { name: true } }),
        ])
        if (consumer?.email) {
          await sendRefundConfirmation({
            to:             consumer.email,
            customerName:   consumer.name ?? consumer.email,
            restaurantName: resto?.name ?? 'votre restaurant',
            refundedCents:  result.amountCents,
            partial:        result.remainingRefundableCents > 0,
            dedupeKey:      `order:${parsed.data.orderId}:${result.amountCents}`,
          })
        }
      }
    } catch (e) {
      console.error('[EMAIL MISS] [POST /api/admin/refunds/run] refund confirmation failed (non-fatal)',
        JSON.stringify({ orderId: parsed.data.orderId, refundId: result.refundId }),
        e instanceof Error ? e.message : e)
    }

    return NextResponse.json({
      ok:                        true,
      resumed:                   result.resumed,
      refundId:                  result.refundId,
      stripeRefundId:            result.stripeRefundId,
      amountCents:               result.amountCents,
      restaurantReverseCents:    result.restaurantReverseCents,
      applicationFeeRefundCents: result.applicationFeeRefundCents,
      royaltyRefundCents:        result.royaltyRefundCents,
      royaltyClawbackCents:      result.royaltyClawbackCents,
      cumulativeRefundedCents:   result.cumulativeRefundedCents,
      remainingRefundableCents:  result.remainingRefundableCents,
      routed:                    result.routed,
    })
  } catch (err) {
    console.error('[refunds run]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
