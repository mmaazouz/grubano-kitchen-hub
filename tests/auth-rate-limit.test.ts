import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P0 — rate-limit wiring of the ANONYMOUS auth endpoints (WP-SEC-03) ────────
// The DORMANT primitive lib/rate-limit (flag RATE_LIMIT_ENABLED, default OFF) is
// wired in front of the five anonymous authentication actions:
//   • NextAuth authorize()            → bucket auth_login   (throws 'rate_limited')
//   • POST /api/auth/register         → bucket auth_register
//   • POST /api/auth/magic-link       → bucket auth_magic_link
//   • POST /api/auth/forgot-password  → bucket auth_forgot_password
//   • POST /api/auth/reset-password   → bucket auth_reset_password
// These tests verify BEHAVIOUR: flag OFF = byte-identical; over the limit = 429
// (or the stable 'rate_limited' error for NextAuth) with the SENSITIVE ACTION
// SHORT-CIRCUITED (no DB lookup, no bcrypt, no token, no email); the hardened
// last-hop XFF keying; per-bucket isolation; window sliding; and concurrency.
// Convention: real lib/rate-limit, heavy deps mocked (cf. logistics precedent).

const { db, mailer, tx } = vi.hoisted(() => ({
  db: {
    operator:          { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    loyaltyCustomer:   { upsert: vi.fn() },
    verificationToken: { findFirst: vi.fn(), deleteMany: vi.fn(), create: vi.fn() },
    emailLog:          { create: vi.fn() },
  },
  mailer: { sendMail: vi.fn() },
  tx: { sendPasswordResetEmail: vi.fn(), sendPasswordChangedEmail: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => mailer } }))
vi.mock('@/lib/transactional-emails', () => tx)
vi.mock('@/lib/magic-link', () => ({
  createMagicLinkToken: vi.fn(async () => 'op.secret'),
  authorizeMagicLink:   vi.fn(async () => null),
}))
vi.mock('@/lib/email-otp', () => ({
  isEmailOtpEnabled:      () => false,
  issueEmailOtp:          vi.fn(),
  authorizeEmailOtpLogin: vi.fn(async () => null),
}))
vi.mock('@/lib/operator-roles', () => ({ readOperatorRoles: vi.fn(async () => ['consumer']) }))

import { rateLimit, rateLimitExceeded, __resetRateLimit } from '@/lib/rate-limit'
import { POST as register } from '@/app/api/auth/register/route'
import { POST as magicLink } from '@/app/api/auth/magic-link/route'
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route'
import { POST as resetPassword } from '@/app/api/auth/reset-password/route'
import { authOptions } from '@/lib/auth'

// next-auth v4 stores the REAL authorize under `.options.authorize` (cf.
// tests/magic-link.test.ts). It receives (credentials, req) — req.headers is a
// PLAIN lower-cased record, exactly what the wiring reads.
const authorize = (authOptions.providers[0] as unknown as {
  options: {
    authorize: (
      c: Record<string, string> | undefined,
      req?: { headers?: Record<string, unknown> },
    ) => Promise<unknown>
  }
}).options.authorize

const post = (path: string, ip: string, body: unknown, extraHeaders: Record<string, string> = {}) =>
  new Request(`http://t${path}`, {
    method:  'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...extraHeaders },
    body:    JSON.stringify(body),
  })

const ENV_KEYS = [
  'RATE_LIMIT_ENABLED',
  'RATE_LIMIT_AUTH_LOGIN_MAX', 'RATE_LIMIT_AUTH_LOGIN_WINDOW_SEC',
  'RATE_LIMIT_AUTH_REGISTER_MAX', 'RATE_LIMIT_AUTH_MAGIC_LINK_MAX',
  'RATE_LIMIT_AUTH_FORGOT_PASSWORD_MAX', 'RATE_LIMIT_AUTH_RESET_PASSWORD_MAX',
  'RATE_LIMIT_T_MAX',
]

beforeEach(() => {
  __resetRateLimit()
  vi.clearAllMocks()
  db.operator.findUnique.mockResolvedValue(null)
  db.operator.create.mockResolvedValue({ id: 'op-new', name: 'Xx', email: 'x@y.zz', role: 'consumer' })
  db.loyaltyCustomer.upsert.mockResolvedValue({})
  db.emailLog.create.mockResolvedValue({})
  db.verificationToken.findFirst.mockResolvedValue(null)
})
afterEach(() => { for (const k of ENV_KEYS) delete process.env[k] })

// ── The hardened IP key (last-hop XFF — spoof resistance) ─────────────────────
describe('client identity — last hop of x-forwarded-for', () => {
  beforeEach(() => { process.env.RATE_LIMIT_ENABLED = 'true' })

  it('a client forging DIFFERENT first hops stays in ONE bucket (no bypass)', () => {
    // Trusted proxy APPENDS the real IP as the LAST element: forged prefixes vary.
    const mk = (forged: string) =>
      new Request('http://t/x', { method: 'POST', headers: { 'x-forwarded-for': `${forged}, 9.9.9.9` } })
    expect(rateLimit(mk('1.1.1.1'), 't', { limitDefault: 2 })).toBeNull()
    expect(rateLimit(mk('2.2.2.2'), 't', { limitDefault: 2 })).toBeNull()
    const third = rateLimit(mk('3.3.3.3'), 't', { limitDefault: 2 })
    expect(third).not.toBeNull()
    expect(third!.status).toBe(429)
  })

  it('single-value XFF and multi-hop XFF with the same last hop share the bucket', () => {
    const a = new Request('http://t/x', { method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' } })
    const b = new Request('http://t/x', { method: 'POST', headers: { 'x-forwarded-for': 'forged, 9.9.9.9' } })
    expect(rateLimit(a, 't', { limitDefault: 1 })).toBeNull()
    expect(rateLimit(b, 't', { limitDefault: 1 })!.status).toBe(429)
  })

  it('no usable header → the shared "unknown" bucket still throttles', () => {
    const bare = () => new Request('http://t/x', { method: 'POST' })
    expect(rateLimit(bare(), 't', { limitDefault: 1 })).toBeNull()
    expect(rateLimit(bare(), 't', { limitDefault: 1 })!.status).toBe(429)
  })
})

// ── rateLimitExceeded (NextAuth-friendly, plain headers record) ───────────────
describe('rateLimitExceeded — plain headers record', () => {
  it('flag OFF → always false (byte-identical no-op)', () => {
    for (let i = 0; i < 100; i++) {
      expect(rateLimitExceeded({ 'x-forwarded-for': '1.2.3.4' }, 'auth_login', { limitDefault: 1 })).toBe(false)
    }
  })

  it('flag ON → false under the limit, true past it; same last-hop trust rule', () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    const h = (forged: string) => ({ 'x-forwarded-for': `${forged}, 8.8.8.8` })
    expect(rateLimitExceeded(h('a'), 'auth_login', { limitDefault: 2 })).toBe(false)
    expect(rateLimitExceeded(h('b'), 'auth_login', { limitDefault: 2 })).toBe(false)
    expect(rateLimitExceeded(h('c'), 'auth_login', { limitDefault: 2 })).toBe(true)
  })

  it('FAIL-OPEN — a faulting headers object never blocks sign-in', () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    const evil = new Proxy({}, { get() { throw new Error('boom') } }) as Record<string, unknown>
    expect(rateLimitExceeded(evil, 'auth_login', { limitDefault: 0 })).toBe(false)
  })
})

// ── NextAuth authorize() — the auth_login bucket ──────────────────────────────
describe('authorize — throttled BEFORE any DB/bcrypt work', () => {
  it('flag OFF → unchanged behaviour (null for bad creds, DB consulted)', async () => {
    for (let i = 0; i < 30; i++) {
      await expect(
        authorize({ email: 'x@y.z', password: 'nope' }, { headers: { 'x-forwarded-for': '1.2.3.4' } }),
      ).resolves.toBeNull()
    }
    expect(db.operator.findUnique).toHaveBeenCalledTimes(30)
  })

  it('flag ON → past the limit it throws the STABLE code and does NOT touch the DB', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '2'
    const req = { headers: { 'x-forwarded-for': '5.5.5.5' } }
    await expect(authorize({ email: 'x@y.z', password: 'nope' }, req)).resolves.toBeNull()
    await expect(authorize({ email: 'x@y.z', password: 'nope' }, req)).resolves.toBeNull()
    expect(db.operator.findUnique).toHaveBeenCalledTimes(2)
    await expect(authorize({ email: 'x@y.z', password: 'nope' }, req)).rejects.toThrow('rate_limited')
    expect(db.operator.findUnique).toHaveBeenCalledTimes(2) // 3rd attempt: DB untouched
  })

  it('the throttle covers the magic-token sub-path too (one gate for all three)', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '1'
    const req = { headers: { 'x-forwarded-for': '6.6.6.6' } }
    await expect(authorize({ magicToken: 'op.secret' }, req)).resolves.toBeNull()
    await expect(authorize({ magicToken: 'op.secret' }, req)).rejects.toThrow('rate_limited')
  })

  it('no headers at all → fail-open when the record is absent is NOT total: the shared bucket throttles', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '1'
    await expect(authorize({ email: 'x@y.z', password: 'nope' }, undefined)).resolves.toBeNull()
    await expect(authorize({ email: 'x@y.z', password: 'nope' }, undefined)).rejects.toThrow('rate_limited')
  })
})

