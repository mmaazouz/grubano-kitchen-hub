import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isLogisticsTrackingEnabled } from '@/lib/logistics-tracking'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/logistics/my-position-data — Géoloc ÉTAPE 5 — courier RGPD rights (access + erasure). ──
// OWNER-SCOPED: the courier is resolved from the SESSION email → LogisticsProfile (never a client
// id → no IDOR). A courier can ONLY ever see/erase THEIR OWN data. Flag-gated (OFF → inert).
//   GET    → art. 15 (access): the courier's own consent state + their own current position points.
//            These are the courier's OWN coordinates (exact — it is their data, no coarsening).
//   DELETE → art. 17 (erasure): erase the courier's own CourierPosition rows on demand, beyond the
//            automatic delete at delivered/cancelled. Returns the count.

async function sessionEmail(): Promise<string | null> {
  const s = await getServerSession(authOptions)
  return s?.user?.email ?? null
}

export async function GET() {
  const email = await sessionEmail()
  if (!email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  // OFF → do NOT read the tracking columns (may not exist pre-migration) → gated, inert.
  if (!isLogisticsTrackingEnabled()) return NextResponse.json({ enabled: false })

  const profile = await prisma.logisticsProfile.findUnique({
    where: { email },
    select: { id: true, trackingConsent: true, trackingConsentAt: true },
  })
  if (!profile) return NextResponse.json({ error: 'Profil livreur introuvable' }, { status: 403 })

  // Owner-scoped: ONLY this courier's own points (courierId = the session profile id).
  const positions = await prisma.courierPosition.findMany({
    where: { courierId: profile.id },
    select: { missionId: true, lat: true, lng: true, accuracy: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json({
    enabled: true,
    consent: profile.trackingConsent,
    consentAt: profile.trackingConsentAt,
    positions,
  })
}

export async function DELETE() {
  const email = await sessionEmail()
  if (!email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!isLogisticsTrackingEnabled()) return NextResponse.json({ error: 'Indisponible', gated: true }, { status: 404 })

  const profile = await prisma.logisticsProfile.findUnique({ where: { email }, select: { id: true } })
  if (!profile) return NextResponse.json({ error: 'Profil livreur introuvable' }, { status: 403 })

  // Owner-scoped erasure — ONLY this courier's own points.
  const res = await prisma.courierPosition.deleteMany({ where: { courierId: profile.id } })
  return NextResponse.json({ ok: true, deleted: res.count })
}
