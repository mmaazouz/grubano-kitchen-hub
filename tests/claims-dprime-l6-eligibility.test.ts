// tests/claims-dprime-l6-eligibility.test.ts — D′ lot L6 (spec v2 §7.1): delivered-only, and the anchor.
//
// WHAT THIS LOT CHANGED, and why each part matters:
//   E3  a claim can only be filed on a DELIVERED order. Before delivery there is nothing to judge: an order
//       on its way is a delivery problem, and a paid order the restaurant cancelled is a question Grubano
//       answers by itself — the SYSTEM claim, which bypasses this list entirely (S-17).
//   E4  the 48-hour window is anchored on `deliveredAt` and NEVER on `updatedAt`. `updatedAt` moves on every
//       later write, so a window measured from it silently re-opens days after the meal. An order carrying
//       no anchor is refused: there is no honest way to date its window, and no fallback is invented.
//   E5  a hard 30-day ceiling on the order's own age, so a clock or a bad anchor cannot open a year-old order.
//   E6  the ceiling is now a refusal in BOTH functions: the form used to say « you may claim » with 0 € left.
//   E8  the active-claim fact is the one the POST enforces — whoever holds the @unique activeOrderKey.
//
// AND THE WRITER: `deliveredAt` is stamped in the SAME write as the transition, once, never rewritten.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { NextRequest } from 'next/server'

import { claimEligibilityRefusal, CLAIM_MAX_ORDER_AGE_DAYS, CLAIM_REFUSAL_TEXT } from '@/lib/claim-eligibility'

// ══ 1. THE RULES, PURE ════════════════════════════════════════════════════════════════════════════

const T0 = Date.UTC(2026, 8, 25, 12, 0, 0)
const HOUR = 3600 * 1000
const DAY = 24 * HOUR

const facts = (over: Partial<Parameters<typeof claimEligibilityRefusal>[0]> = {}) => ({
  orderConsumerId: 'c1',
  consumerId:      'c1',
  paymentStatus:   'paid',
  status:          'delivered',
  deliveredAt:     new Date(T0 - HOUR),
  createdAt:       new Date(T0 - 2 * HOUR),
  hasActiveClaim:  false,
  nowMs:           T0,
  windowHours:     48,
  ...over,
})

