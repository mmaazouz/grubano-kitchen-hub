// tests/claims-t49-round13-customer.test.ts — T-49 round 13, slice W7: J-M51 (E0 customer keys, B9 (c), A-S31-1, A-S31c,
// A-S31d, A-S43, E-06, E-07, E-12, E-13, E-14, E-15).
//
// The customer status of a money state never states a money truth the code has not established: listConsumerClaims and
// getClaimEligibility over one in-memory world (the binder count is evaluated on the claims, not stubbed per call).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { matchWhere } from './support/prisma-where'

/* eslint-disable @typescript-eslint/no-explicit-any -- an in-memory double of Prisma rows */
type Row = Record<string, any>

const { db, st, stripeMock } = vi.hoisted(() => ({
  st: { claims: [] as Row[], refunds: [] as Row[], fail: {} as Record<string, boolean> },
  db: {
    claim:  { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund: { findMany: vi.fn(), findUnique: vi.fn(), aggregate: vi.fn() },
    order:  { findUnique: vi.fn() },
  },
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/refund', () => ({ executeRefund: vi.fn(), isRefundsEnabled: () => false, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn() }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))
vi.mock('@/lib/claim-emails', () => ({ sendClaimAckEmail: vi.fn(), sendClaimDecisionEmail: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => ({ sub: 'u1' })) }))

import { listConsumerClaims, getClaimEligibility } from '@/lib/claims'
import { MARKERS, CUSTOMER_STATUSES, refundedRowTruth, claimClosureKind } from '@/lib/claim-action-rules'
import { GET as CLAIMS_GET } from '@/app/api/claims/route'

const REVERTED = `${MARKERS.REVERTED_AFTER_REFUND} la réclamation a été soldée sur la ligne rf_x, mais Stripe rapporte aujourd’hui son remboursement re_x « failed » …`
/** The D11 writer's text: the DECLARED prefix, then the original reversal text (which itself carries the REVERTED marker). */
const DECLARED = `${MARKERS.DECLARED_AFTER_REVERT} déclaration admin : payé autrement après l’échec chez Stripe du remboursement lié. ${REVERTED}`
const MARKER = 'reconcile_required: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z (tentative 7d2f) — identité du remboursement pas encore liée.'

const claim = (id: string, o: Row = {}): Row => ({
  id, orderId: 'o1', consumerId: 'u1', restaurantId: 'r1', status: 'refunded', refundAttempted: true, refundId: null, refundError: null,
  arbitrationDecision: 'approved', restaurantResponse: null, restaurantResponseReason: null, arbitrationReason: null, reason: 'wrong_item',
  decidedAt: new Date(), createdAt: new Date(), activeOrderKey: null, arbitratedBy: 'op1', ...o,
})
const row = (id: string, o: Row = {}): Row => ({ id, orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: `re_${id}`, ...o })

beforeEach(() => {
  st.fail = {}
  st.claims = [
    claim('c_rev', { refundId: 'rf_rev', refundError: REVERTED }),
    claim('c_decl', { refundId: 'rf_decl', refundError: DECLARED }),
    claim('c_failed', { refundId: 'rf_f' }),
    claim('c_pending', { refundId: 'rf_p' }),
    claim('c_succ', { refundId: 'rf_s' }),
    claim('c_missing', { refundId: 'rf_gone' }),
    claim('c_two_a', { refundId: 'rf_2' }),
    claim('c_two_b', { refundId: 'rf_2', consumerId: 'u2' }),
    claim('c_v13', { status: 'approved', refundAttempted: false, refundError: `${MARKERS.PROOF_PAYABLE_V13} … payable au plus tôt le 2026-09-12T13:00:00.000Z (UTC).` }),
    claim('c_rail', { status: 'approved', refundAttempted: false, refundError: 'no_refund_proven_rail_locked: x' }),
    claim('c_hold', { status: 'approved', refundAttempted: true, refundError: `${MARKERS.SAFETY_HOLD} x` }),
    claim('c_approved', { status: 'approved', refundAttempted: false }),
    claim('c_marker', { status: 'refunding', refundError: MARKER }),
    claim('c_fv', { status: 'financial_verification', refundError: 'financial_verification:stripe_unreadable: x' }),
    claim('c_refused_decl', { status: 'refused_final', arbitrationDecision: 'approved', refundError: 'engine_failed: x' }),
  ]
  st.refunds = [
    row('rf_rev'), row('rf_decl'), row('rf_f', { status: 'failed' }), row('rf_p', { status: 'pending' }), row('rf_s'), row('rf_2'),
  ]
  const byConsumer = (where: Row) => st.claims.filter((c) => matchWhere(where ?? {}, c))
  db.claim.findMany.mockReset().mockImplementation(async ({ where }: { where: Row }) => byConsumer(where).map((c) => ({ ...c })))
  db.claim.findFirst.mockReset().mockImplementation(async ({ where }: { where: Row }) => {
    const c = st.claims.find((x) => matchWhere(where, x))
    return c ? { ...c } : null
  })
  db.claim.count.mockReset().mockImplementation(async ({ where }: { where: Row }) => st.claims.filter((c) => matchWhere(where, c)).length)
  db.claim.groupBy.mockReset().mockImplementation(async ({ where }: { where: Row }) => {
    const counts = new Map<string, number>()
    for (const c of st.claims.filter((x) => matchWhere(where, x))) counts.set(c.refundId, (counts.get(c.refundId) ?? 0) + 1)
    return Array.from(counts, ([refundId, n]) => ({ refundId, _count: { _all: n } }))
  })
  db.refund.findMany.mockReset().mockImplementation(async ({ where }: { where: Row }) => {
    if (st.fail.rows) throw new Error('db down')
    return st.refunds.filter((r) => matchWhere(where, r)).map((r) => ({ ...r }))
  })
  db.refund.findUnique.mockReset().mockImplementation(async ({ where }: { where: Row }) => {
    if (st.fail.rows) throw new Error('db down')
    const r = st.refunds.find((x) => x.id === where.id)
    return r ? { ...r } : null
  })
  db.refund.aggregate.mockReset().mockResolvedValue({ _sum: { amountCents: 0 } })
  db.order.findUnique.mockReset().mockResolvedValue({ consumerId: 'u1', paymentStatus: 'paid', total: 20, updatedAt: new Date(), items: [], stripePaymentIntentId: 'pi_1' })
  stripeMock.paymentIntents.retrieve.mockReset().mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 500 } })
  stripeMock.refunds.list.mockReset().mockResolvedValue({ data: [] })
  delete process.env.CLAIMS_ENABLED
  delete process.env.CLAIMS_WINDOW_UNTIL
})

