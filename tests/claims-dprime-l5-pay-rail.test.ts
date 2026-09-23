// tests/claims-dprime-l5-pay-rail.test.ts — D′ lot L5 (spec v2 §8.1-§8.7): the claims FINANCIAL RAIL.
//
// L5 is the second half of the D′ architecture: Grubano decides (L4), and money leaves here, separately, only
// inside a window a human opened. What this file proves, in the founder's own order:
//   • the two gates: the REFUNDS lease AND the claims product surface, both, or nothing is attempted — and the
//     legacy rehearsal lease never opens the rail (S-14);
//   • no audit, no payment (S-30); an unusable schema answers « not right now », it does not crash (S-27);
//   • PAYER pays the SIGNED batch and never re-selects: a claim whose amount or decision instant moved since
//     the dryRun is skipped with zero writes;
//   • the lease is re-read before EVERY claim with a 60-second margin, and a batch that runs out of window
//     reports the rest `not_attempted` — never « failed » (S-05);
//   • a throw stops the batch and still answers 200 with the partial report;
//   • the rail writes NO decision field of its own (S-06) and never reaches the engine except through
//     triggerClaimRefund, which owns every safety rule.
// The engine behind the spy is the REAL lib/refund, on the same in-memory world, so « no Stripe write » is
// measured rather than assumed, and each control carries a negative control proving the world CAN move.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const {
  db, stripeMock, engineSpy, triggerSpy, alertMock, auditMock, adminMock, schemaMock, noticeMock,
} = vi.hoisted(() => ({
  db: {
    claim:            { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund:           { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), aggregate: vi.fn(), count: vi.fn() },
    order:            { findUnique: vi.fn(), findMany: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    dispute:          { aggregate: vi.fn() },
    payout:           { findUnique: vi.fn() },
    emailDispatch:    { create: vi.fn(), findFirst: vi.fn() },
    adminAuditLog:    { create: vi.fn() },
    $transaction:     vi.fn(),
  },
  stripeMock: {
    paymentIntents:  { retrieve: vi.fn() },
    refunds:         { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() },
    transfers:       { list: vi.fn(), listReversals: vi.fn(), createReversal: vi.fn() },
    applicationFees: { listRefunds: vi.fn() },
  },
  engineSpy: { fn: vi.fn() },
  triggerSpy: { fn: vi.fn(), real: null as null | ((id: string) => Promise<unknown>) },
  alertMock: vi.fn(), auditMock: vi.fn(), adminMock: vi.fn(), noticeMock: vi.fn(),
  schemaMock: { fn: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))
vi.mock('@/lib/refund', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/refund')>()
  engineSpy.fn.mockImplementation((input: Parameters<typeof real.executeRefund>[0]) => real.executeRefund(input))
  return { ...real, executeRefund: (input: Parameters<typeof real.executeRefund>[0]) => engineSpy.fn(input) }
})
// The REAL rail functions run by default; a test that needs a specific engine answer overrides the spy.
vi.mock('@/lib/claims', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/claims')>()
  triggerSpy.real = real.triggerClaimRefund
  return { ...real, triggerClaimRefund: (id: string) => triggerSpy.fn(id) }
})
vi.mock('@/lib/ledger', () => ({ recordRefundLedgerEntry: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
vi.mock('@/lib/admin-audit', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/admin-audit')>()
  return { ...real, recordAdminAudit: auditMock }
})
vi.mock('@/lib/claim-emails', () => ({ sendClaimClosureEmail: noticeMock }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null }))
vi.mock('@/lib/schema-ready', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/schema-ready')>()
  return { ...real, schemaReady: (...a: unknown[]) => schemaMock.fn(...a) }
})

import { POST as PAY } from '@/app/api/admin/claims/pay-approved/route'
import { signPayToken, PAY_TOKEN_TTL_MS } from '@/lib/claims-pay-token'
import {
  classifyRailResult, preflightVerdict, payableShapeRefusal, leaseUsable, bucketOf, tally, noticeDue, moneyMovedOf,
  LEASE_SAFETY_MARGIN_MS, PAY_BUDGET_MS, ENGINE_FAILED_PREFIX,
} from '@/lib/claims-pay-rail'
import { MAX_BATCH, PAYABLE_WHERE } from '@/lib/claims-payable-core'
import { payableWorld, claimOf, type World } from './support/claims-world'
import { wireEngineWorld, type EngineWorld } from './support/claims-engine-world'

const SCHEMA_READY = { ready: true, clientReady: true, dbReady: true, missingClient: [], missingDb: [], probedAt: '', why: null }
const ADMIN = { id: 'admin1', email: 'admin@grubano.test', role: 'admin', name: 'A' }

let w: EngineWorld

const openRefundsLease = (minutes = 15) => {
  process.env.REFUNDS_ENABLED = 'true'
  process.env.REFUNDS_WINDOW_UNTIL = new Date(Date.now() + minutes * 60_000).toISOString()
}
const closeRefundsLease = () => { delete process.env.REFUNDS_ENABLED; delete process.env.REFUNDS_WINDOW_UNTIL }
const openSurface = () => { process.env.CLAIMS_SURFACE_ENABLED = 'true' }
const closeSurface = () => { delete process.env.CLAIMS_SURFACE_ENABLED }
/** The rehearsal-only lease of Mode A/B. It opens the claims SURFACE; it must never open the rail (S-14). */
const openLegacyLease = () => {
  process.env.CLAIMS_ENABLED = 'true'
  process.env.CLAIMS_WINDOW_UNTIL = new Date(Date.now() + 30 * 60_000).toISOString()
}
const closeLegacyLease = () => { delete process.env.CLAIMS_ENABLED; delete process.env.CLAIMS_WINDOW_UNTIL }

/** Everything that would mean money actually moved. */
const moneyTouched = () => ({
  engine: engineSpy.fn.mock.calls.length,
  create: stripeMock.refunds.create.mock.calls.length,
  rows:   w.refunds.length,
})

const call = (body: Record<string, unknown>) =>
  PAY(new Request('https://app.grubano.com/api/admin/claims/pay-approved', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))

const setWorld = (claim: Record<string, unknown> = {}, extra?: (x: EngineWorld) => void) => {
  w = payableWorld(claim) as EngineWorld
  for (const group of Object.values(db)) {
    if (typeof group === 'function') continue
    for (const m of Object.values(group)) (m as { mockReset: () => void }).mockReset()
  }
  for (const group of Object.values(stripeMock)) for (const m of Object.values(group)) (m as { mockReset: () => void }).mockReset()
  extra?.(w)
  wireEngineWorld(w, db, stripeMock)
  db.emailDispatch.create.mockResolvedValue({})
  db.adminAuditLog.create.mockResolvedValue({ id: 'aud1' })
  db.refund.count.mockImplementation(async ({ where }: { where: { orderId?: string; status?: string; reason?: string } }) =>
    w.refunds.filter((r) =>
      (!where.orderId || r.orderId === where.orderId)
      && (!where.status || r.status === where.status)
      && (!where.reason || r.reason === where.reason)).length)
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db))
  return w
}

