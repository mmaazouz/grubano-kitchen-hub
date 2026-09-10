// tests/claims-window-lease.test.ts — T-53
//
// A temporary claims authorization must not depend on the survival of the process that opened it.
// The refund gate learned this as T-48; the claims gate had not. A static boolean survives
// everything — SIGKILL, a host crash, a power cut, a reboot — because `.env.local` is still on
// disk and still says true. A fifteen-minute rehearsal window could therefore stay open for ever
// without anybody making a mistake.
//
// The claims surface is now an EXPIRING AUTHORIZATION the application re-checks on every call:
// CLAIMS_ENABLED=true AND a deadline that parses, is in the future, and is within the compiled
// ceiling. Nobody has to act for it to close. Time passing is what closes it.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isClaimsEnabled, claimsGateState, CLAIMS_WINDOW_MAX_MS } from '@/lib/claims'

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()
const open = (msFromNow = 15 * 60 * 1000) => {
  vi.stubEnv('CLAIMS_ENABLED', 'true')
  vi.stubEnv('CLAIMS_WINDOW_UNTIL', iso(msFromNow))
}

beforeEach(() => { vi.unstubAllEnvs() })
afterEach(() => { vi.unstubAllEnvs() })

describe('DEFAULT CLOSED — a static boolean authorizes nothing on its own', () => {
  it('no flag, no lease → closed', () => {
    expect(isClaimsEnabled()).toBe(false)
    expect(claimsGateState()).toMatchObject({ open: false, reason: 'flag_off' })
  })

  it('CLAIMS_ENABLED=true with NO lease → CLOSED (this is the T-53 change)', () => {
    vi.stubEnv('CLAIMS_ENABLED', 'true')
    expect(isClaimsEnabled()).toBe(false)
    expect(claimsGateState()).toMatchObject({ open: false, reason: 'no_lease' })
  })

  it('a valid lease with the flag OFF → closed (both are required)', () => {
    vi.stubEnv('CLAIMS_WINDOW_UNTIL', iso(60_000))
    expect(isClaimsEnabled()).toBe(false)
    expect(claimsGateState()).toMatchObject({ open: false, reason: 'flag_off' })
  })

  it('flag + valid lease → OPEN, with the remaining time exposed', () => {
    open(5 * 60 * 1000)
    const s = claimsGateState()
    expect(s.open).toBe(true)
    if (s.open) {
      expect(s.remainingMs).toBeGreaterThan(4 * 60 * 1000)
      expect(s.remainingMs).toBeLessThanOrEqual(5 * 60 * 1000)
    }
  })

  it('strict equality: any other spelling of the flag stays closed', () => {
    vi.stubEnv('CLAIMS_WINDOW_UNTIL', iso(60_000))
    for (const spelling of ['TRUE', 'True', '1', 'yes', 'on', '']) {
      vi.stubEnv('CLAIMS_ENABLED', spelling)
      expect(isClaimsEnabled()).toBe(false)
    }
  })
})

describe('EXPIRY — the authorization dies of old age, with nobody acting', () => {
  it('a lease one second in the past → CLOSED', () => {
    vi.stubEnv('CLAIMS_ENABLED', 'true')
    vi.stubEnv('CLAIMS_WINDOW_UNTIL', iso(-1000))
    expect(isClaimsEnabled()).toBe(false)
    expect(claimsGateState()).toMatchObject({ open: false, reason: 'lease_expired' })
  })

  it('the SAME env that was open becomes closed purely because time passed', () => {
    open(60_000)
    expect(isClaimsEnabled()).toBe(true)
    expect(claimsGateState(Date.now() + 61_000)).toMatchObject({ open: false, reason: 'lease_expired' })
  })

  it('an unparsable deadline fails CLOSED (never trusted, never ignored)', () => {
    vi.stubEnv('CLAIMS_ENABLED', 'true')
    for (const bad of ['', '   ', 'bientôt', 'true', '99999999999999999999-13-45']) {
      vi.stubEnv('CLAIMS_WINDOW_UNTIL', bad)
      expect(claimsGateState().open).toBe(false)
    }
  })

  it('a deadline beyond the compiled ceiling is REFUSED, not clamped', () => {
    vi.stubEnv('CLAIMS_ENABLED', 'true')
    vi.stubEnv('CLAIMS_WINDOW_UNTIL', iso(CLAIMS_WINDOW_MAX_MS + 60_000))
    expect(claimsGateState()).toMatchObject({ open: false, reason: 'lease_too_long' })
    vi.stubEnv('CLAIMS_WINDOW_UNTIL', iso(365 * 24 * 3600 * 1000))
    expect(isClaimsEnabled()).toBe(false)
  })

  it('the maximum claims authorization lifetime is 60 minutes', () => {
    expect(CLAIMS_WINDOW_MAX_MS).toBe(60 * 60 * 1000)
  })
})

