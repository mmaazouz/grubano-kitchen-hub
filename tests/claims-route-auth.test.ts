// tests/claims-route-auth.test.ts — AUTHORIZATION ORDER & ABUSE (Claims batch 1)
//
// Baseline P1: `POST /api/claims` uploaded the evidence photo to Cloudinary AND ran the
// LLM moderation chain BEFORE createClaim checked order ownership, with no rate limit.
// Any authenticated user could therefore burn upload + moderation budget on ANY orderId.
// Beta has no photo requirement, so the expensive path is REMOVED, not merely reordered.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { openClaimsWindow } from './support/claims-window'

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

// D′ L6 (spec v2 §7.1 E3/E4/E5) — DELIVERED-ONLY, and the anchor is `deliveredAt`. The fixture carries
// `status:'delivered'` and a fresh `deliveredAt` because a claim is about food that ARRIVED: without them
// every POST below stops at E3 (not_delivered) and would prove nothing about ownership, pricing or the
// machine path. The flag is NOT decoration — the negative controls just below fail if it is
// removed, or if the window is dated from `updatedAt` (kept here precisely so it can be shown inert).
const ORDER = { id: 'o1', consumerId: 'owner', restaurantId: 'r1', paymentStatus: 'paid', status: 'delivered', total: 32.5, deliveredAt: new Date(), createdAt: new Date(), updatedAt: new Date(), items: [{ itemId: 'm1', name: 'Gnocchi', qty: 2, price: 12.5 }] }
const post = (body: unknown) =>
  POST(new Request('https://app.grubano.com/api/claims', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never)

const BIG_IMAGE = 'data:image/jpeg;base64,' + 'A'.repeat(5000)

beforeEach(() => {
  vi.clearAllMocks()
  openClaimsWindow() // T-53: the flag alone no longer opens the claims surface
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
    const res = await post({ orderId: 'o1', reason: 'quality', scope: 'whole' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ gated: true })
    expect(tokenMock).not.toHaveBeenCalled()
    expect(db.order.findUnique).not.toHaveBeenCalled()
    expect(processDishImageMock).not.toHaveBeenCalled()
  })

  it('unauthenticated → 401 with NO DB work and NO image work', async () => {
    tokenMock.mockResolvedValue(null)
    const res = await post({ orderId: 'o1', reason: 'quality', scope: 'whole', imageBase64: BIG_IMAGE })
    expect(res.status).toBe(401)
    expect(db.order.findUnique).not.toHaveBeenCalled()
    expect(db.claim.create).not.toHaveBeenCalled()
    expect(processDishImageMock).not.toHaveBeenCalled()
  })

  it('rate limited → 429 before any parsing or DB work', async () => {
    const { NextResponse } = await import('next/server')
    rateLimitMock.mockReturnValue(NextResponse.json({ error: 'Trop de requêtes' }, { status: 429 }))
    const res = await post({ orderId: 'o1', reason: 'quality', scope: 'whole', imageBase64: BIG_IMAGE })
    expect(res.status).toBe(429)
    expect(db.order.findUnique).not.toHaveBeenCalled()
    expect(processDishImageMock).not.toHaveBeenCalled()
  })

  it('the create path IS rate limited (the limiter is actually consulted)', async () => {
    await post({ orderId: 'o1', reason: 'quality', scope: 'whole' })
    expect(rateLimitMock).toHaveBeenCalledTimes(1)
    expect(rateLimitMock.mock.calls[0][1]).toBe('claims:create')
  })
})

