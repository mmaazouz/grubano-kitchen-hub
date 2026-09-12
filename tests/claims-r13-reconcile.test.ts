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
    emailDispatch: { create: vi.fn() },
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

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { loadOrderMoneyFacts, triggerClaimRefund, reconcileClaimEvidence } from '@/lib/claims'
import {
  deriveNoRowOutcome, absenceProofText, reapprovalSafetyHolds, proofInstant, MARKERS, holdSentence, arbitrationRefusal, isStuckResolvable, acceptedExits,
  type OrderMoneyRead,
} from '@/lib/claim-action-rules'
import { sendAdminMoneyReviewAlert } from '@/lib/admin-alerts'
import { STATES, stateOf } from './fixtures/claims-r13-states'

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
    // ROUND 13 (G2 (3), W3): every no-row pre-image is dispatched to the derivation (the (i)/(i-b) filter is gone).
    const noDispatch = src.replace('return reconcileNoRowByDerivation(claim, stripeCache)', '')
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

// ══ W3 — J-M43 over EVERY J-M01 no-row state: reconcile (N0-N8) and T2 (e') derive the same outcome ═══════════
const PRE = 'no_refund_proven_rail_locked: écrit avant'
const INSTANT = /payable au plus tôt le \S+ \(UTC\)/
const alertSpy = sendAdminMoneyReviewAlert as unknown as ReturnType<typeof vi.fn>
const worldOf = (id: string, claim: Record<string, unknown> = {}) => {
  const x = payableWorld(claim)
  stateOf(id).world!(x as never)
  wireWorld(x, db, stripeMock)
  return x
}

