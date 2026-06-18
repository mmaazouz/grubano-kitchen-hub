import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P4.5-C1 — claim routes: client create/GET + restaurant respond ───────────────
// Flag gating, auth, owner-scoping, optional-photo pass-through. lib/claims, the photo
// chain, the establishment scope and auth are mocked.

const { flag, createMock, listMock, eligMock, respondMock } = vi.hoisted(() => ({
  flag: vi.fn(), createMock: vi.fn(), listMock: vi.fn(), eligMock: vi.fn(), respondMock: vi.fn(),
}))
vi.mock('@/lib/claims', () => ({
  isClaimsEnabled: flag,
  createClaim: createMock,
  listConsumerClaims: listMock,
  getClaimEligibility: eligMock,
  respondToClaim: respondMock,
  CLAIM_REASONS: ['missing_item', 'wrong_order', 'quality', 'not_delivered', 'other'],
}))

const { photoMock } = vi.hoisted(() => ({ photoMock: vi.fn() }))
vi.mock('@/lib/dish-photo', () => ({ processDishImage: photoMock, ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'] }))

const { tokenMock } = vi.hoisted(() => ({ tokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))

const { scopeMock } = vi.hoisted(() => ({ scopeMock: vi.fn() }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: scopeMock }))

import { POST as CREATE, GET as LIST } from '@/app/api/claims/route'
import { POST as RESPOND } from '@/app/api/claims/[id]/respond/route'

const req = (body?: unknown, url = 'https://app.grubano.com/api/claims') =>
  ({ url, json: async () => body ?? {} }) as never

beforeEach(() => {
  vi.clearAllMocks()
  flag.mockReturnValue(true)
  tokenMock.mockResolvedValue({ sub: 'c1' })
  createMock.mockResolvedValue({ ok: true, claim: { id: 'cl1' } })
  listMock.mockResolvedValue([])
  eligMock.mockResolvedValue({ canClaim: true, maxRefundableCents: 5000, windowHours: 48, existingClaim: null })
  respondMock.mockResolvedValue({ ok: true, claim: { id: 'cl1', status: 'refunded' }, refund: { state: 'refunded', refundId: 'rf1' } })
  scopeMock.mockResolvedValue({ ok: true, ownedIds: ['r1'], operatorId: 'op1' })
  photoMock.mockResolvedValue({ ok: true, url: 'https://cdn/x.jpg', warnings: [] })
})

describe('POST /api/claims (client create)', () => {
  it('(f) flag OFF → 403 gated, no create', async () => {
    flag.mockReturnValue(false)
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality' }))
    expect(res.status).toBe(403)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('no session → 401', async () => {
    tokenMock.mockResolvedValue(null)
    expect((await CREATE(req({ orderId: 'o1', reason: 'quality' }))).status).toBe(401)
  })

  it('valid → 201, consumerId from session (never client-supplied)', async () => {
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality', requestedAmountCents: 2500 }))
    expect(res.status).toBe(201)
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ consumerId: 'c1', orderId: 'o1', reason: 'quality', requestedAmountCents: 2500, photoUrl: null }))
  })

  it('with photo → processDishImage uploaded, url passed; rejected photo → its status', async () => {
    await CREATE(req({ orderId: 'o1', reason: 'quality', imageBase64: 'abc', mediaType: 'image/jpeg' }))
    expect(photoMock).toHaveBeenCalledWith('abc', 'image/jpeg')
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ photoUrl: 'https://cdn/x.jpg' }))

    photoMock.mockResolvedValue({ ok: false, status: 422, error: 'refusée' })
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality', imageBase64: 'abc', mediaType: 'image/jpeg' }))
    expect(res.status).toBe(422)
  })

  it('engine error status surfaced (e.g. 409 dup)', async () => {
    createMock.mockResolvedValue({ ok: false, status: 409, error: 'déjà en cours' })
    expect((await CREATE(req({ orderId: 'o1', reason: 'quality' }))).status).toBe(409)
  })
})

describe('GET /api/claims', () => {
  it('flag OFF → enabled:false (UI renders nothing)', async () => {
    flag.mockReturnValue(false)
    const res = await LIST(req(undefined))
    expect(await res.json()).toEqual({ enabled: false })
  })
  it('?orderId → eligibility', async () => {
    const res = await LIST(req(undefined, 'https://app.grubano.com/api/claims?orderId=o1'))
    expect(eligMock).toHaveBeenCalledWith({ consumerId: 'c1', orderId: 'o1' })
    expect(await res.json()).toMatchObject({ enabled: true, eligibility: { canClaim: true } })
  })
})

describe('POST /api/claims/[id]/respond (restaurant)', () => {
  it('(f) flag OFF → 403', async () => {
    flag.mockReturnValue(false)
    expect((await RESPOND(req({ action: 'accept' }), { params: { id: 'cl1' } })).status).toBe(403)
    expect(respondMock).not.toHaveBeenCalled()
  })

  it('accept → respondToClaim with owned ids from session scope', async () => {
    const res = await RESPOND(req({ action: 'accept' }), { params: { id: 'cl1' } })
    expect(res.status).toBe(200)
    expect(respondMock).toHaveBeenCalledWith({ claimId: 'cl1', restaurantIds: ['r1'], action: 'accept', reason: undefined })
  })

  it('(IDOR) lib returns 404 → surfaced verbatim', async () => {
    respondMock.mockResolvedValue({ ok: false, status: 404, error: 'Réclamation introuvable.' })
    expect((await RESPOND(req({ action: 'accept' }), { params: { id: 'cl1' } })).status).toBe(404)
  })

  it('scope failure (not an operator) → surfaced', async () => {
    scopeMock.mockResolvedValue({ ok: false, status: 403, error: 'refusé' })
    expect((await RESPOND(req({ action: 'accept' }), { params: { id: 'cl1' } })).status).toBe(403)
    expect(respondMock).not.toHaveBeenCalled()
  })
})
