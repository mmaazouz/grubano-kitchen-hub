// tests/claims-r13-rules.test.ts — T-49 round 13, J-M47 (G9, D14 (2)/(3), A-S10b, A-S10c, A-S30e-2)
//
// Only ONE lock can cease without a Claims action: another claim's pending row whose Stripe refund
// succeeded and needs no settled-royalty clawback. Every other lock is permanent. Neither is payable.
// The pure layer: which facts give the AWAITING prefix, and which approval refusal each lock gets.
// The G8 texts, T1 and the sweep are wired by a later slice.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { payableWorld, wireWorld, refundRow, claimOf, HOURS, type World } from './support/claims-world'
import { stateOf } from './fixtures/claims-r13-states'

// W3 (J-M33 / J-M34 / J-M47): the gate, the marker and the lock writer run against the shipped lib/claims.
const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { execMock, refundsFlag, alertMock, adminMock } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn(), alertMock: vi.fn(), adminMock: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { reconcileClaimEvidence, triggerClaimRefund } from '@/lib/claims'
import { POST as RECONCILE } from '@/app/api/admin/claims/[id]/reconcile/route'
import {
  reconcileRefusal, reconcileMarkerAge, isStuckResolvable, proofInstant, RECONCILE_GRACE_MS, LOCKED_CLOSE, AWAITING_CLOSE, RECONCILE_MARKER_UNREADABLE_TEXT,
} from '@/lib/claim-action-rules'
import {
  deriveNoRowOutcome, proofInstantFor, arbitrationRefusal, approveRevisableText, approvePermanentText, acceptedExits,
  ATTEMPT_QUIESCENCE_MS, MARKERS, APPROVE_ALREADY_SET,
  type ReapprovalFacts, type MoneyRow, type NoRowOutcome,
} from '@/lib/claim-action-rules'

const T0 = new Date('2026-09-12T08:00:00.000Z')
const row = (id: string, o: Partial<MoneyRow> = {}): MoneyRow => ({
  id, status: 'pending', amountCents: 300, stripeRefundId: null, reason: 'claim:cl_A', idempotencyKey: `refund:o:k_${id}`,
  createdAt: T0, royaltyRefundCents: 0, ...o,
})
/** A-S10b: cl_A's pending row rf_A, its refund re_A SUCCEEDED at Stripe; cl_A is the single refunded binder. */
const aS10b = (o: Partial<ReapprovalFacts> = {}): ReapprovalFacts => ({
  orderId: 'o', requestedAmountCents: 500, orderPaymentStatus: 'paid', hasPaymentIntent: true, piStatus: 'succeeded',
  chargeId: 'ch_1', chargeAmountCents: 2000, amountCapturedCents: 2000, chargeDisputed: false, amountRefundedCents: 300,
  routed: false, royaltyStatus: null, stripeListLength: 1,
  rows: [row('rf_A')],
  L: [{ id: 're_A', status: 'succeeded', amount: 300, charge: 'ch_1', metadata: { grubano_refund_row: 'rf_A' } }],
  truths: { rf_A: { kind: 'at_stripe', refundId: 're_A', status: 'succeeded' } },
  binders: { rf_A: [{ id: 'cl_A', status: 'refunded', refundError: null, refundId: 'rf_A' }] },
  stampedClaims: {}, succeededNotCounted: [], rowContradictions: [], ...o,
})
const prefixOf = (o: NoRowOutcome) => (o.kind === 'proof' ? o.prefix : `${o.kind}:${'outcome' in o ? o.outcome : o.reason}`)

