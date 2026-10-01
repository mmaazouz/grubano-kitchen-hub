import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// D′ L9.1 — THE RESTAURANT'S POST-MONEY NOTICE, WITHOUT A CLAIM (founder arbitration, 2026-09-27).
//
// WHAT L9 GOT WRONG. Spec v2 §6.3 asked the support notify route to send the restaurant notice AND forbade
// it from importing `lib/claim-emails`, the only module that contained one — whose sender required a
// `claimId` and keyed its dedupe on `claim:<id>:resto_refunded:<re_>`. A support refund cannot form that:
// `/api/admin/refunds/run` and the abandoned-checkout path create `Refund` rows with no `Claim` behind
// them. L9 stopped and reported it. The founder's answer: the intent stands, the implementation was wrong —
// the notice must not depend on a claim, and NO SYNTHETIC CLAIM may be invented to carry an e-mail.
//
// SO THE IDENTITY OF THE NOTICE IS THE REFUND: trigger `claim_restaurant_refunded` (historical value kept,
// so L8's dispatched rows are not orphaned), dedupeKey `refund:<re_>`. The invariant these tests exist for:
// ONE real `re_` ⇒ AT MOST ONE restaurant post-money notice, whichever path discovers it.
//
// THE DISPATCH TABLE IS MODELLED, NOT STUBBED. `sendTransactional` claims its `EmailDispatch` row BEFORE
// sending, so at-most-once is a property of that claim and of nothing else. A mock that always answers
// 'sent' would make every replay test below pass for the wrong reason, so the fake below keeps a real
// (trigger, dedupeKey) set and both senders claim against it — the same uniqueness the schema enforces.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const H = vi.hoisted(() => {
  /** The `EmailDispatch` table: unique on (trigger, dedupeKey), exactly as `@@unique` declares it. */
  const dispatched: Array<{ trigger: string; dedupeKey: string }> = []
  const held = (trigger: string, dedupeKey: string) =>
    dispatched.some((d) => d.trigger === trigger && d.dedupeKey === dedupeKey)
  /** The claim-before-send: the row is taken first, and a taken row makes the send a duplicate. */
  const claim = (trigger: string, dedupeKey: string) => {
    if (held(trigger, dedupeKey)) return false
    dispatched.push({ trigger, dedupeKey })
    return true
  }
  /**
   * The `where` shapes this table is actually queried with: `{dedupeKey: {in}}`, a bare key, and the
   * `{OR: [{in}, {endsWith}]}` the claim-agnostic legacy check uses. Modelled rather than stubbed, because
   * at-most-once is a property of this matching and of nothing else.
   */
  const keyMatch = (clause: any, key: string): boolean => {
    if (!clause) return true
    if (typeof clause === 'string') return clause === key
    if (Array.isArray(clause.in)) return clause.in.includes(key)
    if (typeof clause.endsWith === 'string') return key.endsWith(clause.endsWith)
    return true
  }
  const matches = (where: any) => dispatched.filter((d) => {
    if (where?.trigger !== undefined && d.trigger !== where.trigger) return false
    if (Array.isArray(where?.OR)) return where.OR.some((o: any) => keyMatch(o?.dedupeKey, d.dedupeKey))
    return keyMatch(where?.dedupeKey, d.dedupeKey)
  })
  return {
    dispatched, held, claim,
    db: {
      refund:        { findUnique: vi.fn(), findMany: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
      claim:         { count: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), upsert: vi.fn() },
      emailDispatch: {
        count:    vi.fn(async ({ where }: any) => matches(where).length),
        findMany: vi.fn(async ({ where }: any) => matches(where).map((d) => ({ dedupeKey: d.dedupeKey }))),
      },
      order:      { findUnique: vi.fn(), findMany: vi.fn() },
      operator:   { findUnique: vi.fn() },
      restaurant: { findUnique: vi.fn() },
      ledgerEntry: { findMany: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
    },
    adminMock:  vi.fn(),
    stripeMock: { refunds: { retrieve: vi.fn(), create: vi.fn(), cancel: vi.fn() } },
    /** The CLIENT notice (the route's own sender), claiming its row like the real one. */
    sendRefund: vi.fn(async ({ dedupeKey }: any) =>
      claim('refund_confirmation', dedupeKey) ? { status: 'sent' } : { status: 'duplicate' }),
    /** The RESTAURANT notice's transport. */
    sendTx: vi.fn(async ({ trigger, dedupeKey }: any) =>
      claim(trigger, dedupeKey) ? { status: 'sent' } : { status: 'duplicate' }),
    skipLog:   vi.fn(),
    alert:     vi.fn(),
    audit:     vi.fn(),
    rateLimitMock: vi.fn(),
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: H.db }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: H.adminMock }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => H.stripeMock }))
vi.mock('@/lib/transactional-emails', () => ({
  sendRefundConfirmation: H.sendRefund,
  sendTransactional:      H.sendTx,
  logEmailSkipped:        H.skipLog,
}))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: H.alert }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: H.audit }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: H.rateLimitMock }))
// The e-mail body is not under test here; the FIGURES in it are. A key-echoing translator keeps the
// assertions about money, which is what a restaurant reads this mail for.
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))

