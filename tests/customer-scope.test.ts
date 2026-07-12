import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── lib/customer-scope — tenant fence + PII MASKING (founder hybrid model) ─────
// The restaurateur NEVER sees a customer's contact details. Every function here
// must: (1) mask the name to "first + last initial", (2) NEVER return email/phone/
// address, (3) stay tenant-fenced (a resto never sees a customer who never ordered
// chez lui). Allergen/dietary notes surface PER ORDER, never as a stored profile.

const { db } = vi.hoisted(() => ({
  db: {
    restaurant:      { findMany: vi.fn() },
    brand:           { findMany: vi.fn() },
    order:           { findMany: vi.fn() },
    operator:        { findMany: vi.fn() },
    loyaltyOrder:    { findMany: vi.fn() },
    loyaltyCustomer: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  maskCustomerName,
  loyaltyCustomerWhereForOperator,
  getScopedCustomers,
  getCustomerProfile,
} from '@/lib/customer-scope'

const OP_A = 'op-A'
const CUSTOMER = {
  id: 'lc1', name: 'Mohammed Maazouz', email: 'c1@x.fr',
  pointsBalance: 1240, tier: 'gold', createdAt: new Date('2025-03-01'),
}

beforeEach(() => {
  vi.clearAllMocks()
  db.restaurant.findMany.mockResolvedValue([{ id: 'r1' }])
  db.brand.findMany.mockResolvedValue([{ id: 'b1' }])
  db.operator.findMany.mockImplementation((args: { where?: { id?: unknown; email?: unknown } }) => {
    const w = args?.where ?? {}
    if (w.id) return Promise.resolve([{ email: 'c1@x.fr' }])       // customerEmailsFromEatOrders
    if (w.email) return Promise.resolve([{ id: 'cons1', email: 'c1@x.fr' }]) // collectOrders path B
    return Promise.resolve([])
  })
  db.order.findMany.mockImplementation((args: { distinct?: unknown }) => {
    if (args?.distinct) return Promise.resolve([{ consumerId: 'cons1' }])
    return Promise.resolve([
      { consumerId: 'cons1', total: 24.9, createdAt: new Date('2026-07-09'), fulfillmentType: 'delivery',
        items: [{ name: 'Burger maison', qty: 1, options: [{ exclusions: ['arachide'] }] }] },
    ])
  })
  db.loyaltyOrder.findMany.mockResolvedValue([{ customerId: 'lc1', amount: 30, validatedAt: new Date('2026-07-01') }])
  db.loyaltyCustomer.findMany.mockResolvedValue([CUSTOMER])
  db.loyaltyCustomer.count.mockResolvedValue(1)
  db.loyaltyCustomer.findFirst.mockResolvedValue(CUSTOMER)
})

describe('maskCustomerName', () => {
  it('full name → first name + last initial', () => {
    expect(maskCustomerName('Mohammed Maazouz')).toBe('Mohammed M.')
    expect(maskCustomerName('léa rousseau')).toBe('Léa R.')
  })
  it('single token → first name only', () => {
    expect(maskCustomerName('Mohammed')).toBe('Mohammed')
  })
  it('a stored email → local part, never the full address', () => {
    const out = maskCustomerName('karim.benali@gmail.com')
    expect(out).not.toContain('@')
    expect(out.toLowerCase()).toContain('karim')
  })
  it('empty → "Client"', () => {
    expect(maskCustomerName('')).toBe('Client')
    expect(maskCustomerName(null)).toBe('Client')
  })
})

describe('loyaltyCustomerWhereForOperator — the tenant fence', () => {
  it('scopes to MY brands OR MY restaurant customers by email', async () => {
    const where = await loyaltyCustomerWhereForOperator(OP_A)
    expect(where).toEqual({
      OR: [
        { orders: { some: { brand: { operatorId: OP_A } } } },
        { email: { in: ['c1@x.fr'] } },
      ],
    })
  })
})

const CONTACT_KEYS = ['email', 'phone', 'address', 'deliveryAddress', 'referralCode']

describe('getScopedCustomers — masked, contact-free, real aggregates', () => {
  it('restaurant role → masked name + aggregates, and NO contact PII key on any row', async () => {
    const { customers, total } = await getScopedCustomers({ id: OP_A, roles: ['restaurant'] })
    expect(total).toBe(1)
    const row = customers[0]!
    expect(row.name).toBe('Mohammed M.')          // MASKED
    // real relation aggregates: 1 /eat order (24,90) + 1 loyalty order (30,00)
    expect(row.ordersCount).toBe(2)
    expect(row.avgBasketCents).toBe(2745)
    for (const k of CONTACT_KEYS) expect(row).not.toHaveProperty(k)
  })

  it('query is tenant-scoped (never {}) for a restaurateur', async () => {
    await getScopedCustomers({ id: OP_A, roles: ['restaurant'] })
    const call = db.loyaltyCustomer.findMany.mock.calls[0]![0]
    expect(call.where).not.toEqual({})
    expect(call.where.OR[0]).toEqual({ orders: { some: { brand: { operatorId: OP_A } } } })
  })

  it('admin → platform-wide (unscoped) but STILL masked + contact-free', async () => {
    const { customers } = await getScopedCustomers({ id: 'op-admin', roles: ['admin'] })
    expect(db.loyaltyCustomer.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }))
    const row = customers[0]!
    expect(row.name).toBe('Mohammed M.')
    for (const k of CONTACT_KEYS) expect(row).not.toHaveProperty(k)
  })
})

describe('getCustomerProfile — full fiche, still ZERO contact PII', () => {
  it('in-scope customer → masked profile, favorites + per-order dietary note, no contact keys', async () => {
    const p = (await getCustomerProfile({ id: OP_A, roles: ['restaurant'] }, 'lc1'))!
    expect(p).not.toBeNull()
    expect(p.name).toBe('Mohammed M.')
    expect(p.ordersCount).toBe(2)
    expect(p.favorites.some((f) => f.name === 'Burger maison')).toBe(true)
    // allergen/dietary note surfaces PER ORDER (food safety), not as a stored field
    expect(p.recent[0]!.dietaryNote).toContain('arachide')
    for (const k of CONTACT_KEYS) expect(p).not.toHaveProperty(k)
    // findFirst is fenced to (id AND tenant-fence)
    const call = db.loyaltyCustomer.findFirst.mock.calls[0]![0]
    expect(call.where.AND[0]).toEqual({ id: 'lc1' })
  })

  it('out-of-tenant customer → null (404), never a leak', async () => {
    db.loyaltyCustomer.findFirst.mockResolvedValue(null)
    const p = await getCustomerProfile({ id: OP_A, roles: ['restaurant'] }, 'foreign')
    expect(p).toBeNull()
  })
})
