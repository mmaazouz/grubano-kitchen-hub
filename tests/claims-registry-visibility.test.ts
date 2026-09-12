// tests/claims-registry-visibility.test.ts — T-49 round 13, slice W7
//   J-M50 / J-C45 (I-09, E0, E-01…E-18, F05) every E entry appears where it says — its bucket and count, a separate count, or its
//                   census key — and E-08 / E-09 are pinned as NOT visible;
//   J-C46 (E0 NM0, E-10, R-D5) no registry surface moves money, and E-10's exits are gated or time-bound.
//
// One in-memory Prisma world (where clauses evaluated by tests/support/prisma-where) drives the REAL list builders behind
// GET /api/admin/claims/financial-verification and the census.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { matchWhere } from './support/prisma-where'

/* eslint-disable @typescript-eslint/no-explicit-any -- an in-memory double of Prisma rows, passed to the typed rules as they are */
type Row = any

const { db, st, lib, stripeMock } = vi.hoisted(() => {
  const st = { claims: [] as Row[], refunds: [] as Row[], dispatch: [] as Row[], audits: [] as Row[], royalties: [] as Row[], writes: [] as Row[] }
  return {
    st,
    db: {
      claim:           { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn(), groupBy: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
      refund:          { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      order:           { findMany: vi.fn(), findUnique: vi.fn() },
      emailDispatch:   { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
      adminAuditLog:   { findMany: vi.fn() },
      franchiseRoyalty: { findMany: vi.fn(), findFirst: vi.fn() },
      $transaction:    vi.fn(),
    },
    lib: { executeRefund: vi.fn(), refundsOn: vi.fn(() => false), closureEmail: vi.fn(), audit: vi.fn() },
    stripeMock: {
      paymentIntents: { retrieve: vi.fn() },
      refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn(), update: vi.fn() },
      transfers: { createReversal: vi.fn() },
    },
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/refund', () => ({ executeRefund: lib.executeRefund, isRefundsEnabled: lib.refundsOn, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn().mockResolvedValue({ status: 'sent' }) }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: lib.audit, isAdminAuditEnabled: () => true }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: vi.fn(async () => ({ id: 'op1', role: 'admin', email: 'a@x.test' })) }))
vi.mock('@/lib/claim-emails', () => ({ sendClaimClosureEmail: lib.closureEmail, sendClaimDecisionEmail: vi.fn(), sendClaimAckEmail: vi.fn() }))

import { GET as FV_ROUTE } from '@/app/api/admin/claims/financial-verification/route'
import { POST as RECONCILE } from '@/app/api/admin/claims/[id]/reconcile/route'
import { POST as RESOLVE_STUCK } from '@/app/api/admin/claims/[id]/resolve-stuck/route'
import { POST as CLOSURE_NOTICE } from '@/app/api/admin/claims/[id]/closure-notice/route'
import { POST as ARBITRATE } from '@/app/api/admin/claims/[id]/arbitrate/route'
import { POST as ATTRIBUTE } from '@/app/api/admin/claims/[id]/attribute/route'
import { GET as CENSUS } from '@/app/api/admin/claims/census/route'
import { claimsLegacyCensus, claimsClosureCensus } from '@/lib/claims-census'
import { triggerClaimRefund, markClaimsForRevertedRefundRow, attributeClaimRefund, arbitrateClaim } from '@/lib/claims'
import {
  MARKERS, reconcileRefusal, isStuckResolvable, arbitrationRefusal, acceptedExits, customerClaimStatus, refundedRowTruth, type BoundRowFacts,
} from '@/lib/claim-action-rules'
import { financialVerificationCardVisible, financialVerificationHeadingVisible } from '@/lib/claim-money-line'
import { approvalToast } from '@/lib/claim-approval-toast'

// ── the world ──────────────────────────────────────────────────────────────────────────────────────────────────────
function filterRows(rows: Row[], where: Row = {}): Row[] {
  return rows.filter((r) => matchWhere(where, r))
}
function ordered(rows: Row[], orderBy?: Row | Row[]): Row[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).map((o) => Object.entries(o)[0] as [string, 'asc' | 'desc'])
  return [...rows].sort((a, b) => {
    for (const [k, dir] of keys) {
      const x = k === 'id' ? String(a[k]) : new Date(a[k] ?? 0).getTime()
      const y = k === 'id' ? String(b[k]) : new Date(b[k] ?? 0).getTime()
      if (x !== y) return (x < y ? -1 : 1) * (dir === 'asc' ? 1 : -1)
    }
    return 0
  })
}
function page(rows: Row[], args: Row = {}): Row[] {
  let out = ordered(filterRows(rows, args.where), args.orderBy)
  if (args.cursor) { const i = out.findIndex((r) => r.id === args.cursor.id); out = out.slice(i < 0 ? out.length : i) }
  out = out.slice(args.skip ?? 0)
  return (typeof args.take === 'number' ? out.slice(0, args.take) : out).map((r) => ({ ...r }))
}
const MONEY_WRITE = () => { throw new Error('a registry surface wrote a Refund row') }

beforeEach(() => {
  vi.clearAllMocks()
  st.claims = []; st.refunds = []; st.dispatch = []; st.audits = []; st.royalties = []; st.writes = []
  db.claim.findMany.mockReset().mockImplementation(async (args: Row) => page(st.claims, args))
  db.claim.findUnique.mockReset().mockImplementation(async ({ where }: Row) => { const c = st.claims.find((x) => x.id === where.id); return c ? { ...c } : null })
  db.claim.findFirst.mockReset().mockImplementation(async (args: Row) => page(st.claims, args)[0] ?? null)
  db.claim.count.mockReset().mockImplementation(async ({ where }: Row) => filterRows(st.claims, where).length)
  db.claim.groupBy.mockReset().mockImplementation(async ({ where, having }: Row) => {
    const counts = new Map<string, number>()
    for (const c of filterRows(st.claims, where)) if (c.refundId) counts.set(c.refundId, (counts.get(c.refundId) ?? 0) + 1)
    const min = having?.refundId?._count?.gt
    return Array.from(counts).filter(([, n]) => typeof min !== 'number' || n > min).map(([refundId, n]) => ({ refundId, _count: { _all: n } }))
  })
  db.claim.updateMany.mockReset().mockImplementation(async ({ where, data }: Row) => {
    const hits = st.claims.filter((c) => c.id === where.id && matchWhere(where, c))
    for (const h of hits) Object.assign(h, data)
    st.writes.push({ where, data, count: hits.length })
    return { count: hits.length }
  })
  db.claim.update.mockReset().mockImplementation(async () => { throw new Error('claim.update is not a CAS') })
  db.refund.findMany.mockReset().mockImplementation(async (args: Row) => page(st.refunds, args))
  db.refund.findUnique.mockReset().mockImplementation(async ({ where }: Row) => { const r = st.refunds.find((x) => x.id === where.id); return r ? { ...r } : null })
  db.refund.findFirst.mockReset().mockImplementation(async (args: Row) => page(st.refunds, args)[0] ?? null)
  for (const m of [db.refund.create, db.refund.update, db.refund.updateMany]) m.mockReset().mockImplementation(MONEY_WRITE)
  db.order.findMany.mockReset().mockResolvedValue([])
  db.order.findUnique.mockReset().mockResolvedValue({ id: 'o1', paymentStatus: 'paid', stripePaymentIntentId: 'pi_1', restaurantId: 'r1' })
  db.emailDispatch.findMany.mockReset().mockImplementation(async (args: Row) => page(st.dispatch, args))
  db.emailDispatch.findFirst.mockReset().mockImplementation(async (args: Row) => page(st.dispatch, args)[0] ?? null)
  db.emailDispatch.create.mockReset().mockImplementation(async ({ data }: Row) => { st.dispatch.push({ id: `d${st.dispatch.length}`, createdAt: new Date(), ...data }); return data })
  db.adminAuditLog.findMany.mockReset().mockImplementation(async ({ where }: Row) => filterRows(st.audits, where))
  db.franchiseRoyalty.findMany.mockReset().mockImplementation(async ({ where }: Row) => filterRows(st.royalties, where))
  db.franchiseRoyalty.findFirst.mockReset().mockResolvedValue(null)
  db.$transaction.mockReset().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db))
  lib.refundsOn.mockReset().mockReturnValue(false)
  lib.executeRefund.mockReset()
  lib.audit.mockReset().mockResolvedValue(true)
  lib.closureEmail.mockReset().mockResolvedValue({ status: 'skipped', kind: 'refunded', why: 'claims_disabled' })
  for (const m of [stripeMock.refunds.create, stripeMock.refunds.update, stripeMock.transfers.createReversal]) m.mockReset().mockImplementation(async () => { throw new Error('a registry surface wrote to Stripe') })
  stripeMock.paymentIntents.retrieve.mockReset().mockResolvedValue({ id: 'pi_1', status: 'succeeded', transfer_data: null, latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0, disputed: false } })
  stripeMock.refunds.list.mockReset().mockResolvedValue({ data: [], has_more: false })
  stripeMock.refunds.retrieve.mockReset()
  delete process.env.CLAIMS_ENABLED
  delete process.env.CLAIMS_WINDOW_UNTIL
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

const H = 3_600_000
const iso = (ms: number) => new Date(Date.now() + ms).toISOString()
const claim = (id: string, o: Row = {}): Row => ({
  id, orderId: 'o1', consumerId: 'u1', restaurantId: 'r1', reason: 'wrong_item', requestedAmountCents: 500, status: 'approved', refundAttempted: false,
  refundId: null, refundError: null, arbitrationDecision: 'approved', restaurantResponse: null, arbitrationReason: null, decidedAt: new Date(), createdAt: new Date(Date.now() - 48 * H),
  responseDeadlineAt: new Date(0), activeOrderKey: 'o1', ...o,
})
const row = (id: string, o: Row = {}): Row => ({ id, orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: `re_${id}`, reason: null, createdAt: new Date(Date.now() - 30 * H), royaltyRefundCents: 0, idempotencyKey: `refund:o1:${id}`, ...o })
const marker = (atMs: number) => `reconcile_required: tentative de remboursement démarrée à ${iso(atMs)} (tentative 1a2b) — identité du remboursement pas encore liée.`
const REVERTED = `${MARKERS.REVERTED_AFTER_REFUND} la réclamation a été soldée sur la ligne rf_e06…`

/** One representative claim per E entry (and per sub-shape where the surface differs). */
function registryWorld() {
  st.claims = [
    claim('E-01', { refundError: 'no_refund_proven_rail_locked: x' }),
    claim('E-02', { refundAttempted: true, refundId: 'rf_e02', refundError: 'stripe_failed: x' }),
    claim('E-03', { status: 'financial_verification', refundError: 'financial_verification:stripe_unreadable: x' }),
    claim('E-04', { status: 'financial_verification', refundError: 'financial_verification:refund_moved_unattributed: x' }),
    claim('E-05-grace', { status: 'refunding', refundAttempted: true, refundError: marker(-60_000) }),
    claim('E-05-after', { status: 'refunding', refundAttempted: true, refundError: marker(-2 * H) }),
    claim('E-06', { status: 'refunded', refundAttempted: true, refundId: 'rf_e06', refundError: REVERTED, activeOrderKey: null }),
    claim('E-07c', { status: 'refunded', refundAttempted: true, refundId: 'rf_e07c', activeOrderKey: null }),
    claim('E-07d', { status: 'refunded', refundAttempted: true, refundId: 'rf_e07d', activeOrderKey: null }),
    claim('E-08', { status: 'refunded', refundAttempted: true, refundId: 'rf_e08', activeOrderKey: null }),
    claim('E-09', { status: 'refunded', refundAttempted: true, refundId: 'rf_e09', activeOrderKey: null }),
    claim('E-10-null', {}),
    claim('E-10-v13', { refundError: `${MARKERS.PROOF_PAYABLE_V13} … payable au plus tôt le ${iso(H)} (UTC).` }),
    claim('E-11', { status: 'financial_verification', refundError: 'financial_verification:stripe_refund_contradiction: x' }),
    claim('E-12-a', { status: 'financial_verification', refundId: 'rf_e12', refundError: 'financial_verification:refund_moved_unattributed: x' }),
    claim('E-12-b', { status: 'financial_verification', refundId: 'rf_e12', refundError: 'financial_verification:refund_moved_unattributed: y' }),
    claim('E-13', { status: 'refunded', refundAttempted: true, refundId: 'rf_missing', activeOrderKey: null }),
    claim('E-14', { status: 'refunded', refundAttempted: true, refundId: 'rf_e14', refundError: 'resume_mismatch: x', activeOrderKey: null }),
    claim('E-15', { status: 'refunded', refundAttempted: true, refundId: 'rf_e15', activeOrderKey: null }),
    claim('E-16', { status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'accepted', activeOrderKey: null }),
    claim('E-18', { status: 'refused_final', arbitrationDecision: 'approved', refundError: 'engine_failed: x', activeOrderKey: null }),
  ]
  st.refunds = [
    row('rf_e02', { status: 'failed' }), row('rf_e06'), row('rf_e07c', { status: 'failed' }), row('rf_e07d', { status: 'pending', createdAt: new Date(Date.now() - 2 * H) }),
    row('rf_e08'), row('rf_e09'), row('rf_e12'), row('rf_e14', { reason: 'claim:E-14' }), row('rf_e15'),
  ]
  // E-16: this build's closure record, no notice dispatched. E-15: the contradiction-park alert record and the attribution audit row.
  st.dispatch = [
    { id: 'rec_E-16', trigger: 'claim_closure_record', dedupeKey: 'claim:E-16', createdAt: new Date() },
    { id: 'fv_E-15', trigger: 'admin_money_review_claim_financial_verification', dedupeKey: 'claim_fv:E-15:stripe_refund_contradiction', createdAt: new Date() },
  ]
  st.audits = [{ id: 'a1', targetType: 'claim', action: 'claim.attribute_refund', targetId: 'E-15' }]
}

type Payload = Row & { counts: Row }
const fv = async (): Promise<Payload> => (await FV_ROUTE()).json()
const ids = (rows: Row[]) => rows.map((r) => r.id ?? r.claimId).sort()

// ══ J-M50 / J-C45 ═══════════════════════════════════════════════════════════════════════════════════════════════════
describe('J-M50 / J-C45 — every E entry is in its bucket and count', () => {
  it('buckets and counts, per E entry', async () => {
    registryWorld()
    const p = await fv()
    expect(ids(p.otherUnsettled)).toEqual(['E-01', 'E-02', 'E-05-grace', 'E-06', 'E-07c', 'E-10-null', 'E-10-v13'].sort())
    expect(ids(p.financialVerification)).toEqual(['E-03', 'E-04', 'E-11', 'E-12-a', 'E-12-b'])
    expect(ids(p.reconcileRequired)).toEqual(['E-05-after'])
    expect(p.unfinalizedRefundRows.map((u: Row) => u.claimId)).toEqual(['E-07d'])
    expect(ids(p.refundedUnproven.items)).toEqual(['E-13'])
    expect(p.closureNotices.items.map((n: Row) => n.claimId)).toEqual(['E-16'])
    expect(p.counts).toEqual({
      financialVerification: 5, reconcileRequired: 1, otherUnsettled: 7, total: 13, unfinalizedRefundRows: 1, refundedUnproven: 1, closureNoticesMissing: 1,
    })
  })

  it('E-05 during grace: listed with no reconcile control and the grace refusal; after grace: reconcilable', async () => {
    registryWorld()
    const p = await fv()
    const grace = p.otherUnsettled.find((r: Row) => r.id === 'E-05-grace')
    expect(grace).toMatchObject({ moneyState: 'reconcile_required', reconcilable: false, resolvable: false })
    expect(reconcileRefusal(grace)?.error).toContain('moins de 5 minutes')
    expect(p.reconcileRequired[0]).toMatchObject({ id: 'E-05-after', reconcilable: true })
  })

  it('census keys: E-12 rowsBoundToMultipleClaims, E-14 ownRowResumeMismatch.terminal, E-15 refundedAfterContradictionAttribution, E-18 closure.terminalWithoutRecord', async () => {
    registryWorld()
    const legacy = await claimsLegacyCensus()
    const closure = await claimsClosureCensus()
    expect(legacy.rowsBoundToMultipleClaims).toBe(1)
    expect(legacy.ownRowResumeMismatch.terminal).toBe(1)
    expect(legacy.refundedAfterContradictionAttribution).toBe(1)
    expect(legacy.refundedRowUnproven).toBe(1)
    expect(legacy.refundedBoundToFailedRow).toBe(1)
    // E-18: the declaration without a record, and every other terminal closure without one (E-06 is not a closure: kind null)
    expect(closure.terminalWithoutRecord).toBe(st.claims.filter((c) => ['E-07c', 'E-07d', 'E-08', 'E-09', 'E-13', 'E-14', 'E-15', 'E-18'].includes(c.id)).length)
    expect(closure.missing).toBe(1)
  })

  it('per row, the D0 flags equal the server rule verdicts (reconcilable, resolvable, approvable)', async () => {
    registryWorld()
    const p = await fv()
    const now = new Date()
    for (const r of [...p.otherUnsettled, ...p.reconcileRequired, ...p.financialVerification]) {
      const boundRow: BoundRowFacts | null | undefined = 'refund' in r
        ? (r.refund ? { id: r.refund.id, orderId: st.refunds.find((x) => x.id === r.refund.id)?.orderId, status: r.refund.status, stripeRefundId: r.refund.stripeRefundId, reason: r.refund.reason } : null)
        : undefined
      const c = { ...st.claims.find((x) => x.id === r.id)!, ...(boundRow !== undefined ? { boundRow } : {}) }
      expect(r.reconcilable, `${r.id} reconcilable`).toBe(reconcileRefusal(c) === null)
      if ('resolvable' in r) expect(r.resolvable, `${r.id} resolvable`).toBe(isStuckResolvable(c))
      expect(r.approvable, `${r.id} approvable`).toBe(acceptedExits({ claim: c, now }).includes('approve') && arbitrationRefusal(c, 'approve', now) === null)
    }
    expect(p.otherUnsettled.find((r: Row) => r.id === 'E-10-null').approvable).toBe(true)
    expect(p.otherUnsettled.find((r: Row) => r.id === 'E-10-v13').approvable).toBe(false) // before its instant
  })

  it('the customer status of each fixture equals its E entry’s CUSTOMER field', () => {
    registryWorld()
    const truth = (id: string) => {
      const c = st.claims.find((x) => x.id === id)!
      const r = st.refunds.find((x) => x.id === c.refundId) ?? null
      const binders = st.claims.filter((x) => x.refundId && x.refundId === c.refundId && (x.refundError === null || !String(x.refundError).startsWith('resume_mismatch'))).length
      return customerClaimStatus(c, r ? r.status === 'pending' && !!r.stripeRefundId : null, refundedRowTruth(r, binders, c.orderId))
    }
    const FVc = 'financial_verification'
    expect(Object.fromEntries(['E-01', 'E-02', 'E-03', 'E-04', 'E-05-grace', 'E-06', 'E-07c', 'E-07d', 'E-08', 'E-09', 'E-10-null', 'E-10-v13', 'E-12-a', 'E-13', 'E-14', 'E-15', 'E-16', 'E-18'].map((id) => [id, truth(id)]))).toEqual({
      'E-01': FVc, 'E-02': FVc, 'E-03': FVc, 'E-04': FVc, 'E-05-grace': FVc, 'E-06': FVc,
      'E-07c': 'refund_unconfirmed', 'E-07d': 'refunded', // A-S31d: RFc until R0b (no failure signal read)
      'E-08': 'refunded', 'E-09': 'refunded', // the documented C6 breach (E-08) and REG-7 (E-09)
      'E-10-null': 'approved', 'E-10-v13': FVc, 'E-12-a': FVc, 'E-13': 'refund_unconfirmed', 'E-14': 'closed_by_support', 'E-15': 'refunded',
      'E-16': 'refused_by_grubano', 'E-18': 'closed_by_support',
    })
  })

  it('E-09 (A-S31e-1/2) and E-08 appear in no list and no count — REG-7 NOT FAIL-VISIBLE (AMF-1 is a pass, not a surface)', async () => {
    registryWorld()
    const withAll = await fv()
    const legacyWith = await claimsLegacyCensus()
    const listed = JSON.stringify([withAll.otherUnsettled, withAll.financialVerification, withAll.reconcileRequired, withAll.unfinalizedRefundRows, withAll.refundedUnproven, withAll.closureNotices])
    for (const id of ['E-08', 'E-09']) expect(listed, id).not.toContain(`"${id}"`)
    // removing both fixtures changes no count and no census key
    st.claims = st.claims.filter((c) => c.id !== 'E-08' && c.id !== 'E-09')
    expect((await fv()).counts).toEqual(withAll.counts)
    expect(await claimsLegacyCensus()).toEqual(legacyWith)
  })

  it('E-13 and E-07 lists are disjoint, and their union is every settled null-error claim whose row is unproven or failed with an id (NEGATIVE CONTROL)', async () => {
    registryWorld()
    const p = await fv()
    const e13 = ids(p.refundedUnproven.items)
    const e07 = [...p.otherUnsettled.filter((r: Row) => r.status === 'refunded' && r.refundError === null).map((r: Row) => r.id), ...p.unfinalizedRefundRows.map((u: Row) => u.claimId)]
    expect(e13.filter((id) => e07.includes(id))).toEqual([])
    const settled = st.claims.filter((c) => c.status === 'refunded' && c.refundError === null)
    // W7 fixer (J-C45 note): a row with two or more binders (A-S43) is in neither list, so the union excludes it.
    const bindersOf = (refundId: string | null) => st.claims.filter((x) => refundId && x.refundId === refundId && (x.refundError === null || !String(x.refundError).startsWith('resume_mismatch'))).length
    const unprovenOrFailed = settled.filter((c) => {
      const r = st.refunds.find((x) => x.id === c.refundId) ?? null
      if (c.refundId && bindersOf(c.refundId) >= 2) return false
      return refundedRowTruth(r, 1, c.orderId) === false
    }).map((c) => c.id).sort()
    expect([...e13, ...p.otherUnsettled.filter((r: Row) => r.status === 'refunded' && r.refundError === null).map((r: Row) => r.id)].sort()).toEqual(unprovenOrFailed)
  })

  it('W7 fixer (J-C45) — an unproven row with two binders is in neither list and each claim reads the manual review; NEGATIVE CONTROL: one binder → section A', async () => {
    registryWorld()
    const mb = (id: string) => claim(id, { status: 'refunded', refundAttempted: true, refundId: 'rf_mb', activeOrderKey: null })
    st.claims.push(mb('MB-a'), mb('MB-b'))
    st.refunds.push(row('rf_mb', { amountCents: 0 }))
    const p = await fv()
    const listed = JSON.stringify([p.otherUnsettled, p.financialVerification, p.reconcileRequired, p.unfinalizedRefundRows, p.refundedUnproven, p.closureNotices])
    for (const id of ['MB-a', 'MB-b']) expect(listed, id).not.toContain(`"${id}"`)
    expect(p.counts.refundedUnproven).toBe(1) // E-13 only
    const r = st.refunds.find((x) => x.id === 'rf_mb')!
    for (const id of ['MB-a', 'MB-b']) {
      const c = st.claims.find((x) => x.id === id)!
      expect(customerClaimStatus(c, r.status === 'pending' && !!r.stripeRefundId, refundedRowTruth(r, 2, c.orderId)), id).toBe('financial_verification')
    }
    st.claims = st.claims.filter((c) => c.id !== 'MB-b')
    expect(ids((await fv()).refundedUnproven.items)).toEqual(['E-13', 'MB-a'])
  })

  it('financialVerificationCardVisible: the 16-row truth table (true iff any input > 0); the red heading iff claim rows or unfinalized rows', () => {
    for (let mask = 0; mask < 16; mask++) {
      const q = { claimRows: mask & 1, unfinalizedRows: (mask >> 1) & 1, closureNotices: (mask >> 2) & 1, refundedUnproven: (mask >> 3) & 1 }
      expect(financialVerificationCardVisible(q)).toBe(mask !== 0)
      expect(financialVerificationHeadingVisible(q)).toBe((mask & 3) !== 0)
    }
  })

  it('NEGATIVE CONTROL — no false alarm: a settled claim on a row still succeeded is listed nowhere; BREAK/RESTORE witness: without the REVERTED OR clause E-06 disappears', async () => {
    st.claims = [claim('ok', { status: 'refunded', refundAttempted: true, refundId: 'rf_ok', activeOrderKey: null })]
    st.refunds = [row('rf_ok')]
    const p = await fv()
    expect(p.counts).toMatchObject({ total: 0, unfinalizedRefundRows: 0, refundedUnproven: 0, closureNoticesMissing: 0 })
    registryWorld()
    const real = db.claim.findMany.getMockImplementation()!
    db.claim.findMany.mockImplementation(async (args: Row) => {
      const or = args?.where?.OR as Row[] | undefined
      const stripped = or ? { ...args, where: { ...args.where, OR: or.filter((w) => !(w.status === 'refunded' && w.refundError?.startsWith === MARKERS.REVERTED_AFTER_REFUND)) } } : args
      return real(stripped)
    })
    expect(ids((await fv()).otherUnsettled)).not.toContain('E-06')
  })
})

// ══ J-C46 — no money from any registry surface ═══════════════════════════════════════════════════════════════════════
describe('J-C46 (NM0) — the registry surfaces move no money; their audits say moneyMoved false', () => {
  const noMoney = () => {
    expect(lib.executeRefund).not.toHaveBeenCalled()
    for (const m of [stripeMock.refunds.create, stripeMock.refunds.update, stripeMock.transfers.createReversal, db.refund.create, db.refund.update, db.refund.updateMany]) expect(m).not.toHaveBeenCalled()
  }
  const post = (h: (req: Request, ctx: { params: { id: string } }) => Promise<Response>, id: string, body?: unknown) =>
    h(new Request('https://app.grubano.com/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? '' : JSON.stringify(body) }), { params: { id } })

  it('the FV GET and the census', async () => {
    registryWorld()
    await fv()
    await claimsLegacyCensus()
    await claimsClosureCensus()
    noMoney()
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('reconcile R0a on E-07c (claim-only marking), resolve-stuck on the marked claim, closure-notice on E-16, the webhook helper: all money spies 0, audits moneyMoved false', async () => {
    registryWorld()
    let res = await post(RECONCILE, 'E-07c')
    expect(res.status).toBe(200)
    expect((await res.json()).result.outcome).toBe('reverted_after_refund')
    res = await post(RESOLVE_STUCK, 'E-07c', { resolution: 'closed_no_payment' })
    expect(res.status).toBe(200)
    res = await post(CLOSURE_NOTICE, 'E-16')
    expect(res.status).toBe(200)
    const helper = await markClaimsForRevertedRefundRow({ rowId: 'rf_e02', evidence: { kind: 'failed_row' } } as never)
    expect(helper.failed).toBe(false)
    noMoney()
    const audited = lib.audit.mock.calls.map((c) => c[0]).filter((a) => ['claim.reconcile_evidence', 'claim.closure_notice'].includes(a.action))
    expect(audited.length).toBeGreaterThanOrEqual(2)
    for (const a of audited) expect(a.metadata.moneyMoved, a.action).toBe(false)
  })

  // W7 fixer (J-C46): the attribute WRITE through the route — the Serializable transaction commits, and still no money moves.
  it('POST attribute (write, not a preview) on an FV claim with a Stripe-proven row: the claim settles, all money spies 0, audit moneyMoved false', async () => {
    registryWorld()
    st.refunds.push(row('rf_attr', { stripeRefundId: 're_attr' }))
    stripeMock.refunds.retrieve.mockResolvedValue({ id: 're_attr', status: 'succeeded', amount: 500, payment_intent: 'pi_1', charge: 'ch_1', metadata: {} })
    const res = await post(ATTRIBUTE, 'E-04', { refundRowId: 'rf_attr' })
    expect(res.status).toBe(200)
    expect((await res.json()).result.outcome).toBe('refunded')
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(st.claims.find((c) => c.id === 'E-04')).toMatchObject({ status: 'refunded', refundId: 'rf_attr' })
    noMoney()
    const audited = lib.audit.mock.calls.map((c) => c[0]).filter((a) => a.action === 'claim.attribute_refund')
    expect(audited).toHaveLength(1)
    expect(audited[0].metadata.moneyMoved).toBe(false)
  })

  it('GET /api/admin/claims/census with the internal token: 200, counts only, all money spies 0, no claim or dispatch write; 401 without the token', async () => {
    registryWorld()
    const prev = process.env.INTERNAL_CRON_TOKEN
    process.env.INTERNAL_CRON_TOKEN = 'registry-test-token'
    try {
      // the census counts every claim with count() and no argument
      db.claim.count.mockImplementation(async (args?: Row) => filterRows(st.claims, args?.where).length)
      const url = 'https://app.grubano.com/api/admin/claims/census'
      expect((await CENSUS(new Request(url) as never)).status).toBe(401)
      const res = await CENSUS(new Request(url, { headers: { 'x-internal-token': 'registry-test-token' } }) as never)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.claims.total).toBe(st.claims.length)
      expect(body.claims.legacy.refundedRowUnproven).toBe(1)
      noMoney()
      expect(db.claim.updateMany).not.toHaveBeenCalled()
      expect(db.emailDispatch.create).not.toHaveBeenCalled()
    } finally {
      if (prev === undefined) delete process.env.INTERNAL_CRON_TOKEN
      else process.env.INTERNAL_CRON_TOKEN = prev
    }
  })

  it('attribute preview (dryRun) reads Stripe and writes nothing', async () => {
    registryWorld()
    st.refunds.push(row('rf_attr', { stripeRefundId: 're_attr' }))
    stripeMock.refunds.retrieve.mockResolvedValue({ id: 're_attr', status: 'succeeded', amount: 500, payment_intent: 'pi_1', charge: 'ch_1', metadata: {} })
    const out = await attributeClaimRefund({ claimId: 'E-04', refundRowId: 'rf_attr', adminId: 'op1', dryRun: true })
    expect(out.ok).toBe(true)
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
    noMoney()
  })
})

describe('J-C46 (E-10) — an unpaid approval is payable only through a gated or time-bound approval', () => {
  it('arbitrate with CLAIMS off → 403, nothing read', async () => {
    registryWorld()
    const res = await ARBITRATE(new Request('https://app.grubano.com/x', { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }), { params: { id: 'E-10-null' } })
    expect(res.status).toBe(403)
    expect(db.claim.findUnique).not.toHaveBeenCalled()
  })

  it('REFUNDS off → triggerClaimRefund answers refunds_disabled before its CAS (no claim write); the toast is approvedNotSent, success', async () => {
    registryWorld()
    const r = await triggerClaimRefund('E-10-null')
    expect(r).toEqual({ state: 'pending', reason: 'refunds_disabled' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(approvalToast(r)).toEqual({ key: 'approvedNotSent', tone: 'success' })
    noMoneyEngine()
  })

  it('before Q-INSTANT → approve refused with a text carrying the instant, and T1 answers already_handled without writing', async () => {
    registryWorld()
    lib.refundsOn.mockReturnValue(true)
    const c = st.claims.find((x) => x.id === 'E-10-v13')!
    const text = arbitrationRefusal(c, 'approve', new Date())?.error
    expect(text).toContain(/payable au plus tôt le (\S+) \(UTC\)/.exec(c.refundError)![1])
    expect(await triggerClaimRefund('E-10-v13')).toEqual({ state: 'already_handled' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    noMoneyEngine()
  })

  it('the customer reads APc for a null error and FVc for a v13 proof; refuse_final is refused on every approved claim (AM-B3)', () => {
    registryWorld()
    const nul = st.claims.find((x) => x.id === 'E-10-null')!
    const v13 = st.claims.find((x) => x.id === 'E-10-v13')!
    expect(customerClaimStatus(nul, null, null)).toBe('approved')
    expect(customerClaimStatus(v13, null, null)).toBe('financial_verification')
    for (const c of [nul, v13, { ...nul, arbitrationDecision: null }]) expect(arbitrationRefusal(c, 'refuse_final', new Date())?.error).toContain('elle ne peut plus être refusée')
  })

  it('NEGATIVE CONTROL — both leases open, past Q-INSTANT, T2 passing → executeRefund is called exactly once (the spy works)', async () => {
    st.claims = [claim('pay', { refundError: `${MARKERS.PROOF_PAYABLE_V13} … payable au plus tôt le ${iso(-2 * H)} (UTC).` })]
    st.refunds = []
    lib.refundsOn.mockReturnValue(true)
    lib.executeRefund.mockResolvedValue({ ok: false, status: 409, error: 'Refus du moteur (test).' })
    await triggerClaimRefund('pay')
    expect(lib.executeRefund).toHaveBeenCalledTimes(1)
    expect(lib.executeRefund).toHaveBeenCalledWith({ orderId: 'o1', amountCents: 500, reason: 'claim:pay' })
  })

  // W7 fixer (J-C46, E-10): A-S30e-3 before until — an older pending row of the order, unknown to Stripe, still in its window.
  it('A-S30e-3 before until: approve → T2 (e′) unconfirmed_within_window, no engine call, the pre-image restored, toast approvedNotSentUntil carrying until', async () => {
    const world = (withPendingRow: boolean) => {
      st.claims = [claim('ase3', { status: 'arbitration', arbitrationDecision: null })]
      st.refunds = withPendingRow ? [row('rf_W', { status: 'pending', stripeRefundId: null, reason: 'claim:cl_OTHER', createdAt: new Date(Date.now() - 1 * H) })] : []
    }
    world(true)
    lib.refundsOn.mockReturnValue(true)
    lib.executeRefund.mockResolvedValue({ ok: false, status: 409, error: 'Refus du moteur (test).' })
    const out = await arbitrateClaim({ claimId: 'ase3', adminId: 'op1', decision: 'approve' })
    expect(out.ok).toBe(true)
    const refund = (out as { refund?: { state?: string; error?: string; until?: string } }).refund
    expect(refund).toMatchObject({ state: 'failed', error: 'unconfirmed_within_window' })
    expect(Date.parse(String(refund?.until))).toBeGreaterThan(Date.now())
    expect(approvalToast(refund)).toEqual({ key: 'approvedNotSentUntil', tone: 'success', until: refund?.until })
    expect(st.claims[0]).toMatchObject({ status: 'approved', refundAttempted: false, refundError: null })
    noMoneyEngine()
    for (const m of [stripeMock.refunds.update, stripeMock.transfers.createReversal, db.refund.create, db.refund.update, db.refund.updateMany]) expect(m).not.toHaveBeenCalled()
    // NEGATIVE CONTROL: the same world without the pending row reaches the engine once (the spy sees a call when there is one)
    world(false)
    lib.executeRefund.mockClear()
    await arbitrateClaim({ claimId: 'ase3', adminId: 'op1', decision: 'approve' })
    expect(lib.executeRefund).toHaveBeenCalledTimes(1)
  })

  function noMoneyEngine() {
    expect(lib.executeRefund).not.toHaveBeenCalled()
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  }
})