describe('J-M43 (W3) — reconcile and T2 on every no-row state of the J-M01 table', () => {
  // W3 round-1 fix: an EXPLICIT list, never the self-defining « states that carry reconcile facts ». It is the union of
  // D4 REACHED FROM, the no-row ids of D6 EVIDENCE / TIME EXITS (A-S05c-2a included), and the A rows whose
  // RECONCILIATION runs N0-N8 (A-S05b-2 unstamped, A-S09a/b, A-S12/b, A-S13a/b, A-S14a-*, A-S17-A-S20, A-S29-1/2,
  // A-S30e-3, A-S37, A-S40). Dropping a state's reconcile facts turns the first test red.
  const NO_ROW_IDS = [
    'A-S01', 'A-S01b', 'A-S02', 'A-S03', 'A-S04', 'A-S05a-1', 'A-S05a-2', 'A-S05b-2', 'A-S05c-2a', 'A-S06a', 'A-S07', 'A-S08a', 'A-S08b',
    'A-S09a', 'A-S09b', 'A-S10b', 'A-S10c', 'A-S11', 'A-S12', 'A-S12b', 'A-S13a', 'A-S13b', 'A-S14a-1', 'A-S14a-2a', 'A-S14a-2b', 'A-S14b',
    'A-S17', 'A-S18', 'A-S19', 'A-S20', 'A-S26', 'A-S29-1', 'A-S29-2', 'A-S30', 'A-S30c-1', 'A-S30c-2', 'A-S30e-1', 'A-S30e-2', 'A-S30e-3',
    'A-S30e-4', 'A-S30g', 'A-S32-1', 'A-S32-2', 'A-S37', 'A-S38-1', 'A-S38-2', 'A-S39', 'A-S40',
  ]
  const D4_REACHED_FROM = [
    'A-S01', 'A-S01b', 'A-S02', 'A-S03', 'A-S04', 'A-S05a-1', 'A-S05a-2', 'A-S06a', 'A-S07', 'A-S08a', 'A-S08b', 'A-S10b', 'A-S10c', 'A-S11',
    'A-S14b', 'A-S26', 'A-S30', 'A-S30c-1', 'A-S30c-2', 'A-S30e-1', 'A-S30e-2', 'A-S30g', 'A-S32-1', 'A-S32-2', 'A-S38-1', 'A-S38-2', 'A-S39',
  ]
  const NO_ROW = NO_ROW_IDS.map((id) => stateOf(id))
  it('every named no-row state carries reconcile facts; D4 REACHED FROM is inside the list', () => {
    expect(NO_ROW_IDS.filter((id) => !stateOf(id).reconcile)).toEqual([])
    expect(D4_REACHED_FROM.filter((id) => !NO_ROW_IDS.includes(id))).toEqual([])
    // the table has no other state with reconcile facts (a new one must be named here)
    expect(STATES.filter((s) => s.reconcile).map((s) => s.id).filter((id) => !NO_ROW_IDS.includes(id))).toEqual([])
  })

  for (const s of NO_ROW) {
    it(`${s.id} → ${s.reconcile!.outcome}${s.reconcile!.reason ? ` (${s.reconcile!.reason})` : ''}`, async () => {
      // the pure derivation on the loader's facts
      w = worldOf(s.id)
      const read = await load()
      const o = deriveNoRowOutcome(read, 'cl1')
      // reconcile on an admitted lock pre-image
      w = worldOf(s.id, { refundError: PRE })
      const rec = await reconcileClaimEvidence({ claimId: 'cl1' })
      expect(rec.ok && rec.outcome).toBe(s.reconcile!.outcome)
      if (s.reconcile!.reason) expect((rec as { reason?: string }).reason).toBe(s.reconcile!.reason)
      const recText = String(claimOf(w).refundError)
      for (const c of s.reconcile!.contains ?? []) expect(recText, s.id).toContain(c)
      expect(execMock).not.toHaveBeenCalled()
      // reconcile writes exactly the derivation's outcome (text body, the instant excluded)
      if (o.kind === 'proof') {
        expect(recText.replace(INSTANT, '')).toBe(absenceProofText(o, read, { preImage: PRE, now: new Date(), requestedAmountCents: 500 }).replace(INSTANT, ''))
      } else if (o.kind === 'park') {
        expect(recText).toBe(`financial_verification:${o.reason}: ${o.detail}`)
      } else {
        expect(recText).toBe(PRE)
      }
      // T2 (e') on a null pre-image, same facts
      w = worldOf(s.id)
      execMock.mockClear()
      await triggerClaimRefund('cl1')
      const t2 = claimOf(w)
      const t2Text = String(t2.refundError)
      const holds = read.readable ? reapprovalSafetyHolds(read.facts) : []
      if (!read.readable && read.permanent !== null) {
        // (b') a permanent unreadability is a SAFETY_HOLD at T2; reconcile wrote the G6 lock or the N1 park
        expect(t2Text.startsWith(MARKERS.SAFETY_HOLD), s.id).toBe(true)
      } else if (holds.length) {
        // (c) the holds stop T2 before (e'); reconcile names the same hold sentences in its lock or park
        expect(t2Text.startsWith(MARKERS.SAFETY_HOLD), s.id).toBe(true)
        for (const h of holds) expect(t2Text).toContain(holdSentence(h))
        if (o.kind === 'proof') for (const h of holds) expect(recText).toContain(holdSentence(h))
      } else if (o.kind === 'proof' && o.basis === 'verdict' && o.verdict === 'payable') {
        expect(execMock, s.id).toHaveBeenCalledTimes(1)
      } else if (o.kind === 'proof' || o.kind === 'park') {
        expect(t2Text, s.id).toBe(recText)
        expect(execMock).not.toHaveBeenCalled()
      } else {
        // no_write: T2 reverts to its null pre-image; reconcile wrote nothing
        expect(t2).toMatchObject({ status: 'approved', refundAttempted: false, refundError: null })
      }
    })
  }

  it('NEGATIVE CONTROL — the A-S03 facts with the reverted row removed derive a different text than reconcile wrote (the parity can fail)', async () => {
    w = worldOf('A-S03')
    const read = (await load()) as Extract<OrderMoneyRead, { readable: true }>
    w = worldOf('A-S03', { refundError: PRE })
    await reconcileClaimEvidence({ claimId: 'cl1' })
    const altered: OrderMoneyRead = { readable: true, facts: { ...read.facts, succeededNotCounted: [] } }
    const o = deriveNoRowOutcome(altered, 'cl1')
    const text = o.kind === 'proof' ? absenceProofText(o, altered, { preImage: PRE, now: new Date(), requestedAmountCents: 500 }) : o.kind
    expect(text).not.toBe(String(claimOf(w).refundError))
  })
})