/** The dryRun the console runs, then the batch it signs. */
const dry = async (body: Record<string, unknown> = {}) => {
  const res = await call({ dryRun: true, ...body })
  return { res, body: await res.json() as Record<string, unknown> }
}

beforeEach(() => {
  vi.clearAllMocks()
  engineSpy.fn.mockClear()
  // A test that drives a specific engine answer must not leak it into the next one: the REAL trigger is
  // restored every time, so « by default this file measures the product » stays true test after test.
  triggerSpy.fn.mockReset()
  triggerSpy.fn.mockImplementation((id: string) => triggerSpy.real!(id))
  alertMock.mockReset(); alertMock.mockResolvedValue({ status: 'sent' })
  auditMock.mockReset(); auditMock.mockResolvedValue(true)
  adminMock.mockReset(); adminMock.mockResolvedValue(ADMIN)
  noticeMock.mockReset(); noticeMock.mockResolvedValue({ status: 'sent', kind: 'refunded' })
  schemaMock.fn.mockReset(); schemaMock.fn.mockResolvedValue(SCHEMA_READY)
  process.env.NEXTAUTH_SECRET = 'rail-test-secret'
  process.env.ADMIN_AUDIT_ENABLED = 'true'
  openSurface()
  openRefundsLease()
  setWorld()
})
afterEach(() => {
  closeRefundsLease(); closeSurface(); closeLegacyLease()
  delete process.env.ADMIN_AUDIT_ENABLED
})

// ══ 1. THE PURE DECISIONS (lib/claims-pay-rail) ═══════════════════════════════════════════════════════════

