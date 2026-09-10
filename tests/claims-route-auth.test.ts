// tests/claims-route-auth.test.ts — AUTHORIZATION ORDER & ABUSE (Claims batch 1)
//
// Baseline P1: `POST /api/claims` uploaded the evidence photo to Cloudinary AND ran the
// LLM moderation chain BEFORE createClaim checked order ownership, with no rate limit.
// Any authenticated user could therefore burn upload + moderation budget on ANY orderId.
// Beta has no photo requirement, so the expensive path is REMOVED, not merely reordered.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { db } = vi.hoisted(() => ({
  db: {
    order:  { findUnique: vi.fn() },
    claim:  { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund: { aggregate: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { tokenMock } = vi.hoisted(() => ({ tokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))

// The whole point: this must NEVER be called from the claim path.
const { processDishImageMock } = vi.hoisted(() => ({ processDishImageMock: vi.fn() }))
vi.mock('@/lib/dish-photo', () => ({
  processDishImage: processDishImageMock,
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'] as const,
}))

const { rateLimitMock } = vi.hoisted(() => ({ rateLimitMock: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rateLimitMock }))

vi.mock('@/lib/refund', () => ({ executeRefund: vi.fn(), isRefundsEnabled: () => false }))
const { ackMock, decisionMock } = vi.hoisted(() => ({ ackMock: vi.fn(), decisionMock: vi.fn() }))
vi.mock('@/lib/claim-emails', () => ({ sendClaimAckEmail: ackMock, sendClaimDecisionEmail: decisionMock }))

import { POST } from '@/app/api/claims/route'

const ORDER = { id: 'o1', consumerId: 'owner', restaurantId: 'r1', paymentStatus: 'paid', total: 32.5, updatedAt: new Date(), items: [{ itemId: 'm1', name: 'Gnocchi', qty: 2, price: 12.5 }] }
const post = (body: unknown) =>
  POST(new Request('https://app.grubano.com/api/claims', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never)

const BIG_IMAGE = 'data:image/jpeg;base64,' + 'A'.repeat(5000)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CLAIMS_ENABLED = 'true'
  tokenMock.mockResolvedValue({ sub: 'owner' })
  rateLimitMock.mockReturnValue(null)
  db.order.findUnique.mockResolvedValue(ORDER)
  db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
  db.claim.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'cl1', ...data }))
  db.claim.findFirst.mockResolvedValue(null)
  db.claim.count.mockResolvedValue(0)
  ackMock.mockResolvedValue(undefined)
  decisionMock.mockResolvedValue(undefined)
})

describe('gate & authentication come first', () => {
  it('CLAIMS_ENABLED=false → 403 gated, no token read, no DB work, no image work', async () => {
    process.env.CLAIMS_ENABLED = 'false'
    const res = await post({ orderId: 'o1', reason: 'quality' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ gated: true })
    expect(tokenMock).not.toHaveBeenCalled()
    expect(db.order.findUnique).not.toHaveBeenCalled()
    expect(processDishImageMock).not.toHaveBeenCalled()
  })

  it('unauthenticated → 401 with NO DB work and NO image work', async () => {
    tokenMock.mockResolvedValue(null)
    const res = await post({ orderId: 'o1', reason: 'quality', imageBase64: BIG_IMAGE })
    expect(res.status).toBe(401)
    expect(db.order.findUnique).not.toHaveBeenCalled()
    expect(db.claim.create).not.toHaveBeenCalled()
    expect(processDishImageMock).not.toHaveBeenCalled()
  })

  it('rate limited → 429 before any parsing or DB work', async () => {
    const { NextResponse } = await import('next/server')
    rateLimitMock.mockReturnValue(NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 }))
    const res = await post({ orderId: 'o1', reason: 'quality', imageBase64: BIG_IMAGE })
    expect(res.status).toBe(429)
    expect(db.order.findUnique).not.toHaveBeenCalled()
    expect(processDishImageMock).not.toHaveBeenCalled()
  })

  it('the create path IS rate limited (the limiter is actually consulted)', async () => {
    await post({ orderId: 'o1', reason: 'quality' })
    expect(rateLimitMock).toHaveBeenCalledTimes(1)
    expect(rateLimitMock.mock.calls[0][1]).toBe('claims:create')
  })
})