import { POST } from '@/app/api/admin/refunds/rows/[rowId]/notify/route'
import {
  sendRefundRestaurantNotice, readRefundRestaurantEffect, restaurantNoticeAlreadySent,
  restaurantNoticeKeys, canonicalRestaurantNoticeKey, legacyRestaurantNoticeKey,
  RESTAURANT_REFUND_NOTICE_TRIGGER,
} from '@/lib/refund-restaurant-notice'

const RE   = 're_L91RESTOAAA1'
const ROW  = 'rf_l91'
const ORD  = 'o_l91'
const RST  = 'rest_1'
const CID  = 'cl_legacy_1'
const CLIENT_TRIGGER = 'refund_confirmation'

/** Mode B's own arithmetic, the figures this repository already reconciled: 500 refunded, 40 fee back, −460 net. */
const LEDGER_LINE = { grossAmount: -500, applicationFeeAmount: -40, netToRestaurant: -460 }

const row = (over: Record<string, unknown> = {}) => ({
  id: ROW, orderId: ORD, amountCents: 500, status: 'succeeded', stripeRefundId: RE,
  reason: null, idempotencyKey: 'refund:o_l91:0', settledAt: new Date('2026-09-25T10:00:00Z'),
  createdAt: new Date('2026-09-25T09:59:00Z'), ...over,
})

const world = () => {
  H.dispatched.length = 0
  for (const m of [H.db.refund.findUnique, H.db.refund.findMany, H.db.refund.aggregate, H.db.refund.groupBy, H.db.claim.count, H.db.claim.findMany,
    H.db.claim.create, H.db.claim.update, H.db.claim.upsert, H.db.emailDispatch.count,
    H.db.emailDispatch.findMany, H.db.order.findUnique, H.db.order.findMany, H.db.operator.findUnique,
    H.db.restaurant.findUnique, H.db.ledgerEntry.findMany, H.db.ledgerEntry.aggregate, H.db.ledgerEntry.create,
    H.adminMock, H.stripeMock.refunds.retrieve, H.sendRefund, H.sendTx, H.skipLog, H.alert, H.audit,
    H.rateLimitMock]) m.mockClear()
  H.rateLimitMock.mockReturnValue(null)
  H.adminMock.mockResolvedValue({ id: 'adm1', role: 'admin', name: 'A', email: 'a@g.com' })
  H.db.refund.findUnique.mockResolvedValue(row())
  H.db.refund.findMany.mockResolvedValue([row()])
  H.db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 500 } })
  H.db.refund.groupBy.mockResolvedValue([{ orderId: ORD, _sum: { amountCents: 500 } }])
  H.db.claim.count.mockResolvedValue(0)          // ← NO CLAIM. The whole point of this lot.
  H.db.claim.findMany.mockResolvedValue([])
  H.db.order.findUnique.mockResolvedValue({
    id: ORD, total: 14.1, consumerId: 'u1', restaurantId: RST,
    stripePaymentIntentId: 'pi_l91', restaurant: { name: 'Gnocchi Bar' },
  })
  H.db.order.findMany.mockResolvedValue([{ id: ORD, total: 14.1, restaurant: { name: 'Gnocchi Bar' } }])
  H.db.operator.findUnique.mockResolvedValue({ email: 'buyer@x.com', name: 'Zoé' })
  H.db.restaurant.findUnique.mockResolvedValue({ name: 'Gnocchi Bar', operator: { email: 'resto@x.com', locale: 'fr' } })
  H.db.ledgerEntry.findMany.mockResolvedValue([LEDGER_LINE])
  H.db.ledgerEntry.aggregate.mockResolvedValue({ _sum: { applicationFeeAmount: 1200 } })
  H.stripeMock.refunds.retrieve.mockResolvedValue({ id: RE, status: 'succeeded', amount: 500 })
  H.audit.mockResolvedValue(true)
  H.alert.mockResolvedValue(undefined)
  H.skipLog.mockResolvedValue(undefined)
}
beforeEach(world)