describe('J-M47 — only the finalizable other-claim row is temporary', () => {
  it('A-S10b (and A-S30e-2, the same facts at T2) → AWAITING', () => {
    expect(prefixOf(deriveNoRowOutcome({ readable: true, facts: aS10b() }, 'cl1'))).toBe(MARKERS.AWAITING_FINALIZATION)
  })

  it('A-S10c (settled royalty, 300 c) → permanent lock', () => {
    const f = aS10b({ rows: [row('rf_A', { royaltyRefundCents: 300 })], royaltyStatus: 'settled' })
    expect(prefixOf(deriveNoRowOutcome({ readable: true, facts: f }, 'cl1'))).toBe('no_refund_proven_rail_locked:')
  })

  it('AWAITING plus H5, a tie with a dead oldest row, a truncated list, and an E6 lock → permanent', () => {
    const withH5 = aS10b({ chargeDisputed: true })
    const tie = aS10b({
      rows: [row('rf_A'), row('rf_D', { reason: null })],
      truths: { rf_A: { kind: 'at_stripe', refundId: 're_A', status: 'succeeded' }, rf_D: { kind: 'absent_dead' } },
    })
    const truncated = aS10b({ stripeListLength: 101 })
    const e6 = aS10b({
      rows: [row('rf_S', { status: 'succeeded', stripeRefundId: 're_A', idempotencyKey: 'refund:o:300' })],
      L: [{ id: 're_A', status: 'succeeded', amount: 300, charge: 'ch_1', metadata: {} }],
      truths: {}, binders: { rf_S: [{ id: 'cl_A', status: 'refunded', refundError: null, refundId: 'rf_S' }] },
    })
    for (const [name, f] of [['H5', withH5], ['tie', tie], ['truncated', truncated], ['E6', e6]] as const) {
      expect(prefixOf(deriveNoRowOutcome({ readable: true, facts: f }, 'cl1')), name).toBe('no_refund_proven_rail_locked:')
    }
  })

  it('NEGATIVE CONTROL — A-S10c must NOT get the AWAITING prefix', () => {
    const f = aS10b({ rows: [row('rf_A', { royaltyRefundCents: 300 })], royaltyStatus: 'settling' })
    expect(prefixOf(deriveNoRowOutcome({ readable: true, facts: f }, 'cl1'))).not.toBe(MARKERS.AWAITING_FINALIZATION)
  })

  it('after the other row finalized (succeeded, explained) the derivation is payable, with a NEW instant later than the earlier write + Q', () => {
    const firstWrite = T0
    const after = aS10b({ rows: [row('rf_A', { status: 'succeeded', stripeRefundId: 're_A', idempotencyKey: 'refund:o:0' })], truths: {} })
    expect(prefixOf(deriveNoRowOutcome({ readable: true, facts: after }, 'cl1'))).toBe(MARKERS.PROOF_PAYABLE_V13)
    const awaitingText = `${MARKERS.AWAITING_FINALIZATION} … la plus ancienne ligne en attente de la commande, rf_A (identité claim:cl_A), est reprise par le moteur avant tout nouveau remboursement …`
    const reconcileAt = new Date(firstWrite.getTime() + 2 * 3_600_000)
    const instant = proofInstantFor(awaitingText, reconcileAt)
    expect(instant.getTime()).toBeGreaterThan(firstWrite.getTime() + ATTEMPT_QUIESCENCE_MS)
    const v13 = { id: 'cl1', orderId: 'o', status: 'approved', refundAttempted: false, refundId: null, arbitrationDecision: 'approved', refundError: `${MARKERS.PROOF_PAYABLE_V13} … Elle est payable au plus tôt le ${instant.toISOString()} (UTC).` }
    expect(arbitrationRefusal(v13, 'approve', new Date(instant.getTime() - 1))).not.toBeNull()
    expect(arbitrationRefusal(v13, 'approve', instant)).toBeNull()
  })
})

