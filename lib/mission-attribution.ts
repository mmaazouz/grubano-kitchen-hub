import { prisma } from '@/lib/prisma'
import type { Mission } from '@prisma/client'
import { isMissionsEnabled, canTransition } from '@/lib/missions'

// ── Logistics mission ATTRIBUTION — Brick 2/4 (Agent 123) ──────────────────────
//
// THE compliance-critical brick. It decides who a mission is OFFERED to and how a courier
// takes it, in a way that protects the independent-courier model from a salaried-worker
// requalification (doc §8 / EU directive 2024). The five non-negotiable invariants:
//
//   1. OFFER, NEVER ASSIGN — a mission is exposed to an ELIGIBLE POOL; no function ever
//      attaches a courier to a mission without that courier's own acceptance.
//   2. FREE, FIRST-COME ACCEPTANCE — the first eligible courier to accept gets it, via an
//      ATOMIC claim (DB updateMany on status='offered' AND courierId IS NULL). No double
//      assignment; a lost race fails GRACEFULLY ('unavailable'), never punitively.
//   3. DECLINE = NO-OP, NO PENALTY — declining records nothing but a "don't re-offer this one
//      to me" marker. No score, no rank, no deactivation, no effect on future eligibility.
//   4. OBJECTIVE, TRANSPARENT ELIGIBILITY — the pool is computed from objective attributes only
//      (active status + zone + mission type + optional vehicle requirement). NO performance
//      scoring, NO history-based ranking, NO opaque prioritisation. Order is stable/objective.
//   5. NO AUTOMATIC DEACTIVATION — nothing here suspends or deactivates a courier. Any such
//      decision is reserved for a HUMAN (a later brick), never an algorithm.
//
// ZERO money: priceCents stays the inert datum already on the Mission (shown in an offer, never
// computed/charged here). ZERO commission/ledger/payout/Stripe (payment rail HELD). ZERO UI
// (surfaces are brick 3). Reuses lib/missions (brick 1) — does NOT fork it. Gated by
// LOGISTICS_MISSIONS_ENABLED (default OFF): every DB-touching function is a no-op when OFF.

/** The objective attributes used to decide eligibility — a normalised LogisticsProfile subset. */
export interface EligibilityCourier {
  id: string
  status: string          // only 'active' couriers are eligible
  missionTypes: string[]  // repas | produits_fournisseurs | b2b | froid
  vehicleTypes: string[]  // velo | scooter | voiture | camionnette | frigorifique
  zones: string[]         // cities / postal codes served
}

/** The objective constraints of a mission to match couriers against. */
export interface EligibilityMission {
  type: string
  zone?: string | null
  // Optional, caller-supplied objective vehicle requirement (e.g. a cold delivery needs a
  // refrigerated vehicle). Empty/omitted → no vehicle constraint. The live DB Mission has no
  // such column yet, so the DB-backed paths pass none; a later brick may supply it.
  requiredVehicleTypes?: string[]
}

/** Coerce a Prisma Json column into a clean string[] (defensive against legacy/odd values). */
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

/**
 * PURE — is this courier eligible for this mission? OBJECTIVE criteria ONLY (status + zone +
 * type + optional vehicle). No scoring, no history, no side effects. The single source of the
 * eligibility rule, reused by eligibleCouriers + the DB-backed reads below.
 */
export function isCourierEligibleForMission(courier: EligibilityCourier, mission: EligibilityMission): boolean {
  if (courier.status !== 'active') return false
  if (!courier.missionTypes.includes(mission.type)) return false
  if (mission.zone && !courier.zones.includes(mission.zone)) return false
  if (mission.requiredVehicleTypes && mission.requiredVehicleTypes.length > 0) {
    if (!mission.requiredVehicleTypes.some((v) => courier.vehicleTypes.includes(v))) return false
  }
  return true
}

/**
 * PURE — the eligible pool for a mission. Returns the matching couriers in the SAME ORDER they
 * were given (stable, objective) — there is deliberately NO sort: ranking couriers by any
 * performance/acceptance metric is exactly what we must not do.
 */
export function eligibleCouriers(mission: EligibilityMission, couriers: EligibilityCourier[]): EligibilityCourier[] {
  return couriers.filter((c) => isCourierEligibleForMission(c, mission))
}

// ── DB-backed operations (all gated; no money, no UI) ──────────────────────────

function normalizeCourier(row: {
  id: string; status: string; missionTypes: unknown; vehicleTypes: unknown; zones: unknown
}): EligibilityCourier {
  return {
    id: row.id,
    status: row.status,
    missionTypes: asStringArray(row.missionTypes),
    vehicleTypes: asStringArray(row.vehicleTypes),
    zones: asStringArray(row.zones),
  }
}

async function loadCourier(courierId: string): Promise<EligibilityCourier | null> {
  const row = await prisma.logisticsProfile.findUnique({
    where: { id: courierId },
    select: { id: true, status: true, missionTypes: true, vehicleTypes: true, zones: true },
  })
  return row ? normalizeCourier(row) : null
}