describe('D′ L6 — the ONE eligibility list (spec v2 §7.1)', () => {
  it('a delivered, paid, recent order of its owner, with no active claim, is eligible', () => {
    expect(claimEligibilityRefusal(facts())).toBeNull()
  })

  it('⭐ E1 first, and it leaks nothing: a non-owner is refused before payment or delivery is even looked at', () => {
    // The order below is unpaid AND not delivered AND has an active claim. A non-owner must learn none of it.
    const r = claimEligibilityRefusal(facts({
      consumerId: 'someone_else', paymentStatus: 'unpaid', status: 'received', hasActiveClaim: true,
    }))
    expect(r).toEqual({ reason: 'not_owner', status: 403, rule: 'E1' })
    // An order with no owner at all is not « anyone's » either.
    expect(claimEligibilityRefusal(facts({ orderConsumerId: null }))?.reason).toBe('not_owner')
  })

  it('E2 — an unpaid order has nothing to give back', () => {
    expect(claimEligibilityRefusal(facts({ paymentStatus: 'unpaid' }))).toEqual({ reason: 'not_paid', status: 409, rule: 'E2' })
    expect(claimEligibilityRefusal(facts({ paymentStatus: null }))?.reason).toBe('not_paid')
  })

  it('⭐ E3 — every non-delivered status is refused with not_delivered, picked_up included', () => {
    for (const status of ['received', 'preparing', 'ready', 'picked_up', 'cancelled', 'expired', 'awaiting_payment']) {
      expect(claimEligibilityRefusal(facts({ status })), status).toEqual({ reason: 'not_delivered', status: 409, rule: 'E3' })
    }
    // NEGATIVE CONTROL — 'delivered' and only 'delivered' passes.
    expect(claimEligibilityRefusal(facts({ status: 'delivered' }))).toBeNull()
  })

  it('⭐⭐ E4 — the anchor is deliveredAt: a null anchor is REFUSED, and updatedAt is never consulted', () => {
    // A legacy delivered order carries no anchor. There is no honest way to date its window, so no
    // self-service — and, deliberately, no fallback on createdAt or on updatedAt.
    expect(claimEligibilityRefusal(facts({ deliveredAt: null }))).toEqual({ reason: 'window_expired', status: 409, rule: 'E4' })
    // An unreadable anchor is refused too rather than treated as « now ».
    expect(claimEligibilityRefusal(facts({ deliveredAt: new Date(NaN) }))?.rule).toBe('E4')
    // The boundary, both sides: exactly 48 h passes, one millisecond past it does not.
    expect(claimEligibilityRefusal(facts({ deliveredAt: new Date(T0 - 48 * HOUR) }))).toBeNull()
    expect(claimEligibilityRefusal(facts({ deliveredAt: new Date(T0 - 48 * HOUR - 1) }))?.rule).toBe('E4')
    // THE FACT THE FIELD EXISTS FOR: the rules read no `updatedAt` at all. A row touched a second ago is
    // still judged on its delivery instant — there is no key by which it could be judged otherwise.
    expect(Object.keys(facts())).not.toContain('updatedAt')
  })

  it('⭐ E5 — the 30-day ceiling holds even when the anchor says the order was delivered a minute ago', () => {
    const old = facts({ createdAt: new Date(T0 - (CLAIM_MAX_ORDER_AGE_DAYS + 1) * DAY), deliveredAt: new Date(T0 - 60_000) })
    expect(claimEligibilityRefusal(old)).toEqual({ reason: 'window_expired', status: 409, rule: 'E5' })
    expect(CLAIM_MAX_ORDER_AGE_DAYS).toBe(30)
    // NEGATIVE CONTROL — exactly 30 days old is still inside.
    expect(claimEligibilityRefusal(facts({ createdAt: new Date(T0 - 30 * DAY) }))).toBeNull()
  })

  it('⭐ E8 last — a customer who already has a claim is told THAT, not that their window closed', () => {
    expect(claimEligibilityRefusal(facts({ hasActiveClaim: true }))).toEqual({ reason: 'active_claim', status: 409, rule: 'E8' })
    // …and the order of the list means a non-delivered order with an active claim answers E3 first, which is
    // the spec's own order: the earlier rule is the more fundamental fact about the order.
    expect(claimEligibilityRefusal(facts({ status: 'ready', hasActiveClaim: true }))?.rule).toBe('E3')
  })

  it('every refusal has a sentence, and none of them promises or denies money', () => {
    for (const reason of ['not_owner', 'not_paid', 'not_delivered', 'window_expired', 'active_claim'] as const) {
      const text = CLAIM_REFUSAL_TEXT[reason]
      expect(text, reason).toBeTruthy()
      expect(text, reason).not.toMatch(/sera rembours|sera pay|déjà rembours/i)
    }
  })
})

// ══ 2. THE WRITER — the anchor is stamped in the transition's own write ════════════════════════════