describe('D′ L5 — the outcome table of spec v2 §8.6 is total, closed and stops where it must', () => {
  const after = (status: string, refundError: string | null, refundId: string | null = null) => ({ status, refundError, refundId })

  it('every arm of the table maps to its outcome, and only two of them stop the batch', () => {
    expect(classifyRailResult({ state: 'refunded', refundId: 'rf1', amountCents: 500 }, null))
      .toEqual({ outcome: 'paid', stop: false })
    expect(classifyRailResult({ state: 'pending', reason: 'stripe_pending', refundId: 'rf1' }, null))
      .toEqual({ outcome: 'accepted_pending', stop: false })
    expect(classifyRailResult({ state: 'pending', reason: 'refunds_disabled' }, null))
      .toEqual({ outcome: 'lease_closed', stop: true })
    expect(classifyRailResult({ state: 'already_handled' }, null))
      .toEqual({ outcome: 'state_changed_since_dryrun', stop: false })
    expect(classifyRailResult({ state: 'failed', error: 'attempt_superseded' }, null))
      .toEqual({ outcome: 'superseded', stop: false })
    expect(classifyRailResult({ state: 'failed', error: 'amount_not_ratified' }, null))
      .toEqual({ outcome: 'not_paid:amount_not_ratified', stop: false })
    for (const e of ['safety_hold', 'proof_stale', 'own_row_exists', 'safety_check_unreadable']) {
      expect(classifyRailResult({ state: 'failed', error: e }, null)).toEqual({ outcome: `held:${e}`, stop: false })
    }
    expect(classifyRailResult({ state: 'failed', error: 'unconfirmed_within_window', until: '2026-01-01T00:00:00.000Z' }, null))
      .toEqual({ outcome: 'held:unconfirmed_within_window', stop: false, until: '2026-01-01T00:00:00.000Z' })
    for (const e of ['resume_mismatch', 'identity_unverified']) {
      expect(classifyRailResult({ state: 'failed', error: e }, null)).toEqual({ outcome: `review:${e}`, stop: false, error: e })
    }
    // Only a closed lease and a crash stop a batch. Everything else is one claim's answer, not the batch's.
    const stops = [
      classifyRailResult({ state: 'pending', reason: 'refunds_disabled' }, null).stop,
      classifyRailResult({ state: 'failed', error: 'safety_hold' }, null).stop,
    ]
    expect(stops).toEqual([true, false])
  })

  it('⭐ an engine refusal that CREATED NOTHING is « not paid »; anything else — including a claim we could not re-read — is « review »', () => {
    const engineSaid = 'Erreur paiement, réessayez.'
    // « Nothing created » needs all three: approved, the engine_failed prefix, AND no row bound.
    expect(classifyRailResult({ state: 'failed', error: engineSaid }, after('approved', `${ENGINE_FAILED_PREFIX}${engineSaid} — …`, null)))
      .toEqual({ outcome: 'not_paid:engine_failed', stop: false, error: engineSaid, evidence: 'claim_reread' })
    // ⭐⭐ THE ROW-CREATED-THEN-FAILED CASE. The engine inserted the refund row, Stripe answered « failed »,
    // markRefundRowFailed stamped the row — and on a routed charge the reverse transfer is NOT restored, so
    // the restaurant has already been debited. The trigger writes the same prefix but ALSO binds refundId:
    // classifying this as « 0 € » would print a false money fact on the one screen a human acts from.
    expect(classifyRailResult({ state: 'failed', error: 'Remboursement Stripe en échec — reprise manuelle requise (le transfert inversé n’est pas restauré par Stripe : re-transférer le net au restaurant, puis rembourser sans reverse_transfer).' },
      after('approved', `${ENGINE_FAILED_PREFIX}Remboursement Stripe en échec — …`, 'rf_failed')).outcome)
      .toBe('review:engine_own_row')
    // A claim still on its attempt token: its own refund row exists or could not be read — money may have moved.
    expect(classifyRailResult({ state: 'failed', error: engineSaid }, after('refunding', 'reconcile:… Moteur : « … » — la ligne rf_1 existe')))
      .toEqual({ outcome: 'review:engine_own_row', stop: false, error: engineSaid, evidence: 'claim_reread' })
    // NEGATIVE CONTROL — unreadable is NOT read as « nothing moved »: it takes the safer bucket and says why.
    expect(classifyRailResult({ state: 'failed', error: engineSaid }, null))
      .toEqual({ outcome: 'review:engine_own_row', stop: false, error: engineSaid, evidence: 'claim_unreadable' })
    // NEGATIVE CONTROL — the prefix is the discriminator, not the status alone.
    expect(classifyRailResult({ state: 'failed', error: engineSaid }, after('approved', 'refund_safety_hold: …')).outcome)
      .toBe('review:engine_own_row')
  })

  it('⭐ « money was issued, the royalty resume failed » arrives as a FAILURE and is never reported as 0 €', () => {
    // lib/refund answers ok:false with this sentence AFTER the customer was refunded. The claim keeps its
    // attempt token (its own row exists), so the rail must send it to review — never « not paid ».
    const said = 'Remboursement émis, reprise de la royalty franchisé en échec — réessayez.'
    const cls = classifyRailResult({ state: 'failed', error: said }, after('refunding', 'reconcile:… la ligne rf_9 existe'))
    expect(cls.outcome).toBe('review:engine_own_row')
    expect(bucketOf(cls.outcome)).toBe('review')
  })

  it('the buckets, the notice rule and the tally', () => {
    expect(bucketOf('paid')).toBe('paid')
    expect(bucketOf('accepted_pending')).toBe('pending')
    expect(bucketOf('held:safety_hold')).toBe('held')
    expect(bucketOf('review:resume_mismatch')).toBe('review')
    expect(bucketOf('skipped:stale_dryrun')).toBe('skipped')
    expect(bucketOf('not_attempted')).toBe('not_attempted')
    for (const o of ['lease_closed', 'state_changed_since_dryrun', 'superseded', 'not_paid:engine_failed', 'crashed'] as const) {
      expect(bucketOf(o), o).toBe('failed')
    }
    // ⭐ THREE VALUES, because two are not enough: « not established » is its own answer, and an audit row
    // that said `false` about a crashed attempt or a lost CAS would invite the one conclusion this whole
    // architecture exists to prevent. Found by the D′ L5 adversarial review.
    expect(moneyMovedOf('paid')).toBe(true)
    for (const o of ['accepted_pending', 'review:resume_mismatch', 'review:identity_unverified',
      'review:engine_own_row', 'crashed', 'superseded'] as const) {
      expect(moneyMovedOf(o), o).toBe('unknown')
    }
    for (const o of ['lease_closed', 'state_changed_since_dryrun', 'not_paid:amount_not_ratified',
      'not_paid:engine_failed', 'held:safety_hold', 'held:proof_stale', 'held:own_row_exists',
      'held:unconfirmed_within_window', 'held:safety_check_unreadable', 'not_attempted',
      'skipped:stale_dryrun', 'skipped:not_selectable', 'skipped:claim_unreadable'] as const) {
      expect(moneyMovedOf(o), o).toBe(false)
    }
    // ONLY a proven payment notifies a customer (§8.6: accepted_pending sends nothing).
    expect(noticeDue('paid')).toBe(true)
    for (const o of ['accepted_pending', 'review:resume_mismatch', 'held:safety_hold', 'not_paid:engine_failed', 'crashed'] as const) {
      expect(noticeDue(o), o).toBe(false)
    }
    expect(tally(['paid', 'paid', 'accepted_pending', 'held:proof_stale', 'review:engine_own_row', 'crashed', 'not_attempted', 'skipped:stale_dryrun']))
      .toEqual({ requested: 8, paid: 2, pending: 1, held: 1, review: 1, failed: 1, skipped: 1, notAttempted: 1 })
  })

  it('the lease margin: a window with less than 60 s left is treated as CLOSED', () => {
    expect(leaseUsable({ open: true, expiresAt: new Date(), remainingMs: LEASE_SAFETY_MARGIN_MS + 1 })).toBe(true)
    expect(leaseUsable({ open: true, expiresAt: new Date(), remainingMs: LEASE_SAFETY_MARGIN_MS })).toBe(false)
    expect(leaseUsable({ open: true, expiresAt: new Date(), remainingMs: 59_000 })).toBe(false)
    expect(leaseUsable({ open: false, reason: 'flag_off' })).toBe(false)
    expect(LEASE_SAFETY_MARGIN_MS).toBe(60_000)
    expect(PAY_BUDGET_MS).toBe(40_000)
  })

  it('the preflight refuses in the order of certainty, and never calls an unknown ceiling « too high »', () => {
    const base = { approvedAmountCents: 500, requestedAmountCents: 500, funding: 'ok' as const, maxRefundableCents: 2000, ceilingReadable: true, orderHasPendingRow: false }
    expect(preflightVerdict(base)).toEqual({ payable: true })
    expect(preflightVerdict({ ...base, approvedAmountCents: null }).payable).toBe(false)
    expect(preflightVerdict({ ...base, approvedAmountCents: 501 })).toEqual({ payable: false, hold: 'amount_not_ratified' })
    expect(preflightVerdict({ ...base, funding: 'routed_without_fee' })).toEqual({ payable: false, hold: 'routed_without_fee' })
    expect(preflightVerdict({ ...base, funding: 'unreadable' })).toEqual({ payable: false, hold: 'funding_unreadable' })
    // Unreadable ceiling ⇒ « unknown », not « exceeds »: we never assert a number we did not read.
    expect(preflightVerdict({ ...base, ceilingReadable: false, maxRefundableCents: null })).toEqual({ payable: false, hold: 'ceiling_unreadable' })
    expect(preflightVerdict({ ...base, maxRefundableCents: 400 })).toEqual({ payable: false, hold: 'exceeds_refundable', detail: '500 > 400' })
    expect(preflightVerdict({ ...base, orderHasPendingRow: true })).toEqual({ payable: false, hold: 'order_has_pending_row' })
    // NEGATIVE CONTROL — a payment with no PaymentIntent is NOT held here: the engine refuses it itself, unwritten.
    expect(preflightVerdict({ ...base, funding: null })).toEqual({ payable: true })
  })

  it('the payable SHAPE is the §8.5 selection, plus v13 only when a human names the claim', () => {
    const ok = { status: 'approved', arbitrationDecision: 'approved', refundAttempted: false, refundId: null, refundError: null, approvedAmountCents: 500, requestedAmountCents: 500 }
    const now = Date.now()
    expect(payableShapeRefusal(ok, { nowMs: now, allowV13: false })).toBeNull()
    expect(payableShapeRefusal({ ...ok, status: 'arbitration' }, { nowMs: now, allowV13: false })).toBe('status')
    expect(payableShapeRefusal({ ...ok, arbitrationDecision: null }, { nowMs: now, allowV13: false })).toBe('arbitration_decision')
    expect(payableShapeRefusal({ ...ok, refundAttempted: true }, { nowMs: now, allowV13: false })).toBe('refund_attempted')
    expect(payableShapeRefusal({ ...ok, refundId: 'rf1' }, { nowMs: now, allowV13: false })).toBe('refund_id')
    expect(payableShapeRefusal({ ...ok, approvedAmountCents: null }, { nowMs: now, allowV13: false })).toBe('amount_not_ratified')
    expect(payableShapeRefusal({ ...ok, approvedAmountCents: 501 }, { nowMs: now, allowV13: false })).toBe('amount_not_ratified')
    // S-14b: a v13 proof is NEVER selected automatically…
    const past = new Date(now - 60_000).toISOString()
    const future = new Date(now + 60_000).toISOString()
    const v13 = (iso: string) => ({ ...ok, refundError: `no_refund_proven:v13: payable au plus tôt le ${iso} (UTC)` })
    expect(payableShapeRefusal(v13(past), { nowMs: now, allowV13: false })).toBe('refund_error')
    // …and when it is named, only after its instant.
    expect(payableShapeRefusal(v13(past), { nowMs: now, allowV13: true })).toBeNull()
    expect(payableShapeRefusal(v13(future), { nowMs: now, allowV13: true })).toBe('v13_before_instant')
    // NEGATIVE CONTROL — any OTHER recorded money state stays refused even when named.
    expect(payableShapeRefusal({ ...ok, refundError: 'refund_safety_hold: …' }, { nowMs: now, allowV13: true })).toBe('refund_error')
  })

  it('the selection of §8.5 has exactly the six clauses, and the batch cap is 20', () => {
    expect(PAYABLE_WHERE).toEqual({
      status: 'approved', arbitrationDecision: 'approved', refundAttempted: false,
      refundId: null, refundError: null, approvedAmountCents: { not: null },
    })
    expect(MAX_BATCH).toBe(20)
  })
})

