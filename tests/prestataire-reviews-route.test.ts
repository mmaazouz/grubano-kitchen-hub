import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── /api/prestataire-reviews (P5, Agent 78) — anti-fraud, operator-gated, NO money ──
// POST: a restaurant rates a prestataire AFTER ITS OWN 'done' mission (1 per mission). GET:
// reviews + average for a prestataire (fiche). Real isPrestataireEnabled + computeAverage;
// prisma + callerOperator mocked.

const { db, op } = vi.hoisted(() => ({
  db: {
    serviceMission: { findUnique: vi.fn() },
    serviceReview:  { findMany: vi.fn(), create: vi.fn() },
  },
  op: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/operator-session', () => ({ callerOperator: op }))

import { GET, POST } from '@/app/api/prestataire-reviews/route'

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }
const post = (body: unknown) => POST(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const get  = (qs = '') => GET(new Request(`http://x/api/prestataire-reviews${qs}`))

const OK = { serviceMissionId: 'm1', rating: 5, comment: 'Excellent' }

beforeEach(() => {
  vi.clearAllMocks(); ON()
  op.mockResolvedValue({ id: 'op1', role: 'restaurant' })
  db.serviceMission.findUnique.mockResolvedValue({ id: 'm1', status: 'done', restaurantOperatorId: 'op1', prestataireProfileId: 'pp1' })
  db.serviceReview.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'rv1', ...data }))
  db.serviceReview.findMany.mockResolvedValue([])
})
afterEach(() => OFF())

describe('FLAG OFF → 404', () => {
  it('POST + GET 404, no operator lookup, no create', async () => {
    OFF()
    expect((await post(OK)).status).toBe(404)
    expect((await get('?prestataireProfileId=pp1')).status).toBe(404)
    expect(op).not.toHaveBeenCalled()
    expect(db.serviceReview.create).not.toHaveBeenCalled()
  })
})

describe('POST — valid deposit (a) + NO money', () => {
  it('owner of a done mission → 201; author + prestataire come from the SESSION/mission, never the body', async () => {
    const res = await post({ ...OK, restaurantOperatorId: 'EVIL', prestataireProfileId: 'EVIL', amount: 999 })
    expect(res.status).toBe(201)
    const data = db.serviceReview.create.mock.calls[0][0].data
    expect(data.serviceMissionId).toBe('m1')
    expect(data.restaurantOperatorId).toBe('op1')         // ← session, never 'EVIL'
    expect(data.prestataireProfileId).toBe('pp1')         // ← from the mission, never 'EVIL'
    expect(data.rating).toBe(5)
    expect(data.comment).toBe('Excellent')
    expect(data).not.toHaveProperty('amount')             // NO money
    expect(data).not.toHaveProperty('priceCents')
  })
})

describe('POST — anti-fraud (b)', () => {
  it('non-restaurant/non-admin → 403; no session → 401', async () => {
    op.mockResolvedValue({ id: 'op1', role: 'supplier' })
    expect((await post(OK)).status).toBe(403)
    op.mockResolvedValue(null)
    expect((await post(OK)).status).toBe(401)
  })
  it('mission not found → 404', async () => {
    db.serviceMission.findUnique.mockResolvedValue(null)
    expect((await post(OK)).status).toBe(404)
    expect(db.serviceReview.create).not.toHaveBeenCalled()
  })
  it('NOT the owner of the mission → 403 (IDOR), no create', async () => {
    db.serviceMission.findUnique.mockResolvedValue({ id: 'm1', status: 'done', restaurantOperatorId: 'OTHER', prestataireProfileId: 'pp1' })
    expect((await post(OK)).status).toBe(403)
    expect(db.serviceReview.create).not.toHaveBeenCalled()
  })
  it('mission NOT done → 409, no create', async () => {
    db.serviceMission.findUnique.mockResolvedValue({ id: 'm1', status: 'accepted', restaurantOperatorId: 'op1', prestataireProfileId: 'pp1' })
    expect((await post(OK)).status).toBe(409)
    expect(db.serviceReview.create).not.toHaveBeenCalled()
  })
  it('a SECOND review on the same mission → 409 (unique)', async () => {
    const { Prisma } = await import('@prisma/client')
    db.serviceReview.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0' }))
    expect((await post(OK)).status).toBe(409)
  })
  it('rating out of 1..5 → 400; non-integer → 400; missing missionId → 400', async () => {
    expect((await post({ ...OK, rating: 0 })).status).toBe(400)
    expect((await post({ ...OK, rating: 6 })).status).toBe(400)
    expect((await post({ ...OK, rating: 3.5 })).status).toBe(400)
    expect((await post({ rating: 5 })).status).toBe(400)
    expect(db.serviceReview.create).not.toHaveBeenCalled()
  })
})

describe('GET — reviews + average (c), operator-gated', () => {
  it('flag-gated + role-gated', async () => {
    op.mockResolvedValue(null)
    expect((await get('?prestataireProfileId=pp1')).status).toBe(401)
    op.mockResolvedValue({ id: 'op1', role: 'supplier' })
    expect((await get('?prestataireProfileId=pp1')).status).toBe(403)
  })
  it('missing prestataireProfileId → 400', async () => {
    expect((await get()).status).toBe(400)
  })
  it('returns average + count computed from the reviews', async () => {
    db.serviceReview.findMany.mockResolvedValue([
      { id: 'a', rating: 5, comment: 'x', createdAt: new Date() },
      { id: 'b', rating: 4, comment: null, createdAt: new Date() },
      { id: 'c', rating: 4, comment: null, createdAt: new Date() },
    ])
    const d = await (await get('?prestataireProfileId=pp1')).json()
    expect(d.average).toBe(4.3) // 13/3
    expect(d.count).toBe(3)
    expect(d.reviews).toHaveLength(3)
    expect(db.serviceReview.findMany.mock.calls[0][0].where).toEqual({ prestataireProfileId: 'pp1' })
  })
})
