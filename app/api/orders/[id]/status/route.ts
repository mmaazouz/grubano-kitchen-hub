import { NextRequest, NextResponse } from 'next/server'
import { orderRef } from '@/lib/order-ref'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { applyEarnWithOffsetRepay } from '@/lib/loyalty-refund'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { sendOrderStatusEmail } from '@/lib/transactional-emails'
import { createSystemClaim, isClaimsEnabled } from '@/lib/claims'
import { sendOrderCancelledPaidEmail, sendOrderCancelledPaidOffEmail } from '@/lib/claim-emails'
import { sendAdminPaidCancellationAlert } from '@/lib/admin-alerts'
import { z } from 'zod'

// ── Valid status machine ──────────────────────────────────────────────────────
//   received → preparing → ready → picked_up → delivered
//   any state → cancelled  (restaurant/admin only)

const TRANSITIONS: Record<string, string[]> = {
  received:  ['preparing', 'cancelled'],
  preparing: ['ready',     'cancelled'],
  // ready → delivered DIRECTLY = the PICKUP hand-off (no courier leg, the
  // "picked_up / En route" step never applies to a pickup — ghost-orders 2.4).
  ready:     ['picked_up', 'delivered', 'cancelled'],
  picked_up: ['delivered'],
  delivered: [],
  cancelled: [],
}

const patchSchema = z.object({
  status: z.enum(['received', 'preparing', 'ready', 'picked_up', 'delivered', 'cancelled']),
})

