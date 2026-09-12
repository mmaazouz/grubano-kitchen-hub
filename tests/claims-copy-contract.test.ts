// tests/claims-copy-contract.test.ts — T-49 round 13, customer status contract
//   J-C01 (F04, F05, F01) one fixture per F05 derivation line
//   J-C04 (F03)           refundedRowProven / refundedRowTruth and the binder-count Prisma shape
//   J-C06 (F01, F06, F07) the closed status set; deleted keys stay deleted
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync as readRaw } from 'node:fs'

const read = (p: string) => readRaw(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn() },
    order:  { findUnique: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/refund', () => ({ executeRefund: vi.fn(), isRefundsEnabled: () => false, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn() }))
const { stripeMock } = vi.hoisted(() => ({ stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn() } } }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { getClaimEligibility, listConsumerClaims, BINDER_OR } from '@/lib/claims'
import {
  customerClaimStatus, refundedRowProven, refundedRowTruth, CUSTOMER_STATUSES, MARKERS,
  type ClaimFacts, type CustomerStatus,
} from '@/lib/claim-action-rules'

const FV = 'financial_verification'
const M = 'reconcile_required: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z (tentative 7d2f) — identité du remboursement pas encore liée.'
const FR_STATUS_KEYS = Object.keys(JSON.parse(read('messages/fr.json')).claims.status)

// ══ J-C01 — one fixture per F05 line ═════════════════════════════════════════════════════════════
type Row = { line: number; name: string; c: ClaimFacts; inProgress: boolean | null; refundedRow: boolean | null; key: CustomerStatus }
const approvedWith = (refundError: string): ClaimFacts => ({ status: 'approved', refundAttempted: false, refundId: null, refundError })
const ROWS: Row[] = [
  { line: 1, name: 'financial_verification', c: { status: FV, refundError: 'financial_verification:stripe_unreadable: x' }, inProgress: null, refundedRow: null, key: FV },
  { line: 2, name: 'refunding, bound row pending with a Stripe id', c: { status: 'refunding', refundId: 'rf1', refundError: null }, inProgress: true, refundedRow: null, key: 'refunding' },
  { line: 3, name: 'refunding + marker M', c: { status: 'refunding', refundId: null, refundError: M }, inProgress: true, refundedRow: null, key: FV },
  { line: 3, name: 'refunding + resume_mismatch', c: { status: 'refunding', refundId: 'rf9', refundError: 'resume_mismatch: x' }, inProgress: true, refundedRow: null, key: FV },
  { line: 3, name: 'refunding + identity_unverified', c: { status: 'refunding', refundId: null, refundError: `${M} Moteur : le remboursement de la ligne rf1 a abouti chez Stripe ; l’identité de cette ligne n’a pas pu être relue` }, inProgress: true, refundedRow: null, key: FV },
  { line: 4, name: 'approved + v13 proof', c: approvedWith(`${MARKERS.PROOF_PAYABLE_V13} x`), inProgress: null, refundedRow: null, key: FV },
  { line: 4, name: 'approved + rail_locked', c: approvedWith('no_refund_proven_rail_locked: x'), inProgress: null, refundedRow: null, key: FV },
  { line: 4, name: 'approved + AWAITING', c: approvedWith(`${MARKERS.AWAITING_FINALIZATION} x`), inProgress: null, refundedRow: null, key: FV },
  { line: 4, name: 'approved + SAFETY_HOLD', c: { ...approvedWith(`${MARKERS.SAFETY_HOLD} x`), refundAttempted: true }, inProgress: null, refundedRow: null, key: FV },
  { line: 4, name: 'approved + stripe_failed', c: { ...approvedWith('stripe_failed: x'), refundId: 'rf1' }, inProgress: null, refundedRow: null, key: FV },
  { line: 4, name: 'approved + engine_failed', c: approvedWith('engine_failed: x'), inProgress: null, refundedRow: null, key: FV },
  { line: 4, name: 'approved + engine_row_dead', c: approvedWith('engine_row_dead: x'), inProgress: null, refundedRow: null, key: FV },
  { line: 4, name: 'approved + STRIPE_REVERTED', c: approvedWith(`${MARKERS.STRIPE_REVERTED} x`), inProgress: null, refundedRow: null, key: FV },
  { line: 4, name: 'approved + legacy proof', c: approvedWith('no_refund_proven: x'), inProgress: null, refundedRow: null, key: FV },
  { line: 5, name: 'approved + refundAttempted true, no error', c: { status: 'approved', refundAttempted: true, refundId: null, refundError: null }, inProgress: null, refundedRow: null, key: FV },
  { line: 6, name: 'approved, clean', c: { status: 'approved', refundAttempted: false, refundId: null, refundError: null }, inProgress: null, refundedRow: null, key: 'approved' },
  { line: 7, name: 'refunded + REVERTED_AFTER_REFUND', c: { status: 'refunded', refundId: 'rf1', refundError: `${MARKERS.REVERTED_AFTER_REFUND} x` }, inProgress: null, refundedRow: true, key: FV },
  { line: 8, name: 'refunded, no error, row proven', c: { status: 'refunded', refundId: 'rf1', refundError: null }, inProgress: null, refundedRow: true, key: 'refunded' },
  { line: 9, name: 'refunded, no error, row not proven', c: { status: 'refunded', refundId: 'rf1', refundError: null }, inProgress: null, refundedRow: false, key: 'refund_unconfirmed' },
  { line: 10, name: 'refunded, no error, row unknown or ambiguous', c: { status: 'refunded', refundId: 'rf1', refundError: null }, inProgress: null, refundedRow: null, key: FV },
  { line: 11, name: 'refunded + engine_failed (declaration)', c: { status: 'refunded', refundId: null, refundError: 'engine_failed: x' }, inProgress: null, refundedRow: null, key: 'closed_by_support' },
  { line: 11, name: 'refunded + DECLARED_AFTER_REVERT', c: { status: 'refunded', refundId: 'rf1', refundError: `${MARKERS.DECLARED_AFTER_REVERT} déclaration admin` }, inProgress: null, refundedRow: true, key: 'closed_by_support' },
  { line: 12, name: 'refused_final, decision null', c: { status: 'refused_final', arbitrationDecision: null }, inProgress: null, refundedRow: null, key: 'closed_by_support' },
  { line: 12, name: 'refused_final, decision approved', c: { status: 'refused_final', arbitrationDecision: 'approved' }, inProgress: null, refundedRow: null, key: 'closed_by_support' },
  { line: 13, name: 'refused_final + refused_final + restaurant refused', c: { status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'refused' }, inProgress: null, refundedRow: null, key: 'refused_final' },
  { line: 14, name: 'refused_final + refused_final + restaurant accepted', c: { status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'accepted' }, inProgress: null, refundedRow: null, key: 'refused_by_grubano' },
  { line: 14, name: 'refused_final + refused_final + silence', c: { status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: null }, inProgress: null, refundedRow: null, key: 'refused_by_grubano' },
  { line: 15, name: 'restaurant_review', c: { status: 'restaurant_review' }, inProgress: null, refundedRow: null, key: 'restaurant_review' },
  { line: 15, name: 'refused', c: { status: 'refused' }, inProgress: null, refundedRow: null, key: 'refused' },
  { line: 15, name: 'arbitration', c: { status: 'arbitration' }, inProgress: null, refundedRow: null, key: 'arbitration' },
]

describe('J-C01 — customer status derivation table (F05)', () => {
  for (const r of ROWS) {
    it(`line ${r.line}: ${r.name} → ${r.key}`, () => {
      const got = customerClaimStatus(r.c, r.inProgress, r.refundedRow)
      expect(got).toBe(r.key)
      expect(CUSTOMER_STATUSES as readonly string[]).toContain(got)
      expect(FR_STATUS_KEYS).toContain(got)
    })
  }

  it('every F05 line 1-15 has a fixture', () => {
    expect(Array.from(new Set(ROWS.map((r) => r.line))).sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
  })

  it('an unknown raw status fails closed', () => {
    expect(customerClaimStatus({ status: 'weird' }, null, null)).toBe(FV)
  })

  it('NEGATIVE CONTROL', () => {
    const unknownRow = customerClaimStatus({ status: 'refunded', refundId: 'rf1', refundError: null }, null, null)
    expect(unknownRow).not.toBe('refunded')
    expect(unknownRow).not.toBe('refund_unconfirmed')
    expect(customerClaimStatus({ status: 'weird' }, null, null)).not.toBe('weird')
    expect(customerClaimStatus({ status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'accepted' }, null, null)).not.toBe('refused_final')
    // the break mutant « refundedRow !== false ? 'refunded' » reads the unknown row as « Remboursée »
    const mutant = (refundedRow: boolean | null) => (refundedRow !== false ? 'refunded' : 'refund_unconfirmed')
    expect(mutant(null)).toBe('refunded')
  })
})

// ══ J-C04 — refundedRowProven / refundedRowTruth ═════════════════════════════════════════════════
describe('J-C04 — refundedRowProven / refundedRowTruth', () => {
  const ROWS_: Array<[string, Parameters<typeof refundedRowProven>[0]]> = [
    ['null', null],
    ['other order', { orderId: 'o2', status: 'succeeded', amountCents: 1250 }],
    ['failed with id', { orderId: 'o1', status: 'failed', amountCents: 1250 }],
    ['failed without id', { orderId: 'o1', status: 'failed', amountCents: 1250 }],
    ['pending', { orderId: 'o1', status: 'pending', amountCents: 1250 }],
    ['succeeded', { orderId: 'o1', status: 'succeeded', amountCents: 1250 }],
    ['succeeded 0', { orderId: 'o1', status: 'succeeded', amountCents: 0 }],
    ['succeeded 1.5', { orderId: 'o1', status: 'succeeded', amountCents: 1.5 }],
    ['succeeded -1', { orderId: 'o1', status: 'succeeded', amountCents: -1 }],
  ]
  const PROVEN = new Set(['pending', 'succeeded'])

  it('proven only for the same order, succeeded or pending, and an integer amount > 0', () => {
    for (const [name, row] of ROWS_) expect(refundedRowProven(row, 'o1'), name).toBe(PROVEN.has(name))
  })

  it('truth is null for binders null or ≥ 2, otherwise equals proven', () => {
    for (const [name, row] of ROWS_) {
      for (const b of [null, 0, 1, 2, 3]) {
        const want = b === null || b >= 2 ? null : PROVEN.has(name)
        expect(refundedRowTruth(row, b, 'o1'), `${name} binders=${b}`).toBe(want)
      }
    }
  })

  it('NEGATIVE CONTROL — a failed row with a Stripe id is never proven', () => {
    expect(refundedRowProven({ orderId: 'o1', status: 'failed', amountCents: 500 }, 'o1')).toBe(false)
    expect(refundedRowTruth({ orderId: 'o1', status: 'failed', amountCents: 500 }, 1, 'o1')).toBe(false)
  })
})

const BINDER_SHAPE = [{ refundError: null }, { NOT: { refundError: { startsWith: 'resume_mismatch' } } }]
/** The shape assertion: the binder where carries BOTH branches — NOT startsWith alone drops NULL rows. */
const hasBinderShape = (where: { OR?: unknown }) => JSON.stringify(where.OR) === JSON.stringify(BINDER_SHAPE)

describe('J-C04 — the binder count reads use the explicit null branch (Prisma shape)', () => {
  const ORDER = { consumerId: 'u1', paymentStatus: 'paid', total: 20, updatedAt: new Date(), items: [], stripePaymentIntentId: 'pi_1' }
  const EXISTING = { id: 'cl1', status: 'refunded', decidedAt: null, restaurantResponseReason: null, arbitrationReason: null, refundError: null, refundId: 'rf1', refundAttempted: true, arbitrationDecision: 'approved', restaurantResponse: null, reason: 'wrong_item' }

  beforeEach(() => {
    for (const m of [db.claim.findFirst, db.claim.findMany, db.claim.count, db.claim.groupBy, db.refund.findUnique, db.refund.findMany, db.refund.aggregate, db.order.findUnique, stripeMock.paymentIntents.retrieve, stripeMock.refunds.list]) m.mockReset()
    db.order.findUnique.mockResolvedValue({ ...ORDER })
    db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 500 } })
    stripeMock.refunds.list.mockResolvedValue({ data: [] })
  })

  it('BINDER_OR is the shape', () => {
    expect(hasBinderShape({ OR: BINDER_OR })).toBe(true)
  })

  it('getClaimEligibility: row read, then claim.count on { refundId, OR: [null branch, NOT startsWith] }', async () => {
    db.claim.findFirst.mockResolvedValue({ ...EXISTING })
    db.refund.findUnique.mockResolvedValue({ id: 'rf1', orderId: 'o1', status: 'succeeded', amountCents: 500 })
    db.claim.count.mockResolvedValue(1)
    expect((await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })).existingClaim?.status).toBe('refunded')
    const where = db.claim.count.mock.calls[0][0].where
    expect(where).toEqual({ refundId: 'rf1', OR: BINDER_SHAPE })
    expect(db.refund.findUnique.mock.calls[0][0].select).toEqual({ id: true, orderId: true, status: true, amountCents: true })
    // the eligibility select carries the provenance fields F02 reads
    expect(db.claim.findFirst.mock.calls[0][0].select).toMatchObject({ restaurantResponse: true, reason: true, arbitrationReason: true })
  })

  it('getClaimEligibility: two binders → manual check; a failed row → unconfirmed; a throw → manual check', async () => {
    db.claim.findFirst.mockResolvedValue({ ...EXISTING })
    db.refund.findUnique.mockResolvedValue({ id: 'rf1', orderId: 'o1', status: 'succeeded', amountCents: 500 })
    db.claim.count.mockResolvedValue(2)
    expect((await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })).existingClaim?.status).toBe(FV)
    db.claim.count.mockResolvedValue(1)
    db.refund.findUnique.mockResolvedValue({ id: 'rf1', orderId: 'o1', status: 'failed', amountCents: 500 })
    expect((await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })).existingClaim?.status).toBe('refund_unconfirmed')
    db.refund.findUnique.mockRejectedValue(new Error('db down'))
    expect((await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })).existingClaim?.status).toBe(FV)
  })

  it('listConsumerClaims: ONE row read and ONE groupBy with the same OR; ambiguous row → manual check for the claim on it', async () => {
    db.claim.findMany.mockResolvedValue([
      { id: 'a', orderId: 'o1', status: 'refunded', refundId: 'rfS', refundError: null, refundAttempted: true, arbitrationDecision: 'approved' },
      { id: 'b', orderId: 'o1', status: 'refunded', refundId: 'rfF', refundError: null, refundAttempted: true, arbitrationDecision: 'approved' },
      { id: 'c', orderId: 'o1', status: 'refunded', refundId: 'rfX', refundError: null, refundAttempted: true, arbitrationDecision: 'approved' },
      { id: 'd', orderId: 'o1', status: 'restaurant_review', refundId: null, refundError: null, refundAttempted: false, arbitrationDecision: null },
    ])
    db.refund.findMany.mockResolvedValue([
      { id: 'rfS', orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_S' },
      { id: 'rfF', orderId: 'o1', status: 'failed', amountCents: 500, stripeRefundId: 're_F' },
      { id: 'rfX', orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_X' },
    ])
    db.claim.groupBy.mockResolvedValue([
      { refundId: 'rfS', _count: { _all: 1 } }, { refundId: 'rfF', _count: { _all: 1 } }, { refundId: 'rfX', _count: { _all: 2 } },
    ])
    const out = await listConsumerClaims('u1')
    expect(out.map((c) => [c.id, c.status])).toEqual([['a', 'refunded'], ['b', 'refund_unconfirmed'], ['c', FV], ['d', 'restaurant_review']])
    expect(db.refund.findMany).toHaveBeenCalledTimes(1)
    expect(db.claim.groupBy).toHaveBeenCalledTimes(1)
    const args = db.claim.groupBy.mock.calls[0][0]
    expect(args).toMatchObject({ by: ['refundId'], _count: { _all: true } })
    expect(args.where.refundId).toEqual({ in: ['rfS', 'rfF', 'rfX'] })
    expect(hasBinderShape(args.where)).toBe(true)
  })

  it('listConsumerClaims: a groupBy throw reads the refunded kinds as a manual check, and nothing else', async () => {
    db.claim.findMany.mockResolvedValue([
      { id: 'a', orderId: 'o1', status: 'refunded', refundId: 'rfS', refundError: null, refundAttempted: true, arbitrationDecision: 'approved' },
      { id: 'd', orderId: 'o1', status: 'restaurant_review', refundId: null, refundError: null, refundAttempted: false, arbitrationDecision: null },
    ])
    db.refund.findMany.mockResolvedValue([{ id: 'rfS', orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_S' }])
    db.claim.groupBy.mockRejectedValue(new Error('db down'))
    const out = await listConsumerClaims('u1')
    expect(out.map((c) => [c.id, c.status])).toEqual([['a', FV], ['d', 'restaurant_review']])
  })

  it('NEGATIVE CONTROL — a where without the {refundError:null} branch fails the shape assertion', () => {
    expect(hasBinderShape({ OR: [{ NOT: { refundError: { startsWith: 'resume_mismatch' } } }] })).toBe(false)
    expect(hasBinderShape({ OR: undefined })).toBe(false)
  })
})

// ══ J-C06 — the closed status set ════════════════════════════════════════════════════════════════
describe('J-C06 — closed customer status set; deleted keys stay deleted', () => {
  const HEAD_FR_KEYS = ['restaurant_review', 'approved', 'refunding', 'refunded', 'refused', 'arbitration', 'refused_final', 'closed_by_support', 'refund_failed', 'refund_pending_stripe', 'financial_verification']
  const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

  it('every locale: claims.status keys === CUSTOMER_STATUSES, each non-empty', () => {
    for (const loc of LOCALES) {
      const status = JSON.parse(read(`messages/${loc}.json`)).claims.status as Record<string, string>
      expect(sameSet(Object.keys(status), CUSTOMER_STATUSES), loc).toBe(true)
      for (const s of CUSTOMER_STATUSES) expect(status[s]?.trim().length, `${loc} ${s}`).toBeGreaterThan(0)
    }
  })

  it('the removed keys do not exist', () => {
    for (const loc of LOCALES) {
      const m = JSON.parse(read(`messages/${loc}.json`))
      expect(m.claims.status.settled_by_support, loc).toBeUndefined()
      expect(m.eat.help.claimSettledBySupport, loc).toBeUndefined()
      expect(m.claimEmails?.settledBySupport, loc).toBeUndefined()
      expect(m.claimEmails?.closedBySupport?.noPayment, loc).toBeUndefined()
    }
  })

  it('no source passes a deleted status key to t(status.…) or to eligibilityLabel', () => {
    const DELETED = /(settled_by_support|refund_failed|refund_pending_stripe)/
    const files = ['components/claims/ClaimSection.tsx', 'app/[locale]/eat/order/[orderId]/help/page.tsx', 'lib/claims.ts', 'lib/claim-action-rules.ts']
    for (const f of files) {
      const src = stripComments(read(f))
      expect(src, f).not.toMatch(new RegExp(`t\\(\\s*[\`'"]status\\.${DELETED.source}`))
      expect(src, f).not.toMatch(new RegExp(`status === '${DELETED.source}'`))
    }
  })

  it('ClaimSection renders only status.${s}, with s the payload status; the help page has a branch for every status (F07)', () => {
    const cs = stripComments(read('components/claims/ClaimSection.tsx'))
    expect(cs).toContain('const s = ec.status')
    expect(cs.match(/t\(`status\./g) ?? []).toHaveLength(1)
    expect(cs).toContain('t(`status.${s}`)')
    const help = stripComments(read('app/[locale]/eat/order/[orderId]/help/page.tsx'))
    for (const s of CUSTOMER_STATUSES) expect(help, s).toContain(`ex.status === '${s}'`)
    expect(help).toContain("if (ex.status === 'refund_unconfirmed') return t('claimRefundUnconfirmed')")
  })

  it('NEGATIVE CONTROL — the HEAD status keys fail the set equality', () => {
    expect(sameSet(HEAD_FR_KEYS, CUSTOMER_STATUSES)).toBe(false)
  })
})
