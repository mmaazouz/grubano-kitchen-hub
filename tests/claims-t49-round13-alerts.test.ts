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
import { triggerClaimRefund, arbitrateClaim, runClaimAutoApproval, alertClaimPaymentBlocked, reconcileClaimEvidence, CLAIM_BLOCKED_TITLE, CLAIM_ATTEMPT_SUPERSEDED_TITLE } from '@/lib/claims'
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

/** Checks one claim_payment_blocked alert against the I-01 contract. */
function expectBlocked(cause: string, o: { status?: string; engineCalled?: boolean; registry?: string } = {}) {
  const a = calls('claim_payment_blocked')
  expect(a, cause).toHaveLength(1)
  expect(a[0].title).toBe(CLAIM_BLOCKED_TITLE)
  expect(a[0].title).toBe('Réclamation non payée par le rail — décision admin requise')
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

/** The T2 / T4 trigger fixtures: [name, world mutation, engine result or null, expected cause, CAS index of the trigger write]. */
const TRIGGERS: Array<[string, (x: World) => void, Record<string, unknown> | null, string, number]> = [
  ['T2 (a) own row', (x) => { x.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', status: 'pending' })) }, null, 'own_row_exists', 2],
  ['T2 (b) revert', (x) => { x.fail.piRetrieve = true }, null, 'safety_check_unreadable', 2],
  ['T2 (b\') no charge', (x) => { x.pis.pi_1.latest_charge = null }, null, 'safety_hold', 2],
  ['T2 (c) hold', (x) => { x.pis.pi_1.latest_charge.disputed = true }, null, 'safety_hold', 2],
  ['T2 (e\') lock', (x) => { x.refunds.push(refundRow('rf_D', { status: 'pending', createdAt: new Date(Date.now() - 30 * HOURS) })) }, null, 'no_refund_proven_rail_locked:', 2],
  ['T2 (e\') window revert', (x) => { x.refunds.push(refundRow('rf_W', { status: 'pending', createdAt: new Date(Date.now() - HOURS) })) }, null, 'unconfirmed_within_window', 2],
  // The engine puts the resumed row in the base: present before T2, it would be a Claims-side H1 hold, not an engine outcome.
  ['T4 resume_mismatch', (x) => { execMock.mockImplementation(async () => { x.refunds.push(refundRow('rf9', { reason: 'claim:OTHER' })); return engineOk({ resumed: true, refundId: 'rf9' }) }) }, null, 'resume_mismatch', 2],
  ['T4 identity_unverified', () => {}, engineOk({ resumed: true, refundId: 'rf_unread' }), 'identity_unverified', 2],
  ['T4 own-row fatal', (x) => { execMock.mockImplementation(async () => { x.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', status: 'pending' })); return engineRefusal('Erreur paiement, réessayez.', 502) }) }, null, 'engine_own_row', 2],
  ['T4 engine_failed', () => {}, engineRefusal(), 'engine_failed', 2],
]

describe('J-M52 / J-C39 — claim_payment_blocked after a won CAS only (I-01)', () => {
  it('MoneyReviewKind carries both new kinds', () => {
    const kinds: MoneyReviewKind[] = ['claim_payment_blocked', 'claim_attempt_superseded']
    expect(kinds).toHaveLength(2)
    expect(read('lib/admin-alerts.ts')).toMatch(/\| 'claim_payment_blocked'/)
    expect(read('lib/admin-alerts.ts')).toMatch(/\| 'claim_attempt_superseded'/)
  })

  for (const [name, mutate, result, cause, casIndex] of TRIGGERS) {
    it(`${name}: count 1 → sent once with the I-01 facts; count 0 → not sent`, async () => {
      mutate(w)
      if (result) execMock.mockResolvedValue(result)
      await triggerClaimRefund('cl1')
      expectBlocked(cause)
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
    const run = async (setup: () => void, message: string) => {
      spy.mockClear()
      w = payableWorld()
      wireWorld(w, db, stripeMock)
      execMock.mockReset()
      execMock.mockResolvedValue(engineOk())
      setup()
      await expect(triggerClaimRefund('cl1')).rejects.toThrow(message)
      expectBlocked('attempt_crashed')
      return calls('claim_payment_blocked')[0].facts.engineCalled
    }
    // T2 (c): the safety-hold write (claim write 2) throws — the engine was never reached.
    expect(await run(() => { w.pis.pi_1.latest_charge.disputed = true; w.beforeClaimWrite = (n) => { if (n === 2) throw new Error('t2 write failed') } }, 't2 write failed')).toBe(false)
    expect(execMock).not.toHaveBeenCalled()
    expect(await run(() => { execMock.mockImplementation(async () => { throw new Error('finalize failed') }) }, 'finalize failed')).toBe(true)
    // T4: the engine returned ok (Stripe accepted the refund), then the claim write throws.
    expect(await run(() => { w.beforeClaimWrite = (n) => { if (n === 2) throw new Error('t4 write failed') } }, 't4 write failed')).toBe(true)
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

void stripeRefund
