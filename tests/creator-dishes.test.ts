import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── Mission 3 — l'éditeur de recettes créateur ────────────────────────────────
// Route-level spec of the engraved business rules (décisions Agent 0):
//   R1  pristine recipe (no adoption all-time, no sale) → real DELETE
//   R3  ACTIVE adoption → content PATCH 409 (photo stays free) · DELETE 409
//   R4  any history (past adoption or sale) → DELETE becomes 'archived'
//   submit: draft → vetting outcome (pass→approved · flag→pending · reject→rejected)
// Ownership is strict: someone else's dish (or no creator profile) is a 404.

const { db } = vi.hoisted(() => ({
  db: {
    creator:          { findUnique: vi.fn() },
    creatorDish:      { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
    dishAdoption:     { count: vi.fn() },
    dishSale:         { count: vi.fn() },
    adoptionWaitlist: { deleteMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { vetMock } = vi.hoisted(() => ({ vetMock: vi.fn() }))
vi.mock('@/lib/dish-submit', () => ({ runDishVetting: vetMock }))

import { PATCH, DELETE } from '@/app/api/creators/dishes/[id]/route'
import { POST as SUBMIT } from '@/app/api/creators/dishes/[id]/submit/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.CREATOR_ENABLED = 'true' })
afterEach(() => { delete process.env.CREATOR_ENABLED })

const dish = {
  id: 'd1', creatorId: 'c1', status: 'approved',
  name: 'Gnocchi truffe', description: 'Gnocchi maison, crème de truffe noire.',
  ingredients: ['gnocchi', 'truffe'], cuisineType: 'italien', suggestedPrice: 14.5,
  photo: null,
}

const patchReq = (body: Record<string, unknown>) =>
  new Request('https://app.grubano.com/api/creators/dishes/d1', {
    method: 'PATCH', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
const patch  = (body: Record<string, unknown>) => PATCH(patchReq(body), { params: { id: 'd1' } })
const remove = () =>
  DELETE(new Request('https://app.grubano.com/api/creators/dishes/d1', { method: 'DELETE' }),
    { params: { id: 'd1' } })
const submit = () =>
  SUBMIT(new Request('https://app.grubano.com/api/creators/dishes/d1/submit', { method: 'POST' }),
    { params: { id: 'd1' } })

/** dishAdoption.count is called twice (active-only, then all-time). */
const setHistory = (active: number, allTime: number, sales: number) => {
  db.dishAdoption.count.mockImplementation(({ where }: { where: { status?: string } }) =>
    Promise.resolve(where.status === 'active' ? active : allTime))
  db.dishSale.count.mockResolvedValue(sales)
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ user: { email: 'chef@example.com' } })
  db.creator.findUnique.mockResolvedValue({ id: 'c1' })
  db.creatorDish.findFirst.mockResolvedValue(dish)
  db.creatorDish.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ ...dish, ...data }))
  db.creatorDish.delete.mockResolvedValue(dish)
  db.adoptionWaitlist.deleteMany.mockResolvedValue({ count: 0 })
  setHistory(0, 0, 0)
  vetMock.mockResolvedValue({ status: 'approved', reason: 'ok' })
})

describe('ownership is strict — 404, never reveal existence', () => {
  it("PATCH 404 when the dish belongs to another creator", async () => {
    db.creatorDish.findFirst.mockResolvedValue(null) // findFirst is scoped creatorId
    expect((await patch({ name: 'Volé' })).status).toBe(404)
    expect(db.creatorDish.update).not.toHaveBeenCalled()
  })

  it('PATCH 404 when the session has no creator profile', async () => {
    db.creator.findUnique.mockResolvedValue(null)
    expect((await patch({ name: 'Fantôme' })).status).toBe(404)
  })

  it('PATCH 401 without a session', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await patch({ name: 'Anonyme' })).status).toBe(401)
  })
})

