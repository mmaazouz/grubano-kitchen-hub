// tests/claims-t49-round10.test.ts — T-49, round-10 fixes for the round-9 adversarial audit
//
// Round 9 ran to completion on 7c459eb: P0 0, P1 9. Four of the P1s were ONE absorbing state that
// round 9 itself introduced (our pending row with no Stripe id: no write, no Stripe read, no exit).
// The rest were the same classes again — a console control the server refuses (Class 3), copy that
// promises a mechanism the code does not reliably run (Class 1) — plus the status and delay copy a
// CUSTOMER reads. So the method changed instead of patching a tenth time:
//   • one shared rule per human action (lib/claim-action-rules), with PARITY tests below;
//   • an EXIT TABLE over every claim state: each has an action the server accepts, or a named path;
//   • evidence for every pending row: Stripe's refunds, by the engine's own tag or recorded id.
// Everything runs against the SHIPPED code with the operator-aware CAS mock.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync as readRaw } from 'node:fs'
import { updateManyMock, matchWhere } from './support/prisma-where'

/** CRLF-safe: the founder's checkout has core.autocrlf=true. */
const read = (p: string) => readRaw(p, 'utf8').replace(/\r\n/g, '\n')
/** Negative pins read CODE only: comments quote removed sentences on purpose (the audit record). */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const WINDOW = 20 * 60 * 60 * 1000

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))

const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

const { cronMock } = vi.hoisted(() => ({ cronMock: vi.fn() }))
vi.mock('@/lib/safe-compare', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isInternalCronRequest: cronMock,
}))

import {
  reconcileClaimEvidence, listActionableRefundClaims, listArbitrationQueue, arbitrateClaim, triggerClaimRefund,
  listConsumerClaims, isStuckResolvable, isRailLocked, isReconcileRequired, claimRefundReason,
  FINANCIAL_VERIFICATION, RECONCILE_REQUIRED, NO_REFUND_PROVEN, NO_REFUND_PROVEN_RAIL_LOCKED, ENGINE_ROW_DEAD,
  ENGINE_DEAD_MARGIN_MS, TERMINAL_STATUSES,
} from '@/lib/claims'
import {
  MARKERS, TERMINAL, reconcileRefusal, arbitrationRefusal, customerClaimStatus, moneyStateGuidance, type ClaimFacts,
} from '@/lib/claim-action-rules'
import { attributionRefusal } from '@/lib/claim-attribution-rules'
import { GET as CENSUS } from '@/app/api/admin/claims/census/route'

const fx: { row: Record<string, unknown> | null; forcedCount: number | null; applyWrites: boolean } =
  { row: null, forcedCount: null, applyWrites: true }

const MARKER = `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z — identité pas encore liée.`
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [
    db.claim.findUnique, db.claim.findFirst, db.claim.findMany, db.claim.count, db.claim.groupBy,
    db.refund.findFirst, db.refund.findUnique, db.refund.findMany, db.order.findUnique,
    stripeMock.refunds.list, stripeMock.refunds.retrieve, stripeMock.paymentIntents.retrieve,
  ]) m.mockReset()
  fx.row = null; fx.forcedCount = null; fx.applyWrites = true
  db.claim.findUnique.mockResolvedValue(null)
  db.claim.findFirst.mockResolvedValue(null)
  db.claim.updateMany.mockImplementation(updateManyMock(fx))
  db.claim.update.mockResolvedValue({})
  db.claim.findMany.mockResolvedValue([])
  db.claim.count.mockResolvedValue(0)
  db.claim.groupBy.mockResolvedValue([])
  db.refund.findMany.mockResolvedValue([])
  db.refund.findUnique.mockResolvedValue(null)
  db.refund.findFirst.mockResolvedValue(null)
  db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'r1', stripePaymentIntentId: 'pi_1' })
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 } })
  stripeMock.refunds.list.mockResolvedValue({ data: [], has_more: false })
  alertMock.mockResolvedValue({ status: 'sent' })
  auditMock.mockResolvedValue(undefined)
  refundsFlag.mockReturnValue(false)
  cronMock.mockReturnValue(true)
})

// ══ THE SHARED MODULE SPEAKS THE LIBRARY'S MARKERS ═══════════════════════════════════════
describe('the shared rules module speaks the library’s own markers', () => {
  it('every prefix and the terminal set are the library’s', () => {
    expect(MARKERS).toEqual({
      FINANCIAL_VERIFICATION, RECONCILE_REQUIRED, NO_REFUND_PROVEN, RAIL_LOCKED: NO_REFUND_PROVEN_RAIL_LOCKED, ENGINE_ROW_DEAD,
    })
    expect([...TERMINAL]).toEqual([...TERMINAL_STATUSES])
  })

  it('the crash marker is recognised exactly as lib/claims recognises it', () => {
    for (const e of [MARKER, RECONCILE_REQUIRED, 'engine_failed: x', 'financial_verification:x', 'resume_mismatch: x']) {
      const admitted = reconcileRefusal({ status: 'refunding', refundId: 'rf1', refundError: e }) === null
      expect(admitted, e).toBe(isReconcileRequired(e))
    }
  })
})

