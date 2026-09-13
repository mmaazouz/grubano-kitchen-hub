// tests/claims-t49-round13-alerts.test.ts — T-49 round 13, slice W2: J-M52 / J-C39 (I-01 claim_payment_blocked)
// and J-C41 (I-03 claim_attempt_superseded, the T4 attempt-token CAS).
//
// A write by this build that leaves a claim unpaid by the rail sends ONE alert, after its CAS won, per claim
// and cause; a lost CAS sends nothing. The real sendAdminMoneyReviewAlert runs over a deduping sendOnce, so
// the dedupe key is exercised, not restated. Triggers of the reconcile and webhook slices (N8, applyRowTruth,
// R0) are pinned there.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { payableWorld, wireWorld, refundRow, stripeRefund, claimOf, engineOk, engine202, engineRefusal, HOURS, type World } from './support/claims-world'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
    // ROUND 13 (J-C42, slice W5): attribution binds in one transaction, and the closure record follows a refunded CAS.
    emailDispatch: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
const { sendOnceMock, sent } = vi.hoisted(() => {
  const sent = new Set<string>()
  return { sent, sendOnceMock: vi.fn() }
})
vi.mock('@/lib/transactional-emails', () => ({ sendOnce: sendOnceMock }))
vi.mock('@/lib/admin-alerts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admin-alerts')>()
  return { ...actual, sendAdminMoneyReviewAlert: vi.fn(actual.sendAdminMoneyReviewAlert) }
})
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn() }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { sendAdminMoneyReviewAlert, type MoneyReviewKind } from '@/lib/admin-alerts'
import { triggerClaimRefund, arbitrateClaim, runClaimAutoApproval, alertClaimPaymentBlocked, reconcileClaimEvidence, enterFinancialVerification, CLAIM_BLOCKED_TITLE, CLAIM_BLOCKED_OUTCOME_UNKNOWN_TITLE, claimBlockedTitle, CLAIM_ATTEMPT_SUPERSEDED_TITLE, attributeClaimRefund, adoptStripeRefundForClaim } from '@/lib/claims'
import { MARKERS, HEAD_A, reconcileMarkerAge } from '@/lib/claim-action-rules'
import { approvalToast } from '@/lib/claim-approval-toast'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const spy = sendAdminMoneyReviewAlert as unknown as ReturnType<typeof vi.fn>
type Alert = { kind: string; dedupeKey: string; title: string; facts: Record<string, unknown> }
const calls = (kind: string): Alert[] => (spy.mock.calls as Array<[Alert]>).map((c) => c[0]).filter((a) => a.kind === kind)
const BLOCKED_KEYS = ['claimId', 'orderId', 'claimStatusAfter', 'cause', 'refundRowIds', 'stripeRefundIds', 'firstEngineRefusal', 'holds', 'routed', 'exits', 'engineCalled', 'registry']
const CAUSES = [
  'no_refund_proven:v13:', 'no_refund_proven_rail_locked:awaiting_finalization:', 'no_refund_proven_rail_locked:', 'safety_hold', 'safety_check_unreadable',
  'unconfirmed_within_window', 'own_row_exists', 'resume_mismatch', 'identity_unverified', 'engine_own_row', 'engine_failed', 'stripe_failed',
  'engine_row_dead', 'stripe_reverted', 'reverted_after_refund', 'refunds_disabled', 'attempt_crashed',
]

let w: World
beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [execMock, refundsFlag, sendOnceMock]) m.mockReset()
  sent.clear()
  process.env.ALERT_EMAIL = 'ops@grubano.test'
  sendOnceMock.mockImplementation(async (trigger: string, key: string) => {
    const k = `${trigger}|${key}`
    if (sent.has(k)) return { status: 'duplicate' }
    sent.add(k)
    return { status: 'sent' }
  })
  refundsFlag.mockReturnValue(true)
  execMock.mockResolvedValue(engineOk())
  w = payableWorld()
  wireWorld(w, db, stripeMock)
})
afterEach(() => { delete process.env.ALERT_EMAIL })

const OUTCOME_UNKNOWN_TEXT = 'Tentative de remboursement sans issue établie — preuve requise avant toute décision'
const FROZEN_TEXT = 'Réclamation non payée par le rail — décision admin requise'
/**
 * I-01 title (certification audit c32d8d3, P1; targeted re-audit of 2466e03, P1): « non payée par le rail » only where no rail
 * payment for this claim can have happened. The expected title is DECLARED by the fixture (`expectUnknown`), never derived from
 * the alert's own facts; facts that forbid the frozen title (engineCalled true, own_row_exists) are a violation whatever the
 * fixture declares. Returns the violation, or null.
 */
function titleViolation(a: { title: string; facts: Record<string, unknown> }, expectUnknown: boolean): string | null {
  if ((a.facts.engineCalled === true || a.facts.cause === 'own_row_exists') && !expectUnknown) return 'the fixture expects the frozen title where the alert facts forbid it'
  const want = expectUnknown ? OUTCOME_UNKNOWN_TEXT : FROZEN_TEXT
  if (a.title !== want) return `title « ${a.title} », expected « ${want} »`
  if (expectUnknown && /non payée|payée|versé|remboursée/i.test(a.title)) return 'the outcome-unknown title states a payment outcome'
  return null
}