const post = () => POST(new Request('http://x/api', { method: 'POST', body: '{}' }) as never, { params: { rowId: ROW } })
const restoCalls = () => H.sendTx.mock.calls.filter((c) => c[0]?.trigger === RESTAURANT_REFUND_NOTICE_TRIGGER)
/** The sender, called exactly as the support route calls it: no claim, ledger-derived figures. */
const sendAsSupport = async (over: Record<string, unknown> = {}) => {
  const effect = await readRefundRestaurantEffect({
    stripeRefundId: RE, orderId: ORD, refundStatus: 'succeeded', rowOrderId: ORD, ...over,
  })
  return await sendRefundRestaurantNotice({
    restaurantId: RST, orderId: ORD, stripeRefundId: RE, effect,
    noticeOpen: true, traceLabel: ROW, ...over,
  })
}

// ── A ════════════════════════════════════════════════════════════════════════════════════════════════
describe('A — support refund succeeded + ledger complete ⇒ 1 client mail AND 1 restaurant mail', () => {
  it('both go out, once each, from ONE request', async () => {
    const res = await post()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.notified).toBe(true)
    expect(body.restaurantNotice).toEqual({ status: 'sent' })
    expect(H.sendRefund).toHaveBeenCalledTimes(1)
    expect(restoCalls()).toHaveLength(1)
    // …and the dispatch table holds exactly the two rows, one per trigger
    expect(H.dispatched).toEqual([
      { trigger: CLIENT_TRIGGER,                dedupeKey: `refund:${RE}` },
      { trigger: RESTAURANT_REFUND_NOTICE_TRIGGER, dedupeKey: `refund:${RE}` },
    ])
  })

  it('the restaurant mail carries the LEDGER figures — 5,00 € back, 40 c of fees, −4,60 € net', async () => {
    await post()
    const sent = restoCalls()[0][0]
    expect(sent.to).toBe('resto@x.com')
    expect(sent.dedupeKey).toBe(`refund:${RE}`)
    // The euro amounts, in the RECIPIENT's locale (a comma, never `.toFixed(2)`'s point)
    expect(sent.html).toContain('5,00')
    expect(sent.html).toContain('0,40')
    // the net is printed SIGNED so a debit cannot read as something received
    expect(sent.html).toMatch(/[-−‑]\s?4,60/)
    // NEVER the Stripe id, and never the customer's address
    expect(sent.html).not.toContain(RE)
    expect(sent.html).not.toContain('buyer@x.com')
  })

  it('the figures come from the LEDGER LINE of this re_, not from the Refund row', async () => {
    await post()
    const where = H.db.ledgerEntry.findMany.mock.calls[0][0].where
    expect(where).toEqual({ type: 'refund', sourceEventId: RE })
    // NEGATIVE CONTROL: a ledger line that disagrees with the row's amountCents is what gets printed —
    // the row's 500 is a prediction, the line is Stripe truth.
    world()
    H.db.ledgerEntry.findMany.mockResolvedValue([{ grossAmount: -410, applicationFeeAmount: -40, netToRestaurant: -370 }])
    await post()
    expect(restoCalls()[0][0].html).toContain('4,10')
    expect(restoCalls()[0][0].html).not.toContain('5,00')
  })
})