// ══ EXIT TABLE — every non-terminal state has a way out the server accepts ════════════════
const NOW = new Date('2026-09-11T12:00:00.000Z')
const PAST = new Date(NOW.getTime() - 3_600_000)
const FUTURE = new Date(NOW.getTime() + 3_600_000)
const S = (o: Partial<ClaimFacts> & { status: string }): ClaimFacts =>
  ({ refundAttempted: false, refundId: null, refundError: null, arbitrationDecision: null, responseDeadlineAt: PAST, ...o })

type Exit = 'reconcile' | 'stuck_close' | 'approve' | 'refuse_final' | 'attribute_or_adopt'
/** What the SERVER accepts on this claim — computed from the same rules the routes apply. */
function acceptedExits(c: ClaimFacts, now = NOW): Exit[] {
  const out: Exit[] = []
  if (reconcileRefusal(c) === null) out.push('reconcile')
  if (isStuckResolvable({ status: c.status, refundError: c.refundError ?? null })) out.push('stuck_close')
  if (arbitrationRefusal(c, 'approve', now) === null) out.push('approve')
  if (arbitrationRefusal(c, 'refuse_final', now) === null) out.push('refuse_final')
  // attributeClaimRefund and adoptStripeRefundForClaim accept exactly this status.
  if (c.status === FINANCIAL_VERIFICATION) out.push('attribute_or_adopt')
  return out
}

const A = 'approved'
const EXIT_TABLE: Array<{ state: string; claim: ClaimFacts; exits: Exit[]; note?: 'awaits_refund_rail' | 'deadline_then_arbitration' | 'decision_state_not_money' }> = [
  { state: 'restaurant_review — delay running', claim: S({ status: 'restaurant_review', responseDeadlineAt: FUTURE }), exits: [], note: 'deadline_then_arbitration' },
  { state: 'restaurant_review — delay expired', claim: S({ status: 'restaurant_review' }), exits: ['approve', 'refuse_final'] },
  { state: 'arbitration', claim: S({ status: 'arbitration' }), exits: ['approve', 'refuse_final'] },
  { state: 'approved, unpaid — legacy, no decision', claim: S({ status: A }), exits: ['approve', 'refuse_final'], note: 'awaits_refund_rail' },
  { state: 'approved, unpaid — admin-decided', claim: S({ status: A, arbitrationDecision: A }), exits: ['approve'], note: 'awaits_refund_rail' },
  { state: 'absence proven, payable', claim: S({ status: A, arbitrationDecision: A, refundError: `${NO_REFUND_PROVEN}: x` }), exits: ['approve'], note: 'awaits_refund_rail' },
  { state: 'rail locked — admin-decided', claim: S({ status: A, arbitrationDecision: A, refundError: `${NO_REFUND_PROVEN_RAIL_LOCKED}: x` }), exits: ['stuck_close'] },
  { state: 'rail locked — legacy, no decision', claim: S({ status: A, refundError: `${NO_REFUND_PROVEN_RAIL_LOCKED}: x` }), exits: ['stuck_close', 'refuse_final'] },
  { state: 'engine row dead', claim: S({ status: A, refundAttempted: true, refundId: 'rf1', arbitrationDecision: A, refundError: `${ENGINE_ROW_DEAD}: x` }), exits: ['stuck_close'] },
  { state: 'stripe failed, recorded', claim: S({ status: A, refundAttempted: true, refundId: 'rf1', arbitrationDecision: A, refundError: 'stripe_failed: x' }), exits: ['stuck_close'] },
  { state: 'engine failed, recorded', claim: S({ status: A, refundAttempted: true, arbitrationDecision: A, refundError: 'engine_failed: x' }), exits: ['stuck_close'] },
  { state: 'approved — attempt taken, nothing recorded', claim: S({ status: A, refundAttempted: true, arbitrationDecision: A }), exits: ['reconcile'] },
  { state: 'approved — bound, no error', claim: S({ status: A, refundAttempted: true, refundId: 'rf1', arbitrationDecision: A }), exits: ['reconcile'] },
  { state: 'refunding — crash marker', claim: S({ status: 'refunding', refundAttempted: true, arbitrationDecision: A, refundError: MARKER }), exits: ['reconcile'] },
  { state: 'refunding — legacy stranded', claim: S({ status: 'refunding', refundAttempted: true }), exits: ['reconcile'] },
  { state: 'refunding — bound, no error (pending, failed, succeeded or missing row)', claim: S({ status: 'refunding', refundAttempted: true, refundId: 'rf1' }), exits: ['reconcile'] },
  { state: 'refunding — resume mismatch', claim: S({ status: 'refunding', refundAttempted: true, refundId: 'rf9', refundError: 'resume_mismatch: x' }), exits: ['stuck_close'] },
  { state: 'financial verification', claim: S({ status: FINANCIAL_VERIFICATION, refundAttempted: true, refundError: 'financial_verification:stripe_unreadable: x' }), exits: ['reconcile', 'attribute_or_adopt'] },
  { state: 'refused by the restaurant', claim: S({ status: 'refused' }), exits: [], note: 'decision_state_not_money' },
]