describe('I-01 title — certification audit c32d8d3 and targeted re-audit of 2466e03 (P1): no payment outcome unless the attempt READ that none can have happened', () => {
  it('claimBlockedTitle: the frozen title only when the engine was not called, the cause is not own_row_exists and no stamped row can exist', () => {
    expect(CLAIM_BLOCKED_TITLE).toBe(FROZEN_TEXT)
    expect(CLAIM_BLOCKED_OUTCOME_UNKNOWN_TITLE).toBe(OUTCOME_UNKNOWN_TEXT)
    for (const cause of CAUSES) {
      for (const engineCalled of [true, false]) {
        for (const ownRowAbsent of [true, false]) {
          const expectUnknown = engineCalled || cause === 'own_row_exists' || !ownRowAbsent
          const title = claimBlockedTitle(cause as never, engineCalled, ownRowAbsent)
          expect(titleViolation({ title, facts: { cause, engineCalled } }, expectUnknown), `${cause} engineCalled=${engineCalled} ownRowAbsent=${ownRowAbsent}`).toBeNull()
        }
      }
      // Callers outside triggerClaimRefund pass no ownRowAbsent: they act on Stripe evidence for the bound row.
      expect(claimBlockedTitle(cause as never, false)).toBe(cause === 'own_row_exists' ? OUTCOME_UNKNOWN_TEXT : FROZEN_TEXT)
    }
  })

  it('targeted re-audit of 2466e03 (P1): the own-row write throws AFTER a row stamped claim:cl1 was read → attempt_crashed, engineCalled false, outcome-unknown title', async () => {
    w.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', status: 'pending' }))
    w.beforeClaimWrite = (n) => { if (n === 2) throw new Error('own-row write failed') }
    await expect(triggerClaimRefund('cl1')).rejects.toThrow('own-row write failed')
    expect(execMock).not.toHaveBeenCalled()
    const a = calls('claim_payment_blocked')
    expect(a.map((x) => [x.facts.cause, x.facts.engineCalled, x.title])).toEqual([['attempt_crashed', false, CLAIM_BLOCKED_OUTCOME_UNKNOWN_TITLE]])
  })

  it('targeted re-audit of 2466e03 (P1): (a) reads no stamped row, the loader then reads one (the loader check) and the own-row write throws → attempt_crashed, engineCalled false, outcome-unknown title', async () => {
    // Read skew: the row stamped claim:cl1 lands between (a) and the loader; its Stripe refund names it.
    const skewWorld = () => {
      w = payableWorld()
      wireWorld(w, db, stripeMock)
      w.refunds.push(refundRow('rf_own', { status: 'pending', stripeRefundId: 're_own', reason: 'claim:cl1' }))
      w.stripeRefunds.push(stripeRefund('re_own', { metadata: { grubano_refund_row: 'rf_own' } }))
      w.pis.pi_1.latest_charge.amount_refunded = 300
      const wired = db.refund.findFirst.getMockImplementation() as (args: { where?: Record<string, unknown> }) => Promise<unknown>
      const reads = { stamped: 0 }
      db.refund.findFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
        if (args?.where?.reason === 'claim:cl1' && ++reads.stamped === 1) return null
        return wired(args)
      })
      return reads
    }
    // The fixture reaches ownRowExists through the loader check, not (a), (f) or an exit's own read: one stamped read, own_row_exists.
    // (Before 75f1601 it went through (e') changed_during_read, a branch the loader check now dominates.)
    const precondition = skewWorld()
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'own_row_exists' })
    expect(precondition.stamped).toBe(1)
    spy.mockClear()
    sent.clear()

    const reads = skewWorld()
    w.beforeClaimWrite = (n) => { if (n === 2) throw new Error('own-row write failed') }
    await expect(triggerClaimRefund('cl1')).rejects.toThrow('own-row write failed')
    expect(reads.stamped).toBe(1)
    expect(execMock).not.toHaveBeenCalled()
    const a = calls('claim_payment_blocked')
    expect(a.map((x) => [x.facts.cause, x.facts.engineCalled, x.title])).toEqual([['attempt_crashed', false, CLAIM_BLOCKED_OUTCOME_UNKNOWN_TITLE]])
  })

  const LOADER_SKEW: Array<[string, (x: World) => void, string]> = [
    ['(e\') window revert', (x) => {
      x.refunds.push(refundRow('rf_own', { status: 'pending', stripeRefundId: null, reason: 'claim:cl1', createdAt: new Date(Date.now() - HOURS) }))
    }, 'unconfirmed_within_window'],
    ['(c) hold', (x) => {
      x.refunds.push(refundRow('rf_own', { status: 'pending', stripeRefundId: 're_own', reason: 'claim:cl1' }))
      x.stripeRefunds.push(stripeRefund('re_own', { metadata: { grubano_refund_row: 'rf_own' } }))
      x.pis.pi_1.latest_charge.amount_refunded = 300
      x.pis.pi_1.latest_charge.disputed = true
    }, 'safety_hold'],
  ]
  for (const [label, arrange, wasCause] of LOADER_SKEW) {
    it(`targeted re-audit of d9fb194 (P1): a row stamped claim:cl1 seen only by the loader on the ${label} path → own_row_exists with the outcome-unknown title, never ${wasCause} under « non payée par le rail »`, async () => {
      // Read skew: (a)'s stamped query runs before a stalled attempt's insert; the loader, just after, reads the row.
      w = payableWorld()
      wireWorld(w, db, stripeMock)
      arrange(w)
      const wired = db.refund.findFirst.getMockImplementation() as (args: { where?: Record<string, unknown> }) => Promise<unknown>
      let stampedReads = 0
      db.refund.findFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
        if (args?.where?.reason === 'claim:cl1' && ++stampedReads === 1) return null
        return wired(args)
      })
      expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'own_row_exists' })
      expect(stampedReads).toBe(1)
      expect(execMock).not.toHaveBeenCalled()
      expect(String(claimOf(w).refundError)).toContain('porte déjà l’identité de cette réclamation')
      const a = calls('claim_payment_blocked')
      expect(a.map((x) => [x.facts.cause, x.facts.engineCalled, x.title])).toEqual([['own_row_exists', false, CLAIM_BLOCKED_OUTCOME_UNKNOWN_TITLE]])
    })
  }

  /** Stamped reads (reason claim:cl1), numbered: `hideFirst` hides (a)'s, `insertOn` inserts `row` just before that read, `failOn` throws. */
  const stampedReadsWith = (o: { hideFirst?: boolean; insertOn?: number; row?: World['refunds'][number]; failOn?: number[] }) => {
    const wired = db.refund.findFirst.getMockImplementation() as (args: { where?: Record<string, unknown> }) => Promise<unknown>
    const reads = { stamped: 0 }
    db.refund.findFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
      if (args?.where?.reason !== 'claim:cl1') return wired(args)
      const n = ++reads.stamped
      if (o.insertOn === n && o.row) w.refunds.push(o.row)
      if (o.failOn?.includes(n)) throw new Error('db down')
      if (o.hideFirst && n === 1) return null
      return wired(args)
    })
    return reads
  }
  const expectOwnRowExists = () => {
    expect(execMock).not.toHaveBeenCalled()
    expect(claimOf(w).status).not.toBe('financial_verification')
    expect(calls('claim_financial_verification')).toEqual([])
    expect(String(claimOf(w).refundError)).toContain('porte déjà l’identité de cette réclamation')
    expect(String(claimOf(w).refundError)).not.toMatch(/aucun remboursement/i)
    const a = calls('claim_payment_blocked')
    expect(a.map((x) => [x.facts.cause, x.facts.engineCalled, x.title])).toEqual([['own_row_exists', false, CLAIM_BLOCKED_OUTCOME_UNKNOWN_TITLE]])
  }

  // targeted re-audit of 75f1601 (P1): the loader reads the order's rows at its step 2 and can still fail afterwards; the variant it
  // returns carries no rows, so the loader check sees none. The exit's own stamped read, taken right before its write, decides.
  const LOADER_UNREADABLE: Array<[string, (x: World) => void, string]> = [
    ['the PaymentIntent retrieve fails', (x) => { x.fail.piRetrieve = true }, 'safety_check_unreadable'],
    ['the royalty read throws', (x) => { x.fail.royaltyFindFirst = true }, 'safety_check_unreadable'],
    ['that row\'s Stripe refund cannot be read', (x) => { x.fail.refundRetrieve = { re_own: 'throw' } }, 'safety_check_unreadable'],
    ['the refund list is over its page cap', (x) => { x.fail.listOverCap = true }, 'safety_hold'],
  ]
  for (const [label, arrange, wasCause] of LOADER_UNREADABLE) {
    it(`targeted re-audit of 75f1601 (P1): (a) reads no stamped row, the loader reads one then fails (${label}) → own_row_exists with the outcome-unknown title, never ${wasCause} under « non payée par le rail »`, async () => {
      w.refunds.push(refundRow('rf_own', { status: 'pending', stripeRefundId: 're_own', reason: 'claim:cl1' }))
      arrange(w)
      const reads = stampedReadsWith({ hideFirst: true })
      expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'own_row_exists' })
      // Two stamped reads: (a), hidden, then the exit's own read. One would mean the loader check caught it (a readable load).
      expect(reads.stamped).toBe(2)
      expectOwnRowExists()
    })
  }

  /** A refund of another claim still pending at Stripe: T2 (e') parks the claim in financial verification (refund_moved_unattributed). */
  const parkWorld = (x: World) => {
    x.refunds.push(refundRow('rf_P', { status: 'pending', stripeRefundId: 're_P', reason: 'claim:cl_Z' }))
    x.stripeRefunds.push(stripeRefund('re_P', { status: 'pending' }))
    x.pis.pi_1.latest_charge.amount_refunded = 300
  }

  // targeted re-audit of 75f1601 (the class): a row stamped claim:cl1 inserted after the loader, before an exit's write — unseen by
  // (a) and by the loader — is read by that exit's own stamped read, on every non-engine exit of the trigger.
  const INSERTED_AFTER_LOADER: Array<[string, (x: World) => void, string]> = [
    ['(b) revert', (x) => { x.fail.piRetrieve = true }, 'safety_check_unreadable'],
    ['(b\') no-charge hold', (x) => { x.pis.pi_1.latest_charge = null }, 'safety_hold'],
    ['(c) hold', (x) => { x.pis.pi_1.latest_charge.disputed = true }, 'safety_hold'],
    ['(e\') window revert', (x) => { x.refunds.push(refundRow('rf_W', { status: 'pending', createdAt: new Date(Date.now() - HOURS) })) }, 'unconfirmed_within_window'],
    ['(e\') lock proof', (x) => { x.refunds.push(refundRow('rf_D', { status: 'pending', createdAt: new Date(Date.now() - 30 * HOURS) })) }, 'no_refund_proven_rail_locked:'],
    // targeted re-audit of 68621aa (P2): the park took no read of its own and attributed the refunds from the loader's rows.
    ['(e\') park', parkWorld, 'refund_moved_unattributed'],
  ]
  for (const [label, arrange, wasCause] of INSERTED_AFTER_LOADER) {
    it(`targeted re-audit of 75f1601: a row stamped claim:cl1 inserted after the loader, before the ${label} write → own_row_exists with the outcome-unknown title, never ${wasCause}`, async () => {
      arrange(w)
      const reads = stampedReadsWith({ insertOn: 2, row: refundRow('rf_own', { status: 'pending', stripeRefundId: null, reason: 'claim:cl1', createdAt: new Date() }) })
      expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'own_row_exists' })
      expect(reads.stamped).toBe(2)
      expectOwnRowExists()
    })
  }

  // targeted re-audit of 68621aa (P1): the failed-read branch of each exit's own read. The exit writes no hold, proof or park text and
  // reverts to the pre-image; the revert takes its own stamped read, which decides the title (none → frozen, failed too → unknown).
  const FAILED_OWN_READ: Array<[string, (x: World) => void]> = [
    ['(b\') no-charge hold', (x) => { x.pis.pi_1.latest_charge = null }],
    ['(b\') list_over_cap hold', (x) => { x.fail.listOverCap = true }],
    ['(c) hold', (x) => { x.pis.pi_1.latest_charge.disputed = true }],
    ['(e\') lock proof', (x) => { x.refunds.push(refundRow('rf_D', { status: 'pending', createdAt: new Date(Date.now() - 30 * HOURS) })) }],
    ['(e\') park', parkWorld],
  ]
  const FAILED_READS: Array<[number[], string]> = [[[2], CLAIM_BLOCKED_TITLE], [[2, 3], CLAIM_BLOCKED_OUTCOME_UNKNOWN_TITLE]]
  for (const [label, arrange] of FAILED_OWN_READ) {
    for (const [failOn, title] of FAILED_READS) {
      const both = failOn.length > 1
      it(`targeted re-audit of 68621aa (P1): the ${label}'s own stamped read fails${both ? ' and so does the revert\'s' : ''} → safety_check_unreadable, back to the pre-image, no hold, proof or park text, ${both ? 'the outcome-unknown title' : 'the frozen title (the revert read none)'}`, async () => {
        arrange(w)
        const pre = { ...claimOf(w) }
        const reads = stampedReadsWith({ failOn })
        expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'safety_check_unreadable' })
        // (a), then the exit's own read, then the revert's own read.
        expect(reads.stamped).toBe(3)
        expect(execMock).not.toHaveBeenCalled()
        expect(claimOf(w)).toMatchObject({ status: pre.status, refundAttempted: false, refundError: pre.refundError })
        expect(String(claimOf(w).refundError ?? '')).not.toMatch(/aucun remboursement|porte déjà l’identité|financial_verification|no_refund_proven|awaiting/i)
        expect(calls('claim_financial_verification')).toEqual([])
        const a = calls('claim_payment_blocked')
        expect(a.map((x) => [x.facts.cause, x.facts.engineCalled, x.title])).toEqual([['safety_check_unreadable', false, title]])
      })
    }
  }

  it('targeted re-audit of 75f1601 (P3): a row stamped claim:cl1 seen only by a no_charge loader read → own_row_exists at the loader check, before the hold\'s own read', async () => {
    w.pis.pi_1.latest_charge = null
    w.refunds.push(refundRow('rf_own', { status: 'pending', stripeRefundId: null, reason: 'claim:cl1' }))
    const reads = stampedReadsWith({ hideFirst: true })
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'own_row_exists' })
    // One stamped read: the loader check took the no_charge rows. Without that arm the hold's own read would be a second one.
    expect(reads.stamped).toBe(1)
    expectOwnRowExists()
  })

  it('targeted re-audit of 2466e03 (P2): the stamped read fails at (a) → safety_check_unreadable with the outcome-unknown title', async () => {
    w.fail.refundFindFirst = true
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'safety_check_unreadable' })
    const a = calls('claim_payment_blocked')
    expect(a.map((x) => [x.facts.cause, x.facts.engineCalled, x.title])).toEqual([['safety_check_unreadable', false, CLAIM_BLOCKED_OUTCOME_UNKNOWN_TITLE]])
  })

  it('targeted re-audits of 2466e03 and 75f1601: the (f) stamped read fails, the revert\'s own read then returns none → safety_check_unreadable with the frozen title (absence read: rows are never deleted)', async () => {
    const reads = stampedReadsWith({ failOn: [2] })
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'safety_check_unreadable' })
    expect(reads.stamped).toBe(3)
    expect(execMock).not.toHaveBeenCalled()
    const a = calls('claim_payment_blocked')
    expect(a.map((x) => [x.facts.cause, x.facts.engineCalled, x.title])).toEqual([['safety_check_unreadable', false, CLAIM_BLOCKED_TITLE]])
  })

  it('targeted re-audit of 2466e03 (P2): the (f) stamped read and the revert\'s own read both fail → safety_check_unreadable with the outcome-unknown title', async () => {
    const reads = stampedReadsWith({ failOn: [2, 3] })
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'safety_check_unreadable' })
    expect(reads.stamped).toBe(3)
    expect(execMock).not.toHaveBeenCalled()
    const a = calls('claim_payment_blocked')
    expect(a.map((x) => [x.facts.cause, x.facts.engineCalled, x.title])).toEqual([['safety_check_unreadable', false, CLAIM_BLOCKED_OUTCOME_UNKNOWN_TITLE]])
  })

  it('the real alert after engine_own_row (executeRefund answered 502 « Remboursement émis… » with a row stamped for this claim) carries the outcome-unknown title', async () => {
    execMock.mockImplementation(async () => {
      w.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', status: 'pending' }))
      return engineRefusal('Remboursement émis, reprise de la royalty franchisé en échec — réessayez.', 502)
    })
    expect(await triggerClaimRefund('cl1')).toMatchObject({ state: 'failed' })
    const a = calls('claim_payment_blocked')
    expect(a.map((x) => [x.facts.cause, x.facts.engineCalled, x.title])).toEqual([['engine_own_row', true, CLAIM_BLOCKED_OUTCOME_UNKNOWN_TITLE]])
  })

  it('NEGATIVE CONTROL — the frozen title where the facts or the fixture forbid it, or the outcome-unknown title where the frozen one is due, is a violation', () => {
    expect(titleViolation({ title: CLAIM_BLOCKED_TITLE, facts: { cause: 'engine_own_row', engineCalled: true } }, true)).not.toBeNull()
    expect(titleViolation({ title: CLAIM_BLOCKED_TITLE, facts: { cause: 'attempt_crashed', engineCalled: true } }, true)).not.toBeNull()
    expect(titleViolation({ title: CLAIM_BLOCKED_TITLE, facts: { cause: 'own_row_exists', engineCalled: false } }, true)).not.toBeNull()
    // targeted re-audit of 2466e03: engineCalled false, but the fixture read a stamped row (or could not read) → the frozen title is false.
    expect(titleViolation({ title: CLAIM_BLOCKED_TITLE, facts: { cause: 'attempt_crashed', engineCalled: false } }, true)).not.toBeNull()
    expect(titleViolation({ title: CLAIM_BLOCKED_TITLE, facts: { cause: 'safety_check_unreadable', engineCalled: false } }, true)).not.toBeNull()
    // A fixture that declares the frozen title where the alert facts forbid it is itself caught.
    expect(titleViolation({ title: CLAIM_BLOCKED_TITLE, facts: { cause: 'engine_failed', engineCalled: true } }, false)).not.toBeNull()
    expect(titleViolation({ title: CLAIM_BLOCKED_OUTCOME_UNKNOWN_TITLE, facts: { cause: 'refunds_disabled', engineCalled: false } }, false)).not.toBeNull()
  })
})

