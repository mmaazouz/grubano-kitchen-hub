import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { releaseHold } from '@/lib/deposit'
import { isValidTime, toMin, localParts, dateOnly } from '@/lib/opening-hours'
import { isEatReservation, maskCustomerName } from '@/lib/customer-scope'
import {
  sendReservationCancelledByClosure,
  resolveReservationRecipient,
  logEmailSkipped,
} from '@/lib/transactional-emails'

// releaseHold reads the live Stripe PI → Node runtime.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/restaurants/[id]/closures — exceptional closures (owner-scoped) ───────
// GET lists the establishment's closure exceptions (upcoming first). POST creates
// one: whole covered days by default, or a PARTIAL daily window when startTime +
// endTime are both set. `reason` (≤140) is PUBLIC — shown to consumers (T2.Q2).

const postSchema = z.object({
  dateStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateStart invalide (YYYY-MM-DD)'),
  dateEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'dateEnd invalide (YYYY-MM-DD)'),
  startTime: z.string().optional(),
  endTime:   z.string().optional(),
  reason:    z.string().max(140, 'Motif trop long (140 caractères max).').optional(),
  // Conflict flow (T3.Q1): without confirm, a POST that collides with existing
  // reservations returns the conflict list WITHOUT creating anything; with
  // confirm:true the closure is created and the conflicting reservations are
  // cancelled + their empreintes released.
  confirm:   z.boolean().optional(),
})

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(params.id)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const closures = await prisma.closureException.findMany({
      where:   { restaurantId: params.id },
      select:  { id: true, type: true, dateStart: true, dateEnd: true, startTime: true, endTime: true, reason: true, createdAt: true },
      orderBy: { dateStart: 'desc' },
    })
    return NextResponse.json({ closures })
  } catch (err) {
    console.error('[GET /api/restaurants/[id]/closures]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(params.id)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const data = postSchema.parse(await req.json())

    if (data.dateEnd < data.dateStart) {
      return NextResponse.json({ error: 'La date de fin précède la date de début.' }, { status: 400 })
    }
    // Partial window: BOTH times or NEITHER; coherent same-day window.
    const partial = Boolean(data.startTime || data.endTime)
    if (partial) {
      if (!data.startTime || !data.endTime) {
        return NextResponse.json({ error: 'Fermeture partielle : renseignez heure de début ET de fin.' }, { status: 400 })
      }
      if (!isValidTime(data.startTime) || !isValidTime(data.endTime, true)) {
        return NextResponse.json({ error: 'Heure invalide (format HH:mm).' }, { status: 400 })
      }
      if (toMin(data.endTime) <= toMin(data.startTime)) {
        return NextResponse.json({ error: "L'heure de fin doit être après l'heure de début." }, { status: 400 })
      }
    }

    // ── Conflict detection (T3.Q1, fixed: an ONGOING session is never cut) ────
    // A closure governs ENTRY (new bookings/orders) — it NEVER cuts a meal in
    // progress ("la session fait foi"). So:
    //   • CANCELLABLE = FUTURE 'confirmed' reservations whose slot falls inside
    //     the closure (covered local day; for a PARTIAL closure, slot overlapping
    //     the closed window). With confirm:true these are cancelled + their
    //     empreinte released (lib/deposit.releaseHold — called, never modified).
    //   • ONGOING = 'arrived' sessions (guest physically at the table, bill open)
    //     matching the closure: INFORMATIVE ONLY. Never cancelled, never
    //     released — they order, pay and close normally, even with confirm:true.
    //     (No date>=now filter here: an in-progress session STARTED in the past;
    //     endTime>=now keeps long-finished stale rows out of the list.)
    // A guest is NEVER silently dropped: without confirm, anything to show
    // (cancellable OR ongoing) returns a preview and NOTHING is created.
    const now = new Date()
    const candidates = await prisma.reservation.findMany({
      where: {
        restaurantId: params.id,
        OR: [
          { status: 'confirmed', date:    { gte: now } },
          { status: 'arrived',   endTime: { gte: now } },
        ],
      },
      select: {
        id: true, customerName: true, email: true, userId: true, source: true, date: true, endTime: true,
        status: true, depositStatus: true, stripePaymentIntentId: true,
      },
      orderBy: { date: 'asc' },
    })
    const winStart = partial ? toMin(data.startTime!) : 0
    const winEnd   = partial ? toMin(data.endTime!)   : 1440
    const matching = candidates.filter((r) => {
      const p = localParts(r.date)
      if (p.dateStr < data.dateStart || p.dateStr > data.dateEnd) return false
      if (!partial) return true
      // Same-local-day overlap between the reservation slot and the closed window.
      const endMin = Math.min(1440, p.minutes + Math.max(1, Math.round((r.endTime.getTime() - r.date.getTime()) / 60_000)))
      return p.minutes < winEnd && endMin > winStart
    })
    const conflicts = matching.filter((r) => r.status === 'confirmed')
    const ongoing   = matching.filter((r) => r.status === 'arrived')

    const toPublic = (r: (typeof matching)[number]) => ({
      id:            r.id, // the UI derives the short session code from it
      // Masquage PII /eat: consumer bookings reach the operator masked.
      customerName:  isEatReservation(r) ? maskCustomerName(r.customerName) : r.customerName,
      date:          r.date.toISOString(),
      status:        r.status,
      depositStatus: r.depositStatus,
    })

    if ((conflicts.length > 0 || ongoing.length > 0) && !data.confirm) {
      // PREVIEW: nothing is created. Agent 13's modal shows the recap ("X résas
      // seront annulées" + "Y session(s) en cours se termineront normalement")
      // then re-POSTs the same body with confirm:true.
      return NextResponse.json({
        created: false,
        conflicts: { count: conflicts.length, reservations: conflicts.map(toPublic) },
        ongoing:   { count: ongoing.length,   reservations: ongoing.map(toPublic) },
      })
    }

    const closure = await prisma.closureException.create({
      data: {
        restaurantId: params.id,
        type:         'closed',
        dateStart:    new Date(`${data.dateStart}T00:00:00.000Z`),
        dateEnd:      new Date(`${data.dateEnd}T00:00:00.000Z`),
        startTime:    partial ? data.startTime : null,
        endTime:      partial ? data.endTime : null,
        reason:       data.reason?.trim() || null,
      },
      select: { id: true, type: true, dateStart: true, dateEnd: true, startTime: true, endTime: true, reason: true },
    })

    // ── Mass cancellation (confirmed) — best-effort PER reservation ───────────
    // One failing release never blocks the others; every failure is surfaced.
    // The reservation is cancelled EVEN IF its release fails (the closure is a
    // fact) — the error tells the operator to settle that hold manually.
    // ONLY `conflicts` (future 'confirmed') is iterated: the `ongoing` 'arrived'
    // sessions are deliberately NOT in this loop — never cancelled, never released.
    let cancelled = 0
    let depositsReleased = 0
    const errors: Array<{ reservationId: string; error: string }> = []
    // Restaurant display name for the cancellation emails — fetched ONCE,
    // best-effort (a lookup failure falls back to a generic label, it never
    // blocks the cancellations).
    let restaurantNameForEmails = 'votre restaurant'
    if (conflicts.length > 0) {
      try {
        const resto = await prisma.restaurant.findUnique({ where: { id: params.id }, select: { name: true } })
        if (resto?.name) restaurantNameForEmails = resto.name
      } catch { /* keep the generic label */ }
    }
    for (const r of conflicts) {
      let depositStatusUpdate: string | null = null
      if (r.stripePaymentIntentId && r.depositStatus !== 'released' && r.depositStatus !== 'captured') {
        try {
          const settle = await releaseHold(r.stripePaymentIntentId)
          if (settle.ok) {
            depositStatusUpdate = settle.depositStatus ?? 'released'
            depositsReleased++
          } else {
            errors.push({ reservationId: r.id, error: settle.error })
          }
        } catch (e) {
          errors.push({ reservationId: r.id, error: e instanceof Error ? e.message : 'release failed' })
        }
      }
      try {
        await prisma.reservation.update({
          where: { id: r.id },
          data:  {
            status:       'cancelled',
            cancelReason: 'closure',
            ...(depositStatusUpdate ? { depositStatus: depositStatusUpdate } : {}),
          },
        })
        cancelled++
        // ── Transactional email (Emails v2 FIX 2) — POST-success, BEST-EFFORT
        // (never throws). EVERY guest the closure cancelled is informed, with
        // the dedicated trigger reservation_cancelled_by_closure + the PUBLIC
        // reason. Recipient = reservation email OR the linked ACCOUNT's email
        // (FIX 1 — the v1 hook depended on the reservation's typed email only,
        // and skipped SILENTLY when it was empty: that's why a partial closure
        // produced zero EmailLog lines). Nobody → traced 'skipped' row.
        const guestEmail = await resolveReservationRecipient(r)
        if (guestEmail) {
          await sendReservationCancelledByClosure({
            to:             guestEmail,
            customerName:   r.customerName,
            restaurantName: restaurantNameForEmails,
            date:           r.date,
            closureReason:  data.reason?.trim() || null,
            dedupeKey:      `resv:${r.id}`,
          })
        } else {
          await logEmailSkipped(
            'reservation_cancelled_by_closure',
            `Votre réservation a été annulée — fermeture exceptionnelle de ${restaurantNameForEmails}`,
            { reservationId: r.id },
          )
        }
      } catch (e) {
        errors.push({ reservationId: r.id, error: e instanceof Error ? e.message : 'cancel failed' })
      }
    }

    return NextResponse.json(
      {
        created: true,
        closure,
        cancelled,
        depositsReleased,
        // Informative recap: the in-progress sessions the closure did NOT touch
        // (they finish normally — order, pay, close as usual).
        ongoing: { count: ongoing.length, reservations: ongoing.map(toPublic) },
        ...(errors.length ? { errors } : {}),
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/restaurants/[id]/closures]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
