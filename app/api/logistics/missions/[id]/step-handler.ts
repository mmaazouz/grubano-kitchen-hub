import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isMissionsEnabled } from '@/lib/missions'
import { advanceMissionByCourier, type CourierMissionStep, type AdvanceResult } from '@/lib/mission-attribution'

// ── Shared handler for the courier lifecycle steps — pickup / deliver / cancel (brick 3
// wiring, Agent 126). One handler, three thin route.ts files (a courier drives a mission they
// OWN: accepted→picked_up→delivered, or accepted|picked_up→cancelled). Gated by
// LOGISTICS_MISSIONS_ENABLED → 404 when OFF (the feature does not exist yet). Owner-scoped: the
// courier is resolved from the session e-mail → their LogisticsProfile (no client id → no IDOR);
// brick-2 advanceMissionByCourier enforces that ONLY the assigned courier may act, via an ATOMIC
// guarded transition. NO money is ever touched (priceCents inert; no gain/payout/ledger/commission).

// Non-ok brick-2 reason → HTTP. 'invalid_transition' → 422 (a step the state machine forbids);
// 'forbidden' → 403 (not this courier's mission); 'not_found'/'disabled' → 404; 'conflict' → 409
// (the status moved underneath — lost race, no wrong write).
const REASON_STATUS: Record<Exclude<AdvanceResult, { ok: true }>['reason'], number> = {
  disabled:           404,
  not_found:          404,
  forbidden:          403,
  invalid_transition: 422,
  conflict:           409,
}

export async function handleCourierMissionStep(
  missionId: string,
  to: CourierMissionStep,
): Promise<NextResponse> {
  if (!isMissionsEnabled()) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 })
  }
  try {
    const session = await getServerSession(authOptions)
    const email = session?.user?.email
    if (!email) return NextResponse.json({ ok: false, error: 'Non autorisé' }, { status: 401 })

    const profile = await prisma.logisticsProfile.findUnique({ where: { email }, select: { id: true } })
    if (!profile) return NextResponse.json({ ok: false, error: 'Profil livreur introuvable' }, { status: 403 })

    const result = await advanceMissionByCourier(missionId, profile.id, to)
    if (result.ok) return NextResponse.json(result)
    return NextResponse.json(result, { status: REASON_STATUS[result.reason] ?? 400 })
  } catch (err) {
    console.error(`[POST /api/logistics/missions/${to}]`, err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
