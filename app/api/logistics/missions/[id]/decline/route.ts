import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isMissionsEnabled } from '@/lib/missions'
import { declineMission } from '@/lib/mission-attribution'

export const dynamic = 'force-dynamic'

// ── POST /api/logistics/missions/[id]/decline — the connected courier passes on an
// offered mission (brick 3, Agent 124). Gated → 404 when OFF. Owner-scoped. Delegates to
// brick-2 declineMission: a NO-OP that keeps the mission offered for everyone else and only
// records a do-not-re-offer marker. There is NO penalty, NO score, NO status change — the
// route returns {ok:true} regardless, and the UI shows NO penalty wording. NO money.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!isMissionsEnabled()) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  try {
    const session = await getServerSession(authOptions)
    const email = session?.user?.email
    if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

    const profile = await prisma.logisticsProfile.findUnique({ where: { email }, select: { id: true } })
    if (!profile) return NextResponse.json({ ok: false, error: 'Profil livreur introuvable' }, { status: 403 })

    const result = await declineMission(params.id, profile.id)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[POST /api/logistics/missions/decline]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
