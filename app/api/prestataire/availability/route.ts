import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { isPrestataireEnabled, callerPrestataireProfile } from '@/lib/prestataire-account'
import { normalizeWeekdays, isValidPeriod } from '@/lib/availability'

export const dynamic = 'force-dynamic'

// ── /api/prestataire/availability — the prestataire's OWN declared availability (P4) ──
// SIMPLE + DECLARATIVE. GET reads the caller's working weekdays + note + leave periods.
// PATCH sets the declared weekdays + free-text note. POST adds a leave/holiday period;
// DELETE removes one. Everything is owner-scoped to the caller's PrestataireProfile (from the
// SESSION via callerPrestataireProfile) — never a client-supplied id → no IDOR. 404 when
// PRESTATAIRE_ENABLED is OFF. NO bookable slots / NO conflict detection. NO money.

const NOT_FOUND = NextResponse.json({ error: 'Not found' }, { status: 404 })
const UNAUTH    = NextResponse.json({ error: 'Profil prestataire introuvable' }, { status: 401 })

const declareSchema = z.object({
  availableWeekdays: z.array(z.string()).max(7).default([]),
  availabilityNote:  z.string().max(1000).nullish(),
})
const periodSchema = z.object({
  startDate: z.string().datetime(),
  endDate:   z.string().datetime(),
  reason:    z.string().max(300).nullish(),
})

export async function GET() {
  if (!isPrestataireEnabled()) return NOT_FOUND
  const profile = await callerPrestataireProfile()
  if (!profile) return UNAUTH
  const [p, unavailabilities] = await Promise.all([
    prisma.prestataireProfile.findUnique({ where: { id: profile.id }, select: { availableWeekdays: true, availabilityNote: true } }),
    prisma.prestataireUnavailability.findMany({
      where:   { prestataireProfileId: profile.id },
      orderBy: { startDate: 'asc' },
      select:  { id: true, startDate: true, endDate: true, reason: true },
    }),
  ])
  return NextResponse.json({
    availableWeekdays: normalizeWeekdays(p?.availableWeekdays),
    availabilityNote:  p?.availabilityNote ?? '',
    unavailabilities,
  })
}

export async function PATCH(req: Request) {
  if (!isPrestataireEnabled()) return NOT_FOUND
  try {
    const profile = await callerPrestataireProfile()
    if (!profile) return UNAUTH
    const data = declareSchema.parse(await req.json())
    await prisma.prestataireProfile.update({
      where: { id: profile.id }, // ← from the SESSION, never the body
      data: {
        availableWeekdays: normalizeWeekdays(data.availableWeekdays), // canonical, unique, valid weekdays only
        availabilityNote:  data.availabilityNote?.trim() || null,
      },
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[PATCH /api/prestataire/availability]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  if (!isPrestataireEnabled()) return NOT_FOUND
  try {
    const profile = await callerPrestataireProfile()
    if (!profile) return UNAUTH
    const data = periodSchema.parse(await req.json())
    const start = new Date(data.startDate)
    const end   = new Date(data.endDate)
    if (!isValidPeriod(start, end)) {
      return NextResponse.json({ error: 'La date de fin doit être après la date de début' }, { status: 400 })
    }
    const period = await prisma.prestataireUnavailability.create({
      data: { prestataireProfileId: profile.id, startDate: start, endDate: end, reason: data.reason?.trim() || null },
      select: { id: true, startDate: true, endDate: true, reason: true },
    })
    return NextResponse.json({ period }, { status: 201 })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0]?.message ?? 'Données invalides' }, { status: 400 })
    }
    console.error('[POST /api/prestataire/availability]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  if (!isPrestataireEnabled()) return NOT_FOUND
  try {
    const profile = await callerPrestataireProfile()
    if (!profile) return UNAUTH
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id requis' }, { status: 400 })

    // Ownership: the period must belong to the CALLER's profile (never another's).
    const existing = await prisma.prestataireUnavailability.findUnique({
      where: { id }, select: { prestataireProfileId: true },
    })
    if (!existing) return NextResponse.json({ error: 'Période introuvable' }, { status: 404 })
    if (existing.prestataireProfileId !== profile.id) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    await prisma.prestataireUnavailability.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/prestataire/availability]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