// ══ W3 — J-M42: the G2 dispatch, and the deleted round-12 ladder ═══════════════════════════════════════════════
describe('J-M42 — reconcile dispatch (G2) and the deleted round-12 ladder', () => {
  const OLD_MARKER = 'reconcile_required: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z (tentative 0) — identité pas encore liée.'

  it('IMPLEMENTATION NOTE (W3) — a refunded claim is refused by the gate until the R0 dispatch (G10) lands; nothing is read or written', async () => {
    w = payableWorld({ status: 'refunded', refundAttempted: true, refundId: 'rf_1', refundError: null })
    w.refunds.push(refundRow('rf_1', { status: 'pending', stripeRefundId: 're_1', reason: 'claim:cl1' }))
    wireWorld(w, db, stripeMock)
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: false, status: 409, error: 'Cette réclamation n’est pas en attente de réconciliation.' })
    expect(db.refund.findMany).not.toHaveBeenCalled()
    expect(w.writes).toEqual([])
  })

  it('approved with a refundId and no error → reconcileBoundClaim on that row; the order’s rows are not read', async () => {
    w = payableWorld({ status: 'approved', refundAttempted: true, refundId: 'rf_b', refundError: null })
    w.refunds.push(refundRow('rf_b', { status: 'failed', stripeRefundId: 're_b', reason: 'claim:cl1' }))
    wireWorld(w, db, stripeMock)
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refund_failed', refundId: 'rf_b' })
    expect(db.refund.findMany).not.toHaveBeenCalled()
  })

  it('…a bound row that is missing → the bound_row_missing park on the read pre-image', async () => {
    w = payableWorld({ status: 'approved', refundAttempted: true, refundId: 'rf_gone', refundError: null })
    wireWorld(w, db, stripeMock)
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'bound_row_missing' })
    expect(w.writes[0].where).toEqual({ id: 'cl1', status: 'approved', refundError: null })
  })

  it('mine > 1 (A-S27-1a) → multiple_candidate_refunds', async () => {
    w = worldOf('A-S27-1a', { status: 'refunding', refundAttempted: true, refundError: OLD_MARKER })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'multiple_candidate_refunds' })
  })

  it('mine === 1 (A-S33-1, a stalled attempt’s late own row) → applyRowTruth « stamped »: refunded with evidence stripe_read and the STRIPE amount', async () => {
    w = worldOf('A-S33-1', { status: 'refunding', refundAttempted: true, refundError: OLD_MARKER })
    // our row says 500 c; Stripe's refund object says 480 c — the outcome carries Stripe's
    w.stripeRefunds = w.stripeRefunds.map((x) => (x.id === 're_n' ? { ...x, amount: 480 } : x))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'refunded', refundId: 'rf_n', amountCents: 480, evidence: 'stripe_read' })
    expect(stripeMock.refunds.retrieve).toHaveBeenCalledWith('re_n')
  })

  it('mine === 1 whose Stripe refund FAILED (applyRowTruth reverted) → one CAS → approved + STRIPE_REVERTED_TEXT, refund_failed, ALERT-B', async () => {
    w = worldOf('A-S33-1', { status: 'refunding', refundAttempted: true, refundError: OLD_MARKER })
    w.stripeRefunds = w.stripeRefunds.map((x) => (x.id === 're_n' ? { ...x, status: 'canceled' } : x))
    alertSpy.mockClear()
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'refund_failed', refundId: 'rf_n' })
    expect(w.writes).toHaveLength(1)
    expect(claimOf(w)).toMatchObject({ status: 'approved', refundId: 'rf_n' })
    expect(String(claimOf(w).refundError).startsWith('stripe_reverted: la ligne rf_n est marquée ABOUTIE dans notre base, mais Stripe rapporte aujourd’hui son remboursement re_n « canceled »')).toBe(true)
    expect(alertSpy.mock.calls.map((c) => c[0].dedupeKey)).toEqual(['claim_blocked:cl1:stripe_reverted'])
  })

  it('no PaymentIntent → the no_payment_intent park', async () => {
    w = payableWorld({ refundError: PRE })
    w.orders[0].stripePaymentIntentId = null
    wireWorld(w, db, stripeMock)
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'no_payment_intent' })
  })

  it('A-S03 (the round-12 otherClaimRows fixture: rf_o succeeded, key refund:o1:0, stamped claim:OTHER, retrieve failed, routed) → the LOCK, never « no_refund_proven: »', async () => {
    w = worldOf('A-S03', { refundError: PRE })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'no_refund_proven_rail_locked' })
    const e = String(claimOf(w).refundError)
    expect(e.startsWith('no_refund_proven_rail_locked: ')).toBe(true)
    for (const c of ['refund:o1:0', 'blocage de sûreté', 'Ce paiement est routé']) expect(e).toContain(c)
  })

  it('NEGATIVE CONTROL — A-S03 with transfer_data null → no ROUTED sentence; key refund:o1:500 → H1 without E6 (A-S04)', async () => {
    w = worldOf('A-S03', { refundError: PRE })
    w.pis.pi_1.transfer_data = null
    await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(String(claimOf(w).refundError)).not.toContain('Ce paiement est routé')
    w = worldOf('A-S03', { refundError: PRE })
    w.refunds[0].idempotencyKey = 'refund:o1:500'
    await reconcileClaimEvidence({ claimId: 'cl1' })
    const e = String(claimOf(w).refundError)
    expect(e).toContain('blocage de sûreté, pas un refus du moteur')
    expect(e).not.toContain('refund:o1:0')
  })

  // W3 round-1 fix: the four G2 pin strings (« jamais déplacé », « n’a déplacé d’argent », « Absence de remboursement
  // PROUVÉE » added). components/ joins with the console slice (W7): AdminFinancialVerification.tsx still carries one.
  const G2_NEEDLES = [
    'boundElsewhere', 'otherClaimRows', 'mayMoveMoney', 'mayMoveMoneyHere', 'noRowEverMoved',
    'relèvent d’AUTRES réclamations', 'aucun remboursement n’a jamais déplacé d’argent', 'jamais déplacé', 'n’a déplacé d’argent', 'Absence de remboursement PROUVÉE',
  ]
  const walkFiles = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walkFiles(join(dir, n)) : [join(dir, n)]))
  const g2Offenders = (files: string[]) => files.filter((f) => /\.(ts|tsx|json)$/.test(f)).flatMap((f) => {
    const src = stripSrcComments(readSrc(f))
    return G2_NEEDLES.filter((needle) => src.includes(needle)).map((needle) => `${f.replace(/\\/g, '/')}: ${needle}`)
  })

  it('source scan: the round-12 ladder identifiers and the G2 phrases are absent from lib/ and messages/', () => {
    expect(g2Offenders([...walkFiles('lib'), ...walkFiles('messages')])).toEqual([])
  })

  it('NEGATIVE CONTROL — the same scan flags the one remaining W7 string in components/ (so it can find a real hit)', () => {
    expect(g2Offenders(['components/claims/AdminFinancialVerification.tsx'])).toEqual([
      'components/claims/AdminFinancialVerification.tsx: aucun remboursement n’a jamais déplacé d’argent',
      'components/claims/AdminFinancialVerification.tsx: jamais déplacé',
    ])
  })
})