const EXPECTED: Record<string, string> = {
  c_rev: 'financial_verification', c_decl: 'closed_by_support',
  c_failed: 'refund_unconfirmed', c_pending: 'refunded', c_succ: 'refunded', c_missing: 'refund_unconfirmed',
  c_two_a: 'financial_verification',
  c_v13: 'financial_verification', c_rail: 'financial_verification', c_hold: 'financial_verification', c_approved: 'approved',
  c_marker: 'financial_verification', c_fv: 'financial_verification', c_refused_decl: 'closed_by_support',
}

describe('J-M51 — listConsumerClaims: the customer status of every money state', () => {
  it('each fixture reads its key (REVERTED → manual review; declarations → closed_by_support; a failed or missing row → unconfirmed; pending / succeeded → refunded; two binders → manual review)', async () => {
    const out = await listConsumerClaims('u1')
    expect(Object.fromEntries(out.map((c) => [c.id, c.status]))).toEqual(EXPECTED)
    // the other binder of the ambiguous row reads the manual review too
    const other = await listConsumerClaims('u2')
    expect(other.map((c) => [c.id, c.status])).toEqual([['c_two_b', 'financial_verification']])
  })

  it('an unreadable row read → the refunded kinds read the manual review; other statuses are unchanged', async () => {
    st.fail.rows = true
    const out = Object.fromEntries((await listConsumerClaims('u1')).map((c) => [c.id, c.status]))
    for (const id of ['c_failed', 'c_pending', 'c_succ', 'c_missing', 'c_two_a']) expect(out[id], id).toBe('financial_verification')
    expect(out.c_approved).toBe('approved')
    expect(out.c_decl).toBe('closed_by_support')
  })

  it('« settled_by_support » is never returned, every status is a CUSTOMER_STATUSES key, and no internal refund field reaches the payload', async () => {
    const out = await listConsumerClaims('u1')
    for (const c of out) {
      expect(c.status).not.toBe('settled_by_support')
      expect(CUSTOMER_STATUSES as readonly string[]).toContain(c.status)
      for (const k of ['refundError', 'refundId', 'refundAttempted', 'activeOrderKey', 'arbitratedBy']) expect(Object.keys(c), `${c.id} ${k}`).not.toContain(k)
    }
  })

  it('NEGATIVE CONTROL — a single-binder refunded row reads « Remboursée »; the fixtures discriminate the two break mutants', async () => {
    const out = Object.fromEntries((await listConsumerClaims('u1')).map((c) => [c.id, c.status]))
    expect(out.c_succ).toBe('refunded')
    // (1) DECLARED startsWith → includes: the declaration text carries the REVERTED marker, so the mutant reads it as a reversal.
    expect(DECLARED.includes(MARKERS.REVERTED_AFTER_REFUND)).toBe(true)
    expect(claimClosureKind({ status: 'refunded', refundError: DECLARED })).toBe('settled_by_declaration')
    // (2) dropping the binder count: the ambiguous row alone is proven, so without the count c_two_a would read « Remboursée ».
    expect(refundedRowTruth(row('rf_2'), 1, 'o1')).toBe(true)
    expect(refundedRowTruth(row('rf_2'), 2, 'o1')).toBeNull()
  })
})

