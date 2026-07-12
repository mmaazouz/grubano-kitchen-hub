import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { rateLimit } from '@/lib/rate-limit'
import { authOptions } from '@/lib/auth'
import { loadHoursContext, slotFitsCtx } from '@/lib/opening-hours'
import { reservationCode } from '@/lib/reservation-code'
import { maskCustomerName } from '@/lib/customer-scope'
import { sendReservationConfirmation, sendRestaurantNewReservationEmail } from '@/lib/transactional-emails'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

// nodemailer (transactional confirmation) needs the Node runtime.
export const runtime = 'nodejs'

// ── POST /api/reservations/public ─────────────────────────────────────────────
// PUBLIC consumer reservation endpoint (no auth). Agent 13 step 1 of payment V1:
// the owner-scoped POST /api/reservations requires a tableId AND a session, so
// it can't drive the public conso flow on /eat/r/[id]/reserver. This wrapper:
//
//   1. validates restaurantId + date + guests + contact details,
//   2. confirms the restaurant is active and not archived (Agent 2's archivedAt
//      rule — same as availability),
//   3. enforces the same 5-min past-slot grace as POST /api/reservations and
//      GET /api/reservations/availability,
//   4. auto-picks a FREE active table for that slot using the EXACT same
//      anti-double-booking overlap as availability (`r.date < end && r.endTime
//      > start`), so a slot that availability reports `available:true` will
//      atomically succeed unless taken between calls (then 409),
//   5. creates the reservation with status='confirmed', depositPaid=false, and
//      the establishment-level depositAmount already configured on Restaurant
//      (Agent 2's V1 — montant fixé serveur ; depositAmount=0 ⇒ skip Stripe).
//
// Returns 201 { reservation: { id, depositAmount, restaurantId, tableName,
// date, endTime, status, guests, customerName } }. The client uses `id` to
// kick off POST /api/reservations/[id]/deposit (Agent 2) when depositAmount>0.

export const dynamic = 'force-dynamic'

const PAST_GRACE_MS = 5 * 60 * 1000

const schema = z.object({
  restaurantId: z.string().min(1),
  // ISO-8601 datetime — the date+time the consumer picked.
  date:         z.string().min(1),
  guests:       z.number().int().min(1).max(30),
  customerName: z.string().min(1).max(100),
  email:        z.string().email().optional(),
  phone:        z.string().min(1).max(40).optional(),
  // Optional override; otherwise the establishment default is used (60 fb).
  durationMin:  z.number().int().min(15).max(600).optional(),
})

