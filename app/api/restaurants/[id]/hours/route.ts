import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { isValidTime, toMin } from '@/lib/opening-hours'

export const dynamic = 'force-dynamic'

// ── /api/restaurants/[id]/hours — weekly opening hours (owner-scoped) ──────────
// GET returns the full weekly set (one entry per range). PUT REPLACES the whole
// set atomically (the UI edits the grid and saves it as one unit — no per-range
// PATCH juggling). An empty `hours` array un-configures the establishment →
// back to the "no restriction" behaviour (T1.Q3).

const rangeSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6), // 0=dimanche … 6=samedi (JS getDay)
  openTime:  z.string(),
  closeTime: z.string(),
  // V1: always 'all' (per-channel hours are a future, the column already exists).
  channel:   z.literal('all').optional(),
})
const putSchema = z.object({ hours: z.array(rangeSchema).max(50) })

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(params.id)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const hours = await prisma.openingHour.findMany({
      where:   { restaurantId: params.id },
      select:  { id: true, dayOfWeek: true, openTime: true, closeTime: true, channel: true },
      orderBy: [{ dayOfWeek: 'asc' }, { openTime: 'asc' }],
    })
    return NextResponse.json({ hours, configured: hours.length > 0 })
  } catch (err) {
    console.error('[GET /api/restaurants/[id]/hours]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(params.id)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const { hours } = putSchema.parse(await req.json())

    // Per-range validation: "HH:mm" times ("24:00" allowed as a close — 24/7 day),
    // open ≠ close. closeTime < openTime is VALID (overnight, ends next day).
    for (const h of hours) {
      if (!isValidTime(h.openTime) || !isValidTime(h.closeTime, true)) {
        return NextResponse.json({ error: 'Heure invalide (format HH:mm).' }, { status: 400 })
      }
      if (toMin(h.openTime) === toMin(h.closeTime)) {
        return NextResponse.json({ error: 'Une plage ne peut pas ouvrir et fermer à la même heure.' }, { status: 400 })
      }
    }

    // No overlap between ranges of the SAME day (an overnight range occupies
    // [open, close+24h) on its starting day).
    for (let d = 0; d < 7; d++) {
      const day = hours
        .filter(h => h.dayOfWeek === d)
        .map(h => {
          const open = toMin(h.openTime), close = toMin(h.closeTime)
          return { open, closeAbs: close > open ? close : close + 1440 }
        })
        .sort((a, b) => a.open - b.open)
      for (let i = 1; i < day.length; i++) {
        if (day[i].open < day[i - 1].closeAbs) {
          return NextResponse.json(
            { error: 'Deux plages du même jour se chevauchent — ajustez les horaires.' },
            { status: 400 },
          )
        }
      }
    }

    // Atomic full replacement.
    await prisma.$transaction([
      prisma.openingHour.deleteMany({ where: { restaurantId: params.id } }),
      ...(hours.length
        ? [prisma.openingHour.createMany({
            data: hours.map(h => ({
              restaurantId: params.id,
              dayOfWeek:    h.dayOfWeek,
              openTime:     h.openTime,
              closeTime:    h.closeTime,
              channel:      'all',
            })),
          })]
        : []),
    ])

    const saved = await prisma.openingHour.findMany({
      where:   { restaurantId: params.id },
      select:  { id: true, dayOfWeek: true, openTime: true, closeTime: true, channel: true },
      orderBy: [{ dayOfWeek: 'asc' }, { openTime: 'asc' }],
    })
    return NextResponse.json({ hours: saved, configured: saved.length > 0 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[PUT /api/restaurants/[id]/hours]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