describe('J-M51 — getClaimEligibility: the same derivation on the help page payload', () => {
  const statusOf = async (id: string) => {
    const c = st.claims.find((x) => x.id === id)!
    st.claims = [c, ...st.claims.filter((x) => x.id !== id && x.refundId === c.refundId && c.refundId)]
    return (await getClaimEligibility({ consumerId: c.consumerId, orderId: 'o1' })).existingClaim?.status
  }
  for (const id of ['c_rev', 'c_decl', 'c_failed', 'c_succ', 'c_two_a', 'c_v13', 'c_approved', 'c_marker']) {
    it(`${id} → ${EXPECTED[id]}`, async () => {
      expect(await statusOf(id)).toBe(EXPECTED[id])
    })
  }
})

describe('J-M51 — CLAIMS_ENABLED off, and the copy of the two keys', () => {
  it('GET /api/claims answers { enabled: false } and no claim', async () => {
    const res = await CLAIMS_GET(new Request('https://app.grubano.com/api/claims') as never)
    expect(await res.json()).toEqual({ enabled: false })
    expect(db.claim.findMany).not.toHaveBeenCalled()
  })

  it('the fr texts of closed_by_support and refund_unconfirmed state no payment and no absence of refund; the five locales carry both keys', () => {
    const LOCALES = ['fr', 'en', 'es', 'it', 'ar']
    const m = (loc: string) => JSON.parse(readFileSync(`messages/${loc}.json`, 'utf8'))
    for (const k of ['closed_by_support', 'refund_unconfirmed']) {
      expect(String(m('fr').claims.status[k]), k).not.toMatch(/rembours[^.]*pay[ée]|aucun remboursement/i)
      for (const loc of LOCALES) expect(typeof m(loc).claims.status[k], `${loc} ${k}`).toBe('string')
    }
    // NEGATIVE CONTROL: the sentence class is caught
    expect('Aucun remboursement n’a été effectué.').toMatch(/rembours[^.]*pay[ée]|aucun remboursement/i)
  })
})