describe('EXIT TABLE — every non-terminal claim state has a way out the server accepts', () => {
  for (const row of EXIT_TABLE) {
    it(`${row.state} → ${row.exits.join(' + ') || row.note}`, () => {
      expect(acceptedExits(row.claim)).toEqual(row.exits)
      expect(row.exits.length > 0 || !!row.note, 'a state no action leads out of must name its documented path').toBe(true)
    })
  }

  it('terminal states, and only they, carry neither an exit nor a note', () => {
    for (const status of TERMINAL_STATUSES) expect(acceptedExits(S({ status })), status).toEqual([])
  })

  it('the documented non-human path is real: once the restaurant’s delay passes, arbitration accepts both decisions', () => {
    const running = EXIT_TABLE.find((r) => r.note === 'deadline_then_arbitration')!.claim
    const after = new Date(FUTURE.getTime() + 1)
    expect(arbitrationRefusal(running, 'approve', after)).toBeNull()
    expect(arbitrationRefusal(running, 'refuse_final', after)).toBeNull()
  })

  it('« awaits the refund rail » is stated, not hidden: with REFUNDS closed an approval pays nothing and writes nothing', async () => {
    refundsFlag.mockReturnValue(false)
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'pending', reason: 'refunds_disabled' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
  })
})

// ══ PARITY — the consoles carry exactly the server's verdicts ════════════════════════════
describe('ARBITRATION PARITY — the queue carries exactly the refusal the server returns', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
  afterEach(() => { vi.useRealTimers() })

  it('for every state and both decisions: listed verdict === server verdict, and a lost CAS is the only other answer', async () => {
    const shapes = EXIT_TABLE.map((r, i) => ({
      ...r.claim, id: `cl${i}`, orderId: `o${i}`, consumerId: 'u1', restaurantId: 'r1', reason: 'wrong_item', requestedAmountCents: 500, createdAt: PAST,
    }))
    db.claim.findMany.mockImplementation(async (args?: { where?: { OR?: unknown } }) => (args?.where?.OR ? shapes : []))
    const queue = await listArbitrationQueue()
    expect(queue).toHaveLength(shapes.length)

    fx.row = null; fx.forcedCount = 0 // every CAS loses: no call can reach the engine
    let refusals = 0
    for (const listed of queue) {
      db.claim.findUnique.mockResolvedValue(shapes.find((s) => s.id === listed.id))
      const pairs: Array<['approve' | 'refuse_final', string | null]> = [['approve', listed.approveRefusal], ['refuse_final', listed.refuseFinalRefusal]]
      for (const [decision, verdict] of pairs) {
        const server = await arbitrateClaim({ claimId: listed.id, adminId: 'op1', decision })
        if (verdict) { refusals++; expect(server, `${listed.id} ${decision}`).toEqual({ ok: false, status: 409, error: verdict }) }
        else expect(server, `${listed.id} ${decision}`).toEqual({ ok: false, status: 409, error: 'Cette réclamation a déjà été arbitrée.' })
      }
    }
    expect(refusals).toBeGreaterThan(0)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('the rail-locked claim that round 9 left with « Refuser » live: both decisions are refused, both are disabled', () => {
    const rail = EXIT_TABLE.find((r) => r.state === 'rail locked — admin-decided')!.claim
    expect(arbitrationRefusal(rail, 'approve', NOW)).not.toBeNull()
    expect(arbitrationRefusal(rail, 'refuse_final', NOW)).not.toBeNull()
  })
})

describe('RECONCILE PARITY — the button appears exactly where the server’s gate admits the claim', () => {
  it('for every approved / refunding state: `reconcilable` === the server did not return the gate refusal', async () => {
    const GATE = 'Cette réclamation n’est pas en attente de réconciliation.'
    const shapes = EXIT_TABLE.filter((r) => ['approved', 'refunding'].includes(r.claim.status)).map((r, i) => ({
      ...r.claim, id: `cl${i}`, orderId: 'o1', consumerId: 'u1', restaurantId: 'r1', reason: 'wrong_item', requestedAmountCents: 500, createdAt: PAST,
    }))
    db.claim.findMany.mockResolvedValue(shapes)
    const listed = await listActionableRefundClaims()
    expect(listed).toHaveLength(shapes.length)

    // Admitted claims run to a park without Stripe; every CAS loses, so nothing is written either way.
    db.order.findUnique.mockResolvedValue({ id: 'o1', stripePaymentIntentId: null })
    fx.row = null; fx.forcedCount = 0
    let admitted = 0, refused = 0
    for (const l of listed) {
      db.claim.findUnique.mockResolvedValue(shapes.find((s) => s.id === l.id))
      const server = await reconcileClaimEvidence({ claimId: l.id })
      const refusedByGate = !server.ok && (server as { error?: string }).error === GATE
      expect(refusedByGate, l.id).toBe(!l.reconcilable)
      if (l.reconcilable) { admitted++; expect(server.ok, l.id).toBe(true) } else refused++
    }
    expect(admitted).toBeGreaterThan(0)
    expect(refused).toBeGreaterThan(0)
  })
})

// ══ A PENDING ROW IS DECIDED BY STRIPE — round 9's absorbing state, removed ═══════════════
const OWN = (o: Record<string, unknown> = {}) => ({
  id: 'rf1', orderId: 'o1', status: 'pending', amountCents: 500, stripeRefundId: null as string | null,
  reason: claimRefundReason('cl1'), createdAt: new Date(Date.now() - 3_600_000), ...o,
})
const MARKED = { id: 'cl1', orderId: 'o1', status: 'refunding', refundAttempted: true, refundId: null, requestedAmountCents: 500, refundError: MARKER }
const stripeRefund = (status: string, o: Record<string, unknown> = {}) =>
  ({ id: 're_T', status, amount: 500, payment_intent: 'pi_1', metadata: { grubano_refund_row: 'rf1' }, ...o })

describe('OUR PENDING ROW, NO STRIPE ID — Stripe decides by the engine’s own tag, and every answer has an exit', () => {
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ ...MARKED })
    fx.row = { status: 'refunding', refundAttempted: true, refundId: null, refundError: MARKER, activeOrderKey: 'o1' }
  })

  it('Stripe unreadable → nothing concluded, nothing written; the claim stays reconcilable', async () => {
    db.refund.findMany.mockResolvedValue([OWN()])
    stripeMock.refunds.list.mockRejectedValue(new Error('stripe down'))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'stripe_unreadable_retry', refundId: 'rf1' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(reconcileRefusal(fx.row as ClaimFacts)).toBeNull()
  })

  it('a truncated list is PAGED, never read as complete — the tag on page 2 is found', async () => {
    db.refund.findMany.mockResolvedValue([OWN()])
    stripeMock.refunds.list
      .mockResolvedValueOnce({ data: [{ id: 're_other', status: 'succeeded', amount: 100, metadata: {} }], has_more: true })
      .mockResolvedValueOnce({ data: [stripeRefund('succeeded')], has_more: false })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf1' })
    expect(stripeMock.refunds.list.mock.calls[1][0]).toMatchObject({ payment_intent: 'pi_1', starting_after: 're_other' })
  })

  it('…and a list longer than the page cap proves nothing', async () => {
    db.refund.findMany.mockResolvedValue([OWN()])
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: 're_x', status: 'succeeded', amount: 1, metadata: {} }], has_more: true })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ outcome: 'stripe_unreadable_retry' })
    expect(stripeMock.refunds.list).toHaveBeenCalledTimes(10)
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('the tagged refund SUCCEEDED → the claim is refunded, bound, and the order released', async () => {
    db.refund.findMany.mockResolvedValue([OWN()])
    stripeMock.refunds.list.mockResolvedValue({ data: [stripeRefund('succeeded', { amount: 480 })], has_more: false })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'refunded', refundId: 'rf1', amountCents: 480 })
    expect(fx.row).toMatchObject({ status: 'refunded', refundId: 'rf1', refundError: null, activeOrderKey: null })
  })

  it('the tagged refund FAILED or was CANCELED → approved with the Stripe failure recorded — closable', async () => {
    for (const s of ['failed', 'canceled']) {
      fx.row = { status: 'refunding', refundAttempted: true, refundId: null, refundError: MARKER }
      db.refund.findMany.mockResolvedValue([OWN()])
      stripeMock.refunds.list.mockResolvedValue({ data: [stripeRefund(s)], has_more: false })
      expect(await reconcileClaimEvidence({ claimId: 'cl1' }), s).toEqual({ ok: true, outcome: 'refund_failed', refundId: 'rf1' })
      expect(fx.row, s).toMatchObject({ status: 'approved', refundId: 'rf1' })
      expect(String(fx.row!.refundError).startsWith('stripe_failed:'), s).toBe(true)
      expect(isStuckResolvable(fx.row as { status: string; refundError: string }), s).toBe(true)
    }
  })

  it('the tagged refund is PENDING at Stripe → bound, marker cleared, still reconcilable (re-run once terminal)', async () => {
    db.refund.findMany.mockResolvedValue([OWN()])
    stripeMock.refunds.list.mockResolvedValue({ data: [stripeRefund('pending')], has_more: false })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'still_pending', refundId: 'rf1' })
    expect(fx.row).toMatchObject({ status: 'refunding', refundId: 'rf1', refundError: null })
    expect(reconcileRefusal(fx.row as ClaimFacts)).toBeNull()
  })

  it('NOT at Stripe, past the window but inside the margin → says from when it can conclude, writes nothing', async () => {
    const createdAt = new Date(Date.now() - WINDOW - ENGINE_DEAD_MARGIN_MS / 2)
    db.refund.findMany.mockResolvedValue([OWN({ createdAt })])
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({
      ok: true, outcome: 'unconfirmed_within_window', refundId: 'rf1',
      until: new Date(createdAt.getTime() + WINDOW + ENGINE_DEAD_MARGIN_MS).toISOString(),
    })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('NOT at Stripe, past the window AND the margin → the row is dead: approved, bound, closable, never re-approvable', async () => {
    const createdAt = new Date(Date.now() - WINDOW - ENGINE_DEAD_MARGIN_MS - 60_000)
    db.refund.findMany.mockResolvedValue([OWN({ createdAt })])
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'engine_row_dead', refundId: 'rf1' })
    expect(fx.row).toMatchObject({ status: 'approved', refundId: 'rf1', refundAttempted: true })
    const e = String(fx.row!.refundError)
    expect(e.startsWith(`${ENGINE_ROW_DEAD}:`)).toBe(true)
    expect(e).toContain('rf1')
    expect(e).toContain('Clôturer ce dossier')
    const after = { ...(fx.row as ClaimFacts), arbitrationDecision: 'approved' }
    expect(acceptedExits(after)).toEqual(['stuck_close'])
  })
})

