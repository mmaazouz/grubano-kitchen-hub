import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { releaseHold } from '@/lib/deposit'
import { isValidTime, toMin, localParts, dateOnly } from '@/lib/opening-hours'

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

    // ── Conflict detection (T3.Q1) ───────────────────────────────────────────
    // FUTURE reservations (confirmed | arrived) whose slot falls inside the
    // closure: start on a covered local day, and — for a PARTIAL closure — the
    // reservation slot overlaps the closed [startTime, endTime) window that day.
    // A guest is NEVER silently dropped: without confirm, conflicts are returned
    // and NOTHING is created; with confirm:true the closure is created, each
    // conflicting reservation is cancelled (cancelReason 'closure') and its
    // empreinte released via lib/deposit.releaseHold (called, never modified —
    // idempotent) so the client is never charged for the restaurant's closure.
    const now = new Date()
    const candidates = await prisma.reservation.findMany({
      where: {
        restaurantId: params.id,
        status:       { in: ['confirmed', 'arrived'] },
        date:         { gte: now },
      },
      select: {
        id: true, customerName: true, date: true, endTime: true,
        status: true, depositStatus: true, stripePaymentIntentId: true,
      },
      orderBy: { date: 'asc' },
    })
    const winStart = partial ? toMin(data.startTime!) : 0
    const winEnd   = partial ? toMin(data.endTime!)   : 1440
    const conflicts = candidates.filter((r) => {
      const p = localParts(r.date)
      if (p.dateStr < data.dateStart || p.dateStr > data.dateEnd) return false
      if (!partial) return true
      // Same-local-day overlap between the reservation slot and the closed window.
      const endMin = Math.min(1440, p.minutes + Math.max(1, Math.round((r.endTime.getTime() - r.date.getTime()) / 60_000)))
      return p.minutes < winEnd && endMin > winStart
    })

    if (conflicts.length > 0 && !data.confirm) {
      // PREVIEW: nothing is created. Agent 13's modal shows the recap then
      // re-POSTs the same body with confirm:true.
      return NextResponse.json({
        created: false,
        conflicts: {
          count: conflicts.length,
          reservations: conflicts.map((r) => ({
            id:            r.id, // the UI derives the short session code from it
            customerName:  r.customerName,
            date:          r.date.toISOString(),
            status:        r.status,
            depositStatus: r.depositStatus,
          })),
        },
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
    let cancelled = 0
    let depositsReleased = 0
    const errors: Array<{ reservationId: string; error: string }> = []
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
      } catch (e) {
        errors.push({ reservationId: r.id, error: e instanceof Error ? e.message : 'cancel failed' })
      }
    }
    // V1 limit (assumed, T3.Q1): no cancellation email yet — flagged priority 1
    // of the transactional-emails chantier. The client sees the cancellation in
    // the app (status + cancelReason exposed by the existing endpoints).

    return NextResponse.json(
      {
        created: true,
        closure,
        cancelled,
        depositsReleased,
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
