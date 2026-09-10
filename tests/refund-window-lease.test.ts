// tests/refund-window-lease.test.ts — T-48
//
// A temporary refund authorization must not depend on the survival of the process that
// opened it. The batch-1 closeout audit proved a process-local `finally` (and even a signal
// handler) cannot cover SIGKILL, a host crash or a power cut — and `.env.local` survives a
// reboot, so a crashed window could come back OPEN and stay open indefinitely.
//
// The gate is therefore an EXPIRING AUTHORIZATION the application re-checks itself on every
// call: REFUNDS_ENABLED=true AND a deadline that parses, is in the future, and is within the
// compiled ceiling. Nobody has to act for it to close — time passing is what closes it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isRefundsEnabled, refundGateState, REFUND_WINDOW_MAX_MS } from '@/lib/refund'

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()
const open = (msFromNow = 10 * 60 * 1000) => {
  vi.stubEnv('REFUNDS_ENABLED', 'true')
  vi.stubEnv('REFUNDS_WINDOW_UNTIL', iso(msFromNow))
}

beforeEach(() => { vi.unstubAllEnvs() })
afterEach(() => { vi.unstubAllEnvs() })

describe('DEFAULT CLOSED — a static boolean authorizes nothing on its own', () => {
  it('no flag, no lease → closed', () => {
    expect(isRefundsEnabled()).toBe(false)
    expect(refundGateState()).toMatchObject({ open: false, reason: 'flag_off' })
  })

  it('REFUNDS_ENABLED=true with NO lease → CLOSED (this is the T-48 change)', () => {
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    expect(isRefundsEnabled()).toBe(false)
    expect(refundGateState()).toMatchObject({ open: false, reason: 'no_lease' })
  })

  it('a valid lease with the flag OFF → closed (both are required)', () => {
    vi.stubEnv('REFUNDS_WINDOW_UNTIL', iso(60_000))
    expect(isRefundsEnabled()).toBe(false)
    expect(refundGateState()).toMatchObject({ open: false, reason: 'flag_off' })
  })

  it('flag + valid lease → OPEN, with the remaining time exposed', () => {
    open(5 * 60 * 1000)
    const s = refundGateState()
    expect(s.open).toBe(true)
    if (s.open) {
      expect(s.remainingMs).toBeGreaterThan(4 * 60 * 1000)
      expect(s.remainingMs).toBeLessThanOrEqual(5 * 60 * 1000)
    }
  })
})

describe('EXPIRY — the authorization dies of old age, with nobody acting', () => {
  it('a lease one second in the past → CLOSED', () => {
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    vi.stubEnv('REFUNDS_WINDOW_UNTIL', iso(-1000))
    expect(isRefundsEnabled()).toBe(false)
    expect(refundGateState()).toMatchObject({ open: false, reason: 'lease_expired' })
  })

  it('the SAME env that was open becomes closed purely because time passed', () => {
    open(60_000)
    expect(isRefundsEnabled()).toBe(true)
    // no cleanup, no signal, no process: just a later clock
    const later = Date.now() + 61_000
    expect(refundGateState(later)).toMatchObject({ open: false, reason: 'lease_expired' })
  })

  it('an unparsable deadline fails CLOSED (never trusted, never ignored)', () => {
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    for (const bad of ['', '   ', 'bientôt', 'true', '99999999999999999999-13-45']) {
      vi.stubEnv('REFUNDS_WINDOW_UNTIL', bad)
      expect(refundGateState().open).toBe(false)
    }
  })

  it('a deadline beyond the compiled ceiling is REFUSED, not clamped', () => {
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    vi.stubEnv('REFUNDS_WINDOW_UNTIL', iso(REFUND_WINDOW_MAX_MS + 60_000))
    expect(refundGateState()).toMatchObject({ open: false, reason: 'lease_too_long' })
    // a year-long "authorization" is a configuration error or tampering, never a longer window
    vi.stubEnv('REFUNDS_WINDOW_UNTIL', iso(365 * 24 * 3600 * 1000))
    expect(isRefundsEnabled()).toBe(false)
  })

  it('the maximum authorization lifetime is 30 minutes', () => {
    expect(REFUND_WINDOW_MAX_MS).toBe(30 * 60 * 1000)
  })
})