describe('OUR PENDING ROW WITH A STRIPE ID — read by that id, as the engine does', () => {
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ ...MARKED })
    fx.row = { status: 'refunding', refundAttempted: true, refundId: null, refundError: MARKER, activeOrderKey: 'o1' }
    db.refund.findMany.mockResolvedValue([OWN({ stripeRefundId: 're_1' })])
  })

  it('succeeded → refunded, and the list is not consulted', async () => {
    stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund('succeeded', { id: 're_1' }))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf1' })
    expect(stripeMock.refunds.retrieve).toHaveBeenCalledWith('re_1')
    expect(stripeMock.refunds.list).not.toHaveBeenCalled()
  })

  it('Stripe does not know that id → parked with the contradiction, never « retry for ever »', async () => {
    stripeMock.refunds.retrieve.mockRejectedValue(Object.assign(new Error('No such refund'), { statusCode: 404, code: 'resource_missing' }))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'stripe_refund_contradiction' })
    expect(fx.row!.status).toBe(FINANCIAL_VERIFICATION)
    expect(acceptedExits(fx.row as ClaimFacts)).toEqual(['reconcile', 'attribute_or_adopt'])
  })

  it('the refund sits on ANOTHER payment → parked, never applied', async () => {
    stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund('succeeded', { id: 're_1', payment_intent: 'pi_OTHER' }))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ outcome: 'financial_verification', reason: 'stripe_refund_contradiction' })
    expect(fx.row!.status).not.toBe('refunded')
  })

  it('a transient read error → nothing written, re-run', async () => {
    stripeMock.refunds.retrieve.mockRejectedValue(new Error('ETIMEDOUT'))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'stripe_unreadable_retry', refundId: 'rf1' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('a CANCELED row in our table paid nothing → the reconciler’s failed path, closable', async () => {
    db.refund.findMany.mockResolvedValue([OWN({ status: 'canceled', stripeRefundId: 're_1' })])
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: MARKER })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refund_failed', refundId: 'rf1' })
    expect(isStuckResolvable(fx.row as { status: string; refundError: string })).toBe(true)
  })
})

