import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { releaseHold } from '@/lib/deposit'
import { maskCustomerName } from '@/lib/customer-scope'
import {
  sendReservationCancelledByClientToClient,
  sendReservationCancelledByClientToOwner,
  resolveReservationRecipient,
  logEmailSkipped,
} from '@/lib/transactional-emails'
import type { NextRequest } from 'next/server'

// ── POST /api/reservations/[id]/cancel — CONSUMER self-cancellation ────────────
//
// The missing link of the reservation lifecycle (A0 decision: « annulation libre
// jusqu'à 2h avant, paramétrable » — Restaurant.cancellationWindowHours).
//
// AUTH: the CONNECTED CONSUMER who OWNS the reservation (token.sub ===
// reservation.userId — the account link written at booking time). Anonymous
// bookings have no userId → not self-cancellable online (403, call the resto).
//
// Refusals (all explicit):
//   401  not connected
//   403  not the owner of this reservation (or anonymous booking)
//   404  unknown id
//   409  code 'not_cancellable'  — status isn't 'confirmed' (arrived/cancelled/…)
//   409  code 'window_closed'    — now > (start − cancellationWindowHours)
//
// Success path: FIRST the guarded status flip (updateMany conditioned on
// status:'confirmed' — a concurrent 'arrived' between the read and the write
// yields 409 'not_cancellable' instead of cancelling a live session), THEN the
// empreinte release via the EXISTING lib/deposit.releaseHold (called, never
// modified — best-effort: a release hiccup never blocks the guest's right to
// cancel, the hold expires on its own and the error is surfaced), then the TWO
// prepared transactional emails (guest + owner) — post-success, best-effort.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const token = await getToken({ req })
    if (!token?.sub) {
      return NextResponse.json({ error: 'Non connecté' }, { status: 401 })
    }

    const reservation = await prisma.reservation.findUnique({
      where:  { id: params.id },
      select: {
        id: true, userId: true, status: true, date: true, guests: true,
        customerName: true, email: true,
        stripePaymentIntentId: true, depositStatus: true,
        restaurantId: true,
        restaurant: {
          select: {
            name: true,
            cancellationWindowHours: true,
            operator: { select: { email: true, phone: true } },
          },
        },
      },
    })
    if (!reservation) {
      return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 })
    }
    if (!reservation.userId || reservation.userId !== token.sub) {
      return NextResponse.json(
        { error: 'Cette réservation n’est pas liée à votre compte.' },
        { status: 403 },
      )
    }

    if (reservation.status !== 'confirmed') {
      const why =
        reservation.status === 'cancelled'
          ? 'Cette réservation est déjà annulée.'
          : reservation.status === 'arrived' || reservation.status === 'overrun'
            ? 'Votre session est déjà en cours — adressez-vous au restaurant.'
            : 'Cette réservation ne peut plus être annulée en ligne.'
      return NextResponse.json({ error: why, code: 'not_cancellable' }, { status: 409 })
    }

    const windowHours = reservation.restaurant?.cancellationWindowHours ?? 2
    const deadline = new Date(reservation.date.getTime() - windowHours * 3_600_000)
    if (Date.now() > deadline.getTime()) {
      return NextResponse.json(
        {
          error: `L'annulation en ligne est possible jusqu'à ${windowHours} h avant la réservation. Contactez le restaurant.`,
          code:  'window_closed',
          windowHours,
          contactPhone: reservation.restaurant?.operator?.phone ?? null,
        },
        { status: 409 },
      )
    }

    // ── Bascule de statut GARDÉE contre la concurrence ───────────────────────
    // L'ancien flux lisait le statut puis faisait un update inconditionnel : une
    // course fine avec le passage 'arrived' côté restaurant pouvait annuler une
    // session déjà démarrée (et libérer son empreinte). updateMany conditionné
    // sur status:'confirmed' — 0 ligne touchée ⇒ l'état a bougé entre-temps ⇒
    // même 409 'not_cancellable' que le pré-check. L'empreinte n'est libérée
    // qu'APRÈS une annulation effectivement acquise.
    const flipped = await prisma.reservation.updateMany({
      where: { id: reservation.id, status: 'confirmed' },
      data:  { status: 'cancelled', cancelledBy: 'consumer' },
    })
    if (flipped.count === 0) {
      return NextResponse.json(
        { error: 'Cette réservation ne peut plus être annulée en ligne.', code: 'not_cancellable' },
        { status: 409 },
      )
    }
    const updated = { id: reservation.id, status: 'cancelled' as const, date: reservation.date }

    // ── Empreinte release — EXISTING lib, called only. Same best-effort rule
    // as the closures mass-cancel: a Stripe hiccup never blocks the guest's
    // cancellation right (the uncaptured hold expires on its own); the error
    // is surfaced so the operator can settle it manually if needed.
    let depositReleased = false
    let depositError: string | null = null
    if (
      reservation.stripePaymentIntentId &&
      reservation.depositStatus !== 'released' &&
      reservation.depositStatus !== 'captured'
    ) {
      try {
        const settle = await releaseHold(reservation.stripePaymentIntentId)
        if (settle.ok) {
          const depositStatusUpdate = settle.depositStatus ?? 'released'
          depositReleased = true
          // Tolerant second write: the cancellation is already durable; a failed
          // depositStatus stamp only loses the label, never the cancellation.
          try {
            await prisma.reservation.update({
              where: { id: reservation.id },
              data:  { depositStatus: depositStatusUpdate },
              select: { id: true },
            })
          } catch (stampErr) {
            console.error('[reservations cancel] depositStatus stamp failed (cancellation kept):',
              stampErr instanceof Error ? stampErr.message : stampErr)
          }
        } else {
          depositError = settle.error
        }
      } catch (e) {
        depositError = e instanceof Error ? e.message : 'release failed'
      }
    }

    // ── Transactional emails — POST-success, BEST-EFFORT (never throw).
    // Guest confirmation: reservation email OR the linked ACCOUNT's email
    // (Emails v2 FIX 1 — this route requires userId, so the account fallback
    // always exists in practice); nobody → traced 'skipped' EmailLog row.
    const restaurantName = reservation.restaurant?.name ?? 'votre restaurant'
    const guestEmail = await resolveReservationRecipient(reservation)
    if (guestEmail) {
      await sendReservationCancelledByClientToClient({
        to:             guestEmail,
        customerName:   reservation.customerName,
        restaurantName,
        date:           reservation.date,
        dedupeKey:      `resv:${reservation.id}`,
      })
    } else {
      await logEmailSkipped(
        'reservation_cancelled_by_client_client',
        `Annulation confirmée — ${restaurantName}`,
        { reservationId: reservation.id },
      )
    }
    const ownerEmail = reservation.restaurant?.operator?.email
    if (ownerEmail) {
      await sendReservationCancelledByClientToOwner({
        to:             ownerEmail,
        // This route requires userId (consumer self-cancel) → always an /eat
        // booking: the RESTAURANT sees the masked name only (founder model).
        customerName:   maskCustomerName(reservation.customerName),
        restaurantName,
        date:           reservation.date,
        guests:         reservation.guests,
        dedupeKey:      `resv:${reservation.id}`,
      })
    }

    return NextResponse.json({
      reservation: updated,
      deposit: {
        released: depositReleased,
        ...(depositError ? { error: depositError } : {}),
      },
    })
  } catch (err) {
    console.error('[POST /api/reservations/[id]/cancel]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