describe('PROCESS DEATH — the scenarios a process-local handler cannot cover', () => {
  it('SIGKILL: the env survives untouched, and the window still closes on its own', () => {
    // Killed with -9: no handler ran, so CLAIMS_ENABLED is still "true" and the lease was never
    // expired by anyone. It is honestly open for the remainder of the lease, and then not.
    vi.stubEnv('CLAIMS_ENABLED', 'true')
    vi.stubEnv('CLAIMS_WINDOW_UNTIL', iso(3 * 60 * 1000))
    expect(isClaimsEnabled()).toBe(true)
    expect(claimsGateState(Date.now() + 3 * 60 * 1000 + 1).open).toBe(false)
  })

  it('HOST RESTART: a stale true flag reloaded from .env.local cannot reopen anything', () => {
    vi.stubEnv('CLAIMS_ENABLED', 'true')
    vi.stubEnv('CLAIMS_WINDOW_UNTIL', iso(-6 * 60 * 60 * 1000))
    expect(isClaimsEnabled()).toBe(false)
    expect(claimsGateState()).toMatchObject({ open: false, reason: 'lease_expired' })
  })

  it('A RESTART DOES NOT EXTEND the authorization: the deadline is absolute', () => {
    const deadline = iso(30_000)
    vi.stubEnv('CLAIMS_ENABLED', 'true')
    vi.stubEnv('CLAIMS_WINDOW_UNTIL', deadline)
    const t0 = Date.now()
    expect(claimsGateState(t0).open).toBe(true)
    const s1 = claimsGateState(t0 + 20_000)
    expect(s1.open).toBe(true)
    if (s1.open) expect(s1.remainingMs).toBeLessThanOrEqual(10_000)
    expect(claimsGateState(t0 + 31_000).open).toBe(false)
  })

  it('RESTORING A TRUE-FLAG BACKUP cannot reopen the surface (T-54 defence in depth)', () => {
    // A backup restored later carries the lease it was taken with — which is now in the past.
    // The lease is the lock; neutralising backups is the tidy-up, not the control.
    vi.stubEnv('CLAIMS_ENABLED', 'true')
    vi.stubEnv('CLAIMS_WINDOW_UNTIL', iso(-42 * 60 * 1000))
    expect(isClaimsEnabled()).toBe(false)
  })
})

describe('SEPARATION OF AUTHORITY — a claims lease is not a refund lease', () => {
  it('an open claims window grants NO refund authority', async () => {
    open()
    const { isRefundsEnabled } = await import('@/lib/refund')
    expect(isClaimsEnabled()).toBe(true)
    expect(isRefundsEnabled()).toBe(false)
  })

  it('the refund lease variable does not open the claims surface either', () => {
    vi.stubEnv('CLAIMS_ENABLED', 'true')
    vi.stubEnv('REFUNDS_WINDOW_UNTIL', iso(10 * 60 * 1000))
    expect(isClaimsEnabled()).toBe(false) // wrong lease, still closed
  })
})

// ── NEGATIVE CONTROL ────────────────────────────────────────────────────────────
describe('negative control — the pre-T-53 rule would be caught', () => {
  it('the old boolean rule says OPEN for a six-hour-stale window; the real gate says closed', () => {
    const vulnerableGate = () => process.env.CLAIMS_ENABLED === 'true' // the pre-T-53 rule
    vi.stubEnv('CLAIMS_ENABLED', 'true')
    vi.stubEnv('CLAIMS_WINDOW_UNTIL', iso(-6 * 60 * 60 * 1000))
    expect(vulnerableGate()).toBe(true)   // ← the defect T-53 exists to remove
    expect(isClaimsEnabled()).toBe(false) // ← fixed
  })
})
