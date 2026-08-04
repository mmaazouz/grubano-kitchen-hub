import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isMissionsEnabled } from '@/lib/missions'
import { acceptMission } from '@/lib/mission-attribution'
import { isLogisticsEnabled } from '@/lib/logistics-account'

export const dynamic = 'force-dynamic'

// ── POST /api/logistics/missions/[id]/accept — the connected courier FREELY accepts
// an offered mission (brick 3, Agent 124). Gated → 404 when OFF. Owner-scoped (session
// e-mail → LogisticsProfile). Delegates to brick-2 acceptMission (ATOMIC claim): the
// first eligible acceptor wins; a lost race comes back {ok:false, reason:'unavailable'}
// — returned VERBATIM so the UI can show it GRACEFULLY (never an error / penalty). NO money.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
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

    // Brick 2 enforces eligibility + the atomic claim. Reason 'unavailable' / 'ineligible'
    // is a NORMAL outcome (HTTP 200) — refusal/loss carries NO penalty.
    const result = await acceptMission(params.id, profile.id)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[POST /api/logistics/missions/accept]', err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
