import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Promo V2 Slice 1 — POST /api/restaurant/promotions accepts the new types ──
// Integration at the route boundary: the new types validate, the per-type bounds
// are enforced, and the create persists type + conditions verbatim.

const { db } = vi.hoisted(() => ({
  db: {
    brand:     { findMany: vi.fn() },
    menuItem:  { count: vi.fn() },
    promotion: { create: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { scopeMock } = vi.hoisted(() => ({ scopeMock: vi.fn() }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: scopeMock }))

import { POST } from '@/app/api/restaurant/promotions/route'

const body = (over: Record<string, unknown> = {}) =>
  new Request('https://app.grubano.com/api/restaurant/promotions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      brandId: 'b1', name: 'Promo test', type: 'percent', discount: 10,
      startDate: '2026-06-12T00:00:00.000Z', endDate: '2026-06-30T00:00:00.000Z',
      ...over,
    }),
  })

// POST always returns a NextResponse at runtime; assert non-null for the type.
const post = async (over: Record<string, unknown> = {}) => {
  const r = await POST(body(over))
  return r as NonNullable<typeof r>
}

beforeEach(() => {
  vi.clearAllMocks()
  scopeMock.mockResolvedValue({ ok: true, restaurantId: 'r1' })
  db.brand.findMany.mockResolvedValue([{ id: 'b1', name: 'Brand', emoji: '🍴' }])
  db.menuItem.count.mockResolvedValue(0)
  db.promotion.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'newp', ...data }))
})

describe('second_item', () => {
  it('creates a « 2e à −50% » promo (type + whole percent persisted)', async () => {
    const res = await post({ type: 'second_item', discount: 50 })
    expect(res.status).toBe(201)
    expect(db.promotion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'second_item', discount: 50 }),
    }))
  })
  it('rejects an out-of-range percent (1..90)', async () => {
    expect((await post({ type: 'second_item', discount: 120 })).status).toBe(400)
    expect(db.promotion.create).not.toHaveBeenCalled()
  })
})

describe('threshold_reward', () => {
  it('creates a « dessert offert dès 18€ » free_item promo (conditions persisted)', async () => {
    db.menuItem.count.mockResolvedValue(1) // the freeItemIds pool is owned
    const res = await post({
      type: 'threshold_reward', discount: 0,
      conditions: { thresholdEur: 18, rewardKind: 'free_item', freeItemIds: ['dessert1'] },
    })
    expect(res.status).toBe(201)
    expect(db.promotion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'threshold_reward',
        conditions: expect.objectContaining({ thresholdEur: 18, rewardKind: 'free_item', freeItemIds: ['dessert1'] }),
      }),
    }))
    // freeItemIds ownership is checked against the establishment menu.
    expect(db.menuItem.count).toHaveBeenCalled()
  })
  it('creates a « −20% dès 25€ » percent reward', async () => {
    const res = await post({
      type: 'threshold_reward', discount: 0,
      conditions: { thresholdEur: 25, rewardKind: 'percent', rewardPct: 20 },
    })
    expect(res.status).toBe(201)
  })
  it('rejects a threshold_reward without a threshold', async () => {
    expect((await post({ type: 'threshold_reward', discount: 0, conditions: { rewardKind: 'percent', rewardPct: 20 } })).status).toBe(400)
  })
  it('rejects a percent reward out of range', async () => {
    expect((await post({ type: 'threshold_reward', discount: 0, conditions: { thresholdEur: 25, rewardKind: 'percent', rewardPct: 99 } })).status).toBe(400)
  })
  it('rejects an unknown reward kind', async () => {
    expect((await post({ type: 'threshold_reward', discount: 0, conditions: { thresholdEur: 25 } })).status).toBe(400)
  })
  it('rejects free_item WITHOUT an offered-item pool (no whole-order giveaway)', async () => {
    expect((await post({ type: 'threshold_reward', discount: 0, conditions: { thresholdEur: 18, rewardKind: 'free_item' } })).status).toBe(400)
    expect(db.promotion.create).not.toHaveBeenCalled()
  })
})

describe('non-régression — le flat percent existant', () => {
  it('crée toujours un percent classique', async () => {
    const res = await post({ type: 'percent', discount: 15 })
    expect(res.status).toBe(201)
    expect(db.promotion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'percent', discount: 15 }),
    }))
  })
})
