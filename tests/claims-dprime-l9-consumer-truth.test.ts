import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// D′ L9 — THE THREE CONTRACTS THAT ARE NOT ABOUT ARITHMETIC.
//
//  §2  `Order.paymentStatus` describes the PAYMENT and is never repurposed as a refund flag.
//  §18 a proven refund is an ORDER truth: CLAIMS_SURFACE_ENABLED=false must not erase it.
//  §27 the customer's claim history leaks nothing — and is a BUILDER, not a blocklist.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

// ── §2 — paymentStatus IMMUTABILITY ═════════════════════════════════════════════════════════════════
describe('§2 — Order.paymentStatus is not a refund read-model and gains no new writer', () => {
  const FILES = ['app', 'lib', 'components', 'scripts'].flatMap((d) => {
    const walk = (dir: string): string[] => {
      const fs = require('node:fs') as typeof import('node:fs')
      let out: string[] = []
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`
        if (e.isDirectory()) out = out.concat(walk(p))
        else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(p)
      }
      return out
    }
    try { return walk(d) } catch { return [] }
  })

  it('EXACTLY two files write Order.paymentStatus, and they are the two that always did', () => {
    // SCOPED TO THE ORDER MODEL on purpose. `paymentStatus` is a column on other models too — lib/supply-payment
    // writes a supplier payment's and two QA seed scripts write their own fixtures — so a detector that merely
    // looked for the word would fail for reasons that have nothing to do with a consumer's refund. The pin looks
    // for a write to `prisma.order.*` whose payload mentions the column, which is exactly what §2 is about. The
    // two legitimate writers are the pay route (→ 'pending') and the Stripe webhook (→ 'paid' / 'refunded' /
    // 'reconcile_manual'), and 'refunded' is written ONLY on the abandoned-checkout path.
    // NO COMMENT-STRIPPING HERE, and that is deliberate. A naive `/\*…\*/` strip is unsafe on a large file
    // that contains regex literals: the non-greedy match runs from an early `/*` to a far-away `*/` and takes
    // real code with it. MEASURED on the Stripe webhook — the strip removed all SIX of its
    // `prisma.order.update` occurrences, so a pin built on it would have reported the webhook as not writing
    // the column at all, i.e. it would have passed for the wrong reason. The payload pattern below requires a
    // VALUE after the colon, which prose cannot satisfy.
    const writesOrderPaymentStatus = (src: string): boolean => {
      const re = /prisma\.order\.(update|updateMany|upsert|create|createMany)\s*\(/g
      for (let m = re.exec(src); m; m = re.exec(src)) {
        if (/paymentStatus:\s*['\w]/.test(src.slice(m.index, m.index + 900))) return true
      }
      return false
    }
    // Scanned over the PRODUCT (app, lib, components). A QA seed under scripts/ also creates Order fixtures
    // carrying the column; that is fixture data, not the product asserting a payment state, and the second
    // assertion below is what holds it honest.
    const productWriters = FILES.filter((f) => /^(app|lib|components)\//.test(f) && writesOrderPaymentStatus(readFileSync(f, 'utf8'))).sort()
    expect(productWriters).toEqual([
      'app/api/orders/[id]/pay/route.ts',
      'app/api/webhooks/stripe/route.ts',
    ])
    // …and every OTHER writer anywhere in the tree writes only fixture values, never a refund state.
    const others = FILES.filter((f) => !/^(app|lib|components)\//.test(f) && writesOrderPaymentStatus(readFileSync(f, 'utf8')))
    for (const f of others) {
      const src = readFileSync(f, 'utf8')
      expect(src, `${f} writes a refund state`).not.toMatch(/paymentStatus:\s*'(refunded|partially_refunded|reconcile_manual)'/)
    }
  })

  it('NO new writer invents a refund state: nothing writes partially_refunded, and refunded stays webhook-only', () => {
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8')
      expect(src, `${f} invents partially_refunded`).not.toContain("'partially_refunded'")
      if (f !== 'app/api/webhooks/stripe/route.ts') {
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
        expect(code, `${f} writes paymentStatus 'refunded'`).not.toMatch(/paymentStatus:\s*'refunded'/)
      }
    }
  })

  it('the refund read-model itself never reads or writes paymentStatus', () => {
    const src = readFileSync('lib/order-refund-summary.ts', 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(code).not.toContain('paymentStatus')
  })

  it('the detail route still serves paymentStatus unchanged, BESIDE the summary — not instead of it', () => {
    // §2 is « ne crée pas un faux paymentStatus='refunded' », not « hide paymentStatus ». The field still
    // describes the payment; the refund is a separate, additive fact.
    const src = readFileSync('app/api/orders/[id]/route.ts', 'utf8')
    expect(src).toContain('paymentStatus:   order.paymentStatus,')
    expect(src).toContain('refundSummary,')
  })
})

// ── §18 — THE KILL-SWITCH MUST NOT ERASE AN ORDER TRUTH ═════════════════════════════════════════════
const { db, tokenMock } = vi.hoisted(() => ({
  db: {
    order:              { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    refund:             { findMany: vi.fn() },
    ledgerEntry:        { findMany: vi.fn() },
    loyaltyTransaction: { findMany: vi.fn() },
    promotion:          { findUnique: vi.fn() },
  },
  tokenMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: vi.fn() }))

import { GET as ORDER_GET } from '@/app/api/orders/[id]/route'

const RE = 're_L9KS0000001'
const ORDER = {
  id: 'o1', status: 'delivered', consumerId: 'u1', restaurantId: 'r1', total: 14.5, subtotal: 14.5,
  deliveryFee: 0, discount: 0, loyaltyCreditCents: 0, pointsRedeemed: 0, tipCents: 0, pointsEarned: 14,
  estimatedTime: 30, trackingUrl: null, deliveryAddress: 'x', paymentMethod: 'card', paymentStatus: 'paid',
  fulfillmentType: 'delivery', items: [], promotionId: null, createdAt: new Date(), updatedAt: new Date(),
  stripePaymentIntentId: 'pi_1', restaurant: { id: 'r1', name: 'Gnocchi Bar', logo: null, address: '', city: '', lat: 0, lng: 0, deliveryTime: 30, pickupPrepTime: 10, deliveryPrepTime: 20 },
}

describe('§18 — a proven refund is an ORDER truth, and no product flag erases it', () => {
  beforeEach(() => {
    for (const m of [db.order.findUnique, db.refund.findMany, db.ledgerEntry.findMany, db.loyaltyTransaction.findMany, db.promotion.findUnique, tokenMock]) m.mockReset()
    tokenMock.mockResolvedValue({ sub: 'u1' })
    db.order.findUnique.mockResolvedValue(ORDER)
    db.refund.findMany.mockResolvedValue([{
      status: 'succeeded', stripeRefundId: RE, amountCents: 1450, reason: null,
      idempotencyKey: 'refund:o1:0', settledAt: new Date('2026-09-20T10:00:00Z'), createdAt: new Date('2026-09-20T09:00:00Z'),
    }])
    db.ledgerEntry.findMany.mockResolvedValue([{ type: 'payment', sourceEventId: 'pi_1', grossAmount: 1450, createdAt: new Date(), stripePaymentIntentId: 'pi_1' }])
    db.loyaltyTransaction.findMany.mockResolvedValue([{ type: 'earn_reversal', points: -14, sourceEventId: 'prorata:v1:o1:1450' }])
  })

  const get = async () => (await ORDER_GET(new Request('http://x') as never, { params: { id: 'o1' } })).json()

  it('with EVERY claims and refund flag OFF, the order still states the refund and the points take-back', async () => {
    const before = { s: process.env.CLAIMS_SURFACE_ENABLED, i: process.env.CLAIMS_INTAKE_ENABLED, c: process.env.CLAIMS_ENABLED, r: process.env.REFUNDS_ENABLED }
    try {
      process.env.CLAIMS_SURFACE_ENABLED = 'false'
      process.env.CLAIMS_INTAKE_ENABLED  = 'false'
      process.env.CLAIMS_ENABLED         = 'false'
      process.env.REFUNDS_ENABLED        = 'false'
      const body = await get()
      expect(body.order.refundSummary).toMatchObject({
        refundedCents: 1450, isTotal: true, isPartial: false, pointsReversed: 14,
      })
      // …and paymentStatus is untouched: the two facts coexist (§2).
      expect(body.order.paymentStatus).toBe('paid')
    } finally {
      if (before.s === undefined) delete process.env.CLAIMS_SURFACE_ENABLED; else process.env.CLAIMS_SURFACE_ENABLED = before.s
      if (before.i === undefined) delete process.env.CLAIMS_INTAKE_ENABLED;  else process.env.CLAIMS_INTAKE_ENABLED = before.i
      if (before.c === undefined) delete process.env.CLAIMS_ENABLED;         else process.env.CLAIMS_ENABLED = before.c
      if (before.r === undefined) delete process.env.REFUNDS_ENABLED;        else process.env.REFUNDS_ENABLED = before.r
    }
  })

  it('SOURCE PIN — neither the read-model nor the order routes consult a claims flag', () => {
    // A `not.toContain` on STRIPPED code passes vacuously if the strip ate the file, and it can: a naive
    // block-comment strip on a file containing regex literals runs from an early `/*` to a far-away `*/`.
    // Measured elsewhere in this file on the Stripe webhook — six real statements disappeared. So each file
    // must first PROVE it survived the strip by still containing a landmark it certainly has.
    const LANDMARK: Record<string, string> = {
      'lib/order-refund-summary.ts':   'deriveOrderRefundSummary',
      'app/api/orders/[id]/route.ts':  'refundSummary',
      'app/api/eat/orders/route.ts':   'loadRefundSummariesForOrders',
    }
    for (const [f, landmark] of Object.entries(LANDMARK)) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(code, `${f}: the comment strip destroyed the file, so the assertions below would be vacuous`).toContain(landmark)
      for (const forbidden of ['claimsSurfaceOpen', 'claimsIntakeOpen', 'isClaimsEnabled', 'claim-flags']) {
        expect(code, `${f} → ${forbidden}`).not.toContain(forbidden)
      }
    }
  })

  it('the summary is ALWAYS present, so a client never branches on undefined (§10)', async () => {
    db.refund.findMany.mockResolvedValue([])
    db.ledgerEntry.findMany.mockResolvedValue([])
    db.loyaltyTransaction.findMany.mockResolvedValue([])
    const body = await get()
    expect(body.order.refundSummary).toMatchObject({ refundedCents: 0, pendingCents: 0, isTotal: false, isPartial: false, refunds: [] })
  })

  it('a refund read that THROWS degrades to the empty summary — the order still renders', async () => {
    db.refund.findMany.mockRejectedValue(new Error('db down'))
    const body = await get()
    expect(body.order.id).toBe('o1')
    expect(body.order.refundSummary).toMatchObject({ refundedCents: 0, isTotal: false })
  })

  it('a NON-terminal order pays nothing for the summary — the 15 s poll stays cheap (§9)', async () => {
    db.order.findUnique.mockResolvedValue({ ...ORDER, status: 'preparing' })
    const body = await get()
    expect(db.refund.findMany).not.toHaveBeenCalled()
    expect(db.ledgerEntry.findMany).not.toHaveBeenCalled()
    expect(db.loyaltyTransaction.findMany).not.toHaveBeenCalled()
    expect(body.order.refundSummary.refundedCents).toBe(0)
  })

  it('ZERO LEAK — the order payload carries no Stripe or ledger internal', async () => {
    const body = await get()
    const json = JSON.stringify(body)
    for (const secret of [RE, 'pi_1', 'sourceEventId', 'grossAmount', 'idempotencyKey', 'stripeRefundId', 'prorata:']) {
      expect(json, secret).not.toContain(secret)
    }
  })
})

// ── P0 — THE EXPIRED SCREEN MUST NOT SAY « RIEN N'A ÉTÉ DÉBITÉ » OVER A REFUND ══════════════════════
describe('P0 — the expired-order screen states the refund truth, not a paymentStatus sentinel', () => {
  const page = () => readFileSync('app/[locale]/eat/track/[orderId]/page.tsx', 'utf8')

  it('the gate asks the MONEY, so no sentinel can be forgotten again', () => {
    // FOUND BY THE ADVERSARIAL REVIEW OF THIS LOT, and it was the worst thing in it. The ghost-order
    // auto-refund writes `paymentStatus: 'refunded'` — the ONE place in the repository that writes that
    // value — and the pre-existing gate tested only 'paid' and 'reconcile_manual'. So on the single order
    // Grubano refunds by itself, the screen rendered, in the same box and in all five locales:
    //     « Le paiement n'a pas été finalisé … Rien n'a été débité. »
    //     « 14,50 € vous ont été remboursés sur cette commande. »
    // The first sentence is FALSE (1450 c was debited, then returned) and the second contradicts it two lines
    // below. Before this lot the screen was merely silent; the lot turned silence into a self-contradiction.
    const src = page()
    // The load-bearing half: a non-zero refund figure means money moved, whatever the column says.
    expect(src).toContain('const refundKnownCents = refundedCents + refundPendingCents + refundOtherCents')
    expect(src).toContain("|| order.paymentStatus === 'refunded' || refundKnownCents > 0)")
    // A third state, because once the refund has SETTLED « notre équipe vous recontacte pour le régulariser »
    // is stale rather than false — there is nothing left to regularise.
    expect(src).toContain('const expiredAndRefunded = !awaiting && refundedCents > 0')
    expect(src).toContain("expiredAndRefunded ? t('expiredRefundedDesc')")
  })

  it('the three descriptions are mutually exclusive and ordered so the truest one wins', () => {
    const src = page()
    const line = src.split(String.fromCharCode(10)).find((l) => l.includes("t('awaitingDesc')")) ?? ''
    // refunded → paid → not-paid. The « nothing was debited » sentence is the LAST resort, reachable only
    // when no refund figure and no payment sentinel says otherwise.
    const iRefunded = line.indexOf('expiredRefundedDesc')
    const iPaid     = line.indexOf('expiredPaidDesc')
    const iNothing  = line.indexOf('expiredDesc')
    expect(iRefunded).toBeGreaterThan(-1)
    expect(iPaid).toBeGreaterThan(iRefunded)
    expect(iNothing).toBeGreaterThan(iPaid)
  })

  it('the new description exists in five locales and promises no callback for a settled refund', () => {
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const m = require(`../messages/${loc}.json`)
      const s = m.eat.track.expiredRefundedDesc as string
      expect(s, loc).toBeTruthy()
      // no bank delay and no arrival date, like every other refund string in this lot
      expect(s, loc).not.toMatch(/\d+\s*(jours|days|días|giorni|ouvrés|business)/i)
    }
    // …and the stale « we will contact you to regularise » copy is NOT what a settled refund gets.
    const fr = require('../messages/fr.json')
    expect(fr.eat.track.expiredRefundedDesc).not.toContain('recontacte')
    expect(fr.eat.track.expiredPaidDesc).toContain('recontacte')
  })
})

// ── §27 — THE CLAIM HISTORY: a builder, and no leak ═════════════════════════════════════════════════
describe('§27 — listConsumerClaims is a BUILDER and leaks nothing', () => {
  it('SOURCE PIN — no spread of the claim row, the pattern D′ L8 removed from the restaurant side', () => {
    const src = readFileSync('lib/claims.ts', 'utf8')
    const fn = src.slice(src.indexOf('export async function listConsumerClaims'))
    const body = fn.slice(0, fn.indexOf('\nexport '))
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    // A blocklist ships every FUTURE column by default; a builder cannot.
    expect(code).not.toContain('{ ...c')
    expect(code).not.toContain('{...c')
    expect(code).not.toContain('CONSUMER_HIDDEN_CLAIM_FIELDS')   // nothing is deleted any more
    expect(code).toContain('const card: ConsumerClaimCard = {')
  })

  it('the declared card keys are EXACTLY the §16 contract, and every forbidden field is absent from it', () => {
    const src = readFileSync('lib/claims.ts', 'utf8')
    const iface = src.slice(src.indexOf('export interface ConsumerClaimCard'), src.indexOf('export async function listConsumerClaims'))
    const keys = Array.from(iface.matchAll(/^\s{2}([a-zA-Z]+)\??:/gm)).map((m) => m[1]).sort()
    expect(keys).toEqual([
      'approvedAmountCents', 'arbitrationReason', 'canContest', 'createdAt', 'decidedAt', 'id', 'orderId',
      'orderRef', 'reason', 'requestedAmountCents', 'restaurantName', 'restaurantResponseReason',
      'selectionSummary', 'status',
    ])
    // §27's list, verbatim, plus what the old blocklist let through.
    for (const forbidden of [
      'consumerId', 'refundId', 'refundError', 'stripeRefundId', 'arbitratedBy', 'decidedBy',
      'activeOrderKey', 'arbitrationDecision', 'restaurantId', 'restaurantResponse', 'contestReason',
      'contestedAt', 'arbitratedAt', 'responseDeadlineAt', 'photoUrl', 'description', 'selection',
      'refundAttempted',
    ]) {
      expect(keys, `leaks ${forbidden}`).not.toContain(forbidden)
    }
    // `selectionSummary` is present but `selection` is not — the précis, never the snapshot.
    expect(keys).toContain('selectionSummary')
    expect(keys).not.toContain('selection')
  })

  it('the selection précis is TWO COUNTS and nothing else, and legacy null reads as « not recorded »', async () => {
    const { consumerSelectionSummary } = await import('@/lib/claims')
    expect(consumerSelectionSummary(null)).toBe(null)
    expect(consumerSelectionSummary(undefined)).toBe(null)
    expect(consumerSelectionSummary({})).toBe(null)
    expect(consumerSelectionSummary({ lines: [] })).toBe(null)          // no mode → legacy/malformed
    const s = consumerSelectionSummary({
      v: 1, mode: 'lines', modeSource: 'customer', requestedCents: 900, ceilingVerified: true,
      lines: [{ index: 0, itemId: 'it_secret', qty: 2, unitCents: 450, name: 'Gnocchi' }],
    })
    expect(s).toEqual({ mode: 'lines', lines: 1, items: 2 })
    // NOT a way to reach the L7 internals: no itemId, no unitCents, no mode, no ceiling.
    expect(Object.keys(s!).sort()).toEqual(['items', 'lines', 'mode'])
    expect(JSON.stringify(s)).not.toContain('it_secret')
    expect(JSON.stringify(s)).not.toContain('450')
    // a malformed qty contributes nothing rather than NaN
    expect(consumerSelectionSummary({ mode: 'lines', lines: [{ qty: 'two' }, { qty: 1.5 }, { qty: -1 }, { qty: 3 }] })).toEqual({ mode: 'lines', lines: 4, items: 3 })
    // A LINE-LESS MODE IS RECORDED, NOT ABSENT — the review found the card asserting a false absence for it.
    expect(consumerSelectionSummary({ v: 1, mode: 'whole', lines: [] })).toEqual({ mode: 'whole', lines: 0, items: 0 })
    expect(consumerSelectionSummary({ v: 1, mode: 'amount', lines: [] })).toEqual({ mode: 'amount', lines: 0, items: 0 })
    // …while a snapshot with no recognisable mode stays null, so « non enregistrée » keeps its meaning.
    expect(consumerSelectionSummary({ lines: [{ qty: 2 }] })).toBe(null)
  })

  it('the approved amount appears ONLY when it differs from what was asked', () => {
    const src = readFileSync('lib/claims.ts', 'utf8')
    expect(src).toContain('c.approvedAmountCents !== c.requestedAmountCents')
  })

  it('the card states the PUBLIC order reference, not only the raw id', () => {
    const src = readFileSync('lib/claims.ts', 'utf8')
    expect(src).toContain('orderRef:                 orderRef(c.orderId)')
  })
})

// ── P1 — THE ADMIN CARD MUST BE REACHABLE IN THE STATE IT EXISTS FOR ════════════════════════════════
describe('P1 — both « avis non envoyés » sections can actually render', () => {
  it('the visibility gate counts the two notice lists, so a build whose ONLY work is an unsent notice shows it', async () => {
    const { financialVerificationCardVisible } = await import('@/lib/claim-money-line')
    const none = { claimRows: 0, unfinalizedRows: 0, closureNotices: 0, refundedUnproven: 0 }
    // Found by the adversarial review of this lot: the gate listed four inputs and neither notice list, so a
    // build whose only pending work was « somebody was refunded and never told » returned early and rendered
    // NEITHER section — the feature was invisible in exactly the state it exists for. L8's restaurant half
    // shipped with the same hole; both are closed here rather than only the one added by this lot.
    expect(financialVerificationCardVisible(none)).toBe(false)
    expect(financialVerificationCardVisible({ ...none, supportNotices: 1 })).toBe(true)
    expect(financialVerificationCardVisible({ ...none, restaurantNotices: 1 })).toBe(true)
    // the four original inputs still each open it on their own
    for (const k of ['claimRows', 'unfinalizedRows', 'closureNotices', 'refundedUnproven'] as const) {
      expect(financialVerificationCardVisible({ ...none, [k]: 1 }), k).toBe(true)
    }
    // and the component passes both lists to it
    const src = readFileSync('components/claims/AdminFinancialVerification.tsx', 'utf8')
    expect(src).toContain('restaurantNotices: sectionWeight(restoNoticesList), supportNotices: sectionWeight(supportNoticesList)')
  })

  it('the support list scans WIDER than it pages, so already-notified rows cannot hide an unsent one', async () => {
    const { SUPPORT_NOTICE_CAP, SUPPORT_NOTICE_SCAN_CAP } = await import('@/lib/support-refund-notices')
    // The first version capped the RAW candidate population and then filtered, so 200 already-notified refunds
    // would render « nothing to send » while the 201st waited. The exclusions are the expensive part to know
    // and the cheap part to apply, so the scan is wider than the page.
    expect(SUPPORT_NOTICE_SCAN_CAP).toBeGreaterThan(SUPPORT_NOTICE_CAP)
    const src = readFileSync('lib/support-refund-notices.ts', 'utf8')
    expect(src).toContain('take: SUPPORT_NOTICE_SCAN_CAP + 1')
    expect(src).toContain('const scanTruncated = candidates.length > SUPPORT_NOTICE_SCAN_CAP')
    expect(src).toContain('items: items.slice(0, SUPPORT_NOTICE_CAP)')
  })
})
