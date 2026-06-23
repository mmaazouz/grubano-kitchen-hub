import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isMissionsEnabled } from '@/lib/missions'
import { offeredMissionsForCourier } from '@/lib/mission-attribution'
import { serializeMission } from '@/lib/mission-serialize'

export const dynamic = 'force-dynamic'

// ── GET /api/logistics/missions — the OFFERED missions the connected courier may
// freely accept (brick 3, Agent 124). Gated by LOGISTICS_MISSIONS_ENABLED → 404 when
// OFF (the feature does not exist yet). Owner-scoped: the courier is resolved from the
// session e-mail → their LogisticsProfile (no client id → no IDOR). The eligibility +
// already-declined filtering is done by lib/mission-attribution (brick 2), reused as-is.
// NO money is computed (priceCents is passed through as inert data).
export async function GET() {
  if (!isMissionsEnabled()) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  try {
    const session = await getServerSession(authOptions)
    const email = session?.user?.email
    if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

    const profile = await prisma.logisticsProfile.findUnique({ where: { email }, select: { id: true } })
    if (!profile) return NextResponse.json({ ok: false, error: 'Profil livreur introuvable' }, { status: 403 })

    // Reuses brick 2 — returns [] for a non-active courier / flag OFF, excludes declined.
    const missions = await offeredMissionsForCourier(profile.id)
    return NextResponse.json({ ok: true, missions: missions.map(serializeMission) })
  } catch (err) {
    console.error('[GET /api/logistics/missions]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
