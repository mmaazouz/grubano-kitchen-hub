import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'

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
        status:  { notIn: ['cancelled', 'noshow'] },
        date:    { lt: endTime },
        endTime: { gt: start },
      },
      select: { tableId: true },
    })
    const taken = new Set(conflicts.map((c) => c.tableId))
    // Prefer the smallest table that still seats `guests`, then any free one.
    const ranked = [...tables]
      .filter((tab) => !taken.has(tab.id))
      .sort((a, b) => {
        const aOk = a.seats >= data.guests ? 0 : 1
        const bOk = b.seats >= data.guests ? 0 : 1
        if (aOk !== bOk) return aOk - bOk
        return a.seats - b.seats
      })
    const picked = ranked[0]
    if (!picked) {
      return NextResponse.json(
        { error: 'Créneau complet', code: 'slot_taken' },
        { status: 409 },
      )
    }

    const reservation = await prisma.reservation.create({
      data: {
        restaurantId: restaurant.id,
        tableId:      picked.id,
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

    return NextResponse.json(
      {
        reservation: {
          id:            reservation.id,
          restaurantId:  reservation.restaurantId,
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