// ── POST /api/auth/register — the auth_register bucket ────────────────────────
describe('register — throttled BEFORE DB/bcrypt/email', () => {
  const body = { name: 'Xx', email: 'x@y.zz', password: 'Abcdef1!' }

  it('flag OFF → byte-identical (no 429 whatever the volume)', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1' }) // existing → 409 path (no email)
    for (let i = 0; i < 12; i++) {
      const res = await register(post('/api/auth/register', '1.2.3.4', body) as never)
      expect(res.status).toBe(409)
    }
    expect(mailer.sendMail).not.toHaveBeenCalled()
  })

  it('flag ON → past the limit: 429 + Retry-After, no DB lookup, no email', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_AUTH_REGISTER_MAX = '2'
    db.operator.findUnique.mockResolvedValue({ id: 'op1' })
    expect((await register(post('/api/auth/register', '2.2.2.2', body) as never)).status).toBe(409)
    expect((await register(post('/api/auth/register', '2.2.2.2', body) as never)).status).toBe(409)
    const third = await register(post('/api/auth/register', '2.2.2.2', body) as never)
    expect(third.status).toBe(429)
    expect(Number(third.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(db.operator.findUnique).toHaveBeenCalledTimes(2) // throttled call never reached the DB
    expect(mailer.sendMail).not.toHaveBeenCalled()
  })

  it('the 429 body is the EXISTING primitive copy (no invented user text)', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_AUTH_REGISTER_MAX = '1'
    await register(post('/api/auth/register', '3.3.3.3', body) as never)
    const res = await register(post('/api/auth/register', '3.3.3.3', body) as never)
    expect(await res.json()).toEqual({ error: 'Trop de requêtes, réessayez plus tard.' })
  })
})