describe('J-M47 — the approval refusal of a lock: REVISABLE when reconcile admits it, PERMANENT otherwise', () => {
  const now = new Date(T0.getTime() + 86_400_000)
  const approved = (refundError: string, o: Record<string, unknown> = {}) =>
    ({ id: 'cl1', orderId: 'o', status: 'approved', refundAttempted: false, refundId: null, arbitrationDecision: 'approved', refundError, ...o })

  it('AWAITING, a permanent lock and a safety hold (reconcile admits) → D14 (2) with the declaration sentence', () => {
    for (const c of [
      approved(`${MARKERS.AWAITING_FINALIZATION} x`),
      approved('no_refund_proven_rail_locked: x'),
      approved(`${MARKERS.SAFETY_HOLD} x`, { refundAttempted: true }),
    ]) {
      expect(arbitrationRefusal(c, 'approve', now), c.refundError).toEqual({ status: 409, error: approveRevisableText(true) })
      expect(acceptedExits({ claim: c, now }), c.refundError).toEqual(['reconcile', 'stuck_close'])
    }
  })

  it('stripe_failed, engine_failed, engine_row_dead, STRIPE_REVERTED (reconcile refuses) → D14 (3) naming the close', () => {
    for (const e of ['stripe_failed: x', 'engine_failed: x', 'engine_row_dead: x', `${MARKERS.STRIPE_REVERTED} x`]) {
      const c = approved(e, { refundAttempted: true, refundId: 'rf1' })
      expect(arbitrationRefusal(c, 'approve', now), e).toEqual({ status: 409, error: approvePermanentText(true) })
      expect(acceptedExits({ claim: c, now }), e).toEqual(['stuck_close'])
    }
  })

  it('no lock prefix is approvable', () => {
    for (const e of [`${MARKERS.AWAITING_FINALIZATION} x`, 'no_refund_proven_rail_locked: x']) {
      expect(acceptedExits({ claim: approved(e), now })).not.toContain('approve')
    }
  })
})

// ══ W3 — the shipped lib/claims ══════════════════════════════════════════════════════════════════════════════
let w: World
const setWorld = (claim: Record<string, unknown>, stateId?: string) => {
  w = payableWorld(claim)
  if (stateId) stateOf(stateId).world!(w as never)
  wireWorld(w, db, stripeMock)
}
beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [execMock, refundsFlag, alertMock, adminMock]) m.mockReset()
  refundsFlag.mockReturnValue(true)
  alertMock.mockResolvedValue({ status: 'sent' })
  adminMock.mockResolvedValue({ id: 'op1', role: 'admin', name: 'Admin', email: 'a@x.test' })
})
const NONCE = '11111111-2222-4333-8444-555555555555'
const markerAt = (iso: string) => `reconcile_required: tentative de remboursement démarrée à ${iso} (tentative ${NONCE}) — identité pas encore liée. Ceci n'est PAS un échec : la vérité argent doit être PROUVÉE (Stripe), jamais devinée.`
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
const blocked = () => alertMock.mock.calls.map((c) => c[0]).filter((a) => a.kind === 'claim_payment_blocked').map((a) => a.dedupeKey)
const post = () => RECONCILE(new Request('https://app.grubano.com/x', { method: 'POST' }), { params: { id: 'cl1' } })

