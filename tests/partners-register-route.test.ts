import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { NextRequest } from 'next/server'

// ── POST /api/partners/register — PASSWORDLESS restaurateur signup (P6, Agent 24) ─
// The account is created with password=null (Operator.password is nullable) and signs
// in by magic-link. Anti-bot (honeypot / too-fast) + RGPD consent + host gate are kept.

const { db, mailer, makeToken } = vi.hoisted(() => ({
  db: { operator: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() }, emailLog: { create: vi.fn() } },
  mailer: { sendMail: vi.fn() },
  makeToken: vi.fn(() => ({ token: 'tok.secret', hash: 'deadbeef', expiry: new Date(8.64e15) })),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/partner-verification', () => ({ createVerificationToken: makeToken }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: mailer.sendMail }) } }))
// Domain MX check passes (mailable domain).
vi.mock('dns', () => ({ promises: {
  resolveMx: vi.fn().mockResolvedValue([{ exchange: 'mx.example', priority: 10 }]),
  resolve:   vi.fn().mockResolvedValue(['1.2.3.4']),
} }))

import { POST } from '@/app/api/partners/register/route'

// Unique IP per call so the in-memory per-IP rate limiter (5/h) never trips in the suite.
let ip = 0
function post(body: Record<string, unknown>, host = 'business.grubano.com') {
  ip++
  const req = new Request('http://business.grubano.com/api/partners/register', {
    method:  'POST',
    headers: {
      'content-type':    'application/json',
      'x-forwarded-host': host,
      'x-forwarded-for':  `10.9.0.${ip}`,
    },
    body: JSON.stringify(body),
  })
  return POST(req as unknown as NextRequest)
}

const VALID = { name: 'Marco Pizzeria', email: 'marco@grubano.com', consent: true, formStartedAt: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  makeToken.mockReturnValue({ token: 'tok.secret', hash: 'deadbeef', expiry: new Date(8.64e15) })
  db.operator.findUnique.mockResolvedValue(null) // fresh email
  db.operator.create.mockResolvedValue({ id: 'op1' })
  db.operator.update.mockResolvedValue({})
  db.emailLog.create.mockResolvedValue({})
})

describe('POST /api/partners/register — passwordless', () => {
  it('(a/d) a passwordless signup (no password sent) creates a pending restaurant account with password=null', async () => {
    const res = await post(VALID)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(db.operator.create).toHaveBeenCalledTimes(1)
    const data = db.operator.create.mock.calls[0][0].data
    expect(data).toMatchObject({ email: 'marco@grubano.com', role: 'restaurant', status: 'pending' })
    expect(data.password).toBeNull()        // passwordless — no usable secret
    expect(data.consentAt).toBeInstanceOf(Date)
    // verification token is stored + a verification email is attempted
    expect(db.operator.update).toHaveBeenCalled()
    expect(mailer.sendMail).toHaveBeenCalled()
  })

  it('an old client that still sends a password → ignored, account still created password=null', async () => {
    const res = await post({ ...VALID, password: 'Sup3rSecret!' })
    expect(res.status).toBe(200)
    expect(db.operator.create.mock.calls[0][0].data.password).toBeNull()
  })

  it('(c) missing RGPD consent → 400, no account created', async () => {
    const res = await post({ name: 'Marco', email: 'marco@grubano.com', consent: false, formStartedAt: 0 })
    expect(res.status).toBe(400)
    expect(db.operator.create).not.toHaveBeenCalled()
  })

  it('(c) honeypot filled → generic 200 but NO account created (anti-bot preserved)', async () => {
    const res = await post({ ...VALID, website: 'http://spam.example' })
    expect(res.status).toBe(200)
    expect(db.operator.create).not.toHaveBeenCalled()
  })

  it('too-fast submit (formStartedAt now) → generic 200, no account', async () => {
    const res = await post({ ...VALID, formStartedAt: Date.now() })
    expect(res.status).toBe(200)
    expect(db.operator.create).not.toHaveBeenCalled()
  })

  it('duplicate email → generic 200, no second account (anti-enumeration)', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'existing' })
    const res = await post(VALID)
    expect(res.status).toBe(200)
    expect(db.operator.create).not.toHaveBeenCalled()
  })

  it('off-host request → 404 (host gate)', async () => {
    const res = await post(VALID, 'www.grubano.com')
    expect(res.status).toBe(404)
    expect(db.operator.create).not.toHaveBeenCalled()
  })

  it('invalid email → 400, no account', async () => {
    const res = await post({ ...VALID, email: 'not-an-email' })
    expect(res.status).toBe(400)
    expect(db.operator.create).not.toHaveBeenCalled()
  })
})
