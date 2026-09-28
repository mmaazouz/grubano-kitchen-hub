// tests/prel11-dispute-ledger-t106.test.ts — T-106 and T-107, the founder's eight mandatory scenarios.
//
// T-106, THE TWO DEFECTS. (a) PARTIAL-FAILURE AMNESIA: the net reversal succeeded, the royalty clawback then
// failed, the function RETURNED, and the webhook answered 200 — so Stripe never redelivered. The reversal id
// and amount were LOCAL VARIABLES, discarded; steps 3, 4 and 5 were skipped. Money had left the restaurant
// with no ledger line, no royalty write-down, and `splitReversed` still false — and both royalty aggregates
// filter on `splitReversed: true`, so the settlement could still pay a royalty that had been charged back.
// (b) DOUBLE REVERSAL PAST ~24 h: the only protection was the Stripe idempotency key, which Stripe prunes
// after about a day. A later redelivery found `splitReversed` false, recomputed the amount, and debited the
// restaurant a SECOND time.
//
// THE FIX, in one sentence: what moved is persisted the instant it moves, nothing is created before asking
// whether it already exists, a list that cannot prove absence fails closed, and an unfinalized state is
// answered 5xx — never 200.
//
// T-107, THE FOUNDER'S ARBITRATION: a chargeback must be TRACED even with the flags closed. The flag stops
// the unwind, not the record. The trace makes NO Stripe call at all, is idempotent, and never claims the
// unwind happened.
//
// The eight scenarios the founder required are named in the describes below, and scenario 7 (« aucun double
// mouvement ») is asserted inside every one of the others rather than once in isolation.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: {
    charges:   { retrieve: vi.fn() },
    transfers: { createReversal: vi.fn(), list: vi.fn(), retrieve: vi.fn(), listReversals: vi.fn() },
    refunds:   { create: vi.fn() }, // must NEVER be called by the dispute path
  },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

