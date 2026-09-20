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

// ══ ROUND 13 (slice W7) — J-C02 (F05, F04, A-S00): every claim write in lib/claims.ts maps to an F05 line ════════════════
type Writer = { fn: string; status: string; prefix: string }
const keyOf = (w: Writer) => `${w.fn}|${w.status}|${w.prefix}`

/** The claim writes of a source: every `data` object passed to (prisma|tx|db).claim.update/updateMany/create, every T4 write and
 *  the engine_failed data object, with the enclosing function, the status literal and the refundError head. */
function scanClaimWrites(source: string): Writer[] {
  // Line comments first: a `//` comment that mentions a glob (« …/claims/* ») must not open a block comment for the stripper.
  const src = source.replace(/\r\n/g, '\n').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
  const fns = Array.from(src.matchAll(/\n(?:export )?(?:async )?function (\w+)\s*[(<]/g)).map((m) => ({ at: m.index ?? 0, name: m[1] }))
  const enclosing = (i: number) => fns.filter((f) => f.at < i).pop()?.name ?? '?'
  const balanced = (i: number) => {
    let depth = 0
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++
      else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1)
    }
    return src.slice(i)
  }
  const out: Writer[] = []
  const push = (fn: string, data: string) => {
    const status = /\bstatus:\s*'([a-z_]+)'/.exec(data)?.[1]
      ?? (/\bstatus:\s*FINANCIAL_VERIFICATION\b/.test(data) ? 'financial_verification' : /(^|[\s{,])status,/.test(data) ? '(variable)' : '-')
    const re = /\brefundError:\s*(null|`\$\{([\w.]+)\}|`([a-z_]+)|'([a-z_]+)|([A-Za-z_][\w.]*))/.exec(data)
    const prefix = !re ? '-' : re[1] === 'null' ? 'null' : (re[2] ?? re[3] ?? re[4] ?? re[5])
    if (status === '-' && prefix === '-') return
    out.push({ fn, status, prefix })
  }
  for (const m of Array.from(src.matchAll(/\b(?:prisma|tx|db)\.claim\.(?:updateMany|update|create)\(\s*\{/g))) {
    const open = (m.index ?? 0) + m[0].length - 1
    const call = balanced(open)
    const d = call.search(/\bdata:\s*\{/)
    // `data` passed as a variable (the T4 helper's own body) is read at its t4Write call sites below.
    if (d >= 0) push(enclosing(m.index ?? 0), balanced(open + call.indexOf('{', d)))
  }
  for (const m of Array.from(src.matchAll(/\bt4Write\(\s*\{|\bconst failedData = \{/g))) {
    push(enclosing(m.index ?? 0), balanced((m.index ?? 0) + m[0].length - 1))
  }
  return out
}

const M_TEXT = 'reconcile_required: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z (tentative 7d2f) — identité du remboursement pas encore liée.'
const V13_TEXT = `${MARKERS.PROOF_PAYABLE_V13} x payable au plus tôt le 2026-09-10T00:00:00.000Z (UTC).`
type Case = { c: ClaimFacts; inProgress?: boolean | null; refundedRow?: boolean | null; line: number }
const ap = (refundError: string | null, o: Partial<ClaimFacts> = {}): ClaimFacts => ({ status: 'approved', refundAttempted: false, refundId: null, refundError, ...o })
/** Hand table: each extracted writer → the F05 line(s) its synthetic claim reads. */
const WRITERS: Record<string, Case[]> = {
  'createClaim|restaurant_review|-': [{ c: { status: 'restaurant_review' }, line: 15 }],
  'createSystemClaim|arbitration|-': [{ c: { status: 'arbitration' }, line: 15 }],
  'triggerClaimRefund|refunding|M': [{ c: { status: 'refunding', refundAttempted: true, refundError: M_TEXT }, line: 3 }],
  'triggerClaimRefund|-|ownText': [{ c: { status: 'refunding', refundAttempted: true, refundError: `${M_TEXT} Moteur : « x » — la ligne rf1 existe` }, line: 3 }],
  'triggerClaimRefund|approved|before.refundError': [{ c: ap(null), line: 6 }, { c: ap(V13_TEXT), line: 4 }],
  'triggerClaimRefund|approved|text': [{ c: ap(`${MARKERS.SAFETY_HOLD} x`, { refundAttempted: true }), line: 4 }, { c: ap(V13_TEXT), line: 4 }, { c: ap('no_refund_proven_rail_locked: x'), line: 4 }],
  'triggerClaimRefund|-|resume_mismatch': [{ c: { status: 'refunding', refundAttempted: true, refundId: 'rf9', refundError: 'resume_mismatch: x' }, line: 3 }],
  'triggerClaimRefund|-|unknownOk': [{ c: { status: 'refunding', refundAttempted: true, refundError: `${M_TEXT} Moteur : a abouti` }, line: 3 }],
  'triggerClaimRefund|-|unknownPending': [{ c: { status: 'refunding', refundAttempted: true, refundError: `${M_TEXT} Moteur : en attente` }, line: 3 }],
  'triggerClaimRefund|refunded|null': [{ c: { status: 'refunded', refundId: 'rf1', refundError: null }, refundedRow: true, line: 8 }],
  'triggerClaimRefund|-|null': [{ c: { status: 'refunding', refundAttempted: true, refundId: 'rf1', refundError: null }, inProgress: true, line: 2 }],
  'triggerClaimRefund|approved|engine_failed': [{ c: ap('engine_failed: x', { refundAttempted: true }), line: 4 }],
  'approveClaim|approved|-': [{ c: ap(null), line: 6 }],
  'respondToClaim|refused|-': [{ c: { status: 'refused' }, line: 15 }],
  'respondToClaim|arbitration|-': [{ c: { status: 'arbitration' }, line: 15 }],
  'contestClaim|arbitration|-': [{ c: { status: 'arbitration' }, line: 15 }],
  'arbitrateClaim|refused_final|-': [
    { c: { status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'refused' }, line: 13 },
    { c: { status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'accepted' }, line: 14 },
  ],
  'arbitrateClaim|approved|-': [{ c: ap(null, { arbitrationDecision: 'approved' }), line: 6 }],
  'reconcileClaimForRefund|refunded|null': [{ c: { status: 'refunded', refundId: 'rf1', refundError: null }, refundedRow: true, line: 8 }],
  // MODE B commit B — ce writer écrit DEUX marqueurs selon la preuve : `stripe_failed` (Stripe a
  // vraiment échoué) ou `row_voided` (ligne LIBÉRÉE : il est prouvé que rien n'a jamais existé chez
  // Stripe). Le texte est nommé dans la source, d'où la clé par identifiant — même convention que
  // `triggerClaimRefund|-|ownText` et `applyRowTruth|approved|failedText`.
  'reconcileClaimForRefund|approved|released': [
    { c: ap('stripe_failed: x', { refundAttempted: true, refundId: 'rf1' }), line: 4 },
    { c: ap('row_voided: x', { refundAttempted: true, refundId: 'rf1' }), line: 4 },
  ],
  'resolveStuckClaim|(variable)|MARKERS.DECLARED_AFTER_REVERT': [
    { c: { status: 'refunded', refundId: 'rf1', refundError: `${MARKERS.DECLARED_AFTER_REVERT} déclaration admin` }, refundedRow: true, line: 11 },
    { c: { status: 'refunded', refundError: 'engine_failed: x' }, line: 11 },
    { c: { status: 'refused_final', arbitrationDecision: 'approved', refundError: 'engine_failed: x' }, line: 12 },
  ],
  'enterFinancialVerification|-|FINANCIAL_VERIFICATION': [{ c: { status: FV, refundError: 'financial_verification:stripe_unreadable: x' }, line: 1 }],
  'enterFinancialVerification|financial_verification|FINANCIAL_VERIFICATION': [{ c: { status: FV, refundError: 'financial_verification:stripe_unreadable: x' }, line: 1 }],
  'reconcileNoRowByDerivation|approved|text': [{ c: ap(V13_TEXT), line: 4 }, { c: ap(`${MARKERS.AWAITING_FINALIZATION} x`), line: 4 }],
  'applyRowTruth|approved|text': [{ c: ap(`${MARKERS.STRIPE_REVERTED} x`, { refundAttempted: true, refundId: 'rf1' }), line: 4 }],
  'applyRowTruth|refunding|-': [{ c: { status: 'refunding', refundAttempted: true, refundId: 'rf1', refundError: M_TEXT }, line: 3 }],
  'applyRowTruth|refunded|null': [{ c: { status: 'refunded', refundId: 'rf1', refundError: null }, refundedRow: true, line: 8 }],
  'applyRowTruth|approved|failedText': [{ c: ap('stripe_failed: x', { refundAttempted: true, refundId: 'rf1' }), line: 4 }],
  'applyRowTruth|refunding|null': [{ c: { status: 'refunding', refundAttempted: true, refundId: 'rf1', refundError: null }, inProgress: true, line: 2 }],
  'applyRowTruth|approved|deadText': [{ c: ap(`${MARKERS.ENGINE_ROW_DEAD}: x`, { refundAttempted: true, refundId: 'rf1' }), line: 4 }],
  'attributeWithEvidence|refunded|null': [{ c: { status: 'refunded', refundId: 'rf1', refundError: null }, refundedRow: true, line: 8 }],
  'markClaimsForRevertedRefundRow|-|text': [{ c: { status: 'refunded', refundId: 'rf1', refundError: `${MARKERS.REVERTED_AFTER_REFUND} x` }, refundedRow: true, line: 7 }],
  'markClaimsForRevertedRefundRow|approved|stripeRevertedText': [{ c: ap(`${MARKERS.STRIPE_REVERTED} x`, { refundId: 'rf1' }), line: 4 }],
}
const LINE_KEY: Record<number, CustomerStatus | 'same'> = {
  1: FV, 2: 'refunding', 3: FV, 4: FV, 5: FV, 6: 'approved', 7: FV, 8: 'refunded', 9: 'refund_unconfirmed', 10: FV,
  11: 'closed_by_support', 12: 'closed_by_support', 13: 'refused_final', 14: 'refused_by_grubano', 15: 'same',
}
const unmappedOrStale = (writers: Writer[], table: Record<string, Case[]>) => {
  const found = new Set(writers.map(keyOf))
  return { unmapped: Array.from(found).filter((k) => !(k in table)).sort(), stale: Object.keys(table).filter((k) => !found.has(k)).sort() }
}

describe('J-C02 — status grid over every writer of lib/claims.ts', () => {
  const writers = scanClaimWrites(read('lib/claims.ts'))

  it('the extracted writers equal the WRITERS keys: none unmapped, none stale', () => {
    expect(writers.length).toBeGreaterThan(30)
    expect(unmappedOrStale(writers, WRITERS)).toEqual({ unmapped: [], stale: [] })
  })

  it('each writer’s synthetic claim reads the key of its F05 line', () => {
    for (const [k, cases] of Object.entries(WRITERS)) {
      for (const cs of cases) {
        const want = LINE_KEY[cs.line] === 'same' ? cs.c.status : LINE_KEY[cs.line]
        expect(customerClaimStatus(cs.c, cs.inProgress ?? null, cs.refundedRow ?? null), `${k} (F05 line ${cs.line})`).toBe(want)
      }
    }
  })

  it('no writer writes the status literals settled_by_support, refund_failed or refund_pending_stripe', () => {
    expect(writers.filter((w) => ['settled_by_support', 'refund_failed', 'refund_pending_stripe'].includes(w.status))).toEqual([])
  })

  it('NEGATIVE CONTROL — a synthetic write appended to the scanned source is reported unmapped; BREAK/RESTORE: a deleted WRITERS entry is reported', () => {
    const synthetic = `${read('lib/claims.ts')}\nexport async function newWriter(id: string) {\n  await prisma.claim.updateMany({ where: { id }, data: { status: 'refunded', refundError: 'new_marker: x' } })\n}\n`
    expect(unmappedOrStale(scanClaimWrites(synthetic), WRITERS).unmapped).toEqual(['newWriter|refunded|new_marker'])
    const { ['resolveStuckClaim|(variable)|MARKERS.DECLARED_AFTER_REVERT']: _deleted, ...broken } = WRITERS
    expect(unmappedOrStale(writers, broken).unmapped).toEqual(['resolveStuckClaim|(variable)|MARKERS.DECLARED_AFTER_REVERT'])
  })
})

// ══ ROUND 13 (slice W7) — J-C03 (A-S00…A-S43, F04, E0): every Section A state yields its CUSTOMER key ═══════════════════
describe('J-C03 — Section A customer column', () => {
  const spec = read('docs/ops/CLAIMS-T49-ROUND13-SPEC-v1.md')
  const A_IDS = Array.from(spec.matchAll(/^### (A-S[\w-]+) /gm)).map((m) => m[1]).filter((id) => id !== 'A-S00')
  const refundedWith = (refundedRow: boolean | null, refundError: string | null = null): Omit<Case, 'line'> => ({ c: { status: 'refunded', refundId: 'rf1', refundError }, refundedRow })
  const fvStatus: Omit<Case, 'line'> = { c: { status: FV, refundError: 'financial_verification:refund_moved_unattributed: x' } }
  const approvedLock: Omit<Case, 'line'> = { c: ap('no_refund_proven_rail_locked: x') }
  const v13: Omit<Case, 'line'> = { c: ap(V13_TEXT) }
  const refundingMarker: Omit<Case, 'line'> = { c: { status: 'refunding', refundAttempted: true, refundError: M_TEXT } }
  const refundingMismatch: Omit<Case, 'line'> = { c: { status: 'refunding', refundAttempted: true, refundId: 'rf9', refundError: 'resume_mismatch: x' } }
  const approvedNull: Omit<Case, 'line'> = { c: ap(null) }
  const reverted = refundedWith(true, `${MARKERS.REVERTED_AFTER_REFUND} x`)
  const declared = refundedWith(true, `${MARKERS.DECLARED_AFTER_REVERT} x`)
  type Variant = Omit<Case, 'line'> & { key: CustomerStatus }
  const v = (base: Omit<Case, 'line'>, key: CustomerStatus): Variant => ({ ...base, key })
  const group = (ids: string[], variants: Variant[]) => Object.fromEntries(ids.map((id) => [id, variants]))
  const ASTATES: Record<string, Variant[]> = {
    ...group(['A-S01', 'A-S02', 'A-S08b'], [v(v13, FV)]),
    ...group(['A-S01b', 'A-S03', 'A-S04', 'A-S05a-1', 'A-S05a-2', 'A-S06a', 'A-S07', 'A-S08a', 'A-S10b', 'A-S10c', 'A-S11', 'A-S14b', 'A-S26', 'A-S30', 'A-S30c-1', 'A-S30c-2', 'A-S30e-1', 'A-S30e-2', 'A-S30g', 'A-S32-1', 'A-S32-2', 'A-S39'], [v(approvedLock, FV)]),
    ...group(['A-S06b'], [v({ c: ap('stripe_failed: x', { refundId: 'rf1' }) }, FV)]),
    ...group(['A-S24-1', 'A-S24-2'], [v({ c: ap(`${MARKERS.STRIPE_REVERTED} x`, { refundId: 'rf1' }) }, FV)]),
    ...group(['A-S25'], [v({ c: ap('engine_failed: x', { refundAttempted: true }) }, FV)]),
    ...group(['A-S15a', 'A-S15b', 'A-S36-1', 'A-S36-2', 'A-S36b'], [v(refundingMismatch, FV)]),
    ...group(['A-S16a', 'A-S16b', 'A-S30d', 'A-S33-1', 'A-S33-2', 'A-S35'], [v(refundingMarker, FV)]),
    ...group(['A-S10', 'A-S21', 'A-S23a-1', 'A-S23a-2'], [v(refundedWith(true), 'refunded')]),
    ...group(['A-S19'], [v(fvStatus, FV), v(refundedWith(true), 'refunded')]),
    ...group(['A-S42'], [v(refundedWith(true), 'refunded'), v(fvStatus, FV)]),
    ...group(['A-S12', 'A-S12b'], [v(refundingMarker, FV), v(approvedNull, 'approved')]),
    ...group(['A-S30b-1'], [v(approvedNull, 'approved'), v(v13, FV)]),
    ...group(['A-S30b-2a', 'A-S30b-2b', 'A-S30e-3'], [v(approvedNull, 'approved')]),
    ...group(['A-S31-1', 'A-S31-2', 'A-S31b'], [v(reverted, FV), v(declared, 'closed_by_support'), v({ c: { status: 'refused_final', arbitrationDecision: 'approved', refundError: `${MARKERS.REVERTED_AFTER_REFUND} x` } }, 'closed_by_support')]),
    ...group(['A-S31c', 'A-S31f-1'], [v(refundedWith(false), 'refund_unconfirmed')]),
    ...group(['A-S31d'], [v(refundedWith(true), 'refunded'), v(reverted, FV)]),
    ...group(['A-S31e-1', 'A-S31e-2', 'A-S31f-2', 'A-S31f-3'], [v(refundedWith(true), 'refunded')]),
    ...group(['A-S43'], [v(refundedWith(refundedRowTruth({ orderId: 'o1', status: 'succeeded', amountCents: 500 }, 2, 'o1')), FV)]),
    ...group(['A-S05b-1', 'A-S05b-2', 'A-S05c-1', 'A-S05c-2a', 'A-S05c-2b', 'A-S09a', 'A-S09b', 'A-S13a', 'A-S13b', 'A-S14a-1', 'A-S14a-2a', 'A-S14a-2b', 'A-S17', 'A-S18', 'A-S20', 'A-S22', 'A-S22b', 'A-S23b-1', 'A-S23b-2', 'A-S27-1a', 'A-S27-1b', 'A-S27-2', 'A-S29-1', 'A-S29-2', 'A-S29-3', 'A-S30e-4', 'A-S34', 'A-S37', 'A-S38-1', 'A-S38-2', 'A-S40', 'A-S41'], [v(fvStatus, FV)]),
  }
  const TOKEN: Record<string, CustomerStatus> = { FVc: FV, RFc: 'refunded', APc: 'approved', CBS: 'closed_by_support', RUc: 'refund_unconfirmed' }

  it('ASTATES contains every Section A id (parsed from the frozen specification)', () => {
    expect(A_IDS.length).toBeGreaterThan(90)
    expect(A_IDS.filter((id) => !(id in ASTATES))).toEqual([])
    expect(Object.keys(ASTATES).filter((id) => !A_IDS.includes(id))).toEqual([])
  })

  it('customerClaimStatus(...) === the expected key for every variant, and the first variant is the first key the rule’s CUSTOMER field names', () => {
    const lines = spec.split(/\r?\n/)
    for (const id of A_IDS) {
      for (const x of ASTATES[id]) expect(customerClaimStatus(x.c, x.inProgress ?? null, x.refundedRow ?? null), `${id} → ${x.key}`).toBe(x.key)
      const at = lines.findIndex((l) => l.startsWith(`### ${id} `))
      const field = /CUSTOMER: ([^|]*)\|/.exec(lines.slice(at + 1, at + 6).join(' '))?.[1] ?? ''
      const first = /\b(FVc|RFc|APc|CBS|RUc)\b/.exec(field)?.[1]
      if (first) expect(ASTATES[id][0].key, `${id} CUSTOMER « ${field.trim().slice(0, 60)} »`).toBe(TOKEN[first])
    }
  })

  it('NEGATIVE CONTROL — A-S43 with one binder reads « Remboursée » (the binder count flips it); A-S31c with refundedRow true reads « Remboursée », not RUc', () => {
    const one = refundedRowTruth({ orderId: 'o1', status: 'succeeded', amountCents: 500 }, 1, 'o1')
    expect(customerClaimStatus({ status: 'refunded', refundId: 'rf1', refundError: null }, null, one)).toBe('refunded')
    expect(customerClaimStatus({ status: 'refunded', refundId: 'rf1', refundError: null }, null, true)).not.toBe('refund_unconfirmed')
  })
})

// ══ ROUND 13 (slice W7) — J-C11 (F06, F09, F17, R-D9) and J-C16 (F13): exact copy values, 5 locales ═════════════════════
describe('J-C11 — F06 new keys, F09 rewordings and F17 labels, verbatim from the frozen specification', () => {
  const M = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}.json`))]))
  const EXPECTED = { ...specCopyTable('F06', 'claims.status.'), ...specCopyTable('F09', 'claims.client.'), ...specCopyTable('F17', 'claims.admin.') }

  it('the tables are complete and every value equals the specification', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([
      'claims.admin.decisionReasonLabel', 'claims.admin.refuseFinal', 'claims.admin.refusedFinalDone',
      'claims.client.arbitrationInfo', 'claims.client.description', 'claims.client.refusalReasonShown', 'claims.client.statusTitle', 'claims.client.success',
      'claims.status.refund_unconfirmed', 'claims.status.refused_by_grubano', 'eat.help.claimFiledSub',
    ])
    for (const loc of LOCALES) for (const [path, vals] of Object.entries(EXPECTED)) expect(messageAt(M[loc], path), `${loc} ${path}`).toBe(vals[loc as 'fr'])
  })

  it('the unchanged F06 values stay as the specification lists them (fr)', () => {
    const unchanged = Object.fromEntries(specSection('F06').map((l) => /^- (?!(?:fr|en|es|it|ar) )(\w+) « (.*) »$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => [m[1], m[2]]))
    expect(Object.keys(unchanged).sort()).toEqual(['approved', 'arbitration', 'closed_by_support', 'financial_verification', 'refunded', 'refunding', 'refused', 'refused_final', 'restaurant_review'])
    for (const [k, fr] of Object.entries(unchanged)) expect(M.fr.claims.status[k], k).toBe(fr)
  })

  // W7 fixer (J-C11): the nine unchanged values byte-identical to HEAD in the other four locales — the table was read with
  // `git show ad26dac:messages/<loc>.json` when this test was written (fr is pinned against the spec list above).
  const HEAD_UNCHANGED: Record<'en' | 'es' | 'it' | 'ar', Record<string, string>> = {
    en: {
      restaurant_review: 'Awaiting restaurant response', refused: 'Refused', arbitration: 'Under Grubano arbitration',
      approved: 'Approved — refund awaiting processing', refunding: 'Refund in progress', refunded: 'Refunded', refused_final: 'Refusal confirmed',
      closed_by_support: 'Case closed by our team — contact support with any questions.', financial_verification: 'Your request requires a manual check by our team.',
    },
    es: {
      restaurant_review: 'Esperando respuesta del restaurante', refused: 'Rechazada', arbitration: 'En arbitraje de Grubano',
      approved: 'Aprobada — reembolso pendiente de tramitación', refunding: 'Reembolso en curso', refunded: 'Reembolsada', refused_final: 'Rechazo confirmado',
      closed_by_support: 'Expediente cerrado por nuestro equipo — contacte con el soporte para cualquier pregunta.', financial_verification: 'Su solicitud requiere una verificación manual por parte de nuestro equipo.',
    },
    it: {
      restaurant_review: 'In attesa di risposta del ristorante', refused: 'Rifiutata', arbitration: 'In arbitrato Grubano',
      approved: 'Approvata — rimborso in attesa di elaborazione', refunding: 'Rimborso in corso', refunded: 'Rimborsata', refused_final: 'Rifiuto confermato',
      closed_by_support: 'Pratica chiusa dal nostro team — contatti l’assistenza per qualsiasi domanda.', financial_verification: 'La Sua richiesta richiede una verifica manuale da parte del nostro team.',
    },
    ar: {
      restaurant_review: 'بانتظار رد المطعم', refused: 'مرفوضة', arbitration: 'قيد تحكيم Grubano',
      approved: 'تمت الموافقة — ردّ المبلغ بانتظار المعالجة', refunding: 'جارٍ رد المبلغ', refunded: 'تم رد المبلغ', refused_final: 'تم تأكيد الرفض',
      closed_by_support: 'أُغلق الملف من قِبل فريقنا — تواصل مع الدعم لأي استفسار.', financial_verification: 'يتطلب طلبك تحققًا يدويًا من فريقنا.',
    },
  }
  it('the unchanged F06 values stay byte-identical to HEAD in en / es / it / ar', () => {
    for (const loc of ['en', 'es', 'it', 'ar'] as const) {
      expect(Object.keys(HEAD_UNCHANGED[loc]).sort(), loc).toEqual(['approved', 'arbitration', 'closed_by_support', 'financial_verification', 'refunded', 'refunding', 'refused', 'refused_final', 'restaurant_review'])
      for (const [k, v] of Object.entries(HEAD_UNCHANGED[loc])) expect(M[loc].claims.status[k], `${loc} ${k}`).toBe(v)
    }
    // NEGATIVE CONTROL: a one-character drift in one locale fails the equality
    expect(`${HEAD_UNCHANGED.it.refunded}.`).not.toBe(M.it.claims.status.refunded)
  })

  it('NEGATIVE CONTROL — the HEAD values fail equality; BREAK/RESTORE: refuseFinal fr reverted to « Confirmer le refus » is caught', () => {
    expect('Confirmer le refus').not.toBe(EXPECTED['claims.admin.refuseFinal'].fr)
    expect('Votre réclamation est en cours d’examen. Vous serez informé de la suite.').not.toBe(EXPECTED['eat.help.claimFiledSub'].fr)
    // W7 fixer (J-C11): the pre-round-13 HEAD claims.client.success / description (read at e12c0f3) fail equality too
    expect('Réclamation envoyée. Le restaurant l’examine — suivez sa réponse sur cette page.').not.toBe(EXPECTED['claims.client.success'].fr)
    expect('Dites-nous ce qui s’est passé. Le restaurant examine votre demande et sa réponse s’affichera ici.').not.toBe(EXPECTED['claims.client.description'].fr)
    expect('Claim submitted. The restaurant is reviewing it — check this page for its response.').not.toBe(EXPECTED['claims.client.success'].en)
    expect('Tell us what happened. The restaurant reviews your request and its response will appear here.').not.toBe(EXPECTED['claims.client.description'].en)
    const reverted = JSON.parse(JSON.stringify(M.fr))
    reverted.claims.admin.refuseFinal = 'Confirmer le refus'
    expect(messageAt(reverted, 'claims.admin.refuseFinal')).not.toBe(EXPECTED['claims.admin.refuseFinal'].fr)
  })
})

describe('J-C16 — admin approval toast copy (F13) and its drafting constraints', () => {
  const M = Object.fromEntries(LOCALES.map((l) => [l, JSON.parse(read(`messages/${l}.json`))]))
  const KEYS = ['approvedNotSent', 'approvedPending', 'approvedIdentityUnverified', 'approvedSuperseded', 'approvedNotSentUntil', 'approvedFailed', 'approvedResumeMismatch']
  const F13 = specSection('F13')
  /** The five `- <loc> « … »` lines right after a line starting with `head`. */
  const afterLine = (head: string) => {
    const at = F13.findIndex((l) => l.startsWith(head))
    return Object.fromEntries(F13.slice(at + 1, at + 6).map((l) => /^- (fr|en|es|it|ar) « (.*) »$/.exec(l)!).map((m) => [m[1], m[2]]))
  }
  /** ER-R30 (W2 note on F13): approvedSuperseded ships without « ce que cette tentative a obtenu du moteur ». */
  const supersededShipped = () => {
    const note = F13.find((l) => l.startsWith('IMPLEMENTATION NOTE (W2):'))!
    const out: Record<string, string> = {}
    const locs = ['fr', 'en', 'es', 'it', 'ar']
    locs.forEach((loc, i) => {
      const start = note.indexOf(`${i === 0 ? 'shipped strings — ' : '; '}${loc} « `) + `${i === 0 ? 'shipped strings — ' : '; '}${loc} « `.length
      const end = i < locs.length - 1 ? note.indexOf(`; ${locs[i + 1]} « `, start) : note.indexOf(' ». A console slice', start)
      out[loc] = note.slice(start, end).replace(/ »$/, '')
    })
    return out
  }
  const SECTION = /« (Remboursements à traiter|Vérification financière requise|En arbitrage — à trancher|Avis client non envoyés|Réclamations remboursées dont)/
  const ES = [new RegExp(String.raw`\b(webhook|motor|barrido)\b[^.]{0,60}\p{L}+ará(?!\p{L})`, 'iu')]
  const IT = [new RegExp(String.raw`\b(webhook|motore|scansione)\b[^.]{0,60}\p{L}+rà(?!\p{L})`, 'iu')]

  it('new or reworded values equal F13 (approvedSuperseded per the W2 ER-R30 note)', () => {
    const table = specCopyTable('F13', 'claims.admin.')
    const notSent = afterLine('REWORD approvedNotSent.')
    const superseded = supersededShipped()
    for (const loc of LOCALES) {
      const a = M[loc].claims.admin
      expect(a.approvedNotSent, loc).toBe(notSent[loc])
      for (const k of ['approvedPending', 'approvedIdentityUnverified', 'approvedNotSentUntil']) expect(a[k], `${loc} ${k}`).toBe(table[`claims.admin.${k}`][loc as 'fr'])
      expect(a.approvedSuperseded, loc).toBe(superseded[loc])
      expect(a.approvedSuperseded, loc).not.toContain('obtenu du moteur')
    }
  })

  it('approvedFailed / approvedResumeMismatch name no section; no approval toast names a console section; ar never « المحرك »; es/it no future tense after motor/motore; {date} kept', () => {
    for (const loc of LOCALES) {
      const a = M[loc].claims.admin
      for (const k of KEYS) {
        expect(a[k], `${loc} ${k}`).not.toMatch(SECTION)
        if (loc === 'ar') expect(a[k], k).not.toContain('المحرك')
        if (loc === 'es') for (const re of ES) expect(a[k], k).not.toMatch(re)
        if (loc === 'it') for (const re of IT) expect(a[k], k).not.toMatch(re)
      }
      expect(a.approvedNotSentUntil, loc).toContain('{date}')
    }
    // IMPLEMENTATION NOTE (W7) on F13: only the section-naming clause was removed from approvedResumeMismatch — the « never retry » instruction stays.
    expect(M.fr.claims.admin.approvedResumeMismatch).toMatch(/Ne relancez aucun remboursement\.$/)
  })

  it('NEGATIVE CONTROL — the HEAD approvedNotSent and a synthetic ar « المحرك » fail; BREAK/RESTORE: the HEAD section sentence appended to en approvedFailed is caught', () => {
    expect('Réclamation approuvée — aucun remboursement confirmé… À vérifier dans « Remboursements à traiter ».').toMatch(SECTION)
    expect('تمت الموافقة على الشكوى، لكن المحرك رفض ردّ المبلغ').toContain('المحرك')
    expect(`${M.en.claims.admin.approvedFailed} Details under « Remboursements à traiter ».`).toMatch(SECTION)
  })
})

import { specCopyTable, specSection, messageAt } from './support/spec-copy'