// ══ 2. THE GATES ══════════════════════════════════════════════════════════════════════════════════════════

describe('D′ L5 — what must be true before a single claim is attempted', () => {
  const PAY_BODY = { confirm: 'PAYER', token: 'x' }

  it('not an admin → 403, and nothing is read: a machine never pays a claim (S-04)', async () => {
    adminMock.mockResolvedValue(null)
    expect((await call({ dryRun: true })).status).toBe(403)
    expect((await call(PAY_BODY)).status).toBe(403)
    expect(db.claim.findMany).not.toHaveBeenCalled()
    expect(triggerSpy.fn).not.toHaveBeenCalled()
  })

  it('the schema probe is not ready → 503 on BOTH calls, zero reads (S-27)', async () => {
    schemaMock.fn.mockResolvedValue({ ready: false, clientReady: false, dbReady: null, missingClient: ['Claim.approvedAmountCents'], missingDb: [], probedAt: '', why: 'stale client' })
    const d = await call({ dryRun: true })
    expect(d.status).toBe(503)
    expect(await d.json()).toMatchObject({ reason: 'schema_not_ready', schemaReady: false })
    expect((await call(PAY_BODY)).status).toBe(503)
    expect(db.claim.findMany).not.toHaveBeenCalled()
    expect(triggerSpy.fn).not.toHaveBeenCalled()
  })

  it('⭐ PAYER with the REFUNDS lease closed → 403, zero attempts, zero Stripe writes', async () => {
    const { body } = await dry()
    closeRefundsLease()
    const res = await call({ confirm: 'PAYER', token: body.token })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ gated: true, reason: 'refunds_closed' })
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
    expect(triggerSpy.fn).not.toHaveBeenCalled()
  })

  it('⭐ PAYER with the claims SURFACE closed → 403, even with the REFUNDS lease wide open', async () => {
    const { body } = await dry()
    closeSurface()
    const res = await call({ confirm: 'PAYER', token: body.token })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ gated: true, reason: 'surface_closed' })
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
  })

  it('⭐⭐ S-14 — the LEGACY rehearsal lease never opens the rail, whatever it opens elsewhere', async () => {
    const { body } = await dry()
    closeSurface()
    openLegacyLease() // Mode A/B's own flag + window: it opens the claims surface for the workflow…
    const res = await call({ confirm: 'PAYER', token: body.token })
    expect(res.status, 'the rehearsal lease must not pay a claim').toBe(403)
    expect(await res.json()).toMatchObject({ reason: 'surface_closed' })
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
    // NEGATIVE CONTROL — the PRODUCT flag, on the same world, lets the same batch through.
    openSurface()
    const ok = await call({ confirm: 'PAYER', token: body.token })
    expect(ok.status).toBe(200)
    expect(triggerSpy.fn).toHaveBeenCalledTimes(1)
  })

  it('⭐ S-30 — the admin audit disabled → 409 audit_disabled, nothing attempted', async () => {
    const { body } = await dry()
    process.env.ADMIN_AUDIT_ENABLED = 'false'
    const res = await call({ confirm: 'PAYER', token: body.token })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'audit_disabled' })
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
    // NEGATIVE CONTROL — re-enabled, the same batch pays.
    process.env.ADMIN_AUDIT_ENABLED = 'true'
    expect((await call({ confirm: 'PAYER', token: body.token })).status).toBe(200)
  })

  it('PAYER without the typed word → 400, nothing attempted', async () => {
    const { body } = await dry()
    const res = await call({ token: body.token })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ reason: 'confirm_required' })
    expect(triggerSpy.fn).not.toHaveBeenCalled()
    // NEGATIVE CONTROL — the exact word, and only it.
    expect((await call({ confirm: 'payer', token: body.token })).status).toBe(400)
    expect((await call({ confirm: 'PAYER', token: body.token })).status).toBe(200)
  })

  it('a token minted for another admin, or absent, is refused — 0 attempts', async () => {
    const other = signPayToken({ adminId: 'admin2', items: [{ claimId: 'cl1', approvedAmountCents: 500, arbitratedAt: null }], lease: null, nowMs: Date.now() })
    const res = await call({ confirm: 'PAYER', token: other })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ reason: 'token_wrong_admin' })
    expect((await call({ confirm: 'PAYER' })).status).toBe(400)
    expect(triggerSpy.fn).not.toHaveBeenCalled()
  })

  it('⭐ a contradictory body — a simulation carrying a payment authorization — is refused outright', async () => {
    const { body } = await dry()
    const res = await call({ dryRun: true, confirm: 'PAYER', token: body.token })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ reason: 'dry_run_with_payment' })
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
    expect(triggerSpy.fn).not.toHaveBeenCalled()
  })

  it('⭐ the same claim named twice is signed ONCE: a batch never offers one claim to the engine twice', async () => {
    const { body } = await dry({ claimIds: ['cl1', 'cl1', 'cl1'] })
    expect(body.payableCount).toBe(1)
    expect((body.claims as unknown[])).toHaveLength(1)
    const out = await (await call({ confirm: 'PAYER', token: body.token })).json()
    expect(out.items).toHaveLength(1)
    expect(out.items[0].outcome).toBe('paid')
    expect(engineSpy.fn).toHaveBeenCalledTimes(1)
  })

  it('an expired token → 409, nothing attempted (the admin must see the numbers again)', async () => {
    const stale = signPayToken({ adminId: ADMIN.id, items: [{ claimId: 'cl1', approvedAmountCents: 500, arbitratedAt: null }], lease: null, nowMs: Date.now() - PAY_TOKEN_TTL_MS - 1 })
    const res = await call({ confirm: 'PAYER', token: stale })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'token_expired' })
    expect(triggerSpy.fn).not.toHaveBeenCalled()
  })
})

