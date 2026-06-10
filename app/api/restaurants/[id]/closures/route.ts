import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { isValidTime, toMin } from '@/lib/opening-hours'

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
    return NextResponse.json({ closure }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/restaurants/[id]/closures]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
