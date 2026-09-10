// tests/support/claims-window.ts — open/close the T-53 claims lease in tests.
//
// Since T-53 the claims surface needs BOTH the flag and a live, non-expired, within-ceiling
// lease. A test that only sets CLAIMS_ENABLED now correctly finds the gate CLOSED, which is the
// whole point of the ticket. These helpers make the intent explicit at each call site rather
// than scattering ISO date arithmetic through the suites.

/** Milliseconds of lease used by default: comfortably inside the compiled ceiling. */
export const TEST_CLAIMS_LEASE_MS = 15 * 60 * 1000

/** Open the claims gate for a test: the flag AND a live lease, exactly as the operator writes. */
export function openClaimsWindow(msFromNow: number = TEST_CLAIMS_LEASE_MS): void {
  process.env.CLAIMS_ENABLED = 'true'
  process.env.CLAIMS_WINDOW_UNTIL = new Date(Date.now() + msFromNow).toISOString()
}

/** Close it the way the application closes it: by removing the authorization entirely. */
export function closeClaimsWindow(): void {
  delete process.env.CLAIMS_ENABLED
  delete process.env.CLAIMS_WINDOW_UNTIL
}