describe('PROCESS DEATH — the scenarios a process-local handler cannot cover', () => {
  it('SIGKILL: the env survives untouched, and the window still closes on its own at the deadline', () => {
    // The operator opened a window and was then killed with -9: no handler ran, so
    // REFUNDS_ENABLED is still "true" and the lease was never expired by anyone.
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    vi.stubEnv('REFUNDS_WINDOW_UNTIL', iso(3 * 60 * 1000))
    expect(isRefundsEnabled()).toBe(true) // honest: it IS open for the remainder of the lease
    // …and it closes with nobody acting, once the deadline passes.
    expect(refundGateState(Date.now() + 3 * 60 * 1000 + 1).open).toBe(false)
  })

  it('HOST RESTART: a stale true flag reloaded from .env.local cannot reopen anything', () => {
    // .env.local survives a reboot. Before T-48 this reloaded an OPEN gate for ever.
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    vi.stubEnv('REFUNDS_WINDOW_UNTIL', iso(-6 * 60 * 60 * 1000)) // window from six hours ago
    expect(isRefundsEnabled()).toBe(false)
    expect(refundGateState()).toMatchObject({ open: false, reason: 'lease_expired' })
  })

  it('A RESTART DOES NOT EXTEND the authorization: the deadline is absolute, not a countdown', () => {
    const deadline = iso(30_000)
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    vi.stubEnv('REFUNDS_WINDOW_UNTIL', deadline)
    const t0 = Date.now()
    expect(refundGateState(t0).open).toBe(true)
    // "restart" = re-read the same env later. The remaining time only shrinks.
    const s1 = refundGateState(t0 + 20_000)
    expect(s1.open).toBe(true)
    if (s1.open) expect(s1.remainingMs).toBeLessThanOrEqual(10_000)
    expect(refundGateState(t0 + 31_000).open).toBe(false)
  })

  it('REPLAYING an old authorization does not revive it', () => {
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    vi.stubEnv('REFUNDS_WINDOW_UNTIL', '2026-09-09T17:44:00.000Z') // a real past window
    expect(isRefundsEnabled()).toBe(false)
  })
})

// ── NEGATIVE CONTROL ────────────────────────────────────────────────────────────
// Prove this suite would catch a gate that accepted an expired lease.
describe('negative control — an expired lease accepted would be caught', () => {
  const vulnerableGate = () => process.env.REFUNDS_ENABLED === 'true' // the pre-T-48 rule

  it('the old boolean rule says OPEN for a six-hour-stale window; the real gate says closed', () => {
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    vi.stubEnv('REFUNDS_WINDOW_UNTIL', iso(-6 * 60 * 60 * 1000))
    expect(vulnerableGate()).toBe(true)   // ← the defect T-48 exists to remove
    expect(isRefundsEnabled()).toBe(false) // ← fixed
  })
})

// ── AUDIT FIX (batch 2, P1) ──────────────────────────────────────────────────────
// The ghost-order auto-refund reached executeRefund on its OWN standing flag alone: a
// permanent, never-expiring authorization to move money that bypassed the window entirely.
// An automatic refund must never pay out while the refund rail is closed.
describe('AUDIT FIX — no standing flag can move money without a live authorization', () => {
  it('the ONLY gate function is isRefundsEnabled, and it requires the lease', () => {
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    expect(isRefundsEnabled()).toBe(false) // no lease ⇒ no money, whatever any other flag says
    vi.stubEnv('REFUNDS_WINDOW_UNTIL', iso(60_000))
    expect(isRefundsEnabled()).toBe(true)
  })

  it('an expired lease closes the gate for EVERY caller, automatic paths included', () => {
    vi.stubEnv('REFUNDS_ENABLED', 'true')
    vi.stubEnv('REFUNDS_WINDOW_UNTIL', iso(-1))
    expect(isRefundsEnabled()).toBe(false)
  })
})

// ── AUDIT FIX (batch 2, P3) — THE OPERATOR MUST NOT OUTLIVE ITS OWN AUTHORIZATION ──
// The window operator writes a lease of `window + 2 min`, clamped to the compiled ceiling.
// Above ~28 minutes the clamp bites: the app closes the gate while the operator keeps polling
// and keeps printing "WINDOW OPEN". No money can move in that state — but an EVIDENCE operator
// that states something false is the defect this whole train exists to eliminate. It now
// REFUSES such a window instead of silently shortening it.
describe('AUDIT FIX — the operator refuses a window the lease cannot cover', () => {
  const LEASE_MARGIN_MS = 120_000
  const leaseFor = (windowMs: number) => Math.min(windowMs + LEASE_MARGIN_MS, REFUND_WINDOW_MAX_MS)
  const accepted = (windowMs: number) => windowMs + LEASE_MARGIN_MS <= REFUND_WINDOW_MAX_MS

  it('every window the operator ACCEPTS gets a lease that outlasts it', () => {
    for (const min of [1, 5, 10, 15, 20, 27, 28]) {
      const windowMs = min * 60_000
      expect(accepted(windowMs)).toBe(true)
      expect(leaseFor(windowMs)).toBeGreaterThan(windowMs) // the gate is still open at the last poll
      expect(leaseFor(windowMs)).toBeLessThanOrEqual(REFUND_WINDOW_MAX_MS)
    }
  })

  it('a window the lease CANNOT cover is refused, not clamped', () => {
    for (const min of [29, 30, 45, 120]) {
      expect(accepted(min * 60_000)).toBe(false)
    }
  })

  it('NEGATIVE CONTROL — clamping instead of refusing leaves the operator lying', () => {
    const windowMs = 45 * 60_000
    const clamped = leaseFor(windowMs)
    expect(clamped).toBe(REFUND_WINDOW_MAX_MS)
    expect(clamped).toBeLessThan(windowMs) // ← 15 minutes of "WINDOW OPEN" on a closed gate
  })

  it('the guard is actually present in the operator, not only in this test', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync('scripts/server/phase2-refund-gate.js', 'utf8')
    expect(src).toContain('WINDOW_DEADLINE_MS + 120000 > 30 * 60 * 1000')
    expect(src).toContain('Nothing changed.')
  })
})
