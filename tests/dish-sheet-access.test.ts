import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── Mission 6 — the D1 lock + the D2 gate, route level ─────────────────────────
//   GET /api/dishes/[id]/sheet : 404 for a NON-adopter resto / 200 for the
//   adopter (active or ended), the creator, the admin.
//   POST /api/creators/dishes/[id]/submit : 400 without allergens on a
//   sheet-era recipe / OK for a legacy recipe without any sheet.

const { db } = vi.hoisted(() => ({
  db: {
    creatorDish:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    creator:      { findUnique: vi.fn() },
    dishAdoption: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { vetMock } = vi.hoisted(() => ({ vetMock: vi.fn() }))
vi.mock('@/lib/dish-submit', () => ({ runDishVetting: vetMock }))

import { GET as SHEET } from '@/app/api/dishes/[id]/sheet/route'
import { POST as SUBMIT } from '@/app/api/creators/dishes/[id]/submit/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.CREATOR_ENABLED = 'true' })
afterEach(() => { delete process.env.CREATOR_ENABLED })

const dishRow = {
  id: 'd1', creatorId: 'c1', name: 'Gnocchi truffe', photo: null,
  cuisineType: 'italien', suggestedPrice: 14, status: 'approved',
}
const SHEET_JSON = {
  baseServings: 4,
  ingredients: [{ name: 'gnocchi', qty: 400, unit: 'g' }],
  steps: ['Pocher.', 'Saucer.'],
  allergens: ['gluten'],
}

const getSheet = () =>
  SHEET(new Request('https://app.grubano.com/api/dishes/d1/sheet'), { params: { id: 'd1' } })
const submit = () =>
  SUBMIT(new Request('https://app.grubano.com/api/creators/dishes/d1/submit', { method: 'POST' }),
    { params: { id: 'd1' } })

beforeEach(() => {
  vi.clearAllMocks()
  db.creatorDish.findUnique.mockResolvedValue(dishRow)
  // readDishSheets' explicit select — the sheet exists by default.
  db.creatorDish.findMany.mockResolvedValue([{ id: 'd1', sheet: SHEET_JSON }])
  db.creator.findUnique.mockResolvedValue(null)
  db.dishAdoption.findFirst.mockResolvedValue(null)
  db.creatorDish.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...dishRow, ...data }))
  vetMock.mockResolvedValue({ status: 'approved', reason: 'ok' })
})

describe('GET /api/dishes/[id]/sheet — the D1 server lock', () => {
  it('404 for a restaurateur WITHOUT any adoption of the recipe', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'op-stranger', role: 'restaurant', email: 'resto@x.fr' } })
    const res = await getSheet()
    expect(res.status).toBe(404) // never reveals the asset exists
  })

  it('200 for the ADOPTER (active adoption)', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'op1', role: 'restaurant', email: 'resto@x.fr' } })
    db.dishAdoption.findFirst.mockResolvedValue({ id: 'a1' })
    const res = await getSheet()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sheet.steps).toEqual(['Pocher.', 'Saucer.'])
    expect(body.completeness).toBeGreaterThan(0)
    // The ownership filter asked for active OR ended adoptions of THIS operator.
    expect(db.dishAdoption.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        creatorDishId: 'd1',
        status: { in: ['active', 'ended'] },
        brand:  { operatorId: 'op1' },
      }),
    }))
  })

  it('200 for the CREATOR of the recipe', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'op-creator', role: 'creator', email: 'chef@x.fr' } })
    db.creator.findUnique.mockResolvedValue({ id: 'c1' }) // matches dish.creatorId
    expect((await getSheet()).status).toBe(200)
  })

  it('200 for an admin', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'adm', role: 'admin', email: 'a@x.fr' } })
    expect((await getSheet()).status).toBe(200)
  })

  it('401 without a session', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await getSheet()).status).toBe(401)
  })
})

describe('POST submit — the D2 allergens gate', () => {
  beforeEach(() => {
    sessionMock.mockResolvedValue({ user: { email: 'chef@x.fr' } })
    db.creator.findUnique.mockResolvedValue({ id: 'c1' })
    db.creatorDish.findFirst.mockResolvedValue({ ...dishRow, status: 'draft', description: 'desc', ingredients: ['gnocchi'] })
  })

  it('400 allergens_required when the sheet exists WITHOUT a declaration', async () => {
    db.creatorDish.findMany.mockResolvedValue([{ id: 'd1', sheet: { ...SHEET_JSON, allergens: undefined } }])
    const res = await submit()
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('allergens_required')
    expect(vetMock).not.toHaveBeenCalled()
  })

  it("explicit ['none'] passes the gate", async () => {
    db.creatorDish.findMany.mockResolvedValue([{ id: 'd1', sheet: { ...SHEET_JSON, allergens: ['none'] } }])
    expect((await submit()).status).toBe(200)
    expect(vetMock).toHaveBeenCalled()
  })

  it('LEGACY recipe without any sheet keeps submitting (D2 tolerance)', async () => {
    db.creatorDish.findMany.mockResolvedValue([{ id: 'd1', sheet: null }])
    expect((await submit()).status).toBe(200)
    expect(vetMock).toHaveBeenCalled()
  })

  it('pre-db-push window (sheet select throws) behaves as legacy', async () => {
    db.creatorDish.findMany.mockRejectedValue(new Error('Unknown column sheet'))
    expect((await submit()).status).toBe(200)
  })
})
