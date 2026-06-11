import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { captureHold } from '@/lib/deposit'
import { ensureOpenTicket } from '@/lib/ticket'
import { loadHoursContext, slotFitsCtx } from '@/lib/opening-hours'
import { sendReservationCancelledByOwner, sendNoShowPenaltyCharged } from '@/lib/transactional-emails'
import { z } from 'zod'
import { Prisma } from '@prisma/client'

// Reads the session/cookie + may call Stripe (deposit settle on status change) →
// Node runtime, never statically prerendered.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Reject a reservation whose START is already in the past. A 5-minute grace
// window absorbs clock skew and "book for the current slot" cases — we block
// clearly-past times (hours earlier), not to-the-minute.
const PAST_GRACE_MS = 5 * 60 * 1000

// ── Validation ────────────────────────────────────────────────────────────────

const createSchema = z.object({
  // Must be a non-empty table id. When the room has no tables the form used to
  // submit an empty string, which slipped past validation and only failed at the
  // DB as a foreign-key violation surfaced as an opaque 500 ("Erreur serveur").
  tableId:      z.string().min(1, 'Sélectionnez une table.'),
  customerName: z.string().min(1).max(100),
  phone:        z.string().optional(),
  email:        z.string().email().optional(),
  guests:       z.number().int().min(1).max(30),
  date:         z.string().datetime(),
  // endTime is optional: when a durationMin is sent the server computes it; when
  // neither is sent the establishment default (else 60 min) is applied. A sent
  // endTime is kept for backward-compatibility with the current form.
  endTime:      z.string().datetime().optional(),
  // Optional per-reservation duration override (minutes). Wins over endTime.
  durationMin:  z.number().int().min(15).max(600).optional(),
  type:         z.enum(['quick', 'standard', 'full']).default('standard'),
  allergies:    z.array(z.string()).default([]),
  preOrder:     z.array(z.unknown()).default([]),
  depositAmount:z.number().min(0).default(0),
  noShowPenalty:z.number().min(0).default(0),
  notes:        z.string().max(500).optional(),
  // Optional explicit target establishment; verified against the caller below.
  // The reservation's establishment is ultimately taken from its TABLE, so this
  // only resolves scope for a legacy (NULL-restaurantId) table.
  restaurantId: z.string().min(1).optional(),
})

const patchSchema = z.object({
  id:      z.string(),
  status:  z.enum(['confirmed', 'arrived', 'overrun', 'cancelled', 'noshow']).optional(),
  depositPaid: z.boolean().optional(),
})