// ── B ════════════════════════════════════════════════════════════════════════════════════════════════
describe('B — a refund with NO Claim: the restaurant notice works, and no claim is invented', () => {
  it('no Claim exists, the notice is sent, and nothing wrote a Claim', async () => {
    H.db.claim.count.mockResolvedValue(0)
    H.db.claim.findMany.mockResolvedValue([])
    const body = await (await post()).json()
    expect(body.restaurantNotice).toEqual({ status: 'sent' })
    // « AUCUNE Claim inventée. AUCUNE Claim synthétique. »
    expect(H.db.claim.create).not.toHaveBeenCalled()
    expect(H.db.claim.upsert).not.toHaveBeenCalled()
    expect(H.db.claim.update).not.toHaveBeenCalled()
    // and the key names no claim
    expect(restoCalls()[0][0].dedupeKey).toBe(`refund:${RE}`)
    expect(restoCalls()[0][0].dedupeKey).not.toContain('claim:')
  })

  it('the route passes NO claimId — the sender is claim-agnostic by call, not merely by type', async () => {
    const src = readFileSync('app/api/admin/refunds/rows/[rowId]/notify/route.ts', 'utf8')
    const call = src.slice(src.indexOf('sendRefundRestaurantNotice({'))
    // the comments are stripped, because « NO claimId: … » is an explanation, not a call argument
    const args = call.slice(0, call.indexOf('})')).split(/\r?\n/)
      .filter((l) => !l.trim().startsWith('//')).join(' ')
    expect(args).not.toContain('claimId')
    expect(args).toContain('stripeRefundId:')
    // …and the route never reaches for the claim senders
    expect(src).not.toContain('@/lib/claim-emails')
  })

  it('the sender itself requires no claim: called with no claimId at all, it sends', async () => {
    expect(await sendAsSupport()).toEqual({ status: 'sent' })
    expect(restoCalls()).toHaveLength(1)
  })
})

// ── C ════════════════════════════════════════════════════════════════════════════════════════════════
describe('C — TEN replays produce AT MOST ONE mail of each kind', () => {
  it('ten POSTs on the same row: 1 client mail, 1 restaurant mail, the other nine refused', async () => {
    const statuses: number[] = []
    for (let i = 0; i < 10; i++) statuses.push((await post()).status)
    expect(statuses[0]).toBe(200)
    // the nine replays are refused BY NAME, before any sender is reached
    expect(statuses.slice(1)).toEqual(Array(9).fill(409))
    expect(H.sendRefund).toHaveBeenCalledTimes(1)
    expect(restoCalls()).toHaveLength(1)
    expect(H.dispatched).toHaveLength(2)
  })

  it('the refusal is `already_sent`, which is the CLIENT notice being recorded — so the restaurant invariant is proven separately', async () => {
    await post()
    expect((await (await post()).json()).error).toBe('already_sent')
    // TEN direct calls to the restaurant sender: one send, nine duplicates. This is the invariant that
    // matters — ONE real re_ ⇒ AT MOST ONE restaurant notice, whichever path discovers it.
    world()
    const out: string[] = []
    for (let i = 0; i < 10; i++) out.push((await sendAsSupport()).status)
    expect(out).toEqual(['sent', ...Array(9).fill('duplicate')])
    expect(restoCalls()).toHaveLength(1)
    expect(H.dispatched.filter((d) => d.trigger === RESTAURANT_REFUND_NOTICE_TRIGGER)).toHaveLength(1)
  })

  it('a replay from the CLAIM path lands on the same key and is a duplicate there too', async () => {
    expect((await sendAsSupport()).status).toBe('sent')
    // the closure path, which does carry a claim id, still keys on the refund
    const again = await sendRefundRestaurantNotice({
      restaurantId: RST, orderId: ORD, stripeRefundId: RE,
      effect: await readRefundRestaurantEffect({ stripeRefundId: RE, orderId: ORD, refundStatus: 'succeeded', rowOrderId: ORD }),
      noticeOpen: true, traceLabel: CID, claimId: CID,
    })
    expect(again).toEqual({ status: 'duplicate' })
    expect(restoCalls()).toHaveLength(1)
  })
})

