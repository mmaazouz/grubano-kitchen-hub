import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isPrestataireEnabled, callerPrestataireProfile } from '@/lib/prestataire-account'

export const dynamic = 'force-dynamic'

// ── GET /api/prestataire/missions — the prestataire's received missions (P3) ──
// CLONE of /api/supplier/orders GET. Scoped to the caller's PrestataireProfile (SESSION) —
// a prestataire only ever sees ITS OWN missions. 404 when PRESTATAIRE_ENABLED is OFF. NO
// money (the quote amount is pure data).

export async function GET() {
  if (!isPrestataireEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const profile = await callerPrestataireProfile()
  if (!profile) return NextResponse.json({ error: 'Profil prestataire introuvable' }, { status: 401 })
  const missions = await prisma.serviceMission.findMany({
    where:   { prestataireProfileId: profile.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, status: true, requestDetails: true,
      quoteAmountCents: true, quoteDescription: true, proposedDate: true, scheduledDate: true, createdAt: true,
      restaurantOperator: { select: { id: true, name: true } },
      serviceOffering:    { select: { id: true, title: true, category: true } },
    },
  })
  return NextResponse.json({ missions })
}