// ══ 3. THE DRY RUN ════════════════════════════════════════════════════════════════════════════════════════

describe('D′ L5 — the dryRun shows what the rail WOULD pay, and writes nothing', () => {
  it('⭐ a dryRun with the REFUNDS lease closed still answers, and touches no money', async () => {
    closeRefundsLease()
    const { res, body } = await dry()
    expect(res.status).toBe(200)
    expect(body.mode).toBe('dry_run')
    expect((body.claims as unknown[])).toHaveLength(1)
    expect(body.payableCount).toBe(1)
    expect(body.totalPayableCents).toBe(500)
    expect(body.lease).toMatchObject({ open: false, usable: false })
    expect(body.token).toBeTruthy()
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(db.claim.update).not.toHaveBeenCalled()
  })

  it('the queue is read with the §8.5 selection, FIFO by decision instant, capped at 20', async () => {
    await dry()
    const q = db.claim.findMany.mock.calls[0][0]
    expect(q.where).toEqual(PAYABLE_WHERE)
    expect(q.orderBy).toEqual([{ arbitratedAt: 'asc' }, { createdAt: 'asc' }])
    expect(q.take).toBe(MAX_BATCH)
    db.claim.findMany.mockClear()
    await dry({ take: 3 })
    expect(db.claim.findMany.mock.calls[0][0].take).toBe(3)
    // A body asking for more than the cap is REFUSED, not silently clamped: 20 is the contract, not a hint.
    db.claim.findMany.mockClear()
    expect((await call({ dryRun: true, take: MAX_BATCH + 1 })).status).toBe(400)
    expect((await call({ dryRun: true, claimIds: Array.from({ length: MAX_BATCH + 1 }, (_, i) => 'c' + i) })).status).toBe(400)
    expect(db.claim.findMany).not.toHaveBeenCalled()
  })

  it('⭐ a preflight hold is shown, NOT signed: the token carries only what the rail would really pay', async () => {
    // The order already carries a pending refund row: a second refund would race its cumulative key.
    setWorld({}, (x) => { x.refunds.push({ id: 'rf_p', orderId: 'o1', status: 'pending', amountCents: 100, stripeRefundId: null, reason: null, idempotencyKey: 'refund:o1:0', createdAt: new Date(), royaltyRefundCents: 0 }) })
    const { body } = await dry()
    expect((body.claims as Array<Record<string, unknown>>)[0]).toMatchObject({ payable: false, hold: 'order_has_pending_row' })
    expect(body.payableCount).toBe(0)
    expect(body.token).toBeNull()
    // NEGATIVE CONTROL — without that row the same claim is payable and IS signed.
    setWorld()
    const clean = await dry()
    expect(clean.body.payableCount).toBe(1)
    expect(clean.body.token).toBeTruthy()
  })

  it('⭐ an amount above what the order can still refund is held, with the two numbers', async () => {
    setWorld({ requestedAmountCents: 2500, approvedAmountCents: 2500 }, (x) => {
      x.pis.pi_1.latest_charge.amount_refunded = 1900
      Object.assign(x.orders[0], { total: 20, items: [] })
    })
    const { body } = await dry()
    expect((body.claims as Array<Record<string, unknown>>)[0]).toMatchObject({ payable: false, hold: 'exceeds_refundable' })
    expect(body.payableCount).toBe(0)
    // NEGATIVE CONTROL — on the SAME partially refunded order, an amount inside what is left IS payable: the
    // hold is the live remainder, not the shape of the claim.
    setWorld({ requestedAmountCents: 2500, approvedAmountCents: 100 }, (x) => {
      x.pis.pi_1.latest_charge.amount_refunded = 1900
      Object.assign(x.orders[0], { total: 20, items: [] })
    })
    expect((await dry()).body.payableCount).toBe(1)
  })

  it('⭐ a named claim that does not exist is REPORTED, never dropped from the answer', async () => {
    const { body } = await dry({ claimIds: ['cl1', 'cl_ghost'] })
    const rows = body.claims as Array<Record<string, unknown>>
    expect(rows.map((r) => r.claimId)).toEqual(['cl1', 'cl_ghost'])
    expect(rows[1]).toMatchObject({ payable: false, hold: 'not_selectable', holdDetail: 'not_found' })
    expect(body.payableCount).toBe(1)
  })

  it('the dryRun leaves an audit trail of what was shown, and says no money moved', async () => {
    await dry()
    const entry = auditMock.mock.calls.map((c) => c[0]).find((a) => a.action === 'claim.pay_dry_run')
    expect(entry).toBeTruthy()
    expect(entry.metadata).toMatchObject({ mode: 'dry_run', moneyMoved: false, requested: 1, payable: 1, totalPayableCents: 500 })
    expect(entry.actorId).toBe(ADMIN.id)
  })

  it('⭐ S-14b — a v13 payable proof is NEVER in the automatic batch, and IS payable when explicitly named', async () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    setWorld({ refundError: `no_refund_proven:v13: payable au plus tôt le ${past} (UTC)` })
    // Automatic: the §8.5 WHERE has refundError null, so the world's claim is not even returned…
    const auto = await dry()
    expect(db.claim.findMany.mock.calls[0][0].where).toEqual(PAYABLE_WHERE)
    expect(auto.body.payableCount).toBe(0)
    // …named explicitly, it is offered.
    const named = await dry({ claimIds: ['cl1'] })
    expect(named.body.payableCount).toBe(1)
    // NEGATIVE CONTROL — before its instant it is refused even when named.
    setWorld({ refundError: `no_refund_proven:v13: payable au plus tôt le ${new Date(Date.now() + 60_000).toISOString()} (UTC)` })
    expect((await dry({ claimIds: ['cl1'] })).body.payableCount).toBe(0)
  })
})

// ══ 4. PAYER — the batch ══════════════════════════════════════════════════════════════════════════════════