// ── D ════════════════════════════════════════════════════════════════════════════════════════════════
describe('D — a claim refund already announced under the LEGACY key gets no second notice', () => {
  it('the pre-L9.1 key suppresses the send, although the canonical key is absent', async () => {
    H.dispatched.push({ trigger: RESTAURANT_REFUND_NOTICE_TRIGGER, dedupeKey: legacyRestaurantNoticeKey(CID, RE) })
    expect(H.held(RESTAURANT_REFUND_NOTICE_TRIGGER, canonicalRestaurantNoticeKey(RE))).toBe(false)
    const r = await sendRefundRestaurantNotice({
      restaurantId: RST, orderId: ORD, stripeRefundId: RE,
      effect: await readRefundRestaurantEffect({ stripeRefundId: RE, orderId: ORD, refundStatus: 'succeeded', rowOrderId: ORD }),
      noticeOpen: true, traceLabel: CID, claimId: CID,
    })
    expect(r).toEqual({ status: 'duplicate' })
    expect(restoCalls()).toHaveLength(0)
  })

  it('NEGATIVE CONTROL — keying ONLY on the canonical shape would have sent that second mail', async () => {
    H.dispatched.push({ trigger: RESTAURANT_REFUND_NOTICE_TRIGGER, dedupeKey: legacyRestaurantNoticeKey(CID, RE) })
    // the canonical key alone is free, so `sendTransactional`'s own claim would NOT have caught this
    expect(H.claim(RESTAURANT_REFUND_NOTICE_TRIGGER, canonicalRestaurantNoticeKey(RE))).toBe(true)
    // …which is exactly why the read consults BOTH shapes
    expect(restaurantNoticeKeys({ stripeRefundId: RE, claimId: CID })).toEqual([
      `refund:${RE}`, `claim:${CID}:resto_refunded:${RE}`,
    ])
  })

  it('the legacy shape is READ, never WRITTEN again', async () => {
    await sendAsSupport()
    expect(restoCalls()[0][0].dedupeKey).toBe(`refund:${RE}`)
    expect(H.dispatched.map((d) => d.dedupeKey).join('|')).not.toContain('resto_refunded')
    // and a support row, having no claim, does not even form the legacy shape
    expect(restaurantNoticeKeys({ stripeRefundId: RE })).toEqual([`refund:${RE}`])
    expect(restaurantNoticeKeys({ stripeRefundId: RE, claimId: null })).toEqual([`refund:${RE}`])
  })

  it('a legacy notice under an UNKNOWN claim id still suppresses the SUPPORT send (the suffix branch)', async () => {
    // The support path has no claim id, so `restaurantNoticeKeys` cannot build the legacy shape. If a claim
    // existed and BOTH of the route's claim guards had missed it, the one key the path cannot name is the one
    // it would duplicate. Found by this lot's own adversarial review; closed without making the sender
    // claim-aware, because a suffix under this trigger can only be that refund's own legacy notice.
    H.dispatched.push({ trigger: RESTAURANT_REFUND_NOTICE_TRIGGER, dedupeKey: legacyRestaurantNoticeKey('cl_UNKNOWN_TO_US', RE) })
    expect(await restaurantNoticeAlreadySent({ stripeRefundId: RE })).toBe(true)
    expect(await sendAsSupport()).toEqual({ status: 'duplicate' })
    expect(restoCalls()).toHaveLength(0)
    // NEGATIVE CONTROL — a legacy notice for a DIFFERENT refund suppresses nothing
    world()
    H.dispatched.push({ trigger: RESTAURANT_REFUND_NOTICE_TRIGGER, dedupeKey: legacyRestaurantNoticeKey('cl_x', 're_OTHERREFUND1') })
    expect(await restaurantNoticeAlreadySent({ stripeRefundId: RE })).toBe(false)
    expect((await sendAsSupport()).status).toBe('sent')
  })

  it('a CLAIM-BOUND row never reaches the support path at all, so the legacy key is not its only defence', async () => {
    H.db.claim.count.mockResolvedValue(1)
    const res = await post()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('claim_bound')
    expect(H.sendRefund).not.toHaveBeenCalled()
    expect(restoCalls()).toHaveLength(0)
  })
})

// ── E ════════════════════════════════════════════════════════════════════════════════════════════════
describe('E — a refund already announced under the CANONICAL key gets no second notice', () => {
  it('pre-seeded canonical key ⇒ duplicate, 0 send, from the support path', async () => {
    H.dispatched.push({ trigger: RESTAURANT_REFUND_NOTICE_TRIGGER, dedupeKey: canonicalRestaurantNoticeKey(RE) })
    expect(await restaurantNoticeAlreadySent({ stripeRefundId: RE })).toBe(true)
    expect(await sendAsSupport()).toEqual({ status: 'duplicate' })
    expect(restoCalls()).toHaveLength(0)
  })

  it('…and through the ROUTE, where the client notice is still owed and still goes', async () => {
    // Only the RESTAURANT notice was recorded. The client's is a different trigger, so the row is still
    // eligible — and the two notices are independent: one being a duplicate must not suppress the other.
    H.dispatched.push({ trigger: RESTAURANT_REFUND_NOTICE_TRIGGER, dedupeKey: canonicalRestaurantNoticeKey(RE) })
    const body = await (await post()).json()
    expect(body.notified).toBe(true)                       // the customer IS told
    expect(body.restaurantNotice).toEqual({ status: 'duplicate' })
    expect(H.sendRefund).toHaveBeenCalledTimes(1)
    expect(restoCalls()).toHaveLength(0)
  })

  it('the trigger is part of the identity: the same key under the CLIENT trigger does not suppress it', async () => {
    H.dispatched.push({ trigger: CLIENT_TRIGGER, dedupeKey: canonicalRestaurantNoticeKey(RE) })
    expect(await restaurantNoticeAlreadySent({ stripeRefundId: RE })).toBe(false)
    expect((await sendAsSupport()).status).toBe('sent')
  })
})

