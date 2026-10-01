// tests/support/refund-window.ts — open/close the T-48 refund lease in tests.
//
// WHY THIS EXISTS NOW. T-90 put a declaration in front of every financial Stripe write
// (lib/stripe-money-guard.ts): a write that INITIATES a movement must pass its caller's own gate result,
// and `assertMoneyWriteAllowed` refuses a `rail_open` declaration whose gate says closed. The guard is
// exactly as strict as the four production callers — `isRefundsEnabled()` IS `refundGateState().open`
// (lib/refund.ts:123) — so nothing that passes in production fails here.
//
// What it DID expose is that several suites drive `executeRefund` / `refundPayment` directly, bypassing
// the route gate that production always applies. Those tests were asserting the arithmetic of a refund
// the rail had never authorized. Opening the lease explicitly makes each of them say what production
// says, and it makes the opposite case — the engine refusing while the rail is closed — a test of its
// own rather than an accident of the setup.
//
// The shape mirrors tests/support/claims-window.ts deliberately: one helper per rail, no ISO date
// arithmetic scattered through the suites.

/** Milliseconds of lease used by default: comfortably inside the compiled 30-minute ceiling. */
export const TEST_REFUND_LEASE_MS = 15 * 60 * 1000

/**
 * Open the refund gate for a test: the flag AND a live lease, exactly as phase2-refund-gate.js writes
 * them. Both halves are required — `refundGateState()` refuses a bare flag (`no_lease`), a lease in the
 * past (`lease_expired`) and a lease beyond the ceiling (`lease_too_long`).
 */
export function openRefundWindow(msFromNow: number = TEST_REFUND_LEASE_MS): void {
  process.env.REFUNDS_ENABLED = 'true'
  process.env.REFUNDS_WINDOW_UNTIL = new Date(Date.now() + msFromNow).toISOString()
}

/** Close it the way the application closes it: by removing the authorization entirely. */
export function closeRefundWindow(): void {
  delete process.env.REFUNDS_ENABLED
  delete process.env.REFUNDS_WINDOW_UNTIL
}

/** The chargeback rail is a bare flag — there is no CHARGEBACKS_WINDOW_UNTIL anywhere in the repo. */
export function openChargebackRail(): void {
  process.env.CHARGEBACKS_ENABLED = 'true'
}

export function closeChargebackRail(): void {
  delete process.env.CHARGEBACKS_ENABLED
}