describe('J-M33 — the reconcile gate: approved admissions (i), (i-b), and the existing ones (G1, D4)', () => {
  const A = (o: Record<string, unknown> = {}) => ({ id: 'cl1', orderId: 'o1', status: 'approved', refundAttempted: false, refundId: null, refundError: null, ...o })
  const HOLD = `${MARKERS.SAFETY_HOLD} Aucun remboursement n’a été lancé pour cette réclamation : x Décision humaine requise ; « Clôturer ce dossier… » enregistre votre déclaration.`

  it('(i) v13, legacy, rail-locked and AWAITING proofs → admitted; (i-b) a SAFETY_HOLD with refundAttempted true → admitted', () => {
    for (const e of [`${MARKERS.PROOF_PAYABLE_V13} x`, 'no_refund_proven: x', 'no_refund_proven_rail_locked: x', `${MARKERS.AWAITING_FINALIZATION} x`]) {
      expect(reconcileRefusal(A({ refundError: e })), e).toBeNull()
    }
    expect(reconcileRefusal(A({ refundAttempted: true, refundError: HOLD }))).toBeNull()
  })

  it('controls: refundAttempted flipped, or a refundId set → refused', () => {
    expect(reconcileRefusal(A({ refundAttempted: true, refundError: 'no_refund_proven_rail_locked: x' }))).not.toBeNull()
    expect(reconcileRefusal(A({ refundId: 'rf1', refundError: 'no_refund_proven_rail_locked: x' }))).not.toBeNull()
    expect(reconcileRefusal(A({ refundAttempted: false, refundError: HOLD }))).not.toBeNull()
  })

  it('the existing admissions: FV, a marker past its grace, legacyStranded, bound with no error, attemptedUnrecorded', () => {
    expect(reconcileRefusal(A({ status: 'financial_verification', refundError: 'financial_verification:x: d' }))).toBeNull()
    expect(reconcileRefusal(A({ status: 'refunding', refundAttempted: true, refundError: markerAt(minutesAgo(10)) }))).toBeNull()
    expect(reconcileRefusal(A({ status: 'refunding', refundAttempted: true }))).toBeNull()
    expect(reconcileRefusal(A({ status: 'refunding', refundAttempted: true, refundId: 'rf1' }))).toBeNull()
    expect(reconcileRefusal(A({ refundAttempted: true }))).toBeNull()
  })

  it('(ii) the own-row mismatch needs the bound row read; (iii) a settled bound claim too — undefined row → refused', () => {
    const mm = { status: 'refunding', refundAttempted: true, refundId: 'R', refundError: 'resume_mismatch: x' }
    expect(reconcileRefusal(A({ ...mm, boundRow: { id: 'R', orderId: 'o1', reason: 'claim:cl1' } }))).toBeNull()
    expect(reconcileRefusal(A(mm))).not.toBeNull()
    const settled = { status: 'refunded', refundAttempted: true, refundId: 'R' }
    expect(reconcileRefusal(A({ ...settled, boundRow: { id: 'R', orderId: 'o1', status: 'pending' } }))).toBeNull()
    expect(reconcileRefusal(A(settled))).not.toBeNull()
    // the list flag equals this verdict per admission: pinned by tests/claims-exit-parity.test.ts (J-M29)
  })

  it('route on (i) with nothing at Stripe → the N0-N8 payable proof; on (i-b) → the proof resets refundAttempted false (only this write does)', async () => {
    setWorld(A({ refundError: 'no_refund_proven_rail_locked: écrit avant' }))
    let res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()).result).toMatchObject({ ok: true, outcome: 'no_refund_proven' })
    setWorld(A({ refundAttempted: true, refundError: HOLD }))
    res = await post()
    expect((await res.json()).result).toMatchObject({ ok: true, outcome: 'no_refund_proven' })
    expect(w.writes).toHaveLength(1)
    expect(w.writes[0].where).toMatchObject({ refundAttempted: true, refundError: HOLD })
    expect(claimOf(w)).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('(i) on unexplained money (A-S19) → a park through enterFinancialVerification with the read pre-image', async () => {
    setWorld(A({ refundError: 'no_refund_proven_rail_locked: écrit avant' }), 'A-S19')
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'refund_moved_unattributed' })
    expect(w.writes[0].where).toEqual({ id: 'cl1', status: 'approved', refundError: 'no_refund_proven_rail_locked: écrit avant' })
    expect(alertMock.mock.calls.map((c) => c[0].dedupeKey)).toEqual(['claim_fv:cl1:refund_moved_unattributed'])
  })

  it('N8: a row stamped for the claim appears before the write → changed_during_read with 0 updateMany', async () => {
    setWorld(A({ refundAttempted: true, refundError: HOLD }))
    db.refund.findFirst.mockResolvedValueOnce({ id: 'rf_late' })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'changed_during_read' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — approved, null error, refundAttempted false → refused by the route (409), not reconcilable, 0 writes', async () => {
    setWorld(A())
    const res = await post()
    expect(res.status).toBe(409)
    expect(reconcileRefusal(A())).not.toBeNull()
    expect(w.writes).toEqual([])
  })
})

