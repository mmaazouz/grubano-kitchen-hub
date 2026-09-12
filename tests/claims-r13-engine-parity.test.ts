// tests/claims-r13-engine-parity.test.ts — T-49 round 13, J-M03 / J-M04 / J-M05: the REAL executeRefund on every state.
//
// lib/refund.ts runs unchanged, against the same in-memory order, rows, royalty and Stripe objects that
// loadOrderMoneyFacts reads (tests/support/claims-engine-world). Prisma and Stripe are doubles; nothing is mocked
// inside the engine. Each state of the J-M01 table says what the engine does with a fresh refund of the claim's
// amount (J-M03) or with the oldest pending row it resumes first (J-M04); the G5 mirror must name the same step on
// the loader's facts, so no copy or control can offer an exit the engine would refuse.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { payableWorld, refundRow, stripeRefund, HOURS } from './support/claims-world'
import { wireEngineWorld, royaltyRow, type EngineWorld } from './support/claims-engine-world'
import { stateOf, J_M03_STATES, J_M04_STATES, ENGINE_QUOTES, RESUME_QUOTES } from './fixtures/claims-r13-states'

const { db, stripeMock } = vi.hoisted(() => ({
  db: {
    claim:            { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund:           { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    order:            { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    dispute:          { aggregate: vi.fn() },
    payout:           { findUnique: vi.fn() },
  },
  stripeMock: {
    paymentIntents:  { retrieve: vi.fn() },
    refunds:         { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() },
    transfers:       { list: vi.fn(), listReversals: vi.fn(), createReversal: vi.fn() },
    applicationFees: { listRefunds: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))
const { ledgerMock } = vi.hoisted(() => ({ ledgerMock: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/ledger', () => ({ recordRefundLedgerEntry: ledgerMock }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn(async () => ({ status: 'sent' })) }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn() }))

import { executeRefund } from '@/lib/refund'
import { loadOrderMoneyFacts, refundRowTruth } from '@/lib/claims'
import {
  engineRefusalOnReapproval, reapprovalVerdict, lockIsTemporary, deriveNoRowOutcome, absenceProofText, safetyHoldText, noChargeClause,
  type OrderMoneyRead, type ReapprovalFacts,
} from '@/lib/claim-action-rules'

let w: EngineWorld
const world = (mutate?: (x: EngineWorld) => void): EngineWorld => {
  w = payableWorld() as EngineWorld
  mutate?.(w)
  wireEngineWorld(w, db, stripeMock)
  return w
}
const allMocks = () => [
  ...Object.values(db).flatMap((m) => Object.values(m)),
  ...Object.values(stripeMock).flatMap((m) => Object.values(m)),
  ledgerMock,
]
beforeEach(() => {
  vi.clearAllMocks()
  for (const m of allMocks()) m.mockReset()
  ledgerMock.mockResolvedValue({ ok: true })
})
const refund = () => executeRefund({ orderId: 'o1', amountCents: 500, reason: 'claim:cl1' })
const cursorOf = (x: EngineWorld) => Number((x.pis.pi_1.latest_charge as { amount_refunded?: number } | null)?.amount_refunded ?? 0)
/** The loader on a fresh copy of the same state (the engine run may have written rows). */
async function loaderOn(mutate: (x: EngineWorld) => void): Promise<OrderMoneyRead> {
  world(mutate)
  return loadOrderMoneyFacts('o1', 'cl1', 500)
}
const factsOf = (r: OrderMoneyRead): ReapprovalFacts => {
  if (!r.readable) throw new Error('facts not readable')
  return r.facts
}
/** The resume path's own Stripe list calls (the engine's eager ledger lists with expand, the resume does not). */
const resumeListCalls = () => stripeMock.refunds.list.mock.calls.filter((c) => !(c[0] as { expand?: unknown }).expand)

// ══ J-M03 — a fresh refund, no pending row ════════════════════════════════════════════════════════════════
describe('J-M03 — the real engine on every state without a pending row, and the G5 mirror on the loader', () => {
  for (const id of J_M03_STATES) {
    it(`${id}`, async () => {
      const s = stateOf(id)
      const answer = s.engine!
      world(s.world)
      const cursor = cursorOf(w)
      const r = await refund()
      // ENGINE RESUMES NO: no driveRefund on a pending row — no retrieve, no resume list.
      expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
      expect(resumeListCalls()).toEqual([])
      const creates = stripeMock.refunds.create.mock.calls
      if (answer.accepts) {
        expect(creates, JSON.stringify(r)).toHaveLength(1)
        expect(creates[0][1]).toEqual({ idempotencyKey: `refund:o1:${cursor}` })
        expect(creates[0][0].reverse_transfer === true).toBe(answer.routed === true)
        expect(r.ok).toBe(true)
      } else {
        expect(creates).toHaveLength(0)
        const q = ENGINE_QUOTES[answer.step]
        expect(r).toMatchObject({ ok: false, status: q.status })
        const error = (r as { error: string }).error
        if (answer.step === 'E5') expect(error.startsWith(`${q.message} — remboursable:`)).toBe(true)
        else expect(error).toBe(q.message)
      }
      // The G5 mirror on loadOrderMoneyFacts of the same state names the same step (PIX and E1c are unreadable facts).
      const read = await loaderOn(s.world!)
      if (read.readable) {
        expect(engineRefusalOnReapproval(read.facts)?.step ?? null).toBe(answer.accepts ? null : answer.step)
      } else if (read.permanent === 'no_charge') {
        const o = deriveNoRowOutcome(read, 'cl1')
        expect(o.kind === 'proof' && o.basis === 'no_charge' ? o.noChargeStep : o.kind).toBe(answer.accepts ? 'accepts' : answer.step)
      } else {
        // transient (a PaymentIntent or list read failed) or over the page cap: the mirror never concludes a step
        expect(answer.accepts ? 'accepts' : answer.step).toMatch(/^(accepts|PIX)$/)
      }
    })
  }

  it('A-S39 disputed: Stripe refuses the create after the insert → 502, and the row stays pending with no id (CX)', async () => {
    world((x) => { stateOf('A-S39').world!(x); x.engine = { createThrows: true } })
    const r = await refund()
    expect(r).toMatchObject({ ok: false, status: 502, error: 'Erreur paiement, réessayez.' })
    expect(w.refunds).toEqual([expect.objectContaining({ id: 'rf_new', status: 'pending', stripeRefundId: null, reason: 'claim:cl1', idempotencyKey: 'refund:o1:0' })])
  })

  it('A-S34: the adoption mirror key external:re_D never collides at E6', async () => {
    world(stateOf('A-S34').world)
    expect((await refund()).ok).toBe(true)
    expect(w.refunds.map((r) => r.idempotencyKey)).toEqual(['external:re_D', 'refund:o1:300'])
  })

  it('NEGATIVE CONTROL — A-S01b with its key renamed « :failed:re_x » → the engine creates (YES), and the mirror agrees', async () => {
    const renamed = (x: EngineWorld) => { x.refunds.push(refundRow('rf_k', { status: 'failed', idempotencyKey: 'refund:o1:0:failed:re_x', reason: 'admin:x' })) }
    world(renamed)
    expect((await refund()).ok).toBe(true)
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1)
    expect(engineRefusalOnReapproval(factsOf(await loaderOn(renamed)))).toBeNull()
  })
})

// ══ J-M04 — resume-first ═════════════════════════════════════════════════════════════════════════════════
describe('J-M04 — the real engine resumes the oldest pending row on every E3 state; G5 names E3 with the same evidence', () => {
  for (const id of J_M04_STATES) {
    it(`${id}`, async () => {
      const s = stateOf(id)
      const answer = s.resume!
      world(s.world)
      const oldest = w.refunds.filter((r) => r.status === 'pending').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
      const r = await refund()
      // ENGINE RESUMES YES: driveRefund reached (by the recorded id, or the tag list), and no fresh-key row insert.
      expect(stripeMock.refunds.retrieve.mock.calls.length + resumeListCalls().length).toBeGreaterThan(0)
      expect(db.refund.create).not.toHaveBeenCalled()
      for (const [, opts] of stripeMock.refunds.create.mock.calls) expect(opts).toEqual({ idempotencyKey: oldest.idempotencyKey })
      if (answer.outcome === 'ok') expect(r).toMatchObject({ ok: true, resumed: true, refundId: oldest.id })
      else if (answer.outcome === 'pending_202') expect(r).toMatchObject({ ok: false, status: 202, refundId: oldest.id })
      else expect(r).toMatchObject({ ok: false, status: RESUME_QUOTES[answer.outcome].status, error: RESUME_QUOTES[answer.outcome].message })
      // G5 on the loader of the same state
      const read = await loaderOn(s.world!)
      if (answer.evidence === 'unreadable') {
        expect(read.readable).toBe(false)
      } else {
        const refusal = engineRefusalOnReapproval(factsOf(read))
        expect(refusal?.step).toBe('E3')
        const e3 = refusal as Extract<typeof refusal, { step: 'E3' }>
        expect(e3.oldestRowIds).toEqual([oldest.id])
        expect(e3.evidenceByRow[oldest.id]).toBe(answer.evidence)
      }
    })
  }

  const noIdRow = (hours: number, o: Record<string, unknown> = {}) => (x: EngineWorld) => {
    x.refunds.push(refundRow('rf_a', { status: 'pending', reason: 'claim:cl_O', createdAt: new Date(Date.now() - hours * HOURS), amountCents: 300, ...o }))
  }
  const clawback = (hours: number, o: { cents?: number; royalty?: string; transfer?: string | null; reversalsHasMore?: boolean } = {}) => (x: EngineWorld) => {
    x.pis.pi_1.latest_charge.amount_refunded = 300
    x.refunds.push(refundRow('rf_c', { status: 'pending', reason: 'claim:cl_A', createdAt: new Date(Date.now() - hours * HOURS), amountCents: 300, royaltyRefundCents: o.cents ?? 300 }))
    x.stripeRefunds.push(stripeRefund('re_c', { metadata: { grubano_refund_row: 'rf_c' } }))
    x.claims.push({ id: 'cl_A', orderId: 'o1', status: 'refunded', refundAttempted: true, refundId: 'rf_c', refundError: null })
    x.royalty = royaltyRow(o.royalty ?? 'settled')
    x.engine = { settlementTransfer: o.transfer === undefined ? 'tr_set' : o.transfer, reversals: { data: [], has_more: o.reversalsHasMore === true } }
  }

  /** W3 round-1 fix (J-M04): G5 on the loader of the same state — step E3 and the evidence class of the resumed row. */
  const g5Class = async (mutate: (x: EngineWorld) => void, rowId: string): Promise<string> => {
    const e = engineRefusalOnReapproval(factsOf(await loaderOn(mutate)))
    return e && e.step === 'E3' ? String(e.evidenceByRow[rowId]) : `step:${e?.step ?? 'none'}`
  }

  it('(a) a no-id pending row at 19 h → the create is re-sent under the ROW key; G5 E3 within_window', async () => {
    world(noIdRow(19))
    expect(await refund()).toMatchObject({ ok: true, resumed: true, refundId: 'rf_a' })
    expect(stripeMock.refunds.create.mock.calls.map((c) => c[1])).toEqual([{ idempotencyKey: 'refund:o1:k_rf_a' }])
    expect(await g5Class(noIdRow(19), 'rf_a')).toBe('within_window')
  })

  it('(b) the same at 20.5 h → 409 ResumeIdempotencyExpired, while refundRowTruth reads absent_within_window until createdAt + 21 h (A-S12b band); G5 E3 within_window', async () => {
    world(noIdRow(20.5))
    expect(await refund()).toMatchObject({ ok: false, status: RESUME_QUOTES.expired.status, error: RESUME_QUOTES.expired.message })
    const row = w.refunds[0]
    const t = await refundRowTruth(row as never, 'o1', {})
    expect(t).toMatchObject({ kind: 'absent_within_window', until: new Date(row.createdAt.getTime() + 21 * HOURS) })
    expect(await g5Class(noIdRow(20.5), 'rf_a')).toBe('within_window')
  })

  it('(c) dead at 22 h → 409; G5 E3 dead', async () => {
    world(noIdRow(22))
    expect(await refund()).toMatchObject({ ok: false, status: 409, error: RESUME_QUOTES.expired.message })
    expect(await g5Class(noIdRow(22), 'rf_a')).toBe('dead')
  })

  it('(d) more than 100 refunds and an id-less oldest row → 502 ResumeListUnavailable; G5 marks the E3 list truncated', async () => {
    const many = (x: EngineWorld) => {
      noIdRow(2)(x)
      for (let i = 0; i < 101; i++) x.stripeRefunds.push(stripeRefund(`re_${String(i).padStart(3, '0')}`, { amount: 1 }))
      x.pis.pi_1.latest_charge.amount_refunded = 101
    }
    world(many)
    expect(await refund()).toMatchObject({ ok: false, status: RESUME_QUOTES.listDown.status, error: RESUME_QUOTES.listDown.message })
    const e3 = engineRefusalOnReapproval(factsOf(await loaderOn(many)))
    expect(e3).toMatchObject({ step: 'E3', engineListTruncated: true })
  })

  it('(e) failed_at_stripe → markRefundRowFailed then 409; a second call → E2 409; G5 E3 failed_at_stripe', async () => {
    world(stateOf('A-S07').world)
    expect(await refund()).toMatchObject({ ok: false, status: 409, error: RESUME_QUOTES.failed.message })
    expect(w.refunds[0]).toMatchObject({ status: 'failed', stripeRefundId: 're_rf_p' })
    expect(await refund()).toMatchObject({ ok: false, status: ENGINE_QUOTES.E2.status, error: ENGINE_QUOTES.E2.message })
    expect(await g5Class(stateOf('A-S07').world!, 'rf_p')).toBe('failed_at_stripe')
  })

  it('(f) another claim’s row succeeded at Stripe, royaltyRefundCents 0 → ok resumed:true on the OTHER row; G5 E3 succeeded_at_stripe', async () => {
    world(stateOf('A-S10b').world)
    expect(await refund()).toMatchObject({ ok: true, resumed: true, refundId: 'rf_A' })
    expect(w.refunds.find((r) => r.id === 'rf_A')).toMatchObject({ status: 'succeeded' })
    expect(await g5Class(stateOf('A-S10b').world!, 'rf_A')).toBe('succeeded_at_stripe')
  })

  it('(g) clawback at 21 h, no tagged reversal → 409 ResumeIdempotencyExpired(row:clawback), createReversal 0, row pending; a second call identical', async () => {
    world(clawback(21))
    for (let i = 0; i < 2; i++) {
      expect(await refund()).toMatchObject({ ok: false, status: 409, error: RESUME_QUOTES.expired.message })
      expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
      expect(w.refunds[0].status).toBe('pending')
    }
  })

  it('(g2) the same clawback at 1 h → createReversal once (refund-claw:<row>), row succeeded — G5 still classes it clawback, never temporary', async () => {
    world(clawback(1))
    expect(await refund()).toMatchObject({ ok: true, resumed: true, refundId: 'rf_c' })
    expect(stripeMock.transfers.createReversal).toHaveBeenCalledTimes(1)
    expect(stripeMock.transfers.createReversal.mock.calls[0][2]).toEqual({ idempotencyKey: 'refund-claw:rf_c' })
    expect(w.refunds[0].status).toBe('succeeded')
    const v = reapprovalVerdict(factsOf(await loaderOn(clawback(1))))
    expect(v !== 'payable' && v.refusal?.step === 'E3' ? v.refusal.evidenceByRow.rf_c : null).toBe('succeeded_at_stripe_clawback')
    expect(lockIsTemporary(v)).toBe(false)
  })

  it('(g3) settled royalty, no locatable settlement transfer → the engine finalizes with createReversal 0; G5 classes clawback (documented over-lock)', async () => {
    world(clawback(1, { transfer: null }))
    expect(await refund()).toMatchObject({ ok: true, refundId: 'rf_c' })
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
    const e3 = engineRefusalOnReapproval(factsOf(await loaderOn(clawback(1, { transfer: null }))))
    expect(e3 && e3.step === 'E3' ? e3.evidenceByRow.rf_c : null).toBe('succeeded_at_stripe_clawback')
  })

  it('(g4) listReversals has_more → 502, row pending; G5 clawback', async () => {
    world(clawback(1, { reversalsHasMore: true }))
    expect(await refund()).toMatchObject({ ok: false, status: RESUME_QUOTES.listDown.status, error: RESUME_QUOTES.listDown.message })
    expect(w.refunds[0].status).toBe('pending')
    expect(await g5Class(clawback(1, { reversalsHasMore: true }), 'rf_c')).toBe('succeeded_at_stripe_clawback')
  })

  it('(h) a recorded id unknown to Stripe (404, A-S13a) → 502 on every call; G5 E3 unclassified (J-M05 note)', async () => {
    world(stateOf('A-S13a').world)
    for (let i = 0; i < 2; i++) expect(await refund()).toMatchObject({ ok: false, status: RESUME_QUOTES.stripeError.status, error: RESUME_QUOTES.stripeError.message })
    expect(await g5Class(stateOf('A-S13a').world!, 'rf_x')).toBe('unclassified')
  })

  it('(i) a recorded id on pi_OTHER, succeeded (A-S13b) → row succeeded with the foreign id, NO ledger line (warn); with the (g) royalty below 20 h, the franchisor clawback runs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    world(stateOf('A-S13b').world)
    expect(await refund()).toMatchObject({ ok: true, resumed: true, refundId: 'rf_x' })
    expect(w.refunds[0]).toMatchObject({ status: 'succeeded', stripeRefundId: 're_X' })
    expect(ledgerMock).not.toHaveBeenCalled()
    expect(warn.mock.calls.some((c) => String(c[0]).includes('eager ledger line skipped'))).toBe(true)
    // W3 round-1 fix (J-M04): G5 on the loader of the same state — E3, unclassified (the J-M05 note's contradiction class)
    expect(await g5Class(stateOf('A-S13b').world!, 'rf_x')).toBe('unclassified')
    vi.clearAllMocks()
    world((x) => {
      stateOf('A-S13b').world!(x)
      x.refunds[0].royaltyRefundCents = 300
      x.royalty = royaltyRow('settled')
      x.engine = { settlementTransfer: 'tr_set', reversals: { data: [], has_more: false } }
    })
    expect(await refund()).toMatchObject({ ok: true, refundId: 'rf_x' })
    expect(stripeMock.transfers.createReversal).toHaveBeenCalledTimes(1)
    expect(ledgerMock).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('NEGATIVE CONTROL — the (g2) row with royaltyRefundCents 0, or with royalty pending → finalized with createReversal 0; G5 succeeded_at_stripe and TEMPORARY', async () => {
    for (const variant of [clawback(1, { cents: 0 }), clawback(1, { royalty: 'pending' })]) {
      vi.clearAllMocks()
      world(variant)
      expect(await refund()).toMatchObject({ ok: true, refundId: 'rf_c' })
      expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
      const v = reapprovalVerdict(factsOf(await loaderOn(variant)))
      expect(v !== 'payable' && v.refusal?.step === 'E3' ? v.refusal.evidenceByRow.rf_c : null).toBe('succeeded_at_stripe')
      expect(lockIsTemporary(v)).toBe(true)
    }
  })
})

// ══ J-M05 — PIX, E1, E2, E1b, E1c and the facts-chosen quote ════════════════════════════════════════════
describe('J-M05 — the refusals that precede E3, and the quote the texts choose from the facts', () => {
  it('a PaymentIntent retrieve that throws with a pending row present → 502, and driveRefund is not reached (PIX precedes E3); the loader is transient', async () => {
    const pix = (x: EngineWorld) => { noPending(x); x.fail.piRetrieve = true }
    world(pix)
    expect(await refund()).toMatchObject({ ok: false, status: ENGINE_QUOTES.PIX.status, error: ENGINE_QUOTES.PIX.message })
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
    expect(stripeMock.refunds.list).not.toHaveBeenCalled()
    expect(await loaderOn(pix)).toEqual({ readable: false, permanent: null })
  })

  it('a readable PaymentIntent with an unreadable list (A-S14a-2a) → the loader is transient', async () => {
    expect(await loaderOn((x) => { x.fail.refundList = true })).toMatchObject({ readable: false, permanent: null })
  })

  const V: Array<[string, (x: EngineWorld) => void, keyof typeof ENGINE_QUOTES, string, string]> = [
    ['(a) paymentStatus pending', (x) => { x.pis.pi_1.latest_charge = null; x.orders[0].paymentStatus = 'pending' }, 'E1', 'pending', 'succeeded'],
    ['(b) piStatus requires_payment_method', (x) => { x.pis.pi_1.latest_charge = null; x.pis.pi_1.status = 'requires_payment_method' }, 'E1b', 'paid', 'requires_payment_method'],
    ['(c) piStatus succeeded', (x) => { x.pis.pi_1.latest_charge = null }, 'E1c', 'paid', 'succeeded'],
    ['(d) requires_payment_method + a failed row with a Stripe id', (x) => {
      x.pis.pi_1.latest_charge = null; x.pis.pi_1.status = 'requires_payment_method'
      x.refunds.push(refundRow('rf_f', { status: 'failed', stripeRefundId: 're_F', idempotencyKey: 'refund:o1:0:failed:re_F' }))
    }, 'E2', 'paid', 'requires_payment_method'],
  ]
  for (const [name, mutate, step, paymentStatus, piStatus] of V) {
    it(`latest_charge null ${name} → the engine answers ${step}; the loader is no_charge with rows and statuses; the texts quote that answer`, async () => {
      world(mutate)
      const q = ENGINE_QUOTES[step]
      expect(await refund()).toMatchObject({ ok: false, status: q.status, error: q.message })
      const read = await loaderOn(mutate)
      expect(read).toMatchObject({ readable: false, permanent: 'no_charge', paymentStatus, piStatus })
      const nc = read as Extract<OrderMoneyRead, { permanent: 'no_charge' }>
      expect(nc.rows.map((r) => r.id)).toEqual(step === 'E2' ? ['rf_f'] : [])
      const hold = safetyHoldText(noChargeClause(nc))
      const o = deriveNoRowOutcome(read, 'cl1')
      if (step === 'E2') {
        expect(hold).toContain('la ligne rf_f est ÉCHOUÉE avec un identifiant Stripe')
        expect(hold).not.toContain('Paiement non débité')
        expect(o).toMatchObject({ kind: 'park', reason: 'stripe_refund_contradiction' })
      } else {
        expect(hold).toContain(`(« ${q.message} »)`)
        expect(o.kind).toBe('proof')
        const lock = absenceProofText(o as Extract<typeof o, { kind: 'proof' }>, read, { preImage: null, now: new Date(), requestedAmountCents: 500 })
        expect(lock).toContain(`« ${q.message} »`)
      }
    })
  }

  it('NEGATIVE CONTROL — variant (b) never carries the E1c quote; variant (d) never carries the E1b quote', async () => {
    const b = (await loaderOn(V[1][1])) as Extract<OrderMoneyRead, { permanent: 'no_charge' }>
    expect(safetyHoldText(noChargeClause(b))).not.toContain('Charge introuvable')
    const ob = deriveNoRowOutcome(b, 'cl1') as Extract<ReturnType<typeof deriveNoRowOutcome>, { kind: 'proof' }>
    expect(absenceProofText(ob, b, { preImage: null, now: new Date(), requestedAmountCents: 500 })).not.toContain('Charge introuvable')
    const d = (await loaderOn(V[3][1])) as Extract<OrderMoneyRead, { permanent: 'no_charge' }>
    expect(safetyHoldText(noChargeClause(d))).not.toContain('Paiement non débité')
  })
})

function noPending(x: EngineWorld) {
  x.refunds.push(refundRow('rf_p', { status: 'pending', reason: 'claim:cl_O', createdAt: new Date(Date.now() - 2 * HOURS) }))
}
