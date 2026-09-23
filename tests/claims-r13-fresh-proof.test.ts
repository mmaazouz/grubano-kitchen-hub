// tests/claims-r13-fresh-proof.test.ts — T-49 round 13, slice W2: J-M20 (C3 (e')(f), C4, D2 (4)-(5)).
//
// HARD INVARIANT: a payable proof is revalidated from fresh Stripe and DB truth immediately before any money
// authority. The claim carries a v13 proof past its quiescence instant (arbitrationRefusal null); T1 takes the
// attempt; then ONE change lands between T1 and T2's reads. The engine must never be called on a stale proof.
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
const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn() }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { triggerClaimRefund } from '@/lib/claims'
import { MARKERS, HEAD_A, arbitrationRefusal, acceptedExits, APPROVE_ALREADY_SET } from '@/lib/claim-action-rules'
import { approvalToast } from '@/lib/claim-approval-toast'

const INSTANT = new Date(Date.now() - 60_000)
const V13 = `${MARKERS.PROOF_PAYABLE_V13} ${HEAD_A} … Elle est payable au plus tôt le ${INSTANT.toISOString()} (UTC).`
const causes = () => (alertMock.mock.calls as Array<[{ kind: string; facts: { cause?: string } }]>).map((c) => `${c[0].kind}:${c[0].facts.cause ?? ''}`)

let w: World
beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [execMock, alertMock, refundsFlag]) m.mockReset()
  refundsFlag.mockReturnValue(true)
  alertMock.mockResolvedValue({ status: 'sent' })
  execMock.mockResolvedValue(engineOk())
  w = payableWorld({ refundError: V13 })
  wireWorld(w, db, stripeMock)
})

/** Injects ONE change right after T1's attempt CAS, before any T2 read. */
const inject = (change: (x: World) => void) => { w.beforeClaimWrite = (n) => { if (n === 1) change(w) } }