describe('R3 — active adoption locks the content (photo stays free)', () => {
  beforeEach(() => setHistory(1, 1, 5))

  it('content PATCH → 409 content_locked, nothing written', async () => {
    const res = await patch({ name: 'Nouveau nom' })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('content_locked')
    expect(db.creatorDish.update).not.toHaveBeenCalled()
    expect(vetMock).not.toHaveBeenCalled()
  })

  it('photo-only PATCH → 200, status untouched, no re-vetting', async () => {
    const res = await patch({ photo: 'https://res.cloudinary.com/x/p.jpg' })
    expect(res.status).toBe(200)
    expect(db.creatorDish.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ photo: 'https://res.cloudinary.com/x/p.jpg', status: 'approved' }),
    }))
    expect(vetMock).not.toHaveBeenCalled()
  })

  it('DELETE → 409 has_active_adoption (« archivez-la plutôt »)', async () => {
    const res = await remove()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('has_active_adoption')
    expect(db.creatorDish.delete).not.toHaveBeenCalled()
    expect(db.creatorDish.update).not.toHaveBeenCalled()
  })
})

describe('R2 — content edit on an approved recipe re-runs the vetting', () => {
  it('the merged content is vetted and the status follows the verdict', async () => {
    vetMock.mockResolvedValue({ status: 'pending', reason: 'à revoir' })
    const res = await patch({ name: 'Gnocchi 4 fromages' })
    expect(res.status).toBe(200)
    expect(vetMock).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Gnocchi 4 fromages', cuisineType: 'italien', // merged: new name + kept fields
    }), expect.anything()) // M7 — runDishVetting now also receives { creatorId, excludeDishId }
    expect(db.creatorDish.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'pending' }),
    }))
  })
})

describe('R4/R1 — deletion: history → archived, pristine → real delete', () => {
  it('DELETE → archived when a past adoption exists (R4)', async () => {
    setHistory(0, 2, 0) // no ACTIVE adoption, but all-time history
    const res = await remove()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ archived: true })
    expect(db.creatorDish.update).toHaveBeenCalledWith(
      { where: { id: 'd1' }, data: { status: 'archived' } })
    expect(db.creatorDish.delete).not.toHaveBeenCalled()
  })

  it('DELETE → archived when sales exist even without adoption rows (R4)', async () => {
    setHistory(0, 0, 3)
    expect(await (await remove()).json()).toMatchObject({ archived: true })
    expect(db.creatorDish.delete).not.toHaveBeenCalled()
  })

  it('DELETE → real deletion when pristine (R1)', async () => {
    setHistory(0, 0, 0)
    expect(await (await remove()).json()).toMatchObject({ deleted: true })
    expect(db.creatorDish.delete).toHaveBeenCalledWith({ where: { id: 'd1' } })
  })
})

describe('submit — draft goes through the vetting and lands on the verdict', () => {
  beforeEach(() => db.creatorDish.findFirst.mockResolvedValue({ ...dish, status: 'draft' }))

  it("flag verdict → the dish stays 'pending' (manual review)", async () => {
    vetMock.mockResolvedValue({ status: 'pending', reason: 'photo ambiguë' })
    const res = await submit()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ verdict: 'pending', reason: 'photo ambiguë' })
    expect(db.creatorDish.update).toHaveBeenCalledWith(
      { where: { id: 'd1' }, data: { status: 'pending' } })
  })

  it("pass verdict → 'approved'", async () => {
    const res = await submit()
    expect((await res.json()).verdict).toBe('approved')
    expect(db.creatorDish.update).toHaveBeenCalledWith(
      { where: { id: 'd1' }, data: { status: 'approved' } })
  })

  it('409 when the dish is not submittable (approved already)', async () => {
    db.creatorDish.findFirst.mockResolvedValue(dish) // status 'approved'
    expect((await submit()).status).toBe(409)
    expect(vetMock).not.toHaveBeenCalled()
  })
})
