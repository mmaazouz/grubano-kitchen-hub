import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isMissionsEnabled } from '@/lib/missions'
import { isLogisticsEnabled } from '@/lib/logistics-account'
import { advanceMissionByCourier, type CourierMissionStep, type AdvanceResult } from '@/lib/mission-attribution'
import { accrueCourierCourseEarning, accrueCourierTipEarning } from '@/lib/courier-accrual'
import { deleteCourierPositionForMission } from '@/lib/courier-position'

// ── Shared handler for the courier lifecycle steps — pickup / deliver / cancel (brick 3
// wiring, Agent 126). One handler, three thin route.ts files (a courier drives a mission they
// OWN: accepted→picked_up→delivered, or accepted|picked_up→cancelled). Gated by
// LOGISTICS_MISSIONS_ENABLED → 404 when OFF (the feature does not exist yet). Owner-scoped: the
// courier is resolved from the session e-mail → their LogisticsProfile (no client id → no IDOR);
// brick-2 advanceMissionByCourier enforces that ONLY the assigned courier may act, via an ATOMIC
// guarded transition. The transition itself stays money-free; the ONLY money side-effect is the
// P4.3 ÉTAPE 3 course accrual on 'delivered' (below) — best-effort, idempotent, and INERT unless
// LOGISTICS_COURIER_ACCRUAL_ENABLED is ON + the order is case B ('grubano_courier').

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
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — couvre les 3 routes minces pickup/deliver/cancel qui délèguent ici
  // (accept/decline ont leur gate direct dans leur route.ts).
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

    const result = await advanceMissionByCourier(missionId, profile.id, to)

    // ── P4.3 ÉTAPE 3 — accrue the courier's COURSE earning once the mission is DELIVERED ──
    // BEST-EFFORT + idempotent (self-guards on mission state + owner + case B, DB @@unique):
    // it runs on a successful delivered transition AND on a 'conflict' retry (the mission is
    // already delivered → HEALS a failed first accrual). It NEVER affects the HTTP response
    // (a failure is logged only) and is INERT unless LOGISTICS_COURIER_ACCRUAL_ENABLED is ON
    // and the order is 'grubano_courier' (case B) → for case A / flag OFF this is a no-op and
    // the step routes are byte-identical. advanceMissionByCourier stays money-free (its own
    // invariant); the money side-effect lives here at the route layer (cf. orders/pay accruals).
    if (to === 'delivered' && (result.ok || result.reason === 'conflict')) {
      // Course accrual (ÉTAPE 3, gated LOGISTICS_COURIER_ACCRUAL_ENABLED) + tip reversal (ÉTAPE 6,
      // gated LOGISTICS_PAYOUT_ENABLED). BOTH best-effort, idempotent, self-guarded, INERT when
      // their flag is OFF — a failure NEVER affects the HTTP response. Independent try/catch so a
      // hiccup in one never blocks the other.
      try {
        await accrueCourierCourseEarning(missionId, profile.id)
      } catch (err) {
        console.error(
          `[logistics deliver] courier course accrual failed for mission ${missionId} (delivery unaffected): ` +
          (err instanceof Error ? err.message : String(err)),
        )
      }
      try {
        await accrueCourierTipEarning(missionId, profile.id)
      } catch (err) {
        console.error(
          `[logistics deliver] courier tip accrual failed for mission ${missionId} (delivery unaffected): ` +
          (err instanceof Error ? err.message : String(err)),
        )
      }
    }

    // ── Géoloc ÉTAPE 2 — minimization: erase the courier's last point when the mission ENDS ──
    // Both 'delivered' and 'cancelled' are terminal → the point NEVER survives the course. Flag-
    // gated (OFF → deleteCourierPositionForMission is a no-op and the CourierPosition table is
    // never touched → byte-identical) + best-effort (a deletion hiccup NEVER affects the HTTP
    // response). Runs on a successful terminal transition AND on a 'conflict' retry (the mission
    // is already terminal → HEALS a missed delete). Keyed by missionId (never courierId).
    if ((to === 'delivered' || to === 'cancelled') && (result.ok || result.reason === 'conflict')) {
      try {
        await deleteCourierPositionForMission(missionId)
      } catch (err) {
        console.error(
          `[logistics ${to}] courier position deletion failed for mission ${missionId} (${to} unaffected): ` +
          (err instanceof Error ? err.message : String(err)),
        )
      }
    }

    if (result.ok) return NextResponse.json(result)
    return NextResponse.json(result, { status: REASON_STATUS[result.reason] ?? 400 })
  } catch (err) {
    console.error(`[POST /api/logistics/missions/${to}]`, err)
    return NextResponse.json({ ok: false, error: 'Erreur serveur' }, { status: 500 })
  }
}
