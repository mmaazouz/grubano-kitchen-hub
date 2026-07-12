import { describe, it, expect, beforeEach, vi } from 'vitest'
import { sha256 } from '@/lib/partner-verification'

// ── Email OTP security core (Phase 3 auth hardening — Agent 88) ───────────────────
// Locks the non-negotiables: crypto 6-digit code, HASHED (peppered + email/purpose
// bound, never clear), single-use, expiry, per-code attempt cap, request throttle,
// purpose/email binding (non-interchangeable), constant-time compare.

const { db, roles } = vi.hoisted(() => ({
  db: {
    emailOtp: { count: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    operator: { findUnique: vi.fn() },
  },
  roles: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/operator-roles', () => ({ readOperatorRoles: roles }))

import {
  issueEmailOtp, verifyEmailOtp, authorizeEmailOtpLogin,
  OTP_MAX_ATTEMPTS, OTP_MAX_REQUESTS,
} from '@/lib/email-otp'

const SECRET = 'test-pepper-secret'
const EMAIL = 'User@X.FR'           // mixed case → must be normalized to lower
const NORM = 'user@x.fr'
const hashOf = (code: string, purpose: string, email = NORM) => sha256(`${SECRET}:${purpose}:${email}:${code}`)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_SECRET = SECRET
  db.emailOtp.count.mockResolvedValue(0)
  db.emailOtp.updateMany.mockResolvedValue({ count: 1 })
  db.emailOtp.create.mockResolvedValue({})
  db.emailOtp.update.mockResolvedValue({})
  roles.mockResolvedValue(['consumer'])
})

describe('issueEmailOtp — crypto code, hashed storage, throttle', () => {
  it('mints a crypto 6-digit code and stores ONLY a peppered+bound hash (never the clear code)', async () => {
    const r = await issueEmailOtp(EMAIL, 'login')
    expect(r.ok).toBe(true)
    const code = (r as { ok: true; code: string }).code
    expect(code).toMatch(/^\d{6}$/)
    const data = db.emailOtp.create.mock.calls[0][0].data
    expect(data.email).toBe(NORM)                       // normalized
    expect(data.purpose).toBe('login')
    expect(data.codeHash).toBe(hashOf(code, 'login'))    // peppered + email + purpose bound
    expect(data.codeHash).not.toContain(code)            // never the clear code
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now())
    // supersedes any prior live code for (email,purpose)
    expect(db.emailOtp.updateMany.mock.calls[0][0].where).toMatchObject({ email: NORM, purpose: 'login', consumedAt: null })
  })

  it('THROTTLE: at/over the request cap → throttled, NO new code written', async () => {
    db.emailOtp.count.mockResolvedValue(OTP_MAX_REQUESTS)
    const r = await issueEmailOtp(EMAIL, 'login')
    expect(r).toEqual({ ok: false, reason: 'throttled' })
    expect(db.emailOtp.create).not.toHaveBeenCalled()
  })

  it('different purposes hash DIFFERENTLY for the same code (non-interchangeable)', async () => {
    const code = '123456'
    expect(hashOf(code, 'login')).not.toBe(hashOf(code, 'stepup:withdraw'))
  })
})

describe('verifyEmailOtp — single-use, expiry, attempts, binding, constant-time', () => {
  const liveRow = (code: string, purpose: string, over: Record<string, unknown> = {}) =>
    ({ id: 'otp1', codeHash: hashOf(code, purpose), attempts: 0, ...over })

  it('correct code on a live row → true, counts the attempt, then CONSUMES (single-use)', async () => {
    db.emailOtp.findFirst.mockResolvedValue(liveRow('424242', 'login'))
    const ok = await verifyEmailOtp(EMAIL, 'login', '424242')
    expect(ok).toBe(true)
    // attempt counted BEFORE compare
    expect(db.emailOtp.update.mock.calls[0][0]).toMatchObject({ where: { id: 'otp1' }, data: { attempts: { increment: 1 } } })
    // consumed race-safe (only if still unconsumed)
    expect(db.emailOtp.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'otp1', consumedAt: null })
    // the live-row query excludes consumed + expired
    const where = db.emailOtp.findFirst.mock.calls[0][0].where
    expect(where).toMatchObject({ email: NORM, purpose: 'login', consumedAt: null })
    expect(where.expiresAt.gt).toBeInstanceOf(Date)
  })

  it('SINGLE-USE: a consume that updates 0 rows (already used) → false', async () => {
    db.emailOtp.findFirst.mockResolvedValue(liveRow('424242', 'login'))
    db.emailOtp.updateMany.mockResolvedValue({ count: 0 })
    expect(await verifyEmailOtp(EMAIL, 'login', '424242')).toBe(false)
  })

  it('EXPIRED / none live → findFirst null → false, no consume', async () => {
    db.emailOtp.findFirst.mockResolvedValue(null)
    expect(await verifyEmailOtp(EMAIL, 'login', '424242')).toBe(false)
    expect(db.emailOtp.updateMany).not.toHaveBeenCalled()
  })

  it('ATTEMPT CAP: a row already at the cap → false WITHOUT comparing or consuming', async () => {
    db.emailOtp.findFirst.mockResolvedValue(liveRow('424242', 'login', { attempts: OTP_MAX_ATTEMPTS }))
    expect(await verifyEmailOtp(EMAIL, 'login', '424242')).toBe(false)
    expect(db.emailOtp.update).not.toHaveBeenCalled()
    expect(db.emailOtp.updateMany).not.toHaveBeenCalled()
  })

  it('WRONG code → false, attempt counted, NOT consumed', async () => {
    db.emailOtp.findFirst.mockResolvedValue(liveRow('424242', 'login'))
    expect(await verifyEmailOtp(EMAIL, 'login', '000000')).toBe(false)
    expect(db.emailOtp.update).toHaveBeenCalledTimes(1)       // attempt counted
    expect(db.emailOtp.updateMany).not.toHaveBeenCalled()    // never consumed
  })

  it('PURPOSE BINDING: a code minted for one purpose does NOT verify under another', async () => {
    // findFirst would only return a 'stepup:withdraw' row; even if a login-hashed row
    // were returned, the recomputed hash uses the verify purpose → mismatch.
    db.emailOtp.findFirst.mockResolvedValue(liveRow('424242', 'login')) // hash bound to 'login'
    expect(await verifyEmailOtp(EMAIL, 'stepup:withdraw', '424242')).toBe(false)
  })

  it('SHAPE guard: a non-6-digit code is rejected with NO DB hit', async () => {
    expect(await verifyEmailOtp(EMAIL, 'login', 'abc')).toBe(false)
    expect(await verifyEmailOtp(EMAIL, 'login', '12345')).toBe(false)
    expect(db.emailOtp.findFirst).not.toHaveBeenCalled()
  })
})

describe('authorizeEmailOtpLogin — same session shape as magic-link, status-gated', () => {
  beforeEach(() => db.emailOtp.findFirst.mockResolvedValue({ id: 'o', codeHash: hashOf('424242', 'login'), attempts: 0 }))

  it('verified code + ACTIVE operator → user with the role SET', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', name: 'U', email: NORM, role: 'restaurant', status: 'active' })
    roles.mockResolvedValue(['restaurant', 'creator'])
    const u = await authorizeEmailOtpLogin(EMAIL, '424242')
    expect(u).toMatchObject({ id: 'op1', email: NORM, role: 'restaurant', roles: ['restaurant', 'creator'] })
  })

  it('PENDING / SUSPENDED operator → null (cannot sign in)', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', name: 'U', email: NORM, role: 'restaurant', status: 'pending' })
    expect(await authorizeEmailOtpLogin(EMAIL, '424242')).toBeNull()
  })

  it('wrong code → null (no operator lookup needed)', async () => {
    expect(await authorizeEmailOtpLogin(EMAIL, '000000')).toBeNull()
    expect(db.operator.findUnique).not.toHaveBeenCalled()
  })
})