describe('D′ L5 — PAYER pays the signed batch, in order, and never re-selects', () => {
  it('⭐ a claim whose AMOUNT moved since the dryRun is skipped with zero writes', async () => {
    const { body } = await dry()
    claimOf(w).approvedAmountCents = 400 // an admin withdrew and re-decided between the two calls
    const res = await call({ confirm: 'PAYER', token: body.token })
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.items[0]).toMatchObject({ outcome: 'skipped:stale_dryrun' })
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
    expect(triggerSpy.fn).not.toHaveBeenCalled()
  })

  it('⭐ a claim whose DECISION INSTANT moved is skipped too — same amount is not the same decision', async () => {
    const { body } = await dry()
    claimOf(w).arbitratedAt = new Date(Date.now() + 1000)
    const out = await (await call({ confirm: 'PAYER', token: body.token })).json()
    expect(out.items[0].outcome).toBe('skipped:stale_dryrun')
    expect(triggerSpy.fn).not.toHaveBeenCalled()
  })

  it('⭐ the two skips are said with two different words: a moved DECISION vs a state the rail no longer accepts', async () => {
    // (a) the decision moved: same claim, different amount.
    const moved = await dry()
    claimOf(w).approvedAmountCents = 400
    const a = await (await call({ confirm: 'PAYER', token: moved.body.token })).json()
    expect(a.items[0]).toMatchObject({ outcome: 'skipped:stale_dryrun', evidence: 'identity_moved' })
    // (b) the decision is intact, but a money state was recorded since: a different word, and the clause.
    setWorld()
    const intact = await dry()
    claimOf(w).refundError = 'refund_safety_hold: une vérification a bloqué ce dossier'
    const b = await (await call({ confirm: 'PAYER', token: intact.body.token })).json()
    expect(b.items[0]).toMatchObject({ outcome: 'skipped:not_selectable', evidence: 'refund_error' })
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
    // Both skips are audited: what the rail looked at and refused is part of the trail.
    const skips = auditMock.mock.calls.map((c) => c[0]).filter((x) => x.action === 'claim.pay' && String(x.metadata.outcome).startsWith('skipped:'))
    expect(skips.map((s) => s.metadata.outcome)).toEqual(['skipped:stale_dryrun', 'skipped:not_selectable'])
    for (const s of skips) expect(s.metadata).toMatchObject({ moneyMoved: false, bucket: 'skipped' })
  })

  it('⭐ a claim WITHDRAWN between the two calls is skipped, not paid', async () => {
    const { body } = await dry()
    Object.assign(claimOf(w), { status: 'arbitration', arbitrationDecision: null, approvedAmountCents: null })
    const out = await (await call({ confirm: 'PAYER', token: body.token })).json()
    expect(out.items[0].outcome).toBe('skipped:stale_dryrun')
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
  })

  it('⭐ the happy path: the engine runs, the claim is refunded, the customer is notified ONCE', async () => {
    const { body } = await dry()
    const res = await call({ confirm: 'PAYER', token: body.token })
    expect(res.status).toBe(200)
    const out = await res.json()
    expect(out.items[0]).toMatchObject({ outcome: 'paid', approvedAmountCents: 500, engineAmountCents: 500 })
    expect(out.counts).toMatchObject({ requested: 1, paid: 1, failed: 0, held: 0, review: 0 })
    expect(out.stoppedBy).toBeNull()
    expect(claimOf(w).status).toBe('refunded')
    // The engine was reached exactly once, and the amount it drove is the APPROVED one.
    expect(engineSpy.fn).toHaveBeenCalledTimes(1)
    expect(engineSpy.fn.mock.calls[0][0]).toMatchObject({ orderId: 'o1', amountCents: 500, reason: 'claim:cl1' })
    expect(noticeMock).toHaveBeenCalledTimes(1)
    // ⭐ The rail hands the sender the claim, the gate and — when there is one — STRIPE'S OWN number. It
    // never hands it an amount of its own: the approved figure must not reach a customer as « refunded ».
    const notice = noticeMock.mock.calls[0][0] as Record<string, unknown>
    expect(Object.keys(notice).sort()).toEqual(['claimId', 'claimsOpen', 'evidence'])
    expect(notice.claimId).toBe('cl1')
    expect(notice.claimsOpen).toBe(true)
    if (notice.evidence !== undefined) {
      expect(notice.evidence).toMatchObject({ basis: 'stripe_read' })
      expect(typeof (notice.evidence as { amountCents: unknown }).amountCents).toBe('number')
    }
  })

  it('⭐ S-06 — the rail writes no decision field of its own: every claim write came from the trigger', async () => {
    const { body } = await dry()
    await call({ confirm: 'PAYER', token: body.token })
    const writes = [...db.claim.updateMany.mock.calls, ...db.claim.update.mock.calls].map((c) => c[0].data ?? {})
    expect(writes.length).toBeGreaterThan(0)
    for (const data of writes) {
      for (const forbidden of ['arbitratedBy', 'arbitratedAt', 'arbitrationDecision', 'approvedAmountCents']) {
        expect(Object.keys(data), `the rail must never write ${forbidden}`).not.toContain(forbidden)
      }
    }
    // `decidedAt` is written once, by the trigger's own T4 « ours » CAS that closes a paid claim.
    expect(writes.filter((d) => 'decidedAt' in d)).toHaveLength(1)
    expect(claimOf(w).arbitrationDecision).toBe('approved')
    expect(claimOf(w).approvedAmountCents).toBe(500)
  })

  it('an accepted-but-pending refund is reported as such and notifies NOBODY (§8.6)', async () => {
    const { body } = await dry()
    triggerSpy.fn.mockResolvedValue({ state: 'pending', reason: 'stripe_pending', refundId: 'rf_p' })
    const out = await (await call({ confirm: 'PAYER', token: body.token })).json()
    expect(out.items[0]).toMatchObject({ outcome: 'accepted_pending', refundRowId: 'rf_p' })
    expect(out.counts.pending).toBe(1)
    expect(noticeMock).not.toHaveBeenCalled()
  })

  it('⭐ the lease closing mid-batch STOPS it: the rest is « not attempted », never « failed »', async () => {
    const world = threeClaims()
    const { body } = await dry()
    expect((body.claims as unknown[])).toHaveLength(3)
    let n = 0
    triggerSpy.fn.mockImplementation(async () => {
      n += 1
      return n === 1 ? { state: 'refunded', refundId: 'rf1', amountCents: 500 } : { state: 'pending', reason: 'refunds_disabled' }
    })
    const out = await (await call({ confirm: 'PAYER', token: body.token })).json()
    expect(out.items.map((i: { outcome: string }) => i.outcome)).toEqual(['paid', 'lease_closed', 'not_attempted'])
    expect(out.stoppedBy).toBe('lease_expired')
    expect(out.counts).toMatchObject({ requested: 3, paid: 1, notAttempted: 1 })
    expect(triggerSpy.fn, 'the third claim was never offered to the engine').toHaveBeenCalledTimes(2)
    expect(world.claims).toHaveLength(3)
  })

  it('⭐ a lease with less than the safety margin left stops the batch BEFORE the first claim (S-05)', async () => {
    const { body } = await dry()
    openRefundsLease(0.5) // 30 s: open, but not usable
    const out = await (await call({ confirm: 'PAYER', token: body.token })).json()
    expect(out.items[0].outcome).toBe('not_attempted')
    expect(out.stoppedBy).toBe('lease_expired')
    expect(triggerSpy.fn).not.toHaveBeenCalled()
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
  })

  it('⭐ a throw stops the batch and still answers 200 with the partial report', async () => {
    threeClaims()
    const { body } = await dry()
    let n = 0
    triggerSpy.fn.mockImplementation(async () => {
      n += 1
      if (n === 1) return { state: 'refunded', refundId: 'rf1', amountCents: 500 }
      throw new Error('la base a disparu')
    })
    const res = await call({ confirm: 'PAYER', token: body.token })
    expect(res.status, 'a partial report is an answer, not a 500').toBe(200)
    const out = await res.json()
    expect(out.items.map((i: { outcome: string }) => i.outcome)).toEqual(['paid', 'crashed', 'not_attempted'])
    expect(out.stoppedBy).toBe('crashed')
    // The crash is audited and says the engine outcome is unknown — never « nothing happened ».
    const crashed = auditMock.mock.calls.map((c) => c[0]).filter((a) => a.action === 'claim.pay' && a.metadata.outcome === 'crashed')
    expect(crashed).toHaveLength(1)
    // ⭐ « unknown », never false: a throw may have happened after the engine answered.
    expect(crashed[0].metadata).toMatchObject({ moneyMoved: 'unknown', evidence: 'engine_called_unknown' })
    const batch = auditMock.mock.calls.map((c) => c[0]).find((a) => a.action === 'claim.pay_batch')
    expect(batch.metadata.moneyMoved, 'a batch that paid one claim says true').toBe(true)
  })

  it('⭐ replaying a consumed token is harmless: the second run pays nothing', async () => {
    const { body } = await dry()
    const first = await (await call({ confirm: 'PAYER', token: body.token })).json()
    expect(first.items[0].outcome).toBe('paid')
    const engineCallsAfterFirst = engineSpy.fn.mock.calls.length
    const second = await (await call({ confirm: 'PAYER', token: body.token })).json()
    // A paid claim keeps the amount and the instant it was paid on, so its IDENTITY is intact — what
    // refuses it is its recorded state. The rail says which of the two happened, and here it is the
    // second: « the rail no longer accepts this claim », not « the decision changed under you ».
    expect(second.items[0].outcome, 'a paid claim is refused by its state, not by a changed identity').toBe('skipped:not_selectable')
    expect(second.items[0].evidence).toBe('status')
    expect(engineSpy.fn.mock.calls.length, 'no second engine call').toBe(engineCallsAfterFirst)
    expect(w.refunds).toHaveLength(1)
  })

  it('⭐⭐ S-05 PINNED — the lease is re-read INSIDE the loop: closing it during item 1 stops the batch at item 2', async () => {
    // Hoisting the gate read out of the loop would keep every other test in this file green, so this is
    // the one that forbids it: the lease is closed by the FIRST attempt itself, and the rail must notice
    // before the second claim. Found by the D′ L5 adversarial review (the S-05 claim was unpinned).
    threeClaims()
    const { body } = await dry()
    let n = 0
    triggerSpy.fn.mockImplementation(async () => {
      n += 1
      if (n === 1) { closeRefundsLease(); return { state: 'refunded', refundId: 'rf1', amountCents: 500 } }
      return { state: 'refunded', refundId: `rf${n}`, amountCents: 500 }
    })
    const out = await (await call({ confirm: 'PAYER', token: body.token })).json()
    expect(out.items.map((i: { outcome: string }) => i.outcome)).toEqual(['paid', 'not_attempted', 'not_attempted'])
    expect(out.stoppedBy).toBe('lease_expired')
    expect(triggerSpy.fn, 'the second claim was never offered to the engine').toHaveBeenCalledTimes(1)
  })

  it('⭐ a claim the rail could not READ is said as unreadable — not as « the decision changed »', async () => {
    const { body } = await dry()
    const real = db.claim.findUnique.getMockImplementation()!
    db.claim.findUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
      // Only the rail's own per-item re-read (it selects requestedAmountCents) fails; the engine's reads
      // are left alone, so the test does not accidentally prove something about the trigger.
      if (args?.select && 'requestedAmountCents' in args.select && 'arbitrationReason' in args.select) throw new Error('db down')
      return real(args)
    })
    const out = await (await call({ confirm: 'PAYER', token: body.token })).json()
    expect(out.items[0]).toMatchObject({ outcome: 'skipped:claim_unreadable', evidence: 'claim_unreadable' })
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
    const audited = auditMock.mock.calls.map((c) => c[0]).find((a) => a.action === 'claim.pay')
    expect(audited.metadata).toMatchObject({ outcome: 'skipped:claim_unreadable', moneyMoved: false })
  })

  it('⭐ a ceiling that Stripe did not confirm HOLDS the claim: a db-derived cap can be too high', async () => {
    // The DB cap ignores refunds issued outside this rail, so « inside the remainder » judged against it
    // is not established. For a PAYMENT that is a hold, not a pass (T-59 applied to the rail).
    setWorld({}, (x) => { x.fail.piRetrieve = true; Object.assign(x.orders[0], { total: 20, items: [] }) })
    const { body } = await dry()
    const held = (body.claims as Array<Record<string, unknown>>)[0]
    expect(held.payable).toBe(false)
    expect(['ceiling_unreadable', 'funding_unreadable']).toContain(held.hold)
    expect(body.payableCount).toBe(0)
    expect(body.token).toBeNull()
    // NEGATIVE CONTROL — with Stripe readable the same claim is payable.
    setWorld({}, (x) => { Object.assign(x.orders[0], { total: 20, items: [] }) })
    expect((await dry()).body.payableCount).toBe(1)
  })

  it('⭐⭐ S-14b re-enforced at PAYER: a v13 proof acquired AFTER an automatic dryRun is never paid', async () => {
    // The automatic selection excludes a recorded money state, so an automatic batch can only carry claims
    // whose refundError was null when it was signed. If one acquires a v13 payable proof in between — its
    // amount and its decision instant unchanged — a lenient re-check would pay a claim nobody named.
    const { body } = await dry()
    const past = new Date(Date.now() - 60_000).toISOString()
    claimOf(w).refundError = `no_refund_proven:v13: payable au plus tôt le ${past} (UTC)`
    const auto = await (await call({ confirm: 'PAYER', token: body.token })).json()
    expect(auto.items[0]).toMatchObject({ outcome: 'skipped:not_selectable', evidence: 'refund_error' })
    expect(moneyTouched()).toEqual({ engine: 0, create: 0, rows: 0 })
    // NEGATIVE CONTROL — the SAME claim, in the SAME state, in a batch an admin NAMED: it is paid.
    setWorld({ refundError: `no_refund_proven:v13: payable au plus tôt le ${past} (UTC)` })
    const named = await dry({ claimIds: ['cl1'] })
    expect(named.body.payableCount).toBe(1)
    const out = await (await call({ confirm: 'PAYER', token: named.body.token })).json()
    expect(out.items[0].outcome).toBe('paid')
  })

  it('⭐ an audit row the database refuses is COUNTED and reported, never swallowed', async () => {
    const { body } = await dry()
    auditMock.mockResolvedValue(false) // recordAdminAudit answers « not written »
    const out = await (await call({ confirm: 'PAYER', token: body.token })).json()
    expect(out.items[0].outcome).toBe('paid')
    expect(out.auditGaps, 'a missing trail is said, not implied away').toBe(1)
    // NEGATIVE CONTROL — when the row is written, the count is zero.
    setWorld()
    auditMock.mockResolvedValue(true)
    const ok = await dry()
    expect((await (await call({ confirm: 'PAYER', token: ok.body.token })).json()).auditGaps).toBe(0)
  })

  it('the per-claim and batch audits carry what an operator needs to reconcile', async () => {
    const { body } = await dry()
    await call({ confirm: 'PAYER', token: body.token })
    const perClaim = auditMock.mock.calls.map((c) => c[0]).find((a) => a.action === 'claim.pay')
    expect(perClaim).toMatchObject({ targetType: 'claim', targetId: 'cl1' })
    expect(Object.keys(perClaim.metadata).sort()).toEqual(
      ['approvedAmountCents', 'bucket', 'customerEmail', 'engineAmountCents', 'error', 'evidence', 'moneyMoved', 'outcome', 'refundRowId', 'stripeRefundId'].sort(),
    )
    expect(perClaim.metadata).toMatchObject({ outcome: 'paid', moneyMoved: true, approvedAmountCents: 500, engineAmountCents: 500 })
    const batch = auditMock.mock.calls.map((c) => c[0]).find((a) => a.action === 'claim.pay_batch')
    expect(batch.metadata).toMatchObject({ requested: 1, paid: 1, pending: 0, held: 0, review: 0, failed: 0, skipped: 0, stoppedBy: null })
  })
})

