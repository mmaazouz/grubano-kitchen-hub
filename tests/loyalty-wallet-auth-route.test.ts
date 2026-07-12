import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── GET /api/loyalty/wallet — PII-enumeration + cross-tenant hardening ─────────
// The ?email= branch is an OPERATOR/ADMIN action (the /loyalty screen consulting a
// client wallet).
//   • WP-SEC-01 (authn): anonymous/consumer cannot read others' wallets.
//   • WP-SEC-02 (tenancy): a RESTAURATEUR is fenced to customers who ordered chez
//     lui — he can no longer read ANY platform customer's wallet + cross-tenant
//     order history by guessing an email. Admin keeps the platform-wide view.
// A consumer reads ONLY their own wallet via the no-param session fallback.

const { db, getToken, loyalty, scope } = vi.hoisted(() => ({
  db: { loyaltyCustomer: { findUnique: vi.fn(), findFirst: vi.fn() } },
  getToken: vi.fn(),
  loyalty: { centsPerPoint: vi.fn(() => 10), pointsToCents: vi.fn((p: number) => p * 10) },
  scope: { loyaltyCustomerWhereForOperator: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken }))
vi.mock('@/lib/loyalty', () => loyalty)
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(() => null) }))
vi.mock('@/lib/customer-scope', () => scope)

import { GET } from '@/app/api/loyalty/wallet/route'

const req = (qs = '') => GET(new NextRequest(`http://x/api/loyalty/wallet${qs}`))

const CUSTOMER = {
  pointsBalance: 240, tier: 'gold', referralCode: 'abcd1234ef',
  orders: [],
}
const FENCE = { OR: [{ orders: { some: { brand: { operatorId: 'op1' } } } }] }

beforeEach(() => {
  vi.clearAllMocks()
  db.loyaltyCustomer.findUnique.mockResolvedValue(CUSTOMER)
  db.loyaltyCustomer.findFirst.mockResolvedValue(CUSTOMER)
  scope.loyaltyCustomerWhereForOperator.mockResolvedValue(FENCE)
})

describe('?email= branch — authn (PII leak closed)', () => {
  it('anonymous + ?email= → 401, NO db read', async () => {
    getToken.mockResolvedValue(null)
    const res = await req('?email=victim@x.fr')
    expect(res.status).toBe(401)
    expect(db.loyaltyCustomer.findUnique).not.toHaveBeenCalled()
    expect(db.loyaltyCustomer.findFirst).not.toHaveBeenCalled()
  })

  it('consumer session + ?email= (someone else) → 403, NO db read (cannot enumerate)', async () => {
    getToken.mockResolvedValue({ role: 'consumer', email: 'me@x.fr' })
    const res = await req('?email=victim@x.fr')
    expect(res.status).toBe(403)
    expect(db.loyaltyCustomer.findUnique).not.toHaveBeenCalled()
    expect(db.loyaltyCustomer.findFirst).not.toHaveBeenCalled()
  })
})

describe('?email= branch — tenant scoping (WP-SEC-02)', () => {
  it('restaurant + ?email= (own customer) → 200, TENANT-SCOPED findFirst (never unscoped findUnique)', async () => {
    getToken.mockResolvedValue({ role: 'restaurant', email: 'op@x.fr', sub: 'op1' })
    const res = await req('?email=client@x.fr')
    expect(res.status).toBe(200)
    expect(scope.loyaltyCustomerWhereForOperator).toHaveBeenCalledWith('op1')
    expect(db.loyaltyCustomer.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{ email: 'client@x.fr' }, FENCE] } }),
    )
    // recent orders fenced to the caller's OWN brands (no competitor brand names).
    const arg = db.loyaltyCustomer.findFirst.mock.calls[0][0]
    expect(arg.include.orders.where).toEqual({ brand: { operatorId: 'op1' } })
    // the unscoped path must NOT be used for a restaurant caller.
    expect(db.loyaltyCustomer.findUnique).not.toHaveBeenCalled()
    expect(await res.json()).toMatchObject({ pointsBalance: 240, tier: 'gold' })
  })

  it('restaurant + ?email= (NOT his customer) → 404, no oracle, no unscoped read', async () => {
    getToken.mockResolvedValue({ role: 'restaurant', email: 'op@x.fr', sub: 'op1' })
    db.loyaltyCustomer.findFirst.mockResolvedValue(null)
    const res = await req('?email=victim-of-other-resto@x.fr')
    expect(res.status).toBe(404)
    expect(db.loyaltyCustomer.findUnique).not.toHaveBeenCalled()
  })

  it('restaurant with no operator id (sub) + ?email= → 403 (cannot resolve tenant)', async () => {
    getToken.mockResolvedValue({ role: 'restaurant', email: 'op@x.fr' })
    const res = await req('?email=client@x.fr')
    expect(res.status).toBe(403)
    expect(db.loyaltyCustomer.findFirst).not.toHaveBeenCalled()
  })

  it('admin + ?email= → 200, PLATFORM-WIDE (unscoped findUnique — admin spans tenants)', async () => {
    getToken.mockResolvedValue({ role: 'admin', sub: 'adm1' })
    const res = await req('?email=client@x.fr')
    expect(res.status).toBe(200)
    expect(db.loyaltyCustomer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'client@x.fr' } }),
    )
    expect(db.loyaltyCustomer.findFirst).not.toHaveBeenCalled()
    expect(scope.loyaltyCustomerWhereForOperator).not.toHaveBeenCalled()
  })
})

describe('no-param branch — consumer reads own wallet via session (unchanged)', () => {
  it('consumer session, no ?email → 200, reads OWN wallet by session email (unscoped findUnique)', async () => {
    getToken.mockResolvedValue({ role: 'consumer', email: 'me@x.fr' })
    const res = await req()
    expect(res.status).toBe(200)
    expect(db.loyaltyCustomer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'me@x.fr' } }),
    )
    expect(db.loyaltyCustomer.findFirst).not.toHaveBeenCalled()
  })

  it('anonymous, no ?email → 400 (no session, no target — no leak)', async () => {
    getToken.mockResolvedValue(null)
    const res = await req()
    expect(res.status).toBe(400)
    expect(db.loyaltyCustomer.findUnique).not.toHaveBeenCalled()
  })

  it('operator with no ?email → reads their own session email (not an enumeration path)', async () => {
    getToken.mockResolvedValue({ role: 'restaurant', email: 'op@x.fr', sub: 'op1' })
    const res = await req()
    expect(res.status).toBe(200)
    expect(db.loyaltyCustomer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'op@x.fr' } }),
    )
    // no ?email → NOT a scoped enumeration path.
    expect(db.loyaltyCustomer.findFirst).not.toHaveBeenCalled()
  })
})
