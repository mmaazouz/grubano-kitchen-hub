import type { Mission } from '@prisma/client'

// ── Mission → wire shape (brick 3, Agent 124 · S1 privacy, Agent 126) ─────────
// The fields the courier / requester surfaces need. priceCents is passed through as
// INERT DATA (a proposed amount shown for information) — NO money is computed here.
// snapshot / courierId / orderId are intentionally NOT exposed (no PII, no internal linkage).
export interface MissionDTO {
  id: string
  type: string
  pickupAddress: string
  dropoffAddress: string
  // S1 (privacy): true → `dropoffAddress` is a COARSE zone/quartier only. The exact client
  // drop-off (a consumer's home address on a B2C meal mission) is WITHHELD on OFFERS broadcast
  // to the whole eligible pool, and revealed in full only once a courier has CLAIMED the mission.
  dropoffApprox: boolean
  zone: string | null
  priceCents: number
  status: string
  createdAt: string
}

// S1 — on an OFFER the exact drop-off must NOT be broadcast to every eligible courier (only the
// courier who ends up delivering needs it). Coarsen to a zone/quartier. PRIVACY-FIRST: reveal a
// value ONLY when it is unambiguously locality-level; otherwise reveal NOTHING (the UI shows a
// generic "revealed on acceptance" label). PURE, no side effects.
//   1) Prefer the mission's objective `zone` (the safe, intended value).
//   2) Zone-less fallback: inspect ONLY the LAST address segment (FR format "street, POSTAL CITY"
//      puts the locality last). Accept it only when it is a "<5-digit postal> city" tail OR a
//      digit-free city/quarter. A segment that still carries any digit (a street number) is
//      WITHHELD — so the exact street/number is NEVER leaked, even for odd inputs (a 5-digit
//      street number, a "Résidence 75001 …" prefix, or a comma-less street-only address).
function coarseDropoff(m: Mission): string {
  if (m.zone && m.zone.trim()) return m.zone.trim()
  const last = ((m.dropoffAddress ?? '').split(',').pop() ?? '').trim()
  if (/^\d{5}\b/.test(last)) return last  // "69003 Lyon" → postal code + city (locality-level)
  if (last && !/\d/.test(last)) return last // "Lyon" / "Paris" → digit-free city/quarter
  return '' // ambiguous or street-bearing → reveal nothing
}

/**
 * Serialise a Mission to its wire shape. `opts.maskDropoff` (used on the OFFER list served to the
 * eligible pool) coarsens the client drop-off to a zone/quartier only (S1). The requester's own
 * list and any post-claim courier view call it WITHOUT the flag → the full address (they are
 * entitled to it). Pickup (the merchant address) is never masked — it is not client PII.
 */
export function serializeMission(m: Mission, opts?: { maskDropoff?: boolean }): MissionDTO {
  const mask = opts?.maskDropoff ?? false
  return {
    id: m.id,
    type: m.type,
    pickupAddress: m.pickupAddress,
    dropoffAddress: mask ? coarseDropoff(m) : m.dropoffAddress,
    dropoffApprox: mask,
    zone: m.zone ?? null,
    priceCents: m.priceCents,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  }
}

// ── The courier's OWN missions (post-claim) — LO2 "En cours"/"Terminées". ─────
// Serialised ONLY for the assigned courier (the /mine route is owner-scoped by session
// email → courierId), so the FULL drop-off is revealed (dropoffApprox:false) — this is the
// honest S1 counterpart: the exact address appears only once THIS courier has claimed the
// mission. Also carries the lifecycle timestamps the cycle stepper needs. NO money is computed
// (priceCents stays the inert proposed amount). NO client PII beyond the addresses is exposed
// (courier missions carry no customer name/phone — nothing is fabricated).
export interface OwnMissionDTO extends MissionDTO {
  acceptedAt: string | null
  pickedUpAt: string | null
  deliveredAt: string | null
  cancelledAt: string | null
}

export function serializeOwnMission(m: Mission): OwnMissionDTO {
  return {
    ...serializeMission(m), // full drop-off (no mask) — the owning courier is post-claim
    acceptedAt: m.acceptedAt ? m.acceptedAt.toISOString() : null,
    pickedUpAt: m.pickedUpAt ? m.pickedUpAt.toISOString() : null,
    deliveredAt: m.deliveredAt ? m.deliveredAt.toISOString() : null,
    cancelledAt: m.cancelledAt ? m.cancelledAt.toISOString() : null,
  }
}