/** Three payable claims on three orders, so a batch has something to stop in the middle of. */
function threeClaims(): World {
  const world = setWorld()
  for (const i of [2, 3]) {
    world.orders.push({ id: `o${i}`, restaurantId: 'r1', paymentStatus: 'paid', stripePaymentIntentId: `pi_${i}` })
    world.pis[`pi_${i}`] = { id: `pi_${i}`, status: 'succeeded', transfer_data: null, metadata: {}, latest_charge: { id: `ch_${i}`, amount: 2000, amount_captured: 2000, amount_refunded: 0, disputed: false } }
    world.claims.push({
      id: `cl${i}`, orderId: `o${i}`, consumerId: 'c1', restaurantId: 'r1', status: 'approved', refundAttempted: false,
      refundId: null, refundError: null, requestedAmountCents: 500, approvedAmountCents: 500,
      arbitrationDecision: 'approved', arbitratedAt: new Date(Date.now() - (4 - i) * 1000), responseDeadlineAt: null, activeOrderKey: `o${i}`,
    })
  }
  return world
}

// ══ 5. THE SOURCE CONTRACT (§8.7) ═════════════════════════════════════════════════════════════════════════

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n).replace(/\\/g, '/')
  return statSync(p).isDirectory() ? walk(p) : [p]
})
const RAIL = 'app/api/admin/claims/pay-approved/route.ts'