// ── F ════════════════════════════════════════════════════════════════════════════════════════════════
describe('F — ledger incomplete ⇒ ZERO restaurant mail, and the row says why', () => {
  it('no ledger line ⇒ skipped `ledger_incomplete`, and the CLIENT notice still goes', async () => {
    H.db.ledgerEntry.findMany.mockResolvedValue([])
    const body = await (await post()).json()
    expect(body.notified).toBe(true)                       // independence, again
    expect(body.restaurantNotice).toEqual({ status: 'skipped', why: 'ledger_incomplete' })
    expect(restoCalls()).toHaveLength(0)
    // the reason is TRACED, so an admin sees it rather than inferring it from silence
    expect(H.skipLog).toHaveBeenCalledTimes(1)
    expect(H.skipLog.mock.calls[0][3]).toBe('ledger_incomplete')
  })

  it('a financial e-mail without figures is NOT sent in a lighter form — nothing is sent', async () => {
    H.db.ledgerEntry.findMany.mockResolvedValue([])
    await post()
    expect(H.sendTx).not.toHaveBeenCalled()
    // and no dispatch row was claimed, so the notice remains OWED once the line appears
    expect(H.dispatched.filter((d) => d.trigger === RESTAURANT_REFUND_NOTICE_TRIGGER)).toHaveLength(0)
    world()
    H.db.ledgerEntry.findMany.mockResolvedValue([LEDGER_LINE])
    expect((await sendAsSupport()).status).toBe('sent')
  })

  it('an INCONSISTENT line is treated as incomplete too — no rounding, no reconstruction', async () => {
    // gross ≠ fee + net: the golden equation of a ledger line fails
    H.db.ledgerEntry.findMany.mockResolvedValue([{ grossAmount: -500, applicationFeeAmount: -40, netToRestaurant: -100 }])
    expect((await sendAsSupport()).status).toBe('skipped')
    expect(restoCalls()).toHaveLength(0)
    // two candidate lines is an ambiguous association, not an average
    world()
    H.db.ledgerEntry.findMany.mockResolvedValue([LEDGER_LINE, LEDGER_LINE])
    expect((await sendAsSupport()).status).toBe('skipped')
    expect(restoCalls()).toHaveLength(0)
  })

  it('an unreadable ledger is not an empty one — it still sends nothing', async () => {
    H.db.ledgerEntry.findMany.mockRejectedValue(new Error('table missing'))
    expect((await sendAsSupport()).status).toBe('skipped')
    expect(restoCalls()).toHaveLength(0)
  })
})

