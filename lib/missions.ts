import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import type { Mission } from '@prisma/client'

// ── Logistics missions — Brique 1/4 (Agent 122) ────────────────────────────────
//
// The data MODEL + lifecycle STATE MACHINE for the independent-courier fleet. This brick
// is foundation ONLY:
//   • NO money — no commission, no ledger, no payout, no Stripe/Connect. Mission.priceCents
//     is INERT DATA (a proposed amount); nothing here moves or computes money. The payment
//     rail is a FUTURE brick, HELD pending legal review.
//   • NO UI (brique 3).
//   • NO attribution — who a mission is OFFERED to / which courier ACCEPTS is brique 2.
//     createMission() only persists an 'offered' mission with NO courier assigned.
//   • Compliance (doc §8 / EU dir. 2024): the lifecycle SUPPORTS courier autonomy —
//     declined / expired / cancelled are NEUTRAL terminals (NO penalty/score is EVER stored),
//     there is NO forced 'assigned' state, and courierId stays null through 'offered' (a
//     courier is linked only when they FREELY accept, brique 2).
// Gated by LOGISTICS_MISSIONS_ENABLED (default OFF) — createMission is a no-op when OFF.

/** Kill-switch — default OFF. Only the exact string 'true' enables the missions surface. */
export function isMissionsEnabled(): boolean {
  return process.env.LOGISTICS_MISSIONS_ENABLED === 'true'
}

export type MissionStatus =
  | 'offered' | 'accepted' | 'picked_up' | 'delivered'  // happy path
  | 'declined' | 'expired' | 'cancelled'                 // NEUTRAL terminals (no penalty encoded)

export const MISSION_ACTIVE_STATUSES: readonly MissionStatus[] = ['offered', 'accepted', 'picked_up']
export const MISSION_TERMINAL_STATUSES: readonly MissionStatus[] = ['delivered', 'declined', 'expired', 'cancelled']

// Allowed FORWARD transitions. 'declined' (no one took it / refused — neutral), 'expired'
// (offer window lapsed) and 'cancelled' (withdrawn by the requester) are reachable from the
// active states; a courier who accepts then drops out → 'cancelled'. NO transition encodes a
// penalty or a score (courier autonomy). Terminals go nowhere.
const TRANSITIONS: Record<MissionStatus, readonly MissionStatus[]> = {
  offered:   ['accepted', 'declined', 'expired', 'cancelled'],
  accepted:  ['picked_up', 'cancelled'],
  picked_up: ['delivered', 'cancelled'],
  delivered: [],
  declined:  [],
  expired:   [],
  cancelled: [],
}

// Each status → the lifecycle timestamp column it stamps (offeredAt is set at create).
const TIMESTAMP_FIELD: Record<MissionStatus, string | null> = {
  offered:   'offeredAt',
  accepted:  'acceptedAt',
  picked_up: 'pickedUpAt',
  delivered: 'deliveredAt',
  declined:  'declinedAt',
  expired:   'expiredAt',
  cancelled: 'cancelledAt',
}

/** PURE — is `to` a valid next state from `from`? Unknown/terminal `from` → false. */
export function canTransition(from: MissionStatus, to: MissionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * PURE — build the update patch for a VALID transition: the new status + its lifecycle
 * timestamp (stamped with the caller-supplied `now`, keeping it deterministic + unit-
 * testable). Throws on an invalid transition. NO money, NO courier selection — pure
 * state-machine bookkeeping (the persistence/attribution is brique 2/3).
 */
export function buildTransitionData(
  from: MissionStatus,
  to: MissionStatus,
  now: Date,
): Record<string, MissionStatus | Date> {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid mission transition: ${from} → ${to}`)
  }
  const patch: Record<string, MissionStatus | Date> = { status: to }
  const field = TIMESTAMP_FIELD[to]
  if (field) patch[field] = now
  return patch
}

export interface CreateMissionInput {
  orderId?: string | null            // (a) B2C link to a consumer Order; absent for (b) a B2B mission
  type?: string                      // repas | produits_fournisseurs | b2b | froid (default repas)
  pickupAddress: string
  dropoffAddress: string
  zone?: string | null
  priceCents?: number                // INERT proposed amount — NO money logic attached
  snapshot?: Record<string, unknown> // stable offer context (pure data)
}

/**
 * Persist a NEW mission in status 'offered'. NO courier is assigned (courierId stays null —
 * attribution is brique 2) and NO money is touched (priceCents is inert). Gated: returns
 * null when LOGISTICS_MISSIONS_ENABLED is OFF (no write). Supports BOTH a B2C order-linked
 * delivery (orderId set) and an autonomous B2B mission (orderId absent).
 */
export async function createMission(input: CreateMissionInput): Promise<Mission | null> {
  if (!isMissionsEnabled()) return null
  return prisma.mission.create({
    data: {
      orderId:        input.orderId ?? null,
      // courierId intentionally OMITTED → null: no forced assignment, free acceptance only.
      type:           input.type ?? 'repas',
      pickupAddress:  input.pickupAddress,
      dropoffAddress: input.dropoffAddress,
      zone:           input.zone ?? null,
      status:         'offered',
      priceCents:     input.priceCents ?? 0,
      snapshot:       (input.snapshot ?? {}) as Prisma.InputJsonValue,
      // offeredAt / createdAt default to now() at the DB level.
    },
  })
}
