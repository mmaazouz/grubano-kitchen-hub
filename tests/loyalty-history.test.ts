import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Chantier fidélité L2 — GET /api/loyalty/history (read-only ledger) ─────────
// Session-aware resolution (token.email → LoyaltyCustomer → its transactions),
// signed points preserved, euro magnitude from the REAL rate (lib/loyalty),
// empty profile → clean empty ledger, take capped at 30.

const { db } = vi.hoisted(() => ({
  db: {
    loyaltyCustomer:    { findUnique: vi.fn() },
    loyaltyTransaction: { findMany: vi.fn(), count: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { tokenMock } = vi.hoisted(() => ({ tokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))

// lib/loyalty stays REAL — we assert the euro conversion uses the true rate.
import { GET } from '@/app/api/loyalty/history/route'
import { centsPerPoint } from '@/lib/loyalty'

const call = (url = 'https://app.grubano.com/api/loyalty/history') =>
  GET(new Request(url) as never)

beforeEach(() => {
  vi.clearAllMocks()
  tokenMock.mockResolvedValue({ email: 'client@example.com' })
  db.loyaltyCustomer.findUnique.mockResolvedValue({ id: 'lc1', pointsBalance: 240 })
  db.loyaltyTransaction.findMany.mockResolvedValue([
    { id: 't1', type: 'earn',   points: 14,   orderId: 'order_abc123def', createdAt: new Date('2026-06-12') },
    { id: 't2', type: 'redeem', points: -100, orderId: 'order_xyz789ghi', createdAt: new Date('2026-06-11') },
    { id: 't3', type: 'refund', points: 100,  orderId: null,              createdAt: new Date('2026-06-10') },
  ])
  db.loyaltyTransaction.count.mockResolvedValue(3)
})

describe('auth + empty profile', () => {
  it('401 when there is no session email', async () => {
    tokenMock.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('IGNORES a caller-supplied ?email (no IDOR) — resolves the SESSION email only', async () => {
    const res = await call('https://app.grubano.com/api/loyalty/history?email=victim@example.com')
    expect(res.status).toBe(200)
    // The lookup must use the session email, NEVER the attacker-supplied param.
    expect(db.loyaltyCustomer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'client@example.com' } }))
    expect(db.loyaltyCustomer.findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'victim@example.com' } }))
  })

  it('401 even WITH a ?email when the session is absent (param never authenticates)', async () => {
    tokenMock.mockResolvedValue(null)
    expect((await call('https://app.grubano.com/api/loyalty/history?email=victim@example.com')).status).toBe(401)
  })

  it('no loyalty profile yet → clean empty ledger, not an error', async () => {
    db.loyaltyCustomer.findUnique.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ transactions: [], total: 0, pointsBalance: 0 })
    expect(db.loyaltyTransaction.findMany).not.toHaveBeenCalled()
  })
})

describe('the ledger', () => {
  it('resolves session email → customer → its transactions, newest first preserved', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(db.loyaltyCustomer.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'client@example.com' } }))
    expect(db.loyaltyTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerId: 'lc1' }, orderBy: { createdAt: 'desc' } }))
    expect(body.transactions).toHaveLength(3)
    expect(body.total).toBe(3)
  })

  it('keeps the SIGNED points and derives euros from the real rate', async () => {
    const body = await (await call()).json()
    const cpp = centsPerPoint()
    const [earn, redeem, refund] = body.transactions
    expect(earn.points).toBe(14)
    expect(redeem.points).toBe(-100)
    expect(refund.points).toBe(100)
    // euros = |points| × centsPerPoint / 100 (server conversion, never client)
    expect(redeem.euros).toBeCloseTo(100 * cpp / 100, 5)
    expect(earn.type).toBe('earn')
    expect(redeem.type).toBe('redeem')
    expect(refund.type).toBe('refund')
  })

  it('builds a short order ref from orderId (#last6 upper) and null when no order', async () => {
    const body = await (await call()).json()
    expect(body.transactions[0].orderRef).toBe('#123DEF')  // last 6 of order_abc123def → '123def'
    expect(body.transactions[2].orderRef).toBeNull()       // refund had no orderId
  })

  it('exposes the balance + its euro equivalent (server rate)', async () => {
    const body = await (await call()).json()
    expect(body.pointsBalance).toBe(240)
    expect(body.balanceCents).toBe(240 * centsPerPoint())
  })
})

describe('pagination', () => {
  it('caps take at 30 even when a larger take is requested', async () => {
    await call('https://app.grubano.com/api/loyalty/history?take=100')
    expect(db.loyaltyTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 30 }))
  })

  it('honours a smaller take + skip', async () => {
    await call('https://app.grubano.com/api/loyalty/history?take=5&skip=10')
    expect(db.loyaltyTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, skip: 10 }))
  })

  it('a malformed ?take/?skip falls back to defaults — never 500s (NaN-safe)', async () => {
    const res = await call('https://app.grubano.com/api/loyalty/history?take=abc&skip=xyz')
    expect(res.status).toBe(200)
    expect(db.loyaltyTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20, skip: 0 }))
  })

  it('floors a fractional take so Prisma never sees a non-integer', async () => {
    await call('https://app.grubano.com/api/loyalty/history?take=5.9')
    expect(db.loyaltyTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }))
  })
})