/**
 * Checks one claim_payment_blocked alert against the I-01 contract. The title is checked against the fixture's DECLARED outcome
 * (`outcomeUnknown`, defaulting to the declared engineCalled / own_row_exists), never against the alert's own facts.
 */
function expectBlocked(cause: string, o: { status?: string; engineCalled?: boolean; registry?: string; outcomeUnknown?: boolean } = {}) {
  const a = calls('claim_payment_blocked')
  expect(a, cause).toHaveLength(1)
  expect(titleViolation(a[0], o.outcomeUnknown ?? (o.engineCalled === true || cause === 'own_row_exists')), cause).toBeNull()
  expect(a[0].dedupeKey).toBe(`claim_blocked:cl1:${cause}`)
  expect(CAUSES).toContain(a[0].facts.cause)
  expect(a[0].facts.cause).toBe(cause)
  const v13 = String(a[0].facts.claimStatusAfter) === 'approved' && 'quiescenceInstant' in a[0].facts
  expect(Object.keys(a[0].facts).sort()).toEqual([...BLOCKED_KEYS, ...(v13 ? ['quiescenceInstant'] : [])].sort())
  if (o.status) expect(a[0].facts.claimStatusAfter).toBe(o.status)
  if (o.engineCalled !== undefined) expect(a[0].facts.engineCalled).toBe(o.engineCalled)
  if (o.registry) expect(a[0].facts.registry).toBe(o.registry)
  expect(`${a[0].title} ${JSON.stringify(a[0].facts)}`).not.toMatch(/payable|sera payé|réessayez|@|€/i)
}

