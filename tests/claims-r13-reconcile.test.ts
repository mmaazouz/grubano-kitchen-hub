// tests/claims-r13-reconcile.test.ts — T-49 round 13, slice W2: J-M43 (G3 loadOrderMoneyFacts, C3 (b)(e') parity).
//
// ONE read-only loader feeds the pure derivation. It never throws (any throw is transient), never writes, and
// hands T2 exactly the facts the pure path derives from. The reconcile half of the parity (reconcileClaimEvidence
// N0-N8) lands with the reconcile slice; here the pure path on the same loader output stands for it.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { payableWorld, wireWorld, refundRow, stripeRefund, claimOf, engineOk, HOURS, type World } from './support/claims-world'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn(async () => ({ status: 'sent' })) }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn() }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { readFileSync } from 'node:fs'
import { loadOrderMoneyFacts, triggerClaimRefund, reconcileClaimEvidence } from '@/lib/claims'
import { deriveNoRowOutcome, absenceProofText, reapprovalSafetyHolds, proofInstant, MARKERS, type OrderMoneyRead } from '@/lib/claim-action-rules'

let w: World
beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [execMock, refundsFlag]) m.mockReset()
  refundsFlag.mockReturnValue(true)
  execMock.mockResolvedValue(engineOk())
  w = payableWorld()
  wireWorld(w, db, stripeMock)
})
const load = () => loadOrderMoneyFacts('o1', 'cl1', 500)

const FACT_KEYS = [
  'orderId', 'requestedAmountCents', 'orderPaymentStatus', 'hasPaymentIntent', 'piStatus', 'chargeId', 'chargeAmountCents', 'amountCapturedCents',
  'chargeDisputed', 'amountRefundedCents', 'routed', 'royaltyStatus', 'stripeListLength', 'rows', 'L', 'truths', 'binders', 'stampedClaims',
  'succeededNotCounted', 'rowContradictions',
]