export async function POST(req: Request) {
  try {
    const limited = rateLimit(req, 'reservation_public', { limitDefault: 20, windowDefault: 60 })
    if (limited) return limited

    const body = await req.json().catch(() => null)
    if (!body) {
      return NextResponse.json({ error: 'Corps invalide' }, { status: 400 })
    }
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'Données invalides' },
        { status: 400 },
      )
    }
    const data = parsed.data

    // Past-slot guard (same grace as /api/reservations + /availability).
    const start = new Date(data.date)
    if (Number.isNaN(start.getTime())) {
      return NextResponse.json({ error: 'date invalide' }, { status: 400 })
    }
    if (start.getTime() < Date.now() - PAST_GRACE_MS) {
      return NextResponse.json(
        { error: 'Créneau déjà passé — choisissez un horaire à venir.', code: 'slot_past' },
        { status: 400 },
      )
    }

    // Restaurant must exist + be active + not archived (Agent 2 honesty: a
    // soft-archived resto is inert publicly).
    const restaurant = await prisma.restaurant.findFirst({
      where:  { id: data.restaurantId, isActive: true, archivedAt: null },
      select: {
        id: true,
        name: true,
        defaultReservationDurationMin: true,
        defaultDepositAmount: true,
      },
    })
    if (!restaurant) {
      return NextResponse.json({ error: 'Établissement introuvable' }, { status: 404 })
    }

    // Per-establishment guarantee deposit (empreinte). Configured by the operator
    // via /api/restaurants/[id]/fulfillment (defaultDepositAmount); falls back to
    // 10 € for any legacy row. Mohammed's decision: ONE amount per resto, and the
    // no-show penalty = 100 % of it (so noShowPenalty is set equal to the deposit
    // on the row — captureHold then captures the full empreinte at no-show).
    const depositEur = restaurant.defaultDepositAmount ?? 10

    // Slot end — explicit duration override > establishment default > 60.
    const durationMin = data.durationMin ?? restaurant.defaultReservationDurationMin ?? 60
    const endTime     = new Date(start.getTime() + durationMin * 60_000)

    // Opening hours — STRICT on the public path (Chantier horaires). When the
    // establishment configured its hours, the requested slot must start inside an
    // open range, clear of any closure exception, and start ≤ close − duration
    // (T3.Q2). Not configured → no restriction (T1.Q3). Booking a FUTURE open
    // slot while the restaurant is currently closed stays possible — only the
    // SLOT's own hours matter here (T3.Q3).
    const hoursCtx = await loadHoursContext(restaurant.id)
    const fit = slotFitsCtx(hoursCtx, start, durationMin)
    if (!fit.ok) {
      const reason = fit.code === 'closure' && fit.closure?.reason ? ` (${fit.closure.reason})` : ''
      const error =
        fit.code === 'too_late'
          ? 'Ce créneau est trop proche de la fermeture pour la durée du repas — choisissez un horaire plus tôt.'
          : `L'établissement est fermé à cet horaire${reason} — choisissez un autre créneau.`
      return NextResponse.json(
        { error, code: fit.code === 'closure' ? 'closed' : 'hors_horaires' },
        { status: 409 },
      )
    }

    // All active tables. Empty list ⇒ the operator hasn't set up any table
    // for at-table reservations yet → 409 "no tables".
    const tables = await prisma.restaurantTable.findMany({
      where:  { restaurantId: restaurant.id, active: true },
      select: { id: true, name: true, seats: true },
    })
    if (tables.length === 0) {
      return NextResponse.json(
        { error: 'Aucune table configurée', code: 'no_tables' },
        { status: 409 },
      )
    }

    // Anti-double-booking — load all overlapping reservations on this resto's
    // tables in ONE query, then pick the first table free for the slot.
    const conflicts = await prisma.reservation.findMany({
      where: {
        tableId: { in: tables.map((t) => t.id) },
        // 'completed' = session over (table freed) → must not block the slot.
        status:  { notIn: ['cancelled', 'noshow', 'completed'] },
        date:    { lt: endTime },
        endTime: { gt: start },
      },
      select: { tableId: true },
    })
    const taken = new Set(conflicts.map((c) => c.tableId))

    // Capacity (V1: one reservation = one table). NEVER seat a party on a table
    // smaller than it. If no table is big enough at all → clear 400; otherwise
    // pick the SMALLEST free table that seats the whole party.
    const maxSeats = Math.max(...tables.map((t) => t.seats))
    if (data.guests > maxSeats) {
      return NextResponse.json(
        {
          error: `Nos tables accueillent au maximum ${maxSeats} couvert${maxSeats > 1 ? 's' : ''} (vous demandez ${data.guests}).`,
          code:  'capacity_exceeded',
        },
        { status: 400 },
      )
    }
    const ranked = tables
      .filter((tab) => tab.seats >= data.guests && !taken.has(tab.id))
      .sort((a, b) => a.seats - b.seats)
    const picked = ranked[0]
    if (!picked) {
      // Big-enough tables exist but they are all taken for this slot.
      return NextResponse.json(
        { error: 'Créneau complet', code: 'slot_taken' },
        { status: 409 },
      )
    }

    // Link the reservation to the consumer's ACCOUNT when they booked while logged
    // in (session.user.id = Operator.id). null for anonymous bookings (still allowed,
    // but only payable via the open QR channel — not the app/account channel). This
    // is a PUBLIC endpoint: getServerSession simply returns null when no cookie.
    const session = await getServerSession(authOptions)
    const userId = (session?.user as { id?: string } | undefined)?.id ?? null

    const reservation = await prisma.reservation.create({
      data: {
        restaurantId: restaurant.id,
        tableId:      picked.id,
        userId,
        // Masquage PII /eat: mark the booking as CONSUMER-made so every operator
        // surface masks the name and hides phone/email (founder hybrid model).
        source:       'eat',
        date:         start,
        endTime,
        guests:       data.guests,
        customerName: data.customerName,
        email:        data.email,
        phone:        data.phone,
        status:       'confirmed',
        type:         'standard',
        // Server-side authoritative deposit amount — the client can't
        // influence it. Agent 2's deposit POST will use the same value
        // (depositAmount on the row, not on the body). noShowPenalty is set
        // equal to the deposit so a no-show capture takes 100 % of the empreinte.
        depositAmount: depositEur,
        noShowPenalty: depositEur,
        depositPaid:   false,
        // Empty JSON columns — Prisma rejects undefined for Json @default("[]").
        allergies: [] as unknown as Prisma.InputJsonValue,
        preOrder:  [] as unknown as Prisma.InputJsonValue,
      } as unknown as Prisma.ReservationUncheckedCreateInput,
      include: { table: { select: { id: true, name: true } } },
    })

    // ── Confirmation email (transactional v1) — POST-success, BEST-EFFORT ────
    // sendReservationConfirmation never throws (its failures land in
    // [EMAIL MISS] + EmailLog). No email on the booking → nothing to send.
    if (data.email) {
      await sendReservationConfirmation({
        to:             data.email,
        customerName:   data.customerName,
        restaurantName: restaurant.name,
        date:           reservation.date,
        guests:         reservation.guests,
        code:           reservationCode(reservation.id),
        depositEur,
        dedupeKey:      `resv:${reservation.id}`,
      })
    }

    // Email B2 (Agent 143) — also notify the RESTAURANT of the new reservation. POST-create,
    // BEST-EFFORT, idempotent via sendOnce (trigger resto_reservation_received, dedupeKey resv:<id>).
    // Independent of the guest email above — the resto is notified even for an anonymous booking.
    try {
      const owner = await prisma.restaurant.findUnique({
        where:  { id: restaurant.id },
        select: { operator: { select: { email: true } } },
      })
      const ownerEmail = owner?.operator?.email
      if (ownerEmail) {
        await sendRestaurantNewReservationEmail({
          reservationId:  reservation.id,
          to:             ownerEmail,
          restaurantName: restaurant.name,
          // /eat booking → the RESTAURANT sees the masked name only (the guest's
          // own confirmation email above keeps the full name — it goes TO them).
          customerName:   maskCustomerName(data.customerName),
          date:           reservation.date,
          guests:         reservation.guests,
          code:           reservationCode(reservation.id),
        })
      }
    } catch (e) {
      console.error('[EMAIL MISS] [reservations/public] restaurant new-reservation email failed (non-fatal):',
        reservation.id, e instanceof Error ? e.message : e)
    }

    return NextResponse.json(
      {
        reservation: {
          id:            reservation.id,
          restaurantId:  reservation.restaurantId,
          tableId:       picked.id,
          tableName:     reservation.table?.name ?? picked.name,
          date:          reservation.date.toISOString(),
          endTime:       reservation.endTime.toISOString(),
          status:        reservation.status,
          guests:        reservation.guests,
          customerName:  reservation.customerName,
          depositAmount: reservation.depositAmount,
        },
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[POST /api/reservations/public]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