const { getTokenMock, db } = vi.hoisted(() => ({
  getTokenMock: vi.fn(),
  db: {
    order:              { findUnique: vi.fn(), update: vi.fn() },
    operator:           { findUnique: vi.fn() },
    restaurant:         { findUnique: vi.fn() },
    refund:             { findMany: vi.fn(), aggregate: vi.fn() },
    ledgerEntry:        { findMany: vi.fn(), findFirst: vi.fn() },
    loyaltyCustomer:    { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    loyaltyTransaction: { findFirst: vi.fn(), create: vi.fn() },
    claim:              { findFirst: vi.fn(), create: vi.fn() },
    $transaction:       vi.fn(),
    $queryRawUnsafe:    vi.fn(),
  },
}))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/establishment-scope', () => ({
  resolveEstablishmentScope: vi.fn().mockResolvedValue({
    ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['rest1'], restaurantId: 'rest1',
  }),
}))
vi.mock('@/lib/transactional-emails', () => ({ sendOrderStatusEmail: vi.fn().mockResolvedValue({ status: 'skipped' }) }))
vi.mock('@/lib/claim-emails', () => ({
  sendOrderCancelledPaidEmail: vi.fn().mockResolvedValue({ status: 'skipped' }),
  sendOrderCancelledPaidOffEmail: vi.fn().mockResolvedValue({ status: 'skipped' }),
}))
vi.mock('@/lib/admin-alerts', () => ({
  sendAdminPaidCancellationAlert: vi.fn().mockResolvedValue({ status: 'skipped' }),
  sendAdminMoneyReviewAlert: vi.fn().mockResolvedValue({ status: 'skipped' }),
}))
// Stripe unreachable on purpose: the ceiling then falls back to the DB cap, which is all the parity test
// needs — and it proves the parity holds without a payment provider, which is when it matters most.
vi.mock('@/lib/stripe', () => ({ getStripe: () => { throw new Error('no Stripe in this test') } }))

import { PATCH as patchStatus } from '@/app/api/orders/[id]/status/route'

const patch = (status: string) => patchStatus(
  new NextRequest('https://app.grubano.com/api/orders/order1/status', {
    method: 'PATCH', body: JSON.stringify({ status }), headers: { 'content-type': 'application/json' },
  }),
  { params: { id: 'order1' } },
)
/** The `data` object of the one status write. */
const writeData = () => (db.order.update.mock.calls[0]?.[0] as { data: Record<string, unknown> } | undefined)?.data

beforeEach(() => {
  vi.clearAllMocks()
  getTokenMock.mockResolvedValue({ sub: 'op1', role: 'restaurant' })
  db.order.findUnique.mockResolvedValue({
    id: 'order1', status: 'picked_up', restaurantId: 'rest1', consumerId: 'op1',
    pointsEarned: 0, pointsRedeemed: 0, total: 14.1, paymentStatus: 'paid', deliveredAt: null,
    stripePaymentIntentId: 'pi_1',
  })
  db.order.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'order1', ...args.data, updatedAt: new Date(0) }))
  db.operator.findUnique.mockResolvedValue({ email: 'buyer@example.com', name: 'Buyer' })
  db.restaurant.findUnique.mockResolvedValue({ name: 'Chez Test' })
  db.refund.findMany.mockResolvedValue([])
  db.ledgerEntry.findMany.mockResolvedValue([])
  db.ledgerEntry.findFirst.mockResolvedValue(null)
  db.loyaltyTransaction.findFirst.mockResolvedValue(null)
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => Promise<unknown>)(db) : Promise.all(arg as Promise<unknown>[]))
  db.$queryRawUnsafe.mockResolvedValue([{ recoveryOffsetPoints: 0 }])
  db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
  db.claim.findFirst.mockResolvedValue(null)
  db.claim.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'cl_new', ...args.data }))
})

