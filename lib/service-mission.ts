// ── Service mission (DEVIS → MISSION) state machine — PURE (P3, Agent 76) ─────
// The SERVICES analogue of the lib/marketplace supply-order state machine, adapted to the
// quote→mission cycle. `status` is a free String column → these VALUES need no migration.
// No I/O → unit-tested. SHARED by both PATCH routes (prestataire + restaurant) so the
// "who may do what" rule is single-sourced. 100% OFF the money path: a transition only
// moves the status; quoteAmountCents is data set alongside, never charged (payment = P6).
//
// FLOW:
//   requested ──(prestataire quotes: + amount/description/date)──▶ quoted
//   quoted    ──(restaurant accepts: + scheduledDate)───────────▶ accepted
//   accepted  ──(prestataire marks done)──────────────────────────▶ done   (TERMINAL)
// OFF-RAMPS:
//   requested ──(prestataire declines the request)──▶ declined  (TERMINAL)
//   requested ──(restaurant cancels the request)────▶ cancelled (TERMINAL)
//   quoted    ──(restaurant declines the quote)─────▶ declined  (TERMINAL)
// There is deliberately NO "invoiced"/"paid" state here — that is P6.

export type ServiceMissionStatus =
  | 'requested' | 'quoted' | 'accepted' | 'declined' | 'cancelled' | 'done'

export const SERVICE_MISSION_STATUSES: readonly ServiceMissionStatus[] =
  ['requested', 'quoted', 'accepted', 'declined', 'cancelled', 'done'] as const

export const TERMINAL_MISSION_STATUSES: readonly ServiceMissionStatus[] =
  ['declined', 'cancelled', 'done'] as const

export type MissionActor = 'prestataire' | 'restaurant'

// Transitions the PRESTATAIRE (seller) may perform, keyed by the current status.
//   requested → quoted   (chiffrer le devis) | declined (refuser la demande)
//   accepted  → done     (marquer la mission réalisée)
const PRESTATAIRE_TRANSITIONS: Record<string, ServiceMissionStatus[]> = {
  requested: ['quoted', 'declined'],
  accepted:  ['done'],
}

// Transitions the RESTAURANT (buyer) may perform, keyed by the current status.
//   requested → cancelled              (annuler la demande avant chiffrage)
//   quoted    → accepted | declined    (accepter ou refuser le devis)
const RESTAURANT_TRANSITIONS: Record<string, ServiceMissionStatus[]> = {
  requested: ['cancelled'],
  quoted:    ['accepted', 'declined'],
}

/** The statuses `actor` may move a mission to FROM its current status. */
export function allowedMissionTransitions(actor: MissionActor, from: string): ServiceMissionStatus[] {
  const map = actor === 'prestataire' ? PRESTATAIRE_TRANSITIONS : RESTAURANT_TRANSITIONS
  return map[from] ?? []
}

/** True iff `actor` may move a mission from `from` → `to` (the only transition gate). */
export function canTransitionMission(actor: MissionActor, from: string, to: string): boolean {
  return allowedMissionTransitions(actor, from).includes(to as ServiceMissionStatus)
}

/** True iff `status` is terminal (no further transition is possible). */
export function isTerminalMission(status: string): boolean {
  return (TERMINAL_MISSION_STATUSES as readonly string[]).includes(status)
}