// ── POST /api/auth/magic-link — the auth_magic_link bucket ────────────────────
describe('magic-link — throttled BEFORE DB/token/email', () => {
  const body = { email: 'x@y.z', locale: 'fr' }

  it('flag OFF → byte-identical generic 200s', async () => {
    for (let i = 0; i < 8; i++) {
      const res = await magicLink(post('/api/auth/magic-link', '1.2.3.4', body) as never)
      expect(res.status).toBe(200)
    }
    expect(mailer.sendMail).not.toHaveBeenCalled() // unknown account → generic, no email (historical)
  })

  it('flag ON → past the limit: 429, DB never consulted, no email', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_AUTH_MAGIC_LINK_MAX = '2'
    expect((await magicLink(post('/api/auth/magic-link', '4.4.4.4', body) as never)).status).toBe(200)
    expect((await magicLink(post('/api/auth/magic-link', '4.4.4.4', body) as never)).status).toBe(200)
    expect((await magicLink(post('/api/auth/magic-link', '4.4.4.4', body) as never)).status).toBe(429)
    expect(db.operator.findUnique).toHaveBeenCalledTimes(2)
    expect(mailer.sendMail).not.toHaveBeenCalled()
  })
})

// ── POST /api/auth/forgot-password — the auth_forgot_password bucket ──────────
describe('forgot-password — throttled BEFORE DB/token/email', () => {
  const body = { email: 'x@y.zz' }

  it('flag ON → past the limit: 429, no lookup, no token, no email; anti-enum 200 kept below it', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_AUTH_FORGOT_PASSWORD_MAX = '2'
    expect((await forgotPassword(post('/api/auth/forgot-password', '7.7.7.7', body) as never)).status).toBe(200)
    expect((await forgotPassword(post('/api/auth/forgot-password', '7.7.7.7', body) as never)).status).toBe(200)
    expect((await forgotPassword(post('/api/auth/forgot-password', '7.7.7.7', body) as never)).status).toBe(429)
    expect(db.operator.findUnique).toHaveBeenCalledTimes(2)
    expect(db.verificationToken.create).not.toHaveBeenCalled()
    expect(tx.sendPasswordResetEmail).not.toHaveBeenCalled()
  })
})