// ── G ════════════════════════════════════════════════════════════════════════════════════════════════
describe('G — Stripe says pending, failed or canceled ⇒ ZERO mail of either kind', () => {
  for (const status of ['pending', 'failed', 'canceled']) {
    it(`Stripe ${status} ⇒ 409, 0 client mail, 0 restaurant mail, 1 human alert`, async () => {
      H.stripeMock.refunds.retrieve.mockResolvedValue({ id: RE, status, amount: 500 })
      const res = await post()
      expect(res.status).toBe(409)
      expect((await res.json()).error).toBe('support_row_reverted')
      expect(H.sendRefund).not.toHaveBeenCalled()
      expect(restoCalls()).toHaveLength(0)
      expect(H.alert).toHaveBeenCalledTimes(1)
      expect(H.dispatched).toEqual([])
    })
  }

  for (const status of ['pending', 'failed', 'canceled']) {
    it(`the sender refuses a ${status} refund on its own, and does not even read the ledger for it`, async () => {
      const effect = await readRefundRestaurantEffect({ stripeRefundId: RE, orderId: ORD, refundStatus: status, rowOrderId: ORD })
      expect(effect.confirmed).toBe(false)
      expect(H.db.ledgerEntry.findMany).not.toHaveBeenCalled()
      const r = await sendRefundRestaurantNotice({
        restaurantId: RST, orderId: ORD, stripeRefundId: RE, effect, noticeOpen: true, traceLabel: ROW,
      })
      expect(r).toEqual({ status: 'skipped', why: 'ledger_incomplete' })
      expect(restoCalls()).toHaveLength(0)
    })
  }

  it('a refund on ANOTHER order is not this order\'s refund, whatever the row says', async () => {
    const effect = await readRefundRestaurantEffect({
      stripeRefundId: RE, orderId: ORD, refundStatus: 'succeeded', rowOrderId: 'o_other',
    })
    expect(effect).toEqual({ confirmed: false, reason: 'ledger_ambiguous' })
    expect((await sendRefundRestaurantNotice({
      restaurantId: RST, orderId: ORD, stripeRefundId: RE, effect, noticeOpen: true, traceLabel: ROW,
    })).status).toBe('skipped')
  })

  it('an UNREADABLE Stripe is not a reverted refund: 502, no alert, no mail, nothing written', async () => {
    H.stripeMock.refunds.retrieve.mockRejectedValue(new Error('network'))
    expect((await post()).status).toBe(502)
    expect(H.sendRefund).not.toHaveBeenCalled()
    expect(restoCalls()).toHaveLength(0)
    expect(H.alert).not.toHaveBeenCalled()
  })
})

// ── H ════════════════════════════════════════════════════════════════════════════════════════════════
describe('H — every product flag false: the notice is STILL sendable (S-25, post-money)', () => {
  const FLAGS = ['CLAIMS_ENABLED', 'CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED', 'REFUNDS_ENABLED',
    'CLAIMS_ARBITRATION_ENABLED', 'CLAIMS_PAYOUT_ENABLED']

  it('with all of them explicitly false, both mails go out', async () => {
    const saved: Record<string, string | undefined> = {}
    for (const f of FLAGS) { saved[f] = process.env[f]; process.env[f] = 'false' }
    try {
      const body = await (await post()).json()
      expect(body.notified).toBe(true)
      expect(body.restaurantNotice).toEqual({ status: 'sent' })
      expect(restoCalls()).toHaveLength(1)
    } finally {
      for (const f of FLAGS) { if (saved[f] === undefined) delete process.env[f]; else process.env[f] = saved[f]! }
    }
  })

  it('…because neither the route nor the sender reads a claims flag at all', () => {
    for (const f of ['app/api/admin/refunds/rows/[rowId]/notify/route.ts', 'lib/refund-restaurant-notice.ts']) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toContain('@/lib/claim-flags')
      expect(src, f).not.toMatch(/claimsSurfaceOpen|claimsIntakeOpen|claimsEnabled\(/)
    }
    // A kill-switch stops the product from doing NEW things; it never stops it from telling the truth
    // about money that has already left. `noticeOpen` stays a parameter so the notice-class pin keeps
    // meaning, and the ungated caller passes a literal true.
    const route = readFileSync('app/api/admin/refunds/rows/[rowId]/notify/route.ts', 'utf8')
    expect(route).toMatch(/noticeOpen:\s*true/)
  })

  it('a caller that passes noticeOpen false sends nothing — the parameter is real, not decorative', async () => {
    const r = await sendRefundRestaurantNotice({
      restaurantId: RST, orderId: ORD, stripeRefundId: RE,
      effect: { confirmed: true, customerRefundCents: 500, grubanoFeeReturnedCents: 40, restaurantNetImpactCents: -460, source: 'ledger' },
      noticeOpen: false, traceLabel: ROW,
    })
    // …and the REASON is its own, not `ledger_incomplete`. An adversarial review of this lot caught the
    // delegation reporting a closed gate as a missing ledger line: an operator would have gone looking for
    // a line that is not missing. A diagnostic vocabulary that lies about the reason is worse than none.
    expect(r).toEqual({ status: 'skipped', why: 'notice_closed' })
    expect(H.skipLog.mock.calls[0][3]).toBe('notice_closed')
    expect(restoCalls()).toHaveLength(0)
  })

  it('the claim path maps that reason to ITS own word, and maps every other value explicitly', () => {
    const src = readFileSync('lib/claim-emails.ts', 'utf8')
    const fn = src.slice(src.indexOf('export async function sendRestaurantRefundedEmail'))
    expect(fn).toContain("r.why === 'notice_closed' ? 'claims_disabled'")
    // the nine frozen toast keys (H11) are untouched: no new ClaimEmailWhy value was invented for this
    expect(src).not.toContain("| 'notice_closed'")
  })
})