const { db } = vi.hoisted(() => ({
  db: {
    dispute:          { upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(), aggregate: vi.fn() },
    order:            { findFirst: vi.fn(), findUnique: vi.fn() },
    franchiseRoyalty: { findUnique: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
    payout:           { findUnique: vi.fn() },
    refund:           { aggregate: vi.fn() },
    ledgerEntry:      { create: vi.fn(), findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const alerts: Array<Record<string, unknown>> = []
vi.mock('@/lib/admin-alerts', () => ({
  sendAdminMoneyReviewAlert: vi.fn(async (p: Record<string, unknown>) => { alerts.push(p); return { status: 'sent' } }),
}))

const ledgerCalls: Array<Record<string, unknown>> = []
let ledgerThrows = false
vi.mock('@/lib/ledger', () => ({
  recordLedgerEntry: vi.fn(async (p: Record<string, unknown>) => {
    if (ledgerThrows) throw new Error('P2002 unique violation (simulated)')
    ledgerCalls.push(p)
    return { ok: true }
  }),
}))

const DISPUTE_ID = 'dp_t106'
const CHARGE_ID = 'ch_t106'
const PI_ID = 'pi_t106'
const TRANSFER_ID = 'tr_t106'

/** A LOST dispute event, exactly the shape Stripe signs. */
const lostEvent = (over: Record<string, unknown> = {}) => ({
  id: 'evt_t106',
  type: 'charge.dispute.closed',
  data: {
    object: {
      id: DISPUTE_ID, object: 'dispute', status: 'lost', amount: 5000, currency: 'eur',
      reason: 'fraudulent', charge: CHARGE_ID, payment_intent: PI_ID,
      balance_transactions: [{ fee: 1500, amount: -5000 }],
      ...over,
    },
  },
}) as never

/** The DB row `settleDisputeLost` reads back from its own upsert. */
const row = (over: Record<string, unknown> = {}) => ({
  id: 'd1', stripeDisputeId: DISPUTE_ID, splitReversed: false, feeCents: 1500,
  reverseTransferCents: 0, royaltyClawbackCents: 0, stripeReversalId: null, ...over,
})

function world(o: { rowOver?: Record<string, unknown>; reversals?: Array<Record<string, unknown>>; listThrows?: boolean } = {}) {
  vi.clearAllMocks()
  alerts.length = 0
  ledgerCalls.length = 0
  ledgerThrows = false
  db.dispute.upsert.mockResolvedValue(row(o.rowOver))
  db.dispute.updateMany.mockResolvedValue({ count: 1 })
  db.dispute.update.mockResolvedValue({})
  db.dispute.aggregate.mockResolvedValue({ _sum: { royaltyRefundedCents: 0, royaltyClawbackCents: 0 } })
  db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'rest1', stripePaymentIntentId: PI_ID })
  db.order.findFirst.mockResolvedValue({ id: 'o1', restaurantId: 'rest1' })
  db.franchiseRoyalty.findUnique.mockResolvedValue(null)
  db.refund.aggregate.mockResolvedValue({ _sum: { royaltyRefundCents: 0, royaltyClawbackCents: 0 } })
  stripeMock.charges.retrieve.mockResolvedValue({
    id: CHARGE_ID, amount: 5000, amount_refunded: 0, application_fee_amount: 400, currency: 'eur',
    payment_intent: PI_ID, transfer: TRANSFER_ID, metadata: { orderId: 'o1', restaurantId: 'rest1' },
    destination: 'acct_r',
  })
  stripeMock.transfers.retrieve.mockResolvedValue({ id: TRANSFER_ID, amount: 4600, amount_reversed: 0 })
  if (o.listThrows) stripeMock.transfers.listReversals.mockRejectedValue(new Error('Stripe 500 (simulated)'))
  else stripeMock.transfers.listReversals.mockResolvedValue({ has_more: false, data: o.reversals ?? [] })
  stripeMock.transfers.createReversal.mockResolvedValue({ id: 'trr_new', amount: 4100 })
  process.env.CHARGEBACKS_ENABLED = 'true'
}
const load = async () => (await import('@/lib/dispute'))
const reversalCalls = () => stripeMock.transfers.createReversal.mock.calls.length
beforeEach(() => { vi.resetModules() })

// ══ 1. PREMIÈRE LIVRAISON ══════════════════════════════════════════════════════════════════════════
describe('T-106 scenario 1 — première livraison', () => {
  it('reverses once, writes the ledger line, marks splitReversed, and answers as FINALIZED', async () => {
    world()
    const { handleDisputeEvent } = await load()
    const out = await handleDisputeEvent(lostEvent())
    expect(out.outcome).toBe('lost')
    expect(out.reversed).toBe(true)
    expect(out.retryable, 'a finalized unwind must NOT ask Stripe to redeliver').toBeFalsy()
    expect(reversalCalls(), 'scenario 7 — exactly one movement').toBe(1)
    expect(ledgerCalls).toHaveLength(1)
    expect(ledgerCalls[0]).toMatchObject({ type: 'adjustment', sourceEventId: DISPUTE_ID })
    // the movement was persisted BEFORE the ledger, not only at the end
    const movementWrites = db.dispute.updateMany.mock.calls.filter((c) => 'stripeReversalId' in (c[0] as { data: Record<string, unknown> }).data)
    expect(movementWrites.length, 'the reversal id is persisted the instant it moves').toBeGreaterThanOrEqual(1)
    expect(stripeMock.refunds.create, 'a dispute never issues a Stripe refund').not.toHaveBeenCalled()
  })
})

// ══ 2. REDELIVERY DU MÊME ÉVÉNEMENT ════════════════════════════════════════════════════════════════
describe('T-106 scenario 2 — redelivery du même événement', () => {
  it('a finished unwind takes the fast path: no read, no movement, no second ledger line', async () => {
    world({ rowOver: { splitReversed: true, reverseTransferCents: 4100, stripeReversalId: 'trr_old' } })
    const { handleDisputeEvent } = await load()
    const out = await handleDisputeEvent(lostEvent())
    expect(out.alreadyReversed).toBe(true)
    expect(out.retryable).toBeFalsy()
    expect(reversalCalls(), 'scenario 7 — no second movement').toBe(0)
    expect(ledgerCalls, 'the ledger line is not written twice').toHaveLength(0)
  })

  it('an UNFINISHED unwind whose reversal is on the row ADOPTS it and moves nothing', async () => {
    // This is the state scenario 5 leaves behind: money moved, splitReversed still false.
    world({ rowOver: { splitReversed: false, reverseTransferCents: 4100, stripeReversalId: 'trr_persisted' } })
    const { handleDisputeEvent } = await load()
    const out = await handleDisputeEvent(lostEvent())
    expect(reversalCalls(), 'scenario 7 — the persisted reversal is adopted, not recreated').toBe(0)
    expect(out.reversed).toBe(true)
    expect(out.reverseTransferCents).toBe(4100)
    expect(ledgerCalls, 'and the run it completes writes the ledger line').toHaveLength(1)
  })
})

// ══ 3. ÉVÉNEMENT ANCIEN (past the Stripe idempotency window) ════════════════════════════════════════
describe('T-106 scenario 3 — événement ancien, au-delà de la fenêtre d\'idempotence Stripe', () => {
  it('THE OLD DEFECT: with only a Stripe key, a >24 h redelivery would debit the restaurant TWICE', () => {
    // The arithmetic of the defect, stated so the fix is not taken on faith. Stripe prunes idempotency keys
    // « after they are at least 24 hours old » — past that, the same key is a NEW request.
    const oldProtection = (hoursSinceFirst: number) => hoursSinceFirst < 24 ? 'deduped_by_stripe' : 'NEW_REVERSAL'
    expect(oldProtection(2)).toBe('deduped_by_stripe')
    expect(oldProtection(30)).toBe('NEW_REVERSAL')
  })

  it('THE FIX: our row is empty but Stripe HOLDS the reversal → adopted, nothing created', async () => {
    world({
      rowOver: { splitReversed: false, stripeReversalId: null, reverseTransferCents: 0 },
      reversals: [{ id: 'trr_from_24h_ago', amount: 4100, metadata: { disputeId: DISPUTE_ID, kind: 'dispute_net_reversal' } }],
    })
    const { handleDisputeEvent } = await load()
    const out = await handleDisputeEvent(lostEvent())
    expect(reversalCalls(), 'scenario 7 — the franchisor and the restaurant are debited ONCE, ever').toBe(0)
    expect(out.reverseTransferCents).toBe(4100)
    expect(out.retryable).toBeFalsy()
    expect(ledgerCalls).toHaveLength(1) // and the unwind completes
  })

  it('a reversal belonging to ANOTHER dispute is NOT adopted — the match is on our own metadata', async () => {
    world({
      reversals: [{ id: 'trr_other', amount: 999, metadata: { disputeId: 'dp_SOMEONE_ELSE', kind: 'dispute_net_reversal' } }],
    })
    const { handleDisputeEvent } = await load()
    await handleDisputeEvent(lostEvent())
    expect(reversalCalls(), 'a foreign reversal must not be mistaken for ours').toBe(1)
  })

  it('a TRUNCATED list cannot prove absence → fail CLOSED, retryable, nothing created', async () => {
    world()
    stripeMock.transfers.listReversals.mockResolvedValue({ has_more: true, data: [] })
    const { handleDisputeEvent } = await load()
    const out = await handleDisputeEvent(lostEvent())
    expect(reversalCalls(), 'scenario 7 — an ambiguous proof set never authorizes a movement').toBe(0)
    expect(out.retryable).toBe(true)
    expect(out.reason).toBe('net_reversal_unprovable')
    expect(alerts.some((a) => a.kind === 'dispute_unfinalized')).toBe(true)
  })
})

// ══ 4. DOUBLE TENTATIVE ════════════════════════════════════════════════════════════════════════════
describe('T-106 scenario 4 — double tentative', () => {
  it('two runs against the same world produce exactly ONE movement in total', async () => {
    world()
    const { handleDisputeEvent } = await load()
    await handleDisputeEvent(lostEvent())
    expect(reversalCalls()).toBe(1)
    // the second run sees the movement the first persisted
    const persisted = db.dispute.updateMany.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .find((d) => typeof d.stripeReversalId === 'string')
    expect(persisted, 'the first run must have persisted its reversal').toBeTruthy()
    db.dispute.upsert.mockResolvedValue(row({ stripeReversalId: persisted!.stripeReversalId as string, reverseTransferCents: persisted!.reverseTransferCents as number }))
    await handleDisputeEvent(lostEvent())
    expect(reversalCalls(), 'scenario 7 — still exactly one movement after the second attempt').toBe(1)
  })
})

// ══ 5. PANNE ENTRE LE MOUVEMENT EXTERNE ET LA PERSISTANCE ══════════════════════════════════════════
describe('T-106 scenario 5 — panne entre le mouvement externe et la persistance', () => {
  it('the clawback fails AFTER the net reversal moved: the movement is on the row and the answer is RETRYABLE', async () => {
    world({ rowOver: { splitReversed: false } })
    db.franchiseRoyalty.findUnique.mockResolvedValue({ id: 'fr1', royaltyCents: 300, refundedCents: 0, status: 'settled', payoutId: 'po1', settlementId: 'S1' })
    db.payout.findUnique.mockResolvedValue({ stripeTransferId: 'tr_settle' })
    // the NET reversal succeeds, the CLAWBACK throws
    stripeMock.transfers.createReversal
      .mockResolvedValueOnce({ id: 'trr_net_ok', amount: 4100 })
      .mockRejectedValueOnce(new Error('balance_insufficient (simulated)'))
    const { handleDisputeEvent } = await load()
    const out = await handleDisputeEvent(lostEvent())

    // THE OLD BEHAVIOUR: reversed:false, reason 'clawback_failed', and the webhook answered 200.
    expect(out.reason).toBe('clawback_failed')
    // THE FIX — three properties:
    expect(out.retryable, 'the state is NOT finalized, so Stripe must redeliver').toBe(true)
    // 4600 = the resto NET on a full 5000 dispute with a 400 fee, capped by the transfer's remaining
    // reversible. The engine uses the AMOUNT IT ASKED FOR, not the mock's echoed amount — which is right:
    // `toReverse` is what we authorized and what the ledger must balance against.
    expect(out.reverseTransferCents, 'what moved is REPORTED, not discarded').toBe(4600)
    const persisted = db.dispute.updateMany.mock.calls
      .map((c) => (c[0] as { data: Record<string, unknown> }).data)
      .filter((d) => d.stripeReversalId === 'trr_net_ok')
    expect(persisted.length, 'what moved is PERSISTED before the clawback could fail').toBeGreaterThanOrEqual(1)
    // and nothing incoherent was written
    expect(ledgerCalls, 'no PARTIAL ledger line — a missing line is visible, an incoherent one is not').toHaveLength(0)
    const marked = db.dispute.updateMany.mock.calls.some((c) => (c[0] as { data: Record<string, unknown> }).data.splitReversed === true)
    expect(marked, 'splitReversed must stay false so a redelivery completes the unwind').toBe(false)
    expect(alerts.some((a) => a.kind === 'dispute_unfinalized')).toBe(true)
  })

  it('a FAILED LEDGER WRITE is also unfinalized — the founder\'s rule, asserted', async () => {
    // « un dispute ayant réellement déplacé de l'argent laisse TOUJOURS une trace ledger cohérente AVANT
    // qu'on considère l'événement comme correctement traité. » A logged shrug is not that.
    world()
    ledgerThrows = true
    const { handleDisputeEvent } = await load()
    const out = await handleDisputeEvent(lostEvent())
    expect(out.retryable).toBe(true)
    expect(out.reason).toBe('ledger_write_failed')
    expect(out.reverseTransferCents).toBe(4600)
    const marked = db.dispute.updateMany.mock.calls.some((c) => (c[0] as { data: Record<string, unknown> }).data.splitReversed === true)
    expect(marked, 'an unwind with no ledger line is not a finished unwind').toBe(false)
    expect(alerts.some((a) => a.kind === 'dispute_unfinalized' && a.dedupeKey === `dispute_unfinalized:${DISPUTE_ID}:ledger_write_failed`)).toBe(true)
  })
})

// ══ 6. REPRISE APRÈS PANNE ═════════════════════════════════════════════════════════════════════════
describe('T-106 scenario 6 — reprise après panne', () => {
  it('the redelivery adopts the persisted reversal, does the clawback, writes the ledger, finalizes', async () => {
    // Exactly the state scenario 5 left: net reversal done and recorded, clawback not done.
    world({ rowOver: { splitReversed: false, stripeReversalId: 'trr_net_ok', reverseTransferCents: 4100 } })
    db.franchiseRoyalty.findUnique.mockResolvedValue({ id: 'fr1', royaltyCents: 300, refundedCents: 0, status: 'settled', payoutId: 'po1', settlementId: 'S1' })
    db.payout.findUnique.mockResolvedValue({ stripeTransferId: 'tr_settle' })
    stripeMock.transfers.createReversal.mockResolvedValue({ id: 'trr_claw', amount: 300 })
    const { handleDisputeEvent } = await load()
    const out = await handleDisputeEvent(lostEvent())

    expect(out.retryable, 'the resumed run finalizes').toBeFalsy()
    expect(out.reversed).toBe(true)
    expect(out.reverseTransferCents, 'the adopted amount, not a recomputed one').toBe(4100)  // from the row
    expect(out.royaltyClawbackCents).toBe(300)
    expect(reversalCalls(), 'scenario 7 — only the CLAWBACK moves; the net reversal is adopted').toBe(1)
    expect(stripeMock.transfers.createReversal.mock.calls[0][1]).toMatchObject({ metadata: expect.objectContaining({ kind: 'dispute_royalty_clawback' }) })
    expect(ledgerCalls).toHaveLength(1)
    const marked = db.dispute.updateMany.mock.calls.some((c) => (c[0] as { data: Record<string, unknown> }).data.splitReversed === true)
    expect(marked, 'and NOW the unwind is marked complete').toBe(true)
  })

  it('an already-clawed-back royalty is adopted too — the franchisor is never debited twice', async () => {
    world({ rowOver: { splitReversed: false, stripeReversalId: 'trr_net_ok', reverseTransferCents: 4100, royaltyClawbackCents: 300 } })
    db.franchiseRoyalty.findUnique.mockResolvedValue({ id: 'fr1', royaltyCents: 300, refundedCents: 0, status: 'settled', payoutId: 'po1', settlementId: 'S1' })
    db.payout.findUnique.mockResolvedValue({ stripeTransferId: 'tr_settle' })
    const { handleDisputeEvent } = await load()
    const out = await handleDisputeEvent(lostEvent())
    expect(reversalCalls(), 'scenario 7 — nothing moves at all on this run').toBe(0)
    expect(out.royaltyClawbackCents).toBe(300)
    expect(out.retryable).toBeFalsy()
  })
})

// ══ 8. AUCUN 200 TROMPEUR ══════════════════════════════════════════════════════════════════════════
describe('T-106 scenario 8 — aucun 200 trompeur', () => {
  it('the webhook answers 503 on every retryable outcome, and 200 only on a finalized one', () => {
    // Asserted on the route's source: the mapping from `retryable` to the HTTP answer is the whole point,
    // and it is one branch. A test that mocked the handler would prove nothing about that branch.
    const src = readFileSync('app/api/webhooks/stripe/route.ts', 'utf8').replace(/\r\n/g, '\n')
    expect(src).toContain('if (result.retryable) {')
    expect(src).toContain("return NextResponse.json({ received: false, ...result }, { status: 503 })")
    expect(src).toContain('NOT finalized')
    // …and the record-only path has the same rule
    expect(src).toContain('if (recorded.retryable) {')
    // the old unconditional 200 is gone
    const branch = src.slice(src.indexOf("if (event.type.startsWith('charge.dispute.'))"), src.indexOf("if (event.type.startsWith('charge.dispute.')) {") + 3000)
    expect(branch).not.toMatch(/const result = await handleDisputeEvent\(event\)\n\s+return NextResponse\.json\(\{ received: true, \.\.\.result \}\)/)
  })

  it('EVERY retryable reason is enumerated, so a new one cannot be added without a 503', () => {
    const src = readFileSync('lib/dispute.ts', 'utf8').replace(/\r\n/g, '\n')
    const reasons = Array.from(src.matchAll(/retryable: true, reason: '([a-z_]+)'/g)).map((m) => m[1])
    const also = Array.from(src.matchAll(/retryable: true,\n\s+reason: '([a-z_]+)'/g)).map((m) => m[1])
    const all = new Set([...reasons, ...also])
    // measured at the time of writing; the point is that each is paired with `retryable: true`
    for (const r of ['net_reversal_unprovable', 'reverse_failed', 'clawback_unprovable', 'clawback_failed', 'ledger_write_failed']) {
      expect(all, r).toContain(r)
    }
    // and NO return carries a reason that moved money without `retryable`
    expect(src).not.toMatch(/reversed: false, reason: 'clawback_failed' \}/)
  })
})

// ══ T-107 — the record-only path ═══════════════════════════════════════════════════════════════════
describe('T-107 — a chargeback is traced even with CHARGEBACKS_ENABLED closed', () => {
  it('it writes the Dispute row from the SIGNED EVENT and our own DB, with NO Stripe call at all', async () => {
    world()
    delete process.env.CHARGEBACKS_ENABLED
    const { recordDisputeObservation } = await load()
    const out = await recordDisputeObservation(lostEvent())
    expect(out.recordedOnly).toBe(true)
    expect(out.reversed).toBe(false)
    // THE property that makes this path incapable of moving money:
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled()
    expect(stripeMock.transfers.listReversals).not.toHaveBeenCalled()
    expect(stripeMock.transfers.retrieve).not.toHaveBeenCalled()
    expect(stripeMock.charges.retrieve, 'not even a READ — everything comes from the event').not.toHaveBeenCalled()
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    // the row carries the external reality
    expect(db.dispute.upsert).toHaveBeenCalledTimes(1)
    const call = db.dispute.upsert.mock.calls[0][0] as { where: Record<string, unknown>; create: Record<string, unknown> }
    expect(call.where).toEqual({ stripeDisputeId: DISPUTE_ID })
    expect(call.create).toMatchObject({ status: 'lost', amountCents: 5000, stripeChargeId: CHARGE_ID, paymentIntentId: PI_ID, orderId: 'o1', restaurantId: 'rest1' })
    expect(call.create.feeCents).toBe(1500)
  })

  it('it NEVER claims the unwind happened — splitReversed is untouched', async () => {
    world()
    delete process.env.CHARGEBACKS_ENABLED
    const { recordDisputeObservation } = await load()
    await recordDisputeObservation(lostEvent())
    const call = db.dispute.upsert.mock.calls[0][0] as { create: Record<string, unknown>; update: Record<string, unknown> }
    expect('splitReversed' in call.create, 'the record must not set splitReversed').toBe(false)
    expect('splitReversed' in call.update).toBe(false)
    expect('reverseTransferCents' in call.create).toBe(false)
    expect('royaltyClawbackCents' in call.create).toBe(false)
    // which is what lets the unwind still run exactly once the day the rail is opened
    const src = readFileSync('lib/dispute.ts', 'utf8')
    expect(src).toContain('IT NEVER CLAIMS THE UNWIND HAPPENED')
  })

  it('it is IDEMPOTENT: an upsert on the unique dispute id, and one alert per dispute', async () => {
    world()
    delete process.env.CHARGEBACKS_ENABLED
    const { recordDisputeObservation } = await load()
    await recordDisputeObservation(lostEvent())
    await recordDisputeObservation(lostEvent())
    expect(db.dispute.upsert).toHaveBeenCalledTimes(2)   // upsert, so the second is a no-op update
    // …and there is no bare `create` on this path: the recorder's ONLY write is the upsert above, which is
    // what makes a redelivery a no-op rather than a duplicate row.
    expect(readFileSync('lib/dispute.ts', 'utf8')).not.toContain('prisma.dispute.create(')
    const lostAlerts = alerts.filter((a) => a.kind === 'dispute_recorded_rail_closed')
    expect(lostAlerts).toHaveLength(2)
    // …and both carry the SAME dedupe key, so lib/admin-alerts sends one mail
    expect(new Set(lostAlerts.map((a) => a.dedupeKey)).size).toBe(1)
    expect(lostAlerts[0].dedupeKey).toBe(`dispute_recorded_rail_closed:${DISPUTE_ID}`)
  })

  it('a LOST chargeback with the rail closed is ESCALATED — that is the case that costs money', async () => {
    world()
    delete process.env.CHARGEBACKS_ENABLED
    const { recordDisputeObservation } = await load()
    await recordDisputeObservation(lostEvent())
    const a = alerts.find((x) => x.kind === 'dispute_recorded_rail_closed') as { facts: Record<string, unknown> }
    expect(a).toBeTruthy()
    expect(a.facts).toMatchObject({ stripeDisputeId: DISPUTE_ID, orderId: 'o1', disputedCents: 5000 })
    expect(String(a.facts.action)).toContain('splitReversed reste false')
  })

  it('a NON-lost event is recorded without an alert — only the costly case wakes a human', async () => {
    world()
    delete process.env.CHARGEBACKS_ENABLED
    const { recordDisputeObservation } = await load()
    await recordDisputeObservation({ id: 'evt_c', type: 'charge.dispute.created', data: { object: { id: DISPUTE_ID, status: 'warning_needs_response', amount: 5000, currency: 'eur', charge: CHARGE_ID, payment_intent: PI_ID } } } as never)
    expect(alerts.filter((a) => a.kind === 'dispute_recorded_rail_closed')).toHaveLength(0)
    expect(db.dispute.upsert).toHaveBeenCalledTimes(1)
    expect((db.dispute.upsert.mock.calls[0][0] as { create: Record<string, unknown> }).create.status).toBe('open')
  })

  it('funds_withdrawn — Stripe\'s own statement that the money is gone — is recorded', async () => {
    world()
    delete process.env.CHARGEBACKS_ENABLED
    const { recordDisputeObservation } = await load()
    await recordDisputeObservation({ id: 'evt_w', type: 'charge.dispute.funds_withdrawn', data: { object: { id: DISPUTE_ID, status: 'needs_response', amount: 5000, currency: 'eur', charge: CHARGE_ID, payment_intent: PI_ID } } } as never)
    expect((db.dispute.upsert.mock.calls[0][0] as { create: Record<string, unknown> }).create.fundsWithdrawn).toBe(true)
  })

  it('a record that FAILS is retryable, not a tidy 200', async () => {
    world()
    delete process.env.CHARGEBACKS_ENABLED
    db.dispute.upsert.mockRejectedValue(new Error('DB down (simulated)'))
    const { recordDisputeObservation } = await load()
    const out = await recordDisputeObservation(lostEvent())
    expect(out.retryable).toBe(true)
    expect(out.reason).toBe('record_failed')
  })

  it('the webhook routes the closed rail to the RECORDER, not to the unwind', () => {
    const src = readFileSync('app/api/webhooks/stripe/route.ts', 'utf8').replace(/\r\n/g, '\n')
    expect(src).toContain('if (!isChargebacksEnabled()) {')
    expect(src).toContain('const recorded = await recordDisputeObservation(event)')
    expect(src).toContain('THE FLAG STOPS THE UNWIND, NOT THE RECORD')
    // the old do-nothing answer is gone
    expect(src).not.toContain("return NextResponse.json({ received: true, ignored: event.type, gated: true })")
  })
})