// ── POST /api/auth/reset-password — the auth_reset_password bucket ────────────
describe('reset-password — throttled BEFORE token lookup / bcrypt', () => {
  const body = { token: 'a'.repeat(64), email: 'x@y.z', password: 'Abcdef1!' }

  it('flag ON → past the limit: 429 and the token is never looked up', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_AUTH_RESET_PASSWORD_MAX = '2'
    const r1 = await resetPassword(post('/api/auth/reset-password', '8.8.8.8', body) as never)
    const r2 = await resetPassword(post('/api/auth/reset-password', '8.8.8.8', body) as never)
    expect(r1.status).not.toBe(429)
    expect(r2.status).not.toBe(429)
    const calls = db.verificationToken.findFirst.mock.calls.length
    const r3 = await resetPassword(post('/api/auth/reset-password', '8.8.8.8', body) as never)
    expect(r3.status).toBe(429)
    expect(db.verificationToken.findFirst).toHaveBeenCalledTimes(calls) // throttled call: no lookup
    expect(db.operator.update).not.toHaveBeenCalled()
  })
})

// ── Isolation + concurrency ───────────────────────────────────────────────────
describe('bucket isolation and concurrency', () => {
  beforeEach(() => { process.env.RATE_LIMIT_ENABLED = 'true' })

  it('auth buckets are independent: exhausting auth_login leaves auth_register open', async () => {
    process.env.RATE_LIMIT_AUTH_LOGIN_MAX = '1'
    const req = { headers: { 'x-forwarded-for': '9.1.1.1' } }
    await authorize({ email: 'x@y.z', password: 'nope' }, req)
    await expect(authorize({ email: 'x@y.z', password: 'nope' }, req)).rejects.toThrow('rate_limited')
    db.operator.findUnique.mockResolvedValue({ id: 'op1' })
    const res = await register(post('/api/auth/register', '9.1.1.1', { name: 'Xx', email: 'x@y.zz', password: 'Abcdef1!' }) as never)
    expect(res.status).toBe(409) // not 429 — separate bucket
  })

  it('CONCURRENCY — 20 simultaneous requests, limit 5 → exactly 5 pass', async () => {
    const mk = () => new Request('http://t/x', { method: 'POST', headers: { 'x-forwarded-for': '9.2.2.2' } })
    const results = await Promise.all(
      Array.from({ length: 20 }, () => Promise.resolve().then(() => rateLimit(mk(), 't', { limitDefault: 5 }))),
    )
    expect(results.filter((r) => r === null)).toHaveLength(5)
    expect(results.filter((r) => r !== null && r.status === 429)).toHaveLength(15)
  })
})