// ══ A CLAIM BOUND TO A ROW, WITH NO ERROR — it had no human exit at all ═══════════════════
describe('A CLAIM BOUND TO A ROW, NO ERROR — reconcile applies that row’s truth', () => {
  const BOUND = { id: 'cl1', orderId: 'o1', status: 'refunding', refundAttempted: true, refundId: 'rf1', requestedAmountCents: 500, refundError: null }
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ ...BOUND })
    fx.row = { status: 'refunding', refundAttempted: true, refundId: 'rf1', refundError: null, activeOrderKey: 'o1' }
  })

  it('Stripe reports the bound refund succeeded and the webhook never came → refunded', async () => {
    db.refund.findUnique.mockResolvedValue(OWN({ stripeRefundId: 're_1' }))
    stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund('succeeded', { id: 're_1' }))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf1' })
    expect(fx.row).toMatchObject({ status: 'refunded', activeOrderKey: null })
    // the order's other rows are not this claim's question
    expect(db.refund.findMany).not.toHaveBeenCalled()
  })

  it('the bound row FAILED in our table → recorded as failed by the reconciler, and the claim becomes closable', async () => {
    db.refund.findUnique.mockResolvedValue(OWN({ status: 'failed', stripeRefundId: 're_1' }))
    db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', refundError: null })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refund_failed', refundId: 'rf1' })
    expect(isStuckResolvable(fx.row as { status: string; refundError: string })).toBe(true)
  })

  it('the bound row is not on this order → parked, where a refund can be linked', async () => {
    db.refund.findUnique.mockResolvedValue(OWN({ orderId: 'o_OTHER' }))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'bound_row_missing' })
    expect(fx.row!.status).toBe(FINANCIAL_VERIFICATION)
  })
})

// ══ NO ROW IS OURS — a dead pending row of the order no longer blocks the proof for ever ═══
describe('NO ROW IS OURS — a dead pending row no longer blocks the proof of absence', () => {
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ ...MARKED })
    fx.row = { status: 'refunding', refundAttempted: true, refundId: null, refundError: MARKER }
  })
  const adminRow = (createdAt: Date) => ({ id: 'rf_admin', orderId: 'o1', status: 'pending', amountCents: 300, stripeRefundId: null, reason: 'admin:x', createdAt })

  it('Stripe reports nothing and the order’s only pending row is dead → proof of absence, locked by that row, closable', async () => {
    db.refund.findMany.mockResolvedValue([adminRow(new Date(Date.now() - WINDOW - ENGINE_DEAD_MARGIN_MS - 60_000))])
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'no_refund_proven_rail_locked' })
    expect(fx.row).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
    const e = String(fx.row!.refundError)
    expect(isRailLocked(e)).toBe(true)
    expect(e).toContain('rf_admin')
    expect(isStuckResolvable({ status: 'approved', refundError: e })).toBe(true)
  })

  it('the same row still inside the window → nothing concluded, nothing written, and from when', async () => {
    const createdAt = new Date(Date.now() - 3_600_000)
    db.refund.findMany.mockResolvedValue([adminRow(createdAt)])
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({
      ok: true, outcome: 'unconfirmed_within_window', refundId: null,
      until: new Date(createdAt.getTime() + WINDOW + ENGINE_DEAD_MARGIN_MS).toISOString(),
    })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('that row’s refund IS at Stripe → not absence: parked, never « nothing left »', async () => {
    db.refund.findMany.mockResolvedValue([adminRow(new Date(Date.now() - WINDOW - ENGINE_DEAD_MARGIN_MS - 60_000))])
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: 're_A', status: 'pending', amount: 300, payment_intent: 'pi_1', metadata: { grubano_refund_row: 'rf_admin' } }], has_more: false })
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'financial_verification' })
    expect(fx.row!.refundAttempted).toBe(true)
  })
})