describe('OWNERSHIP before any expensive or side-effecting work', () => {
  it('a claim on ANOTHER customer’s order → 403 and NOTHING is uploaded, moderated or created', async () => {
    tokenMock.mockResolvedValue({ sub: 'attacker' })
    const res = await post({ orderId: 'o1', reason: 'quality', scope: 'whole', imageBase64: BIG_IMAGE, mediaType: 'image/jpeg' })
    expect(res.status).toBe(403)
    expect(processDishImageMock).not.toHaveBeenCalled()
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('an unknown order → 404, no image work, no create', async () => {
    db.order.findUnique.mockResolvedValue(null)
    const res = await post({ orderId: 'nope', reason: 'quality', scope: 'whole', imageBase64: BIG_IMAGE })
    expect(res.status).toBe(404)
    expect(processDishImageMock).not.toHaveBeenCalled()
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('even for the LEGITIMATE owner, no photo is ever uploaded or moderated in beta', async () => {
    const res = await post({ orderId: 'o1', reason: 'quality', scope: 'whole', imageBase64: BIG_IMAGE, mediaType: 'image/jpeg' })
    expect(res.status).toBe(201)
    expect(processDishImageMock).not.toHaveBeenCalled()
    // and the client is TOLD its photo was not kept, rather than left to assume it was
    expect(await res.json()).toMatchObject({ photoAccepted: false })
    expect(db.claim.create.mock.calls[0][0].data.photoUrl).toBeNull()
  })
})

// ── D′ L6 — THE DELIVERY ANCHOR, SEEN FROM THE ROUTE (spec v2 §7.1 E3/E4) ───────────
// NEGATIVE CONTROLS for the edges this lot creates, and for the fixture above: if the shipped
// `delivered` / `deliveredAt` fixture were decoration, these would not be able to fail. They live here
// because this file drives the REAL route with lib/claims real — what a customer receives is an HTTP
// status and a sentence, not a return value.
describe('D′ L6 — delivered-only, and the window is dated from deliveredAt alone', () => {
  it('an order still on its way → 409 not_delivered, nothing created (E3: nothing has arrived to be judged)', async () => {
    db.order.findUnique.mockResolvedValue({ ...ORDER, status: 'preparing', deliveredAt: null })
    const res = await post({ orderId: 'o1', reason: 'quality', scope: 'whole' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/pas encore marquée livrée/)
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('delivered but with NO anchor (deliveredAt null) → 409, nothing created: there is no honest way to date the window, and neither createdAt nor updatedAt stands in for it', async () => {
    db.order.findUnique.mockResolvedValue({ ...ORDER, status: 'delivered', deliveredAt: null, createdAt: new Date(), updatedAt: new Date() })
    const res = await post({ orderId: 'o1', reason: 'quality', scope: 'whole' })
    expect(res.status).toBe(409)
    // E4, not E3: the order IS delivered — what is missing is the instant the window is measured from.
    expect((await res.json()).error).toMatch(/délai de réclamation est dépassé/)
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('updatedAt bumped to NOW on an order delivered 3 days ago → still 409; the same order with a fresh anchor → 201 (so the refusal is the anchor’s age, nothing else)', async () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 3600 * 1000)
    db.order.findUnique.mockResolvedValue({ ...ORDER, status: 'delivered', deliveredAt: threeDaysAgo, createdAt: threeDaysAgo, updatedAt: new Date() })
    const stale = await post({ orderId: 'o1', reason: 'quality', scope: 'whole' })
    expect(stale.status).toBe(409)
    expect((await stale.json()).error).toMatch(/délai de réclamation est dépassé/)
    expect(db.claim.create).not.toHaveBeenCalled()
    // Same row, same (old) updatedAt, anchor moved inside the 48 h window → accepted.
    db.order.findUnique.mockResolvedValue({ ...ORDER, status: 'delivered', deliveredAt: new Date(Date.now() - 3600 * 1000), createdAt: threeDaysAgo, updatedAt: threeDaysAgo })
    expect((await post({ orderId: 'o1', reason: 'quality', scope: 'whole' })).status).toBe(201)
    expect(db.claim.create).toHaveBeenCalledTimes(1)
  })
})

describe('FINANCIAL AUTHORITY is server-derived at the route boundary', () => {
  // L7 (T-50): this used to assert the forged figure was IGNORED and the whole-order value derived
  // silently. A figure ignored without a word is the same defect facing the other way — the customer is
  // then shown « the amount you requested » and it is not what they sent. A scope that takes no amount
  // now REFUSES one. The invariant is unchanged and stronger: no client number reaches the row.
  it('a forged requestedAmountCents beside a whole-order scope → 400, nothing created', async () => {
    const res = await post({ orderId: 'o1', reason: 'quality', scope: 'whole', requestedAmountCents: 999999 })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('amount_not_allowed')
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('the same whole-order claim WITHOUT a figure is accepted, and the amount is the SERVER ceiling', async () => {
    const res = await post({ orderId: 'o1', reason: 'quality', scope: 'whole' })
    expect(res.status).toBe(201)
    expect(db.claim.create.mock.calls[0][0].data.requestedAmountCents).toBe(3250)
  })

  it('an amount ABOVE the ceiling in its own scope is refused, never capped in silence', async () => {
    const res = await post({ orderId: 'o1', reason: 'quality', scope: 'amount', requestedAmountCents: 999999 })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('amount_over_ceiling')
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('an amount WITHIN the ceiling is honoured exactly — the figure the customer chose, not a derived one', async () => {
    const res = await post({ orderId: 'o1', reason: 'quality', scope: 'amount', requestedAmountCents: 500 })
    expect(res.status).toBe(201)
    expect(db.claim.create.mock.calls[0][0].data.requestedAmountCents).toBe(500)
  })

  it('a line SELECTION is priced from server values, not from anything the client sent', async () => {
    const res = await post({
      orderId: 'o1', reason: 'missing_item', scope: 'items',
      items: [{ index: 0, qty: 1, price: 9999, lineCents: 9999 }],
    })
    expect(res.status).toBe(201)
    expect(db.claim.create.mock.calls[0][0].data.requestedAmountCents).toBe(1250)
  })

  it('a selection AND a figure is a contradiction → 400: two fields cannot both set the amount', async () => {
    const res = await post({
      orderId: 'o1', reason: 'missing_item', scope: 'items',
      items: [{ index: 0, qty: 1 }], requestedAmountCents: 400,
    })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('amount_not_allowed')
    expect(db.claim.create).not.toHaveBeenCalled()
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
    const res = await post({ orderId: 'o1', reason: 'quality', scope: 'whole', imageBase64: BIG_IMAGE })
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
    const res = await post({ orderId: 'o1', reason: 'not_received', scope: 'whole' })
    expect(res.status).toBe(201)
    expect(db.claim.create.mock.calls[0][0].data.requestedAmountCents).toBe(3250)
  })

  // L7 (T-50) — `restaurant_closed` is WITHDRAWN from the customer's list. It described a paid order the
  // restaurant never took, which is Grubano's own question about a cancellation, not a complaint about
  // food: the customer has nothing to describe and nothing to select, and letting them file it produced a
  // whole-order claim no one could arbitrate against evidence. It is refused at the ROUTE, not merely
  // hidden in the UI — a stale client that still offers it is told why (the UI is never the authority).
  // The question itself did not disappear: createSystemClaim still raises it, and the pin below is what
  // stops this refusal from silently deleting a real case.
  it('restaurant_closed from a CUSTOMER → 400 reason_not_selectable, nothing created', async () => {
    const res = await post({ orderId: 'o1', reason: 'restaurant_closed' })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('reason_not_selectable')
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('…and naming a scope does not buy it: the refusal is about WHO files it, not about the scope', async () => {
    for (const scope of ['items', 'amount', 'whole'] as const) {
      const res = await post({ orderId: 'o1', reason: 'restaurant_closed', scope, requestedAmountCents: scope === 'amount' ? 100 : undefined })
      expect(res.status).toBe(400)
      expect((await res.json()).reason).toBe('reason_not_selectable')
    }
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('PIN — withdrawing the reason from the CUSTOMER removes nothing from the product', async () => {
    // Two distinct things must survive this refusal, and a static read is the honest way to check them
    // here (driving createSystemClaim would need the cancellation path's whole fixture):
    //  1. the SYSTEM's own paid-cancellation question — a different reason entirely
    //     (`system_order_cancelled`), raised by Grubano and never by a form ;
    //  2. `restaurant_closed` itself, which must stay a KNOWN reason: rows already filed with it are
    //     still displayed, translated and arbitrated. Deleting it would orphan them.
    const fs = await import('node:fs')
    const claims = fs.readFileSync('lib/claims.ts', 'utf8')
    expect(claims).toContain('createSystemClaim')
    expect(claims).toContain('SYSTEM_CLAIM_REASON_ORDER_CANCELLED')
    expect(claims).toContain('system_order_cancelled')
    expect(fs.readFileSync('lib/claim-reasons.ts', 'utf8')).toContain('restaurant_closed')
  })

  it('a safety claim is accepted, stored as allergen_safety, and triggers NO refund', async () => {
    const res = await post({ orderId: 'o1', reason: 'allergen_safety', scope: 'whole', description: 'réaction allergique' })
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
// `where` could never match). `autoResolveSmallClaim` then refused safety reasons — but only
// if the reason actually REACHED it. This drives the REAL route end to end with the
// auto-resolve configuration deliberately switched ON.
// D′ L2 (spec v2 S-13): the machine path itself is now INERT BY CONSTRUCTION — the route still
// consults `autoResolveSmallClaim` after the create, but it approves nothing for ANY reason,
// reads nothing (not even the anti-abuse count) and the route sends no decision e-mail from
// it. The old « a NON-safety claim DOES take the machine path » control is therefore INVERTED;
// the liveness control is the ack e-mail, sent by the route AFTER the hook: it proves the
// route ran past the auto-resolution and that the zero-write observation is not a dead route.
describe('AUDIT FIX → D′ L2 — no claim takes the machine path through the real route, safety or not (the path is inert; the route runs past it)', () => {
  beforeEach(() => {
    process.env.CLAIM_AUTO_RESOLVE_ENABLED = 'true'
    process.env.CLAIM_AUTO_APPROVE_MAX_CENTS = '10000' // well above the order total — the OLD unlock
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

  it('an allergen claim is created but NEVER approved by the machine; the route still reaches the ack (liveness) and sends no decision e-mail', async () => {
    const res = await post({ orderId: 'o1', reason: 'allergen_safety', scope: 'whole', description: 'réaction' })
    expect(res.status).toBe(201)
    expect(db.claim.create).toHaveBeenCalled()          // the claim is filed…
    expect(db.claim.updateMany).not.toHaveBeenCalled()  // …and no approval transition happens
    expect(db.claim.count).not.toHaveBeenCalled()       // the anti-abuse orientation is never read
    expect(ackMock).toHaveBeenCalledTimes(1)            // the route ran PAST the hook
    expect(ackMock.mock.calls[0][0]).toMatchObject({ claimId: 'cl1', consumerId: 'owner', orderId: 'o1' })
    expect(decisionMock).not.toHaveBeenCalled()         // no auto_small decision e-mail exists any more
  })

  it('INVERTED — a comparable NON-safety claim does NOT take the machine path either: same 201, same zero writes, same ack, no decision e-mail (D′ L2: the path is inert by construction, not a reason filter)', async () => {
    const res = await post({ orderId: 'o1', reason: 'quality', scope: 'whole', description: 'froid' })
    expect(res.status).toBe(201)
    expect(db.claim.create).toHaveBeenCalledTimes(1)
    expect(db.claim.create.mock.calls[0][0].data).toMatchObject({ reason: 'quality', status: 'restaurant_review' })
    // L7 — the SNAPSHOT is written in the same create, so a claim can never exist without one.
    expect(db.claim.create.mock.calls[0][0].data.selection).toMatchObject({ v: 1, mode: 'whole', modeSource: 'client', lines: [], requestedCents: 3250 })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(db.claim.update).not.toHaveBeenCalled()
    expect(db.claim.count).not.toHaveBeenCalled()
    expect(ackMock).toHaveBeenCalledTimes(1)            // the route ran PAST the hook — the zero writes are not a dead route
    expect(decisionMock).not.toHaveBeenCalled()
    expect((await res.json()).claim).toMatchObject({ id: 'cl1', status: 'restaurant_review' })
  })

  it('with auto-resolve OFF neither reason is auto-approved (the config is not what carries this: ON or OFF, the same nothing)', async () => {
    delete process.env.CLAIM_AUTO_RESOLVE_ENABLED
    await post({ orderId: 'o1', reason: 'quality', scope: 'whole', description: 'froid' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(decisionMock).not.toHaveBeenCalled()
  })
})