describe('J-M34 — reconcile a refunding claim: the marker after its grace (D5, E-05)', () => {
  it('M (ISO + nonce) at grace − 1 s → refused with the grace text and no reconcile exit; at grace + 1 s → admitted', () => {
    const at = (ms: number) => markerAt(new Date(Date.now() - ms).toISOString())
    const c = (e: string) => ({ id: 'cl1', orderId: 'o1', status: 'refunding', refundAttempted: true, refundId: null, refundError: e })
    expect(reconcileRefusal(c(at(RECONCILE_GRACE_MS - 1000)))?.error).toContain('moins de 5 minutes')
    expect(acceptedExits({ claim: c(at(RECONCILE_GRACE_MS - 1000)), now: new Date() })).toEqual([])
    expect(reconcileRefusal(c(at(RECONCILE_GRACE_MS + 1000)))).toBeNull()
    expect(acceptedExits({ claim: c(at(RECONCILE_GRACE_MS + 1000)), now: new Date() })).toEqual(['reconcile'])
  })

  it('NEGATIVE CONTROL — a marker with a nonce but a malformed ISO → reconcileMarkerAge null → refused, never treated as aged', () => {
    const bad = markerAt('2026-13-45T99:99:99.000Z').replace('2026-13-45T99:99:99.000Z', '2026-09-10Tzz')
    expect(reconcileMarkerAge(bad)).toBeNull()
    expect(reconcileRefusal({ status: 'refunding', refundAttempted: true, refundError: bad })).toEqual({ status: 409, error: RECONCILE_MARKER_UNREADABLE_TEXT })
    // and a well-formed nonce marker is read by its ISO, never by the nonce
    expect(reconcileMarkerAge(markerAt(minutesAgo(10)))).toBeGreaterThanOrEqual(10 * 60_000)
  })

  const A_S35 = (hours: number) => {
    setWorld({ status: 'refunding', refundAttempted: true, refundError: `${markerAt(minutesAgo(10))} Moteur : « Erreur paiement, réessayez. » — la ligne rf_n existe ; seule la preuve établira ce qui a été versé ou non.` })
    const createdAt = new Date(Date.now() - hours * HOURS)
    w.refunds.push(refundRow('rf_n', { status: 'pending', reason: 'claim:cl1', createdAt }))
    return createdAt
  }
  for (const hours of [2, 20.5]) {
    it(`A-S35 at ${hours} h → unconfirmed_within_window until createdAt + 21 h, nothing written`, async () => {
      const createdAt = A_S35(hours)
      expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'unconfirmed_within_window', refundId: 'rf_n', until: new Date(createdAt.getTime() + 21 * HOURS).toISOString() })
      expect(w.writes).toEqual([])
    })
  }

  it('A-S35 at 22 h → engine_row_dead + ALERT-B → the declaration close is its only exit', async () => {
    A_S35(22)
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'engine_row_dead', refundId: 'rf_n' })
    expect(blocked()).toEqual(['claim_blocked:cl1:engine_row_dead'])
    // D′ L4 (D1 v1.1): the amount is FIXED on this row, so the declared set also carries the audited reversal and the rail…
    const bound = { id: 'rf_n', orderId: 'o1', status: 'pending', reason: 'claim:cl1' }
    // D′ L4 control parity: engine_row_dead is a recorded money state — neither the rail nor the reversal
    // accepts it, so « the declaration close is its only exit » (this test's own title) is now literally true.
    expect(acceptedExits({ claim: claimOf(w) as never, boundRow: bound, now: new Date() })).toEqual(['stuck_close'])
    // …and the declaration close is still the ONLY exit of the very same facts when no amount was ever ratified.
    expect(acceptedExits({ claim: { ...claimOf(w), approvedAmountCents: null } as never, boundRow: bound, now: new Date() })).toEqual(['stuck_close'])
  })

  it('A-S30d — executeRefund rejects after T1: the claim stays on its token, attempt_crashed is alerted, the throw propagates; reconcile after the grace → the v13 proof, instant = marker + Q', async () => {
    setWorld({})
    execMock.mockRejectedValue(new Error('db down after T1'))
    await expect(triggerClaimRefund('cl1')).rejects.toThrow('db down after T1')
    const c = claimOf(w)
    expect(c).toMatchObject({ status: 'refunding', refundAttempted: true, refundId: null })
    expect(String(c.refundError).startsWith('reconcile_required: ')).toBe(true)
    expect(blocked()).toEqual(['claim_blocked:cl1:attempt_crashed'])
    expect(w.refunds).toEqual([])
    const iso = /(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(String(c.refundError))![1]
    const past = minutesAgo(10)
    c.refundError = String(c.refundError).replace(iso, past)
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toEqual({ ok: true, outcome: 'no_refund_proven', payableFrom: new Date(Date.parse(past) + ATTEMPT_QUIESCENCE_MS).toISOString() })
  })

  it('A-S12 — a refunding pre-image with another claim’s id-less pending row at 10 h → no write, until createdAt + 21 h', async () => {
    setWorld({ status: 'refunding', refundAttempted: true, refundError: markerAt(minutesAgo(10)) }, 'A-S12')
    const createdAt = w.refunds[0].createdAt as Date
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'unconfirmed_within_window', refundId: null, until: new Date(createdAt.getTime() + 21 * HOURS).toISOString() })
    expect(w.writes).toEqual([])
  })

  it('approve on a refunding claim → « n’est pas en arbitrage »; isStuckResolvable false under a marker', () => {
    const c = { id: 'cl1', orderId: 'o1', status: 'refunding', refundAttempted: true, refundId: null, refundError: markerAt(minutesAgo(10)) }
    expect(arbitrationRefusal(c, 'approve', new Date())?.error).toBe('Cette réclamation n’est pas en arbitrage.')
    expect(isStuckResolvable(c)).toBe(false)
  })
})