// ══ THE GATE — an attempt taken with nothing recorded is money-unknown ═══════════════════
describe('RECONCILE GATE — an approval whose attempt was taken with nothing recorded', () => {
  it('is admitted, and the evidence runs', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', status: 'approved', refundAttempted: true, refundId: null, requestedAmountCents: 500, refundError: null })
    fx.row = { status: 'approved', refundAttempted: true, refundId: null, refundError: null }
    await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(db.refund.findMany).toHaveBeenCalled()
  })

  it('the classifier calls it reconcile_required, not « jamais payée »; an approval bound to a missing row is stale', async () => {
    db.claim.findMany.mockResolvedValue([
      { id: 'a', orderId: 'o1', status: 'approved', refundAttempted: true, refundId: null, refundError: null, reason: 'wrong_item', createdAt: PAST },
      { id: 'b', orderId: 'o1', status: 'approved', refundAttempted: true, refundId: 'rf_gone', refundError: null, reason: 'wrong_item', createdAt: PAST },
      { id: 'c', orderId: 'o1', status: 'approved', refundAttempted: false, refundId: null, refundError: null, reason: 'wrong_item', createdAt: PAST },
    ])
    const byId = Object.fromEntries((await listActionableRefundClaims()).map((c) => [c.id, c]))
    expect([byId.a.moneyState, byId.b.moneyState, byId.c.moneyState]).toEqual(['reconcile_required', 'stale_refunding_no_refund_row', 'approved_not_driven'])
    expect([byId.a.reconcilable, byId.b.reconcilable, byId.c.reconcilable]).toEqual([true, true, false])
  })
})

