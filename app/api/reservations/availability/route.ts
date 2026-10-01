import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { loadHoursContext, slotFitsCtx } from '@/lib/opening-hours'

// Reads query/DB → never static.
export const dynamic = 'force-dynamic'

const PAST_GRACE_MS = 5 * 60 * 1000 // same grace as POST /api/reservations
const pad = (n: number) => String(n).padStart(2, '0')
const clampInt = (raw: string | null, min: number, max: number, def: number) => {
  const n = parseInt(raw ?? '', 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}

// ── GET /api/reservations/availability?restaurantId=&date=YYYY-MM-DD ───────────
// PUBLIC, read-only. Bookable slots for a restaurant on a given day, REUSING the
// existing reservation rules: active tables, defaultReservationDurationMin, the
// anti-double-booking overlap, and the past-slot refusal. Optional ?from=&to=
// (hours) and ?step= (minutes) tune the service window. Returns ONLY slot
// availability + free-table counts — never any private data (no names/emails).
//
// Note (V1): a fixed service window + server-local slot times. Opening-hours and
// timezone handling are later refinements.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const restaurantId = searchParams.get('restaurantId')
    const date = searchParams.get('date')
    if (!restaurantId || !date) {
      return NextResponse.json({ error: 'restaurantId et date requis' }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: 'date invalide (format YYYY-MM-DD)' }, { status: 400 })
    }

    const fromH = clampInt(searchParams.get('from'), 0, 23, 11)
    const toH   = clampInt(searchParams.get('to'),   1, 24, 23)
    const step  = clampInt(searchParams.get('step'), 15, 120, 30)

    // The restaurant must exist, be active, and not archived (no leak otherwise).
    const restaurant = await prisma.restaurant.findFirst({
      where:  { id: restaurantId, isActive: true, archivedAt: null },
      select: { id: true, defaultReservationDurationMin: true },
    })
    if (!restaurant) {
      return NextResponse.json({ error: 'Établissement introuvable' }, { status: 404 })
    }
    const durationMin = restaurant.defaultReservationDurationMin ?? 60

    // Opening hours (Chantier horaires). Loaded ONCE; not configured → every
    // slot passes (current behaviour). Configured → a slot is only proposed when
    // its START falls inside an open range, no closure exception blocks it, and
    // start ≤ close − duration (T3.Q2) — ADDED to the existing rules below
    // (capacity, anti-double-booking, past refusal), never replacing them.
    const hoursCtx = await loadHoursContext(restaurantId)

    const tables = await prisma.restaurantTable.findMany({
      where:  { restaurantId, active: true },
      select: { id: true, seats: true },
    })
    // Capacity ceiling: the largest single table (V1 = one reservation = one
    // table). Exposed so the consumer UI can cap the covers selector.
    const maxTableSeats = tables.reduce((max, t) => Math.max(max, t.seats), 0)

    // The day's live reservations for those tables (exclude cancelled/no-show).
    const dayStart = new Date(`${date}T00:00:00`)
    const dayEnd   = new Date(dayStart); dayEnd.setDate(dayStart.getDate() + 1)
    const reservations = tables.length === 0
      ? []
      : await prisma.reservation.findMany({
          where: {
            tableId: { in: tables.map(t => t.id) },
            // 'completed' = the session is over (bill paid / table closed) → the
            // table is free again and must NOT block the slot.
            status:  { notIn: ['cancelled', 'noshow', 'completed'] },
            date:    { gte: dayStart, lt: dayEnd },
          },
          select: { tableId: true, date: true, endTime: true },
        })

    const now = Date.now()
    const slots: { time: string; available: boolean; freeTables: number }[] = []
    for (let mins = fromH * 60; mins < toH * 60; mins += step) {
      const h = Math.floor(mins / 60)
      const m = mins % 60
      const slotStart = new Date(`${date}T${pad(h)}:${pad(m)}:00`)
      const slotEnd   = new Date(slotStart.getTime() + durationMin * 60_000)
      const past      = slotStart.getTime() < now - PAST_GRACE_MS
      const withinHours = slotFitsCtx(hoursCtx, slotStart, durationMin).ok

      let freeTables = 0
      if (!past && withinHours) {
        for (const t of tables) {
          // overlap = same anti-double-booking rule as POST /api/reservations
          const busy = reservations.some(
            r => r.tableId === t.id && r.date < slotEnd && r.endTime > slotStart,
          )
          if (!busy) freeTables++
        }
      }

      slots.push({ time: `${pad(h)}:${pad(m)}`, available: !past && withinHours && freeTables > 0, freeTables })
    }

    return NextResponse.json({
      restaurantId, date, durationMin, totalTables: tables.length, maxTableSeats, slots,
      // Additive: lets the booking UI explain WHY a day shows no slots.
      hoursConfigured: hoursCtx.configured,
    })
  } catch (err) {
    console.error('[GET /api/reservations/availability]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
