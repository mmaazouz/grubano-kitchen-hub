import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isMissionsEnabled } from '@/lib/missions'
import { serializeOwnMission } from '@/lib/mission-serialize'
import { isLogisticsEnabled } from '@/lib/logistics-account'

export const dynamic = 'force-dynamic'

// ── GET /api/logistics/missions/mine — the connected courier's OWN missions (LO2). ──
// The "En cours" (accepted / picked_up) + "Terminées" (delivered / cancelled) tabs. Gated by
// LOGISTICS_MISSIONS_ENABLED → 404 when OFF. OWNER-SCOPED: the courier is resolved from the
// session e-mail → their LogisticsProfile (no client id → no IDOR), and the query pins
// courierId = that profile — a courier only ever sees missions they claimed. The FULL drop-off
// is revealed here (serializeOwnMission, no mask) — the honest S1 counterpart: the exact address
// appears only once THIS courier has the mission. NO money is computed (priceCents inert).
export async function GET() {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isLogisticsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!isMissionsEnabled()) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  try {
    const session = await getServerSession(authOptions)
    const email = session?.user?.email
    if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

    const profile = await prisma.logisticsProfile.findUnique({ where: { email }, select: { id: true } })
    if (!profile) return NextResponse.json({ ok: false, error: 'Profil livreur introuvable' }, { status: 403 })

    const [current, done] = await Promise.all([
      prisma.mission.findMany({
        where: { courierId: profile.id, status: { in: ['accepted', 'picked_up'] } },
        orderBy: { acceptedAt: 'desc' },
      }),
      prisma.mission.findMany({
        where: { courierId: profile.id, status: { in: ['delivered', 'cancelled'] } },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ])

    return NextResponse.json({
      ok: true,
      current: current.map(serializeOwnMission),
      done: done.map(serializeOwnMission),
    })
  } catch (err) {
    console.error('[GET /api/logistics/missions/mine]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
