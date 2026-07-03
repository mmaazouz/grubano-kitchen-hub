import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── GET /api/loyalty/wallet — WP-SEC-01 PII-enumeration hardening ──────────────
// The ?email= branch is an OPERATOR/ADMIN action (the /loyalty screen consulting a
// client wallet). Before the fix it had NO auth → anyone could read any consumer's
// points/tier/referral/last-10-orders by guessing an email. Now: ?email= requires
// session + operator/admin role; a consumer reads ONLY their own wallet via the
// no-param session fallback (unchanged).

const { db, getToken, loyalty } = vi.hoisted(() => ({
  db: { loyaltyCustomer: { findUnique: vi.fn() } },
  getToken: vi.fn(),
  loyalty: { centsPerPoint: vi.fn(() => 10), pointsToCents: vi.fn((p: number) => p * 10) },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('@/lib/loyalty', () => loyalty)

import { GET } from '@/app/api/loyalty/wallet/route'

const req = (qs = '') => GET(new NextRequest(`http://x/api/loyalty/wallet${qs}`))

const CUSTOMER = {
  pointsBalance: 240, tier: 'gold', referralCode: 'abcd1234ef',
  orders: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  db.loyaltyCustomer.findUnique.mockResolvedValue(CUSTOMER)
})

describe('?email= branch — operator/admin only (PII leak closed)', () => {
  it('anonymous + ?email= → 401, NO db read', async () => {
    getToken.mockResolvedValue(null)
    const res = await req('?email=victim@x.fr')
    expect(res.status).toBe(401)
    expect(db.loyaltyCustomer.findUnique).not.toHaveBeenCalled()
  })

  it('consumer session + ?email= (someone else) → 403, NO db read (cannot enumerate)', async () => {
    getToken.mockResolvedValue({ role: 'consumer', email: 'me@x.fr' })
    const res = await req('?email=victim@x.fr')
    expect(res.status).toBe(403)
    expect(db.loyaltyCustomer.findUnique).not.toHaveBeenCalled()
  })

  it('operator (restaurant) + ?email= → 200, reads that wallet', async () => {
    getToken.mockResolvedValue({ role: 'restaurant', email: 'op@x.fr' })
    const res = await req('?email=client@x.fr')
    expect(res.status).toBe(200)
    expect(db.loyaltyCustomer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'client@x.fr' } }),
    )
    expect(await res.json()).toMatchObject({ pointsBalance: 240, tier: 'gold' })
  })

  it('admin + ?email= → 200', async () => {
    getToken.mockResolvedValue({ role: 'admin' })
    const res = await req('?email=client@x.fr')
    expect(res.status).toBe(200)
  })
})

describe('no-param branch — consumer reads own wallet via session (unchanged)', () => {
  it('consumer session, no ?email → 200, reads OWN wallet by session email', async () => {
    getToken.mockResolvedValue({ role: 'consumer', email: 'me@x.fr' })
    const res = await req()
    expect(res.status).toBe(200)
    expect(db.loyaltyCustomer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'me@x.fr' } }),
    )
  })

  it('anonymous, no ?email → 400 (no session, no target — no leak)', async () => {
    getToken.mockResolvedValue(null)
    const res = await req()
    expect(res.status).toBe(400)
    expect(db.loyaltyCustomer.findUnique).not.toHaveBeenCalled()
  })

  it('operator with no ?email → reads their own session email (not an enumeration path)', async () => {
    getToken.mockResolvedValue({ role: 'restaurant', email: 'op@x.fr' })
    const res = await req()
    expect(res.status).toBe(200)
    expect(db.loyaltyCustomer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'op@x.fr' } }),
    )
  })
})
