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
import { readFileSync } from 'node:fs'
// ROUND 13 (J-C10, slice W7): GET /api/claims over a mocked Prisma, the senders and the session stubbed.
const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findMany: vi.fn(), groupBy: vi.fn() },
    refund: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/claim-emails', () => ({ sendClaimAckEmail: vi.fn(), sendClaimDecisionEmail: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => ({ sub: 'u1' })) }))
// D′ L1: the lease readers live in lib/claim-flags.ts and are re-exported by lib/claims (same functions).
import { isClaimsEnabled, claimsGateState, CLAIMS_WINDOW_MAX_MS } from '@/lib/claims'
import * as flags from '@/lib/claim-flags'
import { GET as CLAIMS_GET } from '@/app/api/claims/route'

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

// ══ ROUND 13 (slice W7) — J-C10 (E0, F06, A-S00): CLAIMS_ENABLED off, the customer sees no claim ════════════════════════
describe('J-C10 — CLAIMS_ENABLED off: GET /api/claims answers { enabled: false } and no claim', () => {
  const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  const base = { orderId: 'o1', consumerId: 'u1', refundAttempted: true, arbitrationDecision: 'approved', restaurantResponse: null, restaurantResponseReason: null, arbitrationReason: null, reason: 'wrong_item' }
  const CLAIMS = [
    { ...base, id: 'fv', status: 'financial_verification', refundId: null, refundError: 'financial_verification:stripe_unreadable: x' },
    { ...base, id: 'rf', status: 'refunded', refundId: 'rf1', refundError: null },
    { ...base, id: 'ru', status: 'refunded', refundId: 'rf2', refundError: null },
    { ...base, id: 'rg', status: 'refused_final', refundId: null, refundError: null, arbitrationDecision: 'refused_final', restaurantResponse: 'accepted' },
  ]
  const get = (q = '') => CLAIMS_GET(new Request(`https://app.grubano.com/api/claims${q}`) as never)

  beforeEach(() => {
    db.claim.findMany.mockReset().mockResolvedValue(CLAIMS.map((c) => ({ ...c })))
    db.refund.findMany.mockReset().mockResolvedValue([
      { id: 'rf1', orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_1' },
      { id: 'rf2', orderId: 'o1', status: 'failed', amountCents: 500, stripeRefundId: 're_2' },
    ])
    db.claim.groupBy.mockReset().mockResolvedValue([{ refundId: 'rf1', _count: { _all: 1 } }, { refundId: 'rf2', _count: { _all: 1 } }])
  })

  it('closed: the body deep-equals { enabled: false } — no claim object, no status key — and nothing is read', async () => {
    const body = await (await get()).json()
    expect(body).toEqual({ enabled: false })
    expect(JSON.stringify(body)).not.toMatch(/status|claims|eligibility/)
    expect(await (await get('?orderId=o1')).json()).toEqual({ enabled: false })
    expect(db.claim.findMany).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — with an open lease the body carries the claims and their derived statuses', async () => {
    open()
    const body = await (await get()).json()
    expect(body.enabled).toBe(true)
    expect(body.claims.map((c: { id: string; status: string }) => [c.id, c.status])).toEqual([
      ['fv', 'financial_verification'], ['rf', 'refunded'], ['ru', 'refund_unconfirmed'], ['rg', 'refused_by_grubano'],
    ])
  })

  it('ClaimSection renders nothing unless enabled; the help page reads eligibility only behind enabled', () => {
    const cs = strip(read('components/claims/ClaimSection.tsx'))
    expect(cs).toContain('if (!enabled || !el) return null')
    expect(cs).toContain('if (data.enabled) setEl(data.eligibility as Eligibility)')
    const help = strip(read('app/[locale]/eat/order/[orderId]/help/page.tsx'))
    expect(help).toMatch(/if \(d\?\.enabled === true\) \{\s*setClaimsEnabled\(true\)\s*setEligibility\(/)
  })

  it('BREAK/RESTORE pin — the early { enabled: false } return is the first statement of GET', () => {
    const src = strip(read('app/api/claims/route.ts'))
    const handler = src.slice(src.indexOf('export async function GET('))
    // D′ L1: the first statement reads the SURFACE — claimsSurfaceOpen() ≡ isClaimsEnabled() when no product flag is set
    // (S-12), and the lease readers of lib/claims are the very functions of lib/claim-flags.
    expect(handler).toMatch(/^export async function GET\(req: NextRequest\) \{\s*if \(!claimsSurfaceOpen\(\)\) return NextResponse\.json\(\{ enabled: false \}\)/)
    expect(flags.isClaimsEnabled).toBe(isClaimsEnabled)
    expect(flags.claimsGateState).toBe(claimsGateState)
    // the break (the early return removed) no longer satisfies the pin
    const broken = handler.replace('if (!claimsSurfaceOpen()) return NextResponse.json({ enabled: false })', '')
    expect(broken).not.toMatch(/^export async function GET\(req: NextRequest\) \{\s*if \(!claimsSurfaceOpen\(\)\) return/)
    // NEGATIVE CONTROL: the pre-L1 shape (the legacy reader inline) is not the shipped shape any more
    expect(handler).not.toMatch(/if \(!isClaimsEnabled\(\)\) return NextResponse\.json\(\{ enabled: false \}\)/)
  })
})
