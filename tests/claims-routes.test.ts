import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { openClaimsWindow, closeClaimsWindow } from './support/claims-window'

// ── P4.5-C1 — claim routes: client create/GET + restaurant respond ───────────────
// Flag gating, auth, owner-scoping, optional-photo pass-through. lib/claims, the photo
// chain, the establishment scope and auth are mocked.
//
// D′ L1 (spec v2 §3, S-23): the gate is lib/claim-flags (process.env only), not a function of lib/claims a mock could
// answer. Opened here the legacy way (the lease — S-12: surface AND intake together) and closed by removing it. Under
// the PRODUCT surface, filing a NEW claim additionally needs CLAIMS_INTAKE_ENABLED (intake_closed shape).

const { createMock, listMock, eligMock, respondMock, autoMock } = vi.hoisted(() => ({
  createMock: vi.fn(), listMock: vi.fn(), eligMock: vi.fn(), respondMock: vi.fn(), autoMock: vi.fn(),
}))
vi.mock('@/lib/claims', () => ({
  createClaim: createMock,
  listConsumerClaims: listMock,
  getClaimEligibility: eligMock,
  respondToClaim: respondMock,
  autoResolveSmallClaim: autoMock, // C2 — called by the create route post-create (no-op for non-small)
  // CLAIMS BATCH 2 — the route validates against the canonical taxonomy plus the two
  // legacy aliases, so the mock must expose the list the route actually imports.
  CLAIM_REASONS: ['missing_item', 'wrong_item', 'wrong_quantity', 'quality', 'restaurant_closed', 'excessive_wait', 'not_received', 'payment_issue', 'allergen_safety', 'other'],
  ACCEPTED_REASONS: ['missing_item', 'wrong_item', 'wrong_quantity', 'quality', 'restaurant_closed', 'excessive_wait', 'not_received', 'payment_issue', 'allergen_safety', 'other', 'wrong_order', 'not_delivered'],
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

const PRODUCT_FLAGS = ['CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED'] as const

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of PRODUCT_FLAGS) delete process.env[k]
  openClaimsWindow() // D′ L1: the real gate, opened as Mode A/B opened it
  tokenMock.mockResolvedValue({ sub: 'c1' })
  createMock.mockResolvedValue({ ok: true, claim: { id: 'cl1', consumerId: 'c1', requestedAmountCents: 2500, status: 'restaurant_review' } })
  autoMock.mockResolvedValue({ state: 'not_eligible' })
  listMock.mockResolvedValue([])
  eligMock.mockResolvedValue({ canClaim: true, maxRefundableCents: 5000, windowHours: 48, existingClaim: null })
  respondMock.mockResolvedValue({ ok: true, claim: { id: 'cl1', status: 'refunded' }, refund: { state: 'refunded', refundId: 'rf1' } })
  scopeMock.mockResolvedValue({ ok: true, ownedIds: ['r1'], operatorId: 'op1' })
  photoMock.mockResolvedValue({ ok: true, url: 'https://cdn/x.jpg', warnings: [] })
})
afterEach(() => { closeClaimsWindow(); for (const k of PRODUCT_FLAGS) delete process.env[k] })

