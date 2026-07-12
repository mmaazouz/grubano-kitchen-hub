import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { releaseHold } from '@/lib/deposit'
import { retrieveIntent, type DepositStatus } from '@/lib/stripe'
import { isEatReservation, maskCustomerName } from '@/lib/customer-scope'

// ── POST /api/reservations/purge-residual-deposits ────────────────────────────
// One-shot maintenance endpoint (OWNER-scoped). Releases empreintes that stayed
// active on Stripe but whose Reservation row was left inconsistent BEFORE the
// webhook existed — e.g. reservations marked "arrived" via the legacy status
// path (Mourad/Angèle), or an unconfirmed test PaymentIntent (claude).
//
// For each matching reservation (within the caller's OWN establishments only):
//   • probe the live PaymentIntent (Stripe = source of truth);
//   • if it is still cancellable → releaseHold() cancels it (nothing charged) →
//     depositStatus 'released';
//   • if it is already captured → keep 'captured' (never undo a real charge);
//   • if it is gone / there is no PI → normalise depositStatus to 'none'.
// Reuses Agent 2's lib/deposit.releaseHold + lib/stripe.retrieveIntent (read-only
// reuse — those files are NOT modified). Safe & idempotent: re-running only ever
// releases still-active holds and normalises status, never regresses a settled one.
//
// Run it once via curl with the operator session cookie (see report). It is
// owner-scoped, so it can only ever touch the caller's own reservations.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Default residual customers (case-insensitive contains). Override via body.
const DEFAULT_NAMES = ['Mourad', 'Angèle', 'Angele', 'claude']

const bodySchema = z.object({
  names: z.array(z.string().min(1)).min(1).max(50).optional(),
})

export async function POST(req: Request) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })
    if (!scope.ownedIds.length) {
      return NextResponse.json({ error: 'Aucun établissement', processed: [] }, { status: 200 })
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    const names = parsed.success && parsed.data.names?.length ? parsed.data.names : DEFAULT_NAMES

    // Owner-scoped: only reservations in the caller's establishments, matching one
    // of the residual names. MySQL's default collation makes `contains` case- and
    // accent-insensitive, so "Mourad"/"mourad"/"Angèle" all match.
    const reservations = await prisma.reservation.findMany({
      where: {
        restaurantId: { in: scope.ownedIds },
        OR: names.map((n) => ({ customerName: { contains: n } })),
      },
      select: {
        id: true, customerName: true, status: true,
        depositStatus: true, stripePaymentIntentId: true,
        source: true, userId: true,
      },
    })

    const processed: Array<Record<string, unknown>> = []

    for (const r of reservations) {
      const current = r.depositStatus as DepositStatus
      let after: DepositStatus = current
      let stripeBefore: string | null = null
      let action: string

      if (!r.stripePaymentIntentId) {
        after = 'none'
        action = 'no_pi_normalized_none'
      } else {
        // Probe the live PI for the report (and to keep a captured hold intact).
        let piStatus: string | null = null
        try {
          piStatus = (await retrieveIntent(r.stripePaymentIntentId)).status
        } catch {
          piStatus = null // PI not found / unreachable
        }
        stripeBefore = piStatus

        if (piStatus === null) {
          after = 'none'
          action = 'pi_not_found_normalized_none'
        } else if (piStatus === 'succeeded') {
          after = 'captured' // a real charge happened — never undo it
          action = 'already_captured_kept'
        } else {
          const settle = await releaseHold(r.stripePaymentIntentId)
          if (settle.ok) {
            after = settle.depositStatus ?? 'released'
            action = 'released'
          } else {
            action = `release_failed_${settle.status}:${settle.error}`
          }
        }
      }

      if (after !== current) {
        await prisma.reservation.update({
          where: { id: r.id },
          data:  { depositStatus: after },
        })
      }

      processed.push({
        id: r.id,
        // Masquage PII /eat: consumer bookings reach the operator masked.
        customerName: isEatReservation(r) ? maskCustomerName(r.customerName) : r.customerName,
        reservationStatus: r.status,
        stripeBefore,
        depositStatusBefore: current,
        depositStatusAfter: after,
        action,
      })
    }

    return NextResponse.json({
      ok: true,
      matched: reservations.length,
      changed: processed.filter((p) => p.depositStatusBefore !== p.depositStatusAfter).length,
      processed,
    })
  } catch (err) {
    console.error('[purge-residual-deposits]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