describe('D′ L5 — what the rail may never contain (spec v2 §8.7, S-01/S-03/S-04)', () => {
  it('⭐ S-04 — the rail is the ONLY caller of triggerClaimRefund outside lib/claims itself', () => {
    const callers = ['app', 'lib', 'scripts', 'components'].flatMap(walk)
      .filter((f) => /\.(ts|tsx|js)$/.test(f))
      .filter((f) => /\btriggerClaimRefund\s*\(/.test(read(f)))
      .sort()
    expect(callers).toEqual(['app/api/admin/claims/pay-approved/route.ts', 'lib/claims.ts'])
    // NEGATIVE CONTROL — a second caller anywhere would break this list, which is the point of writing it.
    expect(callers).not.toContain('app/api/admin/claims/[id]/arbitrate/route.ts')
  })

  it('⭐ the rail never reaches the engine, Stripe or the cron token directly', () => {
    const src = read(RAIL)
    expect(src).not.toMatch(/executeRefund/)
    expect(src).not.toMatch(/@\/lib\/stripe/)
    expect(src).not.toMatch(/INTERNAL_CRON_TOKEN|x-internal-token/i)
    expect(src).not.toMatch(/prisma\.refund\.create|refund\.create\(/)
    expect(src).not.toMatch(/prisma\.claim\.(update|updateMany|upsert)/)
    // …and it DOES read the lease before each claim (S-05): at least two reads, one per loop turn plus the report.
    expect((src.match(/refundGateState\(/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('⭐ PAYER requires BOTH product-surface and refunds gates, by name, and never the legacy lease', () => {
    const src = read(RAIL)
    expect(src).toMatch(/isRefundsEnabled\(\)/)
    expect(src).toMatch(/isClaimsSurfaceEnabled\(\)/)
    // The legacy rehearsal reader opens the surface elsewhere; it has no business in the money path.
    expect(src).not.toMatch(/\bisClaimsEnabled\b|claimsSurfaceOpen\(/)
  })

  it('the engine file is untouched by this lot (S-15)', () => {
    const src = read('lib/refund.ts')
    expect(src).not.toMatch(/pay-approved|claims-pay-rail|claims-payable-core|D′ L5/)
  })
})