// ── GET /api/reservations?date= ──────────────────────────────────────────────
// Owner-scoped to the caller's CURRENT establishment (explicit ?restaurantId= if
// owned, else the selected-establishment cookie, else oldest).

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const dateStr  = searchParams.get('date')
    const explicit = searchParams.get('restaurantId')

    const scope = await resolveEstablishmentScope(explicit)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }
    if (!scope.restaurantId) {
      return NextResponse.json({ reservations: [] })
    }

    const where: Record<string, unknown> = { restaurantId: scope.restaurantId }

    if (dateStr) {
      const day   = new Date(dateStr)
      day.setHours(0, 0, 0, 0)
      const next  = new Date(day)
      next.setDate(day.getDate() + 1)
      where.date = { gte: day, lt: next }
    }

    const reservations = await prisma.reservation.findMany({
      where,
      include: { table: true },
      orderBy: { date: 'asc' },
    })

    return NextResponse.json({ reservations })
  } catch (err) {
    console.error('[GET /api/reservations]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── POST /api/reservations ────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { restaurantId: bodyRestaurantId, durationMin, endTime: bodyEndTime, ...data } =
      createSchema.parse(body)

    // Reject a slot that already started (server is the authority). Validated
    // before any DB work so a clearly-past booking fails fast and cheap.
    const start = new Date(data.date)
    if (start.getTime() < Date.now() - PAST_GRACE_MS) {
      return NextResponse.json(
        { error: 'Créneau déjà passé — choisissez un horaire à venir.' },
        { status: 400 },
      )
    }

    const scope = await resolveEstablishmentScope(bodyRestaurantId ?? null)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    // The table must exist before we create a reservation that references it.
    // A missing / stale tableId would otherwise hit a foreign-key violation that
    // bubbles up as a generic 500; return a clear 400 instead.
    const table = await prisma.restaurantTable.findUnique({
      where:  { id: data.tableId },
      select: { id: true, restaurantId: true, seats: true },
    })
    if (!table) {
      return NextResponse.json(
        { error: 'Table introuvable — créez ou sélectionnez une table avant de réserver.' },
        { status: 400 },
      )
    }

    // Capacity (V1: one reservation = one table). The party must fit on the chosen
    // table — never book more covers than the table seats. Server is the authority.
    if (data.guests > table.seats) {
      return NextResponse.json(
        {
          error: `Cette table a ${table.seats} place${table.seats > 1 ? 's' : ''}, vous demandez ${data.guests} couvert${data.guests > 1 ? 's' : ''}.`,
          code:  'capacity_exceeded',
        },
        { status: 400 },
      )
    }

    // The reservation belongs to the TABLE's establishment (source of truth). A
    // legacy table with no establishment yet falls back to the caller's current
    // scope. Either way the establishment MUST belong to the caller (owner-scope),
    // so a table from another operator can never be booked here.
    const resaRestaurantId = table.restaurantId ?? scope.restaurantId
    if (resaRestaurantId && !scope.ownedIds.includes(resaRestaurantId)) {
      return NextResponse.json({ error: 'Établissement non autorisé' }, { status: 403 })
    }

    // Resolve the slot end (server is the authority). Priority:
    //   1. an explicit per-reservation durationMin override,
    //   2. an endTime sent by the form (legacy / current behaviour),
    //   3. the establishment's default reservation duration, else 60 minutes.
    let endTime: Date
    if (durationMin != null) {
      endTime = new Date(start.getTime() + durationMin * 60_000)
    } else if (bodyEndTime) {
      endTime = new Date(bodyEndTime)
    } else {
      let defaultMin = 60
      if (resaRestaurantId) {
        const est = await prisma.restaurant.findUnique({
          where:  { id: resaRestaurantId },
          select: { defaultReservationDurationMin: true },
        })
        defaultMin = est?.defaultReservationDurationMin ?? 60
      }
      endTime = new Date(start.getTime() + defaultMin * 60_000)
    }

    // Check table availability over the resolved [start, endTime) slot.
    const conflict = await prisma.reservation.findFirst({
      where: {
        tableId: data.tableId,
        // 'completed' = session over (table freed) → must not block the slot.
        status:  { notIn: ['cancelled', 'noshow', 'completed'] },
        date:    { lt: endTime },
        endTime: { gt: start },
      },
    })

    if (conflict) {
      return NextResponse.json(
        { error: `Table déjà réservée de ${new Date(conflict.date).toTimeString().slice(0,5)} à ${new Date(conflict.endTime).toTimeString().slice(0,5)}` },
        { status: 409 },
      )
    }

    // Opening hours — NON-BLOCKING on the owner path (angle mort 3: the
    // restaurant is master of its own room — a private event on a closed Monday
    // is legitimate). The reservation IS created; when the slot falls outside the
    // configured hours / inside a closure, the response carries an explicit
    // hoursWarning the UI surfaces ("hors des horaires configurés — confirmer ?").
    // Public/consumer path stays STRICT (see /api/reservations/public). Best-
    // effort: a hours hiccup never blocks the owner's booking.
    let hoursWarning: { code: string; message: string } | null = null
    if (resaRestaurantId) {
      try {
        const durMin = Math.max(1, Math.round((endTime.getTime() - start.getTime()) / 60_000))
        const fit = slotFitsCtx(await loadHoursContext(resaRestaurantId), start, durMin)
        if (!fit.ok) {
          hoursWarning = {
            code: fit.code,
            message:
              fit.code === 'too_late'
                ? 'Créneau hors des horaires configurés : le repas dépasse l’heure de fermeture.'
                : `Créneau hors des horaires configurés${fit.code === 'closure' && fit.closure?.reason ? ` (fermeture : ${fit.closure.reason})` : ''}.`,
          }
        }
      } catch (e) {
        console.error('[POST /api/reservations] hours check failed (booking proceeds)', e instanceof Error ? e.message : e)
      }
    }

    const reservation = await prisma.reservation.create({
      data: {
        ...data,
        restaurantId: resaRestaurantId,
        date:     start,
        endTime,
        allergies: data.allergies as unknown as Prisma.InputJsonValue,
        preOrder:  data.preOrder  as unknown as Prisma.InputJsonValue,
      } as unknown as Prisma.ReservationUncheckedCreateInput,
      include: { table: true },
    })

    return NextResponse.json(
      { reservation, ...(hoursWarning ? { hoursWarning } : {}) },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    // Foreign-key / not-found at the DB level → a client data problem, not a
    // server fault. Surface a clean 400 rather than an opaque 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2003' || err.code === 'P2025')) {
      return NextResponse.json({ error: 'Table invalide — réservation impossible.' }, { status: 400 })
    }
    console.error('[POST /api/reservations]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

// ── PATCH /api/reservations ───────────────────────────────────────────────────
// Owner-scoped: the reservation must belong to one of the caller's establishments.

export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const { id, ...data } = patchSchema.parse(body)

    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) {
      return NextResponse.json({ error: scope.error }, { status: scope.status })
    }

    const existing = await prisma.reservation.findUnique({
      where:  { id },
      select: {
        restaurantId: true, stripePaymentIntentId: true,
        depositAmount: true, noShowPenalty: true,
      },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Réservation introuvable' }, { status: 404 })
    }
    if (existing.restaurantId && !scope.ownedIds.includes(existing.restaurantId)) {
      return NextResponse.json({ error: 'Réservation non autorisée' }, { status: 403 })
    }

    // Empreinte lifecycle (premium-table cycle, étape 2): the hold STAYS ACTIVE
    // from arrival until the bill is PAID. 'arrived' therefore NO LONGER releases
    // the empreinte (it used to call releaseHold here) — the only normal release
    // moment is the bill payment (webhook handleTicketPaid), and on an unpaid
    // walk-out the operator chooses capture/release at POST /api/tickets/[id]/close.
    // 'noshow' (the client never arrived) still captures the penalty here.
    const writeData: Record<string, unknown> = { ...data }
    let capturedCents: number | null = null
    if (existing.stripePaymentIntentId && data.status === 'noshow') {
      const settle = await captureHold(existing.stripePaymentIntentId, existing.noShowPenalty, existing.depositAmount)
      if (!settle.ok) {
        return NextResponse.json({ error: settle.error }, { status: settle.status })
      }
      if (settle.depositStatus) writeData.depositStatus = settle.depositStatus
      if (settle.depositStatus === 'captured') {
        writeData.depositPaid = true
        capturedCents = settle.capturedAmount ?? null
      }
    }

    const reservation = await prisma.reservation.update({
      where:   { id },
      data:    writeData,
      include: { table: true },
    })

    // ── Transactional emails v1 — POST-success, BEST-EFFORT (never throw) ────
    // (b) the RESTAURANT cancels → inform the client; (4) a no-show penalty was
    // actually captured → notify the client (amount + how to contest). Both
    // need the client's email — owner-typed reservations without one are
    // silently skipped (nothing to send).
    if ((data.status === 'cancelled' || (data.status === 'noshow' && capturedCents !== null)) && reservation.email) {
      try {
        const resto = reservation.restaurantId
          ? await prisma.restaurant.findUnique({ where: { id: reservation.restaurantId }, select: { name: true } })
          : null
        const restaurantName = resto?.name ?? 'votre restaurant'
        if (data.status === 'cancelled') {
          await sendReservationCancelledByOwner({
            to:             reservation.email,
            customerName:   reservation.customerName,
            restaurantName,
            date:           reservation.date,
          })
        } else if (capturedCents !== null) {
          await sendNoShowPenaltyCharged({
            to:             reservation.email,
            customerName:   reservation.customerName,
            restaurantName,
            capturedCents,
            date:           reservation.date,
          })
        }
      } catch (e) {
        console.error('[EMAIL MISS] [PATCH /api/reservations] context lookup failed',
          JSON.stringify({ reservationId: reservation.id, status: data.status }),
          e instanceof Error ? e.message : e)
      }
    }

    // Auto-open the SESSION ticket bound to THIS reservation when the operator marks
    // it 'arrived'. Best-effort: wrapped so a ticket hiccup can never break the
    // reservation update nor the empreinte release above. ensureOpenTicket binds the
    // ticket to THIS reservation; if the table still carries an UNPAID previous
    // service, it does NOT open a new ticket and returns a blocked signal — the
    // reservation still goes 'arrived' (the guest did arrive) but we surface a
    // ticketAlert so the dashboard tells the operator to settle/void the old bill.
    let ticketAlert: { code: string; existingTicketId: string; existingSubtotal: number } | null = null
    if (data.status === 'arrived' && reservation.restaurantId) {
      try {
        const res = await ensureOpenTicket({
          restaurantTableId: reservation.tableId,
          restaurantId:      reservation.restaurantId,
          reservationId:     reservation.id,
        })
        if (!res.ok) {
          ticketAlert = { code: res.code, existingTicketId: res.existingTicketId, existingSubtotal: res.existingSubtotal }
        }
      } catch (e) {
        console.error('[PATCH /api/reservations] auto-open ticket failed', e instanceof Error ? e.message : e)
      }
    }

    return NextResponse.json({ reservation, ...(ticketAlert ? { ticketAlert } : {}) })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[PATCH /api/reservations]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
