import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── GET /api/business/activation — restaurateur path (mission CA) ──────────────────────
// Covers the loader of the two NAMED OUTPUTS of Contract v1.1: `prepared` and `cardReady`.
// The scope was arbitrated by the founder: PER ESTABLISHMENT. What is asserted here is the
// SCOPING of the two new counts — that only brands ATTACHED to the resolved establishment
// are counted, and only AVAILABLE dishes carried by them (D11). The REAL activation engine
// is used; prisma/auth/roles/affiliate-account are mocked. No write, no money.

const { db, session, roles, affAccount } = vi.hoisted(() => ({
  db: {
    operator:        { findUnique: vi.fn() },
    creator:         { findUnique: vi.fn() },
    supplierProfile: { findUnique: vi.fn() },
    brand:           { findFirst: vi.fn(), count: vi.fn() },
    restaurant:      { findFirst: vi.fn() },
    menuItem:        { count: vi.fn() },
  },
  session: vi.fn(),
  roles: { readOperatorRoles: vi.fn() },
  affAccount: { isAffiliateEnabled: vi.fn(), getAffiliateByOperator: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/operator-roles', () => roles)
vi.mock('@/lib/affiliate-account', () => affAccount)

import { GET } from '@/app/api/business/activation/route'

const get = () => GET(new Request('http://x/api/business/activation'))

const ESTAB = { id: 'r1', isActive: false, stripeAccountStatus: null }

beforeEach(() => {
  vi.clearAllMocks()
  session.mockResolvedValue({ user: { email: 'r@x.fr' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant', status: 'active', emailVerifiedAt: new Date() })
  roles.readOperatorRoles.mockResolvedValue(['restaurant'])
  affAccount.isAffiliateEnabled.mockReturnValue(true)
  affAccount.getAffiliateByOperator.mockResolvedValue(null)
  db.brand.findFirst.mockResolvedValue({ id: 'b1' })
  db.restaurant.findFirst.mockResolvedValue(ESTAB)
  db.menuItem.count.mockResolvedValue(0)
  db.brand.count.mockResolvedValue(0)
})
afterEach(() => { vi.clearAllMocks() })

describe('PRÉPARÉ — carried by the establishment alone (arbitration B2)', () => {
  it('is false with no establishment, even when the operator owns a brand', async () => {
    db.restaurant.findFirst.mockResolvedValue(null)
    const body = await (await get()).json()
    expect(body.checklist.prepared).toBe(false)
  })

  it('is true as soon as the establishment exists', async () => {
    const body = await (await get()).json()
    expect(body.checklist.prepared).toBe(true)
  })
})

describe('CARTE PRÊTE — the two counts are scoped to THE establishment (D11)', () => {
  it('counts only brands whose restaurantId IS the resolved establishment', async () => {
    db.brand.count.mockResolvedValue(2)
    db.menuItem.count.mockResolvedValue(5) // legacy owner-wide count, then the scoped one
    await get()
    expect(db.brand.count.mock.calls[0][0].where).toEqual({ operatorId: 'op1', restaurantId: 'r1' })
  })

  it('counts only AVAILABLE dishes carried by those attached brands', async () => {
    db.brand.count.mockResolvedValue(1)
    await get()
    // call 0 = legacy owner-wide menuItemCount; call 1 = the scoped, available-only count
    expect(db.menuItem.count.mock.calls[1][0].where).toEqual({
      available: true,
      brand: { operatorId: 'op1', restaurantId: 'r1' },
    })
  })

  it('skips the scoped dish query when no brand is attached — the count is 0 by construction', async () => {
    db.brand.count.mockResolvedValue(0)
    const body = await (await get()).json()
    expect(db.menuItem.count).toHaveBeenCalledTimes(1) // the legacy one only
    expect(body.checklist.cardReady).toEqual({ value: false, reason: 'no_attached_brand' })
  })

  it('issues neither scoped query without an establishment, and still exposes the capacity', async () => {
    db.restaurant.findFirst.mockResolvedValue(null)
    const body = await (await get()).json()
    expect(db.brand.count).not.toHaveBeenCalled()
    expect(db.menuItem.count).toHaveBeenCalledTimes(1)
    expect(body.checklist.cardReady).toEqual({ value: false, reason: 'no_establishment' })
  })

  it('reports no_available_dish when the attached brands carry only unavailable dishes', async () => {
    db.brand.count.mockResolvedValue(1)
    db.menuItem.count.mockResolvedValueOnce(7).mockResolvedValueOnce(0) // 7 owner-wide, 0 available+attached
    const body = await (await get()).json()
    expect(body.checklist.cardReady).toEqual({ value: false, reason: 'no_available_dish' })
  })

  it('holds when an attached brand carries an available dish', async () => {
    db.brand.count.mockResolvedValue(1)
    db.menuItem.count.mockResolvedValueOnce(4).mockResolvedValueOnce(4)
    const body = await (await get()).json()
    expect(body.checklist.cardReady).toEqual({ value: true, reason: null })
  })

  it('stays false when the operator owns dishes but none is attached to the establishment', async () => {
    // The divergence the contract asked to close: the legacy menu step turns done,
    // the contract-conform capacity does not.
    db.brand.count.mockResolvedValue(0)
    db.menuItem.count.mockResolvedValue(12)
    const body = await (await get()).json()
    expect(body.checklist.steps.find((s: { id: string }) => s.id === 'menu').state).toBe('done')
    expect(body.checklist.cardReady.value).toBe(false)
  })
})

describe('the restaurateur payload is otherwise unchanged', () => {
  it('keeps the six steps, their order and their gates', async () => {
    const body = await (await get()).json()
    expect(body.role).toBe('restaurant')
    expect(body.checklist.steps.map((s: { id: string }) => s.id)).toEqual([
      'account', 'establishment', 'menu', 'publish', 'payments', 'payouts',
    ])
    expect(body.checklist.steps.map((s: { gate: number }) => s.gate)).toEqual([0, 1, 1, 2, 3, 4])
  })

  it('still loads the legacy owner-wide signals it always loaded', async () => {
    await get()
    expect(db.menuItem.count.mock.calls[0][0].where).toEqual({ brand: { operatorId: 'op1' } })
    expect(db.restaurant.findFirst.mock.calls[0][0].where).toEqual({ operatorId: 'op1', archivedAt: null })
  })
})