describe('OWNERSHIP before any expensive or side-effecting work', () => {
  it('a claim on ANOTHER customer’s order → 403 and NOTHING is uploaded, moderated or created', async () => {
    tokenMock.mockResolvedValue({ sub: 'attacker' })
    const res = await post({ orderId: 'o1', reason: 'quality', imageBase64: BIG_IMAGE, mediaType: 'image/jpeg' })
    expect(res.status).toBe(403)
    expect(processDishImageMock).not.toHaveBeenCalled()
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('an unknown order → 404, no image work, no create', async () => {
    db.order.findUnique.mockResolvedValue(null)
    const res = await post({ orderId: 'nope', reason: 'quality', imageBase64: BIG_IMAGE })
    expect(res.status).toBe(404)
    expect(processDishImageMock).not.toHaveBeenCalled()
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('even for the LEGITIMATE owner, no photo is ever uploaded or moderated in beta', async () => {
    const res = await post({ orderId: 'o1', reason: 'quality', imageBase64: BIG_IMAGE, mediaType: 'image/jpeg' })
    expect(res.status).toBe(201)
    expect(processDishImageMock).not.toHaveBeenCalled()
    // and the client is TOLD its photo was not kept, rather than left to assume it was
    expect(await res.json()).toMatchObject({ photoAccepted: false })
    expect(db.claim.create.mock.calls[0][0].data.photoUrl).toBeNull()
  })
})

describe('FINANCIAL AUTHORITY is server-derived at the route boundary', () => {
  it('a forged requestedAmountCents is ignored — the server derives the whole-order value', async () => {
    const res = await post({ orderId: 'o1', reason: 'quality', requestedAmountCents: 999999 })
    expect(res.status).toBe(201)
    expect(db.claim.create.mock.calls[0][0].data.requestedAmountCents).toBe(3250)
  })

  it('a line SELECTION is priced from server values, not from anything the client sent', async () => {
    const res = await post({
      orderId: 'o1', reason: 'missing_item',
      items: [{ index: 0, qty: 1, price: 9999, lineCents: 9999 }],
      requestedAmountCents: 999999,
    })
    expect(res.status).toBe(201)
    expect(db.claim.create.mock.calls[0][0].data.requestedAmountCents).toBe(1250)
  })

  it('a forged quantity above what was purchased → 400, nothing created', async () => {
    const res = await post({ orderId: 'o1', reason: 'missing_item', items: [{ index: 0, qty: 99 }] })
    expect(res.status).toBe(400)
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('a forged item index → 400, nothing created', async () => {
    const res = await post({ orderId: 'o1', reason: 'missing_item', items: [{ index: 42, qty: 1 }] })
    expect(res.status).toBe(400)
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('an oversized selection payload cannot widen authority (schema-bounded)', async () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ index: i, qty: 1 }))
    const res = await post({ orderId: 'o1', reason: 'missing_item', items })
    expect(res.status).toBe(400)
    expect(db.claim.create).not.toHaveBeenCalled()
  })
})

// ── NEGATIVE CONTROL ────────────────────────────────────────────────────────────
// Prove this suite would actually detect "expensive work before ownership": run the OLD
// order (moderate first, verify ownership second) against a non-owner and show the
// assertion these tests make would fail. The vulnerable variant exists only here.
describe('negative control — upload-before-ownership would be caught', () => {
  it('the old order calls the moderation chain for a NON-OWNER; the shipped route does not', async () => {
    const vulnerablePost = async (body: { orderId: string; imageBase64?: string }, callerId: string) => {
      if (body.imageBase64) await processDishImageMock(body.imageBase64, 'image/jpeg') // ← the bug
      const order = await db.order.findUnique({ where: { id: body.orderId } })
      if (!order || order.consumerId !== callerId) return { status: 403 }
      return { status: 201 }
    }
    const vres = await vulnerablePost({ orderId: 'o1', imageBase64: BIG_IMAGE }, 'attacker')
    expect(vres.status).toBe(403)
    expect(processDishImageMock).toHaveBeenCalledTimes(1) // the defect this suite exists to catch

    processDishImageMock.mockClear()
    tokenMock.mockResolvedValue({ sub: 'attacker' })
    const res = await post({ orderId: 'o1', reason: 'quality', imageBase64: BIG_IMAGE })
    expect(res.status).toBe(403)
    expect(processDishImageMock).not.toHaveBeenCalled() // shipped route: zero expensive work
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH 2 — the reason's authority scope enforced at the route boundary.
// ═══════════════════════════════════════════════════════════════════════════════
describe('BATCH 2 — an item-specific reason cannot claim the whole order through the API', () => {
  it('missing_item with NO selection → 400, nothing created', async () => {
    const res = await post({ orderId: 'o1', reason: 'missing_item', requestedAmountCents: 3250 })
    expect(res.status).toBe(400)
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('missing_item WITH a selection → 201, priced from server lines', async () => {
    const res = await post({ orderId: 'o1', reason: 'missing_item', items: [{ index: 0, qty: 1 }] })
    expect(res.status).toBe(201)
    expect(db.claim.create.mock.calls[0][0].data.requestedAmountCents).toBe(1250)
  })

  it('the legacy alias wrong_order inherits the item requirement', async () => {
    const res = await post({ orderId: 'o1', reason: 'wrong_order' })
    expect(res.status).toBe(400)
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('a legacy reason is STORED in its canonical form', async () => {
    const res = await post({ orderId: 'o1', reason: 'not_delivered' })
    expect(res.status).toBe(201)
    expect(db.claim.create.mock.calls[0][0].data.reason).toBe('not_received')
  })

  it('an order-level reason keeps the whole-order ceiling', async () => {
    const res = await post({ orderId: 'o1', reason: 'restaurant_closed' })
    expect(res.status).toBe(201)
    expect(db.claim.create.mock.calls[0][0].data.requestedAmountCents).toBe(3250)
  })

  it('a safety claim is accepted, stored as allergen_safety, and triggers NO refund', async () => {
    const res = await post({ orderId: 'o1', reason: 'allergen_safety', description: 'réaction allergique' })
    expect(res.status).toBe(201)
    const data = db.claim.create.mock.calls[0][0].data
    expect(data.reason).toBe('allergen_safety')
    expect(data.status).toBe('restaurant_review') // human review, never an automatic refund
  })

  it('an unknown reason is still rejected by the schema', async () => {
    const res = await post({ orderId: 'o1', reason: 'give_me_money' })
    expect(res.status).toBe(400)
    expect(db.order.findUnique).not.toHaveBeenCalled()
  })
})

// ── AUDIT FIX (batch 2) — THE SAFETY GUARD MUST NOT BE INERT ─────────────────────
// A previous fix in this very batch looked correct and did nothing at runtime (a CAS whose
// `where` could never match). `autoResolveSmallClaim` now refuses safety reasons — but only
// if the reason actually REACHES it. This drives the REAL route end to end: the object the
// route hands to the machine path is whatever `prisma.claim.create` returned, so if that
// object has no `reason` field the guard silently evaporates. Assert the behaviour, through
// the route, with the auto-resolve configuration deliberately switched ON.
describe('AUDIT FIX — the safety exclusion survives the real route (not inert)', () => {
  beforeEach(() => {
    process.env.CLAIM_AUTO_RESOLVE_ENABLED = 'true'
    process.env.CLAIM_AUTO_APPROVE_MAX_CENTS = '10000' // well above the order total
    db.claim.updateMany.mockResolvedValue({ count: 1 })
  })
  afterEach(() => {
    delete process.env.CLAIM_AUTO_RESOLVE_ENABLED
    delete process.env.CLAIM_AUTO_APPROVE_MAX_CENTS
  })

  it('the created row really carries the CANONICAL reason (the guard has something to read)', async () => {
    const res = await post({ orderId: 'o1', reason: 'not_delivered', description: 'x' }) // legacy alias
    expect(res.status).toBe(201)
    expect(db.claim.create.mock.calls[0][0].data.reason).toBe('not_received')
  })

  it('an allergen claim is created but NEVER approved by the machine', async () => {
    const res = await post({ orderId: 'o1', reason: 'allergen_safety', description: 'réaction' })
    expect(res.status).toBe(201)
    expect(db.claim.create).toHaveBeenCalled()          // the claim is filed…
    expect(db.claim.updateMany).not.toHaveBeenCalled()  // …and no approval transition happens
  })

  it('a comparable NON-safety claim DOES take the machine path — proving the test can tell them apart', async () => {
    const res = await post({ orderId: 'o1', reason: 'quality', description: 'froid' })
    expect(res.status).toBe(201)
    expect(db.claim.updateMany).toHaveBeenCalled()
  })

  it('with auto-resolve OFF neither reason is auto-approved (the guard is not what carries this)', async () => {
    delete process.env.CLAIM_AUTO_RESOLVE_ENABLED
    await post({ orderId: 'o1', reason: 'quality', description: 'froid' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })
})