// ══ GUIDANCE AND COPY — facts and accepted actions, never a mechanism that may not run ═════
const MONEY_STATES = [
  'reconcile_required', 'stripe_pending', 'local_pending_unconfirmed', 'stripe_failed', 'stripe_succeeded_claim_unreconciled',
  'stale_refunding_no_refund_row', 'approved_not_driven', 'absence_proven_payable', 'refund_error_recorded',
]
const PROMISES = [/l[’']appliquera/i, /sera appliqu[ée]e? par/i, /la reprend/i, /son webhook/i, /balayage de récupération/i]

describe('GUIDANCE — one fact-only line per money state, shared by both consoles', () => {
  it('the classifier’s union is exactly the guided set', () => {
    const src = stripComments(read('lib/claims.ts'))
    const block = src.slice(src.indexOf('let moneyState:'), src.indexOf('if (isReconcileRequired(c.refundError)) moneyState'))
    const union = Array.from(block.matchAll(/'([a-z_]+)'/g)).map((m) => m[1]).sort()
    expect(union).toEqual([...MONEY_STATES].sort())
  })

  it('every state has its own line, and none promises a mechanism', () => {
    const fallback = moneyStateGuidance('__unknown__')
    for (const s of MONEY_STATES) {
      const g = moneyStateGuidance(s)
      expect(g, s).not.toBe(fallback)
      for (const re of PROMISES) expect(g, `${s} ${re}`).not.toMatch(re)
    }
  })

  it('no shipped console or rule string promises that a webhook, the sweep or the engine will act (comments excluded)', () => {
    for (const f of ['components/claims/AdminFinancialVerification.tsx', 'components/claims/AdminClaimsArbitration.tsx', 'lib/claim-attribution-rules.ts', 'lib/claim-action-rules.ts']) {
      const code = stripComments(read(f))
      const hits = PROMISES.flatMap((re) => { const m = code.match(re); return m ? [`${re} → « ${m[0]} »`] : [] })
      expect(hits, f).toEqual([])
    }
  })

  it('NEGATIVE CONTROL — the round-9 sentences would be caught', () => {
    const caught = (s: string) => PROMISES.some((re) => re.test(s))
    expect(caught('Elle n’avancera que si Stripe a réellement créé ce remboursement (son webhook l’appliquera)')).toBe(true)
    expect(caught('ou si le moteur de remboursement la reprend (fenêtre remboursements ouverte)')).toBe(true)
    expect(caught('son sort sera appliqué par la réconciliation (webhook Stripe, ou le balayage de récupération lorsqu’il est déclenché)')).toBe(true)
  })

  it('the attribution rule’s refusal names the action that reads the evidence', () => {
    const r = attributionRefusal({ claimId: 'cl1', row: { id: 'rf1', status: 'pending', reason: claimRefundReason('cl1'), stripeRefundId: null }, orderRows: [{ id: 'rf1', reason: claimRefundReason('cl1') }], boundToOtherClaimId: null })
    expect(r?.code).toBe('pending_unconfirmed')
    expect(r?.message).toContain('Réconcilier d’après la preuve')
  })

  it('both consoles render the shared line', () => {
    expect(read('components/claims/AdminClaimsArbitration.tsx')).toContain('{moneyStateGuidance(r.moneyState)}')
    expect(read('components/claims/AdminFinancialVerification.tsx')).toContain("moneyStateGuidance(r.moneyState ?? '')")
  })
})

// ══ THE CUSTOMER — « en cours » only when a refund is bound to a row Stripe confirmed ══════
describe('CUSTOMER STATUS — never the raw recovery state', () => {
  it('the table', () => {
    const T: Array<[ClaimFacts, boolean | null, string]> = [
      [{ status: 'refunding', refundId: 'rf1', refundError: null }, true, 'refunding'],
      [{ status: 'refunding', refundId: 'rf1', refundError: null }, false, FINANCIAL_VERIFICATION],
      [{ status: 'refunding', refundId: 'rf1', refundError: null }, null, FINANCIAL_VERIFICATION],
      [{ status: 'refunding', refundId: null, refundError: MARKER }, true, FINANCIAL_VERIFICATION],
      [{ status: 'refunding', refundId: 'rf9', refundError: 'resume_mismatch: x' }, true, FINANCIAL_VERIFICATION],
      [{ status: 'approved', refundError: 'engine_failed: x' }, null, FINANCIAL_VERIFICATION],
      [{ status: 'approved', refundError: `${ENGINE_ROW_DEAD}: x` }, null, FINANCIAL_VERIFICATION],
      [{ status: 'approved', refundError: null }, null, 'approved'],
      [{ status: FINANCIAL_VERIFICATION, refundError: 'x' }, null, FINANCIAL_VERIFICATION],
      [{ status: 'refunded' }, null, 'refunded'],
      [{ status: 'refused_final' }, null, 'refused_final'],
      [{ status: 'restaurant_review' }, null, 'restaurant_review'],
    ]
    for (const [c, confirmed, want] of T) expect(customerClaimStatus(c, confirmed), `${JSON.stringify(c)} ${confirmed}`).toBe(want)
  })

  it('the customer list carries the derived status and none of the internal recovery fields', async () => {
    db.claim.findMany.mockResolvedValue([
      { id: 'a', status: 'refunding', refundId: 'rfA', refundError: null, refundAttempted: true, activeOrderKey: 'o1', arbitratedBy: null },
      { id: 'b', status: 'refunding', refundId: 'rfB', refundError: null, refundAttempted: true, activeOrderKey: 'o2', arbitratedBy: null },
      { id: 'c', status: 'approved', refundId: null, refundError: 'engine_failed: Erreur paiement', refundAttempted: true, activeOrderKey: 'o3', arbitratedBy: 'op1' },
      { id: 'd', status: 'refunding', refundId: null, refundError: MARKER, refundAttempted: true, activeOrderKey: 'o4', arbitratedBy: null },
      { id: 'e', status: 'refunded', refundId: 'rfE', refundError: null, refundAttempted: true, activeOrderKey: null, arbitratedBy: null },
    ])
    db.refund.findMany.mockResolvedValue([{ id: 'rfA', stripeRefundId: 're_A' }, { id: 'rfB', stripeRefundId: null }])
    const out = await listConsumerClaims('u1')
    expect(out.map((c) => [c.id, c.status])).toEqual([
      ['a', 'refunding'], ['b', FINANCIAL_VERIFICATION], ['c', FINANCIAL_VERIFICATION], ['d', FINANCIAL_VERIFICATION], ['e', 'refunded'],
    ])
    for (const c of out) for (const k of ['refundError', 'refundId', 'refundAttempted', 'activeOrderKey', 'arbitratedBy']) expect(c, `${c.id} ${k}`).not.toHaveProperty(k)
  })

  it('eligibility derives the status too, the help page reads the review state as a review, and every locale has its line', () => {
    expect(read('lib/claims.ts')).toContain('status: customerClaimStatus(existing, existingBoundConfirmed)')
    expect(read('app/[locale]/eat/order/[orderId]/help/page.tsx')).toContain("if (ex.status === 'financial_verification') return t('claimInReview')")
    for (const loc of LOCALES) expect(typeof JSON.parse(read(`messages/${loc}.json`)).claims.status.financial_verification, loc).toBe('string')
  })

  it('the requested-amount line promises no delay, in any locale', () => {
    for (const loc of LOCALES) {
      const v = JSON.parse(read(`messages/${loc}.json`)).eat.help.refundEstimate as string
      expect(v, loc).toContain('<b>{amount} €</b>')
      expect(v, loc).not.toMatch(/3[–-]5|jours|days|días|giorni|أيام/)
    }
  })
})

// ══ CENSUS — nonTerminal from the library's terminal set ═════════════════════════════════
describe('CENSUS — nonTerminal is the total minus the library’s terminal set', () => {
  it('a refused claim, non-terminal in the library, is counted', async () => {
    db.claim.count.mockImplementation(async (args?: unknown) => (args ? 0 : 7))
    db.claim.groupBy.mockResolvedValue([
      { status: 'refused', _count: 2 }, { status: 'refunded', _count: 3 }, { status: 'refused_final', _count: 1 }, { status: 'arbitration', _count: 1 },
    ])
    const res = await CENSUS(new Request('https://app.grubano.com/api/admin/claims/census') as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.claims.nonTerminal).toBe(3)
    expect(body.claims.active).toBe(1)
  })

  it('NEGATIVE CONTROL — the round-9 formula is gone', () => {
    expect(stripComments(read('app/api/admin/claims/census/route.ts'))).not.toMatch(/nonTerminal:\s*active/)
  })
})

// ══ ENGINE FAILURE — the own-row query and a stale read (round-9 P3) ═════════════════════
describe('ENGINE FAILURE — the own-row query honours its clauses, and a stale read writes nothing', () => {
  beforeEach(() => {
    refundsFlag.mockReturnValue(true)
    fx.row = { status: 'approved', refundAttempted: false, refundId: null, refundError: null }
    execMock.mockResolvedValue({ ok: false, status: 502, error: 'Erreur paiement, réessayez.' })
  })

  it('the NEWEST row stamped for THIS claim decides — not an older one, not another claim’s', async () => {
    const ROWS = [
      { id: 'rf_old_failed', orderId: 'o1', reason: claimRefundReason('cl1'), status: 'failed', createdAt: new Date(1000) },
      { id: 'rf_new_pending', orderId: 'o1', reason: claimRefundReason('cl1'), status: 'pending', createdAt: new Date(2000) },
      { id: 'rf_other_newest', orderId: 'o1', reason: claimRefundReason('cl_OTHER'), status: 'failed', createdAt: new Date(3000) },
    ]
    db.refund.findFirst.mockImplementation(async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { createdAt?: 'asc' | 'desc' } }) => {
      const dir = orderBy?.createdAt === 'desc' ? -1 : 1
      return ROWS.filter((r) => matchWhere(where, r)).sort((a, b) => dir * (a.createdAt.getTime() - b.createdAt.getTime()))[0] ?? null
    })
    db.claim.findUnique
      .mockImplementationOnce(async () => ({ orderId: 'o1', requestedAmountCents: 500 }))
      .mockImplementation(async () => ({ refundError: fx.row!.refundError }))
    await triggerClaimRefund('cl1')
    expect(fx.row!.status).toBe('refunding')
    expect(String(fx.row!.refundError)).toContain('rf_new_pending')
    expect(db.claim.update).not.toHaveBeenCalled()
  })

  it('a stale read of the marker writes nothing: the append is keyed on the marker it read', async () => {
    db.refund.findFirst.mockResolvedValue({ id: 'rf_own', status: 'pending' })
    db.claim.findUnique
      .mockImplementationOnce(async () => ({ orderId: 'o1', requestedAmountCents: 500 }))
      .mockImplementation(async () => ({ refundError: `${RECONCILE_REQUIRED}: an OLDER marker` }))
    await triggerClaimRefund('cl1')
    expect(fx.row!.status).toBe('refunding')
    expect(String(fx.row!.refundError)).not.toContain('Moteur :')
    expect(db.claim.update).not.toHaveBeenCalled()
  })
})