// ── PATCH /api/orders/:id/status ─────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const token = await getToken({ req })
    if (!token) {
      return NextResponse.json({ error: 'Authentification requise' }, { status: 401 })
    }

    // Only restaurant operators and admins can update order status
    const role = token.role as string
    if (!['restaurant', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const body = await req.json()
    const { status: newStatus } = patchSchema.parse(body)

    const order = await prisma.order.findUnique({ where: { id: params.id } })
    if (!order) {
      return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    }

    // ── Establishment ownership (hardening) ──────────────────────────────────
    // Beyond session + role, a 'restaurant' operator may only mutate orders that
    // belong to an establishment they OWN — closes a pre-existing IDOR where any
    // operator could PATCH another restaurant's order by id. 'admin' stays a
    // superuser (unchanged). Reuses resolveEstablishmentScope = the exact same
    // owner-scoping as GET /api/orders/live & /api/orders/kitchen. A foreign order
    // returns 404 (not 403) so its existence is not even confirmed. This is a pure
    // PRE-CONDITION: the state machine, the 'delivered' loyalty credit and the
    // status email below are byte-identical.
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    if (scope.role !== 'admin' && !scope.ownedIds.includes(order.restaurantId)) {
      return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    }

    // Enforce state machine
    const allowed = TRANSITIONS[order.status] ?? []
    if (!allowed.includes(newStatus)) {
      return NextResponse.json(
        {
          error:   `Transition invalide: ${order.status} → ${newStatus}`,
          allowed: allowed.length ? allowed : ['(aucune transition possible)'],
        },
        { status: 422 },
      )
    }

    // ── P0-08 (vague 4) — annuler une commande PAYÉE crée une demande de
    // remboursement SYSTÈME qui entre DIRECTEMENT dans la file d'arbitrage admin,
    // dans la MÊME transaction que l'annulation : les deux réussissent ou
    // échouent ENSEMBLE (sans demande, l'annulation reproduirait le défaut
    // constaté en exécution le 06/08 : « annuler une commande payée garde
    // l'argent »). AUCUN remboursement n'est déclenché ici (Q3 absolu) — l'admin
    // tranche via le circuit d'arbitrage prouvé le 04/08. Cas particulier VOULU :
    // une réclamation DÉJÀ ACTIVE sur la commande (P2002 sur activeOrderKey) ne
    // crée pas de doublon et ne bloque pas l'annulation — la question de l'argent
    // est déjà dans le circuit. Une commande NON payée garde le chemin
    // historique, byte-identique.
    // Revue adversariale : la branche est GATÉE par isClaimsEnabled(), comme TOUS
    // les autres écrivains de Claim — flag OFF ⇒ chemin historique byte-identique
    // (la demande serait invisible et intranchable, l'email mentirait ; et une
    // table Claim absente pré-db-push casserait l'annulation). Flag ON + table
    // absente = config CASSÉE (contrat docs/ops/flags.md : CLAIMS_ENABLED exige
    // la table) ⇒ échec BRUYANT voulu (rollback + 500), jamais silencieux.
    const claimAmountCents = Math.max(0, Math.round(order.total * 100))
    // LOT C — le fait « une commande PAYÉE est annulée » est découplé du flag
    // claims : il gouverne l'alerte admin et le CHOIX d'email ci-dessous, que la
    // branche demande-système (gatée isClaimsEnabled, inchangée) tourne ou non.
    const claimsOn = isClaimsEnabled()
    const paidCancelled = newStatus === 'cancelled' && order.paymentStatus === 'paid'
    const paidCancellation = paidCancelled && claimsOn && claimAmountCents > 0
    let systemClaim: Awaited<ReturnType<typeof createSystemClaim>> | null = null
    let updated
    if (paidCancellation) {
      updated = await prisma.$transaction(async (tx) => {
        const u = await tx.order.update({
          where: { id: params.id },
          data:  { status: newStatus },
        })
        systemClaim = await createSystemClaim({
          orderId:              order.id,
          consumerId:           order.consumerId,
          restaurantId:         order.restaurantId,
          requestedAmountCents: claimAmountCents,
          description:          `Annulation par le restaurant d'une commande payée (${order.id}).`,
          tx,
        })
        return u
      })
      // Revue : le cas P2002 (réclamation déjà active) est TRACÉ — la question de
      // l'argent est déjà portée par la réclamation existante, aucune demande
      // système n'a été créée, et l'email ci-dessous le dit HONNÊTEMENT.
      if (systemClaim !== null && !(systemClaim as Awaited<ReturnType<typeof createSystemClaim>>).created) {
        console.warn(
          `[P0-08] annulation payée ${order.id} : demande système NON créée — une réclamation est déjà ACTIVE sur cette commande (la question du remboursement y est déjà portée).`,
        )
      }
    } else {
      updated = await prisma.order.update({
        where: { id: params.id },
        data:  { status: newStatus },
      })
    }

    // When order is delivered: credit loyalty points to the consumer.
    // Loyalty is an AUTOMATIC acquis — every consumer earns, with NO opt-in. The
    // normal consumer signup (/api/auth/register) historically created NO
    // LoyaltyCustomer, and this earn path only ever did findUnique-then-if(lc),
    // so the credit was silently SKIPPED for the majority of customers → "0 point
    // à vie" (the confirmed root cause). FIX: UPSERT the LoyaltyCustomer by EMAIL
    // (create it at 0 pts if absent — the 10-pt welcome bonus stays reserved to
    // the explicit /api/loyalty/register opt-in, never duplicated here), THEN
    // increment + append the signed 'earn' ledger row in the SAME transaction.
    // Idempotent: one 'earn' per order (the [orderId,'earn'] guard), so a re-PATCH
    // to 'delivered' / a retry never double-credits — and because the increment +
    // the 'earn' row are atomic, a failed credit leaves no 'earn' row and safely
    // retries. Best-effort: a loyalty hiccup never blocks the status update. This
    // touches ONLY the points credit — zero financial amount/fee/total.
    if (newStatus === 'delivered' && order.pointsEarned > 0) {
      try {
        const already = await prisma.loyaltyTransaction.findFirst({
          where: { orderId: order.id, type: 'earn' }, select: { id: true },
        })
        // Adversarial review E-P2d — never CREDIT earned points on an order whose
        // loyalty was already reconciled by a refund (a refund before delivery, then
        // a later 'delivered'). A 'refund' or 'earn_reversal' row for the order is the
        // marker; if present, skip the earn (the refund already unwound this order).
        const refundedMarker = await prisma.loyaltyTransaction.findFirst({
          where: { orderId: order.id, type: { in: ['refund', 'earn_reversal'] } }, select: { id: true },
        })
        if (!already && !refundedMarker) {
          const operator = await prisma.operator.findUnique({
            where: { id: order.consumerId }, select: { email: true, name: true },
          })
          if (operator?.email) {
            // Ensure the account exists (create at 0 — NOT the welcome bonus).
            const lc = await prisma.loyaltyCustomer.upsert({
              where:  { email: operator.email },
              update: {},
              create: { name: operator.name ?? operator.email, email: operator.email, pointsBalance: 0 },
              select: { id: true },
            })
            // D3 (Phase 1) — a future earning first REPAYS the recovery offset (a debt
            // left by an earlier refund whose earned points were already spent); only
            // the remainder becomes spendable balance. The 'earn' row records the FULL
            // earning; the split between offset repayment and spendable balance is on
            // the customer row (pointsBalance rises by the remainder, recoveryOffset
            // falls by what was repaid). Interactive tx = the offset read + both writes
            // are atomic. Idempotent via the [orderId,'earn'] guard above.
            await prisma.$transaction(async (tx) => {
              // LOCK the customer row (SELECT … FOR UPDATE) so a concurrent refund
              // clawback (which also locks it) cannot lost-update the offset: an
              // absolute `recoveryOffsetPoints = newOffset` write racing a clawback's
              // `{increment}` would drop the clawback's debt (review E-P2c). Under the
              // lock we read the true offset and apply RELATIVE deltas only.
              const rows = await tx.$queryRawUnsafe<{ recoveryOffsetPoints: number }[]>(
                'SELECT recoveryOffsetPoints FROM LoyaltyCustomer WHERE id = ? FOR UPDATE', lc.id,
              )
              const off = Number(rows?.[0]?.recoveryOffsetPoints ?? 0)
              const { spendableIncrement, offsetRepaid } = applyEarnWithOffsetRepay(order.pointsEarned, off)
              await tx.loyaltyCustomer.update({
                where: { id: lc.id },
                data:  { pointsBalance: { increment: spendableIncrement }, recoveryOffsetPoints: { decrement: offsetRepaid } },
              })
              await tx.loyaltyTransaction.create({
                data: { customerId: lc.id, orderId: order.id, type: 'earn', points: order.pointsEarned },
              })
            })
          }
        }
      } catch (e) {
        // Non-fatal: a loyalty hiccup or the table being absent pre-db-push never
        // blocks the 'delivered' transition.
        console.error('[LOYALTY MISS] earn credit failed (non-fatal):', order.id, e instanceof Error ? e.message : e)
      }
    }

    // Email B1 (Agent 142) — notify the CONSUMER of the new status. POST-update, BEST-EFFORT
    // (calque of the loyalty block above): a send failure NEVER blocks/fails the transition.
    // Idempotent per (status, order) via sendOnce inside sendOrderStatusEmail (trigger
    // `order_<status>` + dedupeKey `order:<id>`). STATUS-ONLY: no amount is read or recomputed.
    // GOLDEN RULE preserved — this fires from the restaurant/admin PATCH, never from the webhook.
    try {
      const [consumer, resto] = await Promise.all([
        prisma.operator.findUnique({ where: { id: order.consumerId }, select: { email: true, name: true } }),
        prisma.restaurant.findUnique({ where: { id: order.restaurantId }, select: { name: true } }),
      ])
      if (paidCancellation) {
        // P0-08 — contenu VÉRIDIQUE pour une annulation PAYÉE : la demande de
        // remboursement vient d'être créée dans la même transaction ; l'ancien
        // email (« contactez directement le restaurant », muet sur l'argent) ne
        // décrivait pas la situation réelle. Localisé (rail T43), même trigger
        // order_cancelled + dedupeKey order:<id> → une seule notification
        // d'annulation par commande. La commande NON payée garde l'email
        // historique ci-dessous, byte-identique.
        await sendOrderCancelledPaidEmail({
          orderId:        order.id,
          consumerId:     order.consumerId,
          restaurantName: resto?.name ?? 'votre restaurant',
          // Revue : quand la demande N'A PAS été créée (réclamation déjà active),
          // l'email ne dit plus « une demande a été transmise » — il dit la
          // vérité : la réclamation EN COURS porte la question du remboursement.
          existingClaim:  systemClaim != null && !(systemClaim as Awaited<ReturnType<typeof createSystemClaim>>).created,
        })
      } else if (paidCancelled && !claimsOn) {
        // LOT C (P-1 M7) — annulation PAYÉE avec CLAIMS OFF (réglage bêta D4) :
        // AUCUNE demande système n'existe (branche gatée), donc l'email flag-ON
        // ci-dessus MENTIRAIT (« demande transmise ») et le générique ci-dessous
        // est muet sur l'argent (« contactez directement le restaurant »). La
        // variante honnête flag-OFF dit la vérité : commande payée annulée,
        // remboursement instruit par le support (humain, bêta). Même trigger
        // order_cancelled + dedupeKey order:<id> → une seule notification
        // d'annulation par commande, quel que soit le chemin.
        await sendOrderCancelledPaidOffEmail({
          orderId:        order.id,
          consumerId:     order.consumerId,
          restaurantName: resto?.name ?? 'votre restaurant',
        })
      } else if (consumer?.email) {
        await sendOrderStatusEmail({
          orderId:         order.id,
          to:              consumer.email,
          customerName:    consumer.name ?? consumer.email,
          restaurantName:  resto?.name ?? 'votre restaurant',
          orderRef:        orderRef(order.id),
          status:          newStatus,
          fulfillmentType: order.fulfillmentType,
        })
      }
    } catch (e) {
      console.error('[EMAIL MISS] [PATCH /api/orders/:id/status] status email failed (non-fatal):',
        order.id, e instanceof Error ? e.message : e)
    }

    // LOT C — alerte admin, POST-update, BEST-EFFORT, INDÉPENDANTE du flag claims :
    // une commande PAYÉE vient d'être annulée → l'argent encaissé doit être
    // instruit (file /admin/reconciliation « Annulées payées » + outil refunds/run).
    // sendOnce idempotent (trigger admin_paid_cancellation, dedupeKey order:<id>) ;
    // ALERT_EMAIL absent → skipped ; un échec ne bloque JAMAIS la transition.
    if (paidCancelled) {
      try {
        const restoName = (await prisma.restaurant.findUnique({
          where: { id: order.restaurantId }, select: { name: true },
        }))?.name ?? null
        await sendAdminPaidCancellationAlert({
          orderId:         order.id,
          paymentIntentId: order.stripePaymentIntentId ?? null,
          amountCents:     claimAmountCents,
          restaurantName:  restoName,
        })
      } catch (e) {
        console.error('[ALERT MISS] [PATCH /api/orders/:id/status] paid-cancellation alert failed (non-fatal):',
          order.id, e instanceof Error ? e.message : e)
      }
    }

    return NextResponse.json({
      orderId:    updated.id,
      status:     updated.status,
      updatedAt:  updated.updatedAt,
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.errors[0]?.message ?? 'Données invalides' },
        { status: 400 },
      )
    }
    console.error('[PATCH /api/orders/:id/status]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
