import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mission 4 — POST /api/dishes/waitlist/accept ───────────────────────────────
// The waitlist promotion accept path: a live 'offered' slot becomes an adoption
// via the SAME business path as /adopt (adoptDish). The two mission cases:
//   • accept on an EXPIRED offer → 409/expired (+ lazy promotion of the next)
//   • accept when the exclusivity was taken in between → 409 (adoptDish's verdict)

const { db } = vi.hoisted(() => ({
  db: {
    brand:            { findFirst: vi.fn() },
    adoptionWaitlist: { findFirst: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { adoptMock } = vi.hoisted(() => ({ adoptMock: vi.fn() }))
vi.mock('@/lib/dish-adoption', () => ({ adoptDish: adoptMock }))

const { expiredMock, sweepMock } = vi.hoisted(() => ({ expiredMock: vi.fn(), sweepMock: vi.fn() }))
vi.mock('@/lib/waitlist-promotion', () => ({
  offerExpired:    expiredMock,
  sweepAndPromote: sweepMock,
  WAITLIST_OFFER_TTL_HOURS: 72,
}))

import { POST } from '@/app/api/dishes/waitlist/accept/route'

const call = (body: Record<string, unknown> = { creatorDishId: 'd1' }) =>
  POST(new Request('https://app.grubano.com/api/dishes/waitlist/accept', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  }))

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ user: { id: 'op1', role: 'restaurant' } })
  db.brand.findFirst.mockResolvedValue({ id: 'b1', restaurant: { city: 'Lyon' } })
  db.adoptionWaitlist.findFirst.mockResolvedValue({
    id: 'w1', city: 'Lyon', offeredAt: new Date(), offerExpiresAt: new Date(Date.now() + 3_600_000),
  })
  db.adoptionWaitlist.update.mockResolvedValue({})
  expiredMock.mockReturnValue(false)
  sweepMock.mockResolvedValue(undefined)
  adoptMock.mockResolvedValue({ ok: true, adoption: { id: 'a1' }, menuItem: { id: 'm1' } })
})

describe('guards', () => {
  it('401 without a session', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('403 for a non-restaurateur role', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'op1', role: 'consumer' } })
    expect((await call()).status).toBe(403)
  })

  it('409 no_offer when there is no offered entry for this brand', async () => {
    db.adoptionWaitlist.findFirst.mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('no_offer')
    expect(adoptMock).not.toHaveBeenCalled()
  })
})

describe('the two mission cases', () => {
  it('EXPIRED offer → 409/expired, marks it expired, promotes the next (lazy)', async () => {
    expiredMock.mockReturnValue(true)
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('expired')
    expect(db.adoptionWaitlist.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { status: 'expired' } })
    expect(sweepMock).toHaveBeenCalledWith('d1', 'Lyon')
    expect(adoptMock).not.toHaveBeenCalled()
  })

  it('exclusivity taken in between → adoptDish 409 surfaced verbatim, entry NOT accepted', async () => {
    adoptMock.mockResolvedValue({ ok: false, status: 409, body: { reason: 'city_taken', message: 'Exclusivité locale.' } })
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('city_taken')
    // The offer must NOT be marked accepted when the adoption failed.
    expect(db.adoptionWaitlist.update).not.toHaveBeenCalledWith({ where: { id: 'w1' }, data: { status: 'accepted' } })
  })

  it('happy path → adoption created via adoptDish, entry marked accepted, 201', async () => {
    const res = await call()
    expect(res.status).toBe(201)
    expect(adoptMock).toHaveBeenCalledWith(expect.objectContaining({ operatorId: 'op1', creatorDishId: 'd1', brandId: 'b1' }))
    expect(db.adoptionWaitlist.update).toHaveBeenCalledWith({ where: { id: 'w1' }, data: { status: 'accepted' } })
    expect(await res.json()).toMatchObject({ ok: true, adoption: { id: 'a1' } })
  })
})
