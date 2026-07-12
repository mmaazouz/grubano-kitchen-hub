// KDS (kitchen display) — PURE helpers for the operator /prep screen.
// No money, no DB, no I/O: just the kitchen slice of the Order state machine +
// the real elapsed-time timer maths, so they can be unit-tested and reused by the
// screen AND the read endpoint. The authoritative transitions live server-side in
// app/api/orders/[id]/status; this only mirrors the *forward* kitchen steps.

// The kitchen-relevant statuses, in flow order. Orders in 'received' | 'preparing'
// | 'ready' are on the board; 'picked_up' / 'delivered' / 'cancelled' have left the
// kitchen (dispatch/history) and are filtered out server-side.
export const KITCHEN_STATUSES = ['received', 'preparing', 'ready'] as const
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number]

// The three columns/queues, in flow order (New → In prep → Ready).
export const KITCHEN_COLUMNS: KitchenStatus[] = ['received', 'preparing', 'ready']

// True if a status belongs on the kitchen board.
export function isKitchenStatus(status: string): status is KitchenStatus {
  return (KITCHEN_STATUSES as readonly string[]).includes(status)
}

// Forward-only "bump" target — mirrors the server TRANSITIONS map for the kitchen:
// received → preparing, preparing → ready. null on 'ready' (cooking done; the next
// hop is dispatch/pickup, not a kitchen action) or on any non-kitchen status. The
// server still validates the transition — this only drives which button to show.
export function bumpTarget(status: string): KitchenStatus | null {
  if (status === 'received') return 'preparing'
  if (status === 'preparing') return 'ready'
  return null
}

// Whole minutes elapsed since an ISO timestamp (the server's Order.createdAt),
// clamped ≥ 0. `nowMs` is injected (Date.now()) so the function stays pure/testable
// and the caller controls the tick. Invalid input → 0 (never NaN in the UI).
export function elapsedMin(iso: string, nowMs: number): number {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((nowMs - t) / 60_000))
}

// Age bucket from elapsed minutes → drives the ticket colour (green/amber/red).
// fresh < 10 min ≤ warn < 20 min ≤ late. Thresholds are display-only.
export function ageOf(min: number): 'fresh' | 'warn' | 'late' {
  if (min >= 20) return 'late'
  if (min >= 10) return 'warn'
  return 'fresh'
}
