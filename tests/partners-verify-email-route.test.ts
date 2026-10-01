import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { sha256 } from '@/lib/partner-verification'

// ── GET /api/partners/verify-email — P6 anti-lockout activation (Agent 24) ────
// A verified PASSWORDLESS partner must reach status='active' so POST /api/auth/
// magic-link will mint a sign-in link (it mints ONLY for 'active'). This route
// promotes 'pending' → 'active' on a valid token. Real partner-verification crypto
// is used (sha256) so the timing-safe compare passes against a real token.

const { db } = vi.hoisted(() => ({
  db: { operator: { findUnique: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { GET } from '@/app/api/partners/verify-email/route'

const future = () => new Date(Date.now() + 60_000)
function req(token: string) {
  return GET(new NextRequest(`http://business.grubano.com/api/partners/verify-email?token=${encodeURIComponent(token)}`))
}

beforeEach(() => {
  vi.clearAllMocks()
  db.operator.update.mockResolvedValue({})
})

describe('GET /api/partners/verify-email', () => {
  it('valid token on a pending account → promotes to ACTIVE (passwordless can then magic-link)', async () => {
    const token = 'op1.thesecret'
    db.operator.findUnique.mockResolvedValue({
      id: 'op1', status: 'pending', verifyTokenHash: sha256('thesecret'), verifyTokenExpiry: future(),
    })
    const res = await req(token)
    expect(res.status).toBe(303)
    expect(res.headers.get('Location')).toContain('status=success')
    const arg = db.operator.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'op1' })
    expect(arg.data.status).toBe('active')              // ← the anti-lockout fix
    expect(arg.data.emailVerifiedAt).toBeInstanceOf(Date)
    expect(arg.data.verifyTokenHash).toBeNull()         // single-use
    expect(arg.data.verifyTokenExpiry).toBeNull()
  })

  it('never downgrades an already-advanced account (status preserved)', async () => {
    const token = 'op2.sec'
    db.operator.findUnique.mockResolvedValue({
      id: 'op2', status: 'active', verifyTokenHash: sha256('sec'), verifyTokenExpiry: future(),
    })
    await req(token)
    expect(db.operator.update.mock.calls[0][0].data.status).toBe('active')
  })

  it('wrong secret → invalid, no write', async () => {
    db.operator.findUnique.mockResolvedValue({
      id: 'op1', status: 'pending', verifyTokenHash: sha256('thesecret'), verifyTokenExpiry: future(),
    })
    const res = await req('op1.WRONG')
    expect(res.headers.get('Location')).toContain('status=invalid')
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('already consumed (hash cleared) → used, no write', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', status: 'active', verifyTokenHash: null, verifyTokenExpiry: null })
    const res = await req('op1.sec')
    expect(res.headers.get('Location')).toContain('status=used')
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('expired token → expired, no write', async () => {
    db.operator.findUnique.mockResolvedValue({
      id: 'op1', status: 'pending', verifyTokenHash: sha256('sec'), verifyTokenExpiry: new Date(Date.now() - 1000),
    })
    const res = await req('op1.sec')
    expect(res.headers.get('Location')).toContain('status=expired')
    expect(db.operator.update).not.toHaveBeenCalled()
  })
})
