import type { Mission } from '@prisma/client'

// ── Mission → wire shape (brick 3, Agent 124) ─────────────────────────────────
// The fields the courier / requester surfaces need. priceCents is passed through as
// INERT DATA (a proposed amount shown for information) — NO money is computed here.
// snapshot / courierId / orderId are intentionally NOT exposed (no PII, no internal linkage).
export interface MissionDTO {
  id: string
  type: string
  pickupAddress: string
  dropoffAddress: string
  zone: string | null
  priceCents: number
  status: string
  createdAt: string
}

export function serializeMission(m: Mission): MissionDTO {
  return {
    id: m.id,
    type: m.type,
    pickupAddress: m.pickupAddress,
    dropoffAddress: m.dropoffAddress,
    zone: m.zone ?? null,
    priceCents: m.priceCents,
    status: m.status,
    createdAt: m.createdAt.toISOString(),
  }
}