export type OfferResult =
  | { ok: true; eligibleCourierIds: string[] }
  | { ok: false; reason: 'disabled' | 'not_found' }

/**
 * Preview the ELIGIBLE POOL a mission is offered to — a READ. We do NOT assign, we do NOT push;
 * every listed courier may freely accept. Pool = active couriers matching the mission's objective
 * attributes. No ranking (the ids come back in the DB's natural order).
 */
export async function offerMission(missionId: string): Promise<OfferResult> {
  if (!isMissionsEnabled()) return { ok: false, reason: 'disabled' }
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    select: { id: true, type: true, zone: true },
  })
  if (!mission) return { ok: false, reason: 'not_found' }
  const couriers = await prisma.logisticsProfile.findMany({
    where: { status: 'active' },
    select: { id: true, status: true, missionTypes: true, vehicleTypes: true, zones: true },
  })
  const pool = eligibleCouriers({ type: mission.type, zone: mission.zone }, couriers.map(normalizeCourier))
  return { ok: true, eligibleCourierIds: pool.map((c) => c.id) }
}

export type AcceptResult =
  | { ok: true; missionId: string; courierId: string }
  | { ok: false; reason: 'disabled' | 'not_found' | 'ineligible' | 'unavailable' }

/**
 * A courier FREELY accepts an offered mission. The claim is ATOMIC: a conditional updateMany on
 * (status='offered' AND courierId IS NULL) → the DB serialises it so exactly ONE concurrent
 * caller wins (count===1). A loser (count===0) gets 'unavailable' — GRACEFUL, never an error or
 * a penalty. Only an ELIGIBLE courier may claim. No money, no forced assignment.
 */
export async function acceptMission(missionId: string, courierId: string): Promise<AcceptResult> {
  if (!isMissionsEnabled()) return { ok: false, reason: 'disabled' }

  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    select: { id: true, type: true, zone: true, status: true, courierId: true },
  })
  if (!mission) return { ok: false, reason: 'not_found' }
  if (mission.status !== 'offered' || mission.courierId) return { ok: false, reason: 'unavailable' }

  const courier = await loadCourier(courierId)
  if (!courier || !isCourierEligibleForMission(courier, { type: mission.type, zone: mission.zone })) {
    return { ok: false, reason: 'ineligible' }
  }

  // Reuse the brick-1 state machine to assert offered→accepted is the legal transition.
  if (!canTransition('offered', 'accepted')) return { ok: false, reason: 'unavailable' }

  // ── ATOMIC CLAIM — first eligible acceptor wins; concurrent accepts can't double-assign ──
  const claim = await prisma.mission.updateMany({
    where: { id: missionId, status: 'offered', courierId: null },
    data: { courierId, status: 'accepted', acceptedAt: new Date() },
  })
  if (claim.count === 0) return { ok: false, reason: 'unavailable' } // someone else took it — no penalty

  return { ok: true, missionId, courierId }
}

export type DeclineResult = { ok: boolean; reason?: 'disabled' }

/**
 * A courier passes on a mission. PURE NO-OP on the mission itself — it stays 'offered' for every
 * other eligible courier. We record the decline ONLY so we don't re-offer THIS mission to THIS
 * courier (idempotent set membership via the @@unique). NOTHING punitive is written: no score, no
 * counter (the upsert's update is intentionally empty), no status change, no eligibility impact.
 */
export async function declineMission(missionId: string, courierId: string): Promise<DeclineResult> {
  if (!isMissionsEnabled()) return { ok: false, reason: 'disabled' }
  try {
    await prisma.missionDecline.upsert({
      where: { missionId_courierId: { missionId, courierId } },
      create: { missionId, courierId },
      update: {}, // already declined → no-op. We do NOT bump any counter — declining never penalises.
    })
  } catch {
    // Best-effort: a decline must never fail loudly or punish the courier (e.g. an unknown
    // missionId just means there is nothing to remember). Swallow and report success.
  }
  return { ok: true }
}

/**
 * The missions a courier may freely accept: still 'offered' + unclaimed + NOT already declined by
 * this courier, then filtered by OBJECTIVE eligibility. Stable order, no scoring. Returns [] when
 * the flag is OFF or the courier is not active.
 */
export async function offeredMissionsForCourier(courierId: string): Promise<Mission[]> {
  if (!isMissionsEnabled()) return []
  const courier = await loadCourier(courierId)
  if (!courier || courier.status !== 'active') return []

  const candidates = await prisma.mission.findMany({
    where: {
      status: 'offered',
      courierId: null,
      declines: { none: { courierId } }, // exclude what this courier already passed on
    },
  })
  return candidates.filter((m) => isCourierEligibleForMission(courier, { type: m.type, zone: m.zone }))
}