// ── THE SENDER STILL TAKES ITS FIGURES AS A PARAMETER ════════════════════════════════════════════════
describe('the L8 discipline survives the move: the SENDER reads no ledger, the READER is separate', () => {
  it('sendRefundRestaurantNotice touches no ledger — the figures arrive as `effect`', () => {
    const src = readFileSync('lib/refund-restaurant-notice.ts', 'utf8')
    const body = src.slice(src.indexOf('export async function sendRefundRestaurantNotice'))
    // The module DOES read the ledger — it has to, since a support row has no claim whose effect someone
    // else computed. But the read is its own exported function, and the sender only prints what it is given:
    // a sender that could read money could invent it, which is the whole reason L8 split the two.
    expect(body).not.toContain('ledgerEntry')
    expect(body).not.toContain('deriveFinancialEffect')
    expect(body).toContain('p.effect')
    expect(body).toContain('if (!p.effect.confirmed)')
    // …and the reader is where those live
    const reader = src.slice(src.indexOf('export async function readRefundRestaurantEffect'), src.indexOf('export async function sendRefundRestaurantNotice'))
    expect(reader).toContain('ledgerEntry')
    expect(reader).toContain('deriveFinancialEffect')
  })

  it('ONE definition of the trigger and of both key shapes — the notice module re-exports, never restates', () => {
    const src = readFileSync('lib/refund-restaurant-notice.ts', 'utf8')
    // a second literal here is how a dedupe key comes to disagree with itself
    expect(src).not.toMatch(/=\s*'claim_restaurant_refunded'/)
    // No TEMPLATE forming either key shape. The header prose names the legacy shape, which is documentation;
    // what must not exist is a second construction of it.
    expect(src).not.toMatch(/`refund:\$\{/)
    expect(src).not.toMatch(/`claim:\$\{/)
    expect(src).toContain("from '@/lib/claim-action-rules'")
    // and the values still are what every already-dispatched row was written under
    expect(RESTAURANT_REFUND_NOTICE_TRIGGER).toBe('claim_restaurant_refunded')
    expect(canonicalRestaurantNoticeKey('re_x')).toBe('refund:re_x')
    expect(legacyRestaurantNoticeKey('cl1', 're_x')).toBe('claim:cl1:resto_refunded:re_x')
  })
})

// ── I ════════════════════════════════════════════════════════════════════════════════════════════════
describe('I — the webhook neither imports nor calls the sender (H15, and it is load-bearing)', () => {
  it('the Stripe webhook names neither the module nor its functions', () => {
    const src = readFileSync('app/api/webhooks/stripe/route.ts', 'utf8')
    for (const needle of ['refund-restaurant-notice', 'sendRefundRestaurantNotice', 'readRefundRestaurantEffect',
      'claim-emails', 'sendRestaurantRefundedEmail']) {
      expect(src, needle).not.toContain(needle)
    }
    // …and the webhook DOES handle refunds, so this is a real constraint on a real code path
    expect(src).toContain('charge.refunded')
  })

  it('the sender imports neither the refund engine nor any Stripe write path', () => {
    const src = readFileSync('lib/refund-restaurant-notice.ts', 'utf8')
    for (const banned of ["@/lib/refund'", "@/lib/stripe'", "@/lib/claims'"]) {
      expect(src, banned).not.toContain(banned)
    }
    expect(src).not.toMatch(/refunds\.(create|update|cancel)/)
    // it reads the LEDGER and sends; that is the whole of its power
    expect(src).toContain("@/lib/claim-financial-effect")
    expect(src).toContain("@/lib/transactional-emails")
  })

  it('the transitive proof lives in the H15 suite, and the closed callsite list is asserted there', () => {
    const h15 = readFileSync('tests/claims-closure-imports.test.ts', 'utf8')
    expect(h15).toContain('lib/refund-restaurant-notice.ts')
    expect(h15).toContain('CLOSED list of two')
    expect(h15).toContain('no webhook, reconcile-refunds or cron root reaches the restaurant notice sender')
  })
})