describe('J-M47 — the writer: AWAITING and LOCKED tails, the new instant after finalization, T1 refuses every lock', () => {
  const PRE = { status: 'approved', refundAttempted: false, refundId: null, refundError: 'no_refund_proven_rail_locked: écrit avant' }

  it('A-S10b → the AWAITING prefix and tail; A-S10c → the LOCKED tail (« ne cessera pas »)', async () => {
    setWorld(PRE, 'A-S10b')
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ outcome: 'no_refund_proven_awaiting_finalization', rowIds: ['rf_A'] })
    const awaiting = String(claimOf(w).refundError)
    expect(awaiting.startsWith(`${MARKERS.AWAITING_FINALIZATION} `)).toBe(true)
    expect(awaiting.endsWith(AWAITING_CLOSE)).toBe(true)
    setWorld(PRE, 'A-S10c')
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'no_refund_proven_rail_locked' })
    const locked = String(claimOf(w).refundError)
    expect(locked.endsWith(LOCKED_CLOSE)).toBe(true)
    expect(locked).toContain('une cause qui ne dépend d’aucune action ultérieure ne cessera pas')
  })

  it('NEGATIVE CONTROL — A-S10c never carries « lorsque cette ligne ne sera plus « en attente » »', async () => {
    setWorld(PRE, 'A-S10c')
    await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(String(claimOf(w).refundError)).not.toContain('lorsque cette ligne ne sera plus « en attente »')
  })

  it('after the other row finalized, reconcile writes a NEW v13 proof with a NEW instant (> the earlier write + Q), and the claim is not payable before it', async () => {
    setWorld(PRE, 'A-S10b')
    const firstWriteAt = Date.now() - 1
    await reconcileClaimEvidence({ claimId: 'cl1' })
    // the webhook finalized rf_A: our row is now succeeded with its Stripe id
    Object.assign(w.refunds[0], { status: 'succeeded', stripeRefundId: 're_rf_A' })
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'no_refund_proven' })
    const v13 = String(claimOf(w).refundError)
    const instant = proofInstant(v13)!
    expect(instant.getTime()).toBeGreaterThan(firstWriteAt + ATTEMPT_QUIESCENCE_MS)
    // D′ L4 (S-29): with the amount fixed the re-approval is refused first; with none, the C4 instant still refuses.
    expect(arbitrationRefusal({ ...claimOf(w), arbitrationDecision: 'approved' } as never, 'approve', new Date(instant.getTime() - 1))?.error).toBe(APPROVE_ALREADY_SET)
    expect(arbitrationRefusal({ ...claimOf(w), arbitrationDecision: 'approved', approvedAmountCents: null } as never, 'approve', new Date(instant.getTime() - 1))?.error).toMatch(/^Approbation prématurée/)
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'already_handled' })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('T1 refuses every lock prefix: triggerClaimRefund writes nothing and never calls the engine', async () => {
    for (const e of [`${MARKERS.AWAITING_FINALIZATION} x`, 'no_refund_proven_rail_locked: x', 'no_refund_proven: legacy', `${MARKERS.SAFETY_HOLD} x`]) {
      setWorld({ refundError: e, refundAttempted: e.startsWith(MARKERS.SAFETY_HOLD) })
      expect(await triggerClaimRefund('cl1'), e).toEqual({ state: 'already_handled' })
      expect(w.writes, e).toEqual([])
    }
    expect(execMock).not.toHaveBeenCalled()
    // « the sweep skips it » is pinned by tests/claims-r13-quiescence.test.ts (C4 note)
  })
})