/**
 * The T2 / T4 trigger fixtures: [name, world mutation, engine result or null, expected cause, CAS index of the trigger write,
 * declared title — true: the outcome-unknown title (the engine was called, or a stamped row was seen or could not be read)].
 */
const TRIGGERS: Array<[string, (x: World) => void, Record<string, unknown> | null, string, number, boolean]> = [
  ['T2 (a) own row', (x) => { x.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', status: 'pending' })) }, null, 'own_row_exists', 2, true],
  ['T2 (b) revert', (x) => { x.fail.piRetrieve = true }, null, 'safety_check_unreadable', 2, false],
  // targeted re-audit of 2466e03 (P2): the stamped read itself fails at (a) — whether a row carrying this claim exists is unknown.
  ['T2 (a) stamped read unreadable', (x) => { x.fail.refundFindFirst = true }, null, 'safety_check_unreadable', 2, true],
  ['T2 (b\') no charge', (x) => { x.pis.pi_1.latest_charge = null }, null, 'safety_hold', 2, false],
  ['T2 (c) hold', (x) => { x.pis.pi_1.latest_charge.disputed = true }, null, 'safety_hold', 2, false],
  ['T2 (e\') lock', (x) => { x.refunds.push(refundRow('rf_D', { status: 'pending', createdAt: new Date(Date.now() - 30 * HOURS) })) }, null, 'no_refund_proven_rail_locked:', 2, false],
  ['T2 (e\') window revert', (x) => { x.refunds.push(refundRow('rf_W', { status: 'pending', createdAt: new Date(Date.now() - HOURS) })) }, null, 'unconfirmed_within_window', 2, false],
  // The engine puts the resumed row in the base: present before T2, it would be a Claims-side H1 hold, not an engine outcome.
  ['T4 resume_mismatch', (x) => { execMock.mockImplementation(async () => { x.refunds.push(refundRow('rf9', { reason: 'claim:OTHER' })); return engineOk({ resumed: true, refundId: 'rf9' }) }) }, null, 'resume_mismatch', 2, true],
  ['T4 identity_unverified', () => {}, engineOk({ resumed: true, refundId: 'rf_unread' }), 'identity_unverified', 2, true],
  ['T4 own-row fatal', (x) => { execMock.mockImplementation(async () => { x.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', status: 'pending' })); return engineRefusal('Erreur paiement, réessayez.', 502) }) }, null, 'engine_own_row', 2, true],
  ['T4 engine_failed', () => {}, engineRefusal(), 'engine_failed', 2, true],
]

describe('J-M52 / J-C39 — claim_payment_blocked after a won CAS only (I-01)', () => {
  it('MoneyReviewKind carries both new kinds', () => {
    const kinds: MoneyReviewKind[] = ['claim_payment_blocked', 'claim_attempt_superseded']
    expect(kinds).toHaveLength(2)
    expect(read('lib/admin-alerts.ts')).toMatch(/\| 'claim_payment_blocked'/)
    expect(read('lib/admin-alerts.ts')).toMatch(/\| 'claim_attempt_superseded'/)
  })

  for (const [name, mutate, result, cause, casIndex, outcomeUnknown] of TRIGGERS) {
    it(`${name}: count 1 → sent once with the I-01 facts; count 0 → not sent`, async () => {
      mutate(w)
      if (result) execMock.mockResolvedValue(result)
      await triggerClaimRefund('cl1')
      expectBlocked(cause, { outcomeUnknown })
      expect(sendOnceMock.mock.calls.filter((c) => c[0] === 'admin_money_review_claim_payment_blocked')).toHaveLength(1)

      // count 0 on the trigger's own CAS
      spy.mockClear()
      w = payableWorld()
      wireWorld(w, db, stripeMock)
      execMock.mockReset()
      execMock.mockResolvedValue(engineOk())
      mutate(w)
      if (result) execMock.mockResolvedValue(result)
      w.beforeClaimWrite = (n) => { if (n === casIndex) claimOf(w).refundError = 'financial_verification:x: écrit entre-temps' }
      expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'attempt_superseded' })
      expect(calls('claim_payment_blocked'), `${name} lost CAS`).toEqual([])
    })
  }

  it('refunds_disabled from arbitrateClaim: after the decision CAS, facts approved / engineCalled false / E-10; a lost decision CAS → 409, no trigger, no alert', async () => {
    refundsFlag.mockReturnValue(false)
    Object.assign(claimOf(w), { status: 'arbitration', arbitrationDecision: null })
    const out = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect(out).toMatchObject({ ok: true, refund: { state: 'pending', reason: 'refunds_disabled' } })
    expectBlocked('refunds_disabled', { status: 'approved', engineCalled: false, registry: 'E-10' })
    const a = calls('claim_payment_blocked')[0]
    expect(a.facts.firstEngineRefusal).toBeNull()
    expect(a.facts.exits).toBe('approve (réclamations+remboursements ouverts)')
    expect(w.writes.filter((x) => String(x.data.refundError ?? '').startsWith('reconcile_required'))).toEqual([])

    spy.mockClear()
    w = payableWorld({ status: 'arbitration', arbitrationDecision: null })
    wireWorld(w, db, stripeMock)
    w.beforeClaimWrite = (n) => { if (n === 1) claimOf(w).arbitrationDecision = 'approved' }
    expect(await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })).toEqual({ ok: false, status: 409, error: 'Cette réclamation a déjà été arbitrée.' })
    expect(calls('claim_payment_blocked')).toEqual([])
  })

  it('a rejecting sender does not fail the write nor change arbitrateClaim\'s result', async () => {
    refundsFlag.mockReturnValue(false)
    Object.assign(claimOf(w), { status: 'arbitration', arbitrationDecision: null })
    spy.mockRejectedValueOnce(new Error('smtp down'))
    const out = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect(out).toMatchObject({ ok: true, refund: { state: 'pending', reason: 'refunds_disabled' } })
    expect(claimOf(w)).toMatchObject({ status: 'approved', arbitrationDecision: 'approved' })
  })

  it('approveClaim via runClaimAutoApproval with the rail closed: the same alert after its own CAS', async () => {
    refundsFlag.mockReturnValue(false)
    Object.assign(claimOf(w), { status: 'restaurant_review', responseDeadlineAt: new Date(Date.now() - HOURS), reason: 'quality', arbitrationDecision: null })
    await runClaimAutoApproval()
    expectBlocked('refunds_disabled', { status: 'approved', engineCalled: false, registry: 'E-10' })
  })

  it('approveClaim via runClaimAutoApproval, its restaurant_review CAS lost → already_handled, triggerClaimRefund not reached, no alert', async () => {
    refundsFlag.mockReturnValue(false)
    Object.assign(claimOf(w), { status: 'restaurant_review', responseDeadlineAt: new Date(Date.now() - HOURS), reason: 'quality', arbitrationDecision: null })
    // a restaurant answered at the same instant: the claim left restaurant_review before the sweep's CAS
    w.beforeClaimWrite = (n) => { if (n === 1) claimOf(w).status = 'arbitration' }
    const summary = await runClaimAutoApproval()
    expect(summary.autoApproved).toBe(0)
    expect(w.writes.map((x) => x.count)).toEqual([0])
    // the sweep's own step-2 check is the only REFUNDS read: triggerClaimRefund (which reads it first) was not reached
    expect(refundsFlag).toHaveBeenCalledTimes(1)
    expect(calls('claim_payment_blocked')).toEqual([])
  })

  it('N8 (D4) × 3 prefixes: a reconcile proof write sends one alert per prefix after its won CAS; a lost CAS sends nothing', async () => {
    const HOLD = { status: 'approved', refundAttempted: true, refundError: `${MARKERS.SAFETY_HOLD} Aucun remboursement n’a été lancé pour cette réclamation : x Décision humaine requise ; « Clôturer ce dossier… » enregistre votre déclaration.` }
    const WORLDS: Array<[string, (x: World) => void]> = [
      [MARKERS.PROOF_PAYABLE_V13, () => {}],
      ['no_refund_proven_rail_locked:', (x) => { x.refunds.push(refundRow('rf_D', { status: 'pending', reason: 'claim:cl_OTHER', createdAt: new Date(Date.now() - 30 * HOURS) })) }],
      [MARKERS.AWAITING_FINALIZATION, (x) => {
        x.refunds.push(refundRow('rf_A', { status: 'pending', stripeRefundId: 're_A', reason: 'claim:cl_A' }))
        x.stripeRefunds.push(stripeRefund('re_A', { metadata: { grubano_refund_row: 'rf_A' } }))
        x.pis.pi_1.latest_charge.amount_refunded = 300
        x.claims.push({ id: 'cl_A', orderId: 'o1', status: 'refunded', refundId: 'rf_A', refundError: null })
      }],
    ]
    for (const [prefix, mutate] of WORLDS) {
      for (const lose of [false, true]) {
        spy.mockClear()
        sent.clear()
        w = payableWorld(HOLD)
        mutate(w)
        wireWorld(w, db, stripeMock)
        if (lose) w.beforeClaimWrite = (n) => { if (n === 1) claimOf(w).refundError = 'financial_verification:x: écrit entre-temps' }
        const r = await reconcileClaimEvidence({ claimId: 'cl1' })
        if (lose) {
          expect(r, prefix).toEqual({ ok: true, outcome: 'changed_during_read' })
          expect(calls('claim_payment_blocked'), `${prefix} lost`).toEqual([])
        } else {
          expect(String(claimOf(w).refundError).startsWith(`${prefix} `), prefix).toBe(true)
          expectBlocked(prefix, { status: 'approved', engineCalled: false })
        }
      }
    }
    expect(execMock).not.toHaveBeenCalled()
  })

  it('the catch after T1: attempt_crashed is sent BEFORE the rethrow, and a rejecting alert does not swallow it', async () => {
    const order: string[] = []
    execMock.mockImplementation(async () => { throw new Error('insert failed') })
    spy.mockImplementationOnce(async (p: Alert) => { order.push(`alert:${p.facts.cause}:${p.facts.engineCalled}`); throw new Error('smtp down') })
    await expect(triggerClaimRefund('cl1').catch((e) => { order.push('rethrow'); throw e })).rejects.toThrow('insert failed')
    // I-01 facts: the engine WAS called (money may have moved) — engineCalled is what this attempt established.
    expect(order).toEqual(['alert:attempt_crashed:true', 'rethrow'])
    expect(String(claimOf(w).refundError).startsWith('reconcile_required')).toBe(true)
  })

  it('attempt_crashed engineCalled: a T2 write that throws → false; executeRefund throwing → true; a T4 write that throws after an ok result → true', async () => {
    const run = async (setup: () => void, message: string, outcomeUnknown: boolean) => {
      spy.mockClear()
      w = payableWorld()
      wireWorld(w, db, stripeMock)
      execMock.mockReset()
      execMock.mockResolvedValue(engineOk())
      setup()
      await expect(triggerClaimRefund('cl1')).rejects.toThrow(message)
      expectBlocked('attempt_crashed', { outcomeUnknown })
      return calls('claim_payment_blocked')[0].facts.engineCalled
    }
    // T2 (c): the safety-hold write (claim write 2) throws — the engine was never reached.
    expect(await run(() => { w.pis.pi_1.latest_charge.disputed = true; w.beforeClaimWrite = (n) => { if (n === 2) throw new Error('t2 write failed') } }, 't2 write failed', false)).toBe(false)
    expect(execMock).not.toHaveBeenCalled()
    expect(await run(() => { execMock.mockImplementation(async () => { throw new Error('finalize failed') }) }, 'finalize failed', true)).toBe(true)
    // T4: the engine returned ok (Stripe accepted the refund), then the claim write throws.
    expect(await run(() => { w.beforeClaimWrite = (n) => { if (n === 2) throw new Error('t4 write failed') } }, 't4 write failed', true)).toBe(true)
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  it('never inside a $transaction callback (lib/claims.ts source)', () => {
    const inTx = (src: string) => {
      const out: string[] = []
      let i = src.indexOf('$transaction(')
      while (i >= 0) {
        let depth = 0
        let j = i + '$transaction'.length
        for (; j < src.length; j++) { if (src[j] === '(') depth++; else if (src[j] === ')') { depth--; if (depth === 0) break } }
        const span = src.slice(i, j)
        if (/alertClaimPaymentBlocked|sendAdminMoneyReviewAlert/.test(span)) out.push(span.slice(0, 60))
        i = src.indexOf('$transaction(', j)
      }
      return out
    }
    expect(inTx(stripComments(read('lib/claims.ts')))).toEqual([])
    // NEGATIVE CONTROL: the scan finds one
    expect(inTx('await prisma.$transaction(async (tx) => { await alertClaimPaymentBlocked(id, "safety_hold", f) })')).toHaveLength(1)
  })

  it('NEGATIVE CONTROL — two writes of the same cause for one claim → one send; two causes → two sends', async () => {
    const f = { orderId: 'o1', engineCalled: false, claimAfter: { status: 'approved', refundAttempted: false, refundId: null, refundError: 'no_refund_proven_rail_locked: x' } }
    await alertClaimPaymentBlocked('cl1', 'no_refund_proven_rail_locked:', f)
    await alertClaimPaymentBlocked('cl1', 'no_refund_proven_rail_locked:', f)
    const sends = () => sendOnceMock.mock.results.length
    const statuses = await Promise.all(sendOnceMock.mock.results.map((r) => r.value))
    expect(statuses.map((s) => (s as { status: string }).status)).toEqual(['sent', 'duplicate'])
    await alertClaimPaymentBlocked('cl1', MARKERS.AWAITING_FINALIZATION, { ...f, claimAfter: { ...f.claimAfter, refundError: `${MARKERS.AWAITING_FINALIZATION} x` } })
    expect(sends()).toBe(3)
    expect((await sendOnceMock.mock.results[2].value).status).toBe('sent')
  })

  it('v13 facts carry quiescenceInstant; facts never carry a customer e-mail or address', async () => {
    const instant = new Date(Date.now() - 1000)
    await alertClaimPaymentBlocked('cl1', 'no_refund_proven:v13:', { orderId: 'o1', engineCalled: false, claimAfter: { status: 'approved', refundAttempted: false, refundId: null, refundError: `${MARKERS.PROOF_PAYABLE_V13} ${HEAD_A} … Elle est payable au plus tôt le ${instant.toISOString()} (UTC).` } })
    const a = calls('claim_payment_blocked')[0]
    expect(a.facts.quiescenceInstant).toBe(instant.toISOString())
    // W7 fixer (I-01, W2 carry-over): the gated approve exit of a v13 proof states its time bound too.
    expect(a.facts.exits).toContain(`approve (réclamations+remboursements ouverts, au plus tôt le ${instant.toISOString()} UTC)`)
    expect(a.facts.exits).not.toContain('approve (réclamations+remboursements ouverts),')
    expect(Object.keys(a.facts).sort()).toEqual([...BLOCKED_KEYS, 'quiescenceInstant'].sort())
    expect(JSON.stringify(a.facts)).not.toMatch(/@|consumer|email|adresse/i)
  })
})

describe('J-C41 — claim_attempt_superseded and the T4 attempt-token CAS (I-03)', () => {
  const loseT4 = () => { w.beforeClaimWrite = (n) => { if (n === 2) Object.assign(claimOf(w), { status: 'financial_verification', refundError: 'financial_verification:stripe_unreadable: x' }) } }

  it('count 0 + ok / 202 → one alert, dedupe claim_attempt:<id>:<row>, facts per I-03, result attempt_superseded → toast approvedSuperseded', async () => {
    for (const result of [engineOk(), engine202()]) {
      w = payableWorld()
      wireWorld(w, db, stripeMock)
      spy.mockClear()
      execMock.mockResolvedValue(result)
      loseT4()
      const r = await triggerClaimRefund('cl1')
      expect(r).toEqual({ state: 'failed', error: 'attempt_superseded' })
      expect(approvalToast(r)).toEqual({ key: 'approvedSuperseded', tone: 'error' })
      const a = calls('claim_attempt_superseded')
      expect(a).toHaveLength(1)
      expect(a[0].title).toBe(CLAIM_ATTEMPT_SUPERSEDED_TITLE)
      expect(a[0].dedupeKey).toBe('claim_attempt:cl1:rf_new')
      expect(Object.keys(a[0].facts).sort()).toEqual(['claimId', 'orderId', 'refundRowId', 'stripeRefundId', 'engineStatus', 'resumed', 'claimStatusNow', 'claimRefundIdNow', 'claimRefundErrorPrefixNow'].sort())
      expect(a[0].facts.engineStatus).toBe(result.ok ? 'ok' : 'pending')
      expect(a[0].facts.claimStatusNow).toBe('financial_verification')
      expect(`${a[0].title} ${JSON.stringify(a[0].facts)}`).not.toMatch(/payé deux fois|paid twice|must be reversed|à rembourser/i)
      expect(calls('claim_payment_blocked')).toEqual([])
    }
  })

  it('count 0 + a refusal → console.warn only', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    execMock.mockResolvedValue(engineRefusal())
    loseT4()
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'attempt_superseded' })
    expect(spy).not.toHaveBeenCalled()
    expect(warn.mock.calls.some((c) => String(c[0]).includes('attempt_superseded'))).toBe(true)
    warn.mockRestore()
  })

  it('NEGATIVE CONTROL — count 1 with an ok result does not alert superseded', async () => {
    expect(await triggerClaimRefund('cl1')).toMatchObject({ state: 'refunded' })
    expect(calls('claim_attempt_superseded')).toEqual([])
    expect(w.writes.at(-1)!.where).toEqual({ id: 'cl1', status: 'refunding', refundError: String(w.writes[0].data.refundError) })
  })

  it('M carries an ISO timestamp and a nonce, and reconcileMarkerAge parses it; no prisma.claim.update in triggerClaimRefund', async () => {
    await triggerClaimRefund('cl1')
    const M = String(w.writes[0].data.refundError)
    expect(M).toMatch(/\d{4}-\d{2}-\d{2}T[\d:.]+Z \(tentative [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)/)
    expect(reconcileMarkerAge(M)).not.toBeNull()
    const src = stripComments(read('lib/claims.ts'))
    const start = src.indexOf('export async function triggerClaimRefund(')
    expect(src.slice(start, src.indexOf('\n}\n', start))).not.toContain('prisma.claim.update(')
  })

  it('refused and T2 outcomes never claim a stripe refund: stripe refunds.create is never called', async () => {
    w.pis.pi_1.latest_charge.disputed = true
    await triggerClaimRefund('cl1')
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
  })
})

// ══ W3 — applyRowTruth's stripe_failed and engine_row_dead writes (G2, I-01 triggers) ═══════════════════════
describe('I-01 — applyRowTruth: ALERT-B after the stripe_failed and engine_row_dead writes, never on a lost CAS (G2)', () => {
  const OLD_MARKER = 'reconcile_required: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z (tentative 0) — identité pas encore liée.'
  const marked = () => payableWorld({ status: 'refunding', refundAttempted: true, refundError: OLD_MARKER })
  const CASES: Array<[string, (x: World) => void, string, string]> = [
    ['own pending row, Stripe failed it (at_stripe failed)', (x) => {
      x.refunds.push(refundRow('rf_own', { status: 'pending', reason: 'claim:cl1', stripeRefundId: 're_own' }))
      x.stripeRefunds.push(stripeRefund('re_own', { status: 'failed' }))
    }, 'stripe_failed', 'refund_failed'],
    ['own row FAILED with its Stripe id (row_terminal failed, through reconcileClaimForRefund)', (x) => {
      x.refunds.push(refundRow('rf_own', { status: 'failed', reason: 'claim:cl1', stripeRefundId: 're_own' }))
    }, 'stripe_failed', 'refund_failed'],
    ['own pending row with no Stripe refund past the window (absent_dead)', (x) => {
      x.refunds.push(refundRow('rf_own', { status: 'pending', reason: 'claim:cl1', createdAt: new Date(Date.now() - 30 * HOURS) }))
    }, 'engine_row_dead', 'engine_row_dead'],
  ]
  for (const [name, mutate, cause, outcome] of CASES) {
    it(`${name} → ${cause} alert after count 1; the same write lost → no alert`, async () => {
      w = marked(); mutate(w); wireWorld(w, db, stripeMock)
      const r = await reconcileClaimEvidence({ claimId: 'cl1' })
      expect(r).toMatchObject({ ok: true, outcome, refundId: 'rf_own' })
      expectBlocked(cause, { status: 'approved', engineCalled: false, registry: 'E-02' })
      // lost: the claim changes before the decisive write (the only write, or the reconciler's after the bind)
      spy.mockClear()
      w = marked(); mutate(w); wireWorld(w, db, stripeMock)
      w.beforeClaimWrite = (_n, { data }) => { if (data.status === 'approved') claimOf(w).refundError = 'financial_verification:x: écrit entre-temps' }
      await reconcileClaimEvidence({ claimId: 'cl1' })
      expect(calls('claim_payment_blocked'), `${name} lost`).toEqual([])
    })
  }
})

// ══ J-C40 — claim_financial_verification on entry and on relabel with a NEW reason only (I-02) ═══════════════
describe('J-C40 — claim_financial_verification on entry, and on relabel only with a new reason (I-02)', () => {
  const FV_KEYS = ['claimId', 'orderId', 'claimState', 'ambiguity', 'detail', 'refundRowId', 'stripeRefundId', 'requestedCents', 'moneyMoved', 'nextAction']
  const fvAlerts = () => calls('claim_financial_verification')
  const checkFacts = (a: Alert, reason: string) => {
    expect(a.dedupeKey).toBe(`claim_fv:cl1:${reason}`)
    expect(a.title).toBe('Vérification financière requise — réclamation cl1')
    expect(Object.keys(a.facts).sort()).toEqual([...FV_KEYS].sort())
    expect(a.facts.ambiguity).toBe(reason)
    expect(`${a.title} ${JSON.stringify(a.facts)}`).not.toMatch(/another refund|nouveau remboursement peut/i)
  }

  for (const status of ['approved', 'refunding'] as const) {
    it(`entry from ${status} → one alert, dedupe claim_fv:<id>:<reason>, facts keys unchanged`, async () => {
      w = payableWorld({ status, refundAttempted: true, refundError: 'x' }); wireWorld(w, db, stripeMock)
      expect(await enterFinancialVerification({ claimId: 'cl1', reason: 'stripe_refund_contradiction', detail: 'd', expect: { status, refundError: 'x' } })).toEqual({ entered: true })
      expect(fvAlerts()).toHaveLength(1)
      checkFacts(fvAlerts()[0], 'stripe_refund_contradiction')
    })
  }

  it('FV → FV with a NEW reason → one alert with the new reason', async () => {
    w = payableWorld({ status: 'financial_verification', refundError: 'financial_verification:stripe_unreadable: a' }); wireWorld(w, db, stripeMock)
    expect(await enterFinancialVerification({ claimId: 'cl1', reason: 'refund_moved_unattributed', detail: 'b', expect: { status: 'financial_verification', refundError: 'financial_verification:stripe_unreadable: a' } })).toEqual({ entered: false, relabelled: true })
    expect(fvAlerts()).toHaveLength(1)
    checkFacts(fvAlerts()[0], 'refund_moved_unattributed')
  })

  it('NEGATIVE CONTROL — FV → FV with the SAME reason relabels and sends 0 alerts', async () => {
    w = payableWorld({ status: 'financial_verification', refundError: 'financial_verification:stripe_unreadable: a' }); wireWorld(w, db, stripeMock)
    expect(await enterFinancialVerification({ claimId: 'cl1', reason: 'stripe_unreadable', detail: 'b', expect: { status: 'financial_verification', refundError: 'financial_verification:stripe_unreadable: a' } })).toEqual({ entered: false, relabelled: true })
    expect(claimOf(w).refundError).toBe('financial_verification:stripe_unreadable: b')
    expect(spy).not.toHaveBeenCalled()
  })

  it('a relabel CAS lost → nothing written, no alert', async () => {
    w = payableWorld({ status: 'financial_verification', refundError: 'financial_verification:stripe_unreadable: a' }); wireWorld(w, db, stripeMock)
    w.beforeClaimWrite = () => { claimOf(w).refundError = 'financial_verification:stripe_unreadable: écrit entre-temps' }
    expect(await enterFinancialVerification({ claimId: 'cl1', reason: 'refund_moved_unattributed', detail: 'b', expect: { status: 'financial_verification', refundError: 'financial_verification:stripe_unreadable: a' } })).toEqual({ entered: false })
    expect(spy).not.toHaveBeenCalled()
  })
})

// ══ ROUND 13 (J-C42, slice W5) — claim_refunded_row_unfinalized triggers (I-04, A-S10, A-S21) ═══════════════════════
describe('J-C42 — claim_refunded_row_unfinalized: at_stripe on a pending row, attribution after an observed commit, never adoption', () => {
  const OLD_MARKER = 'reconcile_required: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z (tentative 0) — identité pas encore liée.'
  const FORBIDDEN = /ledger (appliqué|applied)|clawback (appliqué|applied)|reprise de royalty appliquée/i
  const unfinalized = () => calls('claim_refunded_row_unfinalized')
  const fv = () => payableWorld({ status: 'financial_verification', refundAttempted: true, refundError: 'financial_verification:refund_moved_unattributed: x', activeOrderKey: 'o1' })
  const noForbiddenText = () => expect(JSON.stringify(spy.mock.calls)).not.toMatch(FORBIDDEN)
  beforeEach(() => {
    db.emailDispatch.create.mockReset()
    db.emailDispatch.create.mockResolvedValue({})
    db.$transaction.mockReset()
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db))
  })

  it('applyRowTruth at_stripe succeeded on a pending row (A-S10) → ONE alert', async () => {
    w = payableWorld({ status: 'refunding', refundAttempted: true, refundError: OLD_MARKER })
    w.refunds.push(refundRow('rf_n', { status: 'pending', stripeRefundId: 're_n', reason: 'claim:cl1' }))
    w.stripeRefunds.push(stripeRefund('re_n', { status: 'succeeded', amount: 500 }))
    wireWorld(w, db, stripeMock)
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refunded', evidence: 'stripe_read' })
    expect(unfinalized()).toHaveLength(1)
    expect(unfinalized()[0]).toMatchObject({ dedupeKey: 'claim_row_unfinalized:rf_n' })
    noForbiddenText()
  })

  it('attribution PROVEN on a pending row (A-S21) → ONE alert, after the observed commit', async () => {
    w = fv()
    w.refunds.push(refundRow('rf_p', { status: 'pending', stripeRefundId: 're_p' }))
    w.stripeRefunds.push(stripeRefund('re_p', { status: 'succeeded', amount: 300 }))
    wireWorld(w, db, stripeMock)
    const order: string[] = []
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => { const out = await fn(db); order.push('commit'); return out })
    spy.mockImplementation(async (a: Alert) => { order.push(`alert:${a.kind}`); return { status: 'sent' } })
    expect(await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_p', adminId: 'op1' })).toMatchObject({ ok: true, outcome: 'refunded' })
    expect(unfinalized()).toHaveLength(1)
    expect(order.indexOf('alert:claim_refunded_row_unfinalized')).toBeGreaterThan(order.indexOf('commit'))
    noForbiddenText()
  })

  it('NEGATIVE CONTROL — the same attribution whose transaction throws → 0 alerts', async () => {
    w = fv()
    w.refunds.push(refundRow('rf_p', { status: 'pending', stripeRefundId: 're_p' }))
    w.stripeRefunds.push(stripeRefund('re_p', { status: 'succeeded', amount: 300 }))
    wireWorld(w, db, stripeMock)
    // W5 fixer (J-C42 break/restore): the callback RUNS, then the transaction aborts — its writes are rolled back — so an
    // alert moved inside the callback would be sent by this fixture and turn it red.
    let ran = false
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const snapshot = structuredClone(w.claims)
      await fn(db)
      ran = true
      w.claims.splice(0, w.claims.length, ...snapshot)
      throw Object.assign(new Error('Transaction failed due to a write conflict or a deadlock'), { code: 'P2034' })
    })
    expect(await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_p', adminId: 'op1' })).toMatchObject({ ok: false, status: 409 })
    expect(ran).toBe(true)
    expect(unfinalized()).toEqual([])
  })

  it('adoption (D9: the mirror row is succeeded) → no alert', async () => {
    w = fv()
    w.pis.pi_1.latest_charge.amount_refunded = 300
    w.stripeRefunds.push(stripeRefund('re_D12345678', { status: 'succeeded', amount: 300 }))
    wireWorld(w, db, stripeMock)
    db.refund.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: 'rf_mirror', createdAt: new Date(), ...data }
      w.refunds.push(row)
      return { ...row }
    })
    expect(await adoptStripeRefundForClaim({ claimId: 'cl1', stripeRefundId: 're_D12345678', adminId: 'op1' })).toMatchObject({ ok: true, outcome: 'refunded' })
    expect(unfinalized()).toEqual([])
    noForbiddenText()
  })
})

void stripeRefund