describe('J-M20 — a payable proof invalidated between approval and the money call never reaches the engine', () => {
  it('the fixture is PAYABLE: the v13 proof is past its instant, and D′ L4 sends it to the rail (the amount is ratified) instead of to a re-approval', () => {
    const facts = { ...claimOf(w), status: 'approved' }
    // D′ L4 (S-29): the amount is fixed on this row, so « Approuver » is closed and « Payer » is the exit…
    expect(arbitrationRefusal(facts as never, 'approve', new Date())).toEqual({ status: 409, error: APPROVE_ALREADY_SET })
    expect(acceptedExits({ claim: facts as never, now: new Date() })).toContain('pay')
    // … while the SAME proof with no amount fixed is still ratifiable: the C4 instant has passed (the property
    // this fixture is built on, and the reason T1 admits the attempt below).
    expect(arbitrationRefusal({ ...facts, approvedAmountCents: null } as never, 'approve', new Date())).toBeNull()
  })

  const VARIANTS: Array<[string, (x: World) => void, (r: unknown) => void]> = [
    ['(1) a new succeeded untagged Dashboard refund → FV refund_moved_unattributed + ALERT-FV', (x) => {
      x.stripeRefunds.push(stripeRefund('re_D'))
      x.pis.pi_1.latest_charge.amount_refunded = 300
    }, (r) => {
      expect(r).toEqual({ state: 'failed', error: 'proof_stale' })
      expect(String(claimOf(w).refundError).startsWith('financial_verification:refund_moved_unattributed:')).toBe(true)
      expect(causes()).toEqual(['claim_financial_verification:'])
    }],
    // IMPLEMENTATION NOTE (W2, round-1 fix) on J-M20 / A-S38-2: on a fully captured charge E5 applies, the engine
    // refuses before any insert, so H5 captured does not hold (G5 note) and (e') parks N5 as A-S38-2 states.
    ['(2) the same with refundable < requested (A-S38-2) → FV refund_moved_unattributed (N5 precedes N8), never an H5 hold', (x) => {
      x.stripeRefunds.push(stripeRefund('re_D', { amount: 1800 }))
      x.pis.pi_1.latest_charge.amount_refunded = 1800
    }, (r) => {
      expect(r).toEqual({ state: 'failed', error: 'proof_stale' })
      expect(String(claimOf(w).refundError).startsWith('financial_verification:refund_moved_unattributed:')).toBe(true)
      expect(String(claimOf(w).refundError)).not.toContain('montant capturé')
      expect(causes()).toEqual(['claim_financial_verification:'])
    }],
    ['(3) an admin-rail row succeeded, unstamped → FV refund_moved_unattributed + ALERT-FV', (x) => {
      x.refunds.push(refundRow('rf_adm', { stripeRefundId: 're_adm', idempotencyKey: 'refund:o1:0' }))
      x.stripeRefunds.push(stripeRefund('re_adm'))
      x.pis.pi_1.latest_charge.amount_refunded = 300
    }, (r) => {
      expect(r).toEqual({ state: 'failed', error: 'proof_stale' })
      expect(claimOf(w).status).toBe('financial_verification')
      expect(String(claimOf(w).refundError).startsWith('financial_verification:refund_moved_unattributed:')).toBe(true)
      expect(causes()).toEqual(['claim_financial_verification:'])
    }],
    ['(4) a dead pending row of another claim → locked proof + ALERT-B', (x) => {
      x.refunds.push(refundRow('rf_D', { status: 'pending', reason: 'claim:cl_OTHER', createdAt: new Date(Date.now() - 30 * HOURS) }))
    }, (r) => {
      expect(r).toEqual({ state: 'failed', error: 'proof_stale' })
      expect(String(claimOf(w).refundError).startsWith('no_refund_proven_rail_locked: ')).toBe(true)
      expect(causes()).toEqual(['claim_payment_blocked:no_refund_proven_rail_locked:'])
    }],
    ['(5) a pending row within its window → the v13 pre-image restored + ALERT-B unconfirmed_within_window', (x) => {
      x.refunds.push(refundRow('rf_W', { status: 'pending', createdAt: new Date(Date.now() - HOURS) }))
    }, (r) => {
      expect(r).toMatchObject({ state: 'failed', error: 'unconfirmed_within_window' })
      expect(claimOf(w)).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null, refundError: V13 })
      expect(causes()).toEqual(['claim_payment_blocked:unconfirmed_within_window'])
    }],
    ['(6) a failed row without id now holds refund:o1:<amount_refunded> → locked (E6)', (x) => {
      x.refunds.push(refundRow('rf_K', { status: 'failed', idempotencyKey: 'refund:o1:0' }))
    }, (r) => {
      expect(r).toEqual({ state: 'failed', error: 'proof_stale' })
      expect(String(claimOf(w).refundError).startsWith('no_refund_proven_rail_locked: ')).toBe(true)
      expect(String(claimOf(w).refundError)).toContain('le moteur calculerait la clé refund:o1:0 pour un nouveau remboursement, et la ligne rf_K la détient déjà')
      expect(causes()).toEqual(['claim_payment_blocked:no_refund_proven_rail_locked:'])
    }],
    ['(7) a failed row with a Stripe id → locked (E2)', (x) => {
      x.refunds.push(refundRow('rf_F', { status: 'failed', stripeRefundId: 're_F' }))
    }, (r) => {
      expect(r).toEqual({ state: 'failed', error: 'proof_stale' })
      expect(String(claimOf(w).refundError).startsWith('no_refund_proven_rail_locked: ')).toBe(true)
      expect(String(claimOf(w).refundError)).toContain('la ligne rf_F est ÉCHOUÉE avec un identifiant Stripe')
      expect(causes()).toEqual(['claim_payment_blocked:no_refund_proven_rail_locked:'])
    }],
    ['(8) the bound row of the other claim (HEAD_B) reverted at Stripe → SAFETY_HOLD (H1)', (x) => {
      x.refunds.push(refundRow('rf_O', { stripeRefundId: 're_O', idempotencyKey: 'refund:o1:0' }))
      x.claims.push({ id: 'cl_X', orderId: 'o1', status: 'refunded', refundId: 'rf_O', refundError: null })
      x.stripeRefunds.push(stripeRefund('re_O', { status: 'failed' }))
    }, (r) => {
      expect(r).toEqual({ state: 'failed', error: 'safety_hold' })
      expect(String(claimOf(w).refundError)).toContain('son remboursement re_O est « failed » chez Stripe')
    }],
    ['(9) a dispute on the charge → SAFETY_HOLD', (x) => { x.pis.pi_1.latest_charge.disputed = true }, (r) => {
      expect(r).toEqual({ state: 'failed', error: 'safety_hold' })
    }],
    ['(10) an own stamped row → own_row_exists', (x) => {
      x.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', status: 'pending' }))
    }, (r) => {
      expect(r).toEqual({ state: 'failed', error: 'own_row_exists' })
    }],
    ['(12) the other claim’s pending row succeeded at Stripe, no clawback → AWAITING', (x) => {
      x.refunds.push(refundRow('rf_A', { status: 'pending', stripeRefundId: 're_A', reason: 'claim:cl_A' }))
      x.stripeRefunds.push(stripeRefund('re_A', { metadata: { grubano_refund_row: 'rf_A' } }))
      x.pis.pi_1.latest_charge.amount_refunded = 300
      x.claims.push({ id: 'cl_A', orderId: 'o1', status: 'refunded', refundId: 'rf_A', refundError: null })
    }, (r) => {
      expect(r).toEqual({ state: 'failed', error: 'proof_stale' })
      expect(String(claimOf(w).refundError).startsWith(MARKERS.AWAITING_FINALIZATION)).toBe(true)
    }],
  ]

  for (const [name, change, check] of VARIANTS) {
    it(name, async () => {
      inject(change)
      const r = await triggerClaimRefund('cl1')
      expect(execMock).not.toHaveBeenCalled()
      expect(stripeMock.refunds.create).not.toHaveBeenCalled()
      check(r)
      // The approval response never renders a success-of-money toast.
      expect(['approvedRefunded', 'approvedPending']).not.toContain(approvalToast(r as never).key)
    })
  }

  it('(11) at step (f) the claim is changed to FV by another request → attempt_superseded, no write', async () => {
    w.beforeClaimRead = (n) => { if (n === 2) Object.assign(claimOf(w), { status: 'financial_verification', refundError: 'financial_verification:stripe_unreadable: x' }) }
    const r = await triggerClaimRefund('cl1')
    expect(r).toEqual({ state: 'failed', error: 'attempt_superseded' })
    expect(w.writes).toHaveLength(1)
    expect(execMock).not.toHaveBeenCalled()
    expect(approvalToast(r)).toEqual({ key: 'approvedSuperseded', tone: 'error' })
  })

  it('NEGATIVE CONTROL — no injected change → executeRefund exactly once with amountCents = requested, then T4 refunded', async () => {
    const r = await triggerClaimRefund('cl1')
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(execMock.mock.calls[0][0]).toEqual({ orderId: 'o1', amountCents: 500, reason: 'claim:cl1' })
    expect(r).toEqual({ state: 'refunded', refundId: 'rf_new', amountCents: 500 })
    expect(claimOf(w)).toMatchObject({ status: 'refunded', refundId: 'rf_new', refundError: null })
  })
})