describe('J-M43 — loadOrderMoneyFacts never throws, and says why facts are unreadable', () => {
  it('every failed read → { readable: false, permanent: null } (order, rows, royalty, PI, list, a row truth)', async () => {
    const FAILS: Array<[string, (x: World) => void]> = [
      ['order read throws', (x) => { x.fail.orderFindUnique = true }],
      ['rows read throws', (x) => { x.fail.refundFindMany = true }],
      ['royalty read throws', (x) => { x.fail.royaltyFindFirst = true }],
      ['PI unreadable', (x) => { x.fail.piRetrieve = true }],
      ['list null', (x) => { x.fail.refundList = true }],
      ['one row truth unreadable', (x) => { x.refunds.push(refundRow('rf_S', { stripeRefundId: 're_S' })); x.fail.refundRetrieve = { re_S: 'throw' } }],
      ['a binder read throws', (x) => { x.refunds.push(refundRow('rf_S', { stripeRefundId: 're_S' })); x.stripeRefunds.push(stripeRefund('re_S')); x.fail.claimFindMany = true }],
    ]
    for (const [name, fail] of FAILS) {
      w = payableWorld()
      fail(w)
      wireWorld(w, db, stripeMock)
      const r = await load()
      expect(r.readable, name).toBe(false)
      expect((r as { permanent: unknown }).permanent, name).toBeNull()
    }
  })

  it('a list over the page cap → permanent list_over_cap; no charge → permanent no_charge with the rows; no PaymentIntent → no_charge, hasPaymentIntent false', async () => {
    w.fail.listOverCap = true
    expect(await load()).toMatchObject({ readable: false, permanent: 'list_over_cap', refundedCents: 0 })
    w.fail.listOverCap = false
    w.pis.pi_1.latest_charge = null
    w.refunds.push(refundRow('rf_F', { status: 'failed', stripeRefundId: 're_F' }))
    const nc = await load()
    expect(nc).toMatchObject({ readable: false, permanent: 'no_charge', paymentStatus: 'paid', piStatus: 'succeeded', hasPaymentIntent: true })
    expect((nc as { rows: Array<{ id: string }> }).rows.map((r) => r.id)).toEqual(['rf_F'])
    w.orders[0].stripePaymentIntentId = null
    expect(await load()).toMatchObject({ readable: false, permanent: 'no_charge', hasPaymentIntent: false })
  })

  it('the ReapprovalFacts shape: exactly the G3 fields, no ownStampedRowIds; 0 Stripe write calls', async () => {
    const r = await load()
    expect(r.readable).toBe(true)
    const f = (r as Extract<OrderMoneyRead, { readable: true }>).facts
    expect(Object.keys(f).sort()).toEqual([...FACT_KEYS].sort())
    expect(f).not.toHaveProperty('ownStampedRowIds')
    expect(f).toMatchObject({ orderPaymentStatus: 'paid', piStatus: 'succeeded', chargeId: 'ch_1', chargeAmountCents: 2000, amountCapturedCents: 2000, amountRefundedCents: 0, routed: false, chargeDisputed: false, stripeListLength: 0 })
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('a reverted succeeded row → succeededNotCounted reverted; a 404 omitted from the list → absent; another payment → other_payment', async () => {
    w.refunds.push(
      refundRow('rf_R', { stripeRefundId: 're_R' }),
      refundRow('rf_A', { stripeRefundId: 're_A' }),
      refundRow('rf_P', { stripeRefundId: 're_P' }),
    )
    w.stripeRefunds.push(stripeRefund('re_R', { status: 'canceled' }), stripeRefund('re_P', { payment_intent: 'pi_OTHER' }))
    w.fail.refundRetrieve = { re_A: 'missing' }
    const f = ((await load()) as Extract<OrderMoneyRead, { readable: true }>).facts
    expect(f.succeededNotCounted).toEqual([
      { rowId: 'rf_R', how: 'reverted', refundId: 're_R', stripeStatus: 'canceled' },
      { rowId: 'rf_A', how: 'absent', refundId: 're_A' },
      { rowId: 'rf_P', how: 'other_payment', refundId: 're_P' },
    ])
  })

  it('ownerless failed refunds: only a ZERO-owner failed refund holds a routed payment (H2)', async () => {
    w.pis.pi_1.transfer_data = { destination: 'acct_1' }
    w.refunds.push(refundRow('rf_F', { status: 'failed', stripeRefundId: 're_owned' }))
    w.stripeRefunds.push(stripeRefund('re_owned', { status: 'failed' }), stripeRefund('re_orphan', { status: 'failed' }))
    const f = ((await load()) as Extract<OrderMoneyRead, { readable: true }>).facts
    expect(reapprovalSafetyHolds(f).filter((h) => h.hold === 'H2')).toEqual([{ hold: 'H2', refundId: 're_orphan', status: 'failed' }])
  })

  it('binders and stamped claims are read for single-owner standing refunds only', async () => {
    w.refunds.push(refundRow('rf_X', { stripeRefundId: 're_X', reason: 'claim:cl_Y' }))
    w.stripeRefunds.push(stripeRefund('re_X'))
    w.pis.pi_1.latest_charge.amount_refunded = 300
    w.claims.push({ id: 'cl_Y', orderId: 'o1', status: 'refused_final', refundId: 'rf_other', refundError: null })
    const f = ((await load()) as Extract<OrderMoneyRead, { readable: true }>).facts
    expect(f.binders).toEqual({ rf_X: [] })
    expect(f.stampedClaims).toEqual({ cl_Y: { ...w.claims[1] } })
  })
})

describe('J-M43 — T2 and the pure derivation reach the same outcome on the same facts', () => {
  const FIXTURES: Array<[string, (x: World) => void]> = [
    ['A-S30e-1 dead lock', (x) => { x.refunds.push(refundRow('rf_D', { status: 'pending', reason: 'claim:cl_O', createdAt: new Date(Date.now() - 30 * HOURS) })) }],
    ['A-S30e-2 AWAITING', (x) => {
      x.refunds.push(refundRow('rf_A', { status: 'pending', stripeRefundId: 're_A', reason: 'claim:cl_A' }))
      x.stripeRefunds.push(stripeRefund('re_A', { metadata: { grubano_refund_row: 'rf_A' } }))
      x.pis.pi_1.latest_charge.amount_refunded = 300
      x.claims.push({ id: 'cl_A', orderId: 'o1', status: 'refunded', refundId: 'rf_A', refundError: null })
    }],
    ['E6 lock', (x) => { x.refunds.push(refundRow('rf_K', { status: 'failed', idempotencyKey: 'refund:o1:0' })) }],
    ['A-S38-1 N5 park', (x) => { x.stripeRefunds.push(stripeRefund('re_D')); x.pis.pi_1.latest_charge.amount_refunded = 300 }],
  ]

  for (const [name, mutate] of FIXTURES) {
    it(name, async () => {
      mutate(w)
      const read = await load()
      const pure = deriveNoRowOutcome(read, 'cl1')
      await triggerClaimRefund('cl1')
      const written = String(claimOf(w).refundError)
      expect(execMock).not.toHaveBeenCalled()
      if (pure.kind === 'park') {
        expect(written).toBe(`financial_verification:${pure.reason}: ${pure.detail}`)
      } else {
        expect(pure.kind).toBe('proof')
        const expected = absenceProofText(pure as Extract<typeof pure, { kind: 'proof' }>, read, { preImage: null, now: new Date(), requestedAmountCents: 500 })
        expect(written).toBe(expected)
      }
    })
  }

  it('a payable proof on both paths: the pure verdict is v13, and T2 calls the engine (writes no proof)', async () => {
    const pure = deriveNoRowOutcome(await load(), 'cl1')
    expect(pure).toMatchObject({ kind: 'proof', prefix: MARKERS.PROOF_PAYABLE_V13 })
    await triggerClaimRefund('cl1')
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  it('NEGATIVE CONTROL — the parity assertion can fail: facts with one cause removed derive a different text', async () => {
    FIXTURES[0][1](w)
    const read = (await load()) as Extract<OrderMoneyRead, { readable: true }>
    await triggerClaimRefund('cl1')
    const altered: OrderMoneyRead = { readable: true, facts: { ...read.facts, rows: [], truths: {}, rowContradictions: [], chargeDisputed: true } }
    const other = deriveNoRowOutcome(altered, 'cl1')
    const text = other.kind === 'proof' ? absenceProofText(other, altered, { preImage: null, now: new Date(), requestedAmountCents: 500 }) : other.kind
    expect(text).not.toBe(String(claimOf(w).refundError))
  })
})

// ══ D4 / G8 (W2 round-1 fix) — the pre-images T2 writes are re-derived by reconcile on the SAME loader ════════
// T2 writes LOCKED / AWAITING / SAFETY_HOLD texts whose tails say « Réconcilier d’après la preuve » réévalue toutes les
// conditions. That is true only if reconcile derives those pre-images through loadOrderMoneyFacts + deriveNoRowOutcome
// and writes N8 — never the round-12 ladder, whose legacy proof no approval accepts (absorbing).
const readSrc = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripSrcComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
function g8InterimViolations(src: string): string[] {
  const body = (head: string) => {
    const a = src.indexOf(head)
    return a < 0 ? '' : src.slice(a, src.indexOf('\n}\n', a))
  }
  const t2 = body('export async function triggerClaimRefund(')
  if (!/\babsenceProofText\(|\bsafetyHoldText\(/.test(t2)) return []
  const out: string[] = []
  const rec = body('export async function reconcileClaimEvidence(')
  const dispatch = rec.indexOf('reconcileNoRowByDerivation(')
  const ladder = rec.indexOf('NO_REFUND_PROVEN}:')
  if (dispatch < 0) out.push('reconcileClaimEvidence does not dispatch the (i)/(i-b) pre-images to the derivation')
  else if (ladder >= 0 && dispatch > ladder) out.push('the derivation dispatch comes after the round-12 ladder write')
  const derived = body('async function reconcileNoRowByDerivation(')
  for (const needle of ['loadOrderMoneyFacts(', 'deriveNoRowOutcome(', 'absenceProofText(']) {
    if (!derived.includes(needle)) out.push(`reconcileNoRowByDerivation does not call ${needle}`)
  }
  return out
}

describe('D4 / G8 — RELEASE GATE: T2 writes lock and hold texts only while reconcile re-derives them (W2 round-1 fix)', () => {
  it('the shipped tree has no violation', () => {
    expect(g8InterimViolations(stripSrcComments(readSrc('lib/claims.ts')))).toEqual([])
  })

  it('NEGATIVE CONTROL — without the dispatch, or with a derivation that skips the loader, the gate is red', () => {
    const src = stripSrcComments(readSrc('lib/claims.ts'))
    const noDispatch = src.replace('if (isDerivedNoRowPreImage(claim)) return reconcileNoRowByDerivation(claim, stripeCache)', '')
    expect(noDispatch).not.toBe(src)
    expect(g8InterimViolations(noDispatch)).toEqual(['reconcileClaimEvidence does not dispatch the (i)/(i-b) pre-images to the derivation'])
    const noLoader = src.replace('const read = await loadOrderMoneyFacts(claim.orderId, claim.id, claim.requestedAmountCents, cache)', 'const read = null as never')
    expect(noLoader).not.toBe(src)
    expect(g8InterimViolations(noLoader)).toEqual(['reconcileNoRowByDerivation does not call loadOrderMoneyFacts('])
  })

  const HOLD = `${MARKERS.SAFETY_HOLD} Aucun remboursement n’a été lancé pour cette réclamation : x Décision humaine requise ; « Clôturer ce dossier… » enregistre votre déclaration.`

  it('a SAFETY_HOLD with nothing at Stripe → a v13 proof with its instant, refundAttempted false — never the legacy « no_refund_proven: » text', async () => {
    w = payableWorld({ status: 'approved', refundAttempted: true, refundError: HOLD })
    wireWorld(w, db, stripeMock)
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    const c = claimOf(w)
    expect(String(c.refundError).startsWith(`${MARKERS.PROOF_PAYABLE_V13} `)).toBe(true)
    expect(c).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
    expect(r).toEqual({ ok: true, outcome: 'no_refund_proven', payableFrom: proofInstant(String(c.refundError))!.toISOString() })
    expect(execMock).not.toHaveBeenCalled()
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })

  const PARITY: Array<[string, (x: World) => void, string]> = [
    ['A-S30e-1 dead lock', (x) => { x.refunds.push(refundRow('rf_D', { status: 'pending', reason: 'claim:cl_O', createdAt: new Date(Date.now() - 30 * HOURS) })) }, 'no_refund_proven_rail_locked'],
    ['A-S30e-2 AWAITING', (x) => {
      x.refunds.push(refundRow('rf_A', { status: 'pending', stripeRefundId: 're_A', reason: 'claim:cl_A' }))
      x.stripeRefunds.push(stripeRefund('re_A', { metadata: { grubano_refund_row: 'rf_A' } }))
      x.pis.pi_1.latest_charge.amount_refunded = 300
      x.claims.push({ id: 'cl_A', orderId: 'o1', status: 'refunded', refundId: 'rf_A', refundError: null })
    }, 'no_refund_proven_awaiting_finalization'],
    ['A-S38-1 N5 park', (x) => { x.stripeRefunds.push(stripeRefund('re_D')); x.pis.pi_1.latest_charge.amount_refunded = 300 }, 'financial_verification'],
    ['H5 disputed lock', (x) => { x.pis.pi_1.latest_charge.disputed = true }, 'no_refund_proven_rail_locked'],
  ]
  for (const [name, mutate, outcome] of PARITY) {
    it(`J-M43 reconcile half — ${name}: reconcile on a lock pre-image writes exactly what T2 writes on a null pre-image`, async () => {
      // T2 on a null pre-image
      w = payableWorld()
      mutate(w)
      wireWorld(w, db, stripeMock)
      await triggerClaimRefund('cl1')
      const t2Text = String(claimOf(w).refundError)
      // reconcile on the lock pre-image T2 would have left (an admitted (i) shape)
      w = payableWorld({ status: 'approved', refundAttempted: false, refundError: 'no_refund_proven_rail_locked: écrit avant' })
      mutate(w)
      wireWorld(w, db, stripeMock)
      const r = await reconcileClaimEvidence({ claimId: 'cl1' })
      expect(r.ok && r.outcome, name).toBe(outcome)
      const recText = String(claimOf(w).refundError)
      // H5 disputed is a T2 (c) SAFETY_HOLD on the T2 path; on reconcile it is the N8 lock naming the same hold sentence.
      if (name.startsWith('H5')) expect(recText).toContain('Stripe rapporte un litige sur la charge ch_1 de ce paiement')
      else expect(recText, name).toBe(t2Text)
      expect(execMock).not.toHaveBeenCalled()
    })
  }
})
