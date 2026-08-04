import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── Promo V2 Slice 2 — chef campaigns + resto opt-in ──────────────────────────
// Chef launch requires ownership + an adopted recipe; opt-in creates a STANDARD
// percent Promotion scoped to the resto's own MenuItem; a non-adopter sees no
// invitation and cannot opt in.

const { db } = vi.hoisted(() => ({
  db: {
    creator:         { findUnique: vi.fn() },
    creatorDish:     { findFirst: vi.fn() },
    dishAdoption:    { count: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    creatorCampaign: { create: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    promotion:       { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    brand:           { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { scopeMock } = vi.hoisted(() => ({ scopeMock: vi.fn() }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: scopeMock }))

import { POST as CHEF_POST } from '@/app/api/creators/campaigns/route'
import { GET as RESTO_GET, POST as RESTO_OPTIN } from '@/app/api/restaurant/campaigns/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.CREATOR_ENABLED = 'true' })
afterEach(() => { delete process.env.CREATOR_ENABLED })

const future = (d: number) => new Date(Date.now() + d * 86_400_000)
const liveCampaign = {
  id: 'camp1', creatorDishId: 'd1', creatorId: 'c1', suggestedDiscountPct: 20,
  message: 'Goûtez ma recette signature !', status: 'active',
  startDate: new Date(Date.now() - 86_400_000), endDate: future(7),
  creatorDish: { name: 'Gnocchi truffe' }, creator: { name: 'Marco' },
}

const chefBody = (over = {}) =>
  new Request('https://app.grubano.com/api/creators/campaigns', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      creatorDishId: 'd1', suggestedDiscountPct: 20, message: 'Goûtez ma recette !',
      startDate: new Date().toISOString(), endDate: future(7).toISOString(), ...over,
    }),
  })
const optinBody = (over = {}) =>
  new Request('https://app.grubano.com/api/restaurant/campaigns', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ campaignId: 'camp1', discountPct: 15, ...over }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ user: { email: 'chef@example.com' } })
  db.creator.findUnique.mockResolvedValue({ id: 'c1' })
  db.creatorDish.findFirst.mockResolvedValue({ id: 'd1', status: 'approved' })
  db.dishAdoption.count.mockResolvedValue(2)
  db.creatorCampaign.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'camp1', ...data }))
  // resto side
  scopeMock.mockResolvedValue({ ok: true, restaurantId: 'r1' })
  db.brand.findMany.mockResolvedValue([{ id: 'b1' }])
  db.dishAdoption.findMany.mockResolvedValue([{ creatorDishId: 'd1', brandId: 'b1', menuItemId: 'mi1' }])
  db.creatorCampaign.findMany.mockResolvedValue([liveCampaign])
  db.promotion.findMany.mockResolvedValue([])         // no existing opt-in
  db.creatorCampaign.findUnique.mockResolvedValue(liveCampaign)
  db.dishAdoption.findFirst.mockResolvedValue({ brandId: 'b1', menuItemId: 'mi1' })
  db.promotion.findFirst.mockResolvedValue(null)
  db.promotion.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: 'promoNew', ...data }))
})

describe('chef launch — ownership + adopted recipe required', () => {
  it('201 when the chef owns an approved, adopted recipe', async () => {
    const res = await CHEF_POST(chefBody())
    expect(res.status).toBe(201)
    expect(db.creatorCampaign.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ creatorDishId: 'd1', creatorId: 'c1', status: 'active', suggestedDiscountPct: 20 }),
    }))
  })
  it('404 when the recipe is not the chef’s', async () => {
    db.creatorDish.findFirst.mockResolvedValue(null)
    expect((await CHEF_POST(chefBody())).status).toBe(404)
    expect(db.creatorCampaign.create).not.toHaveBeenCalled()
  })
  it('400 when the recipe is adopted by NO restaurant', async () => {
    db.dishAdoption.count.mockResolvedValue(0)
    expect((await CHEF_POST(chefBody())).status).toBe(400)
    expect(db.creatorCampaign.create).not.toHaveBeenCalled()
  })
  it('400 on an out-of-range suggested percent', async () => {
    expect((await CHEF_POST(chefBody({ suggestedDiscountPct: 120 }))).status).toBe(400)
  })
})

describe('resto opt-in — creates a STANDARD percent Promotion scoped to the item', () => {
  it('201 and the promo is percent, scoped to the resto’s menuItemId, linked to the campaign', async () => {
    const res = await RESTO_OPTIN(optinBody({ discountPct: 15 }))
    expect(res.status).toBe(201)
    expect(db.promotion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        type: 'percent', discount: 15, brandId: 'b1', campaignId: 'camp1',
        conditions: { itemIds: ['mi1'] },
      }),
    }))
  })
  it('403 when the resto has NOT adopted the recipe', async () => {
    db.dishAdoption.findFirst.mockResolvedValue(null)
    expect((await RESTO_OPTIN(optinBody())).status).toBe(403)
    expect(db.promotion.create).not.toHaveBeenCalled()
  })
  it('409 when already opted in (one promo per resto/campaign)', async () => {
    db.promotion.findFirst.mockResolvedValue({ id: 'existing' })
    expect((await RESTO_OPTIN(optinBody())).status).toBe(409)
    expect(db.promotion.create).not.toHaveBeenCalled()
  })
  it('409 when the campaign is no longer live', async () => {
    db.creatorCampaign.findUnique.mockResolvedValue({ ...liveCampaign, status: 'ended' })
    expect((await RESTO_OPTIN(optinBody())).status).toBe(409)
  })
})

describe('invitations — only for adopters, not already opted in', () => {
  it('lists the live campaign on an adopted recipe', async () => {
    const body = await (await RESTO_GET()).json()
    expect(body.invitations).toHaveLength(1)
    expect(body.invitations[0]).toMatchObject({ campaignId: 'camp1', menuItemId: 'mi1', suggestedDiscountPct: 20 })
  })
  it('a NON-adopter resto sees no invitation', async () => {
    db.dishAdoption.findMany.mockResolvedValue([]) // adopted nothing
    const body = await (await RESTO_GET()).json()
    expect(body.invitations).toEqual([])
  })
  it('hides a campaign already opted into', async () => {
    db.promotion.findMany.mockResolvedValue([{ campaignId: 'camp1' }])
    const body = await (await RESTO_GET()).json()
    expect(body.invitations).toEqual([])
  })
})