// ══ W3 round-1 fix — G2 / H05 site 3: every refunded write of applyRowTruth is followed by the closure record ═══════
describe('G2 / H05 site 3 — applyRowTruth records this build’s closure after each refunded write it won (AMF-2)', () => {
  const OLD_MARKER = 'reconcile_required: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z (tentative 0) — identité pas encore liée.'
  const records = () => (db.emailDispatch.create.mock.calls as Array<[{ data: unknown }]>).map((c) => c[0].data)
  const RECORD = { trigger: 'claim_closure_record', dedupeKey: 'claim:cl1' }
  /** at_stripe succeeded: our own stamped row is still pending, Stripe settled its refund. */
  const atStripeWorld = () => {
    const x = payableWorld({ status: 'refunding', refundAttempted: true, refundError: OLD_MARKER })
    x.pis.pi_1.latest_charge.amount_refunded = 500
    x.refunds.push(refundRow('rf_n', { status: 'pending', stripeRefundId: 're_n', reason: 'claim:cl1', amountCents: 500, idempotencyKey: 'refund:o1:0' }))
    x.stripeRefunds.push(stripeRefund('re_n', { status: 'succeeded', amount: 500 }))
    wireWorld(x, db, stripeMock)
    return x
  }
  beforeEach(() => { db.emailDispatch.create.mockReset() })

  it('at_stripe succeeded → refunded (stripe_read), then ONE record { claim_closure_record, claim:cl1 }', async () => {
    w = atStripeWorld()
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'refunded', refundId: 'rf_n', amountCents: 500, evidence: 'stripe_read' })
    expect(claimOf(w).status).toBe('refunded')
    expect(records()).toEqual([RECORD])
  })

  it('row_terminal succeeded through reconcileClaimForRefund (A-S33-1) → refunded, then ONE record', async () => {
    w = worldOf('A-S33-1', { status: 'refunding', refundAttempted: true, refundError: OLD_MARKER })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf_n' })
    expect(claimOf(w).status).toBe('refunded')
    expect(records()).toEqual([RECORD])
  })

  it('a record that fails (P2002 or another error) never changes the reconcile outcome', async () => {
    w = atStripeWorld()
    db.emailDispatch.create.mockRejectedValue(new Error('db down'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refunded' })
    expect(err.mock.calls.some((c) => String(c[0]).startsWith('[EMAIL MISS] [claim_closure_record] claim cl1'))).toBe(true)
    err.mockRestore()
  })

  it('NEGATIVE CONTROL — the same refunded writes LOST (the claim changed during the read) → no record', async () => {
    w = atStripeWorld()
    w.beforeClaimWrite = () => { claimOf(w).refundError = 'financial_verification:x: écrit entre-temps' }
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'changed_during_read' })
    w = worldOf('A-S33-1', { status: 'refunding', refundAttempted: true, refundError: OLD_MARKER })
    // the bind wins, reconcileClaimForRefund's refunded CAS loses
    w.beforeClaimWrite = (n: number) => { if (n === 2) claimOf(w).refundError = 'financial_verification:x: écrit entre-temps' }
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r.ok && r.outcome).not.toBe('refunded')
    expect(records()).toEqual([])
  })

  // RELEASE GATE (G2 / H05 / AMF-2): the closure record is the only closure-notice eligibility. A refunded write in
  // applyRowTruth without recordClaimClosure after it makes that claim's notice unreachable — this pin fails then.
  const applyRowTruthBody = (src: string) => {
    const a = src.indexOf('async function applyRowTruth(')
    return a < 0 ? '' : src.slice(a, src.indexOf('\n}\n', a))
  }
  function closureGateViolations(claimsSrc: string): string[] {
    const body = applyRowTruthBody(stripSrcComments(claimsSrc))
    const out: string[] = []
    const sites = [
      ...Array.from(body.matchAll(/status: 'refunded'/g)).map((m) => ({ at: m.index ?? 0, what: "status: 'refunded' write" })),
      ...Array.from(body.matchAll(/reconcileClaimForRefund\(/g)).map((m) => ({ at: m.index ?? 0, what: 'reconcileClaimForRefund refunded CAS' })),
    ]
    if (sites.length < 2) out.push(`applyRowTruth: expected the at_stripe refunded write and the reconcileClaimForRefund call, found ${sites.length}`)
    for (const s of sites) {
      const settle = body.indexOf("outcome: 'refunded'", s.at)
      const span = body.slice(s.at, settle < 0 ? undefined : settle)
      if (!span.includes('await recordClaimClosure(claim.id)')) out.push(`applyRowTruth: ${s.what} with no recordClaimClosure before its refunded outcome`)
    }
    return out
  }

  it('RELEASE GATE — the shipped applyRowTruth follows both refunded writes with recordClaimClosure', () => {
    const src = readSrc('lib/claims.ts')
    expect(src).toContain('async function recordClaimClosure(claimId: string, opts?: { noNoticeSource?: true }): Promise<boolean>')
    expect(closureGateViolations(src)).toEqual([])
  })

  it('NEGATIVE CONTROL — removing either call (or both) turns the gate red', () => {
    const src = readSrc('lib/claims.ts')
    const call = '    await recordClaimClosure(claim.id)\n'
    const first = src.indexOf(call, src.indexOf('async function applyRowTruth('))
    expect(first).toBeGreaterThan(0)
    const second = src.indexOf(call, first + call.length)
    expect(second).toBeGreaterThan(first)
    const dropFirst = src.slice(0, first) + src.slice(first + call.length)
    const dropSecond = src.slice(0, second) + src.slice(second + call.length)
    expect(closureGateViolations(dropFirst)).toHaveLength(1)
    expect(closureGateViolations(dropSecond)).toHaveLength(1)
    expect(closureGateViolations(dropFirst.replace(call, ''))).toHaveLength(2)
  })
})