// ══ ROUND-10 SOURCE PINS ═════════════════════════════════════════════════════════════════
describe('round-10 source pins', () => {
  it('the arbitration console enables each decision on the server’s verdict — no hand-picked flag', () => {
    const arb = read('components/claims/AdminClaimsArbitration.tsx')
    expect(arb).toContain('disabled={c.approveRefusal != null}')
    expect(arb).toContain('disabled={busyId === c.id || c.refuseFinalRefusal != null}')
    expect(stripComments(arb)).not.toContain('railLocked === true')
  })

  it('arbitrateClaim keeps no pre-check of its own beside the shared rule', () => {
    const src = stripComments(read('lib/claims.ts'))
    const body = src.slice(src.indexOf('export async function arbitrateClaim'), src.indexOf('export type ConsumerClaimStats'))
    expect(body).toContain('arbitrationRefusal(claim, input.decision, now)')
    for (const msg of ['décision définitive', 'arbitrage prématuré', 'n’est pas en arbitrage', 'ne peut plus être refusée', 'Approbation impossible']) {
      expect(body, msg).not.toContain(msg)
    }
  })

  it('the reconcile route’s gate is the shared rule', () => {
    const src = stripComments(read('lib/claims.ts'))
    const body = src.slice(src.indexOf('export async function reconcileClaimEvidence'), src.indexOf('export async function recoverStrandedClaimReconciliations'))
    expect(body).toContain('const gate = reconcileRefusal(claim)')
    expect(body).not.toContain('legacyStranded')
  })

  it('the financial-verification card offers reconcile and the declaration close on the server’s own flags', () => {
    const fv = read('components/claims/AdminFinancialVerification.tsx')
    expect(fv).toContain("{(r.kind !== 'other_unsettled' || r.reconcilable === true) && (")
    expect(fv).toContain("{r.kind === 'other_unsettled' && r.resolvable === true && (")
    expect(fv).toContain('`/api/admin/claims/${id}/resolve-stuck`')
  })
})
