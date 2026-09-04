import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { requireRefundAdmin } from '@/lib/refund-route-guard'
import { recordAdminAudit } from '@/lib/admin-audit'
import { isRefundsEnabled, executeRefund } from '@/lib/refund'
import { rateLimit } from '@/lib/rate-limit'
import { sendRefundConfirmation } from '@/lib/transactional-emails'

// ── POST /api/orders/[id]/refund ──────────────────────────────────────────────
// P0-03 (vague 1, Q3 fondateur) : refund an order — ADMIN GRUBANO ONLY. This
// route used to be OWNER-scoped (the resto could refund its own orders); Q3
// requires every refund to go through a Grubano-admin validation, so the gate is
// requireRefundAdmin (401/403 + 'refund.denied' audit for anyone else, resto
// included).
//
// PHASE 2 (REFUND-FINANCIAL-CONTRACT §4, decision D-A) — ONE ENGINE ON THE ORDER PATH.
// This route now calls lib/refund.executeRefund (the royalty-aware engine), no longer
// lib/refunds.refundPayment: on a FRANCHISED order the old path returned the royalty
// slice to the customer (refund_application_fee) without reducing
// FranchiseRoyalty.refundedCents → the franchise settlement paid it a second time
// (double-return). The engine records the Refund row (audit + anti-double cursor),
// nests the royalty slice, claws back a settled royalty, writes the ledger from Stripe
// truth and is STATUS-TRUTHFUL (§8): a refund still `pending` at Stripe answers 202
// { status:'pending' } — no « effectué » email, audited with pending:true — and is
// finalized later (RESUME-FIRST or the refund.updated webhook). RESUME-FIRST: if an
// interrupted refund exists on the order, it is re-driven BEFORE the requested amount
// (the response says so: resumedIgnoredAmount). Public response shape preserved
// (refundId = the Stripe re_…, refundedCents, remainingCents, routed).
// paymentStatus STAYS 'paid' (no state change): the ledger is the source of truth.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  amountCents: z.number().int().positive().optional(),
})

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    // P0-26 — même régime que /api/admin/refunds/run : (0) rate-limit flag-gaté,
    // (1) kill-switch REFUNDS_ENABLED (défaut OFF → 403 explicite, AUCUN Stripe),
    // (2) garde admin. Couper le flag arrête désormais AUSSI cette route.
    const limited = rateLimit(req, 'order_refund', { limitDefault: 20, windowDefault: 60 })
    if (limited) return limited
    if (!isRefundsEnabled()) {
      return NextResponse.json({ error: 'Remboursements indisponibles', gated: true }, { status: 403 })
    }

    // P0-03 — ADMIN GRUBANO only (denied attempts audited inside the gate).
    const gate = await requireRefundAdmin(req, { route: 'orders/[id]/refund', targetType: 'order', targetId: params.id })
    if (!gate.ok) return gate.res

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Montant invalide.' }, { status: 400 })
    }

    const order = await prisma.order.findUnique({
      where:  { id: params.id },
      select: {
        id: true, restaurantId: true, consumerId: true,
        paymentStatus: true, stripePaymentIntentId: true,
      },
    })
    if (!order) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    // LOT C — garde ÉLARGIE (miroir lib/refund.executeRefund) : 'reconcile_manual'
    // (ghost order encaissé, file manuelle) est de l'argent RÉELLEMENT encaissé —
    // le rail admin doit pouvoir le rendre. Le moteur re-vérifie de toute façon
    // le refundable LIVE côté Stripe avant tout mouvement.
    const isRefundablePaymentStatus =
      order.paymentStatus === 'paid' || order.paymentStatus === 'reconcile_manual'
    if (!isRefundablePaymentStatus || !order.stripePaymentIntentId) {
      return NextResponse.json({ error: 'Commande non payée — rien à rembourser.' }, { status: 409 })
    }

    const result = await executeRefund({
      orderId:     order.id,
      amountCents: parsed.data.amountCents,
      reason:      'admin:orders/[id]/refund',
    })

    if (!result.ok) {
      if (result.pending) {
        // §15 A4 — a Stripe refund WAS created by an admin: audit it, tell the truth.
        await recordAdminAudit({
          actorId:    gate.actorId,
          actorEmail: gate.actorEmail,
          action:     'refund.run',
          targetType: 'order',
          targetId:   order.id,
          metadata:   { route: 'orders/[id]/refund', refundId: result.stripeRefundId, refundRow: result.refundId, refundedCents: result.amountCents, pending: true, stripeStatus: result.stripeStatus },
          req,
        })
        return NextResponse.json({
          status:        'pending',
          refundId:      result.stripeRefundId,
          refundRow:     result.refundId,
          refundedCents: result.amountCents,
          message:       result.error,
        }, { status: 202 })
      }
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    const remainingCents = result.remainingRefundableCents

    // P0-03 — audit the ACCEPTED refund (best-effort, after the money moved).
    await recordAdminAudit({
      actorId:    gate.actorId,
      actorEmail: gate.actorEmail,
      action:     'refund.run',
      targetType: 'order',
      targetId:   order.id,
      metadata:   {
        route: 'orders/[id]/refund', refundId: result.stripeRefundId, refundRow: result.refundId,
        refundedCents: result.amountCents, remainingCents, resumed: result.resumed,
        ...(result.resumedIgnoredAmount ? { resumedIgnoredAmount: true, requestedCents: parsed.data.amountCents ?? null } : {}),
      },
      req,
    })

    // ── Transactional email — POST-success (Stripe `succeeded` only), BEST-EFFORT
    // (never throws). The consumer is an Operator row; a missing email skips the send.
    try {
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
          partial:        remainingCents > 0,
          dedupeKey:      `order:${order.id}:${result.amountCents}`,
        })
      }
    } catch (e) {
      console.error('[EMAIL MISS] [POST /api/orders/[id]/refund] context lookup failed',
        JSON.stringify({ orderId: order.id, refundId: result.stripeRefundId }),
        e instanceof Error ? e.message : e)
    }

    return NextResponse.json({
      refundId:       result.stripeRefundId,
      refundedCents:  result.amountCents,
      remainingCents,
      routed:         result.routed,
      ...(result.resumed ? { resumed: true } : {}),
      ...(result.resumedIgnoredAmount
        ? { resumedIgnoredAmount: true, message: 'Un remboursement interrompu a été repris en priorité ; le montant demandé a été ignoré — réémettez-le si nécessaire.' }
        : {}),
    })
  } catch (err) {
    console.error('[POST /api/orders/[id]/refund]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