// ══ W3 — J-M35: a financial_verification claim, run with Stripe blocking, then resolved ═══════════════════════
describe('J-M35 — reconcile a financial_verification claim: evidence and time exits (D6)', () => {
  const fvWorld = (id: string, reason: string, claim: Record<string, unknown> = {}) =>
    worldOf(id, { status: 'financial_verification', refundAttempted: true, refundError: `financial_verification:${reason}: parqué avant`, ...claim })
  const fvAlerts = () => alertSpy.mock.calls.map((c) => c[0]).filter((a) => a.kind === 'claim_financial_verification')
  const ISO = /\d{4}-\d{2}-\d{2}T[\d:.]+Z/

  type Run = { id: string; reason: string; block?: (x: typeof w) => void; first: string; firstReason?: string; resolve: (x: typeof w) => void; second: string; secondReason?: string; contains?: string[] }
  const RUNS: Run[] = [
    { id: 'A-S09a', reason: 'refund_moved_unattributed', first: 'financial_verification', firstReason: 'refund_moved_unattributed', contains: ['encore EN ATTENTE'],
      resolve: (x) => { x.refunds[0].status = 'succeeded'; x.stripeRefunds[0].status = 'succeeded' }, second: 'no_refund_proven' },
    { id: 'A-S09b', reason: 'refund_moved_unattributed', first: 'financial_verification', firstReason: 'refund_moved_unattributed', contains: ['encore EN ATTENTE'],
      resolve: (x) => { x.stripeRefunds[0].status = 'succeeded' }, second: 'no_refund_proven' },
    { id: 'A-S30e-4', reason: 'refund_moved_unattributed', first: 'financial_verification', firstReason: 'refund_moved_unattributed', contains: ['encore EN ATTENTE'],
      resolve: (x) => { x.refunds[0].status = 'succeeded'; x.stripeRefunds[0].status = 'succeeded' }, second: 'no_refund_proven' },
    { id: 'A-S40', reason: 'refund_moved_unattributed', first: 'financial_verification', firstReason: 'refund_moved_unattributed', contains: ['lorsqu’il sera terminal'],
      resolve: (x) => { x.stripeRefunds[0].status = 'succeeded' }, second: 'financial_verification', secondReason: 'refund_moved_unattributed' },
    { id: 'A-S13a', reason: 'stripe_refund_contradiction', first: 'financial_verification', firstReason: 'stripe_refund_contradiction', contains: ['ne connaît pas'],
      resolve: (x) => { x.fail.refundRetrieve = {}; x.stripeRefunds.push(stripeRefund('re_X', { status: 'failed', metadata: { grubano_refund_row: 'rf_x' } })) }, second: 'no_refund_proven_rail_locked' },
    { id: 'A-S29-2', reason: 'stripe_refund_contradiction', first: 'financial_verification', firstReason: 'stripe_refund_contradiction', contains: ['sur une autre charge'],
      resolve: (x) => { x.stripeRefunds = [] }, second: 'no_refund_proven' },
    { id: 'A-S14a-2a', reason: 'stripe_unreadable', first: 'stripe_unreadable_retry',
      resolve: (x) => { x.fail.refundList = false }, second: 'no_refund_proven' },
    { id: 'A-S14a-2b', reason: 'stripe_unreadable', first: 'stripe_unreadable_retry',
      resolve: (x) => { x.fail.refundRetrieve = {}; x.stripeRefunds.push(stripeRefund('re_P', { status: 'failed', metadata: { grubano_refund_row: 'rf_p' } })) }, second: 'no_refund_proven_rail_locked' },
    // A-S05b-1 / A-S05c-1: the wrong key or mode — the PaymentIntent cannot be read; fixed → the row's refund is readable.
    { id: 'A-S05b-1', reason: 'stripe_refund_contradiction', block: (x) => { x.refunds[0].reason = null }, first: 'stripe_unreadable_retry',
      resolve: (x) => { x.fail.piRetrieve = false; x.pis.pi_1.latest_charge.amount_refunded = 300; x.stripeRefunds.push(stripeRefund('re_X')) }, second: 'financial_verification', secondReason: 'refund_moved_unattributed' },
    { id: 'A-S05c-1', reason: 'stripe_refund_contradiction', first: 'stripe_unreadable_retry',
      resolve: (x) => { x.fail.piRetrieve = false; x.stripeRefunds.push(stripeRefund('re_X')) }, second: 'financial_verification', secondReason: 'refund_moved_unattributed' },
  ]

  for (const run of RUNS) {
    it(`${run.id}: blocking → ${run.first}${run.firstReason ? ` (${run.firstReason}, same reason: relabel, no alert)` : ' (nothing written)'}; resolved → ${run.second}`, async () => {
      w = fvWorld(run.id, run.reason)
      run.block?.(w)
      alertSpy.mockClear()
      const first = await reconcileClaimEvidence({ claimId: 'cl1' })
      expect(first.ok && first.outcome, run.id).toBe(run.first)
      if (run.firstReason) {
        expect((first as { reason: string }).reason).toBe(run.firstReason)
        expect(claimOf(w).status).toBe('financial_verification')
      } else {
        expect(w.writes, run.id).toEqual([])
      }
      for (const c of run.contains ?? []) expect(String(claimOf(w).refundError)).toContain(c)
      // I-02: a relabel with the reason it already had sends nothing
      expect(fvAlerts(), run.id).toEqual([])
      // the only date a park states is none (the window's `until` is not a park's)
      expect(String(claimOf(w).refundError)).not.toMatch(ISO)
      // D6: approve and the declaration refuse a FV claim (a claim approved earlier is refused by the finalization lock first)
      expect(arbitrationRefusal({ ...claimOf(w), arbitrationDecision: null } as never, 'approve', new Date())?.error).toBe('Cette réclamation n’est pas en arbitrage.')
      expect(arbitrationRefusal(claimOf(w) as never, 'approve', new Date())).not.toBeNull()
      expect(isStuckResolvable(claimOf(w) as never)).toBe(false)

      run.resolve(w)
      const second = await reconcileClaimEvidence({ claimId: 'cl1' })
      expect(second.ok && second.outcome, run.id).toBe(run.second)
      if (run.secondReason) expect((second as { reason: string }).reason).toBe(run.secondReason)
      // J-M35 (W3 round-1 fix): A-S40's second run stays FV with adoption offered (and reconcile).
      if (run.id === 'A-S40') expect(acceptedExits({ claim: claimOf(w) as never, now: new Date() })).toEqual(expect.arrayContaining(['reconcile', 'adopt']))
      if (run.second.startsWith('no_refund_proven')) {
        // a proof written from FV is approved-unpaid with refundAttempted false, and grants nothing until D2
        expect(claimOf(w)).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
        if (run.second === 'no_refund_proven') expect(arbitrationRefusal({ ...claimOf(w), arbitrationDecision: 'approved' } as never, 'approve', new Date())?.error).toMatch(/^Approbation prématurée/)
      }
      if (run.secondReason && run.secondReason !== run.reason) expect(fvAlerts().map((a) => a.dedupeKey)).toEqual([`claim_fv:cl1:${run.secondReason}`])
      expect(execMock).not.toHaveBeenCalled()
    })
  }

  it('a relabel with a NEW reason alerts once (I-02); the same run again with that reason sends nothing', async () => {
    w = fvWorld('A-S19', 'stripe_unreadable')
    alertSpy.mockClear()
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ outcome: 'financial_verification', reason: 'refund_moved_unattributed' })
    expect(fvAlerts().map((a) => a.dedupeKey)).toEqual(['claim_fv:cl1:refund_moved_unattributed'])
    alertSpy.mockClear()
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ outcome: 'financial_verification', reason: 'refund_moved_unattributed' })
    expect(fvAlerts()).toEqual([])
  })

  it('NEGATIVE CONTROL — a FV claim on a readable, fully explained 0 / 0 order → the payable v13 proof, not a park', async () => {
    w = fvWorld('A-S01', 'stripe_unreadable')
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'no_refund_proven' })
    expect(String(claimOf(w).refundError).startsWith(`${MARKERS.PROOF_PAYABLE_V13} `)).toBe(true)
  })
})
