// tests/claim-closure-lists.test.ts — T-49 round 13, slice W7: J-C30 (H10, I-09, E0, E-13, E-16, E-18) and the J-M38
// « listed in closureNotices » assertions the W6 note left to the console slice.
//
// The two read-only lists behind the sections kept out of the red heading, run over an in-memory Prisma world whose where
// clauses are evaluated (tests/support/prisma-where), and the financial-verification route that carries them.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { matchWhere } from './support/prisma-where'

/* eslint-disable @typescript-eslint/no-explicit-any -- an in-memory double of Prisma rows */
type Row = Record<string, any>

const { db, st } = vi.hoisted(() => {
  const st = { claims: [] as Row[], refunds: [] as Row[], dispatch: [] as Row[], fail: {} as Record<string, boolean>, onDispatchPage: null as null | ((n: number) => void) }
  return {
    st,
    db: {
      claim:         { findMany: vi.fn(), groupBy: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
      refund:        { findMany: vi.fn() },
      order:         { findMany: vi.fn(), findUnique: vi.fn() },
      emailDispatch: { findMany: vi.fn() },
    },
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/refund', () => ({ executeRefund: vi.fn(), isRefundsEnabled: () => false, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn(), isAdminAuditEnabled: () => false }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({}) }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: vi.fn(async () => ({ id: 'op1', role: 'admin', email: 'a@x.test' })) }))

import { listMissingClaimClosureNotices, closureNoticeBlocker, CLOSURE_SCAN_CAP } from '@/lib/claim-closure-lists'
import { listRefundedClaimsWithUnprovenRow, listActionableRefundClaims } from '@/lib/claims'
import { claimsClosureCensus } from '@/lib/claims-census'
import { reconcileRefusal, refundedRowProven, MARKERS, type BoundRowFacts } from '@/lib/claim-action-rules'
import { GET as FV_ROUTE } from '@/app/api/admin/claims/financial-verification/route'

// ── the in-memory world ────────────────────────────────────────────────────────────────────────────────────────────
/** A where evaluated with Set fast paths for the large `in` lists the paging reads use. */
function filterRows(rows: Row[], where: Row = {}): Row[] {
  const fast: Array<[string, Set<unknown>]> = []
  const rest: Row = {}
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && Array.isArray((v as Row).in)) fast.push([k, new Set((v as Row).in)])
    else rest[k] = v
  }
  return rows.filter((r) => fast.every(([k, s]) => s.has(r[k])) && matchWhere(rest, r))
}
const time = (v: unknown) => new Date(v as string).getTime()
function ordered(rows: Row[], orderBy?: Row | Row[]): Row[] {
  const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).map((o) => Object.entries(o)[0] as [string, 'asc' | 'desc'])
  return [...rows].sort((a, b) => {
    for (const [k, dir] of keys) {
      const x = k === 'id' ? String(a[k]) : time(a[k])
      const y = k === 'id' ? String(b[k]) : time(b[k])
      if (x < y) return dir === 'asc' ? -1 : 1
      if (x > y) return dir === 'asc' ? 1 : -1
    }
    return 0
  })
}
function page(rows: Row[], args: Row): Row[] {
  let out = ordered(filterRows(rows, args.where), args.orderBy)
  if (args.cursor) {
    const i = out.findIndex((r) => r.id === args.cursor.id)
    out = out.slice(i < 0 ? out.length : i)
  }
  out = out.slice(args.skip ?? 0)
  return (typeof args.take === 'number' ? out.slice(0, args.take) : out).map((r) => ({ ...r }))
}

let dispatchPages = 0
beforeEach(() => {
  st.claims = []; st.refunds = []; st.dispatch = []; st.fail = {}; st.onDispatchPage = null
  dispatchPages = 0
  db.emailDispatch.findMany.mockReset().mockImplementation(async (args: Row) => {
    if (st.fail.dispatch) throw new Error('db down')
    if (args.where?.trigger === 'claim_closure_record') { dispatchPages++; st.onDispatchPage?.(dispatchPages) }
    return page(st.dispatch, args)
  })
  db.claim.findMany.mockReset().mockImplementation(async (args: Row) => {
    if (st.fail.claims && args.where?.status === 'refunded') throw new Error('db down')
    return page(st.claims, args)
  })
  db.claim.groupBy.mockReset().mockImplementation(async (args: Row) => {
    const counts = new Map<string, number>()
    for (const c of filterRows(st.claims, args.where)) counts.set(c.refundId, (counts.get(c.refundId) ?? 0) + 1)
    return Array.from(counts, ([refundId, n]) => ({ refundId, _count: { _all: n } }))
  })
  db.claim.count.mockReset().mockImplementation(async (args: Row) => filterRows(st.claims, args.where).length)
  db.refund.findMany.mockReset().mockImplementation(async (args: Row) => page(st.refunds, args))
  db.order.findMany.mockReset().mockResolvedValue([])
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const DAY = 86_400_000
const T0 = Date.parse('2026-09-01T00:00:00.000Z')
let seq = 0
const claim = (id: string, o: Row = {}): Row => ({
  id, orderId: 'o1', consumerId: 'u1', restaurantId: 'r1', reason: 'wrong_item', requestedAmountCents: 500, status: 'refunded', refundAttempted: true,
  refundId: null, refundError: null, arbitrationDecision: 'approved', restaurantResponse: null, decidedAt: new Date(T0 + (seq++) * 60_000),
  createdAt: new Date(T0 - DAY + seq * 1000), activeOrderKey: null, ...o,
})
const row = (id: string, o: Row = {}): Row => ({ id, orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: `re_${id}`, reason: null, createdAt: new Date(T0), ...o })
const record = (claimId: string, at = T0 + (seq++) * 1000): Row => ({ id: `d_rec_${claimId}`, trigger: 'claim_closure_record', dedupeKey: `claim:${claimId}`, createdAt: new Date(at) })
const sent = (claimId: string, trigger: string): Row => ({ id: `d_${trigger}_${claimId}`, trigger, dedupeKey: `claim:${claimId}`, createdAt: new Date(T0) })
const REVERTED = `${MARKERS.REVERTED_AFTER_REFUND} la réclamation a été soldée sur la ligne x…`

// ══ J-C30 — listMissingClaimClosureNotices ═══════════════════════════════════════════════════════════════════════════
describe('J-C30 (H10) — listMissingClaimClosureNotices: record ∧ no same-trigger dispatch ∧ kind ≠ null', () => {
  it('each kind with and without its dispatch; another trigger does not exclude; REVERTED and a claim without record are not listed', async () => {
    st.claims = [
      claim('refunded_open', { refundId: 'rfA' }),
      claim('refunded_sent', { refundId: 'rfB' }),
      claim('confirmed_other_trigger', { status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'refused' }),
      claim('declared', { refundError: 'engine_failed: x' }),
      claim('closed_no_payment', { status: 'refused_final', arbitrationDecision: 'approved' }),
      claim('grubano_sent', { status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'accepted' }),
      claim('reverted', { refundId: 'rfC', refundError: REVERTED }),
      claim('no_record', { refundId: 'rfD' }),
    ]
    st.refunds = [row('rfA'), row('rfB'), row('rfC'), row('rfD')]
    st.dispatch = [
      ...['refunded_open', 'refunded_sent', 'confirmed_other_trigger', 'declared', 'closed_no_payment', 'grubano_sent', 'reverted'].map((id) => record(id)),
      sent('refunded_sent', 'claim_decision_refunded'),
      sent('confirmed_other_trigger', 'claim_closed_by_support'),
      sent('grubano_sent', 'claim_decision_refused_final'),
    ]
    const out = await listMissingClaimClosureNotices()
    expect(out.items.map((i) => [i.claimId, i.kind, i.blocker]).sort()).toEqual([
      ['closed_no_payment', 'closed_by_declaration', null],
      ['confirmed_other_trigger', 'refused_confirmed', null],
      ['declared', 'settled_by_declaration', null],
      ['refunded_open', 'refunded', null],
    ])
    expect(out.total).toBe(4)
    expect(out.scanTruncated).toBe(false)
  })

  it('blockers, in the sender order: two binders → ambiguous; failed with an id on the own order → failed; any other unproven row → unproven', async () => {
    st.claims = [
      claim('failed_id', { refundId: 'rf_f' }),
      claim('failed_no_id', { refundId: 'rf_fn' }),
      claim('failed_other_order', { refundId: 'rf_fo' }),
      claim('missing_row', { refundId: 'rf_gone' }),
      claim('no_refund_id', { refundId: null }),
      claim('amount_zero', { refundId: 'rf_0' }),
      claim('two_binders_a', { refundId: 'rf_2' }),
      claim('two_binders_b', { refundId: 'rf_2', status: 'refunding' }),
      claim('proven_pending', { refundId: 'rf_p' }),
    ]
    st.refunds = [
      row('rf_f', { status: 'failed' }), row('rf_fn', { status: 'failed', stripeRefundId: null }), row('rf_fo', { status: 'failed', orderId: 'o2' }),
      row('rf_0', { amountCents: 0 }), row('rf_2'), row('rf_p', { status: 'pending' }),
    ]
    st.dispatch = st.claims.filter((c) => c.status === 'refunded').map((c) => record(c.id))
    const out = await listMissingClaimClosureNotices()
    const by = Object.fromEntries(out.items.map((i) => [i.claimId, i.blocker]))
    expect(by).toEqual({
      failed_id: 'refunded_row_failed', failed_no_id: 'refunded_row_unproven', failed_other_order: 'refunded_row_unproven',
      missing_row: 'refunded_row_unproven', no_refund_id: 'refunded_row_unproven', amount_zero: 'refunded_row_unproven',
      two_binders_a: 'refunded_row_ambiguous', proven_pending: null,
    })
  })

  it('closureNoticeBlocker (pure): NEGATIVE CONTROL — a single-binder proven row has no blocker; the spec’s status-only rule would call the other-order failed row « failed »', () => {
    expect(closureNoticeBlocker({ orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_1' }, 1, 'o1')).toBeNull()
    expect(closureNoticeBlocker({ orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_1' }, 2, 'o1')).toBe('refunded_row_ambiguous')
    expect(closureNoticeBlocker({ orderId: 'o2', status: 'failed', amountCents: 500, stripeRefundId: 're_1' }, 1, 'o1')).toBe('refunded_row_unproven')
    const statusOnly = (r: { status: string }) => (r.status === 'failed' ? 'refunded_row_failed' : null)
    expect(statusOnly({ status: 'failed' })).toBe('refunded_row_failed') // ← the ER-C22 divergence the rule closes
  })

  // W7 fixer (H10 / ER-C22): the blocker VALUE follows the section that lists the claim, but it is non-null exactly when the
  // sender refuses at H06 step 6. The sender's three lines are pinned from lib/claim-emails.ts and restated as a predicate.
  it('step-6 parity: closureNoticeBlocker is non-null exactly when the sender refuses at step 6 (source-pinned predicate)', () => {
    const sender = readFileSync('lib/claim-emails.ts', 'utf8').replace(/\r\n/g, '\n')
    for (const line of [
      "if (binders >= 2) return await skip('refunded_row_unproven')",
      "if (row && row.status === 'failed') return await skip('refunded_row_failed')",
      "if (!row || !refundedRowProven(row, c.orderId)) return await skip('refunded_row_unproven')",
    ]) expect(sender, line).toContain(line)
    const senderRefuses = (r: Row | null, b: number, o: string) => b >= 2 || (!!r && r.status === 'failed') || !r || !refundedRowProven(r, o)
    const rows: Array<Row | null> = [null]
    for (const status of ['succeeded', 'pending', 'failed', 'canceled']) for (const orderId of ['o1', 'o2']) for (const amountCents of [500, 0]) for (const stripeRefundId of ['re_1', null]) rows.push({ orderId, status, amountCents, stripeRefundId })
    for (const r of rows) for (const b of [0, 1, 2]) {
      expect(closureNoticeBlocker(r, b, 'o1') !== null, JSON.stringify({ r, b })).toBe(senderRefuses(r, b, 'o1'))
    }
    // the value differs from the sender's why for a failed row without an id, or on another order (both block)
    expect(closureNoticeBlocker({ orderId: 'o1', status: 'failed', amountCents: 500, stripeRefundId: null }, 1, 'o1')).toBe('refunded_row_unproven')
    expect(closureNoticeBlocker({ orderId: 'o2', status: 'failed', amountCents: 500, stripeRefundId: 're_1' }, 1, 'o1')).toBe('refunded_row_unproven')
    // NEGATIVE CONTROL: a blocker that ignored the binder count would be null where the sender refuses
    const noBinders = (r: Row | null, o: string) => closureNoticeBlocker(r, 0, o)
    expect(noBinders({ orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_1' }, 'o1')).toBeNull()
    expect(senderRefuses({ orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_1' }, 2, 'o1')).toBe(true)
  })

  it('paging is stable under an insert between pages: every record is scanned exactly once', async () => {
    for (let i = 0; i < 1200; i++) {
      const id = `c${String(i).padStart(5, '0')}`
      st.claims.push(claim(id, { status: 'refused_final', arbitrationDecision: 'approved' }))
      st.dispatch.push(record(id, T0 + i * 1000))
    }
    // a newer closure is recorded after page 1 was read, before page 2 is
    st.onDispatchPage = (n) => {
      if (n === 2) {
        st.claims.push(claim('inserted', { status: 'refused_final', arbitrationDecision: 'approved' }))
        st.dispatch.push(record('inserted', T0 + 99_999_999))
      }
    }
    const findManyCalls = () => db.claim.findMany.mock.calls.map((c) => (c[0] as Row).where?.id?.in as string[]).filter(Boolean)
    const out = await listMissingClaimClosureNotices()
    const scannedIds = findManyCalls().flat()
    expect(new Set(scannedIds).size).toBe(scannedIds.length) // no record scanned twice
    expect(scannedIds).toHaveLength(1200)
    expect(scannedIds).not.toContain('inserted') // newer than the cursor: the next load lists it
    expect(out.total).toBe(1200)
    expect(dispatchPages).toBe(3)
  })

  it('5001 records → scanTruncated, 5000 scanned; items ≤ 200 in decidedAt desc (NEGATIVE CONTROL: exactly 5000 → not truncated)', async () => {
    const fill = (n: number) => {
      st.claims = []; st.dispatch = []
      for (let i = 0; i < n; i++) {
        const id = `k${String(i).padStart(5, '0')}`
        st.claims.push(claim(id, { status: 'refused_final', arbitrationDecision: 'approved', decidedAt: new Date(T0 + ((i * 7919) % n) * 1000) }))
        st.dispatch.push(record(id, T0 + i * 1000))
      }
    }
    fill(5001)
    let out = await listMissingClaimClosureNotices()
    expect(out.scanTruncated).toBe(true)
    expect(out.total).toBe(CLOSURE_SCAN_CAP)
    expect(out.items).toHaveLength(200)
    const times = out.items.map((i) => new Date(i.decidedAt as Date).getTime())
    expect(times).toEqual([...times].sort((a, b) => b - a))
    fill(5000)
    out = await listMissingClaimClosureNotices()
    expect(out.scanTruncated).toBe(false)
    expect(out.total).toBe(5000)
  })

  it('census parity (H16): claims.closure.missing counts the same population as the list on one fixture', async () => {
    st.claims = [claim('a', { refundId: 'rfA' }), claim('b', { status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'refused' }), claim('c', { refundId: 'rfC' })]
    st.refunds = [row('rfA'), row('rfC')]
    st.dispatch = [record('a'), record('b'), sent('b', 'claim_decision_refused_final'), record('c')]
    const out = await listMissingClaimClosureNotices()
    expect((await claimsClosureCensus()).missing).toBe(out.total)
    expect(out.total).toBe(2)
  })
})

// ══ J-M38 — « listed in closureNotices » (the W6 note's console half) ═══════════════════════════════════════════════
describe('J-M38 (H05, D10, E-16, E-18) — eligibility is the closure record only', () => {
  it('a legacy closure with a HEAD audit row and no record → not listed; a C7-observed or webhook closure with its record → listed', async () => {
    st.claims = [
      claim('legacy_with_audit', { refundId: 'rfL' }), // AdminAuditLog rows are not read at all by the list
      claim('c7_reread', { refundId: 'rfC7' }),
      claim('webhook_settled', { refundId: 'rfW' }),
    ]
    st.refunds = [row('rfL'), row('rfC7'), row('rfW')]
    st.dispatch = [record('c7_reread'), record('webhook_settled')]
    const out = await listMissingClaimClosureNotices()
    expect(out.items.map((i) => i.claimId).sort()).toEqual(['c7_reread', 'webhook_settled'])
    expect((await claimsClosureCensus()).terminalWithoutRecord).toBe(1)
  })
})

// ══ J-C30 — listRefundedClaimsWithUnprovenRow (E-13) ═════════════════════════════════════════════════════════════════
describe('J-C30 (H10, E-13) — listRefundedClaimsWithUnprovenRow', () => {
  const arrange = () => {
    st.claims = [
      claim('no_refund_id', { refundId: null }),
      claim('row_missing', { refundId: 'rf_gone' }),
      claim('other_order', { refundId: 'rf_oo' }),
      claim('amount_zero', { refundId: 'rf_0' }),
      claim('failed_no_id', { refundId: 'rf_fn' }),
      claim('canceled_status', { refundId: 'rf_cx' }),
      // excluded
      claim('failed_with_id', { refundId: 'rf_f' }),
      claim('succeeded', { refundId: 'rf_s' }),
      claim('pending', { refundId: 'rf_p' }),
      claim('declared', { refundId: 'rf_d', refundError: 'engine_failed: x' }),
      claim('reverted', { refundId: 'rf_r', refundError: REVERTED }),
      claim('two_binders_a', { refundId: 'rf_2', status: 'refunded' }),
      claim('two_binders_b', { refundId: 'rf_2', status: 'refunded' }),
      claim('approved_unpaid', { status: 'approved', refundAttempted: false }),
    ]
    st.refunds = [
      row('rf_oo', { orderId: 'o2' }), row('rf_0', { amountCents: 0 }), row('rf_fn', { status: 'failed', stripeRefundId: null }), row('rf_cx', { status: 'canceled' }),
      row('rf_f', { status: 'failed' }), row('rf_s'), row('rf_p', { status: 'pending' }), row('rf_d', { status: 'failed' }), row('rf_r'), row('rf_2', { amountCents: 0 }),
    ]
  }

  it('lists the E-13 shapes; excludes failed-with-id (A-S31c), succeeded, pending, refundError set, REVERTED and a row with two binders', async () => {
    arrange()
    const out = await listRefundedClaimsWithUnprovenRow()
    expect(out.items.map((c) => c.id).sort()).toEqual(['amount_zero', 'canceled_status', 'failed_no_id', 'no_refund_id', 'other_order', 'row_missing'])
    expect(out).toMatchObject({ total: 6, scanTruncated: false })
  })

  // W7 fixer (H10 paging): an id cursor, not an offset — a claim that leaves {refunded, refundError null} between two pages
  // (an R0 marking, a declaration) no longer shifts the next page over a claim that is still in the set.
  it('paging follows an id cursor: a claim leaving the set between pages never hides a later claim (NEGATIVE CONTROL: the offset read misses it)', async () => {
    for (let i = 0; i < 700; i++) st.claims.push(claim(`p${String(i).padStart(4, '0')}`, { refundId: null, createdAt: new Date(T0 + i * 1000) }))
    const target = 'p0500' // the first claim of page 2 in createdAt order
    let pages = 0
    const real = db.claim.findMany.getMockImplementation()!
    const offsetRead = async (skip: number) => page(st.claims, { where: { status: 'refunded', refundError: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], skip, take: 500 })
    db.claim.findMany.mockImplementation(async (args: Row) => {
      const out = await real(args)
      if (args.where?.status === 'refunded' && ++pages === 1) {
        // after page 1 was read, an early claim is marked (it leaves the set)
        Object.assign(st.claims.find((c) => c.id === 'p0003')!, { refundError: `${MARKERS.REVERTED_AFTER_REFUND} x` })
      }
      return out
    })
    const out = await listRefundedClaimsWithUnprovenRow()
    expect(out.items.length).toBe(200)
    expect(out.total).toBe(700)
    expect(db.claim.findMany.mock.calls.filter((c) => (c[0] as Row).where?.status === 'refunded').map((c) => (c[0] as Row).cursor?.id ?? null)).toEqual([null, 'p0499'])
    // every claim still in the set after page 1 was scanned — p0500 included
    expect(pages).toBe(2)
    const secondPage = await real({ where: { status: 'refunded', refundError: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], cursor: { id: 'p0499' }, skip: 1, take: 500 })
    expect(secondPage[0].id).toBe(target)
    // NEGATIVE CONTROL: the round-1 offset read (skip 500) of the same set now starts one claim later and never sees p0500
    expect((await offsetRead(500)).map((c) => c.id)).not.toContain(target)
  })

  it('reconcilable === (reconcileRefusal(claim facts + bound row) === null)', async () => {
    arrange()
    const out = await listRefundedClaimsWithUnprovenRow()
    for (const c of out.items) {
      const boundRow: BoundRowFacts | null = c.refund ? { id: c.refund.id, orderId: c.refund.orderId, status: c.refund.status, stripeRefundId: c.refund.stripeRefundId, reason: c.refund.reason } : null
      expect(c.reconcilable, c.id).toBe(reconcileRefusal({ ...c, boundRow }) === null)
    }
    // same-order row with an unusable amount: R0 reads it; a missing or other-order row: no action exists
    expect(Object.fromEntries(out.items.map((c) => [c.id, c.reconcilable]))).toEqual({
      no_refund_id: false, row_missing: false, other_order: false, amount_zero: true, failed_no_id: false, canceled_status: false,
    })
  })

  it('E-07 / E-13 disjoint: the A-S31c claim is in listActionableRefundClaims, never here (NEGATIVE CONTROL: including failed-with-id rows breaks it)', async () => {
    arrange()
    const unproven = (await listRefundedClaimsWithUnprovenRow()).items.map((c) => c.id)
    const actionable = (await listActionableRefundClaims()).map((c) => c.id)
    expect(actionable).toContain('failed_with_id')
    expect(unproven.filter((id) => actionable.includes(id))).toEqual([])
    const mutant = [...unproven, 'failed_with_id']
    expect(mutant.filter((id) => actionable.includes(id))).toEqual(['failed_with_id'])
  })
})

// ══ J-C30 — the financial-verification route ═════════════════════════════════════════════════════════════════════════
describe('J-C30 (I-09) — GET /api/admin/claims/financial-verification carries both lists, each in its own catch', () => {
  it('both lists read: counts outside total; no revertedAfterRefund key', async () => {
    st.claims = [claim('e13', { refundId: null }), claim('notice', { status: 'refused_final', arbitrationDecision: 'approved' })]
    st.dispatch = [record('notice')]
    const body = await (await FV_ROUTE()).json()
    expect(body.refundedUnproven).toMatchObject({ total: 1, scanTruncated: false })
    expect(body.closureNotices).toMatchObject({ total: 1, scanTruncated: false })
    expect(body.counts).toMatchObject({ total: 0, refundedUnproven: 1, closureNoticesMissing: 1 })
    expect(JSON.stringify(body)).not.toContain('revertedAfterRefund')
  })

  it('a list rejection → 200, the money lists intact, { error: unreadable } and a null count', async () => {
    st.claims = [claim('money', { status: 'approved', refundAttempted: true, refundError: 'engine_failed: x' })]
    st.fail.dispatch = true
    let res = await FV_ROUTE()
    expect(res.status).toBe(200)
    let body = await res.json()
    expect(body.otherUnsettled.map((c: Row) => c.id)).toEqual(['money'])
    expect(body.closureNotices).toEqual({ error: 'unreadable' })
    expect(body.counts).toMatchObject({ total: 1, closureNoticesMissing: null, refundedUnproven: 0 })
    st.fail = { claims: true }
    res = await FV_ROUTE()
    body = await res.json()
    expect(res.status).toBe(200)
    expect(body.refundedUnproven).toEqual({ error: 'unreadable' })
    expect(body.counts.refundedUnproven).toBeNull()
  })

  it('source pin (BREAK/RESTORE of J-C30): the two lists run after the money Promise.all, each with its own catch', () => {
    const src = readFileSync('app/api/admin/claims/financial-verification/route.ts', 'utf8').replace(/\r\n/g, '\n')
    const money = src.indexOf('await Promise.all([\n    listFinancialVerificationClaims(),')
    const moneyEnd = src.indexOf('])', money)
    const unproven = src.indexOf('listRefundedClaimsWithUnprovenRow().catch(')
    const notices = src.indexOf('listMissingClaimClosureNotices().catch(')
    expect(money).toBeGreaterThan(0)
    expect(unproven).toBeGreaterThan(moneyEnd)
    expect(notices).toBeGreaterThan(moneyEnd)
    // NEGATIVE CONTROL: the lists moved inside the money Promise.all (the break) no longer satisfy the pin.
    const broken = src.replace('    listUnfinalizedClaimRefundRows(),\n  ])', '    listUnfinalizedClaimRefundRows(),\n    listRefundedClaimsWithUnprovenRow(),\n  ])')
    expect(broken).not.toBe(src)
    expect(broken.indexOf('listRefundedClaimsWithUnprovenRow()')).toBeLessThan(broken.indexOf('])', broken.indexOf('await Promise.all([\n    listFinancialVerificationClaims(),')))
  })
})