describe('D′ L6 — deliveredAt is written by the transition, once', () => {
  it('⭐ a normal transition to delivered stamps the anchor IN THE SAME WRITE as the status', async () => {
    const res = await patch('delivered')
    expect(res.status).toBe(200)
    expect(db.order.update, 'one write, never a second update').toHaveBeenCalledTimes(1)
    const data = writeData()!
    expect(Object.keys(data).sort()).toEqual(['deliveredAt', 'status'])
    expect(data.status).toBe('delivered')
    expect(data.deliveredAt).toBeInstanceOf(Date)
    expect((data.deliveredAt as Date).getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it('⭐ an order that ALREADY carries an anchor is not re-stamped', async () => {
    const earlier = new Date(Date.UTC(2026, 8, 20, 9, 0, 0))
    db.order.findUnique.mockResolvedValue({
      id: 'order1', status: 'picked_up', restaurantId: 'rest1', consumerId: 'op1',
      pointsEarned: 0, pointsRedeemed: 0, total: 14.1, paymentStatus: 'paid', deliveredAt: earlier,
      stripePaymentIntentId: 'pi_1',
    })
    await patch('delivered')
    expect(Object.keys(writeData()!)).toEqual(['status'])
  })

  it('⭐ no other transition stamps it — the anchor means « delivered », not « last touched »', async () => {
    // (`ready → picked_up` is excluded on purpose: for a click-&-collect order the route refuses it with a
    // 422 of its own — a different rule, tested elsewhere — and it would prove nothing about the anchor.)
    for (const [from, to] of [['received', 'preparing'], ['preparing', 'ready'], ['ready', 'cancelled']] as const) {
      db.order.update.mockClear()
      db.order.findUnique.mockResolvedValue({
        id: 'order1', status: from, restaurantId: 'rest1', consumerId: 'op1',
        pointsEarned: 0, pointsRedeemed: 0, total: 14.1, paymentStatus: 'pending', deliveredAt: null,
        stripePaymentIntentId: null,
      })
      const res = await patch(to)
      expect(res.status, `${from} → ${to}`).toBe(200)
      expect(Object.keys(writeData()!), `${from} → ${to}`).toEqual(['status'])
    }
  })

  it('⭐ a second PATCH to delivered is refused BEFORE any write: the anchor cannot be moved by a replay', async () => {
    db.order.findUnique.mockResolvedValue({
      id: 'order1', status: 'delivered', restaurantId: 'rest1', consumerId: 'op1',
      pointsEarned: 0, pointsRedeemed: 0, total: 14.1, paymentStatus: 'paid',
      deliveredAt: new Date(Date.UTC(2026, 8, 24, 9, 0, 0)), stripePaymentIntentId: 'pi_1',
    })
    const res = await patch('delivered')
    expect(res.status).toBe(422)
    expect(db.order.update).not.toHaveBeenCalled()
  })

  it('⭐ the delivered transition never reads Stripe — a courier tapping a button does not wait on a provider', async () => {
    db.order.findUnique.mockResolvedValue({
      id: 'order1', status: 'picked_up', restaurantId: 'rest1', consumerId: 'op1',
      pointsEarned: 14, pointsRedeemed: 0, total: 14.1, paymentStatus: 'paid', deliveredAt: null,
      stripePaymentIntentId: 'pi_1',
    })
    db.loyaltyCustomer.upsert.mockResolvedValue({ id: 'lc1' })
    db.loyaltyTransaction.create.mockResolvedValue({ id: 'tx1' })
    const res = await patch('delivered')
    expect(res.status).toBe(200)
    // The prorata replay ran, and it read only the database.
    expect(db.refund.findMany).toHaveBeenCalled()
    expect(db.ledgerEntry.findMany).toHaveBeenCalled()
    const src = readFileSync('app/api/orders/[id]/status/route.ts', 'utf8')
    expect(src).not.toMatch(/@\/lib\/stripe|getStripe/)
  })

  it('⭐ the skip marker is the LEGACY one: a keyed refund row no longer blocks the earning', async () => {
    db.order.findUnique.mockResolvedValue({
      id: 'order1', status: 'picked_up', restaurantId: 'rest1', consumerId: 'op1',
      pointsEarned: 14, pointsRedeemed: 0, total: 14.1, paymentStatus: 'paid', deliveredAt: null,
      stripePaymentIntentId: 'pi_1',
    })
    db.loyaltyCustomer.upsert.mockResolvedValue({ id: 'lc1' })
    db.loyaltyTransaction.create.mockResolvedValue({ id: 'tx1' })
    await patch('delivered')
    const probes = db.loyaltyTransaction.findFirst.mock.calls.map((c) => (c[0] as { where: Record<string, unknown> }).where)
    // The earn guard, and then the legacy marker — a `refund` row WITH a sourceEventId is not a marker.
    expect(probes).toEqual(expect.arrayContaining([
      { orderId: 'order1', type: 'earn' },
      { orderId: 'order1', type: 'refund', sourceEventId: null },
    ]))
    // NEGATIVE CONTROL — the old blanket probe over ['refund','earn_reversal'] is gone.
    for (const w of probes) expect(w.type).not.toEqual({ in: ['refund', 'earn_reversal'] })
  })
})

// ══ 3. THE SOURCE CONTRACT ════════════════════════════════════════════════════════════════════════

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

describe('D′ L6 — both functions ask the ONE list, and nothing anchors on updatedAt', () => {
  it('⭐ createClaim and getClaimEligibility both call claimEligibilityRefusal', () => {
    const src = read('lib/claims.ts')
    expect((src.match(/claimEligibilityRefusal\(/g) ?? []).length, 'once in each function').toBe(2)
    expect(src).toMatch(/from '@\/lib\/claim-eligibility'/)
  })

  it('⭐⭐ no claim rule anchors on updatedAt any more — the anchor is deliveredAt', () => {
    const code = read('lib/claims.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
    // The window used to be `Date.now() - order.updatedAt.getTime() > windowHours * 3600 * 1000`, twice.
    expect(code).not.toMatch(/updatedAt/)
    expect(read('lib/claim-eligibility.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')).not.toMatch(/updatedAt/)
  })

  it('⭐ both functions read the three fields the rules are about', () => {
    const src = read('lib/claims.ts')
    const selects = Array.from(src.matchAll(/select: \{ ([^}]*consumerId[^}]*) \}/g)).map((m) => m[1])
    const eligibilitySelects = selects.filter((s) => s.includes('paymentStatus'))
    expect(eligibilitySelects.length).toBeGreaterThanOrEqual(2)
    for (const s of eligibilitySelects) {
      expect(s, s).toMatch(/status: true/)
      expect(s, s).toMatch(/deliveredAt: true/)
      expect(s, s).toMatch(/createdAt: true/)
    }
  })

  it('⭐ the active-claim fact is the activeOrderKey — the same one the create enforces', () => {
    const src = read('lib/claims.ts')
    expect((src.match(/where:\s*\{ activeOrderKey: (order\.id|input\.orderId) \}/g) ?? []).length).toBe(2)
  })

  it('the rules module is pure: no Prisma, no env, no Stripe, no clock of its own', () => {
    const src = read('lib/claim-eligibility.ts')
    expect(src).not.toMatch(/from '@\/lib\/prisma'|process\.env|getStripe|Date\.now\(\)/)
  })

  it('⭐ the POST route forwards the refusal CODE to the client, so the page can localise it', () => {
    const route = read('app/api/claims/route.ts')
    // Without this the customer read the server's French sentence whatever their locale — the code existed
    // and was dropped at the boundary.
    expect(route).toContain('result.reason ? { error: result.error, reason: result.reason }')
    const page = read('app/[locale]/eat/order/[orderId]/help/page.tsx')
    expect(page).toMatch(/REFUSAL_LABEL\[code\]/)
    // Every code the server can send has a label on the page.
    for (const code of ['not_owner', 'not_paid', 'not_delivered', 'window_expired', 'active_claim', 'no_refundable_amount']) {
      expect(page, code).toMatch(new RegExp(`${code}:\\s*'claim`))
    }
  })

  it('⭐ the page prefers « une réclamation est en cours » when the BLOCKING claim is not the one it shows', () => {
    const page = read('app/[locale]/eat/order/[orderId]/help/page.tsx')
    // An OLDER claim can hold the key while the newest claim of the order is closed. Describing that closed
    // claim (« refusée ») beside a refusal that means « one is still open » contradicted itself.
    expect(page).toContain("eligibility.blockingClaimId !== ex?.id")
    const label = page.slice(page.indexOf('const eligibilityLabel'))
    const guard = label.indexOf('blockingClaimId')
    const exStatus = label.indexOf("ex.status === 'restaurant_review'")
    expect(guard, 'the guard is in the label function').toBeGreaterThan(-1)
    expect(guard, 'and it is asked BEFORE the existing claim is described').toBeLessThan(exStatus)
  })

  it('the SYSTEM claim still bypasses the list (S-17): a paid cancellation is never « not delivered »', () => {
    const src = read('lib/claims.ts')
    const sys = src.slice(src.indexOf('export async function createSystemClaim'))
    const body = sys.slice(0, sys.indexOf('\n}\n') + 1)
    expect(body).not.toMatch(/claimEligibilityRefusal|not_delivered/)
  })
})

// ══ 4. THE PARITY — the form and the server answer the SAME thing ═════════════════════════════════
//
// The founder's requirement for this lot: « createClaim ET getClaimEligibility doivent appliquer le même
// contrat serveur ». Until L6 each carried its own copy of the rules in a different order, so the form could
// invite a claim the POST then refused — seven divergences, measured. Both now ask the one list, and this
// block drives BOTH functions over the SAME order and asserts they agree, case by case.

describe('D′ L6 — createClaim and getClaimEligibility agree on every order', () => {
  const ORDER = 'order1'
  const CONSUMER = 'c1'

  const order = (over: Record<string, unknown> = {}) => ({
    id: ORDER, consumerId: CONSUMER, restaurantId: 'rest1', paymentStatus: 'paid',
    status: 'delivered', deliveredAt: new Date(Date.now() - HOUR), createdAt: new Date(Date.now() - 2 * HOUR),
    total: 14.1, items: [{ name: 'Plat', qty: 1, price: 14.1 }], stripePaymentIntentId: 'pi_1', ...over,
  })

  const bothFor = async (o: Record<string, unknown>, opts: { activeClaim?: boolean } = {}) => {
    db.order.findUnique.mockResolvedValue(o)
    db.claim.findFirst.mockImplementation(async (args: { where: Record<string, unknown> }) =>
      ('activeOrderKey' in args.where ? (opts.activeClaim ? { id: 'cl_old' } : null) : null))
    const claims = await import('@/lib/claims')
    // L7 (T-50): `other` is a reason where several scopes are possible, so the request must NAME one —
    // silence is refused rather than becoming « toute la commande ». This fixture asks for a precise
    // amount, which is what `requestedAmountCents: 500` always meant. The scope is stated here so that
    // what these cases measure stays the ELIGIBILITY of the order and nothing else; that the eligibility
    // codes come FIRST, before any complaint about the shape of the request, is the invariant this whole
    // describe block exists to hold (and L7's first draft broke it by resolving the scope too early).
    const post = await claims.createClaim({ consumerId: CONSUMER, orderId: ORDER, reason: 'other', scope: 'amount', requestedAmountCents: 500 })
    const get = await claims.getClaimEligibility({ consumerId: CONSUMER, orderId: ORDER })
    return { post, get }
  }

  const CASES: Array<[string, Record<string, unknown>, string]> = [
    ['not delivered',        { status: 'ready' },                                    'not_delivered'],
    ['picked up, not handed over', { status: 'picked_up' },                          'not_delivered'],
    ['cancelled',            { status: 'cancelled' },                                'not_delivered'],
    ['unpaid',               { paymentStatus: 'pending' },                           'not_paid'],
    ['no delivery anchor',   { deliveredAt: null },                                  'window_expired'],
    ['delivered 49 h ago',   { deliveredAt: new Date(Date.now() - 49 * HOUR) },       'window_expired'],
    ['order older than 30 days', { createdAt: new Date(Date.now() - 31 * DAY) },      'window_expired'],
  ]

  for (const [name, over, reason] of CASES) {
    it(`⭐ ${name} → both answer ${reason}`, async () => {
      const { post, get } = await bothFor(order(over))
      expect(post.ok, name).toBe(false)
      if (!post.ok) expect(post.reason, `POST ${name}`).toBe(reason)
      expect(get.canClaim, name).toBe(false)
      expect(get.reason, `GET ${name}`).toBe(reason)
      expect(db.claim.create, 'a refused claim is never created').not.toHaveBeenCalled()
    })
  }

  it('⭐ an active claim → both answer active_claim, on the key the create actually enforces', async () => {
    const { post, get } = await bothFor(order(), { activeClaim: true })
    expect(post.ok).toBe(false)
    if (!post.ok) expect(post.reason).toBe('active_claim')
    expect(get).toMatchObject({ canClaim: false, reason: 'active_claim' })
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('⭐ NEGATIVE CONTROL — a delivered, paid, recent order: the form says yes AND the POST creates the claim', async () => {
    const { post, get } = await bothFor(order())
    expect(get.canClaim).toBe(true)
    expect(get.reason).toBeUndefined()
    expect(post.ok, 'the POST accepts exactly what the form promised').toBe(true)
    expect(db.claim.create).toHaveBeenCalledTimes(1)
  })

  it('⭐ E6 — a fully refunded order: the form no longer invites what the POST refuses', async () => {
    // Everything already refunded ⇒ the ceiling is 0. The GET used to answer canClaim:true here and the
    // POST answered 400: a form that could not be submitted.
    db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 1410 } })
    const { post, get } = await bothFor(order())
    expect(get.maxRefundableCents).toBe(0)
    expect(get).toMatchObject({ canClaim: false, reason: 'no_refundable_amount' })
    expect(post.ok).toBe(false)
    // The SAME code on both sides, and a 409: a ceiling of zero is the state of the order, not a bad request.
    if (!post.ok) {
      expect(post.reason, 'one fact, one code, both directions').toBe('no_refundable_amount')
      expect(post.status).toBe(409)
    }
    expect(db.claim.create).not.toHaveBeenCalled()
  })

  it('⭐ EVERY refusal of the POST carries its code — nothing falls back to untranslated French prose', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ status: 'ready' }, 'not_delivered'],
      [{ paymentStatus: 'pending' }, 'not_paid'],
      [{ deliveredAt: null }, 'window_expired'],
      [{ createdAt: new Date(Date.now() - 31 * DAY) }, 'window_expired'],
      [{ consumerId: 'someone_else' }, 'not_owner'],
    ]
    for (const [over, code] of cases) {
      db.claim.create.mockClear()
      const { post } = await bothFor(order(over))
      expect(post.ok, code).toBe(false)
      if (!post.ok) {
        expect(post.reason, code).toBe(code)
        // The sentence still travels beside the code, for a client that cannot localise it.
        expect(post.error.length, code).toBeGreaterThan(0)
      }
    }
  })

  it('⭐ active_claim names the claim that actually BLOCKS — not the newest one the page shows', async () => {
    // The key holder is an OLDER claim (cl_old); the newest claim of the order is closed. Answering
    // « a claim is in progress » next to a closed claim read as a contradiction; blockingClaimId resolves it.
    const { post, get } = await bothFor(order(), { activeClaim: true })
    expect(post.ok).toBe(false)
    expect(get).toMatchObject({ canClaim: false, reason: 'active_claim', blockingClaimId: 'cl_old' })
  })

  it('a refusal that is NOT active_claim carries no blockingClaimId', async () => {
    const { get } = await bothFor(order({ status: 'ready' }))
    expect(get).toMatchObject({ reason: 'not_delivered' })
    expect(get).not.toHaveProperty('blockingClaimId')
  })

  it('⭐ the anchor, end to end: a row touched three days ago is still judged on its delivery instant', async () => {
    const { post, get } = await bothFor(order({
      deliveredAt: new Date(Date.now() - HOUR),
      // `updatedAt` is not even selected any more; a stale one on the row changes nothing.
      updatedAt:   new Date(Date.now() - 3 * DAY),
    }))
    expect(get.canClaim, 'updatedAt is not the anchor').toBe(true)
    expect(post.ok).toBe(true)
  })
})