describe('POST /api/claims (client create)', () => {
  it('(f) surface CLOSED (no lease) → 403 gated, no create', async () => {
    closeClaimsWindow()
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ gated: true })
    expect(createMock).not.toHaveBeenCalled()
  })

  it('(f) D′ L1 (S-23) — product SURFACE open, INTAKE closed → 403 intake_closed (gated:false), no token read, no create; INTAKE open → 201', async () => {
    closeClaimsWindow()
    process.env.CLAIMS_SURFACE_ENABLED = 'true'; process.env.CLAIMS_INTAKE_ENABLED = 'false'
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Dépôt de réclamation suspendu', gated: false, enabled: true, intakeOpen: false, reason: 'intake_closed' })
    expect(tokenMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
    process.env.CLAIMS_INTAKE_ENABLED = 'true'
    expect((await CREATE(req({ orderId: 'o1', reason: 'quality' }))).status).toBe(201)
    expect(createMock).toHaveBeenCalledTimes(1)
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

  // CONTRACT CHANGE (Claims batch 1): beta has NO photo requirement, and the upload +
  // moderation chain used to run BEFORE the ownership check, so any authenticated user could
  // burn Cloudinary + LLM budget on any orderId. The expensive path is REMOVED, not reordered.
  it('a photo is NEVER uploaded or moderated in beta; the claim still succeeds and says so', async () => {
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality', imageBase64: 'abc', mediaType: 'image/jpeg' }))
    expect(res.status).toBe(201)
    expect(photoMock).not.toHaveBeenCalled()
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ photoUrl: null }))
    expect(await res.json()).toMatchObject({ photoAccepted: false })
  })

  it('a photo that WOULD have been rejected no longer fails the claim (it is never processed)', async () => {
    photoMock.mockResolvedValue({ ok: false, status: 422, error: 'refusée' })
    const res = await CREATE(req({ orderId: 'o1', reason: 'quality', imageBase64: 'abc', mediaType: 'image/jpeg' }))
    expect(res.status).toBe(201)
    expect(photoMock).not.toHaveBeenCalled()
  })

  it('engine error status surfaced (e.g. 409 dup)', async () => {
    createMock.mockResolvedValue({ ok: false, status: 409, error: 'déjà en cours' })
    expect((await CREATE(req({ orderId: 'o1', reason: 'quality' }))).status).toBe(409)
  })
})

describe('GET /api/claims', () => {
  it('surface CLOSED (no lease) → enabled:false (UI renders nothing), no token read', async () => {
    closeClaimsWindow()
    const res = await LIST(req(undefined))
    expect(await res.json()).toEqual({ enabled: false })
    expect(tokenMock).not.toHaveBeenCalled()
  })
  it('?orderId → eligibility (D′ L1: intakeOpen:true under the lease, the engine verdict as is)', async () => {
    const res = await LIST(req(undefined, 'https://app.grubano.com/api/claims?orderId=o1'))
    expect(eligMock).toHaveBeenCalledWith({ consumerId: 'c1', orderId: 'o1' })
    expect(await res.json()).toMatchObject({ enabled: true, intakeOpen: true, eligibility: { canClaim: true } })
  })
  it('D′ L1 (S-23) — ?orderId with the product SURFACE open and INTAKE closed → the route OVERLAYS canClaim:false / intake_closed on the engine verdict (existingClaim kept); history unchanged', async () => {
    closeClaimsWindow()
    process.env.CLAIMS_SURFACE_ENABLED = 'true'; process.env.CLAIMS_INTAKE_ENABLED = 'false'
    const res = await LIST(req(undefined, 'https://app.grubano.com/api/claims?orderId=o1'))
    expect(await res.json()).toEqual({ enabled: true, intakeOpen: false, eligibility: { canClaim: false, reason: 'intake_closed', maxRefundableCents: 5000, windowHours: 48, existingClaim: null } })
    // NEGATIVE CONTROL — the engine itself answered canClaim:true: the overlay is the route's, never the engine's.
    expect(await eligMock.mock.results[0].value).toMatchObject({ canClaim: true })
    expect(await (await LIST(req(undefined))).json()).toEqual({ enabled: true, claims: [] })
  })
})

describe('POST /api/claims/[id]/respond (restaurant)', () => {
  it('(f) surface CLOSED (no lease) → 403', async () => {
    closeClaimsWindow()
    expect((await RESPOND(req({ action: 'accept' }), { params: { id: 'cl1' } })).status).toBe(403)
    expect(respondMock).not.toHaveBeenCalled()
  })
  it('D′ L1 — a restaurant decision needs the SURFACE only: product SURFACE open, INTAKE closed → 200', async () => {
    closeClaimsWindow()
    process.env.CLAIMS_SURFACE_ENABLED = 'true'; process.env.CLAIMS_INTAKE_ENABLED = 'false'
    expect((await RESPOND(req({ action: 'accept' }), { params: { id: 'cl1' } })).status).toBe(200)
    expect(respondMock).toHaveBeenCalledTimes(1)
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
